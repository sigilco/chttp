# @chttp/mcp

Model Context Protocol server (JSON-RPC 2.0, spec revision 2025-06-18) authored in the scriptc-compilable subset — the same source builds to a JS package with `tsc` and lowers into a native ELF with `scriptc build`. Zero runtime dependencies.

```ts
import { Server, StreamableHttpTransport, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

const server = new Server({
  name: "my-server",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s),
});

tool(server, "add", v.object({ a: v.number(), b: v.number() }), async (i) =>
  String(i.a + i.b),
);

export default { fetch: StreamableHttpTransport.route(server) };
```

## What it does

- `Server` — `tool`/`resource`/`prompt` registration plus `handleRequest(JsonRpcRequest)` covering the full MCP method table (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `notifications/*`, `logging/setLevel`, `completion/complete`).
- Two injected seams: validation runs through `schema["~standard"].validate` (any [Standard Schema](https://standardschema.dev) validator — `@chttp/val`, valibot, zod); JSON Schema emission is an adapter you pass (`emitJsonSchema`), so no schema code ships in the package.
- Auto-wrap ladder for tool returns: strings become text blocks, plain objects become dual `content` + `structuredContent`, a full `CallToolResult` passes through, thrown errors become `isError` results.
- `StreamableHttpTransport` — POST JSON-RPC plus an SSE stream (`GET ?stream=progress`) carrying `notifications/progress`/`notifications/message` while tools run.
- Progress + log notifications through a server-level sink registry (`ctx.progress`, `ctx.log`, `logging/setLevel` severity filter).

## Docs

Per-package pages live under [`packages/mcp/docs/`](https://github.com/sigilco/chttp/tree/main/packages/mcp/docs): integration, schema seams, transports, Streamable-HTTP coverage (what v1 does and deliberately skips), the auto-wrap ladder, and scriptc-subset authoring notes. Examples: [`packages/mcp/examples/todo-mcp`](https://github.com/sigilco/chttp/tree/main/packages/mcp/examples/todo-mcp) and [`examples/integrations/mcp-stdio`](https://github.com/sigilco/chttp/tree/main/examples/integrations/mcp-stdio).

## Status

v0.1.0. Covers spec revision 2025-06-18 for tools/resources/prompts + streamable-HTTP POST/SSE. Sessions, resumability, batching, roots/sampling/elicitation, and a packaged stdio transport are out of scope by design — see `docs/streamable-http-coverage.md`.
