# ADR-0035 — ORACLE_DEGRADED: an advisory "amber" oracle-trust layer (API-synth, out-of-hash)

- **Status:** Accepted (2026-07-17). Built full-stack on `landing/v2-port` (backend `7969dfd`, front `85cd6de`, review-fixes `9e5cd4a`), 1:1-reviewed + adversarially reviewed + **live-DOM validated**, **NOT deployed**. Ships with the next `api` rebuild — **no methodology bump, no CLI re-release, no migration** (see §Rollout).
- **Relationship to ADR-0032:** ADR-0032's hard Pyth confidence gate (`conf/price > 500bps → UNKNOWN`) is the **cliff**; this is the **amber layer below it**. ADR-0032 changes the verdict (in-hash, methodology 0.7.0); ADR-0035 is **advisory, out-of-hash, never a verdict/receipt input**.
- **Decision owner:** founder (the three thresholds' calibration; whether to ever promote this to a verdict input — §Open).

## Context

Oracle-trust today is a **cliff**: a Pyth-dependent asset is treated as fully trustworthy until `conf/price` crosses ADR-0032's 500bps hard gate, at which point the verdict collapses to UNKNOWN. There is **no amber** — no "the oracle leg is shaky but not gate-worthy" signal. And market↔oracle **divergence** (one source pricing a move before the other — the exact early-warning that precedes a cascade) lived only in the browser (`web/lib/asset/legs.ts` `sourcesDisagree`), never server-computed or exposed.

Pegana already persists everything needed: `oracle_snapshots.{price,confidence,publish_time}` per subscribed feed, plus `discount_snapshots.market_usd` per asset. The independent `<TICKER>/USD` oracle leg is asof-joined onto `/v1/assets/{symbol}/history` (the 3-leg feature) and, as of this ADR, onto the single-asset detail `fetch_card`.

## Decision

Add an **advisory** `oracle_degraded` annotation to the **single-asset detail** response (`/v1/assets/{symbol}` + by-mint) — **NOT the list/screener**. Pure classifier `classify_oracle_degraded()` (`crates/api-rs/src/oracle_degraded.rs`) over the independent oracle leg (asof-joined in `fetch_card` via `os.feed_id = lower(replace(a.pyth_feed_id,'0x',''))` — the 0x-normalized key the 3-leg established; a naive `= a.pyth_feed_id` is dead-on-arrival), gated identically (`market_kind IN ('jupiter_usd','dex_screener_usd') AND peg_target='USD' AND pyth_feed_id IS NOT NULL`):

```
reason (worst-first: divergent > conf_wide > stale):
  oracle_divergence        |market_usd - oracle_usd| / oracle_usd  >  ORACLE_DEGRADED_DIVERGENCE_BPS = 75
  oracle_confidence_wide   oracle_conf / oracle_usd  >=  ORACLE_DEGRADED_CONF_WARN_BPS = 100   (NO upper bound — see below)
  oracle_stale             now() - oracle.publish_time  >  ORACLE_DEGRADED_STALENESS_SECS = 90
guards: oracle_usd>0 (zeroed-print, per the JupUSD false-CRITICAL EWMA fix); skip if state_reason=="pyth_confidence_gate"
        (already UNKNOWN — amber only annotates a tick that SURVIVED the hard gate); checked arithmetic, overflow→None (never panic).
```

Emitted as `oracle_degraded: { reason, spread_bps?, conf_bps?, age_secs? }`, omitted (not null) when healthy/absent. **Conservative-only in spirit** (a heads-up, never a state change). Front: a V5 amber badge (`st-drift`) on `/asset`, on its own line below the verdict, complementing (not duplicating) the raw `PythConfidenceBadge`; distinct `oracle_crosscheck` glossary term (they scope different feeds — see below).

### The conf window has NO upper bound — because it reads a DIFFERENT feed than the hard gate (review finding, `9e5cd4a`)

The initial design used `[100, 500)` (assuming the ≥500 case was "already hard-gated"). **That was wrong.** The engine's hard gate (`pyth_confidence_gate_violated`) is fed by `pyth_feeds_for_asset` (`engine-rs/main.rs`), which for a `jupiter_usd` asset pushes **only the NUMERAIRE feed** (e.g. USDC/USD) — never `a.pyth_feed_id`. But `oracle_degraded` reads the asset's **OWN `<TICKER>/USD`** feed from `oracle_snapshots`. **Different feeds.** So a `conf_bps ≥ 500` on the asset's own independent oracle is **un-gated** — it would fall through the `[100,500)` crack (not amber, not UNKNOWN), silently dropping the feature's worst case. Fix: **no upper bound** (`bps ≥ 100`); the asset's own feed has no hard gate to double-flag against. Regression-tested (500/800/2500bps fire). **Lesson: when a new signal reuses a threshold from another gate, verify they read the SAME input — mine didn't.**

### Thresholds are conservative starting defaults (founder calibrates — §Calibration)

75bps divergence borrows `SOURCES_DISAGREE_TOLERANCE_BPS`; 100bps conf reuses the display "low" cut; 90s staleness is generous over Pyth's ~1Hz Hermes cadence. Same philosophy as ADR-0032's 500bps: a wide margin over ordinary noisy-but-healthy operation, tuned from prod data.

## Calibration (founder's call — prod DB not reachable from this worktree; #3 of the 2026-07-17 asks)

Run against prod, tune each threshold to near-zero false trips on healthy operation (ADR-0030/0032 "provably-inert" discipline). `oracle_snapshots` has both `feed` (name) and `feed_id` (0x-stripped).

**Query A — divergence distribution per eligible asset (market vs its own oracle, asof):**
```sql
WITH elig AS (
  SELECT symbol, lower(replace(pyth_feed_id,'0x','')) AS feed_id
  FROM assets
  WHERE market_kind IN ('jupiter_usd','dex_screener_usd')
    AND peg_target::text='USD' AND pyth_feed_id IS NOT NULL AND is_active),
spreads AS (
  SELECT e.symbol, abs(ds.market_usd - o.price)/NULLIF(o.price,0)*10000 AS spread_bps
  FROM discount_snapshots ds
  JOIN elig e ON e.symbol = ds.asset
  JOIN LATERAL (SELECT price FROM oracle_snapshots os
                WHERE os.feed_id = e.feed_id AND os.publish_time <= ds.ts
                ORDER BY os.publish_time DESC LIMIT 1) o ON true
  WHERE ds.ts > now() - interval '90 days' AND ds.market_usd IS NOT NULL AND o.price > 0)
SELECT symbol, count(*) n,
  percentile_cont(0.50)  WITHIN GROUP (ORDER BY spread_bps) p50,
  percentile_cont(0.95)  WITHIN GROUP (ORDER BY spread_bps) p95,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY spread_bps) p999,
  max(spread_bps) max_bps,
  count(*) FILTER (WHERE spread_bps > 75) trips_at_75bps
FROM spreads GROUP BY symbol ORDER BY max_bps DESC;
```

**Query B — confidence distribution on each asset's OWN `<TICKER>/USD` feed (NOT the numeraire — the whole point):**
```sql
SELECT os.feed, count(*) n,
  percentile_cont(0.50)  WITHIN GROUP (ORDER BY (os.confidence/NULLIF(os.price,0))*10000) p50,
  percentile_cont(0.95)  WITHIN GROUP (ORDER BY (os.confidence/NULLIF(os.price,0))*10000) p95,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY (os.confidence/NULLIF(os.price,0))*10000) p999,
  max((os.confidence/NULLIF(os.price,0))*10000) max_bps,
  count(*) FILTER (WHERE (os.confidence/NULLIF(os.price,0))*10000 >= 100) trips_at_100bps
FROM oracle_snapshots os
JOIN assets a ON os.feed_id = lower(replace(a.pyth_feed_id,'0x',''))
  AND a.market_kind IN ('jupiter_usd','dex_screener_usd') AND a.peg_target::text='USD'
WHERE os.publish_time > now() - interval '90 days' AND os.price>0 AND os.confidence IS NOT NULL
GROUP BY os.feed ORDER BY max_bps DESC;
```

**Query C — oracle staleness (publish-gap) distribution per eligible feed:**
```sql
WITH gaps AS (
  SELECT os.feed,
    extract(epoch FROM (os.publish_time -
      lag(os.publish_time) OVER (PARTITION BY os.feed ORDER BY os.publish_time))) AS gap_s
  FROM oracle_snapshots os
  JOIN assets a ON os.feed_id = lower(replace(a.pyth_feed_id,'0x',''))
    AND a.market_kind IN ('jupiter_usd','dex_screener_usd') AND a.peg_target::text='USD'
  WHERE os.publish_time > now() - interval '30 days')
SELECT feed, count(*) n,
  percentile_cont(0.95)  WITHIN GROUP (ORDER BY gap_s) p95_gap_s,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY gap_s) p999_gap_s,
  max(gap_s) max_gap_s, count(*) FILTER (WHERE gap_s > 90) trips_at_90s
FROM gaps WHERE gap_s IS NOT NULL GROUP BY feed ORDER BY max_gap_s DESC;
```

**Read the results like ADR-0032:** if `trips_at_*` is non-trivial on a *healthy* feed/asset, raise the threshold above that feed's `p999`. Since this layer is out-of-hash and advisory, a slightly-too-loose default only over/under-shows an amber badge — it never moves a verdict — so calibration is lower-stakes than ADR-0032's, but the same "inert on healthy operation" goal applies to avoid alert-fatigue on the badge.

### Calibration results — RUN against prod 2026-07-17 (14d/7d windows, `statement_timeout`)

⚠️ Only **3 oracle feeds are subscribed in prod today** — `JUPUSD/USD`, `USDC/USD`, `USDT/USD` (2.5M rows/30d each). PYUSD/USDe/USDS light up only after the `[pyth_feeds]` backfill deploys with V2. So the live calibration covers **JupUSD, USDC, USDT**; re-run post-deploy for the added feeds.

| Signal (default) | Result | Verdict |
|---|---|---|
| **Divergence 75bps** (Query A) | USDC/USDT: 0 trips (max 0.61bps — market≈oracle to sub-bps). JupUSD: p50=1.0, p95=2.9, **p999=37.9, max=92.1bps, 3 trips/14d (0.017%)** — genuine outliers. | ✅ **keep 75** — inert for hard pegs; fires only on real JupUSD market↔oracle gaps. |
| **Conf 100bps** (Query B) | Conf/price p999 = 10.8 (USDC) / 12.3 (USDT) / 29.5 (JupUSD); **max = 89.9 (JupUSD), 0 trips at 100bps.** | ✅ **keep 100** — sits just above the worst healthy read; fires only on genuine widening. |
| **Staleness 90s** (Query C) | Publish ~1/s; p999 gap = 2s; **max gap = 45s, 0 trips at 90s.** | ✅ **keep 90** — 2× margin over the worst gap. |

**Conclusion: the three shipped defaults are correctly calibrated** — conservative-inert on healthy operation, the amber badge fires only on real events (0 trips except JupUSD divergence's 3 genuine tail outliers). No change needed. Re-run all three queries after the PYUSD/USDe/USDS `[pyth_feeds]` backfill deploys, since those feeds aren't yet in `oracle_snapshots`.

## Validation

- **10 unit tests** (`oracle_degraded.rs`): healthy→None; each reason fires above/at threshold, not below; the `conf_at_or_above_500_still_fires_amber` regression guard (the review finding); `oracle_usd<=0`→None; `pyth_confidence_gate` skip; overflow→None no-panic; worst-first picks divergence; the nesting/omit-when-none wiring test.
- **81 api-rs tests** green + clippy clean. **Backtest golden byte-exact** by construction — api-rs only, zero methodology/engine/receipt/migration touch.
- **Live-DOM (Playwright fetch-inject on the deployed preview):** badge renders "Oracle diverges · 142bps", color `rgb(226,166,81)` = the amber `st-drift` token (not the depeg rose), reconciled with the still-present conf badge, no h-scroll.
- Front: tsc + 6 badge + 5 glossary tests.

## Rollout (advisory / out-of-hash → trivial vs ADR-0032)

- **No methodology bump, no CLI re-release, no migration, no engine recreate.** Ships with the next `api` rebuild (`deploy.sh --services 'api indexer'` — the api half). The oracle asof-join reuses the existing `oracle_snapshots(feed_id, publish_time DESC)` index (mig 0067) — no new DDL.
- Front ships on the V2 merge (Vercel) with the rest of `landing/v2-port`.
- Rollback: additive field + a front badge — revert the commits; nothing stateful.

## Open decisions (founder)

1. **Calibrate 75 / 100 / 90** from Queries A/B/C — tighten/widen per the data (low-stakes; advisory).
2. **Ever promote to a verdict input?** The research's options C (force UNKNOWN on divergence during an alerting tick) and D (divergence as a new DRIFT-like early-warning) would make this **in-hash** → methodology bump + ADR + byte-exact backtest re-baseline, like ADR-0032. Recommend keeping it **advisory** for launch; revisit D behind a disabled-by-default flag (depth-gate pattern) only with calibration evidence.
3. **Unify with the Legs-chart `sources disagree`** (a client-side 3-way red/green signal) into one server-computed divergence source + color language — a noted follow-up, not a launch blocker (the main contradiction is impossible: the Legs signal takes the widest pairwise gap ⊇ market↔oracle).

## Cross-refs

- `crates/api-rs/src/oracle_degraded.rs` (`classify_oracle_degraded`, the three consts), `routes/assets.rs` (`fetch_card` asof-join + `AssetCard.oracle_degraded`), `web/components/atoms/oracle-degraded-badge.tsx`, `web/lib/glossary.ts` (`oracle_crosscheck`).
- ADR-0032 (hard conf gate — the cliff this sits below; calibration-query precedent) · ADR-0034 (depth-gate — disabled-default pattern for #2) · `project_oracle_degraded_2026_07_17.md` (memory, the numeraire-feed lesson) · `docs/design-research/2026-07-17-sub-b-risk-signals-DESIGN.md` §1.
