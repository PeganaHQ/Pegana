//! Shared application state for all indexer tasks.

use crate::config::Config;
use anyhow::Result;
use pegana_common::AssetsFile;
use rust_decimal::Decimal;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Snapshot of the latest Pyth price for one feed.
#[derive(Debug, Clone)]
#[allow(dead_code)] // confidence/publish_time consumed by engine (separate crate)
pub struct PythEntry {
    pub price: Decimal,
    pub confidence: Decimal,
    pub publish_time: chrono::DateTime<chrono::Utc>,
}

/// Shared in-memory cache of latest Pyth prices keyed by symbolic feed name (e.g. "SOL/USD").
pub type PythCache = Arc<RwLock<HashMap<String, PythEntry>>>;

/// Max age (seconds) of a Pyth numéraire reading before it is treated as STALE.
/// A stalled Pyth publisher keeps its last `publish_time`, so a frozen SOL/USD
/// would otherwise silently poison every USD intrinsic derived from it — and the
/// engine's own staleness gate cannot see it, because the indexer re-stamps
/// intrinsics with `now()` each tick. 120s = 10× the default on-chain poll
/// cadence (12s, `pyth::DEFAULT_ONCHAIN_POLL_MS`) and 2× the ~60s push-feed
/// heartbeat, so this only fires on a genuine sustained stall, never on
/// normal poll jitter.
///
/// On staleness the consumer falls through to the Jupiter-derived last resort
/// (`jupiter::numeraire_usd`), which is held to this same age bound. Only when
/// BOTH tiers are stale is the USD conversion skipped.
pub const PYTH_NUMERAIRE_STALE_SECS: i64 = 120;

/// Read a Pyth numéraire price that is present, non-zero, AND fresh. Returns `None`
/// when the feed is missing, zero, or stale (`publish_time` older than
/// [`PYTH_NUMERAIRE_STALE_SECS`]).
///
/// This is the Pyth tier of the numéraire guard. Consumers should call
/// [`crate::sources::jupiter::numeraire_usd`] instead, which layers the
/// Jupiter-derived last resort on top and only skips USD conversion when both
/// tiers are unusable. A stale numéraire must never be multiplied into a
/// fresh-looking intrinsic; on staleness this increments
/// `pegana_pyth_numeraire_stale_total{feed}` and warns.
pub async fn fresh_numeraire(pyth: &PythCache, feed: &str) -> Option<Decimal> {
    let (price, publish_time) = {
        let cache = pyth.read().await;
        let entry = cache.get(feed)?;
        (entry.price, entry.publish_time)
    };
    if price.is_zero() {
        return None;
    }
    let age = chrono::Utc::now() - publish_time;
    if age > chrono::Duration::seconds(PYTH_NUMERAIRE_STALE_SECS) {
        tracing::warn!(
            feed,
            age_secs = age.num_seconds(),
            "Pyth numéraire stale (publisher stalled) — skipping USD conversion so a \
             frozen price does not poison derived intrinsics"
        );
        metrics::counter!("pegana_pyth_numeraire_stale_total", "feed" => feed.to_string())
            .increment(1);
        return None;
    }
    Some(price)
}

/// Shared in-memory cache of latest Sanctum sol_value per LST symbol, in lamports.
pub type SanctumCache = Arc<RwLock<HashMap<String, u64>>>;

/// Application state. Cheap to clone (Arc inside).
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub assets: Arc<AssetsFile>,
    pub pg: PgPool,
    pub redis: redis::aio::ConnectionManager,
    /// REST client with a 15s whole-request timeout — for the short Jupiter /
    /// Sanctum / DexScreener calls.
    pub http: reqwest::Client,
    pub pyth: PythCache,
    pub sanctum_cache: SanctumCache,
    /// Reverse-lookup: Pyth feed_id (hex without 0x) → symbolic feed name.
    pub pyth_feed_lookup: Arc<HashMap<String, String>>,
}

impl AppState {
    pub async fn init(config: Config) -> Result<Self> {
        let mut assets = config.load_assets()?;
        let before = assets.assets.len();
        assets.assets.retain(|a| a.active);
        let after = assets.assets.len();
        if before != after {
            tracing::info!(
                deactivated = before - after,
                kept = after,
                "asset filter · skipped {} inactive entries from assets.toml",
                before - after
            );
        }
        // Pool safety net (mirror of api-rs, 2026-07-25 incident): sqlx's
        // default pool has NO statement_timeout, so a write stalled on a
        // TimescaleDB chunk lock would freeze ingestion. Size the pool above
        // the source fan-out and clamp any single statement. Env-overridable.
        let statement_timeout_ms = config.db_statement_timeout_ms;
        let pg = PgPoolOptions::new()
            .max_connections(config.db_max_connections)
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
            .connect(&config.database_url)
            .await?;
        let redis_client = redis::Client::open(config.redis_url.clone())?;
        let redis = redis::aio::ConnectionManager::new_with_config(
            redis_client.clone(),
            crate::sinks::redis_pub::connection_config(),
        )
        .await?;
        crate::sinks::redis_pub::init(redis_client);
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("pegana-indexer/0.1")
            .build()?;

        // Build feed_id → symbol map.
        let mut lookup = HashMap::new();
        for (sym, id) in &assets.pyth_feeds {
            let normalized = normalize_feed_id(id);
            lookup.insert(normalized, sym.clone());
        }

        Ok(Self {
            config: Arc::new(config),
            assets: Arc::new(assets),
            pg,
            redis,
            http,
            pyth: Arc::new(RwLock::new(HashMap::new())),
            sanctum_cache: Arc::new(RwLock::new(HashMap::new())),
            pyth_feed_lookup: Arc::new(lookup),
        })
    }

    /// Lst symbols that go to Sanctum (i.e. have intrinsic.kind = sanctum_lst).
    pub fn sanctum_symbols(&self) -> Vec<String> {
        use pegana_common::IntrinsicStrategy::*;
        self.assets
            .assets
            .iter()
            .filter_map(|a| match &a.intrinsic {
                SanctumLst { symbol } => Some(symbol.clone()),
                _ => None,
            })
            .collect()
    }
}

/// Strip 0x prefix if present, lowercase.
pub fn normalize_feed_id(s: &str) -> String {
    s.trim_start_matches("0x").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_with(feed: &str, price: Decimal, age_secs: i64) -> PythCache {
        let mut m = HashMap::new();
        m.insert(
            feed.to_string(),
            PythEntry {
                price,
                confidence: Decimal::ZERO,
                publish_time: chrono::Utc::now() - chrono::Duration::seconds(age_secs),
            },
        );
        Arc::new(RwLock::new(m))
    }

    #[tokio::test]
    async fn fresh_numeraire_returns_price_when_present_nonzero_fresh() {
        let cache = cache_with("SOL/USD", Decimal::from(150), 5);
        assert_eq!(
            fresh_numeraire(&cache, "SOL/USD").await,
            Some(Decimal::from(150))
        );
    }

    #[tokio::test]
    async fn fresh_numeraire_none_when_missing() {
        let cache = cache_with("SOL/USD", Decimal::from(150), 5);
        assert_eq!(fresh_numeraire(&cache, "BTC/USD").await, None);
    }

    #[tokio::test]
    async fn fresh_numeraire_none_when_zero() {
        let cache = cache_with("SOL/USD", Decimal::ZERO, 5);
        assert_eq!(fresh_numeraire(&cache, "SOL/USD").await, None);
    }

    #[tokio::test]
    async fn fresh_numeraire_none_when_stale() {
        // publish_time older than the 120s bound → stale publisher → skip.
        let cache = cache_with(
            "SOL/USD",
            Decimal::from(150),
            PYTH_NUMERAIRE_STALE_SECS + 10,
        );
        assert_eq!(fresh_numeraire(&cache, "SOL/USD").await, None);
    }

    #[tokio::test]
    async fn fresh_numeraire_ok_just_inside_bound() {
        // Exactly at the bound is still fresh (strict `>` for staleness).
        let cache = cache_with("SOL/USD", Decimal::from(150), PYTH_NUMERAIRE_STALE_SECS - 2);
        assert_eq!(
            fresh_numeraire(&cache, "SOL/USD").await,
            Some(Decimal::from(150))
        );
    }
}
