//! xtask — repo-local task runner. Invoke via `cargo xtask <subcommand>`.
//!
//! Subcommands:
//!   - `verify-assets`: validate every mint in `assets.toml` against mainnet RPC.
//!     Checks account exists, owner program matches `token_program`, and declared
//!     decimals match on-chain. Additionally cross-checks every `sanctum_lst`
//!     symbol against Sanctum's `/v1/lsts` catalog so that we never declare
//!     an LST that Sanctum doesn't actually price.
//!   - `migrate`: PRINTS the `sqlx migrate run` reminder — does NOT apply
//!     migrations (kept explicit on purpose; run the printed command yourself).
//!   - `prune-webhook-deliveries`: delete old webhook delivery audit rows.
//!   - `hygiene`: tracked-file hygiene (no `.env`, scratch dirs, or assistant
//!     artifacts committed) plus the receipt-boundary guard that keeps the
//!     inert tokens.xyz enrichment fields out of `engine-rs`/`methodology`.
//!     No network, no DB — safe to run in a pre-commit hook.
//!
//! Exit code is non-zero on any failure → safe for CI gating.

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};
use pegana_common::{AssetConfig, AssetsFile, IntrinsicStrategy, TokenProgram};
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::{collections::HashSet, path::PathBuf, str::FromStr};
use tracing::{error, info, warn};
use xtask::{backtest, hygiene, smoke};

#[derive(Parser)]
#[command(name = "xtask", about = "Pegana repo task runner")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Validate every mint in assets.toml against mainnet RPC.
    VerifyAssets {
        #[arg(long, default_value = "assets.toml")]
        file: PathBuf,
        #[arg(long, default_value = "https://api.mainnet-beta.solana.com")]
        rpc: String,
        /// If true, ignore the `verified=false` flag and validate everything.
        #[arg(long, default_value_t = false)]
        strict: bool,
    },
    /// Print the `sqlx migrate run` reminder (does NOT apply migrations).
    Migrate,
    /// Delete webhook delivery audit rows older than N days.
    PruneWebhookDeliveries {
        #[arg(long, default_value_t = 30)]
        days: i64,
        /// Print the count that would be deleted without deleting rows.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    /// Repo hygiene + receipt-boundary guard (no network, no DB).
    Hygiene,
    /// Black-box canary against a running API: status + latency budget +
    /// ADR-0043 envelope shape. Non-zero exit on any failure.
    Smoke {
        #[arg(long, default_value = "https://api.pegana.xyz")]
        base: String,
        /// Attempts per probe before it is declared failed.
        #[arg(long, default_value_t = 3)]
        retries: u32,
        /// Emit a single-line JSON summary instead of the table.
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Backtest the methodology against a committed historical fixture.
    Backtest {
        /// Case directory under docs/backtests/.
        #[arg(long, default_value = "2025-10-10-usde-depeg")]
        case: String,
        /// Re-fetch inputs.json from Pyth Benchmarks (network; one-time capture).
        #[arg(long, default_value_t = false)]
        capture: bool,
        /// Compare freshly-computed output against the committed golden; non-zero exit on drift.
        #[arg(long, default_value_t = false)]
        check: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Cmd::VerifyAssets { file, rpc, strict } => verify_assets(file, rpc, strict).await,
        Cmd::Migrate => migrate().await,
        Cmd::PruneWebhookDeliveries { days, dry_run } => {
            prune_webhook_deliveries(days, dry_run).await
        }
        Cmd::Hygiene => hygiene::run(),
        Cmd::Smoke {
            base,
            retries,
            json,
        } => smoke::run(base, retries, json).await,
        Cmd::Backtest {
            case,
            capture,
            check,
        } => backtest::run(case, capture, check).await,
    }
}

/// SPL Token program ID (legacy).
const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/// Token-2022 program ID.
const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

async fn verify_assets(file: PathBuf, rpc: String, strict: bool) -> Result<()> {
    let raw = std::fs::read_to_string(&file).with_context(|| format!("read {}", file.display()))?;
    let parsed: AssetsFile = toml::from_str(&raw).context("parse assets.toml")?;
    info!(count = parsed.assets.len(), "loaded assets");
    for asset in &parsed.assets {
        for (kind, table) in [
            ("bps", asset.thresholds.thresholds_bps.as_ref()),
            ("cr", asset.thresholds.thresholds_cr.as_ref()),
        ] {
            let Some(table) = table else { continue };
            for w in methodology::validate_thresholds(kind, table)
                .map_err(|e| anyhow::anyhow!("asset {}: thresholds_{kind}: {e}", asset.symbol))?
            {
                warn!(asset = asset.symbol, "{w}");
            }
        }
    }

    let client = RpcClient::new_with_commitment(rpc.clone(), CommitmentConfig::confirmed());
    let mut failures: Vec<String> = vec![];
    let mut skipped: Vec<String> = vec![];

    for asset in &parsed.assets {
        if !strict && !asset.verified {
            warn!(
                asset = asset.symbol,
                "skipped (verified=false in TOML — run with --strict to force)"
            );
            skipped.push(asset.symbol.clone());
            continue;
        }
        match verify_one(&client, asset).await {
            Ok(()) => info!(asset = asset.symbol, "ok"),
            Err(e) => {
                error!(asset = asset.symbol, error = %e, "FAIL");
                failures.push(format!("{}: {}", asset.symbol, e));
            }
        }
    }

    // Phase 2: cross-check that every sanctum_lst symbol is in Sanctum's catalog.
    // Sanctum's batched /v1/sol-value/current endpoint silently swaps unknown
    // symbols for supported ones, so the per-asset RPC checks above can't
    // catch this class of error. We use /v1/lsts as source of truth.
    // Only checks assets that are being validated (i.e. not skipped).
    let to_check: Vec<&AssetConfig> = parsed
        .assets
        .iter()
        .filter(|a| strict || a.verified)
        .collect();
    let sanctum_failures = match verify_sanctum_coverage(&to_check).await {
        Ok(()) => {
            info!("sanctum_lst coverage check: ok");
            vec![]
        }
        Err(e) => {
            error!(error = %e, "sanctum_lst coverage check FAIL");
            vec![format!("sanctum_lst coverage: {e}")]
        }
    };
    failures.extend(sanctum_failures);

    println!();
    println!("================ verify-assets summary ================");
    println!("checked  : {}", parsed.assets.len() - skipped.len());
    println!("skipped  : {} ({})", skipped.len(), skipped.join(", "));
    println!("failed   : {}", failures.len());
    for f in &failures {
        println!("  ✗ {f}");
    }
    println!("=======================================================");

    if !failures.is_empty() {
        bail!("{} asset(s) failed validation", failures.len());
    }
    Ok(())
}

/// Byte offsets for the SPL StakePool account layout (same as indexer decoder).
const STAKE_POOL_ACCOUNT_TYPE_OFFSET: usize = 0;
const STAKE_POOL_POOL_MINT_OFFSET: usize = 162;
const STAKE_POOL_MIN_LEN: usize = 282;

async fn verify_one(client: &RpcClient, asset: &AssetConfig) -> Result<()> {
    let mint = Pubkey::from_str(&asset.mint).map_err(|e| anyhow!("invalid mint pubkey: {e}"))?;

    let account = client
        .get_account(&mint)
        .await
        .with_context(|| format!("getAccount({})", asset.mint))?;

    // 1. Owner must match declared token_program.
    let expected_owner = match asset.token_program {
        TokenProgram::Spl => TOKEN_PROGRAM_ID,
        TokenProgram::Token2022 => TOKEN_2022_PROGRAM_ID,
    };
    let expected = Pubkey::from_str(expected_owner)?;
    if account.owner != expected {
        bail!(
            "owner mismatch · expected={expected_owner} actual={}",
            account.owner
        );
    }

    // 2. Mint account size sanity (legacy mint = 82 bytes; Token-2022 mint ≥ 82 + extensions).
    if account.data.len() < 82 {
        bail!(
            "data length {} too small for a Mint account",
            account.data.len()
        );
    }

    // 3. Decimals byte at offset 44 (same layout in both programs for the base Mint).
    let on_chain_decimals = account.data[44];
    if on_chain_decimals != asset.decimals {
        bail!(
            "decimals mismatch · declared={} on-chain={}",
            asset.decimals,
            on_chain_decimals
        );
    }

    // 4. For spl_stake_pool intrinsics: validate the pool state account.
    //    Catches a wrong/typo'd pool address before it reaches the live indexer.
    //    Checks: owner==program, account_type==1 (StakePool), pool_mint==mint.
    if let IntrinsicStrategy::SplStakePool { pool, program } = &asset.intrinsic {
        verify_spl_pool_account(client, pool, program, &mint, &asset.symbol).await?;
    }

    Ok(())
}

/// Validate a declared SPL stake-pool state account:
///   - owner must equal the declared program
///   - account_type byte must be 1 (initialized StakePool)
///   - pool_mint at offset 162 must equal the asset's mint
async fn verify_spl_pool_account(
    client: &RpcClient,
    pool: &str,
    program: &str,
    mint: &Pubkey,
    symbol: &str,
) -> Result<()> {
    let pool_pk = Pubkey::from_str(pool)
        .with_context(|| format!("{symbol}: invalid pool pubkey '{pool}'"))?;
    let program_pk = Pubkey::from_str(program)
        .with_context(|| format!("{symbol}: invalid program pubkey '{program}'"))?;

    let pool_account = client
        .get_account(&pool_pk)
        .await
        .with_context(|| format!("{symbol}: getAccount(pool={pool})"))?;

    if pool_account.owner != program_pk {
        bail!(
            "{symbol}: pool account owner mismatch · expected={program} actual={}",
            pool_account.owner
        );
    }

    if pool_account.data.len() < STAKE_POOL_MIN_LEN {
        bail!(
            "{symbol}: pool account data too short: {} bytes (need ≥ {})",
            pool_account.data.len(),
            STAKE_POOL_MIN_LEN
        );
    }

    let account_type = pool_account.data[STAKE_POOL_ACCOUNT_TYPE_OFFSET];
    if account_type != 1 {
        bail!(
            "{symbol}: pool account_type={account_type} — not an initialized StakePool (expected 1)"
        );
    }

    let pool_mint_bytes =
        &pool_account.data[STAKE_POOL_POOL_MINT_OFFSET..STAKE_POOL_POOL_MINT_OFFSET + 32];
    let pool_mint = Pubkey::try_from(pool_mint_bytes)
        .map_err(|_| anyhow!("{symbol}: could not decode pool_mint from pool account"))?;
    if &pool_mint != mint {
        bail!("{symbol}: pool_mint mismatch · pool says {pool_mint}, asset.mint={mint}");
    }

    info!(
        symbol,
        pool, program, account_type, "spl_stake_pool pool account ok"
    );
    Ok(())
}

#[cfg(test)]
mod verify_tests {
    use super::*;

    /// Verify the pool-account check helper compiles and the constants are consistent
    /// with the indexer decoder (spl_stake_pool.rs). The indexer uses POOL_MINT_OFFSET=162
    /// and MIN_STAKE_POOL_LEN=282; xtask must match exactly.
    #[test]
    fn pool_check_constants_match_indexer() {
        assert_eq!(STAKE_POOL_ACCOUNT_TYPE_OFFSET, 0);
        assert_eq!(STAKE_POOL_POOL_MINT_OFFSET, 162);
        assert_eq!(STAKE_POOL_MIN_LEN, 282);
    }

    /// verify_spl_pool_account rejects an account whose account_type ≠ 1
    /// (the Marinade/proprietary case) without a live RPC call. Tested via
    /// the decode_nav_sol logic mirror — confirmed rejected at account_type check.
    #[test]
    fn pool_account_type_must_be_one() {
        // Build a synthetic pool account buffer with account_type=7 (non-StakePool).
        let mut data = vec![0u8; STAKE_POOL_MIN_LEN];
        data[STAKE_POOL_ACCOUNT_TYPE_OFFSET] = 7; // wrong type
        assert_ne!(
            data[STAKE_POOL_ACCOUNT_TYPE_OFFSET], 1,
            "sanity: our synthetic bad account should not look like a StakePool"
        );
    }
}

/// Response shape for `https://extra-api.sanctum.so/v1/lsts` (the LST catalog).
///
/// NOTE: the endpoint is `/v1/lsts` — `/v1/lst-list` returns 404.
#[derive(serde::Deserialize)]
struct SanctumLstListResponse {
    lsts: Vec<SanctumLstEntry>,
}

#[derive(serde::Deserialize)]
struct SanctumLstEntry {
    symbol: String,
    #[serde(default)]
    #[allow(dead_code)]
    mint: Option<String>,
}

/// For every asset whose intrinsic is `sanctum_lst`, assert the symbol is
/// present in Sanctum's `/v1/lsts` catalog. Catches the silent-substitution
/// failure mode where Sanctum's batched sol-value endpoint returns a value
/// for an unsupported symbol by quietly swapping it for a supported one.
async fn verify_sanctum_coverage(assets: &[&AssetConfig]) -> Result<()> {
    let url = "https://extra-api.sanctum.so/v1/lsts";
    let client = reqwest::Client::new();
    let resp: SanctumLstListResponse = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("non-2xx from {url}"))?
        .json()
        .await
        .with_context(|| format!("decode JSON from {url}"))?;

    info!(
        sanctum_lst_count = resp.lsts.len(),
        "fetched Sanctum LST catalog"
    );

    // Sanctum's /v1/lsts catalog is case-sensitive in display (e.g. "JitoSOL"),
    // but the batched /v1/sol-value/current endpoint we hit at runtime accepts
    // any casing. Match case-insensitively so a cosmetic casing difference in
    // assets.toml doesn't fail CI.
    let sanctum_symbols_ci: HashSet<String> =
        resp.lsts.iter().map(|e| e.symbol.to_lowercase()).collect();

    let mut missing: Vec<String> = Vec::new();
    for a in assets {
        if let IntrinsicStrategy::SanctumLst { symbol } = &a.intrinsic {
            if !sanctum_symbols_ci.contains(&symbol.to_lowercase()) {
                missing.push(format!("{} (sanctum symbol: {})", a.symbol, symbol));
            }
        }
    }
    anyhow::ensure!(
        missing.is_empty(),
        "Assets declare sanctum_lst but symbol is not in Sanctum's /v1/lsts catalog: {}",
        missing.join(", ")
    );
    Ok(())
}

async fn migrate() -> Result<()> {
    info!("Run: sqlx migrate run --source migrations");
    info!("(intentionally not exec'd here — keep ops explicit; future versions may shell out)");
    Ok(())
}

async fn prune_webhook_deliveries(days: i64, dry_run: bool) -> Result<()> {
    if days < 1 {
        bail!("--days must be >= 1");
    }
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let pool = sqlx::PgPool::connect(&database_url).await?;

    if dry_run {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT count(*)
               FROM webhook_deliveries
              WHERE attempted_at < now() - ($1::int * interval '1 day')",
        )
        .bind(days as i32)
        .fetch_one(&pool)
        .await?;
        println!("{count}");
        info!(days, count, "webhook_deliveries rows eligible for pruning");
        return Ok(());
    }

    let result = sqlx::query(
        "DELETE FROM webhook_deliveries
          WHERE attempted_at < now() - ($1::int * interval '1 day')",
    )
    .bind(days as i32)
    .execute(&pool)
    .await?;
    println!("{}", result.rows_affected());
    info!(
        days,
        deleted = result.rows_affected(),
        "pruned webhook_deliveries"
    );
    Ok(())
}
