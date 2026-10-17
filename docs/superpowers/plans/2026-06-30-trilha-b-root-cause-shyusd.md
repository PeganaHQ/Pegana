# Trilha B — Root-cause sHYUSD (notional + depth gate) Implementation Plan

> **For agentic workers:** Two phases. **Phase 0 is shippable now** (observe-first, hash-preserving, like A/C/D/E). **Phase 1 is the methodology 0.5.0 bump — FOUNDER-GATED** (changes live verdicts; needs the notional confirm + observe-first calibration + ADR-0028 + drift-gate + 7-day dual-run). Implemented by **Codex** (Sonnet fallback), reviewed 1:1 by **Opus**, with `/code-review ultra` on Phase 1.

**Goal:** Stop the oracle from being confidently-priced on un-exitable pools (the sHYUSD class). Probe the market quote at a realistic notional, use depth (`priceImpactPct` + route-found) to gate confidence/UNKNOWN — validated empirically (ADR-0028).

**Decision source:** `docs/adr/0028-market-quote-notional-depth-gate.md` (validated 2026-06-30).

---

## PHASE 0 — Observe-first instrumentation (SHIP NOW, hash-preserving)

Goal: collect the depth signal at the reference notional WITHOUT changing any verdict, so the per-tier threshold can be calibrated from real data. Deployable like the prior trilhas (no hash change, no founder gate).

### Task B0.1 — depth-probe quote + metric (indexer)
**File:** `crates/indexer-rs/src/sources/jupiter.rs`
- Add a SECOND Jupiter quote (alongside the existing 1-unit price quote) at the **reference notional = $1,000-equivalent** in the asset's units (compute from the asset's ~$1-ish price; for non-$1 assets, derive units from the last known price, fallback to a per-class default). Use the same `ExactIn`, `slippageBps=50`.
- Record, as observe-first metrics (NO verdict change, NOT in the receipt): `pegana_jupiter_depth_probe_impact{asset}` (gauge = priceImpactPct at the reference notional) and `pegana_jupiter_depth_probe_route{asset}` (gauge 1=route found, 0=no route). Reuse the existing 429-retry/error handling; on no-route, set route=0 + skip impact (do NOT bail the price quote — the price leg is independent).
- Keep the existing price-leg quote (1 unit) and `market_usd` UNCHANGED — Phase 0 must not move the verdict or the hash.
- **TDD:** unit-test the notional-from-price helper (e.g. `reference_units(price, decimals) -> u128` → ~$1k worth). Gate: build/clippy/fmt/test + hash baseline `31c06db4fc9a` unchanged.

### Task B0.2 — observe-first panel + (disabled) draft alert
**File:** `ops/grafana/dashboard.json`, `ops/alerts/pegana.yml`
- Add a panel for `pegana_jupiter_depth_probe_impact` / `_route` per asset (validate JSON). Add a COMMENTED draft alert for "shallow_market candidate" (enable after calibration). Hash-irrelevant.

**Phase 0 exit:** deploy via `scripts/deploy.sh` (no migration); collect ~2 weeks; review the per-asset impact distribution to set the Phase-1 threshold + confirm/tune the reference notional.

---

## PHASE 1 — methodology 0.5.0 bump (FOUNDER-GATED — do NOT start without: notional confirmed + observe-first data + founder go)

### Task B1.0 — ADR + version bump
- Finalize `docs/adr/0028`; bump methodology version 0.4.0 → 0.5.0 (`crates/methodology` Cargo.toml + version.rs test); update `METHODOLOGY.md`.

### Task B1.1 (C1) — realistic notional feeds the depth signal
**File:** `jupiter.rs` — promote the B0.1 depth probe to the live path. The PRICE (`market_usd`) decision per ADR-0028: keep the mid-ish quote for reporting; the probe's `priceImpactPct`/route is the gate input (do NOT set market_usd to the size-impacted price).

### Task B1.2 (C2) — depth gate → confidence / UNKNOWN + state_reason
**Files:** `crates/methodology/src/{thresholds.rs,receipt.rs}`, `crates/engine-rs/src/main.rs`
- When the probe is no-route OR `priceImpactPct > calibrated_threshold`: cap `confidence_label` to `low`; beyond a hard bound, force `final_state = UNKNOWN`. Emit `state_reason = "shallow_market"`.
- **Promote `state_reason` INTO `Computed`** (it was added out-of-hash in Trilha A) so it is hashed + re-derivable under 0.5.0. Fold M9/L2/L13.
- This CHANGES the hash → re-baseline the 2025-10-10 backtest fixtures; the drift-gate diff documents the expected verdict changes.

### Task B1.3 (H1) — premium_sanity → synth_lev (xSOL) + CDP (hyUSD)
**File:** `crates/methodology/src/thresholds.rs` — extend `premium_sanity_violated` coverage, bound per class.

### Task B1.4 (M18) — backtest exercises the sHYUSD premium-vs-NAV + shallow-market class
**File:** `crates/xtask/src/backtest/` — add a fixture/case demonstrating both `premium_sanity_violated` and the new `shallow_market` gate.

### Task B1.5 (M19, AFTER 0.5.0 stabilizes) — JS re-derive
**File:** `web/lib/` — port `compute_discount` + `thresholds` + hysteresis to TS with property-tests mirroring the Rust proptests, so the in-browser "Verify" re-derives the verdict (makes the "verifiable" claim literal). Do AFTER the bump stabilizes to avoid maintaining two impls mid-change.

**Phase 1 exit (MAXIMUM gate):** `/code-review ultra` on C1/C2 · `/review-and-iterate` · cargo/vitest green · **MUST pass the re-baselined 2025-10-10 drift-gate with the diff reviewed by the founder** · ADR-0028 merged · **7-day announce + dual-run** before flipping prod · version-pinned CLI preserved for 0.4.0 receipts.

## Self-review (author)
- **Coverage:** C1→B1.1 · C2→B1.2 (+M9/L2/L13) · H1→B1.3 · M18→B1.4 · M19→B1.5. Phase 0 = observe-first (B0.1/B0.2), the safe prefix.
- **Why two phases:** Phase 0 is hash-preserving + deployable + gives the calibration data; Phase 1 is the verdict-changing bump that needs the founder + dual-run. This is the lowest-risk path to a correct, calibrated gate.
- **Notional:** $1k universal reference validated (ADR-0028); per-tier tuning from Phase-0 data, not guessed.
