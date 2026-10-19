# @chttp/router

## 0.4.0

### Minor Changes

- feat(router): Web Standards generated-dispatch arm (GenFetch/withFetchDispatch, contract v4) + fetch emitter in unplugin; @chttp/stream streams through FetchResponseSink as a real ReadableStream

- feat(ctx): typed `c.res` response view on both surfaces — `.status`, `.header(name)`, `.headers` (plus `statusCode`/`nodeRes()` escape hatches for the Node surface). `use()` middleware now also wraps the notFound chain, and `c.req.url` reports the absolute URL on `app.fetch` (Hono parity for hono/logger's outbound `-->` line).

- feat(router): lite Node fetch bridge (issue #89) — `app.fetchBridge()`/`app.serveFetch()` drive the fetch dispatch arm over `LiteRequest` (`WebReqView` over `IncomingMessage`) and `LiteResponse` (a `FetchResponseSink` writing straight to `ServerResponse`), skipping per-request undici `Request`/`Headers`/`Response` construction; `WebReqView.headers` narrows to the structural `WebHeadersView`. `c.req.raw` on the lite surface returns the `LiteRequest`; `lite.request()` materializes a real undici `Request` lazily for `fetch(c.req.raw)`-style consumers. Bench: `chttp-fetch-lite-node` runs at 86–101% of `chttp-node` vs the undici bridge's 50–56% (bench/RESULTS-v2.md).

- fetch(app.fetch) passthrough contract: capture the Web Request into c.req.raw, adopt handler-returned Response objects (incl. streams), and stop eager body buffering on undeclared routes

- Typed HTTP client at `@chttp/router/client`: `createClient(baseUrl)` + `get`/`post`/`put`/`patch`/`delete`/`request` over a minimal HTTP/1.1 transport on `node:net`/`node:tls` — no `fetch`, so the same source compiles into an app ELF. `ClientInput<P>` checks `params` keys against `ParamKey<P>` on Node.js (`.d.ts` surface only — compiled apps bind a `ClientCore` receiver and get the concrete signatures); response types are caller-declared per call. One request per connection (`Connection: close`), chunked responses decoded, no redirects/streaming in v1.

### Patch Changes

- fix(req): `c.req.header(name)` no longer crashes on absent headers in single-graph (vendored/program-code) scriptc builds — `_headers`/`_headersDistinct` are probed with `hasOwnProperty` before indexing instead of a bare record read that throws "record has no key".

- empty-body responses send no content-type (Hono parity); default text/plain charset is UTF-8

- feat(ws): post-merge audit hardening for issue #13 — `allowOrigin` exact-match allowlist (403), `Sec-WebSocket-Key` base64/16-byte format check, peer close-reason UTF-8 validation (1007); `upgradeHandler()` catches a throwing dispatch and destroys the socket; `UpgradeFn` re-exported

## 0.3.0

### Minor Changes

- Add the Web Standards `app.fetch(req, env?, ctx?) → Promise<Response>` surface. `app.handler()` is now a thin Node adapter around it. New Ctx additions: `c.set` / `c.get` for request-scoped vars, `c.req.raw` exposing the inbound `Request`, and `c.header(name, value, { append: true })` for multi-value headers. New `App.use(path, ...mw)` overload for Hono-style path-scoped middleware. The `ResponseSink` abstraction in `packages/router/src/sink.ts` is the single seam that lets the same chain produce either a `ServerResponse` write (Node) or a Web `Response` finalization (Workers, Deno Deploy, Bun, Vercel Edge, Netlify Edge, Supabase, Service Worker). Both surfaces compile to a native ELF; the `bench/apps/chttp-fetch.ts` gate is the new scriptc subset check.

  This commit also includes the SC9001 fix (see `fix-sc9001.md`): `ReqView` now materializes `raw.headers` and `raw.headersDistinct` into Record-typed locals at construction so `header()` reads from Record locals instead of class-typed fields on `IncomingMessage`. The change is needed on the app.fetch commit because the partial fix for `headers` was already there (commit `0305d62`); the `headersDistinct` arm was left in the prior state and fences scriptc 0.3.x with "live dynFrom of unsupported type httpReq".

- Multipart uploads: per-route multipart option parses the stream at dispatch (memoryStorage/diskStorage, streaming maxFileBytes/maxFiles/maxFieldBytes -> 413), c.req.file/field/files/fields; unplugin declines declared-multipart routes (contract v3).

### Patch Changes

- Fix a runtime failure of the compiled ELF under scriptc 0.3.x (upstream: vercel-labs/scriptc#963). Two root causes, both removed from the router surface.

  First, generic classes lower to methodless instances: `Ctx<P>` and `ReqView<P>` compile to objects whose fields read but whose every method call throws (`c.json is not a function` on 0.3.1/0.3.2, `rv._setBody is not a function` on 0.3.3). Second, class-typed unions are unrepresentable: `ResponseSink | ServerResponse` and `IncomingMessage | NodeReqStub` cannot sit in constructor or parameter positions, and `typeof x.method === "function"` discrimination demotes method names into `prototypeMethodAccesses`, which removes the fallback entirely.

  The fix narrows the surface so the same source lowers to a working ELF:
  - `Ctx`/`ReqView` become non-generic `CtxCore`/`ReqViewCore` classes; `interface Ctx<P> extends CtxCore` plus `const Ctx = CtxCore` aliases keep `new Ctx(...)`, `Ctx` annotations and `Ctx<'/path'>` working under tsc with no source change for users.
  - The `Ctx` constructor, `_guard` and `_buffer` take a `ResponseSink` only; callers with a raw `ServerResponse` wrap it: `new Ctx(rv, new NodeResponseSink(res))`. `ROUTE_CONTRACT_VERSION` bumps 1→2 and the generated dispatch is regenerated to match.
  - `ReqViewCore` takes `IncomingMessage | null` plus optional stub arguments; the `app.fetch` arm passes `null` instead of a record union. `c.req.raw` is now `IncomingMessage | null` (`null` on the fetch path).
  - `ResponseSink` gains `nodeRes(): ServerResponse | null` for sink-flavor reads without casts.

  ELF-verified under scriptc 0.3.3: `chttp.ts` and `chttp-fast.ts` serve real 200s (`/json`, `/user/42`, `POST /echo`, `/files`, `/missing` 404, `GET /echo` 405), and a fetch-surface probe (`_dispatchPrim` + `FetchResponseSink` + `toResponse()`) serves 200s including `c.set`/`c.get`, append headers and middleware.

- Fix scriptc 0.3.x build fence (SC9001 "live dynFrom of unsupported type httpReq") in `ReqView.header()`. The prior implementation read `this.raw.headersDistinct` through a chained `as unknown as Record<...>` cast on a class-typed field; scriptc 0.3.x cannot lower the indexed field read on the `IncomingMessage` (httpReq) arm of the union and emits SC9001 as an internal compiler error. The fix materializes `raw.headers` and `raw.headersDistinct` into Record-typed locals (`_headers` and `_headersDistinct`) at construction; `header()` reads from these locals, both indexed field reads lower cleanly, and the cost is O(headers) once per request (same as the prior single-value lookups). The same materialization also gives the `app.fetch` Web Standards surface a single shared lookup shape (Web Headers are joined with `, ` per RFC 7230 before `copyHeaders`).

  **This is a known fence in the published v0.2.0 and v0.2.1 tarballs** (introduced by the 0.2.8→0.3.x scriptc pin bump in commit `273f209`). Consumers on those versions that try to `scriptc build` their app will hit SC9001 on the chttp router. The next release re-enables the `chttp-scriptc` and `chttp-fast-scriptc` bench cells under 0.3.x and unblocks any downstream `scriptc build` of an app that imports `@chttp/router`. No source change is required on the consumer side beyond bumping the @chttp/router version.

  Defense-in-depth: even if a future scriptc release fixes SC9001 directly, the materialization is the right shape (Record locals + O(headers) copy at construction) and stays. The fix is small (~80 LOC net in `packages/router/src/index.ts`) and backports cleanly onto the v0.2.x line if a backport release is needed.

  **Partial fix.** This entry fixes two of three known SC9001 sites (`index.ts` `ReqView.header()` `headers` and `headersDistinct` arms). A third site in the `ReqView` constructor's URL read remains open and is tracked in issue #62; it will land in v0.2.3.

## 0.2.1

### Patch Changes

- Real TCP backpressure on scriptc 0.3.2. `@chttp/ws` and `@chttp/stream` now route outbound data through a compiled `Writable` wrapper whose `_write` forwards to the socket/response, so `write(): boolean`, `"drain"` and `writableLength` observe the real queue; the per-window byte caps stay as the secondary fail-safe (ws flood still closes 1008). When the wrapper ships inside a statically compiled npm package — where 0.3.2 never pumps a subclassed `_write` — it detects the dead pump at construction and degrades to direct writes, leaving the window cap as the only policy. Requires scriptc >= 0.3.2.

## 0.2.0

### Minor Changes

- router: serve() no longer attaches the upgrade listener; wire server.on(upgrade, ...) in your own program (npm-static compilation stays 100% for every app)

- Add c.bytes(buf, contentType) for binary response bodies
