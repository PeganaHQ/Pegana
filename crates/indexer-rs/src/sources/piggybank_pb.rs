//! Piggybank pbUSDC intrinsic NAV reader.
//!
//! Piggybank Finance runs a delta-neutral funding-rate arbitrage strategy
//! across ~10 perp DEXs. Depositors receive `pbUSDC` (a standard SPL Token
//! mint, NOT Token-2022 / NOT InterestBearing) and the redemption value
//! grows every 48-hour epoch as performance is reported.
//!
//! On-chain layout (reverse-engineered from mainnet against the
//! `piggybank.gitbook.io/docs` formula). The official docs state:
//!
//!   exchange_rate = (managed + epoch_deposits − epoch_redemptions
//!                    − prev_epoch_redemptions − pending_redemptions)
//!                   / pbUSDC_supply
//!
//! Pegana reads the precomputed net `total_assets` and `total_shares` from
//! the Piggybank vault state account (mint authority of pbUSDC, owned by
//! the Piggybank program `Pig1CsXnfDwN1NuoeNRBojohbjc14dogmJCXeb2vL3Y`).
//!
//! Account layout (210 bytes, ASCII discriminator, all fields little-endian
//! u64s with 8-byte reserved slots between most actives — likely the on-chain
//! struct uses `u128` for numeric fields with the high half always zero, so
//! reading the low u64 directly is safe and avoids rust_decimal range issues).
//!
//!   off   0 [ 8] discriminator = b"PBKTOKEN"
//!   off   8 [32] share mint pubkey (= pbUSDC = F35yYmTR…2dMZR)
//!   off  40 [32] asset mint pubkey (= USDC   = EPjFWdd5…wyTDt1v)
//!   off  72 [ 8] total_shares (u64, matches SPL Mint.supply for pbUSDC)
//!   off  80 [ 8] reserved_0
//!   off  88 [ 8] epoch_id (u64, 48-hour epoch counter — was 105 on 2026-05-22)
//!   off  96 [ 8] component_a (u64)  ≈ managed     (forensics in meta)
//!   off 104 [ 8] reserved_1
//!   off 112 [ 8] component_b (u64)  ≈ epoch_deposits
//!   off 120 [ 8] reserved_2
//!   off 128 [ 8] component_c (u64)  ≈ epoch_redemptions
//!   off 136 [ 8] reserved_3
//!   off 144 [ 8] component_d (u64)  ≈ prev_epoch_redemptions (was 0)
//!   off 152 [ 8] reserved_4              (also zero on 2026-05-22)
//!   off 160 [ 8] component_e (u64)  ≈ pending_redemptions
//!   off 168 [ 8] reserved_5
//!   off 176 [ 8] TOTAL_ASSETS (u64, net redeemable USDC — NAV numerator)
//!   off 184 [ 8] reserved_6
//!   off 192 [ 8] CAP (u64, USDC deposit cap, 6dp — currently 3,750,000.000000)
//!   off 200 [ 8] reserved_7
//!   off 208 [ 2] flags (currently 0x01 0xff)
//!
//! NAV (1 pbUSDC → USDC) = total_assets / total_shares. Both quantities are
//! 6-decimal USDC base units, so the ratio is dimensionless ≈ USD-per-share.
//! Piggybank caps `total_assets ≤ cap`, and since USDC pegs $1, NAV doubles
//! as the USD redemption value (modulo any USDC depeg, which the engine
//! tracks separately on the USDC asset).
//!
//! Cadence: 60s. Share rate only changes at epoch boundaries (~48h), so we
//! poll a bit slower than sUSD/USDY (which rebase ~continuously).

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// pbUSDC SPL mint (verified on mainnet, 6 decimals, mint authority owned
/// by the Piggybank program). Cross-checked against the Piggybank docs.
pub const PBUSDC_MINT: &str = "F35yYmTR6PqkbTx449P1eGhB57mRhWAdYs93eCo2dMZR";

/// pbUSDC vault state account — IS the pbUSDC mint authority. Owned by the
/// Piggybank program. Holds `total_shares` + `total_assets` + per-epoch
/// flow components used to derive the per-share USDC NAV.
pub const PBUSDC_VAULT: &str = "91LYov1N1j62Q3ipuBi8w2e5GVqjVxWTdJ757roiWXdy";

/// Piggybank vault program (verified — `Pig1…` is the upgrade-loader stub
/// pointing at the actual on-chain BPF bytecode).
pub const PIGGYBANK_PROGRAM: &str = "Pig1CsXnfDwN1NuoeNRBojohbjc14dogmJCXeb2vL3Y";

/// Ascii discriminator at byte 0 of every Piggybank vault state account.
/// Unique enough to lock-in account-shape sanity at decode time (faster
/// than a full Anchor SHA discriminator and equally collision-resistant
/// for our single-account use case).
const VAULT_DISCRIMINATOR: &[u8; 8] = b"PBKTOKEN";

/// Mint that backs the pbUSDC vault — USDC on Solana mainnet.
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/// USDC has 6 decimals; pbUSDC also has 6. NAV cancels out the scale. SAFE only
/// while the Piggybank vault token stays 6-decimal — re-verify against the mint
/// if that ever changes (H11b: decimals are mint-coupled, not a free constant).
const SHARE_DECIMALS_SCALE: u64 = 1_000_000;

/// Minimum bytes the vault account must contain for our reads to be safe.
/// Account is exactly 210 bytes today; we only need through offset 199
/// (cap u64 occupies bytes 192..200).
const MIN_VAULT_LEN: usize = 200;

/// Decoded view of a Piggybank pb-token vault state account.
#[derive(Debug, Clone)]
pub struct VaultState {
    pub share_mint: Pubkey,
    pub asset_mint: Pubkey,
    pub total_shares: u64,
    pub total_assets: u64,
    pub epoch_id: u64,
    pub cap: u64,
    /// Five raw component fields, surfaced in meta for forensics. Loose
    /// ordering against the docs formula — the precise field semantics are
    /// not load-bearing because `total_assets` is the precomputed net we
    /// actually use for NAV.
    pub components: [u64; 5],
}

/// Decode the Piggybank vault state and return the NAV (USD per share).
pub fn decode_nav(vault_data: &[u8]) -> Result<(Decimal, VaultState)> {
    anyhow::ensure!(
        vault_data.len() >= MIN_VAULT_LEN,
        "vault account too short: {} bytes (need ≥ {})",
        vault_data.len(),
        MIN_VAULT_LEN
    );
    anyhow::ensure!(
        &vault_data[0..8] == VAULT_DISCRIMINATOR,
        "vault discriminator mismatch: expected {:?}, got {:?}",
        VAULT_DISCRIMINATOR,
        &vault_data[0..8]
    );

    let share_mint = Pubkey::try_from(&vault_data[8..40])
        .map_err(|_| anyhow::anyhow!("invalid share-mint pubkey at offset 8"))?;
    let asset_mint = Pubkey::try_from(&vault_data[40..72])
        .map_err(|_| anyhow::anyhow!("invalid asset-mint pubkey at offset 40"))?;

    // Sanity-check: this adapter is wired specifically for pbUSDC backed by
    // USDC. If the on-chain vault ever points elsewhere, fail loudly rather
    // than silently misreport NAV.
    let expected_share = Pubkey::from_str(PBUSDC_MINT)?;
    let expected_asset = Pubkey::from_str(USDC_MINT)?;
    anyhow::ensure!(
        share_mint == expected_share,
        "share mint mismatch: vault says {share_mint}, expected {expected_share}"
    );
    anyhow::ensure!(
        asset_mint == expected_asset,
        "asset mint mismatch: vault says {asset_mint}, expected {expected_asset}"
    );

    let total_shares = read_u64_le(vault_data, 72)?;
    let epoch_id = read_u64_le(vault_data, 88)?;
    let component_a = read_u64_le(vault_data, 96)?;
    let component_b = read_u64_le(vault_data, 112)?;
    let component_c = read_u64_le(vault_data, 128)?;
    let component_d = read_u64_le(vault_data, 144)?;
    let component_e = read_u64_le(vault_data, 160)?;
    let total_assets = read_u64_le(vault_data, 176)?;
    let cap = read_u64_le(vault_data, 192)?;

    anyhow::ensure!(total_shares > 0, "vault total_shares is zero");
    anyhow::ensure!(total_assets > 0, "vault total_assets is zero");

    let assets_dec = Decimal::from(total_assets);
    let shares_dec = Decimal::from(total_shares);
    // checked_div (not raw `/`) — the F-12 discipline: a raw Decimal division
    // panics on overflow. Both operands are u64-bounded and shares > 0 here, so
    // this can't actually overflow today, but keeping it checked (matching
    // perena/spl) means a future input-range change degrades to Err, not panic.
    let nav = assets_dec
        .checked_div(shares_dec)
        .context("vault NAV division overflow")?;

    // Hard guard rails — a yield-bearing vault that started 1:1 should
    // never trade < 1.0, and 2.0 would imply a doubling which is far
    // outside Piggybank's published 5–25% APY band even over multiple
    // years. Anything outside these bounds is a layout-drift signal.
    anyhow::ensure!(
        nav >= Decimal::from_str("0.99").unwrap(),
        "NAV {nav} < 0.99 — implausible for delta-neutral funding arb"
    );
    anyhow::ensure!(
        nav < Decimal::from(2u32),
        "NAV {nav} ≥ 2.0 — implausible (would mean >100% accumulated yield)"
    );

    Ok((
        nav,
        VaultState {
            share_mint,
            asset_mint,
            total_shares,
            total_assets,
            epoch_id,
            cap,
            components: [
                component_a,
                component_b,
                component_c,
                component_d,
                component_e,
            ],
        },
    ))
}

/// Read a little-endian u64 from `data[offset..offset+8]`.
///
/// Bounds-checked. The caller `decode_nav` already validates
/// `vault_data.len() >= MIN_VAULT_LEN` (200 bytes) which covers every
/// offset used today. Returning `Result` instead of panicking lets a
/// future second caller fail cleanly if it forgets that invariant.
fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| anyhow::anyhow!("read_u64_le offset overflow: {offset}"))?;
    let bytes = data.get(offset..end).ok_or_else(|| {
        anyhow::anyhow!(
            "read_u64_le out of bounds: offset={offset} need_end={end} len={}",
            data.len()
        )
    })?;
    // Slice is exactly 8 bytes by construction of get(offset..end); unwrap is
    // mathematically safe.
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_piggybank {
        info!("FEATURE_PIGGYBANK=false — piggybank_pb source disabled");
        return Ok(());
    }

    // Active-gate: respect the `active` flag in assets.toml. pbUSDC was
    // deactivated (migration 0040) to stop bad-data polls from a thin DEX
    // pair — but this source was unconditionally polling the vault on-chain
    // every 60s and logging a WARN for NAV < 0.99, which was the correct
    // guard-rail catching the wrong data. Mirror the dexscreener.rs idiom.
    let pbusdc_active = state
        .assets
        .assets
        .iter()
        .any(|a| a.active && a.mint == PBUSDC_MINT);
    if !pbusdc_active {
        info!("pbUSDC inactive (active=false) — piggybank_pb source idle");
        return Ok(());
    }

    let vault_pk = Pubkey::from_str(PBUSDC_VAULT).context("parse pbUSDC vault")?;

    let cadence_ms = state
        .config
        .piggybank_poll_ms
        .or(state.assets.polling.piggybank_poll_ms)
        .unwrap_or(60_000);

    let mut tick = interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let rpc = RpcClient::new_with_commitment(
        state.config.solana_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let rpc_fallback = RpcClient::new_with_commitment(
        state.config.solana_rpc_url_fallback.clone(),
        CommitmentConfig::confirmed(),
    );

    info!(cadence_ms, vault = %vault_pk, "piggybank_pb source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("piggybank_pb source shutdown");
                return Ok(());
            }
        }

        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &vault_pk).await {
            warn!(error = %e, "piggybank_pb poll failed");
            metrics::counter!("pegana_piggybank_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_piggybank_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    vault_pk: &Pubkey,
) -> Result<()> {
    let started = std::time::Instant::now();

    let account =
        crate::rpc::get_account_with_fallback(rpc, rpc_fallback, vault_pk, "piggybank_pb").await?;

    anyhow::ensure!(
        account.owner == Pubkey::from_str(PIGGYBANK_PROGRAM)?,
        "pbUSDC vault owner mismatch: got {} expected {PIGGYBANK_PROGRAM}",
        account.owner
    );

    let now = chrono::Utc::now();
    let (nav, vault) = decode_nav(&account.data)?;
    metrics::histogram!("pegana_piggybank_latency_seconds").record(started.elapsed().as_secs_f64());
    metrics::gauge!("pegana_piggybank_pbusdc_nav_usd").set(pegana_common::decimal_to_f64(nav));

    let total_assets_usdc = Decimal::from(vault.total_assets) / Decimal::from(SHARE_DECIMALS_SCALE);
    let total_shares_pbusdc =
        Decimal::from(vault.total_shares) / Decimal::from(SHARE_DECIMALS_SCALE);

    let meta = serde_json::json!({
        "vault": vault_pk.to_string(),
        "program": PIGGYBANK_PROGRAM,
        "share_mint": vault.share_mint.to_string(),
        "asset_mint": vault.asset_mint.to_string(),
        "epoch_id": vault.epoch_id.to_string(),
        "total_assets_usdc": total_assets_usdc,
        "total_shares_pbusdc": total_shares_pbusdc,
        "cap_usdc": Decimal::from(vault.cap) / Decimal::from(SHARE_DECIMALS_SCALE),
        "components_raw": vault.components.iter().map(|c| c.to_string()).collect::<Vec<_>>(),
        "formula": "total_assets / total_shares (Piggybank vault state)",
    });

    sinks::postgres::insert_intrinsic(
        &state.pg,
        "pbUSDC",
        nav,
        "piggybank",
        meta.clone(),
        None,
        now,
    )
    .await
    .context("insert intrinsic snapshot")?;

    let payload = serde_json::json!({
        "asset": "pbUSDC",
        "value_usd": nav,
        "source": "piggybank",
        "meta": meta,
        "ts": now,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_PIGGYBANK,
        &payload,
        "piggybank",
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
        fn decode_nav_no_panic_on_arbitrary_bytes(
            data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..400),
        ) {
            let _ = decode_nav(&data);
        }

        // Fuzz: valid discriminator + both mints, fuzzed total_shares /
        // total_assets — reaches the checked_div NAV + sanity-band arithmetic.
        // total_shares == 0 hits the zero-guard (Err).
        #[test]
        fn decode_nav_no_panic_on_valid_prefix(
            total_shares in proptest::num::u64::ANY,
            total_assets in proptest::num::u64::ANY,
        ) {
            let share = Pubkey::from_str(PBUSDC_MINT).unwrap();
            let asset = Pubkey::from_str(USDC_MINT).unwrap();
            let mut data = vec![0u8; MIN_VAULT_LEN + 8];
            data[0..8].copy_from_slice(VAULT_DISCRIMINATOR);
            data[8..40].copy_from_slice(share.as_ref());
            data[40..72].copy_from_slice(asset.as_ref());
            data[72..80].copy_from_slice(&total_shares.to_le_bytes());
            data[176..184].copy_from_slice(&total_assets.to_le_bytes());
            let _ = decode_nav(&data);
        }
    }

    /// Decodes the captured mainnet fixture (slot 421435319, 2026-05-22).
    /// Since Piggybank advertises ~21% APY and the vault is multi-month old,
    /// NAV must be > 1.0 and well below 1.5 (which would imply >50%
    /// accumulated yield — implausible).
    #[test]
    fn decodes_fixture() {
        let raw = std::fs::read_to_string("fixtures/piggybank/pbusdc-vault.json")
            .expect("fixture present");
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let b64 = json["result"]["value"]["data"][0]
            .as_str()
            .expect("base64 data");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();

        let owner = json["result"]["value"]["owner"].as_str().unwrap();
        assert_eq!(
            owner, PIGGYBANK_PROGRAM,
            "fixture must be owned by the Piggybank program"
        );

        let (nav, vault) = decode_nav(&bytes).expect("decode succeeds");

        assert!(
            nav > Decimal::ONE,
            "NAV must be > 1.0 for an accruing yield-bearing vault, got {nav}"
        );
        assert!(
            nav < Decimal::from_str("1.5").unwrap(),
            "NAV {nav} ≥ 1.5 — implausible (would imply >50% accumulated yield)"
        );

        // Hard-coded snapshot assertions for layout integrity. These will
        // drift slowly as the vault accrues (NAV creeps up over time).
        // Pin to a wide band — tight enough to catch a bytewise layout
        // bug, loose enough not to flake every epoch.
        assert_eq!(vault.share_mint.to_string(), PBUSDC_MINT);
        assert_eq!(vault.asset_mint.to_string(), USDC_MINT);
        assert_eq!(
            vault.total_shares, 3_194_975_199_906,
            "fixture-pinned total_shares — change if fixture is refreshed"
        );
        assert_eq!(
            vault.total_assets, 3_555_662_488_056,
            "fixture-pinned total_assets — change if fixture is refreshed"
        );
        assert_eq!(vault.epoch_id, 105, "fixture-pinned epoch_id");
        assert_eq!(vault.cap, 3_750_000_000_000, "fixture-pinned cap");

        // NAV at fixture snapshot ≈ 1.1129 (3.5556M USDC / 3.1950M pbUSDC).
        // Lock to four decimals — anything tighter risks flaking on rounding.
        let nav_str = nav.round_dp(4).to_string();
        assert_eq!(
            nav_str, "1.1129",
            "expected NAV ≈ 1.1129 for the fixture, got {nav}"
        );
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let mut bytes = vec![0u8; 210];
        bytes[0..8].copy_from_slice(b"GARBAGE!");
        let err = decode_nav(&bytes).unwrap_err().to_string();
        assert!(err.contains("discriminator mismatch"), "{err}");
    }

    #[test]
    fn rejects_short_account() {
        let bytes = vec![0u8; 50];
        let err = decode_nav(&bytes).unwrap_err().to_string();
        assert!(err.contains("too short"), "{err}");
    }
}
