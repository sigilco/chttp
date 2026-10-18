// Core types, failure sentinel, and issue helpers shared by every module.

export class VIssue {
  // Spec-conformant members: message + path (PropertyKey segments).
  type: string;
  expected: string | null;
  received: string;
  message: string | null;
  path: string[] | null;

  constructor(
    type: string,
    expected: string | null,
    received: string,
    message: string | null,
    path: string[] | null,
  ) {
    this.type = String(type);
    this.expected = expected;
    this.received = String(received);
    this.message = message;
    this.path = path;
  }
}

export interface VSafeResult {
  success: boolean;
  output: unknown;
  issues: VIssue[] | null;
}

export interface VStdResult {
  value: unknown;
  issues: VIssue[] | null;
}

// Failure sentinel: `_run` returns this object — class identity is the
// discriminator (mirrors chttp's isSettled trick), never a data value.
export class VFail {
  _f: number;
  constructor() {
    this._f = 1;
  }
}
export const FAIL: VFail = new VFail();

// Phantom Standard Schema `types` slot carried by concrete schemas: each
// schema class merges a same-named interface that narrows `"~standard"` to
// `StdTyped<I, O>`, so a consumer's `InferInput`/`InferOutput` resolves real
// types (e.g. the @chttp/mcp tool() handler input). Type-level only — the
// class field stays `StdProps`, so nothing changes at runtime or for
// scriptc lowering (cutils#27).
export interface StdTyped<I, O> extends StdProps {
  types: { input: I; output: O };
}

export class StdProps {
  // Literal `1`, not `number`: Standard Schema v1 requires the literal, and
  // a `number` field makes every val schema refuse StandardSchemaV1
  // assignment (TS2345/TS2739 in consumers — cutils#27).
  version: 1;
  vendor: string;
  schema: VSchema;
  constructor(schema: VSchema) {
    this.version = 1;
    this.vendor = "val";
    this.schema = schema;
  }
  validate(input: unknown): VStdResult {
    const issues: VIssue[] = [];
    const path: string[] = [];
    const r = this.schema._run(input, issues, path);
    if (r instanceof VFail) {
      return { value: null, issues: issues };
    }
    return { value: r, issues: null };
  }
}

export class VSchema {
  kind: string;
  "~standard": StdProps = new StdProps(this);

  constructor(kind: string) {
    this.kind = String(kind);
  }

  // Returns the (possibly transformed) output, or the FAIL sentinel.
  _run(input: unknown, issues: VIssue[], path: string[]): unknown {
    return FAIL;
  }
}

export function receivedOf(input: unknown): string {
  if (input === null) {
    return "null";
  }
  const t = typeof input;
  if (t === "object" && Array.isArray(input)) {
    return "array";
  }
  return t;
}

export function pushIssue(
  issues: VIssue[],
  type: string,
  input: unknown,
  expected: string | null,
  message: string | null,
  path: string[],
): void {
  issues.push(new VIssue(type, expected, receivedOf(input), message, path.slice()));
}
