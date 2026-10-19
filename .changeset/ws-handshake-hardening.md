---
"@chttp/ws": minor
"@chttp/router": patch
---

feat(ws): post-merge audit hardening for issue #13 — `allowOrigin` exact-match allowlist (403), `Sec-WebSocket-Key` base64/16-byte format check, peer close-reason UTF-8 validation (1007); `upgradeHandler()` catches a throwing dispatch and destroys the socket; `UpgradeFn` re-exported
