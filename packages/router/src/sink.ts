// chttp — Web Standards adapter layer.
//
// ResponseSink is the sealed base class both Node and Web surfaces write
// into. NodeResponseSink wraps a real node:http ServerResponse (the
// existing app.handler path, byte-for-byte). FetchResponseSink captures into
// a flat string[] header table + chunk buffer and produces a Response in
// app.fetch's resolve step.
//
// Subset note: Request/Response/URL/Headers are usable as LOCAL variables
// (scriptc lowers them), but NOT as class field types. The fields here are
// exclusively string/number/string[]/number[] (and the body side uses
// _chunks: string[] for now — @chttp/stream can be wired through a
// separate streaming sink in a follow-up). The Web Standards API surface
// (Response, Headers, ReadableStream) lives on app.fetch and the bench
// gate; the sinks themselves stay subset-clean so app.handler compiles
// to ELF byte-for-byte with today.

import type { ServerResponse } from "node:http";
import type { ResView } from "./index.ts";

// View of the ReadableStream controller FetchResponseSink feeds when a
// handler opened streaming mode via writeHead(). Host objects can't be
// class field types (SC1090), so the controller is held through this
// interface view — same trick as WebReqView/ResView in index.ts.
export interface StreamCtl {
  enqueue(b: Uint8Array): void;
  close(): void;
}

// ResponseSink is a base class — not declared `abstract` (scriptc doesn't
// lower abstract methods). Each method has a no-op default; concrete
// sinks override the ones they need. Same pattern as Ctx/ReqView/App.
export class ResponseSink {
  setStatus(_n: number): void {}
  setHeader(_k: string, _v: string): void {}
  appendHeader(_k: string, _v: string): void {}
  writeBody(_s: string): void {}
  bodyBytes(_b: Uint8Array, _ct: string): void {}
  redirect(_url: string, _code: number): void {}
  write(_chunk: string): void {}
  // Streaming commit seam (@chttp/stream): write status + a flat
  // [k1, v1, k2, v2, ...] header list and flush headers so subsequent
  // write() chunks reach the client immediately. On the Node sink this is
  // res.writeHead + flushHeaders; on the fetch sink it arms ReadableStream
  // mode (toResponse() then wraps a live stream instead of the chunk
  // buffer). No-op on the base.
  writeHead(_status: number, _flatPairs: string[]): void {}
  // End-of-stream seam for a writeHead()-opened stream. Node ends the
  // ServerResponse; fetch closes the ReadableStream controller. No-op on
  // the base — a sink that never armed streaming ignores it.
  endStream(): void {}
  // Response adoption (0.4.0): a fetch-path handler returned a Response.
  // No-op on the base (and on NodeResponseSink — there is no Web Response
  // to mirror into a ServerResponse); FetchResponseSink overrides it.
  adopt(_view: {
    status: number;
    body: ReadableStream<Uint8Array> | null;
    headers: Headers;
  }): void {}
  isSent(): boolean {
    return false;
  }
  isHeadersSent(): boolean {
    return false;
  }
  destroy(): void {}
  // Read-back accessors backing Ctx.res (issue #57): a uniform status /
  // header view over both surfaces so `c.res.status` resolves identically
  // under app.handler and app.fetch. Base defaults are no-ops like the
  // write-side members; concrete sinks override.
  statusOf(): number {
    return 200;
  }
  headerOf(_k: string): string | null {
    return null;
  }
  headersMap(): { [k: string]: string } {
    return {};
  }
  // Underlying ServerResponse when the sink wraps one; null otherwise
  // (FetchResponseSink). A method rather than a cast so callers can
  // discriminate sink flavors without `instanceof`/`as` — both are
  // scriptc fences (instanceof hangs on Node builtins; `as` on a class
  // is a runtime assertion that throws).
  nodeRes(): ServerResponse | null {
    return null;
  }
}

// Node: writes through to a real ServerResponse. Field shape mirrors the
// existing handler() path — statusCode + setHeader + end, no behaviour
// drift. Bytes use setHeader('content-type', ct) + setHeader('content-
// length', len) before end, exactly the previous Ctx.bytes() did.
//
// We track which header keys the sink has set in `_set` instead of polling
// res.getHeader. The pre-sink code didn't call res.getHeader at all, and
// test fakes for ServerResponse (unplugin e2e) only implement setHeader/end
// — so reading back via getHeader would either break the fake or couple
// the sink to a contract wider than the existing handler() path. Tracking
// on the sink is also faster and works for both real responses and fakes.
export class NodeResponseSink extends ResponseSink {
  res: ServerResponse;
  _status: number;
  _set: { [k: string]: string };

  constructor(res: ServerResponse) {
    super();
    this.res = res;
    this._status = 200;
    this._set = {};
  }

  setStatus(n: number): void {
    this._status = Number(n);
    this.res.statusCode = this._status;
  }

  setHeader(k: string, v: string): void {
    const kk = String(k);
    this.res.setHeader(kk, String(v));
    this._set[kk.toLowerCase()] = String(v);
  }

  appendHeader(k: string, v: string): void {
    // Subset note: res.setHeader with a string[] value is NOT lowered by
    // scriptc (SC2020), so the multi-value append path doesn't compile to
    // ELF. Under node + ELF, repeated set-cookie collapses to last-write-
    // wins — exactly what node does for raw setHeader(). The Web Standards
    // adapter (FetchResponseSink) preserves the full append list and emits
    // a proper multi-cookie Response at toResponse() time.
    //
    // For users who need multi-cookie under ELF: register the full list as
    // a single comma-joined string before the call (the WS adapter in the
    // fetch surface is the supported path).
    const kk = String(k);
    this.res.setHeader(kk, String(v));
    this._set[kk.toLowerCase()] = String(v);
  }

  writeBody(w: string): void {
    const s = String(w);
    this.res.statusCode = this._status;
    // Empty bodies carry no default content-type (Hono parity: redirects
    // and null-body answers send none). An explicit c.text("") still sets
    // its own content-type upstream of this check.
    if (this._set["content-type"] === undefined && s.length > 0) {
      this.res.setHeader("content-type", "text/plain; charset=UTF-8");
      this._set["content-type"] = "text/plain; charset=UTF-8";
    }
    if (this._set["content-length"] === undefined) {
      this.res.setHeader("content-length", String(utf8len(s)));
      this._set["content-length"] = String(utf8len(s));
    }
    this.res.end(s);
  }

  bodyBytes(b: Uint8Array, ct: string): void {
    this.res.statusCode = this._status;
    this.res.setHeader("content-type", String(ct));
    this.res.setHeader("content-length", String(b.length));
    this.res.end(b);
  }

  redirect(url: string, code: number): void {
    this._status = Number(code);
    this.res.statusCode = this._status;
    this.res.setHeader("location", String(url));
    this.res.end();
  }

  write(chunk: string): void {
    this.res.write(String(chunk));
  }

  writeHead(status: number, flatPairs: string[]): void {
    const res = this.res;
    const obj: { [k: string]: string } = {};
    this._status = Number(status);
    for (let i = 0; i + 1 < flatPairs.length; i += 2) {
      const kk = String(flatPairs[i]);
      obj[kk] = String(flatPairs[i + 1]);
      this._set[kk.toLowerCase()] = String(flatPairs[i + 1]);
    }
    res.writeHead(this._status, obj);
    res.flushHeaders();
  }

  endStream(): void {
    this.res.end();
  }

  isSent(): boolean {
    return this.res.headersSent;
  }

  isHeadersSent(): boolean {
    return this.res.headersSent;
  }

  destroy(): void {
    try {
      this.res.destroy();
    } catch (e) {
      // socket already gone
    }
  }

  statusOf(): number {
    return this._status;
  }

  headerOf(k: string): string | null {
    const v = this._set[String(k).toLowerCase()];
    if (v === undefined) {
      return null;
    }
    return v;
  }

  headersMap(): { [k: string]: string } {
    const out: { [k: string]: string } = {};
    const keys = Object.keys(this._set);
    for (let i = 0; i < keys.length; i++) {
      out[keys[i]] = this._set[keys[i]];
    }
    return out;
  }

  nodeRes(): ServerResponse | null {
    return this.res;
  }
}

// Web Standards capture sink. Headers stored as parallel string[] arrays
// (a flat [k1,v1,k2,v2,...] tuple list) so set/append semantics work
// without a Headers class field (which scriptc refuses to lower as a
// class field type). Body accumulates into _chunks; app.fetch joins the
// chunks at finalize time.
//
// toResponse() runs in app.fetch's resolve step and is the single place
// where new Response/Headers get constructed — keeping scriptc-friendly
// (local-variable only) class field shapes inside the sink.
export class FetchResponseSink extends ResponseSink {
  status: number;
  hdrKeys: string[];
  hdrVals: string[];
  hdrList: string[];
  chunks: string[];
  sent: boolean;
  headersSent: boolean;
  // Adopted Response (0.4.0): the handler's own Response viewed through the
  // ResView interface (host-typed fields are SC1090 — even `unknown`, so no
  // slot for the object itself; the view interface with exactly the members
  // we read lowers at 100% static). null until adopt() runs; toResponse()
  // wraps the adopted body stream instead of the chunk buffer when set.
  adopted: ResView | null;
  // Streaming mode (0.5.0): armed by writeHead() — the response body is a
  // live ReadableStream. _ctl holds the controller once toResponse() hands
  // it over (interface view — see StreamCtl above); writes before that
  // point buffer in chunks and replay at stream start. _endSeen records
  // an endStream() that arrived before the controller did.
  _streaming: boolean;
  _ctl: StreamCtl | null;
  _endSeen: boolean;

  constructor() {
    super();
    this.status = 200;
    this.hdrKeys = [];
    this.hdrVals = [];
    this.hdrList = [];
    this.chunks = [];
    this.sent = false;
    this.headersSent = false;
    this.adopted = null;
    this._streaming = false;
    this._ctl = null;
    this._endSeen = false;
  }

  setStatus(n: number): void {
    this.status = Number(n);
  }

  setHeader(k: string, v: string): void {
    const kk = String(k);
    const vv = String(v);
    // Replace any prior value for this key (set is single-value semantics).
    let found = -1;
    for (let i = 0; i < this.hdrKeys.length; i++) {
      if (this.hdrKeys[i] === kk) {
        found = i;
      }
    }
    if (found < 0) {
      this.hdrKeys.push(kk);
      this.hdrVals.push(vv);
    } else {
      this.hdrVals[found] = vv;
    }
    // hdrList is append-only; rewrite the tail in place.
    let i = 0;
    while (i + 1 < this.hdrList.length) {
      if (this.hdrList[i] === kk) {
        // shift down by 2 to remove the prior pair
        for (let j = i; j + 2 < this.hdrList.length; j++) {
          this.hdrList[j] = this.hdrList[j + 2];
        }
        this.hdrList.pop();
        this.hdrList.pop();
      } else {
        i = i + 2;
      }
    }
    this.hdrList.push(kk);
    this.hdrList.push(vv);
  }

  appendHeader(k: string, v: string): void {
    const kk = String(k);
    const vv = String(v);
    let found = -1;
    for (let i = 0; i < this.hdrKeys.length; i++) {
      if (this.hdrKeys[i] === kk) {
        found = i;
      }
    }
    if (found < 0) {
      this.hdrKeys.push(kk);
      this.hdrVals.push(vv);
    }
    this.hdrList.push(kk);
    this.hdrList.push(vv);
  }

  writeBody(s: string): void {
    const str = String(s);
    if (!this.headersSent) {
      this.headersSent = true;
      // Default content-type for text bodies; user can override before writeBody().
      let haveCT = false;
      for (let i = 0; i + 1 < this.hdrList.length; i += 2) {
        if (this.hdrList[i] === "content-type") {
          haveCT = true;
        }
      }
      // Empty bodies carry no default content-type (Hono parity — see
      // NodeResponseSink.writeBody).
      if (!haveCT && str.length > 0) {
        this.appendHeader("content-type", "text/plain; charset=UTF-8");
      }
    }
    this.chunks.push(str);
    this.sent = true;
  }

  bodyBytes(_b: Uint8Array, ct: string): void {
    this.setHeader("content-type", String(ct));
    if (!this.headersSent) {
      this.headersSent = true;
    }
    // The caller passes the byte length through setHeader('content-length').
    this.sent = true;
  }

  redirect(url: string, code: number): void {
    this.status = Number(code);
    this.setHeader("location", String(url));
    this.sent = true;
  }

  write(chunk: string): void {
    // Streaming arm: once toResponse() has handed the ReadableStream
    // controller over, chunks enqueue directly instead of buffering —
    // this is the path @chttp/stream's fetch writers drive.
    const ctl = this._ctl;
    if (ctl !== null) {
      ctl.enqueue(new TextEncoder().encode(String(chunk)));
      return;
    }
    this.chunks.push(String(chunk));
  }

  writeHead(status: number, flatPairs: string[]): void {
    this.status = Number(status);
    for (let i = 0; i + 1 < flatPairs.length; i += 2) {
      this.setHeader(String(flatPairs[i]), String(flatPairs[i + 1]));
    }
    // Headers committed + streaming armed: isHeadersSent() must report
    // true so a later send500 destroys rather than double-writing, and
    // toResponse() must build the live-stream Response.
    this.headersSent = true;
    this.sent = true;
    this._streaming = true;
  }

  endStream(): void {
    this._endSeen = true;
    this.sent = true;
    const ctl = this._ctl;
    if (ctl !== null) {
      ctl.close();
    }
  }

  // Response adoption (0.4.0): a handler returned a full Response. Its
  // status + Headers overwrite the captured state, and its body stream
  // (the handler's own — never buffered here) is kept on the view so
  // toResponse() wraps it instead of the chunk buffer. Overrides the
  // base no-op: adoption is a fetch-surface behavior.
  adopt(view: { status: number; body: ReadableStream<Uint8Array> | null; headers: Headers }): void {
    this.status = Number(view.status);
    const hs = view.headers;
    const self = this;
    hs.forEach(function (v: string, k: string): void {
      self.setHeader(String(k), String(v));
    });
    this.adopted = view;
  }

  isSent(): boolean {
    return this.sent;
  }

  isHeadersSent(): boolean {
    return this.headersSent;
  }

  statusOf(): number {
    return this.status;
  }

  headerOf(k: string): string | null {
    const kk = String(k).toLowerCase();
    for (let i = 0; i < this.hdrKeys.length; i++) {
      if (this.hdrKeys[i].toLowerCase() === kk) {
        return this.hdrVals[i];
      }
    }
    return null;
  }

  headersMap(): { [k: string]: string } {
    const out: { [k: string]: string } = {};
    for (let i = 0; i < this.hdrKeys.length; i++) {
      out[this.hdrKeys[i]] = this.hdrVals[i];
    }
    return out;
  }

  destroy(): void {
    // Web fetch surface: no socket to destroy. Caller aborts the Request
    // signal upstream if they need to.
  }

  // Build a Response from the captured state. Called by app.fetch after
  // the chain settles. Headers come from hdrList (the append-only tail)
  // so multi-value Set-Cookie / Link survive the round-trip; hdrKeys /
  // hdrVals are the deduped last-wins map used by c.header() lookups.
  //
  // Adoption (0.4.0): when a handler returned a Response, its own body
  // stream is wrapped here — status and headers were already copied into
  // the captured state by adopt(), so the wrapper preserves the handler's
  // stream identity without buffering a byte.
  toResponse(): Response {
    const init: { status: number; headers: [string, string][] } = {
      status: this.status,
      headers: [],
    };
    for (let i = 0; i + 1 < this.hdrList.length; i += 2) {
      init.headers.push([String(this.hdrList[i]), String(this.hdrList[i + 1])]);
    }
    const self = this;
    if (self._streaming) {
      // Streaming response (opened via writeHead): wrap a live
      // ReadableStream. Chunks written before toResponse() replay into
      // the stream at start; chunks written after go straight to the
      // controller through write(). endStream() may already have run —
      // close right after the replay then.
      const rs = new ReadableStream<Uint8Array>({
        start: function (ctl: ReadableStreamDefaultController<Uint8Array>): void {
          self._ctl = ctl;
          const pending = self.chunks;
          for (let i = 0; i < pending.length; i++) {
            ctl.enqueue(new TextEncoder().encode(pending[i]));
          }
          pending.length = 0;
          if (self._endSeen) {
            ctl.close();
          }
        },
      });
      return new Response(rs, init);
    }
    const a = this.adopted;
    if (a !== null) {
      const b = a.body;
      if (b !== null) {
        return new Response(b, init);
      }
      return new Response(null, init);
    }
    // Join captured chunks. Empty joins pass null, not "": the Response
    // constructor stamps its own content-type on a string body even when
    // init.headers has none.
    const body = this.chunks.join("");
    if (body.length > 0) {
      return new Response(body, init);
    }
    return new Response(null, init);
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

export { utf8len };
