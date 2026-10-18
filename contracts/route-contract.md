# Generated dispatch contract

Status: **frozen** — this is the seam between `packages/router/src/gen.ts` (`GenDispatch`) and `chttp` (route table + ctx machinery) and build-time code generators (the Vite/unplugin transform agent emits modules satisfying this contract). v0.3.0, 2026-10-13.

## The seam in one paragraph

`app.withDispatch(d)` registers a generated dispatch object. On every request, `app.serve()`/`app.handler()` calls `d.dispatch(req, res)` **first**. `true` = the request is handled (or committed to be handled asynchronously after a body-buffer); `false` = decline — chttp's internal specialized dispatch takes over. Routes stay registered on `app` either way: the generated module is a pure accelerator overlay, never a replacement for the route table.

## Module shape

```ts
import { GenDispatch } from '@chttp/router'

// Emit a CLASS, not an object literal. Under scriptc's eager
// program-code instantiation a function value inside a record
// instantiates the record as `unknown` and fences every call on it;
// class instances with methods compile cleanly. `extends GenDispatch`
// keeps the assignment nominal for both tsc and scriptc.
export class CompiledRoutes extends GenDispatch {
  dispatch(req: IncomingMessage, res: ServerResponse): boolean {
    // ... generated matcher ...
  }
}
```

Emitting code then wires it at app construction:

```ts
const app = createRouter()
app.withDispatch(new CompiledRoutes())
// app.get(...) calls still run — the route table stays the source of truth.
```

`GenDispatch` (from `src/gen.ts`, re-exported by `src/index.ts`):

```ts
export class GenDispatch {
  dispatch(req: IncomingMessage, res: ServerResponse): boolean {
    return false
  }
}
```

## Dispatch precedence — deterministic

1. `withDispatch` may be called at most once; a second call **replaces** the previous dispatch object (documented, deterministic — last wins).
1. Every request calls `dispatch` exactly once, before any internal work — including requests the generated module does not recognize.
1. `false` must only be returned **before** any response bytes, headers, or `req.on(...)` listeners are committed. Returning `false` after `setHeader`/`end`/body-listeners is a contract violation (undefined behavior, double-response).
1. Returning `true` after `app._buffer(...)` was invoked is correct even though the response completes later — the commitment is made at listener-attach time.
1. The internal dispatch never calls generated code; generated code never calls back into `App._dispatch`. One direction only.

## What generated code may use (the stable surface)

Everything below is a **contract member** — it will not change shape in 0.x without a major-version note. Members not listed are private.

```ts
// Construction: the generated matcher already parses the URL for its own
// matching — pass the pieces through, no double-parse.
const rv = new ReqView(raw, qs, path)   // (req, query-string-w/o-?, path-w/o-?)
const c  = new Ctx(rv, new NodeResponseSink(res))

// Params: after the generated matcher binds a route with params, seed the
// lazy param store with decoded name/value pairs — flat array, pairs of 2.
rv._seedPm(['id', dec(segValue)])       // 'id' → param('id'), '*' for splat
// If nothing is seeded, param() materializes from the entry declared on
// the internal table (only when the internal dispatch ran) — generated
// routes that return true MUST seed their own params.

// Body: ONLY for routes the author declared `body: true` at registration.
app-free helper, attaches 'data'/'end', buffers, then runs k under the
// send500 guard. Returns void; dispatch() must still return true.
_buffer(req, res, c, function (): unknown { return handler(c) })

// Guard: run the handler under the standard 500 path. The closure MUST
// return the chain result — _guard awaits a result that is not already
// settled (`undefined`/`null`/`c` are) so a rejected promise answers 500
// and a settled chain that wrote no response answers 500 too (checked via
// Ctx.sent + res headers).
_guard(res, c, function (): unknown { return handler(c) })
```

| Export             | Signature                                                 | Contract                                                                        |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GenDispatch`      | class, `dispatch(req,res): boolean`                       | subclass + override                                                             |
| `ReqView`          | `new (raw, qs, path)`                                     | qs/path already split at `?`                                                    |
| `ReqView._seedPm`  | `(pm: string[]) => void`                                  | flat decoded pairs incl `'*'`                                                   |
| `ReqView._setBody` | `(s: string) => void`                                     | set by `_buffer` only                                                           |
| `Ctx`              | `new (rv, sink)` + `json/text/html/status/header/redirect` | sink built via `new NodeResponseSink(res)`                                      |
| `NodeResponseSink` | `new (res)`                                               | wraps a ServerResponse into the sink Ctx consumes                               |
| `App.withDispatch` | `(d: GenDispatch) => App`                                 | last-wins, tried first per request                                              |
| `_buffer`          | `(req, res, c, k: () => unknown) => void`                 | data/end + `_setBody` + guarded `k`                                             |
| `_guard`           | `(res, c, k: () => unknown) => void`                      | `try { k() }`; result not settled → `await` it; throw/reject/unsent → `send500` |
| `dec`              | `(s: string) => string`                                   | `+`→space then `decodeURIComponent`, fallback raw                               |

## Body buffering — declared-body rule

The request body is buffered **only** when the route declared body use at registration. This is a hard contract, not a hint:

```ts
app.post('/echo', (c) => c.text(c.req.body()), { body: true })
```

- `body: true` + a body-carrying method (`POST`/`PUT`/`PATCH`/`DELETE`) → body is buffered before the handler chain runs; `c.req.body()` returns it.
- `body: true` + `GET`/`HEAD`/etc → no buffering (flag ignored for non-carrying methods).
- No declaration → **no buffering, `c.req.body()` returns `''`** — on generated and internal dispatch alike. 404/notFound paths never buffer.
- A call-site marker (`ctx.body()` auto-detection) is **rejected**: handler introspection is impossible inside the subset (`fn.toString`/`fn.length` are SC2020) and would be non-deterministic across the two runtimes. The registration flag is the one way to do it.
- `maxBodyBytes` is **not** implemented in v0.2 — document if needed later.

## Declared-multipart rule

A route that declares `multipart` in `RouteOpts` owns the request stream through `MultipartParser` — generated dispatch has no emit for it. Emitters **must decline** any route whose registration opts include `multipart` (return `false` / omit it from the emitted matcher, with a build warning): internal dispatch parses the body and the handler reads `c.req.file()`/`field()`/`files()`. Emitting a normal `_guard`/`_buffer` entry for a declared-multipart route serves it unparsed — `c.req.file()` silently returns `null`. Obligation added in contract v3.

## Rules for emitted code (scriptc subset — same as package internals)

The emitted module compiles into the user's program, so it lives under the same subset rules as `src/`:

- Handlers may be async (`Promise`-returning). The dispatch seam itself stays synchronous — `dispatch(req, res): boolean` and the `_guard`/ `_buffer` closures return the chain result so the guard can settle it. Rejections inside generated code run the built-in `send500`; `onError` only intercepts errors on the internal dispatch path.
- `null`, never `undefined`, in every union and return position.
- Class instances (not object literals) for `GenDispatch` impls.
- No function values inside records — generated tables hold `number` indices into a class-side `Handler[]` or emit static `if`/`switch` dispatch (both compile; `switch` on method strings and flat `if` chains are the recommended emit shapes).
- Indexed `for` loops; no `for…in`; no `?.` (use `&&`/`=== null`); no spread calls; no `new Function`/`eval`/`Object.create`.
- `String(x)`/`Number(x)` coercion at function entry for `unknown` params.
- `res.end(...)` statement-called. Body accumulation via `req.on('data', (c: Buffer) => …)` + `toString()` + `join`, or just call `_buffer`.
- `import type` / `.ts` specifiers / `for…of` over arrays / `instanceof` vs program classes / class getters / default params all compile clean.

## Versioning

The contract majors with the package: any change to a member listed in the stable-surface table bumps minor at minimum and is recorded here. The unplugin agent should pin `chttp` peer ranges accordingly.

## Contract versioning

`ROUTE_CONTRACT_VERSION` (currently `4`) is a plain number exported from `chttp` (defined in `src/gen.ts`, re-exported by `src/index.ts`). It exists so a stale generated module can never silently serve requests against a runtime that expects a different emit shape:

- **Lives in chttp.** The runtime is the source of truth; the constant is a plain `const` number, subset-clean.
- **Stamped into gen files.** Emitters write the same number as a literal — `export const ROUTE_CONTRACT_VERSION = 4;` in the module header next to the Source comment, and `ROUTE_CONTRACT_VERSION = 4` as an instance field on the emitted `CompiledRoutes` class (assigned after `super()`, shadowing the `GenDispatch` default). The gen file stays standalone: no import of the version, just the literal.
- **Validated at `withDispatch`.** If the dispatch object exposes a numeric `ROUTE_CONTRACT_VERSION` that differs from the runtime's, `app.withDispatch(d)` throws immediately, naming both versions. A missing stamp is accepted (dispatches that predate versioning).
- **Bump semantics.** Any breaking change to this contract — member shapes, dispatch obligations, the emitted-module grammar — bumps the number. Bump `chttp`'s export and `@chttp/unplugin`'s mirrored constant (`packages/unplugin/src/contract.ts`, asserted equal by test) in the same commit; a regenerated module then carries the new stamp.

```ts
// runtime (chttp)
import { GenDispatch, ROUTE_CONTRACT_VERSION } from '@chttp/router'
app.withDispatch(new CompiledRoutes(app)) // throws on stamp mismatch

// emitted header (.chttp/routes.gen.ts)
export const ROUTE_CONTRACT_VERSION = 4
export class CompiledRoutes extends GenDispatch {
  ROUTE_CONTRACT_VERSION = 4
  // ...
}
```
