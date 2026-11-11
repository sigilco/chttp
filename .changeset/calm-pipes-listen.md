---
"@chttp/mcp": minor
---

Add `StdioTransport` (line-delimited JSON-RPC over stdin/stdout, with progress frames and a pure `handleLine` core) and make `JsonRpcResponse.id` nullable so parse-error envelopes on `id: null` no longer abort inside a scriptc build.
