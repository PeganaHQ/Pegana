#!/usr/bin/env bash
# Pegana Postgres restore drill — restores a .sql.gz dump into a target
# database. By default the target is `pegana_restore_test`, NEVER `pegana`,
# so an operator running this on the prod box can't accidentally clobber
# live data.
#
# Usage:
#   restore.sh <backup-file.sql.gz> [target_db]
#
# Env vars:
#   PEGANA_PG_CONTAINER   docker container running postgres (default: pegana-postgres-1)
#   PEGANA_PG_USER        postgres role (default: pegana)
#   PEGANA_RESTORE_FORCE  set to 1 to allow restoring into 'pegana' (live DB)
#
# Workflow:
#   1. Validate args + safety guard (refuses 'pegana' unless _FORCE).
#   2. Terminate open conns to the target → DROP IF EXISTS → CREATE.
#   3. Pipe `gunzip < dump | psql` into it.
#   4. Smoke-check via SELECT counts on assets + discount_snapshots.
#      Fails loud if either is below expected minimum.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file.sql.gz> [target_db]" >&2
  exit 64
fi

DUMP="$1"
TARGET="${2:-pegana_restore_test}"
PG_CONTAINER="${PEGANA_PG_CONTAINER:-pegana-postgres-1}"
PG_USER="${PEGANA_PG_USER:-pegana}"

if [ ! -f "$DUMP" ]; then
  echo "[restore] FAIL: $DUMP does not exist" >&2
  exit 1
fi

if [ "$TARGET" = "pegana" ] && [ "${PEGANA_RESTORE_FORCE:-}" != "1" ]; then
  echo "[restore] FAIL: refusing to restore into 'pegana' (live DB)." >&2
  echo "         Set PEGANA_RESTORE_FORCE=1 if you really mean it." >&2
  exit 2
fi

echo "[restore] target db: $TARGET (in container: $PG_CONTAINER)"

# Terminate, drop, create — three separate -c calls because the multi-
# statement heredoc form was silently failing under docker exec in some
# environments. The downside is three fork+exec; restore drills aren't
# hot-path so the cost is irrelevant.
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c "
  SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
   WHERE datname = '$TARGET' AND pid <> pg_backend_pid();
" >/dev/null
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS $TARGET;" >/dev/null
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $TARGET OWNER $PG_USER;" >/dev/null

# TimescaleDB restore protocol: extension must exist in the target before
# the dump's chunk INSERTs land, and pre/post_restore() wraps the data load
# so chunk metadata is rebuilt correctly. Without this you get errors like
# "could not find hypertable with id N" during COPY into a _hyper_*_chunk.
# See https://docs.timescale.com/self-hosted/latest/backup-and-restore/pg-dump-and-restore/
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$TARGET" -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" >/dev/null
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$TARGET" -c "SELECT timescaledb_pre_restore();" >/dev/null

echo "[restore] piping dump into $TARGET …"
gunzip < "$DUMP" \
  | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$TARGET" \
      --quiet --set ON_ERROR_STOP=1 \
      >/dev/null

docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$TARGET" -c "SELECT timescaledb_post_restore();" >/dev/null

echo "[restore] smoke check"
RESULT=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$TARGET" -t -A -F'|' -c "
  SELECT 'assets',             count(*) FROM assets
  UNION ALL
  SELECT 'discount_snapshots', count(*) FROM discount_snapshots
  UNION ALL
  SELECT 'alerts',             count(*) FROM alerts;
")
echo "$RESULT" | awk -F'|' '
  /^assets\|/        { a=$2; printf "  assets:               %d\n", a }
  /^discount_/       { d=$2; printf "  discount_snapshots:   %d\n", d }
  /^alerts\|/        {        printf "  alerts:               %d\n", $2 }
  END {
    fail=0
    if (a+0 < 14) { print "  ✗ FAIL: assets < 14" > "/dev/stderr"; fail=1 }
    if (d+0 < 1)  { print "  ✗ FAIL: discount_snapshots empty" > "/dev/stderr"; fail=1 }
    if (fail) exit 3
    print "  ✓ smoke check passed"
  }
'

echo "[restore] done — restored db is '$TARGET'"
echo "[restore] drop when done:"
echo "  docker exec $PG_CONTAINER psql -U $PG_USER -d postgres -c \"DROP DATABASE $TARGET;\""
