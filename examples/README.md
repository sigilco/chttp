# chttp examples

Standalone templates for common Hono/H3-style use cases. Each is a normal `npm i @chttp/router` project: the basic templates compile straight to a native ELF via `scriptc build` (chttp lowers directly like any scriptc-subset library, no bundler or plugin required); `vite-elf` shows the bundler pipeline with `unplugin-scriptc`, and `vite-lowering` the elect build-time route lowering with a plain JS dist.

| Template        | Shows                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `hello`         | Static, param, and wildcard GET routes                                                                          |
| `middleware`    | `app.use` global and per-route middleware                                                                       |
| `json-api`      | POST body (`{ body: true }`), `onError`, `notFound`                                                             |
| `env`           | Boot-time env validation with `@chttp/val` (coerce `PORT`, feature flags, fail with `summarize()`)              |
| `router-mount`  | `app.route` sub-router mounting                                                                                 |
| `ws-echo`       | `@chttp/ws` echo and `:param` room, vendored into one source graph for `scriptc build`                          |
| `vite-elf`      | Vite + `unplugin-scriptc` bundler pipeline                                                                      |
| `vite-lowering` | Vite + `@chttp/unplugin` build-time route lowering, JS dist                                                     |
| `elf-roundtrip` | Native ELF server (`scriptc build`) + typed client (`@chttp/unplugin` `client: true`) sharing one routes module |
| `rate-limit`    | Per-client fixed window limiter middleware: 429 + `Retry-After`, bounded memory                                 |
| `backpressure`  | In-flight cap (503 + `Retry-After`) and body size cap (413) as global middleware                                |
| `deploy-docker` | Multi-stage Dockerfile: scriptc build in alpine, `FROM scratch` runtime (~1.2 MB image)                         |

```sh
cd examples/hello
npm install          # installs @chttp/router + scriptc (once @chttp/router 0.1.0 is published)
npm run build        # scriptc build src/main.ts -o app
./app                # ELF listening on :3000
```

For build-time route lowering (compiled dispatch) with a plain JS dist, see `examples/vite-lowering`: `@chttp/unplugin` + a `.chttp.ts` routes module, no scriptc involved. It is elective dispatch specialization on top of a core that already compiles natively; under scriptc that path needs chttp as program code (vendored `chttp/src` or workspace source). See `docs/unplugin.md` → "Two output modes" for the two tiers.

## Integration recipes

Recipes live under `examples/integrations/` and are workspace members (`workspace:*` pins), so `pnpm test` runs their tests.

| Recipe                            | Shows                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integrations/logging-file-audit` | Request and audit events to a file: subset-native `appendFileSync` sink for ELF, LogTape plus `@logtape/file` on node                                              |
| `integrations/prometheus-metrics` | Request counter and latency histogram on `/metrics`: hand rolled exposition module for ELF, `prom-client` on node                                                  |
| `integrations/otlp-traces`        | Server spans exported to an OTLP/HTTP JSON collector via `node:http`, with `traceparent` propagation, same source for ELF and node                                 |
| `integrations/webhook-server`     | Config driven webhooks: val validated config, HMAC verification, trigger rules, `execFileSync` argv and env, ELF and node                                          |
| `integrations/csr-react`          | React SPA built by Vite served with `@chttp/static` (`spa: true`) plus an `/api` slice; `bake` script emits an `EmbeddedAssets` subclass for a single-binary build |
