// chttp typed-client compile gate + ELF loopback smoke:
// `scriptc coverage bench/apps/chttp-client.ts` must stay 100% static.
// packages/router/test/elf.test.sh builds this file and runs it — it
// serves a real chttp app on node:http and drives it with the compiled
// client over loopback TCP, proving node:net + the whole request path
// lower and run.
//
// Exercises: :param substitution, a `*` wildcard, query encoding,
// JSON body POST, text body, custom headers, the non-generic `request`
// escape hatch through the `Client<App>` interface receiver, and typed
// generic calls through a `ClientCore` receiver (the only receiver kind
// scriptc dispatches generic methods on — SC1090).

import { createRouter } from "../../packages/router/src/index.ts";
import { createClient } from "../../packages/router/src/client.ts";
import type { Client, ClientCore } from "../../packages/router/src/client.ts";

const app = createRouter();

app.get("/users/:id", (c) => {
  return c.json({ id: c.req.param("id") });
});

app.get("/files/*", (c) => {
  return c.json({ star: c.req.param("*") });
});

app.get("/search", (c) => {
  return c.json({ q: c.req.query("q"), page: c.req.query("page") });
});

app.post(
  "/echo",
  (c) => {
    return c.json({ seen: c.req.header("x-seen"), body: c.req.body() });
  },
  { body: true },
);

app.get("/health", (c) => {
  return c.text("ok");
});

function check(cond: boolean, name: string): void {
  if (!cond) {
    throw new Error("gate FAIL: " + name);
  }
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 0);
  app.serve({ port: port });

  // serve() is fire-and-forget; give node:http a tick to bind, then
  // discover the port is unnecessary — tests pass an explicit PORT.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 200);
  });

  const base = "http://127.0.0.1:" + String(port);
  const c: ClientCore = createClient(base, { timeoutMs: 5000 });

  const u = await c.get<{ id: string }>("/users/:id", { params: { id: "42" } });
  check(u.id === "42", "param route");

  const f = await c.get<{ star: string }>("/files/*", { params: { "*": "a/b.txt" } });
  check(f.star === "a/b.txt", "wildcard route");

  const s = await c.get<{ q: string; page: string }>("/search", { query: { q: "a b", page: "2" } });
  check(s.q === "a b" && s.page === "2", "query encoding");

  const e = await c.post<{ seen: string; body: string }>("/echo", {
    headers: { "x-seen": "yes" },
    body: { n: 1 },
  });
  check(e.seen === "yes" && e.body === '{"n":1}', "json body + header");

  const h = await c.get<string>("/health");
  check(h === "ok", "text decode");

  // Non-generic escape hatch: dispatches through the interface receiver.
  const ci: Client = createClient(base, { timeoutMs: 5000 });
  const res = await ci.request("GET", "/health", null);
  check(res.status === 200 && res.body === "ok", "raw request");

  console.log("gate OK");
  process.exit(0);
}

void main();
