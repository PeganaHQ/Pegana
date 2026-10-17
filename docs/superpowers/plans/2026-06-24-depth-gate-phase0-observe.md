# Depth gate — Phase 0 "Observe" Implementation Plan (Spec 04, Phase 0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist every tokens.xyz liquidity tick — INCLUDING `has_market=false` / junk rows (as NULL) — into a new `liquidity_observations` hypertable, so the depth-gate floor (Spec 04 Phase 1) can be calibrated against the real observed distribution instead of a guess. Indexer-only. No behaviour change. No engine, no methodology, no receipt impact.

**Architecture:** The indexer's `tokens_xyz` source already polls liquidity every 60s and publishes valid ticks to Redis. We add a Postgres sink (`insert_liquidity_observation`, mirroring `insert_intrinsic`) and rewrite the `poll_batch` loop to record an observation for EVERY tracked mint while keeping the Redis publish EXACTLY as before (so engine `event.extra` is byte-identical). A pure helper `valid_liquidity` makes the keep/drop logic unit-testable without HTTP or a DB.

**Tech Stack:** Rust, sqlx/Postgres (TimescaleDB), rust_decimal, chrono. Spec: `docs/superpowers/specs/2026-06-24-04-print-quality-gates.md` (§Gate A Phase 0). Allocation: migration **0056** (per `…00-overview-and-sequencing.md`; latest is `0055_perena_usd_star.sql`).

**Branch:** create `feat/depth-gate-observe` off the current branch's base (`main`) before Task 1.

**Scope guard:** Phase 0 ONLY. Do NOT implement the Phase-1 gate (no engine change, no confidence cap, no UNKNOWN forcing, no floor). Do NOT modify `crates/engine-rs`, `crates/methodology`, or the `liquidity_is_server_only_metadata` engine test.

---

## File Structure

- **Create** `migrations/0056_liquidity_observations.sql` — the new hypertable.
- **Modify** `crates/indexer-rs/src/sinks/postgres.rs` — add `insert_liquidity_observation`.
- **Modify** `crates/indexer-rs/src/sources/tokens_xyz.rs` — add the pure `valid_liquidity` helper + its unit tests; rewrite the `poll_batch` per-snapshot loop to persist every observation; update the module doc.

---

### Task 1: migration `0056_liquidity_observations.sql`

**Files:**
- Create: `migrations/0056_liquidity_observations.sql`

- [ ] **Step 1: Write the migration** (mirrors `intrinsic_snapshots`, `0001_initial.sql:52-62`; `liquidity_usd` is NULLABLE to record `has_market=false` / junk rows)

```sql
-- Phase 0 "observe" for the tokens.xyz depth gate (Spec 04). Append-only
-- record of every liquidity tick — INCLUDING has_market=false / junk ticks
-- (stored as NULL) — so the Phase-1 floor is calibrated from the observed
-- distribution, not guessed. Indexer-only; not read by the engine.
CREATE TABLE liquidity_observations (
    asset         TEXT           NOT NULL REFERENCES assets(symbol),
    source        TEXT           NOT NULL,            -- 'tokens_xyz'
    liquidity_usd NUMERIC(30,18),                     -- NULL when has_market=false / junk tick
    has_market    BOOLEAN        NOT NULL,
    ts            TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (asset, source, ts)
);
SELECT create_hypertable('liquidity_observations', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('liquidity_observations', INTERVAL '90 days');
-- Pre-empts the Phase-1 freshness LATERAL (the slow-query class fixed for
-- intrinsics in migration 0052).
CREATE INDEX liquidity_observations_asset_ts_idx ON liquidity_observations (asset, ts DESC);
```

- [ ] **Step 2: Sanity-check SQL parses** (no DB needed for syntax; if a local TimescaleDB is reachable on the prod-local stack you MAY apply it, otherwise skip — it applies at deploy)

Run: `grep -c "create_hypertable" migrations/0056_liquidity_observations.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add migrations/0056_liquidity_observations.sql
git commit -m "feat(db): migration 0056 — liquidity_observations hypertable (depth-gate observe)"
```

---

### Task 2: `insert_liquidity_observation` sink + `valid_liquidity` helper

**Files:**
- Modify: `crates/indexer-rs/src/sinks/postgres.rs`
- Modify: `crates/indexer-rs/src/sources/tokens_xyz.rs` (the pure helper + its tests live next to the loop that uses them)

- [ ] **Step 1: Write the failing test** (add a `#[cfg(test)] mod tests` at the bottom of `tokens_xyz.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn valid_liquidity_keeps_only_real_positive_markets() {
        // has_market=false → always None, even if a number leaks through.
        assert_eq!(valid_liquidity(false, Some(123.0)), None);
        assert_eq!(valid_liquidity(false, None), None);
        // has_market=true but junk → None.
        assert_eq!(valid_liquidity(true, None), None);
        assert_eq!(valid_liquidity(true, Some(0.0)), None);
        assert_eq!(valid_liquidity(true, Some(-5.0)), None);
        assert_eq!(valid_liquidity(true, Some(f64::NAN)), None);
        assert_eq!(valid_liquidity(true, Some(f64::INFINITY)), None);
        // has_market=true + real positive → Some, as a Decimal.
        assert_eq!(
            valid_liquidity(true, Some(51000.0)),
            Some(Decimal::from_str("51000").unwrap())
        );
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p indexer-rs sources::tokens_xyz::tests::valid_liquidity_keeps_only_real_positive_markets`
Expected: FAIL to COMPILE — `cannot find function valid_liquidity`.

- [ ] **Step 3a: Add the sink** — append to `crates/indexer-rs/src/sinks/postgres.rs` (mirrors `insert_intrinsic`, `:8-33`)

```rust
/// Append a liquidity observation. `liquidity_usd` is `None` for a
/// `has_market=false` mint or a junk tick — Phase 0 records those too so the
/// depth-gate floor (Spec 04 Phase 1) is calibrated from the real distribution.
/// Idempotent on `(asset, source, ts)`.
pub async fn insert_liquidity_observation(
    pg: &PgPool,
    asset: &str,
    source: &str,
    liquidity_usd: Option<Decimal>,
    has_market: bool,
    ts: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO liquidity_observations (asset, source, liquidity_usd, has_market, ts)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (asset, source, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(source)
    .bind(liquidity_usd)
    .bind(has_market)
    .bind(ts)
    .execute(pg)
    .await?;
    Ok(())
}
```

- [ ] **Step 3b: Add the pure helper** — add near the top of `tokens_xyz.rs` (after the `const`s, before `run`). Also add the imports `use rust_decimal::Decimal;` and `use rust_decimal::prelude::FromPrimitive;` to the file's `use` block.

```rust
/// Keep a liquidity reading ONLY for a market that exists with a real,
/// positive, finite value; otherwise `None` (has_market=false OR junk tick).
/// Pure + total so the keep/drop rule is unit-tested without HTTP or a DB.
fn valid_liquidity(has_market: bool, raw: Option<f64>) -> Option<Decimal> {
    if !has_market {
        return None;
    }
    raw.filter(|l| l.is_finite() && *l > 0.0)
        .and_then(Decimal::from_f64)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p indexer-rs sources::tokens_xyz::tests::valid_liquidity_keeps_only_real_positive_markets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/indexer-rs/src/sinks/postgres.rs crates/indexer-rs/src/sources/tokens_xyz.rs
git commit -m "feat(indexer): liquidity_observations sink + pure valid_liquidity helper"
```

---

### Task 3: persist every observation in `poll_batch`

**Files:**
- Modify: `crates/indexer-rs/src/sources/tokens_xyz.rs` (the `poll_batch` per-snapshot loop + module doc)

- [ ] **Step 1: Replace the per-snapshot loop**

Find the existing loop in `poll_batch` (it currently `continue`s past `!has_market`, junk, and unknown mints, then publishes valid ticks to Redis):

```rust
        for snap in snapshots {
            if !snap.has_market {
                continue;
            }
            let Some(liq) = snap.token.and_then(|t| t.liquidity) else {
                continue;
            };
            // Guard against junk ticks (NaN / inf / non-positive).
            if !liq.is_finite() || liq <= 0.0 {
                continue;
            }
            let Some(&symbol) = by_mint.get(snap.address.as_str()) else {
                continue;
            };

            let payload = serde_json::json!({
                "asset": symbol,
                "liquidity_usd": liq,
                "source": "tokens_xyz",
                "ts": now,
            });
            sinks::redis_pub::publish(
                state.redis.clone(),
                pegana_common::channels::SRC_JUPITER,
                &payload,
            )
            .await
            .context("publish tokens.xyz liquidity")?;
            published += 1;
        }
```

Replace it with (resolve symbol FIRST so every tracked mint is recorded; persist ALL; publish UNCHANGED for valid ticks only):

```rust
        for snap in snapshots {
            // Resolve the symbol first — Phase 0 records an observation for EVERY
            // tracked mint (incl. has_market=false), so symbol resolution precedes
            // the market check. Skip only mints we don't track.
            let Some(&symbol) = by_mint.get(snap.address.as_str()) else {
                continue;
            };
            let raw = snap.token.and_then(|t| t.liquidity);
            let liquidity_usd = valid_liquidity(snap.has_market, raw);

            // OBSERVE: persist every observation, including has_market=false /
            // junk rows (NULL liquidity). Best-effort — a DB error logs and the
            // poll continues; it must never stall the source.
            if let Err(e) = sinks::postgres::insert_liquidity_observation(
                &state.pg,
                symbol,
                "tokens_xyz",
                liquidity_usd,
                snap.has_market,
                now,
            )
            .await
            {
                warn!(error = %e, asset = symbol, "tokens.xyz liquidity observation persist failed");
            }

            // Publish to the engine ONLY for a real positive-liquidity market.
            // Keep the payload byte-identical to before: a JSON number from the
            // original f64, NOT the Decimal (engine event.extra must not change).
            if liquidity_usd.is_some() {
                if let Some(liq) = raw.filter(|l| l.is_finite() && *l > 0.0) {
                    let payload = serde_json::json!({
                        "asset": symbol,
                        "liquidity_usd": liq,
                        "source": "tokens_xyz",
                        "ts": now,
                    });
                    sinks::redis_pub::publish(
                        state.redis.clone(),
                        pegana_common::channels::SRC_JUPITER,
                        &payload,
                    )
                    .await
                    .context("publish tokens.xyz liquidity")?;
                    published += 1;
                }
            }
        }
```

> NOTE: the indexer `AppState` exposes `state.pg` (a `PgPool`) — confirmed in `crates/indexer-rs/src/state.rs`. The publish keeps the original `raw` f64 so the Redis payload (and therefore the engine's `event.extra.liquidity_usd`) is byte-identical to today.

- [ ] **Step 2: Update the module doc** — `tokens_xyz.rs:14-19` currently says the source "intentionally does not gate anything". Append one sentence so it reflects the new persistence:

```rust
//! As of Spec 04 Phase 0 the source ALSO persists every observation (incl.
//! has_market=false / junk rows, stored as NULL) to `liquidity_observations`
//! for depth-gate calibration. This is OBSERVE-ONLY: it still does not gate or
//! alter the verdict; the engine envelope is unchanged.
```

- [ ] **Step 3: Verify the crate**

Run: `cargo fmt -p indexer-rs && cargo clippy -p indexer-rs --all-targets -- -D warnings && cargo test -p indexer-rs`
Expected: fmt clean, clippy clean, all tests PASS (incl. `valid_liquidity_keeps_only_real_positive_markets`).

- [ ] **Step 4: Commit**

```bash
git add crates/indexer-rs/src/sources/tokens_xyz.rs
git commit -m "feat(indexer): tokens.xyz persists every liquidity observation (depth-gate observe)"
```

---

## Final verification (before a PR)

- [ ] `cargo fmt --all --check`
- [ ] `cargo clippy -p indexer-rs --all-targets -- -D warnings`
- [ ] `cargo test -p indexer-rs`
- [ ] `git --no-pager diff --stat` shows ONLY: `migrations/0056_liquidity_observations.sql`, `crates/indexer-rs/src/sinks/postgres.rs`, `crates/indexer-rs/src/sources/tokens_xyz.rs`
- [ ] NO change under `crates/engine-rs/` or `crates/methodology/`
- [ ] The engine `liquidity_is_server_only_metadata` test is UNTOUCHED (Phase 1 work, not now)

> **Cannot be verified headlessly (deploy-time):** the migration applying to the live TimescaleDB and rows actually accruing (both `has_market=true` and `false`). After deploy, confirm with: `SELECT has_market, count(*) FROM liquidity_observations WHERE ts > now() - interval '5 min' GROUP BY 1;` — expect both true and false rows across the ~62 active mints. Deploy is **indexer-only recreate** (engine untouched).

---

## Self-Review (against the spec)

- Persist every tick incl. `has_market=false` as NULL → Task 3 (resolve symbol first; `valid_liquidity` returns None for false/junk; sink stores NULL). ✓
- Redis publish byte-identical (engine `event.extra` unchanged) → Task 3 publishes the original `raw` f64 only for valid ticks. ✓
- New `liquidity_observations` hypertable, `liquidity_usd` NULLABLE, PK `(asset,source,ts)`, retention, `(asset, ts DESC)` index → Task 1. ✓
- Indexer-only; no engine/methodology/receipt change → scope guard + final verification. ✓
- Idempotent upsert mirroring `insert_intrinsic` → Task 2. ✓
- **No placeholders:** every code step is complete. **Type consistency:** `valid_liquidity(bool, Option<f64>) -> Option<Decimal>`, `insert_liquidity_observation(&PgPool, &str, &str, Option<Decimal>, bool, DateTime<Utc>)` — consistent across tasks.
- **Out of scope (correctly deferred to Phase 1):** the floor, confidence cap / UNKNOWN forcing, the `latest_liquidity_usd` freshness read, updating the engine metadata-only test.
