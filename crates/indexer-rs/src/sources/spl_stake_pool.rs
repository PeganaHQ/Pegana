//! Generic SPL stake-pool intrinsic NAV reader.
//!
//! For LSTs that are NOT in the Sanctum registry (so `sanctum_lst` can't price
//! them) but ARE standard SPL stake pools. The StakePool state account (owned by
//! the canonical SPL stake-pool program `SPoo1Ku8…` or a SanctumSpl fork
//! `SP12tWFx…`, identical layout) holds the running totals:
//!
//!   off   0 [ 1] account_type (== 1 for an initialized StakePool)
//!   off 162 [32] pool_mint   (must equal the LST mint)
//!   off 258 [ 8] total_lamports     (u64 LE) — NAV numerator (SOL backing)
//!   off 266 [ 8] pool_token_supply  (u64 LE) — NAV denominator (LST supply)
//!   off 274 [ 8] last_update_epoch  (u64 LE) — forensics (epoch lag)
//!
//! NAV (SOL per LST) = total_lamports / pool_token_supply (both 9-dp base units,
//! scale cancels). USD intrinsic = NAV × Pyth SOL/USD. We also publish value_sol
//! so the engine cancels the shared SOL/USD multiplier (LST burst guard, same as
//! Sanctum). Decoded by hand — the `spl-stake-pool` crate is NOT a dep (borsh
//! version conflict, Cargo.toml:64-69). Cadence 30s.

use crate::sinks;
use crate::state::AppState;
use anyhow::{ensure, Context, Result};
use chrono::{DateTime, Utc};
use pegana_common::IntrinsicStrategy;
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

const ACCOUNT_TYPE_STAKE_POOL: u8 = 1;
const POOL_MINT_OFFSET: usize = 162;
const TOTAL_LAMPORTS_OFFSET: usize = 258;
const POOL_TOKEN_SUPPLY_OFFSET: usize = 266;
const LAST_UPDATE_EPOCH_OFFSET: usize = 274;
/// We read through last_update_epoch (274..282); the live accounts are ~611 B.
const MIN_STAKE_POOL_LEN: usize = 282;

/// Epochs the pool's `last_update_epoch` may lag the current Solana epoch before
/// we WARN. SPL stake pools crank once per epoch (`UpdateStakePoolBalance`);
/// `last_update_epoch` records the last crank. A lag of 0-1 is normal (1 = the
/// crank hasn't run yet THIS epoch). A lag ≥ 2 means the pool hasn't been cranked
/// for a full ~2-day epoch — the `total_lamports`/`pool_token_supply` (and thus
/// the NAV) are FROZEN, yet `poll_one` re-reads the same account every 30s and
/// stamps it `ts = now()`, so the engine's timestamp-only staleness gate never
/// trips. This is the SplStakePool analogue of the SanctumLst directory `stale`
/// flag: those assets (jitoSOL et al.) have NO other frozen-backing detector.
/// Observability only — never gates a verdict.
pub(crate) const EPOCH_LAG_WARN: u64 = 2;

/// Epochs the pool's last crank lags the current epoch. Saturating so a spurious
/// `last_update_epoch` ahead of `current` reads 0 rather than underflowing.
pub(crate) fn epoch_lag(current_epoch: u64, last_update_epoch: u64) -> u64 {
    current_epoch.saturating_sub(last_update_epoch)
}

/// Decode NAV (SOL per LST token) from a StakePool state account.
/// Returns (nav_sol, total_lamports, pool_token_supply, last_update_epoch).
pub fn decode_nav_sol(data: &[u8], expected_mint: &Pubkey) -> Result<(Decimal, u64, u64, u64)> {
    ensure!(
        data.len() >= MIN_STAKE_POOL_LEN,
        "stake-pool account too short: {} bytes (need ≥ {})",
        data.len(),
        MIN_STAKE_POOL_LEN
    );
    ensure!(
        data[0] == ACCOUNT_TYPE_STAKE_POOL,
        "not an initialized StakePool: account_type={} (expected 1)",
        data[0]
    );
    let pool_mint = Pubkey::try_from(&data[POOL_MINT_OFFSET..POOL_MINT_OFFSET + 32])
        .map_err(|_| anyhow::anyhow!("invalid pool_mint pubkey at offset {POOL_MINT_OFFSET}"))?;
    ensure!(
        &pool_mint == expected_mint,
        "pool_mint mismatch: account says {pool_mint}, expected {expected_mint}"
    );
    let total_lamports = read_u64_le(data, TOTAL_LAMPORTS_OFFSET)?;
    let pool_token_supply = read_u64_le(data, POOL_TOKEN_SUPPLY_OFFSET)?;
    let last_update_epoch = read_u64_le(data, LAST_UPDATE_EPOCH_OFFSET)?;
    ensure!(pool_token_supply > 0, "pool_token_supply is zero");
    ensure!(total_lamports > 0, "total_lamports is zero");
    let nav_sol = Decimal::from(total_lamports)
        .checked_div(Decimal::from(pool_token_supply))
        .context("NAV division overflow")?;
    ensure!(
        nav_sol >= Decimal::from_str("0.99").unwrap() && nav_sol < Decimal::from(2u32),
        "NAV_sol {nav_sol} outside [0.99, 2.0) — layout drift or unhealthy pool"
    );
    Ok((
        nav_sol,
        total_lamports,
        pool_token_supply,
        last_update_epoch,
    ))
}

/// Bounds-checked little-endian u64 read (mirrors piggybank_pb::read_u64_le).
fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| anyhow::anyhow!("read_u64_le offset overflow: {offset}"))?;
    let bytes = data.get(offset..end).ok_or_else(|| {
        anyhow::anyhow!("read_u64_le out of bounds at {offset}, len {}", data.len())
    })?;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

struct PoolCfg {
    symbol: String,
    mint: Pubkey,
    pool: Pubkey,
    program: Pubkey,
}

fn collect_pools(state: &AppState) -> Result<Vec<PoolCfg>> {
    let mut out = Vec::new();
    for a in &state.assets.assets {
        if !a.active {
            continue;
        }
        if let IntrinsicStrategy::SplStakePool { pool, program } = &a.intrinsic {
            out.push(PoolCfg {
                symbol: a.symbol.clone(),
                mint: Pubkey::from_str(&a.mint).with_context(|| format!("{} mint", a.symbol))?,
                pool: Pubkey::from_str(pool).with_context(|| format!("{} pool", a.symbol))?,
                program: Pubkey::from_str(program)
                    .with_context(|| format!("{} program", a.symbol))?,
            });
        }
    }
    Ok(out)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_spl_stake_pool {
        info!("FEATURE_SPL_STAKE_POOL=false — spl_stake_pool source disabled");
        return Ok(());
    }
    let pools = collect_pools(&state)?;
    if pools.is_empty() {
        info!("no active spl_stake_pool assets — spl_stake_pool source idle");
        return Ok(());
    }
    let cadence_ms = state.config.spl_stake_pool_poll_ms.unwrap_or(30_000);
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
        pool_count = pools.len(),
        "spl_stake_pool source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("spl_stake_pool source shutdown");
                return Ok(());
            }
        }
        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &pools).await {
            warn!(error = %e, "spl_stake_pool poll failed");
            metrics::counter!("pegana_spl_stake_pool_polls_total", "status" => "error")
                .increment(1);
        } else {
            metrics::counter!("pegana_spl_stake_pool_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    pools: &[PoolCfg],
) -> Result<()> {
    let started = std::time::Instant::now();
    // Fresh Pyth, else Jupiter-derived — a stalled-publisher SOL/USD must not
    // be multiplied into a fresh-looking LST NAV, and if neither tier has a
    // usable price we skip (see jupiter::numeraire_usd).
    let Some(sol_usd) = crate::sources::jupiter::numeraire_usd(state, "SOL/USD").await else {
        debug!(
            "SOL/USD missing/zero/stale from Pyth and Jupiter unavailable — skipping \
             spl_stake_pool tick"
        );
        return Ok(());
    };

    // Current Solana epoch for the crank-staleness (frozen-backing) check.
    // Fetched once per tick, not per pool. A failure here must NOT fail the NAV
    // poll — the NAV read is independent and more important — so it degrades to
    // `None` and the lag check is skipped this tick.
    let current_epoch = match rpc.get_epoch_info().await {
        Ok(info) => Some(info.epoch),
        Err(_) => match rpc_fallback.get_epoch_info().await {
            Ok(info) => Some(info.epoch),
            Err(e) => {
                debug!(error = %e, "get_epoch_info failed on both RPCs — skipping epoch-lag check this tick");
                None
            }
        },
    };

    let ts = chrono::Utc::now();
    for p in pools {
        if let Err(e) = poll_one(state, rpc, rpc_fallback, p, sol_usd, current_epoch, ts).await {
            warn!(symbol = %p.symbol, error = %e, "spl_stake_pool asset poll failed");
        }
    }
    metrics::histogram!("pegana_spl_stake_pool_latency_seconds")
        .record(started.elapsed().as_secs_f64());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn poll_one(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    p: &PoolCfg,
    sol_usd: Decimal,
    current_epoch: Option<u64>,
    ts: DateTime<Utc>,
) -> Result<()> {
    let account =
        crate::rpc::get_account_with_fallback(rpc, rpc_fallback, &p.pool, "spl_stake_pool").await?;
    ensure!(
        account.owner == p.program,
        "{} stake-pool owner mismatch: got {} expected {}",
        p.symbol,
        account.owner,
        p.program
    );
    let (nav_sol, total_lamports, pool_token_supply, last_update_epoch) =
        decode_nav_sol(&account.data, &p.mint)?;
    // checked_mul (audit F-12): raw Decimal `*` panics on overflow. `nav_sol` is
    // decoder-bounded to [0.99, 2.0), but `sol_usd` is an external Pyth price
    // with no economic upper bound — a corrupted/extreme oracle read makes
    // `nav_sol * sol_usd` panic and crash-loop the tick. Skip cleanly instead.
    // (Twin of the hylo `reserve_sol * sol_usd` fix in e850c71.)
    let Some(value_usd) = nav_sol.checked_mul(sol_usd) else {
        warn!(
            symbol = %p.symbol,
            %nav_sol,
            %sol_usd,
            "spl_stake_pool value_usd overflow (nav_sol × sol_usd) — skipping tick"
        );
        return Ok(());
    };
    metrics::gauge!("pegana_spl_stake_pool_nav_sol", "symbol" => p.symbol.clone())
        .set(pegana_common::decimal_to_f64(nav_sol));

    // Crank-staleness (frozen-backing) signal — the SplStakePool twin of the
    // SanctumLst directory `stale` flag, which does NOT cover these assets.
    if let Some(current) = current_epoch {
        let lag = epoch_lag(current, last_update_epoch);
        metrics::gauge!("pegana_spl_stake_pool_epoch_lag", "symbol" => p.symbol.clone())
            .set(lag as f64);
        if lag >= EPOCH_LAG_WARN {
            warn!(
                symbol = %p.symbol,
                current_epoch = current,
                last_update_epoch,
                epoch_lag = lag,
                "spl_stake_pool crank stalled: NAV backing hasn't advanced in ≥{EPOCH_LAG_WARN} \
                 epochs — the served NAV is FROZEN but still stamped ts=now(), so the engine's \
                 timestamp-only staleness gate won't catch it (a false-PEGGED risk). Investigate \
                 the pool's UpdateStakePoolBalance crank (informational only, NOT a peg signal; \
                 the verdict pipeline is untouched)"
            );
        }

        // Persist the intrinsic-liveness signal (ADR-0038) for the engine's
        // gate: a SplStakePool is "backing stale" when its crank lag reaches the
        // warn floor. Observe-only until INTRINSIC_LIVENESS_GATE is enabled. A
        // write failure must not break the NAV poll.
        if let Err(e) = sinks::postgres::upsert_intrinsic_liveness(
            &state.pg,
            &p.symbol,
            lag >= EPOCH_LAG_WARN,
            "epoch_lag",
            serde_json::json!({
                "epoch_lag": lag,
                "current_epoch": current,
                "last_update_epoch": last_update_epoch,
            }),
        )
        .await
        {
            warn!(symbol = %p.symbol, error = %e, "intrinsic_liveness upsert failed (epoch_lag)");
        }
    }

    let meta = serde_json::json!({
        "pool": p.pool.to_string(),
        "program": p.program.to_string(),
        "nav_sol": nav_sol,
        // Same key sanctum.rs writes, which /v1/assets reads as `sol_per_lst`
        // (`meta->>'sol_per_lst'`). Without it jitoSOL and the other SPL
        // stake-pool LSTs served no sol_per_lst at all.
        "sol_per_lst": nav_sol,
        "total_lamports": total_lamports.to_string(),
        "pool_token_supply": pool_token_supply.to_string(),
        "last_update_epoch": last_update_epoch.to_string(),
        "sol_usd": sol_usd,
        "formula": "total_lamports / pool_token_supply × pyth(SOL/USD)",
    });
    sinks::postgres::insert_intrinsic(
        &state.pg,
        &p.symbol,
        value_usd,
        "spl_stake_pool+pyth",
        meta.clone(),
        None,
        ts,
    )
    .await
    .context("insert intrinsic")?;

    let payload = serde_json::json!({
        "asset": p.symbol,
        "value_usd": value_usd,
        "value_sol": nav_sol,
        "source": "spl_stake_pool+pyth",
        "meta": meta,
        "ts": ts,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_SPL_STAKE_POOL,
        &payload,
        "spl_stake_pool",
    )
    .await
    .context("publish to redis")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    proptest::proptest! {
        // Fuzz: arbitrary bytes must never PANIC the decoder — only Ok / Err.
        #[test]
        fn decode_nav_sol_no_panic_on_arbitrary_bytes(
            data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..400),
        ) {
            let _ = decode_nav_sol(&data, &Pubkey::default());
        }

        // Fuzz: valid account_type + matching (zero) pool_mint, fuzzed
        // total_lamports / pool_token_supply — reaches the checked_div NAV_sol +
        // sanity band. pool_token_supply == 0 hits the zero-guard (Err).
        #[test]
        fn decode_nav_sol_no_panic_on_valid_prefix(
            total_lamports in proptest::num::u64::ANY,
            pool_token_supply in proptest::num::u64::ANY,
        ) {
            let mint = Pubkey::default();
            let mut data = vec![0u8; MIN_STAKE_POOL_LEN + 8];
            data[0] = ACCOUNT_TYPE_STAKE_POOL;
            // pool_mint at POOL_MINT_OFFSET stays zeroed == Pubkey::default().
            data[TOTAL_LAMPORTS_OFFSET..TOTAL_LAMPORTS_OFFSET + 8]
                .copy_from_slice(&total_lamports.to_le_bytes());
            data[POOL_TOKEN_SUPPLY_OFFSET..POOL_TOKEN_SUPPLY_OFFSET + 8]
                .copy_from_slice(&pool_token_supply.to_le_bytes());
            let _ = decode_nav_sol(&data, &mint);
        }
    }

    fn load(name: &str) -> (Vec<u8>, String) {
        let raw = std::fs::read_to_string(format!("fixtures/spl_stake_pool/{name}-pool.json"))
            .expect("fixture present");
        let j: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let b64 = j["result"]["value"]["data"][0].as_str().expect("base64");
        let owner = j["result"]["value"]["owner"].as_str().unwrap().to_string();
        (
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .unwrap(),
            owner,
        )
    }

    #[test]
    fn decodes_stkesol() {
        let (data, owner) = load("stkesol");
        assert_eq!(owner, "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy");
        let mint = Pubkey::from_str("stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh").unwrap();
        let (nav, tl, pts, _epoch) = decode_nav_sol(&data, &mint).expect("decode");
        assert!(tl > 0 && pts > 0);
        assert!(
            nav > Decimal::ONE && nav < Decimal::from_str("1.2").unwrap(),
            "STKESOL NAV {nav} must be a sane LST appreciation ratio"
        );
    }

    #[test]
    fn decodes_rkusol_and_corvussol() {
        for (name, mint_str) in [
            ("rkusol", "rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp"),
            ("corvussol", "CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg"),
        ] {
            let (data, owner) = load(name);
            assert_eq!(
                owner, "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY",
                "{name}"
            );
            let mint = Pubkey::from_str(mint_str).unwrap();
            let (nav, _, _, _) = decode_nav_sol(&data, &mint).expect("decode");
            assert!(
                nav > Decimal::ONE && nav < Decimal::from_str("1.2").unwrap(),
                "{name} NAV {nav}"
            );
        }
    }

    /// jitoSOL is the pilot for direct SPL stake-pool reads (ADR-0031).
    /// Pool: Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb
    /// Owner: SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy (canonical SPL stake-pool program)
    /// Verified on-chain 2026-07-01: account_type=1, pool_mint=J1toso1u…, NAV≈1.2879 ∈ (1.0,1.2+).
    #[test]
    fn decodes_jitosol() {
        let (data, owner) = load("jitosol");
        assert_eq!(
            owner, "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
            "jitoSOL must be owned by the canonical SPL stake-pool program"
        );
        let mint = Pubkey::from_str("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn").unwrap();
        let (nav, tl, pts, epoch) = decode_nav_sol(&data, &mint).expect("jitoSOL decode");
        assert!(tl > 0, "jitoSOL total_lamports must be > 0");
        assert!(pts > 0, "jitoSOL pool_token_supply must be > 0");
        assert!(epoch > 0, "jitoSOL last_update_epoch must be > 0");
        assert!(
            nav > Decimal::ONE && nav < Decimal::from_str("1.5").unwrap(),
            "jitoSOL NAV {nav} must be in (1.0, 1.5) — sane LST appreciation ratio"
        );
    }

    /// Negative test: a Marinade/mSOL account is NOT an SPL stake-pool. Marinade uses a
    /// proprietary program layout whose first byte is NOT 1 (StakePool account_type). The
    /// decoder must reject it so a wrong pool address doesn't publish a garbage NAV.
    #[test]
    fn rejects_marinade_style_account() {
        // Simulate a Marinade-like account: first byte != 1 (their state discriminator
        // is a different value — we use 7 to represent an unknown proprietary layout).
        let mut data = vec![0u8; MIN_STAKE_POOL_LEN];
        data[0] = 7; // Marinade/proprietary discriminator, not StakePool (1)
        let mint = Pubkey::new_unique();
        let err = decode_nav_sol(&data, &mint).unwrap_err();
        assert!(
            err.to_string().contains("not an initialized"),
            "Marinade-style account (account_type=7) must be rejected: {err}"
        );
    }

    #[test]
    fn rejects_wrong_account_type() {
        let mut data = vec![0u8; MIN_STAKE_POOL_LEN];
        data[0] = 2; // not a StakePool
        let mint = Pubkey::new_unique();
        assert!(decode_nav_sol(&data, &mint)
            .unwrap_err()
            .to_string()
            .contains("not an initialized"));
    }

    #[test]
    fn rejects_mint_mismatch() {
        let (data, _) = load("stkesol");
        let wrong = Pubkey::new_unique();
        assert!(decode_nav_sol(&data, &wrong)
            .unwrap_err()
            .to_string()
            .contains("pool_mint mismatch"));
    }

    #[test]
    fn rejects_short_account() {
        let mint = Pubkey::new_unique();
        assert!(decode_nav_sol(&[0u8; 50], &mint)
            .unwrap_err()
            .to_string()
            .contains("too short"));
    }

    #[test]
    fn epoch_lag_is_saturating_and_flags_stalled_crank() {
        // Normal: cranked this epoch (0) or last epoch (1) — below the warn floor.
        assert_eq!(epoch_lag(700, 700), 0);
        assert_eq!(epoch_lag(700, 699), 1);
        assert!(epoch_lag(700, 700) < EPOCH_LAG_WARN);
        assert!(epoch_lag(700, 699) < EPOCH_LAG_WARN);
        // Stalled: ≥ 2 epochs (~≥ a full 2-day epoch) without a crank → WARN.
        assert_eq!(epoch_lag(700, 698), 2);
        assert!(epoch_lag(700, 698) >= EPOCH_LAG_WARN);
        assert!(epoch_lag(700, 690) >= EPOCH_LAG_WARN);
        // Saturating: a spurious last_update ahead of current never underflows.
        assert_eq!(epoch_lag(700, 701), 0);
    }
}
