# Tier 2 — Generic SPL Stake-Pool Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic SPL stake-pool intrinsic adapter so Pegana can monitor 3 significant non-Sanctum LSTs — STKESOL ($66M), rkuSOL, corvusSOL — by reading NAV directly from each pool's `StakePool` state account.

**Architecture:** A new `IntrinsicStrategy::SplStakePool { pool, program }` variant + a `sources/spl_stake_pool.rs` indexer source that hand-decodes the `StakePool` account (`total_lamports / pool_token_supply` → SOL/token), multiplies by Pyth SOL/USD, and publishes the same `{value_usd, value_sol}` envelope Sanctum uses. The engine routes it through the existing shared intrinsic arm (one-line add). No new SDK dependency (borsh conflict — `Cargo.toml:64-69`); decode by byte offset like `sources/piggybank_pb.rs`.

**Tech stack:** Rust (indexer-rs source, common-verify enum, engine routing), borsh-free byte decode, `cargo test` (fixture decode), PostgreSQL migration `0054`, `cargo xtask verify-assets`.

**Spec:** `docs/superpowers/specs/2026-06-23-asset-expansion-design.md` §2. **Prerequisite:** Tier 1 plan shipped (this builds on the same deploy path). fwdSOL/pdSOL/gtSOL were discarded (unconfirmed mints).

**Verified accounts (on-chain):**
| Symbol | Mint | StakePool state | Owner program |
|---|---|---|---|
| STKESOL | `stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh` | `StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw` | `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` |
| rkuSOL | `rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp` | `ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt` | `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY` |
| corvusSOL | `CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg` | `E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66` | `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY` |

---

## File structure
- **Modify** `crates/common/src/lib.rs` — add `SplStakePool` variant + `SRC_SPL_STAKE_POOL` channel.
- **Modify** `crates/engine-rs/src/state.rs:162-168` — add the variant to `intrinsic_window_secs`.
- **Modify** `crates/engine-rs/src/main.rs` — add `SRC_SPL_STAKE_POOL` to the subscribe list (:181-189) AND to the shared intrinsic dispatch arm (:430-432). **Both** are required.
- **Modify** `crates/indexer-rs/src/config.rs` — `feature_spl_stake_pool` + `spl_stake_pool_poll_ms`.
- **Create** `crates/indexer-rs/src/sources/spl_stake_pool.rs` — the source (decode + run/poll).
- **Modify** `crates/indexer-rs/src/sources/mod.rs` + `crates/indexer-rs/src/main.rs` — declare + spawn.
- **Create** `crates/indexer-rs/fixtures/spl_stake_pool/{stkesol,rkusol,corvussol}-pool.json` — fixtures.
- **Create** `migrations/0054_spl_stake_pool_lsts.sql` — 3 asset rows.
- **Modify** `assets.toml` — 3 LST blocks.

> The variant location note: `IntrinsicStrategy`/channels physically live in `crates/common-verify/src/lib.rs` re-exported via `pegana_common`. Edit where the enum is defined; if the channel consts are in `crates/common/src/lib.rs:91-96`, add there. Confirm with `grep -n "pub const SRC_SANCTUM" crates/common*/src/lib.rs`.

---

## Task 1: Capture the 3 StakePool fixtures

**Files:** Create `crates/indexer-rs/fixtures/spl_stake_pool/{stkesol,rkusol,corvussol}-pool.json`

- [ ] **Step 1: Fetch each pool account (base64) and save the raw RPC response**

```bash
mkdir -p crates/indexer-rs/fixtures/spl_stake_pool
for pair in "stkesol:StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw" "rkusol:ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt" "corvussol:E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66"; do
  name="${pair%%:*}"; acc="${pair##*:}"
  curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$acc\",{\"encoding\":\"base64\"}]}" \
    > "crates/indexer-rs/fixtures/spl_stake_pool/${name}-pool.json"
done
```

- [ ] **Step 2: Confirm each fixture has `owner` and base64 `data`**

Run: `for f in crates/indexer-rs/fixtures/spl_stake_pool/*.json; do python3 -c "import json;d=json.load(open('$f'))['result']['value'];print('$f',d['owner'],len(d['data'][0]))"; done`
Expected: STKESOL owner `SPoo1Ku8…`, rkuSOL/corvusSOL owner `SP12tWFx…`, non-empty base64.

- [ ] **Step 3: Commit fixtures**

```bash
git add crates/indexer-rs/fixtures/spl_stake_pool/
git commit -m "test(indexer): capture StakePool fixtures for STKESOL/rkuSOL/corvusSOL"
```

---

## Task 2: Add the `SplStakePool` variant + channel

**Files:** Modify `crates/common-verify/src/lib.rs` (enum) and `crates/common/src/lib.rs` (channel).

- [ ] **Step 1: Add the variant** to `IntrinsicStrategy` (after `SanctumLst`, before `Fixed1Usd` or anywhere in the enum):

```rust
    /// Generic SPL stake-pool LST not in the Sanctum registry. NAV(SOL/token) =
    /// total_lamports / pool_token_supply, read from the StakePool state account
    /// (owned by `program` — canonical SPL stake-pool OR a SanctumSpl fork; both
    /// share the StakePool layout). USD = NAV × Pyth SOL/USD. The indexer source
    /// `spl_stake_pool` publishes `{value_usd, value_sol}` on SRC_SPL_STAKE_POOL.
    SplStakePool { pool: String, program: String },
```

- [ ] **Step 2: Add the channel** to `crates/common/src/lib.rs` (after `SRC_PIGGYBANK`, line ~96):

```rust
    pub const SRC_SPL_STAKE_POOL: &str = "pegana:src:spl_stake_pool";
```

- [ ] **Step 3: Build to surface exhaustive-match errors**

Run: `cargo build -p engine-rs -p xtask -p indexer-rs 2>&1 | grep -A3 "non-exhaustive\|E0004\|not covered" | head`
Expected: a compile error at `engine-rs/src/state.rs` `intrinsic_window_secs` (the F6 guard). Task 3 fixes it. (If xtask or others also error on a match, add the variant there too — likely none beyond state.rs.)

---

## Task 3: Engine routing (3 small edits — state.rs arm + main.rs subscribe-list + main.rs dispatch arm)

**Files:** Modify `crates/engine-rs/src/state.rs` and `crates/engine-rs/src/main.rs` (TWO sites in main.rs).

- [ ] **Step 1: Extend `intrinsic_window_secs`** (`state.rs:162-168`) — add the variant to the `Some(SOURCE_STALENESS_SECS)` arm:

```rust
        IntrinsicStrategy::SanctumLst { .. }
        | IntrinsicStrategy::HyloCr { .. }
        | IntrinsicStrategy::HyloXsolNav { .. }
        | IntrinsicStrategy::HyloShyusdRate { .. }
        | IntrinsicStrategy::SolayerSusdRate { .. }
        | IntrinsicStrategy::PerenaUsdStarPool { .. }
        | IntrinsicStrategy::SplStakePool { .. }
        | IntrinsicStrategy::PiggybankPbVault { .. } => Some(SOURCE_STALENESS_SECS),
```

- [ ] **Step 2: Route the new channel** through the existing shared intrinsic arm (`main.rs:430-432`):

```rust
        c if c == channels::SRC_SANCTUM
            || c == channels::SRC_SOLAYER
            || c == channels::SRC_PIGGYBANK
            || c == channels::SRC_SPL_STAKE_POOL =>
        {
```
(That arm already reads `{asset, value_usd, value_sol?}` and calls `set_intrinsic` + `set_intrinsic_sol` — exactly our envelope.)

- [ ] **Step 3: 🔴 Add the channel to the engine SUBSCRIBE LIST** (`main.rs:181-189`) — WITHOUT this, Redis never delivers the messages, the Step-2 arm is unreachable, and the 3 LSTs stay UNKNOWN forever (silent failure, not a compile error). Add `channels::SRC_SPL_STAKE_POOL,` to the `pubsub.subscribe(&[...])` array:

```rust
    pubsub
        .subscribe(&[
            channels::SRC_SANCTUM,
            channels::SRC_JUPITER,
            channels::SRC_PYTH,
            channels::SRC_HYLO,
            channels::SRC_SOLAYER,
            channels::SRC_PIGGYBANK,
            channels::SRC_SPL_STAKE_POOL,
        ])
        .await?;
```

- [ ] **Step 4: Build the engine**

Run: `cargo build -p engine-rs`
Expected: compiles clean.

---

## Task 4: Decode function (TDD)

**Files:** Create `crates/indexer-rs/src/sources/spl_stake_pool.rs` (decode + tests first).

- [ ] **Step 1: Write the decode fn + helpers + tests**

```rust
//! Generic SPL stake-pool intrinsic NAV reader.
//!
//! For LSTs that are NOT in the Sanctum registry (so `sanctum_lst` can't price
//! them) but ARE standard SPL stake pools. The StakePool state account (owned by
//! the canonical SPL stake-pool program `SPoo1Ku8…` or a SanctumSpl fork
//! `SP12tWFx…`, identical layout) holds the running totals:
//!
//!   off   0 [ 1] account_type (== 1 for an initialized StakePool)
//!   off 162 [32] pool_mint   (must equal the LST mint)
//!   off 258 [ 8] total_lamports     (u64 LE) — NAV numerator (SOL backing)
//!   off 266 [ 8] pool_token_supply  (u64 LE) — NAV denominator (LST supply)
//!   off 274 [ 8] last_update_epoch  (u64 LE) — forensics (epoch lag)
//!
//! NAV (SOL per LST) = total_lamports / pool_token_supply (both 9-dp base units,
//! scale cancels). USD intrinsic = NAV × Pyth SOL/USD. We also publish value_sol
//! so the engine cancels the shared SOL/USD multiplier (LST burst guard, same as
//! Sanctum). Decoded by hand — the `spl-stake-pool` crate is NOT a dep (borsh
//! version conflict, Cargo.toml:64-69). Cadence 30s.

use crate::sinks;
use crate::state::AppState;
use anyhow::{ensure, Context, Result};
use chrono::{DateTime, Utc};
use pegana_common::IntrinsicStrategy;
use rust_decimal::Decimal;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

const ACCOUNT_TYPE_STAKE_POOL: u8 = 1;
const POOL_MINT_OFFSET: usize = 162;
const TOTAL_LAMPORTS_OFFSET: usize = 258;
const POOL_TOKEN_SUPPLY_OFFSET: usize = 266;
const LAST_UPDATE_EPOCH_OFFSET: usize = 274;
/// We read through last_update_epoch (274..282); the live accounts are ~611 B.
const MIN_STAKE_POOL_LEN: usize = 282;

/// Decode NAV (SOL per LST token) from a StakePool state account.
/// Returns (nav_sol, total_lamports, pool_token_supply, last_update_epoch).
pub fn decode_nav_sol(data: &[u8], expected_mint: &Pubkey) -> Result<(Decimal, u64, u64, u64)> {
    ensure!(
        data.len() >= MIN_STAKE_POOL_LEN,
        "stake-pool account too short: {} bytes (need ≥ {})",
        data.len(),
        MIN_STAKE_POOL_LEN
    );
    ensure!(
        data[0] == ACCOUNT_TYPE_STAKE_POOL,
        "not an initialized StakePool: account_type={} (expected 1)",
        data[0]
    );
    let pool_mint = Pubkey::try_from(&data[POOL_MINT_OFFSET..POOL_MINT_OFFSET + 32])
        .map_err(|_| anyhow::anyhow!("invalid pool_mint pubkey at offset {POOL_MINT_OFFSET}"))?;
    ensure!(
        &pool_mint == expected_mint,
        "pool_mint mismatch: account says {pool_mint}, expected {expected_mint}"
    );
    let total_lamports = read_u64_le(data, TOTAL_LAMPORTS_OFFSET)?;
    let pool_token_supply = read_u64_le(data, POOL_TOKEN_SUPPLY_OFFSET)?;
    let last_update_epoch = read_u64_le(data, LAST_UPDATE_EPOCH_OFFSET)?;
    ensure!(pool_token_supply > 0, "pool_token_supply is zero");
    ensure!(total_lamports > 0, "total_lamports is zero");
    let nav_sol = Decimal::from(total_lamports)
        .checked_div(Decimal::from(pool_token_supply))
        .context("NAV division overflow")?;
    ensure!(
        nav_sol >= Decimal::from_str("0.99").unwrap() && nav_sol < Decimal::from(2u32),
        "NAV_sol {nav_sol} outside [0.99, 2.0) — layout drift or unhealthy pool"
    );
    Ok((nav_sol, total_lamports, pool_token_supply, last_update_epoch))
}

/// Bounds-checked little-endian u64 read (mirrors piggybank_pb::read_u64_le).
fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| anyhow::anyhow!("read_u64_le offset overflow: {offset}"))?;
    let bytes = data
        .get(offset..end)
        .ok_or_else(|| anyhow::anyhow!("read_u64_le out of bounds at {offset}, len {}", data.len()))?;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

fn decimal_to_f64(d: Decimal) -> f64 {
    d.to_string().parse::<f64>().unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn load(name: &str) -> (Vec<u8>, String) {
        let raw = std::fs::read_to_string(format!("fixtures/spl_stake_pool/{name}-pool.json"))
            .expect("fixture present");
        let j: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let b64 = j["result"]["value"]["data"][0].as_str().expect("base64");
        let owner = j["result"]["value"]["owner"].as_str().unwrap().to_string();
        (
            base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
            owner,
        )
    }

    #[test]
    fn decodes_stkesol() {
        let (data, owner) = load("stkesol");
        assert_eq!(owner, "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy");
        let mint = Pubkey::from_str("stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh").unwrap();
        let (nav, tl, pts, _epoch) = decode_nav_sol(&data, &mint).expect("decode");
        assert!(tl > 0 && pts > 0);
        assert!(
            nav > Decimal::ONE && nav < Decimal::from_str("1.2").unwrap(),
            "STKESOL NAV {nav} must be a sane LST appreciation ratio"
        );
    }

    #[test]
    fn decodes_rkusol_and_corvussol() {
        for (name, mint_str) in [
            ("rkusol", "rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp"),
            ("corvussol", "CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg"),
        ] {
            let (data, owner) = load(name);
            assert_eq!(owner, "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY", "{name}");
            let mint = Pubkey::from_str(mint_str).unwrap();
            let (nav, _, _, _) = decode_nav_sol(&data, &mint).expect("decode");
            assert!(nav > Decimal::ONE && nav < Decimal::from_str("1.2").unwrap(), "{name} NAV {nav}");
        }
    }

    #[test]
    fn rejects_wrong_account_type() {
        let mut data = vec![0u8; MIN_STAKE_POOL_LEN];
        data[0] = 2; // not a StakePool
        let mint = Pubkey::new_unique();
        assert!(decode_nav_sol(&data, &mint).unwrap_err().to_string().contains("not an initialized"));
    }

    #[test]
    fn rejects_mint_mismatch() {
        let (data, _) = load("stkesol");
        let wrong = Pubkey::new_unique();
        assert!(decode_nav_sol(&data, &wrong).unwrap_err().to_string().contains("pool_mint mismatch"));
    }

    #[test]
    fn rejects_short_account() {
        let mint = Pubkey::new_unique();
        assert!(decode_nav_sol(&[0u8; 50], &mint).unwrap_err().to_string().contains("too short"));
    }
}
```

- [ ] **Step 2: Register the module** so tests compile — add to `crates/indexer-rs/src/sources/mod.rs`: `pub mod spl_stake_pool;`

- [ ] **Step 3: Run the decode tests**

Run: `cargo test -p indexer-rs spl_stake_pool`
Expected: PASS (5 tests). If `decode_nav_sol` reports a band/type error, the offsets need a one-time recheck against the captured fixture (the spec offsets were verified live, so a mismatch means the fixture differs — re-decode and pin).

- [ ] **Step 4: Commit**

```bash
git add crates/indexer-rs/src/sources/spl_stake_pool.rs crates/indexer-rs/src/sources/mod.rs crates/common-verify/src/lib.rs crates/common/src/lib.rs crates/engine-rs/src/state.rs crates/engine-rs/src/main.rs
git commit -m "feat(indexer): SplStakePool intrinsic variant + decode (TDD) + engine routing"
```

---

## Task 5: Config fields + the run/poll source

**Files:** Modify `crates/indexer-rs/src/config.rs`; append to `crates/indexer-rs/src/sources/spl_stake_pool.rs`.

- [ ] **Step 1: Add config fields** in `config.rs` (poll field beside `piggybank_poll_ms` ~line 33; feature beside `feature_piggybank` ~line 55):

```rust
    pub spl_stake_pool_poll_ms: Option<u64>,
```
```rust
    #[serde(default = "default_true")]
    pub feature_spl_stake_pool: bool,
```

- [ ] **Step 2: Append `run` + `poll_once` + `poll_one` + `collect_pools`** to `spl_stake_pool.rs` (above the `#[cfg(test)]` module):

```rust
struct PoolCfg {
    symbol: String,
    mint: Pubkey,
    pool: Pubkey,
    program: Pubkey,
}

fn collect_pools(state: &AppState) -> Result<Vec<PoolCfg>> {
    let mut out = Vec::new();
    for a in &state.assets.assets {
        if !a.active {
            continue;
        }
        if let IntrinsicStrategy::SplStakePool { pool, program } = &a.intrinsic {
            out.push(PoolCfg {
                symbol: a.symbol.clone(),
                mint: Pubkey::from_str(&a.mint).with_context(|| format!("{} mint", a.symbol))?,
                pool: Pubkey::from_str(pool).with_context(|| format!("{} pool", a.symbol))?,
                program: Pubkey::from_str(program).with_context(|| format!("{} program", a.symbol))?,
            });
        }
    }
    Ok(out)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_spl_stake_pool {
        info!("FEATURE_SPL_STAKE_POOL=false — spl_stake_pool source disabled");
        return Ok(());
    }
    let pools = collect_pools(&state)?;
    if pools.is_empty() {
        info!("no active spl_stake_pool assets — spl_stake_pool source idle");
        return Ok(());
    }
    let cadence_ms = state.config.spl_stake_pool_poll_ms.unwrap_or(30_000);
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
    info!(cadence_ms, pool_count = pools.len(), "spl_stake_pool source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("spl_stake_pool source shutdown");
                return Ok(());
            }
        }
        if let Err(e) = poll_once(&state, &rpc, &rpc_fallback, &pools).await {
            warn!(error = %e, "spl_stake_pool poll failed");
            metrics::counter!("pegana_spl_stake_pool_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_spl_stake_pool_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    pools: &[PoolCfg],
) -> Result<()> {
    let started = std::time::Instant::now();
    let sol_usd = {
        let cache = state.pyth.read().await;
        cache.get("SOL/USD").map(|e| e.price)
    };
    let Some(sol_usd) = sol_usd else {
        debug!("SOL/USD missing from Pyth cache — skipping spl_stake_pool tick");
        return Ok(());
    };
    let ts = chrono::Utc::now();
    for p in pools {
        if let Err(e) = poll_one(state, rpc, rpc_fallback, p, sol_usd, ts).await {
            warn!(symbol = %p.symbol, error = %e, "spl_stake_pool asset poll failed");
        }
    }
    metrics::histogram!("pegana_spl_stake_pool_latency_seconds")
        .record(started.elapsed().as_secs_f64());
    Ok(())
}

async fn poll_one(
    state: &AppState,
    rpc: &RpcClient,
    rpc_fallback: &RpcClient,
    p: &PoolCfg,
    sol_usd: Decimal,
    ts: DateTime<Utc>,
) -> Result<()> {
    let account =
        crate::rpc::get_account_with_fallback(rpc, rpc_fallback, &p.pool, "spl_stake_pool").await?;
    ensure!(
        account.owner == p.program,
        "{} stake-pool owner mismatch: got {} expected {}",
        p.symbol,
        account.owner,
        p.program
    );
    let (nav_sol, total_lamports, pool_token_supply, last_update_epoch) =
        decode_nav_sol(&account.data, &p.mint)?;
    let value_usd = nav_sol * sol_usd;
    metrics::gauge!("pegana_spl_stake_pool_nav_sol", "symbol" => p.symbol.clone())
        .set(decimal_to_f64(nav_sol));

    let meta = serde_json::json!({
        "pool": p.pool.to_string(),
        "program": p.program.to_string(),
        "nav_sol": nav_sol,
        "total_lamports": total_lamports.to_string(),
        "pool_token_supply": pool_token_supply.to_string(),
        "last_update_epoch": last_update_epoch.to_string(),
        "sol_usd": sol_usd,
        "formula": "total_lamports / pool_token_supply × pyth(SOL/USD)",
    });
    sinks::postgres::insert_intrinsic(
        &state.pg,
        &p.symbol,
        value_usd,
        "spl_stake_pool+pyth",
        meta.clone(),
        None,
        ts,
    )
    .await
    .context("insert intrinsic")?;

    let payload = serde_json::json!({
        "asset": p.symbol,
        "value_usd": value_usd,
        "value_sol": nav_sol,
        "source": "spl_stake_pool+pyth",
        "meta": meta,
        "ts": ts,
    });
    sinks::redis_pub::publish(
        state.redis.clone(),
        pegana_common::channels::SRC_SPL_STAKE_POOL,
        &payload,
    )
    .await
    .context("publish to redis")?;
    Ok(())
}
```

- [ ] **Step 3: Spawn the source** in `crates/indexer-rs/src/main.rs` (beside the other `tasks.spawn(sources::…::run(...))`, ~line 42):

```rust
    tasks.spawn(sources::spl_stake_pool::run(state.clone(), shutdown.clone()));
```

- [ ] **Step 4: Build + fmt + clippy**

Run: `cargo build -p indexer-rs && cargo fmt --check && cargo clippy -p indexer-rs --all-targets -- -D warnings`
Expected: clean. (If `state.pyth`/`PythEntry.price` field names differ, align with `sources/sanctum.rs:106-107` which does the exact same `cache.get("SOL/USD").map(|e| e.price)`.)

- [ ] **Step 5: Commit**

```bash
git add crates/indexer-rs/src/config.rs crates/indexer-rs/src/sources/spl_stake_pool.rs crates/indexer-rs/src/main.rs
git commit -m "feat(indexer): spl_stake_pool source run loop + config + spawn"
```

---

## Task 6: Add the 3 assets (config + migration)

**Files:** Modify `assets.toml`; create `migrations/0054_spl_stake_pool_lsts.sql`.

- [ ] **Step 1: Append 3 `[[assets]]` blocks** to `assets.toml`:

```toml
[[assets]]
symbol = "STKESOL"
name = "SOL Strategies Staked SOL"
mint = "stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh"
verified = true
decimals = 9
token_program = "spl"
class = "lst"
peg_target = "SOL"
intrinsic = { kind = "spl_stake_pool", pool = "StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw", program = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy" }
market = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }

[[assets]]
symbol = "rkuSOL"
name = "Raiku Staked SOL"
mint = "rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp"
verified = true
decimals = 9
token_program = "spl"
class = "lst"
peg_target = "SOL"
intrinsic = { kind = "spl_stake_pool", pool = "ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt", program = "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY" }
market = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }

[[assets]]
symbol = "corvusSOL"
name = "Corvus Staked SOL"
mint = "CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg"
verified = true
decimals = 9
token_program = "spl"
class = "lst"
peg_target = "SOL"
intrinsic = { kind = "spl_stake_pool", pool = "E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66", program = "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY" }
market = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }
```

- [ ] **Step 2: Create `migrations/0054_spl_stake_pool_lsts.sql`** (3 rows; `intrinsic_kind='spl_stake_pool'`, `intrinsic_cfg={"pool":…,"program":…}`):

```sql
-- 0054: Tier-2 non-Sanctum LSTs via the spl_stake_pool adapter (2026-06-23).
INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  ('STKESOL','stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh','SOL Strategies Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw","program":"SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb),
  ('rkuSOL','rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp','Raiku Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt","program":"SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb),
  ('corvusSOL','CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg','Corvus Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66","program":"SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  mint = EXCLUDED.mint, name = EXCLUDED.name, class = EXCLUDED.class,
  peg_target = EXCLUDED.peg_target, decimals = EXCLUDED.decimals,
  token_program = EXCLUDED.token_program, intrinsic_kind = EXCLUDED.intrinsic_kind,
  intrinsic_cfg = EXCLUDED.intrinsic_cfg, market_kind = EXCLUDED.market_kind,
  market_cfg = EXCLUDED.market_cfg, pyth_feed_id = EXCLUDED.pyth_feed_id,
  thresholds = EXCLUDED.thresholds, is_active = EXCLUDED.is_active,
  metadata = assets.metadata || EXCLUDED.metadata;
```

- [ ] **Step 3: verify-assets** (confirms mint owner=spl + decimals=9; spl_stake_pool is not Sanctum-checked)

Run: `cargo run -p xtask -- verify-assets`
Expected: PASS for all 3 (mints are `spl`/9-dp). If verify-assets has an exhaustive `IntrinsicStrategy` match it didn't before, add a no-op arm for `SplStakePool`.

- [ ] **Step 4: Apply migration to prod-local + commit**

Run: `psql "$DATABASE_URL" -f migrations/0054_spl_stake_pool_lsts.sql`
```bash
git add assets.toml migrations/0054_spl_stake_pool_lsts.sql
git commit -m "feat: add STKESOL/rkuSOL/corvusSOL via spl_stake_pool adapter (migration 0054)"
```

---

## Task 7: Full check + deploy

- [ ] **Step 1: fmt + clippy + test**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all green.

- [ ] **Step 2: Deploy**

Run: `scripts/deploy.sh --migrate`
Expected: `0054` applies before restart; the new `spl_stake_pool` source spawns (log: `spl_stake_pool source ready pool_count=3`).

- [ ] **Step 3: Verify the 3 leave UNKNOWN**

Run: `curl -s https://api.pegana.xyz/v1/assets | python3 -c "import json,sys; d=json.load(sys.stdin); m={a['symbol']:a.get('state') for a in d}; [print(s, m.get(s,'ABSENT')) for s in ['STKESOL','rkuSOL','corvusSOL']]"`
Expected: each `UNKNOWN → PEGGED` within ~1–2 cycles; `intrinsic_snapshots` gains `spl_stake_pool+pyth` rows; `pegana_spl_stake_pool_polls_total{status="ok"}` increments.

---

## Rollback
`UPDATE assets SET is_active=FALSE WHERE symbol IN ('STKESOL','rkuSOL','corvusSOL');` + `FEATURE_SPL_STAKE_POOL=false` in prod `.env` + recreate. Code is additive (new variant/channel/source); reverting the commits is safe.

## Self-review
- ✅ Spec §2 → tasks: variant+channel (T2), engine routing (T3), decode TDD (T4), source (T5), assets+migration (T6), deploy (T7).
- ✅ House-style checklist honored: `run/poll` shape, feature gate, 30s cadence, `select!`+shutdown, `get_account_with_fallback` with low-cardinality label, no panics (all `ensure!`/`Result`), `checked_div`, hand-decode (no `spl-stake-pool` crate), bounded metric labels (3-symbol set), fixtures+tests, the F6 exhaustive-match arm.
- ✅ Engine reuse: publishes the Sanctum-shaped `{value_usd, value_sol}` envelope on a new channel wired into BOTH the subscribe list (main.rs:181-189) AND the shared dispatch arm (main.rs:430-432) — no duplicated engine logic; value_sol cancels the SOL/USD multiplier (LST burst guard). [Validation 2026-06-23 caught the missing subscribe-list edit — now included.]
- ✅ Types consistent: `IntrinsicStrategy::SplStakePool { pool, program }` used identically in the variant, `collect_pools`, migration cfg, and asset blocks; `decode_nav_sol` signature stable across def/tests.
- ✅ No placeholders: full source, exact accounts, exact SQL, exact commands.
- ⚠️ One impl-time recheck: if a fixture decode test fails on the NAV band, re-pin offsets against the captured fixture (spec offsets were live-verified, so this is a guard, not an expected failure).
