//! Pyth price source: on-chain push-oracle accounts only.
//!
//! Polls Pyth's sponsored `PriceUpdateV2` accounts on Solana with one batched
//! `getMultipleAccounts`, decodes each one, persists to `oracle_snapshots`,
//! refreshes the in-memory cache, and broadcasts on Redis pub/sub. There is no
//! Hermes path: the public Hermes host requires a paid API key since the Pyth
//! Core upgrade (2026-08-26), and the on-chain accounts carry the same
//! guardian-verified prints for free.
//!
//! ## Two push programs (Pyth Core upgrade, 2026-08-26)
//!
//! Since the upgrade, sponsored push feeds are written under a NEW push
//! program, `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou`, with accounts owned
//! by the receiver `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`. A handful of
//! core feeds (SOL/USD, USDC/USD, ...) are still also pushed under the legacy
//! program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` (receiver
//! `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`); every other legacy account
//! stopped updating. Source: docs.pyth.network/price-feeds/core/upgrade/contracts.
//! The account format is unchanged.
//!
//! For each configured feed we derive the shard-0 account under BOTH programs
//! and keep the freshest fully-verified print:
//!
//! * the account owner must be one of the two Pyth receivers, otherwise the
//!   account is rejected (an address that collides with a non-Pyth account must
//!   never be decoded as a price);
//! * a print older than `PYTH_ONCHAIN_MAX_AGE_SECS` is never used, so a dead
//!   legacy account cannot stand in for a feed whose v2 account is fresh;
//! * accounts that are missing, foreign-owned, or dead while a sibling is fresh
//!   are parked out of the batch and re-probed hourly (see [`poll_onchain`]).
//!   A missing account is parked only after 5 consecutive misses, and an
//!   account that was fresh earlier in this process is never parked.
//!
//! ## Address derivation
//!
//! Addresses are **derived, never hardcoded**: a push-oracle program namespaces
//! one account per (shard, feed) as `PDA([shard_id u16 LE, feed_id bytes])`,
//! shard 0 being the sponsored deployment. This is the same derivation as the
//! official `@pythnetwork/pyth-solana-receiver` SDK's
//! `getPriceFeedAccountForProgram`. No external mapping service is consulted.
//!
//! ## Knobs
//!
//! `PYTH_ONCHAIN_POLL_MS` (default 12000, floor 1000) and
//! `PYTH_ONCHAIN_MAX_AGE_SECS` (default 604800). The engine widens its Pyth
//! staleness window for these prints via `PYTH_ONCHAIN_STALENESS_SECS`.

use crate::sinks;
use crate::state::{AppState, PythEntry};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use pegana_common::{IntrinsicStrategy, MarketStrategy};
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

/// Default minimum gap between `intrinsic_snapshots` rows written for any
/// single redemption-rate feed. Issuer-attested NAV feeds only step daily, so
/// we throttle inserts to keep the table readable. Overridden via
/// `[polling].pyth_intrinsic_interval_ms` in `assets.toml` or
/// `PYTH_INTRINSIC_INTERVAL_MS` env.
const DEFAULT_INTRINSIC_INTERVAL_MS: u64 = 30_000;

// ---------------------------------------------------------------------------
// On-chain primitives
// ---------------------------------------------------------------------------

/// Post-upgrade push-oracle program (derivation namespace for v2 accounts).
const PUSH_ORACLE_V2_PROGRAM_ID: &str = "pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou";
/// Pre-upgrade push-oracle program (official SDK: `DEFAULT_PUSH_ORACLE_PROGRAM_ID`).
const PUSH_ORACLE_LEGACY_PROGRAM_ID: &str = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
/// Receiver that owns/writes v2 push accounts (verified on mainnet 2026-10-21).
const RECEIVER_V2_PROGRAM_ID: &str = "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp";
/// Receiver that owns/writes legacy push accounts (verified on mainnet 2026-10-21).
const RECEIVER_LEGACY_PROGRAM_ID: &str = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

/// Anchor account discriminator for `PriceUpdateV2`.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

/// Smallest fully-verified `PriceUpdateV2` account: 8 disc + 32 authority +
/// 1 verification tag + 32 feed id + 8 price + 8 conf + 4 exponent +
/// 8 publish_time + 8 prev_publish_time + 8 ema_price + 8 ema_conf +
/// 8 posted_slot = 133 bytes. (The SDK's `LEN` is 134, reserving one byte for
/// the `Partial { num_signatures }` payload.)
const PRICE_UPDATE_V2_MIN_LEN: usize = 133;

/// Default on-chain poll cadence. Kept well inside the 120s numéraire
/// staleness gate (`state::PYTH_NUMERAIRE_STALE_SECS`) so the SOL/USD leg never
/// trips it between polls.
const DEFAULT_ONCHAIN_POLL_MS: u64 = 12_000;

/// Floor for the poll cadence, so a zero/typo'd env value cannot turn the
/// source into an RPC hammer.
const MIN_CADENCE_MS: u64 = 1_000;

/// Hard ceiling on an on-chain print's age. Deliberately generous: issuer-
/// attested NAV feeds legitimately step once a day, and the per-consumer gates
/// (numéraire 120s, engine `stale_source`) are the real freshness policy. This
/// only rejects feeds that have been dead for a week, such as the legacy
/// accounts Pyth stopped pushing after the 2026-08 upgrade.
const DEFAULT_ONCHAIN_MAX_AGE_SECS: i64 = 7 * 24 * 3600;

/// How long a parked account (missing, foreign-owned, or dead next to a fresh
/// sibling) stays out of the batch before it is re-probed once.
const PARKED_REPROBE: Duration = Duration::from_secs(3600);

/// Consecutive `Missing` verdicts before an account is parked. One transient
/// null (primary returned `None` and the fallback errored) must not take a
/// live account out of the batch for [`PARKED_REPROBE`]: for feeds whose
/// legacy account is dead (USX, SUSDE, ONYC, EUSX, PYUSD, USDS) that would
/// leave the feed dark for about an hour. At the 12s poll, 5 is about a minute.
const MISSING_PARK_THRESHOLD: u32 = 5;

/// `getMultipleAccounts` accepts at most 100 keys per call.
const MAX_ACCOUNTS_PER_CALL: usize = 100;

/// Wire label carried as `origin` on the SRC_PYTH Redis envelopes. The engine
/// widens its staleness window for `onchain` prints, whose real cadence is the
/// push-feed heartbeat plus our poll interval.
const ORIGIN_ONCHAIN: &str = "onchain";

/// Which push-oracle program an account was derived under.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum PushProgram {
    V2,
    Legacy,
}

impl PushProgram {
    /// Derivation order. V2 first: it is where every sponsored feed lives now.
    const ALL: [PushProgram; 2] = [PushProgram::V2, PushProgram::Legacy];

    fn program_id(self) -> Pubkey {
        let raw = match self {
            PushProgram::V2 => PUSH_ORACLE_V2_PROGRAM_ID,
            PushProgram::Legacy => PUSH_ORACLE_LEGACY_PROGRAM_ID,
        };
        Pubkey::from_str(raw).expect("hardcoded push oracle program id is valid base58")
    }

    fn label(self) -> &'static str {
        match self {
            PushProgram::V2 => "v2",
            PushProgram::Legacy => "legacy",
        }
    }
}

/// `true` when `owner` is one of the two Pyth receiver programs.
fn is_pyth_receiver(owner: &Pubkey) -> bool {
    [RECEIVER_V2_PROGRAM_ID, RECEIVER_LEGACY_PROGRAM_ID]
        .iter()
        .any(|r| Pubkey::from_str(r).is_ok_and(|r| r == *owner))
}

/// A decoded on-chain `PriceUpdateV2`, in raw Pyth integer form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OnChainPrice {
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
}

impl OnChainPrice {
    /// Convert to the `ParsedPrice` shape `handle_price` consumes.
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

/// One derived account of a feed, plus its batch-membership state.
#[derive(Debug, Clone)]
struct FeedAccount {
    program: PushProgram,
    pubkey: Pubkey,
    /// When this account was taken out of the batch, or `None` while active.
    parked_at: Option<Instant>,
    /// Consecutive polls that returned `Missing` for this account.
    missing_streak: u32,
    /// This account produced a `Fresh` print earlier in this process. Such an
    /// account is never parked: a later miss or stale read is treated as a
    /// transient upstream problem and the account keeps being polled.
    seen_fresh: bool,
}

impl FeedAccount {
    fn new(program: PushProgram, pubkey: Pubkey) -> Self {
        Self {
            program,
            pubkey,
            parked_at: None,
            missing_streak: 0,
            seen_fresh: false,
        }
    }

    /// Fold this poll's verdict into the account state and decide whether it
    /// leaves the batch. On top of [`should_park`]: `Missing` parks only after
    /// [`MISSING_PARK_THRESHOLD`] consecutive misses, and an account that was
    /// ever `Fresh` is never parked.
    fn record(&mut self, verdict: &AccountVerdict, feed_has_fresh: bool) -> bool {
        match verdict {
            AccountVerdict::Fresh { .. } => {
                self.seen_fresh = true;
                self.missing_streak = 0;
            }
            AccountVerdict::Missing => {
                self.missing_streak = self.missing_streak.saturating_add(1);
            }
            _ => self.missing_streak = 0,
        }
        if self.seen_fresh || !should_park(verdict, feed_has_fresh) {
            return false;
        }
        match verdict {
            AccountVerdict::Missing => self.missing_streak >= MISSING_PARK_THRESHOLD,
            _ => true,
        }
    }

    fn in_batch(&self, now: Instant) -> bool {
        self.parked_at
            .is_none_or(|at| now.duration_since(at) >= PARKED_REPROBE)
    }
}

/// One feed's on-chain coordinates (one account per push program), derived once
/// at startup.
#[derive(Debug, Clone)]
struct OnChainFeed {
    name: String,
    feed_bytes: [u8; 32],
    accounts: Vec<FeedAccount>,
}

/// Runtime knobs, parsed once from env.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OnChainConfig {
    poll_interval: Duration,
    max_age_secs: i64,
}

impl OnChainConfig {
    fn from_env() -> Self {
        let poll = std::env::var("PYTH_ONCHAIN_POLL_MS").ok();
        let max_age = std::env::var("PYTH_ONCHAIN_MAX_AGE_SECS").ok();
        Self::from_values(poll.as_deref(), max_age.as_deref())
    }

    fn from_values(poll_ms: Option<&str>, max_age_secs: Option<&str>) -> Self {
        Self {
            poll_interval: Duration::from_millis(
                parse_u64(poll_ms, DEFAULT_ONCHAIN_POLL_MS).max(MIN_CADENCE_MS),
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

/// Derive the shard-0 price account for a feed id under one push program. See
/// the module docs for why this needs no external id-to-account mapping.
fn price_feed_account(program: PushProgram, feed_id_hex: &str) -> Result<Pubkey> {
    let feed = decode_feed_id(feed_id_hex)?;
    let shard = 0u16.to_le_bytes();
    Ok(Pubkey::find_program_address(&[&shard[..], &feed[..]], &program.program_id()).0)
}

/// Decode a `PriceUpdateV2` account. Rejects anything that is not fully
/// guardian-verified or does not carry the expected feed id.
pub(crate) fn decode_price_update(
    data: &[u8],
    expected_feed_id: &[u8; 32],
) -> Result<OnChainPrice> {
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

/// What happened to one fetched account of a feed during selection.
#[derive(Debug, Clone, PartialEq, Eq)]
enum AccountVerdict {
    /// Not returned by RPC (never created under this program).
    Missing,
    /// Owner is not a Pyth receiver.
    WrongOwner(Pubkey),
    /// Data does not decode as a fully-verified `PriceUpdateV2` for this feed.
    Undecodable(String),
    /// Decoded but older than the max age.
    Stale { age_secs: i64 },
    /// Decoded and within the max age.
    Fresh { publish_time: i64 },
}

/// Outcome of choosing among a feed's accounts.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FeedSelection {
    /// Freshest usable print and the program it came from, if any.
    best: Option<(PushProgram, OnChainPrice)>,
    /// Per-account verdicts, in the order the accounts were supplied.
    verdicts: Vec<(PushProgram, AccountVerdict)>,
}

impl FeedSelection {
    /// `true` when at least one account decoded but every decoded one was stale.
    fn only_stale(&self) -> bool {
        self.best.is_none()
            && self
                .verdicts
                .iter()
                .any(|(_, v)| matches!(v, AccountVerdict::Stale { .. }))
    }
}

/// One fetched account of a feed: its program and, when it exists, its owner
/// and raw data.
type Candidate<'a> = (PushProgram, Option<(&'a Pubkey, &'a [u8])>);

/// Pick the freshest usable print among one feed's accounts. Pure so the
/// dual-program policy is unit-testable: owner check first, then decode, then
/// the max-age ceiling, then newest `publish_time` wins (ties keep the earlier
/// candidate, i.e. v2).
fn select_freshest(
    feed_bytes: &[u8; 32],
    candidates: &[Candidate<'_>],
    now_unix: i64,
    max_age_secs: i64,
) -> FeedSelection {
    let mut best: Option<(PushProgram, OnChainPrice)> = None;
    let mut verdicts = Vec::with_capacity(candidates.len());
    for &(program, account) in candidates {
        let verdict = match account {
            None => AccountVerdict::Missing,
            Some((owner, _)) if !is_pyth_receiver(owner) => AccountVerdict::WrongOwner(*owner),
            Some((_, data)) => match decode_price_update(data, feed_bytes) {
                Err(e) => AccountVerdict::Undecodable(e.to_string()),
                Ok(price) => {
                    let age_secs = now_unix.saturating_sub(price.publish_time);
                    if age_secs > max_age_secs {
                        AccountVerdict::Stale { age_secs }
                    } else {
                        let publish_time = price.publish_time;
                        if best
                            .as_ref()
                            .is_none_or(|(_, b)| price.publish_time > b.publish_time)
                        {
                            best = Some((program, price));
                        }
                        AccountVerdict::Fresh { publish_time }
                    }
                }
            },
        };
        verdicts.push((program, verdict));
    }
    FeedSelection { best, verdicts }
}

/// Should this account leave the batch after this poll? Missing and
/// foreign-owned accounts always do (a `None` in the batch makes the RPC
/// helper re-issue the whole call on the fallback endpoint). A stale account
/// does too, but only when a sibling account of the same feed is fresh: then
/// it is dead weight. A feed whose only accounts are stale keeps polling them,
/// so a revived push is picked up without waiting for the re-probe.
fn should_park(verdict: &AccountVerdict, feed_has_fresh: bool) -> bool {
    match verdict {
        AccountVerdict::Missing | AccountVerdict::WrongOwner(_) => true,
        AccountVerdict::Stale { .. } => feed_has_fresh,
        AccountVerdict::Undecodable(_) | AccountVerdict::Fresh { .. } => false,
    }
}

/// The shape `handle_price` consumes (Pyth's integer + exponent form).
#[derive(Debug)]
struct ParsedPrice {
    id: String,
    price: PriceTriplet,
}

#[derive(Debug)]
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

/// Per-poll counters, for logging.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct PollStats {
    /// Feeds with a usable (fresh) print this poll.
    fresh: usize,
    /// Feeds whose print was newer than the cache and got published.
    published: usize,
}

/// Shared routing maps and throttles for `handle_price`.
struct Router {
    redemption_map: HashMap<String, Vec<String>>,
    spot_map: HashMap<String, Vec<String>>,
    last_intrinsic: Mutex<HashMap<String, DateTime<Utc>>>,
    last_market: Mutex<HashMap<String, DateTime<Utc>>>,
    intrinsic_interval_ms: u64,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if state.assets.pyth_feeds.is_empty() {
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

    let intrinsic_interval_ms = std::env::var("PYTH_INTRINSIC_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .or(state.assets.polling.pyth_intrinsic_interval_ms)
        .unwrap_or(DEFAULT_INTRINSIC_INTERVAL_MS);
    // Last-insert trackers so we don't fill `intrinsic_snapshots` /
    // `market_snapshots` on every poll.
    let router = Router {
        redemption_map,
        spot_map,
        last_intrinsic: Mutex::new(HashMap::new()),
        last_market: Mutex::new(HashMap::new()),
        intrinsic_interval_ms,
    };

    let cfg = OnChainConfig::from_env();
    info!(
        poll_ms = cfg.poll_interval.as_millis(),
        max_age_secs = cfg.max_age_secs,
        "pyth: reading on-chain push-oracle accounts (v2 + legacy programs)"
    );
    let mut feeds = build_onchain_feeds(&state);
    let rpc = RpcClient::new_with_commitment(
        state.config.solana_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let rpc_fallback = RpcClient::new_with_commitment(
        state.config.solana_rpc_url_fallback.clone(),
        CommitmentConfig::confirmed(),
    );

    // Every failure is logged at warn with its run length; a recovery after a
    // failure run is logged at info. Nothing about the only Pyth path is
    // demoted to debug.
    let mut consecutive_failures: u64 = 0;
    loop {
        if shutdown.is_cancelled() {
            info!("pyth source shutdown");
            return Ok(());
        }
        match poll_onchain(
            &state,
            &mut feeds,
            &rpc,
            &rpc_fallback,
            &router,
            cfg.max_age_secs,
        )
        .await
        {
            Ok(stats) => {
                if consecutive_failures > 0 {
                    info!(
                        failures = consecutive_failures,
                        "pyth on-chain poll recovered"
                    );
                }
                consecutive_failures = 0;
                if stats.fresh == 0 && !feeds.is_empty() {
                    warn!(
                        feeds = feeds.len(),
                        "pyth on-chain poll: no configured feed has a usable print"
                    );
                } else {
                    debug!(
                        fresh = stats.fresh,
                        published = stats.published,
                        "pyth on-chain poll"
                    );
                }
            }
            Err(e) => {
                consecutive_failures += 1;
                metrics::counter!("pegana_pyth_onchain_poll_errors_total").increment(1);
                warn!(
                    error = %e,
                    consecutive_failures,
                    "pyth on-chain poll failed"
                );
            }
        }
        tokio::select! {
            _ = sleep(cfg.poll_interval) => {}
            _ = shutdown.cancelled() => return Ok(()),
        }
    }
}

/// Derive every configured feed's accounts (one per push program) once at
/// startup.
fn build_onchain_feeds(state: &AppState) -> Vec<OnChainFeed> {
    let mut out = Vec::with_capacity(state.assets.pyth_feeds.len());
    for (name, raw_id) in &state.assets.pyth_feeds {
        let feed_id = crate::state::normalize_feed_id(raw_id);
        match derive_feed(name, &feed_id) {
            Ok(feed) => out.push(feed),
            Err(e) => {
                warn!(feed = %name, id = %feed_id, error = %e, "pyth: cannot derive on-chain accounts")
            }
        }
    }
    info!(
        feeds = out.len(),
        accounts = out.iter().map(|f| f.accounts.len()).sum::<usize>(),
        "pyth: on-chain account map derived (no external mapping service)"
    );
    out
}

fn derive_feed(name: &str, feed_id_hex: &str) -> Result<OnChainFeed> {
    let feed_bytes = decode_feed_id(feed_id_hex)?;
    let accounts = PushProgram::ALL
        .iter()
        .map(|&program| {
            Ok(FeedAccount::new(
                program,
                price_feed_account(program, feed_id_hex)?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(OnChainFeed {
        name: name.to_string(),
        feed_bytes,
        accounts,
    })
}

/// Fetch `slots` in chunks of `chunk_size` with `fetch`, each chunk
/// independently: a chunk that errors (or returns the wrong number of
/// accounts) is logged and skipped, so its accounts sit out this poll (no
/// selection, no parking) while every other chunk is still used. Errors only
/// when every chunk failed, so a full RPC outage still surfaces to the caller.
async fn fetch_chunks<T, F, Fut>(
    slots: &[(usize, usize)],
    chunk_size: usize,
    mut fetch: F,
) -> Result<HashMap<(usize, usize), Option<T>>>
where
    F: FnMut(&[(usize, usize)]) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<Option<T>>>>,
{
    let mut fetched = HashMap::with_capacity(slots.len());
    let mut last_err = None;
    for (ci, chunk) in slots.chunks(chunk_size.max(1)).enumerate() {
        let result = fetch(chunk).await.and_then(|accounts| {
            if accounts.len() == chunk.len() {
                Ok(accounts)
            } else {
                Err(anyhow::anyhow!(
                    "getMultipleAccounts returned {} accounts for {} keys",
                    accounts.len(),
                    chunk.len()
                ))
            }
        });
        match result {
            Ok(accounts) => {
                for (&slot, account) in chunk.iter().zip(accounts) {
                    fetched.insert(slot, account);
                }
            }
            Err(e) => {
                metrics::counter!("pegana_pyth_onchain_chunk_failed_total").increment(1);
                warn!(chunk = ci, keys = chunk.len(), error = %e, "pyth: on-chain chunk failed, skipped this poll");
                last_err = Some(e);
            }
        }
    }
    match last_err {
        Some(e) if fetched.is_empty() => Err(e.context("every pyth on-chain chunk failed")),
        _ => Ok(fetched),
    }
}

/// Batched `getMultipleAccounts` across every active account of every feed;
/// the freshest usable print per feed goes through `handle_price`.
///
/// Batch membership is per account, not per feed. After each poll an account
/// is parked (left out of the batch) when it is missing or foreign-owned, or
/// when it is stale while a sibling account of the same feed is fresh (the
/// typical legacy account after the 2026-08 upgrade). That matters beyond
/// bandwidth: `rpc::get_multiple_accounts_with_fallback` treats *any* `None`
/// in the batch as a primary failure and re-issues the whole call against the
/// fallback endpoint, so a permanently-missing account would otherwise emit a
/// bogus `pegana_rpc_primary_failed_total` and double RPC traffic every poll.
/// Parked accounts are re-probed once per [`PARKED_REPROBE`], so a feed Pyth
/// starts pushing later is picked up without a restart.
async fn poll_onchain(
    state: &AppState,
    feeds: &mut [OnChainFeed],
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    router: &Router,
    max_age_secs: i64,
) -> Result<PollStats> {
    let now_instant = Instant::now();
    // (feed index, account index) for every key in the batch.
    let mut slots: Vec<(usize, usize)> = Vec::new();
    for (fi, feed) in feeds.iter().enumerate() {
        for (ai, acct) in feed.accounts.iter().enumerate() {
            if acct.in_batch(now_instant) {
                slots.push((fi, ai));
            }
        }
    }
    if slots.is_empty() {
        return Ok(PollStats::default());
    }

    let fetched = fetch_chunks(&slots, MAX_ACCOUNTS_PER_CALL, |chunk| {
        let pubkeys: Vec<Pubkey> = chunk
            .iter()
            .map(|&(fi, ai)| feeds[fi].accounts[ai].pubkey)
            .collect();
        async move {
            let (accounts, _slot) = crate::rpc::get_multiple_accounts_with_fallback(
                rpc,
                rpc_fallback,
                &pubkeys,
                "pyth_onchain",
            )
            .await?;
            Ok(accounts)
        }
    })
    .await?;

    let now = Utc::now();
    let mut stats = PollStats::default();
    for (fi, feed) in feeds.iter_mut().enumerate() {
        // Only accounts that were in this batch take part in the selection.
        let polled: Vec<usize> = (0..feed.accounts.len())
            .filter(|ai| fetched.contains_key(&(fi, *ai)))
            .collect();
        if polled.is_empty() {
            continue;
        }
        let candidates: Vec<Candidate<'_>> = polled
            .iter()
            .map(|&ai| {
                let account = fetched
                    .get(&(fi, ai))
                    .and_then(|a| a.as_ref())
                    .map(|a| (&a.owner, a.data.as_slice()));
                (feed.accounts[ai].program, account)
            })
            .collect();
        let selection =
            select_freshest(&feed.feed_bytes, &candidates, now.timestamp(), max_age_secs);
        let feed_has_fresh = selection.best.is_some();

        for (&ai, (program, verdict)) in polled.iter().zip(&selection.verdicts) {
            let acct = &mut feed.accounts[ai];
            match verdict {
                AccountVerdict::Missing => {
                    metrics::counter!(
                        "pegana_pyth_onchain_missing_total",
                        "feed" => feed.name.clone(),
                        "program" => program.label()
                    )
                    .increment(1);
                }
                AccountVerdict::WrongOwner(owner) => {
                    metrics::counter!(
                        "pegana_pyth_onchain_rejected_total",
                        "feed" => feed.name.clone(),
                        "reason" => "wrong_owner"
                    )
                    .increment(1);
                    warn!(
                        feed = %feed.name,
                        program = program.label(),
                        account = %acct.pubkey,
                        %owner,
                        "pyth on-chain account not owned by a Pyth receiver · rejected"
                    );
                }
                AccountVerdict::Undecodable(err) => {
                    metrics::counter!(
                        "pegana_pyth_onchain_rejected_total",
                        "feed" => feed.name.clone(),
                        "reason" => "decode"
                    )
                    .increment(1);
                    warn!(
                        feed = %feed.name,
                        program = program.label(),
                        error = %err,
                        "pyth on-chain decode skipped"
                    );
                }
                AccountVerdict::Stale { .. } | AccountVerdict::Fresh { .. } => {}
            }
            let park = acct.record(verdict, feed_has_fresh);
            if park && acct.parked_at.is_none() {
                info!(
                    feed = %feed.name,
                    program = program.label(),
                    account = %acct.pubkey,
                    verdict = ?verdict,
                    "pyth: parking on-chain account (re-probed hourly)"
                );
            } else if !park && acct.parked_at.is_some() {
                info!(
                    feed = %feed.name,
                    program = program.label(),
                    "pyth: parked on-chain account is usable again"
                );
            }
            acct.parked_at = if park { Some(now_instant) } else { None };
        }

        // Per-feed staleness: counted only when the feed has no usable print
        // at all. A dead legacy account next to a fresh v2 one is not stale.
        if selection.only_stale() {
            let age_secs = selection
                .verdicts
                .iter()
                .filter_map(|(_, v)| match v {
                    AccountVerdict::Stale { age_secs } => Some(*age_secs),
                    _ => None,
                })
                .min()
                .unwrap_or_default();
            metrics::counter!("pegana_pyth_onchain_stale_total", "feed" => feed.name.clone())
                .increment(1);
            debug!(
                feed = %feed.name,
                age_secs,
                max_age_secs,
                "pyth on-chain print beyond max age on every program · skipped"
            );
        }

        let Some((program, decoded)) = selection.best else {
            continue;
        };
        stats.fresh += 1;
        let Some(publish_time) = Utc.timestamp_opt(decoded.publish_time, 0).single() else {
            warn!(feed = %feed.name, ts = decoded.publish_time, "invalid on-chain publish_time");
            continue;
        };
        // Never regress or re-publish a print the cache already holds.
        if let Some(prev) = state.pyth.read().await.get(&feed.name) {
            if prev.publish_time >= publish_time {
                continue;
            }
        }
        metrics::counter!(
            "pegana_pyth_onchain_selected_total",
            "feed" => feed.name.clone(),
            "program" => program.label()
        )
        .increment(1);

        let parsed = decoded.to_parsed_price();
        match handle_price(state, &parsed, router).await {
            Ok(()) => stats.published += 1,
            Err(e) => {
                warn!(feed = %feed.name, error = %e, "failed to persist on-chain pyth update")
            }
        }
    }
    Ok(stats)
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

async fn handle_price(state: &AppState, p: &ParsedPrice, router: &Router) -> Result<()> {
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

    // Publish-to-ingest latency per feed: Pyth publisher signing, the push
    // to Solana, and our poll interval. Goes negative if our local clock
    // drifts behind the signer's; clamp at 0 to keep the histogram
    // interpretable as "how stale is what we ingest".
    let latency_ms = (Utc::now() - publish_time).num_milliseconds().max(0) as f64;
    metrics::histogram!("pegana_pyth_onchain_latency_seconds", "feed" => feed_name.clone())
        .record(latency_ms / 1000.0);

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
        "origin": ORIGIN_ONCHAIN,
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
    if let Some(assets) = router.redemption_map.get(&feed_name) {
        let now = Utc::now();
        let interval = chrono::Duration::milliseconds(router.intrinsic_interval_ms as i64);
        for asset_sym in assets {
            let should_write = {
                let mut guard = router.last_intrinsic.lock().await;
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
                "origin": ORIGIN_ONCHAIN,
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
    if !spot_price_ok && router.spot_map.contains_key(&feed_name) {
        warn!(
            feed = %feed_name,
            %price,
            "implausible pyth_spot price · skipping market fan-out"
        );
    }
    if let Some(assets) = router.spot_map.get(&feed_name).filter(|_| spot_price_ok) {
        let now = Utc::now();
        let interval = chrono::Duration::milliseconds(router.intrinsic_interval_ms as i64);
        for asset_sym in assets {
            let should_write = {
                let mut guard = router.last_market.lock().await;
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
    metrics::counter!("pegana_pyth_onchain_updates_total", "feed" => feed_name).increment(1);
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

    // ---- on-chain push accounts --------------------------------------------

    const SOL_FEED: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const USDC_FEED: &str = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
    const USX_FEED: &str = "0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16";
    const ONYC_NAV_FEED: &str =
        "0xbabbfcc7f46b6e7df73adcccece8b6782408ed27c4e77f35ba39a449440170ab";
    const EUSX_RR_FEED: &str = "0xf36e12e65d2969b242fb97d3ebaa32ec55d5794189b64d1a07dc4f41425c9378";
    const SUSDE_USD_FEED: &str =
        "0xca3ba9a619a4b3755c10ac7d5e760275aa95e9823d38a84fedd416856cdba37c";

    fn receiver_v2() -> Pubkey {
        Pubkey::from_str(RECEIVER_V2_PROGRAM_ID).unwrap()
    }

    fn receiver_legacy() -> Pubkey {
        Pubkey::from_str(RECEIVER_LEGACY_PROGRAM_ID).unwrap()
    }

    fn asset<'a>(parsed: &'a AssetsFile, symbol: &str) -> &'a pegana_common::AssetConfig {
        parsed
            .assets
            .iter()
            .find(|a| a.symbol == symbol)
            .unwrap_or_else(|| panic!("{symbol} present in assets.toml"))
    }

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
    /// external registry. Legacy vectors were captured from mainnet
    /// (2026-10-17) and re-derived with the official JS SDK's
    /// `getPriceFeedAccountForProgram(0, feedId)`; v2 vectors were read live
    /// on mainnet 2026-10-21 (owner `rec2HHDD...`, fresh prints).
    #[test]
    fn price_feed_account_matches_mainnet_vectors() {
        let cases = [
            (
                PushProgram::Legacy,
                SOL_FEED,
                "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
            ),
            (
                PushProgram::Legacy,
                USDC_FEED,
                "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
            ),
            (
                PushProgram::V2,
                USX_FEED,
                "A2vekGVVbR6Xoen51og5i2xTfaWTtErMRveGFGSGxQP8",
            ),
            (
                PushProgram::V2,
                ONYC_NAV_FEED,
                "81yWm9JDhCGgzxWivVkz4tZAEJxYE1VB8tMKKEFbTx71",
            ),
            (
                PushProgram::V2,
                EUSX_RR_FEED,
                "Fu9y6QEEiBTPnmPmkLLJBV7ZEKXsjQHyEdMWobNnsEkc",
            ),
            (
                PushProgram::V2,
                SUSDE_USD_FEED,
                "GkCdemGNMcU32PhThpkV9P45q2MnRDHh7HzAD65ocmBS",
            ),
        ];
        for (program, feed, want) in cases {
            assert_eq!(
                price_feed_account(program, feed).unwrap().to_string(),
                want,
                "{program:?} {feed}"
            );
        }
    }

    #[test]
    fn every_configured_feed_derives_distinct_accounts_on_both_programs() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");
        let mut seen = std::collections::HashSet::new();
        for (name, id) in &parsed.pyth_feeds {
            let feed = derive_feed(name, id)
                .unwrap_or_else(|e| panic!("feed {name} ({id}) must derive accounts: {e}"));
            assert_eq!(
                feed.accounts.iter().map(|a| a.program).collect::<Vec<_>>(),
                PushProgram::ALL.to_vec(),
                "v2 first, then legacy"
            );
            for acct in &feed.accounts {
                assert!(
                    seen.insert(acct.pubkey),
                    "feed {name} ({id}) derived a duplicate account on {:?}",
                    acct.program
                );
            }
        }
        assert_eq!(seen.len(), parsed.pyth_feeds.len() * PushProgram::ALL.len());
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
        assert_eq!(
            sol.to_parsed_price().id,
            SOL_FEED,
            "parsed id is the 0x-prefixed lowercase feed id handle_price looks up"
        );
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

    /// USDY's market leg moved off the Pyth `USDY/USD` spot feed to Jupiter
    /// (2026-10-22, Whirlpool liquidity about $1.7M). The intrinsic is owned
    /// by another source, so only the market leg is asserted here.
    #[test]
    fn assets_toml_wires_usdy_market_to_jupiter() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");
        let usdy = asset(&parsed, "USDY");
        assert!(usdy.active, "USDY stays tracked");
        assert!(
            matches!(usdy.market, MarketStrategy::JupiterUsd { .. }),
            "USDY market must be jupiter_usd, got {:?}",
            usdy.market
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

    // ---- dual-program selection --------------------------------------------

    const NOW: i64 = 1_792_300_000;
    const MAX_AGE: i64 = DEFAULT_ONCHAIN_MAX_AGE_SECS;

    #[test]
    fn both_programs_present_newest_wins() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let (v2_owner, legacy_owner) = (receiver_v2(), receiver_legacy());
        let v2 = synthetic_price_update(1, &feed, 200, 1, -8, NOW - 5);
        let legacy = synthetic_price_update(1, &feed, 100, 1, -8, NOW - 30);
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, Some((&v2_owner, &v2[..]))),
                (PushProgram::Legacy, Some((&legacy_owner, &legacy[..]))),
            ],
            NOW,
            MAX_AGE,
        );
        let (program, price) = sel.best.expect("a fresh print");
        assert_eq!(program, PushProgram::V2);
        assert_eq!(price.price, 200);

        // Order does not matter: a newer legacy print beats an older v2 one.
        let v2_old = synthetic_price_update(1, &feed, 200, 1, -8, NOW - 50);
        let legacy_new = synthetic_price_update(1, &feed, 100, 1, -8, NOW - 2);
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, Some((&v2_owner, &v2_old[..]))),
                (PushProgram::Legacy, Some((&legacy_owner, &legacy_new[..]))),
            ],
            NOW,
            MAX_AGE,
        );
        assert_eq!(sel.best.unwrap().0, PushProgram::Legacy);
    }

    #[test]
    fn only_new_program_present() {
        let feed = decode_feed_id(USX_FEED).unwrap();
        let owner = receiver_v2();
        let v2 = synthetic_price_update(1, &feed, 99_990_000, 1, -8, NOW - 130);
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, Some((&owner, &v2[..]))),
                (PushProgram::Legacy, None),
            ],
            NOW,
            MAX_AGE,
        );
        let (program, price) = sel.best.expect("v2 print used");
        assert_eq!(program, PushProgram::V2);
        assert_eq!(price.publish_time, NOW - 130);
        assert_eq!(
            sel.verdicts[1],
            (PushProgram::Legacy, AccountVerdict::Missing)
        );
        assert!(
            should_park(&sel.verdicts[1].1, true),
            "missing legacy leaves the batch"
        );
        assert!(!should_park(&sel.verdicts[0].1, true), "fresh v2 stays");
    }

    #[test]
    fn wrong_owner_rejected() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let impostor = Pubkey::new_unique();
        // A perfectly valid, fresher payload under a foreign owner must lose to
        // an older genuine one, and on its own must yield nothing.
        let forged = synthetic_price_update(1, &feed, 1, 1, -8, NOW);
        let genuine_owner = receiver_legacy();
        let genuine = synthetic_price_update(1, &feed, 777, 1, -8, NOW - 60);
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, Some((&impostor, &forged[..]))),
                (PushProgram::Legacy, Some((&genuine_owner, &genuine[..]))),
            ],
            NOW,
            MAX_AGE,
        );
        assert_eq!(sel.verdicts[0].1, AccountVerdict::WrongOwner(impostor));
        assert_eq!(sel.best.as_ref().unwrap().1.price, 777);
        assert!(should_park(&sel.verdicts[0].1, true));

        let alone = select_freshest(
            &feed,
            &[(PushProgram::V2, Some((&impostor, &forged[..])))],
            NOW,
            MAX_AGE,
        );
        assert!(alone.best.is_none());
        assert!(!alone.only_stale());
    }

    #[test]
    fn stale_old_program_not_used() {
        let feed = decode_feed_id(USX_FEED).unwrap();
        let (v2_owner, legacy_owner) = (receiver_v2(), receiver_legacy());
        // Legacy stopped ~60 days ago; v2 is current.
        let legacy = synthetic_price_update(1, &feed, 1, 1, -8, NOW - 60 * 86_400);
        let v2 = synthetic_price_update(1, &feed, 2, 1, -8, NOW - 10);
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, Some((&v2_owner, &v2[..]))),
                (PushProgram::Legacy, Some((&legacy_owner, &legacy[..]))),
            ],
            NOW,
            MAX_AGE,
        );
        assert_eq!(sel.best.as_ref().unwrap().0, PushProgram::V2);
        assert!(!sel.only_stale(), "feed is not stale while v2 is fresh");
        assert!(matches!(sel.verdicts[1].1, AccountVerdict::Stale { .. }));
        assert!(
            should_park(&sel.verdicts[1].1, true),
            "a dead legacy account next to a fresh v2 one leaves the batch"
        );

        // With no fresh sibling the stale account is neither used nor parked,
        // and the feed counts as stale.
        let sel = select_freshest(
            &feed,
            &[
                (PushProgram::V2, None),
                (PushProgram::Legacy, Some((&legacy_owner, &legacy[..]))),
            ],
            NOW,
            MAX_AGE,
        );
        assert!(sel.best.is_none(), "a dead print is never published");
        assert!(sel.only_stale());
        assert!(!should_park(&sel.verdicts[1].1, false));
    }

    #[test]
    fn undecodable_account_is_skipped_not_parked() {
        let feed = decode_feed_id(SOL_FEED).unwrap();
        let owner = receiver_v2();
        let partial = synthetic_price_update(0, &feed, 1, 1, -8, NOW);
        let sel = select_freshest(
            &feed,
            &[(PushProgram::V2, Some((&owner, &partial[..])))],
            NOW,
            MAX_AGE,
        );
        assert!(sel.best.is_none());
        assert!(matches!(sel.verdicts[0].1, AccountVerdict::Undecodable(_)));
        assert!(!should_park(&sel.verdicts[0].1, false));
    }

    #[test]
    fn parked_accounts_rejoin_the_batch_after_the_reprobe_window() {
        let now = Instant::now();
        let mut acct = FeedAccount::new(PushProgram::Legacy, Pubkey::new_unique());
        assert!(acct.in_batch(now));
        acct.parked_at = Some(now);
        assert!(!acct.in_batch(now));
        assert!(acct.in_batch(now + PARKED_REPROBE));
    }

    /// P3: one failing chunk no longer aborts the others; only a poll where
    /// every chunk failed is an error.
    #[tokio::test]
    async fn chunks_are_fetched_independently() {
        let slots: Vec<(usize, usize)> = (0..5).map(|i| (i, 0)).collect();
        // Chunk size 2 -> chunks [0,1], [2,3], [4]; the middle one fails.
        let got = fetch_chunks(&slots, 2, |chunk| {
            let chunk = chunk.to_vec();
            async move {
                if chunk[0].0 == 2 {
                    anyhow::bail!("rpc down for this chunk")
                }
                Ok(chunk.iter().map(|s| Some(s.0)).collect())
            }
        })
        .await
        .expect("partial success is Ok");
        let mut keys: Vec<usize> = got.keys().map(|k| k.0).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec![0, 1, 4], "failed chunk skipped, others kept");
        // A wrong-length answer is treated like a failed chunk.
        let got = fetch_chunks(&slots, 2, |chunk| {
            let n = if chunk[0].0 == 0 { 1 } else { chunk.len() };
            async move { Ok((0..n).map(Some).collect::<Vec<_>>()) }
        })
        .await
        .unwrap();
        assert!(!got.contains_key(&(0, 0)) && got.contains_key(&(4, 0)));
        // Every chunk failing is still an error.
        let all = fetch_chunks::<usize, _, _>(&slots, 2, |_| async { anyhow::bail!("down") }).await;
        assert!(all.is_err());
    }

    /// P2-1: one transient `Missing` must not park a live account. Parking
    /// needs `MISSING_PARK_THRESHOLD` consecutive misses, and any other verdict
    /// resets the streak.
    #[test]
    fn missing_parks_only_after_consecutive_misses() {
        let mut acct = FeedAccount::new(PushProgram::V2, Pubkey::new_unique());
        for i in 1..MISSING_PARK_THRESHOLD {
            assert!(
                !acct.record(&AccountVerdict::Missing, false),
                "miss {i} of {MISSING_PARK_THRESHOLD} must not park"
            );
        }
        // A non-missing verdict in between resets the streak.
        assert!(!acct.record(&AccountVerdict::Undecodable("x".into()), false));
        for _ in 1..MISSING_PARK_THRESHOLD {
            assert!(!acct.record(&AccountVerdict::Missing, false));
        }
        assert!(
            acct.record(&AccountVerdict::Missing, false),
            "the {MISSING_PARK_THRESHOLD}th consecutive miss parks a never-fresh account"
        );
    }

    /// P2-1: an account that was `Fresh` earlier in this process is never
    /// parked, however many misses, stale reads or owner mismatches follow.
    #[test]
    fn once_fresh_account_is_never_parked() {
        let mut acct = FeedAccount::new(PushProgram::V2, Pubkey::new_unique());
        assert!(!acct.record(&AccountVerdict::Fresh { publish_time: 1 }, true));
        for _ in 0..(MISSING_PARK_THRESHOLD * 3) {
            assert!(!acct.record(&AccountVerdict::Missing, false));
        }
        assert!(!acct.record(&AccountVerdict::Stale { age_secs: 999_999 }, true));
        assert!(!acct.record(&AccountVerdict::WrongOwner(Pubkey::new_unique()), false));
        // A never-fresh dead sibling still parks as before.
        let mut legacy = FeedAccount::new(PushProgram::Legacy, Pubkey::new_unique());
        assert!(legacy.record(&AccountVerdict::Stale { age_secs: 999_999 }, true));
        let mut foreign = FeedAccount::new(PushProgram::Legacy, Pubkey::new_unique());
        assert!(foreign.record(&AccountVerdict::WrongOwner(Pubkey::new_unique()), false));
    }

    #[test]
    fn receiver_allow_list_is_exactly_the_two_pyth_receivers() {
        assert!(is_pyth_receiver(&receiver_v2()));
        assert!(is_pyth_receiver(&receiver_legacy()));
        assert!(!is_pyth_receiver(&PushProgram::V2.program_id()));
        assert!(!is_pyth_receiver(&Pubkey::new_unique()));
    }

    #[test]
    fn onchain_config_defaults_and_overrides() {
        let d = OnChainConfig::from_values(None, None);
        assert_eq!(
            d.poll_interval,
            Duration::from_millis(DEFAULT_ONCHAIN_POLL_MS)
        );
        assert_eq!(d.max_age_secs, DEFAULT_ONCHAIN_MAX_AGE_SECS);

        let o = OnChainConfig::from_values(Some("5000"), Some("3600"));
        assert_eq!(o.poll_interval, Duration::from_millis(5_000));
        assert_eq!(o.max_age_secs, 3_600);

        // Garbage falls back to the default; a negative age clamps to 0; a zero
        // cadence clamps to the floor (never an RPC hammer).
        let g = OnChainConfig::from_values(Some("nope"), Some("-5"));
        assert_eq!(
            g.poll_interval,
            Duration::from_millis(DEFAULT_ONCHAIN_POLL_MS)
        );
        assert_eq!(g.max_age_secs, 0);
        let z = OnChainConfig::from_values(Some("0"), None);
        assert_eq!(z.poll_interval, Duration::from_millis(MIN_CADENCE_MS));
    }

    /// The numéraire must stay well inside its 120s staleness gate: the default
    /// poll cadence has to be far below it.
    #[test]
    fn default_poll_cadence_beats_the_numeraire_staleness_gate() {
        let d = OnChainConfig::from_values(None, None);
        assert!(
            d.poll_interval < Duration::from_secs(crate::state::PYTH_NUMERAIRE_STALE_SECS as u64),
            "default on-chain poll must be < the {}s numeraire gate",
            crate::state::PYTH_NUMERAIRE_STALE_SECS
        );
    }

    // ---- assets this source feeds (2026-10-22 wiring) ----------------------

    fn feed_id_of(parsed: &AssetsFile, name: &str) -> String {
        parsed
            .pyth_feeds
            .get(name)
            .unwrap_or_else(|| panic!("{name} registered in [pyth_feeds]"))
            .trim_start_matches("0x")
            .to_lowercase()
    }

    #[test]
    fn assets_toml_wires_v2_push_feeds_for_usx_onyc_eusx_susde() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");

        let usx = asset(&parsed, "USX");
        assert!(usx.active);
        assert!(
            matches!(&usx.market, MarketStrategy::PythSpot { feed } if feed == "USX/USD"),
            "USX market: {:?}",
            usx.market
        );
        assert_eq!(feed_id_of(&parsed, "USX/USD"), USX_FEED[2..]);

        let onyc = asset(&parsed, "ONyc");
        assert!(
            matches!(&onyc.intrinsic, IntrinsicStrategy::PythRedemptionRate { feed } if feed == "ONYC/USD.NAV"),
            "ONyc intrinsic: {:?}",
            onyc.intrinsic
        );
        assert_eq!(feed_id_of(&parsed, "ONYC/USD.NAV"), ONYC_NAV_FEED[2..]);

        let eusx = asset(&parsed, "eUSX");
        assert!(
            matches!(&eusx.intrinsic, IntrinsicStrategy::PythRedemptionRate { feed } if feed == "EUSX/USX.RR"),
            "eUSX intrinsic: {:?}",
            eusx.intrinsic
        );
        assert_eq!(feed_id_of(&parsed, "EUSX/USX.RR"), EUSX_RR_FEED[2..]);

        let susde = asset(&parsed, "sUSDe");
        assert!(
            matches!(&susde.market, MarketStrategy::PythSpot { feed } if feed == "SUSDE/USD"),
            "sUSDe market: {:?}",
            susde.market
        );
        assert_eq!(feed_id_of(&parsed, "SUSDE/USD"), SUSDE_USD_FEED[2..]);
    }

    #[test]
    fn assets_toml_retires_ausd_and_keeps_susd_tracked() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");
        assert!(
            !asset(&parsed, "AUSD").active,
            "AUSD retired: no Solana market and no sponsored Pyth feed"
        );
        assert!(
            asset(&parsed, "sUSD").active,
            "sUSD stays tracked (monitoring-only)"
        );
    }

    /// Live smoke test: derives every configured feed's accounts under both
    /// programs and reads them from mainnet. Ignored by default (network).
    /// Run with
    /// `cargo test -p indexer-rs live_pyth_push_accounts -- --ignored --nocapture`;
    /// `SOLANA_RPC_URL` overrides the public endpoint and is never printed.
    #[tokio::test]
    #[ignore = "hits mainnet RPC"]
    async fn live_pyth_push_accounts() {
        let parsed: AssetsFile =
            toml::from_str(include_str!("../../../../assets.toml")).expect("assets.toml parses");
        let url = std::env::var("SOLANA_RPC_URL")
            .ok()
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| "https://api.mainnet-beta.solana.com".into());
        let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
        let mut names: Vec<&String> = parsed.pyth_feeds.keys().collect();
        names.sort();
        let feeds: Vec<OnChainFeed> = names
            .iter()
            .map(|n| derive_feed(n, &parsed.pyth_feeds[*n]).unwrap())
            .collect();
        let keys: Vec<Pubkey> = feeds
            .iter()
            .flat_map(|f| f.accounts.iter().map(|a| a.pubkey))
            .collect();
        let accounts = rpc
            .get_multiple_accounts(&keys)
            .await
            .unwrap_or_else(|e| panic!("{}", pegana_common_verify::redact_urls_in_error(e)));
        let now = Utc::now().timestamp();
        let mut fresh = 0;
        for (fi, feed) in feeds.iter().enumerate() {
            let candidates: Vec<Candidate<'_>> = feed
                .accounts
                .iter()
                .enumerate()
                .map(|(ai, a)| {
                    let acc = accounts[fi * feed.accounts.len() + ai].as_ref();
                    (a.program, acc.map(|x| (&x.owner, x.data.as_slice())))
                })
                .collect();
            let sel = select_freshest(&feed.feed_bytes, &candidates, now, MAX_AGE);
            let best = sel.best.as_ref().map(|(p, price)| {
                let usd = scale_price(&price.price.to_string(), price.exponent).unwrap();
                format!("{} ${usd} age {}s", p.label(), now - price.publish_time)
            });
            if best.is_some() {
                fresh += 1;
            }
            println!(
                "{:<20} best={:<40} verdicts={:?}",
                feed.name,
                best.unwrap_or_else(|| "NONE".into()),
                sel.verdicts
                    .iter()
                    .map(|(p, v)| format!("{}:{}", p.label(), short_verdict(v, now)))
                    .collect::<Vec<_>>()
            );
        }
        assert!(fresh > 0, "at least one feed must be live on mainnet");
    }

    fn short_verdict(v: &AccountVerdict, _now: i64) -> String {
        match v {
            AccountVerdict::Missing => "missing".into(),
            AccountVerdict::WrongOwner(o) => format!("wrong_owner({o})"),
            AccountVerdict::Undecodable(e) => format!("undecodable({e})"),
            AccountVerdict::Stale { age_secs } => format!("stale({}d)", age_secs / 86_400),
            AccountVerdict::Fresh { .. } => "fresh".into(),
        }
    }
}
