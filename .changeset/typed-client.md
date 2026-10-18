---
"@chttp/router": minor
---

Typed HTTP client at `@chttp/router/client`: `createClient(baseUrl)` + `get`/`post`/`put`/`patch`/`delete`/`request` over a minimal HTTP/1.1 transport on `node:net`/`node:tls` — no `fetch`, so the same source compiles into an app ELF. `ClientInput<P>` checks `params` keys against `ParamKey<P>` on Node.js (`.d.ts` surface only — compiled apps bind a `ClientCore` receiver and get the concrete signatures); response types are caller-declared per call. One request per connection (`Connection: close`), chunked responses decoded, no redirects/streaming in v1.
