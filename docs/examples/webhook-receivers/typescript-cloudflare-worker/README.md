# TS / Cloudflare Worker — Pegana webhook receiver

Verifies an Ed25519-signed Pegana webhook in a Cloudflare Worker
using the Web Crypto API. Tested under axe-core's signed payload
matrix in `crates/dispatcher-rs/tests/webhook_receivers.rs`.

## 60-second quickstart

```bash
wrangler init pegana-receiver
cd pegana-receiver
cp ../pegana/docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts src/worker.ts
cp ../pegana/docs/examples/webhook-receivers/typescript-cloudflare-worker/wrangler.toml wrangler.toml
wrangler kv namespace create PEGANA_DEDUP
wrangler deploy
```

Then register the deployed Worker URL at
https://pegana.xyz/account/webhooks.

`worker.ts` fetches active public keys from
`https://api.pegana.xyz/v1/meta/webhook-keys`, caches them for one hour,
and verifies against every active key. If you want a fixed fallback, set:

```bash
wrangler secret put PEGANA_PUB_KEY_B64
# value: primary_base64,secondary_base64_during_rotation
```

## Local testing

```bash
wrangler dev --port 9001
```

Then exercise it from the dispatcher test harness:

```bash
PEGANA_RUN_RECEIVER_TESTS=1 \
RECEIVER_URL=http://127.0.0.1:9001 \
cargo test -p dispatcher-rs --test webhook_receivers
```

## Security notes

- Replay window is **5 minutes**. Reject anything outside.
- Pegana retries up to **6 attempts** with 5s / 30s / 5m / 30m / 2h
  backoff. Dedupe on `x-pegana-event-id`.
- Web Crypto's Ed25519 verify is constant-time. Don't roll your own.
- Bind `PEGANA_DEDUP` KV in production so dedup and key-cache survive
  Worker isolate restarts.
