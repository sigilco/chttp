// StreamableHttpTransport: JSON-RPC 2.0 over HTTP POST, SSE for progress.
//
// Mounts into a chttp app (or any Web-standards host) as a route:
//
//   app.post("/mcp", StreamableHttpTransport.route(server));
//   app.get("/mcp", StreamableHttpTransport.route(server));   // SSE progress
//
// The route handler consumes only Request fields (method/url/headers/body) —
// `new Request` is not constructible under scriptc 0.3.x, so an ELF host
// never builds one; it drives Server.handleRequest + the SSE encoder
// directly instead (test/elf.test.sh is that smoke).
//
// v1 is partial spec, honest about it (docs/streamable-http-coverage.md):
// POST returns a single JSON-RPC response, GET ?stream=progress opens an SSE
// feed, Mcp-Session-Id is SET on every response but never tracked —
// sessions are ephemeral (one connection = one session); no resumability,
// no event ids, no Last-Event-ID, no session store.

import { randomUUID } from "node:crypto";
import { errorFor, isNotification, parseBody } from "../jsonrpc.ts";
import { Server, type SinkEntry } from "../server.ts";
import type { JsonRpcRequest, JsonRpcResponse, StreamableHttpOpts, Transport } from "../types.ts";
import { encodeSseEvent } from "./sse.ts";

const JSON_CT = "application/json";
const SSE_CT = "text/event-stream; charset=utf-8";
const SESSION_HEADER = "mcp-session-id";

// One open SSE connection. `push`/`end` are installed by the stream's
// start()/cancel() callbacks — function fields because the controller type
// doesn't lower as a class field under scriptc.
export class SseSession {
  id: string;
  push: ((data: string) => void) | null;
  end: (() => void) | null;
  open: boolean;
  constructor(id: string) {
    this.id = id;
    this.push = null;
    this.end = null;
    this.open = true;
  }
}

function jsonResponse(r: JsonRpcResponse, status: number, sessionId: string): Response {
  return new Response(JSON.stringify(r), {
    status: status,
    headers: { "content-type": JSON_CT, [SESSION_HEADER]: sessionId },
  });
}

function emptyResponse(status: number, sessionId: string): Response {
  return new Response(null, {
    status: status,
    headers: { [SESSION_HEADER]: sessionId },
  });
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: { "content-type": JSON_CT, allow: allow },
  });
}

function hasProgressStream(search: string): boolean {
  // p.search is "?a=1&stream=progress" — split on '&' and compare segments
  // (no searchParams dependency, no substring false-positives).
  const q = search.charAt(0) === "?" ? search.slice(1) : search;
  const parts = q.split("&");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "stream=progress") {
      return true;
    }
  }
  return false;
}

export class StreamableHttpTransport implements Transport, AsyncDisposable {
  _server: Server;
  _endpoint: string;
  _allowSseGet: boolean;
  _sessionId: () => string;
  _maxBodyBytes: number;
  _sessions: SseSession[];
  _sink: SinkEntry;
  _closed: boolean;
  _enc: TextEncoder;

  constructor(server: Server, opts?: StreamableHttpOpts) {
    this._server = server;
    this._endpoint = opts !== undefined && opts.endpoint !== undefined ? opts.endpoint : "/mcp";
    this._allowSseGet =
      opts !== undefined && opts.allowSseGet !== undefined ? opts.allowSseGet : true;
    // Library functions can't be stored as values — wrap randomUUID.
    this._sessionId =
      opts !== undefined && opts.sessionId !== undefined
        ? opts.sessionId
        : function (): string {
            return randomUUID();
          };
    this._maxBodyBytes =
      opts !== undefined && opts.maxBodyBytes !== undefined ? opts.maxBodyBytes : 1048576;
    this._sessions = [];
    this._closed = false;
    this._enc = new TextEncoder();
    // One sink per transport: server-side progress/log broadcasts fan out to
    // this transport's open SSE sessions.
    this._sink = server.registerSink((json: string): void => {
      this._fanout(json);
    });
  }

  _fanout(json: string): void {
    const frame = encodeSseEvent(json, null, null);
    for (let i = 0; i < this._sessions.length; i++) {
      const s = this._sessions[i];
      if (s.open && s.push !== null) {
        s.push(frame);
      }
    }
  }

  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    return this._server.handleRequest(req);
  }

  // Transport-seam progress push: sessionId targets one session, null
  // broadcasts to all open sessions on this transport.
  async pushProgress(sessionId: string | null, n: JsonRpcRequest): Promise<void> {
    const frame = encodeSseEvent(JSON.stringify(n), null, null);
    for (let i = 0; i < this._sessions.length; i++) {
      const s = this._sessions[i];
      if (s.open && s.push !== null && (sessionId === null || s.id === sessionId)) {
        s.push(frame);
      }
    }
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._sink.open = false;
    for (let i = 0; i < this._sessions.length; i++) {
      const s = this._sessions[i];
      s.open = false;
      if (s.end !== null) {
        s.end();
      }
      s.push = null;
      s.end = null;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  // The common case: app.post("/mcp", StreamableHttpTransport.route(server)).
  // One transport per route() call; progress still reaches SSE sessions on
  // sibling transports because the broadcast registry lives on the Server.
  static route(server: Server, opts?: StreamableHttpOpts): (req: Request) => Promise<Response> {
    const t = new StreamableHttpTransport(server, opts);
    return function (req: Request): Promise<Response> {
      return t.handle(req);
    };
  }

  async handle(req: Request): Promise<Response> {
    const method = String(req.method).toUpperCase();
    if (method === "POST") {
      return this._post(req);
    }
    if (method === "GET") {
      return this._get(req);
    }
    if (method === "DELETE") {
      // Session teardown is a v2 feature; v1 sessions are ephemeral.
      return methodNotAllowed("POST, GET");
    }
    return methodNotAllowed("POST, GET");
  }

  async _post(req: Request): Promise<Response> {
    const sessionId = this._sessionId();
    const body = await req.text();
    if (this._enc.encode(body).length > this._maxBodyBytes) {
      return new Response(JSON.stringify({ error: "Payload Too Large" }), {
        status: 413,
        headers: { "content-type": JSON_CT, [SESSION_HEADER]: sessionId },
      });
    }
    let rpcReq: JsonRpcRequest;
    try {
      rpcReq = parseBody(body);
    } catch (e) {
      return jsonResponse(errorFor(null, e), 400, sessionId);
    }
    const res = await this.handleRequest(rpcReq);
    if (res === null || isNotification(rpcReq)) {
      // Notifications get 202 Accepted, no body (MCP Streamable HTTP).
      return emptyResponse(202, sessionId);
    }
    return jsonResponse(res, 200, sessionId);
  }

  _get(req: Request): Promise<Response> {
    const sessionId = this._sessionId();
    if (!this._allowSseGet) {
      return Promise.resolve(methodNotAllowed("POST"));
    }
    const url = new URL(String(req.url));
    if (!hasProgressStream(url.search)) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Expected ?stream=progress" }), {
          status: 400,
          headers: { "content-type": JSON_CT, [SESSION_HEADER]: sessionId },
        }),
      );
    }
    const session = new SseSession(sessionId);
    this._sessions.push(session);
    const enc = this._enc;
    const rs = new ReadableStream<Uint8Array>({
      start(c: ReadableStreamDefaultController<Uint8Array>): void {
        session.push = function (data: string): void {
          c.enqueue(enc.encode(data));
        };
        session.end = function (): void {
          c.close();
        };
      },
      cancel: (): void => {
        this._dropSession(session);
      },
    });
    return Promise.resolve(
      new Response(rs, {
        status: 200,
        headers: {
          "content-type": SSE_CT,
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          [SESSION_HEADER]: sessionId,
        },
      }),
    );
  }

  _dropSession(session: SseSession): void {
    session.open = false;
    session.push = null;
    session.end = null;
  }
}
