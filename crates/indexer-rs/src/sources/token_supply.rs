//! Circulating-supply / market-cap size-context source.
//!
//! For each ACTIVE asset, reads the SPL Mint account (`supply` field, u64 LE
//! at offset 36 of the standard SPL Mint layout — see `decode_mint_supply`)
//! and writes `circulating_supply` (supply scaled by decimals) to `assets`.
//! The API layer (`crates/api-rs/src/routes/assets.rs`) then derives
//! `market_cap = circulating_supply × market_usd`.
//!
//! ISOLATION (by design, see the module-level requirements this was built
//! against): this is a SIZE/CONTEXT signal, NOT a peg-safety signal.
//!   - It is a completely separate spawned task (see `main.rs`) that shares
//!     no in-memory state (no Pyth cache, no Sanctum cache) with the NAV /
//!     discount source tasks.
//!   - It writes ONLY `assets.circulating_supply` + `assets.supply_updated_at`
//!     (migration 0065) — it never touches `intrinsic_snapshots`,
//!     `discount_snapshots`, thresholds, or any other calibrated value, and
//!     never publishes to the Redis channels the engine's discount pipeline
//!     consumes.
//!   - Every failure (bad Pubkey in config, missing account, undersized /
//!     unparsable mint data) is logged and SKIPPED for that one mint — this
//!     source must never `panic!` or let a single bad mint abort the task
//!     (which would otherwise cascade into the indexer's task-exit handling
//!     in `main.rs`).
//!
//! Cadence: mint `supply` only moves on mint/burn/epoch-unstake events, which
//! are rare relative to price/NAV ticks — so this polls far slower (~10 min
//! default) than the NAV/discount sources (15–30s).

use crate::sinks;
use crate::state::AppState;
use anyhow::Result;
use rust_decimal::Decimal;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{account::Account, commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// SPL Mint account layout (both legacy `Token` and `Token-2022` mints share
/// this base layout — Token-2022 extensions, when present, are TLV data
/// appended AFTER these first 82 bytes, so the offsets below are stable for
/// both token programs):
///
///   off  0 [36] mint_authority (COption<Pubkey>: 4-byte tag + 32-byte key)
///   off 36 [ 8] supply      (u64 LE)  <- what we read
///   off 44 [ 1] decimals    (u8)      <- cross-checked against assets.toml
///   off 45 [ 1] is_initialized (bool)
///   off 46 [36] freeze_authority (COption<Pubkey>)
const SUPPLY_OFFSET: usize = 36;
const DECIMALS_OFFSET: usize = 44;
/// Base Mint account size (legacy SPL Token mints are exactly this size;
/// Token-2022 mints are this size PLUS extension TLV data, so `>=` is the
/// correct bound, never `==`).
const MIN_MINT_LEN: usize = 82;

/// Decode `(supply, decimals)` from a raw SPL Mint account's bytes.
/// Bounds-checked — never panics/indexes out of range.
pub fn decode_mint_supply(data: &[u8]) -> Result<(u64, u8)> {
    anyhow::ensure!(
        data.len() >= MIN_MINT_LEN,
        "mint account too short: {} bytes (need >= {MIN_MINT_LEN})",
        data.len()
    );
    let supply = read_u64_le(data, SUPPLY_OFFSET)?;
    let decimals = data[DECIMALS_OFFSET];
    Ok((supply, decimals))
}

/// Bounds-checked little-endian u64 read (mirrors
/// `spl_stake_pool::read_u64_le` / `piggybank_pb::read_u64_le`).
fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| anyhow::anyhow!("read_u64_le offset overflow: {offset}"))?;
    let bytes = data.get(offset..end).ok_or_else(|| {
        anyhow::anyhow!("read_u64_le out of bounds at {offset}, len {}", data.len())
    })?;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

/// Compute `circulating_supply = supply / 10^decimals` exactly (no floating
/// point / division rounding) by constructing the `Decimal` directly from the
/// raw mantissa + scale.
///
/// Returns `None` when `decimals` exceeds `Decimal`'s maximum scale (28)
/// instead of panicking on a bad config value.
pub fn circulating_supply(supply: u64, decimals: u8) -> Option<Decimal> {
    Decimal::try_from_i128_with_scale(supply as i128, decimals as u32).ok()
}

struct MintCfg {
    symbol: String,
    mint: Pubkey,
    /// Configured decimals from `assets.toml` (== the `assets.decimals` DB
    /// column). Used for the scaling calc; cross-checked (warn-only) against
    /// the on-chain mint's own decimals byte in `handle_one`.
    decimals: u8,
}

/// Collect one `MintCfg` per active asset. A malformed mint string in
/// `assets.toml` is logged + skipped, NEVER propagated — a single bad config
/// entry must not take down the whole source (bulletproof-error-handling
/// requirement).
fn collect_mints(state: &AppState) -> Vec<MintCfg> {
    let mut out = Vec::new();
    for a in &state.assets.assets {
        if !a.active {
            continue;
        }
        match Pubkey::from_str(&a.mint) {
            Ok(mint) => out.push(MintCfg {
                symbol: a.symbol.clone(),
                mint,
                decimals: a.decimals,
            }),
            Err(e) => {
                warn!(
                    symbol = %a.symbol,
                    mint = %a.mint,
                    error = %e,
                    "token_supply: bad mint pubkey in assets.toml — skipping asset"
                );
            }
        }
    }
    out
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_token_supply {
        info!("FEATURE_TOKEN_SUPPLY=false — token_supply source disabled");
        return Ok(());
    }
    let mints = collect_mints(&state);
    if mints.is_empty() {
        info!("no active assets with a valid mint — token_supply source idle");
        return Ok(());
    }

    // Slow cadence by design — mint supply changes rarely relative to
    // price/NAV. Default 10 minutes, independent of every NAV/discount
    // source's cadence.
    let cadence_ms = state.config.token_supply_poll_ms.unwrap_or(600_000);
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
        mint_count = mints.len(),
        "token_supply source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("token_supply source shutdown");
                return Ok(());
            }
        }

        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &mints).await {
            warn!(error = %e, "token_supply poll failed");
            metrics::counter!("pegana_token_supply_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_token_supply_polls_total", "status" => "ok").increment(1);
        }
    }
}

/// One batched `getMultipleAccounts` call for all configured mints, then a
/// per-mint decode+persist. A single mint's decode/persist failure is logged
/// and skipped (`handle_one`'s `Err` is caught here) — it never aborts the
/// rest of the batch. Only a total RPC failure (both primary AND fallback
/// erroring) propagates an `Err` out of `poll_once`, and even that is just
/// logged by `run`'s loop above (the next tick tries again) — never a panic,
/// never an indexer-wide abort.
async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    mints: &[MintCfg],
) -> Result<()> {
    let started = std::time::Instant::now();
    let pubkeys: Vec<Pubkey> = mints.iter().map(|m| m.mint).collect();

    let (accounts, _slot) = crate::rpc::get_multiple_accounts_with_fallback(
        rpc,
        rpc_fallback,
        &pubkeys,
        "token_supply",
    )
    .await?;

    for (cfg, account_opt) in mints.iter().zip(accounts.into_iter()) {
        match account_opt {
            None => {
                warn!(
                    symbol = %cfg.symbol,
                    mint = %cfg.mint,
                    "token_supply: mint account missing from RPC response — skipping"
                );
            }
            Some(account) => {
                if let Err(e) = handle_one(state, cfg, &account).await {
                    warn!(
                        symbol = %cfg.symbol,
                        mint = %cfg.mint,
                        error = %e,
                        "token_supply: failed to decode/persist supply — skipping"
                    );
                }
            }
        }
    }

    metrics::histogram!("pegana_token_supply_latency_seconds")
        .record(started.elapsed().as_secs_f64());
    Ok(())
}

async fn handle_one(state: &AppState, cfg: &MintCfg, account: &Account) -> Result<()> {
    let (supply, decimals_onchain) = decode_mint_supply(&account.data)?;

    if decimals_onchain != cfg.decimals {
        // Advisory only — proceed with the configured decimals (the value
        // the rest of the system, including the `assets.decimals` DB column
        // and every other USD/NAV scaling calc, already treats as
        // authoritative) so this source's output stays internally
        // consistent. Never a fatal condition.
        warn!(
            symbol = %cfg.symbol,
            configured_decimals = cfg.decimals,
            onchain_decimals = decimals_onchain,
            "token_supply: decimals mismatch between assets.toml and on-chain mint — using configured value"
        );
    }

    let Some(supply_scaled) = circulating_supply(supply, cfg.decimals) else {
        anyhow::bail!(
            "token_supply: {} configured decimals {} exceed Decimal scale limit",
            cfg.symbol,
            cfg.decimals
        );
    };

    sinks::postgres::update_circulating_supply(&state.pg, &cfg.mint.to_string(), supply_scaled)
        .await?;

    metrics::gauge!("pegana_token_circulating_supply", "symbol" => cfg.symbol.clone())
        .set(pegana_common::decimal_to_f64(supply_scaled));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a synthetic, well-formed 82-byte SPL Mint account (the base
    /// layout shared by legacy SPL Token and Token-2022 mints, before any
    /// Token-2022 extension TLV data). `mint_authority`/`freeze_authority`
    /// are left as `COption::None` (all-zero tag) since `decode_mint_supply`
    /// doesn't read them.
    fn build_mint_account(supply: u64, decimals: u8) -> Vec<u8> {
        let mut data = vec![0u8; MIN_MINT_LEN];
        data[SUPPLY_OFFSET..SUPPLY_OFFSET + 8].copy_from_slice(&supply.to_le_bytes());
        data[DECIMALS_OFFSET] = decimals;
        data[45] = 1; // is_initialized = true
        data
    }

    /// Known 82-byte SPL Mint fixture: 5,000,000 whole tokens at 6 decimals
    /// (matches USDC's decimals) — asserts both the raw decode AND the
    /// scaled `circulating_supply` calc land on the expected values.
    #[test]
    fn decodes_known_supply_and_computes_circulating_supply() {
        let raw_supply = 5_000_000_000_000u64; // 5,000,000 * 10^6
        let data = build_mint_account(raw_supply, 6);

        let (supply, decimals) = decode_mint_supply(&data).expect("decode succeeds");
        assert_eq!(supply, raw_supply);
        assert_eq!(decimals, 6);

        let circ = circulating_supply(supply, decimals).expect("scale ok");
        assert_eq!(circ, Decimal::new(5_000_000, 0), "5,000,000 whole tokens");
    }

    /// A 9-decimals mint (typical for LSTs/SOL-denominated tokens) with a
    /// supply that isn't a round number, to catch scale-factor-off-by-one
    /// bugs a round-number test could hide.
    #[test]
    fn decodes_nine_decimal_mint_with_fractional_supply() {
        let raw_supply = 1_234_567_891_234_567u64; // 1,234,567.891234567 tokens
        let data = build_mint_account(raw_supply, 9);

        let (supply, decimals) = decode_mint_supply(&data).expect("decode succeeds");
        assert_eq!(decimals, 9);

        let circ = circulating_supply(supply, decimals).expect("scale ok");
        assert_eq!(circ, Decimal::new(1_234_567_891_234_567, 9));
        assert_eq!(circ.to_string(), "1234567.891234567");
    }

    #[test]
    fn circulating_supply_rejects_oversized_decimals() {
        assert!(circulating_supply(1, 28).is_some());
        assert!(circulating_supply(1, 29).is_none());
        assert!(circulating_supply(1, 255).is_none());
    }

    #[test]
    fn rejects_undersized_account() {
        let err = decode_mint_supply(&[0u8; 50]).unwrap_err();
        assert!(
            err.to_string().contains("too short"),
            "expected a too-short error, got: {err}"
        );
    }

    /// A Token-2022 mint with trailing extension TLV bytes must still decode
    /// correctly — the base fields (including `supply` at offset 36) always
    /// precede any extension data, so `>=` MIN_MINT_LEN (not `==`) is the
    /// correct bound.
    #[test]
    fn decodes_mint_with_trailing_extension_bytes() {
        let mut data = build_mint_account(42_000_000u64, 2);
        data.extend_from_slice(&[0xAB; 40]); // simulated extension TLV tail
        let (supply, decimals) = decode_mint_supply(&data).expect("decode succeeds");
        assert_eq!(supply, 42_000_000);
        assert_eq!(decimals, 2);
    }

    /// `collect_mints`/`handle_one` are exercised at the integration level
    /// (real RPC + real DB), out of scope for a unit test — this is a
    /// compile-level smoke test proving the async entry points are wired
    /// with the expected signatures, mirroring `rpc::tests::module_compiles`.
    #[test]
    fn module_compiles() {
        let _ = super::run as fn(AppState, CancellationToken) -> _;
        let _ = super::decode_mint_supply as fn(&[u8]) -> _;
        let _ = super::circulating_supply as fn(u64, u8) -> Option<Decimal>;
    }
}
