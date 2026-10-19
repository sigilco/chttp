# Multipart

`multipart/form-data` uploads are opt-in per route — the same seam as `{ body: true }`. Declare `multipart` in the route options and dispatch parses the stream before the handler chain runs, so `c.req` stays synchronous.

```ts
import { CtxCore, createRouter, diskStorage, memoryStorage } from "@chttp/router";

const app = createRouter();

app.post(
  "/api/entries/:entryId/media",
  (c: CtxCore) => {
    const file = c.req.file("file"); // UploadedFile | null
    const title = c.req.field("title"); // string | null
    db.run([file!.path, file!.mimeType, file!.size, title]);
    return c.json({ ok: true });
  },
  { multipart: { storage: diskStorage(MEDIA_DIR) } },
);
```

## Reading uploads

`file`/`field` are last-wins; `files`/`fields` return every part under the name.

```ts
c.req.file("avatar"); // UploadedFile | null
c.req.files("f[]"); // UploadedFile[]
c.req.field("title"); // string | null
c.req.fields("tag"); // string[]
```

`UploadedFile`:

```ts
{
  field: string; // form field name
  filename: string; // basename-sanitized
  mimeType: string;
  size: number; // bytes written
  bytes: Uint8Array | null; // memoryStorage
  path: string | null; // diskStorage (temp file the caller owns)
}
```

## Storage

```ts
memoryStorage(); // default — buffers into UploadedFile.bytes
diskStorage(dir); // streams to dir/chttp-<ts>-<rand>-<n>, returns path
```

`diskStorage` creates `dir` recursively and never overwrites — temp names carry a timestamp, random hex, and a counter. On any parse failure the partial temp file is closed and unlinked. The finished file is the caller's responsibility (move it, keep it, or delete it).

## Limits

Enforced during the streaming parse — a breach answers `413` mid-upload, destroys the socket, and unlinks the partial temp file. No file is held twice, no body is re-buffered.

```ts
app.post("/up", handler, {
  multipart: {
    maxFileBytes: 100 * 1024 * 1024, // per file, default unlimited
    maxFiles: 16, // parts with a filename, default unlimited
    maxFieldBytes: 64 * 1024, // per text field, default unlimited
  },
});
```

Non-`multipart/form-data` content, a missing boundary, or a truncated body answers `400` before the handler runs. `body` and `multipart` in the same route options throw at registration — multipart owns the body.

Routes without the declaration are untouched: the stream is not consumed. The [unplugin](unplugin.md) declines declared-multipart routes at build time with a warning — they stay on internal dispatch, which is what parses them.
