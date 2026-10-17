# Phase 14 — 2025-10-10 USDe Cascade Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project, implementation is delegated to the `codex` CLI per step, with Opus reviewing every diff and running the full suite; `/code-review` finalizes.

**Goal:** Replay the real 2025-10-10 liquidation cascade across 10 assets through the unmodified `methodology` 0.4.0 crate, emitting per-transition schema-v2 receipts that the public `pegana-replay` CLI can verify, plus a docs artifact, a web page, and a CI drift gate.

**Architecture:** A new `xtask backtest` subcommand drives a per-asset, per-tick loop that mirrors the engine's `try_recompute` order by calling the pure `methodology` functions (`compute_discount` → `apply_ewma_pure` → `classify_with_hysteresis` → `transition_decide` → `premium_sanity_violated`) and threading `ewma_prev` / `previous_state` / `candidate_state` / `candidate_since` forward exactly like `AssetRuntime`. Each tick builds an `InputsFrozen`, computes `canonical_receipt_hash`, and self-verifies via `rederive`. Inputs are a committed Pyth-Benchmarks fixture (no network in CI).

**Tech Stack:** Rust (clap, tokio, reqwest, serde, serde_json, rust_decimal, chrono), the in-repo `methodology` + `pegana_common` crates, Next.js 16 + Recharts for the web page, GitHub Actions for CI.

**Spec:** `docs/superpowers/specs/2026-06-22-phase-14-backtest-design.md`

**Branch:** `feat/phase-14-backtest` (already created; spec committed at `6eaa1fa`).

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/xtask/src/backtest/mod.rs` | Subcommand entry: `capture` + `run` + `check`; orchestration only |
| `crates/xtask/src/backtest/types.rs` | Serde types: `InputsFixture`, `AssetSeries`, `Tick`, `BacktestOutput`, `AssetResult`, `Transition` |
| `crates/xtask/src/backtest/benchmarks.rs` | Pyth Benchmarks fetch + pure response parser → `Vec<Tick>` |
| `crates/xtask/src/backtest/runner.rs` | Pure per-asset tick-loop (the methodology mirror); returns `AssetResult` + receipt bundles |
| `crates/xtask/src/main.rs` | Wire the `Backtest` subcommand into the existing clap enum |
| `crates/xtask/tests/backtest_runner.rs` | Integration tests: synthetic series, round-trip, directional sanity, golden determinism |
| `docs/backtests/2025-10-10-usde-depeg/inputs.json` | Committed Pyth fixture (Task 5) |
| `docs/backtests/2025-10-10-usde-depeg/assets-snapshot.toml` | Frozen 10-asset config (Task 5) |
| `docs/backtests/2025-10-10-usde-depeg/methodology-output.json` | Golden transitions + receipt hashes (Task 6) |
| `docs/backtests/2025-10-10-usde-depeg/receipts/<asset>-<seq>.json` | Per-transition verifiable bundles (Task 6) |
| `docs/backtests/2025-10-10-usde-depeg/README.md` | Narrative + sources + fidelity table + disclaimer (Task 8) |
| `scripts/run-backtest.sh` | Thin wrapper (Task 7) |
| `.github/workflows/backtest.yml` | PR drift gate (Task 7) |
| `web/app/backtest/page.tsx` + `web/app/backtest/2025-10-10-usde-depeg/page.tsx` | Web surfacing (Task 9) |

---

## Reference: the exact pipeline to mirror

From `crates/methodology/src/rederive.rs:99-171` (the canonical re-derivation). The runner replicates this per tick, but ALSO captures `transition_decide`'s `new_candidate_state`/`new_candidate_since` to thread forward (rederive discards them):

```rust
// per tick, ascending time:
let discount_raw = compute_discount(intrinsic_usd, market_usd, intrinsic_sol, market_sol, class)?; // skip if None
if !is_plausible_discount_sample(discount_raw) { /* skip tick */ }
let discount_smooth = apply_ewma_pure(discount_raw, ewma_prev, alpha);          // alpha = 0.3
let candidate = classify_with_hysteresis(class, discount_smooth, &thresholds, previous_state, DEADBAND_PCT); // 25
let decision  = transition_decide(previous_state, candidate, candidate_state, candidate_since, now, 30, 120);
let mut final_state = decision.new_last_state;
if premium_sanity_violated(class, discount_smooth) { final_state = PegState::Unknown; }
// thread forward:
ewma_prev = Some(discount_smooth); previous_state = final_state;
candidate_state = decision.new_candidate_state; candidate_since = decision.new_candidate_since;
```

Key types (`crates/methodology/src/receipt.rs`, `canonical.rs`, `transition.rs`):
- `InputsFrozen { asset, class, now, alpha, intrinsic_usd, market_usd, intrinsic_sol, market_sol, ewma_prev, hyusd_cr, previous_state, candidate_state, candidate_since, thresholds: HashMap<String,u32>, threshold_kind, pyth_entries: HashMap<String,PythEntry>, confirm_up_secs: i64, decay_down_secs: i64 }`
- `Computed { discount_raw, discount_smooth, final_state, confidence_label }`
- `Receipt { schema_version, methodology_version, methodology_git_sha, assets_toml_canonical, inputs_frozen, expected_computed, expected_receipt_sha256 }`
- `canonical_receipt_hash(methodology_version: &str, methodology_git_sha: Option<&str>, assets_toml_canonical: &str, &InputsFrozen, &Computed) -> Result<[u8;32], MethodologyError>`; `hex_sha256([u8;32]) -> String`
- `rederive(&InputsFrozen) -> Result<Rederived{discount_raw,discount_smooth,final_state}, MethodologyRederiveError>`
- `methodology_version()` / `methodology_git_sha()` from `methodology::version`.

All 10 assets use the BPS path (`threshold_kind = "bps"`, `hyusd_cr = None`); hyUSD/CR is out of scope.

---

## Task 1: Backtest module skeleton + serde types

**Files:**
- Create: `crates/xtask/src/backtest/mod.rs`
- Create: `crates/xtask/src/backtest/types.rs`
- Modify: `crates/xtask/src/main.rs` (add `mod backtest;` + `Backtest` subcommand)
- Modify: `crates/xtask/Cargo.toml` (add `methodology`, `serde_json`, `chrono`, `rust_decimal`, `reqwest` deps if missing)

- [ ] **Step 1: Add the module + subcommand wiring**

In `crates/xtask/src/main.rs`, add near the top after the existing `use`:
```rust
mod backtest;
```
Add to `enum Cmd`:
```rust
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
```
Add to the `match cli.command` arm:
```rust
        Cmd::Backtest { case, capture, check } => backtest::run(case, capture, check).await,
```

- [ ] **Step 2: Write the failing test for the fixture types**

Create `crates/xtask/tests/backtest_runner.rs`:
```rust
use std::path::PathBuf;

#[test]
fn inputs_fixture_parses_minimal() {
    let json = r#"{
      "schema_version": "v1",
      "captured_at": "2026-06-22T00:00:00Z",
      "source": "test",
      "window": { "start": "2025-10-09T00:00:00Z", "end": "2025-10-12T00:00:00Z" },
      "series": {
        "USDC": { "class": "stable_fiat", "market_feed": "USDC/USD", "intrinsic": "fixed_1_usd",
                  "ticks": [ { "t": 1759968000, "market_usd": "1.0000" } ] }
      }
    }"#;
    let fixture: xtask::backtest::types::InputsFixture =
        serde_json::from_str(json).expect("parse fixture");
    assert_eq!(fixture.series.len(), 1);
    assert_eq!(fixture.series["USDC"].ticks.len(), 1);
}
```
> Note: `xtask` is a binary crate. To test internals, add a `src/lib.rs` exposing the modules (`pub mod backtest;`) and have `main.rs` `use xtask::backtest;`. Create `crates/xtask/src/lib.rs` with `pub mod backtest;` and move `mod backtest;` out of main.rs into `use xtask::backtest;`. Add `name = "xtask"` `[lib]` if not auto-detected.

- [ ] **Step 3: Run it — verify it fails to compile**

Run: `cargo test -p xtask --test backtest_runner inputs_fixture_parses_minimal`
Expected: FAIL — `xtask::backtest::types::InputsFixture` does not exist.

- [ ] **Step 4: Implement the types**

Create `crates/xtask/src/backtest/types.rs`:
```rust
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputsFixture {
    pub schema_version: String,
    pub captured_at: String,
    pub source: String,
    pub window: Window,
    /// Asset symbol → its series. BTreeMap so JSON key order is deterministic.
    pub series: BTreeMap<String, AssetSeries>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Window { pub start: String, pub end: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetSeries {
    pub class: String,
    #[serde(default)] pub market_feed: Option<String>,
    #[serde(default)] pub intrinsic: Option<String>,      // e.g. "fixed_1_usd"
    #[serde(default)] pub intrinsic_feed: Option<String>, // e.g. "SUSDE/USDE.RR"
    #[serde(default)] pub nav_feed: Option<String>,       // LST: "<LST>/SOL.RR"
    #[serde(default)] pub numeraire_feed: Option<String>, // LST: "SOL/USD"
    pub ticks: Vec<Tick>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tick {
    /// Unix seconds (UTC).
    pub t: i64,
    pub market_usd: Decimal,
    #[serde(default)] pub intrinsic_usd: Option<Decimal>,
    #[serde(default)] pub market_sol: Option<Decimal>,
    #[serde(default)] pub intrinsic_sol: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BacktestOutput {
    pub case: String,
    pub methodology_version: String,
    pub inputs_sha256: String,
    pub assets: BTreeMap<String, AssetResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssetResult {
    pub fidelity: String,                 // "perfect" | "market-proxied" | "doubly-proxied"
    pub transitions: Vec<Transition>,
    pub time_to_first_alert_secs: Option<i64>,
    pub max_state: String,
    pub ticks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transition {
    pub t: String,                        // RFC3339
    pub from: String,
    pub to: String,
    pub discount_smooth: Decimal,
    pub receipt_sha256: String,
}
```

Create `crates/xtask/src/backtest/mod.rs` (stub `run` so it compiles; real logic later tasks):
```rust
pub mod benchmarks;
pub mod runner;
pub mod types;

use anyhow::Result;

pub async fn run(case: String, capture: bool, check: bool) -> Result<()> {
    let _ = (&case, capture, check);
    anyhow::bail!("backtest: not yet implemented")
}
```
Create empty `crates/xtask/src/backtest/benchmarks.rs` and `runner.rs` with `// placeholder` (filled in Tasks 2-4) — or create them in their own tasks; if Rust complains about missing `mod`, comment out the `pub mod benchmarks;`/`pub mod runner;` lines until those files exist.

- [ ] **Step 5: Run the test — verify it passes**

Run: `cargo test -p xtask --test backtest_runner inputs_fixture_parses_minimal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/xtask/src/backtest/types.rs crates/xtask/src/backtest/mod.rs \
        crates/xtask/src/lib.rs crates/xtask/src/main.rs crates/xtask/Cargo.toml \
        crates/xtask/tests/backtest_runner.rs
git commit -m "feat(xtask): backtest subcommand skeleton + fixture types"
```

---

## Task 2: Pyth Benchmarks fetch + pure parser

**Files:**
- Modify: `crates/xtask/src/backtest/benchmarks.rs`
- Test: `crates/xtask/tests/backtest_runner.rs`

- [ ] **Step 1: Write the failing test for the parser**

Append to `crates/xtask/tests/backtest_runner.rs`:
```rust
#[test]
fn parse_benchmarks_history_extracts_closes() {
    // TradingView shim shape: { s, t[], o[], h[], l[], c[], v[] }
    let body = r#"{"s":"ok","t":[1759968000,1759968060],
                   "o":[1.0,1.0],"h":[1.0,1.0],"l":[0.99,0.95],"c":[1.0001,0.9533],"v":[0,0]}"#;
    let ticks = xtask::backtest::benchmarks::parse_history(body).expect("parse");
    assert_eq!(ticks.len(), 2);
    assert_eq!(ticks[0].t, 1759968000);
    assert_eq!(ticks[1].close.to_string(), "0.9533");
}

#[test]
fn parse_benchmarks_history_rejects_error_status() {
    let body = r#"{"s":"error","errmsg":"no data"}"#;
    assert!(xtask::backtest::benchmarks::parse_history(body).is_err());
}
```

- [ ] **Step 2: Run — verify it fails**

Run: `cargo test -p xtask --test backtest_runner parse_benchmarks`
Expected: FAIL — `parse_history` not found.

- [ ] **Step 3: Implement the parser + fetcher**

`crates/xtask/src/backtest/benchmarks.rs`:
```rust
use anyhow::{bail, Context, Result};
use rust_decimal::Decimal;
use serde::Deserialize;

/// One parsed candle (we use `close` as the tick price).
#[derive(Debug, Clone)]
pub struct Candle { pub t: i64, pub close: Decimal }

#[derive(Deserialize)]
struct HistoryRaw {
    s: String,
    #[serde(default)] t: Vec<i64>,
    #[serde(default)] c: Vec<f64>,
    #[serde(default)] errmsg: Option<String>,
}

/// Pure parser for the TradingView shim response. `close` is converted to
/// Decimal via string formatting to avoid binary-float drift in the fixture.
pub fn parse_history(body: &str) -> Result<Vec<Candle>> {
    let raw: HistoryRaw = serde_json::from_str(body).context("parse benchmarks history")?;
    if raw.s != "ok" {
        bail!("benchmarks status={} err={:?}", raw.s, raw.errmsg);
    }
    if raw.t.len() != raw.c.len() {
        bail!("t/c length mismatch: {} vs {}", raw.t.len(), raw.c.len());
    }
    let mut out = Vec::with_capacity(raw.t.len());
    for (t, c) in raw.t.into_iter().zip(raw.c.into_iter()) {
        // Format with enough precision, then parse to Decimal (no f64 in fixture).
        let close: Decimal = format!("{c:.8}").parse().context("close→Decimal")?;
        out.push(Candle { t, close });
    }
    Ok(out)
}

/// Fetch one feed's hourly/minute candles. Network — only used by `--capture`.
pub async fn fetch_history(symbol: &str, resolution: &str, from: i64, to: i64) -> Result<Vec<Candle>> {
    let url = format!(
        "https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Crypto.{}&resolution={}&from={}&to={}",
        urlencoding::encode(symbol), resolution, from, to
    );
    let client = reqwest::Client::builder().build()?;
    // Simple bounded retry for 429/5xx.
    let mut attempt = 0;
    loop {
        attempt += 1;
        let resp = client.get(&url).send().await.with_context(|| format!("GET {url}"))?;
        if resp.status().is_success() {
            return parse_history(&resp.text().await?);
        }
        if attempt >= 5 { bail!("benchmarks {} after {attempt} attempts: {}", symbol, resp.status()); }
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    }
}
```
Add `urlencoding` to `crates/xtask/Cargo.toml` (or build the query with `reqwest`'s query API instead — implementer's choice; if avoiding the dep, use `client.get(base).query(&[("symbol", format!("Crypto.{symbol}")), ...])`).

- [ ] **Step 4: Run — verify pass**

Run: `cargo test -p xtask --test backtest_runner parse_benchmarks`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add crates/xtask/src/backtest/benchmarks.rs crates/xtask/Cargo.toml crates/xtask/tests/backtest_runner.rs
git commit -m "feat(xtask): Pyth Benchmarks fetch + pure history parser"
```

---

## Task 3: Core tick-loop runner (the methodology mirror)

**Files:**
- Modify: `crates/xtask/src/backtest/runner.rs`
- Test: `crates/xtask/tests/backtest_runner.rs`

- [ ] **Step 1: Write the failing test — synthetic depeg series**

Append to `crates/xtask/tests/backtest_runner.rs`:
```rust
use rust_decimal::Decimal;
use std::str::FromStr;
use xtask::backtest::types::{AssetSeries, Tick};

fn tick(t: i64, mkt: &str) -> Tick {
    Tick { t, market_usd: Decimal::from_str(mkt).unwrap(),
           intrinsic_usd: None, market_sol: None, intrinsic_sol: None }
}

#[test]
fn runner_escalates_usde_to_at_least_depeg_and_self_verifies() {
    // USDe: stable_dn, thresholds 25/100/300 bps, intrinsic = $1.
    // Hold a deep depeg (0.953 ≈ 470 bps) for many 1-min ticks so EWMA + the
    // 30s confirm window mature past DEPEG.
    let mut ticks = vec![tick(0, "1.0000")];
    for i in 1..40 { ticks.push(tick(i * 60, "0.9530")); }
    let series = AssetSeries {
        class: "stable_dn".into(),
        market_feed: Some("USDE/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None, nav_feed: None, numeraire_feed: None,
        ticks,
    };
    let thresholds: std::collections::HashMap<String,u32> =
        [("drift",25u32),("depeg",100),("critical",300)].iter().map(|(k,v)|(k.to_string(),*v)).collect();

    let result = xtask::backtest::runner::run_asset(
        "USDe", &series, &thresholds, "market-proxied",
        "0.4.0", None, "ASSETS_CANON",
    ).expect("run_asset");

    // Reached at least DEPEG, and every emitted receipt re-derives.
    let reached: Vec<&str> = result.0.transitions.iter().map(|t| t.to.as_str()).collect();
    assert!(reached.contains(&"DEPEG") || reached.contains(&"CRITICAL"),
            "expected >= DEPEG, got {reached:?}");
    // run_asset returns (AssetResult, Vec<ReceiptBundle>); bundles self-verify internally,
    // but assert the public invariant here too:
    for bundle in &result.1 {
        let rd = methodology::rederive(&bundle.inputs_frozen).expect("rederive");
        assert_eq!(methodology_state_str(rd.final_state), bundle.expected_computed.final_state_str());
    }
}

#[test]
fn runner_keeps_stable_pegged_no_false_positive() {
    // USDC held ~1.0: must stay PEGGED → zero transitions.
    let ticks: Vec<Tick> = (0..30).map(|i| tick(i*60, "0.9997")).collect();
    let series = AssetSeries { class: "stable_fiat".into(), market_feed: Some("USDC/USD".into()),
        intrinsic: Some("fixed_1_usd".into()), intrinsic_feed: None, nav_feed: None,
        numeraire_feed: None, ticks };
    let thresholds: std::collections::HashMap<String,u32> =
        [("drift",15u32),("depeg",50),("critical",200)].iter().map(|(k,v)|(k.to_string(),*v)).collect();
    let (res, _bundles) = xtask::backtest::runner::run_asset(
        "USDC", &series, &thresholds, "perfect", "0.4.0", None, "ASSETS_CANON").unwrap();
    assert_eq!(res.transitions.len(), 0, "USDC must not leave PEGGED");
    assert_eq!(res.max_state, "PEGGED");
}

// helper for the test (maps PegState → the canonical uppercase string used in output)
fn methodology_state_str(s: pegana_common_verify::PegState) -> String {
    xtask::backtest::runner::state_str(s)
}
```

- [ ] **Step 2: Run — verify it fails**

Run: `cargo test -p xtask --test backtest_runner runner_`
Expected: FAIL — `run_asset` / `ReceiptBundle` not found.

- [ ] **Step 3: Implement the runner**

`crates/xtask/src/backtest/runner.rs`:
```rust
use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use methodology::{
    apply_ewma_pure, canonical_receipt_hash, classify_with_hysteresis, compute_discount, hex_sha256,
    is_plausible_discount_sample, premium_sanity_violated, rederive, transition_decide,
    Computed, InputsFrozen, Receipt, DEADBAND_PCT,
};
use pegana_common_verify::{AssetClass, PegState};
use rust_decimal::Decimal;

use crate::backtest::types::{AssetResult, AssetSeries, Transition};

/// Production constants — MUST match the engine exactly (see spec §10).
const ALPHA_STR: &str = "0.3";
const CONFIRM_UP_SECS: i64 = 30;
const DECAY_DOWN_SECS: i64 = 120;

/// A receipt + its frozen inputs (written to receipts/ and verifiable by the CLI).
pub struct ReceiptBundle {
    pub inputs_frozen: InputsFrozen,
    pub expected_computed: Computed,
    pub receipt: Receipt,
}
impl ReceiptBundle {
    pub fn sha(&self) -> &str { &self.receipt.expected_receipt_sha256 }
}

pub fn state_str(s: PegState) -> String {
    match s {
        PegState::Pegged => "PEGGED", PegState::Drift => "DRIFT", PegState::Depeg => "DEPEG",
        PegState::Critical => "CRITICAL", PegState::BlackSwan => "BLACK_SWAN", PegState::Unknown => "UNKNOWN",
    }.to_string()
}

fn class_from_str(s: &str) -> Result<AssetClass> {
    // Reuse serde's rename mapping by round-tripping through JSON.
    serde_json::from_value(serde_json::Value::String(s.to_string()))
        .with_context(|| format!("unknown asset class '{s}'"))
}

fn strictness(s: PegState) -> u8 {
    match s { PegState::Pegged|PegState::Unknown => 0, PegState::Drift => 1,
              PegState::Depeg => 2, PegState::Critical => 3, PegState::BlackSwan => 4 }
}

/// Run one asset's series through the methodology, mirroring engine `try_recompute`.
/// Returns the per-asset result and the receipt bundles for each transition tick.
pub fn run_asset(
    asset: &str,
    series: &AssetSeries,
    thresholds: &HashMap<String, u32>,
    fidelity: &str,
    methodology_version: &str,
    methodology_git_sha: Option<&str>,
    assets_toml_canonical: &str,
) -> Result<(AssetResult, Vec<ReceiptBundle>)> {
    let class = class_from_str(&series.class)?;
    let alpha: Decimal = ALPHA_STR.parse().unwrap();

    // Threaded state (cold-start = engine defaults).
    let mut ewma_prev: Option<Decimal> = None;
    let mut previous_state = PegState::Pegged;
    let mut candidate_state: Option<PegState> = None;
    let mut candidate_since: Option<DateTime<Utc>> = None;

    let mut transitions: Vec<Transition> = Vec::new();
    let mut bundles: Vec<ReceiptBundle> = Vec::new();
    let mut max_strict = 0u8;
    let mut max_state = PegState::Pegged;
    let mut first_alert: Option<i64> = None;
    let mut counted = 0usize;
    let first_t = series.ticks.first().map(|t| t.t);

    for tk in &series.ticks {
        let now = Utc.timestamp_opt(tk.t, 0).single().context("bad timestamp")?;

        // Resolve intrinsic/market per fidelity tier. Stables: intrinsic $1.
        let intrinsic_usd = tk.intrinsic_usd.unwrap_or(Decimal::ONE);
        let market_usd = tk.market_usd;
        let intrinsic_sol = tk.intrinsic_sol;
        let market_sol = tk.market_sol;

        let discount_raw = match compute_discount(intrinsic_usd, market_usd, intrinsic_sol, market_sol, class) {
            Some(d) => d,
            None => continue, // engine skips this tick
        };
        if !is_plausible_discount_sample(discount_raw) { continue; }
        counted += 1;

        let discount_smooth = apply_ewma_pure(discount_raw, ewma_prev, alpha);
        let candidate = classify_with_hysteresis(class, discount_smooth, thresholds, previous_state, DEADBAND_PCT);
        let decision = transition_decide(previous_state, candidate, candidate_state, candidate_since, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS);
        let mut final_state = decision.new_last_state;
        if premium_sanity_violated(class, discount_smooth) { final_state = PegState::Unknown; }

        // Build the frozen receipt for THIS tick.
        let inputs_frozen = InputsFrozen {
            asset: asset.to_string(), class, now, alpha,
            intrinsic_usd, market_usd, intrinsic_sol, market_sol,
            ewma_prev, hyusd_cr: None, previous_state,
            candidate_state, candidate_since,
            thresholds: thresholds.clone(), threshold_kind: "bps".to_string(),
            pyth_entries: HashMap::new(), // confidence is display-only, not re-derived
            confirm_up_secs: CONFIRM_UP_SECS, decay_down_secs: DECAY_DOWN_SECS,
        };
        let expected_computed = Computed {
            discount_raw, discount_smooth, final_state,
            confidence_label: "unknown".to_string(),
        };
        let sha = hex_sha256(canonical_receipt_hash(
            methodology_version, methodology_git_sha, assets_toml_canonical,
            &inputs_frozen, &expected_computed,
        ).context("canonical_receipt_hash")?);

        // SELF-VERIFY: this receipt must re-derive (the same check the public CLI runs).
        let rd = rederive(&inputs_frozen).context("rederive self-check")?;
        anyhow::ensure!(
            rd.discount_raw == discount_raw && rd.discount_smooth == discount_smooth && rd.final_state == final_state,
            "rederive mismatch for {asset} at {now}",
        );

        // Record a transition when the committed state changes.
        if final_state != previous_state {
            transitions.push(Transition {
                t: now.to_rfc3339(), from: state_str(previous_state), to: state_str(final_state),
                discount_smooth, receipt_sha256: sha.clone(),
            });
            if first_alert.is_none() && strictness(final_state) > 0 {
                first_alert = Some(now.signed_duration_since(
                    Utc.timestamp_opt(first_t.unwrap_or(tk.t),0).single().unwrap()).num_seconds());
            }
            let receipt = Receipt {
                schema_version: "v2".to_string(),
                methodology_version: methodology_version.to_string(),
                methodology_git_sha: methodology_git_sha.map(|s| s.to_string()),
                assets_toml_canonical: assets_toml_canonical.to_string(),
                inputs_frozen: inputs_frozen.clone(),
                expected_computed: expected_computed.clone(),
                expected_receipt_sha256: sha,
            };
            bundles.push(ReceiptBundle { inputs_frozen, expected_computed, receipt });
        }

        if strictness(final_state) > max_strict { max_strict = strictness(final_state); max_state = final_state; }

        // Thread forward — exactly AssetRuntime's write-back order.
        ewma_prev = Some(discount_smooth);
        previous_state = final_state;
        candidate_state = decision.new_candidate_state;
        candidate_since = decision.new_candidate_since;
    }

    Ok((AssetResult {
        fidelity: fidelity.to_string(),
        transitions,
        time_to_first_alert_secs: first_alert,
        max_state: state_str(max_state),
        ticks: counted,
    }, bundles))
}
```
Add a small helper on `Computed` for the test, or change the test to compare `state_str(rd.final_state)` to `bundle.expected_computed.final_state` directly (it's a `PegState`). Adjust the Task-3 test's `final_state_str()` call to `state_str(bundle.expected_computed.final_state)`.

> `rust_decimal` Decimal serializes as a JSON string by default in this repo's types — keep that (the NO-FLOATS invariant). Confirm `methodology` re-exports `Receipt`; if not, import via `methodology::receipt::Receipt`.

- [ ] **Step 4: Run — verify pass**

Run: `cargo test -p xtask --test backtest_runner runner_`
Expected: PASS (both runner tests).

- [ ] **Step 5: Commit**

```bash
git add crates/xtask/src/backtest/runner.rs crates/xtask/tests/backtest_runner.rs
git commit -m "feat(xtask): backtest tick-loop runner mirroring engine pipeline + receipts"
```

---

## Task 4: Orchestration — load fixture, run all assets, write output + receipts

**Files:**
- Modify: `crates/xtask/src/backtest/mod.rs`

- [ ] **Step 1: Write the failing test (end-to-end against a tiny embedded fixture)**

Append to `crates/xtask/tests/backtest_runner.rs`:
```rust
#[test]
fn run_case_produces_deterministic_output() {
    // Use the helper that runs from an in-memory fixture (no disk/network).
    let fixture_json = std::fs::read_to_string(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mini-inputs.json")).unwrap();
    let assets_toml = std::fs::read_to_string(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mini-assets.toml")).unwrap();
    let out1 = xtask::backtest::compute_output("mini", &fixture_json, &assets_toml).unwrap();
    let out2 = xtask::backtest::compute_output("mini", &fixture_json, &assets_toml).unwrap();
    let j1 = serde_json::to_string_pretty(&out1.0).unwrap();
    let j2 = serde_json::to_string_pretty(&out2.0).unwrap();
    assert_eq!(j1, j2, "output must be byte-deterministic");
    assert!(out1.0.assets.contains_key("USDe"));
}
```
Create `crates/xtask/tests/fixtures/mini-inputs.json` with USDe (depeg) + USDC (held), ~40 one-minute ticks each (same shape as Task 1's fixture, two assets). Create `crates/xtask/tests/fixtures/mini-assets.toml` with the USDe + USDC blocks copied from the repo root `assets.toml`.

- [ ] **Step 2: Run — verify it fails**

Run: `cargo test -p xtask --test backtest_runner run_case_produces`
Expected: FAIL — `compute_output` not found.

- [ ] **Step 3: Implement orchestration**

In `crates/xtask/src/backtest/mod.rs`, replace the stub:
```rust
pub mod benchmarks;
pub mod runner;
pub mod types;

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use methodology::{methodology_git_sha, methodology_version};
use pegana_common::AssetsFile;
use sha2::{Digest, Sha256};

use crate::backtest::runner::{run_asset, ReceiptBundle};
use crate::backtest::types::{BacktestOutput, InputsFixture};

/// Fidelity tier per asset (spec §2). Drives the badge + claim strength.
fn fidelity(asset: &str) -> &'static str {
    match asset {
        "USDC" | "USDT" | "sUSDe" => "perfect",
        "USDe" | "PYUSD" | "USDS" => "market-proxied",
        "jitoSOL" | "mSOL" | "bSOL" | "INF" => "doubly-proxied",
        _ => "unknown",
    }
}

/// Canonicalize an assets.toml string (parse → re-serialize), mirroring
/// `methodology::canonical_assets_hash` so the receipt's `assets_toml_canonical`
/// matches what a verifier reconstructs.
fn canonicalize_assets(toml_str: &str) -> Result<String> {
    let value: toml::Value = toml::from_str(toml_str).context("parse assets snapshot")?;
    Ok(toml::to_string(&value).context("serialize canonical assets")?)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new(); h.update(bytes);
    methodology::hex_sha256(h.finalize().into())
}

/// Pure: fixture JSON + assets snapshot TOML → (output, all receipt bundles).
pub fn compute_output(
    case: &str, fixture_json: &str, assets_toml: &str,
) -> Result<(BacktestOutput, HashMap<String, Vec<ReceiptBundle>>)> {
    let fixture: InputsFixture = serde_json::from_str(fixture_json).context("parse inputs.json")?;
    let assets_canon = canonicalize_assets(assets_toml)?;
    let parsed: AssetsFile = toml::from_str(assets_toml).context("parse AssetsFile")?;

    // symbol → thresholds map (drift/depeg/critical). Mirror engine's
    // `asset_cfg.thresholds.thresholds_bps` access (see engine-rs/src/main.rs).
    let mut thresholds_by_asset: HashMap<String, HashMap<String, u32>> = HashMap::new();
    for a in &parsed.assets {
        if let Some(bps) = a.thresholds.thresholds_bps.clone() {
            thresholds_by_asset.insert(a.symbol.clone(), bps);
        }
    }

    let mver = methodology_version();
    let gsha = methodology_git_sha();
    let mut assets_out = std::collections::BTreeMap::new();
    let mut all_bundles: HashMap<String, Vec<ReceiptBundle>> = HashMap::new();

    for (sym, series) in &fixture.series {
        let thresholds = thresholds_by_asset.get(sym)
            .with_context(|| format!("no thresholds_bps for {sym} in assets snapshot"))?;
        let (result, bundles) = run_asset(
            sym, series, thresholds, fidelity(sym), mver, gsha.as_deref(), &assets_canon,
        )?;
        assets_out.insert(sym.clone(), result);
        all_bundles.insert(sym.clone(), bundles);
    }

    Ok((BacktestOutput {
        case: case.to_string(),
        methodology_version: mver.to_string(),
        inputs_sha256: sha256_hex(fixture_json.as_bytes()),
        assets: assets_out,
    }, all_bundles))
}

pub async fn run(case: String, capture: bool, check: bool) -> Result<()> {
    let dir = PathBuf::from("docs/backtests").join(&case);
    if capture { capture_inputs(&dir).await.context("capture")?; }

    let fixture_json = std::fs::read_to_string(dir.join("inputs.json")).context("read inputs.json")?;
    let assets_toml = std::fs::read_to_string(dir.join("assets-snapshot.toml")).context("read assets-snapshot.toml")?;
    let (output, bundles) = compute_output(&case, &fixture_json, &assets_toml)?;
    let rendered = serde_json::to_string_pretty(&output)? + "\n";

    let golden_path = dir.join("methodology-output.json");
    if check {
        let golden = std::fs::read_to_string(&golden_path).context("read golden")?;
        if golden != rendered {
            anyhow::bail!("BACKTEST DRIFT — {} differs from freshly computed output", golden_path.display());
        }
        println!("backtest {case}: no drift ✓");
        return Ok(());
    }

    // Write golden + per-transition receipt bundles.
    std::fs::write(&golden_path, &rendered)?;
    let rdir = dir.join("receipts");
    std::fs::create_dir_all(&rdir)?;
    for (sym, list) in &bundles {
        for (i, b) in list.iter().enumerate() {
            let p = rdir.join(format!("{sym}-{:03}.json", i + 1));
            std::fs::write(p, serde_json::to_string_pretty(&b.receipt)? + "\n")?;
        }
    }
    println!("backtest {case}: wrote {} + {} receipt bundles", golden_path.display(),
             bundles.values().map(|v| v.len()).sum::<usize>());
    Ok(())
}

/// Capture mode is defined in Task 5.
async fn capture_inputs(_dir: &std::path::Path) -> Result<()> {
    anyhow::bail!("capture not yet implemented (Task 5)")
}
```
Add `sha2` + `toml` + `pegana_common` to `crates/xtask/Cargo.toml` if missing (`toml` and `pegana_common` already used by xtask; add `sha2`).

- [ ] **Step 4: Run — verify pass**

Run: `cargo test -p xtask --test backtest_runner run_case_produces`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/xtask/src/backtest/mod.rs crates/xtask/Cargo.toml \
        crates/xtask/tests/backtest_runner.rs crates/xtask/tests/fixtures/
git commit -m "feat(xtask): backtest orchestration — load fixture, run assets, write output + receipts"
```

---

## Task 5: Capture mode + real fixture (one-time, network)

**Files:**
- Modify: `crates/xtask/src/backtest/mod.rs` (real `capture_inputs`)
- Create (output, committed): `docs/backtests/2025-10-10-usde-depeg/inputs.json`, `assets-snapshot.toml`

- [ ] **Step 1: Implement `capture_inputs`**

Replace the stub in `mod.rs`. It builds `inputs.json` from Pyth Benchmarks for the 10 assets, window `2025-10-09T00:00:00Z`–`2025-10-12T00:00:00Z`, resolution `1`:
```rust
async fn capture_inputs(dir: &std::path::Path) -> Result<()> {
    use crate::backtest::benchmarks::fetch_history;
    use crate::backtest::types::{AssetSeries, InputsFixture, Tick, Window};
    use std::collections::BTreeMap;

    const FROM: i64 = 1_759_968_000; // 2025-10-09T00:00:00Z
    const TO: i64   = 1_760_227_200; // 2025-10-12T00:00:00Z
    const RES: &str = "1";

    // (symbol, class, market_feed, intrinsic kind/feed, nav_feed, numeraire_feed)
    struct Spec { sym:&'static str, class:&'static str, market:&'static str,
                  intrinsic:Option<&'static str>, intrinsic_feed:Option<&'static str>,
                  nav_feed:Option<&'static str>, numeraire_feed:Option<&'static str> }
    let specs = vec![
        Spec{sym:"USDe", class:"stable_dn",   market:"USDE/USD",  intrinsic:Some("fixed_1_usd"), intrinsic_feed:None, nav_feed:None, numeraire_feed:None},
        Spec{sym:"PYUSD",class:"stable_fiat", market:"PYUSD/USD", intrinsic:Some("fixed_1_usd"), intrinsic_feed:None, nav_feed:None, numeraire_feed:None},
        Spec{sym:"USDC", class:"stable_fiat", market:"USDC/USD",  intrinsic:Some("fixed_1_usd"), intrinsic_feed:None, nav_feed:None, numeraire_feed:None},
        Spec{sym:"USDT", class:"stable_fiat", market:"USDT/USD",  intrinsic:Some("fixed_1_usd"), intrinsic_feed:None, nav_feed:None, numeraire_feed:None},
        Spec{sym:"USDS", class:"stable_cdp",  market:"USDS/USD",  intrinsic:Some("fixed_1_usd"), intrinsic_feed:None, nav_feed:None, numeraire_feed:None},
        Spec{sym:"sUSDe",class:"stable_yield",market:"SUSDE/USD", intrinsic:None, intrinsic_feed:Some("SUSDE/USDE.RR"), nav_feed:None, numeraire_feed:None},
        Spec{sym:"jitoSOL",class:"lst",market:"JITOSOL/USD",intrinsic:None,intrinsic_feed:None,nav_feed:Some("JITOSOL/SOL.RR"),numeraire_feed:Some("SOL/USD")},
        Spec{sym:"mSOL",   class:"lst",market:"MSOL/USD",   intrinsic:None,intrinsic_feed:None,nav_feed:Some("MSOL/SOL.RR"),   numeraire_feed:Some("SOL/USD")},
        Spec{sym:"bSOL",   class:"lst",market:"BSOL/USD",   intrinsic:None,intrinsic_feed:None,nav_feed:Some("BSOL/SOL.RR"),   numeraire_feed:Some("SOL/USD")},
        Spec{sym:"INF",    class:"lst",market:"INF/USD",    intrinsic:None,intrinsic_feed:None,nav_feed:Some("INF/SOL.RR"),    numeraire_feed:Some("SOL/USD")},
    ];

    // Pre-fetch the shared SOL/USD series once (LST numeraire).
    let sol = fetch_history("SOL/USD", RES, FROM, TO).await?;
    let sol_by_t: std::collections::HashMap<i64, rust_decimal::Decimal> =
        sol.iter().map(|c| (c.t, c.close)).collect();

    let mut series = BTreeMap::new();
    for s in &specs {
        let mkt = fetch_history(s.market, RES, FROM, TO).await?;
        let nav = if let Some(f) = s.nav_feed { Some(fetch_history(f, RES, FROM, TO).await?) } else { None };
        let intr = if let Some(f) = s.intrinsic_feed { Some(fetch_history(f, RES, FROM, TO).await?) } else { None };
        let nav_by_t: Option<std::collections::HashMap<i64, rust_decimal::Decimal>> =
            nav.as_ref().map(|v| v.iter().map(|c| (c.t, c.close)).collect());
        let intr_by_t: Option<std::collections::HashMap<i64, rust_decimal::Decimal>> =
            intr.as_ref().map(|v| v.iter().map(|c| (c.t, c.close)).collect());

        let mut ticks = Vec::new();
        for c in &mkt {
            let mut t = Tick { t: c.t, market_usd: c.close, intrinsic_usd: None, market_sol: None, intrinsic_sol: None };
            if let Some(ib) = &intr_by_t { if let Some(v) = ib.get(&c.t) { t.intrinsic_usd = Some(*v); } }
            if s.nav_feed.is_some() {
                if let (Some(nb), Some(solp)) = (&nav_by_t, sol_by_t.get(&c.t)) {
                    if let Some(navv) = nb.get(&c.t) {
                        // NAV (SOL) and market (SOL) for the LST sol-denominated discount.
                        t.intrinsic_sol = Some(*navv);
                        t.market_sol = c.close.checked_div(*solp);
                        t.intrinsic_usd = (*navv).checked_mul(*solp);
                    }
                }
            }
            ticks.push(t);
        }
        series.insert(s.sym.to_string(), AssetSeries {
            class: s.class.to_string(),
            market_feed: Some(s.market.to_string()),
            intrinsic: s.intrinsic.map(|x| x.to_string()),
            intrinsic_feed: s.intrinsic_feed.map(|x| x.to_string()),
            nav_feed: s.nav_feed.map(|x| x.to_string()),
            numeraire_feed: s.numeraire_feed.map(|x| x.to_string()),
            ticks,
        });
    }

    let fixture = InputsFixture {
        schema_version: "v1".to_string(),
        captured_at: chrono::Utc::now().to_rfc3339(),
        source: "pyth-benchmarks tradingview shim, resolution=1".to_string(),
        window: Window { start: "2025-10-09T00:00:00Z".into(), end: "2025-10-12T00:00:00Z".into() },
        series,
    };
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("inputs.json"), serde_json::to_string_pretty(&fixture)? + "\n")?;
    println!("captured {} assets to {}/inputs.json", fixture.series.len(), dir.display());
    Ok(())
}
```
> LST tick alignment: market/nav/SOL candles share the same 1-min grid (verified during design); ticks where any leg is missing are emitted USD-only and the runner's `compute_discount` falls back gracefully. If fixture size exceeds ~10 MB, change `RES` to `5` (documented in README) — re-run capture + golden.

- [ ] **Step 2: Build the assets snapshot**

```bash
# Copy the 10 asset blocks from the repo-root assets.toml into the snapshot.
# Manually extract exactly the [[assets]] blocks for: USDe, PYUSD, USDC, USDT,
# USDS, sUSDe, jitoSOL, mSOL, bSOL, INF (Codex: read assets.toml and copy those blocks verbatim).
mkdir -p docs/backtests/2025-10-10-usde-depeg
$EDITOR docs/backtests/2025-10-10-usde-depeg/assets-snapshot.toml
# Verify it parses as an AssetsFile:
cargo run -p xtask -- verify-assets --file docs/backtests/2025-10-10-usde-depeg/assets-snapshot.toml --strict || true
```

- [ ] **Step 3: Run the capture (network, one-time)**

Run: `cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --capture`
Expected: writes `docs/backtests/2025-10-10-usde-depeg/inputs.json` with 10 asset series. Spot-check: `python3 -c "import json;d=json.load(open('docs/backtests/2025-10-10-usde-depeg/inputs.json'));print({k:len(v['ticks']) for k,v in d['series'].items()})"`

- [ ] **Step 4: Commit the fixture**

```bash
git add docs/backtests/2025-10-10-usde-depeg/inputs.json \
        docs/backtests/2025-10-10-usde-depeg/assets-snapshot.toml \
        crates/xtask/src/backtest/mod.rs
git commit -m "feat(backtest): capture mode + committed 2025-10-10 Pyth fixture (10 assets)"
```

---

## Task 6: Generate golden output + directional sanity + public-CLI acceptance

**Files:**
- Create (output, committed): `methodology-output.json`, `receipts/*`
- Test: `crates/xtask/tests/backtest_runner.rs`

- [ ] **Step 1: Generate the golden artifact from the real fixture**

Run: `cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg`
Expected: writes `methodology-output.json` + `receipts/<asset>-NNN.json`.

- [ ] **Step 2: Write directional sanity tests against the committed golden**

Append to `crates/xtask/tests/backtest_runner.rs`:
```rust
fn load_golden() -> serde_json::Value {
    let p = "../../docs/backtests/2025-10-10-usde-depeg/methodology-output.json";
    serde_json::from_str(&std::fs::read_to_string(p).expect("golden present")).unwrap()
}

#[test]
fn golden_usde_reaches_at_least_depeg() {
    let g = load_golden();
    let max = g["assets"]["USDe"]["max_state"].as_str().unwrap();
    assert!(matches!(max, "DEPEG" | "CRITICAL" | "BLACK_SWAN"), "USDe max_state={max}");
}

#[test]
fn golden_stables_that_held_stay_pegged() {
    let g = load_golden();
    for sym in ["USDC", "USDT"] {
        assert_eq!(g["assets"][sym]["max_state"].as_str().unwrap(), "PEGGED",
                   "{sym} should never leave PEGGED");
        assert_eq!(g["assets"][sym]["transitions"].as_array().unwrap().len(), 0);
    }
}

#[test]
fn golden_pyusd_registers_an_alert() {
    let g = load_golden();
    let max = g["assets"]["PYUSD"]["max_state"].as_str().unwrap();
    assert!(matches!(max, "DRIFT" | "DEPEG" | "CRITICAL"), "PYUSD max_state={max}");
}
```
> Adjust the relative golden path to the crate root if `CARGO_MANIFEST_DIR` differs; prefer `concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/backtests/...")`.

- [ ] **Step 3: Run sanity tests**

Run: `cargo test -p xtask --test backtest_runner golden_`
Expected: PASS. If USDe does NOT reach DEPEG, investigate (EWMA over-smoothing at 1-min) — do NOT weaken the assertion; this is the real validation signal. (Given −467 bps held for >1h, CRITICAL is expected.)

- [ ] **Step 4: Public-CLI acceptance — verify one real receipt with the shipped tool**

Append:
```rust
#[test]
#[ignore] // requires the pegana-replay-cli binary; run in CI's verify job
fn emitted_receipt_verifies_with_public_cli() {
    // Pick the first USDe transition receipt and run `pegana-replay --bundle`.
    let bundle = concat!(env!("CARGO_MANIFEST_DIR"),
        "/../../docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json");
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_pegana-replay"))
        .args(["--bundle", bundle]).output().expect("run pegana-replay");
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
}
```
> If `CARGO_BIN_EXE_pegana-replay` isn't available cross-crate, instead assert in-process: load the receipt JSON, call `methodology::rederive` on `inputs_frozen`, and check it matches `expected_computed`. Keep the `#[ignore]` heavy variant for the CI verify job that builds the CLI.

- [ ] **Step 5: Commit golden + receipts + tests**

```bash
git add docs/backtests/2025-10-10-usde-depeg/methodology-output.json \
        docs/backtests/2025-10-10-usde-depeg/receipts/ \
        crates/xtask/tests/backtest_runner.rs
git commit -m "feat(backtest): golden output + receipts + directional sanity + CLI acceptance"
```

---

## Task 7: `--check` drift gate + CI workflow + wrapper script

**Files:**
- Create: `scripts/run-backtest.sh`
- Create: `.github/workflows/backtest.yml`

- [ ] **Step 1: Verify `--check` passes against the committed golden**

Run: `cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --check`
Expected: `backtest 2025-10-10-usde-depeg: no drift ✓`, exit 0.

- [ ] **Step 2: Prove the gate fails on drift (manual)**

Temporarily edit one number in `methodology-output.json`, re-run `--check`, confirm non-zero exit + "BACKTEST DRIFT", then `git checkout` the file.

- [ ] **Step 3: Wrapper script**

Create `scripts/run-backtest.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
CASE="${1:-2025-10-10-usde-depeg}"
case "${2:-run}" in
  capture) cargo run -p xtask -- backtest --case "$CASE" --capture ;;
  check)   cargo run -p xtask -- backtest --case "$CASE" --check ;;
  *)       cargo run -p xtask -- backtest --case "$CASE" ;;
esac
```
`chmod +x scripts/run-backtest.sh`.

- [ ] **Step 4: CI workflow**

Create `.github/workflows/backtest.yml`:
```yaml
name: backtest
on:
  pull_request:
    paths:
      - 'crates/methodology/**'
      - 'crates/xtask/**'
      - 'docs/backtests/**'
      - '.github/workflows/backtest.yml'
jobs:
  drift-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Backtest drift gate (no network — uses committed fixture)
        run: cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --check
      - name: Directional sanity tests
        run: cargo test -p xtask --test backtest_runner golden_
```
> Match the existing CI style in `.github/workflows/` (toolchain action, cache). Copy the toolchain/cache steps from the repo's main CI workflow if they differ.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-backtest.sh .github/workflows/backtest.yml
git commit -m "ci(backtest): drift gate workflow + run-backtest.sh wrapper"
```

---

## Task 8: README narrative + fidelity table + disclaimer

**Files:**
- Create: `docs/backtests/2025-10-10-usde-depeg/README.md`

- [ ] **Step 1: Write the README**

Create `docs/backtests/2025-10-10-usde-depeg/README.md` with these sections (use the real numbers from `methodology-output.json`):
1. **What happened on 2025-10-10** — the ~$19B liquidation cascade; USDe trough $0.95332 (−467 bps) at ~21:00Z; SOL to ~$170.
2. **What Pegana would have detected** — table of `max_state` + `time_to_first_alert_secs` per asset, pulled from the golden output.
3. **Fidelity table** — the spec §2 three-tier table (perfect / market-proxied / doubly-proxied) with the per-asset reason and the conservative-lower-bound note for Jupiter-market assets.
4. **Data sources + tolerance** — Pyth Benchmarks shim (resolution, window), Hermes for confidence (display-only), CoinGecko/DefiLlama trough cross-check with the tolerance observed.
5. **How to verify** — `pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json`; note schema v2 / methodology 0.4.0.
6. **Disclaimer** — "Hypothetical backtest against real historical Pyth data. No live alert was emitted on this date. Methodology v0.4.0, unmodified."
7. **Pair with live** — link to `/audit?asset=USDe` and the web page `/backtest/2025-10-10-usde-depeg`.

- [ ] **Step 2: Cross-check the trough against CoinGecko/DefiLlama**

```bash
# Document the observed USDe low vs an independent source; record the tolerance in the README.
curl -s "https://api.coingecko.com/api/v3/coins/ethena-usde/market_chart/range?vs_currency=usd&from=1760054400&to=1760140800" | head -c 400
```

- [ ] **Step 3: Commit**

```bash
git add docs/backtests/2025-10-10-usde-depeg/README.md
git commit -m "docs(backtest): 2025-10-10 USDe cascade narrative + fidelity + verification guide"
```

---

## Task 9: Web page (reuses existing components)

**Files:**
- Create: `web/app/backtest/page.tsx` (index)
- Create: `web/app/backtest/2025-10-10-usde-depeg/page.tsx`
- Create: `web/app/backtest/2025-10-10-usde-depeg/backtest-data.ts` (imports the committed JSON)
- Reuse: existing chart (Recharts), `BandGauge`, and the in-browser verify util from the T2 trust-UX work.

- [ ] **Step 1: Wire the data**

Create `web/app/backtest/2025-10-10-usde-depeg/backtest-data.ts`:
```ts
// Import the committed golden as the page's data source (static, build-time).
import output from "../../../../docs/backtests/2025-10-10-usde-depeg/methodology-output.json";
export type BacktestOutput = typeof output;
export const backtest = output as BacktestOutput;
```
> If importing JSON from outside `web/` is blocked by the bundler, add a build step that copies `methodology-output.json` + the per-asset `timeline/*.csv` into `web/public/backtest/` (document in `web/AGENTS.md` conventions) and fetch at build time.

- [ ] **Step 2: Build the index page**

`web/app/backtest/page.tsx`: a list of available backtests (currently one), each linking to its case page, with a one-line summary. Reuse the site's existing page shell/typography. Follow `web/AGENTS.md` (read `node_modules/next/dist/docs/` before writing Next.js per the project rule).

- [ ] **Step 3: Build the case page**

`web/app/backtest/2025-10-10-usde-depeg/page.tsx`:
- Hero with the narrative + headline stat.
- Per-asset rows: fidelity badge, `max_state`, `time_to_first_alert_secs`, and a discount-over-time chart with state-band shading + transition markers (reuse the existing asset-detail chart components).
- "Verify this receipt" per transition → the in-browser byte-exact re-derivation (reuse the existing /audit verify util; no CLI/billing).
- Disclaimer banner (same text as README).
- Prominent link to `/audit?asset=USDe`.

- [ ] **Step 4: Build + lint + visual check**

Run: `cd web && pnpm build && pnpm vitest run`
Expected: build succeeds, tests pass. Then use Playwright to screenshot `/backtest/2025-10-10-usde-depeg` at desktop + mobile widths and eyeball for layout issues.

- [ ] **Step 5: Commit**

```bash
git add web/app/backtest/
git commit -m "feat(web): /backtest 2025-10-10 USDe cascade page (reuses chart + in-browser verify)"
```

---

## Final verification (before PR / merge)

- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace` (incl. the new `backtest_runner` tests + the methodology proptests)
- [ ] `cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --check` → no drift
- [ ] `cd web && pnpm build && pnpm vitest run`
- [ ] One emitted receipt verifies via the actual `pegana-replay --bundle`
- [ ] `/code-review` on the full branch diff; address findings
- [ ] Update `ROADMAP.md` (Phase 14 → done) and the memory pointer

---

## Self-review notes (author)

- **Spec coverage:** 14.1 (capture) → Tasks 2+5; 14.2 (runner + output + receipts) → Tasks 1,3,4,6; 14.3 (README + CI + web) → Tasks 7,8,9. Verifiability → Task 6 (CLI acceptance) + the runner's per-tick `rederive` self-check. Fidelity tiers → `fidelity()` + README. All spec sections mapped.
- **No placeholders:** every code step shows real code; commands have expected output. The two intentional "implementer's choice" notes (urlencoding dep; JSON-import-into-web) are flagged with a concrete fallback each.
- **Type consistency:** `run_asset` returns `(AssetResult, Vec<ReceiptBundle>)` used consistently in Tasks 3,4,6; `compute_output` returns `(BacktestOutput, HashMap<String,Vec<ReceiptBundle>>)` used in Task 4's test and `run`. `state_str`/`fidelity`/`canonicalize_assets` defined once, referenced consistently. `Tick`/`AssetSeries`/`Transition` fields match across types.rs and runner.rs.
