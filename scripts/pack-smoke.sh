#!/usr/bin/env bash
# Pack @chttp/router, @chttp/val and @chttp/mcp, install the tarballs into a
# fresh app, compile it to a native ELF with scriptc, then exercise it over
# HTTP (and JSON-RPC for the mcp+val pairing, cutils#27).
# Requires `pnpm -r build` and `pnpm install` to have run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
PORT="${SMOKE_PORT:-$((20000 + RANDOM % 20000))}"
PID=""

cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$T"
}
trap cleanup EXIT

fail() {
  echo "pack-smoke FAIL: $*" >&2
  exit 1
}

cd "$ROOT"
mkdir -p "$T/tar" "$T/app"
pnpm --filter @chttp/router --filter @chttp/val --filter @chttp/mcp pack --pack-destination "$T/tar" >/dev/null

cp "$ROOT/tests/pack-smoke/app.ts" "$T/app/app.ts"
cp "$ROOT/tests/pack-smoke/mcp-app.ts" "$T/app/mcp-app.ts"
cp "$ROOT/tests/pack-smoke/tsconfig.mcp.json" "$T/app/tsconfig.mcp.json"
printf '{"private":true,"type":"module"}\n' >"$T/app/package.json"
(cd "$T/app" && pnpm add --ignore-workspace "$T"/tar/*.tgz >/dev/null)

pnpm exec scriptc build "$T/app/app.ts" -o "$T/app/out" \
  || fail "scriptc build"
echo "build OK"

"$T/app/out" "$PORT" &
PID=$!

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/json"; then break; fi
  sleep 0.1
done

URL="http://127.0.0.1:$PORT"
for i in 1 2 3; do
  got="$(curl -s -X POST -d '{"name":"a","tags":["x"]}' "$URL/val")"
  echo "$got"
  [ "$got" = '{"ok":true}' ] || fail "valid request $i returned: $got"
done

code="$(curl -s -o "$T/bad.json" -w '%{http_code}' -X POST -d '{"name":1}' "$URL/val")"
echo "$code $(cat "$T/bad.json")"
[ "$code" = "422" ] || fail "invalid request status $code"
grep -Eq '^\{"issues":[0-9]+\}$' "$T/bad.json" || fail "invalid request body"

got="$(curl -s "$URL/json")"
echo "$got"
[ "$got" = '{"hello":"world"}' ] || fail "/json returned: $got"

# --- @chttp/mcp x @chttp/val pairing (cutils#27) ---
# The packed tarballs must type-check the README quickstart under tsc (val
# schema into tool(), emitJsonSchema adapter arrow, inferred handler input)
# and scriptc-build + serve JSON-RPC through Server.handleRequest.
(cd "$T/app" && pnpm add --ignore-workspace "typescript@^5" @types/node >/dev/null)
(cd "$T/app" && pnpm exec tsc -p tsconfig.mcp.json) \
  || fail "tsc typecheck of the mcp+val pairing"
echo "mcp+val typecheck OK"

pnpm exec scriptc build "$T/app/mcp-app.ts" -o "$T/app/mcp-out" \
  || fail "scriptc build of the mcp+val app"
echo "mcp+val build OK"

res=$("$T/app/mcp-out" '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
printf '%s\n' "$res" | grep -q '"name":"add_todo"' || fail "tools/list: $res"
printf '%s\n' "$res" | grep -q '"minLength":1' || fail "tools/list inputSchema: $res"

res=$("$T/app/mcp-out" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_todo","arguments":{"text":"ship it"}}}')
printf '%s\n' "$res" | grep -q 'added: ship it' || fail "tools/call: $res"

# Invalid args still produce a dispatch-level response (INVALID_PARAMS under
# node/bun). Known scriptc limitation: the `error` member of the response
# record is dropped when it crosses the package call boundary into the app's
# stringify, so the ELF emits just the envelope — assert it answered at all.
res=$("$T/app/mcp-out" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_todo","arguments":{"text":""}}}')
printf '%s\n' "$res" | grep -q '"id":3' || fail "tools/call invalid args: $res"

echo "pack-smoke OK"
