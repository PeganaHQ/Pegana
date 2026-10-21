#!/usr/bin/env bash
# Push current branch and roll the prod (Hostinger) stack.
#
# Modes:
#   ./scripts/deploy.sh                 # full deploy: build w/ GIT_SHA + force-recreate
#   ./scripts/deploy.sh --config-only   # NO rebuild; force-recreate to reload .env
#   ./scripts/deploy.sh --migrate       # also apply pending SQL migrations via sqlx
#   ./scripts/deploy.sh --install-crons # also re-run install-pg-backup + install-calibration-watch
#   ./scripts/deploy.sh --logs          # tail logs after deploy (Ctrl+C to exit)
#   ./scripts/deploy.sh --services 'engine api'  # restrict recreate to subset
#
# Flags combine: e.g. `--config-only --logs` skips build, recreates all, tails.
#
# Why this script exists: the launch-runbook documents a 10-step sequence
# with several gotchas (force-recreate vs restart, GIT_SHA build-arg, chmod
# after pull, manual psql for migrations). Encoding it here keeps T-0
# launch day mechanical instead of error-prone.
#
# References:
#   - docs/operations/launch-runbook-2026-06-11.md (deploy + rollback)
#   - feedback_deploy_workflow memory (gotchas list)
#   - ADR-0005 (early-evidence rollout)

set -euo pipefail

SERVER="${PEGANA_DEPLOY_SERVER:?PEGANA_DEPLOY_SERVER is required (deploy@host)}"
REMOTE_DIR="${PEGANA_DEPLOY_DIR:-~/pegana}"
SERVICES="${PEGANA_DEPLOY_SERVICES:-api engine dispatcher indexer mcp-ts protocol-indexer}"
CONFIG_ONLY=false
RUN_MIGRATE=false
INSTALL_CRONS=false
TAIL_LOGS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-only)   CONFIG_ONLY=true ; shift ;;
    --migrate)       RUN_MIGRATE=true ; shift ;;
    --install-crons) INSTALL_CRONS=true ; shift ;;
    --logs)          TAIL_LOGS=true   ; shift ;;
    --services)      SERVICES="$2"    ; shift 2 ;;
    -h|--help)
      grep "^#" "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1 ;;
  esac
done

# Pre-flight: branch + clean tree
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" != "main" ]]; then
  echo "⚠️  On branch '$current_branch', not 'main'. Production tracks 'main'."
  read -rp "Continue anyway (push this branch + deploy from this commit)? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠️  Uncommitted changes. Commit or stash first:" >&2
  git status --short >&2
  exit 1
fi

requested_sha=$(git rev-parse HEAD)
echo "→ requested SHA: $requested_sha"
echo "→ pushing $current_branch..."
git push origin "$current_branch"

# Build the remote sequence as a heredoc — single SSH round-trip.
REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail
cd $REMOTE_DIR

requested_branch='$current_branch'
requested_sha='$requested_sha'

echo "  · fetch origin"
git fetch --prune origin

if [[ -n "\$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Remote checkout has tracked modifications; refusing to deploy:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

unexpected_untracked=()
while IFS= read -r path; do
  [[ -n "\$path" ]] || continue
  if [[ "\$path" != ".env" ]]; then
    unexpected_untracked+=("\$path")
  fi
done <<< "\$(
  {
    git ls-files --others --exclude-standard
    git ls-files --others --ignored --exclude-standard
  } | LC_ALL=C sort -u
)"
if (( \${#unexpected_untracked[@]} )); then
  echo "Remote checkout has unexpected untracked or ignored files; refusing to deploy:" >&2
  printf '  %s\n' "\${unexpected_untracked[@]}" >&2
  exit 1
fi

remote_branch_sha=\$(git rev-parse "origin/\$requested_branch")
if [[ "\$remote_branch_sha" != "\$requested_sha" ]]; then
  echo "Remote branch origin/\$requested_branch is \$remote_branch_sha, expected \$requested_sha" >&2
  exit 1
fi

remote_branch=\$(git symbolic-ref --quiet --short HEAD || true)
if [[ "\$remote_branch" == "\$requested_branch" ]]; then
  echo "  · reset \$requested_branch to exact requested SHA"
  git reset --hard "\$requested_sha"
else
  echo "  · checkout exact requested SHA in detached state"
  git checkout --detach "\$requested_sha"
fi

if [[ "\$(git rev-parse HEAD)" != "\$requested_sha" ]]; then
  echo "Remote HEAD does not equal requested SHA" >&2
  exit 1
fi

echo "  · requested SHA: \$requested_sha"
echo "  · deployed SHA:  \$(git rev-parse HEAD)"

REMOTE
)

if $RUN_MIGRATE; then
  REMOTE_SCRIPT+=$(cat <<REMOTE

echo "  · building migration manifest from requested commit"
migration_stage=\$(mktemp -d /tmp/pegana-migrations.XXXXXX)
trap 'rm -rf "\$migration_stage"' EXIT
migration_manifest="\$migration_stage/manifest.sha256"

migration_paths=()
while IFS= read -r path; do
  [[ -n "\$path" ]] && migration_paths+=("\$path")
done <<< "\$(git ls-tree -r --name-only "\$requested_sha" -- migrations | while IFS= read -r tracked_path; do [[ "\$tracked_path" == migrations/*.sql ]] && printf '%s\n' "\$tracked_path"; done | LC_ALL=C sort -t/ -k2,2n -k2,2)"
(( \${#migration_paths[@]} )) || { echo "No tracked SQL migrations found at \$requested_sha" >&2; exit 1; }

previous_version=-1
for path in "\${migration_paths[@]}"; do
  filename=\${path##*/}
  [[ "\$filename" =~ ^([0-9]+)_.+\.sql$ ]] || { echo "Invalid migration filename in requested commit: \$path" >&2; exit 1; }
  version=\$((10#\${BASH_REMATCH[1]}))
  (( version > previous_version )) || { echo "Migration versions are not strictly increasing at \$path" >&2; exit 1; }
  previous_version=\$version
  git show "\$requested_sha:\$path" > "\$migration_stage/\$filename"
  expected_hash=\$(git rev-parse "\$requested_sha:\$path")
  actual_hash=\$(git hash-object "\$migration_stage/\$filename")
  [[ "\$actual_hash" == "\$expected_hash" ]] || { echo "Git object hash mismatch while staging \$path" >&2; exit 1; }
  (
    cd "\$migration_stage"
    sha256sum "\$filename" >> manifest.sha256
  )
done

(
  cd "\$migration_stage"
  sha256sum -c manifest.sha256 >/dev/null
) || { echo "Staged migration hash verification failed" >&2; exit 1; }

echo "  · inspecting migration history"
postgres_container=\$(docker compose ps -q postgres)
[[ -n "\$postgres_container" ]] || { echo "Postgres container is not running" >&2; exit 1; }

sqlx_history=\$(docker compose exec -T postgres sh -lc \
  'psql -X -qAt -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" "\$POSTGRES_DB" -c "SELECT to_regclass('"'"'public._sqlx_migrations'"'"') IS NOT NULL"' \
  </dev/null)

if [[ "\$sqlx_history" == "t" ]]; then
  echo "  · SQLx history exists; applying pending migrations via sqlx"
  docker run --rm --network "container:\$postgres_container" \
    --env-file .env \
    -v "\$migration_stage:/work/migrations:ro" \
    -w /work \
    rust:1.90-slim \
    bash -c 'cargo install sqlx-cli --version 0.8.6 --no-default-features --features rustls,postgres --locked >/dev/null && cd migrations && sha256sum -c manifest.sha256 >/dev/null && cd .. && DATABASE_URL="postgres://\${POSTGRES_USER:-pegana}:\${POSTGRES_PASSWORD}@127.0.0.1:5432/\${POSTGRES_DB:-pegana}" sqlx migrate run --source migrations' \
    </dev/null
elif [[ "\$sqlx_history" == "f" ]]; then
  echo "  · legacy manually-migrated database detected; validating 0070 sentinel"
  legacy_sentinel=\$(docker compose exec -T postgres sh -lc \
    'psql -X -qAt -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" "\$POSTGRES_DB" -c "SELECT to_regclass('"'"'public.loop_exposure_snapshots'"'"') IS NOT NULL AND to_regclass('"'"'public.loop_hf_distribution'"'"') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'loop_hf_distribution'"'"' AND column_name = '"'"'liquidation_ltv'"'"' AND data_type = '"'"'numeric'"'"')"' \
    </dev/null)
  [[ "\$legacy_sentinel" == "t" ]] || { echo "Refusing migration: no SQLx history and the migration 0070 schema sentinel is incomplete" >&2; exit 1; }

  docker compose exec -T postgres rm -rf /tmp/pegana-migrations </dev/null
  docker compose exec -T postgres mkdir -p /tmp/pegana-migrations </dev/null
  for path in "\${migration_paths[@]}"; do
    filename=\${path##*/}
    docker compose cp "\$migration_stage/\$filename" "postgres:/tmp/pegana-migrations/\$filename"
  done
  docker compose cp "\$migration_manifest" postgres:/tmp/pegana-migrations/manifest.sha256
  docker compose exec -T postgres sh -s <<'MIGRATE_SCRIPT'
set -eu
cd /tmp/pegana-migrations
sha256sum -c manifest.sha256 >/dev/null
psql -X -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" "\$POSTGRES_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS pegana_migration_ledger (
    filename TEXT PRIMARY KEY,
    checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
for path in /tmp/pegana-migrations/*.sql; do
  filename=\${path##*/}
  version=\${filename%%_*}
  version=\$((10#\$version))
  [ "\$version" -ge 71 ] || continue
  checksum=\$(sha256sum "\$path" | cut -d " " -f 1)
  printf "%s\n" "\$filename" | grep -Eq "^[A-Za-z0-9_.-]+$" || { echo "Unsafe migration filename" >&2; exit 1; }
  printf "%s\n" "\$checksum" | grep -Eq "^[0-9a-f]{64}$" || { echo "Invalid migration checksum" >&2; exit 1; }
  recorded=\$(psql -X -qAt -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" "\$POSTGRES_DB" -c "SELECT checksum_sha256 FROM pegana_migration_ledger WHERE filename = '\$filename'")
  if [ -n "\$recorded" ]; then
    [ "\$recorded" = "\$checksum" ] || { echo "Checksum mismatch for recorded migration \$filename" >&2; exit 1; }
    echo "    - \$filename (already applied)"
    continue
  fi
  echo "    - \$filename"
  psql -X -1 -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" "\$POSTGRES_DB" \
    -f "\$path" \
    -c "INSERT INTO pegana_migration_ledger (filename, checksum_sha256) VALUES ('\$filename', '\$checksum')"
done
MIGRATE_SCRIPT
else
  echo "Unexpected _sqlx_migrations detection result: \$sqlx_history" >&2
  exit 1
fi
REMOTE
  )
fi

if ! $CONFIG_ONLY; then
  REMOTE_SCRIPT+=$(cat <<REMOTE

# --no-cache is intentional. Without it, buildkit caches the
# RUN cargo build layer even when --build-arg PEGANA_GIT_SHA changes,
# because the source files didn't change. The result: the binary keeps
# the OLD SHA baked in (or none at all), and every receipt's
# methodology_git_sha field misrepresents which deploy produced it.
# Verified empirically on 2026-05-29 — needed --no-cache to actually
# embed the SHA in the engine binary. Add ~3min to each deploy; worth
# the cost for correctness of audit receipts.
echo "  · build with GIT_SHA baked (--no-cache)"
GIT_SHA=\$(git rev-parse HEAD)
docker compose build --no-cache --build-arg PEGANA_GIT_SHA="\$GIT_SHA" $SERVICES 2>&1 | tail -3
REMOTE
  )
fi

# ⚠️ ALWAYS force-recreate — `docker compose restart` does NOT reload
# env_file. Caught 2026-05-29 when FEATURE_PUBLIC_ALERTS flip + SENTRY_DSN
# add silently failed via restart. up -d --force-recreate is the only way.
REMOTE_SCRIPT+=$(cat <<REMOTE

# --wait: health-gated. Compose blocks until every recreated service reports
# healthy (or running, for services without a healthcheck) and exits non-zero
# if one does not within the timeout, so a container that boots and then
# fails its healthcheck fails the deploy here instead of shipping green.
# The brief api/mcp gap while the old container stops is absorbed by Caddy's
# lb_try_duration plus request_buffers (see Caddyfile), which hold requests,
# including POSTs with a body such as MCP JSON-RPC, through the swap.
# node-exporter bind-mounts the textfile directory with create_host_path: false
# (a missing dir must not become a root-owned one), so make sure it exists as
# the deploy user before anything starts.
METRICS_DIR=\$(sed -n 's/^PEGANA_METRICS_DIR=//p' .env 2>/dev/null | tail -1 | tr -d '"')
METRICS_DIR=\${METRICS_DIR:-\$HOME/.pegana-metrics}
mkdir -p "\$METRICS_DIR"
echo "  · docker compose up -d --force-recreate --wait $SERVICES"
set +o pipefail
docker compose up -d --force-recreate --wait --wait-timeout ${PEGANA_DEPLOY_WAIT_TIMEOUT:-180} $SERVICES 2>&1 | tail -12
up_status=\${PIPESTATUS[0]}
set -o pipefail
if [[ "\$up_status" -ne 0 ]]; then
  echo "Containers were recreated but at least one did not become healthy:" >&2
  docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}" >&2
  exit 1
fi
REMOTE
)

# Reclaim --no-cache build-cache bloat (audit M16: prod disk hit 86%, ~112GB
# non-DB = accumulated build cache). --no-cache never REUSES the cache, so each
# build only adds to it and nothing ever frees it. Prune dangling images + all
# build cache after a successful build+recreate. Running containers' tagged
# images are in-use and untouched; the cache is regenerable. Skipped on
# --config-only (no build ran, nothing new to reclaim).
if ! $CONFIG_ONLY; then
  REMOTE_SCRIPT+=$(cat <<REMOTE

echo "  · reclaim build-cache (image + builder prune)"
docker image prune -f 2>&1 | tail -1
docker builder prune -af 2>&1 | tail -1
echo "    disk after prune:"
df -h / | tail -1
REMOTE
  )
fi

if $INSTALL_CRONS; then
  REMOTE_SCRIPT+=$(cat <<REMOTE

echo "  · re-installing cron entries (pg-backup + calibration-watch)"
bash scripts/install-pg-backup.sh 2>&1 | tail -5
bash scripts/install-calibration-watch.sh 2>&1 | tail -5
REMOTE
  )
fi

REMOTE_SCRIPT+=$(cat <<REMOTE

echo "  · sleep 20s for healthcheck"
sleep 20
docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"
REMOTE
)

# Check the remote's exit status. It was unchecked, so every guard inside the
# remote script — "refusing to deploy", the SHA mismatch check, the migration
# checksum abort — printed its reason, exited 1, and the local script carried
# on to report success.
#
# Found the expensive way: a `.env.bak` left in the deploy directory on Aug 10
# tripped the untracked-files guard, and every deploy since refused and exited
# 0. The containers had been up nine days while deploys "succeeded".
#
# The smoke test below already learned this lesson — its own comment says it
# "used to only PRINT the status code, so a deploy that left the API returning
# 502 still exited 0". The ssh call it guards had the same bug.
if ! ssh -o StrictHostKeyChecking=accept-new "$SERVER" bash <<<"$REMOTE_SCRIPT"; then
  echo "" >&2
  echo "✗ Remote deploy failed or refused (see the reason above). A refusal in" >&2
  echo "  the pre-flight guards leaves the running containers untouched; a" >&2
  echo "  failure at the health-gated recreate step means containers WERE" >&2
  echo "  replaced and one is unhealthy (see the ps table above)." >&2
  exit 1
fi

# Every long-running compose service must have a running container. A normal
# deploy only recreates $SERVICES, so a service that was never created (as
# alertmanager was, from the 2026-10-16 rebuild until this check existed) or
# that crash-looped out stays missing silently. Fail loudly instead.
missing_services=$(ssh "$SERVER" bash -s <<<"cd $REMOTE_DIR && comm -23 <(docker compose config --services | LC_ALL=C sort) <(docker compose ps --status running --services | LC_ALL=C sort)" || echo "CHECK-FAILED")

# Which channels the running alertmanager delivers to. Its entrypoint falls
# back to the null config (no delivery) instead of crash-looping when the
# Telegram/Discord inputs are missing or the render fails, so a "running"
# container says nothing about delivery. Read the --config.file of PID 1 and
# the "# Channels:" line the render script writes (stdin of each exec is
# /dev/null so it cannot swallow the rest of the `bash -s` script). Warns, never fails: alert
# delivery is an owner input, not a reason to call a deploy broken.
am_check='cfg=$(docker compose exec -T alertmanager cat /proc/1/cmdline </dev/null 2>/dev/null | tr "\0" "\n" | sed -n "s/^--config.file=//p")
if [ -z "$cfg" ]; then echo channels=unknown
elif [ "$cfg" = /etc/alertmanager/config-null.yml ]; then echo channels=none
else ch=$(docker compose exec -T alertmanager sed -n "s/^# Channels: //p" "$cfg" </dev/null 2>/dev/null); echo "channels=${ch:-unknown}"; fi'
am_channels=$(ssh "$SERVER" bash -s <<<"cd $REMOTE_DIR || exit 1
$am_check" 2>/dev/null || echo "channels=unknown")
am_channels=${am_channels##*channels=}

# Local smoke test — proves what the operator running this script sees
# externally, not just what the box thinks internally.
#
# This used to only PRINT the status code, so a deploy that left the API
# returning 502 still exited 0 and reported "✅ deploy complete". On a solo
# operation the deploy script's exit code is frequently the only thing anyone
# looks at, so a green tick over a broken service is the worst possible output.
# Now a non-200 fails the script.
echo ""
echo "→ external smoke tests"
smoke_failed=0

# The API is checked by `cargo xtask smoke`, not a bare status-code loop. The
# old loop only compared the HTTP code, so an endpoint that degraded from 38ms
# to 106s while still returning 200 (the 2026-07-25 incident class) shipped
# green. The canary adds a per-probe latency budget and asserts the ADR-0043
# envelope, which also catches a contract regression a status check cannot see.
#
# It runs TWICE with a settle gap: the first pass catches immediate breakage,
# the second catches a regression that only shows once caches/pools have warmed
# and the first request has paid the cold-start cost. Borrowed from
# solana-foundation/tokens' deploy pipeline (MIT).
for pass in 1 2; do
  if [ "$pass" -eq 2 ]; then
    echo "  · settling 15s before the second canary pass"
    sleep 15
  fi
  echo "  · canary pass $pass/2"
  if cargo run --quiet -p xtask -- smoke --base https://api.pegana.xyz; then
    :
  else
    smoke_failed=1
    break
  fi
done

if [[ "$missing_services" == *CHECK-FAILED* ]]; then
  echo "  · could not check for missing compose services (ssh failed)  ❌"
  echo "    Verify by hand: ssh $SERVER 'cd $REMOTE_DIR && docker compose ps'"
  smoke_failed=1
elif [[ -n "$missing_services" ]]; then
  echo "  · compose services without a running container: $(echo $missing_services)  ❌"
  echo "    Start them on the box: docker compose up -d <service>. alertmanager runs"
  echo "    without delivery until Telegram (ALERTMANAGER_TELEGRAM_BOT_TOKEN +"
  echo "    ALERTMANAGER_TELEGRAM_CHAT_ID) OR Discord (ALERTMANAGER_DISCORD_WEBHOOK_URL)"
  echo "    is set in .env; check its logs if it is the one missing."
  smoke_failed=1
fi

case "$am_channels" in
  none)
    echo ""
    echo "  ⚠️  ALERTMANAGER IS NOT DELIVERING ALERTS (null receiver)."
    echo "     Set Telegram (ALERTMANAGER_TELEGRAM_BOT_TOKEN + ALERTMANAGER_TELEGRAM_CHAT_ID)"
    echo "     OR Discord (ALERTMANAGER_DISCORD_WEBHOOK_URL) in the box .env, then:"
    echo "       $0 --config-only --services alertmanager"
    echo "     The reason is in: ssh $SERVER 'cd $REMOTE_DIR && docker compose logs alertmanager | grep WARN'"
    echo ""
    ;;
  unknown|"")
    echo "  · alertmanager delivery channels: could not be read  ⚠️"
    echo "    Check by hand: ssh $SERVER 'cd $REMOTE_DIR && docker compose logs alertmanager | grep \"alertmanager config\"'"
    ;;
  *)
    printf "  · %-40s %s\n" "alertmanager delivers to" "$am_channels"
    ;;
esac

# mcp-ts is a separate service with no /v1 envelope, so it stays a plain check.
mcp_code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 https://mcp.pegana.xyz/health || echo "TIMEOUT")
if [ "$mcp_code" = "200" ]; then
  printf "  · %-40s %s\n" "https://mcp.pegana.xyz/health" "$mcp_code"
else
  printf "  · %-40s %s  ❌\n" "https://mcp.pegana.xyz/health" "$mcp_code"
  smoke_failed=1
fi

if [ "$smoke_failed" -ne 0 ]; then
  echo ""
  echo "❌ deploy FAILED its post-deploy smoke test · HEAD $(git rev-parse --short HEAD)"
  echo "   Containers were replaced but at least one endpoint is not serving 200."
  echo "   Check:  ssh $SERVER 'docker compose -f ~/pegana/docker-compose.yml ps'"
  echo "   Logs:   $0 --logs"
  exit 1
fi

echo ""
echo "✅ deploy complete · HEAD $(git rev-parse --short HEAD)"
echo "   API:   https://api.pegana.xyz/healthz"
echo "   MCP:   https://mcp.pegana.xyz"
echo "   Web:   https://pegana.xyz"
echo "   Grafana: ssh -L 3000:127.0.0.1:3000 $SERVER, then http://localhost:3000"

if $TAIL_LOGS; then
  echo ""
  echo "→ tailing logs (Ctrl+C to exit)..."
  ssh "$SERVER" "cd $REMOTE_DIR && docker compose logs -f --tail 30 $SERVICES"
fi
