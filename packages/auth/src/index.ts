// @chttp/auth — public surface. Plain async functions over node:crypto:
// sessions (Lucia pattern), cookies, scrypt passwords, double-submit CSRF,
// HS256/ES256 JWT, OAuth2 authorization-code + PKCE, TOTP. Zero runtime
// dependencies; the schema seam is a local StandardSchemaV1 twin.

export {
  generateSessionToken,
  hashToken,
  createSession,
  validateSessionToken,
  invalidateSession,
  invalidateAllUserSessions,
} from "./session.ts";
export type {
  SessionRecord,
  SessionRecordData,
  SessionStore,
  SessionStoreCore,
  SessionOpts,
} from "./session.ts";
export { MemorySessionStore, MemorySessionStoreCore } from "./memory-store.ts";

export {
  serializeCookie,
  readCookie,
  buildSessionCookie,
  buildExpiredSessionCookie,
  buildCsrfCookie,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
} from "./cookie.ts";
export type { CookieAttrs, SessionCookieOpts } from "./cookie.ts";

export { hashPassword, verifyPassword } from "./password.ts";
export type { PasswordOpts } from "./password.ts";

export { generateCsrfToken, verifyCsrfToken, verifyRequestOrigin } from "./csrf.ts";

export { signJwt, verifyJwt, verifyJwtWith } from "./jwt.ts";
export type { SignJwtOpts, VerifyJwtOpts } from "./jwt.ts";

export {
  generateState,
  generateCodeVerifier,
  codeChallenge,
  createAuthorizationURL,
  exchangeCodeForTokens,
  fetchUserInfo,
  fetchUserInfoWith,
} from "./oauth.ts";
export type { OAuthProvider, TokenSet, AuthorizeParams, ExchangeParams } from "./oauth.ts";
export { googleProvider, githubProvider, discordProvider } from "./providers.ts";

export { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.ts";
export type { TotpUriOpts, VerifyTotpOpts } from "./totp.ts";

export { base32Encode, base32Decode, toHex, b64urlEncode, b64urlDecode } from "./encoding.ts";

export { authError } from "./errors.ts";
export { runSchema } from "./types.ts";
export type { StandardSchemaV1, InferOutput } from "./types.ts";
