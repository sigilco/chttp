# Upgrade dispatch contract

Status: draft for 0.x. This is the seam between `packages/router/src/upgrade.ts` (`UpgradeDispatch`) and protocol packages that take over a connection after an HTTP `Upgrade` request, such as `@chttp/ws`. It is independent of `contracts/route-contract.md`, which stays frozen.

## The seam in one paragraph

`app.withUpgrade(u)` registers an `UpgradeDispatch`. `app.serve()` never attaches an `"upgrade"` listener itself: any attach built inside the package dist defers two SC1090 sites under scriptc npm-static compilation, for every app importing the router, including apps that never upgrade. Upgrade apps therefore wire the listener in their own program, after `serve()` returns the server, with a listener whose parameter types are visible at their call site. Custom servers wire the same listener before `listen()`.

## Module shape

```ts
import { UpgradeDispatch } from '@chttp/router'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

// Subclass, do not emit an object literal: a function value inside a
// record fences every call on it under scriptc. Class instances with
// methods compile cleanly.
export class WsRouter extends UpgradeDispatch {
  upgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    // match req.url, run the handshake, take over the socket
    return false
  }
}
```

Wiring:

```ts
const app = createRouter()
app.withUpgrade(new WsRouter())
const server = app.serve({ port: 3000 })
// Typed in YOUR program: an inline annotated listener or a typed alias of
// upgradeHandler() both lower 100% under scriptc npm-static compilation.
// An attach built inside the package would defer for every app (see the
// "Why serve() does not attach" note below).
server.on('upgrade', function (req: IncomingMessage, socket: Socket, head: Buffer): void {
  if (!ws.upgrade(req, socket, head)) {
    socket.destroy()
  }
})
```

The alias form is the shorter one:

```ts
const server = app.serve({ port: 3000 })
const up: (req: IncomingMessage, socket: Socket, head: Buffer) => void = app.upgradeHandler()
server.on('upgrade', up)

// custom server, same listener before listen()
const server2 = http.createServer(app.handler())
server2.on('upgrade', up)
```

### Why serve() does not attach

Probed against scriptc 0.3.1 (2026-10-14): every attach shape inside the package — a factory call, a typed field bound in the constructor, an inline listener with JSDoc parameter types — defers two SC1090 sites for every npm-compiled app importing the router, even apps with no upgrades, because the listener's parameter types are unreadable from emitted `.js`. The same probe shows user-program attaches lower at 100%. With the attach removed, a full static + `serveStatic` app compiles `@chttp/router` npm-static with zero deferred sites.

The limit has a second face: `class X extends UpgradeDispatch` (or `WsHandler`) with the base class coming from npm is refused outright (`extending classes not declared in the program`) — the same wall as `GenDispatch`. Apps that compile to an ELF and subclass package classes vendor the sources into one program graph (see `examples/ws-echo/scripts/vendor.mjs`). JS-mode apps (plain `node`, bundlers) are unaffected and can subclass imports directly.


## Typing

The socket parameter is annotated `Socket` from `node:net`, with named imports. The `stream.Duplex` annotation that `@types/node` uses for the listener is rejected by scriptc at the type level (`No overload matches this call`), while `Socket` and `head: Buffer` compile at 100% static (see `bench/scriptc-evidence/frontend-probes-2026-10-14.txt`, case 4).

## Dispatch semantics

1. `withUpgrade` may be called at most once effectively: a later call replaces the earlier one (last wins).
1. The listener runs once per upgrade request, before any other work. The HTTP route table is not consulted; upgrade requests never reach `handler()`.
1. Return `true` when the upgrade is handled. The implementation owns the socket from that point: it must write the handshake response (or an error response) and eventually end or destroy the socket. The runtime does not touch it again.
1. Return `false` when the request is not recognized. Before returning `false` the implementation must not have written to or listened on the socket. The runtime then calls `socket.destroy()`, which matches node's behaviour when no `"upgrade"` listener exists.
1. `head` is the first bytes already read after the HTTP headers. Implementations must treat it as the start of the post-upgrade stream.
1. `upgradeHandler()` with nothing registered destroys every socket it receives.
1. `serve()` registers no `"upgrade"` listener. An app that registered a dispatch but never wires the listener gets node's default: the connection is destroyed.
1. A dispatch that throws is treated as unhandled: `upgradeHandler()` catches it and destroys the socket. Implementations should still answer protocol errors themselves and return `true`.

## Surface exported for protocol packages

- `UpgradeDispatch` (class, from `@chttp/router`).
- `App.withUpgrade`, `App.upgradeHandler`.

Route matching helpers (`matchPath`, `RouteNode`) are intentionally not exported. Protocol packages that need path matching should carry their own small trie.
