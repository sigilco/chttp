# Deploy

Pick one of three ways to ship a chttp app.

| Option                  | Ships                       | Image or artifact | Cold start |
| ----------------------- | --------------------------- | ----------------- | ---------- |
| Docker (`FROM scratch`) | one static binary           | ~2.4 MB           | unverified |
| Binary only             | one static binary           | ~2.4–2.6 MB       | unverified |
| Node                    | your JS plus `node_modules` | node runtime      | 83 ms      |

Binary sizes measured on macOS arm64 with router 0.3.0 and scriptc 0.3.4: the `examples/hello` app builds to 2,558,232 B, or 2,407,680 B with `--strip` (RSS ~3 MB). The `chttp-scriptc` bench cell ([`bench/RESULTS-v2.md`](../bench/RESULTS-v2.md)) measured a 3 ms median cold start for its own app, but per-app cold start was not re-measured for this release — treat it as unverified until the cell is re-run.

## Docker

Copy [`examples/deploy-docker/Dockerfile`](https://github.com/sigilco/chttp/blob/main/examples/deploy-docker/Dockerfile) next to your app. It builds the binary in an alpine stage and copies it into `scratch`.

```sh
docker build -t my-app .
docker run --rm -p 8080:8080 my-app
```

The image has no shell, so debug with a different base if you need one.

## Binary only

Build, copy the file, run it. No runtime needed on the host.

```sh
scriptc build src/main.ts -o app --strip
./app
```

scriptc cannot cross-compile (no `--target`), so build on the OS and architecture you deploy to. For a linux server, build in CI on linux or inside an alpine container. An alpine build is fully static (musl), so it runs on any linux of the same architecture.

## Node

No build step. Deploy the JS like any node service:

```sh
node app.js
```

Use this when you need npm packages outside the scriptc subset. See [Run targets](targets.md).

## Web Standards adapter

The canonical entry is `app.fetch(req: Request) → Promise<Response>`. The same `createRouter()` symbol works on Cloudflare Workers, Deno Deploy, Bun, Vercel Edge, Netlify Edge, Supabase, and as a Service Worker. `app.handler()` is a thin Node adapter around `fetch()` for `node:http` users.

```ts
import { createRouter } from "@chttp/router";

const app = createRouter();
app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));

// Cloudflare Workers / Deno Deploy / Bun / Vercel Edge / Service Worker
export default {
  async fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> {
    return app.fetch(req, env, ctx);
  },
};
```

The Node `app.handler()` surface compiles to a native ELF via `scriptc build`. `app.fetch` itself is JS-runtime-only today — `new Request` is not constructible inside the binary under scriptc 0.3.x — but the fetch dispatch path is ELF-verified through the [`app.fetchShim`](targets.md#native-elf) host-shim entry (the `chttp-fetch` gate stays at 100% static coverage). Recipes for the two most common targets:

- [`examples/integrations/cloudflare-workers/`](../examples/integrations/cloudflare-workers/) — `wrangler dev` / `wrangler deploy`, `app.fetch` as the Workerd fetch handler. Needs `nodejs_compat` + `enable_nodejs_fs_module` compat flags (the router statically imports `node:http` and `node:fs`); verified by a real-workerd smoke in the recipe's test suite.
- [`examples/integrations/aws-lambda/`](../examples/integrations/aws-lambda/) — APIGW v2 / Lambda URL bridge (`provided.al2023` ELF or Node runtime).
