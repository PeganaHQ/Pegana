pub mod benchmarks;
pub mod runner;
pub mod types;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use anyhow::{Context, Result};
use methodology::{methodology_git_sha, methodology_version};
use pegana_common::AssetsFile;
use sha2::{Digest, Sha256};

use self::runner::{run_asset, ReceiptBundle};
use self::types::{BacktestOutput, InputsFixture};

fn fidelity(asset: &str) -> &'static str {
    match asset {
        "USDC" | "USDT" | "sUSDe" => "perfect",
        "USDe" | "PYUSD" | "USDS" => "market-proxied",
        "jitoSOL" | "mSOL" | "bSOL" | "INF" => "doubly-proxied",
        _ => "unknown",
    }
}

fn canonicalize_assets(value: &str) -> Result<String> {
    let parsed: toml::Value = toml::from_str(value).context("parse assets snapshot")?;
    toml::to_string(&parsed).context("serialize canonical assets")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    methodology::hex_sha256(digest)
}

fn deterministic_pretty_json<T: serde::Serialize>(value: &T) -> Result<String> {
    fn sort_value(value: serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(object) => {
                let mut entries: Vec<_> = object.into_iter().collect();
                entries.sort_by(|(left, _), (right, _)| left.cmp(right));
                serde_json::Value::Object(
                    entries
                        .into_iter()
                        .map(|(key, value)| (key, sort_value(value)))
                        .collect(),
                )
            }
            serde_json::Value::Array(values) => {
                serde_json::Value::Array(values.into_iter().map(sort_value).collect())
            }
            scalar => scalar,
        }
    }

    let sorted = sort_value(serde_json::to_value(value)?);
    Ok(serde_json::to_string_pretty(&sorted)? + "\n")
}

pub fn compute_output(
    case: &str,
    fixture_json: &str,
    assets_toml: &str,
) -> Result<(BacktestOutput, HashMap<String, Vec<ReceiptBundle>>)> {
    let fixture: InputsFixture =
        serde_json::from_str(fixture_json).context("parse inputs fixture")?;
    let assets_canonical = canonicalize_assets(assets_toml)?;
    let parsed: AssetsFile = toml::from_str(assets_toml).context("parse AssetsFile")?;
    let thresholds_by_asset: HashMap<_, _> = parsed
        .assets
        .into_iter()
        .filter_map(|asset| {
            asset
                .thresholds
                .thresholds_bps
                .map(|thresholds| (asset.symbol, thresholds))
        })
        .collect();
    let version = methodology_version();
    let git_sha = methodology_git_sha();
    let mut assets = BTreeMap::new();
    let mut all_bundles = HashMap::new();

    for (symbol, series) in &fixture.series {
        let thresholds = thresholds_by_asset
            .get(symbol)
            .with_context(|| format!("no thresholds_bps for {symbol}"))?;
        let (result, bundles) = run_asset(
            symbol,
            series,
            thresholds,
            fidelity(symbol),
            version,
            git_sha,
            &assets_canonical,
        )?;
        assets.insert(symbol.clone(), result);
        all_bundles.insert(symbol.clone(), bundles);
    }

    Ok((
        BacktestOutput {
            case: case.to_string(),
            methodology_version: version.to_string(),
            inputs_sha256: sha256_hex(fixture_json.as_bytes()),
            assets,
        },
        all_bundles,
    ))
}

pub async fn run(case: String, capture: bool, check: bool) -> Result<()> {
    let directory = PathBuf::from("docs/backtests").join(&case);
    if capture {
        capture_inputs(&directory).await.context("capture inputs")?;
    }
    let fixture_json =
        std::fs::read_to_string(directory.join("inputs.json")).context("read inputs.json")?;
    let assets_toml = std::fs::read_to_string(directory.join("assets-snapshot.toml"))
        .context("read assets-snapshot.toml")?;
    let (output, bundles) = compute_output(&case, &fixture_json, &assets_toml)?;
    let rendered = serde_json::to_string_pretty(&output)? + "\n";
    let golden_path = directory.join("methodology-output.json");

    if check {
        let golden = std::fs::read_to_string(&golden_path).context("read golden")?;
        anyhow::ensure!(
            golden == rendered,
            "BACKTEST DRIFT — {} differs from freshly computed output",
            golden_path.display()
        );
        println!("backtest {case}: no drift ✓");
        return Ok(());
    }

    std::fs::write(&golden_path, rendered)?;
    let receipts_directory = directory.join("receipts");
    std::fs::create_dir_all(&receipts_directory)?;
    for entry in std::fs::read_dir(&receipts_directory)? {
        let path = entry?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            std::fs::remove_file(path)?;
        }
    }
    for (symbol, asset_bundles) in &bundles {
        for (index, bundle) in asset_bundles.iter().enumerate() {
            let path = receipts_directory.join(format!("{symbol}-{:03}.json", index + 1));
            std::fs::write(path, deterministic_pretty_json(&bundle.receipt)?)?;
        }
    }
    println!(
        "backtest {case}: wrote {} + {} receipt bundles",
        golden_path.display(),
        bundles.values().map(Vec::len).sum::<usize>()
    );
    Ok(())
}

async fn capture_inputs(directory: &std::path::Path) -> Result<()> {
    use std::collections::BTreeMap;

    use self::benchmarks::fetch_history;
    use self::types::{AssetSeries, Tick, Window};

    const FROM: i64 = 1_759_968_000;
    const TO: i64 = 1_760_227_200;
    const RESOLUTION: &str = "1";

    struct Spec {
        symbol: &'static str,
        class: &'static str,
        market: &'static str,
        intrinsic: Option<&'static str>,
        intrinsic_feed: Option<&'static str>,
        nav_feed: Option<&'static str>,
        numeraire_feed: Option<&'static str>,
    }

    let specs = [
        Spec {
            symbol: "USDe",
            class: "stable_dn",
            market: "USDE/USD",
            intrinsic: Some("fixed_1_usd"),
            intrinsic_feed: None,
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "PYUSD",
            class: "stable_fiat",
            market: "PYUSD/USD",
            intrinsic: Some("fixed_1_usd"),
            intrinsic_feed: None,
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "USDC",
            class: "stable_fiat",
            market: "USDC/USD",
            intrinsic: Some("fixed_1_usd"),
            intrinsic_feed: None,
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "USDT",
            class: "stable_fiat",
            market: "USDT/USD",
            intrinsic: Some("fixed_1_usd"),
            intrinsic_feed: None,
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "USDS",
            class: "stable_cdp",
            market: "USDS/USD",
            intrinsic: Some("fixed_1_usd"),
            intrinsic_feed: None,
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "sUSDe",
            class: "stable_yield",
            market: "SUSDE/USD",
            intrinsic: None,
            intrinsic_feed: Some("SUSDE/USDE.RR"),
            nav_feed: None,
            numeraire_feed: None,
        },
        Spec {
            symbol: "jitoSOL",
            class: "lst",
            market: "JITOSOL/USD",
            intrinsic: None,
            intrinsic_feed: None,
            nav_feed: Some("JITOSOL/SOL.RR"),
            numeraire_feed: Some("SOL/USD"),
        },
        Spec {
            symbol: "mSOL",
            class: "lst",
            market: "MSOL/USD",
            intrinsic: None,
            intrinsic_feed: None,
            nav_feed: Some("MSOL/SOL.RR"),
            numeraire_feed: Some("SOL/USD"),
        },
        Spec {
            symbol: "bSOL",
            class: "lst",
            market: "BSOL/USD",
            intrinsic: None,
            intrinsic_feed: None,
            nav_feed: Some("BSOL/SOL.RR"),
            numeraire_feed: Some("SOL/USD"),
        },
        Spec {
            symbol: "INF",
            class: "lst",
            market: "INF/USD",
            intrinsic: None,
            intrinsic_feed: None,
            nav_feed: Some("INF/SOL.RR"),
            numeraire_feed: Some("SOL/USD"),
        },
    ];

    let sol = fetch_history("SOL/USD", RESOLUTION, FROM, TO).await?;
    let sol_by_time: HashMap<_, _> = sol.iter().map(|candle| (candle.t, candle.close)).collect();
    let mut series = BTreeMap::new();

    for spec in specs {
        let market = fetch_history(spec.market, RESOLUTION, FROM, TO).await?;
        let nav = match spec.nav_feed {
            Some(feed) => Some(fetch_history(feed, RESOLUTION, FROM, TO).await?),
            None => None,
        };
        let intrinsic = match spec.intrinsic_feed {
            Some(feed) => Some(fetch_history(feed, RESOLUTION, FROM, TO).await?),
            None => None,
        };
        let nav_by_time: Option<HashMap<_, _>> = nav.as_ref().map(|candles| {
            candles
                .iter()
                .map(|candle| (candle.t, candle.close))
                .collect()
        });
        let intrinsic_by_time: Option<HashMap<_, _>> = intrinsic.as_ref().map(|candles| {
            candles
                .iter()
                .map(|candle| (candle.t, candle.close))
                .collect()
        });

        let mut ticks = Vec::with_capacity(market.len());
        for candle in market {
            let mut tick = Tick {
                t: candle.t,
                market_usd: candle.close,
                intrinsic_usd: intrinsic_by_time
                    .as_ref()
                    .and_then(|values| values.get(&candle.t).copied()),
                market_sol: None,
                intrinsic_sol: None,
                // Benchmark history (Finnhub candles) carries no Pyth confidence
                // or liveness signal.
                pyth_conf: None,
                intrinsic_stale: None,
                market_unavailable: None,
                premium_unconfirmed: None,
            };
            if let (Some(nav_values), Some(sol_price)) = (&nav_by_time, sol_by_time.get(&candle.t))
            {
                if let Some(nav_value) = nav_values.get(&candle.t) {
                    tick.intrinsic_sol = Some(*nav_value);
                    tick.market_sol = candle.close.checked_div(*sol_price);
                    tick.intrinsic_usd = nav_value.checked_mul(*sol_price);
                }
            }
            ticks.push(tick);
        }
        series.insert(
            spec.symbol.to_string(),
            AssetSeries {
                class: spec.class.to_string(),
                market_feed: Some(spec.market.to_string()),
                intrinsic: spec.intrinsic.map(str::to_string),
                intrinsic_feed: spec.intrinsic_feed.map(str::to_string),
                nav_feed: spec.nav_feed.map(str::to_string),
                numeraire_feed: spec.numeraire_feed.map(str::to_string),
                ticks,
            },
        );
    }

    let fixture = InputsFixture {
        schema_version: "v1".to_string(),
        captured_at: chrono::Utc::now().to_rfc3339(),
        source: format!("pyth-benchmarks tradingview shim, resolution={RESOLUTION}"),
        window: Window {
            start: "2025-10-09T00:00:00Z".to_string(),
            end: "2025-10-12T00:00:00Z".to_string(),
        },
        series,
    };
    std::fs::create_dir_all(directory)?;
    std::fs::write(
        directory.join("inputs.json"),
        serde_json::to_string_pretty(&fixture)? + "\n",
    )?;
    println!(
        "captured {} assets to {}/inputs.json",
        fixture.series.len(),
        directory.display()
    );
    Ok(())
}
