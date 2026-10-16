// OAuth2 authorization-code + PKCE (RFC 6749 + RFC 7636). Providers are
// plain records — no registry, no plugin bus; adding one is a 15-LoC record
// in user code. The token exchange is a POST x-www-form-urlencoded with
// HTTP-basic client auth; responses parse as JSON OR form-urlencoded (RFC
// 6749 permits both). Exchange/userinfo return null on non-2xx or missing
// fields — never throw, never surface provider error bodies as exceptions.

import { createHash, randomBytes } from "node:crypto";
import { b64urlEncode } from "./encoding.ts";
import { runSchema } from "./types.ts";
import type { StandardSchemaV1 } from "./types.ts";

export interface OAuthProvider {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string | null; // GitHub: non-OIDC /user works
  scope: string[]; // joined with spaces
  usePkce: boolean;
}

export function generateState(): string {
  return b64urlEncode(randomBytes(32));
}

// RFC 7636: verifier is 43-128 chars of unreserved; base64url(32 bytes)
// yields exactly 43.
export function generateCodeVerifier(): string {
  return b64urlEncode(randomBytes(32));
}

// S256: base64url(sha256(verifier)), no padding (Node's base64url is
// already unpadded).
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest().toString("base64url");
}

export interface AuthorizeParams {
  state: string;
  codeVerifier: string | null; // ignored when provider.usePkce is false
  extraQuery?: { [k: string]: string }; // e.g. { prompt: "consent" }
}

export function createAuthorizationURL(
  provider: OAuthProvider,
  clientId: string,
  redirectURI: string,
  params: AuthorizeParams,
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectURI);
  url.searchParams.set("scope", provider.scope.join(" "));
  url.searchParams.set("state", params.state);
  if (provider.usePkce && params.codeVerifier !== null) {
    url.searchParams.set("code_challenge", codeChallenge(params.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (params.extraQuery !== undefined && params.extraQuery !== null) {
    const keys = Object.keys(params.extraQuery);
    for (let i = 0; i < keys.length; i++) {
      url.searchParams.set(keys[i], params.extraQuery[keys[i]]);
    }
  }
  return url.toString();
}

export interface TokenSet {
  access_token: string;
  token_type: string;
  refresh_token: string | null;
  expires_in: number | null;
  scope: string | null;
  id_token: string | null;
  raw: { [k: string]: unknown }; // full provider response
}

export interface ExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string | null;
  redirectURI: string;
  codeVerifier: string | null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

// Parses a token-endpoint body by content-type: JSON, else
// x-www-form-urlencoded (RFC 6749 permits both).
function parseTokenBody(contentType: string, text: string): { [k: string]: unknown } | null {
  if (contentType.indexOf("json") >= 0) {
    try {
      const parsed = JSON.parse(text) as { [k: string]: unknown };
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
  const params = new URLSearchParams(text);
  const raw: { [k: string]: unknown } = {};
  for (const name of params.keys()) {
    const v = params.get(name);
    if (v !== null) {
      raw[name] = v;
    }
  }
  if (raw["access_token"] === undefined) {
    return null;
  }
  return raw;
}

export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  params: ExchangeParams,
): Promise<TokenSet | null> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectURI);
  body.set("client_id", params.clientId);
  if (params.codeVerifier !== null) {
    body.set("code_verifier", params.codeVerifier);
  }
  const headers: { [k: string]: string } = {};
  headers["content-type"] = "application/x-www-form-urlencoded";
  headers["accept"] = "application/json";
  if (params.clientSecret !== null) {
    // RFC 6749 §2.3.1: client auth via HTTP basic.
    body.set("client_secret", params.clientSecret);
    headers["authorization"] =
      "Basic " +
      Buffer.from(params.clientId + ":" + params.clientSecret, "utf8").toString("base64");
  }
  let res: Response;
  try {
    res = await fetch(provider.tokenEndpoint, {
      method: "POST",
      headers: headers,
      body: body.toString(),
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  let text: string;
  let contentType = "";
  try {
    const ct = res.headers.get("content-type");
    contentType = ct === null ? "" : ct;
    text = await res.text();
  } catch {
    return null;
  }
  const raw = parseTokenBody(contentType, text);
  if (raw === null) {
    return null;
  }
  const accessToken = raw["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    return null;
  }
  const out: TokenSet = {
    access_token: accessToken,
    token_type:
      strOrNull(raw["token_type"]) === null ? "" : (strOrNull(raw["token_type"]) as string),
    refresh_token: strOrNull(raw["refresh_token"]),
    expires_in: numOrNull(raw["expires_in"]),
    scope: strOrNull(raw["scope"]),
    id_token: strOrNull(raw["id_token"]),
    raw: raw,
  };
  return out;
}

export async function fetchUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ [k: string]: unknown } | null> {
  if (provider.userInfoEndpoint === null) {
    return null;
  }
  const headers: { [k: string]: string } = {};
  headers["authorization"] = "Bearer " + accessToken;
  headers["accept"] = "application/json";
  let res: Response;
  try {
    res = await fetch(provider.userInfoEndpoint, { headers: headers });
  } catch {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { [k: string]: unknown };
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Schema-parsed userinfo — same StandardSchemaV1 seam as verifyJwtWith.
export async function fetchUserInfoWith<Schema extends StandardSchemaV1>(
  provider: OAuthProvider,
  accessToken: string,
  schema: Schema,
): Promise<StandardSchemaV1.InferOutput<Schema> | null> {
  const info = await fetchUserInfo(provider, accessToken);
  if (info === null) {
    return null;
  }
  const out = await runSchema(schema, info);
  if (out === null) {
    return null;
  }
  return out as StandardSchemaV1.InferOutput<Schema>;
}
