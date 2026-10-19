# @chttp/ws

## 0.4.0

### Minor Changes

- feat(ws): post-merge audit hardening for issue #13 — `allowOrigin` exact-match allowlist (403), `Sec-WebSocket-Key` base64/16-byte format check, peer close-reason UTF-8 validation (1007); `upgradeHandler()` catches a throwing dispatch and destroys the socket; `UpgradeFn` re-exported

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

- ws-echo example adds a `/ffi/{text}` route demonstrating `scriptc --ffi` outbound FFI with a call-scoped callback; see `docs/native.md`.

## 0.2.0

### Minor Changes

- Add @chttp/ws: WebSocket router, RFC 6455 framing, and WsHandler/WsConn on the router upgrade seam

### Patch Changes

- Updated dependencies:
  - @chttp/router@0.2.0
