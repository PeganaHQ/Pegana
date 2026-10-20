//! Sanctum extra-api batch poll for LST intrinsic sol_value.
//!
//! One HTTP request per cycle returns N LST values. We multiply by Pyth SOL/USD
//! (from the in-memory cache populated by `sources::pyth`) to get USD intrinsic,
//! persist to `intrinsic_snapshots`, refresh the in-memory cache, and publish
//! on Redis.

use crate::sinks;
use crate::sources::sanctum_nav::{self, NavDecision, OnchainNav, OnchainSpec};
use crate::state::AppState;
use anyhow::Result;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Deserialize;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

#[derive(Debug, Deserialize)]
struct SolValueResponse {
    #[serde(rename = "solValues")]
    sol_values: HashMap<String, String>,
    #[serde(default)]
    errs: HashMap<String, serde_json::Value>,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let symbols = state.sanctum_symbols();
    if symbols.is_empty() {
        warn!("no sanctum_lst assets declared — sanctum source idle");
        return Ok(());
    }

    let cadence_ms = state
        .config
        .sanctum_poll_ms
        .or(state.assets.polling.sanctum_poll_ms)
        .unwrap_or(15_000);

    let covered = covered_lsts(&state);
    let mut mem = GuardMemory::default();
    let rpc = RpcClient::new_with_commitment(
        state.config.solana_rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let rpc_fallback = RpcClient::new_with_commitment(
        state.config.solana_rpc_url_fallback.clone(),
        CommitmentConfig::confirmed(),
    );

    let mut tick = interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        cadence_ms,
        asset_count = symbols.len(),
        "sanctum source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("sanctum source shutdown");
                return Ok(());
            }
        }

        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &covered, &symbols, &mut mem).await {
            warn!(error = %e, "sanctum poll failed");
            metrics::counter!("pegana_sanctum_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_sanctum_polls_total", "status" => "ok").increment(1);
        }
    }
}

/// Market quotes older than this are not a usable NAV reference for the guard.
const MARKET_REF_MAX_AGE_SECS: i64 = 1_800;
/// RPC `getMultipleAccounts` hard cap.
const MAX_ACCOUNTS_PER_CALL: usize = 100;

/// One `sanctum_lst` asset: its Pegana symbol (market key), the Sanctum symbol
/// (API key + `intrinsic_snapshots` key), and its on-chain NAV reader if mapped.
#[derive(Debug, Clone)]
struct Covered {
    asset: String,
    sanctum_symbol: String,
    active: bool,
    spec: Option<&'static OnchainSpec>,
}

fn covered_lsts(state: &AppState) -> Vec<Covered> {
    use pegana_common::IntrinsicStrategy::SanctumLst;
    state
        .assets
        .assets
        .iter()
        .filter_map(|a| match &a.intrinsic {
            SanctumLst { symbol } => Some(Covered {
                asset: a.symbol.clone(),
                sanctum_symbol: symbol.clone(),
                active: a.active,
                spec: sanctum_nav::spec_for_mint(&a.mint),
            }),
            _ => None,
        })
        .collect()
}

/// Edge-trigger memory so the WARN fires when a LST enters a bad state, not on
/// every 15s poll (counters/gauges still update every poll).
#[derive(Debug, Default)]
struct GuardMemory {
    drifted: HashSet<String>,
    /// Withheld this process lifetime (drift or unverified) — their liveness
    /// flag is cleared on recovery.
    degraded: HashSet<String>,
    /// Entered the `Unverified` state (WARN edge trigger).
    unverified: HashSet<String>,
    /// Until the first poll that produced data, a healthy asset also clears a
    /// leftover `sanctum_nav_*` flag from a previous process (restart safety).
    startup_swept: bool,
    /// Last epoch-lag liveness write per asset: (stale verdict, when).
    epoch_written: HashMap<String, (bool, std::time::Instant)>,
}

/// Re-stamp interval for the epoch-lag liveness row (engine freshness is 3600 s).
const EPOCH_LIVENESS_REFRESH_SECS: u64 = 300;

async fn fetch_api(state: &AppState, symbols: &[String]) -> Result<SolValueResponse> {
    let started = std::time::Instant::now();
    let mut url = format!("{}/v1/sol-value/current", state.config.sanctum_api_url);
    for (i, sym) in symbols.iter().enumerate() {
        url.push(if i == 0 { '?' } else { '&' });
        url.push_str("lst=");
        // URL-encode reserved chars. `+` in particular gets decoded back to
        // a space by the server unless we send %2B (this matters for symbols
        // like "hyloSOL+"). Other safe punctuation in our symbols (digits,
        // letters, `-`, `_`) doesn't need encoding, so the cheap form-encoder
        // is fine here without dragging in url::form_urlencoded.
        for c in sym.chars() {
            match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => url.push(c),
                _ => {
                    let mut buf = [0u8; 4];
                    for b in c.encode_utf8(&mut buf).as_bytes() {
                        url.push_str(&format!("%{b:02X}"));
                    }
                }
            }
        }
    }

    let resp = state.http.get(&url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("sanctum http {}", status);
    }
    let body: SolValueResponse = resp.json().await?;
    metrics::histogram!("pegana_sanctum_latency_seconds").record(started.elapsed().as_secs_f64());
    Ok(body)
}

/// Read every mapped active LST's NAV straight from chain (one batched call).
/// Failures degrade per LST (or to an empty map) and never abort the poll: the
/// guard then falls back to the market-implied check on the API value.
async fn fetch_onchain(
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    covered: &[Covered],
) -> HashMap<String, OnchainNav> {
    let mut out = HashMap::new();
    // (covered index, range into the flat pubkey list)
    let mut flat: Vec<Pubkey> = Vec::new();
    let mut ranges: Vec<(usize, std::ops::Range<usize>)> = Vec::new();
    for (i, c) in covered.iter().enumerate() {
        let Some(spec) = c.spec.filter(|_| c.active) else {
            continue;
        };
        match spec.accounts() {
            Ok(keys) => {
                let start = flat.len();
                flat.extend(keys);
                ranges.push((i, start..flat.len()));
            }
            Err(e) => {
                warn!(lst = %c.sanctum_symbol, error = %e, "bad on-chain NAV spec");
            }
        }
    }
    if flat.is_empty() {
        return out;
    }
    let mut accounts: Vec<Option<solana_sdk::account::Account>> = Vec::with_capacity(flat.len());
    for chunk in flat.chunks(MAX_ACCOUNTS_PER_CALL) {
        match crate::rpc::get_multiple_accounts_with_fallback(
            rpc,
            rpc_fallback,
            chunk,
            "sanctum_onchain_nav",
        )
        .await
        {
            Ok((v, _slot)) => accounts.extend(v),
            Err(e) => {
                warn!(error = %e, "sanctum on-chain NAV batch read failed on both RPCs");
                metrics::counter!("pegana_sanctum_onchain_errors_total", "lst" => "_batch")
                    .increment(1);
                return out;
            }
        }
    }
    for (i, range) in ranges {
        let c = &covered[i];
        let spec = c.spec.expect("range only built for mapped specs");
        let slice = &accounts[range];
        let got: Option<Vec<(Pubkey, &[u8])>> = slice
            .iter()
            .map(|a| a.as_ref().map(|a| (a.owner, a.data.as_slice())))
            .collect();
        let res = match got {
            Some(accts) => sanctum_nav::decode_onchain_nav(spec, &accts),
            None => Err(anyhow::anyhow!("account not found")),
        };
        match res {
            Ok(nav) => {
                out.insert(c.sanctum_symbol.clone(), nav);
            }
            Err(e) => {
                warn!(lst = %c.sanctum_symbol, error = %e, "sanctum on-chain NAV decode failed — falling back to guarded API value");
                metrics::counter!("pegana_sanctum_onchain_errors_total", "lst" => c.sanctum_symbol.clone())
                    .increment(1);
            }
        }
    }
    out
}

fn lamports_to_nav(lamports: u64) -> Decimal {
    Decimal::from(lamports) / Decimal::from(1_000_000_000u64)
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    covered: &[Covered],
    symbols: &[String],
    mem: &mut GuardMemory,
) -> Result<()> {
    // API failure must not blind us to the on-chain NAVs: carry the error and
    // report it at the end so `polls_total{status="error"}` still fires.
    let (body, api_err) = match fetch_api(state, symbols).await {
        Ok(b) => (b, None),
        Err(e) => (
            SolValueResponse {
                sol_values: HashMap::new(),
                errs: HashMap::new(),
            },
            Some(e),
        ),
    };

    // Per-LST errors: Sanctum returns `errs{symbol}` for LSTs it couldn't
    // price this poll while the overall HTTP still succeeds (status="ok"). A
    // single persistently-erroring LST silently retains its LAST sol_value in
    // `sanctum_cache` and would otherwise be invisible until the engine's 600s
    // staleness gate — so name it in a metric NOW, per LST, not just at debug.
    if !body.errs.is_empty() {
        debug!(?body.errs, "sanctum partial errs");
        for lst in body.errs.keys() {
            metrics::counter!("pegana_sanctum_lst_errs_total", "lst" => lst.clone()).increment(1);
        }
    }

    // Pull SOL/USD — fresh Pyth, else the Jupiter-derived last resort. If both
    // are unavailable we still persist sol_value (SOL-denominated,
    // numéraire-independent) but skip USD, rather than multiply a frozen price
    // into a fresh-looking USD NAV (see jupiter::numeraire_usd).
    let sol_usd_opt = crate::sources::jupiter::numeraire_usd(state, "SOL/USD").await;

    let onchain = fetch_onchain(rpc, rpc_fallback, covered).await;

    // Market-implied NAV (SOL per LST) as the reference for LSTs without an
    // on-chain read. Only fetched when some active LST needs it.
    let need_market: Vec<String> = covered
        .iter()
        .filter(|c| c.active && !onchain.contains_key(&c.sanctum_symbol))
        .map(|c| c.asset.clone())
        .collect();
    let market_usd = if need_market.is_empty() {
        HashMap::new()
    } else {
        // A query error is logged + counted inside `market_ref_or_empty`; the
        // resulting empty map makes unverifiable API NAVs fail CLOSED (withheld).
        sanctum_nav::market_ref_or_empty(
            sinks::postgres::latest_market_usd_batch(
                &state.pg,
                &need_market,
                MARKET_REF_MAX_AGE_SECS,
            )
            .await,
        )
        .0
    };

    // Current epoch for the pool crank-lag signal (best effort, once per poll).
    let current_epoch = match rpc.get_epoch_info().await {
        Ok(i) => Some(i.epoch),
        Err(_) => rpc_fallback.get_epoch_info().await.ok().map(|i| i.epoch),
    };

    let max_drift_bps = state.config.sanctum_nav_drift_bps;
    let ts = chrono::Utc::now();

    for c in covered {
        let sym = &c.sanctum_symbol;
        let api_nav = match body.sol_values.get(sym) {
            None => None,
            Some(raw) => match u64::from_str(raw) {
                // Zero-backing guard (#R4-3): Sanctum returning "0" parses fine
                // but is not a real LST NAV — it would write a $0 intrinsic row
                // and publish a $0 market_usd, poisoning downstream. Treat as
                // absent (an on-chain NAV can still be published).
                Ok(0) => {
                    warn!(symbol = %sym, "sanctum returned 0 lamports · ignoring API value");
                    // Name it in a per-LST metric (#R5-D): the poll still
                    // returns Ok, so the fast PeganaSanctumDown alert stays
                    // green otherwise.
                    metrics::counter!("pegana_sanctum_zero_lamports_total", "lst" => sym.clone())
                        .increment(1);
                    None
                }
                Ok(n) => Some(lamports_to_nav(n)),
                Err(_) => {
                    warn!(symbol = %sym, raw = %raw, "bad lamports");
                    None
                }
            },
        };
        let on = onchain.get(sym);
        let market_nav = sol_usd_opt
            .filter(|p| *p > Decimal::ZERO)
            .and_then(|p| market_usd.get(&c.asset).and_then(|m| m.checked_div(p)));

        match sanctum_nav::decide(
            api_nav,
            on.map(|o| o.nav_sol),
            market_nav,
            max_drift_bps,
            c.active,
        ) {
            NavDecision::Nothing => {
                metrics::gauge!("pegana_sanctum_nav_drift_bps", "lst" => sym.clone()).set(0.0);
            }
            NavDecision::Onchain {
                nav,
                api_drift_bps,
                api_drifted,
            } => {
                metrics::counter!("pegana_sanctum_nav_source_total", "source" => "onchain")
                    .increment(1);
                // Always set, so the gauge can never stick at an old value.
                metrics::gauge!("pegana_sanctum_nav_drift_bps", "lst" => sym.clone())
                    .set(api_drift_bps.unwrap_or(0) as f64);
                if let (Some(last), Some(cur)) =
                    (on.and_then(|o| o.last_update_epoch), current_epoch)
                {
                    write_epoch_lag(state, mem, c, last, cur).await;
                }
                if api_drifted {
                    metrics::counter!("pegana_sanctum_nav_drift_total", "lst" => sym.clone(), "action" => "onchain_fallback")
                        .increment(1);
                    if mem.drifted.insert(sym.clone()) {
                        warn!(
                            symbol = %sym,
                            api_nav = ?api_nav,
                            onchain_nav = %nav,
                            api_drift_bps = ?api_drift_bps,
                            max_drift_bps,
                            "sanctum API NAV disagrees with on-chain NAV beyond the bound — \
                             publishing the on-chain NAV, not the API value"
                        );
                    }
                } else {
                    mem.drifted.remove(sym);
                }
                clear_degraded(state, mem, sym).await;
                let meta = serde_json::json!({
                    "sol_per_lst": nav,
                    "formula": "on-chain NAV (stake pool / Marinade / S Controller)",
                    "api_sol_per_lst": api_nav,
                    "api_drift_bps": api_drift_bps,
                    "last_update_epoch": on.and_then(|o| o.last_update_epoch).map(|e| e.to_string()),
                });
                publish(state, sym, nav, "sanctum_onchain", sol_usd_opt, meta, ts).await?;
            }
            NavDecision::Api {
                checked_against_market,
            } => {
                metrics::counter!("pegana_sanctum_nav_source_total", "source" => if checked_against_market { "api" } else { "api_unchecked" })
                    .increment(1);
                mem.drifted.remove(sym);
                metrics::gauge!("pegana_sanctum_nav_drift_bps", "lst" => sym.clone()).set(0.0);
                clear_degraded(state, mem, sym).await;
                let nav = api_nav.expect("Api decision implies an API value");
                let lamports = (nav * Decimal::from(1_000_000_000u64)).round();
                let meta = serde_json::json!({
                    "sol_per_lst": nav,
                    "lamports": lamports,
                    "market_checked": checked_against_market,
                });
                publish(state, sym, nav, "sanctum", sol_usd_opt, meta, ts).await?;
            }
            NavDecision::Degraded { shortfall_bps } => {
                metrics::counter!("pegana_sanctum_nav_source_total", "source" => "degraded")
                    .increment(1);
                metrics::counter!("pegana_sanctum_nav_drift_total", "lst" => sym.clone(), "action" => "withheld")
                    .increment(1);
                metrics::gauge!("pegana_sanctum_nav_drift_bps", "lst" => sym.clone())
                    .set(-(shortfall_bps as f64));
                if mem.degraded.insert(sym.clone()) {
                    warn!(
                        symbol = %sym,
                        api_nav = ?api_nav,
                        market_nav = ?market_nav,
                        shortfall_bps,
                        max_drift_bps,
                        "sanctum API NAV is far BELOW the market and no on-chain NAV is available — \
                         withholding it and flagging intrinsic_liveness stale (stale-NAV signature, \
                         would otherwise read as a false PEGGED)"
                    );
                }
                // Re-assert every poll: the liveness row is freshness-guarded by
                // the engine, and lst_directory_audit may overwrite the reason.
                if let Err(e) = sinks::postgres::upsert_intrinsic_liveness_guarded(
                    &state.pg,
                    &c.asset,
                    true,
                    sanctum_nav::LIVENESS_REASON,
                    serde_json::json!({
                        "api_nav": api_nav,
                        "market_nav": market_nav,
                        "shortfall_bps": shortfall_bps,
                        "max_drift_bps": max_drift_bps,
                    }),
                )
                .await
                {
                    warn!(symbol = %sym, error = %e, "intrinsic_liveness upsert failed (sanctum_nav_drift)");
                }
            }
            NavDecision::Unverified => {
                metrics::counter!("pegana_sanctum_nav_source_total", "source" => "unverified_withheld")
                    .increment(1);
                metrics::gauge!("pegana_sanctum_nav_drift_bps", "lst" => sym.clone()).set(0.0);
                if mem.unverified.insert(sym.clone()) {
                    warn!(
                        symbol = %sym,
                        api_nav = ?api_nav,
                        "sanctum API NAV cannot be verified (no on-chain read and no market \
                         reference) — withholding it and flagging intrinsic_liveness stale"
                    );
                }
                mem.degraded.insert(sym.clone());
                if let Err(e) = sinks::postgres::upsert_intrinsic_liveness_guarded(
                    &state.pg,
                    &c.asset,
                    true,
                    sanctum_nav::LIVENESS_REASON_UNVERIFIED,
                    serde_json::json!({ "api_nav": api_nav, "onchain": false, "market_ref": false }),
                )
                .await
                {
                    warn!(symbol = %sym, error = %e, "intrinsic_liveness upsert failed (sanctum_nav_unverified)");
                }
            }
        }
    }

    if api_err.is_none() || !onchain.is_empty() {
        mem.startup_swept = true;
    }
    match api_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Recovery: clear OUR stale flag (only if the row still carries our reason, so a
/// directory-stale/epoch-lag signal from another source is never clobbered).
async fn clear_degraded(state: &AppState, mem: &mut GuardMemory, sym: &str) {
    mem.unverified.remove(sym);
    // `!startup_swept`: first poll after a restart also clears a flag the previous
    // process left behind for an asset this poll proves healthy.
    if mem.degraded.remove(sym) || !mem.startup_swept {
        if let Err(e) = sinks::postgres::clear_intrinsic_liveness_if_reasons(
            &state.pg,
            sym,
            &[
                sanctum_nav::LIVENESS_REASON,
                sanctum_nav::LIVENESS_REASON_UNVERIFIED,
            ],
        )
        .await
        {
            warn!(symbol = %sym, error = %e, "intrinsic_liveness clear failed (sanctum_nav_*)");
        }
    }
}

/// Same crank-lag signal `spl_stake_pool` writes (reason `epoch_lag`, threshold
/// `EPOCH_LAG_WARN`), re-stamped on change or every few minutes.
async fn write_epoch_lag(
    state: &AppState,
    mem: &mut GuardMemory,
    c: &Covered,
    last: u64,
    cur: u64,
) {
    use crate::sources::spl_stake_pool::{epoch_lag, EPOCH_LAG_WARN};
    let lag = epoch_lag(cur, last);
    metrics::gauge!("pegana_spl_stake_pool_epoch_lag", "symbol" => c.asset.clone()).set(lag as f64);
    let stale = lag >= EPOCH_LAG_WARN;
    let now = std::time::Instant::now();
    if !sanctum_nav::liveness_refresh_due(
        mem.epoch_written.get(&c.asset).copied(),
        stale,
        now,
        EPOCH_LIVENESS_REFRESH_SECS,
    ) {
        return;
    }
    if stale {
        warn!(
            symbol = %c.asset, current_epoch = cur, last_update_epoch = last, epoch_lag = lag,
            "sanctum-path stake pool crank stalled: on-chain NAV is frozen but stamped ts=now()"
        );
    }
    match sinks::postgres::upsert_intrinsic_liveness_guarded(
        &state.pg,
        &c.asset,
        stale,
        "epoch_lag",
        serde_json::json!({ "epoch_lag": lag, "current_epoch": cur, "last_update_epoch": last }),
    )
    .await
    {
        Ok(_) => {
            mem.epoch_written.insert(c.asset.clone(), (stale, now));
        }
        Err(e) => {
            warn!(symbol = %c.asset, error = %e, "intrinsic_liveness upsert failed (epoch_lag)")
        }
    }
}

/// Persist + cache + publish one chosen NAV (SOL per LST).
async fn publish(
    state: &AppState,
    sym: &str,
    sol_per_lst: Decimal,
    source_tag: &str,
    sol_usd_opt: Option<Decimal>,
    meta: serde_json::Value,
    ts: chrono::DateTime<chrono::Utc>,
) -> Result<()> {
    // Update sanctum cache (lamports) with the value actually published — the
    // lst-directory self-audit reads it as "our rate".
    if let Some(lamports) = (sol_per_lst * Decimal::from(1_000_000_000u64))
        .floor()
        .to_u64()
    {
        state
            .sanctum_cache
            .write()
            .await
            .insert(sym.to_string(), lamports);
    }

    let Some(sol_usd) = sol_usd_opt else {
        debug!(symbol = %sym, "SOL/USD missing — persisting sol-value without USD");
        return Ok(()); // skip: we need USD for intrinsic_snapshots
    };
    // checked_mul (audit F-12): sol_usd is an external Pyth price with no
    // economic upper bound; a raw `*` panics on overflow → skip this LST.
    let Some(value_usd) = sol_per_lst.checked_mul(sol_usd) else {
        warn!(symbol = %sym, %sol_per_lst, %sol_usd, "sol_per_lst × sol_usd overflow — skipping LST");
        return Ok(());
    };
    let source = format!("{source_tag}+pyth");

    sinks::postgres::insert_intrinsic(&state.pg, sym, value_usd, &source, meta.clone(), None, ts)
        .await?;

    // Publish BOTH `value_usd` (legacy, for stable_* downstream) and
    // `value_sol` (the underlying invariant). For LSTs the engine
    // prefers the SOL path because intrinsic_usd / market_usd are
    // both pyth(SOL/USD)-multiplied and the multiplier cancels —
    // computing in SOL eliminates the synthetic burst we saw on
    // 2026-05-25 23:09 when SOL spot moved ~0.7% between Sanctum and
    // Jupiter polls and 6 LSTs simultaneously "depegged" by the same
    // delta. See docs/incident-2026-05-25-lst-burst.md.
    let payload = serde_json::json!({
        "asset": sym,
        "value_usd": value_usd,
        "value_sol": sol_per_lst,
        "source": source,
        "meta": meta,
        "ts": ts,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_SANCTUM,
        &payload,
        "sanctum",
    )
    .await?;
    Ok(())
}
