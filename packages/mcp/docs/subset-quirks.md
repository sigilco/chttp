# scriptc subset notes

What the subset rules (root AGENTS.md) forced inside this package — the "why" a maintainer needs before touching `src/`.

- **Local `StandardSchemaV1` twin.** `import type` from `@standard-schema/spec` is refused (SC2013). The twin is structural: real schemas still assign, `~standard.validate` is the same call.
- **No `~standard` or schema objects in class fields.** Function-bearing records can't live in class fields, so `Server` keeps parallel arrays and `validatorFor` captures `schema["~standard"]` in a `ValidateFn` closure (also preserves `this` for `@chttp/val`'s `StdProps`). Emitted JSON Schemas are stored serialized as `string`.
- **Handler slots erase `=> unknown`.** `Promise<T>` declarations on registered handlers record `(u,u) => Promise<erased T>` on the value and fail at the erased call site (`Promise<string>` has no conversion into `Promise<unknown>`). Handlers are typed `=> unknown`; the dispatcher casts to `Promise<unknown>` before `await`.
- **No `MaybePromise` / union returns.** `T | Promise<T>` is SC2009 — handlers and `pushProgress` are async-only.
- **No `instanceof Error`.** Error messages are read structurally (`typeof e.message === "string"`).
- **`crypto` global is `unknown`** — session IDs come from `node:crypto`'s `randomUUID`, wrapped in a closure (a bare function value hits SC1090).
- **`new Request()` is not constructible** under scriptc 0.3.x. The transport reads `req.url`/`method`/`headers`/`body` only; tests drive it through undici's Request, the ELF smoke drives `handleRequest` directly.
- **`ReadableStream<Uint8Array>` only**, and no `ReadableStreamDefaultController` class fields — `SseSession` stores `push`/`end` function fields instead.
- **Generic method params keep their erased signature.** Casts don't re-record it; a non-generic delegate param does (`_pushToolHandler`).
- **`for...in` is allowed** in this repo's subset (router precedent: `copyHeaders`) — used for prompt-argument iteration.
- **`"id": null` on the wire** for unparseable requests is produced via an `as JsonRpcResponse` cast — `RequestId` excludes `null` but the JSON-RPC spec requires `"id": null`.
