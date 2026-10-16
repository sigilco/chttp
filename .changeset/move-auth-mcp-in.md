---
"@chttp/auth": minor
"@chttp/mcp": minor
---

Move `@chttp/auth` and `@chttp/mcp` into the chttp monorepo from sigilco/cutils (where they shipped as 0.2.0). Both packages join the fixed versioning group and publish at chttp's shared version going forward. No source changes in the move — session/JWT/OAuth/CSRF/TOTP primitives and the JSON-RPC 2.0 MCP server land as-is, with gates wired into `scripts/scriptc-gate.sh` and docs pages added to the site nav.
