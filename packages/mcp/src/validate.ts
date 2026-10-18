// The dual seam.
//
// Validation seam (standardized): every schema is a StandardSchemaV1; args
// are checked via schema["~standard"].validate, normalized here to a flat
// { value, issues } outcome so callers never see the union arms.
//
// Emission seam (injected): Standard Schema v1 covers validation only, while
// MCP requires draft 2020-12 JSON Schema for inputSchema/outputSchema. The
// emitter is a JsonSchemaEmitter passed per tool (`emit`) or per server
// (`emitJsonSchema`); registering without either throws
// E_NO_JSON_SCHEMA_EMITTER — an honest error beats silently emitting {}.

import { NoEmitterError } from "./errors.ts";
import type { JsonSchemaEmitter, StandardSchemaV1 } from "./types.ts";

// Flat validation outcome: the success/failure union of Standard Schema
// collapsed to `issues: null` on success (| null unions only, SC3004).
export interface StdOutcome {
  value: unknown;
  issues: unknown;
}

export type ValidateFn = (input: unknown) => Promise<StdOutcome>;

// Calls props.validate and normalizes the result. Awaiting a non-Promise is
// fine, so validators that answer synchronously take the same path.
export async function runStdValidate(
  std: StandardSchemaV1.Props<unknown, unknown>,
  input: unknown,
): Promise<StdOutcome> {
  const r = await std.validate(input);
  const issues = (r as { issues?: unknown }).issues;
  if (issues === undefined || issues === null) {
    return { value: (r as { value?: unknown }).value, issues: null };
  }
  return { value: null, issues: issues };
}

// Registration-time: captures the schema's ~standard props in a closure so
// the validator keeps its own `this` (val's StdProps.validate reads
// this.schema). Storing the schema object itself would fence the class
// (function-bearing records can't live in class fields).
export function validatorFor(schema: StandardSchemaV1): ValidateFn {
  const std = schema["~standard"];
  return function (input: unknown): Promise<StdOutcome> {
    return runStdValidate(std, input);
  };
}

export function resolveEmitter(
  toolEmit: JsonSchemaEmitter | null,
  serverEmit: JsonSchemaEmitter | null,
  toolName: string,
): JsonSchemaEmitter {
  if (toolEmit !== null) {
    return toolEmit;
  }
  if (serverEmit !== null) {
    return serverEmit;
  }
  throw new NoEmitterError(toolName);
}

// Emits + serializes a draft 2020-12 schema for storage. Stored as JSON text
// (not the object) because {[k:string]: unknown} records can't be class
// fields — the string round-trips verbatim into tools/list output.
export function emitSchemaJson(emitter: JsonSchemaEmitter, schema: StandardSchemaV1): string {
  return JSON.stringify(emitter(schema));
}
