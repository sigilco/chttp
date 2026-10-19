# Examples

Standalone templates in [`examples/`](https://github.com/sigilco/chttp/tree/main/examples). Each is a normal project: copy the folder, install, build.

| Template                                                                                  | Shows                                                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`hello`](https://github.com/sigilco/chttp/tree/main/examples/hello)                      | Static, param and wildcard GET routes                                                   |
| [`middleware`](https://github.com/sigilco/chttp/tree/main/examples/middleware)            | `app.use` global and per-route middleware                                               |
| [`json-api`](https://github.com/sigilco/chttp/tree/main/examples/json-api)                | POST body, `onError`, `notFound`                                                        |
| [`router-mount`](https://github.com/sigilco/chttp/tree/main/examples/router-mount)        | `app.route` sub-router mounting                                                         |
| [`sse-clock`](https://github.com/sigilco/chttp/tree/main/examples/sse-clock)              | Server-sent events, see [Streaming](streaming.md)                                       |
| [`ws-echo`](https://github.com/sigilco/chttp/tree/main/examples/ws-echo)                  | `@chttp/ws` echo and room, see [WebSocket](websocket.md)                                |
| [`vite-elf`](https://github.com/sigilco/chttp/tree/main/examples/vite-elf)                | Vite with `unplugin-scriptc`                                                            |
| [`vite-lowering`](https://github.com/sigilco/chttp/tree/main/examples/vite-lowering)      | Build-time route lowering, see [Route lowering plugin](unplugin.md)                     |
| [`deploy-docker`](https://github.com/sigilco/chttp/tree/main/examples/deploy-docker)      | Scratch image, see [Deploy](deploy.md)                                                  |
| [`csr-react`](https://github.com/sigilco/chttp/tree/main/examples/integrations/csr-react) | React SPA on `@chttp/static`, baked-assets single binary, see [Static files](static.md) |

```sh
cd examples/hello
pnpm install
pnpm build   # scriptc build src/main.ts -o app
./app        # ELF listening on :3000
```

Full index: [examples/README.md](https://github.com/sigilco/chttp/blob/main/examples/README.md).
