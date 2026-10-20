//! Hylo intrinsic values for hyUSD, sHYUSD, xSOL.
//!
//! Strategy (v1.7 — on-chain TVL, no DefiLlama lag):
//!
//!   - Read Hylo Exchange's canonical `total_sol_cache.total_sol` directly from
//!     the protocol PDA (`b"hylo"` under HYEXCH…). This is the same value Hylo's
//!     own UI uses — it tracks the SOL collateral backing hyUSD+xSOL and is
//!     incremented/decremented on every mint/redeem (enforced by the program
//!     against the current Solana epoch).
//!
//!   - reserve_usd = total_sol × pyth_sol_usd. Both inputs live → no time-basis
//!     mismatch.
//!
//!   - hyUSD intrinsic = min($1, CR) where CR = reserve_usd / hyusd_supply.
//!
//!   - sHYUSD intrinsic = (pool_hyusd_balance / shyusd_supply) × hyUSD_NAV.
//!     Stability Pool's hyUSD token account derived from the PDA seed
//!     `b"pool_auth"` (hylo_stability_pool IDL).
//!
//!   - xSOL intrinsic_usd = (reserve_usd − hyusd_supply × hyusd_nav) / xsol_supply.
//!     This is Hylo's own `next_levercoin_*_nav` formula (hylo-core).
//!     hyloSOL / hyloSOL+ are a SEPARATE Hylo LST product — they do NOT back
//!     hyUSD/xSOL and must not be subtracted (prior v1.6 logic was incorrect).

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{account::Account, commitment_config::CommitmentConfig, pubkey::Pubkey};
use spl_associated_token_account::get_associated_token_address;
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

const HYUSD_MINT: &str = "5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E";
const XSOL_MINT: &str = "4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs";
const SHYUSD_MINT: &str = "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz";
const STABILITY_POOL_PROGRAM: &str = "HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ";
const EXCHANGE_PROGRAM: &str = "HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn";

/// Stability Pool POOL_AUTH seed (hylo_stability_pool IDL `constants`).
const POOL_AUTH_SEED: &[u8] = b"pool_auth";
/// Hylo Exchange root state PDA seed (hylo_exchange IDL `constants` → HYLO).
const HYLO_STATE_SEED: &[u8] = b"hylo";

/// Anchor 8-byte discriminator for `Hylo` account (from hylo_exchange IDL).
const HYLO_ACCOUNT_DISCRIMINATOR: [u8; 8] = [114, 161, 169, 210, 204, 175, 149, 174];

/// Byte offset of `total_sol_cache` inside the Hylo account data (after the
/// 8-byte Anchor discriminator). Layout walked from hylo_exchange IDL field
/// order; verified live on mainnet against 9cd2sAfbBvKs4SX9YKo4dcjwP3TgTVQ8dT5koshGcDND.
///
///   8 disc + 6×32 pubkeys (admin..stability_pool) + 6×1 bumps + 8 oracle_secs
///   + 36 StablecoinFees + 54 LevercoinFees = 304
const HYLO_TOTAL_SOL_CACHE_OFFSET: usize = 304;
const HYLO_TOTAL_SOL_BITS_OFFSET: usize = HYLO_TOTAL_SOL_CACHE_OFFSET + 8; // skip current_update_epoch
const HYLO_TOTAL_SOL_EXP_OFFSET: usize = HYLO_TOTAL_SOL_BITS_OFFSET + 8;

/// Epochs the `total_sol_cache.update_epoch` may lag the current Solana epoch
/// before the SOL backing is flagged stale for the intrinsic-liveness gate
/// (ADR-0038). Same reasoning + default as `spl_stake_pool::EPOCH_LAG_WARN`: the
/// program stamps the cache with the current epoch on each mutation, so 0-1 is
/// normal and ≥ 2 (~≥ a full 2-day epoch un-advanced) is a real freeze. Covers
/// hyUSD (CR) + xSOL (NAV), which both read `total_sol`; NOT sHYUSD (its rate is
/// pool-balance-based, independent of this cache). Calibratable at enable time.
const HYLO_EPOCH_LAG_WARN: u64 = 2;

// 10^6. SAFE only while every Hylo token this source reads (hyUSD, sHYUSD via
// HYUSD_MINT/SHYUSD_MINT) stays 6-decimal — re-verify against the mint if a
// non-6dp Hylo token is ever added (H11b: decimals are mint-coupled).
const TOKEN_DECIMALS_6: u64 = 1_000_000;

const HYUSD_MINT_ACCOUNT_INDEX: usize = 0;
const XSOL_MINT_ACCOUNT_INDEX: usize = 1;
const SHYUSD_MINT_ACCOUNT_INDEX: usize = 2;
const HYUSD_POOL_ATA_ACCOUNT_INDEX: usize = 3;
const HYLO_STATE_ACCOUNT_INDEX: usize = 4;

/// Resolve the Hylo polling cadence (ms) with a three-level priority:
///   1. `env_ms`  — `HYLO_POLL_MS` env var (parsed by Config, wins if set).
///   2. `toml_ms` — `[polling] hylo_onchain_poll_ms` in assets.toml (fallback).
///   3. 30 000 ms — hard-coded default.
///
/// Extracted as a pure function so the priority logic can be unit-tested
/// without spinning up the async poll loop.
fn resolve_hylo_cadence(env_ms: Option<u64>, toml_ms: Option<u64>) -> u64 {
    env_ms.or(toml_ms).unwrap_or(30_000)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_hylo {
        info!("FEATURE_HYLO=false — hylo source disabled");
        return Ok(());
    }

    // Active-gate: this source computes NAV for hyUSD, sHYUSD, and xSOL in
    // one combined poll. Idle only if ALL three are deactivated — any one
    // active asset means the source must run. Today all three are active;
    // this gate is a no-op and exists for future-proofing/consistency.
    let hylo_mints: &[&str] = &[HYUSD_MINT, SHYUSD_MINT, XSOL_MINT];
    let any_hylo_active = state
        .assets
        .assets
        .iter()
        .any(|a| a.active && hylo_mints.contains(&a.mint.as_str()));
    if !any_hylo_active {
        info!("all Hylo assets inactive (active=false) — hylo source idle");
        return Ok(());
    }

    let cadence = resolve_hylo_cadence(
        state.config.hylo_poll_ms,
        state.assets.polling.hylo_onchain_poll_ms,
    );
    let mut tick = interval(Duration::from_millis(cadence));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    // Pre-derive PDAs once (deterministic from on-chain seeds — never changes).
    let exchange_pk = Pubkey::from_str(EXCHANGE_PROGRAM).context("parse exchange program")?;
    let stability_pool_pk =
        Pubkey::from_str(STABILITY_POOL_PROGRAM).context("parse stability pool program")?;
    let hyusd_pk = Pubkey::from_str(HYUSD_MINT).context("parse hyusd mint")?;
    let xsol_pk = Pubkey::from_str(XSOL_MINT).context("parse xsol mint")?;
    let shyusd_pk = Pubkey::from_str(SHYUSD_MINT).context("parse shyusd mint")?;

    let (hylo_state_pk, _bump) = Pubkey::find_program_address(&[HYLO_STATE_SEED], &exchange_pk);
    let (pool_auth, _bump) = Pubkey::find_program_address(&[POOL_AUTH_SEED], &stability_pool_pk);
    let hyusd_pool_ata = get_associated_token_address(&pool_auth, &hyusd_pk);

    info!(
        cadence_ms = cadence,
        hylo_state = %hylo_state_pk,
        pool_auth = %pool_auth,
        hyusd_pool_ata = %hyusd_pool_ata,
        "hylo source ready (v1.7 — on-chain total_sol, no DefiLlama)"
    );

    let rpc = RpcClient::new_with_commitment(
        state.config.solana_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let rpc_fallback = RpcClient::new_with_commitment(
        state.config.solana_rpc_url_fallback.clone(),
        CommitmentConfig::confirmed(),
    );

    let ctx = HyloContext {
        hyusd_pk,
        xsol_pk,
        shyusd_pk,
        hylo_state_pk,
        hyusd_pool_ata,
    };

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("hylo source shutdown");
                return Ok(());
            }
        }
        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &ctx).await {
            warn!(error = %e, "hylo poll failed");
            metrics::counter!("pegana_hylo_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_hylo_polls_total", "status" => "ok").increment(1);
        }
    }
}

struct HyloContext {
    hyusd_pk: Pubkey,
    xsol_pk: Pubkey,
    shyusd_pk: Pubkey,
    hylo_state_pk: Pubkey,
    hyusd_pool_ata: Pubkey,
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    ctx: &HyloContext,
) -> Result<()> {
    // 1. Token supplies — all 6-decimal.
    let account_pubkeys = [
        ctx.hyusd_pk,
        ctx.xsol_pk,
        ctx.shyusd_pk,
        ctx.hyusd_pool_ata,
        ctx.hylo_state_pk,
    ];
    let (accounts, rpc_slot) = crate::rpc::get_multiple_accounts_with_fallback(
        rpc,
        rpc_fallback,
        &account_pubkeys,
        "hylo",
    )
    .await?;
    let snapshot_slot = Some(rpc_slot as i64);

    let hyusd_supply = decode_mint_supply(
        crate::rpc::required_account(&accounts, HYUSD_MINT_ACCOUNT_INDEX, "hyUSD")?,
        "hyUSD",
    )?;
    let xsol_supply = decode_mint_supply(
        crate::rpc::required_account(&accounts, XSOL_MINT_ACCOUNT_INDEX, "xSOL")?,
        "xSOL",
    )?;
    let shyusd_supply = decode_mint_supply(
        crate::rpc::required_account(&accounts, SHYUSD_MINT_ACCOUNT_INDEX, "sHYUSD")?,
        "sHYUSD",
    )?;

    // 2. Stability Pool's hyUSD balance (canonical numerator for sHYUSD rate).
    let pool_hyusd_balance = decode_token_account_amount(
        crate::rpc::required_account(&accounts, HYUSD_POOL_ATA_ACCOUNT_INDEX, "hyusd_pool_ata")?,
        &ctx.hyusd_pool_ata,
    )?;

    // 3. Protocol's canonical total SOL backing hyUSD+xSOL (on-chain, live).
    let HyloOnChainState {
        total_sol,
        update_epoch,
    } = decode_hylo_total_sol(crate::rpc::required_account(
        &accounts,
        HYLO_STATE_ACCOUNT_INDEX,
        "hylo_state",
    )?)?;
    let reserve_sol = total_sol;

    // Intrinsic-liveness (ADR-0038): the total_sol_cache's `update_epoch` is the
    // freshness marker for the SOL backing that feeds hyUSD (CR) + xSOL (NAV).
    // If the program hasn't advanced the cache in ≥ HYLO_EPOCH_LAG_WARN epochs,
    // that SOL QUANTITY is frozen — partially masked (reserve_usd still tracks
    // the live SOL PRICE) but wrong. Flag those two backings stale for the
    // engine's gate. sHYUSD is deliberately excluded (pool-balance-based, not
    // total_sol-based). Current epoch fetch is fail-soft — a failure must not
    // break the Hylo poll.
    let current_epoch = match rpc.get_epoch_info().await {
        Ok(i) => Some(i.epoch),
        Err(_) => rpc_fallback.get_epoch_info().await.ok().map(|i| i.epoch),
    };
    if let Some(current) = current_epoch {
        let lag = current.saturating_sub(update_epoch);
        metrics::gauge!("pegana_hylo_epoch_lag").set(lag as f64);
        let stale = lag >= HYLO_EPOCH_LAG_WARN;
        if stale {
            warn!(
                current_epoch = current,
                update_epoch,
                epoch_lag = lag,
                "hylo total_sol_cache stalled: the SOL backing hasn't advanced in \
                 ≥{HYLO_EPOCH_LAG_WARN} epochs — hyUSD/xSOL intrinsics are computed \
                 on a FROZEN SOL quantity (informational only, NOT a peg signal; \
                 the verdict pipeline is untouched)"
            );
        }
        for hylo_asset in ["hyUSD", "xSOL"] {
            if let Err(e) = sinks::postgres::upsert_intrinsic_liveness(
                &state.pg,
                hylo_asset,
                stale,
                "epoch_lag",
                serde_json::json!({
                    "epoch_lag": lag,
                    "current_epoch": current,
                    "update_epoch": update_epoch,
                    "source": "hylo_total_sol_cache",
                }),
            )
            .await
            {
                warn!(asset = %hylo_asset, error = %e, "intrinsic_liveness upsert failed (hylo epoch_lag)");
            }
        }
    }

    // 4. SOL/USD — fresh Pyth, else the Jupiter-derived last resort. Skip the
    // whole tick when both are unavailable. Every hylo intrinsic (hyUSD CR,
    // xSOL NAV, sHYUSD rate) needs it for USD conversion, so with sol_usd=0 the
    // hyUSD branch below computes cr=0 → intrinsic $0 and writes a GARBAGE $0
    // row for a live, publicly-alerting asset (the engine's own H8 guard skips
    // the verdict, but the poisoned row still lands in intrinsic_snapshots). A
    // STALE (frozen-publisher) SOL/USD is just as poisonous — a fresh-looking
    // intrinsic computed off a stale numéraire — and the engine can't see it
    // (indexer re-stamps ts=now()); `numeraire_usd` closes that. Matches
    // spl_stake_pool / sanctum, and this file's own xSOL is_zero() guard.
    let Some(sol_usd) = crate::sources::jupiter::numeraire_usd(state, "SOL/USD").await else {
        info!(
            "SOL/USD missing/zero/stale from Pyth and Jupiter unavailable — skipping hylo tick \
             (no USD conversion)"
        );
        return Ok(());
    };
    // checked_mul (audit F-12): `reserve_sol` comes from ufix_to_decimal, which
    // is bounded to <= Decimal::MAX but NOT economically — a corrupted/malicious
    // hylo account read can make it huge, and `reserve_sol * sol_usd` then
    // overflows Decimal → PANIC, BEFORE the tvl_out_of_band sanity gate (which
    // runs later). Overflow → skip this tick cleanly (the value is garbage).
    let Some(reserve_usd) = reserve_sol.checked_mul(sol_usd) else {
        warn!(
            reserve_sol = %reserve_sol,
            sol_usd = %sol_usd,
            "hylo reserve_usd overflow (reserve_sol × sol_usd) — corrupted total_sol read; skipping tick"
        );
        return Ok(());
    };

    let ts = chrono::Utc::now();

    // === hyUSD intrinsic = min($1, CR) ===
    let cr = if hyusd_supply.is_zero() {
        Decimal::ZERO
    } else {
        // checked_div (audit F-12): a tiny supply vs a huge reserve overflows
        // Decimal on divide → PANIC (rust_decimal). Overflow → ZERO cr → hyUSD
        // intrinsic 0 → skipped downstream (safe), never a crashed poll task.
        reserve_usd
            .checked_div(hyusd_supply)
            .unwrap_or(Decimal::ZERO)
    };
    let hyusd_intrinsic_usd = if cr >= Decimal::ONE { Decimal::ONE } else { cr };

    sinks::postgres::insert_hylo_state(
        &state.pg,
        ts,
        cr,
        hyusd_supply,
        reserve_sol,
        reserve_usd,
        0,
        Decimal::ZERO,
        Decimal::ZERO,
        serde_json::json!({
            "source": "onchain_total_sol",
            "xsol_supply": xsol_supply,
            "shyusd_supply": shyusd_supply,
            "pool_hyusd_balance": pool_hyusd_balance,
            "pool_auth_ata": ctx.hyusd_pool_ata.to_string(),
            "hylo_state": ctx.hylo_state_pk.to_string(),
            "total_sol_update_epoch": update_epoch,
        }),
    )
    .await?;

    sinks::postgres::insert_intrinsic(
        &state.pg,
        "hyUSD",
        hyusd_intrinsic_usd,
        "hylo_cr",
        serde_json::json!({ "cr": cr, "hyusd_supply": hyusd_supply, "reserve_sol": reserve_sol }),
        snapshot_slot,
        ts,
    )
    .await?;
    metrics::gauge!("pegana_hylo_cr").set(pegana_common::decimal_to_f64(cr));

    // === sHYUSD intrinsic from Stability Pool balance ===
    //
    // sHYUSD wraps hyUSD with yield. The pool's hyUSD balance is its
    // backing, and each sHYUSD has a proportional claim:
    //   rate = pool_hyusd_balance / shyusd_supply
    //   intrinsic_usd = rate × hyUSD_intrinsic_usd
    //
    // The pool may also hold xSOL during stability mode 2 (yield from xSOL
    // appreciation) — v1.5 will add that branch. For now we underestimate
    // sHYUSD slightly during stability events, which biases toward false
    // DRIFT alarms rather than missed depegs (safer direction).
    // checked_div (audit F-12): overflow → route into the same skip/None arm as
    // a missing input, never a panicked poll task. `rate × hyUSD_nav` is safe
    // (hyUSD_nav ≤ 1, so the product ≤ rate ≤ Decimal::MAX).
    let shyusd_rate = if !shyusd_supply.is_zero() && !pool_hyusd_balance.is_zero() {
        pool_hyusd_balance.checked_div(shyusd_supply)
    } else {
        None
    };
    // checked_mul (audit F-12): rate × NAV can overflow Decimal → PANIC; the `?`
    // inside the closure folds an overflow into the same None path as a missing
    // rate, so the combined snapshot below still publishes (sHYUSD = null).
    let shyusd_intrinsic_usd = if let Some((rate, usd)) =
        shyusd_rate.and_then(|rate| Some((rate, rate.checked_mul(hyusd_intrinsic_usd)?)))
    {
        sinks::postgres::insert_intrinsic(
            &state.pg,
            "sHYUSD",
            usd,
            "hylo_shyusd_rate",
            serde_json::json!({
                "formula": "(pool_hyusd_balance / shyusd_supply) × hyUSD_NAV",
                "rate": rate,
                "pool_hyusd_balance": pool_hyusd_balance,
                "shyusd_supply": shyusd_supply,
                "hyusd_nav": hyusd_intrinsic_usd,
            }),
            snapshot_slot,
            ts,
        )
        .await?;
        metrics::gauge!("pegana_hylo_shyusd_rate").set(pegana_common::decimal_to_f64(rate));
        Some(usd)
    } else {
        warn!(
            shyusd_supply = %shyusd_supply,
            pool_hyusd_balance = %pool_hyusd_balance,
            "skipping sHYUSD rate — missing input or rate overflow"
        );
        None
    };

    // === xSOL intrinsic via Hylo's own NAV formula ===
    //
    //   xSOL_NAV = (total_sol × sol_usd − hyusd_supply × hyusd_nav) / xsol_supply
    //
    // Lifted directly from hylo-core::exchange_math::next_levercoin_*_nav.
    // Both inputs (total_sol from on-chain cache, sol_usd from Pyth) are
    // current, so there is no time-basis lag.
    let xsol_intrinsic_usd: Option<Decimal> = 'xsol: {
        if xsol_supply.is_zero() || sol_usd.is_zero() || reserve_usd.is_zero() {
            warn!(
                xsol_supply = %xsol_supply,
                sol_usd = %sol_usd,
                reserve_usd = %reserve_usd,
                "skipping xSOL NAV — missing input"
            );
            break 'xsol None;
        }
        // checked_mul (audit F-12): hyusd_supply (on-chain SPL supply) × NAV can
        // overflow Decimal → PANIC; overflow → skip xSOL (None) so the combined
        // snapshot below still publishes, matching the checked_div guard.
        let Some(hyusd_mc) = hyusd_supply.checked_mul(hyusd_intrinsic_usd) else {
            warn!(
                hyusd_supply = %hyusd_supply,
                hyusd_nav = %hyusd_intrinsic_usd,
                "xSOL hyusd_mc overflow (hyusd_supply × hyusd_nav) — skipping xSOL"
            );
            break 'xsol None;
        };
        let free_collateral_usd = reserve_usd - hyusd_mc;
        // checked_div (audit F-12): a huge free-collateral vs a tiny xSOL supply
        // overflows Decimal on divide → PANIC; overflow → skip (None), never a
        // crashed poll task.
        let xsol_nav = free_collateral_usd.checked_div(xsol_supply);
        if let (true, Some(usd)) = (free_collateral_usd > Decimal::ZERO, xsol_nav) {
            sinks::postgres::insert_intrinsic(
                &state.pg,
                "xSOL",
                usd,
                "hylo_xsol_nav",
                serde_json::json!({
                    "formula": "(total_sol × sol_usd − hyusd_supply × hyusd_nav) / xsol_supply",
                    "total_sol": reserve_sol,
                    "reserve_usd": reserve_usd,
                    "hyusd_mc": hyusd_mc,
                    "xsol_supply": xsol_supply,
                    "sol_usd": sol_usd,
                }),
                snapshot_slot,
                ts,
            )
            .await?;
            metrics::gauge!("pegana_hylo_xsol_nav_usd").set(pegana_common::decimal_to_f64(usd));
            Some(usd)
        } else {
            warn!(
                reserve_usd = %reserve_usd,
                hyusd_mc = %hyusd_mc,
                "xSOL invariant produced non-positive free collateral — system undercollateralized on hyUSD"
            );
            None
        }
    };

    // === Sanity checks (R1 drift detection) ===
    let inputs = HyloSnapshotInputs {
        reserve_usd,
        cr,
        hyusd_supply,
        xsol_supply,
        shyusd_supply,
        pool_hyusd_balance,
        sol_usd,
    };
    let failures = check_hylo_inputs(&inputs);
    if !failures.is_empty() {
        report_sanity_failures(&failures);
    }

    // === Publish combined snapshot ===
    let payload = serde_json::json!({
        "kind": "hylo_snapshot",
        "ts": ts,
        "hyusd":  { "intrinsic_usd": hyusd_intrinsic_usd, "cr": cr, "supply": hyusd_supply },
        "xsol":   { "intrinsic_usd": xsol_intrinsic_usd, "supply": xsol_supply },
        "shyusd": {
            "intrinsic_usd": shyusd_intrinsic_usd,
            "supply": shyusd_supply,
            "pool_balance": pool_hyusd_balance,
        },
        "reserve_usd": reserve_usd,
        "reserve_sol": reserve_sol,
        "sol_usd": sol_usd,
        "total_sol_update_epoch": update_epoch,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_HYLO,
        &payload,
        "hylo",
    )
    .await?;
    Ok(())
}

/// Decode circulating supply from an SPL mint account (6-decimal mints).
fn decode_mint_supply(acc: &Account, label: &str) -> Result<Decimal> {
    if acc.data.len() < 82 {
        anyhow::bail!("{label} mint data too short ({} bytes)", acc.data.len());
    }
    // SPL Mint layout: supply at bytes 36..44 (u64 LE).
    let supply_raw = u64::from_le_bytes(acc.data[36..44].try_into().unwrap());
    Ok(Decimal::from(supply_raw) / Decimal::from(TOKEN_DECIMALS_6))
}

/// Decode token balance from an SPL TokenAccount address (6 decimals).
fn decode_token_account_amount(acc: &Account, addr: &Pubkey) -> Result<Decimal> {
    if acc.data.len() < 72 {
        anyhow::bail!(
            "token account {addr} data too short ({} bytes)",
            acc.data.len()
        );
    }
    // SPL TokenAccount layout: mint(32) + owner(32) + amount(u64 LE) = bytes 0..32, 32..64, 64..72.
    let amount_raw = u64::from_le_bytes(acc.data[64..72].try_into().unwrap());
    Ok(Decimal::from(amount_raw) / Decimal::from(TOKEN_DECIMALS_6))
}

struct HyloOnChainState {
    /// `total_sol_cache.total_sol` decoded to a real-valued SOL amount.
    total_sol: Decimal,
    /// `total_sol_cache.current_update_epoch` — Solana epoch at last cache mutation.
    update_epoch: u64,
}

/// Decode `total_sol_cache.total_sol` from the Hylo Exchange root PDA.
///
/// Hylo's account layout (after the 8-byte Anchor discriminator):
///   admin..stability_pool   (6 × pubkey  = 192)
///   *_bump fields           (6 × u8      =   6)
///   oracle_interval_secs    (u64         =   8)
///   stablecoin_fees         (36)
///   levercoin_fees          (54)
///   total_sol_cache         (u64 current_update_epoch + UFixValue64 total_sol)
///
/// → `total_sol_cache` starts at byte 304 of the account data.
/// → `total_sol.bits` (u64 LE) at byte 312.
/// → `total_sol.exp`  (i8)     at byte 320.
///
/// Value reconstruction: `total_sol = bits × 10^exp`.
/// (Hylo's `UFixValue64` is fixed-point: u64 bits × decimal-exponent i8.)
fn decode_hylo_total_sol(acc: &Account) -> Result<HyloOnChainState> {
    if acc.data.len() < HYLO_TOTAL_SOL_EXP_OFFSET + 1 {
        anyhow::bail!(
            "hylo state account too short ({} bytes, need >= {})",
            acc.data.len(),
            HYLO_TOTAL_SOL_EXP_OFFSET + 1
        );
    }
    if acc.data[..8] != HYLO_ACCOUNT_DISCRIMINATOR {
        anyhow::bail!("hylo state account discriminator mismatch — IDL upgrade or wrong PDA");
    }
    let update_epoch = u64::from_le_bytes(
        acc.data[HYLO_TOTAL_SOL_CACHE_OFFSET..HYLO_TOTAL_SOL_BITS_OFFSET]
            .try_into()
            .unwrap(),
    );
    let bits = u64::from_le_bytes(
        acc.data[HYLO_TOTAL_SOL_BITS_OFFSET..HYLO_TOTAL_SOL_EXP_OFFSET]
            .try_into()
            .unwrap(),
    );
    let exp = acc.data[HYLO_TOTAL_SOL_EXP_OFFSET] as i8;
    let total_sol = ufix_to_decimal(bits, exp).with_context(|| {
        format!("hylo total_sol UFixValue64 bits={bits} exp={exp} did not fit in Decimal")
    })?;
    Ok(HyloOnChainState {
        total_sol,
        update_epoch,
    })
}

/// Convert a Hylo `UFixValue64 { bits: u64, exp: i8 }` into a `Decimal`.
///
/// Value = bits × 10^exp. `exp` is signed and typically negative (e.g. -9 for
/// lamports-scaled values). We use `Decimal::new(bits as i64, scale)` for
/// `exp <= 0`, and fall back to multiplication for `exp > 0`.
fn ufix_to_decimal(bits: u64, exp: i8) -> Option<Decimal> {
    if exp <= 0 {
        let scale: u32 = (-(exp as i32)) as u32;
        // Decimal::new takes i64; bits is u64. Guard against overflow.
        let mantissa = i64::try_from(bits).ok()?;
        // try_new (NOT new): Decimal::new PANICS when scale > 28. A malformed or
        // unexpected on-chain `exp` byte (reinterpreted i8 → as low as -128 →
        // scale 128) would otherwise crash the indexer poll task — the same
        // rust_decimal overflow-panic class as engine audit finding F-12. None
        // here flows to the caller's `.with_context()?`, turning it into a
        // gracefully-skipped tick instead of a crash.
        Decimal::try_new(mantissa, scale).ok()
    } else {
        let base = Decimal::from(bits);
        let mul = Decimal::from(10u64.checked_pow(exp as u32)?);
        base.checked_mul(mul)
    }
}

// ---------------------------------------------------------------------------
// Hylo input sanity check (R1 of risk register, adapted for current arch).
//
// The original R1 risk was "Hylo IDL decode breaks on V2 upgrade." Surface
// areas where we depend on on-chain or oracle data:
//   - Hylo Exchange account layout (account discriminator gates this; if it
//     ever changes, `decode_hylo_total_sol` errors loudly before we get here)
//   - Hylo upgrades the Stability Pool program with a new PDA seed
//   - One of the watched mints is migrated
//
// Per-check Prometheus counter so an alertmanager rule can fire on any one
// independently. Pure function (no IO) so the unit tests below cover it.
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct HyloSnapshotInputs {
    reserve_usd: Decimal,
    cr: Decimal,
    hyusd_supply: Decimal,
    xsol_supply: Decimal,
    shyusd_supply: Decimal,
    pool_hyusd_balance: Decimal,
    sol_usd: Decimal,
}

#[derive(Debug, PartialEq, Eq)]
struct SanityFailure {
    check: &'static str,
    message: String,
}

/// Reserve band: $1M lower, $10B upper. Reality is currently the hyUSD+xSOL
/// collateral pool (~$20M). Generous band tolerates SOL volatility; a unit
/// drift (e.g. lamports) or empty oracle lights up immediately.
const HYLO_TVL_MIN_USD: i64 = 1_000_000;
const HYLO_TVL_MAX_USD: i64 = 10_000_000_000;

/// CR band: 50% to 500%. Anything outside means our math broke, not Hylo's.
fn cr_min() -> Decimal {
    "0.5".parse().unwrap()
}
fn cr_max() -> Decimal {
    "5.0".parse().unwrap()
}

fn check_hylo_inputs(i: &HyloSnapshotInputs) -> Vec<SanityFailure> {
    let mut out = Vec::new();

    let min = Decimal::from(HYLO_TVL_MIN_USD);
    let max = Decimal::from(HYLO_TVL_MAX_USD);
    if i.reserve_usd < min || i.reserve_usd > max {
        out.push(SanityFailure {
            check: "tvl_out_of_band",
            message: format!(
                "reserve_usd={} outside [{}, {}] — on-chain total_sol or Pyth SOL/USD unit error",
                i.reserve_usd, min, max
            ),
        });
    }

    if !i.cr.is_zero() && (i.cr < cr_min() || i.cr > cr_max()) {
        out.push(SanityFailure {
            check: "cr_out_of_band",
            message: format!(
                "cr={} outside [{}, {}] — supply/reserve mismatch likely",
                i.cr,
                cr_min(),
                cr_max()
            ),
        });
    }

    if i.pool_hyusd_balance > i.hyusd_supply {
        out.push(SanityFailure {
            check: "pool_exceeds_supply",
            message: format!(
                "pool_hyusd_balance={} > hyusd_supply={} — PDA derivation or mint mismatch",
                i.pool_hyusd_balance, i.hyusd_supply
            ),
        });
    }

    if !i.shyusd_supply.is_zero() && i.pool_hyusd_balance.is_zero() {
        out.push(SanityFailure {
            check: "shyusd_pool_empty",
            message: format!(
                "shyusd_supply={} > 0 but Stability Pool hyUSD balance is zero — POOL_AUTH PDA likely wrong",
                i.shyusd_supply
            ),
        });
    }

    if i.hyusd_supply.is_zero() {
        out.push(SanityFailure {
            check: "hyusd_supply_zero",
            message: "hyusd_supply=0 — mint migrated or RPC returned bad data".into(),
        });
    }

    if i.xsol_supply.is_zero() {
        out.push(SanityFailure {
            check: "xsol_supply_zero",
            message: "xsol_supply=0 — mint migrated or RPC returned bad data".into(),
        });
    }

    if i.sol_usd.is_zero() {
        // Not a hard error — Pyth may not have populated SOL/USD yet on cold
        // boot. We surface it once so Grafana can see how often the engine
        // works without it, but we don't treat it as a Hylo-specific failure.
        out.push(SanityFailure {
            check: "sol_usd_unknown",
            message: "Pyth SOL/USD cache empty — xSOL NAV skipped this tick".into(),
        });
    }

    out
}

/// Side-effect helper: log + increment per-check Prometheus counter.
fn report_sanity_failures(failures: &[SanityFailure]) {
    for f in failures {
        metrics::counter!(
            "pegana_hylo_sanity_failure_total",
            "check" => f.check.to_string(),
        )
        .increment(1);
        warn!(check = f.check, message = %f.message, "hylo sanity check failed");
    }
}

#[cfg(test)]
mod sanity_tests {
    use super::*;

    fn happy() -> HyloSnapshotInputs {
        HyloSnapshotInputs {
            // Real hyUSD+xSOL reserve, ~$20M
            reserve_usd: Decimal::from(20_000_000),
            cr: "1.3".parse().unwrap(),
            hyusd_supply: Decimal::from(15_000_000),
            xsol_supply: Decimal::from(93_000_000),
            shyusd_supply: Decimal::from(800_000),
            pool_hyusd_balance: Decimal::from(800_000),
            sol_usd: Decimal::from(150),
        }
    }

    #[test]
    fn happy_path_has_no_failures() {
        assert!(check_hylo_inputs(&happy()).is_empty());
    }

    #[test]
    fn tvl_too_low_fires() {
        let mut i = happy();
        i.reserve_usd = Decimal::from(500_000); // below 1M floor
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "tvl_out_of_band"));
    }

    #[test]
    fn tvl_too_high_fires() {
        let mut i = happy();
        i.reserve_usd = Decimal::from(20_000_000_000i64); // above 10B ceiling
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "tvl_out_of_band"));
    }

    #[test]
    fn cr_below_band_fires() {
        let mut i = happy();
        i.cr = "0.3".parse().unwrap();
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "cr_out_of_band"));
    }

    #[test]
    fn cr_above_band_fires() {
        let mut i = happy();
        i.cr = "10".parse().unwrap();
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "cr_out_of_band"));
    }

    #[test]
    fn zero_cr_skipped() {
        // CR=0 happens on boot before supply is read — don't false-alarm.
        let mut i = happy();
        i.cr = Decimal::ZERO;
        let f = check_hylo_inputs(&i);
        assert!(!f.iter().any(|x| x.check == "cr_out_of_band"));
    }

    #[test]
    fn pool_exceeds_supply_fires() {
        let mut i = happy();
        i.pool_hyusd_balance = i.hyusd_supply + Decimal::ONE;
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "pool_exceeds_supply"));
    }

    #[test]
    fn shyusd_with_empty_pool_fires() {
        let mut i = happy();
        i.pool_hyusd_balance = Decimal::ZERO;
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "shyusd_pool_empty"));
    }

    #[test]
    fn zero_supply_each_fires() {
        let mut i = happy();
        i.hyusd_supply = Decimal::ZERO;
        i.pool_hyusd_balance = Decimal::ZERO; // keep pool_exceeds_supply quiet
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "hyusd_supply_zero"));

        let mut i = happy();
        i.xsol_supply = Decimal::ZERO;
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "xsol_supply_zero"));
    }

    #[test]
    fn sol_usd_zero_surfaces_softly() {
        let mut i = happy();
        i.sol_usd = Decimal::ZERO;
        let f = check_hylo_inputs(&i);
        assert!(f.iter().any(|x| x.check == "sol_usd_unknown"));
    }

    #[test]
    fn ufix_decode_negative_exp() {
        // total_sol = 246894137837437 × 10^-9 = 246894.137837437 SOL (live mainnet sample)
        let d = ufix_to_decimal(246_894_137_837_437, -9).expect("decode");
        assert_eq!(d.to_string(), "246894.137837437");
    }

    #[test]
    fn ufix_decode_zero_exp() {
        let d = ufix_to_decimal(42, 0).expect("decode");
        assert_eq!(d, Decimal::from(42));
    }

    #[test]
    fn ufix_decode_scale_over_28_returns_none_not_panic() {
        // exp < -28 → scale > 28, which `Decimal::new` would PANIC on (F-12 class).
        // After the try_new fix this must return None so the caller skips the tick.
        assert_eq!(ufix_to_decimal(1, -29), None);
        assert_eq!(ufix_to_decimal(1, i8::MIN), None); // exp = -128 → scale 128
    }

    // ── resolve_hylo_cadence ────────────────────────────────────────────────

    #[test]
    fn cadence_env_wins_over_toml_and_default() {
        // Env value (5 000 ms) takes precedence even when toml is also set.
        assert_eq!(resolve_hylo_cadence(Some(5_000), Some(10_000)), 5_000);
    }

    #[test]
    fn cadence_toml_fallback_when_env_absent() {
        // No env var → toml value is used.
        assert_eq!(resolve_hylo_cadence(None, Some(10_000)), 10_000);
    }

    #[test]
    fn cadence_default_when_both_absent() {
        // Neither env nor toml set → hard-coded 30 000 ms default.
        assert_eq!(resolve_hylo_cadence(None, None), 30_000);
    }

    #[test]
    fn cadence_env_zero_is_respected() {
        // An explicit 0 from env is a valid (if unusual) override — must not fall
        // through to the toml or default.
        assert_eq!(resolve_hylo_cadence(Some(0), Some(10_000)), 0);
    }
}
