// Code-string errors for caller bugs on the sign/exchange paths. Verify
// paths never throw — they return null/false — so these codes only fire for
// programmer error: missing key material, an alg the package does not sign,
// or malformed parameters.

export function authError(code: string, detail: string): Error {
  return new Error(code + ": " + detail);
}
