# route-contract-fetch.md — Web Standards generated dispatch

Status: **frozen** — the Web Standards twin of `contracts/route-contract.md`.
This is the seam between `packages/router/src/gen.ts` (`GenFetch`) and the
fetch surface (`app.fetch`, `app.fetchShim`) on one side, and build-time
code generators on the other (the `@chttp/unplugin` fetch emitter —
`src/emitfetch.ts` — emits modules satisfying this contract). v0.5.0,
2026-10-18.

## Shape

An emitter produces a module exporting:

```ts
export class CompiledFetchRoutes extends GenFetch {
  constructor(a: App)
  dispatchFetch(
    method: string,
    url: string,
    headers: Record<string, string> | null,
    webReq: WebReqView | null,
    body: string,
    bodyU8: Uint8Array | null,
    sink: FetchResponseSink,
  ): Promise<boolean>
}
```

registered in the app-owning entry module:

```ts
app.withFetchDispatch(new CompiledFetchRoutes(app));
```

`dispatchFetch` takes the **same normalized primitives** `App._dispatchPrim`
consumes — the contract deliberately mirrors that signature so `app.fetch`
(a real `Request` captured through the `WebReqView` view) and
`app.fetchShim` (plain primitives, `webReq === null`, `body` seeded) drive
the emitted matcher identically. No `IncomingMessage`/`ServerResponse` and
no synthesized response object appear anywhere in the module.

- `method` — the HTTP method, pre-uppercased by neither side (matchers
  normalize via `String(method)`).
- `url` — the path + query string (`"/a/b?x=1"`), exactly what
  `app.fetch` derives from `req.url`. The emitted matcher splits `?`
  itself, matching the Node-arm emit line for line.
- `headers` — a lower-cased `Record<string, string>` materialized from
  the Request's `Headers` (`headersFromRaw`), or `null` on fetchShim.
  Passed to the `ReqView` constructor as
  `headers === null ? undefined : headers` (the ReqView ctor's optional
  param).
- `webReq` — the original Web Request through the `WebReqView` interface
  view (host objects can't be class field types, so the interface is the
  sanctioned carrier), or `null` under fetchShim.
- `body` — the seeded body string: `""` under `app.fetch` (lazy reads are
  the route's business — see `_bufferFetch`), the utf8 body string under
  `fetchShim` for non-GET/HEAD methods.
- `bodyU8` — pre-read bytes for multipart-declared routes. Emitted
  matchers **decline multipart routes** (same rule as the Node arm), so
  the parameter is carried for signature parity and never read.
- `sink` — the `FetchResponseSink` the request is answered into. All
  writes go through the `ResponseSink` surface (`setStatus`, `setHeader`,
  `appendHeader`, `writeBody`, `bodyBytes`, `write`, `writeHead`,
  `endStream`, `redirect`).

**Return:** `Promise<boolean>` — always a Promise, never a union: a
single async return shape lowers cleanly where `Promise<boolean> |
boolean` would fence (SC2009). `true` means the request was answered
through `sink` (or will be — an awaited ctx runner resolves after the
chain drains). `false` declines to `_dispatchPrim`, which owns
405/notFound/not-registered decline paths on both surfaces. Emitters
**must** return `false` — never answer a route the matcher cannot fully
cover (`bail, never guess`, same as the Node arm).

## Contract members the emitted module may touch

Same stable surface as the Node arm, with the fetch-arm additions marked:

| Member | Signature |
|---|---|
| `GenFetch` | `class` — emitted class extends it; `ROUTE_CONTRACT_VERSION` instance field stamps the contract version |
| `ReqView` | `new ReqView(raw: IncomingMessage \| null, qs: string, path: string, url?: string, method?: string, headers?: Record<string, string>, headersDistinct?: Record<string, string[]>)` — fetch arm passes `null` for `raw` |
| `ReqView._seedPm` | `(pm: string[]) => void` — flat decoded `[name, value, ...]` pairs incl. `"*"` for splats |
| `ReqView._setWeb` | `(r: WebReqView \| null) => void` — captures the Web Request for `c.req.raw` |
| `ReqView._setBody` | `(s: string) => void` — installs the seeded/`text()` body |
| `ReqView.url` | `string` field — overwrite with the Request's **absolute** URL when `webReq !== null` (Hono parity: `c.req.url` is absolute on the fetch surface) |
| `Ctx` | `new Ctx(rv, sink)` — the sink is the `FetchResponseSink` directly |
| `FetchResponseSink` | `ResponseSink` subclass — capture surface; type-only in emitted code (never constructed there) |
| `WebReqView` | interface view of the Request (method/url/headers/text/arrayBuffer); type-only |
| `_guardFetch` | `(c: CtxCore, sink: ResponseSink, k: () => unknown) => Promise<void>` — drains the chain via `runChainPromise`; thrown, rejected, or silent chains answer 500 |
| `_bufferFetch` | `(c: CtxCore, sink: ResponseSink, webReq: WebReqView \| null, seeded: string, k: () => unknown) => Promise<void>` — declared-body routes: seeded string wins, else `webReq.text()` is buffered, then the guarded chain runs |
| `dec` | `(s: string) => string` — URI-decode for param/wildcard captures |
| `App._chains` | `Handler[]` — composed middleware+handler per registration index |
| `App.withFetchDispatch` | `(d: GenFetch) => App` — registration seam; enforces the version stamp |

## Body rule

Same declared-body rule as the Node arm: a route only buffers when it
registered `{ body: true }` AND the method carries a body. Concrete write
methods emit `_bufferFetch` unconditionally; `*` (all) routes keep a
runtime method check (`m === "POST" || m === "PUT" || m === "PATCH" ||
m === "DELETE"`). Non-body runners still install the seeded string via
`rv._setBody(body)` before `_guardFetch` — `_dispatchPrim` installs it
unconditionally, and fetchShim's seeded body must be visible through
`c.req.body()` identically on both dispatchers.

## Multipart rule

Emitters **must decline** any route whose registration opts include
`multipart` — identical to the Node arm. `_dispatchPrim` owns the parse;
an emitted `_bufferFetch` entry would serve the route unparsed.

## Streaming rule

Streaming middleware (`@chttp/stream`: `streamSSE`, `streamText`) works on
the fetch surface through the sink's streaming members — `writeHead`
arms ReadableStream mode, `write()` enqueues chunks (buffered until
`toResponse()` hands the controller over), `endStream()` closes it. The
emitted dispatcher changes nothing for these routes: they run through
`_guardFetch` like any other ctx route and produce a chunked
`ReadableStream` body, not a buffered single string.

## Contract versioning

Same scheme as the Node arm — both arms share the one
`ROUTE_CONTRACT_VERSION` number (`packages/router/src/gen.ts`, mirrored in
`packages/unplugin/src/contract.ts`).

- **Stamped into gen files** as a literal: `export const
  ROUTE_CONTRACT_VERSION = 4;` in the module header and
  `ROUTE_CONTRACT_VERSION = 4` as an instance field on the emitted class.
- **Validated at `withFetchDispatch`**: a numeric stamp that differs from
  the runtime's throws immediately, naming both versions; a missing stamp
  is accepted.
- Current version: **4** (v4 adds the GenFetch arm; Node-arm modules
  generated at v3 must regenerate alongside their fetch siblings).
