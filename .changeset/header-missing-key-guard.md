---
"@chttp/router": patch
---

fix(req): `c.req.header(name)` no longer crashes on absent headers in single-graph (vendored/program-code) scriptc builds — `_headers`/`_headersDistinct` are probed with `hasOwnProperty` before indexing instead of a bare record read that throws "record has no key".
