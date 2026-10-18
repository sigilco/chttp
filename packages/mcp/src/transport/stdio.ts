// The stdio transport story for v1: the `Transport` interface (in types.ts)
// is the shipped contract; a full StdioTransport implementation is a v2
// ticket. `examples/integrations/mcp-stdio/` shows the ~40 LoC of
// process.stdin/process.stdout plumbing that adapts Server.handleRequest to
// a stdio MCP client (Claude Desktop etc.).
//
// v1 stdio shape: line-delimited JSON-RPC on stdin; each non-null response
// written to stdout. Progress/log notifications have no async channel in
// stdio — the Transport.pushProgress hook is the seam a stdio impl would
// no-op.

import type { Transport } from "../types.ts";

export type { Transport };
