// chttp — minimal HTTP router for node:http, async-first.
// Authored inside the scriptc compilable subset so `scriptc build` can
// statically lower the whole package into a native binary:
//   - handlers may return a Promise; sync handlers keep a zero-tick fast
//     path (one return slot + three identity compares per composed layer)
//   - `| null` unions, never `| undefined`
//   - plain ({}) records for route data; real classes for Ctx/ReqView/App
//   - indexed `for` loops only; `.pop()` statements, never expressions
//   - no object/method shorthand in literals, no `?.`/`??`, no eval/new Function
//   - no Object.create(null)/freeze, no Map/Set/RegExp on the hot path
//   - no spread, no array slice/concat on package paths (SC2020)
//   - no function values inside records — handlers live in App._fns and
//     nodes store numeric indices (function-typed record fields degrade
//     the instantiation to `unknown` and fence every method call on them)
//   - no recursion for matching — an explicit frame stack; recursive calls
//     monomorphize an `unknown` instantiation that fences lazy sites
//   - String(x)/Number(x) coercion at function entry for params that
//     arrive `unknown` (SC1090 "string methods as values")
//   - body via req.on('data'|'end') + string concat (Buffer.concat unlowered)
//   - res.end() always statement-called (result use is deferred)

import * as http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

// WebReqView is the fetch-path view of the original Web Request. WHATWG
// Request/Response are host objects scriptc refuses to lower as class field
// types (SC1090 fires even on `Request | null` and `unknown | null` —
// verified on 0.3.4), but an interface with the members we actually read
// lowers at 100% static, and a real Request assigns to it structurally. The
// field stays null on the Node arm, where `_raw` keeps the IncomingMessage.
export interface WebReqView {
  method: string;
  url: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  // Body readers used by declaration-driven buffering: `{ body: true }`
  // routes read via text() inside _dispatchPrim; multipart routes went
  // through arrayBuffer() in app.fetch before dispatch.
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

// ResView is the adoption-time view of a handler-returned Response: the
// settled value cast through a field-check record into the three members
// finalization needs. Same subset rationale as WebReqView — `Response | null`
// as a field type is SC1090; the interface view is not.
export interface ResView {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
}
import { GenDispatch, GenFetch, ROUTE_CONTRACT_VERSION } from "./gen.ts";
import type { DispatchFn, DispatchFetchFn } from "./gen.ts";
import { UpgradeDispatch } from "./upgrade.ts";
import type { Socket } from "node:net";
import { ResponseSink, NodeResponseSink, FetchResponseSink } from "./sink.ts";
import {
  MultipartParser,
  MultipartStorage,
  MemoryStorage,
  DiskStorage,
  multipartBoundary,
  MP_ERR_LIMIT,
} from "./multipart.ts";
import type { MultipartFileSink, UploadedFile, DispositionParams } from "./multipart.ts";

export { GenDispatch, GenFetch };
export { ResponseSink, NodeResponseSink, FetchResponseSink };
export { MultipartParser, MultipartStorage, MemoryStorage, DiskStorage, multipartBoundary };
export { memoryStorage, diskStorage } from "./multipart.ts";
export type { MultipartFileSink, UploadedFile, DispositionParams };
export type { DispatchFn, DispatchFetchFn };
export { ROUTE_CONTRACT_VERSION };
export { UpgradeDispatch };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Shared immutable defaults for ReqView's unbound param tables — read
// only, never mutated (nothing writes _pn/_pi after construction).
const EMPTY_S: string[] = [];
const EMPTY_N: number[] = [];

// Materialize a Node IncomingMessage's headers table into a plain
// lower-cased Record<string, string>. Used by ReqView's constructor;
// also called directly on the app.fetch path with a Web Request's
// captured entries so the fetch surface can reuse ReqView's lookup
// logic without an IncomingMessage fake.
function copyHeaders(src: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (src === undefined || src === null) {
    return out;
  }
  for (const k in src as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === "string") {
        out[String(k).toLowerCase()] = String(v);
      }
    }
  }
  return out;
}

// Materialize a Node IncomingMessage's headersDistinct table
// (Dict<string[]>; only set-cookie and cookie land here) into a
// plain lower-cased Record<string, string[]>. Mirrors copyHeaders.
// Returns an empty record when src is undefined (the fetch path,
// where Web Headers are single-value and joins are applied in
// copyHeaders' string arm).
function copyHeadersDistinct(src: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (src === undefined || src === null) {
    return out;
  }
  for (const k in src as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      const v = (src as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        out[String(k).toLowerCase()] = v as string[];
      }
    }
  }
  return out;
}

export class ReqViewCore {
  // Node arm: the live IncomingMessage. Fetch arm: null. The `raw` name is
  // taken by the Hono-parity getter below (c.req.raw), so the storage field
  // is underscore-prefixed like the other deferred members.
  _raw: IncomingMessage | null;
  // The fetch arm's original Web Request, typed through the WebReqView
  // interface (see the interface note above for why not `Request | null`).
  // null on the Node arm. `rawReq()` is the Hono-parity accessor: whichever
  // object the host handed in, returned untouched.
  _web: WebReqView | null;
  // _headers is the materialized headers table the router reads. The
  // Node path copies from `raw.headers`; the app.fetch path copies from
  // the captured Web Request's Headers. Reading from a Record instead
  // of an IncomingMessage field sidesteps the scriptc limitation on
  // class-typed field access for synthesized fakes.
  _headers: Record<string, string>;
  // _headersDistinct holds the same repeated-value arm (set-cookie,
  // cookie) that IncomingMessage keeps in `headersDistinct`.
  // Materialized at construction so header() can read it from a Record
  // local — a live `this.raw.headersDistinct` read (or any chained cast
  // on a class-typed field) fences scriptc 0.3.x with SC9001 ("live
  // dynFrom of unsupported type httpReq"). The fetch path populates
  // this empty (Web Headers are single-value; multi-value headers are
  // joined with ", " in copyHeaders).
  _headersDistinct: Record<string, string[]>;
  method: string;
  // Full request URL. The Node path stores the raw `req.url` value
  // (path + query, no host — IncomingMessage carries no host). The
  // app.fetch path stores the Web Request's ABSOLUTE URL, matching
  // Hono's c.req.url so middlewares that derive the path themselves
  // (hono/logger's url.slice(indexOf("/", 8))) parse it correctly.
  // `path`/`_qs` remain the path+query split either way.
  url: string;
  path: string;
  _qs: string;
  _qp: string[] | null;
  // Lazy param materialization: _pm stays null until the first param()/
  // splat read, then fills once from the matched entry's declared
  // (name, seg-index) positions — dispatch does zero param work for
  // handlers that never read params. _pn/_pi/_sp come from registration
  // metadata (see pathMeta); generated dispatch seeds _pm directly.
  _pm: string[] | null;
  _pn: string[];
  _pi: number[];
  _sp: number;
  _body: string;
  // Parsed multipart content — populated only for routes that declared
  // `multipart` in RouteOpts (dispatch fills via _setMultipart after the
  // streaming parse completes). Shared immutable empties until then.
  _mpFiles: UploadedFile[];
  _mpFields: string[];

  constructor(
    raw: IncomingMessage | null,
    qs: string,
    path: string,
    url?: string,
    method?: string,
    headers?: Record<string, string>,
    headersDistinct?: Record<string, string[]>,
  ) {
    // `raw === null` is the app.fetch arm: no IncomingMessage exists, so
    // method/headers arrive through the stub args and `raw` stays null
    // (the sanctioned `| null` union — a record arm in a union type is
    // not representable under scriptc). The Web Request itself is captured
    // separately by app.fetch via `_setWeb` after construction, so
    // `c.req.raw` (rawReq()) returns it there; Node callers see the real
    // IncomingMessage from this field.
    if (raw === null) {
      this._raw = null;
      this._web = null;
      this.method = String(method || "");
      this._headers = headers === undefined ? {} : headers;
      this._headersDistinct = headersDistinct === undefined ? {} : headersDistinct;
      this.url = url === undefined ? path : String(url);
    } else {
      this._raw = raw;
      this._web = null;
      this.method = String(raw.method || "");
      // Copy the headers table. The raw object stays around for
      // c.req.raw access (Node arm); _headers is what header() actually
      // reads. The copy is O(headers) once per request, same as the
      // old code path, but it lets the fetch surface build the table
      // from a Web Request without an IncomingMessage fake.
      this._headers = copyHeaders(raw.headers);
      // Copy the headersDistinct table (repeated-value arm: set-cookie,
      // cookie). Same shape as _headers but values are string[].
      // Reading this.raw.headersDistinct fences scriptc 0.3.x with
      // SC9001, so the field is materialized at construction and read
      // from a Record local in header().
      this._headersDistinct = copyHeadersDistinct(raw.headersDistinct);
      // `url` is the full path+query string the caller saw. On the
      // Node path it equals `req.url` (path+query, no host). On the
      // app.fetch path the constructor arg is the parsed path+query
      // used for matching; _dispatchPrim then overwrites `url` with the
      // Web Request's absolute URL for Hono parity (see the field's
      // comment). We accept it as an optional 4th arg so the Node
      // dispatch can default to `raw.url` and the fetch path can
      // pass the already-parsed value (avoids a second split).
      this.url = url === undefined ? String(raw.url || path) : String(url);
    }
    this._qs = String(qs);
    this._qp = null;
    this._pm = null;
    this._pn = EMPTY_S;
    this._pi = EMPTY_N;
    this._sp = -1;
    this._body = "";
    this._mpFiles = [];
    this._mpFields = [];
    this.path = String(path);
  }

  // Hono-parity accessor: `c.req.raw`. Returns the host's request object —
  // the IncomingMessage on the Node arm, the original Web Request on the
  // fetch arm (captured via _setWeb before the chain runs). Typed as `any` on
  // the runtime class to avoid scriptc SC9001 ICE on non-discriminated union
  // prototype lowering; narrowed to `IncomingMessage | WebReqView` on the
  // exported `ReqView` interface below.
  get raw(): any {
    return this.rawReq();
  }

  // The request object the host handed in, untouched: the IncomingMessage on
  // the Node arm, the original Web Request on the fetch arm (set by
  // app.fetch right after construction, before the chain runs). Hono
  // middleware shapes — bodyLimit, methodOverride, sub-request
  // `fetch(c.req.raw)` — read this; it was null on the fetch arm before
  // 0.4.0, which made those middlewares unusable there.
  rawReq(): any {
    const w = this._web;
    if (w !== null) {
      return w;
    }
    return this._raw;
  }

  // Fetch-path capture. Takes the interface view (a real Request satisfies
  // it structurally) and keeps the object alive for c.req.raw reads. The
  // Request's body stream is NOT consumed here — lazy bodies are the
  // contract: undeclared routes get `_body === ""` while the stream stays
  // readable through rawReq().
  _setWeb(r: WebReqView | null): void {
    this._web = r;
  }

  // param() takes `string`, not ParamKey<P>: conditional types never
  // resolve under eager program-code instantiation (SC2001 — the h3-shim
  // report). ParamKey<P> stays exported for .d.ts consumers and any
  // future lazy-instantiation surface; P is still carried on Ctx.
  param(name: string): string | null {
    const n = String(name);
    const pm = this._pmNow();
    for (let i = 0; i < pm.length; i += 2) {
      if (pm[i] === n) {
        return String(pm[i + 1]);
      }
    }
    return null;
  }

  // Generated dispatch (contracts/route-contract.md) installs pre-materialized
  // decoded pairs — flat [name, value, ...] including '*' for a splat.
  _seedPm(pm: string[]): void {
    this._pm = pm;
  }

  _pmNow(): string[] {
    const pm = this._pm;
    if (pm !== null) {
      return pm;
    }
    const out: string[] = [];
    const pn = this._pn;
    const sp = this._sp;
    if (pn.length > 0 || sp >= 0) {
      const segs = String(this.path).split("/");
      for (let i = 0; i < pn.length; i++) {
        const idx = this._pi[i];
        let v = "";
        if (idx < segs.length) {
          v = String(segs[idx]);
        }
        out.push(pn[i]);
        out.push(dec(v));
      }
      if (sp >= 0) {
        let tail = "";
        for (let j = sp; j < segs.length; j++) {
          if (j > sp) {
            tail = tail + "/";
          }
          tail = tail + String(segs[j]);
        }
        out.push("*");
        out.push(dec(tail));
      }
    }
    this._pm = out;
    return out;
  }

  query(name: string): string | null {
    const n = String(name);
    const qp = this._parsed();
    for (let i = 0; i < qp.length; i += 2) {
      if (qp[i] === n) {
        return String(qp[i + 1]);
      }
    }
    return null;
  }

  queryAll(): Record<string, string> {
    const qp = this._parsed();
    const out: Record<string, string> = {};
    for (let i = 0; i < qp.length; i += 2) {
      const k = String(qp[i]);
      out[k] = String(qp[i + 1]);
    }
    return out;
  }

  // All values for a repeated query key, first-seen order. Returns the
  // shared empty array when absent — read-only, never mutated.
  queries(name: string): string[] {
    const n = String(name);
    const qp = this._parsed();
    let out: string[] | null = null;
    for (let i = 0; i < qp.length; i += 2) {
      if (qp[i] === n) {
        if (out === null) {
          out = [];
        }
        out.push(String(qp[i + 1]));
      }
    }
    if (out === null) {
      return EMPTY_S;
    }
    return out;
  }

  header(name: string): string | null {
    const key = String(name).toLowerCase();
    // Read from the materialized _headers table. The Node path copies
    // `raw.headers` once at construction; the app.fetch path populates
    // it from the captured Web Request's Headers. Presence is probed with
    // hasOwnProperty, never a bare index: under program-code compilation a
    // missing typed-record key throws ("record has no key"), while packed
    // dist tolerates the read — this is what fenced `If-None-Match` /
    // `Accept-Encoding` lookups in single-graph (vendored) builds.
    const v = Object.prototype.hasOwnProperty.call(this._headers, key)
      ? this._headers[key]
      : undefined;
    if (v !== undefined) {
      return String(v);
    }
    // Repeated-value arm via the materialized _headersDistinct table.
    // Node keeps only unjoinable headers (set-cookie, cookie) as arrays
    // in `headersDistinct`; the fetch path stores an empty table (Web
    // Headers are single-value, joined in copyHeaders' string arm).
    // d[0] === v[0] for Node joins, so the first-element read is
    // identical to the IncomingMessage semantics.
    const d = Object.prototype.hasOwnProperty.call(this._headersDistinct, key)
      ? this._headersDistinct[key]
      : undefined;
    if (d !== undefined && d.length > 0) {
      return String(d[0]);
    }
    return null;
  }

  body(): string {
    return String(this._body);
  }

  _setBody(s: string): void {
    this._body = String(s);
  }

  // Last file part with this field name; null when absent (or when the
  // route did not declare `multipart`). Last-wins matches Hono's
  // parseBody single-value semantics — use files() for every part.
  file(name: string): UploadedFile | null {
    const n = String(name);
    const f = this._mpFiles;
    let out: UploadedFile | null = null;
    for (let i = 0; i < f.length; i++) {
      if (f[i].field === n) {
        out = f[i];
      }
    }
    return out;
  }

  // Every file part with this field name, in arrival order.
  files(name: string): UploadedFile[] {
    const n = String(name);
    const f = this._mpFiles;
    const out: UploadedFile[] = [];
    for (let i = 0; i < f.length; i++) {
      if (f[i].field === n) {
        out.push(f[i]);
      }
    }
    return out;
  }

  // Last text field with this name; null when absent.
  field(name: string): string | null {
    const n = String(name);
    const fp = this._mpFields;
    let out: string | null = null;
    for (let i = 0; i + 1 < fp.length; i += 2) {
      if (fp[i] === n) {
        out = String(fp[i + 1]);
      }
    }
    return out;
  }

  // Every text field with this name, in arrival order.
  fields(name: string): string[] {
    const n = String(name);
    const fp = this._mpFields;
    const out: string[] = [];
    for (let i = 0; i + 1 < fp.length; i += 2) {
      if (fp[i] === n) {
        out.push(String(fp[i + 1]));
      }
    }
    return out;
  }

  _setMultipart(files: UploadedFile[], fields: string[]): void {
    this._mpFiles = files;
    this._mpFields = fields;
  }

  _parsed(): string[] {
    const cached = this._qp;
    if (cached !== null) {
      return cached;
    }
    const out: string[] = [];
    const qs = String(this._qs);
    if (qs.length > 0) {
      const parts = qs.split("&");
      for (let i = 0; i < parts.length; i++) {
        const p = String(parts[i]);
        const eq = p.indexOf("=");
        if (eq < 0) {
          out.push(dec(p));
          out.push("");
        } else {
          out.push(dec(p.slice(0, eq)));
          out.push(dec(p.slice(eq + 1)));
        }
      }
    }
    this._qp = out;
    return out;
  }
}

// CtxResCore is the typed read-back view `c.res` exposes on BOTH surfaces
// (issue #57): `status`, `header(name)`, and `headers` read through the
// sink's uniform accessors, so Hono's outbound logger (`c.res.status`
// after `await next()`) and the compress/etag/prettyJSON middlewares see
// the same shape under app.handler and app.fetch. Read-only — response
// writes still go through c.status()/c.header()/the body helpers.
export class CtxResCore {
  _sink: ResponseSink;

  constructor(sink: ResponseSink) {
    this._sink = sink;
  }

  get status(): number {
    return this._sink.statusOf();
  }

  // ServerResponse-shaped alias so Node-shaped callers reading
  // `c.res.statusCode` keep working on the Node surface.
  get statusCode(): number {
    return this._sink.statusOf();
  }

  header(name: string): string | null {
    return this._sink.headerOf(String(name));
  }

  get headers(): { [k: string]: string } {
    return this._sink.headersMap();
  }

  // Escape hatch to the underlying ServerResponse on the Node surface
  // (c.res.end() 304-style paths, res.writeHead); null under app.fetch.
  nodeRes(): ServerResponse | null {
    return this._sink.nodeRes();
  }
}

export class CtxCore {
  req: ReqViewCore;
  sink: ResponseSink;
  _resView: CtxResCore;
  _status: number;
  // True once a body-carrying helper (_send/redirect) flushed the response.
  // runOnError reads it: an onError that already answered must not get a
  // second 500 write.
  sent: boolean;
  // Request-scoped variables — JSON-stringified for subset compliance
  // (Record<string, unknown> as a class field is SC1090). Users get/set
  // via c.set/c.get, which JSON-serialize internally. Preserves object
  // identity through round-trip.
  _vars: string;

  // Backwards-compat: a direct reference to the underlying ServerResponse
  // when the sink wraps one. null when the sink is a FetchResponseSink.
  // Subset: ServerResponse is a class so the field type is concrete;
  // assignment at the constructor branches keeps it typed.
  _nodeRes: ServerResponse | null;

  // Typed response view exposed on both surfaces (issue #57). Replaces
  // the old `ServerResponse | null` accessor: Node-shaped downstream code
  // that needs the raw ServerResponse goes through `c.res.nodeRes()` (or
  // the `c._nodeRes` field, used by @chttp/static and @chttp/stream).
  get res(): CtxResCore {
    return this._resView;
  }

  constructor(req: ReqViewCore, sink: ResponseSink) {
    this.req = req;
    // Sink-only ctor: generated dispatch and other ServerResponse callers
    // wrap with `new NodeResponseSink(res)` at the call site. Discriminating
    // a ResponseSink|ServerResponse union inside the ctor hits three
    // scriptc fences at once — `instanceof` hangs on Node builtins, `as`
    // casts are runtime assertions that throw, and `typeof x.method`
    // demotes methods (vercel-labs/scriptc#963). sink.nodeRes() exposes
    // the underlying ServerResponse for Node-shaped downstream code
    // (@chttp/static's 304 path, @chttp/stream's res.writeHead,
    // generated dispatch) without a cast.
    this.sink = sink;
    this._nodeRes = sink.nodeRes();
    this._resView = new CtxResCore(sink);
    this._status = 200;
    this.sent = false;
    this._vars = "{}";
  }

  status(n: number): CtxCore {
    const code = Number(n);
    this._status = code;
    this.sink.setStatus(code);
    return this;
  }

  header(k: string, v: string): CtxCore;
  header(k: string, v: string, opts: { append?: boolean }): CtxCore;
  header(k: string, v: string, opts?: { append?: boolean }): CtxCore {
    if (opts !== undefined && opts !== null && opts.append === true) {
      this.sink.appendHeader(String(k), String(v));
    } else {
      this.sink.setHeader(String(k), String(v));
    }
    return this;
  }

  // Request-scoped vars. JSON-encoded for subset compliance — see _vars
  // comment. Deep-equal semantics: a value written as Object reads back as
  // an equal-but-not-identical object (same as the previous Map/Record
  // pattern in user code).
  set(key: string, value: unknown): void {
    const k = String(key);
    const cur = JSON.parse(this._vars) as Record<string, unknown>;
    cur[k] = value;
    this._vars = JSON.stringify(cur);
  }

  get<T = unknown>(key: string): T | undefined {
    const k = String(key);
    const cur = JSON.parse(this._vars) as Record<string, unknown>;
    return cur[k] as T | undefined;
  }

  json(o: unknown): CtxCore {
    const t = JSON.stringify(o);
    let s = "null";
    if (typeof t === "string") {
      s = t;
    }
    return this._send(s, "application/json; charset=utf-8");
  }

  text(s: string): CtxCore {
    return this._send(String(s), "text/plain; charset=UTF-8");
  }

  html(s: string): CtxCore {
    return this._send(String(s), "text/html; charset=utf-8");
  }

  redirect(url: string): CtxCore;
  redirect(url: string, code: number): CtxCore;
  redirect(url: string, code?: number): CtxCore {
    const n = code === null || code === undefined ? 302 : Number(code);
    this.status(n);
    this.sink.setHeader("location", String(url));
    this.sink.writeBody("");
    this.sent = true;
    return this;
  }

  // Binary body. A separate method (not a string | Buffer union on
  // _send): a mixed-arm union is SC2009 under scriptc. HEAD-safe: node
  // drops the body for HEAD while keeping content-length.
  bytes(b: Uint8Array, ct: string): CtxCore {
    this.sink.setStatus(this._status);
    this.sink.bodyBytes(b, String(ct));
    this.sent = true;
    return this;
  }

  _send(s: string, ct: string): CtxCore {
    const b = String(s);
    this.sink.setStatus(this._status);
    this.sink.setHeader("content-type", ct);
    this.sink.setHeader("content-length", String(utf8len(b)));
    this.sink.writeBody(b);
    this.sent = true;
    return this;
  }
}

// Public surface: `Ctx`/`ReqView` stay parameterized (`Ctx<'/user/:id'>`)
// for source compatibility — they are interface aliases over the
// non-generic Core classes. scriptc 0.3.x lowers a generic class into an
// instance with fields but no method table (every method call throws
// "X is not a function" — vercel-labs/scriptc#963 persists even with
// instanceof discrimination; verified on the spike/scriptc-app-fetch
// bench), so the runtime classes must be non-generic. The
// interface+const merge keeps `new Ctx(...)`, `Ctx` type annotations,
// and `Ctx<'/path'>` all working under tsc while the ELF path sees only
// the concrete Core classes.
export interface Ctx<P extends string = string> extends CtxCore {}
export const Ctx = CtxCore;
export interface ReqView<P extends string = string> extends ReqViewCore {
  readonly raw: IncomingMessage | WebReqView;
  rawReq(): IncomingMessage | WebReqView;
}
export const ReqView = ReqViewCore;
export interface CtxRes extends CtxResCore {}
export const CtxRes = CtxResCore;

// Param names inferred from a path literal: '/user/:id' -> 'id',
// '/a/:x/b/:y' -> 'x' | 'y', '/w/*' -> '*'. Degrades to `string` when the
// path has no params so param() never becomes uncallable. The leading
// `string extends P` guard must stay first: it short-circuits the
// template-literal matching when P is unbound (`string`) so eager
// program-code instantiation resolves a concrete `string` (SC2001
// otherwise), while literal paths still get full inference under tsc and
// per-call-site scriptc instantiation.
export type ParamKey<P extends string> = string extends P
  ? string
  : P extends `${infer _Head}:${infer Rest}`
    ? Rest extends `${infer K}/${infer Tail}`
      ? K | ParamKey<`/${Tail}`>
      : Rest | (P extends `${string}/*` ? "*" : never)
    : P extends `${string}/*`
      ? "*"
      : string;

// What a chain step may return: anything — dispatch ignores non-thenable
// values and settles thenables through `await` (the async contract).
// Response helpers return `c` for chaining, so Ctx-valued returns are
// common. The type is `unknown` rather than
// `void | Ctx | Promise<...>` because the scriptc subset cannot express
// that union: Promise arms mixed with non-Promise arms refuse to compile
// (SC2009), `instanceof Promise` is refused (SC1090), and reading `.then`
// as a value to duck-type it silently lowers to undefined.
export type Handler = (c: CtxCore) => unknown;
export type Next = () => unknown;
export type Middleware = (c: CtxCore, next: Next) => unknown;

// Error-handler signature. Extracted as a named alias so the runChain /
// runOnError functions and the App._oef field type share it without each
// site declaring a fresh function-typed union (which scriptc won't lower
// when the union mentions Ctx in a parameter position).
export type OnErrorFn = (err: unknown, c: CtxCore) => void;

// Multipart upload declaration (RouteOpts.multipart). Opt-in per route
// like `body: true` — dispatch parses the body before the chain runs and
// handlers read results synchronously through c.req.file()/field().
// Limits are enforced during the streaming parse: crossing one aborts
// with 413 and removes the partial temp file. 0 = no cap.
export interface MultipartOpts {
  storage?: MultipartStorage;
  maxFileBytes?: number;
  maxFiles?: number;
  maxFieldBytes?: number;
}

// Route registration options. `body: true` declares body use — the
// deterministic opt-in that lets dispatch buffer the request body only
// for routes that asked for it (contracts/route-contract.md). `multipart`
// declares a form-data upload; the two are mutually exclusive (multipart
// owns the stream).
export interface RouteOpts {
  body?: boolean;
  multipart?: MultipartOpts;
}

function bodyFlag(opts: RouteOpts | undefined): number {
  if (opts === undefined || opts === null) {
    return 0;
  }
  if (opts.body === true) {
    return 1;
  }
  return 0;
}

// Resolved multipart declaration for one route entry — a class (not a
// record) so the per-entry config lives on App._mp like _fns/_mws.
class MpCfg {
  on: number;
  storage: MultipartStorage | null;
  maxFB: number;
  maxNF: number;
  maxFldB: number;

  constructor() {
    this.on = 0;
    this.storage = null;
    this.maxFB = 0;
    this.maxNF = 0;
    this.maxFldB = 0;
  }
}

// Shared default: memory storage, no caps.
const MP_SHARED_MEM = new MemoryStorage();

function optNum(v: number | undefined): number {
  if (v === undefined || v === null) {
    return 0;
  }
  return Number(v);
}

function resolveMp(opts: RouteOpts | undefined): MpCfg {
  const out = new MpCfg();
  if (opts === undefined || opts === null) {
    return out;
  }
  const m = opts.multipart;
  if (m === undefined || m === null) {
    return out;
  }
  if (opts.body === true) {
    throw new Error(
      "chttp: body and multipart are mutually exclusive — multipart owns the request body",
    );
  }
  out.on = 1;
  if (m.storage === undefined || m.storage === null) {
    out.storage = MP_SHARED_MEM;
  } else {
    out.storage = m.storage;
  }
  out.maxFB = optNum(m.maxFileBytes);
  out.maxNF = optNum(m.maxFiles);
  out.maxFldB = optNum(m.maxFieldBytes);
  return out;
}

// True for methods that may carry a request body — same list the
// declared-body rule uses.
function bodyMethod(m: string): boolean {
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

// Terminal answer for a rejected multipart body: write the status, then
// destroy the request socket once the response has flushed. 'finish' is
// the deferred-destroy point (destroying before end() flushes drops the
// response on the floor).
function abortMultipart(
  sink: ResponseSink,
  req: IncomingMessage,
  status: number,
  msg: string,
): void {
  const res = sink.nodeRes();
  if (res !== null) {
    res.on("finish", function (): void {
      req.destroy();
    });
    sink.setHeader("connection", "close");
  }
  sink.setStatus(status);
  sink.setHeader("content-type", "text/plain; charset=UTF-8");
  sink.setHeader("content-length", String(utf8len(msg)));
  sink.writeBody(msg);
}

// Stream-parse a declared multipart request on the Node path: feed the
// parser chunk-wise so limits abort mid-upload and disk storage streams
// straight to its temp file, then install the results on the ReqView and
// run the chain. Fetch-path requests go through _dispatchPrim's buffered
// variant instead.
function runMultipart(
  req: IncomingMessage,
  sink: ResponseSink,
  c: CtxCore,
  cfg: MpCfg,
  chain: Handler,
  oef: OnErrorFn | null,
): void {
  const ct = c.req.header("content-type");
  const bnd = multipartBoundary(ct);
  if (bnd === null) {
    abortMultipart(sink, req, 400, "Expected multipart/form-data");
    return;
  }
  const st = cfg.storage === null ? MP_SHARED_MEM : cfg.storage;
  const parser = new MultipartParser(bnd, st, cfg.maxFB, cfg.maxNF, cfg.maxFldB);
  let answered = false;
  req.on("data", function (chunk: Buffer): void {
    if (answered) {
      return;
    }
    parser.feed(chunk);
    if (parser.err !== 0) {
      answered = true;
      abortMultipart(
        sink,
        req,
        parser.err === MP_ERR_LIMIT ? 413 : 400,
        parser.err === MP_ERR_LIMIT ? "Payload Too Large" : "Malformed multipart body",
      );
    }
  });
  req.on("end", function (): void {
    if (answered) {
      return;
    }
    parser.finish();
    if (parser.err !== 0) {
      abortMultipart(
        sink,
        req,
        parser.err === MP_ERR_LIMIT ? 413 : 400,
        parser.err === MP_ERR_LIMIT ? "Payload Too Large" : "Malformed multipart body",
      );
      return;
    }
    const rv = c.req;
    rv._setMultipart(parser.files, parser.fields);
    runChain(chain, c, sink, oef);
  });
}

// Buffered variant for the fetch path: the body already arrived as bytes
// (arrayBuffer) or a string (fetchShim — utf8-encoded here; binary file
// content does not survive the string shim, a documented fetchShim limit).
function runMultipartPrim(c: CtxCore, cfg: MpCfg, body: string, bodyU8: Uint8Array | null): number {
  const ct = c.req.header("content-type");
  const bnd = multipartBoundary(ct);
  if (bnd === null) {
    return 400;
  }
  const st = cfg.storage === null ? MP_SHARED_MEM : cfg.storage;
  const parser = new MultipartParser(bnd, st, cfg.maxFB, cfg.maxNF, cfg.maxFldB);
  let bytes: Uint8Array;
  if (bodyU8 !== null) {
    bytes = bodyU8;
  } else {
    bytes = new TextEncoder().encode(body);
  }
  parser.feed(bytes);
  if (parser.err === 0) {
    parser.finish();
  }
  if (parser.err !== 0) {
    return parser.err === MP_ERR_LIMIT ? 413 : 400;
  }
  const rv = c.req;
  rv._setMultipart(parser.files, parser.fields);
  return 0;
}

// Write a status + plain text answer through a sink and (on the Node
// surface) close the connection — used by the prim path where there is no
// IncomingMessage to destroy.
function replyPlain(sink: ResponseSink, status: number, msg: string): void {
  sink.setStatus(status);
  sink.setHeader("content-type", "text/plain; charset=UTF-8");
  sink.setHeader("content-length", String(utf8len(msg)));
  sink.writeBody(msg);
}

// ---------------------------------------------------------------------------
// Route table: a trie of plain records. kinds: 0 static, 1 :param, 2 * wildcard.
// Handlers are stored as indices into App._fns (never function values in
// records); methods and middleware snapshots sit in parallel arrays.
// ---------------------------------------------------------------------------

interface RouteNode {
  seg: string;
  kind: number;
  // children holds indices into the owning App._nodes table: a
  // `RouteNode[]` member self-references the record and is rejected under
  // eager program-code instantiation (SC2009), while boxed `unknown[]`
  // reads degrade dispatch — integer indices keep every member concrete.
  children: number[];
  hm: string[];
  // hf[i] is the entry index for hm[i]'s method into App._fns/_mws —
  // function arrays (incl. nested Middleware[][]) cannot live inside
  // records under eager instantiation, so handlers AND their middleware
  // snapshots both live in parallel class-side arrays.
  hf: number[];
}

interface Frame {
  node: RouteNode;
  // pos is the start index (in path) of the next segment to try;
  // pos > len is the leaf-check state (all segments consumed).
  pos: number;
}

function newNode(nodes: RouteNode[], seg: string, kind: number): number {
  nodes.push({
    seg: String(seg),
    kind: Number(kind),
    children: [],
    hm: [],
    hf: [],
  });
  return nodes.length - 1;
}

function addRoute(nodes: RouteNode[], method: string, path: string, hIdx: number): void {
  const m = String(method);
  const p = String(path);
  if (p === "" || p.charAt(0) !== "/") {
    throw new Error("chttp: route path must start with /");
  }
  const segs = p.split("/");
  let ni = 0;
  for (let i = 1; i < segs.length; i++) {
    let seg = String(segs[i]);
    let kind = 0;
    if (seg === "*") {
      kind = 2;
      if (i !== segs.length - 1) {
        throw new Error("chttp: * wildcard must be the last path segment");
      }
    } else if (seg.charAt(0) === ":") {
      kind = 1;
      seg = String(seg.slice(1));
      if (seg === "") {
        throw new Error("chttp: empty :param name in " + p);
      }
    }
    let child = -1;
    const ch = nodes[ni].children;
    for (let k = 0; k < ch.length; k++) {
      const c = nodes[ch[k]];
      if (c.kind === kind && c.seg === seg) {
        child = ch[k];
        break;
      }
    }
    if (child < 0) {
      child = newNode(nodes, seg, kind);
      ch.push(child);
    }
    ni = child;
  }
  nodes[ni].hm.push(m);
  nodes[ni].hf.push(hIdx);
}

// Segment bounds inside `path` without materializing a string[] — the
// old matcher split every request's path up front.
function segEndAt(path: string, pos: number, len: number): number {
  for (let i = pos; i < len; i++) {
    if (path.charCodeAt(i) === 47) {
      return i;
    }
  }
  return len;
}

function segEq(path: string, pos: number, end: number, seg: string): boolean {
  const s = String(seg);
  if (end - pos !== s.length) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    if (path.charCodeAt(pos + i) !== s.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

// Zero-allocation match over the raw path. Depth-first over an explicit
// frame stack (no recursion — recursive calls monomorphize an unknown
// instantiation). Children are pushed wildcard → param → static so static
// pops first, matching the previous matcher's priority. Params are NOT
// extracted here — values are materialized lazily by ReqView from the
// matched entry's declared positions.
function matchPath(nodes: RouteNode[], path: string): RouteNode | null {
  const p = String(path);
  const len = p.length;
  let node = nodes[0];
  let pos = 1;
  // Zero-alloc static descent: advance only while every level resolves to
  // an exact static child; a param/wildcard sibling or a miss hands off
  // to the DFS below.
  let dive = pos <= len;
  while (dive) {
    const end = segEndAt(p, pos, len);
    const ch = node.children;
    let next = -1;
    let alt = false;
    for (let k = 0; k < ch.length; k++) {
      const c = nodes[ch[k]];
      if (c.kind === 0) {
        if (segEq(p, pos, end, c.seg)) {
          next = ch[k];
        }
      } else {
        alt = true;
      }
    }
    if (alt || next < 0) {
      dive = false;
    } else {
      node = nodes[next];
      pos = end + 1;
      dive = pos <= len;
    }
  }
  if (pos > len && node.hf.length > 0) {
    return node;
  }
  const stack: Frame[] = [];
  stack.push({ node: node, pos: pos });
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    stack.pop();
    const fnode = f.node;
    const fpos = f.pos;
    if (fpos > len) {
      if (fnode.hf.length > 0) {
        return fnode;
      }
      continue;
    }
    const end = segEndAt(p, fpos, len);
    const ch = fnode.children;
    for (let k = ch.length - 1; k >= 0; k--) {
      const c = nodes[ch[k]];
      if (c.kind === 2) {
        stack.push({ node: c, pos: len + 1 });
      }
    }
    for (let k = ch.length - 1; k >= 0; k--) {
      const c = nodes[ch[k]];
      if (c.kind === 1) {
        stack.push({ node: c, pos: end + 1 });
      }
    }
    for (let k = ch.length - 1; k >= 0; k--) {
      const c = nodes[ch[k]];
      if (c.kind === 0 && segEq(p, fpos, end, c.seg)) {
        stack.push({ node: c, pos: end + 1 });
      }
    }
  }
  return null;
}

function findEntry(node: RouteNode, method: string): number {
  const m = String(method);
  const hm = node.hm;
  let star = -1;
  for (let i = 0; i < hm.length; i++) {
    if (hm[i] === m) {
      return i;
    }
    if (hm[i] === "*" && star < 0) {
      star = i;
    }
  }
  if (star >= 0) {
    return star;
  }
  if (m === "HEAD") {
    for (let i = 0; i < hm.length; i++) {
      if (hm[i] === "GET") {
        return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function defaultNotFound(c: CtxCore): void {
  c.status(404);
  c.text("Not Found");
}

// Contract helpers for generated dispatch modules (contracts/route-contract.md):
// _guard runs a handler body under the standard 500 path — a thrown error,
// a rejected promise, or a settled chain that wrote no response all answer
// 500 (the exact internal-dispatch rule: _guard delegates to runChain).
// _buffer attaches data/end listeners, buffers the body, then runs k under
// the same guard.
// The internal dispatch inlines the equivalent flow so the hot path never
// pays a closure it doesn't need.
//
// Accepts either a sink or a raw ServerResponse. The contract predates
// the sink split (contracts/route-contract.md) and ships node-typed
// generated dispatch; tests + downstream generated shims still pass `res`
// directly. Internally, real app code passes a sink.
export function _guard(res: ServerResponse, c: CtxCore, k: () => unknown): void {
  const sink: ResponseSink = new NodeResponseSink(res);
  runChain(
    function (): unknown {
      return k();
    },
    c,
    sink,
    null,
  );
}

export function _buffer(
  req: IncomingMessage,
  res: ServerResponse,
  c: CtxCore,
  k: () => unknown,
): void {
  const sink: ResponseSink = new NodeResponseSink(res);
  const rv = c.req;
  let buf = "";
  req.on("data", function (chunk: Buffer): void {
    buf = buf + chunk.toString();
  });
  req.on("end", function (): void {
    rv._setBody(buf);
    runChain(
      function (): unknown {
        return k();
      },
      c,
      sink,
      null,
    );
  });
}

// Fetch-arm contract helpers (contracts/route-contract-fetch.md).
// _guardFetch is _guard's Promise-returning twin: it drains the chain
// through runChainPromise so the emitted dispatch's Promise resolves only
// after the response settles. _bufferFetch mirrors _buffer's declared-body
// rule for fetch: a fetchShim-seeded string wins; when it is empty the
// captured Web Request's text() is buffered before the chain runs (the
// fetch arm's analogue of the Node path's data/end buffering).
export function _guardFetch(c: CtxCore, sink: ResponseSink, k: () => unknown): Promise<void> {
  return new Promise<void>(function (resolve): void {
    // No onError handler on this path — a no-op is passed rather than a
    // literal null so runChainPromise's runOnError specialization never
    // instantiates with a null-typed oef (SC2001). A thrown chain calls
    // the no-op, leaves c.sent false, and the standard send500 runs —
    // the same outcome the `oef === null` arm produces.
    runChainPromise(
      function (): unknown {
        return k();
      },
      c,
      sink,
      function (_e: unknown, _c: CtxCore): void {},
      resolve,
    );
  });
}

export async function _bufferFetch(
  c: CtxCore,
  sink: ResponseSink,
  webReq: WebReqView | null,
  seeded: string,
  k: () => unknown,
): Promise<void> {
  const rv = c.req;
  if (webReq !== null && seeded === "") {
    try {
      rv._setBody(await webReq.text());
    } catch (e) {
      send500(sink);
      return;
    }
  } else {
    rv._setBody(seeded);
  }
  await _guardFetch(c, sink, k);
}

// 405 Method Not Allowed with an Allow header built from the matched
// node's registered methods. `*` (all) expands to every standard verb so
// the header stays spec-true; GET implies HEAD.
function allow405(
  node: RouteNode,
  req: IncomingMessage,
  sink: ResponseSink,
  oef: OnErrorFn | null,
): void {
  const hm = node.hm;
  const seen: { [k: string]: number } = {};
  const out: string[] = [];
  for (let i = 0; i < hm.length; i++) {
    let m = String(hm[i]);
    if (m === "*") {
      m = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
    } else if (m === "GET" && seen["HEAD"] === undefined) {
      // GET implies HEAD; both names end up in the header
      if (seen["GET"] === undefined) {
        seen["GET"] = 1;
        out.push("GET");
      }
      m = "HEAD";
    }
    if (seen[m] === undefined) {
      seen[m] = 1;
      out.push(m);
    }
  }
  if (oef !== null) {
    // The synthetic Ctx wraps the REAL request (path/qs from its url) so an
    // onError handler can inspect it; params are unbound (no match was
    // made for this method) and body is ''. scriptc rejects constructing
    // external classes or widened literals, so no placeholder object here.
    const url = String(req.url || "/");
    let path = url;
    let qs = "";
    const qi = url.indexOf("?");
    if (qi >= 0) {
      path = String(url.slice(0, qi));
      qs = String(url.slice(qi + 1));
    }
    oef(
      new MethodNotAllowedError(out.join(",")),
      new CtxCore(new ReqViewCore(req, qs, path), sink),
    );
    if (sink.isHeadersSent()) {
      return;
    }
  }
  try {
    sink.setStatus(405);
    sink.setHeader("allow", out.join(", "));
    sink.setHeader("content-type", "text/plain; charset=UTF-8");
    sink.setHeader("content-length", "18");
    sink.writeBody("Method Not Allowed");
  } catch (e) {
    sink.destroy();
  }
}

class MethodNotAllowedError extends Error {
  allow: string;
  constructor(allow: string) {
    super("Method Not Allowed");
    this.name = "MethodNotAllowedError";
    this.allow = String(allow);
  }
}

function send500(sink: ResponseSink): void {
  try {
    if (sink.isHeadersSent()) {
      sink.destroy();
    } else {
      sink.setStatus(500);
      sink.setHeader("content-type", "text/plain; charset=UTF-8");
      sink.setHeader("content-length", "21");
      sink.writeBody("Internal Server Error");
    }
  } catch (e) {
    sink.destroy();
  }
}

function utf8len(s: string): number {
  const b = String(s);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b.charCodeAt(i);
    if (c < 0x80) {
      n = n + 1;
    } else if (c < 0x800) {
      n = n + 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < b.length) {
      const c2 = b.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        n = n + 4;
        i = i + 1;
      } else {
        n = n + 3;
      }
    } else {
      n = n + 3;
    }
  }
  return n;
}

export function dec(s: string): string {
  const t = String(s).split("+").join(" ");
  try {
    return decodeURIComponent(t);
  } catch (e) {
    return t;
  }
}

function copyMw(mw: Middleware[]): Middleware[] {
  const out: Middleware[] = [];
  for (let i = 0; i < mw.length; i++) {
    out.push(mw[i]);
  }
  return out;
}

// matchUsePath: true when a request path matches the `app.use(path)`
// filter. The filter is a literal string — `*` alone matches every
// path; a trailing `*` means "this prefix and anything under it";
// anything else is an exact match. Hono's `app.use(path, mw)` has
// the same semantics, so the integration test wiring is symmetric.
function matchUsePath(reqPath: string, filter: string): boolean {
  if (filter === "*") {
    return true;
  }
  if (filter.length > 0 && filter.charAt(filter.length - 1) === "*") {
    const prefix = filter.slice(0, filter.length - 1);
    return reqPath.indexOf(prefix) === 0;
  }
  return reqPath === filter;
}

// runPrefixed: drive a left-to-right fold over `rest` (the middlewares
// passed to `app.use(prefix, ...mws)`). Each step invokes `mws[i]`
// with a `next` that calls the next step, so the whole prefix group
// participates in the outer chain as a single middleware entry. The
// fold is iterative (not recursive) so the scriptc program stays
// within the no-recursion hot-path rule; depth is bounded by the
// number of middlewares registered for the same prefix.
function runPrefixed(mws: Middleware[], i: number, c: CtxCore, outerNext: () => unknown): unknown {
  if (i >= mws.length) {
    return outerNext();
  }
  const mw = mws[i];
  return mw(c, function (): unknown {
    return runPrefixed(mws, i + 1, c, outerNext);
  });
}

// Middleware flattened per route at registration: mw[..] + handler compose
// into ONE Handler, so dispatch makes a single call with zero per-request
// closures (the previous `_chain` cursor allocated one closure per mw per
// request). Linear semantics are identical: next() resumes the tail, and a
// mw calling next() twice re-runs the tail twice — same as the cursor.
// Wrappers return fn(c, next) so an async tail's promise propagates to
// dispatch's settle check. Sync fast path: one return slot + the
// isSettled identity compares
// per layer, zero microtask ticks.
function compose(mw: Middleware[], h: Handler): Handler {
  let chain: Handler = h;
  for (let i = mw.length - 1; i >= 0; i--) {
    const fn = mw[i];
    const inner = chain;
    chain = function (c: CtxCore): unknown {
      return fn(c, function (): unknown {
        return inner(c);
      });
    };
  }
  return chain;
}

function mergeMw(a: Middleware[], b: Middleware[]): Middleware[] {
  const out: Middleware[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push(a[i]);
  }
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
  }
  return out;
}

// Registration-time route metadata: declared param positions in the
// pattern. Dispatch binds these to ReqView so params materialize lazily
// (never touched for routes whose handlers don't read params).
interface PathMeta {
  names: string[];
  idxs: number[];
  splat: number;
}

function pathMeta(path: string): PathMeta {
  const names: string[] = [];
  const idxs: number[] = [];
  let splat = -1;
  const segs = String(path).split("/");
  for (let i = 1; i < segs.length; i++) {
    const seg = String(segs[i]);
    if (seg === "*") {
      splat = i;
    } else if (seg.charAt(0) === ":") {
      names.push(String(seg.slice(1)));
      idxs.push(i);
    }
  }
  return { names: names, idxs: idxs, splat: splat };
}

interface MountFrame {
  i: number;
  a: string;
}

function mountRoutes(sub: App, app: App, prefix: string, pre: Middleware[]): void {
  const sn = sub._nodes;
  const stack: MountFrame[] = [{ i: 0, a: "" }];
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    stack.pop();
    const n = sn[f.i];
    const a = String(f.a);
    const hs = n.hf;
    if (hs.length > 0) {
      let path = String(prefix) + a;
      if (path === "") {
        path = "/";
      }
      for (let i = 0; i < hs.length; i++) {
        const subMw = sub._mws[hs[i]];
        const idx = app._regFn(
          sub._fns[hs[i]],
          mergeMw(pre, subMw),
          pathMeta(path),
          sub._bodyF[hs[i]],
          sub._mp[hs[i]],
        );
        addRoute(app._nodes, n.hm[i], path, idx);
      }
    }
    const ch = n.children;
    for (let i = 0; i < ch.length; i++) {
      const c = sn[ch[i]];
      let seg = String(c.seg);
      if (c.kind === 1) {
        seg = ":" + seg;
      }
      stack.push({ i: ch[i], a: a + "/" + seg });
    }
  }
}

export class App {
  _nodes: RouteNode[];
  _mw: Middleware[];
  _fns: Handler[];
  // _mws[i] is the middleware snapshot for handler _fns[i] — kept on the
  // class, not in RouteNode records, because function-array record members
  // are rejected under eager program-code instantiation (SC2009).
  _mws: Middleware[][];
  _nf: Handler;
  _nfmw: Middleware[];
  // onError handler: (err, c) => void. null = unset (default send500 path).
  _oef: OnErrorFn | null;
  // _chains[i] is _mws[i] + _fns[i] flattened into one Handler — dispatch
  // calls it directly; there is no runtime chain walker.
  _chains: Handler[];
  _nfchain: Handler;
  // Per-entry route metadata (parallel to _fns): declared param positions
  // for lazy materialization and the `body: true` declaration flag.
  _pn: string[][];
  _pi: number[][];
  _sp: number[];
  _bodyF: number[];
  // Per-entry resolved multipart config (parallel to _fns). mp.on === 1
  // means the route declared `multipart` and dispatch parses the body
  // through MultipartParser before the chain runs.
  _mp: MpCfg[];
  // Generated-dispatch seam (contracts/route-contract.md): a plain function
  // field, not an interface-typed field — an interface with a method member
  // would fence eager program-code instantiation the same way a function
  // inside a record does. Default returns false (never registered).
  _gen: DispatchFn;
  // Web Standards generated dispatch (contracts/route-contract-fetch.md),
  // same closure-field shape as _gen. Default resolves false — the app
  // falls back to _dispatchPrim when no emitted fetch module is
  // registered, so the fetch path works identically with or without the
  // unplugin emit.
  _genFetch: DispatchFetchFn;
  // Upgrade seam (contracts/upgrade-contract.md), same closure-field shape as
  // _gen. serve() never attaches an "upgrade" listener: any attach built
  // inside package dist JS defers 2 SC1090 sites for EVERY npm app
  // importing the router (scriptc cannot recover the listener's parameter
  // types from the emitted .js), including apps that never upgrade.
  // Upgrade users wire server.on("upgrade", ...) in their own program —
  // an inline annotated listener or a typed alias of upgradeHandler()
  // both lower 100% under npm-static compilation.
  _up: (req: IncomingMessage, socket: Socket, head: Buffer) => boolean;

  constructor() {
    this._nodes = [];
    newNode(this._nodes, "", 0);
    this._mw = [];
    this._fns = [];
    this._mws = [];
    this._nf = defaultNotFound;
    this._nfmw = [];
    this._oef = null;
    this._chains = [];
    this._nfchain = defaultNotFound;
    this._pn = [];
    this._pi = [];
    this._sp = [];
    this._bodyF = [];
    this._mp = [];
    this._gen = function (_r: IncomingMessage, _s: ServerResponse): boolean {
      return false;
    };
    this._genFetch = function (
      _m: string,
      _u: string,
      _h: Record<string, string> | null,
      _w: WebReqView | null,
      _b: string,
      _b8: Uint8Array | null,
      _s: FetchResponseSink,
    ): Promise<boolean> {
      return new Promise<boolean>(function (resolve): void {
        resolve(false);
      });
    };
    this._up = function (_r: IncomingMessage, _s: Socket, _h: Buffer): boolean {
      return false;
    };
  }

  // Verb methods take `path: string` + `Ctx`, not `<P extends string>`:
  // a value parameter typed by a type parameter cannot compile under
  // eager program-code instantiation (SC2001). The generic rode along
  // for literal-param inference, but param() is string-typed regardless
  // — no type-safety is lost. `opts.body` declares body use; without it
  // c.req.body() returns '' (contracts/route-contract.md).
  get(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("GET", path, h, opts);
  }

  post(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("POST", path, h, opts);
  }

  put(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("PUT", path, h, opts);
  }

  delete(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("DELETE", path, h, opts);
  }

  patch(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("PATCH", path, h, opts);
  }

  head(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("HEAD", path, h, opts);
  }

  options(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("OPTIONS", path, h, opts);
  }

  all(path: string, h: Handler, opts?: RouteOpts): App {
    return this._add("*", path, h, opts);
  }

  on(method: string, path: string, h: Handler, opts?: RouteOpts): App {
    return this._add(String(method).toUpperCase(), path, h, opts);
  }

  // Register a middleware (runs on every request).
  use(fn: Middleware): App;
  // Register one or more middlewares scoped to a path prefix. The
  // path is a literal string (optionally ending in `*` for "anything
  // under this prefix"); `*` alone matches every path. The match is
  // `c.req.path.startsWith(prefix)` after stripping a trailing `*`.
  // This shape mirrors Hono's `app.use(path, ...mws)` so middlewares
  // like `hono/logger` can be wired in unmodified — the path filter
  // wraps the middleware in a closure that delegates to `next()`
  // when the path doesn't match, so it doesn't disturb the chain.
  use(path: string, ...mws: Middleware[]): App;
  use(pathOrFn: string | Middleware, ...rest: Middleware[]): App {
    if (typeof pathOrFn === "string") {
      const prefix = pathOrFn;
      const wrapped: Middleware = function (c, next): unknown {
        if (matchUsePath(c.req.path, prefix)) {
          // Run the first middleware; it owns the rest of the chain
          // through its `next` argument. When more than one
          // middleware is registered for the same prefix, fold them
          // in left-to-right with the same closure.
          return runPrefixed(rest, 0, c, next);
        }
        return next();
      };
      this._mw.push(wrapped);
      // Keep the notFound chain in step: use() middleware wraps 404s too
      // (Hono semantics — hono/logger's outbound line must fire on a miss;
      // issue #57). Per-route snapshots in _mws are unaffected.
      this._nfchain = compose(copyMw(this._mw), this._nf);
      return this;
    }
    this._mw.push(pathOrFn);
    this._nfchain = compose(copyMw(this._mw), this._nf);
    return this;
  }

  notFound(h: Handler): App {
    this._nf = h;
    this._nfmw = copyMw(this._mw);
    this._nfchain = compose(this._nfmw, this._nf);
    return this;
  }

  // Single catch-all around the whole chain. Honored by both dispatch
  // paths (immediate + buffered-body). Rethrow/throw inside the handler
  // falls back to the built-in 500 — onError must not loop.
  onError(h: OnErrorFn): App {
    this._oef = h;
    return this;
  }

  route(prefix: string, sub: App): App {
    let p = String(prefix);
    if (p.length > 1 && p.charAt(p.length - 1) === "/") {
      p = String(p.slice(0, p.length - 1));
    }
    mountRoutes(sub, this, p, copyMw(this._mw));
    return this;
  }

  // Registers a generated dispatch module (contracts/route-contract.md). The
  // stored field is a closure so `d` only has to satisfy the GenDispatch
  // class shape at the call site — subclasses, duck-typed objects, and the
  // emitted `class X extends GenDispatch` all work.
  withDispatch(d: GenDispatch): App {
    // Contract-version drift guard. The field read is guarded before any
    // use (headersDistinct lesson: reading a member scriptc leaves absent
    // must come after an existence check, decisions.md line 6). A missing
    // stamp is accepted — dispatches without one predate versioning.
    const stamped = d.ROUTE_CONTRACT_VERSION;
    if (typeof stamped === "number" && stamped !== ROUTE_CONTRACT_VERSION) {
      throw new Error(
        "chttp: route contract version mismatch — dispatch was generated against contract v" +
          String(stamped) +
          ", runtime implements v" +
          String(ROUTE_CONTRACT_VERSION) +
          ". Regenerate .chttp/*.gen.ts (upgrade @chttp/unplugin to match chttp) or align chttp.",
      );
    }
    const g = d;
    this._gen = function (rq: IncomingMessage, rs: ServerResponse): boolean {
      return g.dispatch(rq, rs);
    };
    return this;
  }

  // Registers a generated Web Standards dispatch module
  // (contracts/route-contract-fetch.md) — the fetch-arm twin of
  // withDispatch, tried FIRST by app.fetch and app.fetchShim. A `false`
  // resolution declines to _dispatchPrim (405/404/notFound and bailed
  // routes).
  withFetchDispatch(d: GenFetch): App {
    // Same contract-version drift guard as withDispatch — the stamp check
    // runs before any other member read.
    const stamped = d.ROUTE_CONTRACT_VERSION;
    if (typeof stamped === "number" && stamped !== ROUTE_CONTRACT_VERSION) {
      throw new Error(
        "chttp: route contract version mismatch — fetch dispatch was generated against contract v" +
          String(stamped) +
          ", runtime implements v" +
          String(ROUTE_CONTRACT_VERSION) +
          ". Regenerate .chttp/*.gen.fetch.ts (upgrade @chttp/unplugin to match chttp) or align chttp.",
      );
    }
    const g = d;
    this._genFetch = function (
      m: string,
      u: string,
      h: Record<string, string> | null,
      w: WebReqView | null,
      b: string,
      b8: Uint8Array | null,
      s: FetchResponseSink,
    ): Promise<boolean> {
      return g.dispatchFetch(m, u, h, w, b, b8, s);
    };
    return this;
  }

  // Registers an upgrade dispatch (contracts/upgrade-contract.md). Last call
  // wins. The listener is only attached by serve()/upgradeHandler() users
  // when one is registered, so apps without it keep node's default.
  withUpgrade(u: UpgradeDispatch): App {
    const g = u;
    this._up = function (rq: IncomingMessage, sk: Socket, hd: Buffer): boolean {
      return g.upgrade(rq, sk, hd);
    };
    return this;
  }

  // Listener for custom servers: server.on("upgrade", app.upgradeHandler()).
  // An unhandled upgrade (nothing registered, or upgrade() returned false)
  // destroys the socket, matching node's behaviour without a listener.
  upgradeHandler(): (req: IncomingMessage, socket: Socket, head: Buffer) => void {
    const app = this;
    return function (req: IncomingMessage, socket: Socket, head: Buffer): void {
      if (!app._up(req, socket, head)) {
        socket.destroy();
      }
    };
  }

  // Node-shaped listener: thin wrapper that wraps res in a NodeResponseSink
  // and forwards into _dispatch. The dispatch primitive is sink-shaped
  // (and shared with app.fetch); this method is the boundary that keeps
  // node:http users on the same surface they had before the sink split.
  handler(): (req: IncomingMessage, res: ServerResponse) => void {
    const app = this;
    return function (req: IncomingMessage, res: ServerResponse): void {
      app._dispatch(req, new NodeResponseSink(res));
    };
  }

  serve(opts: { port: number }): Server;
  serve(opts: { port: number; host: string }): Server;
  serve(opts: { port: number; host?: string }): Server {
    // No "upgrade" attach here (see the _up field note): apps that take
    // upgrades wire server.on("upgrade", app.upgradeHandler()) themselves
    // after serve() returns the server, typed at their own call site.
    const s = http.createServer(this.handler());
    if (opts.host === null || opts.host === undefined) {
      s.listen(Number(opts.port));
    } else {
      s.listen(Number(opts.port), String(opts.host));
    }
    return s;
  }

  _regFn(h: Handler, mw: Middleware[], m: PathMeta, body: number, mp: MpCfg): number {
    this._fns.push(h);
    this._mws.push(mw);
    this._chains.push(compose(mw, h));
    this._pn.push(m.names);
    this._pi.push(m.idxs);
    this._sp.push(m.splat);
    this._bodyF.push(body);
    this._mp.push(mp);
    return this._fns.length - 1;
  }

  _add(method: string, path: string, h: Handler, opts?: RouteOpts): App {
    const idx = this._regFn(h, copyMw(this._mw), pathMeta(path), bodyFlag(opts), resolveMp(opts));
    addRoute(this._nodes, method, path, idx);
    return this;
  }

  // Web Standards canonical entry. Identical signature to Hono's
  // `app.fetch(req, env, ctx)` so off-the-shelf Hono middlewares drop in
  // (validated by examples/integrations/hono-middleware/). Returns a
  // Promise<Response> that resolves once the sink has finished writing.
  //
  // Bodies are read lazily, mirroring the Node path's declaration-driven
  // buffering: only routes that declared `{ body: true }` (or multipart
  // opts) get `req.text()`/`req.arrayBuffer()` run before the chain.
  // Undeclared routes see `c.req.body() === ""` and read the original
  // Request's unconsumed stream via `c.req.raw` — a 0.4.0 behavior change
  // (0.3 buffered everything). The Request itself is captured into the
  // ReqView (`c.req.raw` returns it) so middleware that needs
  // spec-compliant access (bodyLimit, methodOverride, sub-request
  // `fetch(c.req.raw)`) works on the fetch arm.
  //
  // Handler-returned Response objects are adopted at finalization: a
  // handler may either write through `c.*` or return a Response (Hono
  // accepts both); see adoptResponse in the chain runner.
  //
  // Generated dispatch (contracts/route-contract-fetch.md) is Web
  // Standards-shaped: the emitted GenFetch matcher takes the same
  // normalized primitives _dispatchPrim consumes and writes straight into
  // the FetchResponseSink — no synthesized ServerResponse anywhere. A
  // `false` resolution declines to _dispatchPrim for 405/404/notFound and
  // routes the emitter bailed on.
  fetch(req: Request, _env?: unknown, _ctx?: unknown): Promise<Response> {
    const app = this;
    // The router matches on the path part of the URL (Node's IncomingMessage
    // exposes only the path+query in `req.url`). Use the URL constructor to
    // pull out path+query.
    const parsed = new URL(req.url);
    const url = String(parsed.pathname) + String(parsed.search);
    const method = String(req.method);
    const sink = new FetchResponseSink();
    return (async function (): Promise<Response> {
      // Pre-read the body ONLY for multipart-declared routes (byte-exact
      // content: req.text() would mangle binary file bytes through utf8
      // decoding). Everything else stays lazy: the matched route's bodyFlag
      // decides inside _dispatchPrim whether to buffer, and undeclared
      // routes keep the Request's stream untouched for c.req.raw readers.
      const ctH = req.headers.get("content-type");
      const isMp = ctH !== null && String(ctH).toLowerCase().indexOf("multipart/form-data") === 0;
      let body = "";
      let bodyU8: Uint8Array | null = null;
      if (isMp && method !== "GET" && method !== "HEAD") {
        bodyU8 = new Uint8Array(await req.arrayBuffer());
      }
      // Generated Web Standards dispatch first (contracts/
      // route-contract-fetch.md); a `false` resolution declines to the
      // runtime path — same decline shape as the Node arm's _gen check.
      const hs = headersFromRaw(req);
      const handled = await app._genFetch(method, url, hs, req, body, bodyU8, sink);
      if (handled === false) {
        await app._dispatchPrim(method, url, hs, req, body, bodyU8, sink);
      }
      return sink.toResponse();
    })();
  }

  // Host-shim entry for compiled (ELF) programs. `new Request` is
  // unconstructable under scriptc (upstream fence, tracked with
  // vercel-labs/scriptc#963 follow-ups), so an ELF host cannot call
  // app.fetch(req). This variant takes plain primitives and reports the
  // response back through a callback — no WHATWG types on either side:
  //
  //   app.fetchShim(method, url, headers, body, function (status, hdrList, out) {
  //     res.statusCode = status;
  //     for (let i = 0; i + 1 < hdrList.length; i += 2) {
  //       res.setHeader(hdrList[i], hdrList[i + 1]);
  //     }
  //     res.end(out);
  //   });
  //
  // hdrList is a flat [k1, v1, k2, v2, ...] array in finalization order —
  // appendHeader keys appear once per appended value, matching HTTP wire
  // semantics. `respond` may fire synchronously for 404/405 fast paths;
  // hosts must treat it as fire-and-forget (same contract as handler()).
  // JS runtimes should keep using app.fetch — this entry exists so the
  // same route table is exercisable in a native ELF (bench/apps/
  // fetch-surface.ts is the working example).
  fetchShim(
    method: string,
    url: string,
    headers: Record<string, string> | null,
    body: string,
    respond: (status: number, hdrList: string[], body: string) => void,
  ): void {
    const app = this;
    const sink = new FetchResponseSink();
    const m = String(method).toUpperCase();
    const seeded = m === "GET" || m === "HEAD" ? "" : String(body);
    // Generated Web Standards dispatch first — the emitted GenFetch runs
    // identically on plain primitives (webReq === null), so an ELF bench
    // exercises the same lowered matcher as app.fetch. Decline falls
    // through to _dispatchPrim.
    const p = app._genFetch(String(method), String(url), headers, null, seeded, null, sink);
    p.then(function (handled: boolean): void {
      if (handled === false) {
        const p2 = app._dispatchPrim(
          String(method),
          String(url),
          headers,
          null,
          seeded,
          null,
          sink,
        );
        p2.then(function (): void {
          respond(sink.status, sink.hdrList, sink.chunks.join(""));
        });
        return;
      }
      respond(sink.status, sink.hdrList, sink.chunks.join(""));
    });
  }

  // Internal: the shared dispatch primitive that drives both app.handler
  // (Node) and app.fetch (Web Standards). Takes normalized primitives
  // (method, url, an optional header table, the optional Web Request being
  // dispatched, an optional pre-buffered body — set only for multipart
  // routes and fetchShim's seeded string — and the destination sink).
  // Returns a Promise so app.fetch can await it.
  //
  // Lazy bodies (0.4.0): when `body` arrives empty and the matched route
  // declared `{ body: true }`, the body is buffered HERE from the captured
  // Request's stream (the fetch arm's analogue of the Node path's
  // data/end buffering in _dispatch). Undeclared routes skip the read:
  // `c.req.body()` stays "" and the Request's stream passes through
  // unconsumed for c.req.raw readers.
  async _dispatchPrim(
    method: string,
    url: string,
    webHeaders: Record<string, string> | null,
    webReq: WebReqView | null,
    body: string,
    bodyU8: Uint8Array | null,
    sink: ResponseSink,
  ): Promise<void> {
    const app = this;
    const oef = app._oef;
    let path = url;
    let qs = "";
    const qi = url.indexOf("?");
    if (qi >= 0) {
      path = String(url.slice(0, qi));
      qs = String(url.slice(qi + 1));
    }
    const node = matchPath(app._nodes, path);
    let chain = app._nfchain;
    let idx = -1;
    if (node !== null) {
      const j = findEntry(node, method);
      if (j >= 0) {
        idx = node.hf[j];
        chain = app._chains[idx];
      } else if (node.hf.length > 0) {
        // Path matched, method didn't: 405 + Allow from the node's method
        // table (computed only on this miss path — zero hot-path cost).
        return new Promise<void>(function (resolve): void {
          allow405Promise(node as RouteNode, method, url, sink, oef, resolve);
        });
      }
    }
    // Build a minimal IncomingMessage-shaped object for the ReqView
    // constructor. ReqView only reads .method and .headers from raw;
    // .headers is overridden via _headers (set right after construction).
    // The IncomingMessage fake has to satisfy the type but never gets
    // its method called; we use a stub. On the Node path, webHeaders is
    // null and the constructor copies from raw.headers (an empty
    // IncomingMessage fake is fine — the real headers are populated
    // upstream of this entry by app.handler).
    const rv = new ReqViewCore(
      null,
      qs,
      path,
      url,
      String(method),
      webHeaders === null ? undefined : webHeaders,
    );
    if (idx >= 0) {
      rv._pn = app._pn[idx];
      rv._pi = app._pi[idx];
      rv._sp = app._sp[idx];
    }
    // Capture the Web Request before the chain runs so c.req.raw returns
    // it (Hono parity). The stream is left untouched here — body reading
    // is declaration-driven below.
    rv._setWeb(webReq);
    // Hono parity: c.req.url is the ABSOLUTE URL on the fetch surface —
    // hono/logger derives the path as url.slice(url.indexOf("/", 8)),
    // which misreads a path-only value ("g" for "/missing"). The Node
    // surface stays path+query-only because IncomingMessage.url carries
    // no host (issue #57).
    if (webReq !== null) {
      rv.url = String(webReq.url);
    }
    // Lazy bodies: multipart routes arrive with their bytes already read
    // (app.fetch's arrayBuffer for byte-exact parsing); fetchShim seeds a
    // utf8 string. Everything else defers to the route's bodyFlag: declared
    // `{ body: true }` routes buffer here from the Request's stream;
    // undeclared routes keep `_body === ""` and the stream unconsumed —
    // c.req.raw readers own the bytes (0.4.0 contract; 0.3 buffered all).
    let chainBody = String(body);
    if (
      idx >= 0 &&
      chainBody === "" &&
      bodyU8 === null &&
      webReq !== null &&
      app._bodyF[idx] === 1 &&
      bodyMethod(method)
    ) {
      chainBody = await webReq.text();
    }
    rv._setBody(chainBody);
    const c = new CtxCore(rv, sink);
    return new Promise<void>(function (resolve): void {
      // Multipart-declared routes parse the (already buffered) body
      // before the chain — same per-route opt-in as the Node path. A
      // rejected body answers 400/413 through the sink, no chain run.
      if (idx >= 0 && bodyMethod(method)) {
        const mp = app._mp[idx];
        if (mp.on === 1) {
          const rc = runMultipartPrim(c, mp, chainBody, bodyU8);
          if (rc === 413) {
            replyPlain(sink, 413, "Payload Too Large");
            resolve();
            return;
          }
          if (rc !== 0) {
            replyPlain(sink, 400, "Malformed multipart body");
            resolve();
            return;
          }
        }
      }
      runChainPromise(chain, c, sink, oef, resolve);
    });
  }

  _dispatch(req: IncomingMessage, sink: ResponseSink): void {
    // Generated dispatch (contracts/route-contract.md) takes the raw
    // ServerResponse, not a sink — the contract is node-shaped. Pass
    // through whatever the sink wraps when the sink is a NodeResponseSink
    // (the only path generated handlers run on today). When called from
    // app.fetch the sink is a FetchResponseSink and has no underlying
    // ServerResponse; the contract has no Web Standards variant yet
    // (follow-up A in the plan).
    //
    // Subset: the sink-resolver uses a typed field on the concrete
    // NodeResponseSink class — no `as { res: ... }` casts (scriptc fences
    // those as SC1090 opaque structural views).
    const genRes: ServerResponse | null = sink.nodeRes();
    if (genRes !== null && this._gen(req, genRes)) {
      return;
    }
    const oef = this._oef;
    const method: string = String(req.method || "");
    const url: string = String(req.url || "/");
    let path = url;
    let qs = "";
    const qi = url.indexOf("?");
    if (qi >= 0) {
      path = String(url.slice(0, qi));
      qs = String(url.slice(qi + 1));
    }
    const node = matchPath(this._nodes, path);
    let chain = this._nfchain;
    let body = 0;
    let idx = -1;
    if (node !== null) {
      const j = findEntry(node, method);
      if (j >= 0) {
        idx = node.hf[j];
        chain = this._chains[idx];
        body = this._bodyF[idx];
      } else if (node.hf.length > 0) {
        // Path matched, method didn't: 405 + Allow from the node's method
        // table (computed only on this miss path — zero hot-path cost).
        allow405(node, req, sink, oef);
        return;
      }
    }
    const rv = new ReqViewCore(req, qs, path, url);
    if (idx >= 0) {
      rv._pn = this._pn[idx];
      rv._pi = this._pi[idx];
      rv._sp = this._sp[idx];
    }
    const c = new CtxCore(rv, sink);
    const carrying = bodyMethod(method);
    if (idx >= 0 && this._mp[idx].on === 1 && carrying) {
      // Declared multipart upload: the parser owns the stream, the
      // declared storage strategy owns the bytes.
      runMultipart(req, sink, c, this._mp[idx], chain, oef);
    } else if (body === 1 && carrying) {
      let buf = "";
      req.on("data", function (chunk: Buffer): void {
        buf = buf + chunk.toString();
      });
      req.on("end", function (): void {
        rv._setBody(buf);
        runChain(chain, c, sink, oef);
      });
    } else {
      runChain(chain, c, sink, oef);
    }
  }
}

// Run the composed chain under the standard error path. A sync throw, a
// rejected promise, or a settled chain that never answered all produce
// exactly one terminal outcome: onError(err, c) when registered, else the
// built-in send500. Sync handlers keep a zero-microtask fast path — the
// settle check is three identity compares on the return slot; only
// non-settled results pay an async frame.
//
// Whether a chain result is already settled: undefined/null returns and
// the `c` object response helpers hand back for chaining carry nothing
// to await. Everything else (promises, stray non-thenable values) goes
// through `await` in settleChain — the only "maybe a Promise"
// discrimination the scriptc subset can express without refused or
// miscompiled constructs. Identity, not a type read: `r === c` compares
// reference, no cast on `r`.
function isSettled(r: unknown, c: CtxCore): boolean {
  return r === undefined || r === null || r === (c as unknown);
}

// Settles a chain result that is not already settled. `await`
// passthroughs non-thenables and joins real promises, so a reject and a
// fulfilled-without-response both land on the standard error path. Called
// fire-and-forget — send500/runOnError are internally guarded, so the
// returned promise can never reject.
async function settleChain(
  r: unknown,
  c: CtxCore,
  sink: ResponseSink,
  oef: OnErrorFn | null,
): Promise<void> {
  try {
    await r;
  } catch (e) {
    if (oef !== null) {
      runOnError(oef, e, sink, c);
    } else {
      send500(sink);
    }
    return;
  }
  if (c.sent === false && sink.isHeadersSent() === false) {
    send500(sink);
  }
}

function runChain(chain: Handler, c: CtxCore, sink: ResponseSink, oef: OnErrorFn | null): void {
  try {
    const r = chain(c);
    if (isSettled(r, c)) {
      if (c.sent === false && sink.isHeadersSent() === false) {
        send500(sink);
      }
    } else {
      settleChain(r, c, sink, oef);
    }
  } catch (e) {
    if (oef !== null) {
      runOnError(oef, e, sink, c);
    } else {
      send500(sink);
    }
  }
}

// Run the user onError handler; anything it throws (or a response it never
// writes) falls back to the built-in 500 path so the socket always gets
// exactly one terminal outcome. Headers already sent cannot become a 500, so
// the socket is destroyed — but the handler still runs first (a streaming
// callback that rejects after streamSSE flushed headers must be observable),
// and with no handler registered the router stays quiet (no console noise;
// the destroyed response is the error surface, same as send500's sent path).
function runOnError(oef: OnErrorFn, e: unknown, sink: ResponseSink, c: CtxCore): void {
  try {
    oef(e, c);
    if (!c.sent && !sink.isHeadersSent()) {
      send500(sink);
    } else {
      sink.destroy();
    }
  } catch (e2) {
    if (!sink.isHeadersSent()) {
      send500(sink);
    } else {
      sink.destroy();
    }
  }
}

export function createRouter(): App {
  return new App();
}

// ---------------------------------------------------------------------------
// Web Standards <-> Node bridge helpers (app.fetch path)
// ---------------------------------------------------------------------------

// Minimal IncomingMessage-shaped object used by the app.fetch dispatch
// path. The real IncomingMessage constructor requires a Socket (extends
// stream.Readable) which scriptc 0.3.1 doesn't lower well; a record
// literal cast to IncomingMessage also fails (SC2002 width subtyping).
// A class with the two fields the router actually reads (`method`,
// `headers`) lowers cleanly and accepts the IncomingMessage cast at the
// ReqView constructor site.
// `headers` is read by ReqView's constructor (one-shot copy into
// _headers) and never touched again. `method` is read for the
// constructor's `this.method` initialization; c.req.method is set there
// before the app.fetch wrapper discards the stub. Implemented as a
// Record literal at the call site rather than a class because scriptc
// Capture headers from a Web Request into a plain Record<string, string>.
// Multi-value headers (set-cookie) are joined with ", " per RFC 7230 —
// sufficient for the router's `header()` reader which only returns the
// first value. The full multi-value set is captured separately on the
// FetchResponseSink via appendHeader.
function headersFromRaw(req: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (req === null || req === undefined) {
    return out;
  }
  const h = (req as { headers: { forEach: (cb: (v: string, k: string) => void) => void } }).headers;
  h.forEach(function (v: string, k: string): void {
    out[String(k).toLowerCase()] = String(v);
  });
  return out;
}

// Promise-returning variant of runChain for the Fetch path. The
// fire-and-forget Node path is unchanged (runChain above). The Fetch
// path needs to `await` chain completion so app.fetch returns a
// settled Response; we wrap the existing runChain in a callback that
// resolves the Promise once the chain has produced a response or
// runOnError has run.
// Adoption-time view of a handler-returned Response, with the subset-safe
// field-check that decides whether a settled chain value IS one. `instanceof`
// and `.then` reads are subset-refused; `typeof status === "number"` plus
// body/headers presence is the sanctioned shape (a plain record carrying all
// three adopts too — documented, same trade-off Hono makes with its
// Response-shape check).
function adoptResponse(r: unknown, c: CtxCore): boolean {
  if (r === null || r === undefined || r === (c as unknown)) {
    return false;
  }
  const o = r as { status?: unknown; body?: unknown; headers?: unknown } | null;
  if (o === null) {
    return false;
  }
  if (typeof o.status !== "number") {
    return false;
  }
  if (o.headers === null || o.headers === undefined) {
    return false;
  }
  // body may legitimately be null (204/304-style Responses).
  const view: ResView = {
    status: o.status,
    body: o.body === null || o.body === undefined ? null : (o.body as ReadableStream<Uint8Array>),
    headers: o.headers as Headers,
  };
  const sink = c.sink;
  // Only the fetch surface adopts: the Node surface keeps its
  // write-through sink semantics (an adopted Response would have no
  // ServerResponse to mirror into).
  sink.adopt(view);
  return true;
}

function runChainPromise(
  chain: Handler,
  c: CtxCore,
  sink: ResponseSink,
  oef: OnErrorFn | null,
  resolve: () => void,
): void {
  // The Fetch path is async-only; the sync fast path matters less
  // because app.fetch already crosses at least one microtask (await
  // req.text()). Use the async settle path so the resolve() fires
  // after the chain fully drains.
  // A synchronous throw must become a 500, not a rejected promise —
  // runChain (the Node twin) catches it inline; here the guard keeps
  // app.fetch and fetchShim from surfacing an unhandled rejection.
  let r: unknown;
  try {
    r = chain(c);
  } catch (e) {
    if (oef !== null) {
      runOnError(oef, e, sink, c);
    } else {
      send500(sink);
    }
    resolve();
    return;
  }
  if (isSettled(r, c)) {
    if (c.sent === false && sink.isHeadersSent() === false) {
      send500(sink);
    }
    resolve();
    return;
  }
  // Not a thenable or already settled? The chain can return a Promise;
  // we await it via settleChain's existing pattern, but adapted to
  // also resolve on success. A settled Response value is adopted into
  // the sink instead of counting as "sent nothing" (passthrough
  // handlers `(c) => handler(c.req.raw)` are the motivating shape).
  const p = settleAndResolveAdopting(r, c, sink, oef);
  p.then(resolve, resolve);
}

function settleAndResolveAdopting(
  r: unknown,
  c: CtxCore,
  sink: ResponseSink,
  oef: OnErrorFn | null,
): Promise<void> {
  return new Promise<void>(function (resolve): void {
    function done(): void {
      if (c.sent === false && sink.isHeadersSent() === false) {
        if (adoptResponse(r, c) === false) {
          send500(sink);
        }
      }
      resolve();
    }
    if (r !== null && r !== undefined && typeof (r as { then?: unknown }).then === "function") {
      try {
        (r as Promise<unknown>).then(
          function (v: unknown): void {
            // Resolve-then-adopt: a promise fulfilled WITH a Response
            // adopts that value, not the promise itself.
            if (v !== null && v !== undefined && v !== (c as unknown)) {
              r = v;
            }
            done();
          },
          function (e: unknown): void {
            if (oef !== null) {
              runOnError(oef, e, sink, c);
            } else {
              send500(sink);
            }
            resolve();
          },
        );
      } catch (e) {
        if (oef !== null) {
          runOnError(oef, e, sink, c);
        } else {
          send500(sink);
        }
        resolve();
      }
      return;
    }
    done();
  });
}

// Promise-returning variant of allow405. Same shape as runChainPromise
// but for the 405 path on app.fetch (which can't go through the fire-
// and-forget Node listener).
function allow405Promise(
  node: RouteNode,
  method: string,
  url: string,
  sink: ResponseSink,
  oef: OnErrorFn | null,
  resolve: () => void,
): void {
  const hm = node.hm;
  const seen: { [k: string]: number } = {};
  const out: string[] = [];
  for (let i = 0; i < hm.length; i++) {
    let m = String(hm[i]);
    // Same expansion as the Node allow405: `*` covers every standard verb
    // and GET implies HEAD so the header stays spec-true.
    if (m === "*") {
      m = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
    } else if (m === "GET" && seen["HEAD"] === undefined) {
      if (seen["GET"] === undefined) {
        seen["GET"] = 1;
        out.push("GET");
      }
      m = "HEAD";
    }
    if (seen[m] !== 1) {
      seen[m] = 1;
      out.push(m);
    }
  }
  // Match the Node allow405 split: a registered onError gets the
  // MethodNotAllowedError, then we still try to write a 405.
  if (oef !== null) {
    let path = url;
    let qs = "";
    const qi = url.indexOf("?");
    if (qi >= 0) {
      path = String(url.slice(0, qi));
      qs = String(url.slice(qi + 1));
    }
    const rv = new ReqViewCore(null, qs, path, url, String(method));
    const c = new CtxCore(rv, sink);
    oef(new MethodNotAllowedError(out.join(",")), c);
    if (sink.isHeadersSent()) {
      resolve();
      return;
    }
  }
  try {
    sink.setStatus(405);
    sink.setHeader("allow", out.join(", "));
    sink.setHeader("content-type", "text/plain; charset=UTF-8");
    sink.setHeader("content-length", "18");
    sink.writeBody("Method Not Allowed");
  } catch (e) {
    sink.destroy();
  }
  resolve();
}
