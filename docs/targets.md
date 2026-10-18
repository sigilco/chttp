# Run targets

The same source runs on three targets. Pick per deployment.

| Target | Entry | When |
| --- | --- | --- |
| Node | `app.serve({port})` or `app.handler()` | npm packages, fastest iteration, dev workflow |
| Web Standards | `app.fetch(req, env, ctx)` | Cloudflare Workers, Deno Deploy, Bun, Vercel Edge, Netlify Edge, Lambda, Service Worker, anywhere with a `Request` |
| Native ELF | `scriptc build` → static binary | Containers, scratch images, single-digit-ms cold start, no runtime needed |

The Web Standards surface is canonical. `app.handler()` is a 50-80 LOC Node adapter around `app.fetch`; the same `createRouter()` symbol works in every environment.

## Node

```sh
node app.js
```

Any npm package works. `app.serve()` wraps `http.createServer`; use `app.handler()` to mount into your own server.

## Web Standards

```ts
// Anywhere with a `Request` in scope
const res = await app.fetch(new Request("http://localhost/user/42"));

// Cloudflare Workers / Deno Deploy / Bun / Vercel Edge / Service Worker
export default { async fetch(req, env, ctx) { return app.fetch(req, env, ctx); } };
```

The Ctx surface is Web-Standards-shaped: `c.req.{url,method,path,header,query,param,body,raw}`,
`c.set`/`c.get` for request-scoped vars, `c.header(name, value, {append: true})` for
multi-value headers. Off-the-shelf Hono middlewares wire in via the
[`hono-middleware`](../examples/integrations/hono-middleware/) template.

Recipes:
- [`examples/integrations/cloudflare-workers/`](../examples/integrations/cloudflare-workers/) — CF Workers via `app.fetch`
- [`examples/integrations/aws-lambda/`](../examples/integrations/aws-lambda/) — API Gateway v2 / Lambda URL bridge (Node or `provided.al2023` ELF)

## Native ELF

```sh
scriptc build app.js --npm-static @chttp/router --optimization=speed -o app-bin
./app-bin 3000
```

Everything the app imports must stay inside the scriptc subset, so npm packages outside it do not compile. Check with `scriptc coverage`. Rules for authors: [Coding agents](architecture.md). To call C libraries from the ELF, see [Native FFI](native.md).

`app.fetch` itself is JS-runtime-only today: `new Request` is not constructible
under scriptc 0.3.x, so an ELF host cannot call `app.fetch(req)`. The native
entry is the host-shim `app.fetchShim(method, url, headers, body, respond)` —
plain primitives in, a callback out, no WHATWG types on either side — which
runs the same route table through the shared `_dispatchPrim` dispatch
primitive. The gate [`bench/apps/chttp-fetch.ts`](../bench/apps/chttp-fetch.ts)
keeps that path at 100% static coverage as part of the standard gate suite.

## Bundler pipeline

`unplugin-scriptc` runs `scriptc build` inside Vite. `@chttp/unplugin` additionally lowers the route table at build time: [Route lowering plugin](unplugin.md).

## Docker

A `FROM scratch` image carrying a ~2.4 MB binary: [Deploy](deploy.md).

## Benchmarks

Ratios against raw `node:http`, cold start and RSS: [Benchmarks](benchmarks.md).
