#!/usr/bin/env bash
# Secret scan — gitleaks over the working tree AND the full git history.
#
# WHY A SCRIPT AND NOT A WORKFLOW: GitHub Actions was billing-dead for this
# account from ~2026-07-23 until 2026-10-16; it stayed a script because it must
# also run before deploys and from cron, independent of CI availability.
# This is the same two-pass scan solana-foundation/tokens runs in CI, reduced to
# what it actually is: a pinned binary plus two commands. Run it before a deploy,
# from a cron, or from a pre-push hook.
#
# The history pass is the one that matters. A credential removed in the latest
# commit is still in the pack files, and still exfiltratable by anyone who
# clones — a working-tree-only scan reports clean while the secret is live.
#
# SCOPE IS VERSIONED CONTENT ONLY. A first cut scanned the whole directory and
# chewed through 31 GB of node_modules/target in 4 minutes to report 76
# "findings", every one of them a dependency's test fixture. Untracked local
# files cannot leak to anyone; committed ones can. `gitleaks git` walks exactly
# the commit graph, so it is both the correct scope and ~100x faster.
# Tracked-but-forbidden files (a committed `.env`) are a separate concern and are
# caught by `cargo xtask hygiene`.
#
# Usage:
#   scripts/secret-scan.sh            # full history (the meaningful pass)
#   scripts/secret-scan.sh --staged   # staged changes only (for a pre-commit hook)
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "not inside a git repository" >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

# Pinned: an unpinned scanner silently changes what "clean" means between runs.
GITLEAKS_VERSION="8.24.2"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pegana-gitleaks/${GITLEAKS_VERSION}"
BIN="${CACHE_DIR}/gitleaks"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'

ensure_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    local have
    have="$(gitleaks version 2>/dev/null | tr -d 'v[:space:]')"
    if [ "$have" = "$GITLEAKS_VERSION" ]; then
      BIN="$(command -v gitleaks)"
      return 0
    fi
    printf "%s· system gitleaks is %s, want %s — using a pinned local copy%s\n" \
      "$YEL" "${have:-unknown}" "$GITLEAKS_VERSION" "$RST"
  fi
  [ -x "$BIN" ] && return 0

  local os arch tarball url
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) echo "unsupported OS: $(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) echo "unsupported arch: $(uname -m)" >&2; return 1 ;;
  esac

  tarball="gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tarball}"
  mkdir -p "$CACHE_DIR" || return 1
  printf "· fetching gitleaks %s (%s/%s)\n" "$GITLEAKS_VERSION" "$os" "$arch"
  curl -sSfL "$url" -o "${CACHE_DIR}/${tarball}" || {
    echo "download failed: $url" >&2
    return 1
  }
  tar -xzf "${CACHE_DIR}/${tarball}" -C "$CACHE_DIR" gitleaks || return 1
  rm -f "${CACHE_DIR}/${tarball}"
  chmod +x "$BIN"
}

if ! ensure_gitleaks; then
  printf "%s✗ could not obtain gitleaks — scan NOT run%s\n" "$RED" "$RST" >&2
  exit 1
fi

failed=0

if [ "${1:-}" = "--staged" ]; then
  printf "\n=== secret scan · staged changes ===\n"
  if "$BIN" protect --staged --redact --no-banner; then
    printf "%s✓ staged changes clean%s\n" "$GRN" "$RST"
  else
    printf "%s✗ findings in staged changes — do not commit%s\n" "$RED" "$RST"
    failed=1
  fi
else
  printf "\n=== secret scan · full git history ===\n"
  # A secret deleted in HEAD still lives in the pack files. This is the pass
  # that catches it.
  if "$BIN" git . --redact --no-banner; then
    printf "%s✓ history clean%s\n" "$GRN" "$RST"
  else
    printf "%s✗ findings in git history%s\n" "$RED" "$RST"
    printf "  A finding here means the secret is STILL RECOVERABLE from any clone.\n"
    printf "  Rotating the credential is mandatory; rewriting history is optional and\n"
    printf "  does not un-leak anything already fetched.\n"
    failed=1
  fi
fi

printf "\n"
if [ "$failed" -ne 0 ]; then
  printf "%s✗ secret scan FAILED%s\n" "$RED" "$RST"
  printf "  Verified false positives go in .gitleaksignore as an exact\n"
  printf "  commit:path:rule:line fingerprint. Never ignore a whole rule or file.\n"
  exit 1
fi
printf "%s✓ secret scan passed%s\n" "$GRN" "$RST"
