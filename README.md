# chttp

[![ci](https://github.com/sigilco/chttp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sigilco/chttp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@chttp/router)](https://www.npmjs.com/package/@chttp/router) [![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE) [![scriptc static](https://img.shields.io/badge/scriptc%20static-100%25-brightgreen)](scripts/scriptc-gate.sh)

A minimal async-first HTTP router for `node:http`. Handlers and middleware
may be `async`; the router core ships no runtime dependencies.

The package is authored inside the **scriptc compilable subset**
([scriptc](https://github.com/vercel-labs/scriptc) — a TypeScript-subset to
native-ELF compiler): the same source lowers statically into a single
binary via `scriptc build --npm-static @chttp/router` with zero deferred sites
(100% static coverage).

## 🚀 Quick start

Install:

```bash
npm i @chttp/router
```

Import:

```ts
import { createRouter } from "@chttp/router";

const app = createRouter();

app.get("/", (c) => c.text("hi"));
app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
app.post("/echo", (c) => c.text(c.req.body()));
app.notFound((c) => c.status(404).text("not found"));

app.serve({ port: 3000 });
```

## ✔️ Routing

Static segments, `:param`, and a tail `*` wildcard:

```ts
app.get("/user/:id", (c) => c.req.param("id")); // 'id' is literal-typed
app.get("/wild/*", (c) => c.req.param("*"));
app.all("/any-method", handler);
app.on("m-search", "/custom", handler);
```

`GET` handlers also answer `HEAD`. A matched path with an unknown method
gets a `405` with an `Allow` header built from the route's method table.

## ✔️ Context

Handlers and middleware may be `async` — dispatch settles a `Promise`
return with the same error path as synchronous code. Request access stays
synchronous: dispatch pre-buffers the body for POST/PUT/PATCH/DELETE, so
handlers never await on `c.req`.

```ts
c.req.param("id"); // string | null, percent-decoded
c.req.query("q"); // string | null
c.req.queries("tag"); // string[], all values for a repeated key
c.req.queryAll(); // Record<string, string>
c.req.header("x-foo");
c.req.body(); // string
c.req.file("f"); // UploadedFile | null — { multipart } routes only
c.req.field("f"); // string | null — { multipart } routes only
c.req.method;
c.req.path;
c.req.raw;
```

## ✔️ Responses

All response helpers write at statement level and return `c` for chaining:

```ts
c.json({ ok: true });
c.text("plain");
c.html("<h1>hi</h1>");
c.status(201).json({ created: true });
c.header("x-trace", "abc");
c.redirect("/elsewhere", 302);
```

## ✔️ Middleware

`(c, next) => void | Promise<void>` — sync or async. Applies to routes
registered after it (snapshot semantics):

```ts
app.use((c, next) => {
  c.header("x-start", Date.now().toString());
  next();
});

// path-scoped: `*` matches every path, `/api/*` is a prefix
app.use("/api/*", async (c, next) => {
  await auth(c.req);
  await next();
});
```

Mount sub-routers with `app.route(prefix, subApp)`; parent and sub
middleware merge.

## ✔️ Web Standards surface

`app.fetch(req, env, ctx)` is the canonical entry — the same shape
Cloudflare Workers, Deno Deploy, Bun, Vercel Edge, and Lambda expect.
The existing `app.handler()` is a thin Node adapter around it. Both
compile to a native ELF via `scriptc build` (gate
`bench/apps/chttp-fetch.ts` stays at 100% static).

```ts
const app = createRouter();
app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));

// Cloudflare Workers / Deno Deploy / Bun / Service Worker
export default { async fetch(req, env, ctx) { return app.fetch(req, env, ctx); } };

// Anywhere with a `Request` in scope
const res = await app.fetch(new Request("http://localhost/user/42"));
```

Deployment recipes: [`examples/integrations/cloudflare-workers/`](examples/integrations/cloudflare-workers/),
[`examples/integrations/aws-lambda/`](examples/integrations/aws-lambda/).
Off-the-shelf middleware (Hono, etc.) wires in via the
[`hono-middleware`](examples/integrations/hono-middleware/) template.

The `Ctx` surface is Web-Standards-shaped: `c.req.{url,method,path,header,query,param,body,raw}`,
`c.set`/`c.get` for request-scoped vars, `c.header(name, value, {append: true})` for
multi-value headers. See [Context](#-context) above and
[architecture.md](docs/architecture.md#response-sink) for the sink split.

## ✔️ Error handling

```ts
app.onError((err, c) => {
  c.status(500).json({ message: err.message });
});
```

An error thrown anywhere in the chain — sync throw or rejected promise —
lands here. The built-in 500 path is the fallback when unset, when the
handler never responds, or when the handler itself throws or rejects. The `405` error carries `.allow` for custom bodies.

## ✔️ Compile to a native binary

Because chttp stays inside the scriptc subset, the same code compiles to a
native ELF:

```sh
scriptc build app.js --npm-static @chttp/router --optimization=speed -o app-bin
./app-bin 3000
```

Numbers (shared VM, compare ratios not absolutes; full matrix in
[bench/RESULTS-v2.md](bench/RESULTS-v2.md)):

| subject                | json               | pipelined (-c100 -p10) | cold start | RSS after 100k req |
| ---------------------- | ------------------ | ---------------------- | ---------- | ------------------ |
| chttp on node            | 0.87× raw-node     | 0.95×                  | 83 ms      | 116 MB             |
| **chttp compiled (ELF)** | **1.15× raw-node** | **1.76× (204k rps)**   | **3 ms**   | **4 MB**           |
| fastify on node        | 0.69×              | 0.65×                  | 111 ms     | 108 MB             |

The compiled build sits at ≥96% of a bare compiled `node:http` server on
every cell: the router costs ~0.1-0.3 MB of binary and ~1 MB RSS.

## ✔️ Bundler plugins

Two tiers, kept separate on purpose. chttp itself needs no plugin to go native: the core is authored in the scriptc compilable subset, so `scriptc build` lowers it directly like any subset library. The plugins below are elective additions:

- `@chttp/unplugin` (separate package, [`packages/unplugin`](https://github.com/sigilco/chttp/tree/main/packages/unplugin)), via `chttpPlugin`: build-time dispatch specialization. It recovers the route table from imperative `app.get()`/`use()`/`route()` registrations and emits a `CompiledRoutes` dispatch that skips the runtime trie walk. Works with plain vite/rollup (JS dist) and composes with `unplugin-scriptc` (ELF). Uncertain routes stay on runtime dispatch with a build warning. See [doc...
- `unplugin-scriptc`, via `scriptcPlugin`, which runs `scriptc coverage` diagnostics and `scriptc build` inside your bundler pipeline. See [unplugin-scriptc](https://github.com/sigilco/unplugin-scriptc).

```ts
// vite.config.ts
import { chttpPlugin } from "@chttp/unplugin";
import { scriptcPlugin } from "unplugin-scriptc";

export default defineConfig({
  plugins: [
    chttpPlugin.vite(),
    scriptcPlugin.vite({ entry: "src/main.ts", out: "dist/app" }),
  ],
});
```

## ✔️ Validation

`@chttp/val` (in `packages/val`) is a Standard Schema v1 library authored
inside the same subset — the only way to run schema validation inside a
compiled chttp ELF (npm validators can't compile alongside it — see
[docs/validation.md](docs/validation.md)). In Node mode it performs in the
same band as [valibot](https://github.com/open-circle/valibot).

```ts
import * as v from "@chttp/val";

const Order = v.strictObject({ id: v.pipe(v.string(), v.uuid()) });
app.post("/order", (c) => {
  const r = v.safeParse(Order, JSON.parse(c.req.body()));
  return r.success
    ? c.json({ ok: true })
    : c.status(400).json({ issues: r.issues });
});
```

## 📖 Docs

- [Architecture](ARCHITECTURE.md): why it compiles, the subset rules
- [Validation](docs/validation.md): Standard Schema in node vs ELF, `@chttp/val`
- [Route contract](contracts/route-contract.md): the generated-dispatch seam (internal)
- Full docs site: https://chttpjs.pages.dev/

## 🧩 Ecosystem

- [sigilco/cutils](https://github.com/sigilco/cutils): utility packages that work with chttp and the scriptc subset — `@cutils/sqlite` (embedded SQLite via a C FFI shim) and `@chttp/cache` (LRU/TTL in-memory cache)

## 🤖 Agent skills

Two repo-local skills for coding agents: [`.agents/skills/chttp-app-dev/SKILL.md`](.agents/skills/chttp-app-dev/SKILL.md) for authoring subset-compatible chttp apps, and [`.agents/skills/chttp-integration/SKILL.md`](.agents/skills/chttp-integration/SKILL.md) for wiring chttp and the unplugin pipeline into an existing project.

## ⚙️ Build & test

```sh
npm run build     # tsc → dist/esm and dist/cjs
npm test          # node --test test/
```

## License

Published under the [Apache-2.0](LICENSE) license.

## 💛 Support

chttp is maintained in spare time. If it saves you work, consider [sponsoring maintenance on Polar](https://buy.polar.sh/polar_cl_Mv1gdlG7bw3I70EC9IHtfeSHJj4PEKvA7JAUz23CFhj). One-time or monthly, pay-what-you-want.
