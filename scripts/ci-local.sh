#!/usr/bin/env bash
#
# The CI gauntlet, run locally.
#
# WHY THIS EXISTS
# ---------------
# GitHub Actions is blocked on billing: jobs abort in ~3s with
#
#   "The job was not started because recent account payments have failed or
#    your spending limit needs to be increased."
#
# Every check `.github/workflows/ci.yml` performs is reproducible on this
# machine — none of them needs a hosted runner. So this script mirrors that
# workflow job-for-job, and its exit code is the same signal a green tick was.
# When billing is restored this stays useful as the pre-push check.
#
# WHAT IT DOES NOT COVER
# ----------------------
# The workspace's DB/Redis integration tests self-skip unless
# PEGANA_INTEGRATION_* is set (see CLAUDE.md), exactly as they do on CI, which
# also runs them unset. Bringing up the prod-shaped stack is a separate,
# heavier check: docker compose -f docker-compose.local.yml up -d.
#
# Usage:
#   scripts/ci-local.sh            # everything
#   scripts/ci-local.sh web        # one section: web | rust | ts | audit | assets

set -uo pipefail
cd "$(dirname "$0")/.."

ONLY="${1:-all}"
FAILED=()
PASSED=()

run() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then
    PASSED+=("$name")
  else
    FAILED+=("$name")
    printf '\033[31m  ✗ %s\033[0m\n' "$name"
  fi
}

want() { [[ "$ONLY" == "all" || "$ONLY" == "$1" ]]; }

# ── Rust workspace ───────────────────────────────────────────────────────────
# Mirrors the `rust` job. Runtime sqlx::query() (not the compile-time macros) is
# used almost everywhere, so none of this needs a database.
if want rust; then
  run "rust · fmt"    cargo fmt --all -- --check
  run "rust · clippy" cargo clippy --workspace --all-targets -- -D warnings
  run "rust · check"  cargo check --workspace --all-targets
  run "rust · test"   cargo test --workspace --all-targets
fi

# ── assets.toml against mainnet ──────────────────────────────────────────────
# This is the one job currently red on GitHub, and it is red for billing, not
# for content: it passes here at 72 checked / 0 failed.
if want assets; then
  run "assets · verify vs mainnet RPC" cargo xtask verify-assets --file assets.toml --strict
fi

# ── TypeScript services ──────────────────────────────────────────────────────
ts_pkg() {
  local dir="$1"; shift
  ( cd "$dir" && for s in "$@"; do bun run "$s" || exit 1; done )
}
if want ts; then
  run "mcp-ts"             ts_pkg mcp-ts typecheck test
  run "protocol-indexer"   ts_pkg protocol-indexer-ts typecheck lint test
fi

# ── Web ──────────────────────────────────────────────────────────────────────
# NEVER `next build` or `next dev` here: both have crashed this machine (CLAUDE.md).
# Typecheck + unit tests are what the CI job runs too; e2e goes against a
# deployed preview via PLAYWRIGHT_EXTERNAL_TARGET=1.
if want web; then
  run "web" ts_pkg web typecheck lint test
fi

# ── Dependency audits ────────────────────────────────────────────────────────
if want audit; then
  command -v cargo-audit >/dev/null 2>&1 \
    && run "cargo audit" cargo audit \
    || printf '\n\033[33m▸ cargo audit — skipped (cargo-audit not installed)\033[0m\n'
  # Mirror ci.yml's flags EXACTLY, per package. A plain `bun audit` also walks
  # devDependencies and every severity, which fails on an eslint-transitive
  # js-yaml advisory that CI deliberately does not gate on. A local mirror that
  # is stricter than the real thing reports failures nobody can act on, and gets
  # ignored — the same way the e2e suite that never rendered the onboarding
  # modal got trusted.
  run "bun audit · web"              bash -c 'cd web && bun audit --prod --audit-level=high'
  # ci.yml:197 pins this one to `|| true` until the advisory clears upstream.
  run "bun audit · protocol-indexer" bash -c 'cd protocol-indexer-ts && bun audit --prod --audit-level=high || true'
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n\033[1m═══ ci-local summary ═══\033[0m\n'
for p in "${PASSED[@]:-}";  do [[ -n "$p" ]] && printf '  \033[32m✓\033[0m %s\n' "$p"; done
for f in "${FAILED[@]:-}";  do [[ -n "$f" ]] && printf '  \033[31m✗\033[0m %s\n' "$f"; done
printf '  %d passed, %d failed\n' "${#PASSED[@]}" "${#FAILED[@]}"
[[ ${#FAILED[@]} -eq 0 ]]
