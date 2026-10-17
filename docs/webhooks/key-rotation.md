# Pegana webhook key rotation playbook

Pegana signs every outbound webhook with Ed25519 over:

```text
<x-pegana-timestamp>.<raw request body>
```

Receivers verify the signature against the active public keys published at:

```text
GET https://api.pegana.xyz/v1/meta/webhook-keys
```

The response is ordered:

```json
{
  "pubkeys_b64": ["primary_public_key", "secondary_public_key_during_rotation"]
}
```

Index `0` is the current primary. Index `1`, when present, is the next key being
pre-published before a signing cutover.

## Operator procedure

1. Generate a new 32-byte Ed25519 seed and set it as
   `PEGANA_WEBHOOK_SIGNING_KEY_NEXT`.
2. Redeploy `api` and `dispatcher`. `/v1/meta/webhook-keys` now publishes both
   the current primary public key and the next public key.
3. Wait at least 24 hours. Reference receivers cache metadata keys for one hour,
   but 24 hours gives slow operators and manually pinned deployments room to
   update.
4. Promote the next key by copying the same seed into
   `PEGANA_WEBHOOK_SIGNING_KEY`.
5. Unset `PEGANA_WEBHOOK_SIGNING_KEY_NEXT`.
6. Redeploy `api` and `dispatcher` again.
7. Verify `/v1/meta/webhook-keys` returns only the new primary public key.

During step 2 through step 5, receivers should trust both published public keys.
Pegana signs with the primary key only; the secondary key is published early so
receivers can trust it before the cutover.

## Receiver requirements

Receivers should:

- Fetch `https://api.pegana.xyz/v1/meta/webhook-keys` at startup or on a short
  cache TTL.
- Verify against every key in `pubkeys_b64`, not just index `0`.
- Keep a local fallback via `PEGANA_PUB_KEY_B64` for fail-closed deployments.
- Treat `PEGANA_PUB_KEY_B64` as a comma-separated list during rotation:
  `primary,secondary`.
- Keep replay protection at 300 seconds.
- Dedupe on `x-pegana-event-id`, which is stable across retries.

Reference receivers implementing this model live in:

- `docs/examples/webhook-receivers/typescript-cloudflare-worker/`
- `docs/examples/webhook-receivers/python-fastapi/`
- `docs/examples/webhook-receivers/rust-axum/`

## Verification checklist

Before promoting the key:

- `curl -s https://api.pegana.xyz/v1/meta/webhook-keys` returns two keys.
- The TypeScript, Python, and Rust reference receivers verify a test delivery.
- At least one production dogfood receiver has refreshed its key cache after the
  secondary was published.

After promoting the key:

- `curl -s https://api.pegana.xyz/v1/meta/webhook-keys` returns one key.
- `POST /v1/me/webhooks/{id}/test` succeeds against the dogfood receiver.
- `/v1/me/webhooks/{id}/deliveries` shows the test delivery as 2xx.
- No receiver logs show `invalid signature` for the promoted key.

## Rollback

If receivers reject the promoted key, reverse the promotion:

1. Put the old seed back in `PEGANA_WEBHOOK_SIGNING_KEY`.
2. Put the new seed back in `PEGANA_WEBHOOK_SIGNING_KEY_NEXT`.
3. Redeploy `api` and `dispatcher`.
4. Confirm `/v1/meta/webhook-keys` again returns `[old_primary, new_secondary]`.

This restores signatures to the old key while keeping the new key visible for
receivers that already accepted it.
