// OAuth2: authorization URL construction (exact string fixtures per
// provider), token exchange against a stubbed fetch (JSON + urlencoded
// response shapes, non-2xx -> null), userinfo with-schema parse + reject
// through BOTH @chttp/val and valibot.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as v from "@chttp/val";
import * as valibot from "valibot";
import {
  createAuthorizationURL,
  discordProvider,
  exchangeCodeForTokens,
  fetchUserInfo,
  fetchUserInfoWith,
  generateCodeVerifier,
  generateState,
  githubProvider,
  googleProvider,
} from "../dist/esm/index.js";

// ---------- fetch stubbing (tests run under Node; the package calls the
// global fetch, confirmed static under scriptc 0.3.3)

const realFetch = globalThis.fetch;
let calls = [];

function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function formResponse(status, body) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => stubFetch(() => jsonResponse(200, {})));
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------- PKCE / state primitives

test("generateState/generateCodeVerifier are 43-char base64url", () => {
  assert.match(generateState(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(generateCodeVerifier(), /^[A-Za-z0-9_-]{43}$/);
});

// ---------- authorization URL fixtures (exact strings)

test("Google authorization URL — exact fixture", () => {
  const url = createAuthorizationURL(googleProvider, "client-1", "https://app/cb", {
    state: "st-1",
    codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "client-1");
  assert.equal(u.searchParams.get("redirect_uri"), "https://app/cb");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.equal(u.searchParams.get("state"), "st-1");
  assert.equal(u.searchParams.get("code_challenge"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
});

test("GitHub authorization URL — exact fixture", () => {
  const url = createAuthorizationURL(githubProvider, "gh-client", "https://app/gh", {
    state: "xyz",
    codeVerifier: null,
    extraQuery: { allow_signup: "false" },
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), "read:user user:email");
  assert.equal(u.searchParams.get("allow_signup"), "false");
  assert.equal(u.searchParams.get("code_challenge"), null);
});

test("non-PKCE provider skips challenge params even when a verifier is given", () => {
  const custom = {
    authorizationEndpoint: "https://idp.example/auth",
    tokenEndpoint: "https://idp.example/token",
    userInfoEndpoint: null,
    scope: ["openid"],
    usePkce: false,
  };
  const url = createAuthorizationURL(custom, "c", "https://app/cb", {
    state: "s",
    codeVerifier: "verifier",
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get("code_challenge"), null);
  assert.equal(u.searchParams.get("code_challenge_method"), null);
});

test("discord preset exists as a plain record", () => {
  assert.equal(discordProvider.tokenEndpoint, "https://discord.com/api/oauth2/token");
  assert.equal(discordProvider.userInfoEndpoint, "https://discord.com/api/users/@me");
});

// ---------- token exchange

const EXCHANGE_PARAMS = {
  code: "code-1",
  clientId: "cid",
  clientSecret: "secret",
  redirectURI: "https://app/cb",
  codeVerifier: "ver-1",
};

test("exchange posts form-urlencoded with basic auth and parses JSON", async () => {
  stubFetch(() =>
    jsonResponse(200, {
      access_token: "at-1",
      token_type: "Bearer",
      refresh_token: "rt-1",
      expires_in: 3600,
      scope: "openid email",
      id_token: "id-1",
      extra_field: "kept-in-raw",
    }),
  );
  const tokens = await exchangeCodeForTokens(googleProvider, EXCHANGE_PARAMS);
  assert.equal(tokens.access_token, "at-1");
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.refresh_token, "rt-1");
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.id_token, "id-1");
  assert.equal(tokens.raw.extra_field, "kept-in-raw");

  const call = calls[0];
  assert.equal(call.url, "https://oauth2.googleapis.com/token");
  assert.equal(call.init.method, "POST");
  assert.equal(
    call.init.headers.authorization,
    "Basic " + Buffer.from("cid:secret").toString("base64"),
  );
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "code-1");
  assert.equal(body.get("code_verifier"), "ver-1");
  assert.equal(body.get("redirect_uri"), "https://app/cb");
});

test("exchange parses form-urlencoded responses too (RFC 6749)", async () => {
  stubFetch(() => formResponse(200, "access_token=gh-at&token_type=bearer&scope=read%3Auser"));
  const tokens = await exchangeCodeForTokens(githubProvider, {
    code: "c",
    clientId: "cid",
    clientSecret: "sec",
    redirectURI: "https://app/cb",
    codeVerifier: null,
  });
  assert.equal(tokens.access_token, "gh-at");
  assert.equal(tokens.token_type, "bearer");
  assert.equal(tokens.scope, "read:user");
  assert.equal(tokens.refresh_token, null);
});

test("exchange returns null on non-2xx and on missing access_token", async () => {
  stubFetch(() => jsonResponse(400, { error: "invalid_grant" }));
  assert.equal(await exchangeCodeForTokens(googleProvider, EXCHANGE_PARAMS), null);

  stubFetch(() => jsonResponse(200, { token_type: "Bearer" }));
  assert.equal(await exchangeCodeForTokens(googleProvider, EXCHANGE_PARAMS), null);

  stubFetch(() => {
    throw new Error("network down");
  });
  assert.equal(await exchangeCodeForTokens(googleProvider, EXCHANGE_PARAMS), null);
});

// ---------- userinfo + schema seam

test("fetchUserInfo returns parsed JSON, null without an endpoint", async () => {
  stubFetch(() => jsonResponse(200, { sub: "u-1", email: "a@b.c" }));
  const info = await fetchUserInfo(googleProvider, "at-1");
  assert.equal(info.sub, "u-1");
  assert.equal(calls[0].init.headers.authorization, "Bearer at-1");

  const noEndpoint = {
    authorizationEndpoint: "x",
    tokenEndpoint: "x",
    userInfoEndpoint: null,
    scope: [],
    usePkce: false,
  };
  assert.equal(await fetchUserInfo(noEndpoint, "at"), null);

  stubFetch(() => jsonResponse(401, { error: "bad_token" }));
  assert.equal(await fetchUserInfo(googleProvider, "bad"), null);
});

test("fetchUserInfoWith parses through @chttp/val", async () => {
  stubFetch(() => jsonResponse(200, { sub: "u-1", email: "a@b.c", extra: 9 }));
  const schema = v.object({ sub: v.string(), email: v.string() });
  const info = await fetchUserInfoWith(googleProvider, "at", schema);
  assert.equal(info.sub, "u-1");
  assert.equal(info.email, "a@b.c");
});

test("fetchUserInfoWith parses through valibot and rejects schema misses", async () => {
  stubFetch(() => jsonResponse(200, { sub: "u-1" }));
  const ok = valibot.object({ sub: valibot.string() });
  assert.equal((await fetchUserInfoWith(googleProvider, "at", ok)).sub, "u-1");
  const strict = valibot.object({ sub: valibot.literal("nope") });
  assert.equal(await fetchUserInfoWith(googleProvider, "at", strict), null);
});
