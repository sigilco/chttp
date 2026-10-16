// CSRF: double-submit cookie + Origin allowlist — the two halves of the
// pattern. The token compare is constant-time (length pre-check, then
// timingSafeEqual); the origin allowlist is a plain string match — Origin
// is not secret material.

import { randomBytes, timingSafeEqual } from "node:crypto";

// base64url(32 random bytes).
export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

// Double-submit: the cookie token and the submitted (form field / header)
// token must match byte-for-byte under a constant-time compare.
export function verifyCsrfToken(
  cookieToken: string | null,
  submittedToken: string | null,
): boolean {
  if (cookieToken === null || submittedToken === null) {
    return false;
  }
  const a = Buffer.from(cookieToken, "utf8");
  const b = Buffer.from(submittedToken, "utf8");
  // timingSafeEqual throws on length mismatch — length pre-check.
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

// Origin check for state-changing requests (the other CSRF half): the
// request's Origin header must appear verbatim in the allowlist.
export function verifyRequestOrigin(
  originHeader: string | null,
  allowedOrigins: string[],
): boolean {
  if (originHeader === null) {
    return false;
  }
  for (let i = 0; i < allowedOrigins.length; i++) {
    if (allowedOrigins[i] === originHeader) {
      return true;
    }
  }
  return false;
}
