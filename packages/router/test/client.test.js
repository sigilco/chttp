// Client smoke: createClient against app.serve() over real loopback —
// the Node-side twin of the compiled path in test/elf.test.sh.
import * as assert from "node:assert";
import test from "node:test";
import { createRouter } from "../dist/esm/index.js";
import { createClient } from "../dist/esm/client.js";

async function serve(app) {
  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  return srv;
}

test("client: param + wildcard + query + json body round-trips", async () => {
  const app = createRouter();
  app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/files/*", (c) => c.json({ star: c.req.param("*") }));
  app.get("/search", (c) => c.json({ q: c.req.query("q"), page: c.req.query("page") }));
  app.post("/echo", (c) => c.json({ seen: c.req.header("x-seen"), body: c.req.body() }), {
    body: true,
  });
  app.get("/health", (c) => c.text("ok"));
  const srv = await serve(app);
  const port = srv.address().port;
  const c = createClient("http://127.0.0.1:" + port, { timeoutMs: 5000 });

  assert.deepEqual(await c.get("/users/:id", { params: { id: "42" } }), { id: "42" });
  assert.deepEqual(await c.get("/files/*", { params: { "*": "a/b.txt" } }), { star: "a/b.txt" });
  assert.deepEqual(await c.get("/search", { query: { q: "a b", page: "2" } }), {
    q: "a b",
    page: "2",
  });
  assert.deepEqual(await c.post("/echo", { headers: { "x-seen": "yes" }, body: { n: 1 } }), {
    seen: "yes",
    body: '{"n":1}',
  });
  assert.equal(await c.get("/health"), "ok");

  const res = await c.request("GET", "/health", null);
  assert.equal(res.status, 200);
  assert.equal(res.body, "ok");
  srv.close();
});

test("client: unresolved params throw before the wire", async () => {
  const c = createClient("http://127.0.0.1:1");
  await assert.rejects(() => c.get("/users/:id"), /unresolved path params/);
});
