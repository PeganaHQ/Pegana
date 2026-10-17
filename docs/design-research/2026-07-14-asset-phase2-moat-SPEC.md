# `/asset` Phase 2 — the moat extension (grill + research → recommendation)

> 2026-07-14. Author: Opus (conta 2). Follows Phase 1 (verdict-first re-imagination, shipped
> + approved by Rafael). Rafael asked to run /grill-me + /grill-with-docs + /product-review and
> "analise COMPLETAMENTE, busque, use context7" → decide Phase 2. This is the recommendation
> he approved ("Vamos fazer isso").
>
> Inputs: grill-with-docs (domain/engine), a read-only backend feasibility map (agent audit),
> competitive/demand web research, and context7 (lightweight-charts v5 API).

## The finding that reframed everything

Phase 2 was framed as "backend differentiators." The backend map + a chart read prove that
framing WRONG on both ends:

- **The moat features are ALREADY-SERVED data → frontend, not backend.** `discount_snapshots`
  (365-day retention) holds `intrinsic_usd`/`market_usd`/`discount`/`state`, served by
  `GET /v1/assets/{symbol}/history?bucket=raw|1m&from&to`. And the asset-chart ALREADY plots
  spread-over-time (baseline/line modes) and intrinsic-vs-market-over-time (**"legs" mode**,
  `asset-chart.tsx:673-680`, USD-peg assets only).
- **The expensive features are the WRONG competitive bets.** Chaos Labs (well-funded incumbent)
  already ships engine-computed real-time risk (5×/s) + Proof-of-Reserves at institutional
  scale (frxUSD/Agora/Solv). Pegana can't out-infra them there — and an engine safety-score
  drags in the full methodology-governance machinery (semver bump + ADR + public docs +
  pegana-replay mirror; the calibration ADR cluster 0009/0021/0023/0025/0028/0030).

**Pegana's genuine edge — literally the documented limitation of PoR** (BitGo/coinlaw): *"proof
of reserves confirms assets existed at a point in time, but does NOT prove peg behavior over
time."* Pegana's moat = the tamper-evident record of what the peg ACTUALLY DID over time
(time-below-peg, recovery, the episode arc). That's a frontend surfacing of data we already
compute + store.

## Recommendation (approved)

There is no "backend Phase 2" worth building now. Rename it **Phase 1.5** — a FE extension of
the receipts/replay moat.

- ✅ **Feature A — Episode price-path** (all assets, FE-only, zero calibration risk): in
  `ComparableEvents`, fetch `/history?from&to` per past episode → render the ACTUAL discount arc
  (existing `Sparkline` atom + `cleanSeries`/`isPlausibleDiscount` gates). The tamper-evident
  record of a past depeg's shape — exactly what Chaos/PoR can't show. **Building now.**
- ⚖️ **Feature B — NAV/backing-over-time** (refined after investigation): the GENERAL case
  (spread-over-time, intrinsic-vs-market-over-time) **already exists** as chart modes. The only
  genuinely-new, differentiated piece is the **LST backing-ratio (`sol_per_lst`) over time** in
  `NavBacking` — proof-of-reserves *over time*, which needs a small backend addition (serve the
  `sol_per_lst` series, today buried in `intrinsic_snapshots.meta` JSONB) and is **LST-only**.
  DECISION PENDING RAFAEL: build the small backend add (Sonnet+Opus), or hold it as
  demand-gated and treat the existing legs/NAV chart as sufficient.
- ❌ **Cut / hold indefinitely:** engine safety-score (Chaos-contested + calibration/governance
  risk; if kept advisory it's barely different from today's client heuristic) · reserve-
  attestation panel (table-stakes served by Chaos/Deloitte/KPMG; zero ingestion infra, bespoke
  per issuer).

## Why (three pillars converge)

1. **Strategy ("demand is the gap"):** Feature A isn't the infra-founder trap — it surfaces
   data we already compute + store, in days, extending the visible moat. The expensive backend
   (the actual trap) is skipped. This RESPECTS the standing verdict.
2. **Competition:** Chaos owns engine-risk + PoR. Pegana's edge is peg-behavior-over-time
   receipts — Feature A is that edge made visible.
3. **Feasibility (backend map):** the moat features are already-served data (FE); the wrong-bet
   features are expensive + calibration-risky. Strategy and feasibility point the same way.

## Feature A spec (building)
- Files: `components/organisms/comparable-events.tsx` + 2 new props from `page.tsx`
  (`symbol`, `klass`). Each episode → an `<EpisodeCard>` (per-component `useHistory` call =
  Rules-of-Hooks-safe) fetching `{bucket:"1m", from: episode start, to: start+recoveryMin (or
  now if ongoing)}` → `<Sparkline>` of the discount arc (bps, `cleanSeries`/`isPlausibleDiscount`
  first; `thresholdBps` = `thresholdsFor(symbol,klass).depeg_bps`; stroke by worst-state color).
- Honest degradation: <2 points (outside 365d retention / fetch error) → no arc, keep the stats
  card exactly as today. Never fabricate a curve.
- Crown jewels: never recompute discount (server-computed `HistoryPoint.discount`); sanity-gate
  the series. Loop: Sonnet impl → Opus adversarial review → tsc+vitest → commit → push.

## Chosen tech (context7-validated)
- Episode arc: the in-repo `Sparkline` atom (no new dep).
- Any NAV chart (Feature B, if built): lightweight-charts v5 (already in repo) — `chart.addSeries
  (LineSeries, {...})` for the ratio series, `series.createPriceLine({price, lineStyle, title})`
  for the reference, overlay via `priceScaleId: ''` — confirmed current API.

## Sources
Backend feasibility map (agent audit of `crates/*`, `migrations/*`, `crates/api-rs/src/routes/
*`). Competitive/demand: Chaos Labs oracles + PoR integrations; BitGo & coinlaw on PoR's
point-in-time limitation. context7: `/tradingview/lightweight-charts` v5.
