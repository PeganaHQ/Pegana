#!/usr/bin/env bash
# Hermetic tests for scripts/mirror-public.sh: exclude parsing, the leak grep,
# and a guard that no public doc links into a withheld path. No network.
#
# Run: bash scripts/tests/mirror-public.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mirror-public-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; failed=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }
refute() { local desc="$1"; shift; if "$@"; then bad "$desc"; else ok "$desc"; fi; }

MIRROR_PUBLIC_SOURCE_ONLY=1 source "$ROOT/scripts/mirror-public.sh"

# --- exclude parsing -----------------------------------------------------
printf '# comment\n\n  docs/a/  \nfoo/*.md   # trailing\nexact.md\n' > "$WORK/ex"
parsed="$(read_excludes "$WORK/ex" | tr '\n' '|')"
check "comments, blanks and trailing space stripped" test "$parsed" = 'docs/a/|foo/*.md|exact.md|'

EXCLUDES=()
while IFS= read -r l; do EXCLUDES+=("$l"); done < <(read_excludes "$ROOT/scripts/mirror-public.exclude")
check "exclude file is non-empty" test "${#EXCLUDES[@]}" -gt 0

for p in PR_BODY.md CLAUDE.md docs/superpowers/plans/x.md docs/design-research/a/b.md \
         docs/design-research/x-rebrand-MAP.md docs/operations/deploy.md docs/archive/z.md \
         docs/security/audit-2026-05-26.md docs/security/audit-2026-05-26-resolution.md \
         docs/ops/2026-10-21-launch-r1-runbook.md docs/ops/lst-cleanup/a.sql \
         docs/landing-remake-spec.md docs/landing-remake-references.md docs/verification-2026-10-18.md; do
  check "excluded: $p" is_excluded "$p"
done
for p in README.md web/CLAUDE.md docs/ops/deploy.md docs/runbooks/oncall.md docs/security/rustsec-waivers.md \
         docs/security/2026-10-21-dependency-audit.md docs-site/introduction.mdx docs/adr/0001-x.md \
         sub/PR_BODY.md docs/operations-notes.md; do
  refute "kept: $p" is_excluded "$p"
done

# --- leak grep -------------------------------------------------------------
# Needles are assembled at run time so this file never matches itself.
u='/Use'; u+='rs/someone/x'
ip='2.24.'; ip+='79.64'
nick='rafi'; nick+='nha'
mail='raffx'; mail+='web3@example.com'
tok='123456789:'; tok+='AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawX'
chat='-100'; chat+='2233445566'

new_tree() { rm -rf "$WORK/t"; mkdir -p "$WORK/t/docs" "$WORK/t/crates/x/tests"; printf 'clean\n' > "$WORK/t/docs/a.md"; }
scan() { leak_scan "$WORK/t" >"$WORK/out" 2>&1; }

new_tree
check "clean tree passes" scan
for pair in "home path|$u" "prod ip|$ip" "nickname|$nick" "email|$mail" "bot token|$tok" "real chat id|$chat"; do
  new_tree; printf 'value: %s\n' "${pair#*|}" > "$WORK/t/docs/leak.md"
  refute "leak caught: ${pair%%|*}" scan
done
new_tree; printf 'chat_id=%s\n' "$chat" > "$WORK/t/crates/x/tests/fixture.rs"
check "chat id inside a tests/ fixture allowed" scan
new_tree; printf 'chat_id: -1001234567890 and chat_id=1234567890\n' > "$WORK/t/docs/ex.md"
check "placeholder chat ids allowed" scan
new_tree; printf 'chat_id=%s\n' "$chat" > "$WORK/t/docs/ex.md"
refute "same chat id outside tests fails" scan
new_tree; printf 'clean\n' > "$WORK/t/docs/ok.md"; printf '%s\n' "$nick" > "$WORK/t/crates/x/tests/t.rs"
refute "name leak is NOT exempt inside tests/" scan

# A leak inside a binary file is still a leak (no -I).
new_tree; printf 'bin\000\001 %s \000\n' "$nick" > "$WORK/t/docs/blob.bin"
refute "leak inside a binary file caught" scan

# --- leak grep fails closed on a grep error ----------------------------------
# grep exit 2 (unreadable file, bad pattern, ...) used to read as "no hits".
grep() { return 2; }
new_tree
refute "grep error (exit 2) fails the gate" scan
unset -f grep
check "grep error is reported" grep -q "FATAL: leak grep failed (exit 2)" "$WORK/out"
check "gate passes again once grep works" scan
missing_dir_scan() { leak_scan "$WORK/does-not-exist" >"$WORK/out" 2>&1; }
refute "missing scan dir fails the gate" missing_dir_scan

# --- empty-dir pruning never touches .git -------------------------------------
rm -rf "$WORK/p"; mkdir -p "$WORK/p/.git/refs/tags" "$WORK/p/.git/objects/info" \
  "$WORK/p/a/b/c" "$WORK/p/keep"
printf 'x\n' > "$WORK/p/keep/f"
prune_empty_dirs "$WORK/p"
check "empty dirs inside .git kept" test -d "$WORK/p/.git/refs/tags" -a -d "$WORK/p/.git/objects/info"
check "nested empty dirs removed" test ! -e "$WORK/p/a"
check "non-empty dir kept" test -f "$WORK/p/keep/f"

# --- no public doc links into a withheld path -------------------------------
if command -v python3 >/dev/null 2>&1 && git -C "$ROOT" rev-parse >/dev/null 2>&1; then
  broken="$(cd "$ROOT" && EXFILE="$ROOT/scripts/mirror-public.exclude" python3 - <<'PY'
import fnmatch, os, re, subprocess
ex = []
for l in open(os.environ["EXFILE"]):
    l = l.split("#", 1)[0].strip()
    if l: ex.append(l)
def excl(p):
    return any(p == e or (e.endswith("/") and p.startswith(e)) or ("*" in e and fnmatch.fnmatchcase(p, e)) for e in ex)
files = [f for f in subprocess.check_output(["git", "ls-files"], text=True).split("\n") if f]
fs = set(files)
for f in files:
    if excl(f) or not f.endswith((".md", ".mdx")):
        continue
    try:
        t = open(f, errors="ignore").read()
    except OSError:
        continue
    for m in re.finditer(r"\]\(([^)\s]+)", t):
        u = m.group(1).split("#")[0]
        if not u or re.match(r"[a-z]+:", u) or u.startswith("/"):
            continue
        r = os.path.normpath(os.path.join(os.path.dirname(f), u))
        if r in fs and excl(r):
            print(f + " -> " + r)
PY
)"
  if [[ -z "$broken" ]]; then ok "no kept doc links into a withheld path"; else bad "kept docs link into withheld paths:"; printf '%s\n' "$broken"; fi
else
  echo "  skip link guard (python3 or git missing)"
fi

echo
if (( failed == 0 )); then echo "mirror-public: $pass passed"; exit 0; fi
echo "mirror-public: $failed failed, $pass passed"; exit 1
