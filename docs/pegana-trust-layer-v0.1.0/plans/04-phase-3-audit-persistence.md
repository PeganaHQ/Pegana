> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 3 — Audit Persistence

**Spec reference**: `../04-data-model.md`, `../06-engine-changes.md § main.rs::push_alert`
**Acceptance criteria covered**: AC10-AC15, AC66 (partial)
**Dependencies**: Phase 1 (methodology) + Phase 2 (engine refactor)
**Blocks**: Phase 4 (API reads `alert_evidence`)
**Estimated duration**: 1-2 days

---

## Overview

4 new migrations (0028-0031). `alert_evidence` table with append-only triggers. `methodology_versions` lifecycle table. `alert_events` view codification. `onchain_tx_sig` column for Phase 11M.1. Engine `push_alert` extended to write the audit row.

---

## Task 3.1 — Migration 0028: `alert_evidence` table

**Files**: Create `migrations/0028_alert_evidence.sql`

- [ ] **Step 1**: Write migration

```sql
-- migrations/0028_alert_evidence.sql

CREATE TABLE alert_evidence (
    alert_id              UUID        PRIMARY KEY REFERENCES alerts(id),

    methodology_version   TEXT        NOT NULL,
    methodology_git_sha   TEXT,
    assets_toml_sha256    CHAR(64)    NOT NULL,

    inputs_frozen         JSONB       NOT NULL,
    computed              JSONB       NOT NULL,
    replay_artifact       JSONB,

    receipt_sha256        CHAR(64)    NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_evidence_no_update
    BEFORE UPDATE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

CREATE TRIGGER alert_evidence_no_delete
    BEFORE DELETE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

CREATE INDEX idx_alert_evidence_methodology ON alert_evidence (methodology_version);
CREATE INDEX idx_alert_evidence_assets_hash ON alert_evidence (assets_toml_sha256);
```

- [ ] **Step 2**: Apply migration locally

```bash
sqlx migrate run --source migrations --database-url "$DATABASE_URL"
```

Expected: `Applied 0028/migrate alert_evidence`.

- [ ] **Step 3**: Sanity check

```bash
psql "$DATABASE_URL" -c "\d alert_evidence"
psql "$DATABASE_URL" -c "\d+ alert_evidence" | grep -E "(Triggers|alert_evidence_no_)"
```

Expected: 8 columns, 2 triggers (no_update, no_delete), 3 indexes (PK + 2 named).

- [ ] **Step 4**: Commit

```bash
git add migrations/0028_alert_evidence.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 0028 — alert_evidence append-only table

Audit row per alert: frozen inputs, methodology version, computed
outputs, receipt sha256. UPDATE and DELETE blocked by PL/pgSQL triggers.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.2 — Migration 0029: codify `alert_events` view

**Files**: Create `migrations/0029_alert_events_view.sql`

- [ ] **Step 1**: Confirm production schema (per Phase 0.1)

If Phase 0.1 confirmed view exists, this migration is idempotent (no-op effect via `CREATE OR REPLACE`).

If Phase 0.1 found view missing, this migration FIXES the broken MCP state.

- [ ] **Step 2**: Write migration

```sql
-- migrations/0029_alert_events_view.sql

CREATE OR REPLACE VIEW alert_events AS
SELECT
    id,
    asset,
    from_state,
    to_state,
    discount,
    detected_at AS ts
FROM alerts;

COMMENT ON VIEW alert_events IS
    'Backward-compat view consumed by mcp-ts/src/tools/subscribe-peg-events.ts. '
    'Source: alerts table.';
```

- [ ] **Step 3**: Apply + sanity check

```bash
sqlx migrate run --source migrations --database-url "$DATABASE_URL"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM alert_events;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM alerts;"
```

Expected: both counts match.

- [ ] **Step 4**: Commit

```bash
git add migrations/0029_alert_events_view.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 0029 — codify alert_events view

The view was created out-of-band on production and referenced by
mcp-ts/src/tools/subscribe-peg-events.ts. This migration makes it
reproducible from a fresh database build.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.3 — Migration 0030: methodology_versions + Task 0031: onchain_tx_sig column

Combined here for efficiency (both touch related schema).

**Files**:
- Create: `migrations/0030_methodology_versions.sql`
- Create: `migrations/0031_alert_evidence_onchain_sig.sql`

- [ ] **Step 1**: Write methodology_versions migration

```sql
-- migrations/0030_methodology_versions.sql

CREATE TABLE methodology_versions (
    version       TEXT        PRIMARY KEY,
    git_tag       TEXT        NOT NULL,
    released_at   TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('active', 'deprecated', 'broken')),
    status_reason TEXT,
    superseded_by TEXT REFERENCES methodology_versions(version),
    notes         TEXT
);

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.1.0',
    'methodology-v0.1.0',
    NOW(),
    'active',
    'Initial release. Extracted from engine v0.1.0; no behavior change.'
);
```

- [ ] **Step 2**: Write onchain_tx_sig migration with updated trigger

```sql
-- migrations/0031_alert_evidence_onchain_sig.sql

ALTER TABLE alert_evidence ADD COLUMN onchain_tx_sig TEXT;

CREATE INDEX idx_alert_evidence_onchain_pending
    ON alert_evidence (created_at)
    WHERE onchain_tx_sig IS NULL;

COMMENT ON COLUMN alert_evidence.onchain_tx_sig IS
    'Solana transaction signature of on-chain receipt commit via SPL Memo. '
    'NULL until commit_receipt() completes async. Write-once.';

-- Update the trigger to ALLOW onchain_tx_sig updates from NULL → non-NULL only
CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.alert_id IS DISTINCT FROM OLD.alert_id
            OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
            OR NEW.methodology_git_sha IS DISTINCT FROM OLD.methodology_git_sha
            OR NEW.assets_toml_sha256 IS DISTINCT FROM OLD.assets_toml_sha256
            OR NEW.inputs_frozen IS DISTINCT FROM OLD.inputs_frozen
            OR NEW.computed IS DISTINCT FROM OLD.computed
            OR NEW.replay_artifact IS DISTINCT FROM OLD.replay_artifact
            OR NEW.receipt_sha256 IS DISTINCT FROM OLD.receipt_sha256
            OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'alert_evidence is append-only — only onchain_tx_sig may be set once';
        END IF;
        IF OLD.onchain_tx_sig IS NOT NULL THEN
            RAISE EXCEPTION 'onchain_tx_sig is write-once';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3**: Apply + sanity check

```bash
sqlx migrate run --source migrations --database-url "$DATABASE_URL"
psql "$DATABASE_URL" -c "SELECT * FROM methodology_versions;"
psql "$DATABASE_URL" -c "\d alert_evidence"
```

Expected: `methodology_versions` has row `0.1.0 active`. `alert_evidence` has 9 columns now (with `onchain_tx_sig`).

- [ ] **Step 4**: Commit both migrations together

```bash
git add migrations/0030_methodology_versions.sql migrations/0031_alert_evidence_onchain_sig.sql
git commit -m "$(cat <<'EOF'
feat(db): migrations 0030-0031 — methodology_versions + onchain_tx_sig

0030: methodology_versions lifecycle table (active/deprecated/broken)
      with seed row for 0.1.0.
0031: ALTER alert_evidence ADD onchain_tx_sig TEXT (write-once via
      updated trigger). Partial index for pending commit worker.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.4 — Append-only trigger integration test (black-box pattern)

**Files**: Create `crates/engine-rs/tests/alert_evidence_append_only.rs`

**Note**: engine-rs doesn't currently have a `tests/` directory or `sqlx::test` macro support. This task ADDS the first integration test to engine-rs, following the canonical Pegana pattern (env-var-gated black-box, per `crates/api-rs/tests/stats_endpoint.rs`).

- [ ] **Step 0**: Add reqwest + chrono to engine-rs dev-dependencies (if not already present)

In `crates/engine-rs/Cargo.toml` `[dev-dependencies]`:

```toml
[dev-dependencies]
tokio = { workspace = true }
sqlx = { workspace = true }
uuid = { workspace = true }
```

- [ ] **Step 1**: Write test

```rust
//! Confirms alert_evidence append-only enforcement against the prod-local
//! Postgres. UPDATE blocked except for onchain_tx_sig (write-once from
//! NULL → non-NULL). DELETE blocked.
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skip silently in CI.

use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL").ok().filter(|s| !s.is_empty())
}

async fn insert_baseline(pool: &PgPool, alert_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
    ).bind(alert_id).execute(pool).await?;

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   repeat('b', 64))"#,
    ).bind(alert_id).execute(pool).await?;
    Ok(())
}

#[tokio::test]
async fn update_methodology_version_is_blocked() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    let err = sqlx::query("UPDATE alert_evidence SET methodology_version = '0.2.0' WHERE alert_id = $1")
        .bind(alert_id).execute(&pool).await.expect_err("must block");
    assert!(err.to_string().contains("append-only"), "got: {err}");
}

#[tokio::test]
async fn delete_is_blocked() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    let err = sqlx::query("DELETE FROM alert_evidence WHERE alert_id = $1")
        .bind(alert_id).execute(&pool).await.expect_err("must block");
    assert!(err.to_string().contains("append-only"), "got: {err}");
}

#[tokio::test]
async fn onchain_tx_sig_can_be_set_once() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    // First set: NULL → 'abc...' — should succeed
    sqlx::query("UPDATE alert_evidence SET onchain_tx_sig = $1 WHERE alert_id = $2")
        .bind("abc123signature")
        .bind(alert_id).execute(&pool).await.expect("first set ok");

    // Second set: 'abc...' → 'def...' — should fail (write-once)
    let err = sqlx::query("UPDATE alert_evidence SET onchain_tx_sig = $1 WHERE alert_id = $2")
        .bind("def456signature")
        .bind(alert_id).execute(&pool).await.expect_err("write-once must block");
    assert!(err.to_string().contains("write-once"), "got: {err}");
}
```

- [ ] **Step 2**: Run test

```bash
# CI mode (no infra) — skips silently:
cargo test -p engine-rs --test alert_evidence_append_only

# Local mode (against prod-local stack):
PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
  cargo test -p engine-rs --test alert_evidence_append_only -- --nocapture
```

Expected: 3 passed in local mode, 3 skipped in CI mode.

- [ ] **Step 3**: Commit

```bash
git add crates/engine-rs/tests/alert_evidence_append_only.rs
git commit -m "$(cat <<'EOF'
test(engine): append-only trigger + write-once onchain_tx_sig

3 test cases (env-var-gated black-box pattern) covering:
- UPDATE of methodology_version blocked
- DELETE blocked
- onchain_tx_sig settable once (NULL → non-NULL), blocked after

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.5 — Engine writes `alert_evidence` row in push_alert + methodology version startup check

**Files**:
- Modify: `crates/common/src/lib.rs` (add `AlertEvidence` struct, `AUDIT_BASE_URL_ENV` const)
- Modify: `crates/engine-rs/src/main.rs` (startup check + push_alert)
- Modify: `crates/engine-rs/src/state.rs` (add cache inspection helpers + `assets_toml_canonical`)

- [ ] **Step 1**: Add `AlertEvidence` to common

In `crates/common/src/lib.rs`, after `AlertEvent` struct (around line 313):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertEvidence {
    pub alert_id: uuid::Uuid,
    pub methodology_version: String,
    pub methodology_git_sha: Option<String>,
    pub assets_toml_sha256: String,
    pub inputs_frozen: serde_json::Value,
    pub computed: serde_json::Value,
    pub replay_artifact: Option<serde_json::Value>,
    pub receipt_sha256: String,
    pub onchain_tx_sig: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub const AUDIT_BASE_URL_ENV: &str = "AUDIT_BASE_URL";

pub fn audit_base_url() -> String {
    std::env::var(AUDIT_BASE_URL_ENV).unwrap_or_else(|_| "https://pegana.xyz".to_string())
}
```

- [ ] **Step 2**: Verify common builds

```bash
cargo check -p pegana-common
```

Expected: clean.

- [ ] **Step 3**: Engine startup methodology check

In `crates/engine-rs/src/main.rs::main`, after Postgres + Redis init:

```rust
// ===== Methodology version validation =====
let my_version = pegana_methodology::methodology_version();
let row: Option<(String, Option<String>)> = sqlx::query_as(
    "SELECT status, status_reason FROM methodology_versions WHERE version = $1"
).bind(my_version).fetch_optional(&pg).await?;

match row {
    Some((status, reason)) if status == "broken" => {
        error!(version = my_version, ?reason, "methodology version is marked BROKEN");
        metrics::counter!("pegana_engine_methodology_broken_total").increment(1);
        anyhow::bail!(
            "methodology v{} is broken: {}. Roll forward to a fixed version.",
            my_version, reason.unwrap_or_default()
        );
    }
    Some((status, _)) => {
        info!(version = my_version, status, "methodology version validated");
    }
    None => {
        warn!(version = my_version, "methodology version not in DB — inserting as active");
        sqlx::query(
            "INSERT INTO methodology_versions (version, git_tag, released_at, status) \
             VALUES ($1, $2, NOW(), 'active')"
        )
        .bind(my_version)
        .bind(format!("methodology-v{}", my_version))
        .execute(&pg).await?;
    }
}
```

- [ ] **Step 4**: Engine startup loads assets.toml canonical form

Replace `load_assets`:

```rust
fn load_assets(path: &PathBuf) -> Result<(AssetsFile, String)> {
    let raw = std::fs::read_to_string(path).context("read assets")?;
    let mut parsed: AssetsFile = toml::from_str(&raw).context("parse assets")?;
    let before = parsed.assets.len();
    parsed.assets.retain(|a| a.active);
    let after = parsed.assets.len();
    if before != after {
        info!(deactivated = before - after, kept = after, "asset filter · skipped inactive");
    }
    let canonical = toml::to_string(&toml::from_str::<toml::Value>(&raw)?)?;
    Ok((parsed, canonical))
}
```

Update call site at line ~43:

```rust
let (assets, assets_canonical) = load_assets(&cfg.assets_file)?;
let engine = Arc::new(EngineState::new(&assets, assets_canonical, cfg.pyth_staleness_secs));
```

- [ ] **Step 5**: Extend `EngineState` with canonical TOML + inspection helpers

In `crates/engine-rs/src/state.rs`, add field to struct:

```rust
pub struct EngineState {
    // ... existing fields ...
    assets_toml_canonical: String,  // NEW
}

impl EngineState {
    pub fn new(assets: &AssetsFile, assets_toml_canonical: String, pyth_staleness_secs: i64) -> Self {
        let mut configs = HashMap::new();
        for a in &assets.assets {
            configs.insert(a.symbol.clone(), a.clone());
        }
        Self {
            runtimes: RwLock::new(HashMap::new()),
            configs,
            hyusd_cr: RwLock::new(None),
            pyth: RwLock::new(HashMap::new()),
            pyth_staleness_secs,
            staleness: assets.pyth_staleness.clone(),
            assets_toml_canonical,
        }
    }

    pub fn assets_toml_canonical(&self) -> &str {
        &self.assets_toml_canonical
    }

    // Inspection helpers for push_alert audit payload:
    pub async fn previous_ewma(&self, sym: &str) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        rt.read().await.ewma_discount
    }

    pub async fn candidate_state(&self, sym: &str) -> Option<PegState> {
        let rt = self.rt(sym).await;
        rt.read().await.candidate_state
    }

    pub async fn candidate_since(&self, sym: &str) -> Option<chrono::DateTime<chrono::Utc>> {
        let rt = self.rt(sym).await;
        rt.read().await.candidate_since
    }
}
```

- [ ] **Step 6**: Add receipt-building helpers in main.rs

Append before the `#[cfg(test)]` block at the bottom of `main.rs`:

```rust
fn resolved_thresholds_map(cfg: &AssetConfig, kind: &str) -> std::collections::HashMap<String, u32> {
    match kind {
        "cr" => cfg.thresholds.thresholds_cr.clone().unwrap_or_default(),
        _ => cfg.thresholds.thresholds_bps.clone().unwrap_or_default(),
    }
}

async fn collect_pyth_entries_for_asset(
    engine: &EngineState,
    cfg: &AssetConfig,
) -> std::collections::HashMap<String, MethPythEntry> {
    use std::collections::HashMap;
    let mut feeds: Vec<String> = Vec::new();
    match &cfg.intrinsic {
        IntrinsicStrategy::PythFxCross { feed, .. }
        | IntrinsicStrategy::PythRedemptionRate { feed } => feeds.push(feed.clone()),
        _ => {}
    }
    if let MarketStrategy::PythSpot { feed } = &cfg.market {
        feeds.push(feed.clone());
    }
    let mut map: HashMap<String, MethPythEntry> = HashMap::new();
    for feed in feeds {
        if let Some(entry) = engine.pyth_entry(&feed).await {
            map.insert(feed, MethPythEntry {
                price: entry.price,
                confidence: entry.confidence,
                publish_time: entry.publish_time,
            });
        }
    }
    map
}
```

- [ ] **Step 7**: Modify `try_recompute` to build receipt + extend `push_alert` signature

In `try_recompute`, replace the alert emission block (currently lines 454-487) with the version building receipt material. (Full code in `../06-engine-changes.md § 4. main.rs::try_recompute`.)

Then replace `push_alert` with the version that writes both `alerts` AND `alert_evidence`. (Full code in `../06-engine-changes.md § 5. main.rs::push_alert`.)

Key behavior preservation:
- Two separate sqlx queries (alerts → evidence), NOT a transaction
- Audit failure logged + counted (`pegana_audit_persist_total{outcome="failed"}`), NEVER blocks alert
- Redis XADD still happens regardless of audit outcome

- [ ] **Step 8**: Verify everything builds and existing tests pass

```bash
cargo test -p engine-rs
```

Expected: all 6 existing tests + the new append-only test (Task 3.4) pass.

- [ ] **Step 9**: Commit

```bash
git add crates/common/src/lib.rs crates/engine-rs/src/
git commit -m "$(cat <<'EOF'
feat(engine): write alert_evidence row + methodology version startup check

- common: AlertEvidence struct + audit_base_url() helper
- engine startup: refuse to run if my methodology version is marked broken;
  auto-insert if version unknown
- engine: load assets.toml canonical form once at startup; cache in EngineState
- push_alert: writes alert_evidence row (after alerts insert; separate sqlx call;
  failure logged + counted, never blocks dispatch)
- new state.rs inspection helpers (previous_ewma, candidate_state, candidate_since)
- new main.rs helpers (resolved_thresholds_map, collect_pyth_entries_for_asset)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.6 — End-to-end audit persistence test (black-box pattern)

**Files**: Create `crates/engine-rs/tests/audit_persistence.rs`

- [ ] **Step 1**: Write integration test

```rust
//! Synthetic alert insertion validates alerts + alert_evidence FK + JOIN.
//! Same env-var gating as alert_evidence_append_only.rs.

use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL").ok().filter(|s| !s.is_empty())
}

#[tokio::test]
async fn alert_and_evidence_are_both_written() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
    ).bind(alert_id).execute(&pool).await.expect("seed alerts");

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   repeat('b', 64))"#,
    ).bind(alert_id).execute(&pool).await.expect("seed evidence");

    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id WHERE a.id = $1",
    ).bind(alert_id).fetch_one(&pool).await.expect("join query");
    assert_eq!(row.0, 1);
}
```

- [ ] **Step 2**: Run

```bash
PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
  cargo test -p engine-rs --test audit_persistence -- --nocapture
```

Expected: PASS in local mode, skip in CI.

- [ ] **Step 3**: Commit

```bash
git add crates/engine-rs/tests/audit_persistence.rs
git commit -m "$(cat <<'EOF'
test(engine): alerts + alert_evidence FK consistency

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 3

- [ ] AC10 — Migration 0028 applied; UPDATE and DELETE raise `P0001` exception with `append-only` message
- [ ] AC11 — Migration 0029 applied; `\d alert_events` returns view columns; SELECT COUNT matches `alerts`
- [ ] AC12 — Migration 0030 applied; seed row `0.1.0 active` present
- [ ] AC13 — Migration 0031 applied; column nullable; partial index on `created_at WHERE onchain_tx_sig IS NULL`
- [ ] AC14 — Every alert in 24h post-deploy produces matching evidence row (target 99.9%)
- [ ] AC15 — Engine refuses to start when its version is marked `broken` (manual test on staging)

---

## Cross-references

- For data model spec, see `../04-data-model.md`.
- For engine changes spec, see `../06-engine-changes.md`.
- For Phase 4 API consuming this data, see `05-phase-4-api.md`.
- For Phase 11M.1 populating onchain_tx_sig, see `11-phase-11M-maximalist.md § Task 11M.1`.
