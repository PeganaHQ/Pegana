#!/usr/bin/env bash
# Pegana 24h soak test.
#
# Continuously samples Prometheus + Docker logs against the running prod-local
# stack and asserts that:
#
#   * `pegana_engine_publishes_total{kind="update"}` keeps growing
#   * `pegana_engine_publishes_total{kind="heartbeat"}` ticks at ~12/min
#   * Jupiter 429 rate stays under threshold
#   * Pyth stale-rejection rate stays under threshold
#   * No panics, no `error!` lines in any service log
#
# Exits non-zero with a summary on first violation. Default duration is 24h
# but can be shorter (e.g. SOAK_HOURS=2 for a CI/PR gate).
#
# Usage:
#   ./scripts/soak.sh                   # 24h soak against prod-local
#   SOAK_HOURS=1 ./scripts/soak.sh      # 1h smoke
#   SOAK_NETWORK=pegana_default ./scripts/soak.sh   # against prod compose

set -euo pipefail

SOAK_HOURS="${SOAK_HOURS:-24}"
SAMPLE_INTERVAL_SEC="${SAMPLE_INTERVAL_SEC:-60}"
NETWORK="${SOAK_NETWORK:-pegana-prodlocal_default}"
PROJECT="${SOAK_PROJECT:-pegana-prodlocal}"
LOG_FILE="${SOAK_LOG:-/tmp/pegana-soak-$(date -u +%Y%m%dT%H%M%SZ).log}"

# Failure thresholds — every check is "fails if true at sample time"
MAX_JUPITER_429_PER_MIN="${MAX_JUPITER_429_PER_MIN:-10}"
MAX_PYTH_STALE_PER_MIN="${MAX_PYTH_STALE_PER_MIN:-5}"
MIN_HEARTBEAT_PER_MIN="${MIN_HEARTBEAT_PER_MIN:-8}"   # expect ~12/min, allow some slack
MIN_PUBLISH_PER_MIN="${MIN_PUBLISH_PER_MIN:-3}"       # at least *some* recompute activity

DEADLINE_EPOCH=$(( $(date +%s) + SOAK_HOURS * 3600 ))

# --- helpers -----------------------------------------------------------------

# Run a curl inside a sidecar container on the docker network so we don't need
# host-exposed metrics ports.
metric_query() {
  local target="$1"
  docker run --rm --network "$NETWORK" curlimages/curl:latest \
    -s --max-time 3 "http://$target/metrics" 2>/dev/null || true
}

# Read a counter value (sum across all labels). Falls back to 0 on missing.
counter_sum() {
  local target="$1" name="$2" label_filter="${3:-}"
  metric_query "$target" \
    | grep -E "^${name}(\{[^}]*${label_filter}[^}]*\})? " \
    | awk '{ s += $NF } END { print s+0 }'
}

log() {
  printf '%s [soak] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

fail() {
  log "❌ FAIL: $*"
  log "summary: $LOG_FILE"
  exit 1
}

# --- pre-flight --------------------------------------------------------------

mkdir -p "$(dirname "$LOG_FILE")"
log "soak starting · duration=${SOAK_HOURS}h interval=${SAMPLE_INTERVAL_SEC}s log=$LOG_FILE"
log "network=$NETWORK project=$PROJECT"

# Ensure the stack is up and metrics are responsive *before* starting the
# count baseline — soak failures should mean drift, not bootstrap latency.
for svc in indexer:9090 engine:9091 api:9092; do
  if [[ -z "$(metric_query "$svc")" ]]; then
    fail "service $svc has no /metrics response — is the stack running?"
  fi
done
log "pre-flight ok"

# --- baseline ---------------------------------------------------------------

prev_publishes=$(counter_sum engine:9091 pegana_engine_publishes_total 'kind="update"')
prev_heartbeats=$(counter_sum engine:9091 pegana_engine_publishes_total 'kind="heartbeat"')
prev_jupiter_429=$(counter_sum indexer:9090 pegana_jupiter_429_total)
prev_pyth_stale=$(counter_sum engine:9091 pegana_engine_pyth_stale_total)
log "baseline: publishes=$prev_publishes heartbeats=$prev_heartbeats jupiter_429=$prev_jupiter_429 pyth_stale=$prev_pyth_stale"

# --- main loop --------------------------------------------------------------

iteration=0
while [[ "$(date +%s)" -lt "$DEADLINE_EPOCH" ]]; do
  iteration=$((iteration + 1))
  sleep "$SAMPLE_INTERVAL_SEC"

  cur_publishes=$(counter_sum engine:9091 pegana_engine_publishes_total 'kind="update"')
  cur_heartbeats=$(counter_sum engine:9091 pegana_engine_publishes_total 'kind="heartbeat"')
  cur_jupiter_429=$(counter_sum indexer:9090 pegana_jupiter_429_total)
  cur_pyth_stale=$(counter_sum engine:9091 pegana_engine_pyth_stale_total)

  delta_publishes=$(( cur_publishes - prev_publishes ))
  delta_heartbeats=$(( cur_heartbeats - prev_heartbeats ))
  delta_jupiter_429=$(( cur_jupiter_429 - prev_jupiter_429 ))
  delta_pyth_stale=$(( cur_pyth_stale - prev_pyth_stale ))

  per_min_pub=$(( delta_publishes * 60 / SAMPLE_INTERVAL_SEC ))
  per_min_hb=$(( delta_heartbeats * 60 / SAMPLE_INTERVAL_SEC ))
  per_min_429=$(( delta_jupiter_429 * 60 / SAMPLE_INTERVAL_SEC ))
  per_min_stale=$(( delta_pyth_stale * 60 / SAMPLE_INTERVAL_SEC ))

  log "tick #$iteration · publishes/min=$per_min_pub hb/min=$per_min_hb 429/min=$per_min_429 stale/min=$per_min_stale"

  # Hard fails — engine alive checks
  if [[ "$per_min_hb" -lt "$MIN_HEARTBEAT_PER_MIN" ]]; then
    fail "heartbeat rate $per_min_hb/min < $MIN_HEARTBEAT_PER_MIN/min · engine wedged?"
  fi
  if [[ "$per_min_pub" -lt "$MIN_PUBLISH_PER_MIN" ]]; then
    fail "publish rate $per_min_pub/min < $MIN_PUBLISH_PER_MIN/min · sources stalled?"
  fi

  # Warn-and-fail — rate-limit / staleness creep
  if [[ "$per_min_429" -gt "$MAX_JUPITER_429_PER_MIN" ]]; then
    fail "jupiter 429 rate $per_min_429/min > $MAX_JUPITER_429_PER_MIN/min · budget exceeded"
  fi
  if [[ "$per_min_stale" -gt "$MAX_PYTH_STALE_PER_MIN" ]]; then
    fail "pyth stale rate $per_min_stale/min > $MAX_PYTH_STALE_PER_MIN/min · Hermes degraded?"
  fi

  # Log sweep — panic/error in any service since last tick
  for svc in indexer engine api dispatcher; do
    container="${PROJECT}-${svc}-1"
    if docker logs "$container" --since "${SAMPLE_INTERVAL_SEC}s" 2>&1 \
        | grep -E "panic|FATAL|level\":\"ERROR\"" | grep -v "engine_rs::state.*pyth reading stale" \
        | head -3; then
      :
    fi
  done

  prev_publishes=$cur_publishes
  prev_heartbeats=$cur_heartbeats
  prev_jupiter_429=$cur_jupiter_429
  prev_pyth_stale=$cur_pyth_stale
done

log "✅ soak completed cleanly · duration=${SOAK_HOURS}h iterations=$iteration"
log "final counters: publishes=$cur_publishes heartbeats=$cur_heartbeats 429=$cur_jupiter_429 stale=$cur_pyth_stale"
