# Rust / axum — Pegana webhook receiver

Verifies an Ed25519-signed Pegana webhook with `axum` and
`ed25519-dalek` strict verification. The binary is stateless except for
a small in-process dedup queue used by the example.

## 60-second quickstart

```bash
cargo new pegana-receiver --bin
cd pegana-receiver
cp ../pegana/docs/examples/webhook-receivers/rust-axum/Cargo.toml Cargo.toml
cp ../pegana/docs/examples/webhook-receivers/rust-axum/src/main.rs src/main.rs
cargo run --release
```

The receiver listens on `:9000`. Put it behind TLS, then register the
public URL at https://pegana.xyz/account/webhooks.

For production, set the active key list from:

```bash
curl -s https://api.pegana.xyz/v1/meta/webhook-keys
export PEGANA_PUB_KEY_B64="primary_base64,secondary_base64_during_rotation"
```

Deploy as a systemd service, container, or behind your existing reverse
proxy. Replace the in-process dedup queue with Redis or Postgres if you
run multiple replicas.

## Local testing

```bash
cargo run &
PEGANA_RUN_RECEIVER_TESTS=1 \
RECEIVER_URL=http://127.0.0.1:9000 \
cargo test -p dispatcher-rs --test webhook_receivers
```

## Security notes

- Replay window: **5 minutes**.
- Pegana retries up to **6 attempts** with 5s / 30s / 5m / 30m / 2h
  backoff. Dedupe on `x-pegana-event-id`.
- `verify_strict` enforces RFC-8032 Ed25519 — does NOT accept
  malleable signatures.
