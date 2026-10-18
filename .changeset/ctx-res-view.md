---
"@chttp/router": minor
---

feat(ctx): typed `c.res` response view on both surfaces — `.status`, `.header(name)`, `.headers` (plus `statusCode`/`nodeRes()` escape hatches for the Node surface). `use()` middleware now also wraps the notFound chain, and `c.req.url` reports the absolute URL on `app.fetch` (Hono parity for hono/logger's outbound `-->` line).
