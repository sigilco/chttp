// Codegen: ModuleModel -> .gen.fetch.ts source text (Web Standards arm).
//
// The emitted module satisfies contracts/route-contract-fetch.md: a
// `CompiledFetchRoutes` class extending GenFetch, registered via
// `app.withFetchDispatch(...)`. It is the fetch-surface twin of emit.ts —
// same matcher shape, but dispatchFetch takes the normalized primitives
// _dispatchPrim consumes (method, url, headers, webReq, seeded body,
// sink) instead of IncomingMessage/ServerResponse, so the module runs
// identically under app.fetch (a real Request through the WebReqView
// view) and app.fetchShim (plain primitives, webReq === null).
//
// The same subset rules apply as to src/index.ts and emit.ts: full-shape
// record literals, handlers through App._chains, indexed loops, concrete
// types. The app instance arrives through the constructor, never an
// import (SC1090 — see emit.ts for the full note).

import * as path from "node:path";
import type { ModuleModel, RouteSpec, StaticSend } from "./model.ts";
import { METHOD_ORDER, WRITE_METHODS } from "./model.ts";
import { ROUTE_CONTRACT_VERSION } from "./contract.ts";

const J = JSON.stringify;

// '<dir>/routes.chttp.ts' -> 'routes.gen.fetch.ts'
export function genFetchFileName(modulePath: string): string {
  const base = path.basename(modulePath);
  const stem = base
    .replace(/\.chttp\.(ts|js|mts|mjs|cts|cjs)$/i, "")
    .replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
  return stem + ".gen.fetch.ts";
}

function routeKind(r: RouteSpec): string {
  let kind = "static";
  for (const s of r.segs) {
    if (s.kind === 2) {
      return "wildcard";
    }
    if (s.kind === 1) {
      kind = "param";
    }
  }
  return kind;
}

// Same precedence rule as the Node emit: at the first segment position
// whose KIND differs, static < param < wildcard; same-kind positions
// fall back to registration order for determinism.
function segCmp(a: RouteSpec, b: RouteSpec): number {
  const n = a.segs.length < b.segs.length ? a.segs.length : b.segs.length;
  for (let i = 0; i < n; i++) {
    const d = a.segs[i].kind - b.segs[i].kind;
    if (d !== 0) {
      return d;
    }
  }
  return a.registered - b.registered;
}

function methodRank(r: RouteSpec, m: string): number {
  if (r.method === m) {
    return 0;
  }
  if (r.method === "*") {
    return 1;
  }
  return 2; // GET acting as HEAD fallback
}

// Literal send-chains compile to straight sink writes — no Ctx, no chain.
// Mirrors emit.ts's res.* calls onto the sink surface: setStatus +
// setHeader pairs + writeBody. Redirects end with an empty writeBody so
// `sent` is set (a bare header commit would look like a hang upstream).
function emitStaticRunner(name: string, s: StaticSend): string {
  const lines: string[] = [];
  lines.push("function " + name + "(sink: FetchResponseSink): void {");
  lines.push("  try {");
  lines.push("    sink.setStatus(" + String(s.status) + ")");
  for (const h of s.headers) {
    lines.push("    sink.setHeader(" + J(h[0]) + ", " + J(h[1]) + ")");
  }
  if (s.location !== "") {
    lines.push('    sink.setHeader("location", ' + J(s.location) + ")");
    lines.push('    sink.writeBody("")');
  } else {
    lines.push('    sink.setHeader("content-type", ' + J(s.contentType) + ")");
    const len = Buffer.byteLength(s.body, "utf8");
    lines.push('    sink.setHeader("content-length", ' + J(String(len)) + ")");
    lines.push("    sink.writeBody(" + J(s.body) + ")");
  }
  lines.push("  } catch (e) {");
  lines.push("    __chttpSend500(sink)");
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}

// Ctx routes build ReqView/Ctx through the fetch contract surface and run
// the composed middleware+handler at App._chains[idx]. The ReqView is
// constructed exactly like _dispatchPrim constructs it: raw === null (the
// fetch arm), url/method/headers stub args, _setWeb for c.req.raw, and
// the absolute url overwrite for Hono parity. The seeded body (fetchShim)
// is always installed — _dispatchPrim does the same unconditionally so
// undeclared routes see it identically.
function emitCtxRunner(name: string, r: RouteSpec): string {
  const idx = String(r.handlerIdx);
  const lines: string[] = [];
  lines.push(
    "function " +
      name +
      "(a: App, m: string, url: string, pm: string[], qs: string, path: string, headers: Record<string, string> | null, webReq: WebReqView | null, body: string, sink: FetchResponseSink): Promise<void> {",
  );
  lines.push(
    "  const rv = new ReqView(null, qs, path, url, m, headers === null ? undefined : headers)",
  );
  lines.push("  rv._seedPm(pm)");
  lines.push("  rv._setWeb(webReq)");
  lines.push("  if (webReq !== null) {");
  lines.push("    rv.url = String(webReq.url)");
  lines.push("  }");
  lines.push("  const c = new Ctx(rv, sink)");
  // The closures MUST return the chain result — same settle rule as the
  // Node emit (_guardFetch/_bufferFetch drain it through runChainPromise;
  // a dropped return would unhandled-reject and hang the response).
  const chain = "a._chains[" + idx + "](c)";
  const guarded = "_guardFetch(c, sink, function (): unknown { return " + chain + " })";
  const buffered =
    "_bufferFetch(c, sink, webReq, body, function (): unknown { return " + chain + " })";
  if (r.needsBody) {
    if (r.method === "*") {
      lines.push('  if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {');
      lines.push("    return " + buffered);
      lines.push("  }");
      lines.push("  rv._setBody(body)");
      lines.push("  return " + guarded);
    } else if (WRITE_METHODS[r.method] === true) {
      lines.push("  return " + buffered);
    } else {
      lines.push("  rv._setBody(body)");
      lines.push("  return " + guarded);
    }
  } else {
    lines.push("  rv._setBody(body)");
    lines.push("  return " + guarded);
  }
  lines.push("}");
  return lines.join("\n");
}

// The match check + runner call for one route inside a method section —
// same matcher text as the Node emit; ctx runners are awaited (their
// Promise resolves once the response has settled into the sink).
function emitCheck(r: RouteSpec, runner: string, ind: string): string {
  const conds: string[] = [];
  let wildcardIdx = -1;
  const minLen = r.segs.length + 1;
  for (let i = 0; i < r.segs.length; i++) {
    const s = r.segs[i];
    if (s.kind === 2) {
      wildcardIdx = i;
    }
  }
  if (wildcardIdx >= 0) {
    conds.push("segs.length >= " + String(wildcardIdx + 2));
  } else {
    conds.push("segs.length === " + String(minLen));
  }
  for (let i = 0; i < r.segs.length; i++) {
    const s = r.segs[i];
    if (s.kind === 0) {
      conds.push("segs[" + String(i + 1) + "] === " + J(s.lit));
    }
  }
  const out: string[] = [];
  out.push(ind + "if (" + conds.join(" && ") + ") {");
  if (r.staticSend !== null) {
    out.push(ind + "  " + runner + "(sink)");
    out.push(ind + "  return true");
    out.push(ind + "}");
    return out.join("\n");
  }
  const pmParts: string[] = [];
  let needsTail = false;
  let tailStart = 0;
  for (let i = 0; i < r.segs.length; i++) {
    const s = r.segs[i];
    if (s.kind === 1) {
      pmParts.push(J(s.lit), "dec(segs[" + String(i + 1) + "])");
    } else if (s.kind === 2) {
      needsTail = true;
      tailStart = i + 1;
      pmParts.push(J("*"), "dec(t)");
    }
  }
  if (needsTail) {
    out.push(ind + "  let t = " + J(""));
    out.push(ind + "  for (let j = " + String(tailStart) + "; j < segs.length; j += 1) {");
    out.push(ind + "    if (j > " + String(tailStart) + ") {");
    out.push(ind + '      t = t + "/"');
    out.push(ind + "    }");
    out.push(ind + "      t = t + segs[j]");
    out.push(ind + "  }");
  }
  const pm = pmParts.length === 0 ? "[]" : "[" + pmParts.join(", ") + "]";
  out.push(
    ind +
      "  await " +
      runner +
      "(this._a, m, u, " +
      pm +
      ", qs, path, headers, webReq, body, sink)",
  );
  out.push(ind + "  return true");
  out.push(ind + "}");
  return out.join("\n");
}

export function emitFetchModule(model: ModuleModel, opts: { importFrom: string }): string {
  const out: string[] = [];
  out.push("// GENERATED by unplugin-chttp — do not edit.");
  out.push("// Source: " + path.basename(model.fileName));
  out.push("// Web Standards arm — satisfies contracts/route-contract-fetch.md.");
  out.push("export const ROUTE_CONTRACT_VERSION = " + String(ROUTE_CONTRACT_VERSION) + ";");
  const emitted = model.routes.filter((r) => r.emit);
  const dropped = model.routes.filter((r) => !r.emit);
  out.push(
    "// " +
      String(emitted.length) +
      " route(s) lowered, " +
      String(dropped.length) +
      " left to the runtime path.",
  );
  for (const w of model.warnings) {
    out.push("// warning: " + w);
  }
  out.push("");

  const header =
    "export class CompiledFetchRoutes extends GenFetch {\n" +
    "  private _a: App\n" +
    "  ROUTE_CONTRACT_VERSION = " +
    String(ROUTE_CONTRACT_VERSION) +
    "\n" +
    "  constructor(a: App) {\n" +
    "    super()\n" +
    "    this._a = a\n" +
    "  }\n" +
    "  async dispatchFetch(\n" +
    "    method: string,\n" +
    "    url: string,\n" +
    "    headers: Record<string, string> | null,\n" +
    "    webReq: WebReqView | null,\n" +
    "    body: string,\n" +
    "    bodyU8: Uint8Array | null,\n" +
    "    sink: FetchResponseSink,\n" +
    "  ): Promise<boolean> {\n";

  if (model.app === null || model.fatal !== "") {
    // stub: compiles everywhere, declines every request to the runtime path
    out.push("import { GenFetch } from " + J(opts.importFrom));
    out.push("import type { App, FetchResponseSink, WebReqView } from " + J(opts.importFrom));
    out.push("");
    out.push("export interface ChttpRouteEntry {");
    out.push("  method: string");
    out.push("  path: string");
    out.push("  kind: string");
    out.push("  handlerIdx: number");
    out.push("  needsBody: boolean");
    out.push("}");
    out.push("");
    out.push("export const routeTable: ChttpRouteEntry[] = []");
    out.push("");
    out.push(header);
    out.push("    return false");
    out.push("  }");
    out.push("}");
    out.push("");
    return out.join("\n");
  }

  const ctxEmitted = emitted.filter((r) => r.staticSend === null);
  const needCtx = ctxEmitted.length > 0;
  const needBuffer = ctxEmitted.some(
    (r) => r.needsBody && (r.method === "*" || WRITE_METHODS[r.method] === true),
  );
  const needDec = ctxEmitted.some((r) => r.segs.some((s) => s.kind !== 0));
  const members: string[] = ["GenFetch"];
  if (needCtx) {
    members.push("ReqView");
    members.push("Ctx");
    members.push("_guardFetch");
  }
  if (needBuffer) {
    members.push("_bufferFetch");
  }
  if (needDec) {
    members.push("dec");
  }
  out.push("import { " + members.join(", ") + " } from " + J(opts.importFrom));
  out.push("import type { App, FetchResponseSink, WebReqView } from " + J(opts.importFrom));
  out.push("");

  out.push("export interface ChttpRouteEntry {");
  out.push("  method: string");
  out.push("  path: string");
  out.push("  kind: string");
  out.push("  handlerIdx: number");
  out.push("  needsBody: boolean");
  out.push("}");
  out.push("");
  out.push("export const routeTable: ChttpRouteEntry[] = [");
  for (const r of emitted) {
    out.push(
      "  { method: " +
        J(r.method) +
        ", path: " +
        J(r.path) +
        ", kind: " +
        J(routeKind(r)) +
        ", handlerIdx: " +
        String(r.handlerIdx) +
        ", needsBody: " +
        String(r.needsBody) +
        " },",
    );
  }
  out.push("]");
  out.push("");

  // 500 through the same sink members the runners use — writeBody sets
  // `sent` so the settle bookkeeping stays consistent.
  out.push("function __chttpSend500(sink: FetchResponseSink): void {");
  out.push("  try {");
  out.push("    if (sink.isHeadersSent()) {");
  out.push("      sink.destroy()");
  out.push("    } else {");
  out.push("      sink.setStatus(500)");
  out.push('      sink.setHeader("content-type", "text/plain; charset=UTF-8")');
  out.push('      sink.setHeader("content-length", "21")');
  out.push('      sink.writeBody("Internal Server Error")');
  out.push("    }");
  out.push("  } catch (e) {");
  out.push("    sink.destroy()");
  out.push("  }");
  out.push("}");
  out.push("");

  const runnerNames = new Map<RouteSpec, string>();
  let n = 0;
  for (const r of emitted) {
    const name = "run" + String(n);
    n += 1;
    runnerNames.set(r, name);
    if (r.staticSend !== null) {
      out.push(emitStaticRunner(name, r.staticSend));
    } else {
      out.push(emitCtxRunner(name, r));
    }
    out.push("");
  }

  const methods: string[] = [];
  for (const r of emitted) {
    if (r.method !== "*" && methods.indexOf(r.method) < 0) {
      methods.push(r.method);
    }
  }
  if (methods.indexOf("GET") >= 0 && methods.indexOf("HEAD") < 0) {
    methods.push("HEAD");
  }
  methods.sort((a, b) => {
    const oa = METHOD_ORDER[a] === undefined ? 100 : METHOD_ORDER[a];
    const ob = METHOD_ORDER[b] === undefined ? 100 : METHOD_ORDER[b];
    if (oa !== ob) {
      return oa - ob;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });

  out.push(header);
  out.push('    const m = String(method || "")');
  out.push('    const u = String(url || "/")');
  out.push("    let path = u");
  out.push('    let qs = ""');
  out.push('    const qi = u.indexOf("?")');
  out.push("    if (qi >= 0) {");
  out.push("      path = String(u.slice(0, qi))");
  out.push("      qs = String(u.slice(qi + 1))");
  out.push("    }");
  out.push('    const segs = path.split("/")');
  for (const m of methods) {
    const list = emitted
      .filter((r) => r.method === m || r.method === "*" || (m === "HEAD" && r.method === "GET"))
      .sort((a, b) => {
        const d = segCmp(a, b);
        if (d !== 0) {
          return d;
        }
        const md = methodRank(a, m) - methodRank(b, m);
        if (md !== 0) {
          return md;
        }
        return a.registered - b.registered;
      });
    if (list.length === 0) {
      continue;
    }
    out.push("    if (m === " + J(m) + ") {");
    for (const r of list) {
      out.push(emitCheck(r, runnerNames.get(r) as string, "      "));
    }
    out.push("      return false");
    out.push("    }");
  }
  // fallthrough: methods with no section only see '*' routes
  const star = emitted.filter((r) => r.method === "*").sort(segCmp);
  for (const r of star) {
    out.push(emitCheck(r, runnerNames.get(r) as string, "    "));
  }
  out.push("    return false");
  out.push("  }");
  out.push("}");
  out.push("");
  return out.join("\n");
}
