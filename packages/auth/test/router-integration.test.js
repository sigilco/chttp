// Router integration: real @chttp/router dispatch — login sets a session
// cookie, a protected route validates via readCookie + validateSessionToken,
// logout expires it. Runs against BOTH transports: node:http via
// app.handler() and Web Standards via app.fetch(Request).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "@chttp/router";
import {
  MemorySessionStore,
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSession,
  generateSessionToken,
  invalidateSession,
  readCookie,
  validateSessionToken,
} from "../dist/esm/index.js";

// Shared app factory: the same handlers back both transports.
function buildApp(store) {
  const app = createRouter();

  app.post("/login", async (c) => {
    const token = generateSessionToken();
    await createSession(store, token, "u-1", { role: "user" }, { ttlSeconds: 60 });
    c.header("set-cookie", buildSessionCookie(token, { secure: false, ttlSeconds: 60 }));
    return c.status(201).text("ok");
  });

  app.get("/me", async (c) => {
    const tok = readCookie(c.req.header("cookie"), "session");
    if (tok === null) {
      return c.status(401).text("no session");
    }
    const rec = await validateSessionToken(store, tok, { ttlSeconds: 60 });
    if (rec === null) {
      return c.status(401).text("bad session");
    }
    return c.text("user:" + rec.userId);
  });

  app.post("/logout", async (c) => {
    const tok = readCookie(c.req.header("cookie"), "session");
    if (tok !== null) {
      await invalidateSession(store, tok);
    }
    c.header("set-cookie", buildExpiredSessionCookie({ secure: false }));
    return c.text("bye");
  });

  return app;
}

function sessionCookieOf(res) {
  const sc = res.headers.get("set-cookie") || "";
  const m = sc.match(/session=([^;]*)/);
  return m ? "session=" + m[1] : null;
}

test("node:http transport: login -> protected -> logout", async () => {
  const store = new MemorySessionStore();
  const server = http.createServer(buildApp(store).handler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(base + "/login", { method: "POST" });
  assert.equal(login.status, 201);
  const cookie = sessionCookieOf(login);
  assert.ok(cookie);

  const me = await fetch(base + "/me", { headers: { cookie } });
  assert.equal(await me.text(), "user:u-1");

  const anon = await fetch(base + "/me");
  assert.equal(anon.status, 401);

  const logout = await fetch(base + "/logout", { method: "POST", headers: { cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);

  const me2 = await fetch(base + "/me", { headers: { cookie } });
  assert.equal(me2.status, 401);
});

test("app.fetch transport: identical flow through Web Standards Request", async (t) => {
  const store = new MemorySessionStore();
  const app = buildApp(store);
  // Guard for consumers still on a router without the fetch surface;
  // @chttp/router >= 0.3.0 always runs this arm.
  if (typeof app.fetch !== "function") {
    t.skip("app.fetch not available on this @chttp/router");
    return;
  }

  const login = await app.fetch(new Request("http://t/login", { method: "POST" }));
  assert.equal(login.status, 201);
  const cookie = sessionCookieOf(login);
  assert.ok(cookie);

  const me = await app.fetch(new Request("http://t/me", { headers: { cookie } }));
  assert.equal(await me.text(), "user:u-1");

  const anon = await app.fetch(new Request("http://t/me"));
  assert.equal(anon.status, 401);

  const logout = await app.fetch(
    new Request("http://t/logout", { method: "POST", headers: { cookie } }),
  );
  assert.equal(logout.status, 200);

  const me2 = await app.fetch(new Request("http://t/me", { headers: { cookie } }));
  assert.equal(me2.status, 401);
});
