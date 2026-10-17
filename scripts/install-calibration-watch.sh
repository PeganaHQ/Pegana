#!/usr/bin/env bash
# Install/refresh cron entries for calibration-watch.sh on Hetzner.
# Idempotent — safe to re-run after a `git pull`.
#
# Also removes the TEMPORARY launch-24h-watch cron if present (it was a
# post-launch monitor that floods Telegram every 5min with false-positive
# "Phase-0 not safe to amplify" alerts long after launch — see
# uninstall-launch-24h-watch.sh for details).
#
# Run on the Hetzner host as the `deploy` user:
#   bash ~/pegana/scripts/install-calibration-watch.sh

set -euo pipefail

SCRIPT="$HOME/pegana/scripts/calibration-watch.sh"
LOG="$HOME/.calibration-watch.log"
MARKER="# pegana-calibration-watch"

chmod +x "$SCRIPT"
chmod +x "$0"

# Remove the temporary launch-24h-watch cron if it exists (stops the
# 5-min "🛰 Pegana launch watch" Telegram flood).
LAUNCH_WATCH_MARKER="# pegana-launch-24h-watch"
LAUNCH_WATCH_SCRIPT="$HOME/pegana/scripts/launch-24h-watch.sh"
TMP_LAUNCH="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$LAUNCH_WATCH_MARKER|/scripts/launch-24h-watch\.sh" > "$TMP_LAUNCH" || true
crontab "$TMP_LAUNCH"
rm "$TMP_LAUNCH"

# Remove any prior pegana-calibration-watch lines, then append fresh ones.
# Dedupe by BOTH marker AND script path: handles legacy crons added without
# the marker (e.g., one-off manual installs).
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$MARKER|/scripts/calibration-watch\.sh" > "$TMP" || true

cat >> "$TMP" <<EOF
$MARKER (daily summary at 09:00 UTC)
0 9 * * * $SCRIPT --daily >> $LOG 2>&1
$MARKER (anomaly check every 5min)
*/5 * * * * $SCRIPT --watch >> $LOG 2>&1
EOF

crontab "$TMP"
rm "$TMP"

# Ensure log file has tight perms — defends against any BOT_TOKEN leak via
# curl error output even though the script also redacts.
touch "$LOG" && chmod 0600 "$LOG"

echo "Cron installed:"
crontab -l | grep -A1 pegana-calibration-watch
echo
echo "Logs: $LOG"
echo "Manual run:   $SCRIPT --daily   (sends now)"
echo "Self-test:    $SCRIPT --test    (prints, no send)"
