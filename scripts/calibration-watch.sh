#!/usr/bin/env bash
# Calibration watch — Trust Layer v0.1.0 dogfood monitor (2026-05-29 → 2026-06-10).
#
# Modes:
#   --daily   Once-a-day summary to founder's TG (cron: 0 9 * * *)
#   --watch   Anomaly check; posts to TG only if something is off (cron: */5 * * * *)
#   --test    Run both modes once and print to stdout (no TG send)
#
# Anomaly definitions:
#   - new commit failures since last run
#   - evidence rows stuck >10min uncommitted
#   - wallet balance < 0.02 SOL (commits will start failing soon)
#   - stale engine_state_snapshot (>5min) on an active asset — the REAL liveness
#     signal (a wedged engine stops upserting snapshots). NOTE: "time since last
#     alert" is deliberately NOT a liveness proxy — a calm market produces no
#     state transitions and therefore no alerts for many hours by design; firing
#     on it is a false positive (it alarmed the founder pre-verdict 2026-06-09).
#   - last backup > 8h ago (cron runs every 6h)
#   - R2 lifecycle rule pending in dashboard
#   - waiver expiry countdown (T-7d warning, T-1d urgent, T-0d expired)
#
# State persistence: $HOME/.pegana-calibration-state.json (survives reboot,
# unlike /tmp).

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
STATE_FILE="${STATE_FILE:-$HOME/.pegana-calibration-state.json}"
COMMIT_PUBKEY="${COMMIT_PUBKEY:-7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9}"
VERDICT_DATE="${VERDICT_DATE:-2026-06-10}"
BACKUP_STATE="${PEGANA_BACKUP_STATE:-$HOME/.pegana-last-backup.txt}"
LIFECYCLE_PENDING_MARKER="$HOME/.pegana-r2-lifecycle-pending"
WAIVER_TRACKER="${PEGANA_DIR}/docs/security/waiver-expiry-tracker.txt"
MODE="${1:-}"

cd "$PEGANA_DIR"

# Read only what we need from .env, stripping surrounding quotes if present.
env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}
BOT_TOKEN="$(env_get BOT_TOKEN)"
CHAT_ID="$(env_get DOGFOOD_TELEGRAM_CHAT_ID)"
PG_USER="$(env_get POSTGRES_USER)"; PG_USER="${PG_USER:-pegana}"
PG_DB="$(env_get POSTGRES_DB)";     PG_DB="${PG_DB:-pegana}"
SENTRY_DSN_VAL="$(env_get SENTRY_DSN)"

# The Telegram bot is retired. Without BOT_TOKEN/DOGFOOD_TELEGRAM_CHAT_ID this
# watcher degrades to stdout (cron mail) instead of failing — the ops signal is
# the report, and the transport is optional.
if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
  echo "note: BOT_TOKEN/DOGFOOD_TELEGRAM_CHAT_ID unset — reports go to stdout" >&2
fi

# ─── Sentry cron monitoring ──────────────────────────────────────────────
# Auto-upserts the monitor on Sentry side (first check-in creates it with
# the inline config). 1 monitor per mode so --daily and --watch can have
# different schedules + margins. Best-effort: errors are swallowed so a
# Sentry outage never breaks the cron itself.

case "$MODE" in
  --daily) MONITOR_SLUG="pegana-watch-daily"   ; MONITOR_SCHED="0 9 * * *"   ; MONITOR_MARGIN=10 ; MONITOR_MAX=5  ;;
  --watch) MONITOR_SLUG="pegana-watch-anomaly" ; MONITOR_SCHED="*/5 * * * *" ; MONITOR_MARGIN=2  ; MONITOR_MAX=2  ;;
  *)       MONITOR_SLUG="" ;;  # --test or other: no Sentry checkin
esac

sentry_checkin() {
  local status="$1"
  [[ -z "${SENTRY_DSN_VAL:-}" || -z "$MONITOR_SLUG" ]] && return 0
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
trap '_pegana_st=$?; sentry_checkin $([ "$_pegana_st" -eq 0 ] && echo ok || echo error)' EXIT

psql_q() {
  local out
  out=$(docker compose exec -T postgres sh -c \
    "psql -U $PG_USER -d $PG_DB -tA -c \"$1\"" 2>/dev/null || true)
  # Default empty to 0 for safe arithmetic comparisons
  printf '%s' "${out:-0}"
}

wallet_sol() {
  curl -sS --max-time 5 https://api.mainnet-beta.solana.com \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"${COMMIT_PUBKEY}\"]}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(f'{r[\"result\"][\"value\"]/1e9:.6f}')" \
    2>/dev/null || echo "?"
}

# Send to TG; redact BOT_TOKEN from any captured error output so it can't leak
# to the cron log on curl failures.
tg_send() {
  local text="$1"
  if [[ "$MODE" == "--test" ]]; then
    echo "--- would send to TG ---"; echo "$text"; echo "------------------------"
    return
  fi
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    echo "--- calibration watch report ---"; echo "$text"; echo "-------------------------------"
    return
  fi
  local err
  err=$(curl --silent --show-error --max-time 10 \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${text}" \
    -o /dev/null 2>&1) || true
  if [[ -n "$err" ]]; then
    # Belt-and-suspenders: even if curl ever decided to print the URL, sed kills it
    printf '%s\n' "$err" | sed "s|${BOT_TOKEN}|***REDACTED***|g" >&2
  fi
}

days_until_verdict() {
  local target now
  target=$(date -d "$VERDICT_DATE" +%s 2>/dev/null || gdate -d "$VERDICT_DATE" +%s)
  now=$(date +%s)
  echo $(( (target - now) / 86400 ))
}

run_daily() {
  local alerts_24h evidence_24h committed_24h failures_total stuck sol days_left top
  alerts_24h=$(psql_q "SELECT count(*) FROM alerts WHERE detected_at > now() - interval '24 hours';")
  evidence_24h=$(psql_q "SELECT count(*) FROM alert_evidence WHERE created_at > now() - interval '24 hours';")
  committed_24h=$(psql_q "SELECT count(*) FROM alert_evidence WHERE created_at > now() - interval '24 hours' AND onchain_tx_sig IS NOT NULL;")
  failures_total=$(psql_q "SELECT count(*) FROM alert_evidence_commit_failures;")
  stuck=$(psql_q "SELECT count(*) FROM alert_evidence WHERE onchain_tx_sig IS NULL AND created_at < now() - interval '5 minutes';")
  sol=$(wallet_sol)
  days_left=$(days_until_verdict)
  top=$(psql_q "SELECT asset || ' (' || count(*) || ')' FROM alerts WHERE detected_at > now() - interval '24 hours' GROUP BY asset ORDER BY count(*) DESC LIMIT 3;" | tr '\n' ' ')
  [[ -z "$top" || "$top" == "0" ]] && top="—"

  # Optional lifecycle pending warning
  local lifecycle_note=""
  if [[ -f "$LIFECYCLE_PENDING_MARKER" ]]; then
    lifecycle_note="

⚠️ R2 lifecycle rule still pending in dashboard. See ~/.pegana-r2-lifecycle-pending"
  fi

  local msg="🛰 *Pegana calibration · daily*
\`$(date -u +'%Y-%m-%d %H:%M UTC')\` · *${days_left}d* until verdict ($VERDICT_DATE)

*Last 24h*
• alerts: \`${alerts_24h}\`
• evidence rows: \`${evidence_24h}\` (committed \`${committed_24h}\`)
• top: ${top}

*Current state*
• stuck >5min: \`${stuck}\`
• total commit failures: \`${failures_total}\`
• wallet: \`${sol} SOL\`${lifecycle_note}"

  tg_send "$msg"
}

run_watch() {
  local alerts=()
  local sol failures_now failures_prev delta stuck

  sol=$(wallet_sol)
  if [[ "$sol" != "?" ]] && python3 -c "import sys; sys.exit(0 if float('$sol') < 0.02 else 1)" 2>/dev/null; then
    alerts+=("⚠️ wallet low: \`${sol} SOL\` — refill before commits fail")
  fi

  # Fast check: backup encryption key present + readable. Without it, pg-backup
  # cron fails with `exit 2` and no further alert until the 8h-staleness check
  # below fires. Catch it within 5 min instead. (Audit P2 finding 2026-05-29.)
  if [[ ! -r "$HOME/.pegana-backup-key" ]]; then
    alerts+=("🔑 *backup encryption key missing or unreadable* (\`~/.pegana-backup-key\`) — pg-backup cron will fail until restored")
  fi

  # Same fast check for R2 creds. Both files are 0600 deploy-owned. Without
  # the creds file pg-backup still keeps verified LOCAL copies but every run
  # exits 4 (offsite upload failed) until it is restored.
  if [[ ! -r "$HOME/.pegana-r2-creds.env" ]]; then
    alerts+=("🔑 *R2 credentials missing or unreadable* (\`~/.pegana-r2-creds.env\`): backups are local-only until restored")
  fi

  # alert_evidence_commit_failures uses `last_error` (not `error_message`) +
  # there's no `failed_at` (we sort by last_attempted_at).
  failures_now=$(psql_q "SELECT count(*) FROM alert_evidence_commit_failures WHERE abandoned_at IS NULL;")
  failures_now="${failures_now:-0}"
  failures_prev=0
  if [[ -f "$STATE_FILE" ]]; then
    failures_prev=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('failures', 0))" 2>/dev/null || echo 0)
  fi
  if [[ "$failures_now" -gt "$failures_prev" ]]; then
    delta=$((failures_now - failures_prev))
    local last
    last=$(psql_q "SELECT coalesce(last_error, 'no message') FROM alert_evidence_commit_failures ORDER BY last_attempted_at DESC LIMIT 1;" | head -c 200)
    alerts+=("🚨 *${delta} new commit failure(s)*
last: \`${last}\`")
  fi

  # Stuck check — ONLY count rows that SHOULD have committed. Per engine
  # main.rs:713, only Depeg/Critical/BlackSwan transitions are committed
  # on-chain. DRIFT transitions write alert_evidence but never commit by
  # design. Counting them as "stuck" floods TG with false positives in
  # calm markets where most alerts are DRIFT (caught 2026-05-29 spam).
  # peg_state is a Postgres ENUM with UPPERCASE values (PEGGED, DRIFT,
  # DEPEG, CRITICAL, BLACK_SWAN, UNKNOWN). Cast to ::text for the IN clause
  # — using upper() directly on the enum errors ("function upper(peg_state)
  # does not exist") AND psql_q swallows errors via || true → silently
  # returns 0 → we'd never detect real stuck rows. Caught 2026-05-29.
  stuck=$(psql_q "SELECT count(*) FROM alert_evidence e \
JOIN alerts a ON a.id = e.alert_id \
WHERE e.onchain_tx_sig IS NULL \
  AND e.created_at < now() - interval '10 minutes' \
  AND a.to_state::text IN ('DEPEG','CRITICAL','BLACK_SWAN');")
  stuck="${stuck:-0}"
  # Dedup: don't fire if same count as last cycle (avoids 5-min repeats
  # of the identical alert). Only fire on TRANSITIONS (0→N or N→M where N != M).
  local stuck_prev=0
  if [[ -f "$STATE_FILE" ]]; then
    stuck_prev=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('stuck', 0))" 2>/dev/null || echo 0)
  fi
  if [[ "$stuck" -gt 0 && "$stuck" != "$stuck_prev" ]]; then
    alerts+=("⏱ *${stuck}* DEPEG/CRITICAL evidence row(s) stuck >10min uncommitted")
  fi

  # NOTE: we used to fire "last alert was Nh ago — engine alive?" here. Removed
  # 2026-06-14: time-since-last-alert is a bad liveness proxy. A calm market has
  # no state transitions → no alerts for many hours, which is correct, not a
  # wedge. It produced a false positive that alarmed the founder the night before
  # the calibration verdict. The stale engine_state_snapshot check below is the
  # real liveness signal (a wedged engine stops upserting snapshots within 5min).

  # Stale engine_state_snapshot — counter exists but never alerted on. If
  # recompute stops upserting (network partition engine↔postgres, schema
  # drift) the row ages out. After 5 min an active asset MUST have a recent
  # snapshot (recompute cadence is sub-30s). >0 stale = restart determinism
  # (ADR-0010) degrading silently, calibration data quality at risk.
  #
  # FX-CLASS WEEKEND EXEMPTION: stable_fx assets (EURC, BRZ) take their intrinsic
  # from a Pyth FX feed that goes dark Fri→Sun (forex closed), so their snapshot
  # legitimately freezes every weekend (verified live 2026-06-14: EURC dark Fri
  # 21:10 → Sun 21:00 UTC, snapshot frozen at PEGGED). Without this they'd trip
  # the stale check all weekend — the same false-positive class as the removed
  # "last alert" heartbeat. Boundaries buffered (Fri 20:30 → Sun 22:30 UTC) to
  # absorb forex-DST drift. A weekday FX outage is still caught; the engine's own
  # H12b freshness sweep tracks these assets year-round regardless.
  local fx_dark_exempt="a.class = 'stable_fx' AND (extract(dow from (now() at time zone 'UTC')) = 6 OR (extract(dow from (now() at time zone 'UTC')) = 5 AND (now() at time zone 'UTC')::time >= time '20:30') OR (extract(dow from (now() at time zone 'UTC')) = 0 AND (now() at time zone 'UTC')::time < time '22:30'))"
  stale_snap=$(psql_q "SELECT count(*) FROM engine_state_snapshot s \
JOIN assets a ON a.symbol = s.asset \
WHERE a.is_active = true \
  AND NOT ($fx_dark_exempt) \
  AND s.updated_at < now() - interval '5 minutes';")
  stale_snap="${stale_snap:-0}"
  local stale_assets="" stale_prev=""
  if [[ "$stale_snap" -gt 0 ]]; then
    stale_assets=$(psql_q "SELECT coalesce(string_agg(s.asset, ',' ORDER BY s.asset), '') FROM engine_state_snapshot s \
JOIN assets a ON a.symbol = s.asset \
WHERE a.is_active = true \
  AND NOT ($fx_dark_exempt) \
  AND s.updated_at < now() - interval '5 minutes';")
  fi
  # Dedup: fire only when the stale SET changes (mirrors the `stuck` check
  # above). Without this the identical alert re-fired every 5-min cron tick —
  # for hours during the 2026-06-01 pbUSDC episode, where one thin-pair source
  # published garbage the engine *correctly* rejected (so the snapshot froze
  # but recompute was healthy). Reworded too: the old "recompute may be
  # failing / determinism at risk" is misleading in the common case.
  if [[ -f "$STATE_FILE" ]]; then
    stale_prev=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('stale_assets',''))" 2>/dev/null || echo "")
  fi
  if [[ "$stale_snap" -gt 0 && "$stale_assets" != "$stale_prev" ]]; then
    alerts+=("📸 *${stale_snap}* active asset(s) with stale engine_state_snapshot (>5min): \`${stale_assets}\` — engine isn't completing recompute for these (a bad upstream tick was rejected, or the source is down). Check: \`docker compose logs --since 15m engine | grep -iE '${stale_assets//,/|}'\`")
  fi

  # Backup freshness — pg-backup writes the state file on success.
  # Dedup: fire only once per staleness episode (matching the pattern used
  # by stuck/failures/stale_snap above). Without this the identical alert
  # fired every 5-min cron tick while the backup remained stale — flooding
  # the founder's Telegram with the same message for hours. (Caught
  # 2026-08-04: user reported ~10-min repeat spam.)
  local backup_alerted=false
  if [[ -f "$STATE_FILE" ]]; then
    backup_alerted=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('backup_alerted', False))" 2>/dev/null || echo "False")
  fi
  if [[ -f "$BACKUP_STATE" ]]; then
    local last_ts last_epoch hours_since
    last_ts=$(awk -F'\t' '{print $3}' "$BACKUP_STATE" | head -1)
    last_epoch=$(date -d "$last_ts" +%s 2>/dev/null || gdate -d "$last_ts" +%s 2>/dev/null || echo 0)
    if [[ "$last_epoch" -gt 0 ]]; then
      hours_since=$(( ($(date +%s) - last_epoch) / 3600 ))
      if [[ "$hours_since" -gt 8 ]]; then
        # Only alert once per staleness episode. Reset when a fresh backup arrives.
        if [[ "$backup_alerted" != "True" ]]; then
          alerts+=("💾 last backup was \`${hours_since}h\` ago (cron runs every 6h; alert at >8h)")
        fi
        backup_alerted=true
      else
        backup_alerted=false
      fi
    fi
  else
    # No state file means no backup has EVER succeeded on this box (pg-backup
    # writes it only after a verified local copy exists). This branch used to
    # be missing, so a box whose every run failed never raised this alert.
    if [[ "$backup_alerted" != "True" ]]; then
      alerts+=("💾 no successful backup recorded (\`${BACKUP_STATE}\` missing). Check \`~/.pg-backup.log\`")
    fi
    backup_alerted=true
  fi

  # ─── Waiver expiry countdown ──────────────────────────────────────────────
  # Reads waiver-expiry-tracker.txt and alerts at T-7d (warning), T-1d (urgent),
  # and T-0d (expired — re-blocks GA). Dedup per waiver+tier: each tier fires
  # once, so the founder gets exactly 3 alerts per waiver (7d, 1d, expired),
  # not a repeat every 5-min cron tick.
  local waiver_alerted_json="{}"
  if [[ -f "$STATE_FILE" ]]; then
    waiver_alerted_json=$(python3 -c "import json; print(json.dumps(json.load(open('$STATE_FILE')).get('waiver_alerted', {})))" 2>/dev/null || echo "{}")
  fi
  if [[ -f "$WAIVER_TRACKER" ]]; then
    local now_epoch
    now_epoch=$(date +%s)
    while IFS='|' read -r w_name w_expiry w_doc; do
      [[ -z "$w_name" || "$w_name" == \#* ]] && continue
      local w_epoch days_left hours_left tier_key already_alerted
      w_epoch=$(python3 -c "from datetime import datetime, timezone; print(int(datetime.fromisoformat('${w_expiry}'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo 0)
      [[ "$w_epoch" -eq 0 ]] && continue
      days_left=$(( (w_epoch - now_epoch) / 86400 ))
      hours_left=$(( (w_epoch - now_epoch) / 3600 ))
      if [[ "$hours_left" -le 0 ]]; then
        tier_key="expired"
      elif [[ "$hours_left" -le 24 ]]; then
        tier_key="urgent"
      elif [[ "$days_left" -le 7 ]]; then
        tier_key="warning"
      else
        continue
      fi
      already_alerted=$(python3 -c "import json; print(json.loads('''$waiver_alerted_json''').get('$w_name', {}).get('$tier_key', False))" 2>/dev/null || echo "False")
      if [[ "$already_alerted" != "True" ]]; then
        if [[ "$tier_key" == "expired" ]]; then
          alerts+=("🚨 *WAIVER EXPIRED*: \`${w_name}\` expired at \`${w_expiry}\`. Commercial GA is re-blocked. Revalidate or patch immediately.
Doc: \`${w_doc}\`")
        elif [[ "$tier_key" == "urgent" ]]; then
          alerts+=("🔴 *Waiver expires <24h*: \`${w_name}\` expires at \`${w_expiry}\` (${hours_left}h left). Revalidate NOW.
Doc: \`${w_doc}\`")
        else
          alerts+=("⚠️ *Waiver expires in ${days_left}d*: \`${w_name}\` expires at \`${w_expiry}\`. Schedule revalidation.
Doc: \`${w_doc}\`")
        fi
        waiver_alerted_json=$(python3 -c "
import json
d = json.loads('''$waiver_alerted_json''')
d.setdefault('$w_name', {})['$tier_key'] = True
print(json.dumps(d))
" 2>/dev/null || echo "$waiver_alerted_json")
      fi
    done < "$WAIVER_TRACKER"
  fi

  if [[ ${#alerts[@]} -gt 0 ]]; then
    local joined
    joined=$(printf '%s\n\n' "${alerts[@]}")
    tg_send "🛰 *Pegana watch · anomaly*
\`$(date -u +'%H:%M UTC')\`

${joined}"
  fi

  STALE_ASSETS="$stale_assets" \
  FAILURES="$failures_now" \
  STUCK="$stuck" \
  BACKUP_ALERTED="$backup_alerted" \
  WAIVER_ALERTED="$waiver_alerted_json" \
  CHECKED_AT="$(date -u +%FT%TZ)" \
  python3 -c "
import json, os
state = {
  'failures': int(os.environ['FAILURES'] or 0),
  'stuck': int(os.environ['STUCK'] or 0),
  'stale_assets': os.environ['STALE_ASSETS'],
  'backup_alerted': os.environ['BACKUP_ALERTED'] == 'True',
  'waiver_alerted': json.loads(os.environ['WAIVER_ALERTED'] or '{}'),
  'checked_at': os.environ['CHECKED_AT'],
}
print(json.dumps(state))
" > "$STATE_FILE"
}

case "$MODE" in
  --daily) run_daily ;;
  --watch) run_watch ;;
  --test)  run_daily; echo; run_watch ;;
  *) echo "Usage: $0 --daily | --watch | --test" >&2; exit 1 ;;
esac
