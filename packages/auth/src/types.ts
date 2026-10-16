// Shared types for @chttp/auth.
//
// StandardSchemaV1 below is a structural twin of the interface published by
// @standard-schema/spec (Standard Schema v1). The npm package is types-only
// and scriptc refuses even `import type` of it in the compiled module graph
// (SC2013), so the twin is declared here — same approach as @chttp/mcp's
// src/types.ts. Structural identity means any real Standard Schema v1
// validator (@chttp/val, valibot, zod/v4 standard entry) is assignable to
// this twin and vice versa. The spec text: https://standardschema.dev

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
    // `unknown` (not `Result | Promise<Result>`): a Promise union arm is
    // SC2009 in the subset, and every conforming validator — whose real
    // signature returns `Result<Output> | Promise<Result<Output>>` — is
    // still assignable to a function returning `unknown`. runSchema
    // awaits the value and reads the shape at runtime.
    readonly validate: (value: unknown) => unknown;
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

export type InferOutput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

// Runs a Standard-Schema validator over untrusted input (JWT claims, OAuth
// userinfo). Returns the validated value or null — the auth verify-path
// contract is null-on-invalid, never throw. The validate call may return a
// Result or a Promise<Result>; awaiting unknown covers both without ever
// sniffing `.then` (SC2009).
export async function runSchema(schema: StandardSchemaV1, value: unknown): Promise<unknown | null> {
  let res: unknown;
  try {
    res = await schema["~standard"].validate(value);
  } catch {
    return null;
  }
  if (res === null || typeof res !== "object") {
    return null;
  }
  const r = res as { [k: string]: unknown };
  const issues = r["issues"];
  if (issues !== undefined && issues !== null) {
    return null;
  }
  if (!("value" in r)) {
    return null;
  }
  return r["value"];
}
