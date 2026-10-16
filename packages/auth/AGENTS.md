# auth AGENTS.md

`@chttp/auth` — session, password, JWT, OAuth2+PKCE, CSRF and TOTP primitives over `node:crypto`, in the scriptc compilable subset. Same subset rules as the root AGENTS.md, plus the constraints discovered while authoring this package:

- **`Map` is legal here by the same probe-verified exception as `@chttp/cache`** (0.3.3 lifted the Map/Set ban). `MemorySessionStore` uses it; other packages still need their own probe.
- **No asymmetric `node:crypto` in scriptc 0.3.3** — `createSign`/`createVerify`/`createPrivateKey`/`createPublicKey` (and therefore ES256) have NO lowering ("asymmetric-key operations need a public-key stack ... neither exists in the static runtime"). The spec's "full node:crypto surface" premise is stale. HS256 ships; ES256 is recognized-and-rejected (`E_BAD_ALG` on sign, null on verify) with the `string | KeyObject` signature kept for the upstream drop.
- **Hex goes through a lookup table** (`encoding.ts` `toHex`): `number.toString(16)` is SC2012-fenced and `Buffer.toString("hex")` is avoided on the same class of ground. base64url goes through `Buffer` — probe-verified.
- **`timingSafeEqual` throws on length mismatch** — every secret compare is length-pre-checked first. No `===` on secret material anywhere (the grep gate in the security checklist).
- **`verifyPassword` runs a dummy scrypt on malformed stored strings** — flattens the timing oracle between "row doesn't parse" and "password wrong".
- **scrypt needs explicit `maxmem`** — OWASP N=2^17·r=8 wants ~128 MiB, past Node's 32 MiB default; both `hashPassword` and `verifyPassword` pass `maxmem: 256 MiB` so legacy rows verify.
- **`SessionStore` members return `unknown`, never `T | Promise<T>`** — a Promise union arm is SC2009. The contract is sync-or-async (stores may return values or Promises; auth `await`s unconditionally, one microtask on sync stores). Same trick as the mcp `validate` signature.
- **`SessionStore<A>` / `SessionRecord<A>` / `MemorySessionStore<A>` are phantom generics** — no member signature may reference the type parameter (SC1090 at the call site). Runtime types are non-generic (`SessionRecordData`, `MemorySessionStoreCore`).
- **Standard Schema is a local twin, not an import** — `import type` of `@standard-schema/spec` is refused (SC2013); `src/types.ts` declares the structural twin and `runSchema` reads the `issues`/`value` shape at runtime. `@chttp/val` and valibot are dev-deps proving the seam.
- **`URLSearchParams.keys()` must be `for...of`'d directly** — storing the iterator first is SC1090.
- **Time injection is `nowMs` inside options records** (`SessionOpts`, `VerifyTotpOpts`) — numbers in records are legal; function-typed members are not. `MemorySessionStore` keeps the positional `now` ctor seam (the cache pattern).
- **Verify paths never throw** (null/false on ANY invalid input, incl. malformed JWT segments and non-2xx token endpoints); sign/exchange paths throw `E_*` code strings on caller bugs.
- `scriptc coverage packages/auth/gate.ts` must stay at 100% (via `scripts/scriptc-gate.sh`), and `test/elf.test.sh` must keep passing — 0.3.3 defers some fences to runtime.
- `scriptc` reports ANY program type error as `SC2013 cannot compile npm package '<pkg>' statically`, blaming an npm import even when the package is fine. When a consumer sees it, run `tsc --noEmit` first.

## Security checklist (gate before release)

- [x] All secret compares: length pre-check + `timingSafeEqual`.
- [x] `verifyPassword` runs a dummy hash on malformed stored strings.
- [x] Tokens ≥ 256 bits of entropy (384: 16-byte id + 32-byte secret); store keys are SHA-256 hex of the full token.
- [x] Cookie defaults: HttpOnly (session), SameSite=Lax, Path=/, Secure=true default, Max-Age bound to session TTL.
- [x] CSRF cookie NOT HttpOnly (double-submit needs a JS/page read) — documented in `cookie.ts`.
- [x] JWT: alg enforced, `none` rejected, exp/iat numeric-date seconds, leeway bounded (default 0 via `clockToleranceSeconds`).
- [x] OAuth state validated before code exchange in examples (app-side pattern; package docs show the state-cookie pattern).
- [x] No secrets or provider bodies in error paths (null-return contract; `E_*` codes carry no input).
- [x] OWASP scrypt parameters (N=2^17, r=8, p=1) as defaults, embedded in the hash string for forward upgrades.
- [x] `grep -n "=== " src/` review: `===` appears only on non-secret material (alg names, origin strings, lengths, typeof checks).
