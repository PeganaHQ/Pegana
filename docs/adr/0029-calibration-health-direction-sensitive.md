# ADR-0029 — Calibration health mirrors the engine's direction-sensitive classification

- **Status:** Accepted (2026-07-01). Implemented on `feat/calibration-one-sided-health`
  (read-only API + ops SQL). No methodology version bump, no migration, no receipt/FSM change.
- **Decision owner:** founder-authorized (2026-07-01 recalibration retro).
- **Builds on:** ADR-0021 (LST premium carve-out, methodology 0.2.0), ADR-0025 / methodology
  0.4.0 (`NAV_PREMIUM_SANITY_BPS`, `premium_sanity_violated`). Amends
  `docs/operations/monitoring-only-promotion-criteria.md` (criterion 4).

## Context

`/v1/calibration` ("a trust oracle that knows when it is miscalibrated") and its ops twin
`scripts/calibration-monitor.sql §B` computed the trailing-8d p95/p99 over
**`abs(discount_smooth)`** — a *symmetric* magnitude. But the engine does not classify
direction-sensitive classes symmetrically:

- `thresholds.rs::state_for_bps_discount_aware` normalizes a **premium** (market above NAV,
  `discount < 0`) to **PEGGED** for `is_direction_sensitive = {lst, stable_yield}` — a premium
  is demand pressure, not depeg risk (ADR-0021; cf. stETH −7% 2022, ezETH — the risk is the
  *discount* side).
- `premium_sanity_violated` (methodology 0.4.0) forces **UNKNOWN** only when a premium exceeds
  `NAV_PREMIUM_SANITY_BPS = 1000` (a broken NAV/intrinsic anchor, e.g. sHYUSD's thin-Jupiter print).

**Consequence at the 2026-07-01 recalibration retro (50 beta assets):** the symmetric metric
reported **31 `watch` + 1 `miscalibrated`**. Verified against live data, **30 of the 31 `watch`
are LSTs (+ INF) sitting entirely on the benign premium side** — discount-side max over 24h =
**0.0 bps** for every one of them, 0 transitions, PEGGED, high confidence. The public health
verdict was contradicting the engine's own (correct) classification: healthy assets shown as
mis-banded on the endpoint whose entire pitch is honest self-assessment.

## Decision

Compute the calibration p95/p99 over a **direction-sensitive effective discount**, mirroring the
engine. For each snapshot, in bps:

```
effective_bps(class, d):                       # d = discount_smooth * 10000
  if class in {lst, stable_yield}:             # is_direction_sensitive
      if d >= 0:            d                   # discount side (below NAV) — real risk, counts
      elif |d| > 1000:      |d|                 # premium beyond NAV-sanity — broken anchor, counts in full
      else:                0                    # benign premium — carved out (ADR-0021)
  else:                    |d|                  # symmetric classes — both sides carry information
```

Applied identically in the endpoint (`crates/api-rs/src/routes/calibration.rs`, in-SQL `CASE`)
and the ops SQL (`scripts/calibration-monitor.sql §B`, both `dist` CTEs), with a `#[cfg(test)]`
Rust mirror (`effective_bps`) unit-tested against the LST/sHYUSD/PST cases. `classify()`
(p95 vs drift/depeg → `ok|watch|miscalibrated|no_data|na`) is unchanged.

**This is a read-only reporting change** — it never touches `discount_smooth`, the FSM, the
receipt, or any published verdict. Not a methodology version bump.

### Why NOT re-tune the LST bands instead (the decisive point)

The prior promotion guidance (criterion 4: "re-tune `drift ≈ p99 × 1.25`") is **wrong for
direction-sensitive classes**. It was written for symmetric assets. Widening an LST's `drift`
from ~55 to ~135 bps to "fit" a benign ~80 bps premium would **desensitize the discount side** —
the one side that carries the depeg signal — leaving the detector blind to a real market-below-NAV
move. The band must stay tight on the discount side; the *metric*, not the band, was mis-defined.

## Consequences

- **Positive.** The public health verdict becomes faithful to the engine. At the retro, the
  30-LST + INF "watch wall" collapses to `ok`; **sHYUSD stays `miscalibrated`** (its +1185 bps
  premium exceeds the 1000 bps sanity bound and counts in full — matching its live UNKNOWN);
  **PST stays `watch`** (a genuine +37.6 bps discount-side move). The retro can finally be read
  as behaviour, not measurement noise.
- **Amends** criterion 4 of `monitoring-only-promotion-criteria.md`: for lst/stable_yield,
  calibrate the **discount side**; never widen the band to fit a premium.
- **`health = ok` is NOT `market-leg-verified` — this is load-bearing.** This ADR only makes the
  metric faithful to the *engine*; it does not validate the *market leg*. The audit (2026-06-28,
  C1/C2 CRITICAL) flagged that `market_usd` for ~38 assets is a **1-unit Jupiter quote** —
  "distance to an unrealizable price" — with depth never entering the verdict. So an LST reading
  `ok` post-ADR-0029 means only "no discount-side move the engine would alert on," measured by a
  possibly-thin market leg. **Promotion (dropping `monitoring_only`) must therefore require an
  additional market-leg trust gate, NOT `health=ok` alone.**

## Adversarial check — does the carve-out hide a real signal?

The premium being carved out was cross-checked against an **independent oracle** (Pyth's own
market feed) for the four LSTs that carry one, 2026-07-01:

| LST | premium vs NAV (Jupiter) | premium vs NAV (Pyth market feed) | verdict |
|---|---|---|---|
| jitoSOL | +88 bps | +79 bps | real |
| bSOL | +83 bps | +72 bps | real |
| INF | +162 bps | +161 bps | real (near-identical) |
| mSOL | +88 bps | +59 bps | real (both > NAV; Pyth conf ±49 bps) |

Two independent market sources agree these LSTs genuinely trade above stake-pool NAV — the
premium is a real liquid-staking premium (pay for instant liquidity vs. the unstake delay), not a
Jupiter artifact. Carving it out is therefore correct, **for the assets that have a cross-check.**
The **22 new expansion LSTs have no Pyth feed** — their premium is Jupiter-only and unverified;
they must stay beta until a depth cross-check exists (ADR-0028), regardless of `health=ok`.

## Scope / non-goals

- **Not** the market-depth gate (ADR-0028 / methodology 0.5.0) — that is verdict-affecting and
  founder-gated; this ADR is orthogonal and ships now.
- **`synth_lev` (xSOL) is deliberately left symmetric here**, matching the *current* engine
  (`is_direction_sensitive` = {lst, stable_yield}). It joins the direction-sensitive set only
  when ADR-0028 §H1 extends `premium_sanity` to synth_lev in the 0.5.0 bump. (xSOL's p95 407 ≪
  drift 1500 → `ok` either way today, so no present effect.)
- **Sample-count floor (included):** an asset with `<200` snapshots in the 8d window reads
  `no_data`, not a confident `ok` — a general safeguard for genuinely *sparse* (e.g. newly-added)
  assets. Verified on deploy it flips nothing today (all live assets have ≥200 samples).
- **Freshness/staleness guard (deliberately NOT added):** USDu's actual failure is *staleness*
  (dark **now** — `state=null`/`updated_at=null`), not sparsity — it has ≥200 rows from earlier in
  the window, so `/v1/calibration` reads `ok` (an 8d *band-fit* statement). Its liveness is already
  surfaced honestly on `/v1/assets` (`state=null`), so a freshness guard here would duplicate that
  signal *and* false-flag `stable_fx` weekend-dark (EURC). USDu's real fix is its **ingestion
  root-cause** — a separate data-integrity follow-up, not a calibration-health change.

## Cross-refs

- `crates/api-rs/src/routes/calibration.rs`, `scripts/calibration-monitor.sql §B`.
- ADR-0021 (premium carve-out), ADR-0025 / `crates/methodology/src/thresholds.rs`
  (`NAV_PREMIUM_SANITY_BPS`, `premium_sanity_violated`, `state_for_bps_discount_aware`).
- `docs/operations/retro-recalibracao-2026-07-01.md` (the retro this resolves).
