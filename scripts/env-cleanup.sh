#!/usr/bin/env bash
# env-cleanup.sh — bring the prod stack .env back in line with .env.example
# for the key the 2026-10-21 r2 audit flagged (finding #48):
#
#   RUST_LOG                   prod had `info,sqlx=warn,pegana=debug`; the
#                              shipped default is `info,sqlx=warn`.
#
# ALERTMANAGER_TELEGRAM_* keys are NEVER removed: alertmanager delivers to
# Telegram through ALERTMANAGER_TELEGRAM_BOT_TOKEN and
# ALERTMANAGER_TELEGRAM_CHAT_ID (ops/alertmanager/render-config.sh). An
# earlier version of this script dropped them as dead secrets; that was undone
# when the Telegram receiver came back (r3).
#
# Optional (--drop-bot-keys): BOT_TOKEN, BOT_INTERNAL_SECRET,
# DOGFOOD_TELEGRAM_CHAT_ID and any other TELEGRAM_* key from the dogfood bot.
# Not removed by default because two scripts still post to Telegram when
# BOT_TOKEN and DOGFOOD_TELEGRAM_CHAT_ID are both set:
# scripts/calibration-watch.sh (its report) and scripts/launch-24h-watch.sh
# (its alerts). Without them each writes to stdout (its cron log). That is an
# owner decision. Even with --drop-bot-keys, DOGFOOD_TELEGRAM_CHAT_ID is KEPT
# while ALERTMANAGER_TELEGRAM_CHAT_ID is unset or empty, because alertmanager
# then falls back to it for its chat id.
#
# Dry run by default: prints what would change, by KEY NAME only (no secret
# value is ever printed; RUST_LOG is not a secret and is shown). --apply writes
# the change atomically, keeping a 0600 copy of the old file OUTSIDE the
# deploy checkout (deploy.sh refuses to deploy when it finds untracked files
# such as a .env.bak next to .env).
#
# It never recreates containers. When RUST_LOG changed it prints the exact
# deploy.sh command to run from the laptop (a restart does not reload .env).
#
# Usage (on the box, as deploy):
#   bash ~/pegana/scripts/env-cleanup.sh                 # dry run
#   bash ~/pegana/scripts/env-cleanup.sh --apply
# From the laptop, without copying anything to the box:
#   ssh "$PEGANA_DEPLOY_SERVER" 'bash -s -- --apply' < scripts/env-cleanup.sh
#
# Options:
#   --env-file PATH     default ~/pegana/.env
#   --backup-dir PATH   default ~/.pegana-env-backups
#   --drop-bot-keys     also remove the dogfood bot's Telegram keys
#   --apply             write the change (otherwise dry run)
#
# Exit: 0 ok (changed, or nothing to do), 1 usage, 2 cannot read/write.

set -euo pipefail

ENV_FILE="$HOME/pegana/.env"
BACKUP_DIR="$HOME/.pegana-env-backups"
APPLY=false
DROP_BOT=false
RUST_LOG_DEFAULT="info,sqlx=warn"
# The compose services whose environment interpolates ${RUST_LOG}.
RUST_LOG_SERVICES="indexer engine dispatcher api"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)      ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    --backup-dir)    BACKUP_DIR="${2:?--backup-dir needs a path}"; shift 2 ;;
    --drop-bot-keys) DROP_BOT=true; shift ;;
    --apply)         APPLY=true; shift ;;
    -h|--help)       sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 2; }

# Nothing is dropped by default. ALERTMANAGER_TELEGRAM_* never matches: the
# patterns below are anchored and none starts with ALERTMANAGER_.
drop_re='^__never_drop__$'
fallback_kept=false
if $DROP_BOT; then
  drop_re='^(BOT_TOKEN|BOT_INTERNAL_SECRET|DOGFOOD_TELEGRAM_CHAT_ID|TELEGRAM_[A-Za-z0-9_]*)$'
  # Keep the alertmanager chat-id fallback alive while it is the only chat id.
  if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?ALERTMANAGER_TELEGRAM_CHAT_ID=["'"'"']?[^"'"'"'[:space:]]' "$ENV_FILE"; then
    drop_re='^(BOT_TOKEN|BOT_INTERNAL_SECRET|TELEGRAM_[A-Za-z0-9_]*)$'
    grep -Eq '^[[:space:]]*(export[[:space:]]+)?DOGFOOD_TELEGRAM_CHAT_ID=' "$ENV_FILE" && fallback_kept=true
  fi
fi

# Work files live outside the deploy checkout: a leftover file next to .env
# would make every later deploy.sh run refuse.
tmp="$(mktemp)"
report="$(mktemp)"
staged=""
trap 'rm -f "$tmp" "$report" ${staged:+"$staged"}' EXIT

# One pass, order preserved. Comments, blank lines and every other key are
# copied byte for byte. The report lists key names and RUST_LOG values only.
awk -v drop_re="$drop_re" -v def="$RUST_LOG_DEFAULT" -v report="$report" -v q="'" '
  function unq(v) {
    if (length(v) >= 2 && ((substr(v, 1, 1) == "\"" && substr(v, length(v), 1) == "\"") ||
                           (substr(v, 1, 1) == q && substr(v, length(v), 1) == q)))
      v = substr(v, 2, length(v) - 2)
    return v
  }
  /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
  {
    key = $0; sub(/=.*/, "", key); sub(/^[[:space:]]*export[[:space:]]+/, "", key)
    gsub(/[[:space:]]/, "", key)
    if (key ~ drop_re) { print "remove " key >> report; next }
    if (key == "RUST_LOG" && index($0, "=") > 0) {
      val = substr($0, index($0, "=") + 1)
      if (unq(val) != def) {
        print "rust_log " unq(val) >> report
        print "RUST_LOG=" def
        next
      }
    }
    print
  }
' "$ENV_FILE" > "$tmp"

removed=$(grep -c '^remove ' "$report" || true)
rust_from=$(sed -n 's/^rust_log //p' "$report" | tail -1)

echo "env file: $ENV_FILE"
if [[ -n "$rust_from" ]]; then
  echo "  RUST_LOG: '$rust_from' -> '$RUST_LOG_DEFAULT'"
else
  echo "  RUST_LOG: already '$RUST_LOG_DEFAULT' or unset (compose default is the same)"
fi
if (( removed > 0 )); then
  sed -n 's/^remove /  remove key: /p' "$report"
else
  echo "  no retired keys present"
fi
if $fallback_kept; then
  echo "  kept: DOGFOOD_TELEGRAM_CHAT_ID (alertmanager's chat id fallback while ALERTMANAGER_TELEGRAM_CHAT_ID is unset)"
fi
if ! $DROP_BOT; then
  present=$(grep -E '^(BOT_TOKEN|BOT_INTERNAL_SECRET|DOGFOOD_TELEGRAM_CHAT_ID|TELEGRAM_[A-Za-z0-9_]*)=' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ' || true)
  [[ -z "$present" ]] || echo "  kept (owner decision, see --drop-bot-keys): $present"
fi

if [[ -z "$rust_from" ]] && (( removed == 0 )); then
  echo "nothing to change"
  exit 0
fi

if ! $APPLY; then
  echo "dry run: nothing written. Re-run with --apply."
  exit 0
fi

umask 077
mkdir -p "$BACKUP_DIR" || { echo "cannot create $BACKUP_DIR" >&2; exit 2; }
chmod 0700 "$BACKUP_DIR"
backup="$BACKUP_DIR/env.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENV_FILE" "$backup" || { echo "cannot back up to $backup" >&2; exit 2; }
chmod 0600 "$backup"
# Stage next to the backup (same filesystem as the checkout under $HOME), then
# rename over .env so a reader never sees a half-written file.
staged="$BACKUP_DIR/.env.staged.$$"
cp "$tmp" "$staged" && chmod 0600 "$staged" \
  || { echo "cannot stage the new file in $BACKUP_DIR" >&2; exit 2; }
mv -f "$staged" "$ENV_FILE" || { echo "cannot write $ENV_FILE" >&2; exit 2; }
staged=""
echo "written. previous file kept at $backup (0600)"

if [[ -n "$rust_from" ]]; then
  echo "next, from the laptop (a restart does not reload .env):"
  echo "  ./scripts/deploy.sh --config-only --services '$RUST_LOG_SERVICES'"
else
  echo "no container reads the removed keys; no recreate needed"
fi
