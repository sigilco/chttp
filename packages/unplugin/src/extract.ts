// AST extraction: a routes module (*.chttp.ts) is walked with the TypeScript
// compiler API to recover the literal app.<method>(path, handler) table.
//
// Everything here is positional and deterministic — a registration only
// counts when it is a top-level statement whose path (and method, for
// app.on) is a compile-time string literal. Anything else is left to the
// runtime router and reported as a warning, never silently dropped.

import type { AstSource, CallExpression, Expression, Node, Parser } from "./parse/index.ts";
import { getParser } from "./parse/index.ts";
import type { ModuleModel, RouteSpec, SegSpec, StaticSend } from "./model.ts";
import { ROUTE_METHODS } from "./model.ts";
import { detectOpenApi } from "./openapi.ts";

export interface ExtractOptions {
  appExport?: string;
  imports?: string[];
  parser?: string;
  // OpenAPI side channel: collect val schema evidence per route (emitted
  // separately by openapi.ts; never touches the gen module). The value is
  // the list of module specifiers treated as '@chttp/val' (source-path
  // imports included), empty/undefined = detection off.
  openapiValSpecifiers?: string[];
}

interface PendingRoute {
  method: string;
  path: string;
  segs: SegSpec[];
  hasMw: boolean;
  mwUnsafe: boolean;
  declaredBody: boolean; // opts.body === true at registration (contract)
  handlerNode: Expression | null;
  node: Node;
}

interface VarState {
  routes: PendingRoute[];
  // Simulated App._fns / App._nodes: mounted sub-routers are replayed
  // into the parent in the runtime's DFS order, so every var needs the
  // trie the runtime would have built — not just a flat route list.
  fns: (PendingRoute | null)[];
  nodes: SimNode[];
  mwDepth: number;
  mwUnsafe: boolean;
  dynamic: boolean; // nested/conditional registrations seen — count unreliable
}

// Mirror of the runtime RouteNode for mount replay.
interface SimNode {
  seg: string; // static text, param name without ':', or '*'
  kind: number; // 0 static, 1 param, 2 wildcard
  hm: string[];
  hf: number[]; // indices into the var's fns
  children: number[];
}

function simRoot(): SimNode {
  return { seg: "", kind: 0, hm: [], hf: [], children: [] };
}

// Mirror of addRoute(): dedup children on (kind, seg), leaf gets
// (method, fnsIdx) appended to parallel arrays.
function simAddRoute(v: VarState, method: string, segs: SegSpec[], fnsIdx: number): void {
  let ni = 0;
  for (const s of segs) {
    let child = -1;
    const ch = v.nodes[ni].children;
    for (const ci of ch) {
      const c = v.nodes[ci];
      if (c.kind === s.kind && c.seg === s.lit) {
        child = ci;
        break;
      }
    }
    if (child < 0) {
      child = v.nodes.length;
      v.nodes.push({ seg: s.lit, kind: s.kind, hm: [], hf: [], children: [] });
      ch.push(child);
    }
    ni = child;
  }
  v.nodes[ni].hm.push(method);
  v.nodes[ni].hf.push(fnsIdx);
}

// Mirror of mountRoutes(): explicit-stack DFS over the sub's node list —
// children are pushed in order and popped last-first, so a mount's index
// order is NOT the sub's registration order. Nodes are snapshotted so
// registrations added to the sub after the mount are not replayed (the
// runtime mounted a snapshot too).
function replayMount(
  sub: VarState,
  onRoute: (method: string, mountedPath: string, pr: PendingRoute | null) => void,
): void {
  const nodes: SimNode[] = [];
  for (const n of sub.nodes) {
    nodes.push({
      seg: n.seg,
      kind: n.kind,
      hm: n.hm.slice(),
      hf: n.hf.slice(),
      children: n.children.slice(),
    });
  }
  const stack: { i: number; a: string }[] = [{ i: 0, a: "" }];
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    stack.pop();
    const n = nodes[f.i];
    if (n.hf.length > 0) {
      for (let k = 0; k < n.hf.length; k++) {
        onRoute(n.hm[k], f.a, sub.fns[n.hf[k]]);
      }
    }
    for (let k = 0; k < n.children.length; k++) {
      const c = nodes[n.children[k]];
      let seg = c.seg;
      if (c.kind === 1) {
        seg = ":" + seg;
      }
      stack.push({ i: n.children[k], a: f.a + "/" + seg });
    }
  }
}

const DEFAULT_IMPORTS = ["@chttp/router"];

function isChttpSpecifier(spec: string, extra: string[]): boolean {
  const all = DEFAULT_IMPORTS.concat(extra);
  for (const p of all) {
    if (spec === p || spec.indexOf(p + "/") === 0) {
      return true;
    }
  }
  return false;
}

// Evaluate a compile-time literal. Returns {ok:false} for anything else.
// `p` (the active parser) is threaded through: predicates are per-parser.
function evalLiteral(p: Parser, e: Expression): { ok: boolean; v: unknown } {
  if (p.isStringLiteral(e) || p.isNoSubstitutionTemplateLiteral(e)) {
    return { ok: true, v: e.text };
  }
  if (p.isNumericLiteral(e)) {
    return { ok: true, v: Number(e.text) };
  }
  if (e.kind === p.k.TrueKeyword) {
    return { ok: true, v: true };
  }
  if (e.kind === p.k.FalseKeyword) {
    return { ok: true, v: false };
  }
  if (e.kind === p.k.NullKeyword) {
    return { ok: true, v: null };
  }
  if (p.isPrefixUnaryExpression(e)) {
    const inner = evalLiteral(p, e.operand);
    if (inner.ok && typeof inner.v === "number") {
      if (e.operator === p.k.MinusToken) {
        return { ok: true, v: -inner.v };
      }
      if (e.operator === p.k.PlusToken) {
        return { ok: true, v: inner.v };
      }
    }
    return { ok: false, v: null };
  }
  if (p.isBinaryExpression(e) && e.operatorToken.kind === p.k.PlusToken) {
    const l = evalLiteral(p, e.left);
    const r = evalLiteral(p, e.right);
    if (l.ok && r.ok && typeof l.v === "string" && typeof r.v === "string") {
      return { ok: true, v: String(l.v) + String(r.v) };
    }
    return { ok: false, v: null };
  }
  if (p.isArrayLiteralExpression(e)) {
    const out: unknown[] = [];
    for (const el of e.elements) {
      const v = evalLiteral(p, el);
      if (!v.ok) {
        return { ok: false, v: null };
      }
      out.push(v.v);
    }
    return { ok: true, v: out };
  }
  if (p.isObjectLiteralExpression(e)) {
    const out: { [k: string]: unknown } = {};
    for (const prop of e.properties) {
      if (!p.isPropertyAssignment(prop)) {
        return { ok: false, v: null };
      }
      const n = prop.name;
      if (!p.isIdentifier(n) && !p.isStringLiteral(n) && !p.isNumericLiteral(n)) {
        return { ok: false, v: null };
      }
      const v = evalLiteral(p, prop.initializer);
      if (!v.ok) {
        return { ok: false, v: null };
      }
      out[n.text] = v.v;
    }
    return { ok: true, v: out };
  }
  if (p.isParenthesizedExpression(e)) {
    return evalLiteral(p, e.expression);
  }
  return { ok: false, v: null };
}

function evalString(p: Parser, e: Expression): { ok: boolean; v: string } {
  const r = evalLiteral(p, e);
  if (r.ok && typeof r.v === "string") {
    return { ok: true, v: r.v };
  }
  return { ok: false, v: "" };
}

// Parse '/user/:id/files/*' into segment specs. Mirrors addRoute():
// ':'-prefixed segs are params, a bare '*' is a tail-only wildcard.
function parsePath(p: string): { segs: SegSpec[] | null; err: string } {
  if (p === "" || p.charAt(0) !== "/") {
    return { segs: null, err: "route path must start with /" };
  }
  const raw = p.split("/");
  const segs: SegSpec[] = [];
  for (let i = 1; i < raw.length; i++) {
    const s = raw[i];
    if (s === "*") {
      if (i !== raw.length - 1) {
        return { segs: null, err: "* wildcard must be the last path segment" };
      }
      segs.push({ kind: 2, lit: "*" });
    } else if (s.charAt(0) === ":") {
      const name = s.slice(1);
      if (name === "") {
        return { segs: null, err: "empty :param name in " + p };
      }
      segs.push({ kind: 1, lit: name });
    } else {
      segs.push({ kind: 0, lit: s });
    }
  }
  return { segs: segs, err: "" };
}

interface ChainCall {
  name: string;
  args: Expression[];
  node: CallExpression;
}

// Decompose a fluent chain `app.get('/a', h).post('/b', h2)` into the
// sequence of member calls rooted at a bare identifier.
function decomposeChain(p: Parser, e: Expression): { root: string; calls: ChainCall[] } | null {
  const calls: ChainCall[] = [];
  let cur = e;
  while (p.isCallExpression(cur) && p.isPropertyAccessExpression(cur.expression)) {
    calls.unshift({
      name: cur.expression.name.text,
      args: cur.arguments,
      node: cur,
    });
    cur = cur.expression.expression;
  }
  if (calls.length > 0 && p.isIdentifier(cur)) {
    return { root: cur.text, calls: calls };
  }
  return null;
}

// ---- static-send specialization ------------------------------------------
// A handler shaped `(c) => c.<chain>` where the chain is only
// status(number)/header(string, string) steps ending in
// json(lit)/text(lit)/html(lit)/redirect(str[,num]) can be answered without
// building a Ctx at all.

function detectStaticSend(p: Parser, h: Expression): StaticSend | null {
  if (!p.isArrowFunction(h) && !p.isFunctionExpression(h)) {
    return null;
  }
  if (h.parameters.length !== 1) {
    return null;
  }
  const param = h.parameters[0];
  if (!p.isIdentifier(param.name)) {
    return null;
  }
  const cname = param.name.text;
  let body: Expression | null = null;
  if (p.isBlock(h.body)) {
    if (h.body.statements.length === 1) {
      const s = h.body.statements[0];
      if (p.isReturnStatement(s) && s.expression !== undefined) {
        body = s.expression;
      }
    }
  } else {
    body = h.body as Expression;
  }
  if (body === null) {
    return null;
  }
  // peel the call chain innermost-first
  const ops: { name: string; args: Expression[] }[] = [];
  let cur: Expression = body;
  while (p.isCallExpression(cur) && p.isPropertyAccessExpression(cur.expression)) {
    ops.unshift({ name: cur.expression.name.text, args: cur.arguments });
    cur = cur.expression.expression;
  }
  if (ops.length === 0 || !p.isIdentifier(cur) || cur.text !== cname) {
    return null;
  }
  const send: StaticSend = {
    status: 200,
    headers: [],
    contentType: "",
    body: "",
    location: "",
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const last = i === ops.length - 1;
    if (!last) {
      if (op.name === "status" && op.args.length === 1) {
        const v = evalLiteral(p, op.args[0]);
        if (!v.ok || typeof v.v !== "number") {
          return null;
        }
        send.status = v.v;
      } else if (op.name === "header" && op.args.length === 2) {
        const k = evalString(p, op.args[0]);
        const v = evalString(p, op.args[1]);
        if (!k.ok || !v.ok) {
          return null;
        }
        send.headers.push([k.v, v.v]);
      } else {
        return null;
      }
      continue;
    }
    if (op.name === "json" && op.args.length === 1) {
      const v = evalLiteral(p, op.args[0]);
      if (!v.ok) {
        return null;
      }
      const t = JSON.stringify(v.v);
      if (typeof t !== "string") {
        return null;
      }
      send.contentType = "application/json; charset=utf-8";
      send.body = t;
    } else if ((op.name === "text" || op.name === "html") && op.args.length === 1) {
      const v = evalString(p, op.args[0]);
      if (!v.ok) {
        return null;
      }
      send.contentType =
        op.name === "text" ? "text/plain; charset=UTF-8" : "text/html; charset=utf-8";
      send.body = v.v;
    } else if (op.name === "redirect" && op.args.length >= 1 && op.args.length <= 2) {
      const u = evalString(p, op.args[0]);
      if (!u.ok) {
        return null;
      }
      send.location = u.v;
      if (op.args.length === 2) {
        const code = evalLiteral(p, op.args[1]);
        if (!code.ok || typeof code.v !== "number") {
          return null;
        }
        send.status = code.v;
      } else {
        send.status = 302;
      }
    } else {
      return null;
    }
  }
  return send;
}

// ---------------------------------------------------------------------------

export function extractModule(fileName: string, code: string, opts?: ExtractOptions): ModuleModel {
  const p = getParser(opts?.parser);
  const extraImports = opts?.imports ?? [];
  const warnings: string[] = [];
  const model: ModuleModel = {
    fileName: fileName,
    app: null,
    routes: [],
    warnings: warnings,
    fatal: "",
    openapi: [],
    openapiWarnings: [],
    openapiConsts: [],
  };
  const sf: AstSource = p.parse(fileName, code);
  const line = (n: Node): number => sf.lineOf(n);
  const warn = (n: Node, msg: string): void => {
    warnings.push("unplugin-chttp: " + fileName + ":" + String(line(n)) + " " + msg);
  };

  // 1. createRouter bindings from chttp imports
  const factories = new Set<string>();
  const namespaces = new Set<string>();
  for (const st of sf.statements) {
    if (p.isImportDeclaration(st) && p.isStringLiteral(st.moduleSpecifier)) {
      if (!isChttpSpecifier(st.moduleSpecifier.text, extraImports)) {
        continue;
      }
      const clause = st.importClause;
      if (clause !== undefined && clause.namedBindings !== undefined) {
        if (p.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = el.propertyName !== undefined ? el.propertyName.text : el.name.text;
            if (imported === "createRouter") {
              factories.add(el.name.text);
            }
          }
        } else if (p.isNamespaceImport(clause.namedBindings)) {
          namespaces.add(clause.namedBindings.name.text);
        }
      }
    }
  }

  const isCreateCall = (e: Expression | undefined): boolean => {
    if (e === undefined || !p.isCallExpression(e)) {
      return false;
    }
    const c = e.expression;
    if (p.isIdentifier(c) && factories.has(c.text)) {
      return true;
    }
    if (
      p.isPropertyAccessExpression(c) &&
      p.isIdentifier(c.expression) &&
      namespaces.has(c.expression.text) &&
      c.name.text === "createRouter"
    ) {
      return true;
    }
    return false;
  };

  // 2. router var declarations + export surface
  const vars = new Map<string, VarState>();
  const routerVarOrder: string[] = [];
  const getVar = (name: string): VarState => {
    let v = vars.get(name);
    if (v === undefined) {
      v = {
        routes: [],
        fns: [],
        nodes: [simRoot()],
        mwDepth: 0,
        mwUnsafe: false,
        dynamic: false,
      };
      vars.set(name, v);
      routerVarOrder.push(name);
    }
    return v;
  };
  const directExportedVars = new Set<string>();
  const namedExports: { local: string; exported: string }[] = [];
  let defaultExport: { local: string } | null = null;

  for (const st of sf.statements) {
    if (p.isVariableStatement(st)) {
      let exported = false;
      const mods = st.modifiers;
      if (mods !== undefined) {
        for (const m of mods) {
          if (m.kind === p.k.ExportKeyword) {
            exported = true;
          }
        }
      }
      for (const d of st.declarationList.declarations) {
        if (p.isIdentifier(d.name)) {
          if (isCreateCall(d.initializer)) {
            getVar(d.name.text);
          }
          if (exported) {
            directExportedVars.add(d.name.text);
          }
        }
      }
    }
    if (p.isExportAssignment(st) && st.isExportEquals !== true) {
      if (p.isIdentifier(st.expression)) {
        defaultExport = { local: st.expression.text };
      }
    }
    if (
      p.isExportDeclaration(st) &&
      st.exportClause !== undefined &&
      p.isNamedExports(st.exportClause)
    ) {
      for (const el of st.exportClause.elements) {
        const local = el.propertyName !== undefined ? el.propertyName.text : el.name.text;
        namedExports.push({ local: local, exported: el.name.text });
      }
    }
  }

  // 3. pick the app var (explicit option → default export → 'app' → first)
  let appVar = "";
  const isExportedVar = (n: string): boolean =>
    directExportedVars.has(n) || namedExports.some((e) => e.local === n);
  if (opts?.appExport !== undefined) {
    const want = opts.appExport;
    if (want === "default") {
      if (defaultExport !== null && vars.has(defaultExport.local)) {
        appVar = defaultExport.local;
      }
    } else {
      for (const n of routerVarOrder) {
        if (
          vars.has(n) &&
          (n === want || namedExports.some((e) => e.local === n && e.exported === want))
        ) {
          appVar = n;
          break;
        }
      }
    }
    if (appVar === "") {
      warnings.push(
        'unplugin-chttp: appExport "' +
          want +
          '" does not resolve to an exported createRouter() binding — emitting a stub dispatch',
      );
    }
  }
  if (appVar === "") {
    if (defaultExport !== null && vars.has(defaultExport.local)) {
      appVar = defaultExport.local;
    } else {
      const exported = routerVarOrder.filter((n) => isExportedVar(n));
      if (exported.indexOf("app") >= 0) {
        appVar = "app";
      } else if (exported.length > 0) {
        appVar = exported[0];
      }
    }
  }
  if (appVar !== "") {
    if (defaultExport !== null && defaultExport.local === appVar) {
      model.app = { varName: appVar, importKind: "default", exportName: "default" };
    } else if (directExportedVars.has(appVar)) {
      model.app = { varName: appVar, importKind: "named", exportName: appVar };
    } else {
      const ne = namedExports.find((e) => e.local === appVar);
      if (ne !== undefined) {
        model.app = { varName: appVar, importKind: "named", exportName: ne.exported };
      }
    }
    if (model.app === null) {
      warnings.push(
        'unplugin-chttp: router var "' +
          appVar +
          '" is not exported — emitting a stub dispatch; export it to enable the compiled path',
      );
    }
  } else {
    warnings.push(
      "unplugin-chttp: no exported createRouter() binding found — emitting a stub dispatch",
    );
  }

  // 4. positional walk — appVarState.fns.length tracks the runtime's
  // App._fns index for the next registration; countUncertain pins every
  // later index to -1.
  let countUncertain = false;

  const consumeFnsSlot = (v: VarState): void => {
    v.fns.push(null);
  };

  const toSpec = (
    pr: PendingRoute,
    idx: number,
    mergedPath: string,
    mergedSegs: SegSpec[],
    mergedHasMw: boolean,
    mergedMwUnsafe: boolean,
  ): RouteSpec => {
    return {
      method: pr.method,
      path: mergedPath,
      segs: mergedSegs,
      handlerIdx: idx,
      handlerNode: pr.handlerNode === null ? undefined : pr.handlerNode,
      hasMw: mergedHasMw,
      mwUnsafe: mergedMwUnsafe,
      declaredBody: pr.declaredBody,
      needsBody: false,
      staticSend: null,
      registered: model.routes.length,
      emit: true,
      bailReason: "",
    };
  };

  // Third-arg options on verb/on registrations: { body: true } declares
  // body use (contracts/route-contract.md). Non-literal opts bail the route.
  const optsBody = (optArg: Expression | undefined, node: Node): { ok: boolean; body: boolean } => {
    if (optArg === undefined) {
      return { ok: true, body: false };
    }
    const v = evalLiteral(p, optArg);
    if (!v.ok || typeof v.v !== "object" || v.v === null || Array.isArray(v.v)) {
      warn(node, "non-literal options object — this route stays runtime-only");
      return { ok: false, body: false };
    }
    const o = v.v as { [k: string]: unknown };
    if (o.multipart !== undefined) {
      // Declared-multipart rule (contracts/route-contract.md): the runtime
      // owns the stream for these routes — generated dispatch must decline
      // them rather than serve them unbuffered/unparsed.
      warn(node, "multipart route — stays runtime-only (internal dispatch parses)");
      return { ok: false, body: false };
    }
    return { ok: true, body: o.body === true };
  };

  const pushRoute = (
    v: VarState,
    isApp: boolean,
    method: string,
    path: string,
    node: Node,
    handlerNode: Expression | null,
    declaredBody: boolean,
  ): void => {
    const parsed = parsePath(path);
    if (parsed.segs === null) {
      warn(node, 'invalid route "' + path + '": ' + parsed.err + " (runtime keeps it)");
      // the runtime's _regFn already ran before addRoute threw — the
      // handler slot is consumed
      consumeFnsSlot(v);
      return;
    }
    const pr: PendingRoute = {
      method: method,
      path: path,
      segs: parsed.segs,
      hasMw: v.mwDepth > 0,
      mwUnsafe: v.mwUnsafe,
      declaredBody: declaredBody,
      handlerNode: handlerNode,
      node: node,
    };
    v.routes.push(pr);
    const idx = v.fns.length;
    v.fns.push(pr);
    simAddRoute(v, method, parsed.segs, idx);
    if (isApp) {
      model.routes.push(
        toSpec(pr, countUncertain ? -1 : idx, path, parsed.segs, pr.hasMw, pr.mwUnsafe),
      );
    }
  };

  const handleCall = (varName: string, call: ChainCall): void => {
    const v = getVar(varName);
    const isApp = varName === appVar;
    const name = call.name;
    const args = call.args;
    if (name === "use") {
      if (args.length >= 1) {
        v.mwDepth += 1;
      }
      return;
    }
    if (name === "route") {
      const sub = args.length >= 2 && p.isIdentifier(args[1]) ? args[1].text : "";
      const subVar = sub !== "" && sub !== varName ? vars.get(sub) : undefined;
      if (subVar === undefined) {
        warn(
          call.node,
          "route() mount target is not a same-module createRouter() var — mount stays runtime-only; later routes stay runtime-only",
        );
        if (isApp) {
          countUncertain = true;
        }
        return;
      }
      const pre = args.length >= 1 ? evalString(p, args[0]) : { ok: false, v: "" };
      if (!pre.ok) {
        warn(call.node, "route() with a non-literal prefix — mounted routes stay runtime-only");
        // the runtime still mounts every sub handler — consume their
        // slots so later indices stay aligned
        for (const pr of subVar.fns) {
          v.fns.push(pr);
        }
        v.dynamic = true;
        if (isApp) {
          countUncertain = true;
        }
        return;
      }
      let prefix = pre.v;
      if (prefix.length > 1 && prefix.charAt(prefix.length - 1) === "/") {
        prefix = prefix.slice(0, prefix.length - 1);
      }
      if (subVar.dynamic || subVar.fns.indexOf(null) >= 0) {
        warn(
          call.node,
          'mounted router "' +
            sub +
            '" has dynamic or non-literal registrations — later routes stay runtime-only',
        );
        v.dynamic = true;
        if (isApp) {
          countUncertain = true;
        }
      }
      // DFS-replay the sub's trie exactly like mountRoutes(): the app
      // gains the sub's handlers in visit order, not registration order.
      const appVarState = v;
      replayMount(subVar, (method: string, mountedPath: string, pr: PendingRoute | null) => {
        const merged = prefix === "" || prefix === "/" ? mountedPath : prefix + mountedPath;
        const parsed = parsePath(merged);
        const idx = appVarState.fns.length;
        appVarState.fns.push(pr);
        if (parsed.segs !== null) {
          simAddRoute(appVarState, method, parsed.segs, idx);
        } else {
          warn(call.node, 'mounted route "' + merged + '" is invalid: ' + parsed.err);
        }
        if (isApp && pr !== null && parsed.segs !== null) {
          model.routes.push(
            toSpec(
              pr,
              countUncertain ? -1 : idx,
              merged,
              parsed.segs,
              pr.hasMw || appVarState.mwDepth > 0,
              pr.mwUnsafe || appVarState.mwUnsafe,
            ),
          );
        }
      });
      return;
    }
    if (name === "on") {
      const m = args.length >= 1 ? evalString(p, args[0]) : { ok: false, v: "" };
      const path = args.length >= 2 ? evalString(p, args[1]) : { ok: false, v: "" };
      if ((args.length !== 3 && args.length !== 4) || !m.ok || !path.ok) {
        warn(
          call.node,
          "on() expects (method: literal, path: literal, handler[, opts]) — left to runtime",
        );
        consumeFnsSlot(v);
        return;
      }
      const ob = optsBody(args[3], call.node);
      if (!ob.ok) {
        consumeFnsSlot(v);
        return;
      }
      pushRoute(v, isApp, m.v.toUpperCase(), path.v, call.node, args[2], ob.body);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(ROUTE_METHODS, name)) {
      const path = args.length >= 1 ? evalString(p, args[0]) : { ok: false, v: "" };
      if (args.length !== 2 && args.length !== 3) {
        warn(
          call.node,
          name + "() expects (path, handler[, opts]) — this route stays runtime-only",
        );
        consumeFnsSlot(v);
        return;
      }
      if (!path.ok) {
        warn(call.node, name + "() with a non-literal path — this route stays runtime-only");
        consumeFnsSlot(v);
        return;
      }
      const ob = optsBody(args[2], call.node);
      if (!ob.ok) {
        consumeFnsSlot(v);
        return;
      }
      pushRoute(v, isApp, ROUTE_METHODS[name], path.v, call.node, args[1], ob.body);
      return;
    }
    // notFound/serve/handler/request — runtime surface, nothing to extract
  };

  const callsIn = (root: Node): CallExpression[] => {
    const out: CallExpression[] = [];
    const visit = (n: Node): void => {
      if (p.isCallExpression(n)) {
        out.push(n);
      }
      p.forEachChild(n, visit);
    };
    visit(root);
    return out;
  };

  for (const st of sf.statements) {
    const consumed = new Set<Node>();
    if (p.isExpressionStatement(st)) {
      const chain = decomposeChain(p, st.expression);
      if (chain !== null && vars.has(chain.root)) {
        for (const c of chain.calls) {
          consumed.add(c.node);
          handleCall(chain.root, c);
        }
      }
    }
    // nested-call scan: calls on a router var we did not consume make that
    // var's state uncertain from this position on
    for (const callNode of callsIn(st)) {
      if (consumed.has(callNode)) {
        continue;
      }
      const callee = callNode.expression;
      if (!p.isPropertyAccessExpression(callee) || !p.isIdentifier(callee.expression)) {
        continue;
      }
      const vn = callee.expression.text;
      if (!vars.has(vn)) {
        continue;
      }
      const mn = callee.name.text;
      const v = getVar(vn);
      if (mn === "use") {
        warn(
          callNode,
          "use() inside a nested/conditional context — middleware state from here is uncertain; later routes lose static-send specialization",
        );
        v.mwUnsafe = true;
      } else if (
        Object.prototype.hasOwnProperty.call(ROUTE_METHODS, mn) ||
        mn === "on" ||
        mn === "route"
      ) {
        warn(
          callNode,
          mn +
            "() inside a nested/conditional context — registration order is uncertain; later routes stay runtime-only",
        );
        v.dynamic = true;
        if (vn === appVar) {
          countUncertain = true;
        }
      }
    }
  }

  // 5. specialization + needsBody + emit eligibility
  for (const r of model.routes) {
    if (r.handlerNode !== undefined && !r.hasMw && !r.mwUnsafe) {
      const s = detectStaticSend(p, r.handlerNode);
      if (s !== null) {
        r.staticSend = s;
      }
    }
    // needsBody drives _buffer in the emitted runner: only routes that
    // declared `body: true` at registration (contract), never speculative.
    r.needsBody = r.staticSend === null && r.declaredBody;
    if (r.handlerIdx < 0 && r.staticSend === null) {
      r.emit = false;
      r.bailReason = "registration order is uncertain past this point";
    }
  }

  // OpenAPI evidence collection (side channel; off unless configured).
  if (opts?.openapiValSpecifiers !== undefined && opts.openapiValSpecifiers.length > 0) {
    detectOpenApi(p, model, sf, { valSpecifiers: opts.openapiValSpecifiers });
  }

  return model;
}
