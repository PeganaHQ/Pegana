//! Solayer sUSD intrinsic NAV reader.
//!
//! sUSD is a Token-2022 mint that uses the `InterestBearingConfig` extension.
//! The current redemption rate (1 sUSD → USD) is encoded directly on the mint
//! account — no separate share-rate PDA. The extension stores:
//!   - `initialization_timestamp` / `pre_update_average_rate`
//!   - `last_update_timestamp` / `current_rate` (basis points)
//!
//! The published rebase factor at wall-clock `t` is:
//!   scale(t) = exp(pre_rate * (last_update - init) / Y / 10_000)
//!           * exp(current_rate * (t - last_update) / Y / 10_000)
//! where Y is `SECONDS_PER_YEAR`. `spl-token-2022` exposes that math via
//! `InterestBearingConfig::amount_to_ui_amount(1 share, decimals, t)` — we
//! call it with one full share (`10^decimals`) so the returned UI amount
//! equals the NAV in dollars.
//!
//! Cadence: 30s (rebasing is smooth — no need for faster polling).

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

pub const SUSD_MINT: &str = "susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X";

/// Decode the current sUSD NAV (1 sUSD → USD) from a Token-2022 mint
/// account's `InterestBearingConfig` extension.
///
/// Returns the redemption rate as a `Decimal`. For a healthy interest-bearing
/// share token the result is ≥ 1.0 (rebases up over time).
pub fn decode_nav(mint_data: &[u8], now_unix_secs: i64) -> Result<Decimal> {
    use spl_token_2022::extension::{
        interest_bearing_mint::InterestBearingConfig, BaseStateWithExtensions, StateWithExtensions,
    };
    use spl_token_2022::state::Mint;

    let state = StateWithExtensions::<Mint>::unpack(mint_data)
        .map_err(|e| anyhow::anyhow!("unpack token-2022 mint: {e}"))?;

    let ib_config = state
        .get_extension::<InterestBearingConfig>()
        .map_err(|e| anyhow::anyhow!("sUSD mint missing InterestBearingConfig: {e}"))?;

    let decimals = state.base.decimals;
    let one_share_raw: u64 = 10u64
        .checked_pow(decimals as u32)
        .context("decimals overflow")?;

    // `amount_to_ui_amount` already divides by 10^decimals internally, so
    // passing one full share yields the per-share NAV directly.
    let nav_str = ib_config
        .amount_to_ui_amount(one_share_raw, decimals, now_unix_secs)
        .context("amount_to_ui_amount returned None (math overflow)")?;
    let nav =
        Decimal::from_str(&nav_str).with_context(|| format!("parse NAV string {nav_str:?}"))?;

    anyhow::ensure!(nav > Decimal::ZERO, "non-positive NAV {nav}");
    anyhow::ensure!(
        nav < Decimal::from(2u32),
        "NAV {nav} > 2.0 — implausible for sUSD"
    );
    Ok(nav)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_solayer {
        info!("FEATURE_SOLAYER=false — solayer_susd source disabled");
        return Ok(());
    }

    // Active-gate: if sUSD is ever deactivated in assets.toml, idle cleanly
    // instead of polling unconditionally. sUSD is currently active — this
    // gate is a no-op today and exists for future-proofing/consistency.
    let susd_active = state
        .assets
        .assets
        .iter()
        .any(|a| a.active && a.mint == SUSD_MINT);
    if !susd_active {
        info!("sUSD inactive (active=false) — solayer_susd source idle");
        return Ok(());
    }

    let mint_pk = Pubkey::from_str(SUSD_MINT).context("parse sUSD mint")?;

    let cadence_ms = state
        .config
        .solayer_poll_ms
        .or(state.assets.polling.solayer_poll_ms)
        .unwrap_or(30_000);

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

    info!(cadence_ms, mint = %mint_pk, "solayer_susd source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("solayer_susd source shutdown");
                return Ok(());
            }
        }

        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &mint_pk).await {
            warn!(error = %e, "solayer_susd poll failed");
            metrics::counter!("pegana_solayer_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_solayer_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    mint_pk: &Pubkey,
) -> Result<()> {
    let started = std::time::Instant::now();

    let account =
        crate::rpc::get_account_with_fallback(rpc, rpc_fallback, mint_pk, "solayer_susd").await?;

    let now = chrono::Utc::now();
    let nav = decode_nav(&account.data, now.timestamp())?;
    metrics::histogram!("pegana_solayer_latency_seconds").record(started.elapsed().as_secs_f64());
    metrics::gauge!("pegana_solayer_susd_nav_usd").set(pegana_common::decimal_to_f64(nav));

    let meta = serde_json::json!({
        "mint": mint_pk.to_string(),
        "nav_decimal": nav.to_string(),
        "formula": "spl-token-2022 InterestBearingConfig::amount_to_ui_amount(1 share, decimals, now)",
    });

    sinks::postgres::insert_intrinsic(&state.pg, "sUSD", nav, "solayer", meta.clone(), None, now)
        .await
        .context("insert intrinsic snapshot")?;

    let payload = serde_json::json!({
        "asset": "sUSD",
        "value_usd": nav,
        "source": "solayer",
        "meta": meta,
        "ts": now,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_SOLAYER,
        &payload,
        "solayer_susd",
    )
    .await
    .context("publish to redis")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::str::FromStr;

    /// Decodes the captured mainnet fixture. The fixture timestamp drifts as
    /// the test gets older, but the NAV at *any* future timestamp should
    /// still land in a sane band (≥ 1.0 because sUSD only rebases up, and
    /// well below 1.5 unless we've accumulated >50% yield).
    #[test]
    fn decodes_fixture() {
        let raw = std::fs::read_to_string("fixtures/solayer/susd-mint-account.json")
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
            owner, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            "fixture must be owned by Token-2022"
        );

        let now = chrono::Utc::now().timestamp();
        let nav = decode_nav(&bytes, now).expect("decode succeeds");

        assert!(
            nav >= Decimal::ONE,
            "NAV must be ≥ 1.0 for a rebasing yield-bearing token, got {nav}"
        );
        assert!(
            nav <= Decimal::from_str("1.5").unwrap(),
            "NAV {nav} > 1.5 — implausible (would imply >50% accumulated yield)"
        );
    }
}
