// Session lifecycle: token round-trip, unknown/expired/malformed -> null,
// sliding extension fires only past the threshold, invalidate +
// invalidateAllForUser, MemorySessionStore TTL sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemorySessionStore,
  createSession,
  generateSessionToken,
  hashToken,
  invalidateAllUserSessions,
  invalidateSession,
  validateSessionToken,
} from "../dist/esm/index.js";

const NOW = 1_700_000_000_000;

function storeAt(t) {
  return new MemorySessionStore(() => t);
}

test("token format: base64url(id).base64url(secret), never stored whole", () => {
  const tok = generateSessionToken();
  const parts = tok.split(".");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^[A-Za-z0-9_-]{22}$/); // 16 bytes -> 22 chars
  assert.match(parts[1], /^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 chars
  // store key is the SHA-256 hex of the whole token, not the token itself
  assert.match(hashToken(tok), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(tok), tok);
});

test("create + validate round-trip through MemorySessionStore", async () => {
  const store = storeAt(NOW);
  const tok = generateSessionToken();
  const rec = await createSession(store, tok, "u-1", { role: "admin" }, { ttlSeconds: 60 });
  assert.equal(rec.userId, "u-1");
  assert.equal(rec.key, hashToken(tok));
  assert.deepEqual(rec.attributes, { role: "admin" });
  const got = await validateSessionToken(store, tok, { ttlSeconds: 60 });
  assert.equal(got.key, rec.key);
});

test("unknown, malformed, and wrong tokens all return null", async () => {
  const store = storeAt(NOW);
  await createSession(store, generateSessionToken(), "u-1", null, { ttlSeconds: 60 });
  assert.equal(await validateSessionToken(store, "garbage"), null);
  assert.equal(await validateSessionToken(store, "a.b.c"), null);
  assert.equal(await validateSessionToken(store, generateSessionToken()), null);
  assert.equal(await validateSessionToken(store, ""), null);
});

test("expired session is deleted and returns null", async () => {
  let t = NOW;
  const store = new MemorySessionStore(() => t);
  const tok = generateSessionToken();
  await createSession(store, tok, "u-1", null, { ttlSeconds: 60, nowMs: NOW });
  t = NOW + 61_000; // past expiry
  assert.equal(await validateSessionToken(store, tok, { ttlSeconds: 60, nowMs: t }), null);
  assert.equal(store.size, 0); // swept on read
});

test("sliding expiry: extends only past the extension threshold", async () => {
  let t = NOW;
  const store = new MemorySessionStore(() => t);
  const tok = generateSessionToken();
  const rec = await createSession(store, tok, "u-1", null, { ttlSeconds: 60, nowMs: NOW });

  // 10s elapsed — inside the threshold (30s default: ttl/2), no write-back
  t = NOW + 10_000;
  const v1 = await validateSessionToken(store, tok, { ttlSeconds: 60, nowMs: t });
  assert.equal(v1.expiresAt, rec.expiresAt);

  // 40s elapsed — 20s remain, past the 30s threshold -> bumped
  t = NOW + 40_000;
  const v2 = await validateSessionToken(store, tok, { ttlSeconds: 60, nowMs: t });
  assert.equal(v2.expiresAt, t + 60_000);
  // written back to the store
  assert.equal(store.get(hashToken(tok)).expiresAt, t + 60_000);
});

test("custom extensionThresholdSeconds is honored", async () => {
  let t = NOW;
  const store = new MemorySessionStore(() => t);
  const tok = generateSessionToken();
  const rec = await createSession(store, tok, "u-1", null, { ttlSeconds: 60, nowMs: NOW });
  t = NOW + 10_000; // 50s remain; threshold 55s -> extend
  const v = await validateSessionToken(store, tok, {
    ttlSeconds: 60,
    extensionThresholdSeconds: 55,
    nowMs: t,
  });
  assert.equal(v.expiresAt, t + 60_000);
  // the record is extended in place — rec sees the bump too
  assert.equal(rec.expiresAt, t + 60_000);
});

test("invalidateSession removes exactly that session", async () => {
  const store = storeAt(NOW);
  const tok1 = generateSessionToken();
  const tok2 = generateSessionToken();
  await createSession(store, tok1, "u-1", null, { ttlSeconds: 60 });
  await createSession(store, tok2, "u-2", null, { ttlSeconds: 60 });
  await invalidateSession(store, tok1);
  assert.equal(await validateSessionToken(store, tok1, { ttlSeconds: 60 }), null);
  assert.notEqual(await validateSessionToken(store, tok2, { ttlSeconds: 60 }), null);
});

test("invalidateAllUserSessions removes all sessions for the user", async () => {
  const store = storeAt(NOW);
  const a = generateSessionToken();
  const b = generateSessionToken();
  const other = generateSessionToken();
  await createSession(store, a, "u-1", null, { ttlSeconds: 60 });
  await createSession(store, b, "u-1", null, { ttlSeconds: 60 });
  await createSession(store, other, "u-2", null, { ttlSeconds: 60 });
  await invalidateAllUserSessions(store, "u-1");
  assert.equal(await validateSessionToken(store, a, { ttlSeconds: 60 }), null);
  assert.equal(await validateSessionToken(store, b, { ttlSeconds: 60 }), null);
  assert.notEqual(await validateSessionToken(store, other, { ttlSeconds: 60 }), null);
});

test("a promise-returning store works unchanged (await-everything seam)", async () => {
  const mem = new MemorySessionStore(() => NOW);
  const asyncStore = {
    get: async (k) => mem.get(k),
    set: async (r) => mem.set(r),
    updateExpiry: async (k, e) => mem.updateExpiry(k, e),
    delete: async (k) => mem.delete(k),
    deleteAllForUser: async (u) => mem.deleteAllForUser(u),
  };
  const tok = generateSessionToken();
  await createSession(asyncStore, tok, "u-9", null, { ttlSeconds: 60 });
  const rec = await validateSessionToken(asyncStore, tok, { ttlSeconds: 60 });
  assert.equal(rec.userId, "u-9");
});

test("non-positive ttlSeconds throws E_BAD_PARAMS (config bug, not traffic)", async () => {
  const store = storeAt(NOW);
  await assert.rejects(createSession(store, "t", "u", null, { ttlSeconds: 0 }), /E_BAD_PARAMS/);
});
