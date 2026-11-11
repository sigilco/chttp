import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractModule } from "../src/extract.ts";

const SRC_BASIC = `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/json', (c) => c.json({ hello: 'world' }))
app.get('/user/:id', (c) => c.json({ id: c.req.param('id') }))
app.get('/files/*', (c) => c.text(c.req.param('*') || ''))
app.post('/echo', (c) => c.text(c.req.body()), { body: true })
`;

describe("extractModule basics", () => {
  it("extracts literal registrations with kinds and indices", () => {
    const m = extractModule("routes.chttp.ts", SRC_BASIC);
    assert.equal(m.fatal, "");
    assert.equal(m.app?.varName, "app");
    assert.equal(m.app?.importKind, "named");
    const paths = m.routes.map((r) => r.method + " " + r.path);
    assert.deepEqual(paths, ["GET /json", "GET /user/:id", "GET /files/*", "POST /echo"]);
    assert.deepEqual(
      m.routes.map((r) => r.handlerIdx),
      [0, 1, 2, 3],
    );
    assert.equal(m.routes[0].segs[0].kind, 0);
    assert.equal(m.routes[1].segs[1].kind, 1);
    assert.equal(m.routes[1].segs[1].lit, "id");
    assert.equal(m.routes[2].segs[1].kind, 2);
    assert.equal(m.routes[3].needsBody, true);
    assert.equal(m.routes[0].needsBody, false);
  });

  it("specializes literal send-chains", () => {
    const m = extractModule("routes.chttp.ts", SRC_BASIC);
    const json = m.routes[0].staticSend;
    assert.ok(json);
    assert.equal(json.body, '{"hello":"world"}');
    assert.equal(json.contentType, "application/json; charset=utf-8");
    assert.equal(json.status, 200);
    assert.equal(m.routes[1].staticSend, null); // uses c.req.param
    assert.equal(m.routes[2].staticSend, null);
    assert.equal(m.routes[3].staticSend, null);
  });

  it("handles status/header chains and redirect", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.post('/made', (c) => c.status(201).header('x-a', 'b').json({ ok: true }))
app.get('/redir', (c) => c.redirect('/json'))
app.get('/redir2', (c) => c.redirect('/x', 301))
app.get('/t', (c) => c.text('plain'))
app.get('/raw', (c) => c.status(201).rawJson('{"a":1}'))
`,
    );
    const made = m.routes[0].staticSend;
    assert.ok(made);
    assert.equal(made.status, 201);
    assert.deepEqual(made.headers, [["x-a", "b"]]);
    assert.equal(made.body, '{"ok":true}');
    assert.equal(m.routes[0].needsBody, false);
    const r = m.routes[1].staticSend;
    assert.ok(r);
    assert.equal(r.location, "/json");
    assert.equal(r.status, 302);
    const r2 = m.routes[2].staticSend;
    assert.equal(r2?.status, 301);
    assert.equal(m.routes[3].staticSend?.body, "plain");
    const raw = m.routes[4].staticSend;
    assert.ok(raw);
    assert.equal(raw.status, 201);
    assert.equal(raw.contentType, "application/json; charset=utf-8");
    assert.equal(raw.body, '{"a":1}');
  });

  it("decomposes fluent chains and app.on", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/a', (c) => c.text('a')).post('/b', (c) => c.text('b'))
app.on('DELETE', '/c', (c) => c.text('c'))
`,
    );
    assert.deepEqual(
      m.routes.map((r) => r.method + " " + r.path),
      ["GET /a", "POST /b", "DELETE /c"],
    );
  });
});

describe("middleware + mounts", () => {
  it("snapshots middleware depth at registration", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/early', (c) => c.text('e'))
app.use((c, next) => { c.header('x', '1'); next() })
app.get('/late', (c) => c.text('l'))
`,
    );
    assert.equal(m.routes[0].hasMw, false);
    assert.ok(m.routes[0].staticSend);
    assert.equal(m.routes[1].hasMw, true);
    assert.equal(m.routes[1].staticSend, null);
  });

  it("replays same-module sub-router mounts with prefix", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/top', (c) => c.text('t'))
const api = createRouter()
api.get('/health', (c) => c.json({ ok: true }))
api.get('/deep/:id', (c) => c.text(c.req.param('id') || ''))
app.route('/api', api)
app.get('/after', (c) => c.text('a'))
`,
    );
    assert.deepEqual(
      m.routes.map((r) => r.method + " " + r.path + "@" + String(r.handlerIdx)),
      // mountRoutes() DFS pops children last-first: '/deep/:id' is
      // replayed into the app before '/health' — matching App._fns order
      ["GET /top@0", "GET /api/deep/:id@1", "GET /api/health@2", "GET /after@3"],
    );
    assert.equal(m.routes[1].segs[0].lit, "api");
    assert.equal(m.routes[1].segs[2].lit, "id");
  });

  it("mount of an unknown router marks later indices uncertain", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
import other from './other.ts'
export const app = createRouter()
app.get('/before', (c) => c.text('b'))
app.route('/x', other)
app.get('/after', (c) => c.json({ id: c.req.query('x') }))
app.get('/also-after', (c) => c.json({ ok: true }))
`,
    );
    assert.equal(m.routes[0].handlerIdx, 0);
    assert.equal(m.routes[0].emit, true);
    assert.equal(m.routes[1].handlerIdx, -1);
    assert.equal(m.routes[1].emit, false); // ctx route after uncertainty
    // static-send specialization is index-free, still emitted
    assert.equal(m.routes[2].emit, true);
    assert.ok(m.routes[2].staticSend);
    assert.ok(m.warnings.some((w) => w.includes("mount target")));
  });
});

describe("bail rules", () => {
  it("non-literal path consumes an index but stays runtime-only", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
const dyn = '/dyn'
app.get('/a', (c) => c.text('a'))
app.get(dyn, (c) => c.text('d'))
app.get('/b', (c) => c.text('b'))
`,
    );
    assert.deepEqual(
      m.routes.map((r) => r.path),
      ["/a", "/b"],
    );
    assert.deepEqual(
      m.routes.map((r) => r.handlerIdx),
      [0, 2],
    );
    assert.ok(m.warnings.some((w) => w.includes("non-literal path")));
  });

  it("declared multipart stays runtime-only (declared-multipart rule)", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/a', (c) => c.text('a'))
app.post('/upload', (c) => c.json({ t: c.req.field('title') }), {
  multipart: { maxFileBytes: 1024 },
})
app.post('/upload2', (c) => c.text('x'), { multipart: {} })
app.get('/b', (c) => c.text('b'))
`,
    );
    assert.deepEqual(
      m.routes.map((r) => r.path),
      ["/a", "/b"],
    );
    // indices consumed: /a is 0, /upload 1, /upload2 2, /b is 3
    assert.deepEqual(
      m.routes.map((r) => r.handlerIdx),
      [0, 3],
    );
    assert.ok(m.warnings.some((w) => w.includes("multipart")));
  });

  it("conditional registration marks later routes uncertain", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/before', (c) => c.text('b'))
if (process.env.X) {
  app.get('/cond', (c) => c.text('c'))
}
app.get('/after', (c) => c.text('a'))
`,
    );
    assert.equal(m.routes.length, 2);
    assert.equal(m.routes[0].emit, true);
    assert.equal(m.routes[1].emit, true); // static-send, index-free
    assert.ok(m.warnings.some((w) => w.includes("nested/conditional")));
  });

  it("conditional ctx routes after uncertainty are not emitted", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
if (process.env.X) {
  app.get('/cond', (c) => c.text('c'))
}
app.get('/after', (c) => c.json({ id: c.req.query('x') }))
`,
    );
    assert.equal(m.routes[0].emit, false);
    assert.equal(m.routes[0].bailReason !== "", true);
  });

  it("non-exported router produces a stub model", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
const app = createRouter()
app.get('/a', (c) => c.text('a'))
`,
    );
    assert.equal(m.app, null);
    assert.ok(m.warnings.some((w) => w.includes("stub dispatch")));
  });

  it("default export is picked up", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
const router = createRouter()
router.get('/a', (c) => c.text('a'))
export default router
`,
    );
    assert.equal(m.app?.importKind, "default");
    assert.equal(m.app?.varName, "router");
    assert.equal(m.routes.length, 1);
  });

  it("invalid patterns warn but keep the index consumed", () => {
    const m = extractModule(
      "routes.chttp.ts",
      `
import { createRouter } from '@chttp/router'
export const app = createRouter()
app.get('/mid/*/x', (c) => c.text('m'))
app.get('/ok', (c) => c.text('o'))
`,
    );
    assert.equal(m.routes.length, 1);
    assert.equal(m.routes[0].handlerIdx, 1);
    assert.ok(m.warnings.some((w) => w.includes("wildcard must be the last")));
  });
});
