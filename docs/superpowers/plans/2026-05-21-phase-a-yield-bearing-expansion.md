# Phase A: yield-bearing expansion (18→32 assets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Pegana's monitored asset universe from 18 to 32 by adding 6 Sanctum LSTs (config-only) and 8 yield-bearing stables (one on-chain NAV reader per issuer), with end-to-end testing against mainnet.

**Architecture:** Each new yield-bearing stable gets its own source adapter under `crates/indexer-rs/src/sources/`, modeled after the existing `hylo.rs` (429 lines, Borsh decode of on-chain accounts via `solana-client`). Adapters publish `IntrinsicReading` to per-issuer Redis channels; the engine subscribes via existing `pegana:src:*` pattern. No new external dependencies. No new asset class — reuses existing `AssetClass::StableYield`.

**Tech Stack:** Rust 1.83 · tokio · solana-client · solana-sdk · borsh · rust_decimal · existing TimescaleDB + Redis infrastructure. Front-end: Next.js 16 · Tailwind v4. Bot: TypeScript · grammY · Fluent i18n.

**Companion spec:** `docs/superpowers/specs/2026-05-21-phase-a-yield-bearing-expansion-design.md`

---

## Reference: existing patterns to mimic

Before starting Task 1, read these in order — they're the templates:

1. `crates/indexer-rs/src/sources/sanctum.rs` (169 lines) — simplest source pattern: `run()` + `poll_once()` + ticker loop
2. `crates/indexer-rs/src/sources/hylo.rs` (429 lines) — on-chain Borsh decode pattern: PDA derivation, account fetch via RPC, payload parse
3. `crates/indexer-rs/src/sinks/postgres.rs` — `insert_intrinsic()` signature you'll call from each adapter
4. `crates/indexer-rs/src/sinks/redis_pub.rs` — `publish()` signature
5. `crates/common/src/lib.rs:48-76` — `IntrinsicStrategy` enum where you'll add new variants
6. `crates/common/src/lib.rs:196-208` — Redis channel constants where you'll add new ones

Every adapter you write MUST be structurally identical to `sanctum.rs` (the ticker shell) wrapped around a `hylo.rs`-style decode (the on-chain part).

---

## Week 1: Foundation (3 tasks)

### Task 1: Add Sanctum symbols list helper + 6 LST configs to assets.toml

**Files:**
- Modify: `assets.toml` (add 6 new `[[assets]]` blocks after existing LSTs around line 115)

- [ ] **Step 1: Verify each new LST mint exists on mainnet**

Run for each candidate:

```bash
# Replace <MINT> with actual address from Sanctum docs at https://sanctum.so/lsts
solana account <MINT> --url mainnet-beta --output json | jq '.account.owner'
# Expected: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" (SPL Token program)
```

You need to obtain the canonical mint for each of: `vSOL`, `compassSOL`, `BNSOL`, `picoSOL`, `kySOL`, `hSOL`. Sources:
- Sanctum's official LST list: visit `https://sanctum.so/lsts` and copy each mint
- Cross-check with Solscan (`https://solscan.io/token/<mint>`) — confirm "Liquid Staking Token" tag

Document each mint in a temp scratch file as you find it.

- [ ] **Step 2: Add 6 entries to assets.toml**

Each entry follows this exact template (replacing `<MINT>`, `<SYMBOL>`, `<NAME>`, `<SANCTUM_SYMBOL>`, `<PYTH_FEED>`):

```toml
[[assets]]
symbol         = "<SYMBOL>"
name           = "<NAME>"
mint           = "<MINT>"
verified       = false   # flip to true after verify-assets passes
decimals       = 9
token_program  = "spl"
class          = "lst"
peg_target     = "SOL"
intrinsic      = { kind = "sanctum_lst", symbol = "<SANCTUM_SYMBOL>" }
market         = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id   = "<PYTH_FEED_OR_EMPTY>"
thresholds_bps = { drift = 30, depeg = 120, critical = 350 }
```

For Pyth feed IDs, check `https://pyth.network/price-feeds` filtering by "Crypto" + searching the symbol. If no feed exists, use `pyth_feed_id = ""` (Sanctum becomes sole source — same pattern as `JupSOL` at `assets.toml:113`).

Sanctum symbol matters: Sanctum's API expects specific identifiers. Default to the asset symbol (e.g., `vSOL`, `compassSOL`); if Sanctum's API returns an error during smoke test, check `https://extra-api.sanctum.so/v1/lst-list` for the canonical identifier.

- [ ] **Step 3: Insert pyth_feeds section additions (if any have Pyth feeds)**

If any of the 6 had a non-empty `pyth_feed_id`, also add the symbol→ID mapping at `assets.toml:288-296` (the `[pyth_feeds]` table). This is what `crates/indexer-rs/src/sources/pyth.rs` subscribes to.

- [ ] **Step 4: Update the count comment at top of assets.toml**

Change line 1 from `# Pegana — Asset universe v1 (14 assets)` to `# Pegana — Asset universe v1.1 (32 assets — 18 baseline + 14 added in Phase A)`. Both the original "14" and current "18" baselines are wrong/stale — fix to 32.

- [ ] **Step 5: Run cargo check to verify TOML parses**

Run: `cargo check -p pegana-common --tests`
Expected: PASS. The `assets_toml_parses` test in `crates/common/src/lib.rs:215` should still pass.

- [ ] **Step 6: Commit**

```bash
git add assets.toml
git commit -m "feat(assets): add 6 Sanctum LSTs to universe (vSOL, compassSOL, BNSOL, picoSOL, kySOL, hSOL)

All marked verified=false; CI verify-assets will flip them after
mainnet checks pass. Sanctum's batch endpoint handles them with zero
new adapter code.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Extend verify-assets to check Sanctum LST list + new mints

**Files:**
- Modify: `crates/xtask/src/main.rs` (the verify-assets subcommand)

- [ ] **Step 1: Read existing verify-assets implementation**

Run: `grep -n "verify_assets\|verify-assets" crates/xtask/src/main.rs`
Expected: a function that loops over assets and calls `get_account` per mint. Read the function.

- [ ] **Step 2: Add Sanctum LST list cross-check**

After existing per-mint checks, add a phase that:
1. Fetches `https://extra-api.sanctum.so/v1/lst-list`
2. For each asset where `intrinsic.kind == "sanctum_lst"`, asserts the symbol is present in Sanctum's list

```rust
async fn verify_sanctum_coverage(assets: &[AssetConfig]) -> Result<()> {
    let resp: serde_json::Value = reqwest::get("https://extra-api.sanctum.so/v1/lst-list")
        .await?
        .json()
        .await?;
    let sanctum_symbols: std::collections::HashSet<String> = resp["lsts"]
        .as_array()
        .context("sanctum lst-list missing `lsts` array")?
        .iter()
        .filter_map(|v| v["symbol"].as_str().map(String::from))
        .collect();

    for a in assets {
        if let IntrinsicStrategy::SanctumLst { symbol } = &a.intrinsic {
            anyhow::ensure!(
                sanctum_symbols.contains(symbol),
                "asset {} declares sanctum_lst symbol={} but Sanctum doesn't list it",
                a.symbol,
                symbol
            );
        }
    }
    Ok(())
}
```

(Adapt the exact `lsts`/`symbol` JSON path after inspecting the actual response — first run `curl https://extra-api.sanctum.so/v1/lst-list | jq 'keys[:3]'` to confirm structure.)

- [ ] **Step 3: Run verify-assets against the updated assets.toml**

Run: `cargo run -p xtask -- verify-assets`
Expected: PASS for all 24 LSTs+stables that existed before plus the 6 new ones. If any of the 6 new mints fail (wrong owner, mint doesn't exist), fix the entry in assets.toml.

- [ ] **Step 4: Flip `verified = false` to `true` for the 6 new entries**

Once they pass, edit `assets.toml` and change `verified = false` → `verified = true` for each.

- [ ] **Step 5: Re-run verify and commit**

```bash
cargo run -p xtask -- verify-assets   # final check
git add crates/xtask/src/main.rs assets.toml
git commit -m "feat(xtask): cross-check sanctum_lst symbols against Sanctum's lst-list endpoint

Extends verify-assets with a network call to Sanctum to ensure every
declared sanctum_lst symbol is actually in their batch API. Flips the
6 new LSTs to verified=true.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Extend `IntrinsicStrategy` enum + add 8 yield-bearing stable assets (verified=false)

**Files:**
- Modify: `crates/common/src/lib.rs` (extend enum at line 48)
- Modify: `assets.toml` (add 8 new `[[assets]]` blocks)

- [ ] **Step 1: Read current `IntrinsicStrategy` enum**

Already inspected in spec — current variants: `SanctumLst`, `Fixed1Usd`, `HyloCr`, `HyloXsolNav`, `HyloShyusdRate`, `PythFxCross`, `PythRedemptionRate`.

Add 8 new variants at the end of the enum:

```rust
// Phase A: yield-bearing stable adapters (one variant per issuer for type-safe
// verify-assets and explicit account/program addresses).
OndoUsdyOracle {
    /// Ondo's USDY price oracle account on Solana.
    oracle: String,
},
EthenaSusdeRate {
    /// Bridged sUSDe mint on Solana (NTT or Wormhole variant).
    mint: String,
    /// Ethena program publishing share-rate updates on Solana.
    program: String,
},
MaplePoolNav {
    /// Maple Pool PDA holding NAV state.
    pool: String,
    /// Maple program ID.
    program: String,
},
SolayerSusdRate {
    /// Solayer's share-rate account or mint with extension.
    share_account: String,
    program: String,
},
PerenaUsdStarPool {
    /// Numéraire seed-pool PDA.
    pool: String,
    /// Underlying mints in pool order (USDC, USDT, PYUSD).
    underlying: Vec<String>,
    program: String,
},
OnreOnycNav {
    /// OnRe pool/vault PDA holding NAV state.
    pool: String,
    program: String,
},
PiggybankPbVault {
    /// Piggybank vault PDA holding NAV state.
    vault: String,
    program: String,
},
StreamflowUsdPlus {
    /// Streamflow USD+ NAV oracle account (updates daily).
    oracle: String,
},
```

- [ ] **Step 2: Run common's tests to confirm enum compiles**

Run: `cargo test -p pegana-common`
Expected: PASS (no test changes needed — the existing `assets_toml_parses` test will still pass because we haven't yet added new assets that use these variants).

- [ ] **Step 3: Add 8 new yield-bearing stable entries to assets.toml**

Add **after the existing `sHYUSD` entry** (around line 250). Use this template per asset:

```toml
[[assets]]
symbol         = "<SYMBOL>"        # e.g., "USDY"
name           = "<FULL_NAME>"     # e.g., "Ondo USD Yield"
mint           = "<MAINNET_MINT>"  # TBD — fetched in Step 4 below
verified       = false
decimals       = <6_OR_9>          # from issuer docs
token_program  = "<spl_OR_token_2022>"
class          = "stable_yield"
peg_target     = "USD"
intrinsic      = { kind = "<KIND>", ... }  # see per-asset section
market         = { kind = "jupiter_usd", numeraire = "USDC", numeraire_feed = "USDC/USD" }
pyth_feed_id   = ""
thresholds_bps = { drift = 30, depeg = 100, critical = 250 }
```

**Per-asset specifics** (intrinsic kind + key fields):

```toml
# USDY (Ondo) — kind = "ondo_usdy_oracle"
intrinsic = { kind = "ondo_usdy_oracle", oracle = "<TBD_ondo_price_oracle>" }

# sUSDe (Ethena, bridged) — kind = "ethena_susde_rate"
intrinsic = { kind = "ethena_susde_rate", mint = "<TBD_solana_mint>", program = "<TBD_ethena_program>" }

# syrupUSDC (Maple) — kind = "maple_pool_nav"
intrinsic = { kind = "maple_pool_nav", pool = "<TBD>", program = "<TBD>" }

# sUSD (Solayer) — kind = "solayer_susd_rate"
intrinsic = { kind = "solayer_susd_rate", share_account = "<TBD>", program = "<TBD>" }

# USD* (Perena) — kind = "perena_usd_star_pool"
intrinsic = { kind = "perena_usd_star_pool", pool = "<TBD>", underlying = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"], program = "<TBD>" }

# ONyc (OnRe) — kind = "onre_onyc_nav"
intrinsic = { kind = "onre_onyc_nav", pool = "<TBD>", program = "<TBD>" }

# pbUSDC (Piggybank) — kind = "piggybank_pb_vault"
intrinsic = { kind = "piggybank_pb_vault", vault = "<TBD>", program = "<TBD>" }

# USD+ (Streamflow) — kind = "streamflow_usd_plus"
intrinsic = { kind = "streamflow_usd_plus", oracle = "<TBD>" }
```

- [ ] **Step 4: Fetch mint + program/oracle addresses for each issuer (research step)**

This is real research. For each issuer, gather from their official docs:

| Asset | Where to look |
|---|---|
| USDY | https://ondo.finance/ → docs → Solana deployment |
| sUSDe | https://ethena.fi/ → bridges → Solana |
| syrupUSDC | https://app.maple.finance/ + https://docs.maple.finance → Solana |
| sUSD | https://docs.solayer.org/assets/susd (mint preliminary: `susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X`) |
| USD* | https://app.perena.org/ + https://www.npmjs.com/package/@perena/numeraire-sdk source |
| ONyc | https://docs.onre.finance/ + https://app.rwa.xyz/assets/ONyc |
| pbUSDC | https://www.piggybank.fi/ (scrape vault pages — vaults are named `usdc-vault`, `spyx-vault`, `jitosol-vault`) |
| USD+ | https://streamflow.finance/ → Streamflow Finance has multiple products; find the USD+ NAV oracle in docs |

For each address: verify on-chain with `solana account <pubkey> --url mainnet-beta --output json` and confirm `owner` matches the issuer's published program ID.

- [ ] **Step 5: Update each `[[assets]]` block with the fetched addresses**

Replace all `<TBD>` placeholders.

- [ ] **Step 6: Run `cargo check` and the common test to confirm TOML still parses**

Run: `cargo check -p pegana-common --tests && cargo test -p pegana-common -- assets_toml_parses`
Expected: PASS.

- [ ] **Step 7: Update the test assertion to expect 32 assets**

Edit `crates/common/src/lib.rs:218-222` — change `>= 14` to `>= 32`. Also add the new required symbols to the "must contain" check:

```rust
for required in [
    "jitoSOL", "USDC", "USDT", "PYUSD", "hyUSD", "BRZ",
    "vSOL", "USDY", "sUSD", "USD*", "syrupUSDC",
] {
    assert!(
        symbols.iter().any(|s| s.as_str() == required),
        "missing {required}"
    );
}
```

- [ ] **Step 8: Run tests, commit**

Run: `cargo test -p pegana-common`
Expected: PASS.

```bash
git add crates/common/src/lib.rs assets.toml
git commit -m "feat(common,assets): add 8 yield-bearing stable IntrinsicStrategy variants + assets

USDY, sUSDe, syrupUSDC, sUSD, USD*, ONyc, pbUSDC, USD+ — all using
StableYield class, verified=false until per-adapter mainnet smoke
passes. IntrinsicStrategy enum gains 8 per-issuer variants for
type-safe verify-assets.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Week 2: Simple oracle-based adapters (3 tasks)

These 3 adapters are simpler because they read from a single oracle account that already publishes a USD price/NAV. No multi-account decode, no PDA derivation.

### Task 4: Implement `ondo_usdy` adapter

**Files:**
- Create: `crates/indexer-rs/src/sources/ondo_usdy.rs`
- Modify: `crates/indexer-rs/src/sources/mod.rs` (add `pub mod ondo_usdy;`)
- Modify: `crates/indexer-rs/src/main.rs` (spawn task; mirror existing source spawns)
- Modify: `crates/common/src/lib.rs` (add `SRC_ONDO` channel constant)
- Create: `crates/indexer-rs/fixtures/ondo/usdy-account.json`

- [ ] **Step 1: Add Redis channel constant**

In `crates/common/src/lib.rs` inside `pub mod channels { ... }` (around line 199), add:

```rust
pub const SRC_ONDO: &str = "pegana:src:ondo";
```

- [ ] **Step 2: Capture an actual USDY oracle account from mainnet (fixture)**

```bash
mkdir -p crates/indexer-rs/fixtures/ondo
solana account <USDY_ORACLE_PUBKEY> --url mainnet-beta --output json > crates/indexer-rs/fixtures/ondo/usdy-account.json
```

Inspect the JSON — note the `data[0]` (base64-encoded bytes) length. Check Ondo's docs/IDL to find the field layout. Usually price oracles have layout: `[discriminator(8), price(i64 or u64), expo(i32), publish_time(i64), ...]`.

- [ ] **Step 3: Write a failing decode test**

Create `crates/indexer-rs/src/sources/ondo_usdy.rs` with **only**:

```rust
//! Ondo USDY NAV reader.
//!
//! Reads USDY's on-chain price oracle on Solana. Oracle publishes USDY/USD
//! denominated NAV (USDY is rebasing or share-based — confirm during impl).
//! Cadence: 30s. Stale if publish_time > 5min old.

use anyhow::Result;
use rust_decimal::Decimal;

pub fn decode_oracle(data: &[u8]) -> Result<Decimal> {
    todo!("implement after inspecting fixture")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_fixture() {
        let raw = std::fs::read_to_string("fixtures/ondo/usdy-account.json")
            .expect("fixture present");
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let b64 = json["account"]["data"][0].as_str().unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let nav = decode_oracle(&bytes).expect("decode succeeds");

        // Cross-reference: visit https://ondo.finance/usdy on the date the
        // fixture was captured and assert NAV matches (within 5bps).
        let expected_nav = Decimal::from_str_exact("1.0843").unwrap();
        let diff = (nav - expected_nav).abs();
        assert!(diff < Decimal::from_str_exact("0.0005").unwrap(),
            "decoded NAV {nav} differs from expected {expected_nav} by {diff}");
    }
}
```

Run: `cargo test -p indexer-rs ondo_usdy::tests::decodes_fixture`
Expected: FAIL with `not yet implemented`

- [ ] **Step 4: Implement `decode_oracle`**

Use the layout you derived in Step 2. Pattern (adjust offsets per Ondo's actual layout):

```rust
pub fn decode_oracle(data: &[u8]) -> Result<Decimal> {
    use anyhow::Context;

    // Skip Anchor discriminator if present (first 8 bytes).
    let offset = if data.len() > 8 { 8 } else { 0 };

    // Read price as little-endian i64 (most Solana oracles use i64 + i32 expo).
    let price_bytes: [u8; 8] = data[offset..offset + 8]
        .try_into()
        .context("price slice")?;
    let price_raw = i64::from_le_bytes(price_bytes);

    let expo_bytes: [u8; 4] = data[offset + 8..offset + 12]
        .try_into()
        .context("expo slice")?;
    let expo = i32::from_le_bytes(expo_bytes);

    // price = price_raw × 10^expo
    let scale = if expo >= 0 {
        Decimal::from(10u64.pow(expo as u32))
    } else {
        Decimal::ONE / Decimal::from(10u64.pow((-expo) as u32))
    };
    let nav = Decimal::from(price_raw) * scale;

    anyhow::ensure!(nav > Decimal::ZERO, "non-positive NAV");
    Ok(nav)
}
```

Run: `cargo test -p indexer-rs ondo_usdy::tests::decodes_fixture`
Expected: PASS (within 5bps tolerance).

If it fails, inspect the actual bytes with `xxd` or `hexdump` and adjust the layout. The expected nav value comes from cross-referencing Ondo's public dashboard at the fixture capture time.

- [ ] **Step 5: Add the runtime adapter (ticker + RPC fetch)**

Append to `crates/indexer-rs/src/sources/ondo_usdy.rs`:

```rust
use crate::sinks;
use crate::state::AppState;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    if !state.config.feature_ondo.unwrap_or(true) {
        info!("FEATURE_ONDO=false — ondo_usdy disabled");
        return Ok(());
    }

    // Find USDY asset config to extract oracle pubkey.
    let asset = state.assets.assets.iter().find(|a| a.symbol == "USDY");
    let oracle_pk = match asset.map(|a| &a.intrinsic) {
        Some(pegana_common::IntrinsicStrategy::OndoUsdyOracle { oracle }) => {
            Pubkey::from_str(oracle).context("invalid oracle pubkey")?
        }
        _ => {
            warn!("USDY not configured with ondo_usdy_oracle intrinsic — adapter idle");
            return Ok(());
        }
    };

    let cadence = state.config.ondo_poll_ms.unwrap_or(30_000);
    let mut tick = interval(Duration::from_millis(cadence));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    info!(cadence_ms = cadence, oracle = %oracle_pk, "ondo_usdy source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => return Ok(()),
        }
        if let Err(e) = poll_once(&state, &oracle_pk).await {
            warn!(error = %e, "ondo_usdy poll failed");
            metrics::counter!("pegana_ondo_polls_total", "status" => "error").increment(1);
        } else {
            metrics::counter!("pegana_ondo_polls_total", "status" => "ok").increment(1);
        }
    }
}

async fn poll_once(state: &AppState, oracle_pk: &Pubkey) -> Result<()> {
    let started = std::time::Instant::now();
    let account = state.rpc.get_account(oracle_pk).await?;
    let nav = decode_oracle(&account.data)?;
    metrics::histogram!("pegana_ondo_latency_seconds").record(started.elapsed().as_secs_f64());

    let ts = chrono::Utc::now();
    let meta = serde_json::json!({ "oracle": oracle_pk.to_string(), "raw_bytes": account.data.len() });

    sinks::postgres::insert_intrinsic(&state.pg, "USDY", nav, "ondo", meta.clone(), None, ts).await?;

    let payload = serde_json::json!({
        "asset": "USDY",
        "value_usd": nav,
        "source": "ondo",
        "meta": meta,
        "ts": ts,
    });
    sinks::redis_pub::publish(state.redis.clone(), pegana_common::channels::SRC_ONDO, &payload).await?;
    Ok(())
}
```

- [ ] **Step 6: Register the source module and spawn it in main**

Modify `crates/indexer-rs/src/sources/mod.rs`:
```rust
pub mod hylo;
pub mod jupiter;
pub mod ondo_usdy;  // NEW
pub mod pyth;
pub mod sanctum;
```

In `crates/indexer-rs/src/main.rs`, find where existing sources are spawned (e.g., `tokio::spawn(sources::hylo::run(state.clone(), shutdown.clone()))`). Add:
```rust
tokio::spawn(sources::ondo_usdy::run(state.clone(), shutdown.clone()));
```

- [ ] **Step 7: Add `feature_ondo` and `ondo_poll_ms` to indexer config**

Modify `crates/indexer-rs/src/config.rs`. Find existing `feature_hylo` field, add alongside:
```rust
#[serde(default = "default_true")]
pub feature_ondo: bool,
pub ondo_poll_ms: Option<u64>,
```

(Use the same `default_true` helper if it exists; if not, copy its definition from how `feature_hylo` is wired.)

- [ ] **Step 8: Mainnet smoke test**

Run the indexer locally for 30 minutes:

```bash
cargo run -p indexer-rs --release 2>&1 | tee /tmp/ondo-smoke.log
```

Watch for log lines: `ondo_usdy source ready` then periodic poll metrics. Cross-check the persisted `intrinsic_snapshots` row vs Ondo's public dashboard:

```sql
SELECT asset, value_usd, ts FROM intrinsic_snapshots
WHERE asset='USDY' ORDER BY ts DESC LIMIT 3;
```

Compare to https://ondo.finance/usdy — discrepancy must be ≤ 5 bps. If not, the decode is wrong. Iterate on `decode_oracle` until the smoke matches.

- [ ] **Step 9: Commit**

```bash
git add crates/indexer-rs/src/sources/ondo_usdy.rs \
        crates/indexer-rs/src/sources/mod.rs \
        crates/indexer-rs/src/main.rs \
        crates/indexer-rs/src/config.rs \
        crates/indexer-rs/fixtures/ondo/usdy-account.json \
        crates/common/src/lib.rs
git commit -m "feat(indexer): add Ondo USDY adapter — on-chain NAV oracle decode

Reads USDY's price oracle on a 30s tick, persists USD NAV, publishes
to pegana:src:ondo. Fixture-based decode test asserts ≤5bps drift
from Ondo's public dashboard at capture time.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Implement `solayer_susd` adapter

**Files:**
- Create: `crates/indexer-rs/src/sources/solayer_susd.rs`
- Modify: `crates/indexer-rs/src/sources/mod.rs`
- Modify: `crates/indexer-rs/src/main.rs`
- Modify: `crates/indexer-rs/src/config.rs`
- Modify: `crates/common/src/lib.rs` (add `SRC_SOLAYER`)
- Create: `crates/indexer-rs/fixtures/solayer/susd-share-account.json`

Follow the **exact same shape** as Task 4. Key differences for sUSD:

- [ ] **Step 1: Add `SRC_SOLAYER` channel constant** (`crates/common/src/lib.rs`, channels module): `pub const SRC_SOLAYER: &str = "pegana:src:solayer";`

- [ ] **Step 2: Capture share-account fixture**

```bash
solana account <SOLAYER_SHARE_ACCOUNT> --url mainnet-beta --output json > crates/indexer-rs/fixtures/solayer/susd-share-account.json
```

Solayer sUSD is a **rebasing** token — its NAV per share is encoded in a share-rate account or via a Token-2022 interest-bearing extension. Read https://docs.solayer.org/assets/susd to confirm exact mechanism.

If sUSD uses Token-2022 InterestBearing extension, the rate is in the mint's extensions, not a separate account. In that case, the decode reads from the mint account directly using `spl-token-2022` crate's interest-bearing parsing (`spl_token_2022::extension::interest_bearing_mint::InterestBearingConfig`).

- [ ] **Step 3: Write failing decode test** (same pattern as Task 4 Step 3; expected NAV from Solayer's dashboard)

- [ ] **Step 4: Implement `decode_share_rate`**

If rebasing-via-extension:

```rust
pub fn decode_share_rate(mint_data: &[u8]) -> Result<Decimal> {
    use spl_token_2022::extension::{interest_bearing_mint::InterestBearingConfig, StateWithExtensions};
    use spl_token_2022::state::Mint;

    let state = StateWithExtensions::<Mint>::unpack(mint_data)?;
    let ib_config = state.get_extension::<InterestBearingConfig>()?;
    // Convert basis-point rate + elapsed seconds to current share rate.
    // Formula from spl-token-2022 docs.
    todo!("compute current rate from ib_config")
}
```

If share-account-based: pattern identical to Task 4 Step 4.

- [ ] **Step 5–9: same as Task 4** — runtime adapter, mod registration, main spawn, config field (`feature_solayer`/`solayer_poll_ms`), mainnet smoke (cross-check https://solayer.org/susd), commit

---

### Task 6: Implement `streamflow_usd_plus` adapter

**Files:**
- Create: `crates/indexer-rs/src/sources/streamflow_usd_plus.rs`
- Same set of modifications as Tasks 4–5
- Channel constant: `SRC_STREAMFLOW`
- Cadence: **60s** (NAV updates daily — no point polling faster)
- Max staleness check: alert if `publish_time > 26h` ago

Follow the Task 4 structure. The decode is similar to Ondo (oracle pattern). The key difference: implement a **staleness check** in `poll_once`:

```rust
const MAX_STALENESS_SECS: i64 = 26 * 3600;

async fn poll_once(state: &AppState, oracle_pk: &Pubkey) -> Result<()> {
    let account = state.rpc.get_account(oracle_pk).await?;
    let (nav, publish_time) = decode_oracle_with_ts(&account.data)?;

    let age = chrono::Utc::now().timestamp() - publish_time;
    if age > MAX_STALENESS_SECS {
        warn!(age_secs = age, "streamflow USD+ oracle stale > 26h — skipping publish");
        metrics::counter!("pegana_streamflow_stale_skips_total").increment(1);
        return Ok(());
    }
    // ... persist + publish as Task 4
}
```

Commit message ends with "honors max_staleness=26h on the daily-update oracle."

---

## Week 3: PDA-based adapters (3 tasks)

These read structured on-chain accounts via Borsh-style decode. Each requires fetching the issuer's IDL or program account schema.

### Task 7: Implement `maple_syrup` adapter

**Files:**
- Create: `crates/indexer-rs/src/sources/maple_syrup.rs`
- Same set of modifications as Tasks 4–6
- Channel constant: `SRC_MAPLE`

- [ ] **Step 1: Fetch Maple program IDL**

```bash
anchor idl fetch <MAPLE_PROGRAM_ID> --provider.cluster mainnet > /tmp/maple.idl.json
```

If `anchor idl fetch` fails (program not Anchor or no IDL published), inspect Maple's GitHub for type definitions: https://github.com/maple-finance.

Find the Pool account type. Identify fields representing:
- Total assets (TVL in underlying)
- Total shares supply
- NAV per share (sometimes computed as `total_assets / total_supply`)

- [ ] **Step 2: Capture pool fixture**

```bash
solana account <MAPLE_POOL_PDA> --url mainnet-beta --output json > crates/indexer-rs/fixtures/maple/pool-account.json
```

- [ ] **Step 3: Define Borsh struct matching the layout**

```rust
use borsh::BorshDeserialize;

#[derive(BorshDeserialize, Debug)]
struct MaplePool {
    // Adjust fields to match actual IDL — these are placeholders
    discriminator: [u8; 8],
    total_assets: u64,
    total_shares: u64,
    // ... other fields
}
```

- [ ] **Step 4: Write failing decode test** (same shape as Task 4)

Cross-reference expected NAV from https://app.maple.finance pool detail page at capture time.

- [ ] **Step 5: Implement `decode_nav`** computing `total_assets / total_shares × 1 USDC`

- [ ] **Step 6: Add `expected_layout_hash()` function**

This is required for IDL drift protection (per spec §4.4):

```rust
pub const EXPECTED_LAYOUT_HASH: [u8; 32] = [
    // SHA-256 of the IDL JSON we captured in Step 1
    // Generate with: sha256sum /tmp/maple.idl.json
    0x00, // ... 32 bytes
];

pub fn expected_layout_hash() -> [u8; 32] { EXPECTED_LAYOUT_HASH }
```

- [ ] **Step 7–10: same as Task 4** — runtime adapter, mod registration, main spawn, config (`feature_maple`/`maple_poll_ms`), mainnet smoke (≤5bps vs Maple dashboard), commit.

---

### Task 8: Implement `onre_onyc` adapter

Same pattern as Task 7. Key differences:
- IDL source: OnRe's docs site or GitHub
- Cadence: **60s** (NAV updates infrequently)
- Cross-check NAV at https://app.rwa.xyz/assets/ONyc

---

### Task 9: Implement `ethena_susde` adapter

Same pattern as Task 7. Key wrinkles for Ethena sUSDe:
- It's **bridged** to Solana via Wormhole NTT or similar. Confirm the bridge type from Ethena docs.
- The "intrinsic" share rate is on **Ethereum**, not Solana. The Solana mint typically has an attestation/oracle that mirrors the Ethereum rate.
- Cross-check the Solana-derived rate against Ethena's Ethereum oracle (https://ethena.fi). If the Solana attestation lags by > 10bps, set asset `state = UNKNOWN` and emit Sentry alert (per spec R16).

```rust
async fn poll_once(state: &AppState, ...) -> Result<()> {
    let solana_rate = read_solana_attestation(...).await?;
    let ethereum_rate = read_ethena_eth_oracle(...).await?;  // via HTTPS, cached 5min

    let drift_bps = ((solana_rate - ethereum_rate) / ethereum_rate * Decimal::from(10_000)).abs();
    if drift_bps > Decimal::from(10) {
        warn!(drift_bps = %drift_bps, "ethena sUSDe Solana<>Ethereum rate diverged > 10bps");
        metrics::counter!("pegana_ethena_drift_alerts_total").increment(1);
        // continue and publish anyway, but flag low_confidence in meta
    }
    // ...
}
```

---

## Week 4: Complex adapters (2 tasks)

### Task 10: Implement `perena_usdstar` adapter (multi-underlying pool)

**Files:**
- Create: `crates/indexer-rs/src/sources/perena_usdstar.rs`
- Same set of modifications
- Channel constant: `SRC_PERENA`

This is the most complex adapter because USD* is **not a single-rate asset** — it's an LP token of a pool containing USDC, USDT, PYUSD. NAV calculation:

```
USD*_nav_usd = (Σ underlying_balance × underlying_usd_price) / usd_star_supply
```

- [ ] **Step 1: Fetch Numéraire pool layout**

Inspect the SDK source code published at https://www.npmjs.com/package/@perena/numeraire-sdk. Look at the Pool type and the seed-pool PDA derivation.

Pool fields you need:
- Total LP supply (USD* supply)
- Balance of each underlying (3 token accounts)
- Pool composition weights (if dynamic)

- [ ] **Step 2: Capture fixtures**

```bash
mkdir -p crates/indexer-rs/fixtures/perena
solana account <PERENA_POOL_PDA> --url mainnet-beta --output json > crates/indexer-rs/fixtures/perena/pool.json
solana account <USDC_TOKEN_ACCOUNT_OF_POOL> --url mainnet-beta --output json > crates/indexer-rs/fixtures/perena/usdc-vault.json
solana account <USDT_TOKEN_ACCOUNT_OF_POOL> --url mainnet-beta --output json > crates/indexer-rs/fixtures/perena/usdt-vault.json
solana account <PYUSD_TOKEN_ACCOUNT_OF_POOL> --url mainnet-beta --output json > crates/indexer-rs/fixtures/perena/pyusd-vault.json
```

- [ ] **Step 3: Define Borsh structs for Pool + use `spl_token::state::Account` for the 3 token accounts**

- [ ] **Step 4: Write failing decode test** asserting:

```rust
let pool_nav = decode_pool(...).unwrap();
let underlying_usds = [
    decode_token_account(&usdc_data).unwrap().amount as Decimal / 10^6,  // USDC = $1
    decode_token_account(&usdt_data).unwrap().amount as Decimal / 10^6,
    decode_token_account(&pyusd_data).unwrap().amount as Decimal / 10^6,
];
let total_underlying_usd = underlying_usds.iter().sum::<Decimal>();
let nav_per_lp = total_underlying_usd / pool.lp_supply;

// Invariant test (spec R17): pool USD value × LP supply must equal total
// underlying value within 1 bp.
let diff_bps = ((nav_per_lp * pool.lp_supply - total_underlying_usd) / total_underlying_usd * 10_000).abs();
assert!(diff_bps < Decimal::ONE, "pool invariant violated by {diff_bps} bps");
```

- [ ] **Step 5: Implement the multi-account fetch + decode**

The runtime fetches 4 accounts per poll (pool + 3 vaults). Use `RpcClient::get_multiple_accounts` for one round-trip:

```rust
async fn poll_once(state: &AppState, pool_pk: &Pubkey, vaults: &[Pubkey; 3]) -> Result<()> {
    let mut keys = vec![*pool_pk];
    keys.extend_from_slice(vaults);
    let accounts = state.rpc.get_multiple_accounts(&keys).await?;
    // accounts[0] = pool, accounts[1..4] = vaults
    // ...
}
```

- [ ] **Step 6–9: same as previous adapters** (channel constant, runtime adapter, mod registration, smoke, commit)

Cross-check: visit https://app.perena.org/ and find the pool detail page showing TVL — divide TVL by USD* supply to compare. Tolerance ≤ 5 bps.

---

### Task 11: Implement `piggybank_pb_vault` adapter

Same complexity tier as Task 7 (single-account Borsh decode), but with **less public documentation** — pb-vaults are not widely covered.

- [ ] **Step 1: Research vault program**

Visit https://www.piggybank.fi/ and inspect their app's JavaScript bundle (DevTools → Sources → search "Program" or "vault"). Identify:
- Vault program ID
- Vault PDA derivation (likely `seeds = [b"vault", strategy_id]`)
- NAV field in the vault account

If the program is open-source on GitHub (search "github piggybank-fi"), use that instead.

- [ ] **Step 2: Capture fixture**

```bash
solana account <PB_USDC_VAULT_PDA> --url mainnet-beta --output json > crates/indexer-rs/fixtures/piggybank/pbusdc-vault.json
```

- [ ] **Step 3–8: same as Task 7**

Cross-check NAV: in Piggybank app, deposit page shows "share price" or "NAV per pb-token". Smoke tolerance ≤ 5 bps.

If the vault doesn't expose NAV directly but does expose `total_assets` and `total_shares`, derive NAV the same way as Maple (Task 7).

---

## Week 5: Engine, dispatcher, frontend, bot, docs (8 tasks)

### Task 12: Extend engine `recompute` to handle StableYield with variable NAV

**Files:**
- Modify: `crates/engine-rs/src/main.rs` (find recompute logic — search `recompute` or `discount`)

- [ ] **Step 1: Locate discount calculation**

Run: `grep -n "discount\|recompute" crates/engine-rs/src/main.rs | head -20`

Expected: lines around the calculation `1 - market/intrinsic`. Read 30 lines of context.

- [ ] **Step 2: Confirm StableYield is already handled (or add the branch)**

The engine probably already treats every class uniformly because it gets `intrinsic_usd` as input from the source. If so, **no change needed** — the new adapters publish `IntrinsicReading` with `value_usd = NAV`, and the engine computes `1 - market/NAV` exactly as it does for `sHYUSD` today.

If the engine has class-specific hardcoded intrinsic (only `StableFiat` → $1), add the explicit branch:

```rust
let intrinsic_usd = match asset.class {
    AssetClass::StableFiat => Decimal::ONE,  // hardcoded $1
    _ => latest_intrinsic.value_usd,         // read from source
};
```

- [ ] **Step 3: Add engine integration test**

Create `crates/engine-rs/tests/yield_bearing.rs`:

```rust
use pegana_common::*;
use rust_decimal::Decimal;
use rust_decimal::prelude::FromStr;

#[test]
fn yield_bearing_discount_uses_nav_not_one_dollar() {
    // Simulate USDY: NAV = 1.0843, market = 1.0801
    // Expected discount = 1 - (1.0801 / 1.0843) ≈ 38.7 bps
    let nav = Decimal::from_str("1.0843").unwrap();
    let market = Decimal::from_str("1.0801").unwrap();
    let discount = Decimal::ONE - (market / nav);
    let bps = discount * Decimal::from(10_000);
    let expected = Decimal::from_str("38.7").unwrap();
    let diff = (bps - expected).abs();
    assert!(diff < Decimal::from_str("0.5").unwrap(),
        "discount {bps} bps differs from expected {expected} bps");
}
```

Run: `cargo test -p engine-rs yield_bearing`
Expected: PASS.

- [ ] **Step 4: Smoke test in dev — feed real USDY data and watch engine compute**

Start indexer + engine locally with the dev compose. Watch logs for `engine recomputed asset=USDY discount_bps=...`. Cross-check the value against (1 - market_jupiter_quote/NAV_from_intrinsic_snapshots).

- [ ] **Step 5: Commit**

```bash
git add crates/engine-rs/
git commit -m "feat(engine): explicit StableYield handling for variable-NAV assets

Engine already supports the model implicitly via shared IntrinsicReading
publishing; this adds an integration test asserting the discount formula
matches a hand-calculated USDY example.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Extend dispatcher payload formatter for yield-bearing alerts

**Files:**
- Modify: `crates/dispatcher-rs/src/format.rs`

- [ ] **Step 1: Read existing format functions**

Run: `cat crates/dispatcher-rs/src/format.rs`

Expected: per-class formatter functions (LST, stable_fiat, etc.). Identify the pattern.

- [ ] **Step 2: Add `format_yield_bearing` function**

```rust
pub fn format_yield_bearing(evt: &AlertEvent, asset_name: &str) -> String {
    use rust_decimal::prelude::ToPrimitive;
    let nav_bps = ((evt.market_usd - evt.intrinsic_usd) / evt.intrinsic_usd * Decimal::from(10_000))
        .to_f64()
        .unwrap_or(0.0);
    let state_emoji = match evt.to_state {
        PegState::Pegged => "🟢",
        PegState::Drift => "🟡",
        PegState::Depeg => "🟠",
        PegState::Critical => "🔴",
        PegState::BlackSwan => "⚫",
        PegState::Unknown => "❓",
    };
    format!(
        "{state_emoji} *{asset_name}* — {from} → {to}\n\
         NAV: ${nav:.4} · Market: ${market:.4}\n\
         Discount: {disc:+.1} bps (yield-bearing — discount to NAV)\n\
         {timestamp}",
        state_emoji = state_emoji,
        asset_name = asset_name,
        from = format!("{:?}", evt.from_state),
        to = format!("{:?}", evt.to_state),
        nav = evt.intrinsic_usd,
        market = evt.market_usd,
        disc = nav_bps,
        timestamp = evt.detected_at.format("%Y-%m-%d %H:%M UTC"),
    )
}
```

- [ ] **Step 3: Wire into the dispatcher's `format_alert` selector**

In `format.rs` find the function that selects format by `class`. Add the `StableYield` branch — if asset symbol is `sHYUSD` keep existing Hylo-aware format (stability-pool semantics); for all other StableYield assets use `format_yield_bearing`.

- [ ] **Step 4: Unit test**

Add to `crates/dispatcher-rs/src/format.rs` (or a test module):

```rust
#[test]
fn yield_bearing_alert_renders_nav_and_discount() {
    let evt = AlertEvent {
        id: uuid::Uuid::nil(),
        asset: "USDY".to_string(),
        class: AssetClass::StableYield,
        peg_target: PegTarget::USD,
        from_state: PegState::Pegged,
        to_state: PegState::Drift,
        discount: Decimal::from_str("0.00387").unwrap(),
        intrinsic_usd: Decimal::from_str("1.0843").unwrap(),
        market_usd: Decimal::from_str("1.0801").unwrap(),
        extra: serde_json::json!({}),
        detected_at: chrono::Utc::now(),
    };
    let out = format_yield_bearing(&evt, "Ondo USD Yield");
    assert!(out.contains("USDY") || out.contains("Ondo"));
    assert!(out.contains("1.0843"));
    assert!(out.contains("1.0801"));
    assert!(out.contains("yield-bearing"));
}
```

Run: `cargo test -p dispatcher-rs format::tests::yield_bearing_alert_renders_nav_and_discount`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher-rs/src/format.rs
git commit -m "feat(dispatcher): yield-bearing alert formatter shows NAV + discount-to-NAV

New format_yield_bearing renders the 'market vs NAV' discount semantic
that 7 of 8 new yield-bearing stables produce. Keeps sHYUSD on its
Hylo-aware existing formatter.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: Extend web `asset-card` molecule to render NAV for StableYield class

**Files:**
- Modify: `web/components/molecules/asset-card.tsx`

- [ ] **Step 1: Read existing component**

Run: `cat web/components/molecules/asset-card.tsx`

Identify where peg/price/state are rendered.

- [ ] **Step 2: Add conditional NAV rendering**

Use the existing `class` field on the asset model to switch rendering:

```tsx
{asset.class === "stable_yield" ? (
  <>
    <div className="text-sm text-text-muted">NAV</div>
    <div className="text-lg font-semibold tabular-nums">
      ${formatPrice(intrinsicUsd, 4)}
    </div>
    <div className="text-xs text-text-muted">
      {marketDiscountBps > 0 ? "+" : ""}{marketDiscountBps.toFixed(1)} bps · vs NAV
    </div>
  </>
) : (
  // existing peg rendering
)}
```

- [ ] **Step 3: Add Vitest unit test**

In `web/tests/unit/asset-card.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { AssetCard } from "@/components/molecules/asset-card";
import { describe, it, expect } from "vitest";

describe("AssetCard yield-bearing variant", () => {
  it("renders NAV instead of peg for stable_yield class", () => {
    const asset = {
      symbol: "USDY",
      name: "Ondo USD Yield",
      class: "stable_yield" as const,
      state: "PEGGED" as const,
      intrinsic_usd: "1.0843",
      market_usd: "1.0801",
      discount: "0.00387",
    };
    const { container } = render(<AssetCard asset={asset} />);
    expect(container.textContent).toContain("NAV");
    expect(container.textContent).toContain("1.0843");
    expect(container.textContent).toContain("bps");
  });
});
```

Run: `cd web && bun test asset-card`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/components/molecules/asset-card.tsx web/tests/unit/asset-card.test.tsx
git commit -m "feat(web): asset-card renders NAV + discount-to-NAV for stable_yield

Yield-bearing stables (USDY, sUSDe, syrupUSDC, sUSD, USD*, ONyc, pbUSDC,
USD+) get a distinct card layout: 'NAV: \$X.XXXX' instead of 'Peg: \$1.00',
with the discount labeled 'vs NAV' to differentiate from fiat-peg drift.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: Add "Yield-bearing" filter to dashboard

**Files:**
- Modify: `web/components/organisms/dashboard-filters.tsx`

- [ ] **Step 1: Locate the class filter** in `dashboard-filters.tsx`. It's likely an enum/dropdown.

- [ ] **Step 2: Add "Yield-bearing" option** that filters by `class === "stable_yield"`. Match the styling of existing options (LST, Stable, etc.).

- [ ] **Step 3: Smoke test in dev server**

```bash
cd web && bun run dev
```

Visit `http://localhost:3000/dashboard`, click "Yield-bearing" filter. Verify only `sHYUSD` + the 8 new yield-bearing assets appear.

- [ ] **Step 4: Commit**

```bash
git add web/components/organisms/dashboard-filters.tsx
git commit -m "feat(web): dashboard filter adds 'Yield-bearing' option

Filters universe to stable_yield class assets. Currently isolates the
10 yield-bearing assets (sHYUSD + 8 new + 1 reserved hyUSD wrapper).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 16: Add `yieldSources` glossary + render "Yield source" section on asset hero

**Files:**
- Modify: `web/lib/glossary.ts`
- Modify: `web/components/organisms/asset-hero.tsx`

- [ ] **Step 1: Append 8 yield source entries to `lib/glossary.ts`**

```ts
export const yieldSources: Record<string, {
  mechanism: string;
  description: string;
  link: string;
  risks: string;
}> = {
  USDY: {
    mechanism: "T-bills",
    description: "Ondo holds short-term U.S. Treasury bills and high-quality bank deposits, accruing yield automatically.",
    link: "https://ondo.finance/usdy",
    risks: "Treasury market shock; Ondo issuer credit; bridge attestation lag for non-Ethereum chains.",
  },
  sUSDe: {
    mechanism: "Funding-rate arbitrage",
    description: "Ethena holds delta-neutral positions across perp DEXs to earn funding rates while staying delta-zero.",
    link: "https://ethena.fi",
    risks: "Negative funding regime; centralized custody of perp collateral; Solana-side attestation lag vs Ethereum source rate.",
  },
  syrupUSDC: {
    mechanism: "Institutional lending",
    description: "Maple lends pooled USDC to KYC'd institutional borrowers at over-collateralized fixed rates.",
    link: "https://app.maple.finance",
    risks: "Borrower default; collateral price shock; liquidity window during withdrawals.",
  },
  sUSD: {
    mechanism: "T-bills + restaking MEV",
    description: "Solayer holds T-bills (via OpenEden) and earns additional yield from MEV captured by its restaking infrastructure.",
    link: "https://solayer.org/susd",
    risks: "T-bill market shock; restaking slashing; MEV regime change.",
  },
  "USD*": {
    mechanism: "Multi-stable pool",
    description: "Perena's Numéraire seed pool combines USDC + USDT + PYUSD into a single LP token, earning AMM fees + redirected yield from underlying stables.",
    link: "https://app.perena.org",
    risks: "Underlying stable depeg; pool composition skew under stress; LP fee compression.",
  },
  ONyc: {
    mechanism: "Reinsurance",
    description: "OnRe collateralizes short-duration reinsurance contracts; NAV reflects underwriting performance + collateral yield.",
    link: "https://onre.finance",
    risks: "Catastrophic claim event; underwriting cycle reversal; NAV is not pegged to \$1 by design.",
  },
  pbUSDC: {
    mechanism: "Funding-rate arbitrage (multi-DEX)",
    description: "Piggybank runs delta-neutral funding-rate arbitrage across ~10 perp DEXs with automated risk management.",
    link: "https://www.piggybank.fi",
    risks: "Funding regime shift; DEX-side exploit exposure (cf. April 2026 Drift incident); strategy unwind under stress.",
  },
  "USD+": {
    mechanism: "T-bills (daily NAV)",
    description: "Streamflow's T-bill backed stable that pays yield daily via NAV update.",
    link: "https://streamflow.finance",
    risks: "Treasury market shock; daily NAV oracle staleness; redemption queue under heavy outflows.",
  },
};
```

- [ ] **Step 2: Render a "Yield source" card in `asset-hero.tsx` when class === "stable_yield"**

After existing mechanism section, add:

```tsx
{asset.class === "stable_yield" && yieldSources[asset.symbol] && (
  <section className="border border-hairline p-6 mt-8">
    <h2 className="text-sm uppercase tracking-widest text-text-muted">Yield source</h2>
    <div className="mt-3 text-lg font-medium">{yieldSources[asset.symbol].mechanism}</div>
    <p className="mt-2 text-text-muted leading-relaxed">{yieldSources[asset.symbol].description}</p>
    <div className="mt-4 text-sm">
      <span className="text-text-muted">Key risks: </span>
      <span>{yieldSources[asset.symbol].risks}</span>
    </div>
    <a
      href={yieldSources[asset.symbol].link}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-block text-sm underline"
    >
      Issuer documentation →
    </a>
  </section>
)}
```

- [ ] **Step 3: Smoke test** — visit `/asset/USDY`, `/asset/pbUSDC`, etc. and confirm the section renders.

- [ ] **Step 4: Commit**

```bash
git add web/lib/glossary.ts web/components/organisms/asset-hero.tsx
git commit -m "feat(web): asset detail shows 'Yield source' section for stable_yield

8 new entries in lib/glossary.ts describing each issuer's mechanism,
key risks, and documentation link. Renders on /asset/[symbol] for any
asset with class=stable_yield.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 17: Add 8 `/explain` entries + locales to bot

**Files:**
- Modify: `bot-ts/locales/en.ftl`
- Modify: `bot-ts/locales/pt-BR.ftl`
- Modify: `bot-ts/src/commands/explain.ts` (or wherever /explain is implemented)

- [ ] **Step 1: Read existing explain command + locale entries**

Run: `grep -rn "explain" bot-ts/src/ bot-ts/locales/`

Expected: existing entries like `explain-jitoSOL`, `explain-hyUSD`.

- [ ] **Step 2: Add 8 entries to `bot-ts/locales/en.ftl`**

```ftl
explain-USDY = USDY (Ondo USD Yield) is backed by short-term U.S. Treasury bills. Yield accrues automatically as the NAV grows daily. Key risk: Treasury market shock or issuer credit.
explain-sUSDe = sUSDe (Staked USDe) earns from Ethena's delta-neutral funding-rate strategy across perp DEXs. The Solana mint is bridged from Ethereum — share rate may lag the source by minutes.
explain-syrupUSDC = syrupUSDC is Maple's lending pool LP token. USDC is lent to KYC'd institutional borrowers at over-collateralized fixed rates. Withdrawals have a liquidity window.
explain-sUSD = sUSD (Solayer USD) holds T-bills via OpenEden and earns additional yield from MEV captured by Solayer's restaking infrastructure. Rebasing token.
explain-USDStar = USD* (Perena) is an LP token of a pool combining USDC, USDT, and PYUSD via the Numéraire AMM. NAV grows from AMM fees + redirected underlying yield.
explain-ONyc = ONyc (OnRe) collateralizes short-duration reinsurance contracts. NAV reflects underwriting performance — it is intentionally NOT pegged to $1, just yield-bearing.
explain-pbUSDC = pbUSDC (Piggybank) runs delta-neutral funding-rate arbitrage across ~10 perp DEXs. NAV grows from funding spreads. Risk: DEX-side exploits (cf. April 2026 Drift incident).
explain-USDPlus = USD+ (Streamflow) is a T-bill backed stable that pays yield via daily NAV update. The oracle may lag by up to 26h — alerts respect that staleness.
```

- [ ] **Step 3: Translate to `bot-ts/locales/pt-BR.ftl`** — equivalent content in Brazilian Portuguese. Follow style of existing PT entries.

- [ ] **Step 4: Wire new keys into the explain command**

In `bot-ts/src/commands/explain.ts` (or wherever), the command likely looks up `explain-<symbol>` directly from the locale. If so, no code change — just ensure symbols `USDY`, `sUSDe`, etc. are mapped to the correct locale keys (handle the `*` and `+` chars: `USD*` → `USDStar`, `USD+` → `USDPlus`).

If a symbol→key mapping table exists, add the 8 new entries.

- [ ] **Step 5: Smoke test bot locally**

```bash
cd bot-ts && bun run dev
# Open Telegram, send /explain USDY
```

Expected: bot responds with the USDY entry. Switch locale (`/lang pt`) and test PT version.

- [ ] **Step 6: Commit**

```bash
git add bot-ts/
git commit -m "feat(bot): 8 new /explain entries for yield-bearing stables (PT + EN)

USDY, sUSDe, syrupUSDC, sUSD, USD*, ONyc, pbUSDC, USD+ — explanations
cover mechanism + key risks, mirroring the web glossary.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 18: Extend IDL drift cron to cover new programs

**Files:**
- Modify: existing IDL drift cron (location TBD — search the codebase)

- [ ] **Step 1: Find existing IDL drift logic**

Run: `grep -rn "idl\|expected_layout_hash" crates/ | head -20`

This was added in Epic 5 (Hylo coverage). Read the implementation. It likely:
1. Lists programs with hardcoded `expected_layout_hash` constants
2. Fetches each via `anchor idl fetch` hourly
3. Computes SHA-256 and compares
4. Alerts Sentry on mismatch

- [ ] **Step 2: Register 6 new programs in the drift cron**

For each new adapter that decodes a program account (Maple, Solayer, OnRe, Piggybank, Streamflow, Perena), add an entry mapping `program_id → expected_layout_hash`.

Ondo and Ethena adapters may not need IDL drift checks if they're oracle-only (no Borsh struct decode) — confirm per adapter and skip if so.

- [ ] **Step 3: Run the drift cron once locally to confirm all new programs resolve**

Run the binary (or the relevant test) that triggers the drift check. Expected: all 6 programs return the expected hash. If any return a different hash, you captured the wrong hash earlier — update.

- [ ] **Step 4: Commit**

```bash
git add crates/
git commit -m "feat(idl-drift): extend cron to cover 6 new programs

Adds Maple, Solayer, OnRe, Piggybank, Streamflow, Perena programs to
the hourly IDL drift check. Each program's expected_layout_hash is
captured at fixture-snapshot time. Drift → Sentry alert + affected
assets set to state=UNKNOWN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 19: Update README.md + ROADMAP.md to reflect 32-asset universe

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update README.md asset count and table**

In `README.md`:
- Line 11: `"...14 assets on Solana mainnet..."` → `"...32 assets on Solana mainnet..."`
- Lines 14-21 (the "What it covers" section): expand the LST line to include the 6 new and add a new "Yield-bearing stables" section listing the 8 new + sHYUSD.

Result:

```markdown
## What it covers (v1)

**15 Liquid Staking Tokens** — pegged to SOL via stake pool accounting
`jitoSOL` · `mSOL` · `bSOL` · `INF` · `dSOL` · `bbSOL` · `JupSOL` · `vSOL` · `compassSOL` · `BNSOL` · `picoSOL` · `kySOL` · `hSOL` · `hyloSOL` · `hyloSOL+`

**6 Stablecoins** — pegged to USD/BRL with different mechanisms
`USDC` · `USDT` · `PYUSD` (Token-2022) · `USDe` (delta-neutral) · `USDS` (CDP+RWA) · `BRZ` (BRL fiat)

**10 Yield-bearing stables** — NAV-based, peg-to-NAV not peg-to-\$1
`hyUSD` (LST-CDP) · `sHYUSD` · `USDY` · `sUSDe` · `syrupUSDC` · `sUSD` · `USD*` · `ONyc` · `pbUSDC` · `USD+`

**1 Synthetic leverage** — variable-leverage exposure (Hylo xSOL)
```

- [ ] **Step 2: Update ROADMAP.md**

In `ROADMAP.md`:
- "Current state" table: bump `assets.toml` line count (will be ~350 lines after additions)
- Risk register: append R13-R18 from the spec
- "Out of scope for v1" + "v1.5 backlog": remove items that moved into Phase A; add wallet-connect dashboard as Phase B

- [ ] **Step 3: Commit**

```bash
git add README.md ROADMAP.md
git commit -m "docs: README + ROADMAP reflect 32-asset universe + Phase A complete

- README counts updated to 15 LSTs / 6 stables / 10 yield-bearing / 1 synth
- ROADMAP risk register gets R13-R18 (layout drift, NAV staleness, bridge
  mismatch, pool invariant)
- v1.5 backlog items pulled into Phase A removed; Phase B (wallet-connect)
  added

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 20: Full E2E integration test — run all 14 new assets against mainnet for 1h

This is the **Definition of Done** gate. No code change, just verification.

- [ ] **Step 1: Start the full local stack**

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
cargo run -p indexer-rs --release &
cargo run -p engine-rs --release &
cargo run -p api-rs --release &
cd web && bun run dev &
```

- [ ] **Step 2: Wait 1 hour, then capture metrics**

Run after 1h:

```sql
-- Connect to Postgres
psql postgres://pegana:pegana@localhost:5433/pegana

-- Confirm intrinsic snapshots exist for all 14 new assets
SELECT asset, count(*) FROM intrinsic_snapshots
WHERE asset IN ('vSOL', 'compassSOL', 'BNSOL', 'picoSOL', 'kySOL', 'hSOL',
                'USDY', 'sUSDe', 'syrupUSDC', 'sUSD', 'USD*', 'ONyc', 'pbUSDC', 'USD+')
AND ts > NOW() - INTERVAL '1 hour'
GROUP BY asset ORDER BY asset;

-- Each should show at least 50 rows (60 min / 60-90s typical cadence)
-- pbUSDC and ONyc are at 60s cadence → ~60 rows
-- Others at 30s → ~120 rows

-- Confirm engine produced discount snapshots for all 14
SELECT asset, count(*) FROM discount_snapshots
WHERE asset IN (...)
AND ts > NOW() - INTERVAL '1 hour'
GROUP BY asset;
```

- [ ] **Step 3: Visit /dashboard and verify all 32 assets are visible**

Open `http://localhost:3000/dashboard`. Click "Yield-bearing" filter — 10 assets. Click "LST" — 15. Total 32.

- [ ] **Step 4: For each of the 8 yield-bearing stables, visit /asset/[symbol] and verify:**
  - NAV displays correctly (matches issuer's public dashboard within 5 bps)
  - Discount-to-NAV displays with correct sign
  - "Yield source" section renders with mechanism + risks
  - History chart shows at least 50 data points

- [ ] **Step 5: Send /explain <symbol> in Telegram for each new asset**

For both EN and PT-BR locale. Expected: bot returns correct localized text for all 8.

- [ ] **Step 6: Document evidence**

Create `docs/phase-a-completion-evidence.md` with:
- Screenshot of /dashboard showing 32 assets
- Screenshot of /asset/USDY (or any yield-bearing) showing NAV section
- SQL output from Step 2 showing all 14 new assets producing snapshots
- Comparison table: for each new asset, NAV from Pegana vs NAV from issuer dashboard (with delta in bps)

If any asset's delta > 5 bps, **STOP** and fix the adapter before declaring Phase A complete.

- [ ] **Step 7: Final commit**

```bash
git add docs/phase-a-completion-evidence.md
git commit -m "docs: Phase A completion evidence — all 32 assets flowing, ≤5bps drift

Mainnet smoke for 1h, all 14 new assets producing intrinsic + discount
snapshots, NAV cross-check vs each issuer's public dashboard within
≤5bps tolerance.

Phase A done. Ready for Hetzner deploy (Epic 10) + dogfood (Epic 11).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-review (after writing the plan)

**Spec coverage:**

| Spec section | Plan coverage |
|---|---|
| §2 Catalog (15 LSTs + 10 yield-bearing) | Tasks 1, 3 |
| §3.1 IntrinsicStrategy variants (8 new) | Task 3 |
| §3.2 AssetClass (StableYield reuse) | Task 3 (no enum change needed) |
| §3.3 Threshold defaults | Task 3 (per-asset thresholds_bps in TOML) |
| §4.1-4.3 8 source adapters | Tasks 4-11 |
| §4.4 IDL drift protection | Task 18 |
| §5 Engine integration | Task 12 |
| §6 Front-end (filter, card, hero) | Tasks 14, 15, 16 |
| §7 Bot (payload, /explain × 8) | Tasks 13, 17 |
| §8 Testing strategy | Embedded in every adapter task (Step 3+4 = fixture decode test; Step 8 = mainnet smoke) |
| §9 Risk register (R13-R18) | Task 19 (ROADMAP update) |
| §10 Sequencing (5 weeks) | Plan organized by week |
| §11 Definition of Done | Task 20 (E2E verification) |

All spec sections have at least one task. Gap check: none.

**Placeholder scan:** Most "TBD" markers in the plan refer to **runtime discovery** — pubkeys that must be fetched from issuer docs at implementation time. This is appropriate (we don't want to hardcode wrong addresses). Per-task discovery steps are explicit.

**Type consistency:** `IntrinsicStrategy` variant names match between Task 3 (declared) and Tasks 4-11 (consumed). Channel constants (`SRC_ONDO`, `SRC_SOLAYER`, etc.) match between declaration in Tasks 4-11 and engine subscription pattern. `AssetClass::StableYield` (existing, lowercase `stable_yield` in TOML serde) is used consistently across all 14 yield-bearing entries.

---

## Execution choice (when plan is approved)

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-phase-a-yield-bearing-expansion.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each adapter (Tasks 4-11) is independent enough to dispatch in parallel after Task 3 completes.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
