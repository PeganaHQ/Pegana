#!/usr/bin/env bash
# install-pg-backup.sh — idempotent setup for pg-backup.sh on Hetzner.
#   - encryption key: generate at ~/.pegana-backup-key if missing
#   - lifecycle rule on R2 bucket: auto-delete objects > 30 days (best effort)
#   - cron entry: every 6h (matches launch-runbook <6h requirement)
#
# Run on Hetzner as deploy:
#   bash ~/pegana/scripts/install-pg-backup.sh

set -euo pipefail

CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
BACKUP_SCRIPT="$HOME/pegana/scripts/pg-backup.sh"
RESTORE_SCRIPT="$HOME/pegana/scripts/pg-restore.sh"
LOG="$HOME/.pg-backup.log"
LIFECYCLE_PENDING_MARKER="$HOME/.pegana-r2-lifecycle-pending"
MARKER="# pegana-pg-backup"

chmod +x "$BACKUP_SCRIPT" "$RESTORE_SCRIPT"

[[ -r "$CREDS" ]] || { echo "FATAL: $CREDS missing" >&2; exit 2; }

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

# 1. Parse creds (line-by-line, no bash exec)
declare R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_ENDPOINT
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  v="${v%\"}"; v="${v#\"}"
  case "$k" in
    R2_ACCESS_KEY_ID)     R2_ACCESS_KEY_ID="$v" ;;
    R2_SECRET_ACCESS_KEY) R2_SECRET_ACCESS_KEY="$v" ;;
    R2_BUCKET)            R2_BUCKET="$v" ;;
    R2_ENDPOINT)          R2_ENDPOINT="$v" ;;
  esac
done < "$CREDS"

# 2. Lifecycle rule — auto-delete objects > 30 days
LIFECYCLE_JSON=$(cat <<'EOF'
{
  "Rules": [
    {
      "ID": "delete-after-30d",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {"Days": 30}
    }
  ]
}
EOF
)
echo "$LIFECYCLE_JSON" > /tmp/lifecycle.json

if AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
   AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
   AWS_REGION="auto" \
   aws s3api put-bucket-lifecycle-configuration \
     --bucket "$R2_BUCKET" \
     --endpoint-url "$R2_ENDPOINT" \
     --lifecycle-configuration file:///tmp/lifecycle.json 2>/tmp/lifecycle.err; then
  echo "Lifecycle rule installed: auto-delete > 30 days"
  rm -f "$LIFECYCLE_PENDING_MARKER"
else
  if grep -q "AccessDenied" /tmp/lifecycle.err; then
    # Mark as pending; calibration-watch --daily will surface this until cleared
    date -u +%FT%TZ > "$LIFECYCLE_PENDING_MARKER"
    echo
    echo "⚠️  Lifecycle rule NOT installed — API token lacks Admin scope."
    echo "    Calibration-watch will remind you daily until set."
    echo "    Set it manually via Cloudflare dashboard:"
    echo "      R2 → ${R2_BUCKET} → Object Lifecycle Rules → Add rule"
    echo "      Action: Delete objects, Age: 30 days, Prefix: (empty)"
    echo "    Then: rm $LIFECYCLE_PENDING_MARKER"
    echo
  else
    echo "ERROR setting lifecycle:"
    cat /tmp/lifecycle.err
  fi
fi
rm -f /tmp/lifecycle.json /tmp/lifecycle.err

# 3. Cron entry — every 6h on the hour. 0600 log perms.
# Dedupe by BOTH marker AND script path: handles legacy crons added without
# the marker (e.g., one-off manual installs during prod debug).
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$MARKER|/scripts/pg-backup\.sh" > "$TMP" || true
cat >> "$TMP" <<EOF
$MARKER (Postgres backup to R2 every 6h)
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
echo "Restore:      $RESTORE_SCRIPT restore <NAME> [--into NEW_DB]"
echo "Logs:         $LOG"
echo "Key file:     $KEY (back up off-host!)"
