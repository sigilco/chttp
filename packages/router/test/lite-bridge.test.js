// lite Node bridge (issue #89): app.serveFetch()/fetchBridge() drive the
// fetch dispatch arm over LiteRequest/LiteResponse — no undici
// Request/Response per request. These tests pin the wire behavior: the
// canonical routes, lazy bodies, absolute c.req.url, multi-value
// set-cookie, response adoption, and the lazy-request escape hatch.
import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../dist/esm/index.js";

async function serve(app) {
  const srv = app.serveFetch({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  return { srv, base: "http://127.0.0.1:" + port };
}

test("lite bridge: canonical routes answer on the wire", async () => {
  const app = createRouter();
  app.get("/json", (c) => c.json({ hello: "world" }));
  app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
  const { srv, base } = await serve(app);
  const r1 = await fetch(base + "/json");
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { hello: "world" });
  const r2 = await fetch(base + "/user/42");
  assert.deepEqual(await r2.json(), { id: "42" });
  srv.close();
});

test("lite bridge: declared body routes read via text()", async () => {
  const app = createRouter();
  app.post("/echo", (c) => c.text(c.req.body()), { body: true });
  const { srv, base } = await serve(app);
  const r = await fetch(base + "/echo", { method: "POST", body: "wire-bytes" });
  assert.equal(await r.text(), "wire-bytes");
  srv.close();
});

test("lite bridge: undeclared routes never drain the request body", async () => {
  const app = createRouter();
  let raw = null;
  app.post("/relay", (c) => {
    raw = c.req.raw;
    return c.text("relayed");
  });
  const { srv, base } = await serve(app);
  const r = await fetch(base + "/relay", { method: "POST", body: "payload" });
  assert.equal(await r.text(), "relayed");
  assert.equal(await raw.text(), "payload", "raw stream readable after dispatch");
  srv.close();
});

test("lite bridge: c.req.url is absolute, raw is a WebReqView (not a Request)", async () => {
  const app = createRouter();
  let seen = null;
  app.get("/u", (c) => {
    seen = c.req.raw;
    return c.json({ url: c.req.url, method: seen.method });
  });
  const { srv, base } = await serve(app);
  const r = await fetch(base + "/u");
  const j = await r.json();
  assert.equal(j.method, "GET");
  assert.match(j.url, /^http:\/\/[^/]+\/u$/);
  assert.equal(seen instanceof Request, false);
  assert.equal(seen.headers.get("host"), "127.0.0.1:" + srv.address().port);
  srv.close();
});

test("lite bridge: multi-value set-cookie survives to the wire", async () => {
  const app = createRouter();
  app.get("/cookies", (c) => {
    c.header("set-cookie", "a=1", { append: true });
    c.header("set-cookie", "b=2", { append: true });
    return c.text("ok");
  });
  const { srv, base } = await serve(app);
  const r = await fetch(base + "/cookies");
  assert.deepEqual(r.headers.getSetCookie(), ["a=1", "b=2"]);
  srv.close();
});

test("lite bridge: handler-returned Response is adopted to the socket", async () => {
  const app = createRouter();
  app.get("/adopted", () => Response.json({ ok: true }, { status: 201 }));
  app.get("/astream", () => {
    const rs = new ReadableStream({
      start(ctl) {
        ctl.enqueue(new TextEncoder().encode("s1,"));
        ctl.enqueue(new TextEncoder().encode("s2"));
        ctl.close();
      },
    });
    return new Response(rs, { status: 202 });
  });
  const { srv, base } = await serve(app);
  const r1 = await fetch(base + "/adopted");
  assert.equal(r1.status, 201);
  assert.deepEqual(await r1.json(), { ok: true });
  const r2 = await fetch(base + "/astream");
  assert.equal(r2.status, 202);
  assert.equal(await r2.text(), "s1,s2");
  srv.close();
});

test("lite bridge: lite.request() materializes a real Request lazily", async () => {
  const app = createRouter();
  let real = null;
  app.get("/mat", (c) => {
    real = c.req.raw.request();
    return c.text("ok");
  });
  const { srv, base } = await serve(app);
  await fetch(base + "/mat?x=1");
  assert.ok(real instanceof Request);
  assert.match(real.url, /^http:\/\/[^/]+\/mat\?x=1$/);
  assert.equal(real.method, "GET");
  srv.close();
});

test("lite bridge: 405 carries Allow like the other surfaces", async () => {
  const app = createRouter();
  app.get("/only-get", (c) => c.text("g"));
  const { srv, base } = await serve(app);
  const r = await fetch(base + "/only-get", { method: "POST" });
  assert.equal(r.status, 405);
  assert.match(r.headers.get("allow"), /GET/);
  srv.close();
});
