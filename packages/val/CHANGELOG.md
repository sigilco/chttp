# @chttp/val

## 0.4.0

### Patch Changes

- Fix Standard Schema v1 type compatibility for the mcp+val pairing (sigilco/cutils#27): `StdProps.version` is now the literal `1`, each concrete schema class merges a `StdTyped<I, O>` interface so `InferInput`/`InferOutput` resolve real types in `tool()` handlers, and `toJsonSchema`/`toOpenApiSchema` accept the `{"~standard": unknown}` structural minimum instead of requiring `VSchema`. In `@chttp/mcp`, response/listing records are built from `{}` open records or single full literals so expanding writes survive scriptc lowering of the packed dist. `pnpm smoke:pack` now packs `@chttp/mcp`, type-checks the pairing under tsc, and runs tools/list + tools/call through `Server.handleRequest` on the built ELF.

## 0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- unplugin: OpenAPI side channel emitting .chttp/routes.openapi.ts from proven @chttp/val schemas; val: toJsonSchema/toOpenApiSchema

### Patch Changes

- Fix runtime import of type-only VSafeResult in parse.ts so the source loads as program code
