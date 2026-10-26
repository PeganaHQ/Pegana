# ADR 0010 — Engine state snapshot for restart determinism

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; engine in-memory state across restarts

## Problem

The engine holds mutable state in-memory per asset:
- `ewma_discount: Option<Decimal>`
- `candidate_state: Option<PegState>`
- `candidate_since: Option<DateTime<Utc>>`
- `last_state: PegState`

On restart (deploy, crash, OOM, machine reboot), this state is wiped.
Consequences:

- EWMA needs ~30 ticks to converge from `None` again. During that window
  alerts are noisier than steady state.
- `candidate_since` resets, so the hysteresis logic in `transition_decide`
  starts fresh — a state that was about to confirm may get reset.
- Calibration data captured around restarts is biased toward "first-30-
  ticks" behavior, which is not representative of normal operation.

## Decision

Persist minimal engine state to Postgres on a short cadence and reload on
startup.

### Schema

```sql
CREATE TABLE engine_state_snapshot (
  asset            text PRIMARY KEY,
  ewma_discount    numeric,
  candidate_state  text,
  candidate_since  timestamptz,
  last_state       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

### Write cadence
- Every successful `apply_ewma + transition` cycle → upsert the row for
  that asset (in-band; same transaction as `alert_evidence` if alert
  fired).
- SIGTERM handler flushes any pending state before exit.

### Read on startup
- `EngineState::load_from_pg(pool).await` runs before the first
  `try_recompute`.
- Missing row for an asset → start fresh (None / Pegged), same as
  today's behavior.
- Logging: count of restored vs cold-start assets.

### Replay determinism
- Receipts already capture `ewma_prev`, `candidate_state`, `candidate_since`
  in `InputsFrozen`, so this change does not affect existing replay
  semantics. It only narrows the live-system divergence across restarts.

## Why persist and not "accept the restart noise"

- ADR-0005 puts Phase 3 in prod on 2026-06-01, meaning ~10 days of
  dogfood data drives the launch verdict. If a single restart in that
  window biases noise classification, the verdict can be wrong.
- The persisted state IS the cache that replay receipts already capture
  per-alert — making it durable is consistent with the existing model.
- Cost: one migration, ~50 lines of code, one shutdown handler. Cheap.

## Consequences

- +1 migration (0033 or similar) for `engine_state_snapshot`.
- +0.5 task in Phase 3: write path + load path + SIGTERM handler.
- Engine startup latency increases by one PG query per active asset
  (~50ms for 26 assets). Negligible.
- Snapshot drift: if engine crashes between write and DB commit, state
  may be 1 cycle stale. Acceptable.
- Manual reset path: `TRUNCATE engine_state_snapshot` if you need to
  force fresh starts (e.g. after a methodology bump that invalidates
  the cache semantics).

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/06-engine-changes.md § state.rs`
- `docs/pegana-trust-layer-v0.1.0/04-data-model.md` (new table)
- `docs/pegana-trust-layer-v0.1.0/plans/04-phase-3-audit-persistence.md`
