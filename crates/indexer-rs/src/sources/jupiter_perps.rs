//! JLP intrinsic NAV from the Jupiter Perpetuals Pool account.
//!
//! JLP NAV (USD per JLP) = `Pool.aum_usd` / JLP mint `supply`. Both are 6-dp
//! integers (aum_usd is USD with 6 decimals, JLP has 6 decimals), so the ratio
//! is directly USD per token. Live 2026-10-21: 879.23M / 189.94M = 4.6289.
//!
//! The Pool and the JLP mint are read in ONE `getMultipleAccounts`, so the
//! numerator and denominator come from the same slot (an add/remove-liquidity
//! between two separate reads would otherwise skew the ratio).
//!
//! Layout comes from the on-chain Anchor IDL of the Perpetuals program
//! `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu` (account `Pool`, Borsh):
//!
//!   [0..8]    discriminator = sha256("account:Pool")[..8] = f19a6d0411b16dbc
//!   name      string  (u32 len + bytes)
//!   custodies Vec<Pubkey> (u32 len + 32*n)
//!   aum_usd   u128    <- NAV numerator
//!   limit     Limit   { max_aum_usd u128, token_weightage_buffer_bps u128, buffer u64 } = 40
//!   fees      Fees    9 x u64 = 72
//!   pool_apr  PoolApr { last_updated i64, fee_apr_bps u64, realized_fee_usd u64 } = 24
//!   max_request_execution_sec i64 = 8
//!   bump u8, lp_token_bump u8 = 2
//!   inception_time i64 = 8
//!   parameter_update_oracle Secp256k1Pubkey { prefix u8, key [u8;32] } = 33
//!   aum_usd_updated_at i64  <- liveness (keepers refresh it every few seconds)
//!
//! Liveness: a reading whose `aum_usd_updated_at` is older than
//! [`MAX_AUM_AGE_SECS`] is refused (not published). The engine then ages the
//! last good intrinsic out through its normal staleness gate, so a frozen pool
//! can never be re-served as a fresh NAV. The same signal is written to
//! `intrinsic_liveness` (ADR-0038) for observability.
//!
//! Independence (limited): the market leg for JLP is the Pyth JLP/USD spot
//! feed, whose derivation Pyth does not document. Because JLP mints and
//! redeems at this NAV through the Perpetuals program, that market price is
//! likely arbitrage-coupled to the NAV, so a JLP discount is weaker evidence
//! than for an asset with an independent market; the wide 200 bps drift band
//! in assets.toml is the guard. Jupiter is never polled for JLP (its market is
//! `pyth_spot`), so no `jupiter_exclude_dexes` is configured for it.

use crate::sources::nav_publish;
use crate::state::AppState;
use anyhow::{Context, Result};
use pegana_common::IntrinsicStrategy;
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Jupiter Perpetuals program (owner of the Pool account).
pub const PERPS_PROGRAM: &str = "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu";
/// JLP mint authority: the Perpetuals PDA (verified on mainnet 2026-05-29 and
/// again 2026-10-21).
pub const JLP_MINT_AUTHORITY: &str = "AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49";
/// SPL Token program (JLP is a classic SPL mint).
const SPL_TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const POOL_DISCRIMINATOR: [u8; 8] = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
/// Pool name is "Pool" today; bound the Borsh length prefix so a corrupt
/// account can't make us skip past the buffer on a huge length.
const MAX_NAME_LEN: usize = 64;
/// Pool has 6 custodies today (SOL, ETH, BTC, USDC, USDT, ...).
const MAX_CUSTODIES: usize = 32;
/// Bytes from the END of `aum_usd` to the START of `aum_usd_updated_at`
/// (limit 40 + fees 72 + pool_apr 24 + max_request_execution_sec 8 + 2 bumps
/// + inception_time 8 + parameter_update_oracle 33).
const AUM_END_TO_UPDATED_AT: usize = 40 + 72 + 24 + 8 + 2 + 8 + 33;
/// Both aum_usd and JLP supply are 6-dp; the ratio needs no rescale, but the
/// JLP decimals are still asserted so a mint change fails loudly.
const JLP_DECIMALS: u8 = 6;

/// The pool's AUM is refreshed by keepers every few seconds (observed 2-5s).
/// Five minutes without a refresh is a genuine stall, not jitter.
pub const MAX_AUM_AGE_SECS: i64 = 300;

/// Default poll cadence. The pool moves every few seconds, but the engine only
/// needs a fresh intrinsic well inside its 600s staleness window.
const DEFAULT_POLL_MS: u64 = 15_000;

/// Decoded fields of the Perpetuals `Pool` account that the NAV needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolNavFields {
    pub name: String,
    pub custody_count: usize,
    pub aum_usd: u128,
    pub aum_usd_updated_at: i64,
}

/// Decode the `Pool` account with full bounds checks.
pub fn decode_pool(data: &[u8]) -> Result<PoolNavFields> {
    anyhow::ensure!(
        data.get(0..8) == Some(POOL_DISCRIMINATOR.as_slice()),
        "perps pool discriminator mismatch"
    );
    let mut off = 8usize;

    let name_len = read_u32_le(data, off)? as usize;
    anyhow::ensure!(
        name_len <= MAX_NAME_LEN,
        "perps pool name length {name_len} > {MAX_NAME_LEN}"
    );
    off += 4;
    let name_bytes = data
        .get(off..off + name_len)
        .context("perps pool name out of bounds")?;
    let name = String::from_utf8(name_bytes.to_vec()).context("perps pool name not UTF-8")?;
    off += name_len;

    let custody_count = read_u32_le(data, off)? as usize;
    anyhow::ensure!(
        (1..=MAX_CUSTODIES).contains(&custody_count),
        "perps pool custody count {custody_count} outside 1..={MAX_CUSTODIES}"
    );
    off += 4;
    off = off
        .checked_add(custody_count * 32)
        .context("custodies offset overflow")?;

    let aum_usd = read_u128_le(data, off)?;
    off += 16;
    let aum_usd_updated_at = read_i64_le(data, off + AUM_END_TO_UPDATED_AT)?;

    Ok(PoolNavFields {
        name,
        custody_count,
        aum_usd,
        aum_usd_updated_at,
    })
}

/// Decoded fields of an SPL Token mint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MintFields {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
}

/// Decode a classic SPL Token mint (82 bytes).
pub fn decode_spl_mint(data: &[u8]) -> Result<MintFields> {
    anyhow::ensure!(data.len() >= 82, "mint account too short: {}", data.len());
    let tag = read_u32_le(data, 0)?;
    let mint_authority = match tag {
        0 => None,
        1 => Some(
            Pubkey::try_from(data.get(4..36).context("mint authority bounds")?)
                .map_err(|_| anyhow::anyhow!("invalid mint authority"))?,
        ),
        other => anyhow::bail!("invalid mint authority option tag {other}"),
    };
    let supply = read_u64_le(data, 36)?;
    let decimals = *data.get(44).context("mint decimals bounds")?;
    anyhow::ensure!(data.get(45) == Some(&1), "mint not initialized");
    Ok(MintFields {
        mint_authority,
        supply,
        decimals,
    })
}

/// NAV (USD per JLP) and sanity band. JLP launched at ~$1 and is a perps LP
/// basket (SOL/ETH/BTC + stables); outside [0.5, 50] is a decode bug, not a
/// market move.
pub fn compute_nav(aum_usd: u128, supply: u64) -> Result<Decimal> {
    anyhow::ensure!(supply > 0, "JLP supply is zero");
    anyhow::ensure!(aum_usd > 0, "perps pool aum_usd is zero");
    let aum =
        Decimal::from_i128_with_scale(i128::try_from(aum_usd).context("aum_usd exceeds i128")?, 0);
    let nav = aum
        .checked_div(Decimal::from(supply))
        .context("JLP NAV division overflow")?;
    anyhow::ensure!(
        nav >= Decimal::new(5, 1) && nav <= Decimal::from(50u32),
        "JLP NAV {nav} outside sanity band [0.5, 50]"
    );
    Ok(nav)
}

/// Pure liveness decision: `true` when the pool's AUM refresh is too old.
pub fn aum_is_stale(aum_usd_updated_at: i64, now_unix: i64) -> bool {
    now_unix.saturating_sub(aum_usd_updated_at) > MAX_AUM_AGE_SECS
}

fn read_u32_le(data: &[u8], off: usize) -> Result<u32> {
    let b = data
        .get(off..off.checked_add(4).context("offset overflow")?)
        .with_context(|| format!("u32 out of bounds at {off} (len {})", data.len()))?;
    Ok(u32::from_le_bytes(b.try_into()?))
}

fn read_u64_le(data: &[u8], off: usize) -> Result<u64> {
    let b = data
        .get(off..off.checked_add(8).context("offset overflow")?)
        .with_context(|| format!("u64 out of bounds at {off} (len {})", data.len()))?;
    Ok(u64::from_le_bytes(b.try_into()?))
}

fn read_i64_le(data: &[u8], off: usize) -> Result<i64> {
    let b = data
        .get(off..off.checked_add(8).context("offset overflow")?)
        .with_context(|| format!("i64 out of bounds at {off} (len {})", data.len()))?;
    Ok(i64::from_le_bytes(b.try_into()?))
}

fn read_u128_le(data: &[u8], off: usize) -> Result<u128> {
    let b = data
        .get(off..off.checked_add(16).context("offset overflow")?)
        .with_context(|| format!("u128 out of bounds at {off} (len {})", data.len()))?;
    Ok(u128::from_le_bytes(b.try_into()?))
}

/// One configured JLP-style asset.
#[derive(Debug, Clone)]
struct PerpsTarget {
    symbol: String,
    pool: Pubkey,
    program: Pubkey,
    lp_mint: Pubkey,
}

fn targets(state: &AppState) -> Result<Vec<PerpsTarget>> {
    let mut out = Vec::new();
    for a in state.assets.assets.iter().filter(|a| a.active) {
        if let IntrinsicStrategy::JupiterPerpsPoolNav { pool, program } = &a.intrinsic {
            // The decoder (discriminator, offsets, mint authority) is specific
            // to the Jupiter Perpetuals program; refuse any other owner.
            anyhow::ensure!(
                program == PERPS_PROGRAM,
                "{} program {program} is not the Jupiter Perpetuals program",
                a.symbol
            );
            out.push(PerpsTarget {
                symbol: a.symbol.clone(),
                pool: Pubkey::from_str(pool).with_context(|| format!("{} pool", a.symbol))?,
                program: Pubkey::from_str(program)
                    .with_context(|| format!("{} program", a.symbol))?,
                lp_mint: Pubkey::from_str(&a.mint).with_context(|| format!("{} mint", a.symbol))?,
            });
        }
    }
    Ok(out)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let targets = targets(&state)?;
    if targets.is_empty() {
        info!("no active jupiter_perps_pool_nav assets: jupiter_perps source idle");
        return Ok(());
    }
    let cadence_ms = std::env::var("JUPITER_PERPS_POLL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_POLL_MS);
    let mut tick = interval(Duration::from_millis(super::min_poll_ms(cadence_ms)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let rpc = RpcClient::new_with_commitment(
        state.config.solana_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let rpc_fallback = RpcClient::new_with_commitment(
        state.config.solana_rpc_url_fallback.clone(),
        CommitmentConfig::confirmed(),
    );
    info!(
        cadence_ms,
        assets = targets.len(),
        "jupiter_perps source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("jupiter_perps source shutdown");
                return Ok(());
            }
        }
        for t in &targets {
            let status = match poll_once(&state, &rpc, &rpc_fallback, t).await {
                Ok(()) => "ok",
                Err(e) => {
                    warn!(asset = %t.symbol, error = %e, "jupiter_perps poll failed");
                    "error"
                }
            };
            metrics::counter!("pegana_jupiter_perps_polls_total", "status" => status).increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    t: &PerpsTarget,
) -> Result<()> {
    let started = std::time::Instant::now();
    let (accounts, slot) = crate::rpc::get_multiple_accounts_with_fallback(
        rpc,
        rpc_fallback,
        &[t.pool, t.lp_mint],
        "jupiter_perps",
    )
    .await?;
    let pool_acc = crate::rpc::required_account(&accounts, 0, "perps pool")?;
    let mint_acc = crate::rpc::required_account(&accounts, 1, "JLP mint")?;

    anyhow::ensure!(
        pool_acc.owner == t.program,
        "perps pool owner mismatch: got {} expected {}",
        pool_acc.owner,
        t.program
    );
    anyhow::ensure!(
        mint_acc.owner == Pubkey::from_str(SPL_TOKEN_PROGRAM)?,
        "JLP mint owner mismatch: got {}",
        mint_acc.owner
    );

    let pool = decode_pool(&pool_acc.data)?;
    let mint = decode_spl_mint(&mint_acc.data)?;
    anyhow::ensure!(
        mint.decimals == JLP_DECIMALS,
        "JLP decimals {} != {JLP_DECIMALS}",
        mint.decimals
    );
    anyhow::ensure!(
        mint.mint_authority == Some(Pubkey::from_str(JLP_MINT_AUTHORITY)?),
        "JLP mint authority mismatch: {:?}",
        mint.mint_authority
    );

    let now = chrono::Utc::now();
    let age_secs = now.timestamp().saturating_sub(pool.aum_usd_updated_at);
    let stale = aum_is_stale(pool.aum_usd_updated_at, now.timestamp());
    metrics::gauge!("pegana_jupiter_perps_aum_age_secs").set(age_secs as f64);
    if let Err(e) = crate::sinks::postgres::upsert_intrinsic_liveness(
        &state.pg,
        &t.symbol,
        stale,
        "aum_refresh_stale",
        serde_json::json!({
            "aum_usd_updated_at": pool.aum_usd_updated_at,
            "age_secs": age_secs,
            "max_age_secs": MAX_AUM_AGE_SECS,
        }),
    )
    .await
    {
        warn!(error = %e, "intrinsic_liveness upsert failed (aum_refresh_stale)");
    }
    anyhow::ensure!(
        !stale,
        "perps pool aum_usd not refreshed for {age_secs}s (> {MAX_AUM_AGE_SECS}s): refusing to publish"
    );

    let nav = compute_nav(pool.aum_usd, mint.supply)?;
    metrics::histogram!("pegana_jupiter_perps_latency_seconds")
        .record(started.elapsed().as_secs_f64());
    metrics::gauge!("pegana_jupiter_perps_nav_usd").set(pegana_common::decimal_to_f64(nav));

    let scale = Decimal::from(1_000_000u32);
    let aum_usd = Decimal::from_i128_with_scale(i128::try_from(pool.aum_usd)?, 0) / scale;
    let meta = serde_json::json!({
        "pool": t.pool.to_string(),
        "program": t.program.to_string(),
        "lp_mint": t.lp_mint.to_string(),
        "pool_name": pool.name,
        "custodies": pool.custody_count,
        "aum_usd": aum_usd,
        "lp_supply": Decimal::from(mint.supply) / scale,
        "aum_usd_updated_at": pool.aum_usd_updated_at,
        "slot": slot,
        "formula": "pool.aum_usd / jlp_mint.supply (one getMultipleAccounts)",
    });
    nav_publish::publish_intrinsic(
        state,
        &t.symbol,
        nav,
        "jupiter_perps",
        meta,
        i64::try_from(slot).ok(),
        now,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Recorded mainnet `getMultipleAccounts([pool, JLP mint])`, slot 459825788
    /// (2026-10-21).
    fn fixture() -> (serde_json::Value, Vec<u8>, Vec<u8>) {
        let raw = std::fs::read_to_string("fixtures/jupiter_perps/pool-and-jlp-mint.json")
            .expect("fixture present");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("fixture JSON");
        let b64 = |i: usize| {
            base64::engine::general_purpose::STANDARD
                .decode(json["result"]["value"][i]["data"][0].as_str().unwrap())
                .unwrap()
        };
        let (pool, mint) = (b64(0), b64(1));
        (json, pool, mint)
    }

    #[test]
    fn decodes_recorded_pool_and_mint() {
        let (json, pool_bytes, mint_bytes) = fixture();
        assert_eq!(
            json["result"]["value"][0]["owner"].as_str(),
            Some(PERPS_PROGRAM)
        );
        let pool = decode_pool(&pool_bytes).expect("pool decodes");
        assert_eq!(pool.name, "Pool");
        assert_eq!(pool.custody_count, 6);
        assert_eq!(pool.aum_usd, 879_231_676_763_053);
        assert_eq!(pool.aum_usd_updated_at, 1_792_627_628);

        let mint = decode_spl_mint(&mint_bytes).expect("mint decodes");
        assert_eq!(mint.decimals, 6);
        assert_eq!(mint.supply, 189_943_443_819_286);
        assert_eq!(
            mint.mint_authority,
            Some(Pubkey::from_str(JLP_MINT_AUTHORITY).unwrap())
        );

        let nav = compute_nav(pool.aum_usd, mint.supply).unwrap();
        assert_eq!(nav.round_dp(4).to_string(), "4.6289");
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let (_, mut pool, _) = fixture();
        pool[0] ^= 0xff;
        let e = decode_pool(&pool).unwrap_err().to_string();
        assert!(e.contains("discriminator"), "{e}");
    }

    #[test]
    fn rejects_huge_name_and_custody_lengths() {
        let (_, pool, _) = fixture();
        let mut bad = pool.clone();
        bad[8..12].copy_from_slice(&10_000u32.to_le_bytes());
        assert!(decode_pool(&bad)
            .unwrap_err()
            .to_string()
            .contains("name length"));

        let mut bad = pool.clone();
        // name "Pool" = 4 bytes → custody count at 8 + 4 + 4 = 16.
        bad[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode_pool(&bad)
            .unwrap_err()
            .to_string()
            .contains("custody count"));
    }

    #[test]
    fn rejects_truncated_pool() {
        let (_, pool, _) = fixture();
        let e = decode_pool(&pool[..300]).unwrap_err().to_string();
        assert!(e.contains("out of bounds"), "{e}");
    }

    #[test]
    fn staleness_rejection_bound() {
        let at = 1_792_627_628;
        assert!(!aum_is_stale(at, at + 5));
        assert!(!aum_is_stale(at, at + MAX_AUM_AGE_SECS));
        assert!(aum_is_stale(at, at + MAX_AUM_AGE_SECS + 1));
    }

    #[test]
    fn nav_sanity_band() {
        assert!(compute_nav(1, 0).is_err());
        assert!(compute_nav(0, 1).is_err());
        // 100 USD per token is outside [0.5, 50].
        assert!(compute_nav(100_000_000, 1_000_000).is_err());
        assert!(compute_nav(4_000_000, 1_000_000).is_ok());
    }

    /// Mainnet RPC for live smokes: `SOLANA_RPC_URL`, else a Helius URL from
    /// `HELIUS_API_KEY`, else the public endpoint. Never printed.
    fn live_rpc() -> RpcClient {
        let url = std::env::var("SOLANA_RPC_URL").ok().unwrap_or_else(|| {
            match std::env::var("HELIUS_API_KEY") {
                Ok(k) => format!("https://mainnet.helius-rpc.com/?api-key={k}"),
                Err(_) => "https://api.mainnet-beta.solana.com".to_string(),
            }
        });
        RpcClient::new_with_commitment(url, CommitmentConfig::confirmed())
    }

    /// Live smoke (network): `cargo test -p indexer-rs -- --ignored live_smoke`.
    #[tokio::test]
    #[ignore]
    async fn live_smoke_jlp_nav() {
        let rpc = live_rpc();
        let pool = Pubkey::from_str("5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq").unwrap();
        let mint = Pubkey::from_str("27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4").unwrap();
        let (accs, slot) =
            crate::rpc::get_multiple_accounts_with_fallback(&rpc, &rpc, &[pool, mint], "smoke")
                .await
                .unwrap();
        let p = decode_pool(&crate::rpc::required_account(&accs, 0, "pool").unwrap().data).unwrap();
        let m =
            decode_spl_mint(&crate::rpc::required_account(&accs, 1, "mint").unwrap().data).unwrap();
        let nav = compute_nav(p.aum_usd, m.supply).unwrap();
        let age = chrono::Utc::now().timestamp() - p.aum_usd_updated_at;
        println!(
            "LIVE JLP slot={slot} aum_usd={} supply={} nav={nav} aum_age_secs={age}",
            p.aum_usd, m.supply
        );
        assert!(!aum_is_stale(
            p.aum_usd_updated_at,
            chrono::Utc::now().timestamp()
        ));
    }

    proptest::proptest! {
        #[test]
        fn decode_pool_never_panics(data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..600)) {
            let _ = decode_pool(&data);
        }

        #[test]
        fn decode_pool_valid_prefix_never_panics(name_len in 0u32..80, custodies in 0u32..40, tail in proptest::collection::vec(proptest::num::u8::ANY, 0usize..1400)) {
            let mut data = POOL_DISCRIMINATOR.to_vec();
            data.extend_from_slice(&name_len.to_le_bytes());
            data.extend(std::iter::repeat_n(b'a', name_len as usize));
            data.extend_from_slice(&custodies.to_le_bytes());
            data.extend(tail);
            let _ = decode_pool(&data);
        }

        #[test]
        fn decode_mint_never_panics(data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..120)) {
            let _ = decode_spl_mint(&data);
        }
    }
}
