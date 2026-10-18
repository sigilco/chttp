// StdioClientTransport — newline-delimited JSON-RPC over a spawned child
// process's stdin/stdout (the classic local-server MCP shape).
// `node:child_process` spawn + stdio streams lower under scriptc 0.3.3
// (probe-verified: spawn runs inside an ELF), so this ships in the main
// client surface, not a Node-only entry.
//
// The duplex stream multiplexes responses and notifications, so pending
// calls live in a plain `{ [id]: index }` record (never a Map) indexing
// into parallel resolve/reject arrays — a record can't hold function
// values under the subset.

import { spawn, type ChildProcess } from "node:child_process";
import type { JsonRpcRequest, JsonRpcResponse, RequestId } from "../types.ts";
import { JsonRpcError, INTERNAL_ERROR } from "../errors.ts";
import { ClientTransport } from "./types.ts";

export interface StdioClientOpts {
  command: string;
  args?: string[];
}

function idKey(id: RequestId): string {
  return typeof id === "number" ? "#" + String(id) : id;
}

export class StdioClientTransport extends ClientTransport {
  _command: string;
  _args: string[];
  _proc: ChildProcess | null;
  _buf: string;

  _dec: TextDecoder;
  _stderrTail: string;
  // Pending table: request id -> index into _pendOk/_pendErr.
  _pend: { [k: string]: number };
  _pendOk: ((r: JsonRpcResponse) => void)[];
  _pendErr: ((e: Error) => void)[];

  constructor(opts: StdioClientOpts) {
    super();
    this._command = opts.command;
    this._args = opts.args === undefined ? [] : opts.args;
    this._proc = null;
    this._buf = "";
    this._dec = new TextDecoder();
    this._stderrTail = "";
    this._pend = {};
    this._pendOk = [];
    this._pendErr = [];
  }

  _ensureProc(): ChildProcess {
    if (this._proc !== null) {
      return this._proc;
    }
    const proc = spawn(this._command, this._args);
    const out = proc.stdout;
    if (out !== null) {
      out.on("data", (chunk: Uint8Array) => {
        this._feed(this._dec.decode(chunk));
      });
    }
    const err = proc.stderr;
    if (err !== null) {
      err.on("data", (chunk: Uint8Array) => {
        this._stderrTail = (this._stderrTail + this._dec.decode(chunk)).slice(-2048);
      });
    }
    proc.on("error", (e: Error) => {
      this._failAll(e);
    });
    proc.on("exit", (code: number | null) => {
      if (code !== 0 && code !== null) {
        this._failAll(
          new JsonRpcError(
            INTERNAL_ERROR,
            "mcp server exited " + String(code) + ": " + this._stderrTail,
          ),
        );
      }
    });
    this._proc = proc;
    return proc;
  }

  _feed(text: string): void {
    this._buf += text;
    for (;;) {
      const idx = this._buf.indexOf("\n");
      if (idx < 0) {
        return;
      }
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.trim().length === 0) {
        continue;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servers may print non-RPC noise
      }
      const env = msg as JsonRpcResponse;
      if (
        env !== null &&
        typeof env === "object" &&
        (typeof env.id === "number" || typeof env.id === "string") &&
        (env.result !== undefined || env.error !== undefined)
      ) {
        const key = idKey(env.id);
        const idx2 = this._pend[key];
        if (idx2 !== undefined) {
          const ok = this._pendOk[idx2];
          this._dropPending(key, idx2);
          ok(env);
          continue;
        }
      }
      this.emitNote(msg as JsonRpcRequest);
    }
  }

  // Removes one pending entry; array splices shift every later index,
  // so the id->index record is re-keyed in the same pass.
  _dropPending(key: string, idx: number): void {
    delete this._pend[key];
    this._pendOk.splice(idx, 1);
    this._pendErr.splice(idx, 1);
    for (const k in this._pend) {
      if (this._pend[k] > idx) {
        this._pend[k] = this._pend[k] - 1;
      }
    }
  }

  _failAll(e: Error): void {
    while (this._pendErr.length > 0) {
      const cb = this._pendErr.shift();
      if (cb !== null && cb !== undefined) {
        cb(e);
      }
    }
    this._pendOk = [];
    this._pend = {};
  }

  request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const id = req.id;
      if (id === undefined || id === null) {
        // Notifications just write a line.
        const stdin0 = this._ensureProc().stdin;
        if (stdin0 !== null) {
          stdin0.write(JSON.stringify(req) + "\n");
        }
        resolve({ jsonrpc: "2.0", id: "", result: {} });
        return;
      }
      const key = idKey(id);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const idx = this._pend[key];
          if (idx !== undefined) {
            this._dropPending(key, idx);
          }
          reject(new JsonRpcError(INTERNAL_ERROR, "stdio request timed out"));
        }
      }, timeoutMs);
      this._pend[key] = this._pendOk.length;
      this._pendOk.push((r: JsonRpcResponse) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(r);
        }
      });
      this._pendErr.push((e: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      });
      const stdin = this._ensureProc().stdin;
      if (stdin === null) {
        reject(new JsonRpcError(INTERNAL_ERROR, "server stdin unavailable"));
        return;
      }
      stdin.write(JSON.stringify(req) + "\n");
    });
  }

  close(): Promise<void> {
    if (this._proc !== null) {
      this._proc.kill();
      this._proc = null;
    }
    this._failAll(new JsonRpcError(INTERNAL_ERROR, "transport closed"));
    return Promise.resolve();
  }
}
