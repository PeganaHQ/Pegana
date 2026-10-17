# ADR 0006 — alert_evidence persistence failure policy

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; conflict between business rule #10 and
the `evidence_url` promise in dispatched payloads

## Problem

Business rule #10 says: "Never let an `alert_evidence` insert failure abort
an alert dispatch. Order of priority: deliver the alert > persist evidence.
We retry persistence; we never silence the alert."

But every dispatched payload (webhook, bot, MCP) includes
`evidence_url: https://pegana.xyz/audit/<alert_id>`. If the insert failed
and "retry" is undefined prose, the link is 404 — the trust pitch breaks
on the first DB hiccup.

## Decision

### Synchronous (in `push_alert`)
- Attempt INSERT into `alert_evidence` in the same transaction as the
  alert dispatch hand-off.
- On failure: log ERROR + Sentry + INSERT row into new
  `alert_evidence_pending` (JSONB column with full payload).
- Alert dispatch continues (rule #10 honored).
- Dispatched payload includes `evidence_status: "pending"` so consumers
  know the link may take time to respond.

### Background retry
- Tokio task in `engine-rs`, runs every 30 seconds.
- For each row in `alert_evidence_pending`: attempt INSERT into
  `alert_evidence`.
- On success: delete pending row + fire `evidence_now_available` webhook
  re-fire to subscribers that received the original.
- After 24h with no success: mark as `failed_permanent` + Sentry alert
  + bot DM to Rafael.

### Public API behavior
- `GET /v1/audit/:id`:
  - Row in `alert_evidence` → `200 OK` with receipt.
  - Row in `alert_evidence_pending` only → `202 Accepted` with
    `{"status": "pending", "retry_after_seconds": 60}`.
  - Row marked `failed_permanent` → `410 Gone` with
    `{"status": "persistence_failed", "alert_dispatched_at": "<ts>"}`.
  - No row anywhere → `404 Not Found` (genuinely unknown ID).
- Web `/audit/[id]` renders these states with matching tooltips.
- Never return 404 for an alert that was actually dispatched.

### Webhook payload
- New field `evidence_status: "ready" | "pending" | "failed_permanent"`.
- Default `"ready"`. HMAC signature covers it.

## Why the full package and not "just Sentry alert when it fails"

- First production DB hiccup (which is when, not if) generates public 404s.
- A real depeg event correlates with high DB load → deadlock cascade →
  10s of 404s from a single incident.
- 202/410 with explicit status preserves the trust narrative ("we're
  honest about state") and gives integrators a deterministic poll path.

## Consequences

- +1 migration: `alert_evidence_pending` table + `failed_permanent`
  state.
- +1 background task in `engine-rs`.
- +1 task in Phase 3 (table + retry).
- +0.5 task in Phase 5 (webhook `evidence_status` field).
- Estimated +0.5–1 day total.
- The 24h cutoff for `failed_permanent` is a default — adjustable per
  ops experience.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 10`
- `docs/pegana-trust-layer-v0.1.0/04-data-model.md` (add pending table)
- `docs/pegana-trust-layer-v0.1.0/07-api-surface.md` (update audit responses)
- `docs/pegana-trust-layer-v0.1.0/08-external-surfaces.md` (webhook field)
