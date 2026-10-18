// FetchClientTransport — the Node convenience tier. `fetch` handles the
// HTTP plumbing (keep-alive, TLS, proxies); the socket transport in
// http.ts exists because an ELF binary can't rely on a fetch runtime.
// Both lower under scriptc 0.3.3 — this tier is for Node hosts that want
// one dependency-free line of setup.

import type { JsonRpcRequest, JsonRpcResponse, RequestId } from "../types.ts";
import { JsonRpcError, PARSE_ERROR } from "../errors.ts";
import { SseDecoder } from "./sse.ts";
import { ClientTransport } from "./types.ts";

const SESSION_HEADER = "mcp-session-id";

export interface FetchClientOpts {
  url: string;
  headers?: { [k: string]: string };
}

function envFromMessage(msg: unknown, wantId: RequestId): JsonRpcResponse | null {
  const env = msg as JsonRpcResponse;
  if (env !== null && typeof env === "object" && env.id === wantId) {
    return env;
  }
  return null;
}

export class FetchClientTransport extends ClientTransport {
  _url: string;
  _headers: { [k: string]: string };
  _sessionId: string | null;

  _abortFn: (() => void) | null;
  _dec: TextDecoder;

  constructor(opts: FetchClientOpts) {
    super();
    this._url = opts.url;
    this._headers = opts.headers === undefined || opts.headers === null ? {} : opts.headers;
    this._sessionId = null;
    this._abortFn = null;
    this._dec = new TextDecoder();
  }

  sessionId(): string | null {
    return this._sessionId;
  }

  request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    return this._post(req, timeoutMs);
  }

  async _post(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    const headers: { [k: string]: string } = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    for (const k in this._headers) {
      headers[k] = this._headers[k];
    }
    if (this._sessionId !== null) {
      headers[SESSION_HEADER] = this._sessionId;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
    }, timeoutMs);
    const res = await fetch(this._url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(req),
      signal: ac.signal,
    });
    clearTimeout(timer);
    const sid = res.headers.get(SESSION_HEADER);
    if (sid !== null && sid !== "") {
      this._sessionId = sid;
    }
    const ctRaw = res.headers.get("content-type");
    const ctype = ctRaw === null ? "" : ctRaw;
    const body = await res.text();
    const wantId: RequestId = req.id === undefined || req.id === null ? "" : req.id;
    if (ctype.indexOf("text/event-stream") >= 0) {
      const events = new SseDecoder().feed(body);
      let found: JsonRpcResponse | null = null;
      for (let i = 0; i < events.length; i++) {
        let msg: unknown;
        try {
          msg = JSON.parse(events[i].data);
        } catch {
          continue;
        }
        const env = envFromMessage(msg, wantId);
        if (env !== null) {
          found = env;
        } else {
          this.emitNote(msg as JsonRpcRequest);
        }
      }
      if (found === null) {
        if (req.id === undefined || req.id === null) {
          return { jsonrpc: "2.0", id: "", result: {} };
        }
        throw new JsonRpcError(PARSE_ERROR, "no response envelope in SSE reply");
      }
      return found;
    }
    if (res.status === 202) {
      return { jsonrpc: "2.0", id: "", result: {} };
    }
    return JSON.parse(body) as JsonRpcResponse;
  }

  openEvents(timeoutMs: number): Promise<void> {
    return this._openEvents(timeoutMs);
  }

  async _openEvents(timeoutMs: number): Promise<void> {
    if (this._abortFn !== null) {
      return;
    }
    const headers: { [k: string]: string } = { accept: "text/event-stream" };
    for (const k in this._headers) {
      headers[k] = this._headers[k];
    }
    if (this._sessionId !== null) {
      headers[SESSION_HEADER] = this._sessionId;
    }
    const ac = new AbortController();
    this._abortFn = function (): void {
      ac.abort();
    };
    const sep = this._url.indexOf("?") >= 0 ? "&" : "?";
    const res = await fetch(this._url + sep + "stream=progress", {
      method: "GET",
      headers: headers,
      signal: ac.signal,
    });
    if (!res.ok || res.body === null) {
      this._abortFn = null;
      throw new JsonRpcError(PARSE_ERROR, "events stream refused: HTTP " + res.status);
    }
    const reader = res.body.getReader();
    const sse = new SseDecoder();
    const dec = this._dec;
    // Detached pump: resolves once headers are accepted, then feeds events
    // to the handler until close() aborts or the server ends the stream.
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const step = await reader.read();
          if (step.done) {
            return;
          }
          const events = sse.feed(dec.decode(step.value));
          if (this._note !== null) {
            for (let i = 0; i < events.length; i++) {
              try {
                this.emitNote(JSON.parse(events[i].data) as JsonRpcRequest);
              } catch {
                // not MCP traffic
              }
            }
          }
        }
      } catch {
        // Abort-driven teardown lands here.
      }
    };
    void timeoutMs;
    void pump();
  }

  close(): Promise<void> {
    if (this._abortFn !== null) {
      this._abortFn();
      this._abortFn = null;
    }
    return Promise.resolve();
  }
}
