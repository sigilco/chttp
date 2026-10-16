#!/usr/bin/env bash
# Build test/elf-app.ts to a native ELF (scriptc build) and run it: the
# binary runs the RFC vectors end-to-end (scrypt hash+verify, session
# round-trip on MemorySessionStore, HS256 sign+verify, PKCE App.B, TOTP and
# base32 RFC vectors) and prints OK. Requires `pnpm install` at the
# workspace root (scriptc is a root devDependency).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail() {
  echo "elf-auth-smoke FAIL: $*" >&2
  exit 1
}

# Prefer the workspace-root binary; fall back to PATH.
BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi
"$BIN" build test/elf-app.ts -o "$T/auth-elf" >/dev/null || fail "scriptc build"
echo "build OK"

out="$("$T/auth-elf")" || fail "elf run"
[ "$out" = "OK" ] || fail "unexpected output: $out"

echo "elf-auth-smoke OK"
