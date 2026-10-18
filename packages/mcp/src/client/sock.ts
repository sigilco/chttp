// Minimal HTTP/1.1 client over node:net / node:tls — the ELF transport
// path. One socket per request (`Connection: close`), headers parsed to
// the \r\n\r\n boundary, body read to EOF and de-chunked when
// Transfer-Encoding says so. Verified lowering on scriptc 0.3.3:
// net.createServer/connect, tls connect(port, host, {servername}),
// TextDecoder, setTimeout — all run inside a compiled ELF.

import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnectRaw } from "node:tls";

export interface HttpResponse {
  status: number;
  // unknown-valued on purpose: absent-key reads on a {k:string} record
  // abort at runtime ("typed slot — no undefined is representable"), so
  // optional headers probe through `typeof === "string"`.
  headers: { [k: string]: unknown };
  body: string;
}

export class HttpTarget {
  host: string;
  port: number;
  path: string;
  tls: boolean;
  constructor(host: string, port: number, path: string, tls: boolean) {
    this.host = host;
    this.port = port;
    this.path = path;
    this.tls = tls;
  }
}

// Parses an http(s):// URL into host/port/path/tls. Throws on anything
// else — only plain host:port endpoints are in scope for v1.
export function parseHttpTarget(url: string): HttpTarget {
  const u = new URL(url);
  const tls = u.protocol === "https:";
  if (!tls && u.protocol !== "http:") {
    throw new Error("unsupported url scheme for HttpClientTransport: " + u.protocol);
  }
  let port = tls ? 443 : 80;
  if (u.port !== "") {
    port = Number(u.port);
  }
  let path = u.pathname;
  if (path === "") {
    path = "/";
  }
  if (u.search !== "") {
    path += u.search;
  }
  return new HttpTarget(u.hostname, port, path, tls);
}

// Byte accumulator + "read until close" sink for one socket.
export class SockReader {
  queued: Uint8Array;
  closed: boolean;
  err: Error | null;
  waiters: ((b: Uint8Array | null) => void)[];

  constructor() {
    this.queued = new Uint8Array(0);
    this.closed = false;
    this.err = null;
    this.waiters = [];
  }

  attach(sock: Socket): void {
    sock.on("data", (chunk: Uint8Array) => {
      const next = new Uint8Array(this.queued.length + chunk.length);
      next.set(this.queued, 0);
      next.set(chunk, this.queued.length);
      this.queued = next;
    });
    sock.on("error", (e: Error) => {
      this.err = e;
      this._drain();
    });
    sock.on("close", () => {
      this.closed = true;
      this._drain();
    });
  }

  _drain(): void {
    while (this.waiters.length > 0) {
      const cb = this.waiters.shift();
      if (cb !== null && cb !== undefined) {
        cb(this.queued);
      }
    }
  }

  // Resolves with every byte received once the socket closes; rejects on
  // socket error or timeout. Callers send `Connection: close`.
  readAll(timeoutMs: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.err !== null) {
        reject(this.err);
        return;
      }
      if (this.closed) {
        resolve(this.queued);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("socket read timed out"));
        }
      }, timeoutMs);
      this.waiters.push((b: Uint8Array | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (this.err !== null) {
          reject(this.err);
          return;
        }
        if (b === null) {
          reject(new Error("socket closed"));
          return;
        }
        resolve(b);
      });
    });
  }
}

export function connectTcp(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    let settled = false;
    const sock = netConnect(port, host);
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      settled = true;
      sock.setTimeout(0);
      resolve(sock);
    });
    sock.once("error", (e: Error) => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(e);
      }
    });
    sock.once("timeout", () => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(new Error("tcp connect timed out"));
      }
    });
  });
}

export function connectTls(
  host: string,
  port: number,
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    let settled = false;
    const sock = tlsConnectRaw(port, host, {
      servername: host,
      rejectUnauthorized: rejectUnauthorized,
    });
    sock.setTimeout(timeoutMs);
    sock.once("secureConnect", () => {
      settled = true;
      sock.setTimeout(0);
      resolve(sock as unknown as Socket);
    });
    sock.once("error", (e: Error) => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(e);
      }
    });
    sock.once("timeout", () => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(new Error("tls connect timed out"));
      }
    });
  });
}

export function connectTarget(
  t: HttpTarget,
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<Socket> {
  if (t.tls) {
    return connectTls(t.host, t.port, timeoutMs, rejectUnauthorized);
  }
  return connectTcp(t.host, t.port, timeoutMs);
}

function indexOfSeq(buf: Uint8Array, seq: Uint8Array, from: number): number {
  for (let i = from; i + seq.length <= buf.length; i++) {
    let hit = true;
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      return i;
    }
  }
  return -1;
}

const HEAD_END = new Uint8Array([13, 10, 13, 10]);

// Strips chunked transfer-encoding framing. Each chunk is
// <hexlen>\r\n<bytes>\r\n terminated by a 0-length chunk; trailers are
// ignored (MCP servers don't emit meaningful ones for JSON).
export function dechunk(body: Uint8Array): Uint8Array {
  const out: number[] = [];
  let pos = 0;
  const dec = new TextDecoder();
  for (;;) {
    let eol = -1;
    for (let i = pos; i + 1 < body.length; i++) {
      if (body[i] === 13 && body[i + 1] === 10) {
        eol = i;
        break;
      }
    }
    if (eol < 0) {
      break;
    }
    const sizeText = dec.decode(body.slice(pos, eol)).trim();
    let semi = sizeText.indexOf(";");
    const hex = semi >= 0 ? sizeText.slice(0, semi) : sizeText;
    const size = parseInt(hex, 16);
    if (!(size > 0)) {
      break;
    }
    const start = eol + 2;
    for (let i = start; i < start + size && i < body.length; i++) {
      out.push(body[i]);
    }
    pos = start + size + 2;
  }
  return new Uint8Array(out);
}

// Parses a full HTTP/1.1 response read to EOF.
export function parseHttpResponse(raw: Uint8Array): HttpResponse {
  const headEnd = indexOfSeq(raw, HEAD_END, 0);
  if (headEnd < 0) {
    throw new Error("malformed HTTP response: no header terminator");
  }
  const dec = new TextDecoder();
  const head = dec.decode(raw.slice(0, headEnd));
  const lines = head.split("\r\n");
  const statusLine = lines[0];
  let status = 0;
  const sp = statusLine.indexOf(" ");
  if (sp >= 0) {
    let sp2 = statusLine.indexOf(" ", sp + 1);
    const code = sp2 < 0 ? statusLine.slice(sp + 1) : statusLine.slice(sp + 1, sp2);
    status = Number(code);
  }
  const headers: { [k: string]: unknown } = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].indexOf(":");
    if (c > 0) {
      headers[lines[i].slice(0, c).toLowerCase().trim()] = lines[i].slice(c + 1).trim();
    }
  }
  let body: Uint8Array = raw.slice(headEnd + 4);
  const te = headers["transfer-encoding"];
  if (typeof te === "string" && te.toLowerCase().indexOf("chunked") >= 0) {
    body = dechunk(body);
  }
  const res: HttpResponse = { status: status, headers: headers, body: dec.decode(body) };
  return res;
}

// One POST request on a fresh socket; resolves the parsed response.
export async function httpPost(
  t: HttpTarget,
  path: string,
  body: string,
  headers: { [k: string]: string },
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<HttpResponse> {
  const sock = await connectTarget(t, timeoutMs, rejectUnauthorized);
  const reader = new SockReader();
  reader.attach(sock);
  const enc = new TextEncoder();
  const payload = enc.encode(body);
  const headText =
    "POST " +
    path +
    " HTTP/1.1\r\nHost: " +
    t.host +
    ":" +
    String(t.port) +
    "\r\ncontent-type: application/json\r\naccept: application/json, text/event-stream\r\ncontent-length: " +
    String(payload.length) +
    "\r\nconnection: close\r\n";
  let head = headText;
  for (const k in headers) {
    head += k + ": " + headers[k] + "\r\n";
  }
  head += "\r\n";
  const headBytes = enc.encode(head);
  const out = new Uint8Array(headBytes.length + payload.length);
  out.set(headBytes, 0);
  out.set(payload, headBytes.length);
  sock.write(out);
  const raw = await reader.readAll(timeoutMs);
  return parseHttpResponse(raw);
}
