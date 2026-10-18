# @chttp/auth

Auth primitives for chttp apps — sessions, cookies, scrypt passwords, CSRF, JWT, OAuth2+PKCE and TOTP — as plain async functions over `node:crypto`, authored in the scriptc-compilable subset. The same source builds to a JS package with `tsc` and lowers into a native ELF with `scriptc build`. Zero runtime dependencies.

```ts
import {
  MemorySessionStore,
  buildSessionCookie,
  createSession,
  generateSessionToken,
  readCookie,
  validateSessionToken,
} from "@chttp/auth";
```

## What it does

- **Sessions (Lucia pattern)** — a 384-bit `id.secret` bearer token, `hashToken` SHA-256 store key (the only thing persisted), `createSession`, `validateSessionToken` with sliding expiry, `invalidateSession`/`invalidateAllUserSessions`. The `SessionStore` contract is sync-or-async — stores may return values or Promises; auth `await`s either way (one microtask on sync stores). `MemorySessionStore` is dev/test only, **not for production**.
- **Cookies** — `serializeCookie`/`readCookie` plus `buildSessionCookie` (HttpOnly, Lax, Secure, Max-Age bound to TTL), `buildExpiredSessionCookie` for logout, `buildCsrfCookie` (not HttpOnly by design — double-submit needs a JS read).
- **Passwords** — `hashPassword`/`verifyPassword` in the self-describing `scrypt:N:r:p:salt:hash` format with OWASP defaults; parameter upgrades don't invalidate old hashes, and verify dummy-hashes on malformed rows to flatten timing.
- **CSRF** — `generateCsrfToken`, `verifyCsrfToken` (constant-time compare), `verifyRequestOrigin` (Origin allowlist) — the two halves of the pattern.
- **JWT** — `signJwt`/`verifyJwt`/`verifyJwtWith`, JWS compact, HS256. Verify is null-on-invalid for every failure and `none` is hard-rejected; `verifyJwtWith` parses claims through any [Standard Schema](https://standardschema.dev) validator (`@chttp/val`, valibot, zod).
- **OAuth2 + PKCE** — `generateState`, `generateCodeVerifier`, `codeChallenge`, `createAuthorizationURL`, `exchangeCodeForTokens` (form POST + basic auth; JSON and form-urlencoded responses both parse), `fetchUserInfo`/`fetchUserInfoWith`. `googleProvider`, `githubProvider`, `discordProvider` presets; a new provider is a 15-LoC record in user code.
- **TOTP** — `generateTotpSecret` (base32, RFC 4648), `totpAuthUri` (otpauth:// enrollment URI), `verifyTotp` (HMAC-SHA1, 6 digits, 30 s step, ±1 window, constant-time).

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

## Status

v0.1.0. ES256 is recognized but unlowerable under scriptc 0.3.3 (no asymmetric `node:crypto` lowering): `signJwt` throws `E_BAD_ALG`, `verifyJwt` returns null, and the `string | KeyObject` signature is kept for the upstream drop. JWE, JWKS, EdDSA, WebAuthn and Argon2 are out of scope by design — see the package AGENTS.md and the plan in `.agents/plans/`.
