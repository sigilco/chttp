# Streamable HTTP coverage

What `@chttp/mcp` v1 implements of the [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) — and what it deliberately leaves out.

## Covered

- Single `POST` endpoint accepting one JSON-RPC message per request (`Content-Type: application/json` implied; the body is read as text).
- `200 application/json` response envelopes for requests; `202 Accepted` + empty body for notifications and responses-only posts.
- `400` with a JSON-RPC error envelope (`-32700` parse, `-32600` invalid request — including batches, which are out of scope) for malformed input.
- `GET ?stream=progress` SSE stream carrying `notifications/progress` and `notifications/message` while a tool runs (`ctx.progress`, `ctx.log`).
- `405` for other methods (with `Allow`), `413` over the body cap.
- `Mcp-Session-Id` header issued on every response.

## NOT covered in v1 (set-but-unused / explicit scope cut)

| Spec feature                                           | Status                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `Mcp-Session-Id` tracking / validation                 | Header set but not tracked — sessions are not a concept in v1    |
| SSE resumability (`Last-Event-ID`, event `id:` replay) | No event IDs emitted, no resumable stream store                  |
| SSE stream opened per-request on `POST`                | Progress goes only to sessions opened via `GET ?stream=progress` |
| `DELETE` session termination                           | `405`                                                            |
| Batched JSON-RPC requests                              | `-32600` by design (method-per-request)                          |
| `Accept`/`Origin` header negotiation                   | Not inspected in v1                                              |

The `sessionId` option lets a host inject its own ID generator (default `node:crypto` `randomUUID`). A v2 session store is a candidate for a follow-up package; the header plumbing is already in place so upgrading is non-breaking.
