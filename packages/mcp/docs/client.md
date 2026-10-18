# Client — `@chttp/mcp/client`

A typed MCP client for the same JSON-RPC 2.0 surface the server package
implements. Type-safety comes from schema-first descriptors, not codegen:
a `ToolDef<I,O>` pairs a name with optional `StandardSchemaV1` validators
for its input and output, and `client.call(def, args)` validates both
sides through the `schema["~standard"].validate` seam.

```ts
import { Client, FetchClientTransport, toolDef } from "@chttp/mcp/client";
import * as v from "@chttp/val";

const addTodo = toolDef(
  "add_todo",
  v.object({ text: v.string() }),
  v.object({ id: v.string() }),
);

const client = new Client({
  name: "my-app",
  version: "1.0.0",
  transport: new FetchClientTransport({ url: "https://mcp.example.com/" }),
});

await client.connect();
const out = await client.call(addTodo, { text: "ship it" }); // -> { id: string }
```

## Descriptors

`toolDef(name, input?, output?)`, `resourceDef(uri, output?, opts?)`, and
`promptDef(name, args?, output?)` build the records. The same `ToolDef`
registers on the server — `server.toolDef(def, handler)` or the `tool()`
helper's descriptor overload — so one definition drives both sides:

```ts
server.toolDef(addTodo, async (input) => {
  const row = db.insert(input.text);
  return { id: row.id }; // validated against def.output
});
```

## Client surface

- `connect()` — `initialize` + `notifications/initialized`, returns the
  server's `InitializeResult`. Opens the notification stream when
  `onNotification`/`onProgress` handlers are registered.
- `call(def, args)` — validate args → `tools/call` → reject on
  `isError` (`ClientToolError`) → validate `structuredContent ?? result`.
- `callTool(name, args)` — the untyped escape hatch, returns
  `CallToolResult`.
- `listTools`/`listResources`/`listPrompts`, `readResource(uri | def)`,
  `getPrompt(name | def, args)`, `ping`, `setLogLevel`.
- `onNotification(h)` / `onProgress(h)` — progress notifications route to
  the progress handlers; everything else lands on `onNotification`.
- `close()` / `Symbol.asyncDispose()` — try/finally, no `using`
  (engines floor).

JSON-RPC errors pass through as `JsonRpcError`; client-side schema
rejections throw `ClientValidationError` (`code: "E_CLIENT_VALIDATION"`,
issues serialized on `issuesJson`).

## Transports

All three implement `ClientTransport` — subclass it to plug in a
proprietary channel:

- `FetchClientTransport` — `fetch` POST, streams `openEvents` through
  `res.body.getReader()`. Node path.
- `HttpClientTransport` — minimal HTTP/1.1 POST over `node:net` /
  `node:tls` (`connection: close`, one socket per request) plus an
  incremental SSE decoder. This is the ELF path — every construct lowers.
- `StdioClientTransport` — NDJSON over `node:child_process` spawn.
  Node-only (spawn lowers, but a child-process pipeline is meaningless
  in a self-contained ELF; kept out of the ELF smoke on purpose).

`mcp-session-id` is captured from the first response and echoed on later
requests as an opaque token.
