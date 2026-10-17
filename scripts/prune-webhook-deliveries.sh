#!/usr/bin/env bash
# Prune old webhook delivery audit rows.
#
# Designed for cron on the prod box. Uses docker compose so it does not depend
# on a Rust toolchain being installed on the host.
#
# Env vars:
#   PEGANA_RETENTION_DAYS  retention window in days (default: 30)
#   PEGANA_PG_USER         postgres role (default: pegana)
#   PEGANA_PG_DB           database name (default: pegana)
#
# Cron example:
#   17 3 * * * cd /home/deploy/pegana && ./scripts/prune-webhook-deliveries.sh >> /var/log/pegana-webhook-retention.log 2>&1

set -euo pipefail

DAYS="${PEGANA_RETENTION_DAYS:-30}"
PG_USER="${PEGANA_PG_USER:-pegana}"
PG_DB="${PEGANA_PG_DB:-pegana}"

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ]; then
  echo "[webhook-retention] FAIL: PEGANA_RETENTION_DAYS must be an integer >= 1 (got '$DAYS')" >&2
  exit 2
fi

echo "[webhook-retention] pruning webhook_deliveries older than ${DAYS}d"
docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
  -c "DELETE FROM webhook_deliveries WHERE attempted_at < now() - (${DAYS}::int * interval '1 day');"
echo "[webhook-retention] done"
