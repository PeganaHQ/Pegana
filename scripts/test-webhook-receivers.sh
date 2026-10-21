#!/usr/bin/env bash
#
# CI orchestrator for the webhook reference receivers.
#
# Generates a fresh Ed25519 keypair, injects the public key into each
# receiver source (TS / Rust), boots them on ports 9001 / 9000
# in the background, then runs the dispatcher-rs integration
# test (`tests/webhook_receivers.rs`) against each receiver in turn.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECEIVERS_DIR="$REPO_ROOT/docs/examples/webhook-receivers"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

# 1. Generate fresh ed25519 keypair.
echo "→ generating Ed25519 keypair"
KEYS=$(python3 - <<'PY'
import base64
import secrets
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

priv_bytes = secrets.token_bytes(32)
priv = Ed25519PrivateKey.from_private_bytes(priv_bytes)
pub = priv.public_key()
print(base64.b64encode(priv_bytes).decode())
print(base64.b64encode(pub.public_bytes_raw()).decode())
PY
)
PRIV_B64=$(echo "$KEYS" | sed -n '1p')
PUB_B64=$(echo "$KEYS"  | sed -n '2p')
export PEGANA_WEBHOOK_SIGNING_KEY="$PRIV_B64"
echo "  pub key: $PUB_B64"

# 2. Inject pub key into each receiver source. Backup created so we
# can restore on exit (don't pollute the checked-in samples).
inject() {
  local file="$1"
  sed -i.bak "s|REPLACE_ME|$PUB_B64|g" "$file"
}
restore() {
  local file="$1"
  if [[ -f "$file.bak" ]]; then mv "$file.bak" "$file"; fi
}

TS_FILE="$RECEIVERS_DIR/typescript-cloudflare-worker/worker.ts"
RUST_FILE="$RECEIVERS_DIR/rust-axum/src/main.rs"

inject "$TS_FILE"
inject "$RUST_FILE"

restore_all() {
  restore "$TS_FILE"
  restore "$RUST_FILE"
}
trap 'cleanup; restore_all' EXIT

wait_for_port() {
  local port="$1"
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "http://127.0.0.1:$port/" 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

run_against() {
  local name="$1" url="$2"
  echo "→ running webhook_receivers tests against $name ($url)"
  PEGANA_RUN_RECEIVER_TESTS=1 \
  RECEIVER_URL="$url" \
  cargo test -p dispatcher-rs --test webhook_receivers -- --nocapture
}

# Rust / axum on :9000
if command -v cargo >/dev/null; then
  echo "→ booting Rust / axum receiver on :9000"
  (cd "$RECEIVERS_DIR/rust-axum" && cargo run --release) &
  PIDS+=($!)
  if wait_for_port 9000; then
    run_against "rust-axum" "http://127.0.0.1:9000"
  else
    echo "✗ Rust receiver never bound :9000"
    exit 1
  fi
fi

# TS / Cloudflare Worker on :9001
if command -v wrangler >/dev/null; then
  echo "→ booting TS / Cloudflare Worker receiver on :9001"
  (cd "$RECEIVERS_DIR/typescript-cloudflare-worker" && wrangler dev --port 9001) &
  PIDS+=($!)
  if wait_for_port 9001; then
    run_against "typescript-cloudflare-worker" "http://127.0.0.1:9001"
  else
    echo "✗ Cloudflare receiver never bound :9001"
    exit 1
  fi
fi

echo "✓ all reachable receivers passed the 4-case matrix"
