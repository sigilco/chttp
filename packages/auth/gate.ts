// scriptc coverage gate — exercises the full @chttp/auth public surface.
// scripts/scriptc-gate.sh requires `compile statically (100%)` here.

import {
  MemorySessionStore,
  base32Decode,
  base32Encode,
  buildCsrfCookie,
  buildExpiredSessionCookie,
  buildSessionCookie,
  codeChallenge,
  createAuthorizationURL,
  createSession,
  discordProvider,
  generateCodeVerifier,
  generateCsrfToken,
  generateSessionToken,
  generateState,
  generateTotpSecret,
  githubProvider,
  googleProvider,
  hashPassword,
  hashToken,
  invalidateAllUserSessions,
  invalidateSession,
  readCookie,
  serializeCookie,
  signJwt,
  toHex,
  totpAuthUri,
  validateSessionToken,
  verifyCsrfToken,
  verifyJwt,
  verifyJwtWith,
  verifyPassword,
  verifyRequestOrigin,
  verifyTotp,
  authError,
} from "./src/index.ts";
import type {
  ExchangeParams,
  OAuthProvider,
  SessionOpts,
  SessionStore,
  SignJwtOpts,
  StandardSchemaV1,
  VerifyJwtOpts,
  VerifyTotpOpts,
} from "./src/index.ts";

// ---------- sessions
const store = new MemorySessionStore();
const token = generateSessionToken();
const key = hashToken(token);
const created = await createSession(store, token, "user-1", { role: "admin" }, {
  ttlSeconds: 60,
} satisfies SessionOpts);
const validated = await validateSessionToken(store, token, {
  ttlSeconds: 60,
  extensionThresholdSeconds: 10,
  nowMs: created.expiresAt - 5 * 1000,
});
await invalidateSession(store, token);
await invalidateAllUserSessions(store, "user-1");

// Custom store impl satisfies the contract (SessionStore<A> phantom).
class FileStore implements SessionStore<{ role: string }> {
  _r: SessionStore<{ role: string }> | null = null;
  get(_k: string): unknown {
    return null;
  }
  set(_r: never): unknown {
    return null;
  }
  updateExpiry(_k: string, _e: number): unknown {
    return null;
  }
  delete(_k: string): unknown {
    return null;
  }
  deleteAllForUser(_u: string): unknown {
    return null;
  }
}
const fs = new FileStore();
await validateSessionToken(fs, "x.y");

// ---------- cookies
const setCookie = serializeCookie("n", "v", {
  maxAge: 10,
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
});
const got = readCookie("a=1; session=tok-9", "session");
const sc = buildSessionCookie(token, { secure: false, ttlSeconds: 60 });
const ec = buildExpiredSessionCookie({});
const cc = buildCsrfCookie("csrf-tok", { secure: true });

// ---------- passwords
const stored = hashPassword("hunter2", { N: 1024, r: 8, p: 1 });
const okPw = verifyPassword("hunter2", stored);
const badPw = verifyPassword("nope", stored);

// ---------- CSRF
const csrf = generateCsrfToken();
const csrfOk = verifyCsrfToken(csrf, csrf);
const originOk = verifyRequestOrigin("https://app.example", ["https://app.example"]);

// ---------- JWT
const hsOpts: SignJwtOpts = { expiresInSeconds: 60, issuer: "iss", audience: "aud" };
const hsToken = signJwt({ sub: "u1" }, "secret", hsOpts);
const vOpts: VerifyJwtOpts = { issuer: "iss", audience: "aud", clockToleranceSeconds: 1 };
const claims = verifyJwt(hsToken, "secret", vOpts);

// ES256 is recognized but unlowerable under scriptc 0.3.3 (no asymmetric
// node:crypto) — the gate covers the reject path.
let esRejected = "";
try {
  signJwt({ sub: "u2" }, "secret", { alg: "ES256" });
} catch (err) {
  esRejected = String(err);
}
const esClaims = verifyJwt(hsToken, "secret", { alg: "ES256" });

const schema: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "gate",
    validate: function (v: unknown): unknown {
      return { value: v };
    },
  },
};
const typed = await verifyJwtWith(hsToken, "secret", schema, vOpts);

// ---------- OAuth2 + PKCE
const state = generateState();
const verifier = generateCodeVerifier();
const challenge = codeChallenge(verifier);
const provider: OAuthProvider = googleProvider;
const gh: OAuthProvider = githubProvider;
const dc: OAuthProvider = discordProvider;
const authUrl = createAuthorizationURL(provider, "cid", "https://app/cb", {
  state: state,
  codeVerifier: verifier,
  extraQuery: { prompt: "consent" },
});
const xp: ExchangeParams = {
  code: "c",
  clientId: "cid",
  clientSecret: "sec",
  redirectURI: "https://app/cb",
  codeVerifier: verifier,
};
// exchange/fetchUserInfo hit the network — referenced for coverage only.
const _netRefs = [xp, challenge, gh, dc];

// ---------- TOTP + base32
const secret = generateTotpSecret();
const uri = totpAuthUri(secret, "acct@example", "issuer", { digits: 6, stepSeconds: 30 });
const vto: VerifyTotpOpts = { window: 1, stepSeconds: 30, digits: 6, nowMs: 59000 };
const totpOk = verifyTotp("942870", secret, vto);
const b32 = base32Encode(new Uint8Array([102, 111, 111]));
const b32d = base32Decode("MZXW6===");
const hex = toHex(new Uint8Array([0xde, 0xad]));
const e = authError("E_BAD_PARAMS", "gate");

if (
  key === "" ||
  validated === null ||
  setCookie === "" ||
  got === null ||
  sc === "" ||
  ec === "" ||
  cc === "" ||
  !okPw ||
  badPw ||
  !csrfOk ||
  !originOk ||
  claims === null ||
  esRejected === "" ||
  esClaims !== null ||
  typed === null ||
  authUrl === "" ||
  uri === "" ||
  !totpOk ||
  b32 === "" ||
  b32d === null ||
  hex === "" ||
  e === null
) {
  throw new Error("gate: unreachable");
}
