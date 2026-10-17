#!/usr/bin/env bash
# Launch 24h watch — post-public-alerts guardrail.
#
# Runs a focused launch check and alerts the operator if:
#   - any Phase-0 asset leaves PEGGED or goes stale/UNKNOWN
#   - delivery failures appear
#   - critical evidence/receipt counters move
#   - any core container is unhealthy
#
# Intended cron during launch day:
#   */5 * * * * ~/pegana/scripts/launch-24h-watch.sh --watch

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
STATE_FILE="${STATE_FILE:-$HOME/.pegana-launch-24h-state.json}"
MODE="${1:---check}"
PHASE0_ASSETS="'JupUSD','JLP','EURC','dzSOL','vSOL'"

cd "$PEGANA_DIR"

env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2- || true)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}

BOT_TOKEN="$(env_get BOT_TOKEN)"
CHAT_ID="$(env_get DOGFOOD_TELEGRAM_CHAT_ID)"
PG_USER="$(env_get POSTGRES_USER)"; PG_USER="${PG_USER:-pegana}"
PG_DB="$(env_get POSTGRES_DB)"; PG_DB="${PG_DB:-pegana}"
SENTRY_DSN_VAL="$(env_get SENTRY_DSN)"

# `docker compose exec` still evaluates the full compose file. These exports
# satisfy required interpolation even though this script does not create or
# recreate containers.
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(env_get POSTGRES_PASSWORD)}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-$(env_get REDIS_PASSWORD)}"
export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-$(env_get GRAFANA_ADMIN_PASSWORD)}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-launch-watch-unused}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-launch-watch-unused}"
export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-launch-watch-unused}"

MONITOR_SLUG=""
if [[ "$MODE" == "--watch" ]]; then
  MONITOR_SLUG="pegana-launch-24h-watch"
fi

sentry_checkin() {
  local status="$1"
  [[ -z "${SENTRY_DSN_VAL:-}" || -z "$MONITOR_SLUG" ]] && return 0
  local key ingest project
  key=$(printf '%s' "$SENTRY_DSN_VAL" | sed -E 's|^https?://([^@]+)@.*|\1|')
  ingest=$(printf '%s' "$SENTRY_DSN_VAL" | sed -E 's|^https?://[^@]+@([^/]+)/.*|\1|')
  project=$(printf '%s' "$SENTRY_DSN_VAL" | sed -E 's|.*/([0-9]+)$|\1|')
  curl -sS --max-time 8 -X POST \
    "https://${ingest}/api/${project}/cron/${MONITOR_SLUG}/${key}/" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"*/5 * * * *\"},\"checkin_margin\":2,\"max_runtime\":2,\"timezone\":\"Etc/UTC\"}}" \
    -o /dev/null 2>/dev/null || true
}
trap '_pegana_st=$?; sentry_checkin $([ "$_pegana_st" -eq 0 ] && echo ok || echo error)' EXIT

psql_q() {
  docker compose exec -T postgres \
    psql -U "$PG_USER" -d "$PG_DB" -tA -F $'\t' -c "$1" 2>/dev/null || true
}

tg_send() {
  local text="$1"
  if [[ "$MODE" != "--watch" ]]; then
    echo "--- launch watch message ---"
    echo "$text"
    echo "----------------------------"
    return
  fi
  # Telegram bot retired: fall back to stdout (cron mail) rather than failing.
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    echo "--- launch watch message ---"; echo "$text"; echo "----------------------------"
    return
  fi
  curl --silent --show-error --max-time 10 \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${text}" \
    -o /dev/null 2>&1 | sed "s|${BOT_TOKEN}|***REDACTED***|g" >&2 || true
}

alerts=()
compose_ok=1
docker compose ps -q postgres >/dev/null 2>&1 || compose_ok=0

bad_phase0=$(psql_q "SELECT coalesce(string_agg(asset || ':' || last_state || ':' || round((ewma_discount * 10000)::numeric, 1) || 'bps', ', ' ORDER BY asset), '') FROM engine_state_snapshot WHERE asset IN ($PHASE0_ASSETS) AND (last_state <> 'PEGGED' OR updated_at < now() - interval '5 minutes');")
missing_phase0=$(psql_q "WITH expected(asset) AS (VALUES ('JupUSD'),('JLP'),('EURC'),('dzSOL'),('vSOL')) SELECT coalesce(string_agg(e.asset, ', ' ORDER BY e.asset), '') FROM expected e LEFT JOIN engine_state_snapshot s USING (asset) WHERE s.asset IS NULL;")
phase0_alerts=$(psql_q "SELECT count(*) FROM alerts WHERE asset IN ($PHASE0_ASSETS) AND detected_at > now() - interval '30 minutes';")
delivery_failed=$(psql_q "SELECT count(*) FROM alert_deliveries WHERE attempted_at > now() - interval '30 minutes' AND status <> 'sent';")
webhook_failed=$(psql_q "SELECT count(*) FROM webhook_deliveries WHERE attempted_at > now() - interval '30 minutes' AND NOT (http_status BETWEEN 200 AND 399 AND error IS NULL);")
receipt_failures=$(psql_q "SELECT count(*) FROM alert_evidence_commit_failures WHERE abandoned_at IS NULL;")
fallback_recent=$({ docker compose logs --since=30m engine 2>/dev/null || true; } | grep -cE "receipt_hash_fallback|audit_persist_failed|methodology broken" || true)
unhealthy=$({ docker compose ps --format '{{.Service}} {{.State}} {{.Status}}' 2>/dev/null || true; } | awk '$2 != "running" || $0 !~ /healthy|Up/ {print $1 ":" $0}' | paste -sd ', ' -)

[[ "$compose_ok" -eq 0 ]] && alerts+=("🚨 Docker Compose unavailable on launch watch host")
[[ -n "$bad_phase0" && "$bad_phase0" != "0" ]] && alerts+=("🚨 Phase-0 not safe to amplify: \`${bad_phase0}\`")
[[ -n "$missing_phase0" && "$missing_phase0" != "0" ]] && alerts+=("🚨 Phase-0 missing engine state: \`${missing_phase0}\`")
[[ "${phase0_alerts:-0}" -gt 0 ]] && alerts+=("🚨 Phase-0 emitted \`${phase0_alerts}\` alert(s) in the last 30m — pause amplification")
[[ "${delivery_failed:-0}" -gt 0 ]] && alerts+=("🚨 Telegram delivery failures in last 30m: \`${delivery_failed}\`")
[[ "${webhook_failed:-0}" -gt 0 ]] && alerts+=("🚨 Webhook delivery failures in last 30m: \`${webhook_failed}\`")
[[ "${receipt_failures:-0}" -gt 0 ]] && alerts+=("🚨 Open commit failures: \`${receipt_failures}\`")
[[ "${fallback_recent:-0}" -gt 0 ]] && alerts+=("🚨 Engine receipt/audit/methodology error log count in last 30m: \`${fallback_recent}\`")
[[ -n "${unhealthy:-}" ]] && alerts+=("🚨 Unhealthy services: \`${unhealthy}\`")

summary=$(psql_q "SELECT string_agg(asset || '=' || last_state || '(' || round((ewma_discount * 10000)::numeric, 1) || 'bps)', ', ' ORDER BY asset) FROM engine_state_snapshot WHERE asset IN ($PHASE0_ASSETS);")

if [[ ${#alerts[@]} -gt 0 ]]; then
  joined=$(printf '%s\n\n' "${alerts[@]}")
  tg_send "🛰 *Pegana launch watch*
\`$(date -u +'%Y-%m-%d %H:%M UTC')\`

${joined}

Phase-0: \`${summary:-missing}\`"
else
  printf '{"ok":true,"phase0":"%s","checked_at":"%s"}\n' "$summary" "$(date -u +%FT%TZ)" > "$STATE_FILE"
  if [[ "$MODE" != "--watch" ]]; then
    echo "OK launch watch"
    echo "Phase-0: ${summary}"
  fi
fi
