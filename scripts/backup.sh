#!/usr/bin/env bash
# Pegana Postgres backup — pg_dump to .sql.gz, retain N locally, push to R2.
#
# Designed to be invoked from cron on the prod box. Idempotent: re-running
# in the same minute produces a different filename (timestamps include
# seconds) so no clobber risk.
#
# Env vars:
#   PEGANA_PG_CONTAINER   docker container running postgres (default: pegana-postgres-1)
#   PEGANA_PG_USER        postgres role (default: pegana)
#   PEGANA_PG_DB          database name (default: pegana)
#   PEGANA_BACKUP_DIR     local backup dir (default: /backups)
#   PEGANA_BACKUP_KEEP    keep N most recent locally (default: 14)
#   PEGANA_BACKUP_R2      rclone remote:bucket (default: empty = skip R2 push)
#
# Exits non-zero on any failure so cron MAILTO surfaces the error.

set -euo pipefail

PG_CONTAINER="${PEGANA_PG_CONTAINER:-pegana-postgres-1}"
PG_USER="${PEGANA_PG_USER:-pegana}"
PG_DB="${PEGANA_PG_DB:-pegana}"
BACKUP_DIR="${PEGANA_BACKUP_DIR:-/backups}"
KEEP="${PEGANA_BACKUP_KEEP:-14}"
R2_REMOTE="${PEGANA_BACKUP_R2:-}"

TS=$(date -u +%Y%m%d-%H%M%S)
OUT="${BACKUP_DIR}/pegana-${TS}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping ${PG_DB} from ${PG_CONTAINER} → ${OUT}"
docker exec "$PG_CONTAINER" pg_dump \
    -U "$PG_USER" \
    -d "$PG_DB" \
    --no-owner \
    --no-acl \
  | gzip > "$OUT"

SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
echo "[backup] ${OUT} (${SIZE} bytes)"

# Sanity check: a backup that compressed to <1KB almost certainly captured
# nothing (broken pg_dump pipe, empty DB, etc.). Fail loud rather than
# letting the broken backup roll into retention.
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] FAIL: backup file is suspiciously small (<1KB)" >&2
  exit 2
fi

# Local retention — keep the N newest, delete the rest. Sort by modification
# time so a backfilled file from a different timestamp slot still ages out
# correctly.
echo "[backup] pruning local retention (keep ${KEEP})"
ls -1t "${BACKUP_DIR}"/pegana-*.sql.gz 2>/dev/null \
  | tail -n +$((KEEP + 1)) \
  | while read -r old; do
      echo "[backup] removing $old"
      rm -f "$old"
    done

# Off-box copy (Cloudflare R2 via rclone). Skipped when PEGANA_BACKUP_R2
# is unset — useful in dev where you don't want to ship local data to
# remote storage.
if [ -n "$R2_REMOTE" ]; then
  echo "[backup] pushing to ${R2_REMOTE}"
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup] WARN: PEGANA_BACKUP_R2 set but rclone not installed; skipping push" >&2
  else
    rclone copy "$OUT" "$R2_REMOTE"
    echo "[backup] pushed ${OUT##*/} to ${R2_REMOTE}"
  fi
fi

echo "[backup] done"
