// Typed HTTP client for chttp apps — `createClient(baseUrl)` + verb
// helpers whose `params` are keyed by `ParamKey<P>` inference
// (`'/users/:id'` -> `{ params: { id } }`). The response type is
// caller-declared (`client.get<User>("/users/:id", ...)`): there is no
// route manifest, so nothing is inferred from the App generic.
//
// Transport is a minimal HTTP/1.1 client over node:net / node:tls —
// `fetch`/`new Request()` are not constructible under scriptc, so the
// same socket path serves Node.js and the compiled ELF. Requests are
// one-shot (`Connection: close`): no keep-alive, redirects, or body
// streaming in v1. `chunked` transfer-encoding IS decoded because
// node:http emits it for length-unknown bodies even on close.
//
// scriptc notes for consumers: generic calls must dispatch through a
// `ClientCore`-typed receiver — `const c: ClientCore = createClient(u)`
// — because generic methods through the `Client<App>` interface are
// signature-only to the compiler (SC1090). On Node.js the interface
// receiver is fine.

import { connect as netConnect } from "node:net";
import type { Socket } from "node:net";
import { connect as tlsConnectRaw } from "node:tls";
import type { ParamKey } from "./index.ts";

// Runtime input record: non-generic so program code never instantiates
// ParamKey (conditional types are a .d.ts-only surface, SC2001).
export interface ClientInputCore {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

// Typed twin: narrows `params` keys to the path's declared params.
// `ClientInput<P>` is assignable to ClientInputCore because
// Record<ParamKey<P>, string> is a Record<string, string>.
export interface ClientInput<P extends string = string> extends ClientInputCore {
  params?: Record<ParamKey<P>, string>;
}

export interface ClientOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export class ClientResponse {
  status: number;
  headers: Record<string, string>;
  body: string;

  constructor(status: number, headers: Record<string, string>, body: string) {
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  json<T>(): T {
    return JSON.parse(this.body) as T;
  }
}

// Missing-key reads on records throw under scriptc ("record has no key"
// — typed slots can't represent undefined). Probe with hasOwnProperty
// first, the same pattern ReqView uses for its header records.
function hasKey(rec: Record<string, string>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, k);
}

interface ParsedBase {
  protocol: string;
  host: string;
  port: number;
  basePath: string;
}

function parseBase(baseUrl: string): ParsedBase {
  const u = new URL(baseUrl);
  let port = u.port === "" ? (u.protocol === "https:" ? 443 : 80) : Number.parseInt(u.port, 10);
  let basePath = u.pathname;
  if (basePath === "/") {
    basePath = "";
  }
  return { protocol: u.protocol, host: u.hostname, port: port, basePath: basePath };
}

// Replaces `:param` segments and a trailing `*` from params, then
// appends the query string. Unreplaced params throw — a missing param
// is a caller bug, and a silent `/users/:id` upstream is worse.
function buildPath(path: string, input: ClientInputCore | null): string {
  let p = path;
  let params: Record<string, string> | null = null;
  let query: Record<string, string> | null = null;
  if (input !== null && input !== undefined) {
    if (input.params !== undefined) {
      params = input.params;
    }
    if (input.query !== undefined) {
      query = input.query;
    }
  }
  if (params !== null) {
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = encodeURIComponent(params[k]);
      if (k === "*") {
        p = p.split("*").join(v);
      } else {
        p = p.split(":" + k).join(v);
      }
    }
  }
  if (p.indexOf(":") >= 0 || p.indexOf("*") >= 0) {
    throw new Error("chttp client: unresolved path params in " + p);
  }
  if (query !== null) {
    const keys = Object.keys(query);
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(query[k]));
    }
    if (parts.length > 0) {
      p = p + "?" + parts.join("&");
    }
  }
  return p;
}

function headerLines(
  input: ClientInputCore | null,
  opts: ClientOpts | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts !== null && opts.headers !== undefined) {
    const keys = Object.keys(opts.headers);
    for (let i = 0; i < keys.length; i++) {
      out[keys[i].toLowerCase()] = opts.headers[keys[i]];
    }
  }
  if (input !== null && input !== undefined && input.headers !== undefined) {
    const keys = Object.keys(input.headers);
    for (let i = 0; i < keys.length; i++) {
      out[keys[i].toLowerCase()] = input.headers[keys[i]];
    }
  }
  return out;
}

// body: unknown — strings are sent raw with text/plain, everything
// else JSON.stringify with application/json; an explicit content-type
// header wins either way.
function bodyBytes(input: ClientInputCore | null): Uint8Array | null {
  if (input === null || input === undefined || input.body === undefined || input.body === null) {
    return null;
  }
  const b = input.body;
  if (typeof b === "string") {
    return new TextEncoder().encode(b);
  }
  return new TextEncoder().encode(JSON.stringify(b));
}

// Reads the whole socket to EOF (we always send `Connection: close`).
function readAll(sock: Socket): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    sock.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    sock.on("error", (e: Error) => {
      reject(e);
    });
    sock.on("close", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

function connect(base: ParsedBase, timeoutMs: number): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    let settled = false;
    let sock: Socket;
    if (base.protocol === "https:") {
      // tls.connect returns a TLSSocket — Socket-shaped for every member
      // this client touches; typed as Socket so no double-cast is needed.
      sock = tlsConnectRaw(base.port, base.host, {
        servername: base.host,
        rejectUnauthorized: true,
      }) as Socket;
    } else {
      sock = netConnect(base.port, base.host);
    }
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      settled = true;
      resolve(sock);
    });
    sock.once("secureConnect", () => {
      settled = true;
      resolve(sock);
    });
    const fail = (e: Error): void => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(e);
      }
    };
    sock.once("error", fail);
    sock.once("timeout", () => {
      fail(new Error("chttp client: connect timed out"));
    });
  });
}

// Decodes `Transfer-Encoding: chunked`; identity bodies pass through.
// Throws on a truncated chunk rather than returning a partial body.
function dechunk(buf: Buffer, off: number): string {
  const body = buf.subarray(off);
  let out = "";
  let i = 0;
  for (;;) {
    let eol = -1;
    for (let j = i; j + 1 < body.length; j++) {
      if (body[j] === 13 && body[j + 1] === 10) {
        eol = j;
        break;
      }
    }
    if (eol < 0) {
      throw new Error("chttp client: truncated chunk size");
    }
    const size = Number.parseInt(body.subarray(i, eol).toString("latin1").trim(), 16);
    if (size === 0) {
      break;
    }
    const start = eol + 2;
    if (start + size > body.length) {
      throw new Error("chttp client: truncated chunk body");
    }
    out = out + body.subarray(start, start + size).toString("utf8");
    i = start + size + 2;
  }
  return out;
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function parseResponse(raw: Buffer): RawResponse {
  const headEnd = raw.indexOf("\r\n\r\n");
  if (headEnd < 0) {
    throw new Error("chttp client: malformed response (no header terminator)");
  }
  const head = raw.subarray(0, headEnd).toString("latin1");
  const lines = head.split("\r\n");
  if (lines.length === 0) {
    throw new Error("chttp client: empty response");
  }
  const statusParts = lines[0].split(" ");
  const status = Number.parseInt(statusParts.length > 1 ? statusParts[1] : "0", 10);
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].indexOf(":");
    if (c > 0) {
      headers[lines[i].substring(0, c).trim().toLowerCase()] = lines[i].substring(c + 1).trim();
    }
  }
  let body: string;
  if (
    hasKey(headers, "transfer-encoding") &&
    headers["transfer-encoding"].indexOf("chunked") >= 0
  ) {
    body = dechunk(raw, headEnd + 4);
  } else {
    body = raw.subarray(headEnd + 4).toString("utf8");
  }
  return { status: status, headers: headers, body: body };
}

export class ClientCore {
  _base: ParsedBase;
  _opts: ClientOpts | null;

  constructor(baseUrl: string, opts?: ClientOpts | null) {
    this._base = parseBase(baseUrl);
    this._opts = opts === undefined ? null : opts;
  }

  /**
   * Full-control call: returns status + headers + raw body string.
   * Non-generic, so it dispatches through the `Client<App>` interface
   * under scriptc too.
   */
  async request(
    method: string,
    path: string,
    input?: ClientInputCore | null,
  ): Promise<ClientResponse> {
    const inp: ClientInputCore | null = input === undefined || input === null ? null : input;
    const rel = buildPath(path, inp);
    const headers = headerLines(inp, this._opts);
    const body = bodyBytes(inp);
    if (!hasKey(headers, "host")) {
      headers["host"] = this._base.host;
    }
    headers["connection"] = "close";
    if (body !== null) {
      headers["content-length"] = String(body.length);
      if (!hasKey(headers, "content-type")) {
        const isStr = inp !== null && typeof inp.body === "string";
        headers["content-type"] = isStr ? "text/plain" : "application/json";
      }
    }
    let wire = method + " " + this._base.basePath + rel + " HTTP/1.1\r\n";
    const hk = Object.keys(headers);
    for (let i = 0; i < hk.length; i++) {
      wire = wire + hk[i] + ": " + headers[hk[i]] + "\r\n";
    }
    wire = wire + "\r\n";
    const timeoutMs =
      this._opts !== null && this._opts.timeoutMs !== undefined ? this._opts.timeoutMs : 30000;
    const sock = await connect(this._base, timeoutMs);
    try {
      sock.write(wire);
      if (body !== null) {
        sock.write(Buffer.from(body));
      }
      const raw = await readAll(sock);
      const r = parseResponse(raw);
      return new ClientResponse(r.status, r.headers, r.body);
    } finally {
      sock.destroy();
    }
  }

  /** Decodes the response body: JSON when content-type is json, else text. */
  async _call<T>(method: string, path: string, input?: ClientInputCore | null): Promise<T> {
    const res = await this.request(method, path, input === undefined ? null : input);
    if (hasKey(res.headers, "content-type") && res.headers["content-type"].indexOf("json") >= 0) {
      return res.json<T>();
    }
    const body: unknown = res.body;
    return body as T;
  }

  get<T = unknown>(path: string, input?: ClientInputCore | null): Promise<T> {
    return this._call("GET", path, input === undefined ? null : input);
  }

  post<T = unknown>(path: string, input?: ClientInputCore | null): Promise<T> {
    return this._call("POST", path, input === undefined ? null : input);
  }

  put<T = unknown>(path: string, input?: ClientInputCore | null): Promise<T> {
    return this._call("PUT", path, input === undefined ? null : input);
  }

  patch<T = unknown>(path: string, input?: ClientInputCore | null): Promise<T> {
    return this._call("PATCH", path, input === undefined ? null : input);
  }

  delete<T = unknown>(path: string, input?: ClientInputCore | null): Promise<T> {
    return this._call("DELETE", path, input === undefined ? null : input);
  }
}

// Phantom-generic surface: `Client<App>` carries the app type for
// .d.ts consumers (and future manifest typing) without changing the
// runtime class — the `Ctx<P> extends CtxCore` pattern. The verb
// redeclarations below add `ParamKey<P>` path-param checking for tsc
// consumers; they are signature-only, so scriptc can never dispatch
// them — compiled apps must bind a `ClientCore` receiver and take the
// concrete signatures (params then type as Record<string, string>).
export interface Client<_App = unknown> extends ClientCore {
  get<T = unknown, P extends string = string>(path: P, input?: ClientInput<P> | null): Promise<T>;
  post<T = unknown, P extends string = string>(path: P, input?: ClientInput<P> | null): Promise<T>;
  put<T = unknown, P extends string = string>(path: P, input?: ClientInput<P> | null): Promise<T>;
  patch<T = unknown, P extends string = string>(path: P, input?: ClientInput<P> | null): Promise<T>;
  delete<T = unknown, P extends string = string>(
    path: P,
    input?: ClientInput<P> | null,
  ): Promise<T>;
}
export const Client = ClientCore;

export function createClient<App = unknown>(
  baseUrl: string,
  opts?: ClientOpts | null,
): Client<App> {
  return new ClientCore(baseUrl, opts === undefined ? null : opts);
}
