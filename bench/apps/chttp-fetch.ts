// chttp-fetch bench subject: the canonical bench route set served through
// app.fetch — a node:http bridge builds a real `Request` per incoming
// message and pipes the `Response` back out. This is the Web Standards
// entry surface the fetch arm of the dispatch contract answers
// (contracts/route-contract-fetch.md); bench/run.sh wires it as
// `chttp-fetch-node` and `chttp-fetch-bun`.
//
// Doubles as the chttp-fetch scriptc gate: `scriptc coverage
// bench/apps/chttp-fetch.ts` must stay 100% static. The gate's original
// coverage targets are kept — c.set/c.get (/vars), c.req.url (/url),
// header append (/cookies), path middleware (app.use('*', ...)) and a
// direct in-process `new Request` + app.fetch call.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRouter } from "../../packages/router/src/index.ts";
import { MIXED_STATIC, MIXED_PARAM, MIXED_WILD } from "./common.mjs";

const app = createRouter();

app.use("*", (c, next) => {
  c.header("x-power", "gate");
  next();
});

// gate routes (coverage targets — not benched)
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

// In-process call so the gate sees `new Request` + `app.fetch` directly.
const probe = new Request("http://localhost/hello");
void app.fetch(probe);

const srv = createServer(function (req: IncomingMessage, res: ServerResponse): void {
  const method = String(req.method || "GET");
  const url = String(req.url || "/");
  let body = "";
  req.on("data", function (chunk: Buffer): void {
    body = body + chunk.toString();
  });
  req.on("end", function (): void {
    const headers: { [k: string]: string } = {};
    const raw = req.headers;
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = raw[k];
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
    let wreq: Request;
    if (method === "GET" || method === "HEAD") {
      wreq = new Request("http://x" + url, { method: method, headers: headers });
    } else {
      wreq = new Request("http://x" + url, {
        method: method,
        headers: headers,
        body: body,
      });
    }
    const p = app.fetch(wreq);
    p.then(
      function (resp: Response): void {
        res.statusCode = resp.status;
        resp.headers.forEach(function (v: string, k: string): void {
          res.setHeader(k, v);
        });
        const tp = resp.text();
        tp.then(
          function (text: string): void {
            res.end(text);
          },
          function (): void {
            res.end("");
          },
        );
      },
      function (): void {
        res.statusCode = 500;
        res.end("");
      },
    );
  });
});

srv.listen(Number(process.argv[2] || process.env.PORT || 3000), function (): void {
  console.log("chttp-fetch listening");
});
