# ADR-0028 — Market-quote notional + depth gate (C1/C2, methodology 0.5.0)

**Status:** Proposed (founder decision validated 2026-06-30; awaiting go + observe-first calibration before the 0.5.0 flip)
**Supersedes/extends:** ADR-0026 (tokens.xyz liquidity depth-gate — observe-first), ADR-0025 (methodology version-bump cadence)
**Decision owner:** founder (notional value + the observe→gate flip); Opus drafted + validated.

## Context

The market leg of the discount is a Jupiter `ExactIn` quote of **1 whole unit** (`jupiter.rs:195`, `amount = 10^decimals`). The audit (C1) found this measures a near-mid, **unrealizable** price in a thin pool: a $8k pool weighs the same as a $50M pool because a 1-unit trade barely moves either. Depth (`priceImpactPct`) is collected but never gates the verdict (C2).

### Empirically validated (2026-06-30, Jupiter lite-api, real assets)
The Jupiter quote **is size-aware** — `priceImpactPct` and route-existence scale with `amount`:

| Asset → numéraire | $1 (1 unit, current) | $1,000 | $10,000 |
|---|---|---|---|
| **sHYUSD → USDC** (thin) | impact 0.17%, rate 1.412 | impact **1.33%** (8×), rate 1.396 | **NO ROUTE** |
| **USDC → USDT** (deep, control) | — | — | impact **0.0022%** |

Three facts this proves:
1. The 1-unit quote's 0.17% impact **hides** that sHYUSD's pool cannot absorb even $10k.
2. A probe at a realistic notional **discriminates** thin (no route / high impact) from deep (≈0% impact).
3. sHYUSD's 1-unit rate of **1.412** (+41% over its ~$1 NAV) is the "thin-Jupiter print" mispricing — already caught by `premium_sanity` → UNKNOWN (live in prod). C1/C2 add the **depth** dimension that a price-anomaly check alone does not cover (a thin pool whose price is *near* NAV would pass premium_sanity but still be un-exitable).

### Industry framing (sources)
Stablecoin exit-liquidity is measured by **selling a meaningful notional and reading the slippage** — the common benchmark is **$1M for major stables, with >10–20 bps = exit liquidity drying up** ([defi-monitor](https://defi-monitor.com/blog/stablecoin-depeg-risk-collateral-monitoring/)). The "realizable" price is the price-at-size, not the mid. For Pegana's universe (mostly thin long-tail pegged assets), the relevant probe is far smaller than $1M.

## Decision

1. **Probe the market quote at a realistic NOTIONAL, not 1 unit.** Start with a **universal reference of ~$1,000** (validated: surfaces thin-pool impact — sHYUSD 1.33% — without being "no route" for most tracked pools; deep pools read ≈0%). The notional is **per-class-tunable** later (deeper stables warrant a larger probe, e.g. $10k–$100k) — calibrated, not guessed.

2. **Use depth as a CONFIDENCE/UNKNOWN gate, NOT as the price** (C2). Do **not** feed the size-impacted price into `market_usd` for the verdict — that would conflate "thin pool" with "depeg" (a thin pool would always show a discount even when the asset is fine). Instead: when the probe returns **no route** OR `priceImpactPct > threshold` at the reference notional → cap `confidence_label` to `low` and, beyond a hard bound, force **UNKNOWN** with `state_reason = "shallow_market"` (the honest-dark default, founder-confirmed). The reported price stays the mid-ish quote, flagged.

3. **Observe-first before the gate flips** (ADR-0026). Phase 0 (hash-preserving, deployable like A/C/D/E): record `priceImpactPct` + route-found at the reference notional per asset as a metric/panel, **verdict unchanged**. Calibrate the per-tier `shallow_market` threshold from ~2 weeks of real data. Phase 1 (the 0.5.0 bump): flip the gate.

4. **Version + rollout** (ADR-0025 cadence): the Phase-1 gate is verdict-affecting → **methodology MINOR bump 0.4.0 → 0.5.0**, with this ADR, a `pegana-replay` drift-gate diff (the 2025-10-10 backtest re-baselined with documented expected verdict changes), a **7-day announce + dual-run**, and historical 0.4.0 receipts verified via the **version-pinned CLI** (`PEGANA_REPLAY_VERSION`, the existing `exit(3)`-on-mismatch model — no in-binary multi-version dispatch exists, and we will not add one).

5. **H1 rides along:** extend `premium_sanity` to `synth_lev` (xSOL) + CDP (hyUSD) — same 0.5.0 bump.

## Consequences

- **Positive:** the oracle stops being confidently-priced on un-exitable pools; the depth signal becomes verdict-load-bearing; the "shallow_market" reason is legible (Trilha A's `state_reason`, promoted into `Computed` so it's re-derivable). Demo-able and defensible to a partner/grant.
- **Cost / risk:** changes LIVE verdicts (some thin assets flip to UNKNOWN); breaks the single-binary re-derive of 0.4.0 receipts (mitigated by version-pinned CLI). Requires founder sign-off on the notional + the flip, and the dual-run — this is why B is the only founder-gated trilha.
- **Calibration risk:** a too-aggressive threshold over-flags (everything UNKNOWN); too-loose under-flags. Observe-first + per-tier calibration is the control. The reference notional and the threshold are the two knobs; both come from data, not a guess.

## Open founder decisions (this ADR resolves #1's direction; confirm the value + the flip)
- **Reference notional:** ✅ recommended **$1,000 universal** to start (validated), per-class tiering after observe-first. Confirm or override.
- **Gate hard-bound (force UNKNOWN):** the `priceImpactPct` / no-route threshold — set from observe-first data, not now.
- **Go for the 0.5.0 flip** after the 2-week observe-first window + a clean drift-gate diff you've reviewed.
