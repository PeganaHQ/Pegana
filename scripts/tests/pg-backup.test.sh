#!/usr/bin/env bash
# Hermetic tests for scripts/pg-backup.sh.
#
# Stubs `docker` (psql / pg_dump / pg_restore) and `rclone` on PATH, uses the
# real openssl, and runs the script against a throwaway HOME. Nothing here
# touches a real database, bucket or the network.
#
# Run: bash scripts/tests/pg-backup.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/pg-backup.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pg-backup-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; failed=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

# ─── stubs ───────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
# docker compose exec -T [-e K=V] postgres <cmd...>
args=("$@")
cmd=""
for a in "${args[@]}"; do
  case "$a" in
    psql|pg_dump|pg_restore) cmd="$a" ;;
  esac
done
case "$cmd" in
  psql)
    joined="$*"
    if [[ "$joined" == *"extversion"* ]]; then echo "2.29.0"
    elif [[ "$joined" == *"server_version"* ]]; then echo "16.14"
    fi ;;
  pg_dump)
    [[ -n "${STUB_PGDUMP_FAIL:-}" ]] && { echo "pg_dump: error" >&2; exit 1; }
    printf 'PGDMP'
    head -c 8192 /dev/zero | tr '\0' 'x' ;;
  pg_restore)
    [[ -n "${STUB_PGRESTORE_FAIL:-}" ]] && { cat >/dev/null; exit 1; }
    magic=$(head -c 5)
    cat >/dev/null
    [[ "$magic" == "PGDMP" ]] ;;
  *) echo "docker stub: unexpected $*" >&2; exit 99 ;;
esac
STUB
cat > "$WORK/bin/rclone" <<'STUB'
#!/usr/bin/env bash
# r2:<bucket>/<name>  ->  $STUB_REMOTE_DIR/<bucket>/<name>
map() { local p="${1#*:}"; printf '%s/%s' "$STUB_REMOTE_DIR" "$p"; }
sub="$1"; shift
[[ "${STUB_RCLONE_MODE:-ok}" == "deny" ]] && { echo "Failed to copyto: AccessDenied: Access Denied status code: 403" >&2; exit 1; }
case "$sub" in
  copyto) dst=$(map "$2"); mkdir -p "$(dirname "$dst")"; cp "$1" "$dst" ;;
  lsjson) f=$(map "$1"); [[ -f "$f" ]] || exit 3
          printf '[{"Path":"x","Size":%s}]\n' "$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")" ;;
  # A blind bulk delete must never be issued again (finding #46): log it so
  # the tests can assert it is absent.
  delete) echo "delete $*" >> "$STUB_REMOTE_DIR/delete.log" ;;
  deletefile)
    f=$(map "$1"); [[ -f "$f" ]] || exit 4
    rm -f "$f"; echo "${1#*:}" >> "$STUB_REMOTE_DIR/deletefile.log" ;;
  lsf)
    [[ -n "${STUB_RCLONE_LSF_FAIL:-}" ]] && { echo "lsf: error" >&2; exit 1; }
    rec=""; target=""
    for a in "$@"; do
      case "$a" in -R) rec=1 ;; *:*) target="$a" ;; esac
    done
    d=$(map "$target"); [[ -d "$d" ]] || { echo "directory not found" >&2; exit 3; }
    if [[ -n "$rec" ]]; then (cd "$d" && find . -type f | sed 's|^\./||')
    else find "$d" -maxdepth 1 -type f -exec basename {} \;
    fi ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$WORK/bin/docker" "$WORK/bin/rclone"

new_home() {
  local h="$WORK/home-$1"
  mkdir -p "$h/pegana" "$h/remote"
  printf 'POSTGRES_USER=pegana\nPOSTGRES_DB=pegana\nPOSTGRES_PASSWORD=pw\n' > "$h/pegana/.env"
  printf 'R2_BUCKET=pegana-backups\n' > "$h/.pegana-r2-creds.env"
  openssl rand -base64 32 > "$h/.pegana-backup-key"
  echo "$h"
}

run_backup() {
  local h="$1"; shift
  env -i PATH="$WORK/bin:$PATH" HOME="$h" STUB_REMOTE_DIR="$h/remote" \
    PEGANA_BACKUP_MIN_FREE_MB=1 "$@" bash "$SCRIPT" >"$h/out.log" 2>&1
}

metric() { awk -v m="$2" '$1 == m { print $2 }' "$1/.pegana-metrics/pegana_backup.prom"; }
count_dumps() { find "$1/backups" -maxdepth 1 -name 'pegana-*.dump.enc' 2>/dev/null | wc -l | tr -d ' '; }

# ─── 1. happy path ───────────────────────────────────────────────────────
echo "happy path"
H=$(new_home ok)
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "one local dump" test "$(count_dumps "$H")" -eq 1
f=$(find "$H/backups" -name 'pegana-*.dump.enc' | head -1)
check "sha256 sidecar matches" bash -c "cd '$H/backups' && (sha256sum -c '$(basename "$f").sha256' >/dev/null 2>&1 || shasum -a 256 -c '$(basename "$f").sha256' >/dev/null 2>&1)"
check "meta records timescaledb version" grep -q '^timescaledb_version=2.29.0$' "$f.meta"
check "local copy decrypts to the dump" bash -c "openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass 'file:$H/.pegana-backup-key' -in '$f' | head -c 5 | grep -q PGDMP"
check "uploaded to remote" test -f "$H/remote/pegana-backups/$(basename "$f")"
check "meta uploaded" test -f "$H/remote/pegana-backups/$(basename "$f").meta"
check "metric exit code 0" test "$(metric "$H" pegana_backup_last_exit_code)" = 0
check "metric local success set" test "$(metric "$H" pegana_backup_local_last_success_timestamp_seconds)" -gt 0
check "metric offsite success set" test "$(metric "$H" pegana_backup_offsite_last_success_timestamp_seconds)" -gt 0
check "metric offsite enabled" test "$(metric "$H" pegana_backup_offsite_enabled)" = 1
check "state file written" test -s "$H/.pegana-last-backup.txt"
check "offsite state file written" test -s "$H/.pegana-last-offsite-backup.txt"
check "prune floor set to this run" grep -qx "$(basename "$f" .dump.enc | sed 's/^pegana-//')" "$H/.pegana-offsite-prune-floor"
check "no blind bulk delete issued" test ! -e "$H/remote/delete.log"
check "no partial left" test "$(find "$H/backups" -name '*.partial' | wc -l | tr -d ' ')" -eq 0

# ─── 2. offsite denied (the 2026-10 prod failure) ────────────────────────
echo "offsite upload denied"
H=$(new_home deny)
run_backup "$H" STUB_RCLONE_MODE=deny; rc=$?
check "exit 4" test "$rc" -eq 4
check "verified local copy KEPT" test "$(count_dumps "$H")" -eq 1
check "metric exit code 4" test "$(metric "$H" pegana_backup_last_exit_code)" = 4
check "metric local success set" test "$(metric "$H" pegana_backup_local_last_success_timestamp_seconds)" -gt 0
check "metric offsite never succeeded (0)" test "$(metric "$H" pegana_backup_offsite_last_success_timestamp_seconds)" = 0
check "no offsite state file" test ! -e "$H/.pegana-last-offsite-backup.txt"
check "log says FAILED" grep -q 'offsite upload FAILED' "$H/out.log"

# A later successful run keeps the earlier offsite timestamp semantics.
prev_local=$(metric "$H" pegana_backup_local_last_success_timestamp_seconds)
sleep 1
run_backup "$H" STUB_PGDUMP_FAIL=1; rc=$?
check "dump failure exits 3" test "$rc" -eq 3
check "failed run carries local timestamp forward" test "$(metric "$H" pegana_backup_local_last_success_timestamp_seconds)" = "$prev_local"
check "failed run keeps earlier local copy" test "$(count_dumps "$H")" -eq 1
check "failed dump leaves no partial" test "$(find "$H/backups" -name '*.partial' | wc -l | tr -d ' ')" -eq 0

# ─── 3. verification failure ─────────────────────────────────────────────
echo "verification failure"
H=$(new_home verify)
run_backup "$H" STUB_PGRESTORE_FAIL=1; rc=$?
check "exit 3" test "$rc" -eq 3
check "no local dump kept" test "$(count_dumps "$H")" -eq 0
check "no partial left" test "$(find "$H/backups" -name '*.partial' | wc -l | tr -d ' ')" -eq 0
check "metric local never succeeded (0)" test "$(metric "$H" pegana_backup_local_last_success_timestamp_seconds)" = 0
check "metric exit code 3" test "$(metric "$H" pegana_backup_last_exit_code)" = 3

# ─── 4. local-only mode ──────────────────────────────────────────────────
echo "offsite disabled"
H=$(new_home off)
rm -f "$H/.pegana-r2-creds.env"
run_backup "$H" PEGANA_BACKUP_OFFSITE=off; rc=$?
check "exit 0" test "$rc" -eq 0
check "metric offsite disabled" test "$(metric "$H" pegana_backup_offsite_enabled)" = 0
check "nothing uploaded" test ! -d "$H/remote/pegana-backups"

echo "missing creds with offsite on"
H=$(new_home nocreds)
rm -f "$H/.pegana-r2-creds.env"
run_backup "$H"; rc=$?
check "exit 4 (offsite misconfigured is loud)" test "$rc" -eq 4
check "local copy kept" test "$(count_dumps "$H")" -eq 1

# ─── 5. config errors ────────────────────────────────────────────────────
echo "config errors"
H=$(new_home nokey)
rm -f "$H/.pegana-backup-key"
run_backup "$H"; rc=$?
check "missing key exits 2" test "$rc" -eq 2
check "missing key still writes metrics" test "$(metric "$H" pegana_backup_last_exit_code)" = 2
H=$(new_home disk)
env -i PATH="$WORK/bin:$PATH" HOME="$H" STUB_REMOTE_DIR="$H/remote" \
  PEGANA_BACKUP_MIN_FREE_MB=999999999 bash "$SCRIPT" >"$H/out.log" 2>&1; rc=$?
check "insufficient disk exits 5" test "$rc" -eq 5

# ─── 6. rotation ─────────────────────────────────────────────────────────
echo "rotation"
H=$(new_home rot)
mkdir -p "$H/backups"
for n in 20260101T000000Z 20260101T060000Z 20260102T000000Z 20260102T120000Z \
         20260103T000000Z 20260104T000000Z 20260104T180000Z 20260105T000000Z; do
  echo old > "$H/backups/pegana-$n.dump.enc"
  echo sha > "$H/backups/pegana-$n.dump.enc.sha256"
done
# New dump (today) + KEEP_RECENT=2 keeps today and 20260105T000000Z; KEEP_DAILY=4
# then adds the newest of the next distinct days: 20260104T180000Z, 20260103T000000Z.
run_backup "$H" PEGANA_BACKUP_OFFSITE=off PEGANA_BACKUP_KEEP_RECENT=2 PEGANA_BACKUP_KEEP_DAILY=4; rc=$?
check "exit 0" test "$rc" -eq 0
check "4 dumps kept" test "$(count_dumps "$H")" -eq 4
check "keeps 20260105T000000Z" test -f "$H/backups/pegana-20260105T000000Z.dump.enc"
check "keeps newest of 2026-01-04" test -f "$H/backups/pegana-20260104T180000Z.dump.enc"
check "drops older of 2026-01-04" test ! -f "$H/backups/pegana-20260104T000000Z.dump.enc"
check "keeps 20260103T000000Z" test -f "$H/backups/pegana-20260103T000000Z.dump.enc"
check "drops 2026-01-02" test ! -f "$H/backups/pegana-20260102T120000Z.dump.enc"
check "drops sidecars of removed dumps" test ! -f "$H/backups/pegana-20260101T000000Z.dump.enc.sha256"
check "metric local_files 4" test "$(metric "$H" pegana_backup_local_files)" = 4

# ─── 7. offsite retention is fail-safe (finding #46) ─────────────────────
# Old dumps use 2020 timestamps so they are always past the 30d cutoff.
seed_remote() {  # seed_remote <home> <ts> [nometa]
  local d="$1/remote/pegana-backups"; mkdir -p "$d"
  echo old > "$d/pegana-$2.dump.enc"
  echo sha > "$d/pegana-$2.dump.enc.sha256"
  [[ "${3:-}" == nometa ]] || echo meta > "$d/pegana-$2.dump.enc.meta"
}
remote_has() { test -f "$1/remote/pegana-backups/pegana-$2.dump.enc"; }

echo "offsite prune: first successful upload never deletes pre-existing dumps"
H=$(new_home prefloor)
for ts in 20200921T150001Z 20200925T000000Z 20200930T180000Z; do seed_remote "$H" "$ts"; done
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "floor file written" test -s "$H/.pegana-offsite-prune-floor"
check "keeps 20200921T150001Z" remote_has "$H" 20200921T150001Z
check "keeps 20200930T180000Z" remote_has "$H" 20200930T180000Z
check "nothing deleted" test ! -e "$H/remote/deletefile.log"
check "no blind bulk delete" test ! -e "$H/remote/delete.log"
# Even with many newer verified dumps, objects older than the floor stay.
for i in 1 2 3 4 5 6 7 8 9; do run_backup "$H"; sleep 1; done
check "still keeps pre-floor dumps after 10 runs" remote_has "$H" 20200921T150001Z
check "still nothing deleted" test ! -e "$H/remote/deletefile.log"

echo "offsite prune: too few newer verified dumps and empty archive/ keeps"
H=$(new_home fewnewer)
echo 20200101T000000Z > "$H/.pegana-offsite-prune-floor"
seed_remote "$H" 20200105T000000Z
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "keeps old dump (1 newer < 7)" remote_has "$H" 20200105T000000Z
check "log explains why" grep -q 'keeping pegana-20200105T000000Z.dump.enc (only 1 newer verified dumps, need 7)' "$H/out.log"
check "floor not moved" grep -qx 20200101T000000Z "$H/.pegana-offsite-prune-floor"

echo "offsite prune: archive/ holding a dump allows pruning with 1 newer"
H=$(new_home archived)
echo 20200101T000000Z > "$H/.pegana-offsite-prune-floor"
seed_remote "$H" 20200105T000000Z
mkdir -p "$H/remote/pegana-backups/archive"
echo arch > "$H/remote/pegana-backups/archive/pegana-20200102T000000Z.dump.enc"
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "prunes old dump" bash -c "! test -f '$H/remote/pegana-backups/pegana-20200105T000000Z.dump.enc'"
check "prunes its sha256" test ! -f "$H/remote/pegana-backups/pegana-20200105T000000Z.dump.enc.sha256"
check "prunes its meta" test ! -f "$H/remote/pegana-backups/pegana-20200105T000000Z.dump.enc.meta"
check "archive/ untouched" test -f "$H/remote/pegana-backups/archive/pegana-20200102T000000Z.dump.enc"
check "new upload kept" test "$(find "$H/remote/pegana-backups" -maxdepth 1 -name 'pegana-*.dump.enc' | wc -l | tr -d ' ')" -eq 1

echo "offsite prune: needs 7 newer verified; unverified dumps do not count"
H=$(new_home minnewer)
echo 20200101T000000Z > "$H/.pegana-offsite-prune-floor"
for d in 03 04 05 06 07 08 09 10; do seed_remote "$H" "202001${d}T000000Z"; done
seed_remote "$H" 20200111T000000Z nometa
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
# Verified newer than 0103: 0104..0110 (7) + new upload = 8; than 0104: 7.
check "prunes 20200103 (8 newer)" bash -c "! test -f '$H/remote/pegana-backups/pegana-20200103T000000Z.dump.enc'"
check "prunes 20200104 (7 newer)" bash -c "! test -f '$H/remote/pegana-backups/pegana-20200104T000000Z.dump.enc'"
check "keeps 20200105 (6 newer)" remote_has "$H" 20200105T000000Z
check "keeps 20200110" remote_has "$H" 20200110T000000Z
check "keeps unverified 20200111 (1 newer)" remote_has "$H" 20200111T000000Z
check "exactly 6 objects deleted (2 dumps x 3)" test "$(wc -l < "$H/remote/deletefile.log" | tr -d ' ')" -eq 6

echo "offsite prune: floor protects older dumps even with many newer"
H=$(new_home floor)
echo 20200106T000000Z > "$H/.pegana-offsite-prune-floor"
for d in 03 04 05 06 07 08 09 10 11 12 13 14 15 16; do seed_remote "$H" "202001${d}T000000Z"; done
run_backup "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "keeps 20200103 (pre-floor)" remote_has "$H" 20200103T000000Z
check "keeps 20200105 (pre-floor)" remote_has "$H" 20200105T000000Z
check "prunes 20200106 (at floor, 11 newer)" bash -c "! test -f '$H/remote/pegana-backups/pegana-20200106T000000Z.dump.enc'"

echo "offsite prune: fail-safe skips"
H=$(new_home badfloor)
echo garbage > "$H/.pegana-offsite-prune-floor"
for d in 03 04 05 06 07 08 09 10 11 12; do seed_remote "$H" "202001${d}T000000Z"; done
run_backup "$H"; rc=$?
check "malformed floor: exit 0" test "$rc" -eq 0
check "malformed floor: nothing deleted" test ! -e "$H/remote/deletefile.log"
check "malformed floor: warns" grep -q 'prune floor .* is missing or malformed' "$H/out.log"
H=$(new_home lsffail)
echo 20200101T000000Z > "$H/.pegana-offsite-prune-floor"
for d in 03 04 05 06 07 08 09 10 11 12; do seed_remote "$H" "202001${d}T000000Z"; done
run_backup "$H" STUB_RCLONE_LSF_FAIL=1; rc=$?
check "listing error: exit 0" test "$rc" -eq 0
check "listing error: nothing deleted" test ! -e "$H/remote/deletefile.log"
H=$(new_home ret0)
echo 20200101T000000Z > "$H/.pegana-offsite-prune-floor"
for d in 03 04 05 06 07 08 09 10 11 12; do seed_remote "$H" "202001${d}T000000Z"; done
run_backup "$H" PEGANA_BACKUP_OFFSITE_RETENTION_DAYS=0; rc=$?
check "retention 0: exit 0" test "$rc" -eq 0
check "retention 0: nothing deleted" test ! -e "$H/remote/deletefile.log"
H=$(new_home badmin)
run_backup "$H" PEGANA_BACKUP_OFFSITE_MIN_NEWER=0; rc=$?
check "MIN_NEWER=0 is a config error (exit 2)" test "$rc" -eq 2
H=$(new_home denyfloor)
run_backup "$H" STUB_RCLONE_MODE=deny; rc=$?
check "failed upload does not set the floor" test ! -e "$H/.pegana-offsite-prune-floor"

echo
echo "pg-backup tests: $pass passed, $failed failed"
(( failed == 0 ))
