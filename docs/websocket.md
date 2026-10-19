# WebSocket

`@chttp/ws` adds RFC 6455 WebSockets to `@chttp/router` through the upgrade seam described in `contracts/upgrade-contract.md` in the repo. It depends on `@chttp/router` only and is authored in the scriptc compilable subset.

## Usage

```ts
import { createRouter } from "@chttp/router";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WsConn, WsHandler, WsRouter } from "@chttp/ws";

class Room extends WsHandler {
  open(c: WsConn): void {
    c.send("joined " + c.param("name"));
  }
  message(c: WsConn, data: string): void {
    c.send(c.param("name") + ": " + data);
  }
}

const app = createRouter();
app.withUpgrade(new WsRouter().ws("/room/:name", new Room()));
const server = app.serve({ port: 3000 });
const up: (req: IncomingMessage, socket: Socket, head: Buffer) => void = app.upgradeHandler();
server.on("upgrade", up);
```

Paths match exactly or with `:param` segments. Param values are the raw path segments (not percent decoded) and are read with `c.param(name)`. The query string is ignored for matching.

## Handlers and connections

`WsHandler` is a base class with four methods, all no-ops by default:

| Method | Called when |
| --- | --- |
| `open(c)` | after the 101 response was written |
| `message(c, data: string)` | a complete text message arrived (valid UTF-8) |
| `binary(c, data: Buffer)` | a complete binary message arrived |
| `close(c, code, reason)` | exactly once: peer close frame, protocol error, `c.close()`, or socket loss (code 1006) |

Handlers are subclasses, not records of functions, because scriptc fences a function value inside a record. The router keeps them in parallel arrays next to their path patterns. One handler instance serves every connection on its path, so keep per connection state in your own structures keyed by the `WsConn`.

`WsConn` has `send(text)`, `sendBinary(buf)`, `ping(buf)` (at most 125 bytes), `close(code, reason)`, `param(name)`, `isOpen()`, and the fields `socket` and `path`. Pings from the peer are answered with a pong automatically.

## Handshake

The path is matched first, then the upgrade headers:

| Condition | Response |
| --- | --- |
| no route matches the path | 404 |
| `Upgrade` is not `websocket`, or `Sec-WebSocket-Version` is not `13` | 426 with `Sec-WebSocket-Version: 13` |
| method is not GET, or `Sec-WebSocket-Key` is missing or is not a base64-encoded 16 byte nonce | 400 |
| an origin allowlist is set and `Origin` does not match exactly | 403 |
| otherwise | 101 with `Sec-WebSocket-Accept` (sha1 of key plus the RFC GUID, base64) |

Error responses are written by the router and the socket is ended. `Connection` is not in the table because `node:http` only emits `"upgrade"` when the header already carries an `upgrade` token — a request reaching the dispatch is guaranteed to have one.

## Origin allowlist

By default every origin is accepted, matching the `ws` library. Apps that authenticate with cookies are exposed to cross-site WebSocket hijacking (CSWSH) under that default; register an exact-match allowlist and handshakes whose `Origin` header is missing or unlisted are rejected with 403:

```ts
new WsRouter().allowOrigin("https://app.example").ws("/echo", new Echo());
```

No subprotocol negotiation happens; check `req` yourself in a custom `UpgradeDispatch` if you need it.

## Framing and limits

The parser is incremental and non-recursive over `Buffer.concat`. It handles 7, 16 and 64 bit lengths, unmasking, fragmented messages with interleaved control frames, ping, pong and close with code validation. It answers violations by sending a close frame and ending the socket:

| Code | Cause |
| --- | --- |
| 1002 | reserved bits, unknown opcode, unmasked client frame, bad control frame, bad continuation order, bad close payload or code |
| 1007 | text message or peer close reason that is not valid UTF-8 |
| 1009 | frame or assembled message above `maxPayload`, or buffered input above `maxPending` |

Limits default to a 1 MiB `maxPayload` and `maxPayload + 128 KiB` for `maxPending` (unparsed bytes held per connection). Change them with `new WsRouter().withLimits(maxPayload, maxPending)`. A single frame is rejected from its header alone, before the payload is buffered. A fragmented message is different: each fragment is buffered as it arrives and the running total is checked, so a connection can hold up to roughly `maxPayload` assembled bytes before the 1009 fires. There is no permessage-deflate.

## Compiling to a native binary

Subclassing a package class (`WsHandler`, `UpgradeDispatch`) from your own program only lowers when the whole graph is program code, the same rule as `GenDispatch` in [unplugin](unplugin). A `node_modules` dist copy fails with "overriding a method with a different signature". Two consequences:

1. Vendor the sources. `examples/ws-echo/scripts/vendor.mjs` copies `@chttp/router` and `@chttp/ws` `src/` into `.vendor/` and points the ws import of `@chttp/router` at the vendored router, so `scriptc build src/main.ts` sees one source graph.
1. Wire the listener inline. `app.serve()` registers no `"upgrade"` listener at all (any attach built inside the package would defer two SC1090 sites under npm-static compilation, for every app importing the router, upgrade or not). Attach an annotated literal listener in your own program, as `examples/ws-echo/src/main.ts` does, or use a typed alias of `app.upgradeHandler()`:

```ts
server.on("upgrade", function (req: IncomingMessage, socket: Socket, head: Buffer): void {
  if (!ws.upgrade(req, socket, head)) {
    socket.destroy();
  }
});
```

`scriptc coverage` reports 100% static for the example after vendoring.

## Status and TODO

- TODO: Autobahn testsuite (fuzzingclient, Docker) against the node and native builds. Sections 1 to 7 are the target; permessage-deflate sections (12, 13) are out of scope. Results will go in `bench/RESULTS-ws.md`.
- TODO: throughput cell against `ws` on node.
- Not implemented: subprotocol negotiation, idle and close-handshake timeouts (a peer that never answers a close frame leaves the socket half-open until TCP teardown).
