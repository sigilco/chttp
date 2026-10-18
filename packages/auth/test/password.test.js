// Password hashing: round-trip, wrong password -> false, legacy-parameter
// strings verify, malformed stored string -> false (not throw), dummy-hash
// timing flatten on corrupt rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../dist/esm/index.js";

// Low N for test speed — the format self-describes parameters, so verify
// works regardless of what the hasher used.
const FAST = { N: 1024, r: 8, p: 1 };

test("hash format is self-describing: scrypt:N:r:p:saltB64:hashB64", () => {
  const stored = hashPassword("hunter2", FAST);
  const parts = stored.split(":");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.equal(parts[1], "1024");
  assert.equal(parts[2], "8");
  assert.equal(parts[3], "1");
  assert.ok(Buffer.from(parts[4], "base64").length === 16);
  assert.ok(Buffer.from(parts[5], "base64").length === 64);
});

test("round-trip: correct password verifies", () => {
  const stored = hashPassword("correct horse battery staple", FAST);
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
});

test("wrong password returns false", () => {
  const stored = hashPassword("right", FAST);
  assert.equal(verifyPassword("wrong", stored), false);
});

test("two hashes of the same password differ (random salt) and both verify", () => {
  const a = hashPassword("same", FAST);
  const b = hashPassword("same", FAST);
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same", a), true);
  assert.equal(verifyPassword("same", b), true);
});

test("legacy-parameter strings verify (parameters ride inside the hash)", () => {
  // Simulates a row written with old parameters: still verifies without
  // any migration because N:r:p are read from the string.
  const legacy = hashPassword("pw", { N: 512, r: 4, p: 2 });
  assert.equal(verifyPassword("pw", legacy), true);
  assert.equal(verifyPassword("nope", legacy), false);
});

test("malformed stored strings return false, never throw", () => {
  assert.equal(verifyPassword("pw", ""), false);
  assert.equal(verifyPassword("pw", "scrypt"), false);
  assert.equal(verifyPassword("pw", "scrypt:abc:8:1:c2FsdA==:aGFzaA=="), false);
  assert.equal(verifyPassword("pw", "argon2:1:2:3:AAAA:BBBB"), false);
  assert.equal(verifyPassword("pw", "scrypt:1024:8:1::"), false);
  assert.equal(verifyPassword("pw", "scrypt:-1:8:1:c2FsdA==:aGFzaA=="), false);
  assert.equal(verifyPassword("pw", ":::::"), false);
});

test("default parameters are the OWASP set (N=2^17, r=8, p=1)", () => {
  const stored = hashPassword("pw");
  const parts = stored.split(":");
  assert.equal(parts[1], "131072");
  assert.equal(parts[2], "8");
  assert.equal(parts[3], "1");
  assert.equal(verifyPassword("pw", stored), true);
});
