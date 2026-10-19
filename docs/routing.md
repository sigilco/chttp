# Routing

Routes are registered per method: `app.get | post | put | delete | patch | head | options(path, h)`, plus `app.all(path, h)` for any method and `app.on(method, path, h)` for custom ones.

Paths support static segments, `:param`, and a tail `*` wildcard.

```ts
import { CtxCore } from "@chttp/router";

app.get("/user/:id", (c: CtxCore) => c.req.param("id")); // literal-typed: 'id'
app.get("/wild/*", (c: CtxCore) => c.req.param("*"));
```

## Semantics

- Params are percent-decoded and typed from the path literal (`ParamKey<P>`). Param-less paths degrade `param()` to `string | null`.
- `HEAD` requests fall back to the `GET` handler; node suppresses the body.
- Matched path, unknown method: `405` with an `Allow` header built from the route's method table.
- Unmatched path: `404` (customizable via `app.notFound`).
- Duplicate exact `method`+`path`: first registered wins. Match is strict: no trailing-slash normalization.

## Sub-routers

```ts
const api = createRouter();
api.get("/users", handler);

app.route("/api", api);
```

Parent and sub middleware merge.

Next: [Context](context.md).
