---
"@chttp/router": minor
---

feat(router): lite Node fetch bridge (issue #89) — `app.fetchBridge()`/`app.serveFetch()` drive the fetch dispatch arm over `LiteRequest` (`WebReqView` over `IncomingMessage`) and `LiteResponse` (a `FetchResponseSink` writing straight to `ServerResponse`), skipping per-request undici `Request`/`Headers`/`Response` construction; `WebReqView.headers` narrows to the structural `WebHeadersView`. `c.req.raw` on the lite surface returns the `LiteRequest`; `lite.request()` materializes a real undici `Request` lazily for `fetch(c.req.raw)`-style consumers. Bench: `chttp-fetch-lite-node` runs at 86–101% of `chttp-node` vs the undici bridge's 50–56% (bench/RESULTS-v2.md).
