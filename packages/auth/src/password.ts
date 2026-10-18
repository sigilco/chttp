// scrypt password hashing, self-describing format:
//   "scrypt:N:r:p:saltB64:hashB64"
// verifyPassword reads the parameters from the string, so parameter upgrades
// don't invalidate old hashes; hashPassword writes today's OWASP defaults
// (N=2^17, r=8, p=1, 64-byte key, 16-byte salt). The format prefix leaves
// room for a future memory-hard successor (e.g. argon2) to slot in.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_N = 131072; // 2^17 — OWASP Password Storage Cheat Sheet
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt memory is ~128*N*r bytes: 2^17*8*128 = 128 MiB, past Node's 32 MiB
// default maxmem — raised explicitly.
const MAXMEM = 256 * 1024 * 1024;

export interface PasswordOpts {
  N?: number;
  r?: number;
  p?: number;
}

export function hashPassword(password: string, opts?: PasswordOpts): string {
  let N = DEFAULT_N;
  let r = DEFAULT_R;
  let p = DEFAULT_P;
  if (opts !== undefined && opts !== null) {
    if (opts.N !== undefined) {
      N = opts.N;
    }
    if (opts.r !== undefined) {
      r = opts.r;
    }
    if (opts.p !== undefined) {
      p = opts.p;
    }
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEYLEN, {
    N: N,
    r: r,
    p: p,
    maxmem: MAXMEM,
  });
  return (
    "scrypt:" +
    N +
    ":" +
    r +
    ":" +
    p +
    ":" +
    salt.toString("base64") +
    ":" +
    hash.toString("base64")
  );
}

// Burns one scrypt at default parameters so malformed/corrupt stored rows
// cost the same as a real verify — flattens the oracle between "row doesn't
// parse" and "password wrong".
function dummyHash(password: string): void {
  scryptSync(password, Buffer.from("cutils-auth-dummy-salt", "utf8"), KEYLEN, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    maxmem: MAXMEM,
  });
}

function parseParam(s: string): number {
  if (!/^[0-9]+$/.test(s)) {
    return -1;
  }
  return Number(s);
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    dummyHash(password);
    return false;
  }
  const N = parseParam(parts[1]);
  const r = parseParam(parts[2]);
  const p = parseParam(parts[3]);
  if (N <= 0 || r <= 0 || p <= 0) {
    dummyHash(password);
    return false;
  }
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || expected.length === 0) {
    dummyHash(password);
    return false;
  }
  let hash: Buffer;
  try {
    hash = scryptSync(password, salt, expected.length, {
      N: N,
      r: r,
      p: p,
      maxmem: MAXMEM,
    });
  } catch {
    dummyHash(password);
    return false;
  }
  // timingSafeEqual throws on length mismatch — length pre-check.
  if (hash.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(hash, expected);
}
