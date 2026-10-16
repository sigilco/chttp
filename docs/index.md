# What is chttp

chttp is a minimal async-first HTTP router for `node:http`, authored inside the [scriptc](https://github.com/vercel-labs/scriptc) compilable subset so the same source also compiles to a single native ELF.

```ts
import { createRouter } from "@chttp/router";

const app = createRouter();
app.get("/user/:id", async (c) => c.json(await fetchUser(c.req.param("id"))));
app.serve({ port: 3000 });
```

## Why it exists

- Small: zero runtime dependencies, one core file.
- Async-first: handlers and middleware may return a `Promise`. Sync handlers still finish without scheduling a microtask.
- Two targets, one source: run on node, or compile to a ~1 MB native binary with a 3 ms cold start.

## Mental model

- An `App` holds a route trie. Routes are registered per method and path.
- A request is matched, then runs a chain: middleware, then one handler.
- Handlers write through `c` (`c.json`, `c.text`, `c.html`, `c.redirect`), which sets status, headers and ends the response.
- Any throw or rejection in the chain lands in `app.onError`.
- Request access is synchronous: the body is pre-buffered, so `c.req.body()` never awaits.

## Node or native

|                    | node      | native ELF          |
| ------------------ | --------- | ------------------- |
| Build step         | none      | `scriptc build`     |
| Cold start         | 83 ms     | 3 ms                |
| RSS after 100k req | 116 MB    | 4 MB                |
| npm ecosystem      | all of it | scriptc subset only |

Pick node for the ecosystem, native for small images and fast starts. Numbers and method: [Benchmarks](benchmarks.md).

Utility packages for chttp apps — including when compiled to a native ELF — live in [sigilco/cutils](https://github.com/sigilco/cutils): `@cutils/sqlite` (embedded SQLite over a C FFI shim) and `@chttp/cache` (LRU/TTL in-memory cache). `@chttp/mcp` (JSON-RPC 2.0 MCP server) and `@chttp/auth` (session/JWT/OAuth/CSRF/TOTP primitives) live in this repo — see [MCP server](mcp.md) and [Auth primitives](auth.md).

Next: [Quickstart](quickstart.md).
