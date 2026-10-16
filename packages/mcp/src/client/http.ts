// HttpClientTransport — Streamable-HTTP client over the minimal socket
// HTTP/1.1 stack in sock.ts. The same code runs under Node and inside a
// scriptc-compiled ELF (verified: net server/client, TextDecoder, spawn,
// fetch all lower and run on 0.3.3).
//
// v1 shape, deliberately lean: one socket per request
// (`Connection: close`), mcp-session-id captured from response headers and
// echoed on later requests, SSE POST bodies decoded in full, a dedicated
// GET ?stream=progress socket for notifications when handlers are
// registered. No keep-alive, no resumability.

import { Socket } from "node:net";
import type { JsonRpcRequest, JsonRpcResponse, RequestId } from "../types.ts";
import { JsonRpcError, PARSE_ERROR } from "../errors.ts";
import { SseDecoder, decodeSseEvents } from "./sse.ts";
import { connectTarget, httpPost, parseHttpTarget, type HttpTarget } from "./sock.ts";
import { ClientTransport, type NotificationHandler } from "./types.ts";

const SESSION_HEADER = "mcp-session-id";

export interface HttpClientOpts {
  // Endpoint URL, e.g. "http://localhost:8080/mcp". May include a path.
  url: string;
  // TLS certificate verification. Default true; set false for self-signed
  // dev servers.
  rejectUnauthorized?: boolean;
  // Extra request headers (auth etc.).
  headers?: { [k: string]: string };
}

// Parses a response envelope out of a JSON or SSE body. For SSE, every
// parsed message is routed through `onNote`; the one matching `wantId`
// becomes the return value (null when the body only carried notifications).
export function responseFromBody(
  contentType: string,
  body: string,
  wantId: RequestId,
  onNote: NotificationHandler | null,
): JsonRpcResponse | null {
  if (contentType.indexOf("text/event-stream") >= 0) {
    const events = decodeSseEvents(body);
    let found: JsonRpcResponse | null = null;
    for (let i = 0; i < events.length; i++) {
      let msg: unknown;
      try {
        msg = JSON.parse(events[i].data);
      } catch {
        continue;
      }
      const env = msg as JsonRpcResponse;
      if (env !== null && typeof env === "object" && env.id === wantId) {
        found = env;
      } else if (onNote !== null) {
        onNote(msg as JsonRpcRequest);
      }
    }
    return found;
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return JSON.parse(trimmed) as JsonRpcResponse;
}

export class HttpClientTransport extends ClientTransport {
  _target: HttpTarget;
  _baseHeaders: { [k: string]: string };
  _sessionId: string | null;
  _rejectUnauthorized: boolean;

  _eventsSock: Socket | null;
  _eventsOpen: boolean;
  _dec: TextDecoder;

  constructor(opts: HttpClientOpts) {
    super();
    this._target = parseHttpTarget(opts.url);
    this._baseHeaders = opts.headers === undefined || opts.headers === null ? {} : opts.headers;
    this._sessionId = null;
    this._rejectUnauthorized =
      opts.rejectUnauthorized === undefined ? true : opts.rejectUnauthorized;
    this._eventsSock = null;
    this._eventsOpen = false;
    this._dec = new TextDecoder();
  }

  sessionId(): string | null {
    return this._sessionId;
  }

  // Overrides must be non-async (async overrides hit the vtable fence,
  // SC1090); the work lives in the async _post delegate.
  request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    return this._post(req, timeoutMs);
  }

  async _post(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    const headers: { [k: string]: string } = {};
    for (const k in this._baseHeaders) {
      headers[k] = this._baseHeaders[k];
    }
    if (this._sessionId !== null) {
      headers[SESSION_HEADER] = this._sessionId;
    }
    const res = await httpPost(
      this._target,
      this._target.path,
      JSON.stringify(req),
      headers,
      timeoutMs,
      this._rejectUnauthorized,
    );
    const sid = res.headers[SESSION_HEADER];
    if (typeof sid === "string" && sid.length > 0) {
      this._sessionId = sid;
    }
    // Notifications answer 202 with no envelope — skip the body parse so
    // an empty payload isn't fed to JSON.parse.
    if (req.id === undefined || req.id === null) {
      return { jsonrpc: "2.0", id: "", result: {} };
    }
    const ctv = res.headers["content-type"];
    const ctype = typeof ctv === "string" ? ctv : "";
    const found = responseFromBody(ctype, res.body, req.id, this._note);
    if (found === null) {
      throw new JsonRpcError(
        PARSE_ERROR,
        "no response envelope in " + String(res.status) + " reply",
      );
    }
    return found;
  }

  // Long-lived GET ?stream=progress: a second socket feeding an
  // incremental SSE decoder; each `data:` payload parses as a JSON-RPC
  // message routed to the notification handler.
  openEvents(timeoutMs: number): Promise<void> {
    return this._openEvents(timeoutMs);
  }

  async _openEvents(timeoutMs: number): Promise<void> {
    if (this._eventsOpen) {
      return;
    }
    this._eventsOpen = true;
    const sock = await connectTarget(this._target, timeoutMs, this._rejectUnauthorized);
    this._eventsSock = sock;
    const enc = new TextEncoder();
    let head =
      "GET " +
      this._target.path +
      (this._target.path.indexOf("?") >= 0 ? "&" : "?") +
      "stream=progress HTTP/1.1\r\nHost: " +
      this._target.host +
      ":" +
      String(this._target.port) +
      "\r\naccept: text/event-stream\r\n";
    if (this._sessionId !== null) {
      head += SESSION_HEADER + ": " + this._sessionId + "\r\n";
    }
    for (const k in this._baseHeaders) {
      head += k + ": " + this._baseHeaders[k] + "\r\n";
    }
    head += "\r\n";
    sock.write(enc.encode(head));

    // The response has a header block before frames; buffer until the
    // \r\n\r\n boundary, then feed the remainder to the SSE decoder.
    const sse = new SseDecoder();
    const dec = this._dec;
    let headBuf = "";
    let headDone = false;
    sock.on("data", (chunk: Uint8Array) => {
      const text = dec.decode(chunk);
      if (!headDone) {
        headBuf += text;
        const idx = headBuf.indexOf("\r\n\r\n");
        if (idx < 0) {
          return;
        }
        headDone = true;
        const rest = headBuf.slice(idx + 4);
        headBuf = "";
        if (rest.length > 0) {
          this._routeEvents(sse.feed(rest));
        }
        return;
      }
      this._routeEvents(sse.feed(text));
    });
    sock.on("close", () => {
      this._eventsOpen = false;
      this._routeEvents(sse.end());
    });
  }

  _routeEvents(events: { event: string | null; data: string; id: string | null }[]): void {
    if (this._note === null) {
      return;
    }
    for (let i = 0; i < events.length; i++) {
      try {
        const msg = JSON.parse(events[i].data) as JsonRpcRequest;
        this.emitNote(msg);
      } catch {
        // Non-JSON payloads are not MCP traffic; skip.
      }
    }
  }

  close(): Promise<void> {
    this._eventsOpen = false;
    if (this._eventsSock !== null) {
      this._eventsSock.destroy();
      this._eventsSock = null;
    }
    return Promise.resolve();
  }
}
