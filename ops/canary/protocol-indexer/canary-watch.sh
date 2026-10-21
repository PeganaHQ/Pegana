#!/usr/bin/env bash
# Read-only status of the pi-canary container. Run repeatedly:  bash canary-watch.sh </dev/null
set -uo pipefail
NAME=pi-canary
redact() { sed -E 's/(api-key=)[^&[:space:]"'"'"')]+/\1REDACTED/g'; }

docker inspect "$NAME" >/dev/null 2>&1 || { echo "no $NAME container"; exit 1; }
echo "== state =="
docker inspect "$NAME" --format 'status={{.State.Status}} running={{.State.Running}} exit={{.State.ExitCode}} oomkilled={{.State.OOMKilled}} restarts={{.RestartCount}} started={{.State.StartedAt}} finished={{.State.FinishedAt}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}'
echo "== mem (one-shot) =="
docker stats --no-stream --format '{{.Name}} mem={{.MemUsage}} ({{.MemPerc}}) cpu={{.CPUPerc}}' "$NAME" 2>&1
echo "== HF / lifecycle log lines (redacted) =="
docker logs --tail 400 "$NAME" 2>&1 | redact | grep -E '_hf\]|\[EXIT\]|\[WARN\]|\[FATAL\]| up on ' | tail -25
echo "== freshest loop_hf_distribution rows per protocol (read-only) =="
PG="$(docker ps -q --filter label=com.docker.compose.service=postgres | head -1)"
if [ -z "$PG" ]; then echo "postgres container not found"; exit 0; fi
docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT protocol, max(ts) AS freshest_ts, now()-max(ts) AS age, count(*) FILTER (WHERE ts > now()-interval '"'"'3 hours'"'"') AS rows_3h FROM loop_hf_distribution GROUP BY protocol ORDER BY protocol;"'
echo
echo "PASS criteria after >=20 min: running, restarts=0 (--restart=no: status must stay running), oomkilled=false,"
echo "mem well under 1GiB, '[kamino_hf] wrote N rows' and '[jupiter_lend_hf] wrote N rows' present, no 401, freshest_ts advanced."
