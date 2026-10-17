# Persistence surfacing (Spec 03b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Spec-03 `sustained` / time-below-peg signal VISIBLE to consumers: the engine writes `current_state_duration_secs` + `sustained` into `discount_snapshots.extra` on EVERY tick (not just on alerts), and `/v1/assets` exposes them on `AssetCard`. Then the web screener / feed can show "sUSD — in DRIFT for 3 months" at rest, which is the demand wedge.

**Architecture:** Reuse the Spec-03 `EngineState::band_duration` already in scope in `try_recompute`. Move its computation up so it is available to `persist_discount` (the every-tick snapshot writer) and pass the values in; `persist_discount` folds them into its `extra` JSONB. The API adds two optional `AssetCard` fields read from `d.extra` in the existing assets SQL. No migration (JSONB), no methodology/receipt impact.

**Tech Stack:** Rust (engine-rs + api-rs), sqlx/Postgres, serde. Builds on Spec 03 (`band_since`/`band_duration`). Spec: `docs/superpowers/specs/2026-06-24-03-persistence-time-below-peg-signal.md` (§Surfaces).

**Branch:** continue on `feat/persistence-time-below-peg` (03b ships with 03 as one persistence feature).

**Scope guard:** engine `persist_discount` extra + `/v1/assets` field ONLY. No migration. No methodology/receipt change. The web badge + bot string that RENDER this field are a separate follow-up (03c). Do NOT touch `crates/methodology`.

---

### Task 1: engine writes duration + sustained to `discount_snapshots.extra` every tick

**Files:** Modify `crates/engine-rs/src/main.rs`

- [ ] **Step 1: Compute `band_duration` before `persist_discount`** — `try_recompute` currently computes it at ~line 969 (for the alert event, which only fires on transition). Move that computation to just BEFORE the `persist_discount(` call (~line 800, after the NAV-sanity `force_unknown` block at 782 so `band_since`/`last_state` are final).

Add immediately before `let ts = now;` (~line 800):
```rust
    // Spec 03b: compute once here so BOTH the every-tick snapshot (persist_discount)
    // and the on-transition alert event carry the same band-duration/sustained.
    // Placed after transition()/force_unknown() so band_since/last_state are final.
    let (band_dur_secs, sustained) = engine.band_duration(asset, now).await;
```
Then DELETE the now-duplicate Spec-03 computation at ~line 969 (the line `let (band_dur_secs, sustained) = engine.band_duration(asset, now).await;` and its 2-line comment) — the `AlertEvent` `extra` at 993-994 keeps using `band_dur_secs` / `sustained`, now from the moved-up binding.

- [ ] **Step 2: Pass them into `persist_discount`** — the call site (~line 801-811) currently ends with `…, threshold_kind, confidence)`. Add the two args after `confidence`:
```rust
        threshold_kind,
        confidence,
        band_dur_secs,
        sustained,
    )
    .await?;
```

- [ ] **Step 3: Add the params + fold into the `extra` JSONB** — `persist_discount` (`main.rs:1227-1262`):

Add to the signature (after `confidence: &str,`):
```rust
    band_dur_secs: Option<i64>,
    sustained: bool,
```
Replace the `extra` bind (`main.rs:1257`):
```rust
    .bind(serde_json::json!({ "threshold_kind": threshold_kind }))
```
with:
```rust
    .bind(serde_json::json!({
        "threshold_kind": threshold_kind,
        "current_state_duration_secs": band_dur_secs,
        "sustained": sustained,
    }))
```

- [ ] **Step 4: Verify the engine compiles + tests pass**

Run: `cargo fmt -p engine-rs && cargo clippy -p engine-rs --all-targets -- -D warnings && cargo test -p engine-rs`
Expected: clean + all green (Spec-03 tests still pass; `band_dur_secs`/`sustained` now flow to both the snapshot and the alert).

- [ ] **Step 5: Commit**

```bash
git add crates/engine-rs/src/main.rs
git commit -m "feat(engine): write current_state_duration_secs + sustained to discount_snapshots.extra (every tick)"
```

---

### Task 2: expose the fields on `/v1/assets`

**Files:** Modify `crates/api-rs/src/routes/assets.rs`

- [ ] **Step 1: Write the failing test** (add to the `assets.rs` `#[cfg(test)]` module — mirror the existing `new_fields_omitted_when_none` test)

```rust
    #[test]
    fn persistence_fields_omitted_when_none_present_when_set() {
        // None → omitted (not null).
        let mut c = sample_card_minimal(); // existing test helper that builds a card with Nones
        c.current_state_duration_secs = None;
        c.sustained = None;
        let v = serde_json::to_value(&c).unwrap();
        assert!(v.get("current_state_duration_secs").is_none());
        assert!(v.get("sustained").is_none());
        // Some → present.
        c.current_state_duration_secs = Some(7_776_000); // ~90 days
        c.sustained = Some(true);
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["current_state_duration_secs"], 7_776_000);
        assert_eq!(v["sustained"], true);
    }
```
> If `assets.rs` has no `sample_card_minimal()` helper, build an `AssetCard` literal inline with every field set to its empty/None value (mirror the struct in `assets.rs:43-149`).

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p api-rs --bin api-rs routes::assets::tests::persistence_fields_omitted_when_none_present_when_set`
Expected: FAIL to COMPILE — `no field current_state_duration_secs on type AssetCard`.

- [ ] **Step 3: Add the fields + wire the SQL** — `crates/api-rs/src/routes/assets.rs`:

Add to `AssetCard` (after `jitter_bps_24h`, ~line 148):
```rust
    /// Seconds the asset has resided in its CURRENT committed FSM band (engine
    /// `band_since`). Omitted until the engine has stamped it. Read with `state`;
    /// `sustained` is the thresholded view (Spec 03).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_state_duration_secs: Option<i64>,
    /// True when the asset has held a committed ALERTING band (DRIFT+) long enough
    /// to be a sustained episode (a slow mechanism depeg, not a blip). A
    /// PEGGED/UNKNOWN asset is never `sustained`. Omitted until computed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sustained: Option<bool>,
```

In `ASSETS_LIST_SQL` (the outer SELECT, after the `s.jitter_bps_24h` line ~291) add:
```sql
            (d.extra->>'current_state_duration_secs')::bigint AS current_state_duration_secs,
            (d.extra->>'sustained')::boolean AS sustained,
```

In `row_to_card` (after `jitter_bps_24h`, ~line 267) add:
```rust
        current_state_duration_secs: r.try_get("current_state_duration_secs").ok(),
        sustained: r.try_get("sustained").ok(),
```

In `fetch_card`'s SQL (`assets.rs:457+`, the by-symbol/by-mint detail query) add the SAME two `d.extra->>…` columns to its outer SELECT, and add the SAME two fields to the `AssetCard` it builds from its row — mirror exactly what `ASSETS_LIST_SQL` + `row_to_card` do above.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p api-rs --bin api-rs routes::assets::tests::persistence_fields_omitted_when_none_present_when_set`
Expected: PASS.

- [ ] **Step 5: Verify the crate (OpenAPI schema picks up the 2 new AssetCard fields; no new route → no count bump)**

Run: `cargo fmt -p api-rs && cargo clippy -p api-rs --all-targets -- -D warnings && cargo test -p api-rs`
Expected: clean + all green (incl. the OpenAPI guard — count stays 37, only the `AssetCard` schema grew).

- [ ] **Step 6: Commit**

```bash
git add crates/api-rs/src/routes/assets.rs
git commit -m "feat(api): expose current_state_duration_secs + sustained on /v1/assets"
```

---

## Final verification (before a PR)

- [ ] `cargo fmt --check` (engine-rs + api-rs)
- [ ] `cargo clippy -p engine-rs -p api-rs --all-targets -- -D warnings`
- [ ] `cargo test -p engine-rs -p api-rs`
- [ ] `cargo test -p pegana-methodology` green + `git --no-pager diff main -- crates/methodology` EMPTY (no receipt impact)
- [ ] `git --no-pager diff --stat` (vs the Spec-03 commit) shows ONLY `crates/engine-rs/src/main.rs` + `crates/api-rs/src/routes/assets.rs`
- [ ] No migration added (`git status` shows no new `migrations/` file for 03b)

> **Cannot be verified headlessly (deploy-time):** the field actually populating for a long-running episode. Post-deploy (engine + api recreate, same release as Spec 03): `curl api.pegana.xyz/v1/assets | jq '.[] | select(.symbol=="sUSD") | {state, current_state_duration_secs, sustained}'` — sUSD (the thin/public DRIFT candidate) should show a growing duration and, after the 6h DRIFT threshold, `sustained:true`.

## Self-Review (against the spec)

- Engine writes duration/sustained every tick (not just alerts) → Task 1 (moved `band_duration` before `persist_discount`). ✓
- `/v1/assets` exposes both, omitted-when-None → Task 2 + test. ✓
- Reuses Spec-03 `band_duration` (single source of the sustained rule — no logic duplication) → Task 1. ✓
- No migration, no methodology/receipt impact → final verification (methodology diff empty). ✓
- **No placeholders:** code complete; `fetch_card` mirror + the test helper point at existing in-file patterns. **Type consistency:** `current_state_duration_secs: Option<i64>`, `sustained: Option<bool>` (API) vs the engine's `(Option<i64>, bool)` — the API's `sustained` is `Option` because old snapshots lack the key (graceful null).
- **Out of scope (→ 03c):** the web "time in state" badge that renders the field; the bot alert string ("in DRIFT for N").
