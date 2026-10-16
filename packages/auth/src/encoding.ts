// Byte <-> text helpers shared across the auth primitives.
//
// - Hex goes through a lookup table: `number.toString(16)` is SC2012-fenced
//   under scriptc (probe finding from the hono/jwt attempt), and
//   `Buffer.toString("hex")` on variable digests is avoided for the same
//   class of reason — the table is deterministic.
// - base64url goes through Buffer (`Buffer.from(bytes).toString("base64url")`
//   — probe-verified static in scriptc 0.3.3). Output is unpadded, which is
//   what session tokens, PKCE challenges and JWS all require.
// - base32 is a 40-LoC RFC 4648 hand-roll (standard alphabet, no padding on
//   encode, padding/lowercase tolerated on decode). It exists only for TOTP.

const HEX_DIGITS = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_DIGITS[b >>> 4] + HEX_DIGITS[b & 15];
  }
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function b64urlDecode(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32, no padding emitted (otpauth secrets are unpadded).
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

// Tolerates `=` padding and lowercase input; returns null on any character
// outside the RFC 4648 alphabet (null-on-invalid — this is attacker input
// when it comes from a stored secret or a user-typed key).
export function base32Decode(text: string): Uint8Array | null {
  const upper = text.toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (ch === "=") {
      break;
    }
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      return null;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
