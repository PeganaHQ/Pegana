#!/usr/bin/env bash
#
# mirror-public.sh - publish the public mirror (github.com/PeganaHQ/Pegana).
#
# WHAT IT DOES
#   1. `git archive` of a private commit (default HEAD, must be committed).
#   2. Stage it in a local clone of PeganaHQ/Pegana on a new sync/<date>-<n>
#      branch, minus every pattern in scripts/mirror-public.exclude. Files
#      that are tracked but gitignored are force-added.
#   3. Pin Cargo.toml `repository` to the public URL.
#   4. Gates, all fail-closed: scripts/tests/public-docs-redaction.test.sh on
#      the staged tree, then a leak grep (see LEAK_PATTERNS).
#   5. One commit by the PeganaHQ noreply identity, push the sync/* branch,
#      open a PR with `gh pr create`. Merge stays a human step.
#
# SAFETY
#   --dry-run is the DEFAULT: it clones, stages, gates and prints the diff
#   stat, and pushes nothing. A real run needs --apply. The script only ever
#   pushes refs/heads/sync/*; it refuses any other target, never force-pushes
#   and never touches main.
#
# USAGE
#   scripts/mirror-public.sh                # dry run (default)
#   scripts/mirror-public.sh --apply        # branch + PR
#   scripts/mirror-public.sh --sha <rev>    # mirror a specific committed rev
#   scripts/mirror-public.sh --keep         # keep the staging clone
#   Env: MIRROR_REMOTE (clone/push URL), MIRROR_SLUG (gh repo).
#
# See docs/runbooks/public-mirror-sync.md.

set -euo pipefail

REMOTE="${MIRROR_REMOTE:-https://github.com/PeganaHQ/Pegana.git}"
SLUG="${MIRROR_SLUG:-PeganaHQ/Pegana}"
PUBLIC_REPO_URL="https://github.com/PeganaHQ/Pegana"
AUTHOR_NAME="PeganaHQ"
AUTHOR_EMAIL="69092895+lrafasouza@users.noreply.github.com"

# Extended regexes (grep -E, case-insensitive). Any hit outside a test fixture
# fails the run.
# A one-character class ([s], [4], ...) keeps this file from matching itself.
LEAK_PATTERNS=(
  '/User[s]/'
  '2\.24\.79\.6[4]'
  'rafin[h]a'
  'raffxweb[3]'
  '[0-9]{8,10}:[A-Za-z0-9_-]{35}'   # Telegram bot token
)
# Telegram chat ids (negative supergroup ids or 9+ digit ids after chat_id).
CHAT_ID_PATTERN='(chat_?id["'"'"' :=]+-?[0-9]{9,}|-100[0-9]{7,})'
# Placeholder ids that are fine to publish.
CHAT_ID_ALLOWED='1234567890|123456789|1001234567890|999888777'
# Paths treated as test fixtures for the chat id check only.
is_fixture_path() {
  case "$1" in
    */tests/*|*/test/*|*/__tests__/*|*/fixtures/*|*.test.*|*.spec.*|*_test.*) return 0 ;;
  esac
  return 1
}

# --- exclude parsing -------------------------------------------------------

# Print the patterns of an exclude file: comments and blanks stripped.
read_excludes() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && printf '%s\n' "$line"
  done < "$1"
}

# is_excluded <relative-path> <patterns-file-or-newline-list-in-EXCLUDES>
# Uses the global array EXCLUDES.
is_excluded() {
  local path="$1" pat
  for pat in "${EXCLUDES[@]}"; do
    if [[ "$pat" == */ ]]; then
      [[ "$path" == "$pat"* ]] && return 0
    else
      # shellcheck disable=SC2254
      case "$path" in $pat) return 0 ;; esac
    fi
  done
  return 1
}

# --- leak scan ---------------------------------------------------------------

# grep_tree <dir> <pattern>: print every matching line under <dir> (.git
# excluded). Binaries are scanned as text (-a): a secret inside a binary is
# still a leak. Exit status is fail-closed: grep's 0 (hits) and 1 (no hits)
# are fine, anything else (2 = an unreadable file, a bad pattern, ...) is
# reported and returns 2, so an error can never pass as "no hits".
grep_tree() {
  local dir="$1" pat="$2" rc=0
  cd "$dir" 2>/dev/null || { echo "FATAL: leak scan cannot enter $dir" >&2; return 2; }
  grep -rniaE --exclude-dir=.git -e "$pat" . || rc=$?
  if (( rc > 1 )); then
    echo "FATAL: leak grep failed (exit $rc) for pattern: $pat" >&2
    return 2
  fi
  return 0
}

# leak_scan <dir>: print findings, return non-zero if any or if a grep fails.
leak_scan() {
  local dir="$1" found=0 pat hit path rest val hits
  for pat in "${LEAK_PATTERNS[@]}"; do
    hits="$(grep_tree "$dir" "$pat")" || { found=1; continue; }
    while IFS= read -r hit; do
      [[ -n "$hit" ]] || continue
      printf '  LEAK %s\n' "$(printf '%s' "$hit" | cut -c1-200)"
      found=1
    done <<< "$hits"
  done
  hits="$(grep_tree "$dir" "$CHAT_ID_PATTERN")" || { found=1; hits=""; }
  while IFS= read -r hit; do
    [[ -n "$hit" ]] || continue
    path="${hit%%:*}"
    is_fixture_path "$path" && continue
    rest="${hit#*:}"; rest="${rest#*:}"
    # Every id on the line must be an allowed placeholder.
    local bad=0
    while IFS= read -r val; do
      val="${val//[^0-9-]/}"
      val="${val#-}"
      [[ "$val" =~ ^(${CHAT_ID_ALLOWED})$ ]] || bad=1
    done < <(printf '%s\n' "$rest" | grep -oE "$CHAT_ID_PATTERN")
    if (( bad )); then
      printf '  LEAK chat id %s\n' "$(printf '%s' "$hit" | cut -c1-200)"
      found=1
    fi
  done <<< "$hits"
  return "$found"
}

# prune_empty_dirs <dir>: remove empty directories under <dir>, never
# touching <dir>/.git. `find -prune ... -delete` does not work: -delete
# implies -depth, which disables -prune, so it removed empty dirs inside .git
# (refs/tags, objects/info, ...). Every non-.git dir is listed deepest first
# and rmdir'd best-effort: a dir that still holds anything stays, and a parent
# emptied by its children's rmdir goes in the same pass.
prune_empty_dirs() {
  local root="$1" d
  while IFS= read -r -d '' d; do
    rmdir "$d" 2>/dev/null || true
  done < <(find "$root" -mindepth 1 -depth -type d ! -path "$root/.git" ! -path "$root/.git/*" -print0)
}

# Sourced by the test: define the functions only.
if [[ "${MIRROR_PUBLIC_SOURCE_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# --- main --------------------------------------------------------------------

APPLY=0
KEEP=0
REV="HEAD"
while (( $# )); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --keep) KEEP=1 ;;
    --sha) REV="${2:?--sha needs a revision}"; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
SHA="$(git rev-parse --verify "${REV}^{commit}")"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "FATAL: working tree is dirty. The mirror must reflect a committed state." >&2
  exit 1
fi

EXCLUDES=()
while IFS= read -r line; do EXCLUDES+=("$line"); done < <(read_excludes "$ROOT/scripts/mirror-public.exclude")
(( ${#EXCLUDES[@]} > 0 )) || { echo "FATAL: scripts/mirror-public.exclude is empty" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/mirror-public.XXXXXX")"
cleanup() { (( KEEP )) || rm -rf "$WORK"; }
trap cleanup EXIT
CLONE="$WORK/clone"

echo "Mirroring ${SHA:0:12} -> $SLUG ($([[ $APPLY == 1 ]] && echo APPLY || echo dry-run))"

# An unreachable remote must abort: never build a parentless tree.
git ls-remote --exit-code "$REMOTE" refs/heads/main >/dev/null \
  || { echo "FATAL: cannot reach $REMOTE or it has no main" >&2; exit 1; }
git clone --quiet --branch main "$REMOTE" "$CLONE"
PARENT="$(git -C "$CLONE" rev-parse HEAD)"
echo "Public main @ ${PARENT:0:12}"

# Branch name: sync/<UTC date>-<n>, n = first unused for today.
DATE="$(date -u +%Y%m%d)"
n=1
while git ls-remote --exit-code "$REMOTE" "refs/heads/sync/${DATE}-${n}" >/dev/null 2>&1; do n=$((n + 1)); done
BRANCH="sync/${DATE}-${n}"
case "$BRANCH" in sync/*) ;; *) echo "FATAL: refusing non-sync branch $BRANCH" >&2; exit 1 ;; esac
git -C "$CLONE" checkout --quiet -b "$BRANCH"

# Replace the working tree with the archive of the private commit.
git -C "$CLONE" rm -rq --ignore-unmatch . >/dev/null
find "$CLONE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive --format=tar "$SHA" | tar -x -C "$CLONE"

removed=0
while IFS= read -r -d '' f; do
  rel="${f#"$CLONE"/}"
  if is_excluded "$rel"; then rm -f "$f"; removed=$((removed + 1)); fi
done < <(find "$CLONE" -path "$CLONE/.git" -prune -o -type f -print0)
prune_empty_dirs "$CLONE"
echo "Withheld $removed file(s) per scripts/mirror-public.exclude"

# Public repository URL in the workspace manifest.
if [[ -f "$CLONE/Cargo.toml" ]]; then
  sed -i.bak -E "s#^repository = \"https://github.com/[^\"]+\"#repository = \"${PUBLIC_REPO_URL}\"#" "$CLONE/Cargo.toml"
  rm -f "$CLONE/Cargo.toml.bak"
  grep -q "^repository = \"${PUBLIC_REPO_URL}\"" "$CLONE/Cargo.toml" \
    || { echo "FATAL: Cargo.toml repository line not pinned to $PUBLIC_REPO_URL" >&2; exit 1; }
fi

# -f: tracked-but-gitignored files must reach the mirror.
git -C "$CLONE" add -A -f .

echo "Gate 1: public-docs-redaction"
bash "$CLONE/scripts/tests/public-docs-redaction.test.sh" \
  || { echo "FATAL: redaction test failed on the staged tree" >&2; exit 1; }

echo "Gate 2: leak grep"
if ! leak_scan "$CLONE"; then
  echo "FATAL: leak grep found internal material in the staged tree" >&2
  exit 1
fi
echo "leak grep: clean"

echo
git -C "$CLONE" diff --cached --stat | tail -15
if git -C "$CLONE" diff --cached --quiet; then
  echo "Mirror is already identical to public main - nothing to push."
  exit 0
fi

if (( ! APPLY )); then
  echo
  echo "dry-run: nothing committed or pushed. Re-run with --apply."
  (( KEEP )) && echo "staging clone kept at $CLONE"
  exit 0
fi

msg="$WORK/msg"
{
  printf 'sync: mirror from private %s\n\n' "${SHA:0:12}"
  printf 'Tree assembled by scripts/mirror-public.sh from lrafasouza/pegana@%s,\n' "$SHA"
  printf 'minus scripts/mirror-public.exclude.\n'
} > "$msg"
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$CLONE" commit --quiet -F "$msg"

# Plain push of the sync branch only. No --force, never main.
git -C "$CLONE" push "$REMOTE" "refs/heads/${BRANCH}:refs/heads/${BRANCH}"

body="$WORK/body"
{
  printf 'Mirror sync from the private repository at %s.\n\n' "${SHA:0:12}"
  printf 'One commit on top of main (%s). Withheld per scripts/mirror-public.exclude.\n\n' "${PARENT:0:12}"
  printf 'Gates passed on the staged tree: public-docs-redaction, leak grep.\n\n'
  git -C "$CLONE" diff --stat "$PARENT" HEAD | tail -15 | sed 's/^/    /'
  printf '\nGenerated with [Claude Code](https://claude.com/claude-code)\n'
} > "$body"
PR_URL="$(gh pr create --repo "$SLUG" --base main --head "$BRANCH" \
  --title "sync: mirror from private ${SHA:0:12}" --body-file "$body")"
echo "Opened $PR_URL (merge is a human step)"
