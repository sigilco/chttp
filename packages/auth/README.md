# @chttp/auth

Auth primitives for chttp apps — sessions (Lucia pattern), cookies, scrypt passwords, double-submit CSRF, HS256 JWT, OAuth2 authorization-code + PKCE, and TOTP — as plain async functions over `node:crypto`, authored in the scriptc-compilable subset. The same source builds to a JS package with `tsc` and lowers into a native ELF with `scriptc build`. Zero runtime dependencies.

Every function is string-in/string-out or boolean-out; none of them touches a request object — compose them inside `@chttp/router` handlers yourself.

## Quickstart

```ts
import {
  MemorySessionStore,
  buildSessionCookie,
  createSession,
  generateSessionToken,
  readCookie,
  validateSessionToken,
} from "@chttp/auth";

const store = new MemorySessionStore(); // dev/test only — see below

app.post("/login", async (c) => {
  const token = generateSessionToken();
  await createSession(store, token, "user-1", { role: "admin" });
  c.header("set-cookie", buildSessionCookie(token, { secure: false }));
  return c.status(201).text("ok");
});

app.get("/me", async (c) => {
  const tok = readCookie(c.req.header("cookie"), "session");
  const rec = tok === null ? null : await validateSessionToken(store, tok);
  if (rec === null) return c.status(401).text("unauthorized");
  return c.text("user:" + rec.userId);
});
```

## What it does

- **Sessions** — `generateSessionToken` (384-bit `id.secret` bearer token), `hashToken` (SHA-256 store key — the only thing persisted), `createSession`, `validateSessionToken` (sliding expiry: extends past `extensionThresholdSeconds`, deletes on expiry), `invalidateSession`, `invalidateAllUserSessions`. The `SessionStore` contract is sync-or-async: stores may return values or Promises; auth `await`s either way. `MemorySessionStore` ships for dev/test — **NOT for production** (process memory loses sessions on restart and shares nothing across replicas).
- **Cookies** — `serializeCookie`/`readCookie` plus prebuilt `buildSessionCookie` (HttpOnly, SameSite=Lax, Secure, Max-Age bound to TTL), `buildExpiredSessionCookie` (logout), `buildCsrfCookie` (deliberately not HttpOnly — double-submit needs a JS read).
- **Passwords** — `hashPassword`/`verifyPassword`, self-describing `scrypt:N:r:p:salt:hash` format, OWASP defaults (N=2^17, r=8, p=1, 64-byte key). Verify is timing-safe and dummy-hashes on malformed rows.
- **CSRF** — `generateCsrfToken`, `verifyCsrfToken` (constant-time double-submit compare), `verifyRequestOrigin` (Origin allowlist).
- **JWT** — `signJwt`/`verifyJwt`/`verifyJwtWith`, JWS compact only, HS256. Verify is null-on-invalid for every failure: bad format, wrong alg (`none` hard-rejected), bad signature, expired/nbf, issuer/audience mismatch. `verifyJwtWith` parses claims through any Standard Schema validator (`@chttp/val`, valibot, zod).
- **OAuth2 + PKCE** — `generateState`, `generateCodeVerifier`, `codeChallenge` (S256), `createAuthorizationURL`, `exchangeCodeForTokens` (form POST + basic auth, JSON or urlencoded responses), `fetchUserInfo`/`fetchUserInfoWith`. `googleProvider`, `githubProvider`, `discordProvider` presets are plain records — a new provider is a 15-LoC record in your code.
- **TOTP** — `generateTotpSecret` (base32), `totpAuthUri` (otpauth:// enrollment URI), `verifyTotp` (HMAC-SHA1, 6 digits, 30 s step, ±1 window, constant-time compare).

## Recipe: API keys

No dedicated module is needed — an API key is a session token whose record carries scopes and a far-future expiry. Only the SHA-256 hash is ever stored, so a database leak doesn't leak usable keys.

```ts
import {
  createSession,
  generateSessionToken,
  hashToken,
  invalidateSession,
  validateSessionToken,
} from "@chttp/auth";

// Provisioning: show `apiKey` to the caller exactly once.
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
const apiKey = generateSessionToken(); // id.secret bearer token (~64 chars)
await createSession(store, apiKey, ownerUserId, { scopes: ["read", "deploy"] }, {
  ttlSeconds: TEN_YEARS,
});

// Per request: "Authorization: Bearer <apiKey>". extensionThresholdSeconds: 0
// keeps the record's expiry fixed — API keys shouldn't slide on every call.
const key = bearer(c.req.header("authorization"));
const rec =
  key === null
    ? null
    : await validateSessionToken(store, key, { extensionThresholdSeconds: 0 });
if (rec === null) return c.status(401).text("unauthorized");
const scopes = rec.attributes.scopes as string[];
if (scopes.indexOf("deploy") < 0) return c.status(403).text("forbidden");

// Revocation is the same as sessions:
await invalidateSession(store, leakedKey);
```

Use `store.get(hashToken(key))` directly instead of `validateSessionToken` when you want to skip the expiry check entirely and manage revocation/rotation yourself; stamp `lastUsedAt` into `rec.attributes` on a throttle if you need audit fields.

## Notes

- **ES256 is not available in this build.** scriptc 0.3.3's static `node:crypto` slice covers hashing, randomness and secret KeyObjects — `createSign`/`createVerify` have no lowering, so `signJwt({ alg: "ES256" })` throws `E_BAD_ALG` and `verifyJwt` rejects ES256 tokens with null. The `string | KeyObject` signature is kept so the feature slots in upstream without a breaking change.
- **Verify paths never throw** — `null`/`false` on any invalid input (attacker-controlled). Sign and exchange throw `E_*` code strings only on caller bugs (missing key, bad alg, non-positive TTL).
- **`validateSessionToken` costs one microtask on sync stores** — the await-everything seam keeps postgres/redis adapters possible without forking the API; the SHA-256 dominates the cost anyway.
- **Refresh-token storage/rotation is app logic.** `exchangeCodeForTokens` returns the `TokenSet`; persist it alongside the session (and re-exchange when `expires_in` elapses) in your own store.

## Docs

Package page: [`docs/auth.md`](https://github.com/sigilco/chttp/tree/main/docs/auth.md) on the docs site. Contributor/subset notes: [`AGENTS.md`](./AGENTS.md) (subset bans + the release security checklist).
