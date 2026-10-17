#!/usr/bin/env bash
#
# setup-crates-trusted-publishing.sh
#
# Registers PeganaHQ/ReplayCLI as a Trusted Publisher for the three published
# crates, then (optionally) flips each crate to trustpub-only so publishing
# with a long-lived API token is refused by crates.io from then on.
#
# WHY THIS MATTERS MORE THAN IT LOOKS
#   A stolen CARGO_REGISTRY_TOKEN lets an attacker publish a `pegana-replay`
#   that returns PASS on tampered receipts. Users install it with
#   `cargo install` and never touch GitHub, so none of the repo-side hardening
#   (rulesets, attestations, immutable releases) helps. Turning on
#   `trustpub_only` is what actually retires that credential: after it, the
#   ONLY way to publish is an OIDC identity minted by
#   .github/workflows/publish.yml running in PeganaHQ/ReplayCLI, behind the
#   `crates-io` environment's manual approval.
#
# TOKEN HANDLING
#   The token is read from the environment and never printed, never written to
#   disk, and never passed as a command-line argument (argv is visible to other
#   processes via `ps`). Create one at https://crates.io/settings/tokens with:
#     - scope:  trusted-publishing   (required for the config endpoints)
#     - scope:  publish-update       (required for the trustpub_only PATCH)
#     - crates: pegana-common-verify, pegana-methodology, pegana-replay
#   Then revoke it when this script is done — it is not needed again.
#
# USAGE
#   export CRATES_IO_TOKEN=...            # not typed inline; use a password manager
#   ./scripts/setup-crates-trusted-publishing.sh status    # read-only, no token needed
#   ./scripts/setup-crates-trusted-publishing.sh register  # add the trusted publishers
#   ./scripts/setup-crates-trusted-publishing.sh enforce   # flip trustpub_only=true
#
# Run `register` FIRST and confirm a real publish works before `enforce` —
# enforcing with a broken publisher config locks you out of publishing until
# you turn it back off.
#
set -euo pipefail

API="https://crates.io/api/v1"
UA="pegana-setup (rafael@pegana.xyz)"
OWNER="PeganaHQ"
REPO="ReplayCLI"
WORKFLOW="publish.yml"
ENVIRONMENT="crates-io"
CRATES=(pegana-common-verify pegana-methodology pegana-replay)

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

need_token() {
  if [[ -z "${CRATES_IO_TOKEN:-}" ]]; then
    echo "CRATES_IO_TOKEN is not set. Export it first — do not pass it as an argument." >&2
    exit 2
  fi
}

# Authorization goes in a header read from the env; it never reaches argv.
api() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "${API}${path}" \
      -H "User-Agent: ${UA}" \
      -H "Authorization: ${CRATES_IO_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data-binary "$body"
  else
    curl -sS -X "$method" "${API}${path}" \
      -H "User-Agent: ${UA}" \
      -H "Authorization: ${CRATES_IO_TOKEN}"
  fi
}

status() {
  echo "Trusted-publishing status"
  for c in "${CRATES[@]}"; do
    local out
    out="$(curl -sS -H "User-Agent: ${UA}" "${API}/crates/${c}" || true)"
    printf '  %-24s ' "$c"
    python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)["crate"]
except Exception:
    print("unreadable"); raise SystemExit
print("v%-8s trustpub_only=%s" % (d.get("max_version"), d.get("trustpub_only")))
' <<<"$out"
  done
  if [[ -n "${CRATES_IO_TOKEN:-}" ]]; then
    echo "  registered publishers:"
    # The `crate` query param is REQUIRED in practice: without it the endpoint
    # returns an empty list rather than everything you own, which reads as
    # "nothing is registered" and is badly misleading right after a successful
    # register run. Query per crate instead.
    for c in "${CRATES[@]}"; do
      api GET "/trusted_publishing/github_configs?crate=${c}" | python3 -c '
import json,sys
name = sys.argv[1]
try: d = json.load(sys.stdin)
except Exception:
    print("    %-24s (unreadable — is the token scoped for trusted-publishing?)" % name); raise SystemExit
cfgs = d.get("github_configs") or []
if not cfgs:
    print("    %-24s (none)" % name)
for g in cfgs:
    print("    %-24s %s/%s · %s · env=%s" % (name, g.get("repository_owner"),
          g.get("repository_name"), g.get("workflow_filename"), g.get("environment")))
' "$c"
    done
  else
    warn "set CRATES_IO_TOKEN to also list registered publishers"
  fi
}

register() {
  need_token
  echo "Registering ${OWNER}/${REPO} (${WORKFLOW}, env=${ENVIRONMENT}) as trusted publisher"
  for c in "${CRATES[@]}"; do
    local body resp
    body="$(python3 -c '
import json,sys
print(json.dumps({"github_config":{
  "crate": sys.argv[1], "repository_owner": sys.argv[2],
  "repository_name": sys.argv[3], "workflow_filename": sys.argv[4],
  "environment": sys.argv[5]}}))' "$c" "$OWNER" "$REPO" "$WORKFLOW" "$ENVIRONMENT")"
    resp="$(api POST "/trusted_publishing/github_configs" "$body")"
    if grep -q '"errors"' <<<"$resp"; then
      bad "$c — $(python3 -c 'import json,sys; print("; ".join(e.get("detail","?") for e in json.load(sys.stdin).get("errors",[])))' <<<"$resp")"
    else
      ok "$c"
    fi
  done
}

enforce() {
  need_token
  warn "This makes API-token publishing IMPOSSIBLE for these crates."
  warn "Only do this after a real publish through publish.yml has succeeded."
  read -r -p "  Type 'enforce' to continue: " confirm
  [[ "$confirm" == "enforce" ]] || { echo "  aborted"; exit 1; }
  for c in "${CRATES[@]}"; do
    local resp
    resp="$(api PATCH "/crates/${c}" '{"crate":{"trustpub_only":true}}')"
    if grep -q '"errors"' <<<"$resp"; then
      bad "$c — $(python3 -c 'import json,sys; print("; ".join(e.get("detail","?") for e in json.load(sys.stdin).get("errors",[])))' <<<"$resp")"
    else
      ok "$c — trustpub_only=true"
    fi
  done
}

case "${1:-status}" in
  status)   status ;;
  register) register; echo; status ;;
  enforce)  enforce; echo; status ;;
  *) echo "usage: $0 {status|register|enforce}" >&2; exit 2 ;;
esac
