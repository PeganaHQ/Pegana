//! Perena USD* intrinsic NAV reader (post-migration `bankineco` Vault).
//!
//! Perena migrated USD* in 2026-10: the old savings reserve
//! `sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A` is drained and the USD* mint
//! authority is now the Vault `ECJGrTZ6QYMEwiEAnL4oReWF126uc22e9Lojy9qyCjHT`,
//! owned by program `save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H` (on-chain
//! Anchor IDL name `bankineco`).
//!
//! `Vault` is a bytemuck (`repr(C)`, zero-copy) account, 10016 bytes. Offsets
//! from the IDL (including the 8-byte discriminator):
//!
//!   [0..8]       discriminator d308e82b02987577 (sha256("account:Vault")[..8])
//!   [8]          bump u8
//!   [9]          mint_decimals u8
//!   [10..12]     vault_id u16
//!   [12]         circuit_breaker_active PodBool
//!   [13]         tranching_enabled PodBool    (1 on mainnet since the migration)
//!   [14]         losses_enabled PodBool       (0 on mainnet, recorded in meta)
//!   [16..48]     mint Pubkey (= USD* mint)
//!   [1568..2256] accounting: VaultAccounting
//!       1568 tvl u64              (NOT used: tvl / total_mint_supply = 1.284
//!       1576 total_mint_supply u64  on 2026-10-21, which is not the share price)
//!       1584 mint_share_price u64 (6dp)   <- NAV
//!       1592 last_update_ts i64           <- liveness (crank_nav, ~every 14 min)
//!       1600 hwm_share_price u64 (6dp)    (forensics only)
//!
//! NAV keys off `mint_share_price` ONLY (live 2026-10-21: 1.104744).
//!
//! Tranching: the vault runs with `tranching_enabled = 1` (observed in the
//! 2026-10-21 fixture and live 2026-10-22; the program also has senior/junior
//! tranche share mints with their own `get_tranche_nav`). `mint_share_price`
//! was validated as the USD* NAV under exactly that configuration. If Perena
//! toggles tranching, what `mint_share_price` means for USD* holders may
//! change, so a reading whose flag differs from [`EXPECTED_TRANCHING_ENABLED`]
//! is refused (the poll logs a warning and publishes nothing) until the decode
//! is re-validated. Both flags are recorded in the snapshot meta.
//!
//! The vault and the USD* mint are read in one `getMultipleAccounts`; the mint's
//! authority must be the vault, which proves this is the account that actually
//! issues USD* (a future re-migration fails loudly instead of reading a dead
//! vault).
//!
//! Liveness (ADR-0038): `last_update_ts` is written by `crank_nav`. Older than
//! [`NAV_UPDATE_STALE_SECS`] (about 2x the ~14 min crank) flags `intrinsic_liveness`
//! stale (observe-only until the gate is enabled). Older than
//! [`NAV_UPDATE_MAX_AGE_SECS`], or with the vault circuit breaker active, the
//! reading is refused (not published) so a frozen NAV is never re-served as
//! fresh.
//!
//! Market leg: the only deep USD* route on Jupiter is "Perena Star V2", the
//! issuer's own share swap, which prices USD* at this same NAV by
//! construction. assets.toml excludes it (`jupiter_exclude_dexes`) and USD*
//! stays monitoring-only, so it reads UNKNOWN until an independent market
//! exists.

use crate::sinks;
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

pub const USDSTAR_MINT: &str = "star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM";
pub const PERENA_PROGRAM: &str = "save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H";
const SPL_TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const VAULT_DISCRIMINATOR: [u8; 8] = [0xd3, 0x08, 0xe8, 0x2b, 0x02, 0x98, 0x75, 0x77];
const VAULT_LEN: usize = 10_016;
const MINT_DECIMALS_OFFSET: usize = 9;
const CIRCUIT_BREAKER_OFFSET: usize = 12;
const TRANCHING_ENABLED_OFFSET: usize = 13;
const LOSSES_ENABLED_OFFSET: usize = 14;
/// `tranching_enabled` as observed when `mint_share_price` was validated as the
/// USD* NAV. Any other value refuses the reading (see the module docs).
pub const EXPECTED_TRANCHING_ENABLED: bool = true;
const MINT_OFFSET: usize = 16;
const TVL_OFFSET: usize = 1568;
const TOTAL_MINT_SUPPLY_OFFSET: usize = 1576;
const MINT_SHARE_PRICE_OFFSET: usize = 1584;
const LAST_UPDATE_TS_OFFSET: usize = 1592;
const HWM_SHARE_PRICE_OFFSET: usize = 1600;
const VALUE_SCALE: u64 = 1_000_000;
const USDSTAR_DECIMALS: u8 = 6;

/// `crank_nav` runs ~every 14 min (measured 2026-10-22: median gap ~825s, max
/// 857s over 21 cranks); 30 min without an update is a stalled crank.
pub const NAV_UPDATE_STALE_SECS: i64 = 30 * 60;
/// Past 6h the share price is not a current NAV: refuse to publish it.
pub const NAV_UPDATE_MAX_AGE_SECS: i64 = 6 * 60 * 60;

/// Timestamp stamped on the Redis envelope: the vault's own `last_update_ts`
/// (when `crank_nav` last wrote the NAV), not the poll time. The engine gates
/// each intrinsic side on this timestamp (`SOURCE_STALENESS_SECS`, 600s), so a
/// stalled crank reads stale in the engine instead of a NAV up to 6h old being
/// re-stamped fresh every poll. Clamped to `now` against clock skew; an
/// unrepresentable value is an error (never silently "now").
pub fn envelope_ts(
    v: &VaultState,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<chrono::DateTime<chrono::Utc>> {
    use chrono::TimeZone;
    let updated = chrono::Utc
        .timestamp_opt(v.last_update_ts, 0)
        .single()
        .with_context(|| format!("invalid last_update_ts {}", v.last_update_ts))?;
    Ok(updated.min(now))
}

/// Decoded fields of the Perena `Vault` account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultState {
    pub mint: Pubkey,
    pub mint_decimals: u8,
    pub circuit_breaker_active: bool,
    pub tranching_enabled: bool,
    pub losses_enabled: bool,
    pub tvl: u64,
    pub total_mint_supply: u64,
    pub mint_share_price: u64,
    pub last_update_ts: i64,
    pub hwm_share_price: u64,
}

/// Decode the vault with bounds checks; does not judge liveness.
pub fn decode_vault(data: &[u8]) -> Result<VaultState> {
    anyhow::ensure!(
        data.len() == VAULT_LEN,
        "vault account is {} bytes, expected {VAULT_LEN}",
        data.len()
    );
    anyhow::ensure!(
        data.get(0..8) == Some(VAULT_DISCRIMINATOR.as_slice()),
        "vault discriminator mismatch"
    );
    let mint = Pubkey::try_from(
        data.get(MINT_OFFSET..MINT_OFFSET + 32)
            .context("vault mint bounds")?,
    )
    .map_err(|_| anyhow::anyhow!("invalid vault mint pubkey"))?;
    let mint_decimals = *data.get(MINT_DECIMALS_OFFSET).context("decimals bounds")?;
    let pod_bool = |offset: usize, name: &str| -> Result<bool> {
        let b = *data.get(offset).with_context(|| format!("{name} bounds"))?;
        anyhow::ensure!(b <= 1, "{name} PodBool is {b}, expected 0/1");
        Ok(b == 1)
    };
    Ok(VaultState {
        mint,
        mint_decimals,
        circuit_breaker_active: pod_bool(CIRCUIT_BREAKER_OFFSET, "circuit_breaker_active")?,
        tranching_enabled: pod_bool(TRANCHING_ENABLED_OFFSET, "tranching_enabled")?,
        losses_enabled: pod_bool(LOSSES_ENABLED_OFFSET, "losses_enabled")?,
        tvl: read_u64_le(data, TVL_OFFSET)?,
        total_mint_supply: read_u64_le(data, TOTAL_MINT_SUPPLY_OFFSET)?,
        mint_share_price: read_u64_le(data, MINT_SHARE_PRICE_OFFSET)?,
        last_update_ts: read_i64_le(data, LAST_UPDATE_TS_OFFSET)?,
        hwm_share_price: read_u64_le(data, HWM_SHARE_PRICE_OFFSET)?,
    })
}

/// NAV from a decoded vault, checked against the expected mint and a sanity
/// band. Losses are possible (`losses_enabled`), so the band admits a NAV
/// below its high-water mark; outside [0.5, 2.0) is a layout bug.
pub fn nav_from_vault(v: &VaultState, expected_mint: &Pubkey) -> Result<Decimal> {
    anyhow::ensure!(
        v.mint == *expected_mint,
        "vault mint mismatch: vault says {}, expected {expected_mint}",
        v.mint
    );
    anyhow::ensure!(
        v.mint_decimals == USDSTAR_DECIMALS,
        "vault mint_decimals {} != {USDSTAR_DECIMALS}",
        v.mint_decimals
    );
    anyhow::ensure!(
        v.tranching_enabled == EXPECTED_TRANCHING_ENABLED,
        "vault tranching_enabled is {}, expected {EXPECTED_TRANCHING_ENABLED}: the USD* NAV decode was validated only for that configuration, refusing",
        v.tranching_enabled
    );
    anyhow::ensure!(v.mint_share_price != 0, "vault mint_share_price is zero");
    let nav = Decimal::from(v.mint_share_price)
        .checked_div(Decimal::from(VALUE_SCALE))
        .context("divide share price by scale")?;
    anyhow::ensure!(
        nav >= Decimal::new(5, 1) && nav < Decimal::TWO,
        "NAV {nav} outside sanity band [0.5, 2.0)"
    );
    Ok(nav)
}

/// Liveness decision for one reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Liveness {
    pub age_secs: i64,
    /// Observe-only ADR-0038 flag.
    pub stale: bool,
    /// Refuse to publish.
    pub refuse: bool,
}

pub fn liveness(v: &VaultState, now_unix: i64) -> Liveness {
    let age_secs = now_unix.saturating_sub(v.last_update_ts);
    Liveness {
        age_secs,
        stale: age_secs > NAV_UPDATE_STALE_SECS || v.circuit_breaker_active,
        refuse: age_secs > NAV_UPDATE_MAX_AGE_SECS || v.circuit_breaker_active,
    }
}

/// SPL mint authority (COption<Pubkey> at offset 0) and decimals.
fn mint_authority_and_decimals(data: &[u8]) -> Result<(Option<Pubkey>, u8)> {
    anyhow::ensure!(data.len() >= 82, "mint account too short");
    let tag = u32::from_le_bytes(data[0..4].try_into()?);
    let auth = match tag {
        0 => None,
        1 => Some(
            Pubkey::try_from(&data[4..36]).map_err(|_| anyhow::anyhow!("bad mint authority"))?,
        ),
        t => anyhow::bail!("invalid mint authority tag {t}"),
    };
    Ok((auth, data[44]))
}

fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data
        .get(offset..offset.checked_add(8).context("offset overflow")?)
        .with_context(|| format!("u64 out of bounds at {offset} (len {})", data.len()))?;
    Ok(u64::from_le_bytes(bytes.try_into()?))
}

fn read_i64_le(data: &[u8], offset: usize) -> Result<i64> {
    let bytes = data
        .get(offset..offset.checked_add(8).context("offset overflow")?)
        .with_context(|| format!("i64 out of bounds at {offset} (len {})", data.len()))?;
    Ok(i64::from_le_bytes(bytes.try_into()?))
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_perena {
        info!("FEATURE_PERENA=false — perena source disabled");
        return Ok(());
    }

    let Some((vault, program)) = state
        .assets
        .assets
        .iter()
        .filter(|a| a.active && a.mint == USDSTAR_MINT)
        .find_map(|a| match &a.intrinsic {
            IntrinsicStrategy::PerenaVaultNav { vault, program } => {
                Some((vault.clone(), program.clone()))
            }
            _ => None,
        })
    else {
        info!("USD* inactive or not perena_vault_nav: perena source idle");
        return Ok(());
    };

    let vault_pk = Pubkey::from_str(&vault).context("parse USD* vault")?;
    let program_pk = Pubkey::from_str(&program).context("parse Perena program")?;
    anyhow::ensure!(
        program == PERENA_PROGRAM,
        "assets.toml USD* program {program} is not the Perena program {PERENA_PROGRAM}"
    );
    let mint_pk = Pubkey::from_str(USDSTAR_MINT).context("parse USD* mint")?;
    let cadence_ms = state.config.perena_poll_ms.unwrap_or(30_000);

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

    info!(cadence_ms, vault = %vault_pk, "perena source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("perena source shutdown");
                return Ok(());
            }
        }

        if let Err(error) = poll_once(
            &state,
            &rpc,
            &rpc_fallback,
            &vault_pk,
            &program_pk,
            &mint_pk,
        )
        .await
        {
            warn!(error = %error, "perena poll failed");
            metrics::counter!("pegana_perena_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_perena_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    vault_pk: &Pubkey,
    program_pk: &Pubkey,
    mint_pk: &Pubkey,
) -> Result<()> {
    let started = std::time::Instant::now();
    let (accounts, slot) = crate::rpc::get_multiple_accounts_with_fallback(
        rpc,
        rpc_fallback,
        &[*vault_pk, *mint_pk],
        "perena",
    )
    .await?;
    let vault_acc = crate::rpc::required_account(&accounts, 0, "USD* vault")?;
    let mint_acc = crate::rpc::required_account(&accounts, 1, "USD* mint")?;

    anyhow::ensure!(
        vault_acc.owner == *program_pk,
        "USD* vault owner mismatch: got {} expected {program_pk}",
        vault_acc.owner
    );
    anyhow::ensure!(
        mint_acc.owner == Pubkey::from_str(SPL_TOKEN_PROGRAM)?,
        "USD* mint owner mismatch: got {}",
        mint_acc.owner
    );
    let (authority, decimals) = mint_authority_and_decimals(&mint_acc.data)?;
    anyhow::ensure!(
        authority == Some(*vault_pk),
        "USD* mint authority is {authority:?}, not the configured vault {vault_pk}; Perena may have migrated again"
    );
    anyhow::ensure!(decimals == USDSTAR_DECIMALS, "USD* decimals {decimals}");

    let v = decode_vault(&vault_acc.data)?;
    let nav = nav_from_vault(&v, mint_pk)?;
    let now = chrono::Utc::now();
    let live = liveness(&v, now.timestamp());

    metrics::histogram!("pegana_perena_latency_seconds").record(started.elapsed().as_secs_f64());
    metrics::gauge!("pegana_perena_nav_update_age_secs").set(live.age_secs as f64);

    if let Err(e) = sinks::postgres::upsert_intrinsic_liveness(
        &state.pg,
        "USD*",
        live.stale,
        "nav_update_stale",
        serde_json::json!({
            "last_update_ts": v.last_update_ts,
            "age_secs": live.age_secs,
            "stale_after_secs": NAV_UPDATE_STALE_SECS,
            "refuse_after_secs": NAV_UPDATE_MAX_AGE_SECS,
            "circuit_breaker_active": v.circuit_breaker_active,
        }),
    )
    .await
    {
        warn!(error = %e, "intrinsic_liveness upsert failed (nav_update_stale)");
    }
    if live.stale {
        warn!(
            age_secs = live.age_secs,
            circuit_breaker = v.circuit_breaker_active,
            "USD* vault NAV not updated recently (crank_nav) or circuit breaker active"
        );
    }
    anyhow::ensure!(
        !live.refuse,
        "USD* NAV refused: last_update_ts age {}s (max {NAV_UPDATE_MAX_AGE_SECS}s), circuit_breaker_active={}",
        live.age_secs,
        v.circuit_breaker_active
    );

    metrics::gauge!("pegana_perena_usdstar_nav_usd").set(pegana_common::decimal_to_f64(nav));
    let scale = Decimal::from(VALUE_SCALE);
    let meta = serde_json::json!({
        "vault": vault_pk.to_string(),
        "program": program_pk.to_string(),
        "share_mint": mint_pk.to_string(),
        "mint_share_price_raw": v.mint_share_price.to_string(),
        "hwm_share_price": Decimal::from(v.hwm_share_price) / scale,
        "last_update_ts": v.last_update_ts,
        "tranching_enabled": v.tranching_enabled,
        "losses_enabled": v.losses_enabled,
        "tvl_raw": v.tvl.to_string(),
        "total_mint_supply_raw": v.total_mint_supply.to_string(),
        "slot": slot,
        "formula": "vault.accounting.mint_share_price / 1_000_000",
    });

    sinks::postgres::insert_intrinsic(
        &state.pg,
        "USD*",
        nav,
        "perena",
        meta.clone(),
        i64::try_from(slot).ok(),
        now,
    )
    .await
    .context("insert intrinsic snapshot")?;

    // The snapshot row above keeps the observation time (`now`); the envelope
    // carries the NAV's own update time so the engine's freshness gate sees a
    // stalled crank (see `envelope_ts`).
    let payload = serde_json::json!({
        "asset": "USD*",
        "value_usd": nav,
        "source": "perena",
        "meta": meta,
        "ts": envelope_ts(&v, now)?,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_PERENA,
        &payload,
        "perena",
    )
    .await
    .context("publish to redis")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Recorded mainnet `getAccountInfo(ECJGrTZ6…)`, slot 459825790 (2026-10-21).
    fn fixture() -> (serde_json::Value, Vec<u8>) {
        let raw =
            std::fs::read_to_string("fixtures/perena/usdstar-vault.json").expect("fixture present");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("valid fixture JSON");
        let b64 = json["result"]["value"]["data"][0]
            .as_str()
            .expect("base64 data");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("valid base64");
        (json, bytes)
    }

    fn mint() -> Pubkey {
        Pubkey::from_str(USDSTAR_MINT).unwrap()
    }

    #[test]
    fn decodes_recorded_vault() {
        let (json, bytes) = fixture();
        assert_eq!(
            json["result"]["value"]["owner"].as_str(),
            Some(PERENA_PROGRAM)
        );
        let v = decode_vault(&bytes).expect("decode succeeds");
        assert_eq!(v.mint, mint());
        assert_eq!(v.mint_decimals, 6);
        assert!(!v.circuit_breaker_active);
        assert_eq!(v.mint_share_price, 1_104_744);
        assert_eq!(v.last_update_ts, 1_792_627_293);
        assert_eq!(v.hwm_share_price, 1_105_682);
        let nav = nav_from_vault(&v, &mint()).unwrap();
        assert_eq!(nav.to_string(), "1.104744");

        // tvl / total_mint_supply is NOT the share price (1.284 vs 1.1047).
        let ratio = Decimal::from(v.tvl) / Decimal::from(v.total_mint_supply);
        assert_eq!(ratio.round_dp(3).to_string(), "1.284");
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let (_, mut bytes) = fixture();
        bytes[0] ^= 0xff;
        let e = decode_vault(&bytes).unwrap_err().to_string();
        assert!(e.contains("discriminator mismatch"), "{e}");
    }

    #[test]
    fn rejects_wrong_length() {
        let (_, bytes) = fixture();
        assert!(decode_vault(&bytes[..VAULT_LEN - 1]).is_err());
        assert!(decode_vault(&[]).is_err());
    }

    #[test]
    fn rejects_mint_mismatch() {
        let (_, mut bytes) = fixture();
        bytes[MINT_OFFSET] ^= 0xff;
        let v = decode_vault(&bytes).unwrap();
        let e = nav_from_vault(&v, &mint()).unwrap_err().to_string();
        assert!(e.contains("mint mismatch"), "{e}");
    }

    #[test]
    fn rejects_zero_or_absurd_share_price() {
        let (_, mut bytes) = fixture();
        bytes[MINT_SHARE_PRICE_OFFSET..MINT_SHARE_PRICE_OFFSET + 8]
            .copy_from_slice(&0u64.to_le_bytes());
        assert!(nav_from_vault(&decode_vault(&bytes).unwrap(), &mint()).is_err());
        bytes[MINT_SHARE_PRICE_OFFSET..MINT_SHARE_PRICE_OFFSET + 8]
            .copy_from_slice(&5_000_000u64.to_le_bytes());
        assert!(nav_from_vault(&decode_vault(&bytes).unwrap(), &mint()).is_err());
    }

    /// The fixture (mainnet 2026-10-21) has tranching on and losses off; a
    /// vault with tranching toggled is refused, not priced.
    #[test]
    fn tranching_flag_is_decoded_and_a_change_is_refused() {
        let (_, mut bytes) = fixture();
        let v = decode_vault(&bytes).unwrap();
        assert!(v.tranching_enabled && !v.losses_enabled);
        assert!(nav_from_vault(&v, &mint()).is_ok());
        bytes[TRANCHING_ENABLED_OFFSET] = 0;
        let off = decode_vault(&bytes).unwrap();
        let err = nav_from_vault(&off, &mint()).unwrap_err().to_string();
        assert!(err.contains("tranching_enabled"), "{err}");
    }

    /// P2-3: the envelope carries `last_update_ts`, not the poll time, so a
    /// NAV 1h old reaches the engine 1h old (past its 600s window) instead of
    /// stamped fresh. A future timestamp (clock skew) is clamped to now.
    #[test]
    fn envelope_ts_is_the_vault_update_time() {
        use chrono::TimeZone;
        let (_, bytes) = fixture();
        let v = decode_vault(&bytes).unwrap();
        let updated = chrono::Utc.timestamp_opt(v.last_update_ts, 0).unwrap();
        let an_hour_later = updated + chrono::Duration::hours(1);
        let ts = envelope_ts(&v, an_hour_later).unwrap();
        assert_eq!(
            ts, updated,
            "stamped with the crank time, not the poll time"
        );
        assert!(
            (an_hour_later - ts).num_seconds() > 600,
            "engine sees it stale"
        );
        let skewed = updated - chrono::Duration::seconds(30);
        assert_eq!(
            envelope_ts(&v, skewed).unwrap(),
            skewed,
            "future ts clamped"
        );
        let mut bad = v.clone();
        bad.last_update_ts = i64::MAX;
        assert!(envelope_ts(&bad, an_hour_later).is_err());
    }

    #[test]
    fn staleness_and_circuit_breaker_rejection() {
        let (_, mut bytes) = fixture();
        let v = decode_vault(&bytes).unwrap();
        let t = v.last_update_ts;
        // Fresh: 5 min crank.
        assert_eq!(
            liveness(&v, t + 300),
            Liveness {
                age_secs: 300,
                stale: false,
                refuse: false
            }
        );
        // Stalled crank: flagged, still published.
        let l = liveness(&v, t + NAV_UPDATE_STALE_SECS + 1);
        assert!(l.stale && !l.refuse);
        // Too old: refused.
        assert!(liveness(&v, t + NAV_UPDATE_MAX_AGE_SECS + 1).refuse);

        bytes[CIRCUIT_BREAKER_OFFSET] = 1;
        let v = decode_vault(&bytes).unwrap();
        let l = liveness(&v, t + 10);
        assert!(l.stale && l.refuse, "circuit breaker must refuse");
        bytes[CIRCUIT_BREAKER_OFFSET] = 7;
        assert!(decode_vault(&bytes).is_err(), "non-0/1 PodBool rejected");
        bytes[CIRCUIT_BREAKER_OFFSET] = 0;
        bytes[TRANCHING_ENABLED_OFFSET] = 2;
        assert!(
            decode_vault(&bytes).is_err(),
            "non-0/1 tranching flag rejected"
        );
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
    async fn live_smoke_usdstar_nav() {
        let rpc = live_rpc();
        let vault = Pubkey::from_str("ECJGrTZ6QYMEwiEAnL4oReWF126uc22e9Lojy9qyCjHT").unwrap();
        let (accs, slot) =
            crate::rpc::get_multiple_accounts_with_fallback(&rpc, &rpc, &[vault, mint()], "smoke")
                .await
                .unwrap();
        let va = crate::rpc::required_account(&accs, 0, "vault").unwrap();
        assert_eq!(va.owner.to_string(), PERENA_PROGRAM);
        let (auth, dec) = mint_authority_and_decimals(
            &crate::rpc::required_account(&accs, 1, "mint").unwrap().data,
        )
        .unwrap();
        assert_eq!(auth, Some(vault), "USD* mint authority must be the vault");
        assert_eq!(dec, 6);
        let v = decode_vault(&va.data).unwrap();
        let nav = nav_from_vault(&v, &mint()).unwrap();
        let l = liveness(&v, chrono::Utc::now().timestamp());
        println!(
            "LIVE USD* slot={slot} nav={nav} last_update_age_secs={} cb={} stale={} refuse={}",
            l.age_secs, v.circuit_breaker_active, l.stale, l.refuse
        );
    }

    proptest::proptest! {
        #[test]
        fn decode_vault_no_panic_on_arbitrary_bytes(
            data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..2000),
        ) {
            let _ = decode_vault(&data);
        }

        #[test]
        fn decode_vault_no_panic_on_valid_prefix(
            price in proptest::num::u64::ANY,
            ts in proptest::num::i64::ANY,
            now in proptest::num::i64::ANY,
        ) {
            let mut data = vec![0u8; VAULT_LEN];
            data[0..8].copy_from_slice(&VAULT_DISCRIMINATOR);
            data[MINT_DECIMALS_OFFSET] = 6;
            data[MINT_OFFSET..MINT_OFFSET + 32].copy_from_slice(mint().as_ref());
            data[MINT_SHARE_PRICE_OFFSET..MINT_SHARE_PRICE_OFFSET + 8].copy_from_slice(&price.to_le_bytes());
            data[LAST_UPDATE_TS_OFFSET..LAST_UPDATE_TS_OFFSET + 8].copy_from_slice(&ts.to_le_bytes());
            let v = decode_vault(&data).unwrap();
            let _ = nav_from_vault(&v, &mint());
            let _ = liveness(&v, now);
        }
    }
}
