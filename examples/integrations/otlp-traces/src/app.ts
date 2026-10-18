import { createRouter } from "@chttp/router";
import type { Ctx } from "@chttp/router";
import { parseTraceparent, randomHex, record } from "./otlp.ts";
import type { Exporter } from "./otlp.ts";

export function createApp(exporter: Exporter) {
  const app = createRouter();

  app.use(async (c: Ctx, next) => {
    const startMs = Date.now();
    const parent = parseTraceparent(c.req.header("traceparent") || "");
    const traceId = parent[0] === "" ? randomHex(32) : parent[0];
    await next();
    record(exporter, {
      traceId: traceId,
      spanId: randomHex(16),
      parentSpanId: parent[1],
      name: c.req.method + " " + c.req.path,
      startMs: startMs,
      endMs: Date.now(),
      httpStatus: c.res.statusCode,
    });
  });

  app.get("/", (c) => c.json({ ok: true }));
  app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/boom", (c) => c.status(500).json({ error: "boom" }));
  return app;
}
