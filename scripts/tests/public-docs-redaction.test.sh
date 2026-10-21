#!/usr/bin/env bash
# Guard: docs mirrored to the public PeganaHQ/Pegana repo must never name the
# production SSH host, login pairs or key paths.
# Real values belong only in the private, unmirrored docs/ops/ dated runbooks
# (docs/ops/2026-*.md and docs/ops/lst-cleanup/), which the mirror withholds.
# Use $PEGANA_DEPLOY_SERVER (deploy@<prod-host>) in runbooks instead.
#
# Two scans:
#   1. Public IPv4 literals in the ops prose the mirror carries (DIR). Not run
#      over all of docs/: version strings and Lighthouse JSON there look like
#      IPv4 addresses and would only be noise.
#   2. user@<IPv4> pairs and the deploy key path in EVERY file under docs/
#      except the withheld private runbooks (no false positives seen there).
#
# Run: bash scripts/tests/public-docs-redaction.test.sh   (also runs in CI)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Space-separated list of mirrored paths for scan 1.
DIR="${PUBLIC_DOCS_PATHS:-$ROOT/docs/runbooks $ROOT/docs/operations $ROOT/docs/archive $ROOT/docs/ops/deploy.md}"
# Root for scan 2, minus the withheld private runbooks.
WIDE="${PUBLIC_DOCS_WIDE_ROOT:-$ROOT/docs}"
failed=0

# IPv4 literals that are fine to publish: loopback/unspecified, public DNS
# resolvers used in dig examples, RFC 1918 private ranges and the RFC 5737
# documentation ranges.
allowed_ip() {
  case "$1" in
    127.*|0.0.0.0|1.1.1.1|1.0.0.1|8.8.8.8|8.8.4.4) return 0 ;;
    10.*|192.168.*|192.0.2.*|198.51.100.*|203.0.113.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
  esac
  return 1
}

while IFS= read -r hit; do
  [[ -n "$hit" ]] || continue
  ip="${hit##*:}"
  allowed_ip "$ip" && continue
  printf '  FAIL public IPv4 literal %s\n' "$hit"
  failed=$((failed + 1))
done < <(grep -rnoE '\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b' $DIR 2>/dev/null)

# user@<numeric host> pairs and the private key path, across all of docs/
# except the withheld private runbooks.
while IFS= read -r hit; do
  [[ -n "$hit" ]] || continue
  case "$hit" in
    */docs/ops/2026-*|*/docs/ops/lst-cleanup/*) continue ;;
  esac
  printf '  FAIL host/key reference %s\n' "$hit"
  failed=$((failed + 1))
done < <(grep -rnE '[A-Za-z0-9_-]+@[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|\.ssh/pegana_deploy' $WIDE 2>/dev/null)

if (( failed == 0 )); then
  echo "public-docs-redaction: ok (IPv4: $DIR; host/key: $WIDE)"
else
  echo "public-docs-redaction: $failed finding(s) (IPv4: $DIR; host/key: $WIDE)"
fi
(( failed == 0 ))
