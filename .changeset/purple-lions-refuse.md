---
"@chttp/router": none
---

Pin scriptc 0.4.7 exactly across the repo toolchain (root devDep, aws-lambda example, bench Dockerfile): the 0.4.x native runtime ABI moved v22 to v48 over six releases with no changelog signal, so a range would silently relink every ELF. All eleven coverage gates, the workspace tests, and the pack/ws smoke pass on 0.4.7; bench re-baseline status recorded in bench/RESULTS-v2.md (canonical rig run still owed, see that file). Toolchain-only change: no published package API or behavior moves, so the fixed group does not advance.
