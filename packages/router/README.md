# chttp

Minimal async-first HTTP router for `node:http`, zero dependencies, authored inside the [scriptc](https://github.com/vercel-labs/scriptc) compilable subset. The same source lowers to a native ELF directly, no plugin required.

```ts
import { createRouter } from "@chttp/router";

const app = createRouter();

app.get("/", (c) => c.text("hi"));
app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
app.post("/echo", (c) => c.text(c.req.body()));

app.get("/slow", async (c) => {
  const user = await fetchUser(c.req.param("id"));
  return c.json(user);
});

app.notFound((c) => c.status(404).text("not found"));

app.serve({ port: 3000 });
```

## Install

```sh
npm i @chttp/router
```

## Compile to native

The package has zero runtime dependencies and compiles fully statically under scriptc v0.3.0 automatic package compilation, no plugin required:

```sh
scriptc build src/main.ts -o app
./app
```

That is the whole native story: chttp lowers directly like any subset library. On top of it, [`@chttp/unplugin`](https://github.com/sigilco/chttp/tree/main/packages/unplugin) is an elective build-time dispatch specialization: it recovers the route table from imperative registrations and emits a `CompiledRoutes` dispatch that skips the runtime trie (works with plain vite/rollup; composes with [`unplugin-scriptc`](https://github.com/sigilco/unplugin-scriptc) for the ELF pipeline, where chttp must be program code). See the [unplugin docs](https://github.com/sigilco/chttp/blob/main/docs/unplugin.md).

## Typed client

`@chttp/router/client` ships a typed HTTP client that compiles into the same ELF (HTTP/1.1 over `node:net`/`node:tls`, no `fetch`):

```ts
import { createClient } from "@chttp/router/client";

const client = createClient("http://localhost:3000");
const user = await client.get<{ id: string }>("/users/:id", { params: { id: "42" } });
```

Path params are checked by `ParamKey` inference on Node.js; inside compiled apps bind a `ClientCore` receiver. See [the client docs](https://github.com/sigilco/chttp/blob/main/docs/client.md).

## Docs

- Full documentation: <https://chttpjs.pages.dev/>
- Benchmarks: `bench/RESULTS-v2.md` in the repo
- Examples: `examples/` in the repo

## License

Apache-2.0
