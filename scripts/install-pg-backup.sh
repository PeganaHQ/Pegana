#!/usr/bin/env bash
# install-pg-backup.sh — idempotent setup for pg-backup.sh on the prod box.
#   - encryption key: generate at ~/.pegana-backup-key if missing
#   - local backup dir (~/backups) and textfile metrics dir (~/.pegana-metrics)
#   - cron entry: every 6h (matches launch-runbook <6h requirement)
#
# Run on the prod box as deploy:
#   bash ~/pegana/scripts/install-pg-backup.sh

set -euo pipefail

CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
BACKUP_SCRIPT="$HOME/pegana/scripts/pg-backup.sh"
RESTORE_SCRIPT="$HOME/pegana/scripts/pg-restore.sh"
LOG="$HOME/.pg-backup.log"
BACKUP_DIR="${PEGANA_BACKUP_DIR:-$HOME/backups}"
METRICS_DIR="${PEGANA_BACKUP_METRICS_DIR:-$HOME/.pegana-metrics}"
LIFECYCLE_PENDING_MARKER="$HOME/.pegana-r2-lifecycle-pending"
MARKER="# pegana-pg-backup"

chmod +x "$BACKUP_SCRIPT" "$RESTORE_SCRIPT"

# 0. Generate encryption key if missing (32 bytes random, base64-encoded)
if [[ ! -e "$KEY" ]]; then
  echo "Generating new encryption key at $KEY ..."
  openssl rand -base64 32 > "$KEY"
  chmod 0600 "$KEY"
  echo
  echo "⚠️  CRITICAL: Back up this key to:"
  echo "    1. Your laptop (e.g., 1Password, USB)"
  echo "    2. At least one offline location"
  echo "    Without this key, encrypted backups are unrecoverable."
  echo
  echo "Key fingerprint (sha256): $(sha256sum "$KEY" | awk '{print $1}' | head -c 16)..."
  echo
fi

# 1. Local backup + metrics directories. The metrics dir is bind-mounted
#    read-only into the node-exporter container (docker-compose.yml), which
#    runs as nobody, so it must be world-readable; it only holds timestamps.
mkdir -p "$BACKUP_DIR" "$METRICS_DIR"
chmod 0700 "$BACKUP_DIR"
chmod 0755 "$METRICS_DIR"

# 2. Offsite retention. pg-backup.sh prunes R2 objects older than
#    PEGANA_BACKUP_OFFSITE_RETENTION_DAYS (default 30) itself, one object at a
#    time with `rclone deletefile`, which only needs an Object Read & Write
#    token. The sweep is fail-safe: it never touches objects older than the
#    first successful upload (~/.pegana-offsite-prune-floor) and needs 7 newer
#    verified dumps offsite (1 once archive/ holds a dump). See pg-backup.sh.
#    The old `aws s3api put-bucket-lifecycle-configuration` step needed both
#    the aws CLI (not installable on Ubuntu 24.04) and an admin token, so it
#    never ran on the Hostinger box. A bucket lifecycle rule set in the
#    Cloudflare dashboard is still a fine belt-and-braces addition.
rm -f "$LIFECYCLE_PENDING_MARKER"
if [[ ! -r "$CREDS" ]]; then
  echo "WARNING: $CREDS missing: backups will be LOCAL ONLY and every run"
  echo "         exits 4 (offsite failed) until it exists, or set"
  echo "         PEGANA_BACKUP_OFFSITE=off in the cron line to opt out."
fi
command -v rclone >/dev/null 2>&1 \
  || echo "WARNING: rclone not installed; offsite upload will fail."

# 3. Cron entry — every 6h on the hour. 0600 log perms.
# Dedupe by BOTH marker AND script path: handles legacy crons added without
# the marker (e.g., one-off manual installs during prod debug).
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$MARKER|/scripts/pg-backup\.sh" > "$TMP" || true
cat >> "$TMP" <<EOF
$MARKER (Postgres backup: local rotation + R2 every 6h)
0 */6 * * * $BACKUP_SCRIPT >> $LOG 2>&1
EOF
crontab "$TMP"
rm "$TMP"

# Ensure log file has tight perms (cron creates with umask)
touch "$LOG" && chmod 0600 "$LOG"

echo "Cron installed:"
crontab -l | grep -A1 pegana-pg-backup
echo
echo "Manual run:   $BACKUP_SCRIPT"
echo "List backups: $RESTORE_SCRIPT list"
echo "Restore:      $RESTORE_SCRIPT restore <NAME|PATH> --into NEW_DB"
echo "Local copies: $BACKUP_DIR"
echo "Metrics:      $METRICS_DIR/pegana_backup.prom"
echo "Logs:         $LOG"
echo "Key file:     $KEY (back up off-host!)"
