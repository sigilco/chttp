// Shared test helpers: a minimal conforming StandardSchemaV1 stub and the
// fixture emitter used across the suite (seam-proof tests live in
// validate.test.js and run the same shapes through @chttp/val + valibot).

export function echoSchema() {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (v) => ({ value: v }),
    },
  };
}

// A rejecting twin of echoSchema: flags missing required keys.
export function objectSchema(requiredKeys) {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (v) => {
        const issues = [];
        const o = typeof v === "object" && v !== null ? v : {};
        for (const k of requiredKeys) {
          if (!(k in o)) {
            issues.push({ message: `missing ${k}`, path: [k] });
          }
        }
        return issues.length ? { issues } : { value: v };
      },
    },
  };
}

// Fixture emitter: stamps a deterministic draft-2020-12-ish object.
export function emit(_schema) {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };
}

export function emitNamed(tag) {
  return (_schema) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", tag });
}

export function rpc(method, params, id) {
  const r = { jsonrpc: "2.0", method };
  if (id !== undefined) r.id = id;
  if (params !== undefined) r.params = params;
  return r;
}
