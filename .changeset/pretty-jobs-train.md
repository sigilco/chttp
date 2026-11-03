---
"@chttp/router": patch
---

Type the adopted-body read callback as unknown and narrow instead of naming DOM ReadableStreamReadResult, so scriptc typechecks the router when a program reaches it through @chttp/router/src
