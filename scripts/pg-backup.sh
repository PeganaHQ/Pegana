#!/usr/bin/env bash
# pg-backup.sh — dump prod Postgres, encrypt client-side, keep a rotating
# local copy, then upload it to the R2 offsite target.
#
# Runs from cron every 6h (installed by scripts/install-pg-backup.sh).
#
# Order of operations, and why:
#   1. pg_dump | openssl  -> $BACKUP_DIR/<name>.partial
#   2. verify the archive  (decrypt + pg_restore --list must succeed)
#   3. rename to <name>    (only a verified dump ever gets its final name)
#   4. rotate local copies (newest KEEP_RECENT + newest-per-day for KEEP_DAILY days)
#   5. upload to R2        (offsite; a failure here KEEPS the local copy)
#   6. prune old offsite   (fail-safe: never pre-floor objects, never without
#                           enough newer verified dumps; see step 6 below)
#   7. write the Prometheus textfile metrics + Sentry check-in (on every exit)
#
# Until 2026-10-21 the script dumped to a temp file and its EXIT trap deleted
# that file whether or not the upload worked. When the R2 token started
# returning 403 after the Hostinger rebuild, every run produced a dump, failed
# the upload, and then deleted the only copy. That is what this layout fixes:
# a backup exists on local disk the moment step 3 completes, and an offsite
# failure is reported (exit 4, metric, Sentry) without losing it.
#
# Exit codes (cron log, Sentry and the textfile metric all see them):
#   0  local copy written and verified; offsite upload OK (or disabled)
#   2  configuration problem (missing key, unreadable .env, bad settings)
#   3  dump or verification failed; no new local copy
#   4  local copy written and verified, but the offsite upload FAILED
#   5  not enough free disk to take the dump safely
#
# Files read:
#   ~/.pegana-backup-key      encryption key (0600). Back it up off-host:
#                             losing it makes every backup unrecoverable.
#   ~/.pegana-r2-creds.env    R2_BUCKET. The upload itself goes through the
#                             preconfigured rclone remote (`r2:` by default,
#                             ~/.config/rclone/rclone.conf holds the token).
#
# Files written:
#   $BACKUP_DIR/pegana-<ts>.dump.enc        encrypted pg_dump (custom format)
#   $BACKUP_DIR/pegana-<ts>.dump.enc.sha256 checksum sidecar
#   $BACKUP_DIR/pegana-<ts>.dump.enc.meta   versions needed to restore it
#   $STATE_FILE          last good LOCAL backup (calibration-watch reads col 3)
#   $OFFSITE_STATE_FILE  last good OFFSITE backup
#   $PRUNE_FLOOR_FILE    timestamp of the first successful upload; offsite
#                        objects older than it are never pruned (step 6)
#   $METRICS_DIR/pegana_backup.prom  node-exporter textfile metrics, which feed
#                                    the PeganaBackup* rules in ops/alerts/pegana.yml
#
# Encryption: openssl AES-256-CBC with PBKDF2 (100k iters).

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
STATE_FILE="${PEGANA_BACKUP_STATE:-$HOME/.pegana-last-backup.txt}"
OFFSITE_STATE_FILE="${PEGANA_BACKUP_OFFSITE_STATE:-$HOME/.pegana-last-offsite-backup.txt}"
BACKUP_DIR="${PEGANA_BACKUP_DIR:-$HOME/backups}"
METRICS_DIR="${PEGANA_BACKUP_METRICS_DIR:-$HOME/.pegana-metrics}"
KEEP_RECENT="${PEGANA_BACKUP_KEEP_RECENT:-4}"
KEEP_DAILY="${PEGANA_BACKUP_KEEP_DAILY:-7}"
MIN_FREE_MB="${PEGANA_BACKUP_MIN_FREE_MB:-4096}"
# `r2` uploads to the rclone remote below; `off` keeps local copies only and
# reports offsite as disabled (pegana_backup_offsite_enabled 0).
OFFSITE="${PEGANA_BACKUP_OFFSITE:-r2}"
RCLONE_REMOTE="${PEGANA_BACKUP_RCLONE_REMOTE:-r2}"
OFFSITE_RETENTION_DAYS="${PEGANA_BACKUP_OFFSITE_RETENTION_DAYS:-30}"
# Newer verified offsite dumps required before an old one may be pruned
# (only 1 is required once archive/ holds a dump). See step 6.
OFFSITE_MIN_NEWER="${PEGANA_BACKUP_OFFSITE_MIN_NEWER:-7}"
PRUNE_FLOOR_FILE="${PEGANA_BACKUP_OFFSITE_PRUNE_FLOOR:-$HOME/.pegana-offsite-prune-floor}"
SOURCE_TAG="${PEGANA_BACKUP_SOURCE_TAG:-pegana-prod}"

log()  { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
fail() { local code="$1"; shift; printf '[%s] FATAL: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit "$code"; }

file_size() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }

# ─── Metrics + Sentry, written on EVERY exit ─────────────────────────────
# The textfile is the source of truth for "when did this last succeed": a
# failed run carries the previous success timestamps forward, so the stale
# alerts measure real age instead of resetting on each attempt. A box where
# no backup ever succeeded reports 0, which the stale rules treat as stale.
prev_metric() {
  local f="$METRICS_DIR/pegana_backup.prom"
  [[ -r "$f" ]] || { echo 0; return 0; }
  awk -v m="$1" '$1 == m { v = $2; found = 1 } END { print (found ? v : 0) }' "$f"
}

LOCAL_OK_TS=""
OFFSITE_OK_TS=""
LOCAL_SIZE=""
write_metrics() {
  local status="$1" now tmp local_ts offsite_ts size files enabled
  now=$(date -u +%s)
  local_ts="${LOCAL_OK_TS:-$(prev_metric pegana_backup_local_last_success_timestamp_seconds)}"
  offsite_ts="${OFFSITE_OK_TS:-$(prev_metric pegana_backup_offsite_last_success_timestamp_seconds)}"
  size="${LOCAL_SIZE:-$(prev_metric pegana_backup_local_last_size_bytes)}"
  files=0
  if [[ -d "$BACKUP_DIR" ]]; then
    files=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pegana-*.dump.enc' | wc -l | tr -d ' ')
  fi
  enabled=1
  [[ "$OFFSITE" == "off" ]] && enabled=0
  # node-exporter runs as nobody inside its container: the directory and the
  # file must be world-readable (they hold no secrets, only timestamps).
  if ! { mkdir -p "$METRICS_DIR" && chmod 0755 "$METRICS_DIR"; } 2>/dev/null; then
    warn "cannot create $METRICS_DIR; metrics not written"
    return 0
  fi
  tmp="$METRICS_DIR/.pegana_backup.prom.$$"
  if {
    echo "# HELP pegana_backup_last_run_timestamp_seconds Unix time pg-backup.sh last finished (any outcome)."
    echo "# TYPE pegana_backup_last_run_timestamp_seconds gauge"
    echo "pegana_backup_last_run_timestamp_seconds $now"
    echo "# HELP pegana_backup_last_exit_code Exit code of the last pg-backup.sh run (0 ok, 2 config, 3 dump, 4 offsite, 5 disk)."
    echo "# TYPE pegana_backup_last_exit_code gauge"
    echo "pegana_backup_last_exit_code $status"
    echo "# HELP pegana_backup_local_last_success_timestamp_seconds Unix time of the newest verified local backup (0 = never)."
    echo "# TYPE pegana_backup_local_last_success_timestamp_seconds gauge"
    echo "pegana_backup_local_last_success_timestamp_seconds $local_ts"
    echo "# HELP pegana_backup_offsite_last_success_timestamp_seconds Unix time of the newest backup confirmed offsite (0 = never)."
    echo "# TYPE pegana_backup_offsite_last_success_timestamp_seconds gauge"
    echo "pegana_backup_offsite_last_success_timestamp_seconds $offsite_ts"
    echo "# HELP pegana_backup_offsite_enabled 1 when the offsite upload is configured, 0 when PEGANA_BACKUP_OFFSITE=off."
    echo "# TYPE pegana_backup_offsite_enabled gauge"
    echo "pegana_backup_offsite_enabled $enabled"
    echo "# HELP pegana_backup_local_last_size_bytes Size in bytes of the newest verified local backup."
    echo "# TYPE pegana_backup_local_last_size_bytes gauge"
    echo "pegana_backup_local_last_size_bytes $size"
    echo "# HELP pegana_backup_local_files Encrypted backups currently kept on local disk."
    echo "# TYPE pegana_backup_local_files gauge"
    echo "pegana_backup_local_files $files"
  } > "$tmp" 2>/dev/null && chmod 0644 "$tmp" && mv -f "$tmp" "$METRICS_DIR/pegana_backup.prom"; then
    :
  else
    rm -f "$tmp"
    warn "could not write $METRICS_DIR/pegana_backup.prom"
  fi
}

SENTRY_DSN_VAL=""
MONITOR_SLUG="pegana-pg-backup"
# Must match the cron line in scripts/install-pg-backup.sh (0 */6 * * *).
MONITOR_SCHED="0 */6 * * *"
MONITOR_MARGIN=15
MONITOR_MAX=30
sentry_checkin() {
  local status="$1"
  [[ -z "${SENTRY_DSN_VAL:-}" ]] && return 0
  local key ingest project
  key=$(printf '%s' "$SENTRY_DSN_VAL"     | sed -E 's|^https?://([^@]+)@.*|\1|')
  ingest=$(printf '%s' "$SENTRY_DSN_VAL"  | sed -E 's|^https?://[^@]+@([^/]+)/.*|\1|')
  project=$(printf '%s' "$SENTRY_DSN_VAL" | sed -E 's|.*/([0-9]+)$|\1|')
  # Sentry crons HTTP API: sentry_key in path, status MUST be in the JSON body
  # (returns 422 if status is in query params). Tested 2026-05-29.
  curl -sS --max-time 8 -X POST \
    "https://${ingest}/api/${project}/cron/${MONITOR_SLUG}/${key}/" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"${MONITOR_SCHED}\"},\"checkin_margin\":${MONITOR_MARGIN},\"max_runtime\":${MONITOR_MAX},\"timezone\":\"Etc/UTC\"}}" \
    -o /dev/null 2>/dev/null || true
}

PARTIAL=""
backup_exit() {
  local status=$?
  # Only an UNVERIFIED partial dump is ever deleted here. A verified local
  # backup is never removed by the exit path, whatever happened afterwards.
  [[ -z "$PARTIAL" ]] || rm -f "$PARTIAL"
  write_metrics "$status"
  sentry_checkin "$([ "$status" -eq 0 ] && echo ok || echo error)"
  if [[ "$status" -ne 0 ]]; then
    printf '[%s] backup FAILED (exit %s)\n' "$(date -u +%FT%TZ)" "$status" >&2
  fi
  exit "$status"
}
trap backup_exit EXIT

# ─── Configuration ───────────────────────────────────────────────────────
for n in KEEP_RECENT KEEP_DAILY MIN_FREE_MB OFFSITE_RETENTION_DAYS OFFSITE_MIN_NEWER; do
  [[ "${!n}" =~ ^[0-9]+$ ]] || fail 2 "$n must be a non-negative integer (got '${!n}')"
done
(( KEEP_RECENT >= 1 )) || fail 2 "PEGANA_BACKUP_KEEP_RECENT must be >= 1"
(( OFFSITE_MIN_NEWER >= 1 )) || fail 2 "PEGANA_BACKUP_OFFSITE_MIN_NEWER must be >= 1"
[[ "$OFFSITE" == "r2" || "$OFFSITE" == "off" ]] \
  || fail 2 "PEGANA_BACKUP_OFFSITE must be 'r2' or 'off' (got '$OFFSITE')"

cd "$PEGANA_DIR" || fail 2 "cannot cd to $PEGANA_DIR"
[[ -r .env ]] || fail 2 "cannot read $PEGANA_DIR/.env"

env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2- || true)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}
SENTRY_DSN_VAL="$(env_get SENTRY_DSN)"
PG_USER="$(env_get POSTGRES_USER)"; PG_USER="${PG_USER:-pegana}"
PG_DB="$(env_get POSTGRES_DB)";     PG_DB="${PG_DB:-pegana}"
PG_PASSWORD="$(env_get POSTGRES_PASSWORD)"

[[ -r "$KEY" ]] || fail 2 "cannot read encryption key at $KEY"

R2_BUCKET=""
if [[ "$OFFSITE" == "r2" && -r "$CREDS" ]]; then
  # Parse creds safely (no `source`): line-by-line key=value.
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    v="${v%\"}"; v="${v#\"}"
    [[ "$k" == "R2_BUCKET" ]] && R2_BUCKET="$v"
  done < "$CREDS"
fi

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

# ─── Free-space guard ────────────────────────────────────────────────────
# Need room for the new dump next to the ones we keep: at least MIN_FREE_MB
# and at least twice the previous dump.
avail_kb=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
need_kb=$(( MIN_FREE_MB * 1024 ))
prev_size=$(prev_metric pegana_backup_local_last_size_bytes)
[[ "$prev_size" =~ ^[0-9]+$ ]] || prev_size=0
if (( prev_size * 2 / 1024 > need_kb )); then
  need_kb=$(( prev_size * 2 / 1024 ))
fi
if (( avail_kb < need_kb )); then
  fail 5 "only $(( avail_kb / 1024 )) MB free in $BACKUP_DIR, need $(( need_kb / 1024 )) MB"
fi

# ─── 1. Dump + encrypt ───────────────────────────────────────────────────
TS=$(date -u +'%Y%m%dT%H%M%SZ')
NAME="pegana-${TS}.dump.enc"
FINAL="$BACKUP_DIR/$NAME"

# Record the exact versions a restore must match. A custom-format dump of a
# TimescaleDB database only restores cleanly into the SAME extension version
# (see docs/runbooks/restore.md, "Version matching").
TSDB_VERSION=$(docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
  psql -X -qAt -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'" </dev/null | tr -d '\r') \
  || fail 3 "cannot query postgres (is the container up?)"
PG_VERSION=$(docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
  psql -X -qAt -U "$PG_USER" -d "$PG_DB" -c "SHOW server_version" </dev/null | tr -d '\r') \
  || fail 3 "cannot query postgres server_version"

PARTIAL="$FINAL.partial"
log "dumping $PG_DB (postgres $PG_VERSION, timescaledb ${TSDB_VERSION:-none}) -> $PARTIAL"
# PGPASSWORD via -e: visible to other local users via `ps auxe` (only deploy
# and root exist on the box; accepted risk). `docker compose exec` does not
# support --env-file.
umask 077
if ! docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
       pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges \
       --format=custom --compress=6 </dev/null \
     | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass "file:$KEY" \
     > "$PARTIAL"; then
  fail 3 "pg_dump | openssl failed"
fi

SIZE_BYTES=$(file_size "$PARTIAL")
(( SIZE_BYTES > 1024 )) || fail 3 "dump is implausibly small ($SIZE_BYTES bytes)"

# ─── 2. Verify: decrypt and read the archive TOC ─────────────────────────
# pg_restore --list parses the archive header and table of contents; a wrong
# key, a broken cipher stream or a non-archive fails here. pg_restore may stop
# reading before EOF, so openssl's SIGPIPE is expected and ignored: only
# pg_restore's own exit status decides.
set +o pipefail
if openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "file:$KEY" -in "$PARTIAL" 2>/dev/null \
     | docker compose exec -T postgres pg_restore --list > /dev/null; then
  verify_status=0
else
  verify_status=$?
fi
set -o pipefail
(( verify_status == 0 )) \
  || fail 3 "verification failed: the encrypted dump does not decrypt to a valid pg_restore archive"

# ─── 3. Promote to a final, named local backup ───────────────────────────
SHA256=$( { sha256sum "$PARTIAL" 2>/dev/null || shasum -a 256 "$PARTIAL"; } | cut -d' ' -f1)
mv -f "$PARTIAL" "$FINAL"
PARTIAL=""
printf '%s  %s\n' "$SHA256" "$NAME" > "$FINAL.sha256"
{
  echo "name=$NAME"
  echo "created_at=$(date -u +%FT%TZ)"
  echo "postgres_version=$PG_VERSION"
  echo "timescaledb_version=$TSDB_VERSION"
  echo "pg_db=$PG_DB"
  echo "host=$(hostname)"
  echo "size_bytes=$SIZE_BYTES"
  echo "sha256=$SHA256"
  echo "encryption=aes-256-cbc-pbkdf2-100000"
} > "$FINAL.meta"
LOCAL_OK_TS=$(date -u +%s)
LOCAL_SIZE="$SIZE_BYTES"
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))
printf '%s\t%dMB\t%s\n' "$NAME" "$SIZE_MB" "$(date -u +%FT%TZ)" > "$STATE_FILE"
log "local backup OK: $FINAL (${SIZE_MB} MB, encrypted, verified)"

# ─── 4. Local rotation ───────────────────────────────────────────────────
# Keep the newest KEEP_RECENT backups, plus the newest backup of each of the
# KEEP_DAILY most recent UTC days. Everything else (and its sidecars) goes.
# Names sort chronologically (pegana-YYYYMMDDTHHMMSSZ.dump.enc). This runs
# only after a new verified backup exists, so it can never empty the dir.
rotate_local() {
  local i=0 day kept_days="" ndays=0 f base
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    base=${f##*/}
    day=${base:7:8}
    i=$(( i + 1 ))
    if (( i <= KEEP_RECENT )); then
      if [[ " $kept_days " != *" $day "* ]]; then
        kept_days+=" $day"; ndays=$(( ndays + 1 ))
      fi
      continue
    fi
    if [[ " $kept_days " != *" $day "* ]] && (( ndays < KEEP_DAILY )); then
      kept_days+=" $day"; ndays=$(( ndays + 1 ))
      continue
    fi
    log "rotate: removing $base"
    rm -f "$f" "$f.sha256" "$f.meta"
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pegana-*.dump.enc' | LC_ALL=C sort -r)
  # Leftover partials from a crashed run, older than a day.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pegana-*.dump.enc.partial' -mmin +1440 -exec rm -f {} + 2>/dev/null || true
}
rotate_local

# ─── 5. Offsite upload ───────────────────────────────────────────────────
if [[ "$OFFSITE" == "off" ]]; then
  log "offsite upload disabled (PEGANA_BACKUP_OFFSITE=off); local copy only"
  exit 0
fi

offsite_fail() {
  warn "offsite upload FAILED: $*"
  warn "the verified local copy is kept at $FINAL"
  exit 4
}
command -v rclone >/dev/null 2>&1 || offsite_fail "rclone is not installed"
[[ -n "$R2_BUCKET" ]] || offsite_fail "R2_BUCKET not set (cannot read it from $CREDS)"
DEST="${RCLONE_REMOTE}:${R2_BUCKET}"

rclone copyto "$FINAL" "$DEST/$NAME" \
  --header-upload "X-Amz-Meta-Source: ${SOURCE_TAG}" \
  --header-upload "X-Amz-Meta-Host: $(hostname)" \
  --header-upload "X-Amz-Meta-Pg-Db: ${PG_DB}" \
  --header-upload "X-Amz-Meta-Timescaledb-Version: ${TSDB_VERSION}" \
  --header-upload "X-Amz-Meta-Encryption: aes-256-cbc-pbkdf2" \
  || offsite_fail "rclone copyto $DEST/$NAME"

REMOTE_SIZE=$(rclone lsjson "$DEST/$NAME" 2>/dev/null | sed -n 's/.*"Size":\([0-9]*\).*/\1/p' | head -1 || true)
[[ "$REMOTE_SIZE" == "$SIZE_BYTES" ]] \
  || offsite_fail "uploaded object size mismatch (local=$SIZE_BYTES, remote=${REMOTE_SIZE:-missing})"

rclone copyto "$FINAL.sha256" "$DEST/$NAME.sha256" || offsite_fail "sha256 sidecar upload"
rclone copyto "$FINAL.meta"   "$DEST/$NAME.meta"   || offsite_fail "meta sidecar upload"

OFFSITE_OK_TS=$(date -u +%s)
printf '%s\t%dMB\t%s\n' "$NAME" "$SIZE_MB" "$(date -u +%FT%TZ)" > "$OFFSITE_STATE_FILE"

# ─── 6. Offsite retention ────────────────────────────────────────────────
# There is no bucket lifecycle rule (setting one needs an admin-scoped token),
# so this script prunes old top-level objects itself. The sweep is built to
# fail SAFE, because the bucket also holds the only copies of history that
# predates the 2026-10-16 box rebuild (the 2026-09 dumps). Until 2026-10-21 it
# was a blind `rclone delete --min-age 30d`, which would have deleted every
# one of those on the first upload that succeeded after the R2 token fix.
#
# A dump is pruned only when ALL of these hold:
#   1. it is a top-level object named pegana-<YYYYMMDDTHHMMSSZ>.dump.enc
#      (anything under a prefix such as archive/ is never even listed);
#   2. its name timestamp is older than OFFSITE_RETENTION_DAYS;
#   3. its name timestamp is not older than the prune floor: the timestamp of
#      the first upload that succeeded with this logic ($PRUNE_FLOOR_FILE,
#      written once, never moved back). Objects that were already offsite
#      before that upload are therefore never deleted by this script;
#   4. enough newer VERIFIED dumps (dump + .sha256 + .meta all present) exist
#      offsite: at least OFFSITE_MIN_NEWER, or at least 1 when archive/
#      already holds a dump.
# Any listing error skips the whole sweep. Best effort: a failure here is
# reported but never fails the backup. RETENTION_DAYS=0 disables it.
fmt_ts() { date -u -d "@$1" +'%Y%m%dT%H%M%SZ' 2>/dev/null || date -u -r "$1" +'%Y%m%dT%H%M%SZ'; }
TS_RE='^[0-9]{8}T[0-9]{6}Z$'

prune_offsite() {
  if (( OFFSITE_RETENTION_DAYS == 0 )); then
    log "offsite retention sweep disabled (PEGANA_BACKUP_OFFSITE_RETENTION_DAYS=0)"
    return 0
  fi
  local floor cutoff listing archive_listing archive_dumps=0 need f ts d newer v
  floor=$(head -1 "$PRUNE_FLOOR_FILE" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ ! "$floor" =~ $TS_RE ]]; then
    warn "offsite retention sweep skipped: prune floor in $PRUNE_FLOOR_FILE is missing or malformed ('$floor')"
    return 0
  fi
  cutoff=$(fmt_ts $(( $(date -u +%s) - OFFSITE_RETENTION_DAYS * 86400 ))) \
    || { warn "offsite retention sweep skipped: cannot compute the cutoff date"; return 0; }

  if ! listing=$(rclone lsf --files-only "$DEST" 2>/dev/null); then
    warn "offsite retention sweep skipped: cannot list $DEST"
    return 0
  fi
  # An unreadable archive/ counts as empty: that only makes the sweep stricter.
  if archive_listing=$(rclone lsf --files-only -R "$DEST/archive" 2>/dev/null); then
    archive_dumps=$(printf '%s\n' "$archive_listing" | grep -cE '(^|/)pegana-[0-9]{8}T[0-9]{6}Z\.dump\.enc$' || true)
  fi
  need="$OFFSITE_MIN_NEWER"
  (( archive_dumps > 0 )) && need=1

  local -a dumps=() verified=()
  while IFS= read -r f; do
    [[ "$f" =~ ^pegana-([0-9]{8}T[0-9]{6}Z)\.dump\.enc$ ]] || continue
    dumps+=("${BASH_REMATCH[1]}")
  done < <(printf '%s\n' "$listing" | LC_ALL=C sort)
  for ts in ${dumps[@]+"${dumps[@]}"}; do
    if grep -qxF "pegana-$ts.dump.enc.sha256" <<<"$listing" \
       && grep -qxF "pegana-$ts.dump.enc.meta" <<<"$listing"; then
      verified+=("$ts")
    fi
  done

  local pruned=0 kept=0
  for ts in ${dumps[@]+"${dumps[@]}"}; do
    [[ "$ts" < "$cutoff" ]] || continue          # not old enough
    if [[ "$ts" < "$floor" ]]; then              # predates the floor: never touched
      kept=$(( kept + 1 ))
      continue
    fi
    newer=0
    for v in ${verified[@]+"${verified[@]}"}; do
      [[ "$v" > "$ts" ]] && newer=$(( newer + 1 ))
    done
    if (( newer < need )); then
      log "offsite retention: keeping pegana-$ts.dump.enc (only $newer newer verified dumps, need $need)"
      kept=$(( kept + 1 ))
      continue
    fi
    d="pegana-$ts.dump.enc"
    log "offsite retention: removing $d ($newer newer verified dumps, archive dumps: $archive_dumps)"
    if rclone deletefile "$DEST/$d"; then
      pruned=$(( pruned + 1 ))
      grep -qxF "$d.sha256" <<<"$listing" && { rclone deletefile "$DEST/$d.sha256" || warn "could not delete $d.sha256"; }
      grep -qxF "$d.meta"   <<<"$listing" && { rclone deletefile "$DEST/$d.meta"   || warn "could not delete $d.meta"; }
    else
      warn "offsite retention: could not delete $d"
    fi
  done
  log "offsite retention: pruned $pruned, kept $kept older than ${OFFSITE_RETENTION_DAYS}d (floor $floor, cutoff $cutoff)"
  return 0
}

# Set the floor on the first upload that succeeds with this logic. Losing the
# file (for example on a box rebuild) only moves the floor LATER, which keeps
# more, never less.
if [[ ! -s "$PRUNE_FLOOR_FILE" ]]; then
  if printf '%s\n' "$TS" > "$PRUNE_FLOOR_FILE"; then
    log "offsite prune floor set to $TS: objects older than this are never pruned"
  else
    warn "could not write $PRUNE_FLOOR_FILE"
  fi
fi
prune_offsite || true

log "backup OK: $NAME (${SIZE_MB} MB, encrypted, local + offsite)"
