# mcp AGENTS.md

`@chttp/mcp` — Model Context Protocol server (JSON-RPC 2.0, spec revision 2025-06-18) in the scriptc compilable subset. Same subset rules as the root AGENTS.md, plus the constraints discovered while authoring this package:

- **Standard Schema is a local twin, not an import.** `import type { StandardSchemaV1 } from "@standard-schema/spec"` is refused by scriptc (SC2013, "looks minified"). `src/types.ts` declares a structural twin; validation runs through the same `schema["~standard"].validate` seam. The package stays a dev-dep so test files can type-check fixtures against the real spec.
- **Handler slots erase to `=> unknown`.** A declared `Promise<T>` on the registered handler records `(u, u) => Promise<erased T>` on the function value, and `Promise<string>` has no lowering into `Promise<unknown>` at the erased call site — the dispatch fails at runtime inside the ELF. `ToolHandler`/`ResourceHandler`/`PromptHandler` therefore return `unknown`; `input` stays typed via `InferOutput`, and the auto-wrap ladder validates the returned value. Dispatch `await`s the slot's unknown result after a `Promise<unknown>` cast.
- **Generic methods keep the param's erased signature.** Inside `tool<Schema, Out>` a `handler as unknown as ToolFn` cast does NOT re-record the erased signature — the value keeps `(u, u) => Promise<unknown>` and breaks at the call site. Re-admission through a non-generic param (`_pushToolHandler`) records `=> unknown`. Same for res/prm handlers.
- **Generic narrowing degrades to `Out & {}` (SC2009).** `opts.outputSchema` is narrowed through a `StandardSchemaV1 | null` local, never the generic `Out`.
- **Function-bearing records can't be class fields.** Registrations live in parallel arrays (`_toolNames`/`_toolValidate`/`_toolHandlers`/…); schemas themselves are never stored — `validatorFor` captures `schema["~standard"]` in a closure (which also preserves `this` for `@chttp/val`'s `StdProps.validate`), and emitted JSON Schemas are stored serialized as `string` (records can't nest).
- **`crypto` global is `unknown` under scriptc** — use `import { randomUUID } from "node:crypto"`, wrapped in a closure (function values passed bare hit SC1090).
- **`instanceof Error` is banned** — `errorFor`/`wrapToolError` read `.message` structurally.
- **`new Request()` is not constructible under scriptc 0.3.x.** The transport only _consumes_ Requests (url/method/headers/body); the ELF smoke (`test/elf-smoke.ts`) exercises `handleRequest` + the SSE encoder via argv/stdout instead.
- **ReadableStream generics must be `<Uint8Array>`** — `ReadableStream<unknown>`/controller-typed class fields are refused; `SseSession` stores `push`/`end` function fields.
- `scriptc coverage packages/mcp/gate.ts` must stay 100% — `scripts/scriptc-gate.sh` is the gate.
- `pnpm --filter @chttp/mcp test` runs the node:test suite against the tsc build (`test/*.test.js`); `bash test/elf.test.sh` builds + runs the ELF smoke.
- Handlers are async-only (`T | Promise<T>` return unions are SC2009); transport push is `Promise<void>` for the same reason.
