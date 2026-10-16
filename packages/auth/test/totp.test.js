// TOTP: RFC 6238 test table (SHA-1, 8 digits) + RFC 4226 Appendix D HOTP
// values (SHA-1, 6 digits), otpauth URI shape, constant-time verify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "../dist/esm/index.js";

// RFC 6238 uses the ASCII secret "12345678901234567890" (20 bytes) —
// base32 of that is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

// RFC 6238 test table, SHA-1, 8 digits.
const RFC6238 = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("TOTP matches the RFC 6238 SHA-1 8-digit table", () => {
  for (const [timeS, expected] of RFC6238) {
    assert.equal(
      verifyTotp(expected, SECRET, {
        digits: 8,
        stepSeconds: 30,
        window: 0,
        nowMs: timeS * 1000,
      }),
      true,
      `T=${timeS} expected ${expected}`,
    );
  }
});

// RFC 4226 Appendix D: same secret, counters 0..9, 6 digits.
const RFC4226 = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

test("HOTP counters 0..9 match RFC 4226 Appendix D via TOTP time mapping", () => {
  for (let i = 0; i < RFC4226.length; i++) {
    assert.equal(
      verifyTotp(RFC4226[i], SECRET, {
        digits: 6,
        stepSeconds: 30,
        window: 0,
        nowMs: i * 30 * 1000,
      }),
      true,
      `counter ${i} expected ${RFC4226[i]}`,
    );
  }
});

test("default window accepts the adjacent step on either side", () => {
  const at1 = "94287082"; // T=1 (8-digit)
  // window=1, T=0 -> accepts counter 1
  assert.equal(verifyTotp(at1, SECRET, { digits: 8, window: 1, nowMs: 0 }), true);
  // window=0, T=0 -> rejects counter 1
  assert.equal(verifyTotp(at1, SECRET, { digits: 8, window: 0, nowMs: 0 }), false);
});

test("wrong code, wrong length, and bad secret all return false", () => {
  assert.equal(verifyTotp("000000", SECRET, { digits: 8, window: 0, nowMs: 59000 }), false);
  assert.equal(verifyTotp("12345", SECRET, { digits: 8, window: 0, nowMs: 59000 }), false);
  assert.equal(
    verifyTotp("94287082", "!!!bad-secret", { digits: 8, window: 0, nowMs: 59000 }),
    false,
  );
});

test("generateTotpSecret is base32 of 20 bytes", () => {
  const s = generateTotpSecret();
  assert.match(s, /^[A-Z2-7]{32}$/); // 160 bits -> 32 base32 chars
  assert.notEqual(s, generateTotpSecret());
});

test("totpAuthUri emits the otpauth:// shape with encoded label", () => {
  const uri = totpAuthUri(SECRET, "acct@example.com", "My App", {
    digits: 8,
    stepSeconds: 60,
  });
  assert.equal(
    uri,
    "otpauth://totp/My%20App%3Aacct%40example.com?secret=" +
      SECRET +
      "&issuer=My%20App&digits=8&period=60",
  );
  const def = totpAuthUri(SECRET, "a", "b");
  assert.equal(def.includes("digits=6"), true);
  assert.equal(def.includes("period=30"), true);
});
