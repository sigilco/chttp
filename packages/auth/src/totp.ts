// TOTP (RFC 6238) over HMAC-SHA1 HOTP (RFC 4226), base32 secrets (RFC 4648).
// Defaults: 6 digits, 30 s step, ±1 window. Code compares are constant-time
// (length pre-check + timingSafeEqual over the digit strings).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { base32Decode, base32Encode } from "./encoding.ts";

const DEFAULT_DIGITS = 6;
const DEFAULT_STEP = 30;
const DEFAULT_WINDOW = 1;
const SECRET_BYTES = 20;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export interface TotpUriOpts {
  digits?: number; // default 6
  stepSeconds?: number; // default 30
}

// otpauth:// URI for authenticator enrollment (Google Authenticator shape).
export function totpAuthUri(
  secret: string,
  accountName: string,
  issuer: string,
  opts?: TotpUriOpts,
): string {
  let digits = DEFAULT_DIGITS;
  let step = DEFAULT_STEP;
  if (opts !== undefined && opts !== null) {
    if (opts.digits !== undefined) {
      digits = opts.digits;
    }
    if (opts.stepSeconds !== undefined) {
      step = opts.stepSeconds;
    }
  }
  const label = encodeURIComponent(issuer + ":" + accountName);
  return (
    "otpauth://totp/" +
    label +
    "?secret=" +
    secret +
    "&issuer=" +
    encodeURIComponent(issuer) +
    "&digits=" +
    digits +
    "&period=" +
    step
  );
}

// RFC 4226 dynamic truncation: 8-byte big-endian counter -> HMAC-SHA1 ->
// 4-byte window -> digits.
function hotpCode(key: Uint8Array, counter: number, digits: number): string {
  const msg = new Uint8Array(8);
  let hi = Math.floor(counter / 4294967296);
  let lo = counter % 4294967296;
  msg[0] = (hi >>> 24) & 255;
  msg[1] = (hi >>> 16) & 255;
  msg[2] = (hi >>> 8) & 255;
  msg[3] = hi & 255;
  msg[4] = (lo >>> 24) & 255;
  msg[5] = (lo >>> 16) & 255;
  msg[6] = (lo >>> 8) & 255;
  msg[7] = lo & 255;
  const mac = createHmac("sha1", key).update(msg).digest();
  const off = mac[19] & 15;
  const bin =
    ((mac[off] & 127) << 24) |
    ((mac[off + 1] & 255) << 16) |
    ((mac[off + 2] & 255) << 8) |
    (mac[off + 3] & 255);
  const mod = Math.pow(10, digits);
  let s = "" + (bin % mod);
  while (s.length < digits) {
    s = "0" + s;
  }
  return s;
}

export interface VerifyTotpOpts {
  window?: number; // default ±1 step
  stepSeconds?: number; // default 30
  digits?: number; // default 6
  nowMs?: number; // deterministic clock seam for tests/ELF (default Date.now())
}

export function verifyTotp(code: string, secret: string, opts?: VerifyTotpOpts): boolean {
  const key = base32Decode(secret);
  if (key === null) {
    return false;
  }
  let digits = DEFAULT_DIGITS;
  let step = DEFAULT_STEP;
  let win = DEFAULT_WINDOW;
  let nowMs = Date.now();
  if (opts !== undefined && opts !== null) {
    if (opts.digits !== undefined) {
      digits = opts.digits;
    }
    if (opts.stepSeconds !== undefined) {
      step = opts.stepSeconds;
    }
    if (opts.window !== undefined) {
      win = opts.window;
    }
    if (opts.nowMs !== undefined) {
      nowMs = opts.nowMs;
    }
  }
  if (code.length !== digits) {
    return false;
  }
  const counter = Math.floor(nowMs / 1000 / step);
  let match = false;
  // Check the whole window without early exit — timing stays flat.
  for (let w = -win; w <= win; w++) {
    const c = counter + w;
    if (c < 0) {
      continue;
    }
    const expected = hotpCode(key, c, digits);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(code, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      match = true;
    }
  }
  return match;
}
