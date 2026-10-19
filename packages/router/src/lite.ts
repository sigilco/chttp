// chttp — Node-side fetch bridge (issue #89).
//
// app.fetch's canonical surface takes a real WHATWG Request and produces a
// real Response — correct for WinterCG hosts, but a Node bridge that builds
// undici Request/Headers/Response per incoming message pays the WHATWG
// constructor + stream machinery on every request (bench/RESULTS-v2.md:
// chttp-fetch-node runs at 53-73% of chttp-node; the cpu profile attributes
// ~20% of total CPU to undici + web-streams internals).
//
// WebReqView/ResView are structural interfaces, so the fetch dispatch arm
// never nominally requires undici objects. This module provides:
//
//   - LiteHeaders: a WebHeadersView over IncomingMessage.headers — zero
//     materialization (Node already lowercases header names).
//   - LiteRequest: a WebReqView over the IncomingMessage — method, absolute
//     url, lazy text()/arrayBuffer()/body reads driven by the same
//     declaration rules as app.fetch ({ body: true } / multipart only).
//     For body-carrying methods the socket is drained into raw Buffer
//     chunks at the edge (no decoding, no undici): node:http dumps
//     unconsumed request bytes once res.end fires, so true laziness
//     would break the 0.4.0 `c.req.raw` readable-body contract. The
//     capture is the same kernel->userland copy the undici bridge pays;
//     the savings are the Request/Headers/Response machinery on top.
//   - LiteResponse: a FetchResponseSink that writes straight to the
//     ServerResponse instead of capturing for a later new Response —
//     status/headers/chunks go on the wire as the chain produces them,
//     including writeHead()-armed streaming (the ReadableStream controller
//     becomes res.write/res.end).
//
// Host-object edge cases stay lazy per the issue plan: `c.req.raw` returns
// the LiteRequest (a WebReqView — not a real Request); consumers that need
// an actual undici Request (`fetch(c.req.raw)`) call `lite.request()` to
// materialize one on demand. A handler returning a Response still works:
// adopt() mirrors status+headers onto the ServerResponse and the bridge
// pumps the adopted body stream to the socket.
//
// Everything here stays inside the scriptc subset (`| null` unions,
// indexed loops, no ?./??/spread, no nominal host-object class fields —
// host objects appear only as locals/returns, like sink.ts's toResponse).

import type { IncomingMessage, ServerResponse } from "node:http";
import { FetchResponseSink, utf8len } from "./sink.ts";
import type { WebReqView, WebHeadersView, ResView } from "./index.ts";

// Header view backed by the IncomingMessage's own tables — no copy, no
// WHATWG normalization. Values Node parsed as repeated headers (string[])
// join with ", " like Web Headers do; set-cookie's repeated arm stays
// reachable through getSetCookie().
export class LiteHeaders implements WebHeadersView {
  _im: IncomingMessage;

  constructor(im: IncomingMessage) {
    this._im = im;
  }

  get(name: string): string | null {
    const h = this._im.headers as Record<string, unknown>;
    const v = h[String(name).toLowerCase()];
    if (typeof v === "string") {
      return v;
    }
    if (Array.isArray(v)) {
      return (v as string[]).join(", ");
    }
    return null;
  }

  has(name: string): boolean {
    const h = this._im.headers as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(h, String(name).toLowerCase());
  }

  getSetCookie(): string[] {
    const h = this._im.headers as Record<string, unknown>;
    const v = h["set-cookie"];
    const out: string[] = [];
    if (typeof v === "string") {
      out.push(v);
    } else if (Array.isArray(v)) {
      const a = v as string[];
      for (let i = 0; i < a.length; i++) {
        out.push(a[i]);
      }
    }
    return out;
  }

  forEach(cb: (value: string, key: string) => void): void {
    const h = this._im.headers as Record<string, unknown>;
    const keys = Object.keys(h);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = h[k];
      if (typeof v === "string") {
        cb(v, k);
      } else if (Array.isArray(v)) {
        cb((v as string[]).join(", "), k);
      }
    }
  }
}

// WebReqView over a live IncomingMessage. `url` is absolute (Request.url
// parity — rv.url reads it for c.req.url); the dispatch matcher gets the
// path+query form separately, same as app.fetch hands over. `_hs` is the
// materialized Record<string, string> the dispatch arm consumes — built
// once here so ReqViewCore's _headers, _genFetch's `headers` param and
// LiteHeaders' values all describe the same request.
export class LiteRequest implements WebReqView {
  method: string;
  url: string;
  headers: WebHeadersView;
  _im: IncomingMessage;
  _hs: Record<string, string>;
  _t: string | null;
  _chunks: Buffer[];
  _ended: number;

  constructor(im: IncomingMessage) {
    this._im = im;
    this.method = String(im.method || "");
    const raw = im.headers as Record<string, unknown>;
    const hv = raw["host"];
    const host = typeof hv === "string" && hv.length > 0 ? hv : "x";
    this.url = "http://" + host + String(im.url || "/");
    this.headers = new LiteHeaders(im);
    this._t = null;
    this._chunks = [];
    this._ended = 0;
    // Body-carrying methods start a raw-chunk drain now: node dumps
    // unconsumed request bytes when the response ends, so waiting for a
    // route to declare body use would lose the prefix (and hang late
    // readers). Chunks stay Buffers — decode happens only in text()/
    // arrayBuffer() when a route actually reads the body.
    const m = this.method;
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {
      const chunks = this._chunks;
      const self = this;
      im.on("data", function (c: Buffer): void {
        chunks.push(c);
      });
      im.on("end", function (): void {
        self._ended = 1;
      });
      im.on("error", function (): void {
        self._ended = 1;
      });
    }
    // One O(headers) pass producing the flat record _dispatchPrim/
    // _genFetch consume (multi-values joined — the same shape
    // headersFromRaw produces for a real Request).
    const rec: Record<string, string> = {};
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = raw[k];
      if (typeof v === "string") {
        rec[k] = v;
      } else if (Array.isArray(v)) {
        rec[k] = (v as string[]).join(", ");
      }
    }
    this._hs = rec;
  }

  // Lazy body stream: null for bodyless methods (Request.body parity),
  // otherwise a ReadableStream fed by the IncomingMessage. Not cached —
  // a second read gets a second stream over the same socket, which like
  // a disturbed Request body is a caller bug (documented edge).
  get body(): ReadableStream<Uint8Array> | null {
    const m = this.method;
    if (m !== "POST" && m !== "PUT" && m !== "PATCH" && m !== "DELETE") {
      return null;
    }
    const im = this._im;
    const self = this;
    return new ReadableStream<Uint8Array>({
      start: function (ctl: ReadableStreamDefaultController<Uint8Array>): void {
        // Replay the already-drained prefix, then keep flowing live —
        // the ctor's capture listener keeps filling _chunks in parallel
        // so text() still sees the full body.
        const drained = self._chunks;
        let i = 0;
        const pump = function (): void {
          while (i < drained.length) {
            ctl.enqueue(drained[i]);
            i = i + 1;
          }
        };
        pump();
        im.on("data", function (c: Buffer): void {
          ctl.enqueue(c);
          i = drained.length;
        });
        im.on("end", function (): void {
          pump();
          ctl.close();
        });
        im.on("error", function (): void {
          pump();
          ctl.close();
        });
      },
    });
  }

  // Declared-body reader for _dispatchPrim/_bufferFetch. The drained
  // chunk prefix is joined and decoded here — never before a route
  // actually reads it.
  text(): Promise<string> {
    const im = this._im;
    const self = this;
    const done = this._t;
    if (done !== null) {
      return new Promise<string>(function (resolve): void {
        resolve(done);
      });
    }
    return new Promise<string>(function (resolve, reject): void {
      const finish = function (): void {
        // Buffer.concat on a field-held list fences SC2020 under
        // scriptc — join per-chunk decodes instead (utf8 boundaries are
        // safe: node splits on packet lines, multi-byte chars can split
        // across chunks... mitigate by decoding the CONCATENATED bytes:
        // gather lengths first, copy into one Uint8Array, then decode.
        const chunks = self._chunks;
        let total = 0;
        for (let i = 0; i < chunks.length; i++) {
          total = total + chunks[i].length;
        }
        const joined = new Uint8Array(total);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
          joined.set(chunks[i], off);
          off = off + chunks[i].length;
        }
        const s = Buffer.from(joined).toString("utf8");
        self._t = s;
        resolve(s);
      };
      if (self._ended === 1) {
        finish();
        return;
      }
      im.on("end", function (): void {
        finish();
      });
      im.on("error", function (e: Error): void {
        reject(e);
      });
    });
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const im = this._im;
    const self = this;
    return new Promise<ArrayBuffer>(function (resolve, reject): void {
      const finish = function (): void {
        const chunks = self._chunks;
        let total = 0;
        for (let i = 0; i < chunks.length; i++) {
          total = total + chunks[i].length;
        }
        const u8 = new Uint8Array(total);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
          u8.set(chunks[i], off);
          off = off + chunks[i].length;
        }
        resolve(u8.buffer);
      };
      if (self._ended === 1) {
        finish();
        return;
      }
      im.on("end", function (): void {
        finish();
      });
      im.on("error", function (e: Error): void {
        reject(e);
      });
    });
  }

  // Host-object materialization (issue #89, documented edge): a consumer
  // that needs a real undici Request — `fetch(c.req.raw)`, spec-level
  // header iteration, a body Reader — pays the WHATWG construction cost
  // on demand instead of every request paying it upfront. Not cached:
  // each call builds a fresh Request over the (possibly already drained)
  // IncomingMessage.
  request(): Request {
    const hs = new Headers();
    const lit = this.headers;
    lit.forEach(function (v: string, k: string): void {
      hs.append(k, v);
    });
    const init: Record<string, unknown> = {};
    init["method"] = this.method;
    init["headers"] = hs;
    const b = this.body;
    if (b !== null) {
      init["body"] = b;
      init["duplex"] = "half";
    }
    return new Request(this.url, init as RequestInit);
  }
}

// LiteResponse is a FetchResponseSink that writes straight to the wire:
// the generated fetch dispatch (dispatchFetch) and _dispatchPrim only
// ever see a FetchResponseSink, so this subclass drops in unchanged —
// but instead of capturing status/headers/chunks for a later
// `new Response`, every write lands on the ServerResponse as it happens.
// toResponse() is never called on this surface.
export class LiteResponse extends FetchResponseSink {
  _res: ServerResponse;

  constructor(res: ServerResponse) {
    super();
    this._res = res;
  }

  setStatus(n: number): void {
    this.status = Number(n);
    this._res.statusCode = this.status;
  }

  setHeader(k: string, v: string): void {
    // Keep the base bookkeeping (hdrKeys/hdrList back c.res readback and
    // appendHeader's multi-value scan) and write through.
    super.setHeader(k, v);
    this._res.setHeader(String(k), String(v));
  }

  appendHeader(k: string, v: string): void {
    super.appendHeader(k, v);
    // Same subset limit as NodeResponseSink.appendHeader: scriptc lowers
    // neither res.setHeader(string[]) nor res.appendHeader, so under the
    // lite Node bridge a repeated set-cookie collapses to last-write-
    // wins on the wire (the append-only hdrList still preserves the full
    // list for adopted/toResponse-style consumers). Use app.fetch when
    // real multi-cookie emission matters.
    this._res.setHeader(String(k), String(v));
  }

  writeBody(s: string): void {
    const str = String(s);
    // Same defaults as NodeResponseSink.writeBody: no content-type on
    // empty bodies, and content-length only when unset upstream.
    if (this.headerOf("content-type") === null && str.length > 0) {
      this.setHeader("content-type", "text/plain; charset=UTF-8");
    }
    if (this.headerOf("content-length") === null) {
      this.setHeader("content-length", String(utf8len(str)));
    }
    this._res.statusCode = this.status;
    this._res.end(str);
    this.sent = true;
    this.headersSent = true;
  }

  bodyBytes(b: Uint8Array, ct: string): void {
    this._res.statusCode = this.status;
    this._res.setHeader("content-type", String(ct));
    this._res.setHeader("content-length", String(b.length));
    this._res.end(b);
    this.sent = true;
    this.headersSent = true;
  }

  redirect(url: string, code: number): void {
    this.status = Number(code);
    this._res.statusCode = this.status;
    this._res.setHeader("location", String(url));
    this._res.end();
    this.sent = true;
  }

  write(chunk: string): void {
    this._res.write(String(chunk));
  }

  writeHead(status: number, flatPairs: string[]): void {
    const res = this._res;
    // Register the pairs through res.setHeader BEFORE writeHead commits —
    // super.writeHead re-routes them through this.setHeader for the
    // bookkeeping, which is still legal while headers are unsent.
    for (let i = 0; i + 1 < flatPairs.length; i += 2) {
      res.setHeader(String(flatPairs[i]), String(flatPairs[i + 1]));
    }
    super.writeHead(status, flatPairs);
    res.writeHead(this.status);
    res.flushHeaders();
    // Arm the streaming controller: subsequent write() calls on the base
    // see _ctl !== null and enqueue through it — each enqueue lands as a
    // res.write so @chttp/stream SSE-style writers flush per chunk, not
    // at chain end.
    const ctl: { enqueue: (b: Uint8Array) => void; close: () => void } = {
      enqueue: function (b: Uint8Array): void {
        res.write(b);
      },
      close: function (): void {
        res.end();
      },
    };
    this._ctl = ctl;
  }

  endStream(): void {
    this._endSeen = true;
    this.sent = true;
    this._res.end();
  }

  // Handler-returned Response on the lite surface: status + headers mirror
  // onto the ServerResponse now; the body stream is kept on `adopted` for
  // the bridge to pump (a sink method stays sync — socket writes need the
  // async reader loop in fetchBridge).
  adopt(view: ResView): void {
    this.status = Number(view.status);
    this._res.statusCode = this.status;
    const res = this._res;
    view.headers.forEach(function (v: string, k: string): void {
      res.setHeader(String(k), String(v));
    });
    this.adopted = view;
    this.sent = true;
    this.headersSent = true;
  }

  isSent(): boolean {
    return this.sent;
  }

  isHeadersSent(): boolean {
    return this.headersSent;
  }

  destroy(): void {
    try {
      this._res.destroy();
    } catch (e) {
      // socket already gone
    }
  }
}
