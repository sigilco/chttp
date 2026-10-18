// Sessions, after the Lucia pattern: a random bearer token, a SHA-256 store
// key (the only thing persisted), sliding expiry. ~150 LoC because the
// package refuses to own state — the caller's store holds everything.
//
// Token layout: base64url(16-byte id) + "." + base64url(32-byte secret) —
// 384 bits of entropy, never stored whole. hashToken() produces the lookup
// key; a leaked store yields nothing replayable.
//
// Store contract is sync-or-async: stores may return values or Promises and
// the lifecycle functions `await` unconditionally (one microtask on sync
// stores — documented in the README; the SHA-256 dominates). We never sniff
// `.then` (SC2009). Interface members return `unknown` for that reason —
// a `T | Promise<T>` union arm is SC2009.
//
// `SessionStore<A>` / `SessionRecord<A>` are phantom-generic aliases: the
// generic parameter documents intended attribute type, but no method
// signature references it (a member that mentions the type param refuses
// to lower at the call site — SC1090, same finding as @chttp/cache).

import { createHash, randomBytes } from "node:crypto";
import { authError } from "./errors.ts";
import { b64urlEncode, toHex } from "./encoding.ts";

export interface SessionRecordData {
  key: string; // hashToken(token) — the store key
  userId: string;
  expiresAt: number; // epoch ms
  attributes: unknown; // app data (role, display name, ...)
}

// Generic-typed surface: `SessionRecord<A>` is SessionRecordData with the
// attributes member re-typed. No functions hold records of this shape by
// generic signature — see the phantom-alias note above.
export interface SessionRecord<A> extends SessionRecordData {
  attributes: A | null;
}

export interface SessionStoreCore {
  // Each member may return the value OR a Promise of it; `unknown` keeps the
  // union SC2009-free. Implementations return the concrete shapes below.
  get(key: string): unknown; // SessionRecordData | null | Promise<...>
  set(record: SessionRecordData): unknown; // void | Promise<void>
  updateExpiry(key: string, expiresAt: number): unknown; // void | Promise<void>
  delete(key: string): unknown; // void | Promise<void>
  deleteAllForUser(userId: string): unknown; // void | Promise<void>
}

// Phantom generic: `SessionStore<A>` types the intended attribute record
// while every method lowers identically to SessionStoreCore.
export interface SessionStore<_A> extends SessionStoreCore {}

export interface SessionOpts {
  ttlSeconds?: number; // default: 30 days
  // extend when less than this remains; default: half the TTL
  extensionThresholdSeconds?: number;
  // deterministic clock seam for tests/ELF (default Date.now())
  nowMs?: number;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function generateSessionToken(): string {
  return b64urlEncode(randomBytes(16)) + "." + b64urlEncode(randomBytes(32));
}

// SHA-256 hex of the full token. This is the store key and the only thing
// persisted; exported so store adapters key consistently.
export function hashToken(token: string): string {
  return toHex(createHash("sha256").update(token).digest());
}

function optsOr(opts: SessionOpts | undefined): SessionOpts {
  if (opts === undefined || opts === null) {
    return {};
  }
  return opts;
}

function ttlOf(opts: SessionOpts): number {
  if (opts.ttlSeconds === undefined) {
    return DEFAULT_TTL_SECONDS;
  }
  return opts.ttlSeconds;
}

function nowOf(opts: SessionOpts): number {
  if (opts.nowMs === undefined) {
    return Date.now();
  }
  return opts.nowMs;
}

export async function createSession(
  store: SessionStoreCore,
  token: string,
  userId: string,
  attributes: unknown,
  opts?: SessionOpts,
): Promise<SessionRecordData> {
  const o = optsOr(opts);
  const ttl = ttlOf(o);
  if (!(ttl > 0)) {
    throw authError("E_BAD_PARAMS", "ttlSeconds must be positive");
  }
  const rec: SessionRecordData = {
    key: hashToken(token),
    userId: userId,
    expiresAt: nowOf(o) + ttl * 1000,
    attributes: attributes,
  };
  await store.set(rec);
  return rec;
}

// Sliding expiry: a valid session past the extension threshold gets
// expiresAt bumped and written back. Returns null for unknown, expired, or
// malformed tokens. Never throws.
export async function validateSessionToken(
  store: SessionStoreCore,
  token: string,
  opts?: SessionOpts,
): Promise<SessionRecordData | null> {
  const o = optsOr(opts);
  const ttl = ttlOf(o);
  let threshold = Math.floor(ttl / 2);
  if (o.extensionThresholdSeconds !== undefined) {
    threshold = o.extensionThresholdSeconds;
  }
  const now = nowOf(o);
  const rec = (await store.get(hashToken(token))) as SessionRecordData | null;
  if (rec === null || rec === undefined) {
    return null;
  }
  if (now >= rec.expiresAt) {
    await store.delete(rec.key);
    return null;
  }
  if (rec.expiresAt - now < threshold * 1000) {
    rec.expiresAt = now + ttl * 1000;
    await store.updateExpiry(rec.key, rec.expiresAt);
  }
  return rec;
}

export async function invalidateSession(store: SessionStoreCore, token: string): Promise<void> {
  await store.delete(hashToken(token));
}

export async function invalidateAllUserSessions(
  store: SessionStoreCore,
  userId: string,
): Promise<void> {
  await store.deleteAllForUser(userId);
}
