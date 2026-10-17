# Depth gate — Phase 1 GO/NO-GO decision checkpoint

> Phase 0 (observe) shipped + LIVE 2026-06-24 (migration 0056, indexer persists
> `liquidity_observations`). This doc makes the Phase-1 decision **mechanical** so it is
> driven by the observed distribution, never a guessed floor (the ADR-0024 lesson).
> Spec: `docs/superpowers/specs/2026-06-24-04-print-quality-gates.md`. Plan (Phase 0):
> `docs/superpowers/plans/2026-06-24-depth-gate-phase0-observe.md`.

## Decision date

**Earliest 2026-07-01** (≥1 week of observation). Do NOT decide before then — 15 ticks
cannot separate a persistently-thin pool from a transient low tick (ADR-0024:
a guessed threshold false-positived healthy public JupSOL within minutes).

## Early read (2026-06-24, ~14 min / 15 ticks — INDICATIVE ONLY, NOT a decision)

Coverage: 24 covered (has_market=true) / 39 not (has_market=false) = the 24/62 split.
Covered-liquidity distribution: min **$2,125** · p10 $503k · median $12.7M · p90 $577M · max $706M.

8 thinnest covered assets:

| asset | avg liq | monitoring_only |
|---|---|---|
| **USD\*** | $2,125 | true (beta, contained) |
| **sUSD** | **$9,160** | **FALSE — PUBLIC / calibrated** |
| AUSD | $503k | true |
| JupSOL | $2.4M | false |
| EURC | $2.6M | true |
| USDY | $2.9M | false |
| bpSOL | $3.4M | true |
| USDu | $3.4M | true |

**Why this leans GO:** there is a clean ~50× gap between the thin cluster (USD\* $2k,
sUSD $9k) and the next tier (AUSD $503k+). Critically **sUSD is a PUBLIC, calibrated
asset trading on a ~$9k pool** — the exact dust-pool false-alert risk the gate exists to
kill (a $9k-pool price is not trustworthy as the market leg). So it is NOT true that "all
24 covered assets are always deep" — at least one public asset is persistently thin.

## The mechanical decision (run on/after 2026-07-01)

### Step 1 — read the full-window per-asset distribution

```sql
-- Run on prod: ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres \
--   sh -c "psql -U \$POSTGRES_USER \$POSTGRES_DB -P pager=off -c \"...\"" </dev/null'
SELECT lo.asset,
       count(*)                                                            AS ticks,
       round(min(lo.liquidity_usd))                                        AS min_liq,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY lo.liquidity_usd)) AS median_liq,
       round(max(lo.liquidity_usd))                                        AS max_liq,
       COALESCE((a.metadata->>'monitoring_only')::boolean,false)           AS monitoring_only
FROM liquidity_observations lo JOIN assets a ON a.symbol = lo.asset
WHERE lo.has_market AND lo.ts > now() - interval '7 days'
GROUP BY lo.asset, monitoring_only
ORDER BY median_liq ASC;
```

### Step 2 — apply the rule (no guessed floor)

- **GO (build Phase 1)** iff: ≥1 asset has its **median** liquidity persistently below a
  natural gap in the distribution AND at least one such asset is **public**
  (`monitoring_only=false`). Set the **floor at the observed gap** (e.g. if the
  distribution stays bimodal — a thin cluster ≪ a deep cluster — put the floor in the
  empty band between them; from the early read that band is ~$50k–$300k, but CONFIRM it
  from the 7-day data, do not hardcode).
  - Also check **stability**: for each thin asset, does `max_liq` ever cross the candidate
    floor? If a thin asset routinely spikes above the floor, the gate would flap — widen
    the hysteresis or exclude it.
- **NO-GO / drop Phase 1** iff: every thin asset is already `monitoring_only` (containment
  already handles them) AND no public asset is persistently below the gap. Then the gate
  adds little; **log the decision** (no silent drop) and revisit only if a public asset
  later goes thin.

### Step 3 — if GO, build per the spec

Phase 1 design is fixed in `…-04-print-quality-gates.md`:
- Effect: cap confidence `high→medium` (NOT receipt-affecting → no replay) as default;
  `force_unknown` only at the extreme. Decide per observed severity.
- Keys ONLY on `has_market=true` + `liquidity < floor`. **`has_market=false` NEVER gates**
  (indexing lag). Explicit **freshness guard** (stale liquidity reads as absent).
- Methodology bump per ADR-0009 (additive honesty guard, ADR-0025 precedent) + replay-diff
  if `force_unknown` is used. Engine-only recreate.

## Current lean (to be confirmed 07-01)

**Likely GO**, scoped to capping confidence on the thin public asset(s) (sUSD foremost).
Floor ≈ the $50k–$300k gap — but the exact value comes from the 7-day distribution, and the
final call is mechanical via Steps 1–2. If, by 07-01, sUSD's market has deepened or it is
moved to `monitoring_only`, re-evaluate (the gate may then be NO-GO).
