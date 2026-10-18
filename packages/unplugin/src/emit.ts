// Codegen: ModuleModel -> routes.gen.ts source text.
//
// The emitted module satisfies contracts/route-contract.md: a `CompiledRoutes`
// class extending GenDispatch, registered via `app.withDispatch(...)`.
// It is what `scriptc build` sees on the app graph — so the same subset
// rules apply as to src/index.ts: full-shape record literals, handlers
// reached through the numeric App._chains index array (never function
// values in records), indexed loops, concrete types, no spread calls.
//
// The app instance arrives through the constructor, never an import:
// under `scriptc build` a dependency module loses lowering for every
// binding rooted at a package instantiation (`app = createRouter()`),
// and importing `app` here would poison the whole module (SC1090 —
// verified). `new CompiledRoutes(app)` inside the app-owning entry
// module keeps every emitted edge inside pure program code.

import * as path from "node:path";
import type { ModuleModel, RouteSpec, StaticSend } from "./model.ts";
import { METHOD_ORDER, WRITE_METHODS } from "./model.ts";
import { ROUTE_CONTRACT_VERSION } from "./contract.ts";

const J = JSON.stringify;

// '<dir>/routes.chttp.ts' -> 'routes.gen.ts'
export function genFileName(modulePath: string): string {
  const base = path.basename(modulePath);
  const stem = base
    .replace(/\.chttp\.(ts|js|mts|mjs|cts|cjs)$/i, "")
    .replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
  return stem + ".gen.ts";
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

// Precedence between two routes competing for the same request: at the
// first segment position whose KIND differs, static < param < wildcard
// (the trie DFS pops children in that order). Same-kind positions — even
// with different literals — cannot both match, so they don't order;
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

// Literal send-chains compile to straight res writes — no Ctx, no chain.
function emitStaticRunner(name: string, s: StaticSend): string {
  const lines: string[] = [];
  lines.push("function " + name + "(req: IncomingMessage, res: ServerResponse): void {");
  lines.push("  try {");
  lines.push("    res.statusCode = " + String(s.status));
  for (const h of s.headers) {
    lines.push("    res.setHeader(" + J(h[0]) + ", " + J(h[1]) + ")");
  }
  if (s.location !== "") {
    lines.push('    res.setHeader("location", ' + J(s.location) + ")");
    lines.push("    res.end()");
  } else {
    lines.push('    res.setHeader("content-type", ' + J(s.contentType) + ")");
    const len = Buffer.byteLength(s.body, "utf8");
    lines.push('    res.setHeader("content-length", ' + J(String(len)) + ")");
    lines.push("    res.end(" + J(s.body) + ")");
  }
  lines.push("  } catch (e) {");
  lines.push("    __chttpSend500(res)");
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}

// Ctx routes build ReqView/Ctx through the contract surface and run the
// composed middleware+handler at App._chains[idx]. Body buffering only
// happens for routes that declared `body: true` at registration AND run
// on a body-carrying method — `app.all` routes keep a runtime method
// check, concrete methods specialize at emit time.
function emitCtxRunner(name: string, r: RouteSpec): string {
  const idx = String(r.handlerIdx);
  const lines: string[] = [];
  lines.push(
    "function " +
      name +
      "(a: App, req: IncomingMessage, res: ServerResponse, pm: string[], qs: string, path: string, m: string): void {",
  );
  lines.push("  const rv = new ReqView(req, qs, path)");
  lines.push("  rv._seedPm(pm)");
  lines.push("  const c = new Ctx(rv, new NodeResponseSink(res))");
  // The closures MUST return the chain result: _guard/_buffer settle it
  // through await when it is not already settled so async handlers get
  // the same semantics as internal dispatch (rejection -> 500, settle
  // without a response -> 500). Dropping the return value would
  // unhandled-reject and hang the socket.
  const chain = "a._chains[" + idx + "](c)";
  const guarded = "_guard(res, c, function (): unknown { return " + chain + " })";
  const buffered = "_buffer(req, res, c, function (): unknown { return " + chain + " })";
  if (r.needsBody) {
    if (r.method === "*") {
      lines.push('  if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {');
      lines.push("    " + buffered);
      lines.push("  } else {");
      lines.push("    " + guarded);
      lines.push("  }");
    } else if (WRITE_METHODS[r.method] === true) {
      lines.push("  " + buffered);
    } else {
      lines.push("  " + guarded);
    }
  } else {
    lines.push("  " + guarded);
  }
  lines.push("}");
  return lines.join("\n");
}

// The match check + runner call for one route inside a method section.
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
    out.push(ind + "  " + runner + "(req, res)");
    out.push(ind + "  return true");
    out.push(ind + "}");
    return out.join("\n");
  }
  // build the pm flat-pair array for ctx runners
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
  out.push(ind + "  " + runner + "(this._a, req, res, " + pm + ", qs, path, m)");
  out.push(ind + "  return true");
  out.push(ind + "}");
  return out.join("\n");
}

export interface EmitOptions {
  importFrom: string; // specifier for the chttp contract surface in the gen file
  modulePath: string; // absolute path of the routes module
}

export function emitGenModule(model: ModuleModel, opts: EmitOptions): string {
  const out: string[] = [];
  out.push("// GENERATED by unplugin-chttp — do not edit.");
  out.push("// Source: " + path.basename(model.fileName));
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
  out.push('import type { IncomingMessage, ServerResponse } from "node:http"');
  out.push("");

  const header =
    "export class CompiledRoutes extends GenDispatch {\n" +
    "  private _a: App\n" +
    "  ROUTE_CONTRACT_VERSION = " +
    String(ROUTE_CONTRACT_VERSION) +
    "\n" +
    "  constructor(a: App) {\n" +
    "    super()\n" +
    "    this._a = a\n" +
    "  }\n" +
    "  dispatch(req: IncomingMessage, res: ServerResponse): boolean {\n";

  if (model.app === null || model.fatal !== "") {
    // stub: compiles everywhere, declines every request to the runtime path
    out.push("import { GenDispatch } from " + J(opts.importFrom));
    out.push("import type { App } from " + J(opts.importFrom));
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

  // Which contract members the emitted code actually touches. Value
  // imports stay inside program code when the routes graph uses source
  // paths (see PLUGIN.md) — under an npm-installed graph the same module
  // still builds under node/vite but cannot lower under scriptc.
  const ctxEmitted = emitted.filter((r) => r.staticSend === null);
  const needCtx = ctxEmitted.length > 0;
  const needBuffer = ctxEmitted.some(
    (r) => r.needsBody && (r.method === "*" || WRITE_METHODS[r.method] === true),
  );
  const needDec = ctxEmitted.some((r) => r.segs.some((s) => s.kind !== 0));
  const members: string[] = ["GenDispatch"];
  if (needCtx) {
    members.push("ReqView");
    members.push("Ctx");
    members.push("NodeResponseSink");
    members.push("_guard");
  }
  if (needBuffer) {
    members.push("_buffer");
  }
  if (needDec) {
    members.push("dec");
  }
  out.push("import { " + members.join(", ") + " } from " + J(opts.importFrom));
  out.push("import type { App } from " + J(opts.importFrom));
  out.push("");

  // route table — full-shape literals only
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

  // helpers
  out.push("function __chttpSend500(res: ServerResponse): void {");
  out.push("  try {");
  out.push("    if (res.headersSent) {");
  out.push("      res.destroy()");
  out.push("    } else {");
  out.push("      res.statusCode = 500");
  out.push('      res.setHeader("content-type", "text/plain; charset=UTF-8")');
  out.push('      res.setHeader("content-length", "21")');
  out.push('      res.end("Internal Server Error")');
  out.push("    }");
  out.push("  } catch (e) {");
  out.push("    try {");
  out.push("      res.destroy()");
  out.push("    } catch (e2) {");
  out.push("      // socket already gone");
  out.push("    }");
  out.push("  }");
  out.push("}");
  out.push("");

  // per-route runners, named by table position
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

  // method sections
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
  out.push('    const m = String(req.method || "")');
  out.push('    const url = String(req.url || "/")');
  out.push("    let path = url");
  out.push('    let qs = ""');
  out.push('    const qi = url.indexOf("?")');
  out.push("    if (qi >= 0) {");
  out.push("      path = String(url.slice(0, qi))");
  out.push("      qs = String(url.slice(qi + 1))");
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
