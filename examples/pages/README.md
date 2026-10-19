# pages — SSG + ISR slice of issue #14

Server-side component rendering on `@chttp/router` with `@chttp/html`. Components
are plain `(props) => string` functions; `page(head, body)` wraps them in a full
document.

- `GET /` — index rendered once at startup and served as a baked string (SSG).
- `GET /post/:slug` — one `IsrPage` per post: cached markup re-rendered on the
  first read after the revalidate window (ISR, blocking semantics).
- `GET /post/nope` — 404 document.

```sh
pnpm start:node   # node --experimental-strip-types
pnpm build && pnpm start   # native ELF via scriptc
pnpm test
```
