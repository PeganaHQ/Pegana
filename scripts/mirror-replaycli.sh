#!/usr/bin/env bash
#
# mirror-replaycli.sh — push the public mirror by hand.
#
# WHY THIS EXISTS
#   PeganaHQ/ReplayCLI main is protected by rulesets (pull request required,
#   no non-fast-forward pushes, no deletion). The old flow force-pushed main
#   and is now rejected (GH013). This script ships the mirror the way the
#   rules allow: ONE normal commit chained on the public HEAD, pushed to a
#   fresh branch, opened as a PR, merged with a merge commit once checks pass.
#   No force-push, no tags, no ruleset bypass.
#
#   .github/workflows/sync-pegana-replay.yml implements the same flow in CI;
#   use this script when Actions on the private repo is unavailable (it has
#   been billing-blocked) or for an ad-hoc resync.
#
# TREE ASSEMBLY
#   `git rev-parse HEAD:<path>` yields the same tree `git subtree split` does,
#   in milliseconds. Empty index, per-prefix read-tree, assets.toml blob
#   overlay, tools/ overlay with the release.yml relocation, commit-tree
#   chained onto the public HEAD.
#
# SAFETY
#   Refuses to build a parentless commit unless the remote genuinely has no
#   main. Never force-pushes. Needs `gh` authenticated with access to
#   PeganaHQ/ReplayCLI (contents + pull requests write).
#
# USAGE
#   ./scripts/mirror-replaycli.sh --dry-run   # assemble + diff, push nothing
#   ./scripts/mirror-replaycli.sh             # branch + PR + wait + merge
#   ./scripts/mirror-replaycli.sh --allow-no-checks   # merge even if CI never registers
#   Merge happens only if every check passed/skipped; otherwise the PR stays open.
#
set -euo pipefail

REMOTE="https://github.com/PeganaHQ/ReplayCLI.git"
SLUG="PeganaHQ/ReplayCLI"
PREFIXES=(crates/common-verify crates/methodology crates/pegana-replay-cli)
OVERLAY_DIR="tools/pegana-replay-public"
DRY_RUN=0
ALLOW_NO_CHECKS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --allow-no-checks) ALLOW_NO_CHECKS=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "FATAL: working tree is dirty. The mirror must reflect a committed state," >&2
  echo "otherwise the public repo gets content that exists in no private commit." >&2
  exit 1
fi

export GIT_INDEX_FILE="$(mktemp -t mirror-index.XXXXXX)"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
rm -f "$GIT_INDEX_FILE"

echo "Assembling mirror tree from $(git rev-parse --short HEAD)"
git read-tree --empty
for p in "${PREFIXES[@]}"; do
  tree="$(git rev-parse "HEAD:$p")"
  git read-tree --prefix="$p/" "$tree"
  echo "  $p"
done

blob="$(git hash-object -w assets.toml)"
git update-index --add --cacheinfo 100644,"$blob",assets.toml
echo "  assets.toml"

while IFS= read -r -d '' src; do
  rel="${src#${OVERLAY_DIR}/}"
  if [[ "$rel" == "release.yml" ]]; then dst=".github/workflows/release.yml"; else dst="$rel"; fi
  b="$(git hash-object -w "$src")"
  git update-index --add --cacheinfo 100644,"$b","$dst"
  echo "  $rel → $dst"
done < <(find "$OVERLAY_DIR" -type f -print0)

TREE="$(git write-tree)"

# Determine the parent. An unreachable remote must ABORT, never degrade into a
# root commit — see the header.
parent_arg=()
if git ls-remote --exit-code "$REMOTE" refs/heads/main >/dev/null 2>&1; then
  git fetch --no-tags "$REMOTE" main >/dev/null 2>&1
  PARENT="$(git rev-parse FETCH_HEAD)"
  parent_arg=(-p "$PARENT")
  echo "Chaining onto public main @ ${PARENT:0:8}"
elif git ls-remote "$REMOTE" >/dev/null 2>&1; then
  PARENT=""
  echo "Remote has no main — first run, root commit"
else
  echo "FATAL: cannot reach $REMOTE. Refusing to build a parentless commit," >&2
  echo "which would erase the mirror's history on force-push." >&2
  exit 1
fi

if [[ -n "${PARENT:-}" ]]; then
  echo
  git diff --stat "$PARENT" "$TREE" || true
fi

if (( DRY_RUN )); then
  echo
  echo "--dry-run: nothing pushed. tree=$TREE"
  exit 0
fi

if [[ -n "${PARENT:-}" ]] && [[ "$(git rev-parse "${PARENT}^{tree}")" == "$TREE" ]]; then
  echo
  echo "Mirror is already identical to the public HEAD — nothing to push."
  exit 0
fi

msg="$(mktemp)"
{
  printf 'sync: mirror methodology + replay + assets\n\n'
  printf 'Tree assembled from lrafasouza/pegana@%s.\n\n' "$(git rev-parse HEAD)"
  printf 'Recent private commits reflected here:\n'
  git log -n 10 --oneline -- assets.toml "${PREFIXES[@]}" | sed 's/^/    /'
  printf '\nVerifier subset mirror of PeganaHQ/Pegana. Do not edit ReplayCLI directly.\n'
} > "$msg"

export GIT_AUTHOR_NAME="PeganaHQ" GIT_COMMITTER_NAME="PeganaHQ"
export GIT_AUTHOR_EMAIL="69092895+lrafasouza@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
COMMIT="$(git commit-tree "$TREE" "${parent_arg[@]+${parent_arg[@]}}" < "$msg")"

BRANCH="mirror/$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"
git push "$REMOTE" "${COMMIT}:refs/heads/${BRANCH}"

PR_BODY="$(mktemp)"
{
  printf 'Mirror sync from the private repository at %s.\n\n' "$(git rev-parse --short HEAD)"
  printf 'One commit chained on main (%s). Files changed:\n\n' "${PARENT:0:8}"
  git diff --stat "$PARENT" "$TREE" | sed 's/^/    /'
  printf '\n\xf0\x9f\xa4\x96 Generated with [Claude Code](https://claude.com/claude-code)\n'
} > "$PR_BODY"
PR_URL="$(gh pr create --repo "$SLUG" --base main --head "$BRANCH" \
  --title "sync: mirror methodology + replay + assets" --body-file "$PR_BODY")"
echo "Opened $PR_URL"

# Poll the PR's checks; merge ONLY when every check settled as pass/skipping.
# Fails closed: a failed/cancelled check, a 25-minute overall timeout, or no
# check registering within the 3-minute grace window leaves the PR open and
# exits non-zero (override: --allow-no-checks).
start=$SECONDS
while true; do
  elapsed=$(( SECONDS - start ))
  if buckets="$(gh pr checks "$PR_URL" --json bucket --jq '[.[].bucket] | join(" ")' 2>/dev/null)" && [[ -n "$buckets" ]]; then
    if [[ " $buckets " == *" fail "* || " $buckets " == *" cancel "* ]]; then
      gh pr checks "$PR_URL" || true
      echo "FATAL: a check failed; PR left open: $PR_URL" >&2; exit 1
    fi
    if [[ " $buckets " != *" pending "* ]]; then
      break  # every bucket is pass or skipping
    fi
  elif (( elapsed >= 180 )); then
    if (( ALLOW_NO_CHECKS )); then
      echo "No checks reported after 3 minutes; --allow-no-checks given, merging."
      break
    fi
    echo "FATAL: no checks reported within 3 minutes (use --allow-no-checks to override); PR left open: $PR_URL" >&2; exit 1
  fi
  if (( elapsed >= 1500 )); then
    echo "FATAL: checks did not settle within 25 minutes; PR left open: $PR_URL" >&2; exit 1
  fi
  sleep 20
done
gh pr merge "$PR_URL" --merge --delete-branch
echo "Merged $PR_URL → PeganaHQ/ReplayCLI@main"
