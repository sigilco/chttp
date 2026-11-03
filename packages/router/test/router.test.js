import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../dist/esm/index.js";

function mkReq(opts = {}) {
  const cbs = {};
  const req = {
    method: opts.method || "GET",
    url: opts.url || "/",
    headers: opts.headers || {},
    headersDistinct: opts.headersDistinct || {},
    on(ev, cb) {
      cbs[ev] = cb;
    },
  };
  const emit = (body) => {
    if (body !== undefined && cbs.data) {
      cbs.data({ toString: () => body });
    }
    if (cbs.end) {
      cbs.end();
    }
  };
  return { req, emit };
}

function mkRes() {
  const res = {
    statusCode: 200,
    headers: {},
    bodyTxt: "",
    ended: false,
    headersSent: false,
    destroyed: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      const v = this.headers[String(k).toLowerCase()];
      return v === undefined ? undefined : v;
    },
    setStatus(n) {
      this.statusCode = Number(n);
    },
    appendHeader() {},
    _setBody(s) {
      this.bodyTxt = s;
      this.ended = true;
      this.headersSent = true;
    },
    writeBody(s) {
      this.bodyTxt = s;
      this.ended = true;
      this.headersSent = true;
    },
    bodyBytes(b) {
      this.bodyTxt = String(b);
      this.ended = true;
      this.headersSent = true;
    },
    redirect() {
      this.ended = true;
      this.headersSent = true;
    },
    write() {},
    isSent() {
      return this.ended;
    },
    isHeadersSent() {
      return this.headersSent;
    },
    end(b) {
      this.ended = true;
      this.headersSent = true;
      if (typeof b === "string") {
        if (this.bodyTxt === "") {
          this.bodyTxt = b;
        } else {
          this.bodyTxt = this.bodyTxt + b;
        }
      }
    },
    destroy() {
      this.destroyed = true;
    },
  };
  // Expose `body` as a getter returning bodyTxt, for tests that read res.body
  Object.defineProperty(res, "body", {
    get() {
      return this.bodyTxt;
    },
  });
  return res;
}

const call = (app, opts, body) => {
  const { req, emit } = mkReq(opts);
  const res = mkRes();
  app.handler()(req, res);
  emit(body);
  return res;
};

test("static route matches and json writes headers + body", () => {
  const app = createRouter();
  app.get("/json", (c) => c.json({ hello: "world" }));
  const res = call(app, { url: "/json" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(JSON.parse(res.body).hello, "world");
  assert.equal(res.headers["content-length"], String(Buffer.byteLength(res.body)));
});

test("param route captures and param() returns value", () => {
  const app = createRouter();
  app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
  const res = call(app, { url: "/user/42" });
  assert.equal(JSON.parse(res.body).id, "42");
});

test("param value is percent-decoded", () => {
  const app = createRouter();
  app.get("/u/:id", (c) => c.text(c.req.param("id") || ""));
  const res = call(app, { url: "/u/a%20b" });
  assert.equal(res.body, "a b");
});

test("missing param returns null", () => {
  const app = createRouter();
  app.get("/u/:id", (c) => c.text(String(c.req.param("nope"))));
  const res = call(app, { url: "/u/1" });
  assert.equal(res.body, "null");
});

test("wildcard captures rest of path including slashes", () => {
  const app = createRouter();
  app.get("/w/*", (c) => c.text(c.req.param("*") || ""));
  const res = call(app, { url: "/w/a/b/c" });
  assert.equal(res.body, "a/b/c");
});

test("static beats param at same position", () => {
  const app = createRouter();
  app.get("/user/new", (c) => c.text("new"));
  app.get("/user/:id", (c) => c.text("id:" + (c.req.param("id") || "")));
  assert.equal(call(app, { url: "/user/new" }).body, "new");
  assert.equal(call(app, { url: "/user/9" }).body, "id:9");
});

test("param backtracks when static branch wins deeper", () => {
  const app = createRouter();
  app.get("/a/:x/z", (c) => c.text("param:" + (c.req.param("x") || "")));
  app.get("/a/b/c", (c) => c.text("static"));
  assert.equal(call(app, { url: "/a/b/c" }).body, "static");
  assert.equal(call(app, { url: "/a/q/z" }).body, "param:q");
});

test("query parsed lazily with + and percent decoding", () => {
  const app = createRouter();
  app.get("/q", (c) => c.json({ x: c.req.query("x"), all: c.req.queryAll() }));
  const res = call(app, { url: "/q?x=1+2&y=a%2Fb&flag" });
  const body = JSON.parse(res.body);
  assert.equal(body.x, "1 2");
  assert.equal(body.all.y, "a/b");
  assert.equal(body.all.flag, "");
});

test("query on url without ? returns null and empty map", () => {
  const app = createRouter();
  app.get("/q", (c) => c.json({ x: c.req.query("x"), n: Object.keys(c.req.queryAll()).length }));
  const res = call(app, { url: "/q" });
  const body = JSON.parse(res.body);
  assert.equal(body.x, null);
  assert.equal(body.n, 0);
});

test("header lookup is case-insensitive and null when absent", () => {
  const app = createRouter();
  app.get("/h", (c) => c.text(c.req.header("X-Token") || "none"));
  const res = call(app, { url: "/h", headers: { "x-token": "abc" } });
  assert.equal(res.body, "abc");
  const res2 = call(app, { url: "/h" });
  assert.equal(res2.body, "none");
});

test("default 404 and custom notFound", () => {
  const app = createRouter();
  app.get("/a", (c) => c.text("a"));
  assert.equal(call(app, { url: "/nope" }).statusCode, 404);

  const app2 = createRouter();
  app2.notFound((c) => {
    c.status(404);
    c.text("not found");
  });
  const res = call(app2, { url: "/x" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, "not found");
});

test("method dispatch is strict per method", () => {
  const app = createRouter();
  app.get("/r", (c) => c.text("get"));
  app.post("/r", (c) => c.text("post:" + c.req.body()), { body: true });
  assert.equal(call(app, { method: "GET", url: "/r" }).body, "get");
  const res = call(app, { method: "POST", url: "/r" }, "hi");
  assert.equal(res.body, "post:hi");
  const del = call(app, { method: "DELETE", url: "/r" });
  assert.equal(del.statusCode, 405);
  assert.equal(del.headers["allow"], "GET, HEAD, POST");
  assert.equal(del.headers["head"], undefined);
});

test("body buffers before handler only when route declares body: true", () => {
  const app = createRouter();
  app.post("/echo", (c) => c.text(c.req.body()), { body: true });
  const res = call(app, { method: "POST", url: "/echo" }, "hello world");
  assert.equal(res.body, "hello world");
  assert.equal(res.headers["content-length"], "11");

  // Same handler without the declaration: declared-body contract says
  // no buffering happens and body() returns ''. Deterministic opt-in —
  // see contracts/route-contract.md.
  const app2 = createRouter();
  app2.post("/echo", (c) => c.text("[" + c.req.body() + "]"));
  const res2 = call(app2, { method: "POST", url: "/echo" }, "ignored");
  assert.equal(res2.body, "[]");
});

test("body: true on a GET route is a no-op", () => {
  const app = createRouter();
  app.get("/g", (c) => c.text("g"), { body: true });
  const res = call(app, { method: "GET", url: "/g" }, "payload");
  assert.equal(res.body, "g");
});

test("HEAD falls back to GET handler", () => {
  const app = createRouter();
  app.get("/g", (c) => c.text("body"));
  const res = call(app, { method: "HEAD", url: "/g" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-length"], "4");
});

test("all() matches every method", () => {
  const app = createRouter();
  app.all("/x", (c) => c.text("any"));
  assert.equal(call(app, { method: "GET", url: "/x" }).body, "any");
  const res = call(app, { method: "POST", url: "/x" }, "");
  assert.equal(res.body, "any");
});

test("middleware runs in registration order before handler", () => {
  const order = [];
  const app = createRouter();
  app.use((c, next) => {
    order.push("mw1");
    c.header("x-one", "1");
    next();
  });
  app.use((c, next) => {
    order.push("mw2");
    next();
  });
  app.get("/m", (c) => {
    order.push("h");
    c.text("ok");
  });
  const res = call(app, { url: "/m" });
  assert.deepEqual(order, ["mw1", "mw2", "h"]);
  assert.equal(res.headers["x-one"], "1");
});

test("middleware registered after a route does not apply to it", () => {
  const hits = [];
  const app = createRouter();
  app.get("/early", (c) => c.text("early"));
  app.use((c, next) => {
    hits.push("mw");
    next();
  });
  app.get("/late", (c) => c.text("late"));
  call(app, { url: "/early" });
  assert.deepEqual(hits, []);
  call(app, { url: "/late" });
  assert.deepEqual(hits, ["mw"]);
});

test("middleware chain continues into notFound registered later", () => {
  const hits = [];
  const app = createRouter();
  app.use((c, next) => {
    hits.push("mw");
    next();
  });
  app.notFound((c) => {
    hits.push("nf");
    c.status(404).text("nf");
  });
  const res = call(app, { url: "/gone" });
  assert.deepEqual(hits, ["mw", "nf"]);
  assert.equal(res.statusCode, 404);
});

test("route() mounts a sub-app under a prefix preserving params", () => {
  const sub = createRouter();
  sub.get("/item/:id", (c) => c.json({ id: c.req.param("id") }));
  sub.get("/", (c) => c.text("subroot"));
  const app = createRouter();
  app.route("/api", sub);
  assert.equal(JSON.parse(call(app, { url: "/api/item/7" }).body).id, "7");
  assert.equal(call(app, { url: "/api" }).statusCode, 404); // mount point itself unclaimed
  assert.equal(call(app, { url: "/api/" }).body, "subroot");
});

test('route("/", sub) mounts sub-app routes at the root (issue #97)', () => {
  const sub = createRouter();
  sub.get("/health", (c) => c.text("ok"));
  const app = createRouter();
  app.route("/", sub);
  const res = call(app, { url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "ok");
});

test('route("/", sub) resolves a handler registered at "/" in the sub-app', () => {
  const sub = createRouter();
  sub.get("/", (c) => c.text("subroot"));
  const app = createRouter();
  app.route("/", sub);
  const res = call(app, { url: "/" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "subroot");
});

test('route("/", sub) preserves params through the root mount', () => {
  const sub = createRouter();
  sub.get("/item/:id", (c) => c.json({ id: c.req.param("id") }));
  const app = createRouter();
  app.route("/", sub);
  assert.equal(JSON.parse(call(app, { url: "/item/7" }).body).id, "7");
  assert.equal(call(app, { url: "/missing" }).statusCode, 404);
});

test('route("/api", sub) still mounts under the prefix after the root fix', () => {
  const sub = createRouter();
  sub.get("/users", (c) => c.text("users"));
  const app = createRouter();
  app.route("/api", sub);
  assert.equal(call(app, { url: "/api/users" }).body, "users");
  assert.equal(call(app, { url: "/users" }).statusCode, 404);
});

test("route() inherits middleware from both sides", () => {
  const hits = [];
  const sub = createRouter();
  sub.use((c, next) => {
    hits.push("sub");
    next();
  });
  sub.get("/x", (c) => c.text("x"));
  const app = createRouter();
  app.use((c, next) => {
    hits.push("parent");
    next();
  });
  app.route("/p", sub);
  call(app, { url: "/p/x" });
  assert.deepEqual(hits, ["parent", "sub"]);
});

test("c.req.url returns the full path+query on the Node path", () => {
  const app = createRouter();
  let seen = "";
  app.get("/q", (c) => {
    seen = c.req.url;
    c.text("ok");
  });
  call(app, { url: "/q?x=1&y=two" });
  assert.equal(seen, "/q?x=1&y=two");
});

test("c.req.url is path-only when no query is present", () => {
  const app = createRouter();
  let seen = "";
  app.get("/p", (c) => {
    seen = c.req.url;
    c.text("ok");
  });
  call(app, { url: "/p" });
  assert.equal(seen, "/p");
});

test("app.use('*', mw) runs on every request", () => {
  const hits = [];
  const app = createRouter();
  app.use("*", (c, next) => {
    hits.push(c.req.path);
    next();
  });
  app.get("/a", (c) => c.text("a"));
  app.get("/b/c", (c) => c.text("b"));
  call(app, { url: "/a" });
  call(app, { url: "/b/c" });
  assert.deepEqual(hits, ["/a", "/b/c"]);
});

test("app.use('/api/*', mw) only runs for matching paths", () => {
  const hits = [];
  const app = createRouter();
  app.use("/api/*", (c, next) => {
    hits.push(c.req.path);
    next();
  });
  app.get("/api/users", (c) => c.text("u"));
  app.get("/api/v2/items", (c) => c.text("v2"));
  app.get("/other", (c) => c.text("o"));
  call(app, { url: "/api/users" });
  call(app, { url: "/api/v2/items" });
  call(app, { url: "/other" });
  assert.deepEqual(hits, ["/api/users", "/api/v2/items"]);
});

test("app.use(path, mw1, mw2) runs both in order when path matches", () => {
  const order = [];
  const app = createRouter();
  app.use(
    "/x/*",
    (c, next) => {
      order.push("a");
      next();
    },
    (c, next) => {
      order.push("b");
      next();
    },
  );
  app.get("/x/y", (c) => {
    order.push("h");
    c.text("ok");
  });
  call(app, { url: "/x/y" });
  assert.deepEqual(order, ["a", "b", "h"]);
});

test("app.use with exact path (no wildcard) only matches that path", () => {
  const hits = [];
  const app = createRouter();
  app.use("/exact", (c, next) => {
    hits.push("x");
    next();
  });
  app.get("/exact", (c) => c.text("e"));
  app.get("/exactly", (c) => c.text("ey"));
  call(app, { url: "/exact" });
  call(app, { url: "/exactly" });
  assert.deepEqual(hits, ["x"]);
});

test("redirect sets status + location", () => {
  const app = createRouter();
  app.get("/r", (c) => c.redirect("/to"));
  app.get("/r2", (c) => c.redirect("/to", 301));
  const res = call(app, { url: "/r" });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/to");
  assert.equal(call(app, { url: "/r2" }).statusCode, 301);
});

test("throwing handler yields 500 not a crash", () => {
  const app = createRouter();
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  const res = call(app, { url: "/boom" });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body, "Internal Server Error");
});

test("on() registers arbitrary methods", () => {
  const app = createRouter();
  app.on("purge", "/cache", (c) => c.text("purged"));
  assert.equal(call(app, { method: "PURGE", url: "/cache" }).body, "purged");
});

test("root path and trailing-slash strictness", () => {
  const app = createRouter();
  app.get("/", (c) => c.text("root"));
  assert.equal(call(app, { url: "/" }).body, "root");
  assert.equal(call(app, { url: "//" }).statusCode, 404);
});

test("non-ascii body gets byte-accurate content-length", () => {
  const app = createRouter();
  app.get("/u", (c) => c.text("héllo → 👋"));
  const res = call(app, { url: "/u" });
  assert.equal(res.headers["content-length"], String(Buffer.byteLength("héllo → 👋")));
});

test("withDispatch validates the route contract version stamp", () => {
  return import("../dist/esm/index.js").then(
    ({ GenDispatch, ROUTE_CONTRACT_VERSION, createRouter }) => {
      const app = createRouter();
      // mismatched stamp → clear error naming both versions
      class Bad extends GenDispatch {
        constructor() {
          super();
          this.ROUTE_CONTRACT_VERSION = 999;
        }
      }
      assert.throws(
        () => createRouter().withDispatch(new Bad()),
        new RegExp("contract version mismatch.*v999.*v" + String(ROUTE_CONTRACT_VERSION)),
      );
      // matching stamp → accepted
      class Ok extends GenDispatch {
        constructor() {
          super();
          this.ROUTE_CONTRACT_VERSION = ROUTE_CONTRACT_VERSION;
        }
      }
      app.withDispatch(new Ok());
      assert.equal(app.handler() instanceof Function, true);
      // missing stamp (duck-typed pre-versioning dispatch) → accepted
      const legacy = {
        dispatch() {
          return false;
        },
      };
      createRouter().withDispatch(legacy);
    },
  );
});

test("withDispatch generated module takes precedence and can decline", () => {
  return import("../dist/esm/index.js").then(({ GenDispatch, createRouter }) => {
    class Gen extends GenDispatch {
      dispatch(req, res) {
        const url = String(req.url || "/");
        if (url === "/fast") {
          res.statusCode = 200;
          res.setHeader("content-type", "text/plain");
          res.end("gen-hit");
          return true;
        }
        return false;
      }
    }
    const app = createRouter();
    app.withDispatch(new Gen());
    app.get("/fast", (c) => c.text("internal"));
    app.get("/other", (c) => c.text("internal-other"));
    // gen claims /fast → its response wins over the registered route
    assert.equal(call(app, { url: "/fast" }).body, "gen-hit");
    // gen declines /other → internal dispatch serves it
    assert.equal(call(app, { url: "/other" }).body, "internal-other");
  });
});

test("generated dispatch can spawn ctx + seed params + buffer via helpers", () => {
  return import("../dist/esm/index.js").then((m) => {
    const app = m.createRouter();
    class Gen extends m.GenDispatch {
      dispatch(req, res) {
        const url = String(req.url || "/");
        if (url.indexOf("/u/") === 0) {
          const rv = new m.ReqView(req, "", url);
          const c = new m.Ctx(rv, new m.NodeResponseSink(res));
          rv._seedPm(["id", m.dec(url.slice(3))]);
          m._guard(res, c, function () {
            return c.json({ id: c.req.param("id") });
          });
          return true;
        }
        if (url === "/b") {
          const rv = new m.ReqView(req, "", url);
          const c = new m.Ctx(rv, new m.NodeResponseSink(res));
          m._buffer(req, res, c, function () {
            c.text("b:" + c.req.body());
          });
          return true;
        }
        return false;
      }
    }
    app.withDispatch(new Gen());
    const res = call(app, { url: "/u/7" });
    assert.equal(JSON.parse(res.body).id, "7");
    const res2 = call(app, { method: "POST", url: "/b" }, "hey");
    assert.equal(res2.body, "b:hey");
    // unknown → internal → 404
    assert.equal(call(app, { url: "/zzz" }).statusCode, 404);
  });
});

test("queries() returns all values for a repeated key in order", () => {
  const app = createRouter();
  app.get("/q", (c) => c.text(c.req.queries("tag").join(",")));
  const res = call(app, { url: "/q?tag=a&x=1&tag=b&tag=c" });
  assert.equal(res.body, "a,b,c");
});

test("queries() on absent key returns empty array", () => {
  const app = createRouter();
  app.get("/q", (c) => c.text(String(c.req.queries("nope").length)));
  const res = call(app, { url: "/q?x=1" });
  assert.equal(res.body, "0");
});

test("onError handles thrown errors and writes the response", () => {
  const app = createRouter();
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  app.onError((err, c) => c.status(503).json({ error: String(err.message) }));
  const res = call(app, { url: "/boom" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, '{"error":"kaboom"}');
});

test("onError that never responds falls back to built-in 500", () => {
  const app = createRouter();
  app.get("/boom", () => {
    throw new Error("x");
  });
  app.onError(() => {
    /* writes nothing */
  });
  const res = call(app, { url: "/boom" });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body, "Internal Server Error");
});

test("onError that throws still yields a single 500", () => {
  const app = createRouter();
  app.get("/boom", () => {
    throw new Error("x");
  });
  app.onError(() => {
    throw new Error("handler bug");
  });
  const res = call(app, { url: "/boom" });
  assert.equal(res.statusCode, 500);
});

test("no onError registered: default 500 behavior unchanged", () => {
  const app = createRouter();
  app.get("/boom", () => {
    throw new Error("x");
  });
  const res = call(app, { url: "/boom" });
  assert.equal(res.statusCode, 500);
});

test("405 surfaces through onError with allow list on the error", () => {
  const app = createRouter();
  app.get("/r", (c) => c.text("get"));
  app.onError((err, c) => {
    c.status(405);
    c.header("allow", String(err.allow));
    c.text("custom 405");
  });
  const res = call(app, { method: "DELETE", url: "/r" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.body, "custom 405");
  assert.equal(res.headers["allow"], "GET,HEAD");
});

test("c.bytes writes the buffer with content-type and byte length", () => {
  const app = createRouter();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  app.get("/img", (c) => c.bytes(png, "image/png"));
  const { req, emit } = mkReq({ url: "/img" });
  const res = mkRes();
  let out = null;
  res.end = function (b) {
    this.ended = true;
    this.headersSent = true;
    out = b;
  };
  app.handler()(req, res);
  emit();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["content-length"], "6");
  assert.ok(Buffer.isBuffer(out));
  assert.deepEqual([...out], [...png]);
});

test("c.bytes honours status() and marks the response sent", () => {
  const app = createRouter();
  app.get("/b", (c) => c.status(201).bytes(Buffer.alloc(0), "application/octet-stream"));
  const res = call(app, { url: "/b" });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["content-length"], "0");
  assert.equal(res.ended, true);
});

test("c.bytes is HEAD-safe over real http", async () => {
  const app = createRouter();
  const data = Buffer.from([1, 2, 3, 4, 5]);
  app.get("/bin", (c) => c.bytes(data, "application/octet-stream"));
  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  const base = "http://127.0.0.1:" + srv.address().port + "/bin";
  const g = await fetch(base);
  assert.deepEqual([...new Uint8Array(await g.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(g.headers.get("content-length"), "5");
  const h = await fetch(base, { method: "HEAD" });
  assert.equal(h.status, 200);
  assert.equal(h.headers.get("content-length"), "5");
  assert.equal((await h.arrayBuffer()).byteLength, 0);
  srv.close();
});

test("fetchShim drives the fetch dispatch path with primitives", async () => {
  const app = createRouter();
  app.use("*", (c, next) => {
    c.header("x-shim", "1");
    next();
  });
  app.get("/json", (c) => c.json({ hello: "world" }));
  app.get("/u/:id", (c) => c.text("id=" + c.req.param("id")));
  app.get("/cookies", (c) => {
    c.header("set-cookie", "a=1", { append: true });
    c.header("set-cookie", "b=2", { append: true });
    return c.text("ok");
  });
  app.post("/echo", (c) => c.text("body=" + c.req.body()));

  const call = (method, url, body = "") =>
    new Promise((resolve) => {
      app.fetchShim(method, url, null, body, (status, hdrList, out) =>
        resolve({ status, hdrList, out }),
      );
    });

  const j = await call("GET", "/json");
  assert.equal(j.status, 200);
  assert.equal(j.out, '{"hello":"world"}');
  assert.ok(j.hdrList.includes("x-shim"));

  const u = await call("GET", "/u/42?q=1");
  assert.equal(u.status, 200);
  assert.equal(u.out, "id=42");

  const ck = await call("GET", "/cookies");
  assert.equal(ck.status, 200);
  const setCookies = [];
  for (let i = 0; i + 1 < ck.hdrList.length; i += 2) {
    if (ck.hdrList[i] === "set-cookie") setCookies.push(ck.hdrList[i + 1]);
  }
  assert.deepEqual(setCookies, ["a=1", "b=2"]);

  const e = await call("POST", "/echo", "hello");
  assert.equal(e.status, 200);
  assert.equal(e.out, "body=hello");

  const m = await call("GET", "/missing");
  assert.equal(m.status, 404);

  const nf = await call("GET", "/echo");
  assert.equal(nf.status, 405);
  const allow = [];
  for (let i = 0; i + 1 < nf.hdrList.length; i += 2) {
    if (nf.hdrList[i] === "allow") allow.push(nf.hdrList[i + 1]);
  }
  assert.ok(allow.length > 0);
});

// c.res view (issue #57): same typed view on the Node surface, backed by
// NodeResponseSink's tracked status + header table.
test("c.res view: status reflects a 404 after next() settles (node)", async () => {
  const app = createRouter();
  let seen = null;
  app.use("*", async (c, next) => {
    await next();
    seen = c.res.status;
  });
  app.get("/ok", (c) => c.text("ok"));
  const res = call(app, { url: "/missing" });
  assert.equal(res.statusCode, 404);
  // The async middleware's post-next() continuation runs on a microtask
  // after the sync call() returns.
  await new Promise((r) => setImmediate(r));
  assert.equal(seen, 404);
});

test("c.res view: header('content-type') reflects a json() write (node)", async () => {
  const app = createRouter();
  let ct = null;
  app.use("*", async (c, next) => {
    await next();
    ct = c.res.header("content-type");
  });
  app.get("/json", (c) => c.json({ ok: true }));
  call(app, { url: "/json" });
  await new Promise((r) => setImmediate(r));
  assert.equal(ct, "application/json; charset=utf-8");
});
