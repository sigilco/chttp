#!/usr/bin/env bash
# Builds test/elf-smoke.ts to a native ELF with `scriptc build`, runs it, and
# asserts the JSON-RPC roundtrip + SSE frame shape. Requires `pnpm install`
# to have run. Runs as part of `pnpm test`.
set -euo pipefail

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$PKG/../.." && pwd)"
OUT="${TMPDIR:-/tmp}/chttp-mcp-elf-smoke"

fail() {
  echo "elf.test FAIL: $*" >&2
  exit 1
}

cd "$ROOT"
# Prefer the workspace-root binary; `pnpm exec` resolves to a stray PATH
# pnpm on some machines.
BIN="scriptc"
if [ -x node_modules/.bin/scriptc ]; then
  BIN="node_modules/.bin/scriptc"
fi
"$BIN" build "$PKG/test/elf-smoke.ts" -o "$OUT" >/dev/null \
  || fail "scriptc build"
echo "build OK"

res=$("$OUT" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
printf '%s\n' "$res" | grep -q '"serverInfo":{"name":"elf-smoke"' \
  || fail "initialize envelope: $res"

res=$("$OUT" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"hi":7}}}')
printf '%s\n' "$res" | grep -q 'hi' \
  || fail "tools/call echo: $res"
printf '%s\n' "$res" | grep -q '^data: {"jsonrpc":"2.0","method":"notifications/progress"' \
  || fail "SSE frame: $res"

res=$("$OUT" '{"jsonrpc":"2.0","method":"notifications/initialized"}')
first=$(printf '%s\n' "$res" | head -1)
[ "$first" = "NOTIFY" ] || fail "notification should print NOTIFY: $res"

res=$("$OUT" '{"jsonrpc":"2.0","id":9,"method":"bogus/method"}')
printf '%s\n' "$res" | grep -q '"code":-32601' \
  || fail "unknown method: $res"

if "$OUT" '{bad json' 2>/dev/null; then
  fail "malformed JSON should exit non-zero"
fi

res=$("$OUT" '{bad json' envelope) || fail "parse error envelope exit"
printf '%s\n' "$res" | grep -q '"id":null' \
  || fail "parse error should answer on id null: $res"
printf '%s\n' "$res" | grep -q '"code":-32700' \
  || fail "parse error code: $res"

# ---------- client smoke (socket HTTP transport inside the ELF) ----------

OUTC="${TMPDIR:-/tmp}/chttp-mcp-elf-client-smoke"
"$BIN" build "$PKG/test/elf-client-smoke.ts" -o "$OUTC" >/dev/null \
  || fail "scriptc build (client)"
echo "build OK (client)"

res=$(timeout 15 "$OUTC")
printf '%s\n' "$res" | grep -q 'server: elf-client-smoke' \
  || fail "initialize: $res"
printf '%s\n' "$res" | grep -q 'session: sess-1' \
  || fail "session header: $res"
printf '%s\n' "$res" | grep -q 'call: {"structured":{"hi":7}}' \
  || fail "call: $res"
printf '%s\n' "$res" | grep -q 'resource: contents' \
  || fail "resource: $res"
printf '%s\n' "$res" | grep -q 'tools: 1' \
  || fail "tools list: $res"
printf '%s\n' "$res" | grep -q 'validation: rejected' \
  || fail "input validation: $res"
printf '%s\n' "$res" | grep -q 'rpcErr: passthrough' \
  || fail "error passthrough: $res"
printf '%s\n' "$res" | grep -q 'progress: notifications/progress' \
  || fail "progress stream: $res"
printf '%s\n' "$res" | grep -q 'elf-client-smoke OK' \
  || fail "client smoke end: $res"

# ---------- stdio transport smoke ----------

OUTS="${TMPDIR:-/tmp}/chttp-mcp-elf-stdio-smoke"
"$BIN" build "$PKG/test/elf-stdio-smoke.ts" -o "$OUTS" >/dev/null \
  || fail "scriptc build (stdio)"
echo "build OK (stdio)"

res=$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"hi":7}}}' \
  '{bad json' \
  '{"jsonrpc":"2.0","id":3,"method":"bogus/method"}' \
  | timeout 15 "$OUTS")
printf '%s\n' "$res" | grep -q '"serverInfo":{"name":"elf-stdio"' \
  || fail "stdio initialize: $res"
printf '%s\n' "$res" | grep -q 'echo:{' \
  || fail "stdio tools/call: $res"
printf '%s\n' "$res" | grep -q '"code":-32700' \
  || fail "stdio parse error: $res"
printf '%s\n' "$res" | grep -q '"code":-32601' \
  || fail "stdio unknown method: $res"
[ "$(printf '%s\n' "$res" | wc -l | tr -d ' ')" = "4" ] \
  || fail "stdio: expected 4 response lines (notification is silent): $res"

echo "elf.test OK"
