#!/usr/bin/env bash
# usage: retry.sh <command...>: up to 3 attempts, RETRY_DELAY (default 30) seconds apart
for attempt in 1 2 3; do
  "$@" && exit 0
  echo "attempt $attempt failed: $*" >&2
  [ "$attempt" -lt 3 ] && sleep "${RETRY_DELAY:-30}"
done
exit 1
