#!/usr/bin/env bash
# ELF smoke for the typed client: compiles bench/apps/chttp-client.ts —
# which serves a chttp app on node:http and drives it with the compiled
# client over loopback TCP — and asserts the "gate OK" line. The
# TCP-from-ELF check is the point: it proves node:net + the whole
# client request path lower and run.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "elf.test.sh FAIL: $*" >&2
  exit 1
}

BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi

mkdir -p build
"$BIN" build ../../bench/apps/chttp-client.ts -o build/client-gate || fail "scriptc build"
echo "build OK"

out="$(PORT=18123 timeout 20 ./build/client-gate)" || fail "client-gate exited nonzero: $out"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "elf.test.sh OK"
