// MemorySessionStore — dev/test SessionStore over a Map (the 0.3.3 probe
// lifted the Map/Set ban; same exception @chttp/cache uses).
//
// NOT for production. Process memory loses sessions on restart and does not
// share them across replicas — ship a real adapter (the @cutils/sqlite
// `key TEXT PRIMARY KEY` shape) instead. Dev only.

import type { SessionRecordData } from "./session.ts";

export class MemorySessionStoreCore {
  _records: Map<string, SessionRecordData>;
  _now: () => number;

  // `now` is a constructor-only test seam (fake clock), deliberately NOT an
  // options-record member — function values inside records degrade
  // instantiation under scriptc.
  constructor(now?: () => number) {
    this._records = new Map<string, SessionRecordData>();
    this._now = now === undefined ? Date.now : now;
  }

  _sweep(key: string, record: SessionRecordData): SessionRecordData | null {
    if (this._now() >= record.expiresAt) {
      this._records.delete(key);
      return null;
    }
    return record;
  }

  get(key: string): SessionRecordData | null {
    const r = this._records.get(key);
    if (r === undefined) {
      return null;
    }
    return this._sweep(key, r);
  }

  set(record: SessionRecordData): void {
    this._records.set(record.key, record);
  }

  updateExpiry(key: string, expiresAt: number): void {
    const r = this._records.get(key);
    if (r === undefined) {
      return;
    }
    r.expiresAt = expiresAt;
  }

  delete(key: string): void {
    this._records.delete(key);
  }

  deleteAllForUser(userId: string): void {
    const doomed: string[] = [];
    for (const e of this._records.entries()) {
      if (e[1].userId === userId) {
        doomed.push(e[0]);
      }
    }
    for (let i = 0; i < doomed.length; i++) {
      this._records.delete(doomed[i]);
    }
  }

  get size(): number {
    return this._records.size;
  }
}

// Phantom-generic alias over the non-generic core class — generic class
// parameters degrade instances to methodless shells under scriptc 0.3.x
// (the `Cache<V>`/`CacheCore` pattern).
export interface MemorySessionStore<_A> extends MemorySessionStoreCore {}
export const MemorySessionStore = MemorySessionStoreCore;
