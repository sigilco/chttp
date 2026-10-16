---
"@chttp/mcp": minor
---

Typed client on a new `./client` subpath (`@chttp/mcp/client`): `Client` plus `toolDef`/`resourceDef`/`promptDef` schema-first descriptors that register on the server via `server.toolDef`, three transports (`fetch`, `node:net`/`node:tls` HTTP/1.1+SSE for the ELF path, stdio), `callTool`/`call`/`listTools`/`readResource`/`getPrompt`, progress-notification handlers, and `JsonRpcError` passthrough. Ported from sigilco/cutils PR #19.
