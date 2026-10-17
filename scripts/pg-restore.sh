#!/usr/bin/env bash
# pg-restore.sh — download an encrypted backup from R2 and restore.
#
# Usage:
#   pg-restore.sh list                              # newest first
#   pg-restore.sh restore <NAME> [--into NEW_DB]    # restore (default: prod)
#
# Safety: restoring INTO the prod DB requires typed confirmation (you must
# type the DB name back). --into NEW_DB skips the prompt because it doesn't
# touch prod.
#
# Reads creds from ~/.pegana-r2-creds.env, key from ~/.pegana-backup-key.
# Run on Hetzner as deploy.

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
CMD="${1:-}"

cd "$PEGANA_DIR"
[[ -r "$CREDS" ]] || { echo "FATAL: no creds at $CREDS" >&2; exit 2; }
[[ -r "$KEY"   ]] || { echo "FATAL: no encryption key at $KEY" >&2; exit 2; }

# Parse creds safely
declare R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_ENDPOINT
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  v="${v%\"}"; v="${v#\"}"
  case "$k" in
    R2_ACCESS_KEY_ID)     R2_ACCESS_KEY_ID="$v" ;;
    R2_SECRET_ACCESS_KEY) R2_SECRET_ACCESS_KEY="$v" ;;
    R2_BUCKET)            R2_BUCKET="$v" ;;
    R2_ENDPOINT)          R2_ENDPOINT="$v" ;;
  esac
done < "$CREDS"

env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}
PG_USER="$(env_get POSTGRES_USER)"
PG_DB="$(env_get POSTGRES_DB)"
PG_PASSWORD="$(env_get POSTGRES_PASSWORD)"

aws_r2() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_REGION="auto" \
  aws --endpoint-url "$R2_ENDPOINT" "$@"
}

case "$CMD" in
  list)
    aws_r2 s3 ls "s3://${R2_BUCKET}/" | sort -r
    ;;

  restore)
    NAME="${2:?usage: pg-restore.sh restore <NAME> [--into NEW_DB]}"
    TARGET_DB="$PG_DB"
    if [[ "${3:-}" == "--into" ]]; then
      TARGET_DB="${4:?--into requires a target DB name}"
    fi

    ENC=$(mktemp -t "pegana-restore-enc-XXXXXX")
    DEC=$(mktemp -t "pegana-restore-dec-XXXXXX")
    SHA_FILE=$(mktemp -t "pegana-restore-sha256-XXXXXX")
    restore_exit() {
      local status=$?
      rm -f "$ENC" "$DEC" "$SHA_FILE"
      docker compose exec -T postgres rm -f /tmp/pg-restore.dump >/dev/null 2>&1 || true
      exit "$status"
    }
    trap restore_exit EXIT

    echo "Downloading s3://${R2_BUCKET}/${NAME} ..."
    aws_r2 s3 cp "s3://${R2_BUCKET}/${NAME}" "$ENC" --no-progress

    if aws_r2 s3api head-object --bucket "$R2_BUCKET" --key "${NAME}.sha256" >/dev/null 2>&1; then
      aws_r2 s3 cp "s3://${R2_BUCKET}/${NAME}.sha256" "$SHA_FILE" --no-progress
      EXPECTED_SHA=$(cut -d' ' -f1 < "$SHA_FILE")
      ACTUAL_SHA=$(sha256sum "$ENC" | cut -d' ' -f1)
      if [[ ! "$EXPECTED_SHA" =~ ^[[:xdigit:]]{64}$ || "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
        echo "FATAL: encrypted backup checksum verification failed." >&2
        exit 3
      fi
    else
      echo "WARNING: checksum sidecar not found; continuing with legacy backup." >&2
    fi

    echo "Decrypting ..."
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
         -pass "file:$KEY" -in "$ENC" -out "$DEC"; then
      echo "FATAL: decryption failed. Wrong key, or backup corrupted." >&2
      exit 3
    fi

    SIZE_MB=$(( $(stat -c%s "$DEC" 2>/dev/null || stat -f%z "$DEC") / 1024 / 1024 ))
    echo "Decrypted ${SIZE_MB} MB; target DB = ${TARGET_DB}"

    docker compose cp "$DEC" postgres:/tmp/pg-restore.dump
    if ! docker compose exec -T postgres pg_restore --list /tmp/pg-restore.dump >/dev/null; then
      echo "FATAL: decrypted file is not a valid pg_restore archive." >&2
      exit 3
    fi

    if [[ "$TARGET_DB" == "$PG_DB" ]]; then
      echo
      echo "⚠️  DESTRUCTIVE: pg_restore into PROD DB ($PG_DB)."
      echo "    Behavior: pg_restore --no-clean against a populated DB will"
      echo "    error on existing rows and partially apply the rest. This is"
      echo "    NOT a clean overwrite — expect inconsistency."
      echo "    Strongly recommended: use --into <fresh_db_name> instead."
      echo "    During restore, the BLOCK TRUNCATE trigger (migration 0037) is"
      echo "    DISABLED via timescaledb_pre_restore(). Re-enabled at the end."
      echo
      printf 'Type the DB name (%s) to confirm, anything else aborts: ' "$PG_DB"
      read -r CONFIRM
      if [[ "$CONFIRM" != "$PG_DB" ]]; then
        echo "Aborted."
        exit 4
      fi
    else
      # Validate target name is a plain identifier (no quoting tricks needed)
      if [[ ! "$TARGET_DB" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        echo "FATAL: --into name must match [a-zA-Z_][a-zA-Z0-9_]* (got '$TARGET_DB')" >&2
        exit 5
      fi
      # Safe to inject after validation above
      DB_EXISTS=$(docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
        psql -U "$PG_USER" -d postgres -Atqc \
        "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB';")
      if [[ "$DB_EXISTS" == "1" ]]; then
        echo "FATAL: destination database '$TARGET_DB' already exists." >&2
        exit 5
      fi
      docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
        psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
        -c "CREATE DATABASE \"$TARGET_DB\";"
    fi

    # TimescaleDB-aware pre-restore. Without this, pg_restore's TRUNCATE
    # on hypertable chunks triggers our BLOCK TRUNCATE custom trigger
    # (migration 0037) and crashes the backend (TimescaleDB/trigger interaction
    # segfault — observed 2026-05-29). timescaledb_pre_restore() disables ALL
    # triggers including ours; post_restore re-enables + refreshes continuous
    # aggregates. Requires extension to exist first.
    echo "Pre-restore: timescaledb_pre_restore() ..."
    docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
      psql -U "$PG_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 \
      -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" \
      -c "SELECT timescaledb_pre_restore();" \
      2>&1 | grep -vE "^CREATE EXTENSION|^ timescaledb_pre_restore" || true

    # Sequential restore (-j 1, NOT parallel). Parallel pg_restore violates
    # TimescaleDB catalog FK order — workers process chunk_constraint before
    # dimension_slice is committed, causing "violates foreign key constraint
    # chunk_constraint_dimension_slice_id_fkey" + lost hypertable data.
    # Refs: timescale/timescaledb#1584, #7137.
    # Performance cost: ~2x slower for our DB size (~15-20 MB), still under
    # 5 min total restore time. Worth the correctness.
    # Keep set +e for the ENTIRE restore + cleanup + post_restore block.
    # If `docker compose exec rm` or any intermediate step errored, the old
    # `set -e` after restore would abort BEFORE post_restore — leaving
    # BLOCK TRUNCATE trigger disabled in prod permanently. Found by audit
    # 2026-05-29 (sanity re-review post PR#41).
    set +e
    docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
      pg_restore -U "$PG_USER" -d "$TARGET_DB" \
      --no-owner --no-privileges -j 1 \
      /tmp/pg-restore.dump 2>&1 | tail -30
    RESTORE_EXIT=$?
    docker compose exec -T postgres rm -f /tmp/pg-restore.dump 2>/dev/null

    # ALWAYS re-enable triggers, even if pg_restore had errors — otherwise
    # prod stays defenseless against TRUNCATE.
    echo "Post-restore: timescaledb_post_restore() ..."
    docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
      psql -U "$PG_USER" -d "$TARGET_DB" \
      -c "SELECT timescaledb_post_restore();" \
      2>&1 | grep -vE "^ timescaledb_post_restore"
    POST_EXIT=$?
    set -e

    if [[ "$POST_EXIT" -ne 0 ]]; then
      echo "🚨 CRITICAL: timescaledb_post_restore() FAILED. Triggers may still be"
      echo "    disabled. Manually run:"
      echo "    docker compose exec postgres psql -U $PG_USER -d $TARGET_DB \\"
      echo "      -c \"SELECT timescaledb_post_restore();\""
      exit 6
    fi

    if [[ "$RESTORE_EXIT" -ne 0 ]]; then
      echo "FATAL: pg_restore exited with code $RESTORE_EXIT." >&2
      echo "       Triggers re-enabled. Inspect output above for actionable errors." >&2
      exit "$RESTORE_EXIT"
    fi
    echo "Restore complete: ${NAME} → ${TARGET_DB}"
    ;;

  *)
    echo "Usage: $0 list" >&2
    echo "       $0 restore <NAME> [--into NEW_DB]" >&2
    exit 1
    ;;
esac
