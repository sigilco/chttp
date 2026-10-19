# @chttp/mcp

## 0.4.0

### Minor Changes

- Move `@chttp/auth` and `@chttp/mcp` into the chttp monorepo from sigilco/cutils (where they shipped as 0.2.0). Both packages join the fixed versioning group and publish at chttp's shared version going forward. No source changes in the move — session/JWT/OAuth/CSRF/TOTP primitives and the JSON-RPC 2.0 MCP server land as-is, with gates wired into `scripts/scriptc-gate.sh` and docs pages added to the site nav.

- Typed client on a new `./client` subpath (`@chttp/mcp/client`): `Client` plus `toolDef`/`resourceDef`/`promptDef` schema-first descriptors that register on the server via `server.toolDef`, three transports (`fetch`, `node:net`/`node:tls` HTTP/1.1+SSE for the ELF path, stdio), `callTool`/`call`/`listTools`/`readResource`/`getPrompt`, progress-notification handlers, and `JsonRpcError` passthrough. Ported from sigilco/cutils PR #19.

### Patch Changes

- Fix Standard Schema v1 type compatibility for the mcp+val pairing (sigilco/cutils#27): `StdProps.version` is now the literal `1`, each concrete schema class merges a `StdTyped<I, O>` interface so `InferInput`/`InferOutput` resolve real types in `tool()` handlers, and `toJsonSchema`/`toOpenApiSchema` accept the `{"~standard": unknown}` structural minimum instead of requiring `VSchema`. In `@chttp/mcp`, response/listing records are built from `{}` open records or single full literals so expanding writes survive scriptc lowering of the packed dist. `pnpm smoke:pack` now packs `@chttp/mcp`, type-checks the pairing under tsc, and runs tools/list + tools/call through `Server.handleRequest` on the built ELF.

- Updated dependencies:
  - @chttp/router@0.4.0

## 0.2.0

### Patch Changes

- Wire ELF smoke into pnpm test; resolve scriptc via workspace .bin instead of pnpm exec

## 0.1.0

### Minor Changes

- Initial release: MCP server (JSON-RPC 2.0, spec 2025-06-18) in the scriptc subset — `Server` dispatcher over the full method table, `tool`/`resource`/`prompt` registration, Standard-Schema validation seam, injected `JsonSchemaEmitter`, auto-wrap ladder, `StreamableHttpTransport` with SSE `notifications/progress`.
