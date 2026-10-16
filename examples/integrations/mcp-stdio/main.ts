// stdio transport wiring for @chttp/mcp (~40 LoC). v1 ships the Transport
// interface, not a finished stdio transport — this is the reference wiring
// for line-delimited JSON-RPC over stdin/stdout (MCP's stdio shape).
//
// Run: node --experimental-strip-types main.ts   (or tsc + node)

import { Server, tool } from "@chttp/mcp";
import * as v from "@chttp/val";
import { createInterface } from "node:readline";

const server = new Server({
  name: "stdio-echo",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s),
});

tool(server, "echo", v.object({ text: v.string() }), async (input) => input.text);

// One JSON-RPC message per line on stdin; each non-null response is one line
// on stdout. Notifications produce no output.
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const res = await server.handleRequest(JSON.parse(trimmed));
    if (res !== null) process.stdout.write(JSON.stringify(res) + "\n");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: msg } }) + "\n",
    );
  }
});
