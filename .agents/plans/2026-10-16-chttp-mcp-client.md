# @chttp/mcp client (wave 3)

Spec of record for the `./client` subpath of `@chttp/mcp`. Wave-3 work: the
package ships a server today; this adds a typed JSON-RPC client authored in
the same scriptc-compilable subset.

## Packaging

- No new package. `packages/mcp/package.json` gains a `./client` subpath
  export (`dist/esm/client/index.js`); `.` stays the server surface.
- Sources under `src/client/`. Fixed versioning group untouched.

## Type-safety model

No Proxy (`hc<AppType>` can't lower — dynamic interception is out). Types come
from schema-first descriptors shared between client and server:

- `ToolDef<I, O>` — `{ name, input?: StandardSchemaV1 | null, output?: StandardSchemaV1 | null }`
- `ResourceDef<O>` — `{ uri, name?, mimeType?, output? }`
- `PromptDef<O>` — `{ name, args?: PromptArgument[], output? }`
- `toolDef` / `resourceDef` / `promptDef` helpers infer `I`/`O` from the
  schemas via `StandardSchemaV1.InferInput/InferOutput`.

`client.call<I, O>(def, args): Promise<O>` validates `args` against
`def.input` and the result (`structuredContent` when present, else the whole
result) against `def.output` through `runStdValidate` — the same seam the
server uses. Registration overload `tool(server, def, handler, opts)` lets a
descriptor drive both sides; requires a non-null `def.input`.

## Client surface (v1)

`Client { connect, callTool, call, listTools, listResources, listPrompts,
readResource, getPrompt, ping, setLogLevel, onNotification, onProgress,
close, [Symbol.asyncDispose] }`.

- `connect` sends `initialize` + `notifications/initialized`, stores the
  result (`initializeResult()`), and opens the progress stream when handlers
  are registered and the transport supports one.
- JSON-RPC error envelopes surface as `JsonRpcError` passthrough.
- Tool `isError` results surface as `ClientToolError`; schema validation
  failures as `ClientValidationError` (issues serialized — `unknown` can't
  sit in a class field).

## Transports

- `ClientTransport` — base class (`request`, `close`, optional
  `openEvents`, `setOnNotification`). A class, not an interface:
  function-bearing records can't be class fields.
- `HttpClientTransport` — minimal HTTP/1.1 POST over `node:net`/`node:tls`
  (`connect`/`connectTls` named imports; `Connection: close`, chunked +
  content-length bodies, `mcp-session-id` capture/echo). SSE POST responses
  decode through `SseDecoder`; `openEvents` holds a GET `?stream=progress`
  socket for `notifications/*`. Works under Node and inside the ELF.
- `FetchClientTransport` — the same over `fetch` (Node convenience path).
- `StdioClientTransport` — `node:child_process` spawn; newline-delimited
  JSON-RPC; pending table is a plain `{ [id]: index }` record into parallel
  resolve/reject arrays (records can't hold function values).
- `SseDecoder` — incremental `feed(text) -> SseEvent[]` (also exported for
  reuse; encode lives in `transport/sse.ts`).

## ELF proof

`test/elf-client-smoke.ts` spins a `node:net` loopback HTTP server in front
of `Server.handleRequest` + `encodeSseEvent`, then runs the real
`HttpClientTransport` client against it: initialize, tools/call round-trip
(validated args + output), notifications/progress over the GET stream, and a
JSON-RPC error passthrough. `test/elf.test.sh` builds and asserts both
smokes.

## Probe results (scriptc 0.3.3, this repo)

- `node:net` `createServer`/`connect` loopback — lowers AND runs in ELF.
- `node:tls` `connect(port, host, {servername})` — lowers (mongo pattern).
- `node:child_process` `spawn` + stdout data — lowers AND runs in ELF.
- `TextDecoder` — lowers AND runs in ELF.
- `fetch` — lowers AND runs in ELF (kept as the Node tier anyway).

## Don't ship

Batches, resumability/Last-Event-ID, session tracking beyond the opaque
`mcp-session-id` echo, keep-alive connection reuse (one socket per request),
server->client requests (sampling/roots/elicitation), websocket transport,
DELETE session teardown.
