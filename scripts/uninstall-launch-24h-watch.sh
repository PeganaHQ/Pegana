#!/usr/bin/env bash
# Remove the launch 24h watch cron from Hetzner.
#
# The launch-24h-watch was a TEMPORARY post-launch anomaly monitor (a 24h
# window). Long after launch it keeps firing "🚨 Phase-0 not safe to amplify"
# to the user-facing Telegram chat every 5 minutes — not because assets are
# depegged (they read PEGGED) but because its `bad_phase0` query also trips on
# `engine_state_snapshot.updated_at < now() - interval '5 minutes'` (a
# freshness clause), so a stale snapshot table pings on every tick. This
# uninstaller stops that flood. (Mirror of install-launch-24h-watch.sh.)

set -euo pipefail

MARKER="# pegana-launch-24h-watch"

TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -vE "$MARKER|/scripts/launch-24h-watch\.sh" > "$TMP" || true
crontab "$TMP"
rm "$TMP"

echo "launch-24h-watch cron removed. Remaining pegana crons:"
crontab -l 2>/dev/null | grep -i pegana || echo "  (none)"
echo
echo "The 5-minute '🛰 Pegana launch watch' Telegram flood will now stop."
echo "Log left in place: \$HOME/.pegana-launch-24h-watch.log"
