# Webhook channel — v1.5 B2B

**Status:** spec, deferred until first inbound integration ask
**Priority:** medium — unblocks B2B, doesn't move retail metric

## Goal

Let protocols (Parity, StableGuard insurance, any future Solana lending app)
receive Pegana peg-state events as signed HTTP POST instead of TG. Protocols
won't integrate Telegram into a production stack.

## Why deferred

- 0 inbound asks so far. Building before demand is YAGNI.
- Distribution-first ordering: get Discord (consumer) + 1 design partner ask before this.
- Ed25519 signing infra has nice-to-have polish (key rotation, replay
  protection, retry envelope) that adds 1-2 days of engineering — not worth
  pre-shipping.

## Design (when triggered)

### DB additions

```sql
ALTER TABLE subscriptions ADD COLUMN webhook_url TEXT;
ALTER TABLE subscriptions ADD COLUMN webhook_pubkey TEXT;
-- existing `channel` column already accepts 'webhook'

CREATE TABLE webhook_keypairs (
    user_id  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pubkey   TEXT NOT NULL,
    privkey  BYTEA NOT NULL,        -- encrypted with a master key
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Endpoints

```
POST /v1/me/webhooks            { url, asset, threshold_bps } → { id, pubkey }
GET  /v1/me/webhooks            list
DELETE /v1/me/webhooks/:id
POST /v1/me/webhooks/:id/rotate rotates the keypair
```

### Dispatcher behavior

Mirror of TG path:
1. Stream `pegana:alerts` consumer
2. For subscriptions where channel='webhook', POST signed payload to `webhook_url`
3. Headers:
   - `X-Pegana-Signature: ed25519=<sig>`
   - `X-Pegana-Pubkey: <pubkey>`
   - `X-Pegana-Timestamp: <unix>`
   - `X-Pegana-Delivery: <uuid>` (idempotency)
4. Retry on 5xx with exp backoff (5s → 30s → 5min), DLQ on 3rd failure
5. Per-URL circuit breaker: if a URL fails 10 in a row, mark sub `is_active=false` and email user

### Payload

```json
{
  "delivery_id": "uuid",
  "asset": "jitoSOL",
  "from_state": "PEGGED",
  "to_state": "DRIFT",
  "discount": 0.0072,
  "intrinsic_usd": "189.42",
  "market_usd": "188.06",
  "detected_at": "2026-05-25T20:42:00Z",
  "confidence": "high"
}
```

### Frontend

- `/account/webhooks` page (new) — list + add (url + pubkey shown once, copy button)
- AlertMeButton modal gains a "Channel" toggle: Telegram | Webhook
- AccountSidebar gets `Webhooks` entry between Subscriptions and Alerts

## Effort estimate

3 days (1d schema + signing + dispatcher path, 1d frontend, 1d testing + key rotation flow).

## Trigger conditions

Ship this when ANY of:
- A protocol explicitly asks for HTTP push
- Discord adapter ships and webhook is the natural next step
- 50+ active users on dogfood (proves retail demand, now go B2B)
