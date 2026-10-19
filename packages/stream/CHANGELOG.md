# @chttp/stream

## 0.4.0

### Minor Changes

- feat(router): Web Standards generated-dispatch arm (GenFetch/withFetchDispatch, contract v4) + fetch emitter in unplugin; @chttp/stream streams through FetchResponseSink as a real ReadableStream

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.3.0

## 0.2.1

### Patch Changes

- Real TCP backpressure on scriptc 0.3.2. `@chttp/ws` and `@chttp/stream` now route outbound data through a compiled `Writable` wrapper whose `_write` forwards to the socket/response, so `write(): boolean`, `"drain"` and `writableLength` observe the real queue; the per-window byte caps stay as the secondary fail-safe (ws flood still closes 1008). When the wrapper ships inside a statically compiled npm package — where 0.3.2 never pumps a subclassed `_write` — it detects the dead pump at construction and degrades to direct writes, leaving the window cap as the only policy. Requires scriptc >= 0.3.2.

## 0.2.0

### Minor Changes

- Add @chttp/stream: streamSSE, SSEStream and streamText for Server-Sent Events and chunked text, with a pending-bytes cap for slow consumers

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.2.0
