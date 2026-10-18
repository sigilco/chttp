# cloudflare-workers

chttp on Cloudflare Workers via the `app.fetch` Web Standards surface.

## Why this is small

The same `createRouter()` you use on `node:http` works on Workerd unchanged. The router exposes `app.fetch(req: Request, env?, ctx?) → Promise<Response>` — the same shape Cloudflare's default `fetch` handler expects and the same shape Hono's `app.fetch` uses. The Worker entry is therefore a 5-line wrapper:

```ts
import { createApp } from "./app.ts";
const app = createApp();
export default { async fetch(req, env, ctx) { return app.fetch(req, env, ctx); } };
```

## Configuration

`wrangler.toml` pins `compatibility_date = "2025-09-01"` and enables `nodejs_compat` plus `enable_nodejs_fs_module`. `nodejs_compat` is required because `@chttp/router` imports `node:http` types in its `app.handler` and the generated dispatch shim; without the flag, those types resolve to Workerd's bundled ambient types and the surface slips. `enable_nodejs_fs_module` is required because `multipart.ts` imports `node:fs` statically for `DiskStorage` and `nodejs_compat` alone does not provide it — on Workerd the flag mounts an in-memory filesystem (ephemeral per isolate), so `DiskStorage` resolves and works.

For the fetch path specifically (what this example uses), neither flag changes `app.fetch`'s behavior — it only consumes the host-provided `Request` and returns a `Response` — but the flags keep the whole `@chttp/router` import graph resolvable inside Workerd.

## Local development

```sh
pnpm --filter @chttp/router build   # once
pnpm --filter chttp-example-cloudflare-workers test   # in-process smoke
pnpm --filter chttp-example-cloudflare-workers dev    # wrangler dev
```

Two tests gate this recipe in CI:

- `test/smoke.test.ts` — in-process spec smoke: fires a real `Request` through `app.fetch` and asserts the response. No network, no Wrangler, no Workers credentials.
- `test/workerd.test.mjs` — **real-workerd smoke**: bundles `src/main.ts` with esbuild, boots the actual `workerd` binary on a socket, and asserts every route over HTTP. This is the honest check that the app runs inside the WinterCG runtime (not just under Node with `Request` polyfilled) — `new Request` is not constructible under scriptc 0.3.x anyway, so the transport only ever sees a host-supplied `Request`.

The `wrangler dev` command boots a local Workerd on `http://localhost:8787` and serves the same routes. Once it's up, exercise it with curl:

```sh
curl http://localhost:8787/
curl http://localhost:8787/user/42
curl -X POST -d 'ping' http://localhost:8787/echo
```

## Deployment

```sh
pnpm --filter chttp-example-cloudflare-workers deploy
```

Wrangler reads `wrangler.toml`, builds the bundle, and pushes it. The `nodejs_compat` flag is in the bundle manifest so the deployed worker has the same Node type surface the local build was tested against.

## What this recipe does NOT do

- **No Cloudflare-specific bindings (KV, D1, R2, Durable Objects).** These are accessed through `env`; add a typed `Env` interface and a binding-aware handler. A future recipe (`cloudflare-workers-kv/`) will show the pattern.
- **No `nodejs_compat_v2` opt-in.** compat date 2025-09-01 already ships the polyfilled APIs chttp's router needs.
- **No WebAssembly ELF build.** Cloudflare's edge runtime is the Workerd JS engine, not a scriptc native target. A WASM-backed Worker would require the scriptc WASI target, which is blocked on upstream (follow-up D in the PR).
