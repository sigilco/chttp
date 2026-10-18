// CSRF + cookies: double-submit match/mismatch/null legs, cookie
// serialization fixtures (all attributes, expiry cookie), origin allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCsrfCookie,
  buildExpiredSessionCookie,
  buildSessionCookie,
  generateCsrfToken,
  readCookie,
  serializeCookie,
  verifyCsrfToken,
  verifyRequestOrigin,
} from "../dist/esm/index.js";

// ---------- CSRF

test("double-submit: matching tokens verify", () => {
  const tok = generateCsrfToken();
  assert.equal(verifyCsrfToken(tok, tok), true);
});

test("double-submit: mismatched and null legs fail", () => {
  const a = generateCsrfToken();
  const b = generateCsrfToken();
  assert.equal(verifyCsrfToken(a, b), false);
  assert.equal(verifyCsrfToken(null, b), false);
  assert.equal(verifyCsrfToken(a, null), false);
  assert.equal(verifyCsrfToken(null, null), false);
  assert.equal(verifyCsrfToken(a, a + "x"), false); // length pre-check
  assert.equal(verifyCsrfToken("", ""), true); // both empty: byte-equal
});

test("origin allowlist: exact match only", () => {
  const allowed = ["https://app.example", "https://admin.example"];
  assert.equal(verifyRequestOrigin("https://app.example", allowed), true);
  assert.equal(verifyRequestOrigin("https://evil.example", allowed), false);
  assert.equal(verifyRequestOrigin(null, allowed), false);
  assert.equal(verifyRequestOrigin("https://app.example.evil.com", allowed), false);
  assert.equal(verifyRequestOrigin("", allowed), false);
});

test("generateCsrfToken is 43-char base64url and unique", () => {
  const a = generateCsrfToken();
  const b = generateCsrfToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

// ---------- cookies

test("serializeCookie emits all attributes", () => {
  assert.equal(
    serializeCookie("sid", "abc", {
      maxAge: 3600,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    }),
    "sid=abc; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
  );
  assert.equal(serializeCookie("a", "b", { sameSite: "strict" }), "a=b; Path=/; SameSite=Strict");
  assert.equal(
    serializeCookie("a", "b", { sameSite: "none", secure: true }),
    "a=b; Path=/; Secure; SameSite=None",
  );
});

test("buildSessionCookie is HttpOnly/Lax/Secure/MaxAge-bound", () => {
  const c = buildSessionCookie("tok-1", { ttlSeconds: 120 });
  assert.equal(c, "session=tok-1; Path=/; Max-Age=120; HttpOnly; Secure; SameSite=Lax");
  const dev = buildSessionCookie("tok-1", { secure: false });
  assert.equal(dev.includes("Secure"), false);
  assert.equal(dev.includes("HttpOnly"), true);
});

test("buildExpiredSessionCookie zeroes Max-Age for logout", () => {
  const c = buildExpiredSessionCookie();
  assert.equal(c, "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
});

test("buildCsrfCookie is NOT HttpOnly (double-submit needs JS read)", () => {
  const c = buildCsrfCookie("csrf-1", { ttlSeconds: 60 });
  assert.equal(c, "csrf=csrf-1; Path=/; Max-Age=60; Secure; SameSite=Lax");
});

test("readCookie finds the named cookie, returns null otherwise", () => {
  assert.equal(readCookie("a=1; session=tok-9; b=2", "session"), "tok-9");
  assert.equal(readCookie("session=abc.def", "session"), "abc.def");
  assert.equal(readCookie("a=1", "session"), null);
  assert.equal(readCookie(null, "session"), null);
  assert.equal(readCookie("", "session"), null);
  assert.equal(readCookie("sessionx=1", "session"), null); // prefix-safe
  assert.equal(readCookie("session=a=b=c", "session"), "a=b=c"); // = in value
});
