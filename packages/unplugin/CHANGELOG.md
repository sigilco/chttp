# @chttp/unplugin

## 0.4.0

### Minor Changes

- feat(router): Web Standards generated-dispatch arm (GenFetch/withFetchDispatch, contract v4) + fetch emitter in unplugin; @chttp/stream streams through FetchResponseSink as a real ReadableStream

### Patch Changes

- empty-body responses send no content-type (Hono parity); default text/plain charset is UTF-8

- Updated dependencies:
  - @chttp/router@0.4.0
  - @chttp/val@0.4.0

## 0.3.0

### Minor Changes

- Multipart uploads: per-route multipart option parses the stream at dispatch (memoryStorage/diskStorage, streaming maxFileBytes/maxFiles/maxFieldBytes -> 413), c.req.file/field/files/fields; unplugin declines declared-multipart routes (contract v3).

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.3.0
  - @chttp/val@0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- unplugin: OpenAPI side channel emitting .chttp/routes.openapi.ts from proven @chttp/val schemas; val: toJsonSchema/toOpenApiSchema

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.2.0
  - @chttp/val@0.2.0
