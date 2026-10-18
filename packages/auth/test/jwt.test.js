// JWT edge cases: round-trip, expired (±clockTolerance), wrong alg, "none"
// rejected, issuer/audience mismatch, tampered payload, jose cross-check,
// verifyJwtWith through BOTH @chttp/val and valibot (the Standard-Schema
// seam). ES256 is deferred (no asymmetric crypto in scriptc 0.3.3) — the
// DER/P1363 negative test lands with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import * as v from "@chttp/val";
import * as valibot from "valibot";
import { signJwt, verifyJwt, verifyJwtWith } from "../dist/esm/index.js";

const SECRET = "test-secret-do-not-ship";

test("HS256 round-trip: sign -> verify returns claims with iat", () => {
  const tok = signJwt({ sub: "u-1", role: "admin" }, SECRET);
  const claims = verifyJwt(tok, SECRET);
  assert.equal(claims.sub, "u-1");
  assert.equal(claims.role, "admin");
  assert.equal(typeof claims.iat, "number");
});

test("exp is written as a numeric date and enforced", () => {
  const tok = signJwt({ sub: "u" }, SECRET, { expiresInSeconds: -10 });
  assert.equal(verifyJwt(tok, SECRET), null); // expired
  // clockTolerance rescues a just-expired token
  const claims = verifyJwt(tok, SECRET, { clockToleranceSeconds: 60 });
  assert.equal(claims.sub, "u");
});

test("issuer and audience are asserted when opts demand them", () => {
  const tok = signJwt({ sub: "u" }, SECRET, {
    issuer: "https://idp.example",
    audience: "my-app",
    expiresInSeconds: 300,
  });
  assert.notEqual(
    verifyJwt(tok, SECRET, { issuer: "https://idp.example", audience: "my-app" }),
    null,
  );
  assert.equal(verifyJwt(tok, SECRET, { issuer: "https://evil.example" }), null);
  assert.equal(verifyJwt(tok, SECRET, { audience: "other-app" }), null);
});

test("audience claim as an array matches a single allowed value", () => {
  const payload = { sub: "u", aud: ["a", "my-app", "c"] };
  const tok = signJwt(payload, SECRET);
  assert.notEqual(verifyJwt(tok, SECRET, { audience: "my-app" }), null);
  assert.equal(verifyJwt(tok, SECRET, { audience: "missing" }), null);
});

test("alg confusion and 'none' are hard-rejected", () => {
  const hs = signJwt({ sub: "u" }, SECRET);
  assert.equal(verifyJwt(hs, SECRET, { alg: "ES256" }), null);
  assert.equal(verifyJwt(hs, SECRET, { alg: "HS256" }) === null, false);
  // hand-rolled alg:none token
  const none =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
    "." +
    Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url") +
    ".";
  assert.equal(verifyJwt(none, SECRET), null);
  assert.equal(verifyJwt(none, SECRET, { alg: "none" }), null);
});

test("malformed tokens return null, never throw", () => {
  assert.equal(verifyJwt("", SECRET), null);
  assert.equal(verifyJwt("a.b", SECRET), null);
  assert.equal(verifyJwt("a.b.c.d", SECRET), null);
  assert.equal(verifyJwt("!!!.@@@.###", SECRET), null);
  const tok = signJwt({ sub: "u" }, SECRET);
  // tampered payload (valid b64, invalid signature)
  const parts = tok.split(".");
  const evil =
    parts[0] +
    "." +
    Buffer.from(JSON.stringify({ sub: "u", admin: true })).toString("base64url") +
    "." +
    parts[2];
  assert.equal(verifyJwt(evil, SECRET), null);
  // tampered signature, same length
  assert.equal(
    verifyJwt(parts[0] + "." + parts[1] + "." + "A".repeat(parts[2].length), SECRET),
    null,
  );
  // claims that aren't an object
  const scalar =
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url") +
    "." +
    Buffer.from("42").toString("base64url") +
    ".x";
  assert.equal(verifyJwt(scalar, SECRET), null);
});

test("wrong secret returns null (signature mismatch, not a throw)", () => {
  const tok = signJwt({ sub: "u" }, SECRET);
  assert.equal(verifyJwt(tok, "other-secret"), null);
});

test("jose cross-check: jose verifies our token, we verify jose's", async () => {
  const key = new TextEncoder().encode(SECRET);
  const theirs = await new jose.SignJWT({ sub: "u-jose" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("jose-iss")
    .setExpirationTime("5m")
    .sign(key);
  const claims = verifyJwt(theirs, SECRET, { issuer: "jose-iss" });
  assert.equal(claims.sub, "u-jose");

  const ours = signJwt({ sub: "u-ours" }, SECRET, {
    expiresInSeconds: 300,
    issuer: "ours-iss",
  });
  const { payload } = await jose.jwtVerify(ours, key, { issuer: "ours-iss" });
  assert.equal(payload.sub, "u-ours");
});

test("verifyJwtWith parses claims through @chttp/val", async () => {
  const schema = v.object({ sub: v.string() });
  const tok = signJwt({ sub: "u-val", extra: 1 }, SECRET);
  const claims = await verifyJwtWith(tok, SECRET, schema);
  assert.equal(claims.sub, "u-val");
});

test("verifyJwtWith parses claims through valibot (the same seam)", async () => {
  const schema = valibot.object({ sub: valibot.string() });
  const tok = signJwt({ sub: "u-valibot", extra: 1 }, SECRET);
  const claims = await verifyJwtWith(tok, SECRET, schema);
  assert.equal(claims.sub, "u-valibot");
});

test("verifyJwtWith returns null on schema failure and on bad tokens", async () => {
  const schema = valibot.object({ sub: valibot.literal("expected") });
  const tok = signJwt({ sub: "other" }, SECRET);
  assert.equal(await verifyJwtWith(tok, SECRET, schema), null);
  assert.equal(await verifyJwtWith("garbage", SECRET, schema), null);
});

test("nbf in the future is rejected, within tolerance accepted", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const tok = signJwt({ sub: "u", nbf: future }, SECRET);
  assert.equal(verifyJwt(tok, SECRET), null);
  assert.notEqual(verifyJwt(tok, SECRET, { clockToleranceSeconds: 3601 }), null);
});

test("signJwt throws on caller bugs (wrong key type, bad alg)", () => {
  // non-string key infers ES256 -> unlowerable -> E_BAD_ALG
  assert.throws(() => signJwt({ a: 1 }, 123, {}), /E_BAD_ALG/);
  assert.throws(() => signJwt({ a: 1 }, "k", { alg: "RS256" }), /E_BAD_ALG/);
  assert.throws(() => signJwt({ a: 1 }, "k", { alg: "none" }), /E_BAD_ALG/);
});
