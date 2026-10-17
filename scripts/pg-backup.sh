#!/usr/bin/env bash
# pg-backup.sh — dump prod Postgres, encrypt client-side, upload to R2.
#
# Runs as cron (every 6h) per launch-runbook requirement of <6h dump age.
# Reads R2 creds from ~/.pegana-r2-creds.env (deploy-owned, 0600).
# Reads encryption key from ~/.pegana-backup-key (deploy-owned, 0600).
# Lifecycle rule on bucket auto-deletes objects older than 30 days.
#
# Encryption: openssl AES-256-CBC with PBKDF2 (100k iters). The key file
# MUST be backed up off-host or losing it = unrecoverable backups.

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
STATE_FILE="${PEGANA_BACKUP_STATE:-$HOME/.pegana-last-backup.txt}"

cd "$PEGANA_DIR"

[[ -r "$CREDS" ]] || { echo "FATAL: cannot read R2 creds at $CREDS" >&2; exit 2; }
[[ -r "$KEY"   ]] || { echo "FATAL: cannot read encryption key at $KEY" >&2; exit 2; }

# Parse creds safely (no `source`, no bash exec) — line-by-line key=value.
declare R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_ENDPOINT
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  v="${v%\"}"; v="${v#\"}"   # strip surrounding quotes if any
  case "$k" in
    R2_ACCESS_KEY_ID)     R2_ACCESS_KEY_ID="$v" ;;
    R2_SECRET_ACCESS_KEY) R2_SECRET_ACCESS_KEY="$v" ;;
    R2_BUCKET)            R2_BUCKET="$v" ;;
    R2_ENDPOINT)          R2_ENDPOINT="$v" ;;
  esac
done < "$CREDS"

env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}
PG_USER="$(env_get POSTGRES_USER)"
PG_DB="$(env_get POSTGRES_DB)"
PG_PASSWORD="$(env_get POSTGRES_PASSWORD)"
SENTRY_DSN_VAL="$(env_get SENTRY_DSN)"

# ─── Sentry cron monitoring ──────────────────────────────────────────────
# Auto-upserts monitor "pegana-pg-backup" on first check-in. Schedule must
# match the cron line in scripts/install-pg-backup.sh (0 */6 * * *).
# checkin_margin=15 = 15min grace after expected time before "missed".
# max_runtime=15 = alert if backup takes >15min (current backup is ~10s).
MONITOR_SLUG="pegana-pg-backup"
MONITOR_SCHED="0 */6 * * *"
MONITOR_MARGIN=15
MONITOR_MAX=15

sentry_checkin() {
  local status="$1"
  [[ -z "${SENTRY_DSN_VAL:-}" ]] && return 0
  local key ingest project
  key=$(printf '%s' "$SENTRY_DSN_VAL"     | sed -E 's|^https?://([^@]+)@.*|\1|')
  ingest=$(printf '%s' "$SENTRY_DSN_VAL"  | sed -E 's|^https?://[^@]+@([^/]+)/.*|\1|')
  project=$(printf '%s' "$SENTRY_DSN_VAL" | sed -E 's|.*/([0-9]+)$|\1|')
  # Sentry crons HTTP API: sentry_key in path, status MUST be in JSON body
  # (returns 422 if status is in query params). Refs: tested 2026-05-29.
  curl -sS --max-time 8 -X POST \
    "https://${ingest}/api/${project}/cron/${MONITOR_SLUG}/${key}/" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"${MONITOR_SCHED}\"},\"checkin_margin\":${MONITOR_MARGIN},\"max_runtime\":${MONITOR_MAX},\"timezone\":\"Etc/UTC\"}}" \
    -o /dev/null 2>/dev/null || true
}
TMP=""
SHA_FILE=""
backup_exit() {
  local status=$?
  [[ -z "$TMP" ]] || rm -f "$TMP"
  [[ -z "$SHA_FILE" ]] || rm -f "$SHA_FILE"
  sentry_checkin $([ "$status" -eq 0 ] && echo ok || echo error)
  exit "$status"
}
trap backup_exit EXIT

TS=$(date -u +'%Y%m%dT%H%M%SZ')
NAME="pegana-${TS}.dump.enc"
TMP=$(mktemp -t "pegana-backup-XXXXXX")
SHA_FILE=$(mktemp -t "pegana-backup-sha256-XXXXXX")

# pg_dump (compressed binary) → openssl encrypt → tmp file.
# PGPASSWORD via -e: visible to other users via `ps auxe` if any exist on the
# box (deploy and root only on Hetzner — accepted risk). The --env-file flag
# isn't supported by `docker compose exec` (only by `run` / `up`); the audit
# P2 fix tried that and broke at runtime.
docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges \
  --format=custom --compress=6 \
| openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass "file:$KEY" \
  > "$TMP"

SIZE_BYTES=$(stat -c%s "$TMP" 2>/dev/null || stat -f%z "$TMP")
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))

# Upload encrypted file to R2 via the preconfigured `r2:` rclone remote.
# 2026-10-16: switched from `aws s3 cp` to rclone — awscli has no package
# candidate on Ubuntu 24.04 (Hostinger box) and rclone is already configured.
rclone copyto "$TMP" "r2:${R2_BUCKET}/${NAME}" \
  --header-upload "X-Amz-Meta-Source: pegana-prod-02" \
  --header-upload "X-Amz-Meta-Host: $(hostname)" \
  --header-upload "X-Amz-Meta-Pg-Db: ${PG_DB}" \
  --header-upload "X-Amz-Meta-Encryption: aes-256-cbc-pbkdf2"

REMOTE_SIZE=$(rclone lsjson "r2:${R2_BUCKET}/${NAME}" | sed -n 's/.*"Size":\([0-9]*\).*/\1/p')
if [[ "$REMOTE_SIZE" != "$SIZE_BYTES" ]]; then
  echo "FATAL: uploaded object size mismatch (local=$SIZE_BYTES, remote=$REMOTE_SIZE)" >&2
  exit 3
fi

SHA256=$(sha256sum "$TMP" | cut -d' ' -f1)
printf '%s  %s\n' "$SHA256" "$NAME" > "$SHA_FILE"
rclone copyto "$SHA_FILE" "r2:${R2_BUCKET}/${NAME}.sha256"

# Record success — calibration-watch reads this to alert on stale backups
printf '%s\t%dMB\t%s\n' "$NAME" "$SIZE_MB" "$(date -u +%FT%TZ)" > "$STATE_FILE"

echo "[$(date -u +%FT%TZ)] backup OK: $NAME (${SIZE_MB} MB, encrypted)"
