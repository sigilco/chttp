// Set-Cookie serialization + minimal Cookie-header read. Three cookies are
// set (session, expired-session, csrf) and one is read (session) — 80 LoC
// beats a jar dependency.

export interface CookieAttrs {
  maxAge?: number; // seconds
  path?: string; // default "/"
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

export const SESSION_COOKIE_NAME = "session";
export const CSRF_COOKIE_NAME = "csrf";

function sameSiteAttr(v: string): string {
  if (v === "strict") {
    return "Strict";
  }
  if (v === "none") {
    return "None";
  }
  return "Lax";
}

// Full Set-Cookie header value.
export function serializeCookie(name: string, value: string, attrs: CookieAttrs): string {
  let out = name + "=" + value;
  const path = attrs.path === undefined ? "/" : attrs.path;
  out += "; Path=" + path;
  if (attrs.maxAge !== undefined) {
    out += "; Max-Age=" + Math.floor(attrs.maxAge);
  }
  if (attrs.httpOnly === true) {
    out += "; HttpOnly";
  }
  if (attrs.secure === true) {
    out += "; Secure";
  }
  if (attrs.sameSite !== undefined) {
    out += "; SameSite=" + sameSiteAttr(attrs.sameSite);
  }
  return out;
}

// Minimal read of the Cookie request header: returns the raw value for
// `name`, or null. First match wins; values are returned undecoded (the
// session/csrf tokens this package sets are base64url, which needs none).
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (cookieHeader === null) {
    return null;
  }
  const prefix = name + "=";
  const parts = cookieHeader.split(";");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.startsWith(prefix)) {
      return p.slice(prefix.length);
    }
  }
  return null;
}

export interface SessionCookieOpts {
  secure?: boolean; // default true; set false for http://localhost dev
  ttlSeconds?: number; // default: 30 days — bound to the session TTL
}

const DEFAULT_COOKIE_TTL = 30 * 24 * 60 * 60;

// Prebuilt session cookie: HttpOnly, SameSite=Lax, Path=/, Secure=true
// (override for localhost), Max-Age bound to the session TTL.
export function buildSessionCookie(token: string, opts?: SessionCookieOpts): string {
  const secure = opts === undefined || opts.secure === undefined ? true : opts.secure;
  const ttl =
    opts === undefined || opts.ttlSeconds === undefined ? DEFAULT_COOKIE_TTL : opts.ttlSeconds;
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: ttl,
    path: "/",
    secure: secure,
    httpOnly: true,
    sameSite: "lax",
  });
}

// Logout: same name, empty value, already expired.
export function buildExpiredSessionCookie(opts?: SessionCookieOpts): string {
  const secure = opts === undefined || opts.secure === undefined ? true : opts.secure;
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    secure: secure,
    httpOnly: true,
    sameSite: "lax",
  });
}

// CSRF double-submit cookie: deliberately NOT HttpOnly — the pattern needs
// JS (or the page itself) to read the token into a form field/header.
export function buildCsrfCookie(token: string, opts?: SessionCookieOpts): string {
  const secure = opts === undefined || opts.secure === undefined ? true : opts.secure;
  const ttl =
    opts === undefined || opts.ttlSeconds === undefined ? DEFAULT_COOKIE_TTL : opts.ttlSeconds;
  return serializeCookie(CSRF_COOKIE_NAME, token, {
    maxAge: ttl,
    path: "/",
    secure: secure,
    httpOnly: false,
    sameSite: "lax",
  });
}
