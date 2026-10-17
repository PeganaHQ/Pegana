//! Pyth Hermes SSE oracle stream.
//!
//! Subscribes to the union of feed IDs declared in `assets.toml`. On each message,
//! decodes the Pyth price-update payload, persists to `oracle_snapshots`, refreshes
//! the in-memory cache, and broadcasts on Redis pub/sub.
//!
//! Reconnects automatically with exponential backoff on transport errors.
//!
//! ## On-chain fallback (F-task #22)
//!
//! When Hermes fails (non-200, 401/403 on a dead API key, or a connection
//! error) the stream loop parks and polls Pyth's **on-chain** price accounts
//! instead, publishing through the exact same `handle_price` path so the
//! engine sees a byte-identical message shape. Hermes is re-probed on a slow
//! cadence (5 min) while the fallback keeps the numéraire fresh at 10-15s.
//!
//! The account address is **derived, never hardcoded**: Pyth's push-oracle
//! program (`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`) namespaces one
//! account per (shard, feed) as
//! `PDA([shard_id u16 LE, feed_id bytes])`, shard 0 being the sponsored
//! deployment. This is the same derivation as the official
//! `@pythnetwork/pyth-solana-receiver` SDK's `getPriceFeedAccountForProgram`.
//! No external mapping service is consulted, so the fallback keeps working
//! even when Hermes (and any id→account registry it might host) is 403.

use crate::config::pyth_bearer;
use crate::sinks;
use crate::state::{AppState, PythEntry};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use eventsource_stream::Eventsource;
use futures::StreamExt;
use pegana_common::{IntrinsicStrategy, MarketStrategy};
use rand::Rng;
use rust_decimal::Decimal;
use serde::Deserialize;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

/// If Hermes goes quiet for this long without closing the TCP connection we
/// treat the stream as stuck and force a reconnect. Hermes normally pushes
/// ~1Hz, so 60s of silence is well outside healthy behavior.
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// Default minimum gap between `intrinsic_snapshots` rows written for any
/// single redemption-rate feed. Hermes streams at ~1 Hz but issuer-attested
/// NAV feeds only step daily, so we throttle inserts to keep the table
/// readable. Overridden via `[polling].pyth_intrinsic_interval_ms` in
/// `assets.toml` or `PYTH_INTRINSIC_INTERVAL_MS` env.
const DEFAULT_INTRINSIC_INTERVAL_MS: u64 = 30_000;

// ---------------------------------------------------------------------------
// On-chain fallback primitives
// ---------------------------------------------------------------------------

/// Pyth push-oracle program on Solana mainnet. Accounts are PDAs under this
/// program; they are owned/written by the receiver program
/// (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`) but the derivation namespace
/// is this one (official SDK: `DEFAULT_PUSH_ORACLE_PROGRAM_ID`).
const PYTH_PUSH_ORACLE_PROGRAM_ID: &str = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";

/// Anchor account discriminator for `PriceUpdateV2`.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

/// Smallest fully-verified `PriceUpdateV2` account: 8 disc + 32 authority +
/// 1 verification tag + 32 feed id + 8 price + 8 conf + 4 exponent +
/// 8 publish_time + 8 prev_publish_time + 8 ema_price + 8 ema_conf +
/// 8 posted_slot = 133 bytes. (The SDK's `LEN` is 134, reserving one byte for
/// the `Partial { num_signatures }` payload.)
const PRICE_UPDATE_V2_MIN_LEN: usize = 133;

/// Default on-chain poll cadence while Hermes is down. Kept well inside the
/// 120s numéraire staleness gate (`state::PYTH_NUMERAIRE_STALE_SECS`) so the
/// SOL/USD leg never trips it between polls.
const DEFAULT_ONCHAIN_POLL_MS: u64 = 12_000;

/// How often to re-probe Hermes while the fallback is carrying the board.
const DEFAULT_HERMES_RETRY_MS: u64 = 300_000;

/// Floor for both fallback cadences, so a zero/typo'd env value cannot turn
/// the fallback into an RPC hammer.
const MIN_CADENCE_MS: u64 = 1_000;

/// Hard ceiling on an on-chain print's age. Deliberately generous: issuer-
/// attested NAV feeds legitimately step once a day, and the per-consumer gates
/// (numéraire 120s, engine `stale_source`) are the real freshness policy. This
/// only rejects feeds that have been dead for a week.
const DEFAULT_ONCHAIN_MAX_AGE_SECS: i64 = 7 * 24 * 3600;

/// Where a price came from. Affects only the latency metric, never the
/// published payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PriceOrigin {
    Hermes,
    OnChain,
}

/// A decoded on-chain `PriceUpdateV2`, in raw Pyth integer form.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OnChainPrice {
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
}

impl OnChainPrice {
    /// Convert to the same `ParsedPrice` shape the Hermes stream produces, so
    /// `handle_price` (and therefore every downstream sink) is shared verbatim.
    fn to_parsed_price(&self) -> ParsedPrice {
        ParsedPrice {
            id: format!("0x{}", hex_encode(&self.feed_id)),
            price: PriceTriplet {
                price: self.price.to_string(),
                conf: self.conf.to_string(),
                expo: self.exponent,
                publish_time: self.publish_time,
            },
        }
    }
}

/// One feed's on-chain coordinates, derived once at startup.
#[derive(Debug, Clone)]
struct OnChainFeed {
    name: String,
    feed_bytes: [u8; 32],
    pubkey: Pubkey,
}

/// Runtime knobs for the fallback, parsed once from env.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FallbackConfig {
    enabled: bool,
    poll_interval: Duration,
    hermes_retry: Duration,
    max_age_secs: i64,
}

impl FallbackConfig {
    fn from_env(flag: Option<&str>) -> Self {
        let poll = std::env::var("PYTH_ONCHAIN_POLL_MS").ok();
        let retry = std::env::var("PYTH_HERMES_RETRY_MS").ok();
        let max_age = std::env::var("PYTH_ONCHAIN_MAX_AGE_SECS").ok();
        Self::from_values(flag, poll.as_deref(), retry.as_deref(), max_age.as_deref())
    }

    fn from_values(
        flag: Option<&str>,
        poll_ms: Option<&str>,
        retry_ms: Option<&str>,
        max_age_secs: Option<&str>,
    ) -> Self {
        Self {
            enabled: parse_onchain_flag(flag),
            // Floor both cadences at 1s: `PYTH_ONCHAIN_POLL_MS=0` (or a typo'd
            // tiny value) must not turn the fallback into an RPC hammer.
            poll_interval: Duration::from_millis(
                parse_u64(poll_ms, DEFAULT_ONCHAIN_POLL_MS).max(MIN_CADENCE_MS),
            ),
            hermes_retry: Duration::from_millis(
                parse_u64(retry_ms, DEFAULT_HERMES_RETRY_MS).max(MIN_CADENCE_MS),
            ),
            max_age_secs: parse_i64(max_age_secs, DEFAULT_ONCHAIN_MAX_AGE_SECS).max(0),
        }
    }
}

fn parse_u64(raw: Option<&str>, default: u64) -> u64 {
    raw.and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_i64(raw: Option<&str>, default: i64) -> i64 {
    raw.and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

/// `PYTH_ONCHAIN_FALLBACK` semantics: unset/empty/1/true/on/yes → enabled;
/// 0/false/off/no → disabled. Anything else defaults ON (a broken knob must not
/// silently remove the only no-subscription price path) and warns.
fn parse_onchain_flag(raw: Option<&str>) -> bool {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("1") | Some("true") | Some("on") | Some("yes") => true,
        Some("0") | Some("false") | Some("off") | Some("no") => false,
        Some(other) => {
            warn!(
                value = other,
                "unrecognized PYTH_ONCHAIN_FALLBACK · defaulting to on"
            );
            true
        }
    }
}

/// Whether the supervisor should keep polling on-chain or spend a cycle
/// re-probing Hermes. Pure so the cadence is unit-testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PollDecision {
    Poll,
    RetryHermes,
}

fn poll_decision(elapsed_in_fallback: Duration, retry_after: Duration) -> PollDecision {
    if elapsed_in_fallback >= retry_after {
        PollDecision::RetryHermes
    } else {
        PollDecision::Poll
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn decode_feed_id(raw: &str) -> Result<[u8; 32]> {
    let hex = raw.trim().trim_start_matches("0x");
    if hex.len() != 64 {
        bail!(
            "pyth feed id must be 32 bytes of hex, got {} chars",
            hex.len()
        );
    }
    let mut out = [0u8; 32];
    for (i, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let s = std::str::from_utf8(pair).context("feed id is not ASCII hex")?;
        out[i] = u8::from_str_radix(s, 16).with_context(|| format!("bad hex byte {s:?}"))?;
    }
    Ok(out)
}

/// Derive the on-chain price account for a feed id. See the module docs for why
/// this needs no external id→account mapping.
fn price_feed_account(feed_id_hex: &str) -> Result<Pubkey> {
    let feed = decode_feed_id(feed_id_hex)?;
    let program =
        Pubkey::from_str(PYTH_PUSH_ORACLE_PROGRAM_ID).context("pyth push oracle program id")?;
    let shard = 0u16.to_le_bytes();
    Ok(Pubkey::find_program_address(&[&shard[..], &feed[..]], &program).0)
}

/// Decode a `PriceUpdateV2` account. Rejects anything that is not fully
/// guardian-verified or does not carry the expected feed id.
fn decode_price_update(data: &[u8], expected_feed_id: &[u8; 32]) -> Result<OnChainPrice> {
    if data.len() < PRICE_UPDATE_V2_MIN_LEN {
        bail!(
            "PriceUpdateV2 too short: {} bytes (need {PRICE_UPDATE_V2_MIN_LEN})",
            data.len()
        );
    }
    if data[..8] != PRICE_UPDATE_V2_DISCRIMINATOR {
        bail!("account is not a PriceUpdateV2 (discriminator mismatch)");
    }
    // 8..40 is the write authority. The Borsh enum tag follows.
    match data[40] {
        1 => {} // Full
        0 => bail!("price update is only partially verified"),
        other => bail!("unknown verification level tag {other}"),
    }
    let feed_id = &data[41..73];
    if feed_id != expected_feed_id {
        bail!(
            "account feed id {} does not match expected {}",
            hex_encode(feed_id),
            hex_encode(expected_feed_id)
        );
    }
    Ok(OnChainPrice {
        feed_id: expected_feed_id.to_owned(),
        price: i64::from_le_bytes(data[73..81].try_into().expect("8 bytes")),
        conf: u64::from_le_bytes(data[81..89].try_into().expect("8 bytes")),
        exponent: i32::from_le_bytes(data[89..93].try_into().expect("4 bytes")),
        publish_time: i64::from_le_bytes(data[93..101].try_into().expect("8 bytes")),
    })
}

#[derive(Debug, Deserialize)]
struct HermesUpdate {
    parsed: Option<Vec<ParsedPrice>>,
}

#[derive(Debug, Deserialize)]
struct ParsedPrice {
    id: String,
    price: PriceTriplet,
}

#[derive(Debug, Deserialize)]
struct PriceTriplet {
    /// Integer price as string (signed) — must scale by 10^expo.
    price: String,
    /// Confidence interval, same scale.
    conf: String,
    /// Power of 10; usually negative (e.g. -8 means price * 10^-8).
    expo: i32,
    /// Unix seconds.
    publish_time: i64,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let feed_ids = state.pyth_feed_ids();
    if feed_ids.is_empty() {
        warn!("no pyth feeds declared in assets.toml — pyth source idle");
        return Ok(());
    }

    // Precompute: for each Pyth feed used as a `pyth_redemption_rate`
    // intrinsic, the list of asset symbols that map to it. The same feed
    // could in principle back multiple assets (rare but cheap to support).
    let mut redemption_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut spot_map: HashMap<String, Vec<String>> = HashMap::new();
    for asset in &state.assets.assets {
        if let IntrinsicStrategy::PythRedemptionRate { feed } = &asset.intrinsic {
            redemption_map
                .entry(feed.clone())
                .or_default()
                .push(asset.symbol.clone());
        }
        if let MarketStrategy::PythSpot { feed } = &asset.market {
            spot_map
                .entry(feed.clone())
                .or_default()
                .push(asset.symbol.clone());
        }
    }
    if !redemption_map.is_empty() {
        info!(
            count = redemption_map.len(),
            "pyth: redemption-rate routing active"
        );
    }
    if !spot_map.is_empty() {
        info!(count = spot_map.len(), "pyth: spot-market routing active");
    }
    let redemption_map = Arc::new(redemption_map);
    let spot_map = Arc::new(spot_map);
    // Last-insert tracker so we don't fill `intrinsic_snapshots` / `market_snapshots` at 1 Hz.
    let last_intrinsic: Arc<Mutex<HashMap<String, DateTime<Utc>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let last_market: Arc<Mutex<HashMap<String, DateTime<Utc>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let intrinsic_interval_ms = std::env::var("PYTH_INTRINSIC_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .or(state.assets.polling.pyth_intrinsic_interval_ms)
        .unwrap_or(DEFAULT_INTRINSIC_INTERVAL_MS);

    let fallback = FallbackConfig::from_env(state.config.pyth_onchain_fallback.as_deref());
    if fallback.enabled {
        info!(
            poll_ms = fallback.poll_interval.as_millis(),
            hermes_retry_ms = fallback.hermes_retry.as_millis(),
            max_age_secs = fallback.max_age_secs,
            "pyth: on-chain fallback armed"
        );
    } else {
        info!("pyth: on-chain fallback disabled (PYTH_ONCHAIN_FALLBACK)");
    }
    let mut onchain_feeds = if fallback.enabled {
        build_onchain_feeds(&state)
    } else {
        Vec::new()
    };
    let (rpc, rpc_fallback) = if fallback.enabled {
        (
            Some(RpcClient::new_with_commitment(
                state.config.solana_rpc_url.clone(),
                CommitmentConfig::confirmed(),
            )),
            Some(RpcClient::new_with_commitment(
                state.config.solana_rpc_url_fallback.clone(),
                CommitmentConfig::confirmed(),
            )),
        )
    } else {
        (None, None)
    };

    let mut hermes_down = false;
    let mut backoff_ms: u64 = 500;
    loop {
        if shutdown.is_cancelled() {
            info!("pyth source shutdown");
            return Ok(());
        }

        // While Hermes is unhealthy, park on the on-chain accounts for the
        // retry window, then spend one cycle re-probing Hermes.
        if fallback.enabled && hermes_down {
            let entered = Instant::now();
            info!("pyth: hermes unhealthy · polling on-chain price accounts");
            while poll_decision(entered.elapsed(), fallback.hermes_retry) == PollDecision::Poll {
                if shutdown.is_cancelled() {
                    info!("pyth source shutdown");
                    return Ok(());
                }
                match poll_onchain(
                    &state,
                    &mut onchain_feeds,
                    rpc.as_ref()
                        .expect("rpc client present when fallback enabled"),
                    rpc_fallback
                        .as_ref()
                        .expect("rpc fallback present when fallback enabled"),
                    &redemption_map,
                    &spot_map,
                    &last_intrinsic,
                    &last_market,
                    intrinsic_interval_ms,
                    fallback.max_age_secs,
                )
                .await
                {
                    Ok(0) => debug!("pyth on-chain poll: no publishable feeds"),
                    Ok(n) => debug!(published = n, "pyth on-chain poll"),
                    Err(e) => warn!(error = %e, "pyth on-chain poll failed"),
                }
                tokio::select! {
                    _ = sleep(fallback.poll_interval) => {}
                    _ = shutdown.cancelled() => return Ok(()),
                }
            }
        }

        match run_once(
            &state,
            &feed_ids,
            redemption_map.clone(),
            spot_map.clone(),
            last_intrinsic.clone(),
            last_market.clone(),
            intrinsic_interval_ms,
            &shutdown,
        )
        .await
        {
            Ok(()) => {
                // graceful EOF — reconnect quickly
                backoff_ms = 500;
                hermes_down = false;
            }
            Err(e) => {
                warn!(error = %e, backoff_ms, "pyth stream error · reconnecting");
                if fallback.enabled {
                    // Skip the exponential backoff: the fallback loop above
                    // owns the cadence now and re-probes Hermes every 5 min.
                    hermes_down = true;
                    continue;
                }
            }
        }

        // Apply jitter so a cluster of pods that all restart at once don't
        // synchronize their reconnect waves into a thundering herd against
        // Hermes. ±50% around the base backoff is the standard mitigation.
        let jitter: f64 = rand::thread_rng().gen_range(0.5..=1.5);
        let effective_ms = ((backoff_ms as f64) * jitter) as u64;
        tokio::select! {
            _ = sleep(Duration::from_millis(effective_ms)) => {}
            _ = shutdown.cancelled() => return Ok(()),
        }
        backoff_ms = (backoff_ms * 2).min(30_000);
    }
}

/// Derive every configured feed's on-chain account once at startup.
fn build_onchain_feeds(state: &AppState) -> Vec<OnChainFeed> {
    let mut out = Vec::with_capacity(state.assets.pyth_feeds.len());
    for (name, raw_id) in &state.assets.pyth_feeds {
        let feed_id = crate::state::normalize_feed_id(raw_id);
        match (decode_feed_id(&feed_id), price_feed_account(&feed_id)) {
            (Ok(feed_bytes), Ok(pubkey)) => out.push(OnChainFeed {
                name: name.clone(),
                feed_bytes,
                pubkey,
            }),
            (Err(e), _) => {
                warn!(feed = %name, id = %feed_id, error = %e, "pyth: cannot derive on-chain account")
            }
            (_, Err(e)) => {
                warn!(feed = %name, id = %feed_id, error = %e, "pyth: cannot derive on-chain account")
            }
        }
    }
    info!(
        feeds = out.len(),
        "pyth: on-chain account map derived (no external mapping service)"
    );
    out
}

/// One batched `getMultipleAccounts` across every configured feed, publishing
/// each account through the shared `handle_price` path.
///
/// `feeds` is pruned in place: a feed whose account does not exist on-chain
/// (e.g. `USDY/USD.RR` today) is removed after the first miss. That matters
/// beyond saving bandwidth — `rpc::get_multiple_accounts_with_fallback` treats
/// *any* `None` in the batch as a primary failure and re-issues the whole call
/// against the fallback endpoint, so a permanently-missing account would
/// otherwise emit a bogus `pegana_rpc_primary_failed_total` and double the RPC
/// traffic on every poll for the length of the outage.
#[allow(clippy::too_many_arguments)]
async fn poll_onchain(
    state: &AppState,
    feeds: &mut Vec<OnChainFeed>,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    redemption_map: &HashMap<String, Vec<String>>,
    spot_map: &HashMap<String, Vec<String>>,
    last_intrinsic: &Mutex<HashMap<String, DateTime<Utc>>>,
    last_market: &Mutex<HashMap<String, DateTime<Utc>>>,
    intrinsic_interval_ms: u64,
    max_age_secs: i64,
) -> Result<usize> {
    if feeds.is_empty() {
        return Ok(0);
    }
    let pubkeys: Vec<Pubkey> = feeds.iter().map(|f| f.pubkey).collect();
    let (accounts, _slot) = crate::rpc::get_multiple_accounts_with_fallback(
        rpc,
        rpc_fallback,
        &pubkeys,
        "pyth_onchain",
    )
    .await?;

    let now = Utc::now();
    let mut published = 0usize;
    let mut missing: Vec<usize> = Vec::new();
    for (idx, maybe_account) in accounts.into_iter().enumerate() {
        let feed = &feeds[idx];
        let Some(account) = maybe_account else {
            metrics::counter!("pegana_pyth_onchain_missing_total", "feed" => feed.name.clone())
                .increment(1);
            debug!(feed = %feed.name, "pyth on-chain account missing · skipped");
            missing.push(idx);
            continue;
        };
        let decoded = match decode_price_update(&account.data, &feed.feed_bytes) {
            Ok(d) => d,
            Err(e) => {
                warn!(feed = %feed.name, error = %e, "pyth on-chain decode skipped");
                continue;
            }
        };
        let Some(publish_time) = Utc.timestamp_opt(decoded.publish_time, 0).single() else {
            warn!(feed = %feed.name, ts = decoded.publish_time, "invalid on-chain publish_time");
            continue;
        };
        let age_secs = (now - publish_time).num_seconds();
        if age_secs > max_age_secs {
            metrics::counter!("pegana_pyth_onchain_stale_total", "feed" => feed.name.clone())
                .increment(1);
            debug!(
                feed = %feed.name,
                age_secs,
                max_age_secs,
                "pyth on-chain print beyond max age · skipped"
            );
            continue;
        }
        // Never regress a fresher cached print (e.g. a late poll racing the
        // Hermes stream's first message after recovery).
        if let Some(prev) = state.pyth.read().await.get(&feed.name) {
            if prev.publish_time >= publish_time {
                continue;
            }
        }

        let parsed = decoded.to_parsed_price();
        match handle_price(
            state,
            &parsed,
            redemption_map,
            spot_map,
            last_intrinsic,
            last_market,
            intrinsic_interval_ms,
            PriceOrigin::OnChain,
        )
        .await
        {
            Ok(()) => published += 1,
            Err(e) => {
                warn!(feed = %feed.name, error = %e, "failed to persist on-chain pyth update")
            }
        }
    }

    // Drop feeds whose account does not exist, so subsequent polls neither
    // trip the batch helper's missing-account fallback nor re-log the same miss
    // every 12s for the duration of the outage. Remove back-to-front to keep
    // earlier indices valid.
    if !missing.is_empty() {
        let removed: Vec<String> = missing.iter().map(|&i| feeds[i].name.clone()).collect();
        for idx in missing.into_iter().rev() {
            feeds.remove(idx);
        }
        warn!(
            feeds = ?removed,
            remaining = feeds.len(),
            "pyth: no on-chain account for these feeds · dropped from the fallback batch"
        );
    }
    Ok(published)
}

#[allow(clippy::too_many_arguments)]
async fn run_once(
    state: &AppState,
    feed_ids: &[String],
    redemption_map: Arc<HashMap<String, Vec<String>>>,
    spot_map: Arc<HashMap<String, Vec<String>>>,
    last_intrinsic: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
    last_market: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
    intrinsic_interval_ms: u64,
    shutdown: &CancellationToken,
) -> Result<()> {
    let mut url = format!("{}/v2/updates/price/stream", state.config.pyth_hermes_url);
    for id in feed_ids {
        url.push_str(if url.contains('?') { "&" } else { "?" });
        url.push_str("ids%5B%5D=");
        url.push_str(id);
    }

    info!(
        feed_count = feed_ids.len(),
        "pyth: connecting to hermes stream"
    );
    // Use the streaming client (no whole-request timeout) — the shared 15s
    // `http` client guillotined this long-lived SSE stream every 15s.
    let req = state.http_stream.get(&url);
    let req = if let Some(auth) = pyth_bearer(state.config.pyth_hermes_api_key.as_deref()) {
        req.header(reqwest::header::AUTHORIZATION, auth)
    } else {
        req
    };
    let resp = req.send().await.context("hermes get")?;
    resp.error_for_status_ref()
        .context("hermes response status")?;
    let mut stream = resp.bytes_stream().eventsource();

    loop {
        if shutdown.is_cancelled() {
            return Ok(());
        }
        let next = match timeout(STREAM_IDLE_TIMEOUT, stream.next()).await {
            Ok(v) => v,
            Err(_) => {
                anyhow::bail!(
                    "pyth hermes idle for {}s · forcing reconnect",
                    STREAM_IDLE_TIMEOUT.as_secs()
                );
            }
        };
        let Some(event) = next else { break };
        let evt = event.context("sse event")?;
        if evt.data.is_empty() {
            continue;
        }
        let parsed: HermesUpdate = match serde_json::from_str(&evt.data) {
            Ok(p) => p,
            Err(e) => {
                debug!(error = %e, "skip malformed pyth message");
                continue;
            }
        };
        let prices = match parsed.parsed {
            Some(p) => p,
            None => continue,
        };

        for p in prices {
            if let Err(e) = handle_price(
                state,
                &p,
                &redemption_map,
                &spot_map,
                &last_intrinsic,
                &last_market,
                intrinsic_interval_ms,
                PriceOrigin::Hermes,
            )
            .await
            {
                warn!(feed_id = %p.id, error = %e, "failed to persist pyth update");
            }
        }
    }
    Ok(())
}

/// Source-side plausibility floor for a `pyth_spot` market price
/// (defense-in-depth, mirrors `jupiter::is_plausible_market_usd` + dexscreener's
/// `ensure!(price > 0)`). Rejects a near-zero / absurd Pyth print (a corrupt
/// `expo`, a feed glitch) BEFORE it reaches `market_snapshots` and the engine
/// EWMA. Critical for the pyth_spot-backed stables — USDC/USDT/USDG/USD1/AUSD
/// (stable_fiat) and USX (stable_dn) are NOT direction-sensitive, so the
/// engine's `discount_sanity` gate never fires for them; a floored zero could
/// otherwise drive a false CRITICAL/BLACK_SWAN on the flagship numéraire stables
/// (the exact JLP-2026-06-24 failure class, one asset-class over). Same generous
/// 0.001 floor + 1,000,000 absolute ceiling jupiter uses — no economic filter,
/// just a corrupt-value backstop. (#R4-2)
fn is_plausible_spot_price(price: Decimal) -> bool {
    price >= Decimal::new(1, 3) && price <= Decimal::from(1_000_000u32)
}

#[allow(clippy::too_many_arguments)]
async fn handle_price(
    state: &AppState,
    p: &ParsedPrice,
    redemption_map: &HashMap<String, Vec<String>>,
    spot_map: &HashMap<String, Vec<String>>,
    last_intrinsic: &Mutex<HashMap<String, DateTime<Utc>>>,
    last_market: &Mutex<HashMap<String, DateTime<Utc>>>,
    intrinsic_interval_ms: u64,
    origin: PriceOrigin,
) -> Result<()> {
    let feed_id = p.id.trim_start_matches("0x").to_lowercase();
    let feed_name = state
        .pyth_feed_lookup
        .get(&feed_id)
        .cloned()
        .unwrap_or_else(|| format!("0x{feed_id}"));

    let price = scale_price(&p.price.price, p.price.expo)?;
    let conf = scale_price(&p.price.conf, p.price.expo)?;
    let publish_time = Utc
        .timestamp_opt(p.price.publish_time, 0)
        .single()
        .context("invalid publish_time")?;

    // Hermes → indexer end-to-end latency per feed. Captures everything
    // upstream of our process: Pyth publisher signing, Hermes
    // aggregation, network hop, our SSE buffer. Goes negative if our
    // local clock drifts behind the signer's — clamp at 0 to keep the
    // histogram interpretable as "how stale is what we ingest".
    let latency_ms = (Utc::now() - publish_time).num_milliseconds().max(0) as f64;
    // Keep the Hermes histogram untouched (dashboards), and give the fallback
    // its own series so an on-chain outage is visible separately.
    let latency_metric = match origin {
        PriceOrigin::Hermes => "pegana_pyth_hermes_latency_seconds",
        PriceOrigin::OnChain => "pegana_pyth_onchain_latency_seconds",
    };
    metrics::histogram!(latency_metric, "feed" => feed_name.clone()).record(latency_ms / 1000.0);

    // 1. Update in-memory cache.
    {
        let mut cache = state.pyth.write().await;
        cache.insert(
            feed_name.clone(),
            PythEntry {
                price,
                confidence: conf,
                publish_time,
            },
        );
    }

    // 2. Persist to oracle_snapshots (idempotent on (feed, publish_time)).
    sinks::postgres::insert_oracle(
        &state.pg,
        &feed_name,
        &feed_id,
        price,
        Some(conf),
        publish_time,
    )
    .await?;

    // 3. Publish raw feed update to Redis (engine caches by feed name).
    let payload = serde_json::json!({
        "feed": feed_name,
        "feed_id": feed_id,
        "price": price,
        "confidence": conf,
        "publish_time": publish_time,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_PYTH,
        &payload,
        "pyth",
    )
    .await?;

    // 4. If any asset uses this feed as a `pyth_redemption_rate` intrinsic,
    //    fan out into `intrinsic_snapshots` (throttled) and publish a second
    //    Redis envelope with the asset symbol so the engine can immediately
    //    set the intrinsic + recompute.
    if let Some(assets) = redemption_map.get(&feed_name) {
        let now = Utc::now();
        let interval = chrono::Duration::milliseconds(intrinsic_interval_ms as i64);
        for asset_sym in assets {
            let should_write = {
                let mut guard = last_intrinsic.lock().await;
                match guard.get(asset_sym) {
                    Some(prev) if now - *prev < interval => false,
                    _ => {
                        guard.insert(asset_sym.clone(), now);
                        true
                    }
                }
            };
            if !should_write {
                continue;
            }
            let meta = serde_json::json!({
                "feed": feed_name,
                "feed_id": feed_id,
                "publish_time": publish_time,
                "source_kind": "pyth_redemption_rate",
            });
            if let Err(e) = sinks::postgres::insert_intrinsic(
                &state.pg,
                asset_sym,
                price,
                "pyth",
                meta.clone(),
                None,
                publish_time,
            )
            .await
            {
                warn!(asset = %asset_sym, error = %e, "intrinsic_snapshots insert failed");
                continue;
            }
            let asset_payload = serde_json::json!({
                "asset": asset_sym,
                "feed": feed_name,
                "feed_id": feed_id,
                "value_usd": price,
                "price": price,
                "confidence": conf,
                "publish_time": publish_time,
                "source": "pyth",
                "meta": meta,
            });
            if let Err(e) = sinks::redis_pub::publish(
                state.redis.clone(),
                pegana_common::channels::SRC_PYTH,
                &asset_payload,
            )
            .await
            {
                warn!(asset = %asset_sym, error = %e, "intrinsic redis publish failed");
            }
            metrics::counter!(
                "pegana_pyth_intrinsic_total",
                "asset" => asset_sym.clone()
            )
            .increment(1);
        }
    }

    // 5. If any asset uses this feed as a `pyth_spot` market source, fan
    //    out into `market_snapshots` (throttled same as intrinsic) and
    //    publish an asset-keyed envelope on SRC_PYTH so the engine can pick
    //    it up as market price and compute discount immediately.
    // #R4-2: gate the spot fan-out on a plausibility floor. Warn once (only when
    // this feed actually backs a spot asset) and skip the writes so a corrupt
    // near-zero print never lands in market_snapshots / the engine EWMA.
    let spot_price_ok = is_plausible_spot_price(price);
    if !spot_price_ok && spot_map.contains_key(&feed_name) {
        warn!(
            feed = %feed_name,
            %price,
            "implausible pyth_spot price · skipping market fan-out"
        );
    }
    if let Some(assets) = spot_map.get(&feed_name).filter(|_| spot_price_ok) {
        let now = Utc::now();
        let interval = chrono::Duration::milliseconds(intrinsic_interval_ms as i64);
        for asset_sym in assets {
            let should_write = {
                let mut guard = last_market.lock().await;
                match guard.get(asset_sym) {
                    Some(prev) if now - *prev < interval => false,
                    _ => {
                        guard.insert(asset_sym.clone(), now);
                        true
                    }
                }
            };
            if !should_write {
                continue;
            }
            if let Err(e) = sinks::postgres::insert_market(
                &state.pg,
                asset_sym,
                price,
                "USD",
                None,
                None,
                None,
                Some("pyth_spot"),
                publish_time,
            )
            .await
            {
                warn!(asset = %asset_sym, error = %e, "market_snapshots insert failed");
                continue;
            }
            let market_payload = serde_json::json!({
                "asset": asset_sym,
                "feed": feed_name,
                "feed_id": feed_id,
                "market_usd": price,
                "numeraire": "USD",
                "publish_time": publish_time,
                "source": "pyth_spot",
            });
            if let Err(e) = sinks::redis_pub::publish(
                state.redis.clone(),
                pegana_common::channels::SRC_PYTH,
                &market_payload,
            )
            .await
            {
                warn!(asset = %asset_sym, error = %e, "market redis publish failed");
            }
            metrics::counter!(
                "pegana_pyth_market_total",
                "asset" => asset_sym.clone()
            )
            .increment(1);
        }
    }

    metrics::counter!("pegana_pyth_updates_total", "feed" => feed_name.clone()).increment(1);
    if origin == PriceOrigin::OnChain {
        metrics::counter!("pegana_pyth_onchain_updates_total", "feed" => feed_name).increment(1);
    }
    Ok(())
}

fn scale_price(integer_str: &str, expo: i32) -> Result<Decimal> {
    // Pyth gives integer with expo (usually negative). We multiply: price * 10^expo.
    let n = Decimal::from_str(integer_str).context("price parse")?;
    if expo == 0 {
        return Ok(n);
    }
    if expo < 0 {
        let abs = expo.unsigned_abs();
        if abs > 28 {
            anyhow::bail!("pyth exponent {expo} exceeds Decimal max scale 28");
        }
        // i128, not u64: `10u64.pow(abs)` overflows for abs >= 20 (10^20 > u64::MAX).
        // 10^28 fits both i128 and Decimal (max ~7.9e28). Identical result to the old
        // u64 form for the reachable range (Pyth expo is -6..-9); now overflow-safe to -28.
        let pow = Decimal::from_i128_with_scale(10i128.pow(abs), 0);
        // checked_div for consistency with the checked_mul branch below + the
        // "fuzz every Decimal div" discipline. `pow` is a hardcoded power of ten
        // (>= 10), so this can't actually divide-by-zero or overflow — but a raw
        // `/` is the one exception the F-12 sweep left, and uniformity matters
        // more than the micro-proof. (audit 2026-07-18)
        n.checked_div(pow)
            .context("pyth negative-expo scale division")
    } else {
        let e = expo as u32;
        if e > 28 {
            anyhow::bail!("pyth exponent {expo} exceeds Decimal max scale 28");
        }
        let pow = Decimal::from_i128_with_scale(10i128.pow(e), 0);
        // checked_mul (audit F-12): a POSITIVE Pyth expo (abnormal — Pyth is
        // normally -6..-9) with a large mantissa overflows Decimal on multiply →
        // PANIC. Treat as a bad feed (Err), never a crash. This is the ROOT price
        // input; bounding it here bounds every downstream `× price` product.
        n.checked_mul(pow)
            .context("pyth positive-expo price overflows Decimal")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pegana_common::AssetsFile;

    #[test]
    fn scale_negative_expo() {
        // 12345 with expo -2 → 123.45
        let v = scale_price("12345", -2).unwrap();
        assert_eq!(v, Decimal::from_str("123.45").unwrap());
    }

    #[test]
    fn spot_price_floor_rejects_corrupt_prints_keeps_real_ones() {
        // #R4-2: a near-zero print (corrupt expo / feed glitch) is rejected
        // before it can poison the engine EWMA for USDC/USDT etc.
        assert!(!is_plausible_spot_price(Decimal::ZERO));
        assert!(!is_plausible_spot_price(
            Decimal::from_str("0.0000001").unwrap()
        ));
        assert!(!is_plausible_spot_price(Decimal::from(5_000_000u32)));
        // Real stable prices — pegged, drifted, and deeply depegged — all pass.
        assert!(is_plausible_spot_price(Decimal::ONE));
        assert!(is_plausible_spot_price(Decimal::from_str("0.92").unwrap()));
        assert!(is_plausible_spot_price(Decimal::from_str("0.65").unwrap()));
        // Exactly at the 0.001 floor is allowed (>=).
        assert!(is_plausible_spot_price(Decimal::new(1, 3)));
    }

    #[test]
    fn scale_eight_decimals() {
        // SOL/USD shape: e.g. 23000000000 expo=-8 → 230.0
        let v = scale_price("23000000000", -8).unwrap();
        assert_eq!(v, Decimal::from_str("230").unwrap());
    }

    #[test]
    fn scale_rejects_expo_beyond_decimal_scale() {
        let normal = scale_price("23000000000", -8).unwrap();
        assert_eq!(normal, Decimal::from_str("230").unwrap());

        let err = scale_price("42", -29).expect_err("expo below -28 must skip instead of clamp");
        assert!(
            err.to_string().contains("pyth exponent -29"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn scale_handles_exponent_beyond_u64_pow_without_overflow() {
        // abs in 20..=28: `10u64.pow(abs)` overflows u64 (10^20 > u64::MAX) — the
        // i128 path must compute the value exactly instead of panicking/wrapping.
        let v = scale_price("5", -25).expect("expo -25 is within Decimal scale 28");
        assert_eq!(v, Decimal::from_str("0.0000000000000000000000005").unwrap());
        // Reachable Pyth range stays byte-identical to the old u64 form.
        let normal = scale_price("23000000000", -8).unwrap();
        assert_eq!(normal, Decimal::from_str("230").unwrap());
    }

    #[test]
    fn scale_positive_expo_overflow_is_err_not_panic() {
        // Audit F-12: a POSITIVE expo (abnormal for Pyth) with a large mantissa
        // makes `mantissa * 10^expo` exceed Decimal's ~7.9e28 ceiling. The raw `*`
        // would PANIC; checked_mul must degrade to Err (bad feed), never crash the
        // poll. 10^28 (expo=28, within the scale guard) × a 20-digit mantissa
        // ≈ 1e47 ≫ Decimal::MAX.
        let err = scale_price("99999999999999999999", 28)
            .expect_err("positive-expo overflow must be Err, not a panic");
        assert!(
            err.to_string().contains("overflows Decimal"),
            "unexpected error: {err:#}"
        );
        // A small positive expo that stays in range still scales normally.
        let ok = scale_price("42", 2).expect("42 × 10^2 fits");
        assert_eq!(ok, Decimal::from_str("4200").unwrap());
    }

    #[test]
    fn scale_zero_expo() {
        let v = scale_price("42", 0).unwrap();
        assert_eq!(v, Decimal::from(42));
    }

    // ---- on-chain fallback (F-task #22) ------------------------------------

    const SOL_FEED: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const USDC_FEED: &str = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

    /// Build a synthetic fully-verified `PriceUpdateV2` account buffer.
    fn synthetic_price_update(
        verification_tag: u8,
        feed: &[u8; 32],
        price: i64,
        conf: u64,
        expo: i32,
        publish_time: i64,
    ) -> Vec<u8> {
        let mut v = Vec::with_capacity(134);
        v.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        v.extend_from_slice(&[7u8; 32]); // write authority
        v.push(verification_tag);
        if verification_tag == 0 {
            v.push(3); // Partial { num_signatures }
        }
        v.extend_from_slice(feed);
        v.extend_from_slice(&price.to_le_bytes());
        v.extend_from_slice(&conf.to_le_bytes());
        v.extend_from_slice(&expo.to_le_bytes());
        v.extend_from_slice(&publish_time.to_le_bytes());
        v.extend_from_slice(&0i64.to_le_bytes()); // prev_publish_time
        v.extend_from_slice(&0i64.to_le_bytes()); // ema_price
        v.extend_from_slice(&0u64.to_le_bytes()); // ema_conf
        v.extend_from_slice(&0u64.to_le_bytes()); // posted_slot
        v
    }

    /// Derivation is the whole mapping source: no hardcoded addresses, no
    /// external registry. These two vectors were captured from mainnet
    /// (2026-10-17) and independently re-derived with the official JS SDK's
    /// `getPriceFeedAccountForProgram(0, feedId)`.
    #[test]
    fn price_feed_account_matches_mainnet_vectors() {
        assert_eq!(
            price_feed_account(SOL_FEED).unwrap().to_string(),
            "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        );
        assert_eq!(
            price_feed_account(USDC_FEED).unwrap().to_string(),
            "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        );
    }

    #[test]
    fn every_configured_feed_derives_a_distinct_onchain_account() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");
        let mut seen = std::collections::HashSet::new();
        for (name, id) in &parsed.pyth_feeds {
            let account = price_feed_account(id).unwrap_or_else(|e| {
                panic!("feed {name} ({id}) must derive an on-chain account: {e}")
            });
            assert!(
                seen.insert(account),
                "feed {name} ({id}) derived a duplicate account {account} — \
                 the derivation must be feed-specific"
            );
        }
        assert_eq!(seen.len(), parsed.pyth_feeds.len());
    }

    #[test]
    fn decode_price_update_v2_reads_price_conf_and_time() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let buf = synthetic_price_update(1, &feed, 10_498_834_127, 3_168_114, -8, 1_792_222_702);
        let p = decode_price_update(&buf, &feed).unwrap();
        assert_eq!(p.feed_id, feed);
        assert_eq!(p.price, 10_498_834_127);
        assert_eq!(p.conf, 3_168_114);
        assert_eq!(p.exponent, -8);
        assert_eq!(p.publish_time, 1_792_222_702);
    }

    /// Decode two REAL mainnet `PriceUpdateV2` accounts (captured 2026-10-17)
    /// so the parser is pinned to actual bytes, not just synthetic ones.
    /// SOL/USD and USDC/USD cover the two structural shapes that matter: the
    /// 8-decimal numéraire and an 8-decimal $1 stable.
    #[test]
    fn decodes_real_mainnet_price_accounts() {
        // Raw getAccountInfo base64 payloads for the two derived PDAs.
        const SOL_USD_ACCOUNT: &str = "IvEjY51+9M1gMUcENA3t3zcf1CRyFI8kjp0abRpesqw6zYt/1dayQwHvDYtv2izrpB2hXUCV0do5Kg0vjtDGx7wPTPrIwoC1bc9+x3ECAAAAclcwAAAAAAD4////7iXTagAAAADtJdNqAAAAAJbsvnACAAAA9ao1AAAAAABr3EsbAAAAAAA=";
        const USDC_USD_ACCOUNT: &str = "IvEjY51+9M2+k5qDCfVkBxh//zCsVLFpSYvpn22OG/1CRGgM1PfR4gHqoCDGHMR5cSgTRhzhU4lKlqbACyHtDPwnmNH5qenJSt+s9QUAAAAAKYkBAAAAAAD4////0C3TagAAAADPLdNqAAAAALW39QUAAAAAIKMBAAAAAACkAEwbAAAAAAA=";

        use base64::Engine as _;
        let sol = base64::engine::general_purpose::STANDARD
            .decode(SOL_USD_ACCOUNT)
            .unwrap();
        let usdc = base64::engine::general_purpose::STANDARD
            .decode(USDC_USD_ACCOUNT)
            .unwrap();

        let sol = decode_price_update(&sol, &decode_feed_id(SOL_FEED).unwrap()).unwrap();
        assert_eq!(sol.price, 10_498_834_127);
        assert_eq!(sol.conf, 3_168_114);
        assert_eq!(sol.exponent, -8);
        assert_eq!(
            scale_price(&sol.price.to_string(), sol.exponent).unwrap(),
            Decimal::from_str("104.98834127").unwrap()
        );

        let usdc = decode_price_update(&usdc, &decode_feed_id(USDC_FEED).unwrap()).unwrap();
        assert_eq!(usdc.price, 99_986_655);
        assert_eq!(usdc.conf, 100_649);
        assert_eq!(usdc.exponent, -8);
        assert_eq!(
            scale_price(&usdc.price.to_string(), usdc.exponent).unwrap(),
            Decimal::from_str("0.99986655").unwrap()
        );
    }

    /// The fallback must hand the engine the *same* shape the Hermes path does,
    /// so `handle_price` (and every downstream sink) stays shared. This proves
    /// an on-chain decode and an equivalent Hermes message scale identically.
    #[test]
    fn onchain_decode_matches_hermes_message_shape() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let buf = synthetic_price_update(1, &feed, 10_498_834_127, 3_168_114, -8, 1_792_222_702);
        let onchain = decode_price_update(&buf, &feed).unwrap().to_parsed_price();

        let hermes = ParsedPrice {
            id: SOL_FEED.to_string(),
            price: PriceTriplet {
                price: "10498834127".to_string(),
                conf: "3168114".to_string(),
                expo: -8,
                publish_time: 1_792_222_702,
            },
        };

        assert_eq!(onchain.id, hermes.id);
        assert_eq!(
            onchain.price.publish_time, hermes.price.publish_time,
            "publish_time parity keeps the engine's staleness gate meaningful"
        );
        assert_eq!(
            scale_price(&onchain.price.price, onchain.price.expo).unwrap(),
            scale_price(&hermes.price.price, hermes.price.expo).unwrap()
        );
        assert_eq!(
            scale_price(&onchain.price.conf, onchain.price.expo).unwrap(),
            scale_price(&hermes.price.conf, hermes.price.expo).unwrap()
        );
    }

    #[test]
    fn decode_rejects_mismatched_feed_id_and_partial_verification() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let other = decode_feed_id(USDC_FEED).unwrap();

        let buf = synthetic_price_update(1, &feed, 1, 1, -8, 1);
        assert!(
            decode_price_update(&buf, &other).is_err(),
            "a swapped feed id must be rejected, never mis-attributed"
        );

        let partial = synthetic_price_update(0, &feed, 1, 1, -8, 1);
        let err = decode_price_update(&partial, &feed).expect_err("partial must be rejected");
        assert!(err.to_string().contains("partially verified"), "{err}");
    }

    #[test]
    fn decode_rejects_short_or_wrong_discriminator() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        assert!(decode_price_update(&[0u8; 40], &feed).is_err());

        let mut buf = synthetic_price_update(1, &feed, 1, 1, -8, 1);
        buf[0] = 0xff;
        assert!(decode_price_update(&buf, &feed).is_err());
    }

    #[test]
    fn feed_id_decode_rejects_bad_input() {
        assert!(decode_feed_id("0x1234").is_err());
        assert!(decode_feed_id(&"zz".repeat(32)).is_err());
        // "0x" prefix is optional and case-insensitive.
        assert_eq!(
            decode_feed_id(&SOL_FEED[2..].to_uppercase()).unwrap(),
            decode_feed_id(SOL_FEED).unwrap()
        );
    }

    #[test]
    fn onchain_flag_defaults_on_and_accepts_1() {
        assert!(parse_onchain_flag(None), "unset must default ON");
        assert!(parse_onchain_flag(Some("")), "empty must default ON");
        for on in ["1", "true", "TRUE", " on ", "yes"] {
            assert!(parse_onchain_flag(Some(on)), "{on:?} should be ON");
        }
        for off in ["0", "false", "False", "off", "no"] {
            assert!(!parse_onchain_flag(Some(off)), "{off:?} should be OFF");
        }
        // A malformed knob must not silently disable the only no-subscription path.
        assert!(parse_onchain_flag(Some("banana")));
    }

    #[test]
    fn fallback_config_defaults_and_overrides() {
        let d = FallbackConfig::from_values(None, None, None, None);
        assert!(d.enabled);
        assert_eq!(
            d.poll_interval,
            Duration::from_millis(DEFAULT_ONCHAIN_POLL_MS)
        );
        assert_eq!(
            d.hermes_retry,
            Duration::from_millis(DEFAULT_HERMES_RETRY_MS)
        );
        assert_eq!(d.max_age_secs, DEFAULT_ONCHAIN_MAX_AGE_SECS);

        let o = FallbackConfig::from_values(Some("0"), Some("5000"), Some("60000"), Some("3600"));
        assert!(!o.enabled);
        assert_eq!(o.poll_interval, Duration::from_millis(5_000));
        assert_eq!(o.hermes_retry, Duration::from_millis(60_000));
        assert_eq!(o.max_age_secs, 3_600);

        // Garbage cadence values fall back to the defaults rather than 0s, and
        // a negative age ceiling clamps to 0 (never a negative window).
        let g = FallbackConfig::from_values(Some("1"), Some("nope"), Some(""), Some("-5"));
        assert_eq!(
            g.poll_interval,
            Duration::from_millis(DEFAULT_ONCHAIN_POLL_MS)
        );
        assert_eq!(g.max_age_secs, 0);

        // A zero cadence must clamp to the floor, never to 0/1ms (RPC hammer).
        let z = FallbackConfig::from_values(Some("1"), Some("0"), Some("0"), None);
        assert_eq!(z.poll_interval, Duration::from_millis(MIN_CADENCE_MS));
        assert_eq!(z.hermes_retry, Duration::from_millis(MIN_CADENCE_MS));
    }

    /// The numéraire must stay well inside its 120s staleness gate: the default
    /// poll cadence has to be far below it.
    #[test]
    fn default_poll_cadence_beats_the_numeraire_staleness_gate() {
        let d = FallbackConfig::from_values(None, None, None, None);
        assert!(
            d.poll_interval < Duration::from_secs(crate::state::PYTH_NUMERAIRE_STALE_SECS as u64),
            "default on-chain poll must be < the {}s numeraire gate",
            crate::state::PYTH_NUMERAIRE_STALE_SECS
        );
    }

    #[test]
    fn poll_decision_polls_until_the_retry_window_elapses() {
        let retry = Duration::from_secs(300);
        assert_eq!(
            poll_decision(Duration::from_secs(0), retry),
            PollDecision::Poll
        );
        assert_eq!(
            poll_decision(Duration::from_secs(299), retry),
            PollDecision::Poll
        );
        assert_eq!(
            poll_decision(Duration::from_secs(300), retry),
            PollDecision::RetryHermes,
            "at the deadline we re-probe hermes exactly once"
        );
        assert_eq!(
            poll_decision(Duration::from_secs(1_000), retry),
            PollDecision::RetryHermes
        );
    }

    /// USDY's intrinsic should resolve to a `pyth_redemption_rate` strategy
    /// pointing at the `USDY/USD.RR` feed declared in `[pyth_feeds]`.
    /// This is a structural check that the routing map the source builds
    /// in `run()` will pick USDY up after the Task 4 configuration change.
    #[test]
    fn assets_toml_wires_usdy_to_usdy_rr_feed() {
        let raw = include_str!("../../../../assets.toml");
        let parsed: AssetsFile = toml::from_str(raw).expect("assets.toml parses");

        let usdy = parsed
            .assets
            .iter()
            .find(|a| a.symbol == "USDY")
            .expect("USDY present in universe");

        match &usdy.intrinsic {
            IntrinsicStrategy::PythRedemptionRate { feed } => {
                assert_eq!(
                    feed, "USDY/USD.RR",
                    "USDY must reference the USDY/USD.RR feed"
                );
            }
            other => panic!("USDY intrinsic must be pyth_redemption_rate, got {other:?}"),
        }

        let feed_id = parsed
            .pyth_feeds
            .get("USDY/USD.RR")
            .expect("USDY/USD.RR present in [pyth_feeds]");
        // Confirmed via benchmarks.pyth.network — Ondo-attested redemption
        // rate (asset_type=Crypto Redemption Rate, base=USDY).
        assert_eq!(
            feed_id.trim_start_matches("0x").to_lowercase(),
            "e3d1723999820435ebab53003a542ff26847720692af92523eea613a9a28d500"
        );
    }

    /// Guard: every asset whose intrinsic/market is Pyth-fed MUST have its feed
    /// name registered in `[pyth_feeds]`, or the indexer never subscribes to it
    /// and the asset locks at UNKNOWN. verify-assets does NOT catch this.
    #[test]
    fn every_pyth_fed_asset_feed_is_registered() {
        let raw =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets.toml"))
                .expect("read assets.toml");
        let af: pegana_common::AssetsFile = toml::from_str(&raw).expect("parse assets.toml");
        let registered: std::collections::HashSet<&str> =
            af.pyth_feeds.keys().map(|s| s.as_str()).collect();
        let mut missing = Vec::new();
        for a in &af.assets {
            if !a.active {
                continue;
            }
            if let pegana_common::IntrinsicStrategy::PythRedemptionRate { feed }
            | pegana_common::IntrinsicStrategy::PythFxCross { feed, .. } = &a.intrinsic
            {
                if !registered.contains(feed.as_str()) {
                    missing.push(format!("{} intrinsic feed {}", a.symbol, feed));
                }
            }
            if let pegana_common::MarketStrategy::PythSpot { feed } = &a.market {
                if !registered.contains(feed.as_str()) {
                    missing.push(format!("{} market feed {}", a.symbol, feed));
                }
            }
        }
        assert!(missing.is_empty(), "unregistered Pyth feeds: {missing:?}");
    }

    /// syrupUSDC's intrinsic should resolve to a `pyth_redemption_rate`
    /// strategy pointing at the `SYRUPUSDC/USDC.RR` feed declared in
    /// `[pyth_feeds]` — same routing shape as USDY (Task 4) but with USDC as
    /// the quote currency. Underlying ≈ $1, so the feed value is USD NAV.
    #[test]
    fn assets_toml_wires_syrup_usdc_to_rr_feed() {
        let raw = include_str!("../../../../assets.toml");
        let parsed: AssetsFile = toml::from_str(raw).expect("assets.toml parses");

        let syrup = parsed
            .assets
            .iter()
            .find(|a| a.symbol == "syrupUSDC")
            .expect("syrupUSDC present in universe");

        match &syrup.intrinsic {
            IntrinsicStrategy::PythRedemptionRate { feed } => {
                assert_eq!(
                    feed, "SYRUPUSDC/USDC.RR",
                    "syrupUSDC must reference the SYRUPUSDC/USDC.RR feed"
                );
            }
            other => panic!("syrupUSDC intrinsic must be pyth_redemption_rate, got {other:?}"),
        }

        let feed_id = parsed
            .pyth_feeds
            .get("SYRUPUSDC/USDC.RR")
            .expect("SYRUPUSDC/USDC.RR present in [pyth_feeds]");
        // Confirmed via benchmarks.pyth.network — Maple-attested redemption
        // rate (asset_type=Crypto Redemption Rate, base=SYRUPUSDC,
        // quote=USDC, contract_id=eth:0x80ac24aA...).
        assert_eq!(
            feed_id.trim_start_matches("0x").to_lowercase(),
            "2ad31d1c4a85fbf2156ce57fab4104124c5ef76a6386375ecfc8da1ed5ce1486"
        );
    }
}
