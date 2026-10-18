# Typed client

`@chttp/router/client` ships a typed HTTP client for chttp apps. The same source compiles into your ELF — transport is HTTP/1.1 over `node:net` / `node:tls`, so it runs on Node.js and native with no `fetch` dependency.

```ts
import { createClient } from "@chttp/router/client";

interface Api {} // your app's surface, for future manifest typing

const client = createClient<Api>("http://localhost:3000");

const user = await client.get<{ id: string }>("/users/:id", {
  params: { id: "42" },
});
```

## Calls

`get` / `post` / `put` / `patch` / `delete` take a path and an optional input:

```ts
interface ClientInput<P> {
  params?: Record<ParamKey<P>, string>; // '/users/:id' -> { id: string }
  query?: Record<string, string>;
  body?: unknown; // string -> text/plain, else JSON.stringify
  headers?: Record<string, string>;
}
```

- `:param` segments and `*` wildcards are substituted from `params` (URI-encoded). Missing params throw before the wire.
- `query` pairs are appended URI-encoded.
- Return type is caller-declared: `client.get<User>(...)`. JSON responses (by `content-type`) are parsed; everything else resolves to the body string.
- `client.request(method, path, input)` returns `{ status, headers, body }` for full control.

`createClient(baseUrl, opts?)` accepts `{ timeoutMs?, headers? }`; base URLs may include a port and path prefix. `https:` URLs use `node:tls` with certificate verification on.

v1 scope: one request per connection (`Connection: close`), no redirects, no streaming bodies. `Transfer-Encoding: chunked` responses are decoded.

## Compiling to ELF

The typed signatures are a `.d.ts` surface — scriptc dispatches generic methods only through the concrete class. In app code that compiles to native, bind the receiver as `ClientCore`:

```ts
import { createClient } from "@chttp/router/client";
import type { ClientCore } from "@chttp/router/client";

const client: ClientCore = createClient("http://127.0.0.1:3000");
const user = await client.get<{ id: string }>("/users/:id", { params: { id: "42" } });
```

`params` then types as `Record<string, string>` — path keys aren't checked inside the compiled subset. The non-generic `request` works through either receiver.

Coverage is gated by `bench/apps/chttp-client.ts` (100% static) and the loopback ELF smoke in `packages/router/test/elf.test.sh`.
