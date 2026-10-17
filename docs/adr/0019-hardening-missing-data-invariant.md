# ADR-0019: Hardening invariant — "missing data ≠ confirming data" (H1-H12)

- **Status:** Accepted (2026-05-31)
- **Supersedes:** none. Amends the engine/indexer/methodology behaviour documented in
  `06-engine-changes.md`, `05-methodology-crate.md`, and the source adapters.

## Context

The 2026-05-29 "hardcoded blind-spots" audit found 12 places (H1-H12) where the
pipeline silently turned **absent, stale, or degenerate upstream data** into a
signal that **confirms a healthy peg**. A risk oracle that says "PEGGED" when it
actually has no data is worse than one that says "I don't know" — it manufactures
false confidence at exactly the moment a depeg might be starting.

Examples found: a missing Pyth feed reported `confidence = "high"`; a failed hyUSD
collateral-ratio read was synthesized to `CR = 1.0` (a false Critical); a zero
intrinsic produced `discount = 0` (read as PEGGED); a canonical-hash failure
emitted an all-zero sentinel that was still committed on-chain; single-source
feeds (Sanctum, DexScreener) had no staleness gate; USDC and USDT priced each
other in a circular numéraire dependency.

## Decision

Adopt one invariant across engine, indexer, and methodology:

> **Missing / stale / broken data MUST NEVER be laundered into a value that
> confirms a healthy peg. It maps to an explicit non-confirming outcome
> (`None`, `"unknown"`, skip-the-tick, or a dropped receipt) that can only ever
> make a verdict look LESS certain, never more.**

Concretely (all on `main`, commits `64752d2` / `96367c0` / `66497ab` / `c301800`):

- **Confidence** (`pyth_confidence_label`) returns `Option`; a missing/stale/zero
  feed yields `None` → the asset's label degrades to `"unknown"` (ranks
  strictest), never `"high"`. The numéraire feed of a `jupiter_usd` asset is a
  first-class confidence input (H1/H3/H4/H9/H12).
- **Collateral ratio** (hyUSD): an absent CR skips the tick and preserves the
  prior state instead of synthesizing `CR = 1.0` (H2).
- **Discount** (`compute_discount`) returns `Option`; a zero/absent intrinsic →
  `None` → skip, never `discount = 0`. The methodology **version stays 0.1.0**:
  every valid (receipt-producing) input returns a byte-identical value, so no
  receipt's discount changes and the version hash is unaffected (H8).
- **Receipt integrity**: a canonical-hash failure DROPS the receipt loudly
  (Sentry + counter + `Err`) — an all-zero sentinel is never persisted, served,
  or committed on-chain (H10).
- **Staleness**: every input side carries an engine-receive timestamp;
  `snapshot()`/`snapshot_sol()` gate each side and return `None` when a source
  stops publishing, so `try_recompute` skips rather than re-serving the last
  value as current. Window is a generous floor (`SOURCE_STALENESS_SECS = 600s`,
  ~12-20× the real receive cadence) so it fires only on a true outage; pyth-fed
  sides use `max(per-feed Pyth window, floor)` because the indexer forwards them
  on a 30s throttle, not the 1Hz feed cadence (H6/H7).
- **Config integrity**: decimals are mint-coupled (no silent `_ => 6`); the
  USDC↔USDT circular numéraire is broken (each prices via its own `pyth_spot`
  feed) (H5/H11/H11b).

`confidence_label` and the discount remain **recorded** in the receipt and are
NOT recomputed by `pegana-replay-cli` (it re-hashes the recorded receipt), so
replay determinism is preserved: old receipts verify identically, new
`"unknown"`/degraded receipts are self-consistent.

## Deferred

- **H12b** (active periodic sweep to age out a TOTALLY-dead asset that receives
  no ticks at all). The snapshot-gating + counter cover the common "one side
  dead, the other still ticking" case; the standalone sweep carries a real
  false-stale risk (it could blank the dashboard) and is best built
  observability-first later.

## Consequences

- New `PegState` value surfaced more often: `"unknown"` confidence and skipped
  ticks. Consumers (web badge, SQL) must tolerate `"unknown"` — verified.
- New counters `pegana_engine_source_stale_total{asset,side}` and
  `pegana_engine_intrinsic_unavailable_total{asset}` with Prometheus alerts.
- Two adversarial review passes each caught a real bug the implementation missed
  (numéraire_feed ALTO; USDC/USDT intrinsic-seeding CRITICAL — both fixed before
  merge). A third risk (a 30s staleness window vs the 30s forwarding throttle =
  false-stale) was caught during live prod-local validation and floored at 600s.

## Verification

`cargo test --workspace` (28 suites) · `verify-assets` 28/28 against mainnet RPC ·
**live end-to-end on the prod-local stack**: USDC/USDT/USDY compute PEGGED with
fresh snapshots and zero false-stale firing.

## Pre-deploy note

Deploying to Hetzner is a deliberate owner step (it changes the live calibration
engine). The prod-local DB held a stray `methodology_versions` row marking
`0.1.0` as `broken`, which crash-loops the engine on restart — **check the prod
`methodology_versions` table before deploying.**
