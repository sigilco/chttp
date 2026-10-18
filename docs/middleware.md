# Middleware

Middleware is `(c, next) => void | Promise<void>` — sync or async. `next()` returns the tail's result, so `await next()` in an async middleware waits for the rest of the chain to settle.

```ts
app.use((c, next) => {
  c.header("x-start", Date.now().toString());
  next();
});
```

Middleware applies to routes registered **after** it (snapshot semantics): `use()` copies the current middleware stack onto every subsequently registered handler, so registration order is the middleware order. This matters for every recipe below: register the middleware first, routes after.

One flush rule all recipes rely on: the response helpers (`c.json`, `c.text`, `c.html`, `c.redirect`) call `res.end()` synchronously. Once the handler calls one, the response is gone; headers set *after* `next()` returns will not land on it. Set headers *before* `next()`, or log instead of decorating when you need post-handler information (see [request logging](#request-logging) and [timing](#timing-header)).

## Body

`c.req.body()` is synchronous because dispatch pre-buffers the request body (`data`/`end` concat) for POST/PUT/PATCH/DELETE before invoking the chain — on routes that declared `{ body: true }`. Other methods dispatch immediately.

## Recipe cookbook

Every snippet below is written in the scriptc subset (indexed `for` loops, `| null` unions, no shorthand or spread or optional chaining, plain records instead of `Map`) and was verified to build and run as an ELF with `scriptc build` (chttp 0.1.0). Node-only recipes are marked.

### CORS

Two pieces, because of how dispatch orders things: an `OPTIONS` request to a path that only has `GET`/`POST` registered fails with 405 *before any middleware runs*, so a middleware alone cannot answer preflight. The working shape is a `use()` middleware for the response headers plus one explicit `app.options()` route per path (or `app.all()` with an in-handler method check) that answers the preflight with 204.

```ts
import type { Ctx } from "@chttp/router";

// 1. Response headers on every actual request (apply to routes after this use()).
app.use((c: Ctx, next: () => unknown): unknown => {
  c.header("access-control-allow-origin", "*");
  return next();
});

// 2. Explicit preflight answer: 204, no body.
function preflight(c: Ctx): void {
  c.status(204)
    .header("access-control-allow-origin", "*")
    .header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS")
    .header("access-control-allow-headers", "content-type,authorization")
    .header("access-control-max-age", "86400");
  const rs = c.res.nodeRes(); // raw ServerResponse (Node surface only)
  if (rs !== null) {
    rs.end();
  }
  c.sent = true; // tells dispatch this middleware answered
}

app.options("/users", (c: Ctx) => {
  preflight(c);
});
app.get("/users", (c: Ctx) => c.json({ users: 1 }));
app.post("/users", (c: Ctx) => c.json({ ok: true }), { body: true });
```

With credentials instead of `*`: echo the request's `origin` header and add `access-control-allow-credentials: true`. For many paths, a shared `app.all("/*", ...)` fallback also answers preflight (a splat route matches paths with no other registration), but paths that have any method registered need their own `app.options()` entry or the 405 wins.

### ETag / If-None-Match (304)

Strong etag from a simple hash of the exact body string. The hash below is FNV-1a 32-bit implemented inline: no `node:crypto` dependency, deterministic across processes, and honest about collision odds (32 bits, fine for cache revalidation of modest APIs; use `node:crypto` `createHash` if you want more, it does lower and run under scriptc). Note the etag must be computed over the same bytes you send, so the handler serializes once and writes the response itself instead of `c.json`.

```ts
function fnv1a(s: string): string {
  let h: number = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = h ^ s.charCodeAt(i);
    h = (h * 16777619) >>> 0; // keep it unsigned 32-bit
  }
  return h.toString(16);
}

app.get("/users", (c: Ctx) => {
  const body: string = JSON.stringify({ users: [1, 2] });
  const etag: string = '"' + fnv1a(body) + '"';
  const inm: string | null = c.req.header("if-none-match");
  if (inm !== null && inm === etag) {
    c.status(304);
    const rs = c.res.nodeRes(); // raw ServerResponse (Node surface only)
    if (rs !== null) {
      rs.end();
    }
    c.sent = true;
    return;
  }
  c.header("etag", etag);
  const rs = c.res.nodeRes();
  if (rs !== null) {
    rs.setHeader("content-type", "application/json; charset=utf-8");
    rs.end(body);
  }
  c.sent = true;
});
```

The comparison is exact equality against a single etag. Browsers may send a comma-separated list or a `W/` weak prefix; if you need those, split `inm` on `,` and trim before comparing.

### Request logging

Async middleware: `await next()` waits until the chain settles, so `Date.now()` after it includes the handler's async work. Duration goes to stdout, not a response header, because the response may already be flushed (the flush rule above).

```ts
app.use(async (c: Ctx, next: () => unknown): Promise<void> => {
  const t0: number = Date.now();
  await next();
  console.log(c.req.method + " " + c.req.path + " " + String(Date.now() - t0) + "ms");
});
```

Register it before the routes you want logged; routes registered earlier carry no middleware (snapshot semantics).

### Security headers

Sync middleware that sets headers before `next()`; they land on every response from routes registered after it.

```ts
app.use((c: Ctx, next: () => unknown): unknown => {
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("content-security-policy", "default-src 'none'");
  return next();
});
```

For a `strict-transport-security` header that only applies over TLS, put it behind your TLS terminator or set it conditionally on your platform's TLS flag; the ELF itself serves plain HTTP.

### Rate limiting (in-memory fixed window)

Plain record of buckets keyed by API key or client IP, fixed window: no `Map`, no cleanup job, counters reset when the window expires. Single-instance only: state lives in the process, so multiple replicas each get their own full budget. For shared state you need a store the subset can call.

```ts
interface Bucket {
  count: number;
  reset: number;
}

const LIMIT: number = 100;      // requests per window
const WINDOW_MS: number = 60000; // window length

const buckets: { [k: string]: Bucket } = {};

function rateLimit(c: Ctx, next: () => unknown): unknown {
  const key: string = c.req.header("x-api-key") === null ? "anon" : String(c.req.header("x-api-key"));
  const now: number = Date.now();
  const cur: Bucket | null = buckets[key] === undefined ? null : buckets[key];
  if (cur === null || now >= cur.reset) {
    buckets[key] = { count: 1, reset: now + WINDOW_MS };
  } else {
    cur.count = cur.count + 1;
  }
  const b: Bucket = buckets[key];
  c.header("x-ratelimit-limit", String(LIMIT));
  c.header("x-ratelimit-remaining", String(LIMIT - b.count < 0 ? 0 : LIMIT - b.count));
  if (b.count > LIMIT) {
    c.header("retry-after", String(Math.ceil((b.reset - now) / 1000)));
    return c.status(429).json({ error: "rate_limited" });
  }
  return next();
}

app.use(rateLimit);
```

Fixed windows burst at the seam (up to 2×LIMIT across a boundary). Sliding windows need sorted timestamps per key, which the subset can do with number arrays if you need it.

### Serve static

Do not hand-roll a static handler: reading files as utf8 corrupts binaries, and the traversal, caching and `index.html` details are easy to get wrong. Use [`@chttp/static`](static.md), which serves bytes through `c.bytes()`, handles ETag/304, HEAD, precompressed siblings and an opt-in SPA fallback, and compiles into the ELF.

If you do need a hand-rolled variant (single small asset set, no package), know the traversal pitfall before you start: `c.req.param("*")` is the *decoded* path tail, so `%2e%2e` arrives as `..` before your code sees it, so guard on the decoded value, reject any tail containing `..` or a leading `/`, and write the response manually through `c.res.nodeRes()` (the raw `ServerResponse`, null on the `app.fetch` surface) with `rs.setHeader` + `rs.end()`, because `c.text()` forces its own `content-type`.

### Timing header

A true `server-timing: app;dur=N` header needs the duration *before* the body is written, but sync handlers flush the response inside `next()` (the flush rule), so the duration is only knowable after it is too late to send it. What works, verified: stamp a start time before `next()` (the header lands on every response), and log the duration after `await next()` in an async middleware.

```ts
// start stamp: header lands (set before the handler can flush)
app.use((c: Ctx, next: () => unknown): unknown => {
  c.header("x-request-start", String(Date.now()));
  return next();
});

// duration: log it, the response is already flushed by the time you know it
app.use(async (c: Ctx, next: () => unknown): Promise<void> => {
  const t0: number = Date.now();
  await next();
  console.log(c.req.path + " " + String(Date.now() - t0) + "ms");
});
```

Clients that understand `x-request-start` (or a tracing proxy reading it) can compute end-to-end duration from the timestamp. If you control the handlers, the alternative is sending the header from the handler itself, where the duration is known before the send.
