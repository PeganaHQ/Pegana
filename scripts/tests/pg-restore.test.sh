#!/usr/bin/env bash
# Hermetic tests for scripts/pg-restore.sh.
#
# Stubs `docker` (psql / pg_restore / cp / rm) and `rclone` on PATH and
# records every postgres call, so the tests can assert the restore sequence
# (version-pinned CREATE EXTENSION, pre_restore, pg_restore, post_restore,
# ALTER EXTENSION UPDATE) without a database.
#
# Run: bash scripts/tests/pg-restore.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/pg-restore.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pg-restore-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; failed=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
joined="$*"
case "$joined" in
  "compose cp "*) exit 0 ;;
  *" rm -f /tmp/pg-restore.dump"*) exit 0 ;;
  *"pg_restore --list"*) exit 0 ;;
  *"pg_restore -U"*) [[ -n "${STUB_RESTORE_FAIL:-}" ]] && { echo "pg_restore: error: boom"; exit 1; }; exit 0 ;;
  *"pg_available_extension_versions"*) [[ -n "${STUB_NO_VERSION:-}" ]] || echo 1 ;;
  *"FROM pg_database"*) [[ -n "${STUB_DB_EXISTS:-}" ]] && echo 1; exit 0 ;;
  *"extversion FROM pg_extension"*) echo "${STUB_INSTALLED:-2.29.0}" ;;
  *psql*) exit 0 ;;
  *) echo "docker stub: unexpected $*" >&2; exit 99 ;;
esac
STUB
cat > "$WORK/bin/rclone" <<'STUB'
#!/usr/bin/env bash
map() { local p="${1#*:}"; printf '%s/%s' "$STUB_REMOTE_DIR" "$p"; }
sub="$1"; shift
case "$sub" in
  copyto) src=$(map "$1"); [[ -f "$src" ]] || exit 3; cp "$src" "$2" ;;
  lsf) for a in "$@"; do last="$a"; done; ls "$(map "$last")" | grep -E '\.dump\.enc$' ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$WORK/bin/docker" "$WORK/bin/rclone"

H="$WORK/home"
mkdir -p "$H/pegana" "$H/backups" "$H/remote/pegana-backups"
printf 'POSTGRES_USER=pegana\nPOSTGRES_DB=pegana\nPOSTGRES_PASSWORD=pw\n' > "$H/pegana/.env"
printf 'R2_BUCKET=pegana-backups\n' > "$H/.pegana-r2-creds.env"
openssl rand -base64 32 > "$H/.pegana-backup-key"

make_backup() { # make_backup DIR NAME TSDB_VERSION
  local f="$1/$2"
  { printf 'PGDMP'; head -c 4096 /dev/zero; } \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass "file:$H/.pegana-backup-key" > "$f"
  printf '%s  %s\n' "$( { sha256sum "$f" 2>/dev/null || shasum -a 256 "$f"; } | cut -d' ' -f1)" "$2" > "$f.sha256"
  printf 'name=%s\npostgres_version=16.14\ntimescaledb_version=%s\n' "$2" "$3" > "$f.meta"
}
LOCAL=pegana-20261020T120000Z.dump.enc
REMOTE=pegana-20261019T060000Z.dump.enc
make_backup "$H/backups" "$LOCAL" 2.29.0
make_backup "$H/remote/pegana-backups" "$REMOTE" 2.29.0

run_restore() {
  : > "$WORK/docker.log"
  env -i PATH="$WORK/bin:$PATH" HOME="$H" TMPDIR="$WORK" STUB_REMOTE_DIR="$H/remote" \
    STUB_LOG="$WORK/docker.log" "${ENVS[@]}" bash "$SCRIPT" "$@" >"$WORK/out.log" 2>&1 </dev/null
}
ENVS=()
line_of() { grep -n -- "$1" "$WORK/docker.log" | head -1 | cut -d: -f1; }

echo "list"
run_restore list; rc=$?
check "exit 0" test "$rc" -eq 0
check "shows local backup" grep -q "^local  $LOCAL$" "$WORK/out.log"
check "shows r2 backup" grep -q "^r2     $REMOTE$" "$WORK/out.log"

echo "restore local backup into a drill DB"
run_restore restore "$LOCAL" --into pegana_restore_drill; rc=$?
check "exit 0" test "$rc" -eq 0
check "checksum verified" grep -q "Checksum OK" "$WORK/out.log"
check "creates DB" grep -q 'CREATE DATABASE "pegana_restore_drill"' "$WORK/docker.log"
check "pins extension to dump version" grep -q "CREATE EXTENSION IF NOT EXISTS timescaledb VERSION '2.29.0'" "$WORK/docker.log"
a=$(line_of timescaledb_pre_restore); b=$(line_of "pg_restore -U"); c=$(line_of timescaledb_post_restore); d=$(line_of "ALTER EXTENSION timescaledb UPDATE")
check "order: pre_restore < pg_restore < post_restore < ALTER UPDATE" test -n "$a" -a -n "$b" -a -n "$c" -a -n "$d" -a "$a" -lt "$b" -a "$b" -lt "$c" -a "$c" -lt "$d"
check "sequential restore (-j 1)" grep -q -- "-j 1" "$WORK/docker.log"
check "no aws CLI call" bash -c "! grep -q aws '$WORK/docker.log'"
check "temp workdir cleaned" test "$(find "$WORK" -maxdepth 1 -name 'pegana-restore.*' | wc -l | tr -d ' ')" -eq 0

echo "restore a name that only exists in R2"
run_restore restore "$REMOTE" --into pegana_restore_drill2; rc=$?
check "exit 0" test "$rc" -eq 0
check "downloaded via rclone" grep -q "Downloading r2:pegana-backups/$REMOTE" "$WORK/out.log"

echo "fetch"
run_restore fetch "$REMOTE"; rc=$?
check "exit 0" test "$rc" -eq 0
check "fetched into backup dir with sidecars" test -f "$H/backups/$REMOTE" -a -f "$H/backups/$REMOTE.meta"
rm -f "$H/backups/$REMOTE" "$H/backups/$REMOTE".*

echo "checksum mismatch"
cp "$H/backups/$LOCAL" "$WORK/tampered.dump.enc"; printf 'x' >> "$WORK/tampered.dump.enc"
cp "$H/backups/$LOCAL.sha256" "$WORK/tampered.dump.enc.sha256"
run_restore restore "$WORK/tampered.dump.enc" --into pegana_x; rc=$?
check "exit 3" test "$rc" -eq 3
check "never touched postgres" bash -c "! grep -q 'CREATE DATABASE' '$WORK/docker.log'"

echo "wrong key"
cp "$H/.pegana-backup-key" "$WORK/key.bak"; openssl rand -base64 32 > "$H/.pegana-backup-key"
run_restore restore "$LOCAL" --into pegana_x; rc=$?
check "exit 3" test "$rc" -eq 3
cp "$WORK/key.bak" "$H/.pegana-backup-key"

echo "TimescaleDB version not installable"
ENVS=(STUB_NO_VERSION=1)
run_restore restore "$LOCAL" --into pegana_x; rc=$?
check "exit 7" test "$rc" -eq 7
check "points to scratch-container procedure" grep -q "timescale/timescaledb:2.29.0-pg16" "$WORK/out.log"
check "did not create DB" bash -c "! grep -q 'CREATE DATABASE' '$WORK/docker.log'"
ENVS=()

echo "existing target DB"
ENVS=(STUB_DB_EXISTS=1)
run_restore restore "$LOCAL" --into pegana_exists; rc=$?
check "exit 5" test "$rc" -eq 5
ENVS=()

echo "pg_restore failure still re-enables triggers"
ENVS=(STUB_RESTORE_FAIL=1)
run_restore restore "$LOCAL" --into pegana_y; rc=$?
check "non-zero exit" test "$rc" -ne 0
check "post_restore ran" grep -q timescaledb_post_restore "$WORK/docker.log"
check "no ALTER UPDATE after failed restore" bash -c "! grep -q 'ALTER EXTENSION' '$WORK/docker.log'"
ENVS=()

echo "prod target with mismatched installed version"
ENVS=(STUB_INSTALLED=2.30.0)
run_restore restore "$LOCAL"; rc=$?
check "exit 7 before the confirmation prompt" test "$rc" -eq 7
ENVS=()

echo "prod target, confirmation not given"
run_restore restore "$LOCAL"; rc=$?
check "exit 4 (aborted)" test "$rc" -eq 4
check "no restore ran" bash -c "! grep -q 'pg_restore -U' '$WORK/docker.log'"

echo
echo "pg-restore tests: $pass passed, $failed failed"
(( failed == 0 ))
