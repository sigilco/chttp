# csr-react

Client-side rendered React SPA served by `@chttp/static`, with a `/api`
slice on the same router. Two ways to ship the assets:

- **Disk** (`src/main.ts`): `DiskAssets("./dist")` re-reads files when
  mtime or size changes — the dev loop.
- **Baked** (`src/main.baked.ts`): `pnpm bake` regenerates
  `src/assets.gen.ts`, an `EmbeddedAssets` subclass with every dist file
  as a base64 record. `pnpm build` then produces a single binary that
  needs no filesystem. See
  [Baking assets into the binary](https://github.com/sigilco/chttp/blob/main/docs/static.md#baking-assets-into-the-binary).

```sh
pnpm install
pnpm build:web    # vite build -> dist/
pnpm start        # node, serves dist/ on :3000

pnpm bake         # regenerate src/assets.gen.ts
pnpm build        # scriptc build src/main.baked.ts -o app
./app             # single binary, no dist/ needed
```

SPA fallback: `GET /dashboard` with `Accept: text/html` serves
`index.html`; asset misses stay 404; `/api/*` never hits the filesystem.
