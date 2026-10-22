//! Issuer NAV from an Ethereum mainnet view call (`eth_call`).
//!
//! Replaces the Pyth redemption-rate feeds (`USDY/USD.RR`, `SUSDE/USDE.RR`)
//! that are not available on Solana without paid Hermes. The NAV is read from
//! the issuer's own Ethereum contract, the same contract the Pyth RR feed
//! itself attested:
//!
//!   - USDY: Ondo `RWADynamicOracle` 0xA0219AA5…De0 `getPrice()` (0x98d5fdca),
//!     USD per USDY, 18 decimals.
//!   - sUSDe: the sUSDe ERC-4626 vault 0x9D39A5DE…3497
//!     `convertToAssets(1e18)` (0x07a2d13a + uint256 1e18), USDe per sUSDe,
//!     18 decimals. USDe is treated as $1 (as the previous `.RR` feed was).
//!
//! Reading discipline per poll (every 60s):
//!   1. Each configured RPC (public, keyless) is asked for the latest block
//!      (number + timestamp), then for every configured `eth_call` pinned AT
//!      that block number, as one JSON-RPC batch. Pinning makes the values from
//!      one RPC block-consistent and lets the block timestamp bound their age.
//!   2. A reading whose block is older than `max_block_age_secs` is rejected
//!      (a lagging RPC must never serve a stale NAV as fresh).
//!   3. Quorum: at least [`MIN_AGREEING_RPCS`] (2) fresh readings must agree
//!      within `max_divergence_bps`; otherwise NOTHING is published for that
//!      asset. With the three default RPCs this is 2-of-3: one outlier or one
//!      dead RPC is tolerated, a single answering RPC is never enough.
//!
//! Each RPC request has a 10s timeout and at most two attempts.
//!
//! Plain JSON-RPC over the shared `reqwest` client: no EVM crates needed for a
//! single uint256 return value.

use crate::sources::nav_publish;
use crate::state::AppState;
use anyhow::{Context, Result};
use pegana_common::IntrinsicStrategy;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::time::Duration;
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Default public Ethereum RPCs (keyless), three independent operators so the
/// 2-of-3 quorum survives one being down. Verified live 2026-10-22
/// (eth.llamarpc.com answered 525 and rpc.ankr.com/eth now requires a key, so
/// neither is used). Override with a comma-separated `ETH_RPC_URLS` env var
/// (e.g. to add a keyed provider); configure at least two.
pub const DEFAULT_ETH_RPCS: &[&str] = &[
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
];

/// Fresh RPC readings that must agree within `max_divergence_bps` before a
/// NAV is published. One answering RPC is never enough.
pub const MIN_AGREEING_RPCS: usize = 2;

const DEFAULT_POLL_MS: u64 = 60_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ATTEMPTS: u32 = 2;
const RETRY_BACKOFF: Duration = Duration::from_millis(750);

/// Plausibility band for the yield-bearing USD wrappers read here. Both
/// started at 1.0 and accrue slowly; outside this band is a wrong contract,
/// selector, or decimals, never a real NAV.
const MIN_NAV: Decimal = Decimal::from_parts(9, 0, 0, false, 1); // 0.9
const MAX_NAV: Decimal = Decimal::from_parts(3, 0, 0, false, 0); // 3

/// One configured view-call NAV.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmTarget {
    pub symbol: String,
    pub contract: String,
    pub calldata: String,
    pub decimals: u32,
    pub max_divergence_bps: u32,
    pub max_block_age_secs: i64,
}

/// What one RPC returned for one block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcReading {
    pub block_number: u64,
    pub block_timestamp: i64,
    /// Per target, in target order. `Err` text when that call failed.
    pub values: Vec<std::result::Result<Decimal, String>>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    id: u64,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

fn targets(state: &AppState) -> Vec<EvmTarget> {
    state
        .assets
        .assets
        .iter()
        .filter(|a| a.active)
        .filter_map(|a| match &a.intrinsic {
            IntrinsicStrategy::EvmViewNav {
                contract,
                calldata,
                decimals,
                max_divergence_bps,
                max_block_age_secs,
            } => Some(EvmTarget {
                symbol: a.symbol.clone(),
                contract: contract.clone(),
                calldata: calldata.clone(),
                decimals: *decimals,
                max_divergence_bps: *max_divergence_bps,
                max_block_age_secs: *max_block_age_secs,
            }),
            _ => None,
        })
        .collect()
}

/// Resolve the RPC list: `ETH_RPC_URLS` (comma-separated) or the defaults.
pub fn rpc_urls(env: Option<&str>) -> Vec<String> {
    let from_env: Vec<String> = env
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if from_env.is_empty() {
        DEFAULT_ETH_RPCS.iter().map(|s| s.to_string()).collect()
    } else {
        from_env
    }
}

/// Parse a hex quantity (`0x1a`) into u64.
pub fn parse_hex_u64(s: &str) -> Result<u64> {
    let h = s.strip_prefix("0x").context("hex quantity missing 0x")?;
    anyhow::ensure!(
        !h.is_empty() && h.len() <= 16,
        "hex quantity length {}",
        h.len()
    );
    u64::from_str_radix(h, 16).context("invalid hex quantity")
}

/// Decode an ABI `uint256` return value and scale it by `10^decimals`.
///
/// The value must fit in 96 bits (Decimal's mantissa); a NAV of a few units at
/// 18 decimals is ~2^61, so anything larger is a wrong call, rejected.
pub fn decode_uint256_scaled(hex: &str, decimals: u32) -> Result<Decimal> {
    let h = hex
        .strip_prefix("0x")
        .context("eth_call result missing 0x")?;
    anyhow::ensure!(
        h.len() == 64,
        "eth_call result is {} hex chars, expected 64 (one uint256)",
        h.len()
    );
    anyhow::ensure!(decimals <= 28, "decimals {decimals} > 28");
    let (high, low) = h.split_at(64 - 24);
    anyhow::ensure!(
        high.bytes().all(|c| c == b'0'),
        "uint256 result exceeds 96 bits"
    );
    let raw = u128::from_str_radix(low, 16).context("invalid uint256 hex")?;
    let mantissa = i128::try_from(raw).context("uint256 exceeds i128")?;
    Decimal::try_from_i128_with_scale(mantissa, decimals).context("uint256 does not fit Decimal")
}

/// Parse a JSON-RPC batch response for `[eth_getBlockByNumber]`.
pub fn parse_block(body: &serde_json::Value) -> Result<(u64, i64)> {
    let resp: Vec<JsonRpcResponse> = match body {
        serde_json::Value::Array(_) => serde_json::from_value(body.clone())?,
        _ => vec![serde_json::from_value(body.clone())?],
    };
    let r = resp.first().context("empty block response")?;
    if let Some(e) = &r.error {
        anyhow::bail!("eth_getBlockByNumber error: {e}");
    }
    let block = r.result.as_ref().context("block result missing")?;
    let number = parse_hex_u64(block["number"].as_str().context("block.number")?)?;
    let ts = parse_hex_u64(block["timestamp"].as_str().context("block.timestamp")?)?;
    Ok((number, i64::try_from(ts)?))
}

/// Parse a JSON-RPC batch of `eth_call` responses (ids `1..=n`, any order).
pub fn parse_calls(
    body: &serde_json::Value,
    targets: &[EvmTarget],
) -> Result<Vec<std::result::Result<Decimal, String>>> {
    let resp: Vec<JsonRpcResponse> =
        serde_json::from_value(body.clone()).context("eth_call batch is not an array")?;
    let mut out = Vec::with_capacity(targets.len());
    for (i, t) in targets.iter().enumerate() {
        let id = i as u64 + 1;
        let v = match resp.iter().find(|r| r.id == id) {
            None => Err(format!("no response for id {id}")),
            Some(r) => match (&r.result, &r.error) {
                (_, Some(e)) => Err(format!("eth_call error: {e}")),
                (Some(serde_json::Value::String(hex)), None) => {
                    decode_uint256_scaled(hex, t.decimals).map_err(|e| e.to_string())
                }
                _ => Err("eth_call result missing".to_string()),
            },
        };
        out.push(v);
    }
    Ok(out)
}

/// Outcome of reconciling the per-RPC readings for one target.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// Publish this value. `agreeing_rpcs` = how many fresh RPCs backed it.
    Publish {
        value: Decimal,
        agreeing_rpcs: usize,
        divergence_bps: Option<Decimal>,
        block_number: u64,
        block_timestamp: i64,
    },
    Reject(String),
}

/// Pure reconciliation: freshness gate, plausibility band, cross-RPC agreement.
///
/// `readings[k]` is RPC k's reading (or `None` if that RPC failed entirely).
pub fn reconcile(
    target_idx: usize,
    target: &EvmTarget,
    readings: &[Option<RpcReading>],
    now_unix: i64,
) -> Verdict {
    let mut fresh: Vec<(Decimal, u64, i64)> = Vec::new();
    let mut reasons: Vec<String> = Vec::new();
    for (k, r) in readings.iter().enumerate() {
        let Some(r) = r else {
            reasons.push(format!("rpc{k}: unavailable"));
            continue;
        };
        let age = now_unix.saturating_sub(r.block_timestamp);
        if age > target.max_block_age_secs {
            reasons.push(format!(
                "rpc{k}: block {} is {age}s old (> {}s)",
                r.block_number, target.max_block_age_secs
            ));
            continue;
        }
        match r.values.get(target_idx) {
            Some(Ok(v)) if *v >= MIN_NAV && *v <= MAX_NAV => {
                fresh.push((*v, r.block_number, r.block_timestamp))
            }
            Some(Ok(v)) => {
                reasons.push(format!("rpc{k}: value {v} outside [{MIN_NAV}, {MAX_NAV}]"))
            }
            Some(Err(e)) => reasons.push(format!("rpc{k}: {e}")),
            None => reasons.push(format!("rpc{k}: no value")),
        }
    }
    if fresh.is_empty() {
        return Verdict::Reject(format!("no fresh reading: {}", reasons.join("; ")));
    }
    // Largest set of fresh readings that agree within the divergence bound
    // (sliding window over the sorted values), so one outlier RPC is ignored
    // rather than vetoing two that agree.
    fresh.sort_by(|a, b| a.0.cmp(&b.0));
    let max_div = Decimal::from(target.max_divergence_bps);
    let mut best: &[(Decimal, u64, i64)] = &fresh[..1];
    let mut best_div = Decimal::ZERO;
    for i in 0..fresh.len() {
        for j in (i + 1)..fresh.len() {
            let Some(div) = nav_publish::divergence_bps(fresh[i].0, fresh[j].0) else {
                break;
            };
            if div > max_div {
                break;
            }
            if j + 1 - i > best.len() {
                best = &fresh[i..=j];
                best_div = div;
            }
        }
    }
    if best.len() < MIN_AGREEING_RPCS {
        let lo = fresh.first().map(|x| x.0).unwrap_or_default();
        let hi = fresh.last().map(|x| x.0).unwrap_or_default();
        return Verdict::Reject(if fresh.len() < MIN_AGREEING_RPCS {
            format!(
                "only {} fresh RPC reading(s), need {MIN_AGREEING_RPCS} agreeing: {}",
                fresh.len(),
                reasons.join("; ")
            )
        } else {
            format!(
                "RPCs diverge by more than {} bps, no {MIN_AGREEING_RPCS} agree: low {lo}, high {hi}",
                target.max_divergence_bps
            )
        });
    }
    // Agreeing readings: publish the one from the newest block.
    let (v, n, ts) = best.iter().max_by_key(|x| x.1).copied().unwrap_or(best[0]);
    Verdict::Publish {
        value: v,
        agreeing_rpcs: best.len(),
        divergence_bps: Some(best_div),
        block_number: n,
        block_timestamp: ts,
    }
}

async fn post_json(
    http: &reqwest::Client,
    url: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value> {
    let mut last_err = None;
    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            sleep(RETRY_BACKOFF).await;
        }
        let res = http
            .post(url)
            .timeout(REQUEST_TIMEOUT)
            .json(body)
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {
                match nav_publish::read_json_capped(r, nav_publish::MAX_BODY_BYTES).await {
                    Ok(v) => return Ok(v),
                    Err(e) => last_err = Some(e),
                }
            }
            Ok(r) => last_err = Some(anyhow::anyhow!("http {}", r.status())),
            Err(e) => last_err = Some(anyhow::anyhow!("request: {}", e.without_url())),
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("no attempt made")))
}

/// Build the pinned `eth_call` batch for one block.
pub fn calls_body(targets: &[EvmTarget], block_number: u64) -> serde_json::Value {
    let block = format!("0x{block_number:x}");
    serde_json::Value::Array(
        targets
            .iter()
            .enumerate()
            .map(|(i, t)| {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": i + 1,
                    "method": "eth_call",
                    "params": [{ "to": t.contract, "data": t.calldata }, block],
                })
            })
            .collect(),
    )
}

async fn read_rpc(http: &reqwest::Client, url: &str, targets: &[EvmTarget]) -> Result<RpcReading> {
    let block_req = serde_json::json!([{
        "jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": ["latest", false]
    }]);
    let (block_number, block_timestamp) = parse_block(&post_json(http, url, &block_req).await?)?;
    let calls = post_json(http, url, &calls_body(targets, block_number)).await?;
    Ok(RpcReading {
        block_number,
        block_timestamp,
        values: parse_calls(&calls, targets)?,
    })
}

/// Host part of an RPC URL, for logs/meta (never the path or query, which may
/// carry a key when `ETH_RPC_URLS` points at a keyed provider).
fn rpc_host(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| "invalid-url".to_string())
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let targets = targets(&state);
    if targets.is_empty() {
        info!("no active evm_view_nav assets: evm_nav source idle");
        return Ok(());
    }
    let rpcs = rpc_urls(std::env::var("ETH_RPC_URLS").ok().as_deref());
    let cadence_ms = std::env::var("EVM_NAV_POLL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_POLL_MS);
    let mut tick = interval(Duration::from_millis(super::min_poll_ms(cadence_ms)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let http = nav_publish::bounded_http_client()?;
    info!(
        cadence_ms,
        assets = targets.len(),
        rpcs = ?rpcs.iter().map(|u| rpc_host(u)).collect::<Vec<_>>(),
        "evm_nav source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("evm_nav source shutdown");
                return Ok(());
            }
        }
        poll_once(&state, &http, &rpcs, &targets).await;
    }
}

async fn poll_once(
    state: &AppState,
    http: &reqwest::Client,
    rpcs: &[String],
    targets: &[EvmTarget],
) {
    let reads = futures::future::join_all(rpcs.iter().map(|u| read_rpc(http, u, targets))).await;
    let readings: Vec<Option<RpcReading>> = reads
        .into_iter()
        .zip(rpcs)
        .map(|(r, url)| match r {
            Ok(r) => Some(r),
            Err(e) => {
                warn!(rpc = %rpc_host(url), error = %e, "evm_nav RPC read failed");
                metrics::counter!("pegana_evm_nav_rpc_errors_total", "rpc" => rpc_host(url))
                    .increment(1);
                None
            }
        })
        .collect();

    let now = chrono::Utc::now();
    for (i, t) in targets.iter().enumerate() {
        match reconcile(i, t, &readings, now.timestamp()) {
            Verdict::Reject(reason) => {
                warn!(asset = %t.symbol, %reason, "evm_nav reading rejected: not published");
                metrics::counter!("pegana_evm_nav_polls_total", "asset" => t.symbol.clone(), "status" => "rejected")
                    .increment(1);
            }
            Verdict::Publish {
                value,
                agreeing_rpcs,
                divergence_bps,
                block_number,
                block_timestamp,
            } => {
                metrics::gauge!("pegana_evm_nav_value", "asset" => t.symbol.clone())
                    .set(pegana_common::decimal_to_f64(value));
                let meta = serde_json::json!({
                    "chain": "ethereum",
                    "contract": t.contract,
                    "calldata": t.calldata,
                    "decimals": t.decimals,
                    "block_number": block_number,
                    "block_timestamp": block_timestamp,
                    "agreeing_rpcs": agreeing_rpcs,
                    "rpcs_configured": rpcs.len(),
                    "rpc_divergence_bps": divergence_bps.map(|d| d.round_dp(4)),
                });
                let status = match nav_publish::publish_intrinsic(
                    state,
                    &t.symbol,
                    value,
                    "ethereum_view",
                    meta,
                    None,
                    now,
                )
                .await
                {
                    Ok(()) => "ok",
                    Err(e) => {
                        warn!(asset = %t.symbol, error = %e, "evm_nav publish failed");
                        "error"
                    }
                };
                metrics::counter!("pegana_evm_nav_polls_total", "asset" => t.symbol.clone(), "status" => status)
                    .increment(1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    fn usdy() -> EvmTarget {
        EvmTarget {
            symbol: "USDY".into(),
            contract: "0xA0219AA5B31e65Bc920B5b6DFb8EdF0988121De0".into(),
            calldata: "0x98d5fdca".into(),
            decimals: 18,
            max_divergence_bps: 10,
            max_block_age_secs: 180,
        }
    }

    fn susde() -> EvmTarget {
        EvmTarget {
            symbol: "sUSDe".into(),
            contract: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497".into(),
            calldata: "0x07a2d13a0000000000000000000000000000000000000000000000000de0b6b3a7640000"
                .into(),
            decimals: 18,
            max_divergence_bps: 10,
            max_block_age_secs: 180,
        }
    }

    /// Recorded live 2026-10-21 from ethereum-rpc.publicnode.com, block 26244464.
    fn recorded_block() -> serde_json::Value {
        serde_json::json!([{"jsonrpc":"2.0","id":1,"result":{
            "number":"0x1907570","timestamp":"0x6ad953df","hash":"0xabc"}}])
    }

    fn recorded_calls() -> serde_json::Value {
        serde_json::json!([
            {"jsonrpc":"2.0","id":2,"result":"0x0000000000000000000000000000000000000000000000001167cffb22a541fd"},
            {"jsonrpc":"2.0","id":1,"result":"0x0000000000000000000000000000000000000000000000000ff7757d1af3d400"}
        ])
    }

    #[test]
    fn decodes_recorded_eth_call_results() {
        let (n, ts) = parse_block(&recorded_block()).unwrap();
        assert_eq!(n, 26_244_464);
        assert_eq!(ts, 1_792_627_679);
        let vals = parse_calls(&recorded_calls(), &[usdy(), susde()]).unwrap();
        assert_eq!(vals[0], Ok(d("1.15051741")));
        assert_eq!(vals[1].as_ref().unwrap().round_dp(6), d("1.254200"));
    }

    #[test]
    fn rejects_malformed_uint256() {
        assert!(decode_uint256_scaled("0x1234", 18).is_err());
        assert!(decode_uint256_scaled("1167cffb22a541fd", 18).is_err());
        // > 96 bits
        let big = format!("0x{}", "f".repeat(64));
        assert!(decode_uint256_scaled(&big, 18)
            .unwrap_err()
            .to_string()
            .contains("96 bits"));
        let not_hex = format!("0x{}zz", "0".repeat(62));
        assert!(decode_uint256_scaled(&not_hex, 18).is_err());
    }

    #[test]
    fn rpc_error_object_is_per_call() {
        let body = serde_json::json!([
            {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"execution reverted"}},
            {"jsonrpc":"2.0","id":2,"result":"0x0000000000000000000000000000000000000000000000001167cffb22a541fd"}
        ]);
        let vals = parse_calls(&body, &[usdy(), susde()]).unwrap();
        assert!(vals[0].as_ref().unwrap_err().contains("reverted"));
        assert!(vals[1].is_ok());
    }

    fn reading(n: u64, ts: i64, v: &str) -> Option<RpcReading> {
        Some(RpcReading {
            block_number: n,
            block_timestamp: ts,
            values: vec![Ok(d(v))],
        })
    }

    #[test]
    fn two_agreeing_rpcs_publish_newest_block() {
        let now = 1_000_000;
        let v = reconcile(
            0,
            &usdy(),
            &[
                reading(10, now - 12, "1.1505"),
                reading(11, now - 1, "1.15051"),
            ],
            now,
        );
        match v {
            Verdict::Publish {
                value,
                agreeing_rpcs,
                block_number,
                ..
            } => {
                assert_eq!(value, d("1.15051"));
                assert_eq!(agreeing_rpcs, 2);
                assert_eq!(block_number, 11);
            }
            other => panic!("expected publish, got {other:?}"),
        }
    }

    #[test]
    fn divergent_rpcs_are_rejected() {
        let now = 1_000_000;
        // 1.1505 vs 1.1540 ~ 30 bps > 10 bps.
        let v = reconcile(
            0,
            &usdy(),
            &[reading(10, now, "1.1505"), reading(10, now, "1.1540")],
            now,
        );
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("diverge")),
            "{v:?}"
        );
    }

    #[test]
    fn stale_block_is_rejected_and_falls_back_to_fresh_rpc() {
        let now = 1_000_000;
        let t = usdy();
        let stale = reading(9, now - t.max_block_age_secs - 1, "1.20");
        // Only the stale one → reject.
        let v = reconcile(0, &t, std::slice::from_ref(&stale), now);
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("old")),
            "{v:?}"
        );
        // Stale + fresh: the stale one is ignored, and one fresh RPC alone is
        // below quorum, so nothing is published.
        let v = reconcile(0, &t, &[stale.clone(), reading(12, now - 3, "1.1505")], now);
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("need 2")),
            "{v:?}"
        );
        // Stale + two fresh agreeing: publishes from the pair.
        let v = reconcile(
            0,
            &t,
            &[
                stale,
                reading(12, now - 3, "1.1505"),
                reading(13, now - 1, "1.1506"),
            ],
            now,
        );
        assert!(
            matches!(
                v,
                Verdict::Publish {
                    agreeing_rpcs: 2,
                    block_number: 13,
                    ..
                }
            ),
            "{v:?}"
        );
    }

    /// P2-2: 2-of-3 quorum. One outlier among three is ignored; a single fresh
    /// reading, or three mutually divergent ones, publish nothing.
    #[test]
    fn quorum_needs_two_agreeing_rpcs() {
        let now = 1_000_000;
        let t = usdy();
        // Two agree, one is 30 bps off: publish from the agreeing pair.
        let v = reconcile(
            0,
            &t,
            &[
                reading(10, now, "1.1505"),
                reading(11, now, "1.1540"),
                reading(12, now, "1.1506"),
            ],
            now,
        );
        match v {
            Verdict::Publish {
                value,
                agreeing_rpcs,
                block_number,
                ..
            } => {
                assert_eq!(agreeing_rpcs, 2);
                assert_eq!(block_number, 12, "newest block in the agreeing pair");
                assert_eq!(value, d("1.1506"));
            }
            other => panic!("expected publish, got {other:?}"),
        }
        // Three agreeing: all three count.
        let v = reconcile(
            0,
            &t,
            &[
                reading(10, now, "1.1505"),
                reading(11, now, "1.1505"),
                reading(12, now, "1.1505"),
            ],
            now,
        );
        assert!(
            matches!(
                v,
                Verdict::Publish {
                    agreeing_rpcs: 3,
                    ..
                }
            ),
            "{v:?}"
        );
        // One fresh reading, two RPCs down: refused.
        let v = reconcile(0, &t, &[reading(10, now, "1.1505"), None, None], now);
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("need 2")),
            "{v:?}"
        );
        // Three mutually divergent readings: refused.
        let v = reconcile(
            0,
            &t,
            &[
                reading(10, now, "1.1400"),
                reading(11, now, "1.1505"),
                reading(12, now, "1.1600"),
            ],
            now,
        );
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("diverge")),
            "{v:?}"
        );
    }

    #[test]
    fn implausible_value_and_dead_rpcs_are_rejected() {
        let now = 1_000_000;
        let v = reconcile(0, &usdy(), &[reading(1, now, "0.5")], now);
        assert!(
            matches!(v, Verdict::Reject(ref r) if r.contains("outside")),
            "{v:?}"
        );
        let v = reconcile(0, &usdy(), &[None, None], now);
        assert!(matches!(v, Verdict::Reject(_)));
    }

    #[test]
    fn calls_are_pinned_to_the_block() {
        let body = calls_body(&[usdy(), susde()], 26_244_464);
        assert_eq!(body[0]["params"][1], "0x1907570");
        assert_eq!(body[1]["id"], 2);
        assert_eq!(body[1]["params"][0]["data"], susde().calldata);
    }

    /// Live smoke (network): `cargo test -p indexer-rs -- --ignored live_smoke`.
    #[tokio::test]
    #[ignore]
    async fn live_smoke_eth_view_navs() {
        let http = crate::sources::nav_publish::bounded_http_client().unwrap();
        let targets = [usdy(), susde()];
        let mut readings = Vec::new();
        for url in DEFAULT_ETH_RPCS {
            let r = read_rpc(&http, url, &targets).await;
            println!("LIVE ETH rpc={} -> {r:?}", rpc_host(url));
            readings.push(r.ok());
        }
        let now = chrono::Utc::now().timestamp();
        for (i, t) in targets.iter().enumerate() {
            let v = reconcile(i, t, &readings, now);
            println!("LIVE ETH {} verdict={v:?}", t.symbol);
            assert!(matches!(v, Verdict::Publish { .. }), "{v:?}");
        }
    }

    #[test]
    fn rpc_list_env_override() {
        assert_eq!(rpc_urls(None).len(), 3);
        assert_eq!(rpc_urls(Some(" ")).len(), 3);
        assert_eq!(
            rpc_urls(Some("https://a.io, https://b.io,")),
            vec!["https://a.io", "https://b.io"]
        );
        assert_eq!(rpc_host("https://x.io/v2/secret?key=1"), "x.io");
    }
}
