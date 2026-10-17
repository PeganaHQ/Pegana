# Pegana webhook receivers — reference implementations

Three production-ready receivers that verify an Ed25519-signed Pegana
webhook payload. Pick the one closest to your stack; all three pass
the same test matrix in `crates/dispatcher-rs/tests/webhook_receivers.rs`.

| Receiver | Stack | Verify API | Folder |
|---|---|---|---|
| 1 | TypeScript / Cloudflare Worker | Web Crypto API `crypto.subtle.verify` (Ed25519, Secure Curves) | `typescript-cloudflare-worker/` |
| 2 | Rust / axum | `ed25519-dalek` (RFC-8032 strict mode) | `rust-axum/` |
| 3 | Python / FastAPI | `cryptography.hazmat.primitives.asymmetric.ed25519` | `python-fastapi/` |

## Signing contract (canonical)

- Header `x-pegana-signature: ed25519:<base64 64-byte sig>`
- Header `x-pegana-timestamp: <unix seconds>`
- Header `x-pegana-event-id: <uuid>` — stable across retries; use for dedup
- Header `x-pegana-delivery-id: <uuid>` — fresh per attempt; use for logs
- Header `x-pegana-attempt: <n>/<max>` — current retry envelope
- Signed input: UTF-8 of `<timestamp>.<request body>`
- Replay window receivers MUST enforce: **300 seconds**
- Retries: Pegana attempts up to 6 times with 5s / 30s / 5m / 30m /
  2h backoff on any non-2xx or network error. Receivers MUST be
  idempotent — dedupe on `x-pegana-event-id` (same value as
  `alert_id` in the body).

## Public-key distribution

Pegana publishes active Ed25519 public keys at:

```text
GET https://api.pegana.xyz/v1/meta/webhook-keys
```

The response is `{ "pubkeys_b64": ["<primary>", "<secondary during rotation>"] }`.
Receivers should trust every key in that list. During a rotation window, both keys
are valid so Pegana can publish the next key before the signing cutover.

The three reference receivers ship with a baked-in fallback plus an
environment override named `PEGANA_PUB_KEY_B64`. Set it to a comma-separated
list (`primary,secondary`) if you want zero runtime dependency on the metadata
endpoint.

## Body schema

```json
{
  "asset": "sUSDe",
  "from_state": "PEGGED",
  "to_state": "DRIFT",
  "discount_bps": -47,
  "ts": "2026-05-26T22:55:00Z",
  "alert_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

`from_state` / `to_state` are one of: `PEGGED`, `DRIFT`, `DEPEG`,
`CRITICAL`, `BLACK_SWAN`, `UNKNOWN`.

## Pick a receiver

- `typescript-cloudflare-worker/` — best for a low-ops edge endpoint.
- `python-fastapi/` — best when your automation already lives in Python.
- `rust-axum/` — best for a small binary with strict Ed25519 verification.
