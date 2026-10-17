#!/usr/bin/env bash
# Install/refresh the launch 24h watch cron on Hetzner.

set -euo pipefail

SCRIPT="$HOME/pegana/scripts/launch-24h-watch.sh"
LOG="$HOME/.pegana-launch-24h-watch.log"
MARKER="# pegana-launch-24h-watch"

chmod +x "$SCRIPT" "$0"

TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$MARKER|/scripts/launch-24h-watch\.sh" > "$TMP" || true

cat >> "$TMP" <<EOF
$MARKER (post-launch anomaly check every 5min)
*/5 * * * * $SCRIPT --watch >> $LOG 2>&1
EOF

crontab "$TMP"
rm "$TMP"
touch "$LOG" && chmod 0600 "$LOG"

echo "Cron installed:"
crontab -l | grep -A1 pegana-launch-24h-watch
echo
echo "Logs: $LOG"
echo "Self-test: $SCRIPT --check"
