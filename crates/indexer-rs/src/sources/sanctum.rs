//! Sanctum extra-api batch poll for LST intrinsic sol_value.
//!
//! One HTTP request per cycle returns N LST values. We multiply by Pyth SOL/USD
//! (from the in-memory cache populated by `sources::pyth`) to get USD intrinsic,
//! persist to `intrinsic_snapshots`, refresh the in-memory cache, and publish
//! on Redis.

use crate::sinks;
use crate::state::AppState;
use anyhow::Result;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;
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

        if let Err(e) = poll_once(&state, &symbols).await {
            warn!(error = %e, "sanctum poll failed");
            metrics::counter!("pegana_sanctum_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_sanctum_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(state: &AppState, symbols: &[String]) -> Result<()> {
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

    // Pull SOL/USD from the Pyth cache — present, non-zero, AND fresh; if missing
    // or stale we still persist sol_value (SOL-denominated, numéraire-independent)
    // but skip USD, rather than multiply a frozen price into a fresh-looking USD
    // NAV (see state::fresh_numeraire).
    let sol_usd_opt = crate::state::fresh_numeraire(&state.pyth, "SOL/USD").await;

    let ts = chrono::Utc::now();

    for (sym, lamports_str) in &body.sol_values {
        // Parse lamports → SOL.
        let lamports = match u64::from_str(lamports_str) {
            Ok(n) => n,
            Err(_) => {
                warn!(symbol = %sym, raw = %lamports_str, "bad lamports");
                continue;
            }
        };

        // Zero-backing guard (#R4-3): Sanctum returning "0" parses fine but is
        // not a real LST NAV — it would write a $0 intrinsic row and publish a
        // $0 market_usd, poisoning downstream. Mirrors spl_stake_pool.rs's
        // `ensure!(total_lamports > 0)` and hylo.rs's $0-row guard. Skip BEFORE
        // touching sanctum_cache so the in-memory reference stays last-good too.
        if lamports == 0 {
            warn!(symbol = %sym, "sanctum returned 0 lamports · skipping (would write $0 intrinsic)");
            // Name it in a per-LST metric (#R5-D): the poll still returns Ok, so
            // `pegana_sanctum_polls_total{status="ok"}` keeps ticking and the
            // fast PeganaSanctumDown alert stays green — a sustained zero for one
            // LST would otherwise only surface ~20min later via the generic
            // PeganaDeadAssets backstop. Mirrors the `body.errs` per-LST counter.
            metrics::counter!("pegana_sanctum_zero_lamports_total", "lst" => sym.clone())
                .increment(1);
            continue;
        }

        // Update sanctum cache.
        {
            let mut sc = state.sanctum_cache.write().await;
            sc.insert(sym.clone(), lamports);
        }

        let sol_per_lst = Decimal::from(lamports) / Decimal::from(1_000_000_000u64);
        let (value_usd, source) = match sol_usd_opt {
            // checked_mul (audit F-12): sol_usd is an external Pyth price with no
            // economic upper bound; a raw `*` panics on overflow → skip this LST.
            Some(sol_usd) => match sol_per_lst.checked_mul(sol_usd) {
                Some(v) => (v, "sanctum+pyth"),
                None => {
                    warn!(symbol = %sym, %sol_per_lst, %sol_usd, "sol_per_lst × sol_usd overflow — skipping LST");
                    continue;
                }
            },
            None => {
                debug!(symbol = %sym, "SOL/USD missing — persisting sol-value without USD");
                continue; // skip: we need USD for intrinsic_snapshots
            }
        };

        let meta = serde_json::json!({
            "sol_per_lst": sol_per_lst,
            "lamports": lamports,
        });

        sinks::postgres::insert_intrinsic(
            &state.pg,
            sym,
            value_usd,
            source,
            meta.clone(),
            None,
            ts,
        )
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
    }

    Ok(())
}
