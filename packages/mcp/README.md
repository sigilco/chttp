# @chttp/mcp

Model Context Protocol server (JSON-RPC 2.0, spec revision 2025-06-18) authored in the [scriptc](https://github.com/vercel-labs/scriptc)-compilable subset — the same source type-checks to a JS package and lowers into a native ELF with `scriptc build`. Zero runtime dependencies. Validation flows through the [Standard Schema](https://standardschema.dev) seam, so `@chttp/val`, valibot, zod, or any conforming validator works; JSON Schema emission flows through a tiny adapter you inject.

```ts
import { Server, StreamableHttpTransport, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

const server = new Server({
  name: "todo-mcp",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s), // adapter seam — see docs/schema.md
});

tool(
  server,
  "add_todo",
  v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
  async (input) => `added: ${input.text}`,
);

export default {
  fetch: StreamableHttpTransport.route(server), // (req) => Promise<Response>
};
```

## What ships

- `Server` — `tool`/`resource`/`prompt` registration + `handleRequest(JsonRpcRequest): Promise<JsonRpcResponse | null>` covering the full method table (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `notifications/*`, `logging/setLevel`, `completion/complete`).
- `StreamableHttpTransport` — POST request/response + SSE `GET ?stream=progress` for `notifications/progress`, on the `Request`/`Response` surface. `Mcp-Session-Id` is set-but-unused in v1.
- The auto-wrap ladder for tool returns (string → text block, `ContentBlock`/`ContentBlock[]`/`CallToolResult` passthrough, plain object → dual content, `null` → empty, throw → `isError`).
- `encodeSseEvent`/`encodeSseComment`/`encodeSseRetry`, envelope helpers (`parseBody`, `parseRequest`, `resultResponse`, `errorResponse`, `errorFor`, `notification`), progress/log notification builders, `runStdValidate`/`validatorFor`.

Docs: [docs/](docs/) — [integration](docs/integration.md), [schema seams](docs/schema.md), [transport](docs/transport.md), [streamable-http coverage](docs/streamable-http-coverage.md), [auto-wrap](docs/auto-wrap.md), [scriptc subset notes](docs/subset-quirks.md). Stdio wiring example: [`examples/integrations/mcp-stdio/`](../../examples/integrations/mcp-stdio/).

## Testing

```sh
pnpm --filter @chttp/mcp test      # node:test against the tsc build
bash packages/mcp/test/elf.test.sh # scriptc build + native smoke
```
