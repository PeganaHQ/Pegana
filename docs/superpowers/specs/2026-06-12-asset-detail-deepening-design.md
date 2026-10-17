# Asset-detail deepening — design (brainstorm + grill outcome)

> 2026-06-12. NOT yet implemented (documented per "anotar tudo"). Produced by a
> research + adversarial-challenge workflow (`asset-detail-brainstorm-grill`)
> then a `/grill-me` pass that resolved every claim against the actual code.
> Stability lock 2026-06-11 → 06-25: **frontend + additive READ API only.**

## TL;DR

Of the 5 roadmap candidates, **3 are already shipped**, **1 is displaced** by a
sharper already-built primitive, leaving **2 features worth building** + one
grill-discovered trust-safety refinement.

## What's ALREADY shipped (verified in code — do NOT rebuild)

| Candidate | Status | Evidence |
|---|---|---|
| **C1 state-transition markers** | ✅ done | `asset-chart.tsx:410-419` `transitionMarkers()` + lightweight-charts `createSeriesMarkers` (arrows by `to_state`, clamped to window, capped at 24) |
| **C4 URL-encoded tab/range/mode** | ✅ done | `app/(app)/asset/[symbol]/page.tsx:121-133` `updatePermalink` + `parseTab/parseBucket/parseMode`; localStorage persist |
| **C5 backing decomposition (LST)** | ✅ done | `nav-backing.tsx:25-67` (`sol_per_lst × pyth(SOL/USD) = intrinsic_usd`); hero ref-strip `asset-hero-v2.tsx:207/214` |

Chart lib = **lightweight-charts 5.2.0** (TradingView LWC), wrapped by `useTvChart`.

## KEEP — 2 features

### Feature 1 — BandGauge in the asset-detail rail *(trivial)*
The `BandGauge` (`components/atoms/band-gauge.tsx`) is an **already-built, tested**
per-asset risk primitive: fill = `|spread|` as a fraction of THIS asset's own
depeg line (`−40bps` = 80% for USDC but ~14% for INF), state-colored,
direction-aware aria-label, null-guarded, reduced-motion-safe. It renders on the
screener table, mobile row, and preview pane — but is **absent from the deepest
page (asset-detail)**. The rail today shows only a raw `formatGap(bps)` number.

- **Scope:** render `<BandGauge bps thresholds state />` in `asset-rail.tsx` under
  the existing Live-state block (props already in scope: `thresholds` L112, `bps`
  L69, `state` L70) + a "Proximity to depeg" caption. Rail only (not the hero,
  which already prints the raw gap). +1 vitest (rail-placement, mirrors the
  asset-table test).
- **Why it beats C2 (shaded regions):** same proximity question, but BandGauge is
  already-built, **asymmetric/per-asset-correct**, and carries no
  "symmetric-band-lie" trap (the chart plots SIGNED discount; the premium side is
  benign). C2 would need new lightweight-charts region rendering for strictly less
  insight → **C2 is CUT.**

### Feature 2 — market-vs-intrinsic "Legs" chart mode *(medium)*
The only genuinely-new analytical view. Plots the two **raw price legs** so a user
can tell **"market leg crashed" vs "NAV re-rated"** — the core depeg-oracle
question the single zeroed spread line structurally cannot answer. Directly ties
to the **sHYUSD "PEGGED on −25% EWMA"** failure class (seeing the legs exposes the
mispricing).

- **Pure additive READ (verified, not engine work):** `intrinsic_usd` +
  `market_usd` already persist `NOT NULL` on `discount_snapshots`
  (`migrations/0001_initial.sql:96-97`). The history endpoint
  (`api-rs/.../assets.rs` raw-bucket SELECT) just doesn't select them. Add the 2
  columns to the raw-bucket SELECT + 2 optional fields to `HistoryPoint` (Rust +
  TS), **mirroring the existing `discount_raw` optional pattern**
  (`skip_serializing_if=none`). The 1m continuous-aggregate (`discount_1m`) has no
  legs → `None` (same as `discount_raw`). No migration, no engine change.
- **🔴 Grill refinement (trust-safety) — restrict "Legs" to USD-peg assets
  (stables), NOT LSTs.** `discount_snapshots` stores only USD legs. For an LST,
  `intrinsic_usd` and `market_usd` BOTH carry the `pyth(SOL/USD)` tick, so the two
  legs **swing with SOL price** while the real peg (computed in SOL space, which
  cancels the multiplier) is fine — plotting USD dual-legs for an LST is
  **misleading**. The honest SOL-denominated legs aren't stored = engine-locked.
  So gate the "Legs" mode on `class !== 'lst'`. This **keeps the motivating case**
  (sHYUSD is `stable_yield` = USD-peg; legs ~$1, the −25% gap shows clearly).
- **Scope:** new `legs` value in the existing `?mode=` union (reuses C4's URL state
  for free); attach 2 `LineSeries` on a **separate ~$1 USD price scale** (not the
  bps scale), reusing the `rawSeriesRef` plumbing; 2-item legend; suppress
  threshold price-lines + bps formatting in legs mode; crosshair tooltip shows both
  legs **+ the implied gap in bps** (the actual signal); pin `bucket=raw` (legs
  only exist there); guard empty series. +vitest (transform + gap math) +
  Playwright (2 series on the USD scale).

## CUT (with reasons)

| Candidate | Reason |
|---|---|
| C1 markers | already shipped |
| C4 URL-state | already shipped |
| C5 backing | LST slice shipped; a stables-reserve panel needs **engine-written attestation data** absent from the response = lock-frozen; fabricating it from existing fields would be the pbUSDC/sHYUSD credibility-kill |
| C2 shaded regions | displaced by BandGauge (same question, already-built, asymmetric-correct, no symmetric-band trap) |

## Optional polish (NOT "deepening")

**Marker dedup** — existing markers spam on flappy assets (hyUSD 52 flips/2d
pre-fix). Collapse runs of same-destination transitions + de-emphasize
PEGGED-recovery arrows. Small. Include only if desired; it's polish on a shipped
feature, not new capability.

## Implementation order (when unlocked)

1. BandGauge in rail (TDD) → commit → vitest/typecheck/lint
2. Legs API additive read (TDD, `cargo test`) → commit → validate
3. Legs chart mode, gated to USD-peg (TDD) → commit → validate
4. `/review-and-iterate` + `/review` → iterate
5. e2e live (browser vs prod) → deploy `web` (Vercel) + `api` (`deploy.sh --services 'api'`, engine/indexer/dispatcher untouched)
