---
"@chttp/router": patch
---

fix(router): `route("/", sub)` now mounts the sub-app at the root instead of registering double-slash paths (`//health`) that 404 on every request. A `"/"` prefix collapses to `""` before `mountRoutes` concatenation, matching Hono behavior.
