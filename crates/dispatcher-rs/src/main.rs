//! Pegana alert dispatcher — consumes `pegana:alerts` Redis stream and fans
//! each transition out to matching webhook subscriptions. Retries with
//! exponential backoff; persists a dead letter on giveup.

mod delivery;
mod evidence_reconcile;
mod format;
mod replay;
mod retraction;
mod webhook;
mod webhook_queries;

use crate::delivery::DeliveryPool;
use crate::webhook::{dispatch_one, DispatchConfig};
use crate::webhook_queries::{
    asset_is_monitoring_only, record_dead_letter, record_dispatch_result, subs_for_asset,
};
use anyhow::{Context, Result};
use pegana_common::webhook_sign::SigningKeys;
use pegana_common::{channels, AlertEvent};
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();
    let _sentry = pegana_common::observability::init_sentry("dispatcher");
    pegana_common::observability::init_metrics("0.0.0.0:9093");
    // Register at 0 so Prometheus increase() sees the first event after a restart.
    metrics::counter!("pegana_dispatcher_alert_mismatch_total").absolute(0);
    metrics::counter!("pegana_dispatcher_alert_missing_total").absolute(0);
    pegana_common::observability::spawn_healthz("0.0.0.0:9096");
    info!(
        "pegana-dispatcher starting · version={}",
        env!("CARGO_PKG_VERSION")
    );

    let cfg = DispatcherConfig::from_env()?;
    // Pool safety net (mirror of api-rs, 2026-07-25 incident): sqlx's default
    // pool is 10 conns with NO statement_timeout. The webhook (50-permit)
    // fan-out can burst well past 10 concurrent DB claims/writes, so size the
    // pool up and clamp any single statement — a stuck query then fails fast
    // instead of pinning a slot. Both env-overridable.
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
    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    // Cloned for the evidence-reconcile subscriber, which opens its OWN
    // dedicated pub/sub connection so it never contends with the alert loop's
    // ConnectionManager (a blocking SUBSCRIBE would otherwise monopolize it).
    let evidence_redis_client = redis_client.clone();
    let mut redis = redis::aio::ConnectionManager::new(redis_client).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        // SSRF: NEVER follow redirects. reqwest's default (Policy::limited(10))
        // auto-follows a 3xx `Location` to ANY host, bypassing the 5-layer
        // webhook_url SSRF validation (which only vetted the ORIGINAL URL) — a
        // registered host can 302 to loopback / 169.254.169.254 and reach it. A
        // signed webhook POST never legitimately needs a redirect; treat a 3xx as
        // the delivery outcome. Shared by all egress paths (fan-out, retraction,
        // evidence-reconcile), so this closes the bypass for all three.
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    // v2 webhook channel — build active keyset + semaphore once.
    // Primary key signs every outbound; secondary (when present during
    // a rotation window) is published alongside via the api-rs
    // `/v1/meta/webhook-keys` endpoint so receivers pre-trust it.
    // Optional, NOT fail-fast: unsigned (chat) webhooks do not need a signing
    // key, and the documented docker-compose contract says the key is "safe to
    // leave empty until the first signed webhook subscription lands". A
    // malformed key still errors; only a signed machine-webhook delivery is
    // skipped when it is unset.
    let signing_keys = SigningKeys::from_env_optional()
        .context("PEGANA_WEBHOOK_SIGNING_KEY[_NEXT] env malformed")?;
    if signing_keys.is_none() {
        warn!(
            "PEGANA_WEBHOOK_SIGNING_KEY unset — unsigned (chat) webhooks deliver \
             normally, but SIGNED machine-webhook deliveries are skipped until it is \
             set. Configure it before onboarding any signed webhook subscriber."
        );
    }
    // The published trust list must match what we sign with, in the same order
    // (primary first), or receivers would reject every delivery.
    if let Some(keys) = &signing_keys {
        let published = pegana_common::webhook_sign::public_keys_b64_from_env()
            .context("PEGANA_WEBHOOK_PUBKEYS_B64 env malformed")?;
        if !published.is_empty() {
            anyhow::ensure!(
                published == keys.pubkeys_b64(),
                "PEGANA_WEBHOOK_PUBKEYS_B64 does not match the configured signing keys (same order, primary first)"
            );
        }
    }
    let dispatch_cfg = Arc::new(DispatchConfig {
        signing_keys,
        http: http.clone(),
        // 6 attempts × RETRY_BACKOFFS_SEC in webhook.rs = ~2h35m envelope.
        // Bumped from 3 (~36s) per Svix-pattern audit; full 28h Svix
        // envelope deferred to v2.1 persistent-retry-queue work.
        max_attempts: 6,
        audit_base_url: pegana_common::audit_base_url(),
        retry_backoffs_secs: webhook::RETRY_BACKOFFS_SEC.to_vec(),
    });
    // Bounded delivery pool: 50 concurrent HTTP attempts, 2000 queued/running
    // deliveries; see delivery.rs.
    let delivery_pool = delivery::global_pool().clone();
    delivery_pool.init_metrics();
    // Keep the permits gauge honest even if an event-driven update is missed.
    delivery_pool.spawn_gauge_refresher(Duration::from_secs(15));
    // Periodic replay of deliveries deferred while a subscriber was unreachable.
    crate::replay::spawn_sweeper(pg.clone(), dispatch_cfg.clone());

    // ADR-0003 retraction worker — polls `retractions` every 60s and
    // fans out a `type: "retraction"` payload to every subscriber that
    // received a 2xx alert delivery produced by the broken methodology
    // version. Runs alongside the main alert loop; never blocks it.
    // Re-uses the alert path's delivery_pool (50 permits) so a retraction
    // storm cannot exhaust the shared HTTP pool out from under live
    // alerts. ADR-0003 retractions are bursty (one fan-out per broken
    // version, sized by historical 2xx delivery count); the semaphore
    // gives them backpressure without starving the alert path.
    crate::retraction::spawn(pg.clone(), dispatch_cfg.clone(), delivery_pool.clone());

    // ADR-0006 evidence-reconcile subscriber — subscribes to
    // `pegana:evidence_reconciled` (pub/sub) and, when the engine promotes a
    // pending audit row to live, re-fires an `evidence_now_available`
    // notification to the SAME webhook subscriptions that received the
    // original alert. Re-uses `dispatch_one` and the shared delivery_pool so a
    // reconcile burst can't starve live alerts. Runs on its own redis
    // connection; the main XREADGROUP loop below is untouched.
    crate::evidence_reconcile::spawn(
        pg.clone(),
        dispatch_cfg.clone(),
        delivery_pool.clone(),
        evidence_redis_client,
    );

    // Ensure consumer group exists (idempotent).
    let _: redis::RedisResult<String> = redis::cmd("XGROUP")
        .arg("CREATE")
        .arg(channels::ALERTS_STREAM)
        .arg(&cfg.consumer_group)
        .arg("0")
        .arg("MKSTREAM")
        .query_async(&mut redis)
        .await;

    info!(
        group = %cfg.consumer_group,
        consumer = %cfg.consumer_name,
        "consumer group ready"
    );

    // Graceful shutdown (T6 audit): on SIGTERM/SIGINT set a flag; the loop below
    // finishes the in-flight process() (which XACKs) and exits BETWEEN reads, so a
    // `docker stop` never strands a read-but-unacked entry in the PEL. read_one
    // BLOCKs only 5s, so the flag is honored within 5s.
    let shutting_down = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let flag = shutting_down.clone();
        tokio::spawn(async move {
            wait_for_shutdown_signal().await;
            info!("shutdown signal — dispatcher will stop after the current entry");
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        });
    }

    // Recover PEL entries a PREVIOUS instance read but never XACK'd (SIGKILL / OOM
    // mid-process). XAUTOCLAIM reclaims + reprocesses them; redelivery is safe
    // (receivers dedup on the stable `x-pegana-event-id` header). Without this,
    // stranded alerts were never redelivered (T6 audit).
    if let Err(e) = reclaim_pending(
        &cfg,
        &pg,
        &mut redis,
        dispatch_cfg.clone(),
        delivery_pool.clone(),
    )
    .await
    {
        warn!(?e, "startup PEL reclaim failed — continuing");
    }

    // Reclaim is NOT a one-shot: a transient Postgres/Redis error mid-process()
    // (the fallible `?` calls before the terminal ack) leaves an entry read-but-
    // unacked in the PEL. Without a periodic sweep it would sit there until the
    // next restart (T6 startup reclaim). Re-run reclaim on an interval so a
    // stranded alert is redelivered within RECLAIM_INTERVAL, not "eventually".
    // Safe: only entries idle > MIN_IDLE_MS are claimed (never the in-flight one),
    // and reprocessing is deduped at the receiver. Reuses the loop's own `&mut redis`
    // (sequential, no second connection). `Instant` (monotonic) — not wall-clock.
    const RECLAIM_INTERVAL: std::time::Duration = std::time::Duration::from_secs(300);
    let mut last_reclaim = std::time::Instant::now();

    loop {
        if shutting_down.load(std::sync::atomic::Ordering::Relaxed) {
            let pending = delivery_pool.inflight();
            info!(pending, "shutdown: draining in-flight webhook deliveries");
            if delivery_pool.drain(Duration::from_secs(30)).await {
                info!("dispatcher exiting cleanly (all in-flight deliveries finished)");
            } else {
                warn!(
                    pending = delivery_pool.inflight(),
                    "drain timed out; remaining deliveries are abandoned (their stream entries were already acked)"
                );
            }
            break;
        }
        if last_reclaim.elapsed() >= RECLAIM_INTERVAL {
            if let Err(e) = reclaim_pending(
                &cfg,
                &pg,
                &mut redis,
                dispatch_cfg.clone(),
                delivery_pool.clone(),
            )
            .await
            {
                warn!(?e, "periodic PEL reclaim failed — continuing");
            }
            last_reclaim = std::time::Instant::now();
        }
        match read_one(&cfg, &mut redis).await {
            Ok(Some((id, event))) => {
                if let Err(e) = process(
                    &cfg,
                    &pg,
                    &mut redis,
                    &id,
                    &event,
                    dispatch_cfg.clone(),
                    delivery_pool.clone(),
                )
                .await
                {
                    error!(id = %id, ?e, "process failed");
                }
            }
            Ok(None) => {} // no new entries, will block again
            Err(e) => {
                warn!(?e, "stream read error");
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
    Ok(())
}

/// Wait for a graceful-shutdown signal (SIGTERM from `docker stop`, or Ctrl-C).
async fn wait_for_shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = ctrl_c => {}
                    _ = term.recv() => {}
                }
            }
            Err(_) => ctrl_c.await,
        }
    }
    #[cfg(not(unix))]
    {
        ctrl_c.await;
    }
}

/// Recover entries this consumer group READ but never XACK'd — reclaim entries idle
/// past `MIN_IDLE_MS` via XAUTOCLAIM and reprocess them (deduped downstream). Runs
/// once at startup so a prior hard-crash's stranded alerts are redelivered (T6).
async fn reclaim_pending(
    cfg: &DispatcherConfig,
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    dispatch_cfg: Arc<DispatchConfig>,
    delivery_pool: Arc<DeliveryPool>,
) -> Result<()> {
    const MIN_IDLE_MS: usize = 60_000; // well past a normal process()
    let mut cursor = "0-0".to_string();
    let mut reclaimed = 0usize;
    loop {
        let reply: redis::Value = redis::cmd("XAUTOCLAIM")
            .arg(channels::ALERTS_STREAM)
            .arg(&cfg.consumer_group)
            .arg(&cfg.consumer_name)
            .arg(MIN_IDLE_MS)
            .arg(&cursor)
            .arg("COUNT")
            .arg(20)
            .query_async(redis)
            .await?;
        // XAUTOCLAIM reply = [next_cursor, [entry, ...], [deleted_ids]]
        let arr = match &reply {
            redis::Value::Array(a) if a.len() >= 2 => a,
            _ => break,
        };
        let next_cursor = match &arr[0] {
            redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
            redis::Value::SimpleString(s) => s.clone(),
            _ => break,
        };
        let entries = match &arr[1] {
            redis::Value::Array(e) => e,
            _ => break,
        };
        // Count CLAIMED entries, not parsed ones: a round made only of
        // unreadable entries must not end the sweep and strand valid ones.
        let this_round = entries.len();
        for entry in entries {
            match parse_stream_entry(entry) {
                Some(ParsedEntry::Event(id, event)) => {
                    reclaimed += 1;
                    if let Err(e) = process(
                        cfg,
                        pg,
                        redis,
                        &id,
                        &event,
                        dispatch_cfg.clone(),
                        delivery_pool.clone(),
                    )
                    .await
                    {
                        // A readable event that failed to process stays pending: the
                        // cause is usually transient (Postgres/Redis), and moving it
                        // aside would lose a real alert. Only unreadable entries are
                        // dead-lettered.
                        error!(id = %id, ?e, "reclaimed PEL entry process failed");
                        metrics::counter!("pegana_dispatcher_reclaim_process_failed_total")
                            .increment(1);
                    }
                }
                Some(ParsedEntry::Unparseable { id, raw }) => {
                    if let Err(e) = dead_letter_if_poison(cfg, redis, &id, &raw).await {
                        warn!(id = %id, ?e, "poison check failed");
                    }
                }
                None => {}
            }
        }
        // "0-0" = scan wrapped; an empty round = nothing left claimable.
        if next_cursor == "0-0" || this_round == 0 {
            break;
        }
        cursor = next_cursor;
    }
    if reclaimed > 0 {
        info!(
            reclaimed,
            "recovered stranded PEL entries at startup (XAUTOCLAIM)"
        );
    }
    Ok(())
}

/// A claimed stream entry: either a readable event, or one this build cannot
/// parse (kept with its raw payload so a poison entry can be dead-lettered).
enum ParsedEntry {
    Event(String, AlertEvent),
    Unparseable { id: String, raw: String },
}

/// Parse one stream entry `[id, [k1,v1,...]]`. Shared by the XAUTOCLAIM recovery
/// path (the XREADGROUP path has its own inline copy).
fn parse_stream_entry(entry: &redis::Value) -> Option<ParsedEntry> {
    let parts = match entry {
        redis::Value::Array(p) => p,
        _ => return None,
    };
    if parts.len() < 2 {
        return None;
    }
    let id = match &parts[0] {
        redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
        redis::Value::SimpleString(s) => s.clone(),
        _ => return None,
    };
    let fields = match &parts[1] {
        redis::Value::Array(f) => f,
        _ => return None,
    };
    for chunk in fields.chunks(2) {
        if chunk.len() != 2 {
            continue;
        }
        let key = match &chunk[0] {
            redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
            _ => continue,
        };
        if key != "event" {
            continue;
        }
        let value = match &chunk[1] {
            redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
            _ => continue,
        };
        match serde_json::from_str::<AlertEvent>(&value) {
            Ok(event) => return Some(ParsedEntry::Event(id, event)),
            Err(e) => {
                // See decode_xread_one: never silently drop a parse failure.
                error!(
                    id = %id,
                    err = %e,
                    "failed to deserialize reclaimed AlertEvent off pegana:alerts"
                );
                metrics::counter!("pegana_dispatcher_alert_parse_failed_total").increment(1);
                return Some(ParsedEntry::Unparseable { id, raw: value });
            }
        }
    }
    // A readable id but no usable `event` field: unreadable all the same.
    Some(ParsedEntry::Unparseable {
        id,
        raw: format!("{fields:?}"),
    })
}

/// An entry delivered more than this many times without being acknowledged is
/// poison (corrupt, or unreadable by every build that has seen it).
const MAX_DELIVERIES: i64 = 10;
const ALERTS_DLQ: &str = "pegana:alerts:dlq";

/// Times Redis has delivered `id` to the group (XPENDING detail form).
async fn delivery_count(
    redis: &mut redis::aio::ConnectionManager,
    group: &str,
    id: &str,
) -> Result<i64> {
    let reply: redis::Value = redis::cmd("XPENDING")
        .arg(channels::ALERTS_STREAM)
        .arg(group)
        .arg(id)
        .arg(id)
        .arg(1)
        .query_async(redis)
        .await?;
    if let redis::Value::Array(rows) = reply {
        if let Some(redis::Value::Array(row)) = rows.first() {
            if let Some(redis::Value::Int(n)) = row.get(3) {
                return Ok(*n);
            }
        }
    }
    Ok(0)
}

/// Move an entry that keeps failing to `pegana:alerts:dlq` and acknowledge it,
/// so it stops looping through XAUTOCLAIM. Returns true when it was moved.
async fn dead_letter_if_poison(
    cfg: &DispatcherConfig,
    redis: &mut redis::aio::ConnectionManager,
    id: &str,
    raw: &str,
) -> Result<bool> {
    if delivery_count(redis, &cfg.consumer_group, id).await? <= MAX_DELIVERIES {
        return Ok(false);
    }
    let _: String = redis::cmd("XADD")
        .arg(ALERTS_DLQ)
        .arg("MAXLEN")
        .arg("~")
        .arg(10_000)
        .arg("*")
        .arg("source_id")
        .arg(id)
        .arg("event")
        .arg(raw)
        .query_async(redis)
        .await?;
    ack(redis, id, &cfg.consumer_group).await?;
    error!(id, "poison alert stream entry moved to {ALERTS_DLQ}");
    metrics::counter!("pegana_dispatcher_alert_poison_total").increment(1);
    Ok(true)
}

#[derive(Debug, Clone, Deserialize)]
struct DispatcherConfig {
    pub database_url: String,
    pub redis_url: String,
    #[serde(default = "default_group")]
    pub consumer_group: String,
    #[serde(default = "default_consumer")]
    pub consumer_name: String,
    /// Postgres pool ceiling. Default 20 (2× sqlx's default of 10) to absorb
    /// the webhook delivery fan-out without queueing on connection
    /// acquisition during an alert burst. Override via DB_MAX_CONNECTIONS.
    #[serde(default = "default_db_max_connections")]
    pub db_max_connections: u32,
    /// Per-connection `statement_timeout`, in ms (0 = unlimited). 30s backstop
    /// so a stuck query can't hang a delivery worker and pin a pool slot.
    /// Override via DB_STATEMENT_TIMEOUT_MS.
    #[serde(default = "default_db_statement_timeout_ms")]
    pub db_statement_timeout_ms: u64,
}

fn default_db_max_connections() -> u32 {
    20
}
fn default_db_statement_timeout_ms() -> u64 {
    30_000
}
fn default_group() -> String {
    "pegana-dispatcher".into()
}
fn default_consumer() -> String {
    "dispatcher-1".into()
}

impl DispatcherConfig {
    fn from_env() -> Result<Self> {
        let cfg: Self = envy::prefixed("").from_env().context("env")?;
        Ok(cfg)
    }
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .init();
}

/// Block-read up to 1 entry from the alerts stream.
async fn read_one(
    cfg: &DispatcherConfig,
    redis: &mut redis::aio::ConnectionManager,
) -> Result<Option<(String, AlertEvent)>> {
    let reply: redis::Value = redis::cmd("XREADGROUP")
        .arg("GROUP")
        .arg(&cfg.consumer_group)
        .arg(&cfg.consumer_name)
        .arg("BLOCK")
        .arg(5000) // ms
        .arg("COUNT")
        .arg(1)
        .arg("STREAMS")
        .arg(channels::ALERTS_STREAM)
        .arg(">")
        .query_async(redis)
        .await?;

    Ok(decode_xread_one(&reply))
}

/// Parse the (somewhat ugly) XREADGROUP reply for a single entry.
fn decode_xread_one(v: &redis::Value) -> Option<(String, AlertEvent)> {
    let streams = match v {
        redis::Value::Array(a) => a,
        redis::Value::Nil => return None,
        _ => return None,
    };
    for stream in streams {
        let stream_pair = match stream {
            redis::Value::Array(p) => p,
            _ => continue,
        };
        if stream_pair.len() < 2 {
            continue;
        }
        let entries = match &stream_pair[1] {
            redis::Value::Array(e) => e,
            _ => continue,
        };
        for entry in entries {
            let parts = match entry {
                redis::Value::Array(p) => p,
                _ => continue,
            };
            if parts.len() < 2 {
                continue;
            }
            let id = match &parts[0] {
                redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
                redis::Value::SimpleString(s) => s.clone(),
                _ => continue,
            };
            let fields = match &parts[1] {
                redis::Value::Array(f) => f,
                _ => continue,
            };
            // fields = [key1, value1, key2, value2, ...]
            for chunk in fields.chunks(2) {
                if chunk.len() != 2 {
                    continue;
                }
                let key = match &chunk[0] {
                    redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
                    _ => continue,
                };
                if key != "event" {
                    continue;
                }
                let value = match &chunk[1] {
                    redis::Value::BulkString(s) => String::from_utf8_lossy(s).to_string(),
                    _ => continue,
                };
                match serde_json::from_str::<AlertEvent>(&value) {
                    Ok(event) => return Some((id, event)),
                    Err(e) => {
                        // Do NOT silently drop: a parse failure here is almost
                        // always enum/field version-skew during a rolling deploy
                        // (an alert published in a shape this build can't read,
                        // possibly a BLACK_SWAN) or a corrupt payload. The entry is
                        // never XACK'd, so it re-loops via XAUTOCLAIM every
                        // RECLAIM_INTERVAL — which self-heals once the newer build
                        // takes over, but MUST be observable meanwhile so a truly
                        // poison entry pages instead of spinning invisibly.
                        error!(
                            id = %id,
                            err = %e,
                            "failed to deserialize AlertEvent off pegana:alerts — leaving it in the PEL for retry (version skew?) or manual handling"
                        );
                        metrics::counter!("pegana_dispatcher_alert_parse_failed_total")
                            .increment(1);
                    }
                }
            }
        }
    }
    None
}

enum Persisted {
    Missing,
    Deliver { event: AlertEvent, mismatch: bool },
}

/// The stream is a delivery hint; the persisted alert is the authority for what
/// is signed and sent. A DB error or an unreadable payload propagates so the
/// entry stays pending instead of being dropped.
async fn resolve_persisted_alert(pg: &PgPool, stream: &AlertEvent) -> Result<Persisted> {
    let row: Option<(serde_json::Value, String, String)> =
        sqlx::query_as("SELECT payload, asset, to_state::text FROM alerts WHERE id = $1")
            .bind(stream.id)
            .fetch_optional(pg)
            .await?;
    let Some((db_payload, db_asset, db_to_state)) = row else {
        return Ok(Persisted::Missing);
    };
    let event: AlertEvent = match serde_json::from_value(db_payload.clone()) {
        Ok(e) => e,
        Err(e) => {
            error!(alert_id = %stream.id, err = %e, "persisted alert payload not readable by this build; leaving pending");
            metrics::counter!("pegana_dispatcher_alert_parse_failed_total").increment(1);
            anyhow::bail!("persisted alert payload not readable");
        }
    };
    let mismatch = serde_json::to_value(stream).ok().as_ref() != Some(&db_payload)
        || db_asset != stream.asset
        || db_to_state != format::label(stream.to_state);
    Ok(Persisted::Deliver { event, mismatch })
}

// All arguments are required and unrelated — bundling them into a
// ProcessContext struct would just hide the surface without removing
// any. Suppress the clippy nit explicitly.
#[allow(clippy::too_many_arguments)]
async fn process(
    cfg: &DispatcherConfig,
    pg: &PgPool,
    redis: &mut redis::aio::ConnectionManager,
    id: &str,
    event: &AlertEvent,
    dispatch_cfg: Arc<DispatchConfig>,
    delivery_pool: Arc<DeliveryPool>,
) -> Result<()> {
    let event = match resolve_persisted_alert(pg, event).await? {
        Persisted::Missing => {
            error!(alert_id = %event.id, "alert stream entry has no persisted alert; acknowledging");
            metrics::counter!("pegana_dispatcher_alert_missing_total").increment(1);
            ack(redis, id, &cfg.consumer_group).await?;
            return Ok(());
        }
        Persisted::Deliver { event, mismatch } => {
            if mismatch {
                warn!(alert_id = %event.id, "alert stream copy differs from the persisted alert; delivering the persisted version");
                metrics::counter!("pegana_dispatcher_alert_mismatch_total").increment(1);
            }
            event
        }
    };
    let event = &event;

    // Beta cohort: assets flagged `monitoring_only` (migration 0048+) are the
    // provisional-calibration ("beta") set. They dispatch like any calibrated
    // asset, but every webhook payload is stamped `provisional` so receivers
    // can branch on it.
    let beta = asset_is_monitoring_only(pg, &event.asset).await?;
    if beta {
        debug!(
            asset = %event.asset,
            from = ?event.from_state,
            to = ?event.to_state,
            "beta (provisional-calibration) asset — dispatching with beta marker"
        );
        metrics::counter!(
            "pegana_dispatcher_beta_released_total",
            "asset" => event.asset.clone(),
        )
        .increment(1);
    }

    // Webhook fan-out — the dispatcher's only delivery channel.
    webhook_fanout(pg, event, dispatch_cfg, delivery_pool, beta).await;

    ack(redis, id, &cfg.consumer_group).await?;
    Ok(())
}

async fn webhook_fanout(
    pool: &PgPool,
    evt: &AlertEvent,
    dispatch_cfg: Arc<DispatchConfig>,
    sem: Arc<DeliveryPool>,
    beta: bool,
) {
    use crate::webhook::decimal_to_f64;
    use pegana_common::webhook_channel::render_for_channel;

    let discount_bps = (decimal_to_f64(evt.discount) * 10_000.0) as i32;
    let subs = match subs_for_asset(pool, &evt.asset, discount_bps).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error=?e, asset=%evt.asset, "webhook subs_for_asset failed");
            return;
        }
    };
    // ADR-0006: surface the audit row's lifecycle status so machine
    // consumers can distinguish "evidence_url will work" (ready) from
    // "evidence_url is still materializing" (pending) from "evidence_url
    // will 404 forever" (failed_permanent). Evaluated ONCE per alert
    // (was per-subscriber before the Wave 5 review — N*2 redundant DB
    // queries for the same alert_id, saved here).
    // Soft-fails to "unknown" on DB error so the alert dispatch never
    // blocks on an audit lookup hiccup (business rule #10).
    let evidence_status = lookup_evidence_status(pool, evt.id).await;
    let evt_id = evt.id;
    for sub in subs {
        let pg = pool.clone();
        let cfg = dispatch_cfg.clone();
        let evt = evt.clone();
        // Canonical event — the store-of-record. Discord/Slack bodies are
        // pure projections of this; the dead-letter keeps the canonical so
        // replay re-renders per the subscription's current channel.
        let canonical = serde_json::json!({
            "asset": evt.asset,
            // Wire labels via format::label — NOT the raw PegState serde, which
            // emits "BLACKSWAN" (no underscore) and would break machine parsing +
            // the documented `BLACK_SWAN` contract. See format::label.
            "from_state": format::label(evt.from_state),
            "to_state": format::label(evt.to_state),
            "discount_bps": (decimal_to_f64(evt.discount) * 10_000.0) as i64,
            "ts": evt.detected_at,
            "alert_id": evt.id,
            "evidence_url": format!("{}/audit/{}", cfg.audit_base_url, evt.id),
            "evidence_status": evidence_status,
            // Released `monitoring_only` (beta) asset → provisional signal.
            // Receivers can branch on this; additive so it never breaks the
            // Ed25519 signature contract (the new body is what we sign).
            "calibration": if beta { "provisional" } else { "calibrated" },
        });
        let overflow_canonical = canonical.clone();
        let task_pool = pool.clone();
        let sub_id = sub.id;
        let task = async move {
            let pool = task_pool;
            let rendered = render_for_channel(sub.channel_type, &canonical);
            let started = std::time::Instant::now();
            // Three write paths fire per attempt — kept separate on purpose:
            //   1. `dispatch_one` → INSERT into `webhook_deliveries`
            //      (one row per ATTEMPT; full audit log).
            //   2. `record_dispatch_result` → UPDATE `webhook_subscriptions`
            //      .last_status / .last_fired_at on terminal success
            //      (single-row "latest" snapshot; powers the inline
            //      health badge in the operator dashboard).
            //   3. `record_dead_letter` → INSERT into `webhook_dead_letter`
            //      on terminal failure (replay source).
            // The three tables answer three different operator
            // questions; do not collapse them.
            match dispatch_one(
                &cfg,
                Some(&pool),
                sub.id,
                &sub.url,
                evt.id,
                evt.id,
                &rendered.body,
                rendered.sign,
            )
            .await
            {
                Ok(status) => {
                    let _ = record_dispatch_result(&pool, sub.id, status as i16).await;
                    record_webhook_success_rate(&pool, sub.id).await;
                    // First successful webhook fan-out stamps
                    // `alerts.dispatched_at`; guarded UPDATE → safe to race the
                    // other spawned webhook tasks.
                    mark_dispatched(&pool, evt.id).await.ok();
                    metrics::counter!("pegana_webhook_dispatches_total", "status" => "ok")
                        .increment(1);
                    // A healthy delivery: re-send anything deferred for this
                    // subscriber while it was unreachable.
                    crate::replay::kick(&pool, &cfg, sub.id).await;
                }
                Err(err) => {
                    let _ = record_dead_letter(
                        &pool,
                        sub.id,
                        evt.id,
                        canonical,
                        &err.to_string(),
                        err.attempts() as i16,
                        None,
                    )
                    .await;
                    metrics::counter!("pegana_webhook_dispatches_total", "status" => "dead_letter")
                        .increment(1);
                    record_webhook_success_rate(&pool, sub.id).await;
                    tracing::warn!(sub_id=?sub.id, error=%err, "webhook dead-letter");
                }
            }
            metrics::histogram!("pegana_webhook_dispatch_latency_seconds")
                .record(started.elapsed().as_secs_f64());
        };
        if sem.try_spawn(task).is_err() {
            // The delivery queue is full: never block intake. Dead-letter the
            // delivery (replayable) and carry on.
            tracing::error!(sub_id = %sub_id, alert_id = %evt_id, "webhook delivery queue full; dead-lettering");
            let _ = record_dead_letter(
                &pg,
                sub_id,
                evt_id,
                overflow_canonical,
                &format!(
                    "{} delivery queue full",
                    crate::delivery::BREAKER_DEAD_LETTER_PREFIX
                ),
                0,
                None,
            )
            .await;
            metrics::counter!("pegana_webhook_dispatches_total", "status" => "queue_full")
                .increment(1);
        }
    }
}

/// Resolve `evidence_status` for the webhook payload (ADR-0006).
///
/// Returns one of `"ready" | "pending" | "failed_permanent" | "unknown"`.
/// Soft-fails to `"unknown"` on any DB error so the alert dispatch never
/// blocks on an audit lookup hiccup (business rule #10: deliver the
/// alert > persist evidence).
async fn lookup_evidence_status(pool: &PgPool, alert_id: uuid::Uuid) -> &'static str {
    // Path 1: receipt already persisted → "ready".
    match sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT alert_id FROM alert_evidence WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(_)) => return "ready",
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(
                ?e,
                %alert_id,
                "evidence_status lookup (evidence table) failed; payload will say unknown"
            );
            return "unknown";
        }
    }
    // Path 2/3: dead-letter queue → discriminate by failed_permanently_at.
    match sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
        "SELECT failed_permanently_at FROM alert_evidence_pending WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(Some(_))) => "failed_permanent",
        Ok(Some(None)) => "pending",
        // No row in either table — the synchronous push_alert path bypassed
        // both. Treat as unknown rather than misrepresenting as ready.
        Ok(None) => "unknown",
        Err(e) => {
            tracing::warn!(
                ?e,
                %alert_id,
                "evidence_status lookup (pending table) failed"
            );
            "unknown"
        }
    }
}

async fn record_webhook_success_rate(pool: &PgPool, subscription_id: uuid::Uuid) {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT
            count(*) FILTER (WHERE http_status >= 200 AND http_status < 300) AS ok,
            count(*) AS total
           FROM (
             SELECT http_status
               FROM webhook_deliveries
              WHERE subscription_id = $1
                AND NOT is_test
              ORDER BY attempted_at DESC
              LIMIT 100
           ) recent",
    )
    .bind(subscription_id)
    .fetch_one(pool)
    .await;

    match row {
        Ok((ok, total)) if total > 0 => {
            metrics::gauge!(
                "pegana_webhook_success_rate",
                "subscription_id" => subscription_id.to_string()
            )
            .set(ok as f64 / total as f64);
        }
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(
                sub_id = ?subscription_id,
                error = ?e,
                "webhook success-rate query failed"
            );
        }
    }
}

/// Stamp `alerts.dispatched_at` on the FIRST successful fan-out of this alert.
/// Idempotent + concurrency-safe: the `WHERE dispatched_at IS NULL` guard means
/// only the first caller wins, so every per-target success site can call this
/// unconditionally — later calls (and the fire-and-forget webhook tasks racing
/// each other) are cheap no-ops.
///
/// Before this, `dispatched_at` was a declared-but-never-written column: the
/// public `/v1/audit` row carried it (and the OpenAPI doc claimed it was
/// populated) while it stayed `null` forever. Wiring it here makes the public
/// ledger honest — a non-null timestamp now means "delivered to ≥1 subscriber".
/// Best-effort: a failure to stamp must never fail the delivery (the delivery
/// already succeeded; the `alert_deliveries` row is the source of truth), so
/// callers `.ok()` the result.
async fn mark_dispatched(pg: &PgPool, alert_id: uuid::Uuid) -> Result<()> {
    sqlx::query("UPDATE alerts SET dispatched_at = now() WHERE id = $1 AND dispatched_at IS NULL")
        .bind(alert_id)
        .execute(pg)
        .await?;
    Ok(())
}

async fn ack(redis: &mut redis::aio::ConnectionManager, id: &str, group: &str) -> Result<()> {
    let _: redis::Value = redis::cmd("XACK")
        .arg(channels::ALERTS_STREAM)
        .arg(group)
        .arg(id)
        .query_async(redis)
        .await?;
    Ok(())
}

#[cfg(test)]
mod persisted_alert_tests {
    use super::*;
    use pegana_common::{AssetClass, PegState, PegTarget};

    fn pg_url() -> Option<String> {
        std::env::var("PEGANA_INTEGRATION_PG_URL")
            .ok()
            .filter(|s| !s.is_empty())
    }

    fn event(id: uuid::Uuid) -> AlertEvent {
        AlertEvent {
            id,
            asset: "USDC".into(),
            class: AssetClass::StableFiat,
            peg_target: PegTarget::USD,
            from_state: PegState::Pegged,
            to_state: PegState::Drift,
            discount: rust_decimal::Decimal::new(1, 3),
            intrinsic_usd: rust_decimal::Decimal::ONE,
            market_usd: rust_decimal::Decimal::new(999, 3),
            extra: serde_json::json!({}),
            detected_at: chrono::Utc::now(),
        }
    }

    async fn seed(pg: &PgPool, e: &AlertEvent) {
        sqlx::query(
            r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                                   intrinsic_usd, market_usd, confidence, detected_at, payload)
               VALUES ($1, $2, 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                       0.001, 1.00, 0.999, 'high', NOW(), $3)"#,
        )
        .bind(e.id)
        .bind(&e.asset)
        .bind(serde_json::to_value(e).unwrap())
        .execute(pg)
        .await
        .expect("seed alert");
    }

    #[tokio::test]
    async fn missing_row_is_reported_and_matching_row_is_delivered() {
        let Some(url) = pg_url() else { return };
        let pg = PgPool::connect(&url).await.expect("connect pg");

        let ghost = event(uuid::Uuid::new_v4());
        assert!(matches!(
            resolve_persisted_alert(&pg, &ghost).await.unwrap(),
            Persisted::Missing
        ));

        let real = event(uuid::Uuid::new_v4());
        seed(&pg, &real).await;
        match resolve_persisted_alert(&pg, &real).await.unwrap() {
            Persisted::Deliver { event, mismatch } => {
                assert_eq!(event.id, real.id);
                assert!(!mismatch);
            }
            Persisted::Missing => panic!("row exists"),
        }

        // A stream copy with an extra/changed field is flagged, and the DB
        // version is what comes back.
        let mut skewed = real.clone();
        skewed.extra = serde_json::json!({"added_by_newer_engine": true});
        match resolve_persisted_alert(&pg, &skewed).await.unwrap() {
            Persisted::Deliver { event, mismatch } => {
                assert!(mismatch);
                assert_eq!(event.extra, serde_json::json!({}));
            }
            Persisted::Missing => panic!("row exists"),
        }
    }
}
