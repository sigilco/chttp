# @chttp/auth

## 0.4.0

### Minor Changes

- Move `@chttp/auth` and `@chttp/mcp` into the chttp monorepo from sigilco/cutils (where they shipped as 0.2.0). Both packages join the fixed versioning group and publish at chttp's shared version going forward. No source changes in the move — session/JWT/OAuth/CSRF/TOTP primitives and the JSON-RPC 2.0 MCP server land as-is, with gates wired into `scripts/scriptc-gate.sh` and docs pages added to the site nav.

## 0.2.0

### Minor Changes

- Add @chttp/auth: session, password, JWT, OAuth2+PKCE, CSRF and TOTP primitives over node:crypto
