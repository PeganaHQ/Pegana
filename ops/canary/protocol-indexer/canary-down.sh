#!/usr/bin/env bash
# Remove the canary container, image tag and temp worktree. Idempotent.
#   bash canary-down.sh </dev/null
set -uo pipefail
REPO_DIR="${REPO_DIR:-$HOME/pegana}"
WT="${CANARY_WT:-/tmp/pi-canary}"
docker rm -f pi-canary >/dev/null 2>&1 && echo "removed container pi-canary" || echo "no container"
docker rmi pegana-protocol-indexer:canary >/dev/null 2>&1 && echo "removed image tag" || echo "no image tag"
if [ -d "$WT" ]; then
  git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
  git -C "$REPO_DIR" worktree prune
  echo "removed worktree $WT"
fi
git -C "$REPO_DIR" status --porcelain | head -5
