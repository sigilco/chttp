// ELF smoke entry for @chttp/auth — built by `scriptc build` in
// test/elf.test.sh (not by tsc). Runs the RFC vectors end-to-end natively:
// scrypt hash+verify, full session round-trip on MemorySessionStore, HS256
// sign+verify, PKCE App.B challenge, TOTP + base32 RFC vectors. Prints OK.

import {
  MemorySessionStore,
  base32Decode,
  base32Encode,
  codeChallenge,
  createSession,
  generateSessionToken,
  hashPassword,
  signJwt,
  validateSessionToken,
  verifyJwt,
  verifyPassword,
  verifyTotp,
} from "../src/index.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error("elf-auth-smoke FAIL: " + msg);
  }
}

// password: hash (low N for speed) + verify both ways
const stored = hashPassword("hunter2", { N: 1024, r: 8, p: 1 });
assert(verifyPassword("hunter2", stored), "password verify");
assert(!verifyPassword("wrong", stored), "password reject");

// session round-trip on the dev store
const store = new MemorySessionStore();
const tok = generateSessionToken();
await createSession(store, tok, "u-1", { role: "admin" }, { ttlSeconds: 60 });
const rec = await validateSessionToken(store, tok, { ttlSeconds: 60 });
assert(rec !== null && rec.userId === "u-1", "session round-trip");
assert((await validateSessionToken(store, "a.b.c", {})) === null, "bad token null");

// HS256 sign + verify
const jwt = signJwt({ sub: "u-1" }, "elf-secret", { expiresInSeconds: 300 });
const claims = verifyJwt(jwt, "elf-secret");
assert(claims !== null && claims["sub"] === "u-1", "jwt round-trip");
assert(verifyJwt(jwt, "wrong-secret") === null, "jwt reject");

// PKCE: RFC 7636 Appendix B
assert(
  codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") ===
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  "pkce app-b",
);

// TOTP: RFC 6238 (time 59, 8 digits, SHA-1)
assert(
  verifyTotp("94287082", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", {
    digits: 8,
    window: 0,
    nowMs: 59000,
  }),
  "totp rfc6238",
);

// base32: RFC 4648 "foobar" vector
assert(
  base32Encode(new Uint8Array([102, 111, 111, 98, 97, 114])) === "MZXW6YTBOI",
  "base32 encode",
);
const dec = base32Decode("MZXW6YTBOI======");
assert(dec !== null && dec.length === 6, "base32 decode");

console.log("OK");
