// JWT — JWS compact serialization only. ~120 LoC over node:crypto; no JWE,
// no JWKS machinery, no EdDSA in v1 (follow-up tickets).
//
// - alg comes from the key type: string => HS256 secret, KeyObject =>
//   ES256 P-256 (the spec's v2 path). Overridable via opts.alg; verify
//   enforces the expected alg, so there is no alg-confusion window and
//   "none" is hard-rejected.
// - ES256 IS RECOGNIZED BUT NOT LOWERABLE TODAY: scriptc 0.3.3's static
//   node:crypto slice covers hashing, randomness and secret KeyObjects —
//   createSign/createVerify/createPrivateKey/createPublicKey have no
//   lowering (asymmetric ops need a public-key stack the runtime lacks).
//   signJwt({ alg: "ES256" }) throws E_BAD_ALG and verifyJwt rejects ES256
//   tokens with null; the `string | KeyObject` signature stays so the
//   feature slots in upstream without a breaking change. When it lands it
//   must sign/verify with dsaEncoding "ieee-p1363" (JWS carries raw R||S,
//   not DER — the classic interop bug; RFC 7515 A.3 vector is in tests).
// - Verify is null-on-invalid for ANY failure: bad format, wrong alg, bad
//   signature, expired/nbf, wrong issuer/audience. Never throws — callers
//   branch on null instead of try/catching attacker input. Sign throws on
//   caller bugs (missing/wrong key) because those are programmer errors.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { authError } from "./errors.ts";
import { b64urlDecode, b64urlEncode } from "./encoding.ts";
import { runSchema } from "./types.ts";
import type { StandardSchemaV1 } from "./types.ts";

export interface SignJwtOpts {
  alg?: "HS256" | "ES256"; // inferred from key type if omitted; ES256 -> E_BAD_ALG
  expiresInSeconds?: number; // sets exp = iat + this
  issuer?: string;
  audience?: string;
}

export interface VerifyJwtOpts {
  alg?: "HS256" | "ES256"; // inferred from key type if omitted
  issuer?: string;
  audience?: string;
  clockToleranceSeconds?: number; // default 0; applies to exp and nbf
}

function inferAlg(key: string | KeyObject): string {
  return typeof key === "string" ? "HS256" : "ES256";
}

export function signJwt(
  payload: { [k: string]: unknown },
  key: string | KeyObject,
  opts?: SignJwtOpts,
): string {
  const o = opts === undefined || opts === null ? {} : opts;
  const alg = o.alg === undefined ? inferAlg(key) : o.alg;
  if (alg === "ES256") {
    throw authError(
      "E_BAD_ALG",
      "ES256 needs node:crypto asymmetric ops, which scriptc 0.3.3 does not lower",
    );
  }
  if (alg !== "HS256") {
    throw authError("E_BAD_ALG", "signJwt supports HS256 only");
  }
  if (typeof key !== "string") {
    throw authError("E_NO_KEY", "HS256 requires a string secret");
  }
  const now = Math.floor(Date.now() / 1000);
  const claims: { [k: string]: unknown } = {};
  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i++) {
    claims[keys[i]] = payload[keys[i]];
  }
  claims["iat"] = now;
  if (o.expiresInSeconds !== undefined) {
    claims["exp"] = now + o.expiresInSeconds;
  }
  if (o.issuer !== undefined) {
    claims["iss"] = o.issuer;
  }
  if (o.audience !== undefined) {
    claims["aud"] = o.audience;
  }
  const header = { alg: alg, typ: "JWT" };
  const input =
    b64urlEncode(Buffer.from(JSON.stringify(header), "utf8")) +
    "." +
    b64urlEncode(Buffer.from(JSON.stringify(claims), "utf8"));
  const sig = createHmac("sha256", key).update(input).digest();
  return input + "." + b64urlEncode(sig);
}

function audMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") {
    return aud === expected;
  }
  if (Array.isArray(aud)) {
    for (let i = 0; i < aud.length; i++) {
      if (aud[i] === expected) {
        return true;
      }
    }
  }
  return false;
}

// null on ANY failure: bad format, wrong alg, bad signature, expired, wrong
// issuer/audience. alg "none" always rejected. Never throws.
export function verifyJwt(
  token: string,
  key: string | KeyObject,
  opts?: VerifyJwtOpts,
): { [k: string]: unknown } | null {
  const o = opts === undefined || opts === null ? {} : opts;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const expectedAlg = o.alg === undefined ? inferAlg(key) : o.alg;
    const headerRaw = JSON.parse(b64urlDecode(parts[0]).toString("utf8")) as {
      [k: string]: unknown;
    };
    const alg = headerRaw["alg"];
    if (alg !== expectedAlg) {
      // Covers "none", alg-confusion, and any unsupported alg.
      return null;
    }
    if (alg !== "HS256" || typeof key !== "string") {
      // ES256 (or anything non-HS256) is unverifiable in this build; a
      // KeyObject key has no usable signing surface either.
      return null;
    }
    const input = parts[0] + "." + parts[1];
    const sigBytes = b64urlDecode(parts[2]);
    const expected = createHmac("sha256", key).update(input).digest();
    // timingSafeEqual throws on length mismatch — length pre-check.
    if (expected.length !== sigBytes.length) {
      return null;
    }
    if (!timingSafeEqual(expected, sigBytes)) {
      return null;
    }
    const claims = JSON.parse(b64urlDecode(parts[1]).toString("utf8")) as { [k: string]: unknown };
    if (claims === null || typeof claims !== "object" || Array.isArray(claims)) {
      return null;
    }
    const tol = o.clockToleranceSeconds === undefined ? 0 : o.clockToleranceSeconds;
    const now = Math.floor(Date.now() / 1000);
    const exp = claims["exp"];
    if (exp !== undefined) {
      if (typeof exp !== "number") {
        return null;
      }
      if (now - tol >= exp) {
        return null; // expired
      }
    }
    const nbf = claims["nbf"];
    if (nbf !== undefined) {
      if (typeof nbf !== "number") {
        return null;
      }
      if (now + tol < nbf) {
        return null; // not yet valid
      }
    }
    if (o.issuer !== undefined) {
      if (claims["iss"] !== o.issuer) {
        return null;
      }
    }
    if (o.audience !== undefined) {
      if (!audMatches(claims["aud"], o.audience)) {
        return null;
      }
    }
    return claims;
  } catch {
    return null;
  }
}

// val-first twin of verifyJwt: verifies, then parses the claims through any
// StandardSchemaV1 (@chttp/val, valibot, ...). Returns the typed claims or
// null — the positional-schema convention (`prepare(sql, schema)`).
export async function verifyJwtWith<Schema extends StandardSchemaV1>(
  token: string,
  key: string | KeyObject,
  schema: Schema,
  opts?: VerifyJwtOpts,
): Promise<StandardSchemaV1.InferOutput<Schema> | null> {
  const claims = verifyJwt(token, key, opts);
  if (claims === null) {
    return null;
  }
  const out = await runSchema(schema, claims);
  if (out === null) {
    return null;
  }
  return out as StandardSchemaV1.InferOutput<Schema>;
}
