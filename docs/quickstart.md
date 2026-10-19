# Quickstart

```sh
pnpm add @chttp/router
```

```ts
import { CtxCore, createRouter } from "@chttp/router";

const app = createRouter();

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Sync handler: returns immediately, no microtask cost.
app.get("/", (c: CtxCore) => c.text("hi"));
app.get("/user/:id", (c: CtxCore) => c.json({ id: c.req.param("id") }));

// Async handler: await anything, the router waits for it to settle.
app.get("/slow", async (c: CtxCore) => {
  await sleep(100);
  c.text("done");
});

// Declare { body: true } or c.req.body() returns "".
app.post("/echo", (c: CtxCore) => c.text(c.req.body()), { body: true });
app.notFound((c: CtxCore) => c.status(404).text("not found"));

app.serve({ port: 3000 });
```

Sync and async handlers mix freely on one router. Write the response on `c` in either style, you do not need to return it.

```sh
node app.js
curl localhost:3000/user/42
curl localhost:3000/slow
curl -d hello localhost:3000/echo
```

## Where to go next

- Run it as a native binary or in Docker: [Run targets](targets.md), [Deploy](deploy.md).
- Add routes, params and sub-routers: [Routing](routing.md).
- Read request data and write responses: [Context](context.md).
- Cross-cutting behavior: [Middleware](middleware.md).
- Copyable projects: [Examples](examples.md).
