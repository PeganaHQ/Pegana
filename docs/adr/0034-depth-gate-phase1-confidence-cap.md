# ADR-0034 — Depth-gate Phase 1: confidence-cap only (ADR-0026 narrow slice)

- **Status:** Accepted (2026-07-16). Implemented on `landing/v2-port`
  (`crates/engine-rs`), **ships DISABLED, NOT yet deployed**. Founder runs the
  GO/NO-GO (§3 below) against prod before ever setting `DEPTH_GATE_FLOOR_USD`.
- **Narrows:** `docs/adr/0026-tokens-xyz-liquidity-depth-gate.md` §"Phase 1 —
  Gate". That section stays **Proposed** for its full scope (which includes
  the `force_unknown` extreme); this ADR flips **only the confidence-cap
  effect** to Accepted/shipped. ADR-0026's Phase 0 (observe — migration
  `0056_liquidity_observations.sql`, `sinks/postgres.rs`,
  `sources/tokens_xyz.rs` persistence) was already shipped and live before this
  ADR; nothing here changes it.
- **Numbering note:** ADR-0032 (Pyth confidence-gate, methodology 0.7.0) and
  ADR-0033 (verifier default-on-chain) were both already Accepted by the time
  this work started — this ADR is 0034, not 0032 as an earlier internal design
  note assumed.
- **Decision owner (deferred):** the founder's Step 1/1.5 GO/NO-GO read (§3)
  and the choice of `DEPTH_GATE_FLOOR_USD` — not part of this build.

## Context

ADR-0026 named the two-phase plan: Phase 0 observes tokens.xyz liquidity
(shipped, live since 2026-06-24); Phase 1 gates on it, but *only* after the
founder confirms the observed distribution actually justifies a floor. Phase 1
itself has two possible depths, both described in ADR-0026 but never built:

1. **Confidence-cap** — a thin, fresh, real market caps `confidence_label`
   `high → medium`. Conservative: it can only make a verdict look *less*
   certain, never *more*, and it never touches `final_state`.
2. **`force_unknown`** — the extreme: publish honest-dark UNKNOWN, same shape
   as the NAV-sanity overrides (ADR-0025/ADR-0030) and the Pyth confidence-gate
   (ADR-0032). This changes `final_state`, needs its own replay-diff, MINOR
   bump, and ADR-0028 cadence (7-day announce).

**This ADR builds only (1).** (2) stays exactly where ADR-0026 left it —
Proposed, deferred, `state_reason = "shallow_market"` (reserved in
`receipt.rs:82`) still unemitted.

## Decision

### Code (all in `crates/engine-rs`; methodology, assets.toml, the Pyth-gate,
### the verifier, and web are untouched)

**`crates/engine-rs/src/state.rs`:**
- `AssetRuntime.last_liquidity_usd_at: Option<DateTime<Utc>>` — sibling
  timestamp to `last_liquidity_usd`, the freshness guard ADR-0026 requires
  ("stale reads as absent, never gate stale-high / un-gate stale-low").
- `set_liquidity(&self, sym, v, observed_at: DateTime<Utc>)` — now takes the
  tick's own observation time (previously untimed).
- `liquidity_usd_fresh(&self, sym, within_secs: i64) -> Option<Decimal>` — a
  freshness-gated read reusing the existing, already-tested `side_is_stale`.
  Returns `None` for "never observed", "stale", and — by construction, since
  only `has_market=true` positive ticks ever reach `set_liquidity` — a
  `has_market=false` reading too. Absence is never a signal.
- `EngineState` gains `depth_gate_floor_usd: Decimal` and
  `depth_gate_freshness_secs: i64`, defaulted **inside `new()`** to
  `Decimal::ZERO` / `600` — every existing `EngineState::new(...)` call site
  (all current tests) is byte-for-byte unaffected; `new()`'s positional
  signature did not change.
- `with_depth_gate(self, floor_usd, freshness_secs) -> Self` — builder;
  `depth_gate_floor_usd()` / `depth_gate_freshness_secs()` getters. Only the
  production wiring in `main()` calls it.

**`crates/engine-rs/src/main.rs`:**
- `DEPTH_GATE_DEFAULT_FLOOR_USD: u32 = 50_000` /
  `DEPTH_GATE_DEFAULT_FRESHNESS_SECS: i64 = 600` — documented reference
  constants (the conservative value the 2026-06-24 Phase-0 early read
  suggested; see ADR-0026 §"What we validated first"). **Not** the wired
  fallback for the floor — see "Ships disabled" below.
- `depth_gate_fires(liquidity_usd_fresh: Option<Decimal>, floor: Decimal) ->
  bool` — pure, total: `None` never fires (absence is not a signal —
  ADR-0026's central rule); `floor <= 0` never fires (the kill switch);
  otherwise fires iff the reading is strictly below `floor`.
- Wired immediately after `pyth_confidence_for_asset` in the confidence
  resolution block (`main.rs`, inside `try_recompute`, right where the
  existing no-Pyth-feed cap and the NAV-sanity overrides already live): reads
  `engine.liquidity_usd_fresh(asset, engine.depth_gate_freshness_secs())`, and
  if `depth_gate_fires(...)`, folds `confidence_label = strictest(confidence_label,
  "medium")` — capping, never upgrading, via the same `strictest` helper the
  Pyth-feed cap uses. Increments `pegana_engine_depth_gate_capped_total{asset}`.
  Never calls `force_unknown`; never assigns `final_state`.
- The tokens.xyz/Jupiter liquidity envelope handler now threads the tick's own
  `ts` into `set_liquidity` (previously untimed) instead of a synthetic
  timestamp.
- `main()`'s production `EngineState` construction opts into
  `.with_depth_gate(depth_gate_floor_usd, depth_gate_freshness_secs)`, where
  both values are read from `DEPTH_GATE_FLOOR_USD` / `DEPTH_GATE_FRESHNESS_SECS`
  env vars if present.

**`crates/indexer-rs/src/sources/tokens_xyz.rs`:** one doc-comment sentence
updated — the *indexer* still does not gate anything; the *engine* now can.

### Ships disabled — floor defaults to 0, not the $50k reference value

The floor's **actual runtime default** (used when `DEPTH_GATE_FLOOR_USD` is
absent) is `Decimal::ZERO` — fully disabled, a true no-op, not the $50,000
conservative reference the constant documents. This is a deliberate,
stricter choice than ADR-0026's own §"Conservative default" text (which
proposed shipping the $50k floor *active* by default): flipping a
confidence-affecting gate on by default, rather than by the founder's
deliberate action after reading the GO/NO-GO evidence, would be a silent
production behavior change on redeploy. `DEPTH_GATE_DEFAULT_FLOOR_USD =
50_000` remains in the code (logged at boot as `recommended_floor_usd`) so the
founder has the reference number ready when they decide to enable it — but it
is never auto-applied.

Freshness (`DEPTH_GATE_DEFAULT_FRESHNESS_SECS = 600`) has no equivalent
"disabled" state to protect — with `floor = 0`, `depth_gate_fires` returns
`false` regardless of freshness — so it defaults live to 600s (matching
`SOURCE_STALENESS_SECS`), overridable independently.

**Verified disabled-by-default, empirically, not just by inspection:**
`cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --capture`
produced a diff limited to the capture tool's own `captured_at` timestamp
(and its downstream `inputs_sha256`, which hashes that timestamp) — every
per-asset field, including every `receipt_sha256` and `confidence_label`, was
byte-identical to the committed golden. (This holds doubly: the shipped
default floor is 0, **and**, independently, the 2025-10-10 fixture carries no
`liquidity_usd` at all, so `liquidity_usd_fresh` returns `None` for every
asset regardless of floor — see `crates/xtask/src/backtest/runner.rs:170`,
which hardcodes `confidence_label: "unknown"` unconditionally and never calls
into `engine-rs` at all.) The re-captured files were reverted to their
committed content — no backtest-golden changes are part of this ADR.

### `confidence_label` and the receipt hash — a note, not a break

`Computed.confidence_label` **is** serialized into the bytes
`canonical_receipt_hash` hashes (`crates/methodology/src/canonical.rs:31-51`
feeds the whole `Computed` struct into the digest). So once the founder
enables the gate and it fires on a real tick, a **newly created** receipt for
that asset will legitimately carry a different `confidence_label` — and thus
a different `expected_receipt_sha256` — than it would have without the gate.
This is not a problem: `pegana-replay verify()`'s hash check recomputes the
hash from that same receipt's own frozen `expected_computed`
(self-consistency / tamper-evidence, `pegana-replay-cli/src/main.rs`), not
against some external precomputed reference, so every receipt — gated or not
— verifies against itself either way. Separately, `confidence_label` is
**explicitly excluded** from `rederive()`'s re-derivation scope
(`crates/methodology/src/rederive.rs:18-28`): only `(discount_raw,
discount_smooth, final_state)` are independently re-derived and checked, and
none of those three are touched by this gate. Old, already-emitted receipts
are entirely unaffected either way — this only concerns receipts emitted
*after* the founder enables the gate.

## Non-goals (explicitly out of scope)

- **`force_unknown` / `state_reason = "shallow_market"`** — the extreme depth
  gate ADR-0026 also describes. Not emitted by this build. Graduating to it
  needs its own GO/NO-GO against real fire-frequency data, its own MINOR
  methodology bump, a full replay-diff / backtest re-baseline, and ADR-0028's
  7-day announce + dual-run cadence — a separate future ADR.
- **No methodology version bump.** `confidence_label` has always been
  computed entirely in `engine-rs`, outside `rederive`'s scope (see above) —
  nothing in `crates/methodology` changed. `crates/methodology/Cargo.toml`,
  `crates/pegana-replay-cli`, and the public-repo subtree mirror are all
  untouched by this ADR.
- **No migration.** `liquidity_observations` already exists from Phase 0
  (migration `0056`); this ADR adds no new table/column. No DB access was
  used or needed to build this (validated purely via unit/integration tests
  against the in-memory `EngineState` and the offline backtest harness).
- **No web/assets.toml/verifier changes.**

## 3. GO/NO-GO — founder runs this against prod

Unchanged in spirit from `docs/operations/depth-gate-phase1-decision.md`,
reproduced here so the decision inputs travel with the ADR that shipped the
code they gate.

**Step 1 — liquidity distribution over a real window:**
```sql
SELECT lo.asset,
       count(*)                                                            AS ticks,
       round(min(lo.liquidity_usd))                                        AS min_liq,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY lo.liquidity_usd)) AS median_liq,
       round(max(lo.liquidity_usd))                                        AS max_liq,
       COALESCE((a.metadata->>'monitoring_only')::boolean,false)           AS monitoring_only
FROM liquidity_observations lo JOIN assets a ON a.symbol = lo.asset
WHERE lo.has_market AND lo.ts > now() - interval '21 days'
GROUP BY lo.asset, monitoring_only
ORDER BY median_liq ASC;
```

**Step 1.5 — would a candidate floor actually change anything displayed?**
(Closes the gap the design found: a thin asset that's already capped to
`medium` by the no-Pyth-feed rule sees zero additional effect from this gate.)
```sql
-- Fill in :candidate_floor from Step 1's observed gap in the distribution.
-- CAUTION: assets.pyth_feed_id / assets.market_kind / assets.market_cfg are
-- DISPLAY METADATA synced from assets.toml, NOT read by the engine at
-- runtime — cross-check any borderline row against the LIVE assets.toml on
-- disk, don't trust this table alone if it looks stale vs. assets.toml.
SELECT a.symbol,
       a.pyth_feed_id,
       a.market_kind,
       a.market_cfg->>'numeraire_feed'                                    AS numeraire_feed,
       COALESCE((a.metadata->>'monitoring_only')::boolean,false)          AS monitoring_only,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY lo.liquidity_usd)) AS median_liq
FROM liquidity_observations lo JOIN assets a ON a.symbol = lo.asset
WHERE lo.has_market AND lo.ts > now() - interval '21 days'
GROUP BY a.symbol, a.pyth_feed_id, a.market_kind, a.market_cfg, monitoring_only
HAVING round(percentile_cont(0.50) WITHIN GROUP (ORDER BY lo.liquidity_usd)) < :candidate_floor
ORDER BY median_liq ASC;
```
**Rule:** a row where `pyth_feed_id = ''` AND `market_kind != 'jupiter_usd'`
(or `numeraire_feed` is null) is **already** capped to `medium` today via the
no-Pyth-feed branch (`main.rs`'s `pyth_confidence_for_asset`) — the depth gate
is a no-op for it. Only rows with a real Pyth cross-check (non-empty
`pyth_feed_id`, or `jupiter_usd` with a `numeraire_feed`) are where the gate
has genuine, currently-invisible bite.

**Step 2 (decision rule):**
- **GO** iff ≥1 asset's median liquidity sits persistently below a natural gap
  in the distribution AND at least one such asset would actually change per
  Step 1.5 (not already pre-capped). Set `DEPTH_GATE_FLOOR_USD` at the
  observed gap. Also check stability — does `max_liq` ever cross the
  candidate floor (flapping)? If so, widen or exclude.
- **NO-GO** iff every asset clearing Step 1.5's filter is `monitoring_only`
  (no public-facing effect yet) — log the decision, leave
  `DEPTH_GATE_FLOOR_USD` unset (0, disabled) or set it anyway at low blast
  radius (confidence-cap-only) if there's forward-looking value in enabling it
  early.

**This SQL is the founder's to run against prod — not run here** (no DB
access in this build environment; no migrations, no SQL, nothing deployed).

## Consequences

- Zero behavior change on any current deployment until `DEPTH_GATE_FLOOR_USD`
  is explicitly set (verified: no existing engine-rs test's assertions
  changed; the 2025-10-10 backtest golden is byte-identical after a fresh
  `--capture` run, save for the capture tool's own timestamp).
- Once enabled, the gate can only ever make `confidence_label` look *less*
  certain (`high → medium`) for a thin, fresh, real-market asset — it never
  changes `final_state`, never calls `force_unknown`, and never affects any
  already-emitted receipt.
- New Prometheus counter `pegana_engine_depth_gate_capped_total{asset}` —
  the observability the founder needs to see how often the gate would fire
  before/after enabling it, and per-asset once live.
- Downstream (deferred, not part of this ADR): public-repo subtree mirror
  and `pegana-replay` CLI release only matter here if/when the `force_unknown`
  extreme ships (a verdict-affecting, MINOR-bump change) — this confidence-cap
  slice needs neither.
