# Static files

`@chttp/static` serves files and single page apps from a directory or from bytes baked into the binary. It depends on `@chttp/router` only and is authored in the scriptc subset, so it compiles into the same native ELF as the rest of your app.

```ts
import { CtxCore, createRouter } from "@chttp/router";
import { DiskAssets, serveStatic } from "@chttp/static";

const app = createRouter();
app.get("/api/ping", (c: CtxCore) => c.json({ ok: true }));
serveStatic(app, "/", new DiskAssets("./web/dist"), { spa: true });
app.serve({ port: 3000 });
```

## Sources

`AssetSource` is the port: one method, `get(path): Asset | null`, where `path` is decoded, relative to the root and has no leading slash. Strategies are subclasses.

| Source | Reads from | Notes |
| --- | --- | --- |
| `DiskAssets(root)` | the filesystem, as `Buffer`s | stats on every request, re-reads only when mtime or size changed, SHA-1 ETag computed on first request of a path |
| `EmbeddedAssets` | bytes held in the program | `add(path, asset)` or `load(records)` with a baked array of `EmbedRecord` |

An `Asset` is a plain record: `body` (Buffer), `type`, `etag`, `size`, `mtimeMs`, `immutable` and `encodings` (precompressed variants, each with its own `enc`, `body` and `etag`).

Baked data must be an array of records, not a path-keyed object: the subset cannot index a string-keyed JSON object. The planned `assets` slice of `@chttp/unplugin` will emit a subclass of `EmbeddedAssets` whose constructor calls `load()` with such an array (`path`, `type`, `b64`, `etag`, `mtimeMs`, `immutable`, `encs`).

## serveStatic

`serveStatic(app, prefix, src, opts?)` registers a GET splat route (HEAD comes from the router's GET fallback). `"/"` serves from the root, `"/assets"` serves `/assets/*`.

| Behaviour | Detail |
| --- | --- |
| Traversal | The splat is already percent-decoded, so `%2e%2e` and `..%2f` arrive as `..` segments and answer 403. Backslash, NUL, drive-letter tails (`C:/...`) and absolute tails are refused too |
| Dotfiles | Any segment starting with `.` answers 404, except `.well-known` |
| Symlinks | Paths are resolved with `realpath` before serving. A link that stays inside the root keeps working; one that escapes it answers 404 |
| Directories | `/docs/` and `/docs` serve `docs/index.html` |
| MIME | Built-in table by extension, `application/octet-stream` otherwise |
| Validators | Quoted ETag on every response, `Last-Modified` when the mtime is known. `If-None-Match` (including `W/` and `*`) answers 304 with no body |
| Cache-Control | `public, max-age=31536000, immutable` for hashed filenames, `no-cache` for HTML, `opts.cacheControl` (default `no-cache`) for the rest |
| Compression | If `app.js.br` or `app.js.gz` sit next to `app.js` (or are in `encodings`), the client's `accept-encoding` picks `br` over `gzip`; `Vary: accept-encoding` is always set for such assets. Codings match exactly and case-insensitively, never by substring. `q=0` (or `q=0.0`, `q=0.000`) excludes a coding; other q-values are not ranked, so the fixed br-over-gzip preference decides |
| SPA fallback | With `spa: true`: GET or HEAD, `accept` contains `text/html`, and the path has no extension serves the index file. Missing assets with an extension stay 404 |
| API prefixes | Paths under `opts.api` (default `["/api"]`) never reach the filesystem or the fallback, and an unmatched one answers `{"error":"not_found"}` with status 404 |

Hashed filenames are detected by name: the last `-` or `.` separated token of the stem is 8 to 32 alphanumerics mixing letters and digits (`index-Ab3dE9fG.js`, `chunk.3f9a1c2e.css`). Date-like tokens such as `report-20241014.pdf` are not hashed.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `spa` | `false` | enable the SPA fallback |
| `api` | `["/api"]` | prefixes owned by the API |
| `index` | `"index.html"` | directory index and SPA shell |
| `cacheControl` | `"no-cache"` | for non-hashed, non-HTML assets |

## Compiling to an ELF

The package is covered at 100% by `scriptc coverage packages/static/gate.ts`, and `scriptc build` produces a binary that serves images byte for byte (sha256 verified through curl). Two subset notes from authoring it: reading a missing key from a string-keyed record throws in a native binary, so presence is tested with `in` and keys are prefixed to avoid prototype names; and `httpDate()` is hand-rolled from the `getUTC*` getters until `toUTCString` lowers.

Not included: range requests, `If-Modified-Since`, ISR caching.
