// chttp-fetch-lite bench subject: the canonical bench route set served
// through the lite Node bridge (issue #89) — app.serveFetch drives the
// fetch dispatch arm over LiteRequest/LiteResponse instead of building
// an undici Request/Headers/Response per incoming message. Compare its
// numbers against chttp-fetch-node (the undici bridge) in
// bench/RESULTS-v2.md.
//
// Also registered in scripts/scriptc-gate.sh: the bridge's own
// primitives (LiteRequest/LiteResponse, serveFetch) lower 100% static,
// which is what keeps the gate app compiling.

import { createRouter } from "../../packages/router/src/index.ts";
import { MIXED_STATIC, MIXED_PARAM, MIXED_WILD } from "./common.mjs";

const app = createRouter();

app.use("*", (c, next) => {
  c.header("x-power", "gate");
  next();
});

app.get("/url", (c) => {
  return c.json({ url: c.req.url, path: c.req.path });
});
app.get("/vars", (c) => {
  c.set("user", { id: 1, name: "ada" });
  const u = c.get<{ id: number; name: string }>("user");
  return c.json({ user: u });
});
app.get("/cookies", (c) => {
  c.header("set-cookie", "a=1", { append: true });
  c.header("set-cookie", "b=2", { append: true });
  return c.text("ok");
});

// canonical bench route set — identical to apps/chttp.ts
app.get("/", (c) => c.text(""));
app.get("/hello", (c) => c.text("Hello World!"));
app.get("/json", (c) => c.json({ hello: "world" }));
app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
app.post("/echo", (c) => c.text(c.req.body()), { body: true });
app.post("/user", (c) => c.text(""));
app.get("/deep/a/b/c/d/e", (c) => c.json({ ok: true }));
app.get("/files/*", (c) => c.text(c.req.param("*") || ""));

// 100-route mixed table: 60 static / 30 param / 10 wildcard.
for (const p of MIXED_STATIC) app.get(p, (c) => c.json({ ok: true }));
for (const p of MIXED_PARAM) app.get(p, (c) => c.json({ ok: true }));
for (const p of MIXED_WILD) app.get(p, (c) => c.json({ ok: true }));

app.serveFetch({ port: Number(process.argv[2] || process.env.PORT || 3000) });
console.log("chttp-fetch-lite listening");
