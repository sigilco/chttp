// stdio MCP server with @chttp/mcp's StdioTransport: line-delimited JSON-RPC
// on stdin/stdout (Claude Desktop and other MCP clients launch this as a
// subprocess). Also compiles with `scriptc build`.
//
// Run: node --experimental-strip-types main.ts   (or tsc + node)

import { Server, StdioTransport, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

const server = new Server({
  name: "stdio-echo",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s),
});

tool(server, "echo", v.object({ text: v.string() }), async (input) => input.text);

await new StdioTransport(server).serve();
