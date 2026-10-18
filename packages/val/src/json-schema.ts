// JSON Schema 2020-12 / OpenAPI 3.1 emission for val schemas.
//
// Mapping decisions (schema/action → JSON Schema):
// - VStr/VNum/VBool → { type: "string"|"number"|"boolean" }.
// - VAny → {}: no constraints match everything.
// - VNever → { not: {} }: the empty schema matches all, its negation nothing.
// - VLiteral → { const: v } for string/number/boolean arms; the null arm is
//   { type: "null" } (const: null would add nothing).
// - VPicklist → { type: "string", enum: [...] }.
// - VOptional(inner, default) → the inner node. Defaults are parse-time fill-in,
//   not a constraint on valid input, so they are not emitted; inside VObject the
//   wrapper's only effect is moving the key out of `required` (the same
//   instanceof VOptional check VObject._run makes).
// - VNullable/VNullish(inner) → "null" merged into the inner node's `type`
//   (type arrays are the 2020-12 spelling of nullable). `undefined` is not a
//   JSON value, so nullish emits exactly like nullable. Falls back to anyOf
//   wrapping when the inner node has no scalar `type` to merge into.
// - VUnion → nullable collapse when there is exactly one non-null arm plus a
//   null-literal arm; otherwise { anyOf: [...] } with null arms as
//   { type: "null" } entries.
// - VArray → { type: "array", items }; VTuple → prefixItems + minItems +
//   maxItems (2020-12 keywords, valid in OpenAPI 3.1).
// - VObject → { type: "object", properties, required }; strict adds
//   additionalProperties: false. Strip and loose modes omit it: their
//   difference from strict is output shaping, not input acceptance.
// - VRecord → { type: "object", additionalProperties: <value node> }; the key
//   schema emits propertyNames only when it is more than a bare VStr.
// - VCustom/VCheckAction/check() → contributes nothing: the predicate is
//   unrepresentable, and the node keeps every other constraint of the base
//   schema (bail, don't guess).
// - Transforms (transform, trim, toLowerCase, toMinValue, ...) → skipped: they
//   map the output and never reject input, so no keyword is owed.
// - Pipe actions fold onto the inner node:
//     min_length/non_empty → minLength (strings) / minItems (arrays);
//     max_length → maxLength/maxItems; length → both bounds at n.
//     The keyword family follows the node's type; an untyped node gets both
//     families, which is exact: each keyword is vacuous off its own type,
//     mirroring the action's own typeof guard.
//     regex/digits → pattern (the action's RegExp source; JSON Schema patterns
//     are unanchored ECMA-262, same semantics as RegExp.test).
//     email/uuid/url/ipv4 → format ("uri" for url): the idiomatic keyword; the
//     regex is val's implementation detail.
//     starts_with/ends_with/includes → pattern with the literal regex-escaped
//     and anchored as needed; empty → maxLength: 0.
//     integer → type: "integer"; safe_integer → type: "integer" + the
//     ±(2^53-1) bounds, exactly Number.isSafeInteger.
//     min_value/max_value → minimum/maximum; gt/lt_value → exclusiveMinimum/
//     exclusiveMaximum (2020-12 numeric spelling); multiple_of → multipleOf.
//     finite → skipped: JSON numbers are finite by construction.
// - toOpenApiSchema: OpenAPI 3.1's Schema Object is a superset of JSON Schema
//   2020-12 and drops `nullable:` in favor of type arrays, so the emitted node
//   is already valid OpenAPI 3.1; the alias exists for API stability and any
//   future dialect divergence.
//
// Subset notes: nodes are index-signature records, not closed interfaces — the
// subset cannot build partial literals of a closed interface (missing fields
// fail typecheck) and `{}` does not width-coerce to one (SC2002), so like
// VObject.entryMap the concrete node type is an open record filled by dynamic
// member writes. Traversal is direct recursion over the class fields: nested
// schemas only ever appear as program-class instances in typed fields, so
// depth is bounded at author time — the same shape parse.ts walks via _run.

import { VSchema } from "./types.ts";
import {
  VAny,
  VArray,
  VBool,
  VCustom,
  VLiteral,
  VNever,
  VNullable,
  VNullish,
  VNum,
  VObject,
  VOptional,
  VPicklist,
  VPipe,
  VRecord,
  VStr,
  VTuple,
  VUnion,
} from "./schemas.ts";
import { VLengthAction, VNumCheck, VStrCheck } from "./actions.ts";

// A JSON Schema node: an open keyword record (see the subset note above for
// why this is not a closed interface).
export interface JsonSchemaNode {
  [keyword: string]: unknown;
}

// The JSON Schema `type` vocabulary (safe_integer's integer included).
export type JsonType = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

// Regex metacharacters that must be escaped when a plain literal becomes a
// pattern (startsWith/endsWith/includes).
const META = "^$\\.*+?()[]{}|/";

function reEscape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (META.indexOf(ch) >= 0) {
      out += "\\";
    }
    out += ch;
  }
  return out;
}

function nullNode(): JsonSchemaNode {
  const n: JsonSchemaNode = {};
  n["type"] = "null";
  return n;
}

// Merge "null" into a node's accepted types, in place where possible.
// Returns the node to use (the same object, or an anyOf wrapper when the
// inner node has no `type`/`anyOf` to merge into — never a self-reference).
function mergedNull(node: JsonSchemaNode): JsonSchemaNode {
  const t = node["type"];
  if (typeof t === "string") {
    const ts: string[] = [];
    ts.push(t);
    ts.push("null");
    node["type"] = ts;
    return node;
  }
  if (Array.isArray(t)) {
    const ts = t as string[];
    let seen = false;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] === "null") {
        seen = true;
      }
    }
    if (!seen) {
      ts.push("null");
    }
    return node;
  }
  const a = node["anyOf"];
  if (Array.isArray(a)) {
    const arms = a as JsonSchemaNode[];
    arms.push(nullNode());
    return node;
  }
  const w: JsonSchemaNode = {};
  const arms: JsonSchemaNode[] = [];
  arms.push(node);
  arms.push(nullNode());
  w["anyOf"] = arms;
  return w;
}

function isNullLiteral(s: VSchema): boolean {
  return s instanceof VLiteral && s.lkind === 3;
}

// Node type for length-keyword selection: 0 = string, 1 = array, 2 = untyped
// or union (both keyword families; each is vacuous off its own type).
function lengthKindOf(node: JsonSchemaNode): number {
  const t = node["type"];
  if (typeof t === "string") {
    return t === "array" ? 1 : 0;
  }
  return 2;
}

// Fold one pipe action onto the node. Unrepresentable actions (check,
// transforms, clamps) leave the node untouched.
function foldAction(node: JsonSchemaNode, act: VSchema): void {
  if (act instanceof VLengthAction) {
    const kind = lengthKindOf(node);
    if (act.op === 0 || act.op === 2) {
      if (kind === 0 || kind === 2) {
        node["minLength"] = act.n;
      }
      if (kind === 1 || kind === 2) {
        node["minItems"] = act.n;
      }
    }
    if (act.op === 1 || act.op === 2) {
      if (kind === 0 || kind === 2) {
        node["maxLength"] = act.n;
      }
      if (kind === 1 || kind === 2) {
        node["maxItems"] = act.n;
      }
    }
    return;
  }
  if (act instanceof VStrCheck) {
    const t = act.type;
    if (t === "email" || t === "uuid" || t === "url" || t === "ipv4") {
      node["format"] = t === "url" ? "uri" : t;
      return;
    }
    if (act.re !== null) {
      node["pattern"] = act.re.source;
      return;
    }
    if (t === "empty") {
      node["maxLength"] = 0;
      return;
    }
    if (t === "starts_with") {
      node["pattern"] = "^" + reEscape(act.str);
      return;
    }
    if (t === "ends_with") {
      node["pattern"] = reEscape(act.str) + "$";
      return;
    }
    if (t === "includes") {
      node["pattern"] = reEscape(act.str);
      return;
    }
    return;
  }
  if (act instanceof VNumCheck) {
    const t = act.type;
    if (t === "integer") {
      node["type"] = "integer";
      return;
    }
    if (t === "safe_integer") {
      node["type"] = "integer";
      node["minimum"] = -9007199254740991;
      node["maximum"] = 9007199254740991;
      return;
    }
    if (t === "min_value") {
      node["minimum"] = act.n;
      return;
    }
    if (t === "max_value") {
      node["maximum"] = act.n;
      return;
    }
    if (t === "gt_value") {
      node["exclusiveMinimum"] = act.n;
      return;
    }
    if (t === "lt_value") {
      node["exclusiveMaximum"] = act.n;
      return;
    }
    if (t === "multiple_of") {
      node["multipleOf"] = act.n;
      return;
    }
    return; // finite: JSON numbers are finite by construction
  }
  // VCheckAction, VTransformAction, VStrTransform, VNumClamp: skipped.
}

function emit(s: VSchema): JsonSchemaNode {
  if (s instanceof VStr) {
    const n: JsonSchemaNode = {};
    n["type"] = "string";
    return n;
  }
  if (s instanceof VNum) {
    const n: JsonSchemaNode = {};
    n["type"] = "number";
    return n;
  }
  if (s instanceof VBool) {
    const n: JsonSchemaNode = {};
    n["type"] = "boolean";
    return n;
  }
  if (s instanceof VAny) {
    const n: JsonSchemaNode = {};
    return n;
  }
  if (s instanceof VNever) {
    const n: JsonSchemaNode = {};
    const none: JsonSchemaNode = {};
    n["not"] = none;
    return n;
  }
  if (s instanceof VLiteral) {
    const n: JsonSchemaNode = {};
    if (s.lkind === 3) {
      n["type"] = "null";
      return n;
    }
    if (s.lkind === 0) {
      n["const"] = s.sReq;
      return n;
    }
    if (s.lkind === 1) {
      n["const"] = s.nReq;
      return n;
    }
    n["const"] = s.bReq;
    return n;
  }
  if (s instanceof VPicklist) {
    const n: JsonSchemaNode = {};
    n["type"] = "string";
    const opts: string[] = [];
    for (let i = 0; i < s.options.length; i++) {
      opts.push(s.options[i]);
    }
    n["enum"] = opts;
    return n;
  }
  if (s instanceof VNullable) {
    return mergedNull(emit(s.inner));
  }
  if (s instanceof VNullish) {
    return mergedNull(emit(s.inner));
  }
  if (s instanceof VOptional) {
    return emit(s.inner);
  }
  if (s instanceof VArray) {
    const n: JsonSchemaNode = {};
    n["type"] = "array";
    n["items"] = emit(s.item);
    return n;
  }
  if (s instanceof VTuple) {
    const n: JsonSchemaNode = {};
    n["type"] = "array";
    const items: JsonSchemaNode[] = [];
    for (let i = 0; i < s.items.length; i++) {
      items.push(emit(s.items[i]));
    }
    n["prefixItems"] = items;
    n["minItems"] = s.items.length;
    n["maxItems"] = s.items.length;
    return n;
  }
  if (s instanceof VObject) {
    const n: JsonSchemaNode = {};
    n["type"] = "object";
    const props: { [k: string]: JsonSchemaNode } = {};
    const req: string[] = [];
    for (let i = 0; i < s.keys.length; i++) {
      props[s.keys[i]] = emit(s.schemas[i]);
      if (!(s.schemas[i] instanceof VOptional)) {
        req.push(s.keys[i]);
      }
    }
    if (s.keys.length > 0) {
      n["properties"] = props;
    }
    if (req.length > 0) {
      n["required"] = req;
    }
    if (s.mode === 2) {
      n["additionalProperties"] = false;
    }
    return n;
  }
  if (s instanceof VRecord) {
    const n: JsonSchemaNode = {};
    n["type"] = "object";
    n["additionalProperties"] = emit(s.valSch);
    if (!(s.keySch instanceof VStr)) {
      n["propertyNames"] = emit(s.keySch);
    }
    return n;
  }
  if (s instanceof VUnion) {
    const nonNull: VSchema[] = [];
    let hasNull = false;
    for (let i = 0; i < s.options.length; i++) {
      if (isNullLiteral(s.options[i])) {
        hasNull = true;
      } else {
        nonNull.push(s.options[i]);
      }
    }
    if (nonNull.length === 1) {
      const node = emit(nonNull[0]);
      if (hasNull) {
        return mergedNull(node);
      }
      return node;
    }
    const arms: JsonSchemaNode[] = [];
    for (let i = 0; i < nonNull.length; i++) {
      arms.push(emit(nonNull[i]));
    }
    if (hasNull) {
      arms.push(nullNode());
    }
    const n: JsonSchemaNode = {};
    n["anyOf"] = arms;
    return n;
  }
  if (s instanceof VCustom) {
    const n: JsonSchemaNode = {};
    return n;
  }
  if (s instanceof VPipe) {
    const n = emit(s.inner);
    for (let i = 0; i < s.acts.length; i++) {
      foldAction(n, s.acts[i]);
    }
    return n;
  }
  // Bare actions (a factory used outside a pipe) and anything else: no base
  // constraints to fold onto.
  const n: JsonSchemaNode = {};
  return n;
}

// Emit a JSON Schema 2020-12 node for a val schema. The parameter is the
// Standard Schema structural minimum — `{ "~standard": unknown }` — not
// `VSchema`, so the function drops straight into a consumer's
// `emitJsonSchema`/`emit` adapter seam (e.g. @chttp/mcp's
// `emitJsonSchema: (s) => v.toJsonSchema(s)`): a `VSchema` parameter is not
// assignable from `StandardSchemaV1`, which is what those seams pass
// (cutils#27). Non-val inputs throw rather than silently emit `{}`.
export function toJsonSchema(s: { "~standard": unknown }): JsonSchemaNode {
  if (!(s instanceof VSchema)) {
    throw new Error("toJsonSchema expects a @chttp/val schema");
  }
  return emit(s);
}

// Emit an OpenAPI 3.1 Schema Object for a val schema. OpenAPI 3.1 adopts
// JSON Schema 2020-12 wholesale (type arrays replace `nullable:`), so this is
// currently the same node under a stable, dialect-named entry point.
export function toOpenApiSchema(s: { "~standard": unknown }): JsonSchemaNode {
  return toJsonSchema(s);
}
