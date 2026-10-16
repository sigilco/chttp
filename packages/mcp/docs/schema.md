# Schema seams

Two seams keep `@chttp/mcp` validator-agnostic. Both are documented in the spec at `.agents/plans/2026-10-15-chttp-mcp.md`.

## Validation: Standard Schema

Every `tool` call takes a [Standard Schema](https://standardschema.dev): an object exposing `schema["~standard"].validate`. `arguments` in `tools/call` are validated before the handler runs; a failure returns `-32602` with `{ issues: [...] }` in `error.data`.

```ts
// These all work — the seam is structural, not an import.
tool(server, "a", valSchema, handler);
tool(server, "b", v.object({ x: v.number() }), handler);   // valibot
tool(server, "c", z.object({ x: z.number() }), handler);   // zod (node builds)
```

Note: under scriptc only schemas that themselves compile to ELF survive a `scriptc build` — in practice that means `@chttp/val` schemas inside an ELF app. zod/valibot work on the node (`tsc` + `node`) build.

## Emission: JsonSchemaEmitter

`tools/list` must publish `inputSchema` (and optionally `outputSchema`) as JSON Schema draft 2020-12. Emission is injected, not bundled — the package ships zero schema code:

```ts
new Server({ name, version, emitJsonSchema: (s) => v.toJsonSchema(s) });   // @chttp/val
new Server({ name, version, emitJsonSchema: (s) => toJsonSchema(s) });     // @valibot/to-json-schema
new Server({ name, version, emitJsonSchema: (s) => z.toJSONSchema(s) });   // zod v4
```

A per-tool `emit` in `ToolOpts` overrides the server emitter. With neither, registration throws `NoEmitterError` (`code: "E_NO_JSON_SCHEMA_EMITTER"`) — loudly at startup, not on first `tools/list`. Emitters run at registration; the serialized JSON is what `tools/list` serves.

## The local twin

`import type { StandardSchemaV1 } from "@standard-schema/spec"` is refused by scriptc (SC2013). `types.ts` declares a structural twin with the same `~standard` shape, so real schemas assign cleanly at the tsc layer and the runtime seam (`schema["~standard"].validate`) is identical. `validatorFor` captures the `~standard` props in a closure — preserving the validator's own `this`, which `@chttp/val`'s `StdProps.validate` reads.
