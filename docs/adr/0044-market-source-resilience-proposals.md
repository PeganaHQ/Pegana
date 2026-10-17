# ADR-0044 — Market-source resilience: dynamic source demotion and dust-trade sanitation

- **Status:** **Proposed** (2026-08-10). NOT implemented. Requires an explicit decision because
  both changes alter the peg verdict and therefore receipt contents.
- **Scope:** the market leg of the discount pipeline only. Neither proposal touches intrinsic
  strategies, thresholds, hysteresis, or the receipt format itself.
- **Origin:** patterns read from `solana-foundation/tokens` (MIT), open-sourced 2026-08-09.

## Context

The tokens.xyz open-sourcing let us read a mature multi-source market pipeline end to end. Two of
its designs address failure modes Pegana currently has no defence against. Both were deliberately
left unimplemented in the 2026-08-10 enrichment work, because everything else shipped that day was
inert context metadata (`liquidity_usd`, `volume_24h_usd`, `holder_count`) that provably cannot
reach a receipt. These two would change published verdicts, which is a decision for the operator,
not for an implementation pass.

## Proposal A — dynamic per-source demotion instead of a static per-asset source

### The problem

`assets.toml` binds each asset to exactly one market strategy: `jupiter_usd` (60 assets),
`pyth_spot` (10), `dex_screener_usd` (2). The binding is **static**. If Jupiter degrades for one
asset, that asset has no fallback: it goes stale, `state` degrades to UNKNOWN via
`stale_source`, and the peg signal is dark until a human edits the TOML and redeploys.

### What tokens.xyz does

`apps/cloudrun-assets/src/handlers/marketSourceSelection.ts` ranks candidate sources **per field
family, per tick**, with two distinct staleness mechanisms:

- `FRESHNESS_DEMOTION_MS = 15min` — a candidate trailing the freshest by more than 15 minutes is
  pushed to the BACK of the preference order, not dropped. It only demotes when a fresher
  candidate exists, and never empties the candidate list.
- `MAX_CLICKHOUSE_AS_OF_AGE_MS = 10min` — a separate gate on `asOf` vs `lastFetchedAt`. A row can
  be freshly *fetched* while *summarising* stale data; checking the fetch timestamp alone never
  catches this. Pegana has the identical exposure in `sanctum.rs` (batch reads) and
  `lst_directory_audit.rs`.

### Why this is not a free win

Pegana is a **reproducibility** product. A receipt records which inputs produced a verdict. Making
source selection dynamic means the source becomes a per-tick decision that must itself be recorded
and replayed byte-exactly by `pegana-replay-cli`. Concretely this requires:

1. The selected source and the full candidate set (with their timestamps) entering the canonical
   input hash, so `rederive.rs` can reproduce the same choice offline.
2. A methodology version bump, because identical raw inputs can now yield a different verdict than
   the previous version would have produced.
3. Backtesting against `docs/backtests/` fixtures to confirm no historical verdict silently flips.

Without (1) the change would break the core promise. This is the reason it is a proposal.

### Recommendation

Worth doing, but as its own versioned methodology change with a backtest, not folded into an
enrichment pass. Sequence: record candidate metadata in the receipt first (inert, no verdict
change), observe for a few weeks, then switch selection on in a second step.

## Proposal B — dust-trade sanitation on aggregated market prices

### The problem

Pegana's `dexscreener.rs` selects a top-liquidity pair, and `jupiter.rs` takes a route quote. Both
can be poisoned by a single unrepresentative trade in a thin pool. This is not hypothetical: the
JupUSD incident (`out_amount = 0`) poisoned the EWMA and produced a false CRITICAL. That was fixed
with an `is_zero` skip, which handles exactly one shape of the bug and nothing else.

### What tokens.xyz does

`apps/api/src/lib/ohlcv-sanitize.ts` defends the general case, with a real documented example: a
dust trade produced `high = 1,296,359` on a candle whose true close was ~75. Their approach:

- `WICK_TOLERANCE = 1.5` against a **median of four local references** (own open, own close,
  previous close, next close). A median, not a mean, so one bad reference cannot skew the check.
- An untrusted extreme is **snapped to the candle body**, NOT clamped to the tolerance edge —
  clamping to the edge draws a fake plateau of identical wicks across consecutive poisoned candles.
- Open/close are deliberately left untouched, since rewriting them would alter the series every
  consumer already trusts.

`primary-variant-ranking.ts` adds a second, orthogonal defence worth noting: a **median-absolute-
deviation z-score** (`0.6745·|x − median| / MAD > 2.5`, min sample 3) over `log1p`-transformed
volume, and if the filter would remove every candidate it is discarded rather than failing closed.

### Why this is not a free win

Same reason as A, more sharply: this directly rewrites the market price that feeds
`compute_discount`. It is a methodology change by definition. It also needs a decision on the
honest failure mode — when the sanitiser rejects a reading, does the tick become UNKNOWN (ADR-0019,
"missing data is not confirming data") or fall back to the last good market? Those produce
materially different alerting behaviour under stress, which is precisely when it matters.

### Recommendation

Higher value than A, because it defends against a false-positive alert class that has already
fired once in production. Implement in `crates/methodology` (pure, replayable) with a version bump
and a backtest against the USDe-depeg fixture to prove no historical verdict changes.

## Decision

**Deferred.** Both are recorded here so the analysis is not lost. Neither should be implemented as
part of a routine change: each needs a methodology version bump, receipt-input changes, and a
backtest run before it can ship.

## What WAS implemented on 2026-08-10 instead

Everything that could not affect a verdict, as inert context (migration 0075):

- `sources/tokens_xyz_risk.rs` — holder count, 24h volume, market cap, liquidity for 62 of 69
  active assets, Postgres-only, never published to Redis.
- `market_score.rs` — a presentation-layer market-DEPTH score, explicitly not a peg score.
- `xtask hygiene` — a build-failing guard asserting `engine-rs` and `methodology` never so much as
  name these fields, so the boundary is enforced structurally rather than by convention.
