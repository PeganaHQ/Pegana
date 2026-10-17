# ADR 0004 — On-chain commit retry, burst, alarm, and UI policy

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; SPL Memo commit on critical alerts

## Problem

`06-engine-changes.md` specifies fire-and-forget on-chain commit for
`Depeg | Critical | BlackSwan` alerts using SPL Memo. Four operational
gaps:

1. No retry — single RPC failure leaves `onchain_tx_sig = NULL` forever.
2. No burst control — real depeg event (e.g. 10/10/2025-shape) can fire
   100+ critical alerts in 30 min, hitting RPC quota.
3. No live wallet alarm — only startup check; can drain mid-event.
4. No explicit UI state for commit lifecycle (only NULL/value).

## Decision

### Retry
- RPC failure → 3 retries, exponential backoff (1s, 5s, 15s).
- Blockhash expired → re-fetch blockhash, retry immediately (up to 2x).
- `InsufficientFundsForFee` → no retry; log ERROR + page; UI shows
  `wallet_drained`.
- After 3 hard failures → row in new `alert_evidence_commit_failures`,
  background job retries every 1h for 24h, then marks `failed_permanent`.

### Burst control
- Semaphore in engine: max 5 in-flight commit tx.
- Excess commits queue (do NOT block alert dispatch — only the commit).
- Metric: `pegana_commit_queue_depth` (Grafana panel + alert >50).

### Wallet alarm
- `check_wallet_balance` runs every 5 min (cron task), not only startup.
- <0.3 SOL → warn log + metric.
- <0.1 SOL → ERROR log + Sentry capture + bot DM to Rafael.
- Runbook documents refill procedure.

### UI lifecycle states
`alert_evidence.commit_status` becomes an explicit enum:
- `not_applicable` — alert is not critical
- `pending` — attempt started, not yet failed, within 24h window
- `committed` — `onchain_tx_sig IS NOT NULL`
- `retry_exhausted` — 3 hard failures + 24h retry window expired
  (reason: `rpc | blockhash | other`)
- `wallet_drained` — `InsufficientFundsForFee`

`/audit/[id]` renders the state explicitly with a tooltip explaining
each one. Never display "NULL" or absence.

## Why the full package and not the simpler "committed | not_committed"

- A NULL sig that means "we tried and failed" reads the same as "we
  haven't gotten to it yet". Both readings damage trust differently;
  the explicit state separates them.
- Burst control prevents a real event (where the trust pitch matters
  most) from breaking the pitch via RPC throttling.
- A wallet alarm during operation, not just startup, prevents silent
  drain when alerts are firing rapidly.

## Consequences

- +1 task in Phase 3: `commit_status` enum, `alert_evidence_commit_failures`
  table, retry background job.
- +0.5 task in Phase 11/12: UI lifecycle states, metric, Grafana panel,
  Sentry capture, runbook.
- Estimated +1 day total.
- Dispatcher webhook payload can include `commit_status` if useful for
  integrators (defer to integration partner asks).

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/06-engine-changes.md` (commit flow)
- `docs/pegana-trust-layer-v0.1.0/11-observability.md` (metrics)
- `docs/pegana-trust-layer-v0.1.0/plans/04-phase-3-audit-persistence.md`
- `docs/pegana-trust-layer-v0.1.0/plans/12-phase-12-observability.md`
