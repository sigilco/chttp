---
"@chttp/mcp": minor
---

Add `Symbol.asyncDispose` to `StdioClientTransport` so it works with `await using`; it delegates to `close()`, matching `Client` and `StreamableHttpTransport`.
