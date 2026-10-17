#!/usr/bin/env bash
# scripts/pre-deploy-check.sh — pre-flight verification for Trust Layer v0.1.0
#
# Runs the gauntlet from `docs/pegana-trust-layer-v0.1.0/plans/13-phase-13-deploy-outreach.md`
# Task 13.1 against the LOCAL checkout. Designed to be run by Rafael on his
# laptop BEFORE the 06-01 dogfood deploy AND BEFORE the 06-11 public launch.
#
# What this script does NOT do:
#   - SSH to prod (operator does that manually)
#   - Run integration tests requiring live Postgres unless
#     PEGANA_INTEGRATION_PG_URL is set
#   - Apply migrations to prod
#   - Send any outreach messages
#
# Exit codes:
#   0  — every required gate passed (deploy may proceed)
#   1  — at least one gate failed (deploy MUST NOT proceed)
#
# Usage:
#   ./scripts/pre-deploy-check.sh
#   PEGANA_INTEGRATION_PG_URL=postgres://... ./scripts/pre-deploy-check.sh
#
# Cross-refs:
#   - docs/operations/deploy-2026-06-01.md (dogfood deploy one-pager)
#   - docs/operations/deploy-2026-06-11.md (public launch one-pager)
#   - docs/adr/0001-calibration-v1-verdict-rule.md
#   - docs/adr/0005-early-evidence-rollout.md

set -uo pipefail

# ──────────────────────────────────────────────────────────────────────
# Resolve repo root from script location so cwd does not matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colors (NO_COLOR honored; tput skipped if not a TTY).
if [[ -t 1 && "${NO_COLOR:-}" == "" ]]; then
  RED="$(tput setaf 1)"; GRN="$(tput setaf 2)"; YEL="$(tput setaf 3)"
  BLU="$(tput setaf 4)"; BLD="$(tput bold)"; RST="$(tput sgr0)"
else
  RED=""; GRN=""; YEL=""; BLU=""; BLD=""; RST=""
fi

# ──────────────────────────────────────────────────────────────────────
# Result accumulator. Each gate appends one line: "PASS|FAIL|SKIP\tname"
RESULTS_FILE="$(mktemp -t pegana-predeploy.XXXXXX)"
trap 'rm -f "$RESULTS_FILE"' EXIT

record() {
  # $1 = PASS|FAIL|SKIP, $2 = gate name
  printf "%s\t%s\n" "$1" "$2" >> "$RESULTS_FILE"
}

step() {
  printf "\n%s──── %s ────%s\n" "$BLD" "$1" "$RST"
}

ok()    { printf "  %s[PASS]%s %s\n" "$GRN" "$RST" "$1"; record PASS "$1"; }
fail()  { printf "  %s[FAIL]%s %s\n" "$RED" "$RST" "$1"; record FAIL "$1"; }
skip()  { printf "  %s[SKIP]%s %s\n" "$YEL" "$RST" "$1"; record SKIP "$1"; }

# ──────────────────────────────────────────────────────────────────────
# Gate 1 — branch + git state
step "Gate 1 / 10 — git branch + state"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "feat/trust-layer-v0.1.0" || "$BRANCH" == "main" ]]; then
  ok "branch is '$BRANCH' (deploy-eligible)"
else
  fail "branch '$BRANCH' — expected 'feat/trust-layer-v0.1.0' or 'main'"
fi

if [[ -z "$(git status --porcelain)" ]]; then
  ok "working tree clean"
else
  fail "working tree dirty — commit or stash first"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 2 — repo hygiene + receipt boundary
# Deliberately runs BEFORE the expensive gates: a committed credential or a
# leaked enrichment field into the receipt pipeline should fail in seconds,
# not after a 10-minute clippy + build cycle.
step "Gate 2 / 10 — cargo xtask hygiene (tracked files + receipt boundary)"

if cargo run --quiet -p xtask -- hygiene 2>&1 | tail -20; then
  ok "no tracked secrets/scratch/artifacts; engine + methodology free of inert fields"
else
  fail "hygiene violations — see list above"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 3 — cargo clippy clean
step "Gate 3 / 10 — cargo clippy --workspace --all-targets -- -D warnings"

if cargo clippy --workspace --all-targets --quiet -- -D warnings 2>&1 | tail -20; then
  ok "clippy clean (no warnings)"
else
  fail "clippy emitted warnings or errors — fix before deploy"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 4 — workspace lib tests
step "Gate 4 / 10 — cargo test --workspace --lib"

if cargo test --workspace --lib --quiet 2>&1 | tail -10; then
  ok "workspace lib tests pass"
else
  fail "workspace lib tests failed"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 5 — integration tests for the deploy-critical crates
step "Gate 5 / 10 — cargo test -p engine-rs -p dispatcher-rs -p api-rs -p pegana-replay-cli"

# Integration tests that touch Postgres only run if PEGANA_INTEGRATION_PG_URL
# is exported. Otherwise we still run the rest (unit + sqlx::test ignored).
if [[ -n "${PEGANA_INTEGRATION_PG_URL:-}" ]]; then
  printf "  %sPEGANA_INTEGRATION_PG_URL set — running full suite%s\n" "$BLU" "$RST"
  if cargo test -p engine-rs -p dispatcher-rs -p api-rs -p pegana-replay-cli --quiet 2>&1 | tail -10; then
    ok "deploy-critical crate tests pass (incl. integration)"
  else
    fail "deploy-critical crate tests failed"
  fi
else
  printf "  %sPEGANA_INTEGRATION_PG_URL not set — DB-backed tests will be ignored%s\n" "$YEL" "$RST"
  if cargo test -p engine-rs -p dispatcher-rs -p api-rs -p pegana-replay-cli --quiet 2>&1 | tail -10; then
    ok "deploy-critical crate tests pass (unit only)"
  else
    fail "deploy-critical crate tests failed"
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 6 — web checks
#
# This gate used to run `bun run build`, i.e. `next build`, which CLAUDE.md and
# web/AGENTS.md both ban outright: it has crashed the dev machine. So the one
# gate meant to protect the web surface could not be run by the person running
# this script, and everything it was supposed to cover went unchecked.
#
# It runs what can actually be run and is worth running: typecheck, lint, and
# the unit suite — which is where the design and honesty guards live
# (tests/unit/design/*). The real build signal is a Vercel preview deploy, per
# web/AGENTS.md; a local build is neither available nor a substitute for it.
step "Gate 6 / 10 — cd web && bun run typecheck && lint && test"

if [[ -d "$REPO_ROOT/web" ]]; then
  if (cd "$REPO_ROOT/web" && bun run typecheck && bun run lint && bun run test 2>&1 | tail -6); then
    ok "web typecheck + lint + unit suite clean"
  else
    fail "web checks failed"
  fi
else
  skip "web/ directory missing (unexpected layout)"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 7 — (retired) the Telegram bot and its bot-ts package were removed
step "Gate 7 / 10 — bot-ts retired"
skip "bot-ts removed with the Telegram bot"

# ──────────────────────────────────────────────────────────────────────
# Gate 8 — MCP tests
step "Gate 8 / 10 — cd mcp-ts && bun run test"

if [[ -d "$REPO_ROOT/mcp-ts" ]]; then
  if (cd "$REPO_ROOT/mcp-ts" && bun run test 2>&1 | tail -10); then
    ok "mcp-ts tests pass"
  else
    fail "mcp-ts tests failed"
  fi
else
  skip "mcp-ts/ directory missing"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 9 — migrations 0028..0039 apply against a TEST DB
step "Gate 9 / 10 — migrations 0028..0039 apply cleanly"

MIGRATIONS=(
  "migrations/0028_alert_evidence.sql"
  "migrations/0029_alert_events_view.sql"
  "migrations/0030_methodology_versions.sql"
  "migrations/0031_alert_evidence_onchain_sig.sql"
  "migrations/0032_retractions.sql"
  "migrations/0033_commit_status_and_failures.sql"
  "migrations/0034_alert_evidence_pending.sql"
  "migrations/0035_engine_state_snapshot.sql"
  "migrations/0036_mcp_call_log.sql"
  "migrations/0037_block_truncate.sql"
  "migrations/0038_webhook_deliveries_alert_id_idx.sql"
  "migrations/0039_retractions_partial_immutability.sql"
)

ALL_PRESENT=1
for m in "${MIGRATIONS[@]}"; do
  if [[ ! -f "$REPO_ROOT/$m" ]]; then
    fail "migration missing: $m"
    ALL_PRESENT=0
  fi
done

if [[ "$ALL_PRESENT" == "1" ]]; then
  ok "all 12 migrations (0028..0039) present on disk"
fi

if [[ -n "${PEGANA_INTEGRATION_PG_URL:-}" ]]; then
  TEST_DB_NAME="pegana_predeploy_$(date +%s)"
  ADMIN_URL="${PEGANA_INTEGRATION_PG_URL%/*}/postgres"
  printf "  %screating test DB %s%s\n" "$BLU" "$TEST_DB_NAME" "$RST"

  if psql "$ADMIN_URL" -c "CREATE DATABASE $TEST_DB_NAME;" >/dev/null 2>&1; then
    TEST_URL="${PEGANA_INTEGRATION_PG_URL%/*}/$TEST_DB_NAME"

    # Apply prior migrations 0001..0027 first (full schema baseline), then the
    # 11 new ones, in lexical order.
    APPLY_OK=1
    for f in "$REPO_ROOT"/migrations/*.sql; do
      if ! psql "$TEST_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
        fail "migration $(basename "$f") failed against test DB"
        APPLY_OK=0
        break
      fi
    done

    if [[ "$APPLY_OK" == "1" ]]; then
      ok "all migrations applied cleanly against test DB"
    fi

    # Verify the methodology_versions seed row landed.
    SEED_COUNT="$(psql "$TEST_URL" -tAc "SELECT COUNT(*) FROM methodology_versions WHERE status='active';" 2>/dev/null || echo "0")"
    if [[ "$SEED_COUNT" -ge "1" ]]; then
      ok "methodology_versions has $SEED_COUNT active row(s) — /v1/methodology/current will return data"
    else
      fail "methodology_versions has no active row — /v1/methodology/current will 5xx"
    fi

    psql "$ADMIN_URL" -c "DROP DATABASE $TEST_DB_NAME;" >/dev/null 2>&1 || true
  else
    skip "could not create test DB at $ADMIN_URL (insufficient privileges?)"
  fi
else
  skip "PEGANA_INTEGRATION_PG_URL not set — migration dry-run deferred to staging"
fi

# ──────────────────────────────────────────────────────────────────────
# Gate 10 — /v1/methodology/current would return active (schema-level check)
step "Gate 10 / 10 — methodology version compile-time vs schema seed"

CARGO_VERSION="$(grep -E '^version\s*=' "$REPO_ROOT/crates/methodology/Cargo.toml" 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
# The ACTIVE methodology version is set by the NEWEST methodology migration —
# 0030 seeds the original v0.1.0 launch row, then 0041 (0.2.0) / 0044 (0.3.0) /
# 0051 (0.4.0) advance it. Reading 0030 hard-coded made this gate false-fail
# every deploy since v0.2.0 ("crate ≠ seed"); fixed 2026-06-19 to read the
# latest methodology_v*.sql (version derived from its filename), with a
# defensive fallback to the 0030 seed if no versioned migration exists.
LATEST_METH_MIGRATION="$(ls "$REPO_ROOT"/migrations/*methodology_v*.sql 2>/dev/null | sort | tail -1)"
if [[ -n "$LATEST_METH_MIGRATION" ]]; then
  SEED_VERSION="$(basename "$LATEST_METH_MIGRATION" | sed -nE 's/.*methodology_v([0-9]+)_([0-9]+)_([0-9]+)\.sql/\1.\2.\3/p')"
else
  SEED_VERSION="$(grep -oE "'[0-9]+\.[0-9]+\.[0-9]+'" "$REPO_ROOT/migrations/0030_methodology_versions.sql" 2>/dev/null | head -1 | tr -d "'")"
fi

if [[ -n "$CARGO_VERSION" && -n "$SEED_VERSION" ]]; then
  if [[ "$CARGO_VERSION" == "$SEED_VERSION" ]]; then
    ok "methodology crate v$CARGO_VERSION matches migration 0030 seed"
  else
    fail "methodology crate v$CARGO_VERSION ≠ migration seed v$SEED_VERSION (engine would refuse to start)"
  fi
else
  skip "could not parse methodology version (cargo=$CARGO_VERSION seed=$SEED_VERSION)"
fi

# ──────────────────────────────────────────────────────────────────────
# Summary
echo ""
printf "%s════════════════════════════════════════════════════════════════%s\n" "$BLD" "$RST"
printf "%sSUMMARY%s\n" "$BLD" "$RST"
printf "%s════════════════════════════════════════════════════════════════%s\n" "$BLD" "$RST"

PASS_COUNT="$(grep -c '^PASS' "$RESULTS_FILE" || true)"
FAIL_COUNT="$(grep -c '^FAIL' "$RESULTS_FILE" || true)"
SKIP_COUNT="$(grep -c '^SKIP' "$RESULTS_FILE" || true)"
TOTAL_COUNT="$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))"

printf "  %s%d passed%s · %s%d failed%s · %s%d skipped%s  (of %d)\n" \
  "$GRN" "$PASS_COUNT" "$RST" \
  "$RED" "$FAIL_COUNT" "$RST" \
  "$YEL" "$SKIP_COUNT" "$RST" \
  "$TOTAL_COUNT"

if [[ "$FAIL_COUNT" -gt "0" ]]; then
  echo ""
  printf "  %sFAILED GATES:%s\n" "$RED" "$RST"
  grep '^FAIL' "$RESULTS_FILE" | cut -f2 | sed 's/^/    - /'
  echo ""
  printf "%sDEPLOY MUST NOT PROCEED.%s Fix the failures above and re-run.\n" "$BLD$RED" "$RST"
  exit 1
fi

if [[ "$SKIP_COUNT" -gt "0" ]]; then
  echo ""
  printf "  %sSKIPPED GATES (resolve before public launch):%s\n" "$YEL" "$RST"
  grep '^SKIP' "$RESULTS_FILE" | cut -f2 | sed 's/^/    - /'
fi

echo ""
printf "%sALL REQUIRED GATES PASSED.%s Deploy may proceed per the relevant one-pager:\n" "$BLD$GRN" "$RST"
echo "  - 06-01 dogfood: docs/operations/deploy-2026-06-01.md"
echo "  - 06-11 public:  docs/operations/deploy-2026-06-11.md"
exit 0
