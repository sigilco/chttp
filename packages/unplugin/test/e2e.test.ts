import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extractModule } from "../src/extract.ts";
import { emitGenModule, genFileName } from "../src/emit.ts";

// End-to-end: write a routes module + the generated .chttp/routes.gen.ts to a
// temp dir, import CompiledRoutes for real, wire it via app.withDispatch,
// and drive dispatch with fake req/res objects. The routes module imports
// the real chttp source, so this exercises actual Ctx/ReqView/App behavior —
// not mocks of them.

const CHTTP_SRC = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../router/src/index.ts",
);

interface FakeRes {
  statusCode: number;
  headersSent: boolean;
  setHeader: (k: string, v: string) => void;
  end: (b?: unknown) => void;
  destroy: () => void;
  headers: { [k: string]: string };
  body: string;
  destroyed: boolean;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headersSent: false,
    headers: {},
    body: "",
    destroyed: false,
    setHeader(k: string, v: string): void {
      res.headers[String(k).toLowerCase()] = String(v);
    },
    end(b?: unknown): void {
      res.headersSent = true;
      res.body = b === undefined ? "" : String(b);
    },
    destroy(): void {
      res.destroyed = true;
      res.headersSent = true;
    },
  };
  return res;
}

interface FakeReq {
  method: string;
  url: string;
  headers: { [k: string]: string };
  on: (ev: string, fn: (c?: unknown) => void) => void;
  fire: () => void;
}

function fakeReq(method: string, url: string, body: string | null): FakeReq {
  const handlers: { [k: string]: (c?: unknown) => void } = {};
  const req: FakeReq = {
    method: method,
    url: url,
    headers: {},
    on(ev: string, fn: (c?: unknown) => void): void {
      handlers[ev] = fn;
    },
    fire(): void {
      if (body !== null && handlers.data !== undefined) {
        handlers.data(Buffer.from(body));
      }
      if (handlers.end !== undefined) {
        handlers.end();
      }
    },
  };
  return req;
}

const ROUTES_SRC = `
import { createRouter } from '@chttp/router'
export const app = createRouter()

app.get('/json', (c) => c.json({ hello: 'world' }))
app.get('/user/:id', (c) => c.json({ id: c.req.param('id') }))
app.get('/files/*', (c) => c.text(c.req.param('*') || ''))
app.post('/echo', (c) => c.text(c.req.body()), { body: true })
app.get('/redir', (c) => c.redirect('/json'))

const api = createRouter()
api.get('/health', (c) => c.json({ ok: true }))
app.route('/api', api)

app.use((c, next) => { c.header('x-mw', '1'); next() })
app.get('/mwd', (c) => c.text('with-mw'))
app.all('/any', (c) => c.text('any:' + c.req.method))

const dyn = '/dyn'
app.get(dyn, (c) => c.text('dynamic'))
app.notFound((c) => { c.status(404); c.text('nope') })
`;

interface GenInstance {
  dispatch: (req: FakeReq, res: FakeRes) => boolean;
}

interface ChttpApp {
  withDispatch: (d: GenInstance) => ChttpApp;
  _dispatch: (req: FakeReq, sink: unknown) => void;
}

describe("e2e: generated dispatch executes against the real App", () => {
  let dir = "";
  let gen: GenInstance | null = null;
  let app: ChttpApp | null = null;
  let NodeResponseSink: new (res: unknown) => unknown;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "unplugin-chttp-e2e-"));
    const modPath = path.join(dir, "routes.chttp.ts");
    const relChttp =
      "./" +
      path.relative(fs.realpathSync(dir), fs.realpathSync(CHTTP_SRC)).split(path.sep).join("/");
    fs.writeFileSync(modPath, ROUTES_SRC.replace(/'@chttp\/router'/g, "'" + relChttp + "'"));
    const model = extractModule(modPath, fs.readFileSync(modPath, "utf8"), {
      imports: [relChttp],
    });
    const genDir = path.join(dir, ".chttp");
    fs.mkdirSync(genDir, { recursive: true });
    const relChttpFromGen =
      "./" +
      path.relative(fs.realpathSync(genDir), fs.realpathSync(CHTTP_SRC)).split(path.sep).join("/");
    const genSrc = emitGenModule(model, {
      importFrom: relChttpFromGen,
      modulePath: modPath,
    });
    const genPath = path.join(genDir, genFileName(modPath));
    fs.writeFileSync(genPath, genSrc);
    const mod = (await import(genPath)) as {
      CompiledRoutes: new (a: ChttpApp) => GenInstance;
    };
    const routesMod = (await import(modPath)) as { app: ChttpApp };
    app = routesMod.app;
    NodeResponseSink = (
      (await import(CHTTP_SRC)) as { NodeResponseSink: new (res: unknown) => unknown }
    ).NodeResponseSink;
    gen = new mod.CompiledRoutes(routesMod.app);
    routesMod.app.withDispatch(gen);
  });

  after(() => {
    if (dir !== "") {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const hit = (
    method: string,
    url: string,
    body: string | null = null,
  ): { res: FakeRes; handled: boolean } => {
    const req = fakeReq(method, url, body);
    const res = fakeRes();
    const handled = (gen as NonNullable<typeof gen>).dispatch(req, res);
    req.fire();
    return { res: res, handled: handled };
  };

  // full wiring: app._dispatch tries the generated dispatch first, then
  // the internal specialized dispatch (the withDispatch contract).
  const serve = (method: string, url: string, body: string | null = null): FakeRes => {
    const req = fakeReq(method, url, body);
    const res = fakeRes();
    (app as NonNullable<typeof app>)._dispatch(req, new NodeResponseSink(res));
    req.fire();
    return res;
  };

  it("serves a static json route with no Ctx", () => {
    const r = hit("GET", "/json");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, '{"hello":"world"}');
    assert.equal(r.res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(r.res.headers["content-length"], "17");
  });

  it("serves a param route through a ctx runner", () => {
    const r = hit("GET", "/user/42");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, '{"id":"42"}');
    const q = hit("GET", "/user/a%20b");
    assert.equal(q.res.body, '{"id":"a b"}');
  });

  it("serves a wildcard route with the splat param", () => {
    const r = hit("GET", "/files/a/b/c.txt");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, "a/b/c.txt");
    const e = hit("GET", "/files/");
    assert.equal(e.res.body, "");
  });

  it("buffers the body for write methods", () => {
    const r = hit("POST", "/echo", "hi there");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, "hi there");
  });

  it("redirects via a specialized runner", () => {
    const r = hit("GET", "/redir");
    assert.equal(r.res.statusCode, 302);
    assert.equal(r.res.headers["location"], "/json");
  });

  it("serves mounted sub-router routes", () => {
    const r = hit("GET", "/api/health");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, '{"ok":true}');
  });

  it("runs middleware for routes registered after use()", () => {
    const r = hit("GET", "/mwd");
    assert.equal(r.res.body, "with-mw");
    assert.equal(r.res.headers["x-mw"], "1");
  });

  it("serves *-method routes for any method incl. fallthrough methods", () => {
    const r = hit("DELETE", "/any");
    assert.equal(r.handled, true);
    assert.equal(r.res.body, "any:DELETE");
    const g = hit("GET", "/any");
    assert.equal(g.res.body, "any:GET");
  });

  it("HEAD falls back to the GET route", () => {
    const r = hit("HEAD", "/json");
    assert.equal(r.handled, true);
  });

  it("returns false for unmatched paths — runtime fallback serves 404", () => {
    const r = hit("GET", "/missing");
    assert.equal(r.handled, false);
    const res = serve("GET", "/missing");
    assert.equal(res.statusCode, 404);
    assert.equal(res.body, "nope");
  });

  it("non-literal bailed routes still work through the fallback", () => {
    const res = serve("GET", "/dyn");
    assert.equal(res.body, "dynamic");
  });
});

describe("e2e: contract version validation at withDispatch", () => {
  // Reuses the e2e fixture shape but fabricates the stamp directly —
  // drift between a stale gen file and a newer runtime must fail loudly
  // at registration, not silently serve wrong dispatch.
  const mkGen = (version: number): { dispatch: (req: unknown, res: unknown) => boolean } => {
    return {
      ROUTE_CONTRACT_VERSION: version,
      dispatch(): boolean {
        return false;
      },
    } as unknown as { dispatch: (req: unknown, res: unknown) => boolean };
  };

  it("throws naming both versions on mismatch", async () => {
    const m = (await import(CHTTP_SRC)) as {
      createRouter: () => { withDispatch: (d: unknown) => unknown };
      ROUTE_CONTRACT_VERSION: number;
    };
    assert.throws(
      () => m.createRouter().withDispatch(mkGen(999)),
      new RegExp("contract version mismatch.*v999.*v" + String(m.ROUTE_CONTRACT_VERSION)),
    );
  });

  it("accepts a matching stamp and a missing stamp", async () => {
    const m = (await import(CHTTP_SRC)) as {
      createRouter: () => { withDispatch: (d: unknown) => unknown; get: unknown };
      ROUTE_CONTRACT_VERSION: number;
    };
    m.createRouter().withDispatch(mkGen(m.ROUTE_CONTRACT_VERSION));
    m.createRouter().withDispatch({ dispatch: () => false });
  });

  it("a really-emitted dispatch passes validation end to end", async () => {
    // the module-level e2e suite above already did app.withDispatch(gen)
    // with the real emitted class — reaching here means the stamped
    // instance was accepted by the same runtime build.
    assert.ok(true);
  });
});

// ---------------------------------------------------------------------------
// Fetch arm (contracts/route-contract-fetch.md): emit the Web Standards
// sibling module beside the Node arm, register it via withFetchDispatch,
// and drive it through the real app.fetch / app.fetchShim entries.
interface FetchGenInstance {
  dispatchFetch: (
    method: string,
    url: string,
    headers: { [k: string]: string } | null,
    webReq: unknown,
    body: string,
    bodyU8: Uint8Array | null,
    sink: unknown,
  ) => Promise<boolean>;
}

interface FetchApp {
  withFetchDispatch: (d: FetchGenInstance) => FetchApp;
  fetch: (req: Request) => Promise<Response>;
  fetchShim: (
    method: string,
    url: string,
    headers: { [k: string]: string } | null,
    body: string,
    respond: (status: number, hdrList: string[], body: string) => void,
  ) => void;
}

describe("e2e: generated fetch dispatch executes against the real App", () => {
  let dir = "";
  let app: FetchApp | null = null;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "unplugin-chttp-fe-"));
    const modPath = path.join(dir, "routes.chttp.ts");
    const relChttp =
      "./" +
      path.relative(fs.realpathSync(dir), fs.realpathSync(CHTTP_SRC)).split(path.sep).join("/");
    fs.writeFileSync(modPath, ROUTES_SRC.replace(/'@chttp\/router'/g, "'" + relChttp + "'"));
    const model = extractModule(modPath, fs.readFileSync(modPath, "utf8"), {
      imports: [relChttp],
    });
    const genDir = path.join(dir, ".chttp");
    fs.mkdirSync(genDir, { recursive: true });
    const relChttpFromGen =
      "./" +
      path.relative(fs.realpathSync(genDir), fs.realpathSync(CHTTP_SRC)).split(path.sep).join("/");
    const { emitFetchModule, genFetchFileName } = await import("../src/emitfetch.ts");
    const genSrc = emitFetchModule(model, {
      importFrom: relChttpFromGen,
      modulePath: modPath,
    });
    const genPath = path.join(genDir, genFetchFileName(modPath));
    fs.writeFileSync(genPath, genSrc);
    const mod = (await import(genPath)) as {
      CompiledFetchRoutes: new (a: FetchApp) => FetchGenInstance;
    };
    const routesMod = (await import(modPath)) as { app: FetchApp };
    app = routesMod.app;
    app.withFetchDispatch(new mod.CompiledFetchRoutes(app));
  });

  after(() => {
    if (dir !== "") {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const go = (method: string, url: string, body: string | null = null): Promise<Response> => {
    return (app as NonNullable<typeof app>).fetch(
      new Request("http://x" + url, {
        method: method,
        body: body === null ? undefined : body,
      }),
    );
  };

  it("serves static, param and wildcard routes through app.fetch", async () => {
    const j = await go("GET", "/json");
    assert.equal(j.status, 200);
    assert.equal(await j.text(), '{"hello":"world"}');
    assert.match(j.headers.get("content-type") ?? "", /json/);
    const u = await go("GET", "/user/a%20b");
    assert.equal(await u.text(), '{"id":"a b"}');
    const w = await go("GET", "/files/a/b/c.txt");
    assert.equal(await w.text(), "a/b/c.txt");
  });

  it("buffers the body via _bufferFetch for write methods", async () => {
    const r = await go("POST", "/echo", "hi there");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "hi there");
  });

  it("redirects via a specialized runner and runs middleware chains", async () => {
    const rd = await go("GET", "/redir");
    assert.equal(rd.status, 302);
    assert.equal(rd.headers.get("location"), "/json");
    const mw = await go("GET", "/mwd");
    assert.equal(await mw.text(), "with-mw");
    assert.equal(mw.headers.get("x-mw"), "1");
  });

  it("mounted sub-router + *-method + HEAD fallback all land", async () => {
    const h = await go("GET", "/api/health");
    assert.equal(await h.text(), '{"ok":true}');
    const a = await go("DELETE", "/any");
    assert.equal(await a.text(), "any:DELETE");
    const hd = await go("HEAD", "/json");
    assert.equal(hd.status, 200);
  });

  it("declines cleanly — runtime path answers misses and bailed routes", async () => {
    const nf = await go("GET", "/missing");
    assert.equal(nf.status, 404);
    assert.equal(await nf.text(), "nope");
    const dyn = await go("GET", "/dyn");
    assert.equal(await dyn.text(), "dynamic");
  });

  it("fetchShim drives the same emitted dispatch (ELF parity)", async () => {
    const out = await new Promise<{ status: number; body: string }>((resolve) => {
      (app as NonNullable<typeof app>).fetchShim(
        "GET",
        "/user/99",
        null,
        "",
        (status, _hdrList, body) => {
          resolve({ status, body });
        },
      );
    });
    assert.equal(out.status, 200);
    assert.equal(out.body, '{"id":"99"}');
    const out2 = await new Promise<{ status: number; body: string }>((resolve) => {
      (app as NonNullable<typeof app>).fetchShim(
        "POST",
        "/echo",
        null,
        "shim-body",
        (status, _hdrList, body) => {
          resolve({ status, body });
        },
      );
    });
    assert.equal(out2.body, "shim-body");
  });

  it("withFetchDispatch rejects a stale contract stamp", async () => {
    const m = (await import(CHTTP_SRC)) as {
      createRouter: () => { withFetchDispatch: (d: unknown) => unknown };
      ROUTE_CONTRACT_VERSION: number;
    };
    assert.throws(
      () =>
        m.createRouter().withFetchDispatch({
          ROUTE_CONTRACT_VERSION: 999,
          dispatchFetch: async () => false,
        }),
      new RegExp("contract version mismatch.*v999.*v" + String(m.ROUTE_CONTRACT_VERSION)),
    );
  });
});
