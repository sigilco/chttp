# @chttp/mcp

## 0.2.0

### Patch Changes

- Wire ELF smoke into pnpm test; resolve scriptc via workspace .bin instead of pnpm exec

## 0.1.0

### Minor Changes

- Initial release: MCP server (JSON-RPC 2.0, spec 2025-06-18) in the scriptc subset — `Server` dispatcher over the full method table, `tool`/`resource`/`prompt` registration, Standard-Schema validation seam, injected `JsonSchemaEmitter`, auto-wrap ladder, `StreamableHttpTransport` with SSE `notifications/progress`.
