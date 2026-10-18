# Transports

## StreamableHttpTransport

```ts
const transport = new StreamableHttpTransport(server);
const route = StreamableHttpTransport.route(server, opts); // -> (req) => Promise<Response>
```

- `POST` — JSON-RPC request body → `200` JSON-RPC response, `202` + empty body for notifications, `400` + `-32700`/`-32600` envelope for malformed input, `413` over `maxBodyBytes` (default 1 MB).
- `GET ?stream=progress` — opens an SSE session carrying `notifications/progress` and `notifications/message`. `GET` without that query → `400`. `allowSseGet: false` → `405`.
- Other methods → `405` with `Allow: POST, GET`.
- `Mcp-Session-Id` is set on every response (v1 set-but-unused; see [streamable-http-coverage.md](streamable-http-coverage.md)).
- `new Request()` is not constructible under scriptc — the transport only _consumes_ `url`/`method`/`headers`/`body`, so it lowers into an ELF that receives Requests from a host shim.

## Progress fan-out

`ctx.progress(...)` and `ctx.log(...)` inside a handler serialize through `progressNotification`/`logNotification` and fan out to every sink registered on the server via `registerSink`. `StreamableHttpTransport` registers one such sink and routes frames to open SSE sessions: `pushProgress(sessionId, n)` targets a session, `pushProgress(null, n)` broadcasts. Progress is a side channel — the `tools/call` response itself never carries it.

## SSE encoder

`encodeSseEvent(data, event, id)`, `encodeSseComment(text)`, `encodeSseRetry(ms)` produce spec-shaped frames (`data:` lines split on `\n`/`\r\n`/`\r`, `event:`/`id:`/`retry:` fields, comments as `: text`). Newlines in `event`/`id` are stripped to one line (header-injection guard).

## The `Transport` interface

```ts
interface Transport {
  handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null>;
  pushProgress?(sessionId: string | null, notification: JsonRpcRequest): Promise<void>;
  close?(): Promise<void>;
}
```

The contract a stdio transport implements (v2). Wiring sketch in [`examples/integrations/mcp-stdio/`](../../examples/integrations/mcp-stdio/). `StreamableHttpTransport` also implements `AsyncDisposable` (`await using` closes all sessions + the sink).
