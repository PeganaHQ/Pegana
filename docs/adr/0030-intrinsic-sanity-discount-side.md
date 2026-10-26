# ADR-0030 — Intrinsic-sanity guard: discount-side NAV-sanity (methodology 0.5.0)

- **Status:** Accepted (2026-07-01). Implemented on `feat/intrinsic-sanity-0.5.0`, **validated, NOT
  yet deployed** — the engine deploy is gated on the `pegana-replay` CLI re-release (see §Rollout).
- **Mirrors:** ADR-0025 (the 0.4.0 NAV **premium**-sanity) — this is its exact counterpart on the
  **discount** side. Builds on ADR-0021 (direction-sensitive classification), ADR-0024 (why a
  constancy/step detector is rejected).
- **Decision owner:** founder (the 0.5.0 flip + the CLI re-release).

## Context

The 0.4.0 `premium_sanity_violated` guard catches a garbage-**LOW** intrinsic (market sits far
*above* it → false PEGGED). The symmetric case was left open: a garbage-**HIGH** intrinsic (market
sits far *below* it → false CRITICAL/BLACK_SWAN).

**Incident 2026-06-24 (root-caused via the public history endpoint):** JLP's Pyth `JLP/USD.RR`
intrinsic feed printed **21817.55** vs a correct **3.41** (~6400× garbage). Discount =
1 − 3.41/21817.55 = **0.9998 (9998 bps)** → the engine classified **BLACK_SWAN** and it reached
public egress (beta/provisional). The market leg was fine — a single garbage RR print. It slipped
**both** existing guards:
- `is_plausible_discount_sample` = `|d| < 1.0` (`discount.rs`) — 0.9998 < 1.0 passes.
- `premium_sanity_violated` — fires only when `discount < 0` (premium side).

## Decision

Add a discount-side mirror of `premium_sanity`:
```
NAV_DISCOUNT_SANITY_BPS = 3000  // 30%
discount_sanity_violated(class, discount) =
    is_direction_sensitive(class) && discount > 0 && |discount| > 3000 bps
```
When it fires, the engine forces **UNKNOWN** with `state_reason = "discount_sanity"` (honest-dark),
instead of publishing a false CRITICAL/BLACK_SWAN off a broken NAV anchor. Applied at the same live
gate as premium_sanity (`engine-rs/main.rs`) and mirrored in the re-derivation path
(`methodology/rederive.rs`) for replay parity.

### Bound = 3000 bps, calibrated from data (not a guess)
- Real yield/LST depegs are bounded ≤ ~25% (stETH −7% 2022, ezETH low-double-digits). All must still
  classify — and they do (5–25% < 3000 bps → DEPEG/CRITICAL on the normal bands).
- The widest legitimate `critical` band in the universe is JLP's **1500 bps**; 3000 = 2× that = at/beyond
  the BLACK_SWAN entry (`2×critical`) of even the widest-banded asset. So nothing a calibrated asset
  reaches in a real depeg is touched.
- Symmetric classes (fiat/fx/dn/cdp) are excluded: for a hard-$1 peg a 30% move IS a legitimate
  BLACK_SWAN (UST-style) and must NOT be laundered to UNKNOWN.
- **This is NOT ADR-0024** — a single-sample magnitude check, not a discount-constancy/step detector.

## Validation (all green; "nada pode quebrar")
- **Inert on the live universe:** the max positive (below-NAV) discount among direction-sensitive
  assets is **245 bps (sUSD)** ≪ 3000 → **zero** current assets flip.
- **Backtest drift-gate (2025-10-10):** re-baselined golden — **STATE changes = 0**; the only diff is
  `methodology_version` 0.4.0→0.5.0. No verdict moved in history.
- 92 methodology + engine tests green (incl. real 7%/15%/25% depegs → classify, NOT UNKNOWN; the JLP
  9998 bps garbage → UNKNOWN). rederive parity proven. fmt + clippy clean.

## Rollout (verdict-affecting → 0.5.0, CLI-first per F-13b)
1. Merge → deploy the engine (rebuild; embeds methodology 0.5.0). New receipts record 0.5.0.
2. **Re-release `pegana-replay`** embedding 0.5.0 so 0.5.0 receipts stay publicly re-derivable — the
   published 0.4.1 CLI rejects 0.5.0 receipts with `exit(3) VERSION_MISMATCH`. **CLI-first, then engine**
   (F-13b precedent) to avoid a re-derivability gap. This crates.io publish is **founder-gated + irreversible.**
3. Per ADR-0009 this is a MINOR bump. It corrects a false-positive that reached egress → plausibly the
   ADR-0009 **critical-bug exception** (compress the 7-day announce), but the founder records the choice.
   Note: the guard is provably inert today, so there is **no urgency** — it may equally be bundled with a
   future methodology change to amortize the announce + the CLI release.

## Cross-refs
- `crates/methodology/src/thresholds.rs` (`discount_sanity_violated`, `NAV_DISCOUNT_SANITY_BPS`),
  `lib.rs` (`STATE_REASON_DISCOUNT_SANITY`), `engine-rs/src/main.rs`, `methodology/src/rederive.rs`.
- `crates/methodology/CHANGELOG.md` § 0.5.0; ADR-0025 (the premium-side mirror); ADR-0021; ADR-0024.
