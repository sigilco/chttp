// StdioTransport: line-delimited JSON-RPC over stdin/stdout, the MCP stdio
// transport shape (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio).
//
//   const transport = new StdioTransport(server);
//   await transport.serve();      // resolves when stdin closes and every in-flight request settled
//
// Each non-empty stdin line is one JSON-RPC message; each non-null response is
// one line on stdout (messages never contain raw newlines: JSON.stringify
// escapes them). Notifications produce no output. Progress and log
// notifications raised by handlers are written to stdout as their own lines
// through a sink registered on the server. stdout carries protocol frames only:
// write diagnostics to stderr.
//
// `handleLine` is the pure core (line in, line out) and the unit under test;
// `serve` is the thin readline glue. process.stdin.on("data") is not lowered by
// scriptc, readline is.

import { createInterface } from "node:readline";
import { errorFor, parseBody, requestId } from "../jsonrpc.ts";
import { Server, type SinkEntry } from "../server.ts";
import type { JsonRpcRequest, JsonRpcResponse, Transport } from "../types.ts";

export type { Transport };

export class StdioTransport implements Transport {
  _server: Server;
  _sink: SinkEntry | null;
  _pending: number;
  _closed: boolean;
  _finish: (() => void) | null;

  constructor(server: Server) {
    this._server = server;
    this._sink = null;
    this._pending = 0;
    this._closed = false;
    this._finish = null;
  }

  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    return this._server.handleRequest(req);
  }

  // One wire line in, one wire line out (null for blank lines and
  // notifications). Never throws: malformed input maps to a JSON-RPC error
  // envelope on id null, a handler failure to an error on the request id.
  async handleLine(line: string): Promise<string | null> {
    const text = line.trim();
    if (text.length === 0) {
      return null;
    }
    let req: JsonRpcRequest;
    try {
      req = parseBody(text);
    } catch (e) {
      return JSON.stringify(errorFor(null, e));
    }
    try {
      const res = await this._server.handleRequest(req);
      if (res === null) {
        return null;
      }
      return JSON.stringify(res);
    } catch (e) {
      return JSON.stringify(errorFor(requestId(req), e));
    }
  }

  // stdio has one implicit session: progress frames always go to stdout.
  async pushProgress(_sessionId: string | null, notification: JsonRpcRequest): Promise<void> {
    process.stdout.write(JSON.stringify(notification) + "\n");
  }

  // Reads stdin until it closes. Requests run concurrently; the promise
  // resolves after stdin ends and all in-flight requests have written their
  // response.
  serve(): Promise<void> {
    const t = this;
    t._sink = t._server.registerSink(function (json: string): void {
      process.stdout.write(json + "\n");
    });
    const rl = createInterface({ input: process.stdin, terminal: false });
    return new Promise<void>(function (resolve: () => void): void {
      t._finish = resolve;
      rl.on("line", async function (line: string): Promise<void> {
        t._pending = t._pending + 1;
        const out = await t.handleLine(line);
        if (out !== null) {
          process.stdout.write(out + "\n");
        }
        t._pending = t._pending - 1;
        t._settle();
      });
      rl.on("close", function (): void {
        t._closed = true;
        t._settle();
      });
    });
  }

  _settle(): void {
    if (this._closed && this._pending === 0 && this._finish !== null) {
      const f = this._finish;
      this._finish = null;
      f();
    }
  }

  async close(): Promise<void> {
    if (this._sink !== null) {
      this._sink.open = false;
      this._sink = null;
    }
  }
}
