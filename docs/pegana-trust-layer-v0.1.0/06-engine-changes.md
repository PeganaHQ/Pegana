> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 06 — Engine Changes

> Refactor of `crates/engine-rs` for Trust Layer v0.1.0. Threshold logic moves to `methodology` crate. `transition()` takes explicit `now`. `push_alert` writes `alert_evidence` row + fires async SAS on-chain commit. Startup checks methodology version is not broken.

---

## 1. Summary of changes

| File | Change | Why |
|---|---|---|
| `crates/engine-rs/Cargo.toml` | Add `pegana-methodology = { path = "../methodology" }` dep; add `spl-memo = "4"`, `bs58 = "0.5"` for SAS fallback | Methodology delegation + on-chain commit |
| `crates/engine-rs/src/thresholds.rs` | **Deleted** | Moved to `methodology` crate (see `05-methodology-crate.md § thresholds module`) |
| `crates/engine-rs/src/state.rs` | `apply_ewma` delegates to `methodology::apply_ewma_pure`; `transition` takes `now: DateTime<Utc>`, delegates to `methodology::transition_decide` | Determinism + reuse of pure logic |
| `crates/engine-rs/src/main.rs` | `try_recompute` reads `Utc::now()` once + threads through; `push_alert` writes `alert_evidence` + spawns SAS commit; startup queries `methodology_versions` | Audit persistence + on-chain anchor |
| `crates/engine-rs/src/onchain_commit.rs` | **NEW module** | SAS on-chain receipt commit (fire-and-forget) |

---

## 2. Engine startup sequence (post-change)

```rust
// crates/engine-rs/src/main.rs::main (high-level pseudocode)

async fn main() -> Result<()> {
    init_tracing();
    init_sentry("engine");
    init_metrics("0.0.0.0:9091");
    spawn_healthz("0.0.0.0:9095");

    let cfg = EngineConfig::from_env()?;
    let (assets, assets_canonical) = load_assets(&cfg.assets_file)?;
    let pg = PgPool::connect(&cfg.database_url).await?;
    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn = redis::aio::ConnectionManager::new(redis_client.clone()).await?;

    // ===== NEW: methodology version validation =====
    let my_version = pegana_methodology::methodology_version();
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT status, status_reason FROM methodology_versions WHERE version = $1"
    ).bind(my_version).fetch_optional(&pg).await?;

    match row {
        Some((status, reason)) if status == "broken" => {
            error!(version = my_version, ?reason, "methodology version marked BROKEN");
            metrics::counter!("pegana_engine_methodology_broken_total").increment(1);
            anyhow::bail!("methodology v{} is broken: {}. Roll forward.",
                my_version, reason.unwrap_or_default());
        }
        Some((status, _)) => info!(version = my_version, status, "methodology validated"),
        None => {
            warn!(version = my_version, "methodology version not in DB; auto-inserting as active");
            sqlx::query("INSERT INTO methodology_versions (version, git_tag, released_at, status) VALUES ($1, $2, NOW(), 'active')")
                .bind(my_version)
                .bind(format!("methodology-v{}", my_version))
                .execute(&pg).await?;
        }
    }

    // ===== NEW: on-chain commit context (optional) =====
    let commit_ctx = if let Ok(keypair_data) = std::env::var("PEGANA_COMMIT_KEYPAIR") {
        let bytes = if std::path::Path::new(&keypair_data).exists() {
            std::fs::read(&keypair_data)?
        } else {
            bs58::decode(&keypair_data).into_vec()?
        };
        let keypair = Keypair::from_bytes(&bytes)?;
        let rpc_url = std::env::var("SOLANA_RPC_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into());
        let rpc = Arc::new(RpcClient::new(rpc_url));
        onchain_commit::check_wallet_balance(&rpc, &keypair).await.ok();
        Some(Arc::new(onchain_commit::CommitContext {
            rpc, keypair: Arc::new(keypair), pg: pg.clone(),
        }))
    } else {
        warn!("PEGANA_COMMIT_KEYPAIR not set — on-chain commitment DISABLED");
        None
    };

    let engine = Arc::new(EngineState::new(&assets, assets_canonical, cfg.pyth_staleness_secs));
    // ... existing pubsub setup ...

    loop {
        tokio::select! {
            maybe_msg = stream.next() => { /* handle_message */ }
            _ = heartbeat.tick() => { /* publish_heartbeat */ }
        }
    }
}
```

**Behavior on broken methodology**: process exits with non-zero status. Docker compose restarts; restart fails again; ops paged. Forces operator to either roll forward to a fixed version OR manually update the row.

**Behavior when wallet unconfigured**: engine starts normally, on-chain commit silently skipped, all other Trust Layer features (audit row, evidence URL, etc.) still active. Useful for staging where SAS isn't needed.

---

## 3. `state.rs` changes

### `EngineState::new` — accepts canonical TOML

```rust
pub struct EngineState {
    runtimes: RwLock<HashMap<String, Arc<RwLock<AssetRuntime>>>>,
    configs: HashMap<String, AssetConfig>,
    hyusd_cr: RwLock<Option<Decimal>>,
    pyth: RwLock<HashMap<String, PythEntry>>,
    pyth_staleness_secs: i64,
    staleness: PythStalenessConfig,
    assets_toml_canonical: String,        // NEW
}

impl EngineState {
    pub fn new(assets: &AssetsFile, assets_toml_canonical: String, pyth_staleness_secs: i64) -> Self {
        // ... existing init ...
        Self {
            // ... existing fields,
            assets_toml_canonical,
        }
    }

    pub fn assets_toml_canonical(&self) -> &str {
        &self.assets_toml_canonical
    }
}
```

The canonical TOML is loaded ONCE at startup and held in memory. It's used by `push_alert` to compute `assets_toml_sha256` and to populate `replay_artifact.assets_toml_canonical`.

### `apply_ewma` — delegates to methodology

```rust
pub async fn apply_ewma(&self, sym: &str, raw: Decimal, alpha: Decimal) -> Decimal {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let new = pegana_methodology::apply_ewma_pure(raw, g.ewma_discount, alpha);
    g.ewma_discount = Some(new);
    new
}
```

Cache mutation (read prev, write new) stays in `EngineState`. The math moves to the pure function. Behavior identical to pre-refactor.

### `transition` — takes explicit `now`, delegates

```rust
pub async fn transition(
    &self,
    sym: &str,
    candidate: PegState,
    now: chrono::DateTime<chrono::Utc>,   // NEW PARAMETER
    confirm_up_secs: i64,
    decay_down_secs: i64,
) -> PegState {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let decision = pegana_methodology::transition_decide(
        g.last_state,
        candidate,
        g.candidate_state,
        g.candidate_since,
        now,
        confirm_up_secs,
        decay_down_secs,
    );
    g.last_state = decision.new_last_state;
    g.candidate_state = decision.new_candidate_state;
    g.candidate_since = decision.new_candidate_since;
    g.last_state
}
```

**Caller update needed**: every `engine.transition(asset, state, X, Y)` becomes `engine.transition(asset, state, now, X, Y)`. The only caller is `try_recompute` in `main.rs`. Tests in `state.rs` also update.

### NEW: state inspection helpers (for `push_alert` audit payload)

```rust
impl EngineState {
    pub async fn previous_ewma(&self, sym: &str) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.ewma_discount
    }

    pub async fn candidate_state(&self, sym: &str) -> Option<PegState> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.candidate_state
    }

    pub async fn candidate_since(&self, sym: &str) -> Option<DateTime<Utc>> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.candidate_since
    }
}
```

These read-only methods let `push_alert` capture the state's "before snapshot" for `inputs_frozen` JSONB.

---

## 4. `main.rs::try_recompute` — read `now` once

The key determinism fix. Currently:
- Line 333: `let timer = std::time::Instant::now();` (metrics only)
- Line 419-421: `let final_state = engine.transition(asset, new_state, CONFIRM_UP_SECS, DECAY_DOWN_SECS).await;` (reads `now` internally)
- Line 429: `let ts = Utc::now();` (used for persist + alert)

After refactor:
```rust
async fn try_recompute(
    engine: &Arc<EngineState>,
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    asset: &str,
    alpha: Decimal,
    commit_ctx: Option<Arc<onchain_commit::CommitContext>>,  // NEW
) -> Result<()> {
    let timer = std::time::Instant::now();
    let now = Utc::now();   // NEW: READ ONCE

    let asset_cfg = match engine.asset_config(asset) {
        Some(a) => a,
        None => { return Ok(()); }
    };

    let (intrinsic, market) = match engine.snapshot(asset).await {
        Some(v) => v,
        None => return Ok(()),
    };

    let (i_sol_opt, m_sol_opt) = match engine.snapshot_sol(asset).await {
        Some((i, m)) => (Some(i), Some(m)),
        None => (None, None),
    };

    // Methodology delegation
    let discount_raw = pegana_methodology::compute_discount(
        intrinsic, market, i_sol_opt, m_sol_opt, asset_cfg.class,
    );

    if !pegana_methodology::is_plausible_discount_sample(discount_raw) {
        warn!(%asset, discount_raw = %discount_raw, "implausible — skip EWMA");
        metrics::counter!(
            "pegana_engine_discount_clamped_total",
            "asset" => asset.to_string(),
        ).increment(1);
        return Ok(());
    }

    let new_smooth = engine.apply_ewma(asset, discount_raw, alpha).await;

    // State determination + threshold kind
    let (new_state, threshold_kind) = if matches!(asset_cfg.class, AssetClass::StableCdp) && asset == "hyUSD" {
        let cr = engine.hyusd_cr().await.unwrap_or(Decimal::ONE);
        let thresholds = asset_cfg.thresholds.thresholds_cr.as_ref()
            .context("hyUSD missing thresholds_cr")?;
        (pegana_methodology::state_for_cr(cr, thresholds), "cr")
    } else {
        let thresholds = asset_cfg.thresholds.thresholds_bps.as_ref()
            .context("asset missing thresholds_bps")?;
        (pegana_methodology::state_for_bps_discount_aware(asset_cfg.class, new_smooth, thresholds), "bps")
    };

    // Transition with EXPLICIT now
    let final_state = engine.transition(asset, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS).await;

    let confidence_label = pyth_confidence_for_asset(engine, asset_cfg).await;

    // Persist + publish (existing) — uses `now` not Utc::now()
    persist_discount(pg, asset, discount_raw, new_smooth, final_state,
                     intrinsic, market, now, threshold_kind, confidence_label).await?;
    publish_discount(redis, asset, final_state, new_smooth, intrinsic, market, now).await?;

    // Alert emission (with audit)
    let prev_opt = engine.last_published_state(asset).await;
    let should_emit = match prev_opt {
        Some(prev) => prev != final_state,
        None => !matches!(final_state, PegState::Pegged | PegState::Unknown),
    };
    if should_emit {
        let prev = prev_opt.unwrap_or(PegState::Unknown);

        // Build receipt material
        let inputs_frozen = MethInputsFrozen {
            asset: asset.to_string(),
            class: asset_cfg.class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: i_sol_opt,
            market_sol: m_sol_opt,
            ewma_prev: engine.previous_ewma(asset).await,
            hyusd_cr: engine.hyusd_cr().await,
            previous_state: prev,
            candidate_state: engine.candidate_state(asset).await,
            candidate_since: engine.candidate_since(asset).await,
            thresholds: resolved_thresholds_map(asset_cfg, threshold_kind),
            threshold_kind: threshold_kind.to_string(),
            pyth_entries: collect_pyth_entries_for_asset(engine, asset_cfg).await,
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
        };
        let computed = Computed {
            discount_raw,
            discount_smooth: new_smooth,
            final_state,
            confidence_label: confidence_label.to_string(),
        };

        let assets_canonical = engine.assets_toml_canonical().to_string();
        let assets_hash = pegana_methodology::canonical_assets_hash(&assets_canonical)
            .map(pegana_methodology::hex_sha256)
            .unwrap_or_else(|e| { error!(?e, "assets hash fallback"); "0".repeat(64) });

        let receipt_hash = pegana_methodology::canonical_receipt_hash(
            pegana_methodology::methodology_version(),
            pegana_methodology::methodology_git_sha(),
            &assets_canonical,
            &inputs_frozen,
            &computed,
        ).map(pegana_methodology::hex_sha256)
            .unwrap_or_else(|e| { error!(?e, "receipt hash fallback"); "0".repeat(64) });

        let replay_artifact = if matches!(final_state, PegState::Depeg | PegState::Critical | PegState::BlackSwan) {
            Some(Receipt {
                schema_version: "v1".into(),
                methodology_version: pegana_methodology::methodology_version().to_string(),
                methodology_git_sha: pegana_methodology::methodology_git_sha().map(str::to_string),
                assets_toml_canonical: assets_canonical.clone(),
                inputs_frozen: inputs_frozen.clone(),
                expected_computed: computed.clone(),
                expected_receipt_sha256: receipt_hash.clone(),
            })
        } else {
            None
        };

        let event = AlertEvent {
            id: uuid::Uuid::new_v4(),
            asset: asset.to_string(),
            class: asset_cfg.class,
            peg_target: asset_cfg.peg_target,
            from_state: prev,
            to_state: final_state,
            discount: new_smooth,
            intrinsic_usd: intrinsic,
            market_usd: market,
            extra: serde_json::json!({
                "cr": engine.hyusd_cr().await,
                "cold_start": prev_opt.is_none(),
            }),
            detected_at: now,
        };

        push_alert(
            pg, redis, &event, confidence_label,
            pegana_methodology::methodology_version(),
            pegana_methodology::methodology_git_sha(),
            &assets_hash,
            &inputs_frozen,
            &computed,
            replay_artifact.as_ref(),
            &receipt_hash,
        ).await?;

        // Fire-and-forget on-chain commit for critical alerts
        if matches!(final_state, PegState::Depeg | PegState::Critical | PegState::BlackSwan) {
            if let Some(ctx) = commit_ctx {
                onchain_commit::commit_receipt(
                    ctx.clone(),
                    event.id,
                    pegana_methodology::methodology_version().to_string(),
                    receipt_hash.clone(),
                );
            }
        }

        info!(asset, from = ?prev, to = ?final_state, discount = %new_smooth,
              evidence_sha256 = %receipt_hash, "ALERT emitted");
    }
    engine.set_last_published_state(asset, final_state).await;

    metrics::histogram!("pegana_engine_recompute_seconds", "asset" => asset.to_string())
        .record(timer.elapsed().as_secs_f64());
    Ok(())
}
```

---

## 5. `main.rs::push_alert` — writes `alert_evidence`

```rust
#[allow(clippy::too_many_arguments)]
async fn push_alert(
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    event: &AlertEvent,
    confidence: &str,
    methodology_version: &str,
    methodology_git_sha: Option<&str>,
    assets_toml_sha256: &str,
    inputs_frozen: &MethInputsFrozen,
    computed: &Computed,
    replay_artifact: Option<&Receipt>,
    receipt_sha256: &str,
) -> Result<()> {
    // 1) Existing: alerts row
    sqlx::query(/* existing INSERT INTO alerts ... */)
        .bind(/* fields */).execute(pg).await?;

    // 2) NEW: alert_evidence row (failure logged + counted, never blocks dispatch)
    let inputs_json = serde_json::to_value(inputs_frozen).unwrap_or_default();
    let computed_json = serde_json::to_value(computed).unwrap_or_default();
    let replay_json = replay_artifact.map(|r| serde_json::to_value(r).unwrap_or_default());

    let audit_timer = std::time::Instant::now();
    let evidence_result = sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, methodology_git_sha, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (alert_id) DO NOTHING"#,
    )
    .bind(event.id)
    .bind(methodology_version)
    .bind(methodology_git_sha)
    .bind(assets_toml_sha256)
    .bind(inputs_json)
    .bind(computed_json)
    .bind(replay_json)
    .bind(receipt_sha256)
    .execute(pg).await;

    metrics::histogram!("pegana_audit_persist_seconds")
        .record(audit_timer.elapsed().as_secs_f64());

    match evidence_result {
        Ok(_) => metrics::counter!("pegana_audit_persist_total", "outcome" => "ok").increment(1),
        Err(e) => {
            error!(alert_id = %event.id, ?e, "alert_evidence insert FAILED — alert continues");
            metrics::counter!("pegana_audit_persist_total", "outcome" => "failed").increment(1);
        }
    }

    // 3) Existing: Redis stream (unchanged)
    use redis::AsyncCommands;
    let json = serde_json::to_string(event)?;
    let _: redis::Value = redis.xadd(channels::ALERTS_STREAM, "*", &[("event", json.as_str())]).await?;

    metrics::counter!("pegana_alerts_emitted_total",
        "class" => asset_class_label(event.class).to_string(),
        "transition" => format!("{}->{}",
            peg_state_label(event.from_state), peg_state_label(event.to_state)),
    ).increment(1);

    Ok(())
}
```

**Critical invariant**: `alerts` and `alert_evidence` are **separate sqlx calls** in this order:
1. alerts INSERT — must succeed (returns error if fail, aborts whole flow).
2. alert_evidence INSERT — if fails, logged + counted, BUT we continue to step 3.
3. Redis XADD — fires dispatcher.

Why this order: alerts is the durable record consumed by dispatcher. evidence is the audit add-on. If we wrapped both in a transaction, an audit-persist transient failure would silence the alert. That's wrong by spec `01-business-rules.md § 10`.

---

## 6. NEW module: `crates/engine-rs/src/onchain_commit.rs`

Fire-and-forget Solana SAS receipt commit. Tokio spawn pattern — never blocks alert dispatch.

```rust
//! Anchor receipt sha256 on-chain via Solana Attestation Service (or SPL Memo fallback).
//! Fire-and-forget — failures are logged + counted, never block alert dispatch.

use anyhow::{Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};
use spl_memo::build_memo;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

const MEMO_FORMAT: &str = "pegana-v1";
const COMMIT_TIMEOUT: Duration = Duration::from_secs(60);

pub struct CommitContext {
    pub rpc: Arc<RpcClient>,
    pub keypair: Arc<Keypair>,
    pub pg: PgPool,
}

pub fn commit_receipt(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: String,
    receipt_sha256: String,
) {
    tokio::spawn(async move {
        let result = tokio::time::timeout(
            COMMIT_TIMEOUT,
            do_commit(ctx.clone(), alert_id, &methodology_version, &receipt_sha256),
        ).await;
        match result {
            Ok(Ok(sig)) => {
                if let Err(e) = persist_sig(&ctx.pg, alert_id, &sig).await {
                    error!(?e, %alert_id, "failed to persist onchain_tx_sig");
                    metrics::counter!("pegana_onchain_persist_failed_total").increment(1);
                }
                info!(%alert_id, signature = %sig, "receipt committed on-chain");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "ok").increment(1);
            }
            Ok(Err(e)) => {
                error!(?e, %alert_id, "onchain commit failed");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "rpc_error").increment(1);
            }
            Err(_) => {
                error!(%alert_id, "onchain commit timeout");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "timeout").increment(1);
            }
        }
    });
}

async fn do_commit(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: &str,
    receipt_sha256: &str,
) -> Result<String> {
    let memo_payload = format!(
        "{}|{}|{}|{}",
        MEMO_FORMAT, methodology_version, alert_id, receipt_sha256
    );
    let memo_ix = build_memo(memo_payload.as_bytes(), &[&ctx.keypair.pubkey()]);
    let blockhash = ctx.rpc.get_latest_blockhash().await
        .context("get_latest_blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[memo_ix],
        Some(&ctx.keypair.pubkey()),
        &[ctx.keypair.as_ref()],
        blockhash,
    );
    let sig = ctx.rpc
        .send_and_confirm_transaction_with_spinner_and_commitment(
            &tx, CommitmentConfig::confirmed(),
        ).await.context("send_and_confirm")?;
    Ok(sig.to_string())
}

async fn persist_sig(pg: &PgPool, alert_id: Uuid, sig: &str) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence SET onchain_tx_sig = $1 \
         WHERE alert_id = $2 AND onchain_tx_sig IS NULL"
    )
    .bind(sig)
    .bind(alert_id)
    .execute(pg).await
    .context("update alert_evidence.onchain_tx_sig")?;
    Ok(())
}

pub async fn check_wallet_balance(rpc: &RpcClient, keypair: &Keypair) -> Result<u64> {
    let lamports = rpc.get_balance(&keypair.pubkey()).await
        .context("get_balance")?;
    let sol = lamports as f64 / 1_000_000_000.0;
    if sol < 0.5 {
        warn!(pubkey = %keypair.pubkey(), sol, "engine commit wallet LOW (<0.5 SOL)");
    } else {
        info!(pubkey = %keypair.pubkey(), sol, "engine commit wallet OK");
    }
    metrics::gauge!("pegana_commit_wallet_balance_sol").set(sol);
    Ok(lamports)
}
```

**Why SPL Memo and not SAS in v0.1.0**: SAS requires schema registration via SAS CLI (devnet first, then mainnet). Adds 1-2 days to project. SPL Memo is functionally equivalent for our needs (anchor a string to a tx that we can grep `getSignaturesForAddress`). **Trade-off accepted**: v0.1.0 ships SPL Memo; v0.2.0 migrates to SAS attestation schema. Both produce the same `onchain_tx_sig` column population.

The TODO for v0.2.0 migration to SAS proper is tracked in `13-risks-and-mitigations.md § Roadmap items`.

---

## 7. Tests

Existing tests in `crates/engine-rs/src/state.rs` (5 integration tests) MUST pass without modification, EXCEPT for `transition_is_two_phase_with_hysteresis` which adds the `now` parameter:

```rust
// Before
let s1 = e.transition("USDC", PegState::Drift, 30, 120).await;
// After
let now = chrono::Utc::now();
let s1 = e.transition("USDC", PegState::Drift, now, 30, 120).await;
```

**New integration tests**:
- `crates/engine-rs/tests/alert_evidence_append_only.rs` — UPDATE/DELETE blocked, write-once on `onchain_tx_sig`
- `crates/engine-rs/tests/audit_persistence.rs` — alerts+evidence FK consistency
- `crates/engine-rs/tests/onchain_commit.rs` (`--ignored` by default; runs with `DEVNET_KEYPAIR` env)

See `plans/03-phase-2-engine.md` and `plans/04-phase-3-audit-persistence.md` for the full test code.

---

## 8. Cross-references

- For methodology crate functions called here, see `05-methodology-crate.md`.
- For DB schema being written, see `04-data-model.md`.
- For test plan, see `plans/03-phase-2-engine.md` + `plans/04-phase-3-audit-persistence.md`.
- For acceptance criteria AC6-AC15, AC65-AC69, see `12-acceptance-criteria.md § Engine refactor` and `§ On-chain commitment`.
