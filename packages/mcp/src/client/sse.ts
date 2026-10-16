// SSE frame decoding — the client-side twin of transport/sse.ts's encoder.
// Incremental: feed() text as it arrives, get back complete events.
// Comment lines (: ...) are skipped; multi-line `data:` accumulates with
// LF joins per the SSE spec. MCP only uses the `data` field, but `event`,
// `id`, and `retry` parse for completeness.

export interface SseEvent {
  event: string | null;
  data: string;
  id: string | null;
}

export class SseDecoder {
  _buf: string;
  _data: string;
  _event: string | null;
  _id: string | null;

  constructor() {
    this._buf = "";
    this._data = "";
    this._event = null;
    this._id = null;
  }

  // Feed a text chunk; returns every event completed by a blank line.
  feed(text: string): SseEvent[] {
    this._buf += text;
    const out: SseEvent[] = [];
    for (;;) {
      const ev = this._next();
      if (ev === null) {
        return out;
      }
      out.push(ev);
    }
  }

  // Flush any complete line-terminated event still buffered (stream end).
  end(): SseEvent[] {
    const out = this._next();
    const rest = this._dispatch();
    const out2: SseEvent[] = [];
    if (out !== null) {
      out2.push(out);
    }
    if (rest !== null) {
      out2.push(rest);
    }
    return out2;
  }

  // Pulls one complete event (terminated by a blank line) off _buf, or
  // null when none is complete yet.
  _next(): SseEvent | null {
    for (;;) {
      const idx = this._findLineEnd();
      if (idx < 0) {
        return null;
      }
      const line = this._buf.slice(0, idx);
      let skip = 1;
      if (this._buf.charCodeAt(idx) === 13 && this._buf.charCodeAt(idx + 1) === 10) {
        skip = 2;
      }
      this._buf = this._buf.slice(idx + skip);
      if (line.length === 0) {
        const ev = this._dispatch();
        if (ev !== null) {
          return ev;
        }
      } else {
        this._line(line);
      }
    }
  }

  _findLineEnd(): number {
    for (let i = 0; i < this._buf.length; i++) {
      const cc = this._buf.charCodeAt(i);
      if (cc === 10 || cc === 13) {
        return i;
      }
    }
    return -1;
  }

  _line(line: string): void {
    if (line.charCodeAt(0) === 58) {
      return; // comment
    }
    const colon = line.indexOf(":");
    let field = line;
    let value = "";
    if (colon >= 0) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 32) {
        value = value.slice(1);
      }
    }
    if (field === "data") {
      this._data += (this._data.length > 0 ? "\n" : "") + value;
    } else if (field === "event") {
      this._event = value;
    } else if (field === "id") {
      this._id = value;
    }
  }

  _dispatch(): SseEvent | null {
    if (this._data.length === 0) {
      this._event = null;
      this._id = null;
      return null;
    }
    const ev: SseEvent = { event: this._event, data: this._data, id: this._id };
    this._data = "";
    this._event = null;
    this._id = null;
    return ev;
  }
}

// One-shot decode of a complete SSE body (e.g. a POST response already
// read to EOF). Notifications arrive in order; the caller routes them.
export function decodeSseEvents(text: string): SseEvent[] {
  const d = new SseDecoder();
  const out = d.feed(text);
  const tail = d.end();
  for (let i = 0; i < tail.length; i++) {
    out.push(tail[i]);
  }
  return out;
}
