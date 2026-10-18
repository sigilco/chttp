// Server smoke: real HTTP round-trips through app.serve() — the test-runner
// path that router.test.js's in-proc dispatch doesn't cover.
import * as assert from "node:assert";
import test from "node:test";
import { createRouter } from "../dist/esm/index.js";

test("serve(): json + param routes over real http", async () => {
  const app = createRouter();
  app.get("/json", (c) => c.json({ hello: "world" }));
  app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  const r1 = await fetch("http://127.0.0.1:" + port + "/json");
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { hello: "world" });
  const r2 = await fetch("http://127.0.0.1:" + port + "/user/42");
  assert.deepEqual(await r2.json(), { id: "42" });
  srv.close();
});

test("serve(): empty bodies carry no content-type; text answers use charset=UTF-8 (Hono parity)", async () => {
  const app = createRouter();
  app.get("/go", (c) => c.redirect("/dest"));
  app.get("/empty-text", (c) => c.text(""));
  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  const red = await fetch("http://127.0.0.1:" + port + "/go", { redirect: "manual" });
  assert.equal(red.status, 302);
  assert.equal(red.headers.get("location"), "/dest");
  assert.equal(red.headers.get("content-type"), null);
  const nf = await fetch("http://127.0.0.1:" + port + "/nope");
  assert.equal(nf.status, 404);
  assert.equal(nf.headers.get("content-type"), "text/plain; charset=UTF-8");
  // An explicit text answer keeps its content-type even when the body is "".
  const et = await fetch("http://127.0.0.1:" + port + "/empty-text");
  assert.equal(et.headers.get("content-type"), "text/plain; charset=UTF-8");
  srv.close();
});
