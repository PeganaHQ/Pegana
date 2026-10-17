# Spec 04 — Print-quality gates (depth gate + Pyth confidence-width)

**Gate A depth: indexer (Phase 0, Wave 1) → engine (Phase 1, Wave 3).
Gate B Pyth-conf: confirm + test only.** Both are conservative-only honesty guards
(ADR-0025 shape): they can only make a verdict *less* certain, never manufacture one.

## Problem / context

`discount = 1 − market/intrinsic`; Pyth supplies a confidence LABEL, not the verdict. Two
reliability gates withhold confidence (or, at the extreme, force honest-dark UNKNOWN) when
an input leg is untrustworthy.

## Gate B — Pyth confidence-width + staleness: ALREADY EXISTS (confirm, don't rebuild)

Validation finding: the gate is already implemented.
- `EngineState::pyth_confidence_label` (`state.rs:291-306`) buckets on conf-interval WIDTH: `ratio = confidence/price`; `<0.1%`→high, `<1%`→medium, else→low.
- `EngineState::pyth_entry` (`state.rs:316-333`) staleness-gates (`age_secs > limit` → `None`, bumps `pegana_engine_pyth_stale_total`); missing/zero-price/zero-conf → `None`.
- `pyth_confidence_for_asset` (`main.rs:1160-1201`) folds the STRICTEST label across all of an asset's Pyth feeds; `None`→`unknown`. ADR-0025 #2's no-Pyth→cap-MEDIUM is at `:1179-1189`. Semantics correctly documented as publisher disagreement, NOT cross-venue dislocation (`state.rs:94-97`).

**Decision: Gate B = a validation note + an explicit boundary test** (assert wide-conf
`≥1%` → `low`, stale → absent) confirming behavior. The conf-label is intentionally OUTSIDE
receipt re-derivation (`rederive.rs:14-20`, reads `Utc::now()`) → no methodology impact. The
only real Gate-B engineering left is the "Option-B" follow-up (port the label into
`methodology` taking explicit `now` so it can be frozen + verified in the receipt) — that is
a **separate, deferred PR**, orthogonal to the depth gate. Do NOT bundle.

## Gate A — depth gate (ADR-0026): observe-first, two phases

### Phase 0 — OBSERVE (Wave 1; indexer-only; no behaviour change; ship now)
tokens.xyz liquidity is live (`sources/tokens_xyz.rs`, 60s, healthy) but inert
(`set_liquidity`, `state.rs:400-404`; unit test `liquidity_is_server_only_metadata`
`:780-794` blocks it from the verdict). Validated coverage: **24/62** active mints have
`hasMarket=true`; 38 return `hasMarket=false` (37 mints added today → absence is indexing
lag, NOT a signal).

Persist EVERY tick — **including `has_market=false`** — to a new `liquidity_observations`
table (mirror the `insert_intrinsic` idempotent-upsert, `sinks/postgres.rs:8-33`):
- Add `sinks::postgres::insert_liquidity_observation(pg, asset, source, liquidity_usd: Option<Decimal>, has_market, ts)`.
- In `tokens_xyz.rs::poll_batch` **replace the two `continue`s** (`:139-141`, `:142-148`): resolve `symbol` first, then record a row for every snapshot — `has_market=false`→`(false, NULL)`; `has_market=true`+junk/NaN/≤0→`(true, NULL)`; valid→`(true, Some)`. Keep the Redis publish ONLY on the valid branch (engine `event.extra` unchanged). Persistence is best-effort (log+continue on DB error).
- No engine/methodology/receipt change.

### Phase 1 — GATE (Wave 3; engine; methodology bump; ONLY if Phase 0 data shows it fires)
A thin pool caps confidence / forces honest-dark UNKNOWN. Hard rules (each an ADR-0026/0024 lesson):
- Keys ONLY on `has_market=true` + `liquidity_usd < floor`. `has_market=false` contributes nothing.
- **Explicit freshness guard**: stale liquidity reads as *absent* (never gate stale-high, never un-gate stale-low). New `latest_liquidity_usd(pg, asset, within_secs)` over `liquidity_observations` (analogue of `latest_intrinsic_usd`, `sinks/postgres.rs:41-61`).
- **Floor calibrated from the observed Phase-0 distribution** on the full population — never a constant (the ADR-0024 mistake). Absolute vs class-relative decided from data.
- Conservative effect only: cap `high→medium` (fold into `pyth_confidence_for_asset`'s `strictest()`) first; `force_unknown` (`state.rs:537-543` + `main.rs:781-797`) only at the extreme.
- Reach ≤ the covered ~24; uncovered tail keeps `monitoring_only` containment.
- **Decision:** default effect = cap `high→medium` (NOT receipt-affecting, no replay) unless the observed severity warrants `force_unknown` (receipt-affecting → replay + version bump).

## Files to touch (exact)

**Phase 0 (indexer-only):**
- `crates/indexer-rs/src/sinks/postgres.rs` — add `insert_liquidity_observation` (mirror `:8-33`, `ON CONFLICT (asset, source, ts) DO NOTHING`).
- `crates/indexer-rs/src/sources/tokens_xyz.rs:138-167` — rewrite `poll_batch` loop per above; update module doc `:14-19`.
- **NEW** `migrations/0056_liquidity_observations.sql`.

**Phase 1 (engine; methodology bump):**
- `crates/engine-rs/src/main.rs` — extend `pyth_confidence_for_asset` (`:1160-1201`) / fold a depth check into confidence resolution at `:768`; reuse `force_unknown` (`:781-797`).
- `crates/engine-rs/src/state.rs` — liquidity-freshness read; **update/replace the `liquidity_is_server_only_metadata` test (`:780-794`)** (this is the intended signal that liquidity is now load-bearing — review so it still never leaks into the receipt *hash* unless `force_unknown` explicitly intends it).
- `crates/methodology/Cargo.toml:3` version bump + `version_matches_cargo_toml` test (`version.rs:18`); NEW `methodology_versions` migration (template `0051`).
- `docs/adr/0026-...md` — flip Proposed→Accepted.

**Gate B:** validation note + boundary test only (`state.rs` tests near `:838-865`, `:953-965`).

## Schema / migrations — `0056_liquidity_observations.sql`

Mirror `intrinsic_snapshots` (TimescaleDB hypertable; `liquidity_usd` NULLABLE to record
`has_market=false`/junk rows):
```sql
CREATE TABLE liquidity_observations (
  asset TEXT NOT NULL REFERENCES assets(symbol),
  source TEXT NOT NULL,              -- 'tokens_xyz'
  liquidity_usd NUMERIC(30,18),      -- NULL when has_market=false / junk
  has_market BOOLEAN NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (asset, source, ts)
);
SELECT create_hypertable('liquidity_observations','ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('liquidity_observations', INTERVAL '90 days');
CREATE INDEX liquidity_observations_asset_ts_idx ON liquidity_observations (asset, ts DESC);
```
The `(asset, ts DESC)` index pre-empts the Phase-1 freshness LATERAL (the slow-query class
fixed for intrinsics in migration 0052).

## Methodology / version / receipt impact

| Change | Methodology bump? | Receipt | Replay |
|---|---|---|---|
| Phase 0 | No | none | no |
| Phase 1 cap (high→medium) | additive guard, PATCH | NOT re-derived (`rederive.rs:14-20`) | confidence-only, no diff |
| Phase 1 force-UNKNOWN | additive guard, PATCH/MINOR (ADR-0009) | `final_state` IS re-derived | **replay-diff required** |
| Gate B confirm | No | none | no |
| Gate B Option-B (freeze conf) | arguably yes | adds frozen field | separate PR |

## Risks

- `has_market=false` false-positive (headline ADR-0026 risk): never let absence drive Phase 1.
- Guessed floor = the ADR-0024 mistake verbatim → floor from ≥1 week Phase-0 data; Phase 1 may resolve to "not worth building" if all 24 covered are always deep.
- Stale-liquidity flip → freshness guard mandatory.
- The `liquidity_is_server_only_metadata` test is a deliberate guardrail; changing it is the review trigger that liquidity is now load-bearing.
- Calibration contamination: Phase 1 forcing UNKNOWN is verdict-affecting → engine-only recreate, replay-diff first.

## Test plan + acceptance

- Phase 0 unit: upsert idempotency on `(asset,source,ts)`; `poll_batch` records the 3 row-shapes and publishes Redis ONLY on the valid branch. Acceptance: `liquidity_observations` accrues true+false rows; engine `event.extra.liquidity_usd` + all receipts byte-identical; `pegana-replay` zero diff; fmt/clippy/test green.
- Phase 1 unit (methodology pure fn): thin→capped/UNKNOWN; `has_market=false`→no effect; stale→absent→no effect; deep→no effect. Replace `liquidity_is_server_only_metadata` with a test asserting liquidity affects ONLY confidence/UNKNOWN and (if confidence-only) NOT the receipt hash. Acceptance: `pegana-replay` diff reviewed + ADR records any state changes.
- Gate B: confirm via existing `pyth_confidence_label_buckets_*` + `stale_pyth_reading_is_refused`; add a `≥1%`→`low` boundary assertion. Acceptance: validation note states "conf-width + staleness gate present and correct; only re-derivability (Option-B) outstanding".

## Decided open questions

- Phase 1 effect default = cap high→medium (no replay); force-UNKNOWN only at extreme — DECIDED.
- Gate B Option-B deferred to its own PR — DECIDED.
- Floor absolute vs class-relative — BLOCKED on Phase-0 data (≥1 week) — by design.
- Phase-0 observation window ≥1 week before calibrating — DECIDED.

## Grill outcomes

- *"Is the depth gate worth building if it only reaches 24/62?"* — Phase 0 (cheap, indexer-only) answers whether it fires at all before any engine risk. If the 24 are always deep, Phase 1 is honestly dropped — and we'll have logged it (no silent cap). Asymmetry: preventing ONE dust-pool false alert on a credibility product is worth the small Phase-0 cost.
- *"Gate B is already done — why spec it?"* — to record that it's done + correct (so it's not re-built) and to pin the one real remaining piece (receipt-freezing) as explicitly out of scope.
