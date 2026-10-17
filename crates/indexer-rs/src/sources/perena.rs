//! Perena USD* intrinsic NAV reader.
//!
//! USD* is the share token of a Perena savings vault. The reserve account
//! stores the precomputed USD-per-share NAV and redundant total-underlying /
//! share-supply fields used to detect silent account-layout shifts.

use crate::sinks;
use crate::sinks::postgres::PerenaNavStats;
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

pub const USDSTAR_MINT: &str = "star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM";
pub const USDSTAR_RESERVE: &str = "sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A";
pub const PERENA_PROGRAM: &str = "save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H";

const RESERVE_DISCRIMINATOR: [u8; 8] = [0x10, 0xa9, 0x7e, 0x63, 0x23, 0xa9, 0x49, 0xc8];
const TOTAL_UNDERLYING_OFFSET: usize = 192;
const SHARE_SUPPLY_OFFSET: usize = 200;
const SHARE_MINT_OFFSET: usize = 320;
const NAV_OFFSET: usize = 352;
const MIN_RESERVE_LEN: usize = 360;
const VALUE_SCALE: u64 = 1_000_000;

/// USD* NAV-accrual stall window (ADR-0038 intrinsic-liveness). USD* is a
/// MONOTONIC-yield vault with NO on-chain epoch/timestamp, so its frozen-backing
/// signal is a NAV that has stopped ADVANCING (the Perena analogue of the
/// SplStakePool `epoch_lag` / Sanctum directory-stale signals). Calibrated LIVE
/// against 21 days of prod history (2026-06-27..07-18, 60,461 polls @30s): USD*
/// NAV ticks ~every 20 min (median), p95 gap ~1h17m, **max healthy flat ~3h35m**
/// — so 12h is ~3.3× the observed max (zero false-positives in-sample) while a
/// genuinely frozen yield crank still trips. Observe-only until
/// `INTRINSIC_LIVENESS_GATE` is enabled — re-validate the window on fresh data
/// before flipping the gate (the standing ADR-0038 "calibrate before ENABLE" rule).
const PERENA_NAV_STALL_SECS: i64 = 12 * 60 * 60;

/// Max tolerated gap between consecutive polls (secs) for the stall window to
/// count as "continuously observed". 5 min = 10× the 30s poll cadence: normal
/// jitter + brief deploy restarts pass, a real indexer/RPC/host outage does not —
/// so a NAV that looks "flat" only because we stopped polling is NOT mistaken for
/// a frozen backing.
const PERENA_MAX_OBS_GAP_SECS: i64 = 5 * 60;

/// Pure stall decision. Stale ⇒ the NAV was flat (`distinct <= 1`) across a
/// window we (a) actually SPANNED (`oldest_age >= 90% of the window` — not a
/// cold start that hasn't accumulated a full window) and (b) CONTINUOUSLY
/// observed (`max_gap <= PERENA_MAX_OBS_GAP_SECS` — no polling OUTAGE
/// masquerading as a freeze). Missing stats / thin / young / gappy window → NOT
/// stale (fail-open: a missing or broken measurement must never force a false
/// "frozen"). Because it keys off a densely-observed FLAT window (not the
/// existence of a prior differing value), it also correctly catches a vault that
/// was already frozen before tracking began, once a full clean window elapses.
fn nav_accrual_stale(stats: Option<&PerenaNavStats>, window_secs: i64) -> bool {
    let Some(s) = stats else { return false };
    s.poll_count > 1
        && s.distinct_navs <= 1
        && s.oldest_age_secs >= window_secs * 9 / 10
        && s.max_gap_secs <= PERENA_MAX_OBS_GAP_SECS
}

/// Decode the Perena reserve and return `(nav, total_underlying, share_supply)`.
pub fn decode_nav(data: &[u8], expected_mint: &Pubkey) -> Result<(Decimal, u64, u64)> {
    anyhow::ensure!(
        data.len() >= MIN_RESERVE_LEN,
        "reserve account too short: {} bytes (need ≥ {})",
        data.len(),
        MIN_RESERVE_LEN
    );
    anyhow::ensure!(
        data.get(0..8) == Some(RESERVE_DISCRIMINATOR.as_slice()),
        "reserve discriminator mismatch"
    );

    let share_mint_end = SHARE_MINT_OFFSET + 32;
    let share_mint_bytes = data
        .get(SHARE_MINT_OFFSET..share_mint_end)
        .context("missing share mint at offset 320")?;
    let share_mint = Pubkey::try_from(share_mint_bytes)
        .map_err(|_| anyhow::anyhow!("invalid share-mint pubkey at offset 320"))?;
    anyhow::ensure!(
        share_mint == *expected_mint,
        "share mint mismatch: reserve says {share_mint}, expected {expected_mint}"
    );

    let total_underlying = read_u64_le(data, TOTAL_UNDERLYING_OFFSET)?;
    let share_supply = read_u64_le(data, SHARE_SUPPLY_OFFSET)?;
    let nav_raw = read_u64_le(data, NAV_OFFSET)?;

    anyhow::ensure!(share_supply != 0, "reserve share_supply is zero");
    anyhow::ensure!(nav_raw != 0, "reserve NAV is zero");

    let nav = Decimal::from(nav_raw)
        .checked_div(Decimal::from(VALUE_SCALE))
        .context("divide NAV by scale")?;
    let ratio = Decimal::from(total_underlying)
        .checked_div(Decimal::from(share_supply))
        .context("divide total_underlying by share_supply")?;
    let relative_difference = (nav - ratio)
        .abs()
        .checked_div(nav)
        .context("divide NAV cross-check difference by NAV")?;
    let max_relative_difference = Decimal::from(5u64)
        .checked_div(Decimal::from(1_000u64))
        .context("construct NAV cross-check threshold")?;

    anyhow::ensure!(
        relative_difference <= max_relative_difference,
        "NAV cross-check failed: nav={nav} ratio={ratio} relative_difference={relative_difference} > 0.005"
    );

    let upper_bound = Decimal::from(15u64)
        .checked_div(Decimal::from(10u64))
        .context("construct NAV upper bound")?;
    anyhow::ensure!(
        nav >= Decimal::ONE && nav < upper_bound,
        "NAV {nav} outside sanity band [1.0, 1.5)"
    );

    Ok((nav, total_underlying, share_supply))
}

/// Read a little-endian u64 from `data[offset..offset+8]`.
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
    let bytes: [u8; 8] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("read_u64_le expected 8 bytes at offset {offset}"))?;
    Ok(u64::from_le_bytes(bytes))
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_perena {
        info!("FEATURE_PERENA=false — perena source disabled");
        return Ok(());
    }

    let usdstar_active = state
        .assets
        .assets
        .iter()
        .any(|a| a.active && a.mint == USDSTAR_MINT);
    if !usdstar_active {
        info!("USD* inactive (active=false) — perena source idle");
        return Ok(());
    }

    let reserve_pk = Pubkey::from_str(USDSTAR_RESERVE).context("parse USD* reserve")?;
    let expected_mint = Pubkey::from_str(USDSTAR_MINT).context("parse USD* mint")?;
    let cadence_ms = state.config.perena_poll_ms.unwrap_or(30_000);

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

    info!(cadence_ms, reserve = %reserve_pk, "perena source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("perena source shutdown");
                return Ok(());
            }
        }

        if let Err(error) =
            poll_once(&state, &rpc, &rpc_fallback, &reserve_pk, &expected_mint).await
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
    reserve_pk: &Pubkey,
    expected_mint: &Pubkey,
) -> Result<()> {
    let started = std::time::Instant::now();
    let account =
        crate::rpc::get_account_with_fallback(rpc, rpc_fallback, reserve_pk, "perena").await?;

    anyhow::ensure!(
        account.owner == Pubkey::from_str(PERENA_PROGRAM)?,
        "USD* reserve owner mismatch: got {} expected {PERENA_PROGRAM}",
        account.owner
    );

    let now = chrono::Utc::now();
    let (nav, total_underlying, share_supply) = decode_nav(&account.data, expected_mint)?;
    metrics::histogram!("pegana_perena_latency_seconds").record(started.elapsed().as_secs_f64());
    metrics::gauge!("pegana_perena_usdstar_nav_usd").set(pegana_common::decimal_to_f64(nav));

    let ratio = Decimal::from(total_underlying)
        .checked_div(Decimal::from(share_supply))
        .context("compute Perena cross-check ratio for metadata")?;
    let meta = serde_json::json!({
        "reserve": reserve_pk.to_string(),
        "program": PERENA_PROGRAM,
        "share_mint": expected_mint.to_string(),
        "total_underlying_raw": total_underlying.to_string(),
        "share_supply_raw": share_supply.to_string(),
        "cross_check_ratio": ratio,
        "formula": "reserve.nav / 1_000_000; guarded by total_underlying / share_supply",
    });

    sinks::postgres::insert_intrinsic(&state.pg, "USD*", nav, "perena", meta.clone(), None, now)
        .await
        .context("insert intrinsic snapshot")?;

    // Intrinsic-liveness (ADR-0038): USD* has no on-chain epoch/timestamp, so its
    // frozen-backing signal is a NAV-accrual STALL — a densely + continuously
    // observed FLAT window (not a wall-clock "time since last change", which would
    // false-fire after a >window polling outage). Queried AFTER the insert above.
    // Fail-open at every step; observe-only until INTRINSIC_LIVENESS_GATE is on.
    // The verdict pipeline is untouched — this only populates the gate's table.
    let nav_stats =
        sinks::postgres::perena_nav_window_stats(&state.pg, PERENA_NAV_STALL_SECS).await;
    let stale = nav_accrual_stale(nav_stats.as_ref(), PERENA_NAV_STALL_SECS);
    if let Some(s) = &nav_stats {
        metrics::gauge!("pegana_perena_nav_max_gap_secs").set(s.max_gap_secs as f64);
        metrics::gauge!("pegana_perena_nav_distinct_in_window").set(s.distinct_navs as f64);
    }
    if stale {
        warn!(
            nav = %nav,
            "USD* NAV accrual STALLED: yield NAV was FLAT across a densely-observed ≥{PERENA_NAV_STALL_SECS}s \
             window — backing may be frozen while still stamped ts=now() (a false-PEGGED risk). \
             Observe-only, verdict pipeline untouched; investigate the Perena updateYieldingInfo crank"
        );
    }
    if let Err(e) = sinks::postgres::upsert_intrinsic_liveness(
        &state.pg,
        "USD*",
        stale,
        "nav_accrual_stall",
        serde_json::json!({
            "stall_window_secs": PERENA_NAV_STALL_SECS,
            "max_obs_gap_secs": PERENA_MAX_OBS_GAP_SECS,
            "distinct_navs": nav_stats.as_ref().map(|s| s.distinct_navs),
            "oldest_age_secs": nav_stats.as_ref().map(|s| s.oldest_age_secs),
            "max_gap_secs": nav_stats.as_ref().map(|s| s.max_gap_secs),
            "poll_count": nav_stats.as_ref().map(|s| s.poll_count),
        }),
    )
    .await
    {
        warn!(error = %e, "intrinsic_liveness upsert failed (nav_accrual_stall)");
    }

    let payload = serde_json::json!({
        "asset": "USD*",
        "value_usd": nav,
        "source": "perena",
        "meta": meta,
        "ts": now,
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

    proptest::proptest! {
        // Fuzz: arbitrary bytes of any length must never PANIC the decoder
        // (out-of-bounds slice, overflow) — only ever Ok or Err. Guards the
        // bounds-checked reads + length gate against a future unguarded index.
        #[test]
        fn decode_nav_no_panic_on_arbitrary_bytes(
            data in proptest::collection::vec(proptest::num::u8::ANY, 0usize..600),
        ) {
            let mint = Pubkey::from_str(USDSTAR_MINT).unwrap();
            let _ = decode_nav(&data, &mint);
        }

        // Fuzz: a well-formed prefix (discriminator + share mint) with fuzzed
        // numeric fields — reaches PAST the header into the checked_div /
        // cross-check / sanity-band arithmetic, where an F-12 overflow panic
        // would live. share_supply / nav_raw == 0 hit the zero-guards (Err).
        #[test]
        fn decode_nav_no_panic_on_valid_prefix(
            total_underlying in proptest::num::u64::ANY,
            share_supply in proptest::num::u64::ANY,
            nav_raw in proptest::num::u64::ANY,
        ) {
            let mint = Pubkey::from_str(USDSTAR_MINT).unwrap();
            let mut data = vec![0u8; MIN_RESERVE_LEN + 8];
            data[0..8].copy_from_slice(&RESERVE_DISCRIMINATOR);
            data[SHARE_MINT_OFFSET..SHARE_MINT_OFFSET + 32].copy_from_slice(mint.as_ref());
            data[TOTAL_UNDERLYING_OFFSET..TOTAL_UNDERLYING_OFFSET + 8]
                .copy_from_slice(&total_underlying.to_le_bytes());
            data[SHARE_SUPPLY_OFFSET..SHARE_SUPPLY_OFFSET + 8]
                .copy_from_slice(&share_supply.to_le_bytes());
            data[NAV_OFFSET..NAV_OFFSET + 8].copy_from_slice(&nav_raw.to_le_bytes());
            let _ = decode_nav(&data, &mint);
        }
    }

    fn fixture() -> (serde_json::Value, Vec<u8>) {
        let raw = std::fs::read_to_string("fixtures/perena/usdstar-reserve.json")
            .expect("fixture present");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("valid fixture JSON");
        let b64 = json["result"]["value"]["data"][0]
            .as_str()
            .expect("base64 data");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("valid base64");
        (json, bytes)
    }

    #[test]
    fn decodes_fixture() {
        let (json, bytes) = fixture();
        assert_eq!(
            json["result"]["value"]["owner"].as_str(),
            Some(PERENA_PROGRAM),
            "fixture must be owned by the Perena savings program"
        );

        let mint = Pubkey::from_str(USDSTAR_MINT).expect("valid USD* mint");
        let (nav, total_underlying, share_supply) =
            decode_nav(&bytes, &mint).expect("decode succeeds");
        let ratio = Decimal::from(total_underlying)
            .checked_div(Decimal::from(share_supply))
            .expect("non-zero fixture share supply");

        assert!(nav >= Decimal::ONE, "NAV must be at least 1.0, got {nav}");
        let upper = Decimal::from(12u64)
            .checked_div(Decimal::from(10u64))
            .expect("valid upper bound");
        assert!(nav < upper, "fixture NAV must be below 1.2, got {nav}");

        let relative_difference = (nav - ratio)
            .abs()
            .checked_div(nav)
            .expect("non-zero fixture NAV");
        let tolerance = Decimal::from(5u64)
            .checked_div(Decimal::from(1_000u64))
            .expect("valid tolerance");
        assert!(
            relative_difference <= tolerance,
            "NAV {nav} must approximate cross-check ratio {ratio}"
        );
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let (_, mut bytes) = fixture();
        bytes[0] ^= 0xff;
        let mint = Pubkey::from_str(USDSTAR_MINT).expect("valid USD* mint");
        let error = decode_nav(&bytes, &mint).expect_err("wrong discriminator rejected");
        assert!(error.to_string().contains("discriminator mismatch"));
    }

    #[test]
    fn rejects_mint_mismatch() {
        let (_, mut bytes) = fixture();
        bytes[SHARE_MINT_OFFSET] ^= 0xff;
        let mint = Pubkey::from_str(USDSTAR_MINT).expect("valid USD* mint");
        let error = decode_nav(&bytes, &mint).expect_err("wrong share mint rejected");
        assert!(error.to_string().contains("share mint mismatch"));
    }

    #[test]
    fn rejects_short_account() {
        let bytes = vec![0u8; MIN_RESERVE_LEN - 1];
        let mint = Pubkey::from_str(USDSTAR_MINT).expect("valid USD* mint");
        let error = decode_nav(&bytes, &mint).expect_err("short account rejected");
        assert!(error.to_string().contains("too short"));
    }

    #[test]
    fn nav_accrual_stall_requires_dense_continuous_flat_window() {
        let w = PERENA_NAV_STALL_SECS; // 12h
        let spanned = w * 95 / 100; // oldest poll ~11.4h old — window is covered
        let stats = |distinct, oldest, max_gap, polls| PerenaNavStats {
            distinct_navs: distinct,
            oldest_age_secs: oldest,
            max_gap_secs: max_gap,
            poll_count: polls,
        };

        // No stats (query error) → fail-open, NOT stale.
        assert!(!nav_accrual_stale(None, w));
        // Genuinely frozen: flat, spanned, densely + continuously observed → STALE.
        assert!(nav_accrual_stale(Some(&stats(1, spanned, 30, 1400)), w));
        // NAV moved in the window (distinct >= 2) → NOT stale.
        assert!(!nav_accrual_stale(Some(&stats(2, spanned, 30, 1400)), w));
        // OUTAGE false-fire guard: flat + spanned but a 6h polling gap → NOT stale
        // (the flat span across the outage was unobserved, not a proven freeze).
        assert!(!nav_accrual_stale(
            Some(&stats(1, spanned, 6 * 3600, 700)),
            w
        ));
        // Cold start: flat + continuous but oldest poll only ~3h old (window not
        // yet spanned) → NOT stale.
        assert!(!nav_accrual_stale(Some(&stats(1, 3 * 3600, 30, 360)), w));
        // Too thin to judge (a single poll) → NOT stale.
        assert!(!nav_accrual_stale(Some(&stats(1, spanned, 0, 1)), w));
    }
}
