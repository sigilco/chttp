// Provider presets: plain records, ~15 LoC each — google, github, discord,
// the top three. A new provider is a 15-LoC record in user code; the
// package deliberately grows no registry (the better-auth trap).

import type { OAuthProvider } from "./oauth.ts";

// OIDC: openid email profile; PKCE on.
export const googleProvider: OAuthProvider = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: ["openid", "email", "profile"],
  usePkce: true,
};

// Non-OIDC /user endpoint; PKCE is tolerated (ignored) by GitHub.
export const githubProvider: OAuthProvider = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  userInfoEndpoint: "https://api.github.com/user",
  scope: ["read:user", "user:email"],
  usePkce: true,
};

// Discord supports PKCE for public clients (clientSecret may be null).
export const discordProvider: OAuthProvider = {
  authorizationEndpoint: "https://discord.com/oauth2/authorize",
  tokenEndpoint: "https://discord.com/api/oauth2/token",
  userInfoEndpoint: "https://discord.com/api/users/@me",
  scope: ["identify", "email"],
  usePkce: true,
};
