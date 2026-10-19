# Route lowering plugin

chttp lowers to a native ELF with `scriptc build` directly: the core package is authored in the scriptc compilable subset like any subset library, and no plugin is involved in that step.

`@chttp/unplugin` (a separate workspace package) is an **elective** build-time dispatch specialization on top. It statically recovers the route table from your imperative `app.get()` / `app.use()` / `app.route()` registrations and emits a `CompiledRoutes` dispatch module next to them, so matching requests skip the runtime trie walk. Anything it cannot prove stays on runtime dispatch with a build warning: the plugin bails, it never guesses.

Install:

```sh
npm i -D @chttp/unplugin
```

Full option reference: [packages/unplugin/PLUGIN.md](https://github.com/sigilco/chttp/blob/main/packages/unplugin/PLUGIN.md).

## Two output modes

**JS dist (plugin standalone).** With plain vite or rollup the plugin works on its own: it emits `.chttp/routes.gen.ts`, your bundler bundles the app as ordinary JavaScript, and you run it on node. No scriptc anywhere in the pipeline. See `examples/vite-lowering`.

**ELF (compose with unplugin-scriptc).** The emitted dispatch is authored inside the scriptc-compilable subset, so it composes with [`unplugin-scriptc`](https://github.com/sigilco/unplugin-scriptc): `chttpPlugin` lowers routes, `scriptcPlugin` runs `scriptc coverage` and `scriptc build` in the same pipeline. Compiled dispatch requires chttp as program code (vendored source or workspace layout); see the "Compiling with scriptc" section of [PLUGIN.md](https://github.com/sigilco/chttp/blob/main...

## Contract stamping

The emitted module carries a `ROUTE_CONTRACT_VERSION` stamp (module header constant plus an instance property), mirrored from chttp's exported `ROUTE_CONTRACT_VERSION`. `app.withDispatch(d)` validates the stamp once at startup: a numeric mismatch throws immediately, naming both versions. It means the dispatch was generated against a different route contract than the runtime implements, typically after upgrading one of the two packages; regenerate `.chttp/*.gen.ts` (upgrade `@chttp/unplugin` ...

## What the plugin does

At `buildStart` (and on each watch event for the file) the plugin scans route modules (default `**/*.chttp.ts`, `**/*.chttp.js`) and emits `.chttp/routes.gen.ts` next to them, satisfying the generated-dispatch contract (`contracts/route-contract.md` in the repo):

- `export class CompiledRoutes extends GenDispatch` whose `dispatch(req, res)` runs per-method sections ordered like the runtime trie (static before param before wildcard, then registration order).
- `routeTable`: full-shape literals `{ method, path, kind, handlerIdx, needsBody }[]`.
- Per-route runners: literal send-chains (`c.json`, `c.text`, ...) compile to straight `res` writes with no `Ctx` allocation; ctx routes build `ReqView`/`Ctx` through the contract surface and call the composed middleware+handler at `app._chains[idx]`.
- `constructor(a: App)` injects the router instance (needed for scriptc lowering; see the scriptc section in PLUGIN.md).

## Bail, not guess

The plugin never silently produces wrong routes. Extracted: literal-path `app.<method>()` calls, `app.all`/`app.on`, `app.use` snapshot semantics, same-file mounts, literal send-chains. Bailed to runtime registration (with a build warning):

- Non-literal paths (variables, calls, spreads).
- Conditional or loop-driven registration.
- Registrations whose handler index cannot be proven against the runtime tables.
- Mounts of routers imported from other modules.

If a routes module cannot be analyzed at all, the plugin emits a stub whose `dispatch` always returns `false`, so the app runs entirely on the runtime path.

## Usage (vite)

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { chttpPlugin } from "@chttp/unplugin"

export default defineConfig({
  plugins: [chttpPlugin.vite()],
})
```

Mark a routes module:

```ts
// src/routes.chttp.ts
import { CtxCore, createRouter } from '@chttp/router'

export const app = createRouter()

app.get('/user/:id', (c: CtxCore) => c.json({ id: c.req.param('id') }))
app.post('/echo', (c: CtxCore) => c.text(c.req.body()), { body: true })
```

Wire the generated dispatch:

```ts
// src/main.ts
import { app } from './routes.chttp.ts'
import { CompiledRoutes } from './.chttp/routes.gen.ts'

app.withDispatch(new CompiledRoutes(app))
app.serve({ port: 3000 })
```

`app.serve()` calls the generated dispatch first; `false` declines to the internal dispatch, which covers bails, `notFound`, and misses. Body buffering is opt-in per the contract: a handler reading `c.req.body()` must register with `{ body: true }` or it receives `''`.

The factory is unplugin-based, so `chttpPlugin.rollup()`, `chttpPlugin.webpack()`, and `chttpPlugin.esbuild()` work too. Only vite is verified by a fixture (`fixtures/vite-app/`): run `npm i && npm run build` there, then `node dist/main.js 3100` to hit static, param, middleware, wildcard, bailed, POST-body, and miss routes.

## Parser option

By default (`parser: "classic"`, the default) extraction parses route modules with the `typescript` package's tsc API. `parser: "tsgo"` switches to the typescript-go native compiler's client API (`typescript/sync`, available on `typescript@next` 7.x nightlies): parsing runs in a spawned native server process and the client decodes the binary AST into classic-shaped node objects. It is experimental: the nightly API breaks between versions, so pin the exact nightly you test. Without a resolvab...

## OpenAPI side channel

With `openapi: true` in the plugin options, the plugin writes a second generated file, `.chttp/routes.openapi.ts`: an OpenAPI 3.1 document (`openapiDocument`) assembled from the extracted route table, plus a `chttpRouteTable` passthrough for typed clients. It is a side channel: the router never imports it and it never enters a scriptc build. Route lowering is untouched; `routes.gen.ts` is byte-identical with the option on or off. Default is off.

Schemas come from `@chttp/val` and are attached only when the extractor can prove one in the handler AST: a `v.parse(schema, ...)` or `v.safeParse(schema, ...)` call where the schema is a val factory expression (or a module-level `const` of one, consts referencing consts included) and the target reads the handler's own context: `c.req.body()` (or `JSON.parse(c.req.body())`) becomes `requestBody`, `c.req.query()`/`c.req.queryAll()` become query parameters, `c.req.param()` fills in path parameter detail.

The emitted module does not embed JSON. It re-declares each proven schema as TS source and calls `toOpenApiSchema` from the same specifier your routes module used, so schemas evaluate at import time in your own val graph, with the val copy that actually validates requests.

What cannot be proven (a schema built dynamically, a target read off another variable, a foreign import) is never guessed: the route documents without its schema and the build warns. See the "OpenAPI side channel" section of [PLUGIN.md](https://github.com/sigilco/chttp/blob/main/packages/unplugin/PLUGIN.md) for the full detection rules and the `path` / `title` / `version` / `imports` sub-options.

## Typed client side channel

With `client: true` in the plugin options, the plugin writes a third generated file, `.chttp/routes.client.ts`, exporting a `createClient(opts)` factory whose verb methods (`get`, `post`, `put`, `patch`, `delete`, `all`) are typed against the route table. Like the OpenAPI side channel, the router never imports it, it never enters a scriptc build, and `routes.gen.ts` is byte-identical with the option on or off. Default is off. Setting `client: true` forces `openapi` on (the client re-exports the openapi sibling's `chttpRouteTable`).

Pass an object for `path` (default `routes.client.ts`) or `fetch` (the default fetch implementation, default `globalThis.fetch`; the value is never embedded in the gen output, only mirrored in the `createClient` default).

Usage:

```ts
// src/client.ts
import { createClient } from "./.chttp/routes.client.ts";

export const api = createClient({ baseUrl: "http://localhost:3000" });

const user = await api.get("/user/:id", { params: { id: "42" } });
//    ^? { id: string }

await api.post("/echo", { body: { hello: "world" } });
```

Path params substitute at the `:name` position and the remaining path segments are URL-encoded. `query` becomes a query string. `body` is JSON-serialized when given an object. A non-2xx response throws a `ChttpClientError extends Error { status, body }`; the body is parsed as JSON if the response Content-Type says so. There is no runtime library: `ChttpClientError` is declared inline in the generated module, and `fetch` resolution is `opts.fetch ?? globalThis.fetch`.

Bail, never guess: a route's response type is only inferred when the extractor can prove it. The rules are the same as the openapi table's, plus a "no body/param/query reads" guard:

- Typed response: single-statement literal-send handlers like `(c) => c.json({...})` with no `c.req.param/body/query/queryAll` reads.
- `unknown` (still emitted, with a build warning): multi-statement handlers, or any handler that reads from the request view, or handlers that do not match a literal send chain.
- Excluded entirely: routes where the handler index cannot be proven. `app.all('*', ...)` becomes a top-level `any(path, opts)` method on the client.

See the "Typed client side channel" section of [PLUGIN.md](https://github.com/sigilco/chttp/blob/main/packages/unplugin/PLUGIN.md) for the full detection rules and the `path` / `fetch` sub-options.
