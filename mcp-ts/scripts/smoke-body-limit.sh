#!/usr/bin/env bash
# Live smoke test for the MCP request-body cap (R2 audit idx 18/56).
#
# Every oversized POST / must be answered with HTTP 413 and a JSON-RPC error
# (-32600), never an empty 413 or a Caddy 502, whether the body carries a
# Content-Length or is chunked. Read-only: every request is rejected before
# any tool runs.
#
# Usage: mcp-ts/scripts/smoke-body-limit.sh [base_url]   (default https://mcp.pegana.xyz/)
set -euo pipefail

URL="${1:-https://mcp.pegana.xyz/}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

check() { # label, extra curl args...
  local label="$1"; shift
  local code
  code="$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -H 'Expect:' "$@" "$URL" || true)"
  if [[ "$code" == "413" ]] && grep -q '"code":-32600' "$TMP/out"; then
    echo "ok   $label -> 413 JSON-RPC"
  else
    echo "FAIL $label -> HTTP $code body: $(head -c 200 "$TMP/out" 2>/dev/null)"
    fail=1
  fi
}

for size in 65537 131072 1048576 2097152; do
  head -c "$size" /dev/zero | tr '\0' 'a' > "$TMP/body"
  check "Content-Length $size B" --data-binary "@$TMP/body"
done
head -c 2097152 /dev/zero | tr '\0' 'a' > "$TMP/body"
check "chunked 2097152 B" -H 'Transfer-Encoding: chunked' -T - < "$TMP/body"

exit "$fail"
