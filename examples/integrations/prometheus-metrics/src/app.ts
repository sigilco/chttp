import { createRouter } from "@chttp/router";
import type { Ctx } from "@chttp/router";

// The metrics seam: the entry point supplies a recorder and registers its own
// /metrics route (sync render in ELF mode, async prom-client render on node).
export type Record = (method: string, status: number, seconds: number) => void;

export function createApp(record: Record) {
  const app = createRouter();

  app.use(async (c: Ctx, next) => {
    const t0 = Date.now();
    await next();
    record(c.req.method, c.res.statusCode, (Date.now() - t0) / 1000);
  });

  app.get("/", (c) => c.json({ ok: true }));
  app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/boom", (c) => c.status(500).json({ error: "boom" }));
  return app;
}
