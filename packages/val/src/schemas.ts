// Schema classes: each validates one shape, sharing the VSchema base and
// the FAIL sentinel from types.ts.

import { FAIL, VFail, VIssue, VSchema, pushIssue, receivedOf } from "./types.ts";
import type { StdTyped } from "./types.ts";

// Best-effort output typing without generics (generic phantom fields cannot
// compile): resolves the concrete schema classes; VObject/VRecord resolve to
// open records, wrappers to unknown unions. Lives here (not types.ts) because
// it conditionally resolves the classes declared below.
export type InferOutput<S> = S extends VStr
  ? string
  : S extends VNum
    ? number
    : S extends VBool
      ? boolean
      : S extends VArray | VTuple
        ? unknown[]
        : S extends VObject | VRecord
          ? { [k: string]: unknown }
          : unknown;

// ---------------------------------------------------------------- schemas

export interface VStr {
  "~standard": StdTyped<string, string>;
}

export class VStr extends VSchema {
  constructor() {
    super("string");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input === "string") {
      return input;
    }
    pushIssue(issues, "string", input, "string", null, path);
    return FAIL;
  }
}

export interface VNum {
  "~standard": StdTyped<number, number>;
}

export class VNum extends VSchema {
  constructor() {
    super("number");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input === "number" && !Number.isNaN(Number(input))) {
      return input;
    }
    pushIssue(issues, "number", input, "number", null, path);
    return FAIL;
  }
}

export interface VBool {
  "~standard": StdTyped<boolean, boolean>;
}

export class VBool extends VSchema {
  constructor() {
    super("boolean");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input === "boolean") {
      return input;
    }
    pushIssue(issues, "boolean", input, "boolean", null, path);
    return FAIL;
  }
}

export class VAny extends VSchema {
  constructor() {
    super("any");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    return input;
  }
}

export class VNever extends VSchema {
  constructor() {
    super("never");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    pushIssue(issues, "never", input, "never", null, path);
    return FAIL;
  }
}

// Literal requirements are string/number/boolean/null (typed slots).
export class VLiteral extends VSchema {
  lkind: number; // 0 string, 1 number, 2 boolean, 3 null
  sReq: string;
  nReq: number;
  bReq: boolean;
  expects: string;

  constructor(req: unknown) {
    super("literal");
    this.sReq = "";
    this.nReq = 0;
    this.bReq = false;
    if (req === null) {
      this.lkind = 3;
      this.expects = "null";
    } else if (typeof req === "number") {
      this.lkind = 1;
      this.nReq = Number(req);
      this.expects = String(req);
    } else if (typeof req === "boolean") {
      this.lkind = 2;
      this.bReq = Boolean(req);
      this.expects = String(req);
    } else {
      this.lkind = 0;
      this.sReq = String(req);
      this.expects = String(req);
    }
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    let ok = false;
    if (this.lkind === 0 && input === this.sReq) {
      ok = true;
    } else if (this.lkind === 1 && input === this.nReq) {
      ok = true;
    } else if (this.lkind === 2 && input === this.bReq) {
      ok = true;
    } else if (this.lkind === 3 && input === null) {
      ok = true;
    }
    if (ok) {
      return input;
    }
    pushIssue(issues, "literal", input, this.expects, null, path);
    return FAIL;
  }
}

export class VPicklist extends VSchema {
  options: string[];
  expects: string;
  constructor(options: string[]) {
    super("picklist");
    this.options = options;
    this.expects = options.join("|");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input === "string") {
      const s = String(input);
      for (let i = 0; i < this.options.length; i++) {
        if (s === this.options[i]) {
          return s;
        }
      }
    }
    pushIssue(issues, "picklist", input, this.expects, null, path);
    return FAIL;
  }
}

export class VNullable extends VSchema {
  inner: VSchema;
  constructor(inner: VSchema) {
    super("nullable");
    this.inner = inner;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (input === null) {
      return null;
    }
    return this.inner._run(input, issues, path);
  }
}

// Optional with primitive default support (string/number/boolean/null).
export class VOptional extends VSchema {
  inner: VSchema;
  hasDef: number;
  dkind: number; // 0 string, 1 number, 2 boolean, 3 null
  sDef: string;
  nDef: number;
  bDef: boolean;

  constructor(
    inner: VSchema,
    hasDef: number,
    dkind: number,
    sDef: string,
    nDef: number,
    bDef: boolean,
  ) {
    super("optional");
    this.inner = inner;
    this.hasDef = hasDef;
    this.dkind = dkind;
    this.sDef = sDef;
    this.nDef = nDef;
    this.bDef = bDef;
  }

  _def(): unknown {
    if (this.dkind === 0) {
      return this.sDef;
    }
    if (this.dkind === 1) {
      return this.nDef;
    }
    if (this.dkind === 2) {
      return this.bDef;
    }
    return null;
  }

  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (input === undefined) {
      return this.hasDef === 1 ? this._def() : undefined;
    }
    return this.inner._run(input, issues, path);
  }
}

export class VNullish extends VSchema {
  inner: VSchema;
  constructor(inner: VSchema) {
    super("nullish");
    this.inner = inner;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (input === null || input === undefined) {
      return input;
    }
    return this.inner._run(input, issues, path);
  }
}

export interface VArray {
  "~standard": StdTyped<unknown[], unknown[]>;
}

export class VArray extends VSchema {
  item: VSchema;
  constructor(item: VSchema) {
    super("array");
    this.item = item;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (!Array.isArray(input)) {
      pushIssue(issues, "array", input, "Array", null, path);
      return FAIL;
    }
    const out: unknown[] = [];
    for (let i = 0; i < input.length; i++) {
      path.push(String(i));
      const r = this.item._run(input[i], issues, path);
      path.pop();
      if (r instanceof VFail) {
        return FAIL;
      }
      out.push(r);
    }
    return out;
  }
}

export interface VTuple {
  "~standard": StdTyped<unknown[], unknown[]>;
}

export class VTuple extends VSchema {
  items: VSchema[];
  constructor(items: VSchema[]) {
    super("tuple");
    this.items = items;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (!Array.isArray(input) || input.length !== this.items.length) {
      pushIssue(issues, "tuple", input, "Array[" + this.items.length + "]", null, path);
      return FAIL;
    }
    const out: unknown[] = [];
    for (let i = 0; i < this.items.length; i++) {
      path.push(String(i));
      const r = this.items[i]._run(input[i], issues, path);
      path.pop();
      if (r instanceof VFail) {
        return FAIL;
      }
      out.push(r);
    }
    return out;
  }
}

// Object modes: 0 = strip unknown keys (valibot `object`), 1 = loose (keep),
// 2 = strict (unknown keys are issues). Entries are parallel arrays plus a
// presence map — records cannot hold function/class-varying values.
export interface VObject {
  "~standard": StdTyped<{ [k: string]: unknown }, { [k: string]: unknown }>;
}

export class VObject extends VSchema {
  keys: string[];
  schemas: VSchema[];
  entryMap: { [k: string]: number };
  mode: number;

  constructor(entries: { [k: string]: VSchema }, mode: number) {
    super(mode === 0 ? "object" : mode === 1 ? "loose_object" : "strict_object");
    this.mode = mode;
    this.keys = [];
    this.schemas = [];
    this.entryMap = {};
    const ks = Object.keys(entries);
    for (let i = 0; i < ks.length; i++) {
      const k = String(ks[i]);
      this.keys.push(k);
      this.schemas.push(entries[k]);
      this.entryMap[k] = 1;
    }
  }

  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      pushIssue(issues, this.kind, input, "Object", null, path);
      return FAIL;
    }
    const src: { [k: string]: unknown } = input as { [k: string]: unknown };
    const out: { [k: string]: unknown } = {};
    let bad = 0;
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[i];
      const sch = this.schemas[i];
      const present = Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined;
      if (!present) {
        if (sch instanceof VOptional) {
          if (sch.hasDef === 1) {
            out[k] = sch._def();
          }
          continue;
        }
        bad++;
        path.push(k);
        issues.push(new VIssue("required", "defined", "undefined", null, path.slice()));
        path.pop();
        continue;
      }
      path.push(k);
      const r = sch._run(src[k], issues, path);
      path.pop();
      if (r instanceof VFail) {
        bad++;
      } else {
        out[k] = r;
      }
    }
    if (this.mode === 2) {
      const inKeys = Object.keys(src);
      for (let i = 0; i < inKeys.length; i++) {
        const k = String(inKeys[i]);
        if (this.entryMap[k] === undefined) {
          bad++;
          path.push(k);
          issues.push(new VIssue("strict_object", "never", receivedOf(src[k]), null, path.slice()));
          path.pop();
        }
      }
    } else if (this.mode === 1) {
      const inKeys = Object.keys(src);
      for (let i = 0; i < inKeys.length; i++) {
        const k = String(inKeys[i]);
        if (this.entryMap[k] === undefined) {
          out[k] = src[k];
        }
      }
    }
    if (bad > 0) {
      return FAIL;
    }
    return out;
  }
}

export interface VRecord {
  "~standard": StdTyped<{ [k: string]: unknown }, { [k: string]: unknown }>;
}

export class VRecord extends VSchema {
  keySch: VSchema;
  valSch: VSchema;
  constructor(keySch: VSchema, valSch: VSchema) {
    super("record");
    this.keySch = keySch;
    this.valSch = valSch;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      pushIssue(issues, "record", input, "Object", null, path);
      return FAIL;
    }
    const src: { [k: string]: unknown } = input as { [k: string]: unknown };
    const out: { [k: string]: unknown } = {};
    const ks = Object.keys(src);
    let bad = 0;
    for (let i = 0; i < ks.length; i++) {
      const k = String(ks[i]);
      path.push(k);
      const rk = this.keySch._run(k, issues, path);
      if (rk instanceof VFail) {
        bad++;
      } else {
        const r = this.valSch._run(src[k], issues, path);
        if (r instanceof VFail) {
          bad++;
        } else {
          out[String(rk)] = r;
        }
      }
      path.pop();
    }
    if (bad > 0) {
      return FAIL;
    }
    return out;
  }
}

export class VUnion extends VSchema {
  options: VSchema[];
  expects: string;
  constructor(options: VSchema[]) {
    super("union");
    this.options = options;
    const names: string[] = [];
    for (let i = 0; i < options.length; i++) {
      names.push(options[i].kind);
    }
    this.expects = names.join("|");
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    for (let i = 0; i < this.options.length; i++) {
      const sub: VIssue[] = [];
      const p2: string[] = [];
      const r = this.options[i]._run(input, sub, p2);
      if (!(r instanceof VFail)) {
        return r;
      }
    }
    pushIssue(issues, "union", input, this.expects, null, path);
    return FAIL;
  }
}

export class VCustom extends VSchema {
  fn: (v: unknown) => boolean;
  expects: string;
  constructor(fn: (v: unknown) => boolean, expects: string) {
    super("custom");
    this.fn = fn;
    this.expects = String(expects);
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    if (this.fn(input)) {
      return input;
    }
    pushIssue(issues, "custom", input, this.expects, null, path);
    return FAIL;
  }
}

export class VPipe extends VSchema {
  inner: VSchema;
  acts: VSchema[];
  constructor(inner: VSchema, acts: VSchema[]) {
    super("pipe");
    this.inner = inner;
    this.acts = acts;
  }
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    const r = this.inner._run(input, issues, path);
    if (r instanceof VFail) {
      return FAIL;
    }
    let v: unknown = r;
    for (let i = 0; i < this.acts.length; i++) {
      const r2 = this.acts[i]._run(v, issues, path);
      if (r2 instanceof VFail) {
        return FAIL;
      }
      v = r2;
    }
    return v;
  }
}
