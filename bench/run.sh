#!/usr/bin/env bash
# chttp bench suite — DESIGN.md §5.
#   bash bench/run.sh              # all subjects
#   bash bench/run.sh raw-node hono-bun ...   # subset
#
# Methodology: warmup `autocannon -c16 -d2` (discarded), then per cell
# `-c64 -d6` x3, median recorded. Cells: json, user, echo64, echo1k,
# deep, files, missing, mixed (ceilings: json, user, echo64, echo1k).
# Also: spawn->200 cold start (median of 10), RSS after 100k reqs,
# binary size for ELF subjects.
set -u
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH:$HOME/.bun/bin"

BASE="http://127.0.0.1:3000"
RESULTS=results
mkdir -p "$RESULTS" logs

# name | command | cellset (full|ceil) | binary-path (optional)
SUBJECTS=(
  "chttp-node|node apps/chttp.ts|full|"
  "chttp-bun|bun apps/chttp.ts|full|"
  "chttp-fetch-node|node apps/chttp-fetch.ts|full|"
  "chttp-fetch-bun|bun apps/chttp-fetch.ts|full|"
  "chttp-fetch-lite-node|node apps/chttp-fetch-lite.ts|full|"
  "chttp-scriptc|./bin/chttp-scriptc|full|bin/chttp-scriptc"
  "chttp-elf-fetch|./bin/chttp-elf-fetch|full|bin/chttp-elf-fetch"
  "raw-node|node apps/raw.ts|full|"
  "raw-bun|bun apps/raw-bun.ts|full|"
  "raw-scriptc|./bin/raw-scriptc|full|bin/raw-scriptc"
  "h3-node|node apps/h3.mjs|full|"
  "h3-bun|bun apps/h3-bun.mjs|full|"
  "hono-node|node apps/hono.mjs|full|"
  "hono-bun|bun apps/hono-bun.ts|full|"
  "fmw-node|node apps/fmw.mjs|full|"
  "fmw-bun|bun apps/fmw.mjs|full|"
  "express-node|node apps/express.mjs|full|"
  "express-bun|bun apps/express.mjs|full|"
  "go-chi|./ceilings/bin/go-chi|ceil|ceilings/bin/go-chi"
  "rust-axum|./ceilings/bin/rust-axum|ceil|ceilings/bin/rust-axum"
  "c-mongoose|./ceilings/bin/c-mongoose|ceil|ceilings/bin/c-mongoose"
)

FILTER=("$@")

run_subject() {
  local name="$1" cmd="$2" cellset="$3" binpath="$4"
  if [ "${#FILTER[@]}" -gt 0 ]; then
    local found=0 f
    for f in "${FILTER[@]}"; do [ "$f" = "$name" ] && found=1; done
    [ "$found" = 0 ] && return 0
  fi

  echo "===== $name ($cmd) ====="
  # shellcheck disable=SC2086
  $cmd > "logs/$name.log" 2>&1 &
  local pid=$!
  local i
  for i in $(seq 1 150); do
    curl -sf "$BASE/json" >/dev/null 2>&1 && break
    sleep 0.2
  done
  if ! curl -sf "$BASE/json" >/dev/null 2>&1; then
    echo "  !! $name failed to start (see logs/$name.log)" >&2
    kill "$pid" 2>/dev/null
    echo "{\"subject\":\"$name\",\"error\":\"no-start\"}" >> "$RESULTS/_errors.jsonl"
    return 1
  fi

  # warmup — discarded
  node lib/ac-run.mjs --url "$BASE/json" -c 16 -d 2 >/dev/null

  local cells
  if [ "$cellset" = ceil ]; then cells="json user echo64 echo1k"; else cells="json user echo64 echo1k deep files missing mixed"; fi

  for cell in $cells; do
    for rep in 1 2 3; do
      case $cell in
        json)     node lib/ac-run.mjs --url "$BASE/json" -c 64 -d 6 ;;
        user)     node lib/ac-run.mjs --url "$BASE/user/42" -c 64 -d 6 ;;
        echo64)   node lib/ac-run.mjs --url "$BASE/echo" --method POST --body-size 64 -c 64 -d 6 ;;
        echo1k)   node lib/ac-run.mjs --url "$BASE/echo" --method POST --body-size 1024 -c 64 -d 6 ;;
        deep)     node lib/ac-run.mjs --url "$BASE/deep/a/b/c/d/e" -c 64 -d 6 ;;
        files)    node lib/ac-run.mjs --url "$BASE/files/a/b/c.txt" -c 64 -d 6 ;;
        missing)  node lib/ac-run.mjs --url "$BASE/missing" -c 64 -d 6 ;;
        mixed)    node lib/ac-run.mjs --url "$BASE" --preset mixed -c 64 -d 6 ;;
      esac | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);r.subject='$name';r.cell='$cell';r.rep=$rep;console.log(JSON.stringify(r))})" >> "$RESULTS/$name.jsonl"
      printf '  %s rep%d done\n' "$cell" "$rep"
    done
  done

  # RSS after 100k requests on /json
  node lib/ac-run.mjs --url "$BASE/json" -c 64 --amount 100000 >/dev/null
  sleep 0.5
  local rss
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
  echo "{\"subject\":\"$name\",\"rss_kb_after_100k\":${rss:-null}}" >> "$RESULTS/$name.meta.jsonl"
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

  # cold start: spawn -> first 200, median of 10
  # shellcheck disable=SC2086
  node lib/coldstart.mjs 10 -- $cmd | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);r.subject='$name';console.log(JSON.stringify(r))})" >> "$RESULTS/$name.meta.jsonl"

  # binary size
  if [ -n "$binpath" ] && [ -f "$binpath" ]; then
    echo "{\"subject\":\"$name\",\"binary_bytes\":$(stat -c%s "$binpath")}" >> "$RESULTS/$name.meta.jsonl"
  fi
  echo "===== $name done ====="
}

for entry in "${SUBJECTS[@]}"; do
  IFS='|' read -r name cmd cellset binpath <<< "$entry"
  run_subject "$name" "$cmd" "$cellset" "$binpath"
done

echo "all done -> $RESULTS/"
