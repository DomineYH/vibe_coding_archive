#!/usr/bin/env bash
# usage (from backend/): BACKEND_TEST_SHARDS='<one pytest selection per line>' backend-shard-guard.sh <job-total>
# Fails unless the selections are exactly <job-total> lines that together collect every test exactly once.
set -euo pipefail
total=$1
shards=$(printf '%s\n' "$BACKEND_TEST_SHARDS" | sed '/^[[:space:]]*$/d')
lines=$(printf '%s\n' "$shards" | wc -l)
if [ "$lines" -ne "$total" ]; then
  echo "::error::BACKEND_TEST_SHARDS has $lines selections but the matrix has $total shards; make them match."
  exit 1
fi
tmp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/shard-guard.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
collect() { # appends the collected test ids of one selection to $tmp/ids
  if ! uv run --frozen pytest --collect-only -q "$@" > "$tmp/out"; then
    cat "$tmp/out"
    echo "::error::pytest could not collect '$*'; fix the selection in BACKEND_TEST_SHARDS or the collection error above."
    exit 1
  fi
  grep '::' "$tmp/out" >> "$tmp/ids" || true
}
collect
sort "$tmp/ids" > "$tmp/all"
: > "$tmp/ids"
while IFS= read -r selection; do
  # shellcheck disable=SC2086 # unquoted so the globs expand
  collect $selection
done <<< "$shards"
sort "$tmp/ids" > "$tmp/shards"
if ! diff "$tmp/all" "$tmp/shards"; then
  echo "::error::Shards do not cover every test exactly once ('<' missing, '>' duplicated). Add the file's path to one selection in BACKEND_TEST_SHARDS or move the file so exactly one selection matches it."
  exit 1
fi
echo "Backend shard guard: $(wc -l < "$tmp/all") tests collected, each in exactly one of $total shards."
