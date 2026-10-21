#!/usr/bin/env bash
# pg-restore.sh — restore an encrypted pg-backup.sh dump (local or from R2).
#
# Usage:
#   pg-restore.sh list                                # local + R2 backups, newest first
#   pg-restore.sh fetch   <NAME>                      # download one R2 backup into $BACKUP_DIR
#   pg-restore.sh restore <NAME|PATH> --into NEW_DB   # restore into a NEW database (drill)
#   pg-restore.sh restore <NAME|PATH>                 # restore into the PROD DB (typed confirm)
#
# <NAME> is resolved in this order: an existing file path; $BACKUP_DIR/<NAME>
# (the local rotation pg-backup.sh keeps); then the R2 bucket via rclone.
#
# Safety: restoring INTO the prod DB requires typed confirmation (type the DB
# name back). --into NEW_DB refuses an existing database, so it can never
# touch prod.
#
# Version matching: pg-backup.sh records the TimescaleDB version of every dump
# in a <NAME>.meta sidecar. A TimescaleDB catalog only restores cleanly into
# the SAME extension version, so this script creates the extension at the
# recorded version in the target DB, refuses when that version is not
# installable in the running postgres image, and (for --into) runs
# `ALTER EXTENSION timescaledb UPDATE` after the restore. See
# docs/runbooks/restore.md "Version matching" for the scratch-container
# procedure when the version is not available.
#
# Uses rclone (the `r2:` remote, ~/.config/rclone/rclone.conf), not the aws
# CLI: awscli has no package on Ubuntu 24.04, which left this script unable
# to run on the Hostinger box.
#
# Env:
#   PEGANA_RESTORE_ALLOW_VERSION_MISMATCH=1  restore even if the dump's
#        TimescaleDB version is not installable (expect catalog errors)
#
# Exit codes: 1 usage, 2 config, 3 bad backup (checksum/decrypt/archive),
#   4 aborted at the prod confirmation, 5 bad name/target, 6 post_restore
#   failed (triggers may be disabled), 7 TimescaleDB version mismatch,
#   other = pg_restore's own exit code.

set -euo pipefail

PEGANA_DIR="${PEGANA_DIR:-$HOME/pegana}"
CREDS="${R2_CREDS:-$HOME/.pegana-r2-creds.env}"
KEY="${PEGANA_BACKUP_KEY:-$HOME/.pegana-backup-key}"
BACKUP_DIR="${PEGANA_BACKUP_DIR:-$HOME/backups}"
RCLONE_REMOTE="${PEGANA_BACKUP_RCLONE_REMOTE:-r2}"
CMD="${1:-}"
NAME_RE='^pegana-[0-9]{8}T[0-9]{6}Z\.dump\.enc$'

usage() {
  echo "Usage: $0 list" >&2
  echo "       $0 fetch <NAME>" >&2
  echo "       $0 restore <NAME|PATH> [--into NEW_DB]" >&2
  exit 1
}

cd "$PEGANA_DIR"

R2_BUCKET=""
if [[ -r "$CREDS" ]]; then
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    v="${v%\"}"; v="${v#\"}"
    [[ "$k" == "R2_BUCKET" ]] && R2_BUCKET="$v"
  done < "$CREDS"
fi

env_get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2- || true)
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}
PG_USER="$(env_get POSTGRES_USER)"; PG_USER="${PG_USER:-pegana}"
PG_DB="$(env_get POSTGRES_DB)";     PG_DB="${PG_DB:-pegana}"
PG_PASSWORD="$(env_get POSTGRES_PASSWORD)"

sha256_of() { { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; } | cut -d' ' -f1; }

remote_ready() {
  [[ -n "$R2_BUCKET" ]] && command -v rclone >/dev/null 2>&1
}

psql_db() {
  local db="$1"; shift
  docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
    psql -X -U "$PG_USER" -d "$db" "$@"
}

# fetch_remote NAME DEST_DIR — download a backup and its sidecars.
fetch_remote() {
  local name="$1" dir="$2" side
  remote_ready || { echo "FATAL: R2 not configured (need R2_BUCKET in $CREDS and rclone)" >&2; exit 2; }
  echo "Downloading ${RCLONE_REMOTE}:${R2_BUCKET}/${name} ..."
  rclone copyto "${RCLONE_REMOTE}:${R2_BUCKET}/${name}" "$dir/$name"
  for side in sha256 meta; do
    rclone copyto "${RCLONE_REMOTE}:${R2_BUCKET}/${name}.${side}" "$dir/$name.$side" 2>/dev/null \
      || echo "WARNING: no ${name}.${side} sidecar in R2 (older backup)" >&2
  done
}

case "$CMD" in
  list)
    echo "# local ($BACKUP_DIR)"
    if [[ -d "$BACKUP_DIR" ]]; then
      find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pegana-*.dump.enc' -exec basename {} \; \
        | LC_ALL=C sort -r | sed 's/^/local  /'
    fi
    if remote_ready; then
      echo "# r2 (${RCLONE_REMOTE}:${R2_BUCKET})"
      rclone lsf --files-only --include 'pegana-*.dump.enc' "${RCLONE_REMOTE}:${R2_BUCKET}" \
        | LC_ALL=C sort -r | sed 's/^/r2     /' \
        || echo "WARNING: could not list ${RCLONE_REMOTE}:${R2_BUCKET}" >&2
    else
      echo "# r2: not configured (R2_BUCKET in $CREDS + rclone)" >&2
    fi
    ;;

  fetch)
    NAME="${2:?usage: pg-restore.sh fetch <NAME>}"
    [[ "$NAME" =~ $NAME_RE ]] || { echo "FATAL: unexpected backup name '$NAME'" >&2; exit 5; }
    mkdir -p "$BACKUP_DIR"; chmod 0700 "$BACKUP_DIR"
    fetch_remote "$NAME" "$BACKUP_DIR"
    echo "Fetched to $BACKUP_DIR/$NAME"
    ;;

  restore)
    SRC="${2:?usage: pg-restore.sh restore <NAME|PATH> [--into NEW_DB]}"
    TARGET_DB="$PG_DB"
    if [[ "${3:-}" == "--into" ]]; then
      TARGET_DB="${4:?--into requires a target DB name}"
    elif [[ -n "${3:-}" ]]; then
      usage
    fi
    [[ -r "$KEY" ]] || { echo "FATAL: no encryption key at $KEY" >&2; exit 2; }

    WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/pegana-restore.XXXXXX")
    DEC="$WORKDIR/restore.dump"
    restore_exit() {
      local status=$?
      rm -rf "$WORKDIR"
      docker compose exec -T postgres rm -f /tmp/pg-restore.dump >/dev/null 2>&1 || true
      exit "$status"
    }
    trap restore_exit EXIT

    # ── Resolve the source ──────────────────────────────────────────────
    if [[ -f "$SRC" ]]; then
      ENC="$SRC"
    elif [[ -f "$BACKUP_DIR/$SRC" ]]; then
      ENC="$BACKUP_DIR/$SRC"
    else
      [[ "$SRC" =~ $NAME_RE ]] || { echo "FATAL: '$SRC' is not a file and not a backup name" >&2; exit 5; }
      fetch_remote "$SRC" "$WORKDIR"
      ENC="$WORKDIR/$SRC"
    fi
    NAME=$(basename "$ENC")
    echo "Source: $ENC"

    # ── Checksum ────────────────────────────────────────────────────────
    if [[ -f "$ENC.sha256" ]]; then
      EXPECTED_SHA=$(cut -d' ' -f1 < "$ENC.sha256")
      ACTUAL_SHA=$(sha256_of "$ENC")
      if [[ ! "$EXPECTED_SHA" =~ ^[[:xdigit:]]{64}$ || "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
        echo "FATAL: encrypted backup checksum verification failed." >&2
        exit 3
      fi
      echo "Checksum OK"
    else
      echo "WARNING: checksum sidecar not found; continuing with legacy backup." >&2
    fi

    # ── Versions recorded at backup time ────────────────────────────────
    DUMP_TSDB=""
    if [[ -f "$ENC.meta" ]]; then
      DUMP_TSDB=$(sed -n 's/^timescaledb_version=//p' "$ENC.meta" | head -1)
      echo "Dump recorded: postgres $(sed -n 's/^postgres_version=//p' "$ENC.meta" | head -1), timescaledb ${DUMP_TSDB:-none}"
    else
      echo "WARNING: no .meta sidecar: the dump's TimescaleDB version is unknown." >&2
      echo "         If the restore fails on _timescaledb_catalog, see restore.md 'Version matching'." >&2
    fi
    if [[ -n "$DUMP_TSDB" && ! "$DUMP_TSDB" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "FATAL: unexpected timescaledb_version '$DUMP_TSDB' in $ENC.meta" >&2
      exit 5
    fi

    # ── Decrypt + validate ──────────────────────────────────────────────
    echo "Decrypting ..."
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
         -pass "file:$KEY" -in "$ENC" -out "$DEC"; then
      echo "FATAL: decryption failed. Wrong key, or backup corrupted." >&2
      exit 3
    fi
    SIZE_MB=$(( $(stat -c%s "$DEC" 2>/dev/null || stat -f%z "$DEC") / 1024 / 1024 ))
    echo "Decrypted ${SIZE_MB} MB; target DB = ${TARGET_DB}"

    docker compose cp "$DEC" postgres:/tmp/pg-restore.dump
    rm -f "$DEC"
    if ! docker compose exec -T postgres pg_restore --list /tmp/pg-restore.dump >/dev/null; then
      echo "FATAL: decrypted file is not a valid pg_restore archive." >&2
      exit 3
    fi

    # ── Version gate ────────────────────────────────────────────────────
    if [[ -n "$DUMP_TSDB" ]]; then
      AVAILABLE=$(psql_db postgres -qAt -c \
        "SELECT 1 FROM pg_available_extension_versions WHERE name = 'timescaledb' AND version = '$DUMP_TSDB'" | tr -d '\r')
      if [[ "$AVAILABLE" != "1" ]]; then
        echo "FATAL: timescaledb $DUMP_TSDB (the dump's version) is not installable in this postgres image." >&2
        echo "       Restore into a scratch container running timescale/timescaledb:${DUMP_TSDB}-pg16" >&2
        echo "       (docs/runbooks/restore.md, 'Version matching')." >&2
        if [[ "${PEGANA_RESTORE_ALLOW_VERSION_MISMATCH:-}" != "1" ]]; then
          exit 7
        fi
        echo "       PEGANA_RESTORE_ALLOW_VERSION_MISMATCH=1: continuing anyway." >&2
        DUMP_TSDB=""
      fi
    fi

    if [[ "$TARGET_DB" == "$PG_DB" ]]; then
      if [[ -n "$DUMP_TSDB" ]]; then
        INSTALLED=$(psql_db "$PG_DB" -qAt -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'" | tr -d '\r')
        if [[ -n "$INSTALLED" && "$INSTALLED" != "$DUMP_TSDB" && "${PEGANA_RESTORE_ALLOW_VERSION_MISMATCH:-}" != "1" ]]; then
          echo "FATAL: prod DB runs timescaledb $INSTALLED but the dump is $DUMP_TSDB." >&2
          echo "       Restore --into a fresh DB first (it creates the extension at $DUMP_TSDB)." >&2
          exit 7
        fi
      fi
      echo
      echo "⚠️  DESTRUCTIVE: pg_restore into PROD DB ($PG_DB)."
      echo "    Behavior: pg_restore --no-clean against a populated DB will"
      echo "    error on existing rows and partially apply the rest. This is"
      echo "    NOT a clean overwrite: expect inconsistency."
      echo "    Strongly recommended: use --into <fresh_db_name> instead."
      echo "    During restore, the BLOCK TRUNCATE trigger (migration 0037) is"
      echo "    DISABLED via timescaledb_pre_restore(). Re-enabled at the end."
      echo
      printf 'Type the DB name (%s) to confirm, anything else aborts: ' "$PG_DB"
      read -r CONFIRM || CONFIRM=""
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
      DB_EXISTS=$(psql_db postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB';" | tr -d '\r')
      if [[ "$DB_EXISTS" == "1" ]]; then
        echo "FATAL: destination database '$TARGET_DB' already exists." >&2
        exit 5
      fi
      psql_db postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET_DB\";"
    fi

    # TimescaleDB-aware pre-restore. Without this, pg_restore's TRUNCATE on
    # hypertable chunks triggers our BLOCK TRUNCATE custom trigger (migration
    # 0037) and crashes the backend (observed 2026-05-29).
    # timescaledb_pre_restore() disables ALL triggers including ours;
    # post_restore re-enables them. The extension must exist first, at the
    # dump's version when known.
    if [[ -n "$DUMP_TSDB" ]]; then
      CREATE_EXT="CREATE EXTENSION IF NOT EXISTS timescaledb VERSION '$DUMP_TSDB';"
    else
      CREATE_EXT="CREATE EXTENSION IF NOT EXISTS timescaledb;"
    fi
    echo "Pre-restore: $CREATE_EXT then timescaledb_pre_restore() ..."
    psql_db "$TARGET_DB" -qAt -v ON_ERROR_STOP=1 \
      -c "$CREATE_EXT" \
      -c "SELECT timescaledb_pre_restore();" >/dev/null

    # Sequential restore (-j 1, NOT parallel). Parallel pg_restore violates
    # TimescaleDB catalog FK order (timescale/timescaledb#1584, #7137).
    # Keep set +e for the ENTIRE restore + post_restore block: if any step
    # aborted before post_restore, the BLOCK TRUNCATE trigger would stay
    # disabled permanently (audit 2026-05-29).
    set +e
    docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" postgres \
      pg_restore -U "$PG_USER" -d "$TARGET_DB" \
      --no-owner --no-privileges -j 1 \
      /tmp/pg-restore.dump 2>&1 | tail -30
    # PIPESTATUS[0] states pg_restore's status explicitly; pipefail (set at the
    # top) already made `$?` non-zero on failure, this just does not rely on it.
    RESTORE_EXIT=${PIPESTATUS[0]}
    docker compose exec -T postgres rm -f /tmp/pg-restore.dump 2>/dev/null

    # ALWAYS re-enable triggers, even if pg_restore had errors.
    echo "Post-restore: timescaledb_post_restore() ..."
    psql_db "$TARGET_DB" -qAt -v ON_ERROR_STOP=1 -c "SELECT timescaledb_post_restore();" >/dev/null
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

    # Bring a drill DB up to the extension version the stack runs. Must be
    # the first statement of a fresh session (-X, single -c).
    if [[ "$TARGET_DB" != "$PG_DB" && -n "$DUMP_TSDB" ]]; then
      echo "ALTER EXTENSION timescaledb UPDATE ..."
      psql_db "$TARGET_DB" -qAt -v ON_ERROR_STOP=1 -c "ALTER EXTENSION timescaledb UPDATE;" >/dev/null
    fi

    echo "Smoke counts in $TARGET_DB:"
    psql_db "$TARGET_DB" -c \
      "SELECT (SELECT count(*) FROM discount_snapshots) AS discount_snapshots,
              (SELECT count(*) FROM alerts) AS alerts,
              (SELECT count(*) FROM alert_evidence) AS alert_evidence,
              (SELECT max(ts) FROM discount_snapshots) AS latest_snapshot,
              (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb;" \
      || echo "WARNING: smoke query failed; inspect $TARGET_DB by hand." >&2
    echo "Restore complete: ${NAME} -> ${TARGET_DB}"
    ;;

  *)
    usage
    ;;
esac
