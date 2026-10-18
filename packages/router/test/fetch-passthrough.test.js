// fetch passthrough contract (0.4.0): the three app.fetch guarantees the
// Hono-migration seam depends on.
//   1. Request passthrough identity — c.req.raw IS the original Request,
//      with its body stream unconsumed on undeclared routes.
//   2. Response adoption — a handler may return a Response (json or
//      streamed) instead of writing through c.*; it reaches the client.
//   3. Lazy bodies — only { body: true } routes get text() run; undeclared
//      routes keep c.req.body() === "" and the raw stream readable.
// Multipart + 405/404 behavior regressions live in multipart.test.js /
// router.test.js and must stay green unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../dist/esm/index.js";

test("passthrough identity: c.req.raw is the original Request, untouched", async () => {
  const app = createRouter();
  let seen = null;
  app.post("/echo", (c) => {
    seen = c.req.raw;
    return new Response("ok", { status: 200 });
  });
  const req = new Request("http://x/echo", {
    method: "POST",
    body: "wire-bytes",
    headers: { "content-type": "text/plain", "x-marker": "keep-me" },
  });
  const res = await app.fetch(req);
  assert.equal(res.status, 200);
  assert.equal(seen, req, "handler receives the same Request object the host passed");
  assert.equal(seen.headers.get("x-marker"), "keep-me");
  assert.equal(seen.method, "POST");
});

test("passthrough identity: body stream unconsumed on undeclared routes", async () => {
  const app = createRouter();
  let raw = null;
  app.post("/relay", (c) => {
    raw = c.req.raw;
    return new Response("relayed", { status: 200 });
  });
  const req = new Request("http://x/relay", { method: "POST", body: "payload" });
  await app.fetch(req);
  assert.equal(await raw.text(), "payload", "handler can still read the full body via raw");
});

test("response adoption: handler-returned Response reaches the client (json)", async () => {
  const app = createRouter();
  app.get("/json", () => Response.json({ adopted: true }));
  const res = await app.fetch(new Request("http://x/json"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.deepEqual(await res.json(), { adopted: true });
});

test("response adoption: streamed Response body passes through unbuffered", async () => {
  const app = createRouter();
  app.get("/stream", () => {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    (async () => {
      await w.write(new TextEncoder().encode("chunk-1,"));
      await w.write(new TextEncoder().encode("chunk-2"));
      await w.close();
    })();
    return new Response(readable, {
      status: 201,
      headers: { "content-type": "application/octet-stream", "x-streamed": "yes" },
    });
  });
  const res = await app.fetch(new Request("http://x/stream"));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-streamed"), "yes");
  assert.equal(await res.text(), "chunk-1,chunk-2");
});

test("response adoption: async handler returning Response adopts the fulfilled value", async () => {
  const app = createRouter();
  app.get("/late", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return new Response("late-body", { status: 202 });
  });
  const res = await app.fetch(new Request("http://x/late"));
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "late-body");
});

test("response adoption: non-response settled values still answer 500", async () => {
  const app = createRouter();
  app.get("/stray", () => 42);
  const res = await app.fetch(new Request("http://x/stray"));
  assert.equal(res.status, 500);
});

test("lazy bodies: undeclared route leaves c.req.body() empty, raw stream intact", async () => {
  const app = createRouter();
  let raw = null;
  app.post("/raw", (c) => {
    raw = c.req.raw;
    return new Response("body:" + c.req.body(), { status: 200 });
  });
  const res = await app.fetch(new Request("http://x/raw", { method: "POST", body: "octet-bytes" }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "body:");
  assert.equal(await raw.text(), "octet-bytes");
});

test("lazy bodies: declared { body: true } route buffers through c.req.body()", async () => {
  const app = createRouter();
  app.post("/buf", (c) => new Response("saw:" + c.req.body()), { body: true });
  const res = await app.fetch(new Request("http://x/buf", { method: "POST", body: "hello-lazy" }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "saw:hello-lazy");
});

test("lazy bodies: binary POST to undeclared route survives a utf8 round trip", async () => {
  const app = createRouter();
  let raw = null;
  app.post("/otel-ish", (c) => {
    raw = c.req.raw;
    return Response.json({ ok: true });
  });
  const bytes = new Uint8Array([0x0a, 0x03, 0xff, 0xfe, 0x80, 0x81]);
  await app.fetch(
    new Request("http://x/otel-ish", {
      method: "POST",
      body: bytes,
      headers: { "content-type": "application/x-protobuf" },
    }),
  );
  const back = new Uint8Array(await raw.arrayBuffer());
  assert.deepEqual(Array.from(back), Array.from(bytes), "protobuf bytes identical");
});

test("multipart regression: declared multipart route still parses through app.fetch", async () => {
  const app = createRouter();
  app.post(
    "/up",
    (c) => {
      const f = c.req.file("f");
      return Response.json({ name: f === null ? null : f.field });
    },
    { multipart: {} },
  );
  const fd = new FormData();
  fd.append("f", new Blob(["file-bytes"]), "a.txt");
  const res = await app.fetch(new Request("http://x/up", { method: "POST", body: fd }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { name: "f" });
});

test("405/404 unchanged: method miss is 405 with Allow, miss is bare Not Found", async () => {
  const app = createRouter();
  app.get("/known", (c) => c.text("known"));
  const miss405 = await app.fetch(new Request("http://x/known", { method: "PUT" }));
  assert.equal(miss405.status, 405);
  assert.match(miss405.headers.get("allow") || "", /GET/);
  const miss404 = await app.fetch(new Request("http://x/nope"));
  assert.equal(miss404.status, 404);
  assert.equal(await miss404.text(), "Not Found");
});
test("empty bodies carry no content-type on the fetch surface (Hono parity)", async () => {
  const app = createRouter();
  app.get("/go", (c) => c.redirect("/dest"));
  app.get("/null-body", () => new Response(null, { status: 400 }));
  const red = await app.fetch(new Request("http://x/go"));
  assert.equal(red.status, 302);
  assert.equal(red.headers.get("location"), "/dest");
  assert.equal(red.headers.get("content-type"), null);
  const nil = await app.fetch(new Request("http://x/null-body"));
  assert.equal(nil.status, 400);
  assert.equal(nil.headers.get("content-type"), null);
  const nf = await app.fetch(new Request("http://x/nope"));
  assert.equal(nf.status, 404);
  assert.equal(nf.headers.get("content-type"), "text/plain; charset=UTF-8");
});

// c.res view (issue #57): the typed response view exposes .status,
// .header(name), and .headers on the Web Standards surface, reading the
// FetchResponseSink's captured state — so a middleware that awaits next()
// sees the final status and headers, same as the Node surface.
test("c.res view: status reflects a 404 after next() settles", async () => {
  const app = createRouter();
  let seen = null;
  app.use("*", async (c, next) => {
    await next();
    seen = c.res.status;
  });
  app.get("/ok", (c) => c.text("ok"));
  const res = await app.fetch(new Request("http://x/missing"));
  assert.equal(res.status, 404);
  assert.equal(seen, 404);
});

test("c.res view: header('content-type') reflects a json() write", async () => {
  const app = createRouter();
  let ct = null;
  let all = null;
  app.use("*", async (c, next) => {
    await next();
    ct = c.res.header("content-type");
    all = c.res.headers;
  });
  app.get("/json", (c) => c.json({ ok: true }));
  const res = await app.fetch(new Request("http://x/json"));
  assert.equal(res.status, 200);
  assert.equal(ct, "application/json; charset=utf-8");
  assert.equal(all["content-type"], "application/json; charset=utf-8");
});
