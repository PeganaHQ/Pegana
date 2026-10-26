//! Pegana discount engine — consumes Redis pub/sub, computes per-asset discount,
//! runs state machine with hysteresis, persists discount_snapshots + emits alerts.

mod state;

// The two background workers live in the library target (src/lib.rs) so the
// integration tests in tests/ can drive a single tick without booting the
// recompute pipeline. The binary consumes them from the lib.
use engine_rs::{evidence_reconcile, onchain_commit};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use pegana_common::{
    channels, AlertEvent, AssetClass, AssetConfig, AssetsFile, IntrinsicStrategy, MarketStrategy,
    PegState,
};
use pegana_methodology::{
    canonical_assets_hash, canonical_receipt_hash, classify_cr_with_hysteresis,
    classify_with_hysteresis, compute_discount, discount_sanity_violated, hex_sha256,
    intrinsic_liveness_gate_violated, is_plausible_discount_sample, methodology_git_sha,
    methodology_version, next_worse_cr_band, override_final_state_attributed,
    premium_sanity_violated, pyth_confidence_gate_violated, Computed,
    InputsFrozen as MethInputsFrozen, OverrideReason, PythEntry as MethPythEntry, Receipt,
    CR_DEADBAND_PCT, DEADBAND_PCT,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use solana_sdk::commitment_config::CommitmentConfig;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use state::{signal_latency_secs, EngineState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

/// Consecutive reference-divergent prints before the market leg is declared dark.
const REFERENCE_REJECTS_BEFORE_DARK: u32 = 3;

/// Set once the flag-mismatch warning has been logged (per process).
static DARK_MISMATCH_WARNED: AtomicBool = AtomicBool::new(false);

// Single source: the verifier binds receipts to these. Changing them REQUIRES a
// methodology version bump (see `pegana_methodology::RECEIPT_*`).
const EWMA_ALPHA: &str = pegana_methodology::RECEIPT_EWMA_ALPHA;
const CONFIRM_UP_SECS: i64 = pegana_methodology::RECEIPT_CONFIRM_UP_SECS;
const DECAY_DOWN_SECS: i64 = pegana_methodology::RECEIPT_DECAY_DOWN_SECS;
/// Phase-1 depth-gate conservative default (ADR-0026) — chosen so the code
/// under-gates rather than over-gates until the founder runs the full-window
/// GO/NO-GO (docs/operations/depth-gate-phase1-decision.md). Override via
/// `DEPTH_GATE_FLOOR_USD`; `0` disables (the gate ships DISABLED by default —
/// see the `with_depth_gate` call site in `main()`).
const DEPTH_GATE_DEFAULT_FLOOR_USD: u32 = 50_000;
/// Freshness window (s) for the depth-gate's liquidity read. Mirrors
/// `SOURCE_STALENESS_SECS` (state.rs) — generous vs the 60s tokens.xyz poll
/// cadence, tight enough to catch a real feed outage. Override via
/// `DEPTH_GATE_FRESHNESS_SECS`.
const DEPTH_GATE_DEFAULT_FRESHNESS_SECS: i64 = 600;
// DEADBAND_PCT / CR_DEADBAND_PCT: moved to pegana_methodology::thresholds (single source of truth)
// and imported above via `use pegana_methodology::{..., CR_DEADBAND_PCT, DEADBAND_PCT}`.
const HEARTBEAT_SECS: u64 = 5;
/// H12b observability sweep: an ACTIVE asset that hasn't published a state in
/// this long is flagged (gauge + warn), never flipped. Well past any normal
/// recompute gap (sources poll every 15–60s; the widest NAV cadence is daily
/// but still republishes within its window).
const STALE_AFTER_SECS: i64 = 900;

/// Log only the RPC host; credentials can appear in the path or query.
fn mask_rpc_url(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_owned))
        .unwrap_or_else(|| "invalid-rpc-url".into())
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();
    let _sentry = pegana_common::observability::init_sentry("engine");
    pegana_common::observability::init_metrics("0.0.0.0:9091");
    metrics::describe_histogram!(
        "pegana_signal_latency_seconds",
        metrics::Unit::Seconds,
        "End-to-end signal latency: newest market observation behind a published verdict → fan-out to consumers"
    );
    pegana_common::observability::spawn_healthz("0.0.0.0:9095");
    info!(
        "pegana-engine starting · version={}",
        env!("CARGO_PKG_VERSION")
    );

    let cfg = EngineConfig::from_env()?;
    let (assets, assets_canonical) = load_assets(&cfg.assets_file)?;
    // Pool safety net (mirror of api-rs, 2026-07-25 incident): sqlx's default
    // pool has NO statement_timeout, so a single stuck query would silently
    // freeze the recompute loop (engine is the signal producer). Low
    // concurrency here, so the default 10-conn ceiling is fine — the
    // statement_timeout backstop is the point. Both env-overridable.
    let statement_timeout_ms = cfg.db_statement_timeout_ms;
    let pg = PgPoolOptions::new()
        .max_connections(cfg.db_max_connections)
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                if statement_timeout_ms > 0 {
                    use sqlx::Executor;
                    conn.execute(
                        format!("SET statement_timeout = {statement_timeout_ms}").as_str(),
                    )
                    .await?;
                }
                Ok(())
            })
        })
        .connect(&cfg.database_url)
        .await?;

    // ===== Methodology version validation =====
    // Per ADR-0009 lifecycle: refuse to start if our compiled methodology
    // version is marked broken. Auto-insert if unknown (first run of this version).
    let my_version = pegana_methodology::methodology_version();
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT status, status_reason FROM methodology_versions WHERE version = $1")
            .bind(my_version)
            .fetch_optional(&pg)
            .await
            .context("query methodology_versions")?;

    match row {
        Some((status, reason)) if status == "broken" => {
            tracing::error!(
                version = my_version,
                reason = ?reason,
                "methodology version is marked BROKEN — refusing to start"
            );
            metrics::counter!("pegana_engine_methodology_broken_total").increment(1);
            anyhow::bail!(
                "methodology v{} is broken: {}. Roll forward to a fixed version.",
                my_version,
                reason.unwrap_or_default()
            );
        }
        Some((status, _)) => {
            tracing::info!(
                version = my_version,
                status,
                "methodology version validated"
            );
        }
        None => {
            tracing::warn!(
                version = my_version,
                "methodology version not in DB — inserting as active"
            );
            // ON CONFLICT DO NOTHING handles the rolling-deploy race where
            // two engine instances start concurrently on a brand-new version —
            // both SELECT → None, both INSERT. Without the clause the second
            // would crash on the unique-key violation and trigger a restart loop.
            sqlx::query(
                "INSERT INTO methodology_versions (version, git_tag, released_at, status, notes) \
                 VALUES ($1, $2, NOW(), 'active', 'Auto-inserted on first engine start.') \
                 ON CONFLICT (version) DO NOTHING",
            )
            .bind(my_version)
            .bind(format!("methodology-v{}", my_version))
            .execute(&pg)
            .await
            .context("insert methodology_versions")?;
        }
    }

    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn =
        redis::aio::ConnectionManager::new_with_config(redis_client.clone(), redis_config())
            .await?;
    // Visible at 0 from startup so `increase()` catches the first timeout.
    metrics::counter!("pegana_redis_timeouts_total").increment(0);
    let mut redis_timeouts = RedisTimeouts::default();
    let alpha: Decimal = EWMA_ALPHA.parse().unwrap();

    // Phase-1 depth gate (ADR-0026, confidence-cap-only). Ships DISABLED
    // (floor = 0, a real liquidity reading is always > 0 so this is a true
    // kill switch) — opt-in only, so the gate is inert on every existing
    // deployment until the founder runs the GO/NO-GO
    // (docs/operations/depth-gate-phase1-decision.md) and explicitly sets
    // `DEPTH_GATE_FLOOR_USD`. `DEPTH_GATE_DEFAULT_FLOOR_USD` documents the
    // plan's conservative reference value for that future decision — it is
    // NOT auto-applied, since flipping a live confidence-affecting gate on
    // by default (rather than by deliberate founder action) would be a
    // silent behavior change on redeploy.
    let depth_gate_floor_usd: Decimal = std::env::var("DEPTH_GATE_FLOOR_USD")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(Decimal::ZERO);
    let depth_gate_freshness_secs: i64 = std::env::var("DEPTH_GATE_FRESHNESS_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEPTH_GATE_DEFAULT_FRESHNESS_SECS);
    info!(
        floor_usd = %depth_gate_floor_usd,
        freshness_secs = depth_gate_freshness_secs,
        recommended_floor_usd = DEPTH_GATE_DEFAULT_FLOOR_USD,
        "depth-gate (Phase 1, confidence-cap-only) configured — ships DISABLED \
         by default (DEPTH_GATE_FLOOR_USD=0); set DEPTH_GATE_FLOOR_USD to enable \
         once the GO/NO-GO decision is made"
    );

    // Intrinsic-liveness gate (ADR-0038). Same opt-in-only discipline as the
    // depth gate: DISABLED unless `INTRINSIC_LIVENESS_GATE` is explicitly truthy,
    // so it's inert (byte-exact receipts, unchanged verdicts) on every existing
    // deployment until the founder runs the calibration + GO decision. When on,
    // the engine reads the `intrinsic_liveness` signal (migration 0068) per
    // asset and force-UNKNOWNs a stale-flagged backing.
    let intrinsic_liveness_gate_enabled: bool = std::env::var("INTRINSIC_LIVENESS_GATE")
        .ok()
        .map(|s| {
            matches!(
                s.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "on" | "yes"
            )
        })
        .unwrap_or(false);
    let intrinsic_liveness_freshness_secs: i64 = std::env::var("INTRINSIC_LIVENESS_FRESHNESS_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3600);
    info!(
        enabled = intrinsic_liveness_gate_enabled,
        freshness_secs = intrinsic_liveness_freshness_secs,
        "intrinsic-liveness gate (ADR-0038) configured — ships DISABLED by \
         default (INTRINSIC_LIVENESS_GATE unset); set it to enable once the \
         signal is calibrated against prod"
    );

    let jupiter_assets = assets
        .assets
        .iter()
        .filter(|a| a.active && matches!(a.market, MarketStrategy::JupiterUsd { .. }))
        .count();
    let jupiter_tick_ms = cfg
        .poll_tick_ms
        .or(assets.polling.jupiter_tick_ms)
        .unwrap_or(2_200)
        .max(250); // same floor as the indexer's MIN_JUPITER_TICK_MS
    let dark_market_window = pegana_common_verify::dark_market_window_secs(
        jupiter_assets,
        cfg.jupiter_max_concurrent.max(1).min(jupiter_assets.max(1)),
        jupiter_tick_ms,
    );
    info!(
        dark_market_gate_enabled = cfg.dark_market_gate_enabled,
        dark_market_window_secs = dark_market_window,
        jupiter_assets,
        jupiter_tick_ms,
        "dark-market gate configured (DARK_MARKET_GATE_ENABLED; default OFF — must match the indexer)"
    );

    // Falling-intrinsic flag (A4). Ships OFF (0). When set (bps drop below the
    // window maximum), the engine exports gauges/counters and caps confidence at
    // "low" on a falling NAV/backing; it never changes the peg state itself.
    let intrinsic_drop_alert_bps: u32 = env_parsed("INTRINSIC_DROP_ALERT_BPS", 0);
    let intrinsic_drop_window_secs: i64 = env_parsed("INTRINSIC_DROP_WINDOW_SECS", 86_400);
    info!(
        threshold_bps = intrinsic_drop_alert_bps,
        window_secs = intrinsic_drop_window_secs,
        "falling-intrinsic flag configured (INTRINSIC_DROP_ALERT_BPS; 0 = off)"
    );

    let engine = Arc::new(
        EngineState::new(&assets, assets_canonical, cfg.pyth_staleness_secs)
            .with_pyth_onchain_staleness(cfg.pyth_onchain_staleness_secs)
            .with_depth_gate(depth_gate_floor_usd, depth_gate_freshness_secs)
            .with_intrinsic_liveness_gate(
                intrinsic_liveness_gate_enabled,
                intrinsic_liveness_freshness_secs,
            )
            .with_pyth_gate_exclude_cancelled_numeraire(env_flag(
                "PYTH_GATE_EXCLUDE_CANCELLED_NUMERAIRE",
            ))
            .with_market_confirmation(
                env_parsed("MARKET_REFERENCE_GATE_BPS", 0u32),
                env_flag("PREMIUM_CONFIRMATION_GATE"),
                env_flag("DEPTH_VERDICT_GATE"),
            )
            .with_intrinsic_drop_alert(intrinsic_drop_alert_bps, intrinsic_drop_window_secs)
            .with_dark_market_gate(cfg.dark_market_gate_enabled, dark_market_window),
    );

    // ===== Engine state hydration (ADR-0010) =====
    // Before the first recompute, restore per-asset EWMA + hysteresis state
    // from engine_state_snapshot. Without this, every restart during the
    // 2026-05-27→2026-06-10 calibration window biases the verdict per ADR-0001:
    // the 30-tick EWMA warmup re-runs from None, and any in-flight hysteresis
    // candidate is lost. Failure here is non-fatal — we just start cold.
    let hydrated = engine.load_from_pg(&pg).await;
    let relatched = engine.reseed_premium_latch().await;
    if relatched > 0 {
        info!(relatched, "premium-hold latch restored after restart");
    }
    match hydrated {
        Ok(n) => info!(
            restored = n,
            total = engine.configs_count(),
            "engine_state_snapshot hydrated"
        ),
        Err(e) => warn!(
            ?e,
            "engine_state_snapshot load failed — starting with cold cache"
        ),
    }

    // ===== On-chain commit context (ADR-0004) =====
    // Built only when PEGANA_COMMIT_KEYPAIR is set. Absence is treated as
    // "commit disabled" — the engine still emits alerts (evidence rows then go
    // in as commit_status='not_applicable', per push_alert's on_chain_enabled
    // gate). When a keypair IS present, the dead-letter retry worker spawned
    // below reconciles any commit failures parked in
    // alert_evidence_commit_failures.
    let commit_ctx = build_commit_context(&pg).await?;

    // ===== ADR-0006 alert_evidence reconcile worker =====
    // Recovers audit rows that push_alert dropped into alert_evidence_pending
    // (the dead-letter queue for failed synchronous INSERTs). Needs only the
    // pool, so it runs unconditionally regardless of on-chain commit state. The
    // cloned ConnectionManager is the reconcile-event publisher (Arc-backed, so
    // cloning shares the underlying multiplexed connection).
    tokio::spawn(evidence_reconcile::run_alert_evidence_reconcile(
        pg.clone(),
        Some(redis_conn.clone()),
    ));

    // ===== ADR-0004 dead-letter commit retry worker =====
    // Re-attempts on-chain commits parked in alert_evidence_commit_failures.
    // Guarded the same way as the wallet monitor: only when a CommitContext
    // (keypair + RPC + burst semaphore) exists — without a keypair there is
    // nothing to retry with.
    if let Some(ctx) = commit_ctx.as_ref() {
        tokio::spawn(onchain_commit::run_commit_failures_retry(ctx.clone()));
    }

    // Pub/sub subscriber needs a dedicated connection (separate from publisher).
    let mut pubsub = redis_client.get_async_pubsub().await?;
    pubsub
        .subscribe(&[
            channels::SRC_SANCTUM,
            channels::SRC_JUPITER,
            channels::SRC_PYTH,
            channels::SRC_HYLO,
            channels::SRC_SOLAYER,
            channels::SRC_PIGGYBANK,
            channels::SRC_SPL_STAKE_POOL,
            channels::SRC_PERENA,
            channels::SRC_INTRINSIC,
        ])
        .await?;

    // Make every persist-failure series visible at 0 so `increase()` sees the first.
    for a in &assets.assets {
        for stage in ["snapshot", "publish", "alert"] {
            metrics::counter!(
                "pegana_engine_persist_failed_after_transition_total",
                "asset" => a.symbol.clone(),
                "stage" => stage,
            )
            .increment(0);
        }
    }

    info!("engine subscribed to source channels");
    let mut stream = pubsub.on_message();

    // Heartbeat keeps WS clients (and operators watching Redis MONITOR) aware
    // the engine is alive even when nothing is recomputing.
    let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_SECS));
    heartbeat.tick().await; // burn the immediate first tick
    let mut heartbeat_ticks: u64 = 0; // drives the every-6th-tick H12b freshness sweep

    // Shutdown signals (ADR-0010): on SIGTERM (k8s/docker graceful stop) or
    // SIGINT (Ctrl-C), flush the in-memory cache to engine_state_snapshot
    // before exiting so the next boot resumes with the exact state we had
    // at signal time (not "1 cycle stale" as in the crash case).
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("register SIGTERM handler")?;

    loop {
        tokio::select! {
            maybe_msg = stream.next() => {
                let Some(msg) = maybe_msg else {
                    info!("engine pub/sub stream ended");
                    return Ok(());
                };
                let channel: String = msg.get_channel_name().to_string();
                let payload: String = match msg.get_payload() {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(?e, "bad payload");
                        metrics::counter!("pegana_engine_redis_bad_payload_total").increment(1);
                        continue;
                    }
                };
                if let Err(e) = handle_message(
                    &engine,
                    &pg,
                    &mut redis_conn,
                    &channel,
                    &payload,
                    alpha,
                    commit_ctx.as_ref(),
                )
                .await
                {
                    if redis_timeouts.on_error(&e) {
                        rebuild_redis(&redis_client, &mut redis_conn).await;
                    }
                    error!(channel = %channel, ?e, "handle_message failed");
                    metrics::counter!(
                        "pegana_engine_handle_message_failed_total",
                        "channel" => channel.clone()
                    )
                    .increment(1);
                    sentry::capture_message(
                        &format!("pegana engine handle_message failed: channel={channel} err={e:?}"),
                        sentry::Level::Error,
                    );
                } else {
                    redis_timeouts.on_success();
                }
            }
            _ = heartbeat.tick() => {
                if let Err(e) = publish_heartbeat(&mut redis_conn).await {
                    if redis_timeouts.on_error(&e) {
                        rebuild_redis(&redis_client, &mut redis_conn).await;
                    }
                    warn!(?e, "heartbeat publish failed");
                    metrics::counter!("pegana_engine_heartbeat_publish_failed_total").increment(1);
                }
                heartbeat_ticks = heartbeat_ticks.wrapping_add(1);
                // H12b (observability-only): every ~30s, classify asset freshness
                // and emit gauges. NEVER flips state — just surfaces a totally-dead
                // asset the snapshot-gating can't catch (it never recomputes). The
                // state-flip phase is deferred (ADR-0019) to avoid false-stale.
                if heartbeat_ticks.is_multiple_of(6) {
                    let report = engine.classify_freshness(Utc::now(), STALE_AFTER_SECS).await;
                    metrics::gauge!("pegana_engine_fresh_assets").set(report.fresh as f64);
                    metrics::gauge!("pegana_engine_stale_assets").set(report.stale.len() as f64);
                    metrics::gauge!("pegana_engine_dead_assets").set(report.dead.len() as f64);
                    if !report.stale.is_empty() || !report.dead.is_empty() {
                        warn!(
                            stale = ?report.stale,
                            dead = ?report.dead,
                            "H12b freshness sweep — active assets not publishing"
                        );
                    }
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("received SIGINT — flushing engine state");
                let flushed = engine.snapshot_all_to_pg(&pg).await;
                info!(flushed, "engine state snapshot flushed before shutdown");
                return Ok(());
            }
            _ = sigterm.recv() => {
                info!("received SIGTERM — flushing engine state");
                let flushed = engine.snapshot_all_to_pg(&pg).await;
                info!(flushed, "engine state snapshot flushed before shutdown");
                return Ok(());
            }
        }
    }
}

/// Response/connect timeout for the engine's publisher connection.
fn redis_config() -> redis::aio::ConnectionManagerConfig {
    redis::aio::ConnectionManagerConfig::new()
        .set_response_timeout(std::time::Duration::from_secs(5))
        .set_connection_timeout(std::time::Duration::from_secs(5))
}

/// Consecutive Redis timeouts before the publisher connection is rebuilt.
const REDIS_REBUILD_AFTER_TIMEOUTS: u32 = 3;

/// Counts Redis timeouts (`pegana_redis_timeouts_total`) and tells the caller
/// when a run of them means the connection manager should be replaced.
#[derive(Default)]
struct RedisTimeouts {
    consecutive: u32,
}

impl RedisTimeouts {
    fn on_success(&mut self) {
        self.consecutive = 0;
    }

    /// `true` when `err` was the third consecutive Redis timeout.
    fn on_error(&mut self, err: &anyhow::Error) -> bool {
        let timed_out = err.chain().any(|cause| {
            cause
                .downcast_ref::<redis::RedisError>()
                .is_some_and(|e| e.is_timeout())
        });
        if !timed_out {
            return false;
        }
        metrics::counter!("pegana_redis_timeouts_total").increment(1);
        self.consecutive += 1;
        if self.consecutive >= REDIS_REBUILD_AFTER_TIMEOUTS {
            self.consecutive = 0;
            return true;
        }
        false
    }
}

async fn rebuild_redis(client: &redis::Client, conn: &mut redis::aio::ConnectionManager) {
    match redis::aio::ConnectionManager::new_with_config(client.clone(), redis_config()).await {
        Ok(fresh) => {
            *conn = fresh;
            warn!("redis connection rebuilt after repeated timeouts");
        }
        Err(e) => warn!(error = %e, "redis connection rebuild failed; keeping the old one"),
    }
}

async fn publish_heartbeat(redis: &mut redis::aio::ConnectionManager) -> Result<()> {
    use redis::AsyncCommands;
    let payload = serde_json::json!({ "kind": "heartbeat", "ts": wire_ts(&Utc::now()) });
    let json = serde_json::to_string(&payload)?;
    let _: redis::Value = redis.publish(channels::DISCOUNT, json).await?;
    metrics::counter!("pegana_engine_publishes_total", "kind" => "heartbeat").increment(1);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct EngineConfig {
    pub database_url: String,
    pub redis_url: String,
    /// Enables the shorter market window and explicit UNKNOWN on missing quotes.
    #[serde(default)]
    pub dark_market_gate_enabled: bool,
    /// Jupiter polling inputs, read from the same env vars as the indexer so
    /// both services derive the same dark-market window.
    #[serde(default = "default_jupiter_concurrent")]
    pub jupiter_max_concurrent: usize,
    #[serde(default)]
    pub poll_tick_ms: Option<u64>,
    #[serde(default = "default_assets_path")]
    pub assets_file: PathBuf,
    /// Base max age (s) for a cached Pyth reading, and the fallback window for
    /// feeds without a `[pyth_staleness.overrides]` entry. Default 30s. Every
    /// print now comes from Solana push accounts (the Hermes stream is gone),
    /// which are additionally floored at `pyth_onchain_staleness_secs`.
    #[serde(default = "default_pyth_staleness")]
    pub pyth_staleness_secs: i64,
    /// Max age (s) for Pyth prints the indexer read from on-chain push-oracle
    /// accounts (`PYTH_ONCHAIN_STALENESS_SECS`, default 120). Those step at the
    /// push-feed heartbeat (55s for Pyth's documented Solana sponsored feeds,
    /// slower for some; see the per-feed overrides) plus the indexer's poll.
    #[serde(default = "default_pyth_onchain_staleness")]
    pub pyth_onchain_staleness_secs: i64,
    /// Postgres pool ceiling. Default 10 (sqlx's default) — engine runs a
    /// single-consumer recompute loop + a few low-concurrency workers, so the
    /// ceiling isn't the risk here. Override via DB_MAX_CONNECTIONS.
    #[serde(default = "default_db_max_connections")]
    pub db_max_connections: u32,
    /// Per-connection `statement_timeout`, in ms (0 = unlimited). 30s backstop
    /// so a stuck query can't silently freeze recompute. Override via
    /// DB_STATEMENT_TIMEOUT_MS.
    #[serde(default = "default_db_statement_timeout_ms")]
    pub db_statement_timeout_ms: u64,
}
fn default_assets_path() -> PathBuf {
    PathBuf::from("./assets.toml")
}
fn default_pyth_staleness() -> i64 {
    30
}
fn default_pyth_onchain_staleness() -> i64 {
    state::DEFAULT_PYTH_ONCHAIN_STALENESS_SECS
}
fn default_db_max_connections() -> u32 {
    10
}
fn default_db_statement_timeout_ms() -> u64 {
    30_000
}

impl EngineConfig {
    fn from_env() -> Result<Self> {
        envy::prefixed("").from_env().context("env")
    }
}

/// Parse an opt-in flag value (`1|true|on|yes`, case-insensitive).
fn parse_flag(raw: &str) -> bool {
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "on" | "yes"
    )
}

/// Read a numeric env var; an unparseable value is logged and replaced by the
/// default rather than silently ignored.
fn env_parsed<T: std::str::FromStr>(name: &str, default: T) -> T {
    match std::env::var(name) {
        Err(_) => default,
        Ok(raw) => raw.trim().parse().unwrap_or_else(|_| {
            warn!(var = name, value = %raw, "unparseable env value; using the default");
            default
        }),
    }
}

/// Read an opt-in boolean env flag; unset means OFF.
fn env_flag(name: &str) -> bool {
    std::env::var(name).map(|v| parse_flag(&v)).unwrap_or(false)
}

fn default_jupiter_concurrent() -> usize {
    1
}

/// Load + parse `assets.toml`. This file is the RUNTIME source of truth for
/// per-asset thresholds: every recompute reads `asset_cfg.thresholds`
/// (`thresholds_bps` / `thresholds_cr`) straight off the parsed config — the
/// engine never queries the `assets` table, so the DB `assets.thresholds` JSONB
/// column (migration 0001/0002) is display metadata only.
///
/// This is why migration 0021 (reserved for "calibration threshold updates")
/// was intentionally never written: a calibration change ships by editing
/// `assets.toml` + redeploying the engine, not by a data migration. The DB
/// column would only need a migration if it ever became authoritative for the
/// running thresholds — it is not today.
fn load_assets(path: &PathBuf) -> Result<(AssetsFile, String)> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let mut parsed: AssetsFile = toml::from_str(&raw).context("parse assets")?;
    let before = parsed.assets.len();
    parsed.assets.retain(|a| a.active);
    let after = parsed.assets.len();
    if before != after {
        info!(
            deactivated = before - after,
            kept = after,
            "asset filter · skipped inactive entries"
        );
    }
    validate_asset_thresholds(&parsed)?;
    let canonical = toml::to_string(&toml::from_str::<toml::Value>(&raw)?)?;
    Ok((parsed, canonical))
}

/// Refuse to start on a malformed threshold table (unknown key, mis-ordered
/// bands, unreachable explicit black_swan); warn on an unreachable implied one.
fn validate_asset_thresholds(assets: &AssetsFile) -> Result<()> {
    for asset in &assets.assets {
        for (kind, table) in [
            ("bps", asset.thresholds.thresholds_bps.as_ref()),
            ("cr", asset.thresholds.thresholds_cr.as_ref()),
        ] {
            let Some(table) = table else { continue };
            match pegana_methodology::validate_thresholds(kind, table) {
                Ok(warnings) => {
                    for w in warnings {
                        warn!(asset = %asset.symbol, "{w}");
                    }
                }
                Err(e) => anyhow::bail!("asset {}: thresholds_{kind}: {e}", asset.symbol),
            }
        }
    }
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,solana_rpc_client=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .init();
}

#[allow(clippy::too_many_arguments)]
async fn handle_message(
    engine: &Arc<EngineState>,
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    channel: &str,
    payload: &str,
    alpha: Decimal,
    commit_ctx: Option<&Arc<onchain_commit::CommitContext>>,
) -> Result<()> {
    let value: serde_json::Value = serde_json::from_str(payload)?;

    match channel {
        c if c == channels::SRC_PYTH => {
            // Cache Pyth prices for FX-cross intrinsic derivation (e.g. BRZ uses USD/BRL).
            // We require a parsable `publish_time` so staleness gating downstream
            // can reject readings that haven't moved in too long. Confidence
            // defaults to zero when the payload omits it; `pyth_confidence_label`
            // now treats a zero/absent confidence as "no signal" (None → the
            // asset's confidence degrades to "unknown"), never as the best bucket.
            if let (Some(feed), Ok(price), Some(publish_time)) = (
                value.get("feed").and_then(|v| v.as_str()),
                parse_decimal(&value, "price"),
                value
                    .get("publish_time")
                    .and_then(|v| v.as_str())
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.with_timezone(&Utc)),
            ) {
                let conf = parse_decimal_opt(&value, "confidence").unwrap_or(Decimal::ZERO);
                // `origin` is additive: absent (an indexer older than the
                // on-chain-only reader) means the print gets only the base window.
                let onchain = value.get("origin").and_then(|v| v.as_str()) == Some("onchain");
                engine
                    .set_pyth_with_origin(feed, price, publish_time, conf, onchain)
                    .await;
            }
            // Secondary envelope: when the Pyth source fans out an
            // asset-specific update, it includes an `asset` field. There are
            // two shapes:
            //   - redemption-rate (intrinsic): carries `value_usd`
            //   - spot-market (market): carries `market_usd` + source="pyth_spot"
            // Treat them as direct writes and immediately try recompute so a
            // separate Jupiter market tick isn't required to publish state.
            if let Some(asset) = value.get("asset").and_then(|v| v.as_str()) {
                let value_usd = parse_decimal(&value, "value_usd").ok();
                let market_usd = parse_decimal(&value, "market_usd").ok();
                let mut touched = false;
                let mut intrinsic_published = false;
                if value_usd.is_some() || market_usd.is_some() {
                    let observed_at = observed_at_or_now(&value, "publish_time");
                    if let Some(value_usd) = value_usd {
                        engine.set_intrinsic(asset, value_usd, observed_at).await;
                        touched = true;
                        intrinsic_published = true;
                    }
                    if let Some(market_usd) = market_usd {
                        engine.set_market(asset, market_usd, observed_at).await;
                        touched = true;
                    }
                    // (Liquidity is handled on the SRC_JUPITER arm, where the
                    // DexScreener + tokens.xyz liquidity envelopes actually publish
                    // — the Pyth fan-out here never carries liquidity_usd.)
                    // F1/H5: a `pyth_spot` asset publishes only `market_usd` here; its
                    // intrinsic (e.g. fixed_1_usd for USDC/USDT, now off the Jupiter
                    // path) must still be seeded or `snapshot()` stays None forever
                    // and the asset locks in UNKNOWN. Mirror the Jupiter handler's
                    // derive step — but only when this envelope didn't already
                    // publish an intrinsic (RR/NAV assets carry `value_usd` above).
                    if touched && !intrinsic_published {
                        if let Some(derived) = engine.derive_intrinsic(asset).await {
                            engine.set_intrinsic(asset, derived, observed_at).await;
                        }
                    }
                }
                if touched {
                    try_recompute(engine, pg, redis, asset, alpha, commit_ctx).await?;
                }
            }
            Ok(())
        }
        c if c == channels::SRC_SANCTUM
            || c == channels::SRC_SOLAYER
            || c == channels::SRC_PIGGYBANK
            || c == channels::SRC_SPL_STAKE_POOL
            || c == channels::SRC_PERENA
            || c == channels::SRC_INTRINSIC =>
        {
            // Generic per-asset intrinsic envelope shape, shared by Sanctum,
            // Solayer (sUSD Token-2022 InterestBearing), Piggybank (pbUSDC
            // vault PDA decode), Perena (USD* vault NAV decode), and the
            // generic SRC_INTRINSIC channel (JLP pool AUM, Ethereum view-call
            // NAVs, HTTP FX median). Each publishes `{asset, value_usd}`.
            // Sanctum additionally publishes `value_sol` (sol_per_lst) — the
            // engine uses it to compute LST discount in SOL terms so the
            // pyth(SOL/USD) multiplier cancels.
            let asset = value
                .get("asset")
                .and_then(|v| v.as_str())
                .context("missing asset")?
                .to_string();
            let value_usd = parse_decimal(&value, "value_usd")?;
            let observed_at = observed_at_or_now(&value, "ts");
            engine.set_intrinsic(&asset, value_usd, observed_at).await;
            if let Some(value_sol) = parse_decimal_opt(&value, "value_sol") {
                engine
                    .set_intrinsic_sol(&asset, value_sol, observed_at)
                    .await;
            }
            try_recompute(engine, pg, redis, &asset, alpha, commit_ctx).await
        }
        c if c == channels::SRC_HYLO => {
            // Hylo now publishes a combined snapshot with all three derived
            // assets (hyUSD CR, xSOL NAV, sHYUSD rate). Each sub-key carries
            // its own `intrinsic_usd` and the engine recomputes per asset.
            //
            // Payload shape:
            //   { "kind": "hylo_snapshot", "ts": ..., "hyusd": {...}, "xsol": {...}, ... }
            //
            // For backward compatibility, fall back to the old single-asset
            // shape if no `kind` field is present.
            if value.get("kind").and_then(|v| v.as_str()) == Some("hylo_snapshot") {
                let observed_at = observed_at_or_now(&value, "ts");
                if let Some(hyusd) = value.get("hyusd") {
                    if let Ok(v) = parse_decimal(hyusd, "intrinsic_usd") {
                        engine.set_intrinsic("hyUSD", v, observed_at).await;
                    }
                    if let Some(cr) = parse_decimal_opt(hyusd, "cr") {
                        engine.set_hyusd_cr(cr).await;
                    }
                    try_recompute(engine, pg, redis, "hyUSD", alpha, commit_ctx).await?;
                }
                // xSOL + sHYUSD intrinsics arrive in the same snapshot when
                // the indexer was able to compute them. If absent (e.g.
                // sHYUSD rate can't be derived without IDL decode), the
                // asset stays in its current state (UNKNOWN on first boot).
                if let Some(xsol) = value.get("xsol") {
                    if let Ok(v) = parse_decimal(xsol, "intrinsic_usd") {
                        engine.set_intrinsic("xSOL", v, observed_at).await;
                        try_recompute(engine, pg, redis, "xSOL", alpha, commit_ctx).await?;
                    }
                }
                if let Some(shyusd) = value.get("shyusd") {
                    if let Ok(v) = parse_decimal(shyusd, "intrinsic_usd") {
                        engine.set_intrinsic("sHYUSD", v, observed_at).await;
                        try_recompute(engine, pg, redis, "sHYUSD", alpha, commit_ctx).await?;
                    }
                }
                Ok(())
            } else {
                let asset = "hyUSD".to_string();
                let intrinsic_usd = parse_decimal(&value, "intrinsic_usd")?;
                let cr = parse_decimal_opt(&value, "cr");
                let observed_at = observed_at_or_now(&value, "ts");
                engine
                    .set_intrinsic(&asset, intrinsic_usd, observed_at)
                    .await;
                if let Some(cr) = cr {
                    engine.set_hyusd_cr(cr).await;
                }
                try_recompute(engine, pg, redis, &asset, alpha, commit_ctx).await
            }
        }
        c if c == channels::SRC_JUPITER => {
            let asset = value
                .get("asset")
                .and_then(|v| v.as_str())
                .context("missing asset")?
                .to_string();
            if value.get("market_unavailable").and_then(|v| v.as_bool()) == Some(true) {
                if !engine.dark_market_gate_enabled() {
                    // The indexer reports dark markets but this engine would ignore
                    // them: the two services disagree on DARK_MARKET_GATE_ENABLED.
                    metrics::counter!("pegana_engine_dark_envelope_ignored_total").increment(1);
                    if !DARK_MISMATCH_WARNED.swap(true, Ordering::Relaxed) {
                        warn!(
                            %asset,
                            "indexer sent market_unavailable but DARK_MARKET_GATE_ENABLED is off here — ignoring (flag mismatch between services)"
                        );
                    }
                    return Ok(());
                }
                // Always record the dark leg; only the false→true edge recomputes, so
                // repeated reports stay idempotent (one UNKNOWN, one receipt).
                if engine.mark_market_unavailable(&asset).await {
                    try_recompute(engine, pg, redis, &asset, alpha, commit_ctx).await?;
                }
                return Ok(());
            }
            // Liquidity-only envelopes (the tokens.xyz source) carry
            // `liquidity_usd` but NO `value_usd`; DexScreener envelopes carry
            // BOTH. Stow the liquidity (server-only metadata → event.extra)
            // here, where those sources actually publish.
            if let Some(liquidity_usd) = parse_decimal_opt(&value, "liquidity_usd") {
                let liq_observed_at = observed_at_or_now(&value, "ts");
                engine
                    .set_liquidity(&asset, liquidity_usd, liq_observed_at)
                    .await;
            }
            // A price tick carries `value_usd`. When it's absent (a liquidity-
            // only tokens.xyz tick) there's nothing more to do — returning Ok
            // avoids a spurious "missing key" error that otherwise fires
            // handle_message-failed → Sentry on EVERY liquidity tick (~14/min).
            let Some(value_usd) = parse_decimal_opt(&value, "value_usd") else {
                return Ok(());
            };
            let observed_at = observed_at_or_now(&value, "ts");
            // Independent-reference gate (ADR-0047): a print that diverges from the
            // reference is rejected BEFORE it can touch the market leg or the EWMA.
            // A run of them marks the leg dark (UNKNOWN) on the last ACCEPTED value.
            if engine.reference_rejects(&asset, value_usd).await {
                metrics::counter!(
                    "pegana_engine_market_rejected_total",
                    "asset" => asset.clone(),
                    "reason" => "reference_divergence",
                )
                .increment(1);
                let streak = engine.note_rejection(&asset).await;
                if streak >= REFERENCE_REJECTS_BEFORE_DARK
                    && engine
                        .mark_market_unavailable_reason(
                            &asset,
                            pegana_methodology::STATE_REASON_MARKET_REFERENCE_DIVERGENCE,
                        )
                        .await
                {
                    try_recompute(engine, pg, redis, &asset, alpha, commit_ctx).await?;
                }
                return Ok(());
            }
            engine.clear_rejection(&asset).await;
            engine.set_market(&asset, value_usd, observed_at).await;
            engine
                .set_market_sized(
                    &asset,
                    value.get("sized").and_then(|v| v.as_bool()) == Some(true),
                )
                .await;
            // SOL-numeraire quotes carry `value_sol` (rate in SOL terms).
            // LST recompute will prefer this if Sanctum has also published
            // an intrinsic_sol — cancels the pyth(SOL/USD) multiplier.
            if let Some(value_sol) = parse_decimal_opt(&value, "value_sol") {
                engine.set_market_sol(&asset, value_sol, observed_at).await;
            }
            // For non-LST/non-Hylo assets, derive intrinsic from config if missing.
            if let Some(derived) = engine.derive_intrinsic(&asset).await {
                engine.set_intrinsic(&asset, derived, observed_at).await;
            }
            try_recompute(engine, pg, redis, &asset, alpha, commit_ctx).await
        }
        _ => Ok(()),
    }
}

fn parse_decimal(v: &serde_json::Value, key: &str) -> Result<Decimal> {
    let s = v.get(key).context("missing key")?;
    if let Some(n) = s.as_f64() {
        return Decimal::from_f64_retain(n).context("f64→Decimal");
    }
    if let Some(s) = s.as_str() {
        return s.parse().context("str→Decimal");
    }
    if let Some(n) = s.as_i64() {
        return Ok(Decimal::from(n));
    }
    anyhow::bail!("unsupported value type for {key}")
}

fn parse_decimal_opt(v: &serde_json::Value, key: &str) -> Option<Decimal> {
    parse_decimal(v, key).ok()
}

fn observed_at_or_now(v: &serde_json::Value, key: &str) -> DateTime<Utc> {
    match parse_timestamp(v, key) {
        Ok(observed_at) => observed_at,
        Err(_) => {
            warn!(
                key,
                "envelope missing/invalid observation ts; using receive-time"
            );
            Utc::now()
        }
    }
}

fn parse_timestamp(v: &serde_json::Value, key: &str) -> Result<DateTime<Utc>> {
    let s = v.get(key).context("missing timestamp")?;
    if let Some(s) = s.as_str() {
        return DateTime::parse_from_rfc3339(s)
            .map(|d| d.with_timezone(&Utc))
            .with_context(|| format!("parse {key} timestamp"));
    }
    anyhow::bail!("unsupported timestamp type for {key}")
}

/// Egress gate (mirrors dispatcher `webhook_queries::asset_is_monitoring_only`):
/// is `asset` flagged `monitoring_only` in the catalog? Reads the same DB
/// metadata (migration 0048) the API + dispatcher use, so all three agree on
/// the set. Used to keep an uncalibrated / provisional asset's high-severity
/// transition from being anchored on-chain (a permanent, public SPL-memo
/// receipt). Returns `false` (commit) when the asset row is absent.
async fn asset_is_monitoring_only(pg: &sqlx::PgPool, asset: &str) -> anyhow::Result<bool> {
    let flag: Option<bool> = sqlx::query_scalar(
        "SELECT COALESCE((metadata->>'monitoring_only')::boolean, FALSE) \
         FROM assets WHERE symbol = $1",
    )
    .bind(asset)
    .fetch_optional(pg)
    .await?;
    Ok(flag.unwrap_or(false))
}

/// Intrinsic-liveness gate (ADR-0038) signal read: is `asset`'s backing flagged
/// stale in the `intrinsic_liveness` table (migration 0068), written by the
/// indexer's `lst_directory_audit` (sanctum_lst `flags.stale`) + `spl_stake_pool`
/// (epoch-lag) + `hylo` (hyUSD/xSOL total_sol_cache epoch-lag)? FRESHNESS-guarded:
/// a row older than `freshness_secs` is treated
/// as absent (fail-open — a dead liveness SOURCE must not force UNKNOWN; the
/// engine's own staleness gate already handles a dead intrinsic). Returns
/// `false` when the asset has no row, the row is stale-by-age, or on any DB
/// error — the gate never fails a verdict CLOSED on missing liveness data. Only
/// called when the gate is enabled, so it adds zero load while DISABLED.
async fn intrinsic_backing_is_stale(pg: &sqlx::PgPool, asset: &str, freshness_secs: i64) -> bool {
    let row: Result<Option<bool>, _> = sqlx::query_scalar(
        "SELECT stale FROM intrinsic_liveness \
         WHERE asset = $1 AND updated_at > now() - make_interval(secs => $2)",
    )
    .bind(asset)
    .bind(freshness_secs as f64)
    .fetch_optional(pg)
    .await;
    match row {
        Ok(v) => v.unwrap_or(false),
        Err(e) => {
            warn!(%asset, error = %e, "intrinsic_liveness read failed — treating as not-stale (fail-open)");
            false
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn try_recompute(
    engine: &Arc<EngineState>,
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    asset: &str,
    alpha: Decimal,
    commit_ctx: Option<&Arc<onchain_commit::CommitContext>>,
) -> Result<()> {
    let timer = std::time::Instant::now();
    let asset_cfg = match engine.asset_config(asset) {
        Some(a) => a,
        None => {
            debug!(%asset, "unknown asset · ignored");
            return Ok(());
        }
    };

    let (intrinsic, market) = match engine.snapshot(asset).await {
        Some((i, m)) => (i, m),
        None => return Ok(()),
    };

    // Compute discount. For LST class we prefer the SOL-denominated path
    // when both sides have published a SOL value: intrinsic_usd and
    // market_usd are both `pyth(SOL/USD) × …` and Sanctum vs Jupiter may
    // have cached different SOL/USD snapshots — computing in SOL cancels
    // the multiplier. Stables / yield / FX assets stay on the USD path
    // because the USD value IS the invariant for those.
    // Short-circuit the SOL-path lookup for non-LST classes — they never
    // consume the i_sol/m_sol values inside compute_discount. Avoids an
    // unnecessary RwLock read on the asset's runtime cache per tick.
    let (i_sol_opt, m_sol_opt) = if matches!(asset_cfg.class, AssetClass::Lst) {
        match engine.snapshot_sol(asset).await {
            Some((i, m)) => (Some(i), Some(m)),
            None => (None, None),
        }
    } else {
        (None, None)
    };
    let discount_raw = match compute_discount(
        intrinsic,
        market,
        i_sol_opt,
        m_sol_opt,
        asset_cfg.class,
    ) {
        Some(d) => d,
        None => {
            // H8: a zero/absent intrinsic yields no discount. Skip the recompute
            // entirely (before the EWMA) — never let missing data become a
            // discount = 0 that the state machine reads as a confirmed healthy peg.
            warn!(%asset, "intrinsic zero/absent — skipping recompute (no peg confirmation on missing data)");
            metrics::counter!(
                "pegana_engine_intrinsic_unavailable_total",
                "asset" => asset.to_string(),
            )
            .increment(1);
            return Ok(());
        }
    };

    // Anomaly clamp — a single bad upstream sample (stale Pyth tick, empty
    // Jupiter route, degenerate Hylo NAV edge) can produce a `discount_raw`
    // many orders of magnitude beyond anything economically possible. Feeding
    // it into the EWMA contaminates the smoothed value for ~7 buckets (α=0.3),
    // which historically painted assets like xSOL with phantom "CRITICAL
    // DEPEG 1160000%" headlines for ~10 minutes after a 1-second glitch.
    //
    // Strategy when the sample is implausible: log + bump a counter + return
    // early. The previous EWMA stays put; the next sane sample resumes the
    // pipeline. No publish, no alert — we never propagate the lie.
    if !is_plausible_discount_sample(discount_raw) {
        warn!(
            %asset,
            class = asset_class_label(asset_cfg.class),
            discount_raw = %discount_raw,
            intrinsic = %intrinsic,
            market = %market,
            "implausible discount sample — skipping EWMA update to protect the average"
        );
        metrics::counter!(
            "pegana_engine_discount_clamped_total",
            "asset" => asset.to_string(),
            "class" => asset_class_label(asset_cfg.class).to_string(),
        )
        .increment(1);
        return Ok(());
    }

    // GAP-1 (schema v2 fix): capture the pre-EWMA smoothed value BEFORE
    // `apply_ewma` overwrites `g.ewma_discount`. `previous_ewma` returns
    // `g.ewma_discount` directly — reading it AFTER apply_ewma would freeze
    // the NEW smoothed value rather than the prior that seeded this tick.
    let ewma_prev_frozen = engine.previous_ewma(asset).await;

    let new_smooth = match engine.apply_ewma(asset, discount_raw, alpha).await {
        Some(v) => v,
        None => {
            // Unreachable in practice: discount_raw already passed the
            // plausibility gate above (|d| < 1) and ewma_discount is itself
            // always a prior output of this same bounded function, so the
            // convex combination can never overflow. Kept as a typed error
            // (not a panic) because apply_ewma_pure is shared with `rederive`,
            // where the equivalent inputs are untrusted and unbounded.
            warn!(%asset, "EWMA overflow — skipping recompute (prior state preserved)");
            metrics::counter!(
                "pegana_engine_ewma_overflow_total",
                "asset" => asset.to_string(),
            )
            .increment(1);
            return Ok(());
        }
    };

    // Market-confirmation gates (ADR-0047), all default OFF, evaluated BEFORE
    // classification so an unconfirmed premium is capped at the CANDIDATE stage
    // (it never matures in the FSM). A sub-floor leg or an expired band hold goes
    // through the shared UNKNOWN override as an unusable (dark) leg. A divergent
    // reference print is rejected at ingest, before the EWMA (see handle_message).
    // CR assets (hyUSD) are exempt.
    let gate_threshold_kind =
        if matches!(asset_cfg.class, AssetClass::StableCdp) && asset == "hyUSD" {
            "cr"
        } else {
            "bps"
        };
    let liq_fresh = engine
        .liquidity_usd_fresh(asset, engine.depth_gate_freshness_secs())
        .await;
    let depth_below_floor = depth_gate_fires(liq_fresh, engine.depth_gate_floor_usd());
    let seed_state = engine.last_state(asset).await;
    let gates = evaluate_market_confirmation(
        engine,
        asset,
        asset_cfg,
        MarketLeg {
            intrinsic,
            smooth: new_smooth,
        },
        gate_threshold_kind,
        depth_below_floor,
        seed_state,
    )
    .await;
    let premium_unconfirmed = gates.premium_unconfirmed;

    // Determine state by class.
    let (new_state, threshold_kind) = if matches!(asset_cfg.class, AssetClass::StableCdp)
        && asset == "hyUSD"
    {
        // H2: a failed/absent CR read must NOT be synthesized into CR = 1.0
        // (≈100% collateralized), which `state_for_cr` reads as a
        // CRITICAL/BlackSwan-grade undercollateralization and would fire a
        // FALSE alarm. Missing data is not confirming data: skip this tick
        // and preserve the previously-published state. The discount EWMA was
        // already folded from a valid sample above, so the running average
        // stays correct — we simply don't publish a state we cannot derive.
        let cr = match engine.hyusd_cr().await {
            Some(cr) => cr,
            None => {
                warn!(%asset, "hyUSD collateral ratio unavailable — skipping recompute (prior state preserved)");
                metrics::counter!(
                    "pegana_engine_cr_unavailable_total",
                    "asset" => asset.to_string(),
                )
                .increment(1);
                return Ok(());
            }
        };
        let thresholds = asset_cfg
            .thresholds
            .thresholds_cr
            .as_ref()
            .context("hyUSD missing thresholds_cr")?;
        // Magnitude deadband on the CR (ADR-0023): hyUSD's collateral ratio
        // sits a few pp above its drift band and oracle jitter clips the
        // threshold, flapping PEGGED↔DRIFT. Escalate immediately (a dropping CR
        // is worsening), relax only once CR clears the deadband-raised exit
        // band — the CR analog of the spread path's classify_with_hysteresis.
        // The time-hysteresis (transition() below) still applies on top.
        let current_state = engine.last_state(asset).await;
        let s = classify_cr_with_hysteresis(cr, thresholds, current_state, CR_DEADBAND_PCT);
        (s, "cr")
    } else {
        let thresholds = asset_cfg
            .thresholds
            .thresholds_bps
            .as_ref()
            .context("asset missing thresholds_bps")?;
        // Direction-aware + magnitude-hysteresis classification:
        //  - direction-aware: yield-bearing stables AND LSTs only alert on the
        //    discount side (market < NAV/intrinsic); a premium normalizes to
        //    PEGGED (demand pressure, not stress).
        //  - deadband: escalate at the normal threshold but only relax once the
        //    smoothed discount clears `threshold × (1-DEADBAND_PCT%)`, so a
        //    discount oscillating around a threshold doesn't flap.
        // The committed state seeds the deadband; the engine's time-hysteresis
        // (transition() below) still applies on top.
        let current_state = engine.last_state(asset).await;
        let s = classify_with_hysteresis(
            asset_cfg.class,
            new_smooth,
            thresholds,
            current_state,
            DEADBAND_PCT,
        );
        (s, "bps")
    };
    let confirmed_candidate = pegana_methodology::confirm_premium_candidate(
        asset_cfg.class,
        new_smooth,
        seed_state,
        premium_unconfirmed,
        gates.premium_cap,
        new_state,
    );
    if confirmed_candidate != new_state {
        metrics::counter!(
            "pegana_engine_premium_unconfirmed_total",
            "asset" => asset.to_string(),
            "action" => if pegana_methodology::is_direction_sensitive(asset_cfg.class) {
                "held"
            } else {
                "capped"
            },
        )
        .increment(1);
    }
    let new_state = confirmed_candidate;

    // Apply hysteresis.
    let now = Utc::now();

    // GAP-2 + GAP-3 (schema v2 fix): capture the pre-transition FSM state
    // BEFORE `transition` mutates `g.candidate_state`, `g.candidate_since`, and
    // `g.last_state`. Reading them AFTER transition would freeze post-mutation
    // values, making re-derivation impossible.
    //   - GAP-2: candidate_state / candidate_since are written by transition().
    //   - GAP-3: previous_state was previously frozen as `prev_opt.unwrap_or(Unknown)`
    //     (= last_published_state) but transition_decide consumes g.last_state.
    //     They diverge on cold-start: last_state = Pegged (default), while
    //     last_published_state = None → prev_opt.unwrap_or(Unknown) = Unknown.
    //     Freezing g.last_state here corrects that divergence.
    //
    // BYTE-EXACTNESS INVARIANT (do not break): `fsm_prev_state_frozen` read here
    // must equal the `current_last_state` that `transition()` reads internally on
    // the next line — the receipt records the former, `rederive`/CLI replay it, and
    // the golden e2e proves the equality. That holds ONLY because recomputes are
    // SERIAL: every `try_recompute` is `.await`ed by the single source-event
    // consumer (never `tokio::spawn`ed), and no background worker mutates the FSM
    // state, so nothing can write `g.last_state` between this freeze and the
    // `transition()` read. If recompute is ever parallelised per asset, this
    // freeze→transition pair MUST move under one held lock (the deferred
    // `state.tick()` extraction) or cold-start receipts will drift.
    let candidate_state_frozen = engine.candidate_state(asset).await;
    let candidate_since_frozen = engine.candidate_since(asset).await;
    let fsm_prev_state_frozen = engine.last_state(asset).await;

    let mut final_state = engine
        .transition(asset, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
        .await;

    // Collect the cached Pyth entries this asset depends on EVERY tick (not
    // only inside the `should_emit`-gated receipt-building branch below) —
    // the Pyth confidence-gate (ADR-0032) must run on every recompute, same
    // as premium/discount sanity, not only on alert-worthy ticks. Reused
    // below both for the gate check and (cloned) for the frozen receipt.
    let pyth_entries = without_cancelled_numeraire(
        collect_pyth_entries_for_asset(engine, asset_cfg).await,
        asset_cfg,
        engine.pyth_gate_excludes_cancelled_numeraire()
            && pegana_methodology::uses_sol_path(asset_cfg.class, i_sol_opt, m_sol_opt),
    );

    // Determine the confidence label from any Pyth feed this asset depends on.
    // Non-Pyth assets stay "high" (no signal to downgrade with). When multiple
    // Pyth feeds contribute (rare), take the strictest label.
    let mut confidence_label = pyth_confidence_for_asset(engine, asset_cfg).await;

    // Phase-1 depth gate (ADR-0026, narrow confidence-cap-only slice). A thin,
    // FRESH, real (has_market=true) tokens.xyz market is unreliable as the
    // market leg even when the Pyth cross-check itself is tight — cap
    // confidence high→medium. Never forces UNKNOWN (that extreme is
    // explicitly deferred). `strictest` guarantees this can only DEGRADE
    // confidence, same as the no-Pyth-feed cap immediately above and the
    // sanity overrides below. Ships DISABLED (`depth_gate_floor_usd() == 0`)
    // until the founder runs the GO/NO-GO (docs/operations/depth-gate-phase1-decision.md).
    if depth_below_floor {
        confidence_label = strictest(confidence_label, "medium");
        metrics::counter!(
            "pegana_engine_depth_gate_capped_total",
            "asset" => asset.to_string(),
        )
        .increment(1);
    }

    // Falling-intrinsic flag (A4): a NAV/backing that dropped beyond the threshold
    // inside the window is flagged even when the market follows it down (no
    // discount opens). Confidence only; the peg state is untouched.
    let intrinsic_drop = engine.intrinsic_drop_flag(asset).await;
    if let Some(bps) = intrinsic_drop {
        confidence_label = strictest(confidence_label, "low");
        // Edge-triggered: one log + one counter increment per crossing, so
        // `increase()` alert rules count episodes rather than recomputes.
        if engine.take_intrinsic_drop_edge(asset).await {
            warn!(%asset, drop_bps = bps, "intrinsic fell beyond the alert threshold within the window");
            metrics::counter!(
                "pegana_engine_intrinsic_drop_total",
                "asset" => asset.to_string(),
            )
            .increment(1);
        }
    }

    // NAV-sanity override (P1, methodology 0.4.0). A premium beyond
    // NAV_PREMIUM_SANITY_BPS on a direction-sensitive class is not demand
    // pressure — it means the NAV/intrinsic anchor is broken (sHYUSD: market
    // ~+30% over a thin-Jupiter NAV print). The ADR-0021 premium→PEGGED carve-out
    // would otherwise mask it as a confident PEGGED off a garbage anchor. Publish
    // honest-dark UNKNOWN instead — the same behaviour the staleness gate applies
    // to absent feeds. force_unknown keeps last_state/candidate in sync with the
    // published UNKNOWN (both classify + transition treat UNKNOWN as severity-0,
    // so the asset resumes via the cold-start path once the anchor recovers).
    // NOTE: magnitude check on a single smoothed sample — NOT the discount-
    // constancy freeze detector rejected in ADR-0024.
    let mut state_reason: Option<String> = None;

    // Intrinsic-liveness gate (ADR-0038). Read the frozen "backing stale" signal
    // ONLY when the gate is enabled — DISABLED (default) → `false` → no DB read,
    // no override, and the field is omitted from the receipt hash (byte-exact).
    let intrinsic_stale = if engine.intrinsic_liveness_gate_enabled() {
        intrinsic_backing_is_stale(pg, asset, engine.intrinsic_liveness_freshness_secs()).await
    } else {
        false
    };

    // True only when a gate marked the market leg unusable: an indexer dark report
    // (DARK_MARKET_GATE_ENABLED), a run of reference-divergent prints, a sub-floor
    // leg or an expired premium hold. With every gate off it is `false` → omitted
    // from the receipt hash.
    let engine_dark = engine.market_is_unavailable(asset).await;
    let engine_dark_reason = engine.market_dark_reason(asset).await;
    let market_unavailable = (engine_dark || gates.dark_reason.is_some())
        && pegana_methodology::market_unavailable_applies(threshold_kind);

    // Honest-dark UNKNOWN override + confirmed-BLACK_SWAN carve-out. The PUBLISHED
    // state AND which gate fired both come from the SINGLE shared
    // `override_final_state_attributed` (methodology) — the exact function whose
    // state-only wrapper `rederive` and the xtask backtest runner also call — so the
    // three implementations agree BY CONSTRUCTION and cannot drift (this drifted
    // twice before centralization: the golden re-baseline debt and the BLACK_SWAN
    // carve-out gap). The engine only LAYERS side effects (force_unknown / metrics /
    // state_reason) keyed off the returned `OverrideReason`; it never re-derives the
    // gate order. force_unknown keeps last_state/candidate in sync with the published
    // UNKNOWN so the asset resumes via the cold-start path once the anchor recovers.
    let (overridden_state, override_reason) = override_final_state_attributed(
        asset_cfg.class,
        new_smooth,
        &pyth_entries,
        intrinsic_stale,
        market_unavailable,
        final_state,
    );
    if let Some(reason) = override_reason {
        // A gate forced UNKNOWN. The confirmed-BLACK_SWAN carve-out is already applied
        // inside the shared fn (a maturing/confirmed BlackSwan yields `None` and never
        // reaches here), so `overridden_state` is always UNKNOWN in this arm.
        final_state = overridden_state;
        confidence_label = "unknown";
        match reason {
            OverrideReason::PremiumSanity => {
                // Premium beyond the NAV-sanity bound: the intrinsic anchor is broken
                // (market >> NAV, e.g. sHYUSD ~+30% over a thin-Jupiter NAV print). The
                // ADR-0021 premium→PEGGED carve-out would otherwise mask it as a
                // confident PEGGED off a garbage anchor. Unconditional force_unknown — a
                // premium cannot be a discount-side BlackSwan candidate, nothing to keep.
                state_reason = Some(pegana_methodology::STATE_REASON_PREMIUM_SANITY.to_string());
                engine.force_unknown(asset).await;
                warn!(
                    %asset,
                    class = asset_class_label(asset_cfg.class),
                    smoothed_discount = %new_smooth,
                    "premium beyond NAV-sanity bound — intrinsic anchor suspect; publishing UNKNOWN (not a masked PEGGED)"
                );
                metrics::counter!(
                    "pegana_engine_nav_sanity_unknown_total",
                    "asset" => asset.to_string(),
                    "class" => asset_class_label(asset_cfg.class).to_string(),
                    "side" => "premium",
                )
                .increment(1);
            }
            OverrideReason::DiscountSanity => {
                // Discount beyond the NAV-sanity bound, not (yet) a confirmed BLACK_SWAN.
                // A flat magnitude cutoff cannot tell a garbage-HIGH NAV print apart from
                // a real catastrophic collapse — both live in the 30–99% band — so the
                // DISTINGUISHER is PERSISTENCE (the confirm window), not magnitude.
                //
                // CRITICAL: when the raw candidate IS BLACK_SWAN (a real collapse still
                // maturing) we must NOT `force_unknown` — that wipes `candidate_since`
                // every tick, so the confirm window never completes and a genuine >30%
                // collapse is masked as UNKNOWN forever (the NAV-sanity ↔ BLACK_SWAN
                // collision fixed in ADR-0039). Leave the maturing candidate intact; once
                // it confirms, `final_state` becomes BlackSwan, the shared fn's carve-out
                // returns `None`, and the real catastrophic depeg is finally published.
                state_reason = Some(pegana_methodology::STATE_REASON_DISCOUNT_SANITY.to_string());
                if new_state != PegState::BlackSwan {
                    engine.force_unknown(asset).await;
                }
                warn!(
                    %asset,
                    class = asset_class_label(asset_cfg.class),
                    smoothed_discount = %new_smooth,
                    "discount beyond NAV-sanity bound — intrinsic anchor suspect (garbage-HIGH NAV) or a real collapse still confirming; publishing UNKNOWN pending the confirm window"
                );
                metrics::counter!(
                    "pegana_engine_nav_sanity_unknown_total",
                    "asset" => asset.to_string(),
                    "class" => asset_class_label(asset_cfg.class).to_string(),
                    "side" => "discount",
                )
                .increment(1);
            }
            OverrideReason::PythConfidence => {
                // Pyth confidence-gate (ADR-0032). YIELDS to a confirmed BLACK_SWAN and
                // preserves a maturing candidate (carve-out inside the shared fn),
                // extended here 2026-07-18: a WIDE Pyth confidence interval is the
                // DOCUMENTED signature of high volatility (Pyth best-practices), i.e.
                // CORRELATED with a real crash. Left unconditional it re-masked a
                // confirmed collapse as UNKNOWN forever via the shared numéraire feed's
                // confidence widening — the exact bug ADR-0039 closed on the discount side.
                state_reason =
                    Some(pegana_methodology::STATE_REASON_PYTH_CONFIDENCE_GATE.to_string());
                if new_state != PegState::BlackSwan {
                    engine.force_unknown(asset).await;
                }
                warn!(
                    %asset,
                    class = asset_class_label(asset_cfg.class),
                    "Pyth confidence interval too wide relative to price on a required feed — oracle read suspect; publishing UNKNOWN (not trusting a possibly-wrong intrinsic/market leg)"
                );
                metrics::counter!(
                    "pegana_engine_pyth_confidence_gate_unknown_total",
                    "asset" => asset.to_string(),
                    "class" => asset_class_label(asset_cfg.class).to_string(),
                )
                .increment(1);
            }
            OverrideReason::MarketUnavailable => {
                // The market source reported consecutive missing quotes. YIELDS to a
                // confirmed BLACK_SWAN and preserves a maturing candidate (ADR-0039),
                // like the other feed-quality gates.
                state_reason = Some(
                    match (engine_dark_reason, gates.dark_reason) {
                        (Some(reason), _) => reason,
                        (None, Some(reason)) if !engine_dark => reason,
                        _ => pegana_methodology::STATE_REASON_MARKET_UNAVAILABLE,
                    }
                    .to_string(),
                );
                if new_state != PegState::BlackSwan {
                    engine.force_unknown(asset).await;
                }
                warn!(
                    %asset,
                    class = asset_class_label(asset_cfg.class),
                    "market source reported no fresh quote — last-known market leg must not read as a peg; publishing UNKNOWN"
                );
                metrics::counter!(
                    "pegana_engine_market_unavailable_unknown_total",
                    "asset" => asset.to_string(),
                    "class" => asset_class_label(asset_cfg.class).to_string(),
                )
                .increment(1);
            }
            OverrideReason::IntrinsicLiveness => {
                // Intrinsic-liveness gate (ADR-0038; reachable only when enabled). YIELDS
                // to a confirmed BLACK_SWAN + preserves a maturing candidate — a stale
                // intrinsic must not erase a sustained, hysteresis-confirmed collapse.
                state_reason =
                    Some(pegana_methodology::STATE_REASON_INTRINSIC_LIVENESS.to_string());
                if new_state != PegState::BlackSwan {
                    engine.force_unknown(asset).await;
                }
                warn!(
                    %asset,
                    class = asset_class_label(asset_cfg.class),
                    "intrinsic backing flagged stale (directory `stale`, or a stalled SPL \
                     stake-pool crank) — a frozen-but-served NAV must not read as a \
                     confident peg; publishing UNKNOWN (ADR-0038)"
                );
                metrics::counter!(
                    "pegana_engine_intrinsic_liveness_unknown_total",
                    "asset" => asset.to_string(),
                    "class" => asset_class_label(asset_cfg.class).to_string(),
                )
                .increment(1);
            }
        }
    }

    // Observability (ADR-0039, broadened 2026-07-18): a hysteresis-confirmed
    // BLACK_SWAN that survived a gate which would otherwise have forced UNKNOWN — a
    // real catastrophic collapse the pre-fix code masked. Now covers ALL FOUR
    // yielding gates (premium-sanity, discount-sanity, Pyth confidence, intrinsic-
    // liveness), since any of them can fire during the market stress (or a garbage
    // NAV print) that co-occurs with the collapse. Kept distinct from the
    // *_unknown_total counters so dashboards tell a masked bad reading apart from a
    // surfaced real catastrophe.
    if final_state == PegState::BlackSwan
        && (premium_sanity_violated(asset_cfg.class, new_smooth)
            || discount_sanity_violated(asset_cfg.class, new_smooth)
            || pyth_confidence_gate_violated(&pyth_entries)
            || intrinsic_liveness_gate_violated(intrinsic_stale)
            || market_unavailable)
    {
        metrics::counter!(
            "pegana_engine_nav_sanity_blackswan_confirmed_total",
            "asset" => asset.to_string(),
        )
        .increment(1);
    }

    // Spec 03b: compute once here so BOTH the every-tick snapshot (persist_discount)
    // and the on-transition alert event carry the same band-duration/sustained.
    // Placed after transition()/force_unknown() so band_since/last_state are final.
    let (band_dur_secs, sustained) = engine.band_duration(asset, now).await;

    // Persist.
    let ts = now;
    persist_discount(
        pg,
        asset,
        discount_raw,
        new_smooth,
        final_state,
        intrinsic,
        market,
        ts,
        threshold_kind,
        confidence_label,
        band_dur_secs,
        sustained,
        state_reason.as_deref(),
    )
    .await
    .inspect_err(|_| count_persist_failure(asset, "snapshot"))?;

    // Fan out to API/WS clients (every recompute, not only on transition).
    let market_observed_at = engine.market_observed_at(asset).await;
    let dark_gate = engine.dark_market_gate_enabled();
    publish_discount(
        redis,
        asset,
        final_state,
        new_smooth,
        (intrinsic, market),
        ts,
        dark_gate.then_some(market_observed_at),
    )
    .await
    .inspect_err(|_| count_persist_failure(asset, "publish"))?;

    // Step 1 observability — end-to-end signal latency: the newest market
    // observation behind THIS verdict → the moment it's fanned out. Pure
    // metric, zero effect on classification/calibration. Skips assets with no
    // market leg yet (intrinsic-only cold start). Staleness of a dead source
    // shows up honestly in the tail.
    if let Some(observed_at) = engine.market_observed_at(asset).await {
        metrics::histogram!(
            "pegana_signal_latency_seconds",
            "class" => asset_class_label(asset_cfg.class).to_string(),
        )
        .record(signal_latency_secs(ts, observed_at));
    }

    // Emit alert on either:
    //   - a state transition (prev != final_state), OR
    //   - a cold start where the very first observed state is non-PEGGED.
    //
    // The cold-start branch closes a gap where, after an engine restart,
    // an asset that's already drifting would silently never alert the
    // user because `last_published_state` is None on first recompute.
    let prev_opt = engine.last_published_state(asset).await;
    let should_emit = match prev_opt {
        Some(prev) => prev != final_state,
        None => !matches!(final_state, PegState::Pegged | PegState::Unknown),
    };
    if should_emit {
        let prev = prev_opt.unwrap_or(PegState::Unknown);

        // ===== Build receipt material =====
        // The receipt freezes everything an offline replay needs to recompute
        // the same verdict: cached snapshot inputs, hysteresis state, EWMA
        // prior, thresholds, Pyth tick values. Wave 3B.3 — the audit row gets
        // written by push_alert as a second sqlx call after `alerts`.
        // Schema v2: all frozen inputs are captured BEFORE their respective
        // mutations so re-derivation is exact. See GAP-1/2/3 capture locals above.
        //   ewma_prev_frozen  — pre-apply_ewma   (GAP-1)
        //   candidate_*_frozen — pre-transition   (GAP-2)
        //   fsm_prev_state_frozen — pre-transition g.last_state (GAP-3)
        let inputs_frozen = MethInputsFrozen {
            asset: asset.to_string(),
            class: asset_cfg.class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: i_sol_opt,
            market_sol: m_sol_opt,
            ewma_prev: ewma_prev_frozen,
            hyusd_cr: engine.hyusd_cr().await,
            previous_state: fsm_prev_state_frozen,
            candidate_state: candidate_state_frozen,
            candidate_since: candidate_since_frozen,
            thresholds: resolved_thresholds_map(asset_cfg, threshold_kind),
            threshold_kind: threshold_kind.to_string(),
            pyth_entries: pyth_entries.clone(),
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale,
            market_unavailable,
            premium_unconfirmed: premium_unconfirmed
                && pegana_methodology::market_unavailable_applies(threshold_kind),
            premium_cap: gates.premium_cap.filter(|_| {
                premium_unconfirmed
                    && pegana_methodology::market_unavailable_applies(threshold_kind)
            }),
        };
        let computed = Computed {
            discount_raw,
            discount_smooth: new_smooth,
            final_state,
            confidence_label: confidence_label.to_string(),
        };

        // Canonical hashes — RFC 8785 JCS for cross-arch determinism (replay
        // CLI must reproduce these byte-for-byte). H10: a hash serializer
        // failure is a HARD failure of the receipt path — drop the receipt
        // loudly (Sentry + counter + error) rather than emitting an all-zero
        // sentinel. A sentinel hash would otherwise be persisted, served via the
        // API, AND committed on-chain, making a broken receipt indistinguishable
        // from a real one and polluting the immutable audit ledger. Zero rows on
        // failure is correct; a fabricated hash never is. Hashing ~never fails;
        // if it does, the next tick retries.
        let assets_canonical = engine.assets_toml_canonical().to_string();
        let assets_hash = canonical_assets_hash(&assets_canonical)
            .map(hex_sha256)
            .map_err(|e| {
                error!(
                    ?e,
                    "assets hash failure — dropping receipt (no sentinel emitted)"
                );
                sentry::capture_message(
                    &format!("pegana assets_toml_sha256 failure (receipt dropped): {e:?}"),
                    sentry::Level::Error,
                );
                metrics::counter!("pegana_receipt_hash_fallback_total", "kind" => "assets")
                    .increment(1);
                anyhow::anyhow!("assets_toml_sha256 failed, receipt dropped: {e:?}")
            })?;
        let receipt_hash = canonical_receipt_hash(
            methodology_version(),
            methodology_git_sha(),
            &assets_canonical,
            &inputs_frozen,
            &computed,
        )
        .map(hex_sha256)
        .map_err(|e| {
            error!(
                ?e,
                "receipt hash failure — dropping receipt (no sentinel emitted)"
            );
            sentry::capture_message(
                &format!("pegana receipt_sha256 failure (receipt dropped): {e:?}"),
                sentry::Level::Error,
            );
            metrics::counter!("pegana_receipt_hash_fallback_total", "kind" => "receipt")
                .increment(1);
            anyhow::anyhow!("receipt_sha256 failed, receipt dropped: {e:?}")
        })?;

        // Replay artifact: full receipt struct, persisted for EVERY alert
        // state (PEGGED-exit Drift, Depeg, Critical, BlackSwan, and any
        // recovery transition back to PEGGED). Originally gated to
        // Depeg/Critical/BlackSwan only — the assets_toml_canonical field
        // makes each row ~50KB, and the original concern was that Drift is
        // high-volume and would explode the alert_evidence table.
        //
        // Why we now write it for every state: the Trust Layer's
        // verifiability claim ("every alert is replayable") only holds if
        // pegana-replay can reconstruct from any audit URL — including the
        // Drift alerts that dominate the calibration window. With the
        // gate on, pegana-replay returns 404 on every receipt in the public
        // /audit feed today.
        //
        // DB-cost mitigation queued as Sub-project Z (assets_toml dedup):
        // move assets_toml_canonical into a separate snapshot table keyed by
        // assets_toml_sha256, store the hash in alert_evidence instead of
        // the full TOML body. See trust-layer-followups roadmap.
        let replay_artifact = Some(Receipt {
            schema_version: "v2".into(),
            methodology_version: methodology_version().to_string(),
            methodology_git_sha: methodology_git_sha().map(str::to_string),
            assets_toml_canonical: assets_canonical.clone(),
            inputs_frozen: inputs_frozen.clone(),
            expected_computed: computed.clone(),
            expected_receipt_sha256: receipt_hash.clone(),
            state_reason: state_reason.clone(),
        });

        // Liquidation floor for CDP stables (black_swan threshold, in
        // percentage points) so the bot can anchor the bare CR — a naked
        // "131%" tells the reader nothing without a reference. Same dual-key
        // tolerance as state_for_cr (assets.toml uses `black_swan`, the DB
        // JSONB uses `cr_black_swan`). None for non-CDP assets → null in the
        // payload; the bot only reads it inside the alert_cdp branch.
        let cr_floor = asset_cfg.thresholds.thresholds_cr.as_ref().map(|t| {
            t.get("black_swan")
                .or_else(|| t.get("cr_black_swan"))
                .copied()
                .unwrap_or(100)
        });

        // Next-worse CR band for the alert UI (CR-driven assets only; None
        // otherwise). Lets the bot show "next: DEPEG at 115% (15pp away)".
        let cr_next = asset_cfg
            .thresholds
            .thresholds_cr
            .as_ref()
            .and_then(|t| next_worse_cr_band(final_state, t));

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
            extra: {
                let mut extra = serde_json::json!({
                "cr": engine.hyusd_cr().await,
                "cr_floor": cr_floor,
                "cr_next_band": cr_next.map(|(b, _)| b),
                "cr_next_at": cr_next.map(|(_, at)| at),
                "confidence": confidence_label.to_string(),
                "cold_start": prev_opt.is_none(),
                // Top-pair USD liquidity from DexScreener (server-only; not in
                // the receipt hash). Null until a DexScreener tick arrives — the
                // 4 DexScreener-priced assets carry it, others stay null. Lays
                // the groundwork for the ADR-0024 depth gate ("observe first").
                "liquidity_usd": engine.liquidity_usd(asset).await,
                "current_state_duration_secs": band_dur_secs,
                "sustained": sustained,
                // SOL-denominated peg view for LSTs. The LST spread is computed
                // in SOL space (1 - market_sol/intrinsic_sol) so the SOL/USD
                // multiplier cancels; the bot renders these so the displayed
                // numbers reconcile with the Spread (the USD prices don't —
                // each carries a different SOL/USD tick). Null for non-LSTs.
                "intrinsic_sol": i_sol_opt,
                "market_sol": m_sol_opt,
                });
                if let Some(bps) = intrinsic_drop {
                    extra["intrinsic_drop_bps"] = serde_json::json!(bps);
                }
                // Additive field, only while the dark-market gate is on.
                if dark_gate {
                    extra["market_observed_at"] =
                        serde_json::json!(market_observed_at.map(|t| wire_ts(&t)));
                }
                extra
            },
            detected_at: ts,
        };

        // Egress gate: a monitoring_only / uncalibrated asset must NOT be
        // anchored on-chain (the SPL-memo receipt is permanent + public) and
        // must not record a commit_status implying a pending anchor. Resolve it
        // once so the receipt's commit_status (via `on_chain_enabled`) and the
        // actual commit below agree. Fail-OPEN on a metadata read error (commit)
        // so a transient DB hiccup never drops a legit calibrated asset's trust
        // anchor; a monitoring_only commit would be undiscoverable anyway (the
        // /v1/audit index + feeds are monitoring_only-gated).
        let monitoring_only = asset_is_monitoring_only(pg, asset).await.unwrap_or(false);
        // A depth verdict can prevent on-chain anchoring of a BLACK_SWAN state
        // when the gate is enabled.
        let thin_black_swan =
            final_state == PegState::BlackSwan && engine.depth_verdict_gate() && depth_below_floor;
        let on_chain_enabled = commit_ctx.is_some() && !monitoring_only && !thin_black_swan;

        push_alert(
            pg,
            redis,
            &event,
            confidence_label,
            methodology_version(),
            methodology_git_sha(),
            &assets_hash,
            &inputs_frozen,
            &computed,
            replay_artifact.as_ref(),
            &receipt_hash,
            on_chain_enabled,
        )
        .await
        .inspect_err(|_| count_persist_failure(asset, "alert"))?;

        // Fire-and-forget on-chain commit for critical alerts. ADR-0004 retry
        // + burst-control + wallet-alarm live inside commit_receipt; if
        // PEGANA_COMMIT_KEYPAIR is unset, commit_ctx is None and the alert
        // still dispatches with commit_status='pending' for a later worker
        // to pick up once a keypair is provisioned.
        if onchain_commit::is_anchorable(final_state) {
            if let Some(ctx) = commit_ctx {
                if monitoring_only {
                    // Egress gate: skip the permanent on-chain anchor for an
                    // uncalibrated/provisional asset (its receipt already records
                    // commit_status='not_applicable' via on_chain_enabled=false).
                    debug!(asset, to = ?final_state, "monitoring_only — skip on-chain commit (egress gate)");
                    metrics::counter!(
                        "pegana_engine_monitoring_commit_skipped_total",
                        "asset" => asset.to_string(),
                    )
                    .increment(1);
                } else {
                    onchain_commit::commit_receipt(
                        ctx.clone(),
                        event.id,
                        methodology_version().to_string(),
                        receipt_hash.clone(),
                    );
                }
            }
        }

        info!(
            asset,
            from = ?prev,
            to = ?final_state,
            discount = %new_smooth,
            evidence_sha256 = %receipt_hash,
            "ALERT emitted"
        );
    }
    match prev_opt {
        Some(prev) if prev != final_state => {
            metrics::gauge!(
                "pegana_engine_asset_state",
                "asset" => asset.to_string(),
                "state" => peg_state_label(prev).to_string(),
            )
            .set(0.0);
        }
        _ => {}
    }
    metrics::gauge!(
        "pegana_engine_asset_state",
        "asset" => asset.to_string(),
        "state" => peg_state_label(final_state).to_string(),
    )
    .set(1.0);
    // Missing run start (new asset, TRUNCATEd cache, pre-backfill row): derive
    // it exactly from history now that this tick's snapshot is persisted,
    // instead of stamping the restart time.
    if engine.state_since(asset).await.is_none() {
        engine.seed_state_since_from_history(pg, asset).await;
    }
    engine.stamp_state_since(asset, final_state, ts).await;
    engine.set_last_published_state(asset, final_state).await;

    // Persist the engine cache so a restart inside the next tick window can
    // resume EWMA + hysteresis where we left off (ADR-0010). Snapshot runs
    // after publish_discount + set_last_published_state so the row reflects
    // the final committed state. Failure here is best-effort: we log + bump
    // a counter, but never abort — losing one snapshot is preferable to
    // dropping an alert that already fired.
    if let Err(e) = engine.snapshot_to_pg(pg, asset).await {
        warn!(asset, ?e, "engine_state_snapshot upsert failed (non-fatal)");
        metrics::counter!(
            "pegana_state_snapshot_failed_total",
            "asset" => asset.to_string(),
            "phase" => "recompute"
        )
        .increment(1);
        // Warning, not Error: a single missed snapshot is non-fatal — the
        // engine keeps publishing, and the next tick will reattempt. But if
        // failures persist, restart determinism (ADR-0010) silently
        // degrades — Sentry surfaces it before the calibration-watch cron
        // catches it (every 5 min).
        sentry::capture_message(
            &format!("pegana engine_state_snapshot upsert failed: asset={asset} err={e:?}"),
            sentry::Level::Warning,
        );
    }

    metrics::histogram!("pegana_engine_recompute_seconds", "asset" => asset.to_string())
        .record(timer.elapsed().as_secs_f64());

    Ok(())
}

/// Resolve which thresholds map applies to this asset for receipt purposes —
/// `cr` for hyUSD (collateral ratio buckets), `bps` for everything else.
/// Returns an empty map if the asset config doesn't declare the relevant
/// thresholds; the caller already validated presence before reaching here.
fn resolved_thresholds_map(
    cfg: &AssetConfig,
    kind: &str,
) -> std::collections::HashMap<String, u32> {
    match kind {
        "cr" => cfg.thresholds.thresholds_cr.clone().unwrap_or_default(),
        _ => cfg.thresholds.thresholds_bps.clone().unwrap_or_default(),
    }
}

/// Every Pyth feed (intrinsic and/or market leg) this asset depends on, as
/// owned `String`s. Shared by `collect_pyth_entries_for_asset` (receipt
/// freezing) and `pyth_confidence_for_asset` (display-label resolution) —
/// both previously built this same list independently; extracted here purely
/// for DRY, zero behavior change.
fn pyth_feeds_for_asset(cfg: &AssetConfig) -> Vec<String> {
    let mut feeds: Vec<String> = Vec::new();
    match &cfg.intrinsic {
        IntrinsicStrategy::PythFxCross { feed, .. }
        | IntrinsicStrategy::PythRedemptionRate { feed } => feeds.push(feed.clone()),
        _ => {}
    }
    if let MarketStrategy::PythSpot { feed } = &cfg.market {
        feeds.push(feed.clone());
    }
    // H3/H4: include the numéraire feed too — a jupiter_usd asset prices its
    // market THROUGH the numéraire's Pyth feed (SOL/USD, USDC/USD, …), a real
    // Pyth dependency both callers need to see.
    if let MarketStrategy::JupiterUsd { numeraire_feed, .. } = &cfg.market {
        feeds.push(numeraire_feed.clone());
    }
    feeds
}

/// On the SOL-denominated path the SOL/USD numeraire multiplier cancels out of
/// the discount, so a wide SOL/USD confidence interval says nothing about the
/// verdict it would otherwise mask. Drop that feed from the gate's inputs; the
/// receipt freezes the filtered set, so `rederive` applies the same gate.
fn without_cancelled_numeraire(
    mut entries: std::collections::HashMap<String, MethPythEntry>,
    cfg: &AssetConfig,
    sol_path: bool,
) -> std::collections::HashMap<String, MethPythEntry> {
    if sol_path {
        if let MarketStrategy::JupiterUsd { numeraire_feed, .. } = &cfg.market {
            entries.remove(numeraire_feed);
        }
    }
    entries
}

/// Collect the cached Pyth entries (price + confidence + publish_time) for
/// every feed this asset depends on. Used to freeze the receipt: replay
/// requires reading the exact tick values the engine consumed at decision
/// time. Stale or missing feeds are simply omitted from the map.
async fn collect_pyth_entries_for_asset(
    engine: &EngineState,
    cfg: &AssetConfig,
) -> std::collections::HashMap<String, MethPythEntry> {
    use std::collections::HashMap;
    let feeds = pyth_feeds_for_asset(cfg);
    let mut map: HashMap<String, MethPythEntry> = HashMap::new();
    for feed in feeds {
        if let Some(entry) = engine.pyth_entry(&feed).await {
            map.insert(
                feed,
                MethPythEntry {
                    price: entry.price,
                    confidence: entry.confidence,
                    publish_time: entry.publish_time,
                },
            );
        }
    }
    map
}

/// Resolve the worst (strictest) Pyth confidence label across every feed this
/// asset depends on. An asset that declares NO Pyth feed has no signal to
/// downgrade with and stays "high". An asset that declares one or more Pyth
/// feeds but where ANY required feed is missing/stale/zero (label `None`)
/// degrades to "unknown" — missing data must not be reported as confidence
/// (hardening H1/H9/H12). "unknown" ranks strictest, so a partially-degraded
/// multi-feed asset also collapses to "unknown".
async fn pyth_confidence_for_asset(engine: &EngineState, cfg: &AssetConfig) -> &'static str {
    let feeds = pyth_feeds_for_asset(cfg);
    if feeds.is_empty() {
        // Confidence gate (P1, methodology 0.4.0). No Pyth feed anywhere means
        // there is NO independent oracle cross-check on this asset's price — a
        // single DEX/quote source stands alone. We cannot assert HIGH off one
        // un-cross-checked source, so cap at MEDIUM.
        // (sHYUSD's broken-anchor case is handled upstream by the NAV-sanity
        // gate, which forces UNKNOWN before this point.)
        return "medium";
    }
    let mut worst = "high";
    for feed in &feeds {
        // A missing/stale/zero feed yields `None` → "unknown": the asset's
        // confidence can only ever degrade here, never get upgraded by absence.
        let label = engine
            .pyth_confidence_label(feed)
            .await
            .unwrap_or("unknown");
        worst = strictest(worst, label);
    }
    worst
}

/// Strictness order: unknown > low > medium > high. The strictest wins, so a
/// degraded ("unknown") or wide ("low") feed can only ever make a verdict look
/// LESS certain, never more.
fn strictest(a: &'static str, b: &'static str) -> &'static str {
    let rank = |s: &str| match s {
        "unknown" => 3,
        "low" => 2,
        "medium" => 1,
        _ => 0,
    };
    if rank(b) > rank(a) {
        b
    } else {
        a
    }
}

/// Phase-1 depth gate (ADR-0026, narrow confidence-cap-only slice). True only
/// for a FRESH, real (`has_market=true`) liquidity reading below `floor`.
/// `None` (never observed / stale / has_market=false) NEVER fires — absence
/// is not a signal (ADR-0026's central rule). `floor <= 0` never fires
/// (disables the gate). Pure + total, unit-tested without an engine.
fn depth_gate_fires(liquidity_usd_fresh: Option<Decimal>, floor: Decimal) -> bool {
    if floor <= Decimal::ZERO {
        return false;
    }
    liquidity_usd_fresh.is_some_and(|l| l < floor)
}

#[allow(clippy::too_many_arguments)]
async fn persist_discount(
    pg: &PgPool,
    asset: &str,
    discount_raw: Decimal,
    discount_smooth: Decimal,
    state: PegState,
    intrinsic_usd: Decimal,
    market_usd: Decimal,
    ts: chrono::DateTime<Utc>,
    threshold_kind: &str,
    confidence: &str,
    band_dur_secs: Option<i64>,
    sustained: bool,
    state_reason: Option<&str>,
) -> Result<()> {
    let state_str = peg_state_label(state);
    sqlx::query(
        r#"
        INSERT INTO discount_snapshots
            (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
             intrinsic_usd, market_usd, extra, ts, state_reason)
        VALUES ($1, $2, $3, NULL, $4::peg_state, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (asset, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(discount_raw)
    .bind(discount_smooth)
    .bind(state_str)
    .bind(confidence)
    .bind(intrinsic_usd)
    .bind(market_usd)
    .bind(serde_json::json!({
        "threshold_kind": threshold_kind,
        "current_state_duration_secs": band_dur_secs,
        "sustained": sustained,
    }))
    .bind(ts)
    .bind(state_reason)
    .execute(pg)
    .await?;
    Ok(())
}

/// Wire timestamp shared with REST (`api-rs::serde_fmt::rfc3339_millis_z`):
/// RFC3339, millisecond precision, `Z` suffix. The WS used to emit chrono's
/// default nanosecond form, so the same tick read differently on WS and REST.
fn wire_ts(t: &chrono::DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Round to the scale of the `discount_snapshots` column REST serves from,
/// with Postgres' NUMERIC rounding (half away from zero), then strip trailing
/// zeros like REST's `dec_norm`. So a WS frame and `/v1/assets` agree on the
/// same tick's value.
fn wire_decimal(v: Decimal, column_scale: u32) -> String {
    v.round_dp_with_strategy(
        column_scale,
        rust_decimal::RoundingStrategy::MidpointAwayFromZero,
    )
    .normalize()
    .to_string()
}

/// The `kind: "update"` frame fanned out to WebSocket clients. Same wire
/// format as REST: `discount` at NUMERIC(10,6), the USD legs at
/// NUMERIC(30,18), trailing zeros trimmed, millisecond timestamps.
fn ws_update_payload(
    asset: &str,
    state: PegState,
    discount: Decimal,
    intrinsic_usd: Decimal,
    market_usd: Decimal,
    ts: chrono::DateTime<Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "update",
        "asset": asset,
        "state": peg_state_label(state),
        "discount": wire_decimal(discount, 6),
        "intrinsic_usd": wire_decimal(intrinsic_usd, 18),
        "market_usd": wire_decimal(market_usd, 18),
        "updated_at": wire_ts(&ts),
    })
}

/// Add `market_observed_at` (millisecond wire format, `null` before the first
/// quote) to a WS frame. `None` = the dark-market gate is off: the frame is left
/// byte-identical to the pre-gate contract.
fn add_market_observed_at(
    payload: &mut serde_json::Value,
    market_observed_at: Option<Option<chrono::DateTime<Utc>>>,
) {
    if let Some(observed) = market_observed_at {
        payload["market_observed_at"] = serde_json::json!(observed.map(|t| wire_ts(&t)));
    }
}

async fn publish_discount(
    redis: &mut redis::aio::ConnectionManager,
    asset: &str,
    state: PegState,
    discount: Decimal,
    prices: (Decimal, Decimal),
    ts: chrono::DateTime<Utc>,
    market_observed_at: Option<Option<chrono::DateTime<Utc>>>,
) -> Result<()> {
    use redis::AsyncCommands;
    let mut payload = ws_update_payload(asset, state, discount, prices.0, prices.1, ts);
    add_market_observed_at(&mut payload, market_observed_at);
    let json = serde_json::to_string(&payload)?;
    let _: redis::Value = redis.publish(channels::DISCOUNT, json).await?;
    metrics::counter!("pegana_engine_publishes_total", "kind" => "update").increment(1);
    Ok(())
}

/// `on_chain_enabled` (last param): when false (PEGANA_COMMIT_KEYPAIR unset),
/// critical alerts still get audited but are stored with
/// commit_status='not_applicable' instead of 'pending' — otherwise the row
/// would sit pending forever (no commit task spawned, no retry worker entry).
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
    on_chain_enabled: bool,
) -> Result<()> {
    // 1) Persist the alerts row. This is the durable record the dispatcher
    //    consumes for webhook fan-out (and that backs the
    //    public /v1/audit ledger) — if it fails the whole
    //    flow aborts (rule #10 still respects the order: alerts > evidence).
    //    `confidence` is plumbed from the same Pyth-derived label
    //    discount_snapshots records, so consumers see the same trustworthiness
    //    signal as the snapshot stream — previously hardcoded 'high'.
    sqlx::query(
        r#"
        INSERT INTO alerts
            (id, asset, class, from_state, to_state, discount, intrinsic_usd, market_usd,
             confidence, detected_at, payload)
        VALUES ($1, $2, $3::asset_class, $4::peg_state, $5::peg_state, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(event.id)
    .bind(&event.asset)
    .bind(asset_class_label(event.class))
    .bind(peg_state_label(event.from_state))
    .bind(peg_state_label(event.to_state))
    .bind(event.discount)
    .bind(event.intrinsic_usd)
    .bind(event.market_usd)
    .bind(confidence)
    .bind(event.detected_at)
    .bind(serde_json::to_value(event).unwrap_or_default())
    .execute(pg)
    .await?;

    // 2) NEW (3B.3): write the audit evidence row. Separate sqlx call, NOT
    //    wrapped in a transaction with alerts — if this fails, the alert
    //    still dispatches via Redis (business rule #10). Failure path falls
    //    back to alert_evidence_pending per ADR-0006 so the reconcile worker
    //    (evidence_reconcile::run_alert_evidence_reconcile) can recover the
    //    audit row.
    //
    //    Per wave-3b-implementation-notes.md Note 1: critical alerts MUST
    //    INSERT with commit_status='pending'. Migration 0033's trigger
    //    treats 'not_applicable' as terminal — once written we cannot UPDATE
    //    to advance. Therefore the discrimination has to happen at INSERT.
    //
    //    However, if on-chain commit is DISABLED (PEGANA_COMMIT_KEYPAIR
    //    unset), we use 'not_applicable' even for critical alerts. Otherwise
    //    those rows would sit at 'pending' forever — no commit task is
    //    spawned and the retry worker only acts on alert_evidence_commit_failures,
    //    not raw pending rows. Better to mark them honestly as "no commit
    //    attempted" than to leak a misleading status indefinitely.
    let initial_commit_status = if on_chain_enabled && onchain_commit::is_anchorable(event.to_state)
    {
        "pending"
    } else {
        "not_applicable"
    };

    let inputs_json = serde_json::to_value(inputs_frozen).unwrap_or_default();
    let computed_json = serde_json::to_value(computed).unwrap_or_default();
    let replay_json = replay_artifact.map(|r| serde_json::to_value(r).unwrap_or_default());

    let audit_timer = std::time::Instant::now();
    let evidence_result = sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, methodology_git_sha, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256, commit_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (alert_id) DO NOTHING"#,
    )
    .bind(event.id)
    .bind(methodology_version)
    .bind(methodology_git_sha)
    .bind(assets_toml_sha256)
    .bind(&inputs_json)
    .bind(&computed_json)
    .bind(&replay_json)
    .bind(receipt_sha256)
    .bind(initial_commit_status)
    .execute(pg)
    .await;

    metrics::histogram!("pegana_audit_persist_seconds").record(audit_timer.elapsed().as_secs_f64());

    match evidence_result {
        Ok(_) => {
            metrics::counter!("pegana_audit_persist_total", "outcome" => "ok").increment(1);
        }
        Err(primary_err) => {
            // ADR-0006 fallback: write to alert_evidence_pending so the retry
            // worker can recover the audit row. The payload is wrapped in a
            // schema-version envelope (Note 2 in wave-3b-implementation-notes.md)
            // so v0.1.1+ workers can detect schema drift and abandon (rather
            // than loop retrying forever).
            let pending_payload = serde_json::json!({
                "schema": 1,
                "payload": {
                    "alert_id": event.id,
                    "methodology_version": methodology_version,
                    "methodology_git_sha": methodology_git_sha,
                    "assets_toml_sha256": assets_toml_sha256,
                    "inputs_frozen": inputs_json,
                    "computed": computed_json,
                    "replay_artifact": replay_json,
                    "receipt_sha256": receipt_sha256,
                    "commit_status": initial_commit_status,
                },
            });

            let pending_result = sqlx::query(
                "INSERT INTO alert_evidence_pending (alert_id, payload, last_error) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (alert_id) DO NOTHING",
            )
            .bind(event.id)
            .bind(&pending_payload)
            .bind(format!("{primary_err:?}"))
            .execute(pg)
            .await;

            match pending_result {
                Ok(_) => {
                    warn!(
                        alert_id = %event.id,
                        err = ?primary_err,
                        "alert_evidence INSERT failed → queued in alert_evidence_pending"
                    );
                    metrics::counter!(
                        "pegana_audit_persist_total",
                        "outcome" => "queued",
                    )
                    .increment(1);
                    // Primary write failed but the dead-letter queue caught
                    // it (ADR-0006 retry worker will reconcile). Worth
                    // surfacing as Warning so the rate is visible — if the
                    // primary path keeps failing, Postgres is unhealthy.
                    sentry::capture_message(
                        &format!(
                            "pegana alert_evidence INSERT failed → queued: alert_id={} err={primary_err:?}",
                            event.id
                        ),
                        sentry::Level::Warning,
                    );
                }
                Err(fallback_err) => {
                    error!(
                        alert_id = %event.id,
                        primary = ?primary_err,
                        fallback = ?fallback_err,
                        "alert_evidence + pending fallback BOTH failed — alert continues without audit"
                    );
                    metrics::counter!(
                        "pegana_audit_persist_total",
                        "outcome" => "failed",
                    )
                    .increment(1);
                    // Catastrophic: the alert fires to dispatchers but the
                    // receipt will never materialise. /v1/audit/{id} returns
                    // a special evidence_missing 404 (audit.rs path 4). Page
                    // immediately — this is the worst trust-layer outcome.
                    sentry::capture_message(
                        &format!(
                            "pegana alert_evidence BOTH writes failed: alert_id={} primary={primary_err:?} fallback={fallback_err:?}",
                            event.id
                        ),
                        sentry::Level::Error,
                    );
                }
            }
        }
    }

    // 3) Push to Redis stream for dispatcher consumption. This runs regardless
    //    of audit outcome — the alert is what the user pays for; the audit
    //    row is the trust-layer add-on (rule #10).
    let json = serde_json::to_string(event)?;
    let _: redis::Value = alerts_xadd_cmd(&json).query_async(redis).await?;
    metrics::counter!(
        "pegana_alerts_emitted_total",
        "class" => asset_class_label(event.class).to_string(),
        "transition" => format!("{}->{}", peg_state_label(event.from_state), peg_state_label(event.to_state)),
    )
    .increment(1);
    Ok(())
}

/// Counts a persistence failure (`snapshot` write, WS `publish`, or `alert`
/// push) inside ANY recompute, not only one that follows a state change: the FSM
/// has already stepped in `transition()`, and the next recompute re-seeds from
/// `last_state` (what the receipt freezes), so it is recoverable but visible.
/// Pre-initialised at boot for every asset and stage.
fn count_persist_failure(asset: &str, stage: &'static str) {
    metrics::counter!(
        "pegana_engine_persist_failed_after_transition_total",
        "asset" => asset.to_string(),
        "stage" => stage,
    )
    .increment(1);
}

struct MarketGates {
    /// Set when the leg must be treated as unusable (forces UNKNOWN).
    dark_reason: Option<&'static str>,
    premium_unconfirmed: bool,
    premium_cap: Option<PegState>,
}

/// The three numbers a confirmation gate judges.
struct MarketLeg {
    intrinsic: Decimal,
    smooth: Decimal,
}

/// Evaluate the ADR-0047 market-confirmation gates for one recompute.
///
/// A divergent reference print never gets here: it is rejected at ingest, before
/// the EWMA (`handle_message`). What is left is the premium-confirmation gate,
/// the depth verdict, and the hold timeout.
async fn evaluate_market_confirmation(
    engine: &EngineState,
    asset: &str,
    cfg: &AssetConfig,
    leg: MarketLeg,
    threshold_kind: &str,
    depth_below_floor: bool,
    seed_state: PegState,
) -> MarketGates {
    let none = MarketGates {
        dark_reason: None,
        premium_unconfirmed: false,
        premium_cap: None,
    };
    let premium_gate = engine.premium_confirmation_gate();
    let depth_gate = engine.depth_verdict_gate();
    if (!premium_gate && !depth_gate)
        || !pegana_methodology::market_unavailable_applies(threshold_kind)
    {
        return none;
    }
    let direction_sensitive = pegana_methodology::is_direction_sensitive(cfg.class);
    let mut dark_reason = None;
    if depth_gate && depth_below_floor {
        dark_reason = Some(pegana_methodology::STATE_REASON_DEPTH_BELOW_FLOOR);
    }
    let mut premium_unconfirmed = false;
    let mut premium_cap = None;
    let latched = engine.premium_hold_latched(asset).await;
    let mut clear = leg.smooth >= Decimal::ZERO;
    if premium_gate && leg.smooth < Decimal::ZERO {
        let empty = std::collections::HashMap::new();
        let thresholds = cfg.thresholds.thresholds_bps.as_ref().unwrap_or(&empty);
        let floor = pegana_methodology::premium_confirmation_floor_bps(thresholds);
        let premium_bps = leg.smooth.abs().checked_mul(Decimal::from(10_000u32));
        let heavy = matches!(
            seed_state,
            PegState::Depeg | PegState::Critical | PegState::BlackSwan
        );
        // A symmetric class needs confirmation for any premium above its drift band
        // (it would otherwise read as a depeg). A direction-sensitive class reads a
        // premium as PEGGED, so what needs confirming is a premium of ANY size that
        // would RELAX a committed DEPEG-or-worse band, or any premium while an expired
        // hold is still latched (the expiry itself resets the FSM to UNKNOWN).
        let needs_confirmation = if direction_sensitive {
            heavy || latched
        } else {
            premium_bps.is_some_and(|p| p >= Decimal::from(floor))
        };
        if needs_confirmation {
            let reference_implied = match engine.market_reference_price(asset).await {
                Some(reference) => reference
                    .checked_div(leg.intrinsic)
                    .and_then(|ratio| Decimal::ONE.checked_sub(ratio)),
                None => None,
            };
            if direction_sensitive {
                // Confirmed only by a reference that implies the SAME smoothed discount
                // within a tight tolerance (<= 10 bps), or by a sized quote.
                let tolerance = Decimal::from(
                    pegana_methodology::premium_confirmation_tolerance_bps(thresholds),
                );
                let ref_confirms = reference_implied
                    .and_then(|implied| leg.smooth.checked_sub(implied))
                    .and_then(|gap| gap.abs().checked_mul(Decimal::from(10_000u32)))
                    .is_some_and(|gap_bps| gap_bps <= tolerance);
                premium_unconfirmed = !(ref_confirms || engine.market_is_sized(asset).await);
                clear = clear || !premium_unconfirmed;
            } else {
                // Symmetric: the premium is capped at DRIFT, or at the band the
                // reference itself implies when that is worse. The reference never
                // lifts the cap above what it actually shows.
                premium_unconfirmed = true;
                // Only a reference that itself implies a premium lifts the cap.
                premium_cap = reference_implied
                    .filter(|i| *i < Decimal::ZERO)
                    .map(|implied| {
                        pegana_methodology::state_for_bps_discount(implied.abs(), thresholds)
                    });
            }
        }
    }
    // Hold timeout: an unconfirmed premium may hold a committed DEPEG+ band only for
    // so long, then the leg goes dark (UNKNOWN) rather than relaxing to PEGGED. The
    // expiry latches until the premium is gone or confirmed.
    let holding = premium_unconfirmed
        && direction_sensitive
        && matches!(
            seed_state,
            PegState::Depeg | PegState::Critical | PegState::BlackSwan
        );
    let expired = engine
        .premium_hold_update(asset, holding, clear, Utc::now())
        .await;
    if expired && direction_sensitive && dark_reason.is_none() {
        dark_reason = Some(pegana_methodology::STATE_REASON_PREMIUM_HOLD_TIMEOUT);
    }
    MarketGates {
        dark_reason,
        premium_unconfirmed,
        premium_cap,
    }
}

/// Approximate cap on the alerts stream length, so an unconsumed stream cannot
/// grow without bound.
const ALERTS_STREAM_MAXLEN: usize = 100_000;

/// `XADD pegana:alerts MAXLEN ~ 100000 * event <json>` (approximate trim).
fn alerts_xadd_cmd(json: &str) -> redis::Cmd {
    let mut cmd = redis::cmd("XADD");
    cmd.arg(channels::ALERTS_STREAM)
        .arg("MAXLEN")
        .arg("~")
        .arg(ALERTS_STREAM_MAXLEN)
        .arg("*")
        .arg("event")
        .arg(json);
    cmd
}

pub fn peg_state_label(s: PegState) -> &'static str {
    match s {
        PegState::Pegged => "PEGGED",
        PegState::Drift => "DRIFT",
        PegState::Depeg => "DEPEG",
        PegState::Critical => "CRITICAL",
        PegState::BlackSwan => "BLACK_SWAN",
        PegState::Unknown => "UNKNOWN",
    }
}

pub fn asset_class_label(c: AssetClass) -> &'static str {
    match c {
        AssetClass::Lst => "lst",
        AssetClass::StableFiat => "stable_fiat",
        AssetClass::StableCdp => "stable_cdp",
        AssetClass::StableRwa => "stable_rwa",
        AssetClass::StableDn => "stable_dn",
        AssetClass::StableFx => "stable_fx",
        AssetClass::SynthLev => "synth_lev",
        AssetClass::StableYield => "stable_yield",
    }
}

/// Build the on-chain commit context from env, or return `None` if
/// `PEGANA_COMMIT_KEYPAIR` is unset (engine still starts; commit just no-ops).
///
/// Supports two keypair file formats:
///   * raw Vec<u8> (the canonical `solana-keygen` JSON output: `[1,2,3,...]`)
///   * an outer JSON string whose inner content is itself a Vec<u8> (some
///     wallets ship it double-encoded)
///
/// Side-effect: runs an immediate `check_wallet_balance` (startup alarm) and
/// spawns the recurring 5-minute monitor task (ADR-0004).
async fn build_commit_context(pg: &PgPool) -> Result<Option<Arc<onchain_commit::CommitContext>>> {
    let Ok(keypair_path) = std::env::var("PEGANA_COMMIT_KEYPAIR") else {
        info!("PEGANA_COMMIT_KEYPAIR unset — on-chain commit disabled (engine starts normally)");
        return Ok(None);
    };

    // Zeroization is best-effort: the parsed buffers are wiped on drop, but serde's
    // internal growth buffers and the allocator's freed pages can still hold
    // copies of the key bytes until reused. The keypair file's permissions, not
    // process memory hygiene, remain the primary protection.
    let keypair_bytes = zeroize::Zeroizing::new(
        std::fs::read_to_string(&keypair_path)
            .with_context(|| format!("read keypair from {keypair_path}"))?,
    );

    // Try the byte-array JSON shape first (overwhelmingly the common case for
    // `solana-keygen new`). Fall back to "JSON string holding a Vec<u8>" for
    // tooling that double-encodes.
    use solana_sdk::signer::Signer;
    let keypair: solana_sdk::signature::Keypair =
        match serde_json::from_str::<Vec<u8>>(&keypair_bytes) {
            Ok(bytes) => {
                solana_sdk::signature::Keypair::try_from(zeroize::Zeroizing::new(bytes).as_slice())
                    .map_err(|e| anyhow::anyhow!("Keypair::try_from failed: {e}"))?
            }
            Err(_) => {
                let inner = zeroize::Zeroizing::new(
                    serde_json::from_str::<String>(&keypair_bytes)
                        .context("parse keypair JSON (neither Vec<u8> nor JSON-string shape)")?,
                );
                let bytes = zeroize::Zeroizing::new(
                    serde_json::from_str::<Vec<u8>>(&inner)
                        .context("parse inner keypair JSON as Vec<u8>")?,
                );
                solana_sdk::signature::Keypair::try_from(bytes.as_slice())
                    .map_err(|e| anyhow::anyhow!("Keypair::try_from (inner) failed: {e}"))?
            }
        };

    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into());
    let rpc_fallback_url = std::env::var("SOLANA_RPC_URL_FALLBACK").ok();
    let masked_rpc_fallback_url = rpc_fallback_url
        .as_deref()
        .map(mask_rpc_url)
        .unwrap_or_else(|| "same-as-primary".into());
    info!(
        rpc_url = %mask_rpc_url(&rpc_url),
        rpc_fallback_url = %masked_rpc_fallback_url,
        pubkey = %keypair.pubkey(),
        "on-chain commit enabled"
    );

    let rpc = Arc::new(
        solana_rpc_client::nonblocking::rpc_client::RpcClient::new_with_commitment(
            rpc_url,
            CommitmentConfig::confirmed(),
        ),
    );
    let rpc_fallback = rpc_fallback_url
        .map(|url| {
            Arc::new(
                solana_rpc_client::nonblocking::rpc_client::RpcClient::new_with_commitment(
                    url,
                    CommitmentConfig::confirmed(),
                ),
            )
        })
        .unwrap_or_else(|| rpc.clone());

    // Startup wallet check — best-effort; do not abort engine startup if the
    // RPC is briefly unreachable. The recurring monitor will catch up.
    if let Err(e) = onchain_commit::check_wallet_balance(&rpc, &keypair).await {
        warn!(
            ?e,
            "startup wallet balance check failed — continuing anyway"
        );
        metrics::counter!(
            "pegana_engine_startup_check_failed_total",
            "check" => "wallet_balance"
        )
        .increment(1);
    }

    let semaphore = Arc::new(tokio::sync::Semaphore::new(5));
    let ctx = Arc::new(onchain_commit::CommitContext {
        rpc: rpc.clone(),
        rpc_fallback,
        keypair: Arc::new(keypair),
        pg: pg.clone(),
        semaphore,
    });

    // Spawn the ADR-0004 recurring wallet-balance monitor (every 5 minutes).
    tokio::spawn(onchain_commit::run_wallet_balance_monitor(
        ctx.clone(),
        std::time::Duration::from_secs(300),
    ));

    Ok(Some(ctx))
}

#[cfg(test)]
mod tests {
    use super::{
        depth_gate_fires, mask_rpc_url, observed_at_or_now, parse_decimal,
        pyth_confidence_for_asset, strictest,
    };
    use crate::state::EngineState;
    use chrono::{DateTime, Utc};
    use pegana_common::AssetsFile;
    use rust_decimal::Decimal;
    use serde_json::json;

    /// WS frames use the REST wire format: discount at 6 dp (Postgres
    /// half-away-from-zero rounding), trimmed decimals, millisecond `Z`
    /// timestamps. Regression for the live frame
    /// `0.0012916058955691941916418750` / `...01:18:32.629700188Z`.
    #[test]
    fn ws_update_frame_matches_the_rest_wire_format() {
        use std::str::FromStr;
        let ts = "2026-10-21T01:18:32.629700188Z"
            .parse::<DateTime<Utc>>()
            .unwrap();
        let v = super::ws_update_payload(
            "mSOL",
            pegana_common::PegState::Pegged,
            Decimal::from_str("0.0012916058955691941916418750").unwrap(),
            Decimal::from_str("150.17513665320654301904141903").unwrap(),
            Decimal::from_str("149.98").unwrap(),
            ts,
        );
        assert_eq!(v["kind"], "update");
        assert_eq!(v["state"], "PEGGED");
        assert_eq!(v["discount"], "0.001292");
        assert_eq!(v["intrinsic_usd"], "150.175136653206543019");
        assert_eq!(v["market_usd"], "149.98");
        assert_eq!(v["updated_at"], "2026-10-21T01:18:32.629Z");
        // Postgres NUMERIC rounds a midpoint away from zero, not to even.
        assert_eq!(
            super::wire_decimal(Decimal::from_str("0.0000025").unwrap(), 6),
            "0.000003"
        );
        assert_eq!(
            super::wire_decimal(Decimal::from_str("-0.0000025").unwrap(), 6),
            "-0.000003"
        );
        assert_eq!(super::wire_ts(&ts), "2026-10-21T01:18:32.629Z");
    }

    fn fresh_engine() -> EngineState {
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).expect("workspace assets.toml parses");
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        EngineState::new(&assets, canonical, 30)
    }

    /// Dark-market end-to-end against real Postgres + Redis (self-skips unless
    /// `PEGANA_INTEGRATION_PG_URL` and `PEGANA_INTEGRATION_REDIS` are set).
    /// Flag OFF: a `market_unavailable` envelope is ignored. Flag ON: exactly one
    /// UNKNOWN alert (with its receipt row) however often it repeats.
    #[tokio::test]
    async fn dark_market_envelope_is_ignored_when_off_and_idempotent_when_on() {
        let (Ok(pg_url), Ok(redis_url)) = (
            std::env::var("PEGANA_INTEGRATION_PG_URL"),
            std::env::var("PEGANA_INTEGRATION_REDIS"),
        ) else {
            return;
        };
        let pg = sqlx::PgPool::connect(&pg_url).await.unwrap();
        let client = redis::Client::open(redis_url).unwrap();
        let mut redis = redis::aio::ConnectionManager::new(client).await.unwrap();
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        let alpha = Decimal::new(3, 1);
        let asset = "mSOL";
        let alerts = |pg: sqlx::PgPool, since: DateTime<Utc>| async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM alerts WHERE asset = $1 AND to_state = 'UNKNOWN' AND detected_at >= $2",
            )
            .bind(asset)
            .bind(since)
            .fetch_one(&pg)
            .await
            .unwrap()
        };
        let dark = json!({"asset": asset, "market_unavailable": true}).to_string();
        let priced = |ts: DateTime<Utc>| {
            json!({"asset": asset, "value_usd": "150", "ts": ts.to_rfc3339()}).to_string()
        };

        for gate in [false, true] {
            let engine = std::sync::Arc::new(
                EngineState::new(&assets, canonical.clone(), 30).with_dark_market_gate(gate, 600),
            );
            let since = Utc::now();
            engine.set_intrinsic(asset, Decimal::from(150), since).await;
            super::handle_message(
                &engine,
                &pg,
                &mut redis,
                pegana_common::channels::SRC_JUPITER,
                &priced(Utc::now()),
                alpha,
                None,
            )
            .await
            .unwrap();
            for _ in 0..3 {
                super::handle_message(
                    &engine,
                    &pg,
                    &mut redis,
                    pegana_common::channels::SRC_JUPITER,
                    &dark,
                    alpha,
                    None,
                )
                .await
                .unwrap();
            }
            let n = alerts(pg.clone(), since).await;
            if gate {
                assert_eq!(n, 1, "one UNKNOWN alert, idempotent on repeats");
                assert!(engine.market_is_unavailable(asset).await);
                let receipts: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM alert_evidence e JOIN alerts a ON a.id = e.alert_id \
                     WHERE a.asset = $1 AND a.to_state = 'UNKNOWN' AND a.detected_at >= $2",
                )
                .bind(asset)
                .bind(since)
                .fetch_one(&pg)
                .await
                .unwrap();
                assert_eq!(receipts, 1, "the dark UNKNOWN carries a receipt");
                // A fresh quote clears the flag (recovery).
                super::handle_message(
                    &engine,
                    &pg,
                    &mut redis,
                    pegana_common::channels::SRC_JUPITER,
                    &priced(Utc::now()),
                    alpha,
                    None,
                )
                .await
                .unwrap();
                assert!(!engine.market_is_unavailable(asset).await);
            } else {
                assert_eq!(n, 0, "flag off: envelope ignored");
                assert!(!engine.market_is_unavailable(asset).await);
            }
        }
    }

    #[test]
    fn the_shipped_assets_file_passes_threshold_validation() {
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        super::validate_asset_thresholds(&assets).expect("assets.toml thresholds are valid");
    }

    #[test]
    fn sol_path_drops_the_numeraire_feed_from_the_confidence_gate() {
        use std::collections::HashMap;
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let cfg = assets
            .assets
            .iter()
            .find(|a| matches!(a.market, pegana_common::MarketStrategy::JupiterUsd { .. }))
            .unwrap();
        let pegana_common::MarketStrategy::JupiterUsd { numeraire_feed, .. } = &cfg.market else {
            unreachable!()
        };
        let entry = pegana_methodology::PythEntry {
            price: Decimal::ONE,
            confidence: Decimal::ONE,
            publish_time: Utc::now(),
        };
        let entries: HashMap<_, _> = [(numeraire_feed.clone(), entry)].into();
        assert!(super::without_cancelled_numeraire(entries.clone(), cfg, true).is_empty());
        assert_eq!(
            super::without_cancelled_numeraire(entries, cfg, false).len(),
            1
        );
    }

    /// The independent reference is each asset's own `<SYMBOL>/USD` spot feed. BRZ
    /// (whose `pyth_feed_id` is the USD/BRL rate it uses as its intrinsic) and
    /// every Pyth-spot asset must NOT get one.
    #[test]
    fn reference_map_holds_only_own_usd_spot_feeds() {
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        let engine = EngineState::new(&assets, canonical, 30);
        assert_eq!(
            engine.market_reference_symbols(),
            ["EURC", "JupUSD", "PYUSD", "USDS", "USDe"]
        );
    }

    fn gate_engine(reference_bps: u32) -> (EngineState, AssetsFile) {
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        let engine = EngineState::new(&assets, canonical, 30).with_market_confirmation(
            reference_bps,
            true,
            false,
        );
        (engine, assets)
    }

    #[test]
    fn the_reference_rejection_bound_is_clamped_below_the_smallest_depeg_band() {
        // PYUSD's DEPEG band is 50 bps: a 500 bps bound would reject real depegs.
        let (engine, _) = gate_engine(500);
        assert!(engine.market_reference_gate_bps() < 50);
        let (engine, _) = gate_engine(20);
        assert_eq!(
            engine.market_reference_gate_bps(),
            20,
            "a safe bound is kept"
        );
    }

    /// A reference must not confirm a premium larger than it shows; the
    /// symmetric cap follows the reference band.
    #[tokio::test]
    async fn a_reference_cannot_confirm_a_premium_larger_than_it_shows() {
        let (engine, assets) = gate_engine(40);
        let cfg = assets.assets.iter().find(|a| a.symbol == "PYUSD").unwrap();
        let leg = |smooth: i64| super::MarketLeg {
            intrinsic: Decimal::ONE,
            smooth: Decimal::new(smooth, 4),
        };
        let eval = |l: super::MarketLeg| {
            super::evaluate_market_confirmation(
                &engine,
                "PYUSD",
                cfg,
                l,
                "bps",
                false,
                pegana_common::PegState::Pegged,
            )
        };
        engine
            .set_pyth("PYUSD/USD", Decimal::ONE, Utc::now(), Decimal::new(1, 4))
            .await;
        let g = eval(leg(-90)).await;
        assert!(g.premium_unconfirmed);
        assert_eq!(
            g.premium_cap, None,
            "a par reference shows no premium: only the DRIFT floor applies"
        );
        // A reference that implies a premium lifts the cap to its band.
        engine
            .set_pyth(
                "PYUSD/USD",
                Decimal::new(10090, 4),
                Utc::now(),
                Decimal::new(1, 4),
            )
            .await;
        let g = eval(leg(-90)).await;
        assert_eq!(g.premium_cap, Some(pegana_common::PegState::Depeg));
    }

    /// An expired hold remains latched while the premium persists.
    #[tokio::test]
    async fn expired_hold_stays_latched() {
        let (engine, assets) = gate_engine(0);
        let cfg = assets
            .assets
            .iter()
            .find(|a| a.class == pegana_common::AssetClass::Lst)
            .unwrap();
        let sym = cfg.symbol.clone();
        let t0 = Utc::now();
        assert!(!engine.premium_hold_update(&sym, true, false, t0).await);
        assert!(
            engine
                .premium_hold_update(&sym, true, false, t0 + chrono::Duration::seconds(960))
                .await
        );
        for minute in 17..77 {
            let g = super::evaluate_market_confirmation(
                &engine,
                &sym,
                cfg,
                super::MarketLeg {
                    intrinsic: Decimal::ONE,
                    smooth: Decimal::new(-50, 4),
                },
                "bps",
                false,
                pegana_common::PegState::Unknown,
            )
            .await;
            assert!(g.premium_unconfirmed, "minute {minute}");
            assert_eq!(
                g.dark_reason,
                Some(pegana_methodology::STATE_REASON_PREMIUM_HOLD_TIMEOUT),
                "minute {minute}"
            );
        }
        let g = super::evaluate_market_confirmation(
            &engine,
            &sym,
            cfg,
            super::MarketLeg {
                intrinsic: Decimal::ONE,
                smooth: Decimal::ZERO,
            },
            "bps",
            false,
            pegana_common::PegState::Unknown,
        )
        .await;
        assert!(g.dark_reason.is_none() && !engine.premium_hold_latched(&sym).await);
    }

    /// A restart restores the premium hold when the smoothed state requires it.
    #[tokio::test]
    async fn restart_relatches_an_expired_premium_hold() {
        let (engine, assets) = gate_engine(0);
        let cfg = assets
            .assets
            .iter()
            .find(|a| a.class == pegana_common::AssetClass::Lst)
            .unwrap();
        let sym = cfg.symbol.clone();
        engine
            .restore_fsm(&sym, pegana_common::PegState::Unknown, None, None)
            .await;
        engine
            .apply_ewma(&sym, Decimal::new(-50, 4), Decimal::new(3, 1))
            .await;
        assert!(!engine.premium_hold_latched(&sym).await);
        assert!(engine.reseed_premium_latch().await >= 1);
        let g = super::evaluate_market_confirmation(
            &engine,
            &sym,
            cfg,
            super::MarketLeg {
                intrinsic: Decimal::ONE,
                smooth: Decimal::new(-50, 4),
            },
            "bps",
            false,
            pegana_common::PegState::Unknown,
        )
        .await;
        assert_eq!(
            g.dark_reason,
            Some(pegana_methodology::STATE_REASON_PREMIUM_HOLD_TIMEOUT)
        );
    }

    #[tokio::test]
    async fn reference_rejection_is_one_sided() {
        let (engine, _) = gate_engine(40);
        engine
            .set_pyth("PYUSD/USD", Decimal::ONE, Utc::now(), Decimal::new(1, 4))
            .await;
        assert!(
            engine
                .reference_rejects("PYUSD", Decimal::new(1010, 3))
                .await
        );
        assert!(
            !engine
                .reference_rejects("PYUSD", Decimal::new(990, 3))
                .await,
            "a LOWER print is a real signal, never rejected"
        );
    }

    /// Premium confirmation keeps a committed band for a direction-sensitive
    /// class; no hold is needed when a higher band was not committed.
    #[tokio::test]
    async fn committed_band_is_held_for_direction_sensitive_class() {
        let (engine, assets) = gate_engine(0);
        let cfg = assets
            .assets
            .iter()
            .find(|a| a.class == pegana_common::AssetClass::Lst)
            .unwrap();
        let leg = super::MarketLeg {
            intrinsic: Decimal::ONE,
            smooth: Decimal::new(-30, 4), // Premium below the drift floor.
        };
        let held = super::evaluate_market_confirmation(
            &engine,
            &cfg.symbol,
            cfg,
            super::MarketLeg { ..leg },
            "bps",
            false,
            pegana_common::PegState::Critical,
        )
        .await;
        assert!(held.premium_unconfirmed);
        let free = super::evaluate_market_confirmation(
            &engine,
            &cfg.symbol,
            cfg,
            super::MarketLeg {
                intrinsic: Decimal::ONE,
                smooth: Decimal::new(-30, 4),
            },
            "bps",
            false,
            pegana_common::PegState::Pegged,
        )
        .await;
        assert!(!free.premium_unconfirmed);
    }

    /// Reference gate end to end (self-skips without PG + Redis): divergent prints
    /// are rejected before the EWMA, the third marks the leg dark (UNKNOWN with a
    /// receipt that re-derives), and a clean print afterwards never leaks a band.
    #[tokio::test]
    async fn reference_divergent_prints_never_reach_the_ewma_or_leak_a_band() {
        let (Ok(pg_url), Ok(redis_url)) = (
            std::env::var("PEGANA_INTEGRATION_PG_URL"),
            std::env::var("PEGANA_INTEGRATION_REDIS"),
        ) else {
            return;
        };
        let pg = sqlx::PgPool::connect(&pg_url).await.unwrap();
        let client = redis::Client::open(redis_url).unwrap();
        let mut redis = redis::aio::ConnectionManager::new(client).await.unwrap();
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        let engine = std::sync::Arc::new(
            EngineState::new(&assets, canonical, 30).with_market_confirmation(50, true, false),
        );
        let alpha = Decimal::new(3, 1);
        let tick = |v: &str| {
            json!({"asset": "PYUSD", "value_usd": v, "ts": Utc::now().to_rfc3339()}).to_string()
        };
        let since = Utc::now();
        let fresh_refs = || async {
            engine
                .set_pyth("PYUSD/USD", Decimal::ONE, Utc::now(), Decimal::new(1, 4))
                .await;
            engine
                .set_pyth("USDC/USD", Decimal::ONE, Utc::now(), Decimal::new(1, 4))
                .await;
        };
        fresh_refs().await;
        let send = |v: &'static str| {
            let engine = engine.clone();
            let (pg, tick) = (pg.clone(), tick(v));
            async move {
                let mut redis = redis::aio::ConnectionManager::new(
                    redis::Client::open(std::env::var("PEGANA_INTEGRATION_REDIS").unwrap())
                        .unwrap(),
                )
                .await
                .unwrap();
                super::handle_message(
                    &engine,
                    &pg,
                    &mut redis,
                    pegana_common::channels::SRC_JUPITER,
                    &tick,
                    alpha,
                    None,
                )
                .await
                .unwrap();
            }
        };
        let _ = &mut redis;
        send("0.9999").await;
        let ewma_before = engine.previous_ewma("PYUSD").await;
        send("1.10").await;
        send("1.10").await;
        assert_eq!(
            engine.previous_ewma("PYUSD").await,
            ewma_before,
            "rejected prints must not be folded"
        );
        assert!(!engine.market_is_unavailable("PYUSD").await);
        fresh_refs().await;
        send("1.10").await;
        assert!(
            engine.market_is_unavailable("PYUSD").await,
            "third rejection goes dark"
        );
        let (state, artifact): (String, serde_json::Value) = sqlx::query_as(
            "SELECT a.to_state::text, e.replay_artifact FROM alert_evidence e JOIN alerts a ON a.id = e.alert_id \
             WHERE a.asset = 'PYUSD' AND a.detected_at >= $1 ORDER BY a.detected_at DESC LIMIT 1",
        )
        .bind(since)
        .fetch_one(&pg)
        .await
        .unwrap();
        assert_eq!(state, "UNKNOWN");
        let receipt: pegana_methodology::Receipt = serde_json::from_value(artifact).unwrap();
        assert!(receipt.inputs_frozen.market_unavailable);
        assert_eq!(
            receipt.state_reason.as_deref(),
            Some("market_reference_divergence")
        );
        let rederived = pegana_methodology::rederive(&receipt.inputs_frozen).unwrap();
        assert_eq!(rederived.final_state, receipt.expected_computed.final_state);
        // A clean print clears the dark flag; no false band was ever published.
        fresh_refs().await;
        send("0.9999").await;
        assert!(!engine.market_is_unavailable("PYUSD").await);
        let bad: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM alerts WHERE asset = 'PYUSD' AND detected_at >= $1 \
             AND to_state IN ('DEPEG','CRITICAL','BLACK_SWAN')",
        )
        .bind(since)
        .fetch_one(&pg)
        .await
        .unwrap();
        assert_eq!(bad, 0);
    }

    #[test]
    fn alerts_xadd_is_length_capped_with_approximate_trim() {
        let packed = String::from_utf8_lossy(&super::alerts_xadd_cmd("{}").get_packed_command())
            .into_owned();
        let args: Vec<&str> = packed
            .split("\r\n")
            .skip(1) // the `*N` array header
            .filter(|l| !l.starts_with('$') && !l.is_empty())
            .collect();
        assert_eq!(
            args,
            [
                "XADD",
                "pegana:alerts",
                "MAXLEN",
                "~",
                "100000",
                "*",
                "event",
                "{}"
            ]
        );
    }

    /// F07, engine side: with last_state = DEPEG, last_published_state = PEGGED, a
    /// matured DRIFT relaxation candidate and an 85 bps smoothed discount, the
    /// engine's seeded classification + transition equals `rederive` on the inputs
    /// the receipt would freeze.
    #[tokio::test]
    async fn engine_and_rederive_agree_when_last_state_differs_from_last_published() {
        use pegana_common::{AssetClass, PegState};
        use pegana_methodology::{
            classify_with_hysteresis, rederive, InputsFrozen, DEADBAND_PCT,
            RECEIPT_CONFIRM_UP_SECS, RECEIPT_DECAY_DOWN_SECS,
        };
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        let engine = EngineState::new(&assets, canonical, 30);
        let asset = "PYUSD";
        let cfg = assets.assets.iter().find(|a| a.symbol == asset).unwrap();
        assert_eq!(cfg.class, AssetClass::StableFiat);
        let thresholds = cfg.thresholds.thresholds_bps.clone().unwrap();
        let now = Utc::now();
        let since = now - chrono::Duration::seconds(3_600);
        engine
            .restore_fsm(asset, PegState::Depeg, Some(PegState::Drift), Some(since))
            .await;
        engine
            .set_last_published_state(asset, PegState::Pegged)
            .await;

        let market = Decimal::new(9915, 4); // 0.9915 → 85 bps discount
        let alpha: Decimal = super::EWMA_ALPHA.parse().unwrap();
        let discount = Decimal::ONE - market;
        // What the engine does, in order: freeze, classify from last_state, transition.
        let previous = engine.last_state(asset).await;
        let (cand_state, cand_since) = (
            engine.candidate_state(asset).await,
            engine.candidate_since(asset).await,
        );
        let candidate =
            classify_with_hysteresis(cfg.class, discount, &thresholds, previous, DEADBAND_PCT);
        let engine_final = engine
            .transition(
                asset,
                candidate,
                now,
                RECEIPT_CONFIRM_UP_SECS,
                RECEIPT_DECAY_DOWN_SECS,
            )
            .await;
        let frozen = InputsFrozen {
            asset: asset.into(),
            class: cfg.class,
            now,
            alpha,
            intrinsic_usd: Decimal::ONE,
            market_usd: market,
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev: None,
            hyusd_cr: None,
            previous_state: previous,
            candidate_state: cand_state,
            candidate_since: cand_since,
            thresholds,
            threshold_kind: "bps".into(),
            pyth_entries: Default::default(),
            confirm_up_secs: RECEIPT_CONFIRM_UP_SECS,
            decay_down_secs: RECEIPT_DECAY_DOWN_SECS,
            intrinsic_stale: false,
            market_unavailable: false,
            premium_unconfirmed: false,
            premium_cap: None,
        };
        assert_eq!(rederive(&frozen).unwrap().final_state, engine_final);
        assert_eq!(
            engine_final,
            PegState::Depeg,
            "sticky seed, not the PEGGED one"
        );
    }

    #[test]
    fn opt_in_flags_parse_strictly() {
        for on in ["1", "true", "TRUE", " on ", "Yes"] {
            assert!(super::parse_flag(on), "{on:?}");
        }
        for off in ["", "0", "false", "off", "no", "2", "enable"] {
            assert!(!super::parse_flag(off), "{off:?}");
        }
    }

    #[test]
    fn receipt_constants_are_the_methodology_ones() {
        assert_eq!(super::EWMA_ALPHA, pegana_methodology::RECEIPT_EWMA_ALPHA);
        assert_eq!(
            super::CONFIRM_UP_SECS,
            pegana_methodology::RECEIPT_CONFIRM_UP_SECS
        );
        assert_eq!(
            super::DECAY_DOWN_SECS,
            pegana_methodology::RECEIPT_DECAY_DOWN_SECS
        );
    }

    #[test]
    fn redis_timeouts_trigger_a_rebuild_on_the_third_in_a_row() {
        let timeout = || {
            anyhow::Error::new(redis::RedisError::from(std::io::Error::from(
                std::io::ErrorKind::TimedOut,
            )))
        };
        let other = anyhow::anyhow!("not redis");
        let mut t = super::RedisTimeouts::default();
        assert!(!t.on_error(&timeout()));
        assert!(!t.on_error(&other), "non-timeout errors are ignored");
        assert!(!t.on_error(&timeout()));
        t.on_success();
        assert!(!t.on_error(&timeout()));
        assert!(!t.on_error(&timeout()));
        assert!(t.on_error(&timeout()));
        assert!(!t.on_error(&timeout()), "streak restarts after a rebuild");
    }

    #[test]
    fn ws_frame_is_byte_identical_with_the_dark_gate_off() {
        let ts = chrono::DateTime::parse_from_rfc3339("2026-10-21T01:18:32.629Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut payload = super::ws_update_payload(
            "USDC",
            pegana_common::PegState::Pegged,
            rust_decimal::Decimal::ZERO,
            rust_decimal::Decimal::ONE,
            rust_decimal::Decimal::ONE,
            ts,
        );
        super::add_market_observed_at(&mut payload, None);
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"asset":"USDC","discount":"0","intrinsic_usd":"1","kind":"update","market_usd":"1","state":"PEGGED","updated_at":"2026-10-21T01:18:32.629Z"}"#
        );
    }

    #[test]
    fn ws_frame_adds_market_observed_at_in_wire_format_with_the_gate_on() {
        let ts = chrono::DateTime::parse_from_rfc3339("2026-10-21T01:18:32.629123456Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut payload = serde_json::json!({"kind": "update"});
        super::add_market_observed_at(&mut payload, Some(Some(ts)));
        assert_eq!(payload["market_observed_at"], "2026-10-21T01:18:32.629Z");
        let mut payload = serde_json::json!({"kind": "update"});
        super::add_market_observed_at(&mut payload, Some(None));
        assert!(payload["market_observed_at"].is_null());
    }

    #[test]
    fn mask_rpc_url_hides_query_and_path() {
        assert_eq!(
            mask_rpc_url("https://mainnet.helius-rpc.com/?api-key=SECRET"),
            "mainnet.helius-rpc.com"
        );
        assert_eq!(mask_rpc_url("https://rpc.example/SECRET"), "rpc.example");
    }

    #[test]
    fn mask_rpc_url_hides_public_endpoint_too() {
        assert_eq!(
            mask_rpc_url("https://api.mainnet-beta.solana.com"),
            "api.mainnet-beta.solana.com"
        );
    }

    #[tokio::test]
    async fn missing_observation_ts_uses_receive_time_and_updates_state() {
        let engine = fresh_engine();
        let envelope = json!({
            "asset": "jitoSOL",
            "value_usd": "1.25",
            "market_usd": "1.24"
        });

        let before = Utc::now();
        let observed_at = observed_at_or_now(&envelope, "ts");
        let after = Utc::now();

        engine
            .set_intrinsic(
                "jitoSOL",
                parse_decimal(&envelope, "value_usd").unwrap(),
                observed_at,
            )
            .await;
        engine
            .set_market(
                "jitoSOL",
                parse_decimal(&envelope, "market_usd").unwrap(),
                observed_at,
            )
            .await;

        assert!(
            observed_at >= before && observed_at <= after,
            "missing ts should fall back to receive-time"
        );
        assert_eq!(
            engine.snapshot("jitoSOL").await,
            Some((Decimal::new(125, 2), Decimal::new(124, 2))),
            "ts-less envelope should still update both cached sides"
        );
    }

    #[test]
    fn valid_observation_ts_is_used_when_present() {
        let envelope = json!({
            "ts": "2026-06-30T12:34:56Z",
            "asset": "jitoSOL",
            "value_usd": "1.25"
        });

        let expected = DateTime::parse_from_rfc3339("2026-06-30T12:34:56Z")
            .unwrap()
            .with_timezone(&Utc);

        assert_eq!(observed_at_or_now(&envelope, "ts"), expected);
    }

    // ===== Phase-1 depth gate (ADR-0026, narrow confidence-cap-only slice) =====

    #[test]
    fn depth_gate_fires_thin_fresh_real_market() {
        assert!(depth_gate_fires(
            Some(Decimal::new(1_000, 0)),
            Decimal::new(50_000, 0)
        ));
    }

    #[test]
    fn depth_gate_fires_deep_market_never_fires() {
        assert!(!depth_gate_fires(
            Some(Decimal::new(500_000, 0)),
            Decimal::new(50_000, 0)
        ));
    }

    #[test]
    fn depth_gate_fires_at_floor_never_fires() {
        // Strictly-less-than: a reading exactly AT the floor is not "below" it.
        assert!(!depth_gate_fires(
            Some(Decimal::new(50_000, 0)),
            Decimal::new(50_000, 0)
        ));
    }

    #[test]
    fn depth_gate_fires_absent_never_fires() {
        // Covers "never observed", and — by construction upstream (only
        // `has_market=true` ticks ever reach `set_liquidity`) — also
        // "has_market=false" and "stale". Absence is never a signal (ADR-0026).
        assert!(!depth_gate_fires(None, Decimal::new(50_000, 0)));
    }

    #[test]
    fn depth_gate_fires_zero_floor_disables() {
        // Proves the `DEPTH_GATE_FLOOR_USD=0` kill switch (also the shipped
        // default — see main()'s production wiring).
        assert!(!depth_gate_fires(Some(Decimal::ONE), Decimal::ZERO));
    }

    #[test]
    fn strictest_never_upgrades_confidence() {
        // Pins the "cap, never upgrade" invariant the whole design leans on.
        assert_eq!(strictest("high", "medium"), "medium");
        assert_eq!(strictest("low", "medium"), "low");
        assert_eq!(strictest("unknown", "medium"), "unknown");
        assert_eq!(strictest("medium", "medium"), "medium");
    }

    #[tokio::test]
    async fn depth_gate_caps_high_to_medium_end_to_end() {
        let engine = fresh_engine().with_depth_gate(Decimal::new(50_000, 0), 600);
        let cfg = engine
            .asset_config("jitoSOL")
            .expect("jitoSOL is in the workspace assets.toml");
        let observed_at = Utc::now();

        // jitoSOL's market leg is `jupiter_usd` numeraire SOL, so its one Pyth
        // dependency is SOL/USD (see `pyth_feeds_for_asset`). Seed a tight
        // reading so the baseline (pre-liquidity) confidence resolves "high".
        engine
            .set_pyth(
                "SOL/USD",
                Decimal::new(20_000, 2), // 200.00
                observed_at,
                Decimal::new(1, 2), // 0.01 conf -> ratio 0.00005 < 0.001 -> "high"
            )
            .await;
        assert_eq!(
            pyth_confidence_for_asset(&engine, cfg).await,
            "high",
            "baseline: tight Pyth cross-check resolves high before any liquidity signal"
        );

        // Seed intrinsic/market so the discount snapshot is well-defined, and
        // freeze the pre-liquidity baseline — the ONLY inputs
        // `compute_discount`/`classify_with_hysteresis` ever read.
        engine
            .set_intrinsic("jitoSOL", Decimal::ONE, observed_at)
            .await;
        engine
            .set_market("jitoSOL", Decimal::new(99, 2), observed_at)
            .await; // 0.99
        let baseline_snapshot = engine.snapshot("jitoSOL").await;

        // A thin, fresh, real (has_market=true) liquidity reading below the floor.
        engine
            .set_liquidity("jitoSOL", Decimal::new(1_000, 0), observed_at)
            .await;

        let liq_fresh = engine
            .liquidity_usd_fresh("jitoSOL", engine.depth_gate_freshness_secs())
            .await;
        assert!(depth_gate_fires(liq_fresh, engine.depth_gate_floor_usd()));
        let confidence_label = strictest(pyth_confidence_for_asset(&engine, cfg).await, "medium");
        assert_eq!(confidence_label, "medium", "depth gate caps high -> medium");

        // Conservative-only guarantee: the discount snapshot — the sole input
        // to discount_raw/discount_smooth/final_state — is byte-for-byte
        // unchanged. Liquidity is a wholly separate field, never read by
        // compute_discount/classify_with_hysteresis; the gate can only ever
        // touch confidence_label.
        assert_eq!(
            engine.snapshot("jitoSOL").await,
            baseline_snapshot,
            "depth gate must never change the discount-affecting snapshot"
        );
    }

    #[tokio::test]
    async fn depth_gate_does_not_fire_on_stale_liquidity_end_to_end() {
        let engine = fresh_engine().with_depth_gate(Decimal::new(50_000, 0), 600);
        // 900s old under a 600s freshness window -> stale -> reads as absent.
        let stale_at = Utc::now() - chrono::Duration::seconds(900);
        engine
            .set_liquidity("jitoSOL", Decimal::new(1_000, 0), stale_at)
            .await;

        let liq_fresh = engine
            .liquidity_usd_fresh("jitoSOL", engine.depth_gate_freshness_secs())
            .await;
        assert!(
            liq_fresh.is_none(),
            "a 900s-old reading must read as absent under a 600s freshness window"
        );
        assert!(
            !depth_gate_fires(liq_fresh, engine.depth_gate_floor_usd()),
            "stale liquidity must never fire the gate, even though the raw value is below the floor"
        );
    }
}
