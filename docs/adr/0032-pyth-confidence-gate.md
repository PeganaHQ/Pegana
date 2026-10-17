# ADR-0032 — Pyth confidence-gate: verdict-affecting override on wide confidence intervals (methodology 0.7.0)

- **Status:** Accepted (2026-07-16). Implemented on `landing/v2-port`, **validated (backtest replay-diff
  clean), NOT yet deployed** — the engine deploy is gated on the `pegana-replay` CLI re-release (see
  §Rollout), same F-13b sequencing as ADR-0030.
- **Mirrors:** ADR-0025 (0.4.0 premium-sanity) / ADR-0030 (0.5.0 discount-sanity) — same shape (a third,
  independent override forcing honest-dark UNKNOWN), but gates on oracle **confidence**, not discount
  **magnitude**. Builds on the display-only confidence label ADR-0025 §2 introduced
  (`pyth_confidence_for_asset` / `EngineState::pyth_confidence_label`), which this ADR explicitly
  promotes from cosmetic to verdict-affecting.
- **Decision owner:** founder (the 0.7.0 flip, the `PYTH_CONFIDENCE_GATE_BPS` calibration, and the CLI
  re-release).

## Context

Every Pyth price update ships with a **confidence interval** (`conf`) — Pyth's own 1-sigma uncertainty
band around the published price, inverse-confidence-weighted into its EMA aggregate (tighter reads count
more). Pegana has captured this since day one: `oracle_snapshots.confidence` is persisted by the indexer
(`crates/indexer-rs/src/sources/pyth.rs`) into the hypertable defined in `migrations/0001_initial.sql`,
and every receipt already freezes the exact Pyth entries an asset depended on
(`InputsFrozen.pyth_entries: HashMap<String, PythEntry>`, `crates/methodology/src/receipt.rs`).

Today that confidence data is used for exactly one thing: `EngineState::pyth_confidence_label`
(`crates/engine-rs/src/state.rs:374-401`) buckets `confidence/price` into `high < 10bps`,
`medium < 100bps`, else `low` (`None` → `"unknown"` on missing/stale/zero). This label is **display-only**
— both the docstring at `state.rs:220` and the `rederive.rs` module docs say so explicitly. A Pyth feed can
report a wildly wide confidence interval (the oracle itself signaling low trust in its own read) and the
**verdict** (PEGGED/DRIFT/DEPEG/CRITICAL/BLACK_SWAN) is computed exactly as if the price were as trustworthy
as any tight, healthy read. The gap: nothing in the classification pipeline actually *listens* to what Pyth
is telling us about its own uncertainty.

This is the same category of gap ADR-0025/ADR-0030 closed for discount **magnitude** (a premium/discount
too large to be a real market move implies a broken anchor) — except here the untrustworthy signal is
**oracle-native**, not derived: Pyth is directly saying "don't trust this price as much right now."

## Decision

Add a third, independent verdict override, same shape as `premium_sanity_violated`/
`discount_sanity_violated`:

```
PYTH_CONFIDENCE_GATE_BPS = 500  // 5%
pyth_confidence_gate_violated(entries: &HashMap<String, PythEntry>) -> bool =
    entries.values().any(|e| {
        if e.price.is_zero() { return false }  // no computable ratio, not evidence of anything
        let ratio = (e.confidence / e.price).abs();
        ratio.checked_mul(10_000).is_none_or(|bps| bps > PYTH_CONFIDENCE_GATE_BPS)
        // checked_mul overflow → treated as violated (untrusted-magnitude reasoning, same as
        // premium_sanity_violated's 0.6.1 fix: an implausibly large ratio is itself proof the
        // reading cannot be trusted).
    })
```

Unlike `is_direction_sensitive`-gated premium/discount sanity, this check is **class-agnostic** — a wide
confidence interval taints trust in the reading regardless of whether the asset is an LST, a yield-stable,
a leveraged synth, or a hard-peg fiat stable. It judges **both** legs a Pyth-dependent asset can have
(intrinsic AND market, since both multiply into `discount_raw`) — any one wide-uncertainty leg taints the
whole verdict (`.any()` semantics).

**Scope discipline (same as its siblings):** the function judges only entries **actually present** in the
frozen map. An asset with no Pyth dependency (empty map — most of the discount-side of the universe today)
or a feed whose live reading did not survive upstream staleness/missing-feed gating is left alone — that is
a presence/absence question already owned by `pyth_confidence_label` and the intrinsic/market staleness
gates (hardening H1/H9/H12: missing data is not confirming data, but punishing absence is not this
function's job either — it only judges reads it actually has).

When it fires, the engine forces **UNKNOWN** with `state_reason = "pyth_confidence_gate"` (honest-dark),
same publish shape as its siblings (`force_unknown`, `confidence_label = "unknown"`, a `warn!` log line, a
`metrics::counter!`). **Conservative-only**: this can only push a verdict *toward* UNKNOWN, never away from
it — it never fabricates a healthier state and never overrides the two existing NAV-sanity guards' own
`state_reason` attribution (checked *after* premium/discount sanity in the `if`/`else if` chain — a
diagnostic-labeling choice only; `final_state` is UNKNOWN either way when more than one condition trips).

### `PYTH_CONFIDENCE_GATE_BPS = 500` is a conservative starting default, not a Pyth-mandated number

Pyth's own best-practices documentation (`docs.pyth.network/price-feeds/core/best-practices`, confirmed via
context7) explicitly frames confidence-interval usage as **application-dependent** — an upper/lower-bound
risk parameter for the consuming application (e.g. loan/collateral sizing), not a single universal ratio
Pyth prescribes. 500 bps (5%) is chosen by the same "wide margin over legitimate operation" philosophy as
`NAV_PREMIUM_SANITY_BPS = 1000` (>6× margin over the widest observed legitimate premium) and
`NAV_DISCOUNT_SANITY_BPS = 3000` (2× the widest legitimate critical band): **5× the existing "low" display
bucket's own 100bps cut point**, so ordinary noisy-but-healthy feed operation should never trip it.

### Calibration (founder's call — prod DB not reachable from this worktree)

**Query A — distribution per feed (pick/confirm the bound):**
```sql
SELECT
  feed,
  count(*) AS n,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (confidence / NULLIF(price,0)) * 10000) AS p50_bps,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (confidence / NULLIF(price,0)) * 10000) AS p95_bps,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY (confidence / NULLIF(price,0)) * 10000) AS p999_bps,
  max((confidence / NULLIF(price,0)) * 10000) AS max_bps
FROM oracle_snapshots
WHERE publish_time > now() - interval '90 days'
  AND price <> 0
  AND confidence IS NOT NULL
GROUP BY feed
ORDER BY max_bps DESC;
```

**Query B — GO/NO-GO inertness check at the shipped default (mirrors ADR-0030's "provably inert on the live
universe" proof):**
```sql
SELECT
  feed,
  count(*) FILTER (WHERE (confidence / NULLIF(price,0)) * 10000 > 500) AS trips_at_500bps,
  count(*) AS n,
  round(100.0 * count(*) FILTER (WHERE (confidence / NULLIF(price,0)) * 10000 > 500) / count(*), 4) AS pct
FROM oracle_snapshots
WHERE publish_time > now() - interval '90 days'
  AND price <> 0
  AND confidence IS NOT NULL
GROUP BY feed
ORDER BY trips_at_500bps DESC;
```

**Founder runs these against prod** before/soon after deploy. Cross-reference any non-zero `feed` in Query B
against `assets.toml`'s `[pyth_feeds]` + each asset's `intrinsic`/`market` declaration to know which asset(s)
it would have touched, and whether those trips landed during a documented incident (e.g. the 2026-06-24 JLP
`JLP/USD.RR` garbage print, ADR-0030) versus healthy operation. If `trips_at_500bps` is non-trivial on a
healthy feed, tighten the query to find a `bps` value above `p999_bps` for every feed and use that as the
shipped constant instead of the hardcoded 500. **The founder may tighten or widen `PYTH_CONFIDENCE_GATE_BPS`
from this data** — the 500 shipped here is a starting point, not a final calibration.

## Validation

- **New unit tests** (`crates/methodology/src/thresholds.rs`): empty map → false; tight confidence (5bps) →
  false; wide confidence (600bps) → true; exact-boundary (500bps, strict `>`) → false; zero price → false
  (no panic); `checked_mul` overflow → true; multi-feed `.any()` (one tight + one wide) → true.
- **New rederive tests** (`crates/methodology/src/rederive.rs`): override-to-Unknown on a wide-confidence
  entry despite an otherwise-healthy discount; tight-confidence entry does NOT force Unknown (proves the
  gate doesn't leak into unrelated ticks); **empty `pyth_entries` map classifies exactly as before the gate
  existed** — this is the test that pins the backtest's zero-diff guarantee.
- **Backtest replay-diff (2025-10-10-usde-depeg), the critical proof:** `cargo run -p xtask -- backtest
  --case 2025-10-10-usde-depeg --capture` then `git diff docs/backtests/2025-10-10-usde-depeg/methodology-output.json`
  — diff limited to `methodology_version` (0.6.1 → 0.7.0) and the resulting `expected_receipt_sha256`
  values. **Zero `final_state`/`state` changes**, because the xtask runner's `pyth_entries` stays
  `HashMap::new()` by construction (`crates/xtask/src/backtest/runner.rs`) — this fixture never captured
  Pyth data, so the gate is a structural no-op on it. (Pre-existing, orthogonal note: the runner also never
  calls `discount_sanity_violated`, a latent gap from the 0.5.0 rollout — not fixed here, flagged for a
  follow-up ticket.)
- Full `pegana-methodology`/`engine-rs`/`xtask` test suites green, `cargo fmt --check` +
  `cargo clippy -p pegana-methodology -p engine-rs --all-targets -- -D warnings` clean.

## Rollout (verdict-affecting → 0.7.0, CLI-first per F-13b / ADR-0030 precedent)

1. Merge → deploy the engine (rebuild; embeds methodology 0.7.0). New receipts record 0.7.0.
2. **Re-release `pegana-replay`** with its `pegana-methodology` dependency pin bumped to embed 0.7.0, so
   0.7.0 receipts stay publicly re-derivable — the currently-published CLI (embedding 0.6.1) would reject a
   0.7.0 receipt with `exit(3) VERSION_MISMATCH` (ADR-0028's exact-match check). **CLI-first, then engine**
   — same ordering ADR-0030 established, to avoid a re-derivability gap. This crates.io publish is
   **founder-gated + irreversible**; timing relative to the engine rebuild is the founder's call at actual
   deploy time (out of scope for this branch-local build).
3. Per ADR-0009's table, a brand-new function that CAN flip `final_state` for some input is a MINOR bump
   regardless of current-universe inertness (ADR-0025 and ADR-0030 were both classified MINOR despite being
   provably inert at ship time) — `0.6.1 → 0.7.0`. A MINOR bump nominally requires a 7-day announce + 7-day
   passive dual-run (ADR-0009 cadence); given the guard is expected to be inert-by-default like its two
   predecessors, the founder may choose to compress/bundle the announce with a future bump — must be an
   explicit recorded decision, not assumed.

## Open decisions (founder call)

1. `PYTH_CONFIDENCE_GATE_BPS = 500` is a starting default — run Query B against prod and confirm near-zero
   trips before/soon after merge; tighten/widen as the data warrants.
2. ADR-0009 cadence override (compress/bundle the announce) — explicit decision required, not assumed.
3. CLI-first-then-engine sequencing timing is the founder's call at actual deploy time.
4. The third `else if` branch is checked after (not before) premium/discount sanity — a defensible default,
   purely a `state_reason` attribution choice with zero effect on `final_state`.

## Cross-refs

- `crates/methodology/src/thresholds.rs` (`pyth_confidence_gate_violated`, `PYTH_CONFIDENCE_GATE_BPS`),
  `lib.rs` (`STATE_REASON_PYTH_CONFIDENCE_GATE`), `crates/methodology/src/rederive.rs`,
  `crates/engine-rs/src/main.rs` (live hook + `pyth_feeds_for_asset` DRY extraction),
  `crates/xtask/src/backtest/runner.rs` (mirrored, structural no-op).
- `crates/methodology/CHANGELOG.md` § 0.7.0; `migrations/0066_methodology_v0_7_0.sql`; ADR-0025 (premium
  side); ADR-0030 (discount side, direct precedent for calibration + rollout shape); ADR-0028
  (exact-match version check); ADR-0009 (bump cadence).
