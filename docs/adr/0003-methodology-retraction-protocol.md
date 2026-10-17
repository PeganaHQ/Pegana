# ADR 0003 — Retraction protocol for broken methodology versions

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; on-chain commitments + webhook consumers

## Problem

When `methodology_versions.status` flips to `broken` (we discover a bug in
a shipped version), the original spec only added a warning banner on
`/audit/[id]`. That is insufficient:

- Integrators (StableGuard, Parity) who received the live webhook acted on
  the signal automatically. A banner on a web page they never read does
  not reverse their automation.
- On-chain attestation is a permanent positive signal that the alert was
  real and verifiable. Without a retraction signal, it amplifies a wrong
  signal indefinitely.
- First time we discover a bug post-launch becomes a manual PR crisis
  instead of a documented protocol.

## Decision

Retraction is a first-class concept in v0.1.0 (not deferred):

1. **Web** — `/audit/[id]` shows banner for any alert produced by the
   broken version (already in spec).

2. **On-chain** — one retraction memo tx per broken version (not per
   alert). Payload format:
   `PEGANA_RETRACT|<broken_version>|<original_tx_sig_or_count>|<bug_short_id>`
   Cost: 1 tx per version bump, ~5000 lamports.

3. **Webhook** — re-fire to every subscription that received any alert
   produced by the broken version. Payload:
   ```json
   {
     "type": "retraction",
     "original_alert_id": "<uuid>",
     "original_methodology_version": "0.1.0",
     "retraction_reason": "bug:<short-id>",
     "retraction_evidence_url": "https://pegana.xyz/methodology#v0.1.0-broken"
   }
   ```
   Same HMAC ed25519 signing as alert webhooks.

4. **RSS** — item in `/audit.xml` with `<category>retraction</category>`.

5. **Bot** — `alert_retracted` template (PT-BR + EN) sent to every chat
   that received the original alert.

6. **API** — `GET /v1/audit/:id` returns `retracted: bool` (default false)
   and `retraction_reason: string | null`.

7. **Policy** — never delete or mutate the original `alert_evidence` row.
   Retractions are additive. The computation happened; only the
   interpretation changed.

## Why first-class and not "we'll deal with it when it happens"

- The trust pitch is "we publish corrections." Reactive ad-hoc messaging
  burns trust faster than a missing feature would have.
- Integrators with automated reversal (insurance payouts, prediction
  settlement) need a machine-readable retraction signal, not a tweet.
- Cost is bounded: ~0.5 day of engineering plus one column add. Bug
  discovery probability over the next 12 months is non-trivial.

## Consequences

- +1 task in Phase 5 (dispatcher webhook re-fire on retraction event).
- +1 migration: `retracted boolean DEFAULT false`, `retraction_reason text`
  in `alert_evidence`. Goes in migration 0028 or a new 0032.
- +1 method in `pegana-methodology`: `build_retraction_payload(...)`.
- /audit, /methodology pages need a "Retractions" section that lists every
  retraction event with timestamps and reasons.
- Operational runbook: how to mark a version broken + trigger retraction.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/05-methodology-crate.md § Versioning rules`
- `docs/pegana-trust-layer-v0.1.0/04-data-model.md § alert_evidence`
- `docs/pegana-trust-layer-v0.1.0/08-external-surfaces.md § Webhook`
