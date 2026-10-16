# Integration

`@chttp/mcp` is a library, not a framework. Two surfaces:

- **`Server`** — registration (`tool`, `resource`, `prompt`) + dispatch (`handleRequest`). Transport-agnostic: anything that can get a `JsonRpcRequest` record in and a `JsonRpcResponse | null` out works.
- **`StreamableHttpTransport`** — the shipped transport. `route(server)` returns `(req: Request) => Promise<Response>` for POST JSON-RPC and SSE progress on `GET ?stream=progress`.

## Minimal server

```ts
import { Server, StreamableHttpTransport, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

const server = new Server({
  name: "my-server",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s),
});

tool(server, "ping", v.object({}), async () => "pong");

export default { fetch: StreamableHttpTransport.route(server) };
```

Mount `route(server)` wherever a `Request -> Promise<Response>` handler is accepted — a chttp route, a `fetch` export, a node:http adapter, or a scriptc `fetchShim` app. See [transport.md](transport.md).

## Mounting on a chttp app

```ts
import { Chttp } from "@chttp/router";

const app = new Chttp();
app.post("/mcp", async (c) => route(c.req.raw));
// or mount the whole handler: app.fetch-compatible signature already
```

The transport is not a router middleware — it owns the whole response. Mount it on the exact endpoint (`POST /mcp`, `GET /mcp?stream=progress`) or check `req.url` yourself.

## Stdio

v1 ships the `Transport` interface and a wiring example, not a finished stdio transport — see [`examples/integrations/mcp-stdio/`](../../examples/integrations/mcp-stdio/) (~40 LoC: read stdin lines, `JSON.parse`, `handleRequest`, `JSON.stringify` each non-null response to stdout).
