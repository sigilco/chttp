# Context

Handlers and middleware receive `c`. Request access is synchronous: the body is pre-buffered, so `c.req` never awaits.

## Request

```ts
c.req.param("id"); // string | null, percent-decoded
c.req.query("q"); // string | null
c.req.queries("tag"); // string[], all values for a repeated key
c.req.queryAll(); // Record<string, string>
c.req.header("x-foo");
c.req.body(); // string
c.req.file("f"); // UploadedFile | null — multipart routes only
c.req.field("f"); // string | null — multipart routes only
c.req.method;
c.req.path;
c.req.raw;
```

## Response

Helpers write at statement level and return `c` for chaining. After one runs, the response is sent, so set headers first.

```ts
c.json({ ok: true });
c.text("plain");
c.html("<h1>hi</h1>");
c.bytes(new Uint8Array([0xff, 0xd8]), "image/jpeg"); // binary body
c.status(201).json({ created: true });
c.header("x-trace", "abc");
c.redirect("/elsewhere", 302);
```

Next: [Errors](errors.md). Request bodies and the `{ body: true }` flag: [Middleware](middleware.md).
