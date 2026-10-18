// stream: Server-Sent Events and chunked text for @chttp/router, authored
// inside the scriptc compilable subset (same bans as packages/router/src).
//
// Helpers are free functions taking a Ctx. They writeHead + flushHeaders and
// set c.sent = true before handing the stream to the callback, so the router
// never answers a 500 for a handler that wrote nothing synchronously, and a
// promise returned by the callback flows into the router's settleChain.
import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Writable } from "node:stream";
import type { Ctx, ResponseSink } from "@chttp/router/src/index.ts";

// UTF-8 byte length of s (surrogate pairs count 4, lone surrogates 3).
function utf8len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    if (cc < 0x80) {
      n += 1;
    } else if (cc < 0x800) {
      n += 2;
    } else if (cc >= 0xd800 && cc <= 0xdbff && i + 1 < s.length) {
      const nx = s.charCodeAt(i + 1);
      if (nx >= 0xdc00 && nx <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}

// Drops CR and LF so a field value (event, id) can never inject a new line.
function oneLine(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    if (cc !== 10 && cc !== 13) {
      out += s.charAt(i);
    }
  }
  return out;
}

// Prefixes every line of s (split on LF, CRLF or CR) with `prefix` and ends
// each with LF. The tail after the last separator is always emitted, so an
// empty s (or one ending in a newline) yields a trailing empty line, as the
// SSE spec's line splitting does.
function prefixLines(prefix: string, s: string): string {
  let out = "";
  let start = 0;
  const n = s.length;
  let i = 0;
  while (i < n) {
    const cc = s.charCodeAt(i);
    if (cc === 10 || cc === 13) {
      out += prefix + s.slice(start, i) + "\n";
      if (cc === 13 && i + 1 < n && s.charCodeAt(i + 1) === 10) {
        i++;
      }
      start = i + 1;
    }
    i++;
  }
  out += prefix + s.slice(start, n) + "\n";
  return out;
}

// Sentinel chunk the writer probes itself with at construction; _write
// swallows it, so it never reaches the socket.
const WRITER_PROBE: Buffer = Buffer.from([0]);

// Outbound write path for one stream: a compiled Writable subclass whose
// _write forwards straight to res. cb is deferred one macrotask so the
// Writable's own queue is what write(): boolean and "drain" observe — the
// ServerResponse surface still refuses all three (probe:
// bench/scriptc-evidence/ws-backpressure-probe-2026-10-15.txt). Past
// highWaterMark chunks hold in _q (ordered) and "drain" re-issues them.
export class ResWriter extends Writable {
  _sink: ServerResponse;
  _q: string[] = [];
  _draining: boolean = false;
  // Set once the stream is closed: pending internal writes are dropped so a
  // res.end() can never race a late _write into write-after-end.
  _ended: boolean = false;
  _closing: boolean = false;
  _writes: number = 0;
  // scriptc 0.3.2 does not wire a subclassed _write when the class lives in a
  // statically compiled npm package: write() buffers but the pump never runs
  // (probe: bench/scriptc-evidence/ws-backpressure-probe-2026-10-15.txt). The
  // constructor writes a swallowed probe chunk; when no _write ran by the
  // time write() returns the writer degrades to direct sink writes — the
  // per-window byte cap stays as the only slow-consumer policy.
  _direct: boolean = false;

  constructor(sink: ServerResponse) {
    super();
    this._sink = sink;
    const self: ResWriter = this;
    this.on("drain", () => {
      self._draining = false;
      self.flushQ();
      self.maybeEnd();
    });
    // Sink errors surface as stream errors; the stream's own close paths
    // already report through _onClose, so swallow to avoid unhandled 'error'.
    this.on("error", () => {});
    this.write(WRITER_PROBE);
    if (this._writes === 0) {
      this._direct = true;
    }
  }

  _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this._writes += 1;
    if (chunk === WRITER_PROBE) {
      // Settle synchronously: the probe must leave writableLength at 0 so
      // the first real write still reaches _write.
      cb();
      return;
    }
    if (this._ended) {
      cb();
      return;
    }
    const self: ResWriter = this;
    this._sink.write(chunk);
    setImmediate(() => {
      cb();
      self.maybeEnd();
    });
  }

  // Re-issues queued chunks while the Writable accepts them. A false write()
  // still buffers the chunk internally, so re-arm and wait for "drain".
  flushQ(): void {
    while (this._q.length > 0) {
      const chunk = this._q[0];
      if (chunk === undefined) {
        this._q.shift();
        continue;
      }
      if (this._direct) {
        this._sink.write(chunk);
        this._q.shift();
        continue;
      }
      const ok = this.write(chunk);
      this._q.shift();
      if (!ok) {
        this._draining = true;
        return;
      }
    }
  }

  sendChunk(chunk: string): void {
    if (this._direct) {
      this._sink.write(chunk);
      return;
    }
    if (this._draining) {
      this._q.push(chunk);
      return;
    }
    if (!this.write(chunk)) {
      this._draining = true;
    }
  }

  // Ends the response once both queues are empty, so close() right after a
  // burst does not truncate the tail still waiting for "drain". Also fires
  // once deferred since "drain" only fires when write() went false first.
  close(): void {
    this._closing = true;
    const self: ResWriter = this;
    setImmediate(() => {
      self.maybeEnd();
    });
  }

  maybeEnd(): void {
    // In direct mode the internal buffer never drains (the swallowed probe
    // sits in it forever), so only the explicit queue gates the end.
    if (this._closing && this._q.length === 0 && (this._direct || this.writableLength === 0)) {
      this._sink.end();
    }
  }
}

// Write-side seam for the fetch surface: sendChunk forwards into
// ResponseSink.write(), which buffers chunks until the sink hands the
// ReadableStream controller over at toResponse() and enqueues straight
// into it after. close() ends the stream the writeHead() armed. The
// pending-bytes window cap in ChunkStream is the only slow-consumer
// policy here — a ReadableStream exposes no writable-queue surface the
// sink could read backpressure from.
export class FetchStreamWriter {
  sink: ResponseSink;
  _ended: boolean;

  constructor(sink: ResponseSink) {
    this.sink = sink;
    this._ended = false;
  }

  sendChunk(chunk: string): void {
    if (this._ended) {
      return;
    }
    this.sink.write(chunk);
  }

  // Queue-drain + end stubs matching the ResWriter surface ChunkStream
  // calls — there is no internal queue on the fetch arm.
  flushQ(): void {}

  close(): void {
    this._ended = true;
    this.sink.endStream();
  }
}

// Base writer: tracks closed state, abort callbacks and the pending-bytes cap.
//
// scriptc < 0.3.2 could not observe backpressure (write() result, "drain"
// and writableLength were all refused), so the cap was a stand-in. On
// scriptc>=0.3.2 a compiled Writable wrapper around res observes the real
// queue via write(): boolean and "drain"; the cap stays as a secondary
// fail-safe: a stream that writes more than maxPending bytes inside one
// windowMs window is still treated as a slow consumer and closed.
export class ChunkStream {
  res: ServerResponse | null;
  closed: boolean;
  maxPending: number;
  windowMs: number;
  _pending: number;
  _windowStart: number;
  _abortFns: Array<() => void>;
  _fired: boolean;
  _writer: ResWriter | null;
  _fwriter: FetchStreamWriter | null;

  constructor(res: ServerResponse | null, sink?: ResponseSink | null) {
    this.res = res;
    this.closed = false;
    this.maxPending = 1048576;
    this.windowMs = 1000;
    this._pending = 0;
    this._windowStart = Date.now();
    this._abortFns = [];
    this._fired = false;
    const s = sink === null || sink === undefined ? null : sink;
    if (res !== null) {
      this._writer = new ResWriter(res);
      this._fwriter = null;
    } else if (s !== null) {
      this._writer = null;
      this._fwriter = new FetchStreamWriter(s);
    } else {
      // Bare test fakes: neither surface — writes/close become no-ops,
      // same toleration the _writer !== undefined guards already gave.
      this._writer = null;
      this._fwriter = null;
    }
  }

  // Raw chunk write. Returns false once the stream is closed, including when
  // this very write tripped the pending-bytes cap.
  write(chunk: string): boolean {
    if (this.closed) {
      return false;
    }
    const now = Date.now();
    if (now - this._windowStart >= this.windowMs) {
      this._windowStart = now;
      this._pending = 0;
    }
    this._pending += utf8len(chunk);
    if (this._pending > this.maxPending) {
      this.close();
      return false;
    }
    const fw = this._fwriter;
    if (fw !== null) {
      fw.sendChunk(chunk);
      return true;
    }
    const w = this._writer;
    if (w !== null && w !== undefined) {
      w.sendChunk(chunk);
    }
    return true;
  }

  // Ends the response. Abort callbacks run from the "close" event it causes.
  // Queued chunks are pushed into the writer first so a close right after a
  // burst does not truncate the tail; the writer ends res once both queues
  // drain.
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const fw = this._fwriter;
    if (fw !== null) {
      fw.flushQ();
      fw.close();
      // No 'close' event exists on the fetch surface — fire the abort
      // hooks deterministically here (idempotent via _fired).
      this._onClose();
      return;
    }
    const w = this._writer;
    if (w !== null && w !== undefined) {
      w.flushQ();
      w.close();
    }
  }

  // Runs fn once when the connection closes, whether the client left or
  // close() was called. Use it to clear timers and release subscriptions.
  onAbort(fn: () => void): void {
    this._abortFns.push(fn);
    if (this._fired) {
      fn();
    }
  }

  _onClose(): void {
    if (this._fired) {
      return;
    }
    this._fired = true;
    this.closed = true;
    // Tests build bare prototype fakes without a writer; guard for those.
    const w = this._writer;
    if (w !== null && w !== undefined) {
      w._ended = true;
    }
    const fw = this._fwriter;
    if (fw !== null && fw !== undefined) {
      fw._ended = true;
    }
    const fns = this._abortFns;
    this._abortFns = [];
    for (let i = 0; i < fns.length; i++) {
      fns[i]();
    }
  }
}

export class SSEStream extends ChunkStream {
  // One event. Multi-line data becomes several data: lines. event and id are
  // optional; CR and LF are stripped from them.
  send(data: string): boolean;
  send(data: string, event: string): boolean;
  send(data: string, event: string, id: string): boolean;
  send(data: string, event?: string, id?: string): boolean {
    let frame = "";
    if (id !== null && id !== undefined) {
      frame += "id: " + oneLine(String(id)) + "\n";
    }
    if (event !== null && event !== undefined) {
      frame += "event: " + oneLine(String(event)) + "\n";
    }
    frame += prefixLines("data: ", String(data)) + "\n";
    return this.write(frame);
  }

  // A comment line (": text"), commonly used as a keep-alive ping.
  comment(text: string): boolean {
    return this.write(prefixLines(": ", String(text)) + "\n");
  }

  // Asks the client to wait ms before reconnecting. Non-numeric and negative
  // values clamp to 0 so the field can never carry garbage.
  retry(ms: number): boolean {
    const v = Math.max(0, Math.floor(Number(ms) || 0));
    return this.write("retry: " + String(v) + "\n\n");
  }
}

export class TextStream extends ChunkStream {
  writeln(s: string): boolean {
    return this.write(String(s) + "\n");
  }
}

// Commits status + stream headers through the sink's writeHead seam, so
// the same call opens a chunked response on both surfaces: res.writeHead
// + flushHeaders under Node, ReadableStream arming under app.fetch.
// `connection` stays Node-only — it is a forbidden header name on the
// Web Standards surface (Response init would drop it).
function open(c: Ctx, contentType: string, extra: string): void {
  const hdrs: string[] = ["content-type", contentType];
  if (extra === "sse") {
    hdrs.push("cache-control", "no-cache, no-transform");
    if (c._nodeRes !== null) {
      hdrs.push("connection", "keep-alive");
    }
    hdrs.push("x-accel-buffering", "no");
  } else {
    hdrs.push("cache-control", "no-cache");
    hdrs.push("x-accel-buffering", "no");
  }
  c.sink.writeHead(c.sink.statusOf(), hdrs);
  c.sent = true;
}

// Starts a text/event-stream response and returns fn(stream). A promise
// returned by fn is awaited by the router; a sync return leaves the response
// open until the stream is closed or the client leaves.
// Wires the stream lifecycle to the response. "close" covers the normal end
// of the connection in both directions; the raw socket's "error" covers an
// abrupt failure (reset mid-stream) which would otherwise throw as an
// unhandled EventEmitter error. Both funnel into _onClose, which is
// idempotent. scriptc 0.3.1 whitelists only "close" and "finish" on
// ServerResponse itself, so the error listener goes on the socket (same
// surface packages/ws uses).
function wire(res: ServerResponse, s: ChunkStream): void {
  res.on("close", () => {
    s._onClose();
  });
  const sk: Socket | null = res.socket;
  if (sk !== null) {
    sk.on("error", function (): void {
      s._onClose();
      sk.destroy();
    });
  }
}

export function streamSSE(c: Ctx, fn: (s: SSEStream) => unknown): unknown {
  open(c, "text/event-stream; charset=utf-8", "sse");
  const res = c._nodeRes;
  if (res !== null) {
    const s = new SSEStream(res);
    wire(res, s);
    return fn(s);
  }
  // Fetch arm: writes feed the sink's ReadableStream instead of a socket.
  return fn(new SSEStream(null, c.sink));
}

// Starts a chunked text/plain response and returns fn(stream).
export function streamText(c: Ctx, fn: (s: TextStream) => unknown): unknown {
  open(c, "text/plain; charset=utf-8", "text");
  const res = c._nodeRes;
  if (res !== null) {
    const s = new TextStream(res);
    wire(res, s);
    return fn(s);
  }
  return fn(new TextStream(null, c.sink));
}
