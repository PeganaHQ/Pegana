#!/usr/bin/env bash
# Start a NON-DESTRUCTIVE canary of the protocol-indexer HF fix.
# Run ON THE BOX as the deploy user:   bash canary-up.sh </dev/null
#
# Does NOT touch ~/pegana, the live container, or compose state. It:
#   a) checks out origin/fix/protocol-indexer-hf-crash into a temp worktree
#      OUTSIDE ~/pegana (default /tmp/pi-canary) so deploy.sh sees a clean tree;
#   b) builds ./protocol-indexer-ts with the repo Dockerfile -> :canary tag;
#   c) runs ONE container `pi-canary` on the live service's network(s) with
#      --memory=1g --memory-swap=1g, read-only + tmpfs, no published ports,
#      the live container's env EXCEPT HELIUS_API_KEY (valid key taken from
#      SOLANA_RPC_URL in ~/pegana/.env, never printed), HTTP_PORT=8092 and
#      PROTOCOL_INDEXER_SOURCES=kamino_hf,jupiter_lend_hf (HF sources only, so
#      kamino/jupiter_lend are NOT double-polled);
#   d) prints the container id.
#
# Write semantics (why the canary is safe against prod data): it writes only
# loop_hf_distribution via INSERT .. ON CONFLICT (asset,protocol,hf_band,ts) DO
# UPDATE. ts is the per-cycle timestamp, so canary rows are additive, identical
# in shape to what the live HF sources would write (they are currently frozen
# on 401) and cannot overwrite other rows. No read of owners; ADR-0036 intact.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/pegana}"
ENV_FILE_SRC="${ENV_FILE_SRC:-$REPO_DIR/.env}"
WT="${CANARY_WT:-/tmp/pi-canary}"
BRANCH="${CANARY_BRANCH:-fix/protocol-indexer-hf-crash}"
LIVE="${LIVE_CONTAINER:-pegana-protocol-indexer}"
NAME=pi-canary
IMAGE=pegana-protocol-indexer:canary
HF_POLL_MS="${CANARY_HF_POLL_MS:-1200000}"   # 20 min: >=2 cycles in a 40 min watch

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
docker inspect "$LIVE" >/dev/null 2>&1 || { echo "live container $LIVE not found" >&2; exit 1; }
if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "container $NAME already exists - run canary-down.sh first" >&2; exit 1
fi

# --- valid Helius key (never printed) ---------------------------------------
KEY="$(grep -E '^SOLANA_RPC_URL=' "$ENV_FILE_SRC" | head -1 | sed -n 's/.*api-key=\([^&[:space:]"'"'"']*\).*/\1/p')"
if [ "${#KEY}" -ne 36 ]; then
  echo "could not extract a 36-char api-key from SOLANA_RPC_URL in $ENV_FILE_SRC (got ${#KEY} chars)" >&2
  exit 1
fi
echo "helius key extracted (36 chars, not shown)"

# --- (a) temp worktree outside ~/pegana -------------------------------------
git -C "$REPO_DIR" fetch origin "$BRANCH" --quiet
if [ -d "$WT" ]; then git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"; fi
git -C "$REPO_DIR" worktree add --detach "$WT" "origin/$BRANCH" >/dev/null
SHA="$(git -C "$WT" rev-parse --short HEAD)"
echo "worktree $WT at $SHA"

# --- (b) build (same context + Dockerfile as compose protocol-indexer) ------
docker build -t "$IMAGE" "$WT/protocol-indexer-ts"

# --- (c) env: live env minus overridden keys, via a private tmp env-file ----
ENVF="$(mktemp)"; chmod 600 "$ENVF"
trap 'rm -f "$ENVF"' EXIT
docker inspect "$LIVE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(DATABASE_URL|SOLANA_RPC_URL|SOLANA_RPC_URL_FALLBACK|KAMINO_[A-Z_]+|JUPITER_[A-Z_]+|SENTRY_DSN|SENTRY_RELEASE)=' \
  > "$ENVF"
{
  echo "HELIUS_API_KEY=$KEY"
  echo "HTTP_PORT=8092"
  echo "PROTOCOL_INDEXER_SOURCES=kamino_hf,jupiter_lend_hf"
  echo "KAMINO_HF_POLL_MS=$HF_POLL_MS"
  echo "JUPITER_HF_POLL_MS=$HF_POLL_MS"
} >> "$ENVF"   # later duplicates win in docker --env-file

NETS="$(docker inspect "$LIVE" --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)"
[ -n "$NETS" ] || { echo "cannot determine compose network" >&2; exit 1; }

CID="$(docker run -d --name "$NAME" --network "$NETS" \
  --memory=1g --memory-swap=1g --memory-swappiness=0 \
  --pids-limit=100 --cpus=1.0 --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp \
  --restart=no \
  --label canary=protocol-indexer \
  --env-file "$ENVF" \
  "$IMAGE")"
echo "canary container: $CID ($NAME) on network $NETS, image $IMAGE @ $SHA"
echo "next: bash canary-watch.sh   (watch >= 20 min; --restart=no so any exit is visible)"
