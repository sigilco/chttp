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

echo "elf.test OK"
