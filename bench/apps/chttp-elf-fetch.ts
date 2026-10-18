// chttp-elf-fetch bench subject: the canonical bench route set served
// through the Web Standards dispatch arm in a scriptc ELF. `new Request`
// is unconstructable under scriptc, so the entry here is app.fetchShim —
// the (method, url, headers, body) -> (status, hdrList, body) shim that
// drives the same emitted/runtime fetch dispatch app.fetch drives
// (contracts/route-contract-fetch.md).
//
// scriptc build apps/chttp-elf-fetch.ts -o bin/chttp-elf-fetch --optimization=speed
// bench/run.sh wires it as `chttp-elf-fetch`.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRouter } from "../../packages/router/src/index.ts";
import { MIXED_STATIC, MIXED_PARAM, MIXED_WILD } from "./common.mjs";

const app = createRouter();

app.use("*", (c, next) => {
  c.header("x-power", "elf");
  next();
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

const srv = createServer(function (req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", function (chunk: Buffer): void {
    body = body + chunk.toString();
  });
  req.on("end", function (): void {
    app.fetchShim(
      String(req.method || "GET"),
      String(req.url || "/"),
      null,
      body,
      function (status: number, hdrList: string[], out: string): void {
        res.statusCode = status;
        for (let i = 0; i + 1 < hdrList.length; i += 2) {
          res.setHeader(String(hdrList[i]), String(hdrList[i + 1]));
        }
        res.end(out);
      },
    );
  });
});

srv.listen(Number(process.argv[2] || process.env.PORT || 3000), function (): void {
  console.log("chttp-elf-fetch listening");
});
