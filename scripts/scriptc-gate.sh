#!/usr/bin/env bash
# Fails unless every gate app reports 100% static under `scriptc coverage`.
# Gates are the compile entries named in each package AGENTS.md. Run after `pnpm -r build`.
set -euo pipefail

cd "$(dirname "$0")/.."

GATES=(
  bench/apps/chttp-fetch.ts
  bench/apps/fetch-surface.ts
  bench/apps/chttp-html.ts
  bench/apps/chttp-stream.ts
  bench/apps/chttp-val.ts
  bench/apps/chttp-multipart.ts
  bench/apps/chttp-client.ts
  packages/static/gate.ts
  packages/auth/gate.ts
  packages/mcp/gate.ts
)

fail=0
for gate in "${GATES[@]}"; do
  out=$(pnpm exec scriptc coverage "$gate" 2>&1) || true
  line=$(printf '%s\n' "$out" | grep -E 'compile statically' || true)
  if [[ "$line" == *"(100%)"* ]]; then
    printf 'ok   %s %s\n' "$gate" "$(printf '%s' "$line" | tr -s ' ')"
  else
    printf 'FAIL %s %s\n' "$gate" "${line:-no coverage line}"
    printf '%s\n' "$out" | tail -20
    fail=1
  fi
done
exit "$fail"
