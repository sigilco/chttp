// Web Standards generated dispatch parity (contracts/route-contract-fetch.md):
// the emitted GenFetch arm must produce the same response shape through
// app.fetch as the Node-shaped GenDispatch arm produces through
// app.handler — status, headers, body. The module below is written in the
// exact shape the unplugin fetch emitter emits (emitfetch.ts); the
// emitter's own e2e covers generation, this suite covers the runtime
// contract the emitted module depends on.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRouter,
  GenDispatch,
  GenFetch,
  ReqView,
  Ctx,
  NodeResponseSink,
  FetchResponseSink,
  _guard,
  _buffer,
  _guardFetch,
  _bufferFetch,
  ROUTE_CONTRACT_VERSION,
} from "../dist/esm/index.js";

function dec(s) {
  try {
    return decodeURIComponent(String(s));
  } catch {
    return String(s);
  }
}

const ROUTES = [
  { method: "GET", path: "/json", segs: ["json"], idx: 0 },
  { method: "GET", path: "/user/:id", segs: ["user", ":id"], idx: 1 },
  { method: "GET", path: "/files/*", segs: ["files", "*"], idx: 2 },
  { method: "POST", path: "/echo", segs: ["echo"], idx: 3, needsBody: true },
];

// Node-arm dispatch in the emitted shape (contracts/route-contract.md).
class TestNodeDispatch extends GenDispatch {
  constructor(a) {
    super();
    this._a = a;
    this.ROUTE_CONTRACT_VERSION = ROUTE_CONTRACT_VERSION;
  }
  dispatch(req, res) {
    const m = String(req.method || "");
    const url = String(req.url || "/");
    let path = url;
    let qs = "";
    const qi = url.indexOf("?");
    if (qi >= 0) {
      path = String(url.slice(0, qi));
      qs = String(url.slice(qi + 1));
    }
    const segs = path.split("/");
    if (m === "GET") {
      if (segs.length === 2 && segs[1] === "json") {
        const rv = new ReqView(req, qs, path);
        const c = new Ctx(rv, new NodeResponseSink(res));
        _guard(res, c, () => this._a._chains[0](c));
        return true;
      }
      if (segs.length === 3 && segs[1] === "user") {
        const rv = new ReqView(req, qs, path);
        rv._seedPm(["id", dec(segs[2])]);
        const c = new Ctx(rv, new NodeResponseSink(res));
        _guard(res, c, () => this._a._chains[1](c));
        return true;
      }
      if (segs.length >= 3 && segs[1] === "files") {
        let t = "";
        for (let j = 2; j < segs.length; j += 1) {
          if (j > 2) t = t + "/";
          t = t + segs[j];
        }
        const rv = new ReqView(req, qs, path);
        rv._seedPm(["*", dec(t)]);
        const c = new Ctx(rv, new NodeResponseSink(res));
        _guard(res, c, () => this._a._chains[2](c));
        return true;
      }
      return false;
    }
    if (m === "POST") {
      if (segs.length === 2 && segs[1] === "echo") {
        const rv = new ReqView(req, qs, path);
        const c = new Ctx(rv, new NodeResponseSink(res));
        _buffer(req, res, c, () => this._a._chains[3](c));
        return true;
      }
      return false;
    }
    return false;
  }
}

// Fetch-arm dispatch in the emitted shape (contracts/route-contract-fetch.md).
class TestFetchDispatch extends GenFetch {
  constructor(a) {
    super();
    this._a = a;
    this.ROUTE_CONTRACT_VERSION = ROUTE_CONTRACT_VERSION;
  }
  async dispatchFetch(method, url, headers, webReq, body, _bodyU8, sink) {
    const m = String(method || "");
    const u = String(url || "/");
    let path = u;
    let qs = "";
    const qi = u.indexOf("?");
    if (qi >= 0) {
      path = String(u.slice(0, qi));
      qs = String(u.slice(qi + 1));
    }
    const segs = path.split("/");
    if (m === "GET") {
      if (segs.length === 2 && segs[1] === "json") {
        const rv = new ReqView(null, qs, path, u, m, headers === null ? undefined : headers);
        rv._seedPm([]);
        rv._setWeb(webReq);
        if (webReq !== null) rv.url = String(webReq.url);
        rv._setBody(body);
        const c = new Ctx(rv, sink);
        await _guardFetch(c, sink, () => this._a._chains[0](c));
        return true;
      }
      if (segs.length === 3 && segs[1] === "user") {
        const rv = new ReqView(null, qs, path, u, m, headers === null ? undefined : headers);
        rv._seedPm(["id", dec(segs[2])]);
        rv._setWeb(webReq);
        if (webReq !== null) rv.url = String(webReq.url);
        rv._setBody(body);
        const c = new Ctx(rv, sink);
        await _guardFetch(c, sink, () => this._a._chains[1](c));
        return true;
      }
      if (segs.length >= 3 && segs[1] === "files") {
        let t = "";
        for (let j = 2; j < segs.length; j += 1) {
          if (j > 2) t = t + "/";
          t = t + segs[j];
        }
        const rv = new ReqView(null, qs, path, u, m, headers === null ? undefined : headers);
        rv._seedPm(["*", dec(t)]);
        rv._setWeb(webReq);
        if (webReq !== null) rv.url = String(webReq.url);
        rv._setBody(body);
        const c = new Ctx(rv, sink);
        await _guardFetch(c, sink, () => this._a._chains[2](c));
        return true;
      }
      return false;
    }
    if (m === "POST") {
      if (segs.length === 2 && segs[1] === "echo") {
        const rv = new ReqView(null, qs, path, u, m, headers === null ? undefined : headers);
        rv._seedPm([]);
        rv._setWeb(webReq);
        if (webReq !== null) rv.url = String(webReq.url);
        const c = new Ctx(rv, sink);
        await _bufferFetch(c, sink, webReq, body, () => this._a._chains[3](c));
        return true;
      }
      return false;
    }
    return false;
  }
}

function makeApp() {
  const app = createRouter();
  app.get("/json", (c) => c.json({ hello: "world" }));
  app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/files/*", (c) => c.text(c.req.param("*") || ""));
  app.post("/echo", (c) => c.text(c.req.body()), { body: true });
  app.get("/runtime-only", (c) => c.text("rt"));
  app.notFound((c) => {
    c.status(404);
    c.text("nf");
  });
  return app;
}

test("fetch emit: status/headers/body parity with the Node arm", async () => {
  const app = makeApp();
  app.withDispatch(new TestNodeDispatch(app));
  app.withFetchDispatch(new TestFetchDispatch(app));

  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;

  const cases = [
    ["GET", "/json", null],
    ["GET", "/user/42", null],
    ["GET", "/files/a/b/c.txt", null],
    ["POST", "/echo", "hello-body"],
  ];
  for (const [method, path, reqBody] of cases) {
    const nr = await fetch("http://127.0.0.1:" + port + path, {
      method,
      body: reqBody === null ? undefined : reqBody,
    });
    const fr = await app.fetch(
      new Request("http://x" + path, {
        method,
        body: reqBody === null ? undefined : reqBody,
      }),
    );
    assert.equal(fr.status, nr.status, path + " status");
    assert.equal(await fr.text(), await nr.text(), path + " body");
    assert.equal(
      fr.headers.get("content-type"),
      nr.headers.get("content-type"),
      path + " content-type",
    );
  }
  srv.close();
});

test("fetch emit: decline falls through to _dispatchPrim (runtime route, 404, 405)", async () => {
  const app = makeApp();
  app.withFetchDispatch(new TestFetchDispatch(app));
  // a route the emit doesn't cover is answered by the runtime path
  const rt = await app.fetch(new Request("http://x/runtime-only"));
  assert.equal(rt.status, 200);
  assert.equal(await rt.text(), "rt");
  // unmatched path -> the app's notFound
  const nf = await app.fetch(new Request("http://x/nope"));
  assert.equal(nf.status, 404);
  assert.equal(await nf.text(), "nf");
  // path match + method miss -> 405 with Allow
  const na = await app.fetch(new Request("http://x/json", { method: "DELETE" }));
  assert.equal(na.status, 405);
  assert.equal(na.headers.get("allow"), "GET, HEAD");
});

test("fetch emit: fetchShim drives the same emitted dispatch (ELF parity)", async () => {
  const app = makeApp();
  app.withFetchDispatch(new TestFetchDispatch(app));
  const out = await new Promise((resolve) => {
    app.fetchShim("GET", "/user/99", null, "", (status, hdrList, body) => {
      resolve({ status, hdrList, body });
    });
  });
  assert.equal(out.status, 200);
  assert.equal(out.body, '{"id":"99"}');
  // seeded body path: fetchShim seeds non-GET/HEAD bodies
  const out2 = await new Promise((resolve) => {
    app.fetchShim("POST", "/echo", null, "shim-body", (status, hdrList, body) => {
      resolve({ status, body });
    });
  });
  assert.equal(out2.body, "shim-body");
});

test("fetch emit: lazy body buffering via _bufferFetch (webReq.text())", async () => {
  const app = makeApp();
  app.withFetchDispatch(new TestFetchDispatch(app));
  const res = await app.fetch(
    new Request("http://x/echo", { method: "POST", body: "streamed-body" }),
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "streamed-body");
});

test("streaming sink: writeHead+write+endStream produce a chunked ReadableStream", async () => {
  const app = createRouter();
  app.get("/sse", (c) => {
    c.sink.writeHead(200, ["content-type", "text/event-stream; charset=utf-8"]);
    c.sink.write("data: one\n\n");
    c.sent = true;
    setTimeout(() => {
      c.sink.write("data: two\n\n");
      c.sink.endStream();
    }, 5);
  });
  const res = await app.fetch(new Request("http://x/sse"));
  assert.ok(res.body instanceof ReadableStream, "body is a ReadableStream, not a buffered string");
  const chunks = [];
  const reader = res.body.getReader();
  const dec8 = new TextDecoder();
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(dec8.decode(r.value));
  }
  assert.deepEqual(chunks, ["data: one\n\n", "data: two\n\n"]);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
});

test("withFetchDispatch: contract-version drift guard", () => {
  const app = createRouter();
  assert.throws(
    () => app.withFetchDispatch({ dispatchFetch: () => false, ROUTE_CONTRACT_VERSION: 999 }),
    /contract version mismatch/,
  );
  // a missing stamp is accepted (predates versioning)
  app.withFetchDispatch({ dispatchFetch: async () => false });
});
