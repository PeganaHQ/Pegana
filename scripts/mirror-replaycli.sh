#!/usr/bin/env bash
#
# mirror-replaycli.sh — push the public mirror by hand.
#
# WHY THIS EXISTS
#   .github/workflows/sync-pegana-replay.yml is the normal path, but GitHub
#   Actions on the PRIVATE repo is currently blocked (every run dies in <10s
#   with a 0-step job — a billing/spending-limit failure, not a broken test).
#   Every sync run since 2026-07-25 has failed, which means merging to main
#   silently does NOT update PeganaHQ/ReplayCLI. This script does the same
#   assembly locally so the mirror can still ship.
#
#   Delete it once Actions billing is restored and the workflow runs green.
#
# EQUIVALENCE TO THE WORKFLOW
#   The workflow uses `git subtree split` to get a commit, then throws the
#   commit away and reads only its TREE. `git rev-parse HEAD:<path>` yields
#   that identical tree directly, in milliseconds instead of minutes on a repo
#   this size. Everything else — empty index, per-prefix read-tree, assets.toml
#   blob overlay, tools/ overlay with the release.yml relocation, commit-tree
#   chained onto the public HEAD, force-push — matches step for step.
#
# SAFETY
#   Refuses to build a parentless commit unless the remote genuinely has no
#   main. A root commit here would erase the mirror's history on force-push;
#   that exact hazard is why the workflow's snapshot step was rewritten.
#
# USAGE
#   ./scripts/mirror-replaycli.sh --dry-run   # assemble + diff, push nothing
#   ./scripts/mirror-replaycli.sh             # assemble + push
#
set -euo pipefail

REMOTE="https://github.com/PeganaHQ/ReplayCLI.git"
PREFIXES=(crates/common-verify crates/methodology crates/pegana-replay-cli)
OVERLAY_DIR="tools/pegana-replay-public"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

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
  printf 'Subtree assembly from lrafasouza/pegana@%s.\n\n' "$(git rev-parse HEAD)"
  printf 'Recent private commits reflected here:\n'
  git log -n 10 --oneline -- assets.toml "${PREFIXES[@]}" | sed 's/^/    /'
  printf '\nMirror of the closed sibling repo. Do not edit ReplayCLI directly —\n'
  printf 'every sync force-overwrites the branch.\n'
} > "$msg"

COMMIT="$(git commit-tree "$TREE" "${parent_arg[@]+${parent_arg[@]}}" < "$msg")"
git push --force "$REMOTE" "${COMMIT}:refs/heads/main"
echo
echo "Pushed ${COMMIT:0:8} → PeganaHQ/ReplayCLI@main"
