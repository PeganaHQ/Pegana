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

#[test]
fn parse_benchmarks_history_extracts_closes() {
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

use std::str::FromStr;

use rust_decimal::Decimal;
use xtask::backtest::types::{AssetSeries, Tick};

fn tick(t: i64, market: &str) -> Tick {
    Tick {
        t,
        market_usd: Decimal::from_str(market).unwrap(),
        intrinsic_usd: None,
        market_sol: None,
        intrinsic_sol: None,
        pyth_conf: None,
        intrinsic_stale: None,
    }
}

fn thresholds(drift: u32, depeg: u32, critical: u32) -> std::collections::HashMap<String, u32> {
    [("drift", drift), ("depeg", depeg), ("critical", critical)]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}

#[test]
fn runner_escalates_usde_to_at_least_depeg_and_self_verifies() {
    let mut ticks = vec![tick(0, "1.0000")];
    for i in 1..40 {
        ticks.push(tick(i * 60, "0.9530"));
    }
    let series = AssetSeries {
        class: "stable_dn".into(),
        market_feed: Some("USDE/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None,
        nav_feed: None,
        numeraire_feed: None,
        ticks,
    };
    let thresholds = [("drift", 25_u32), ("depeg", 100), ("critical", 300)]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();

    let (result, bundles) = xtask::backtest::runner::run_asset(
        "USDe",
        &series,
        &thresholds,
        "market-proxied",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    let reached: Vec<&str> = result
        .transitions
        .iter()
        .map(|transition| transition.to.as_str())
        .collect();
    assert!(
        reached.contains(&"DEPEG") || reached.contains(&"CRITICAL"),
        "expected >= DEPEG, got {reached:?}"
    );
    for bundle in bundles {
        let rederived = methodology::rederive(&bundle.inputs_frozen).expect("rederive");
        assert_eq!(
            xtask::backtest::runner::state_str(rederived.final_state),
            xtask::backtest::runner::state_str(bundle.expected_computed.final_state)
        );
    }
}

#[test]
fn runner_keeps_stable_pegged_no_false_positive() {
    let ticks = (0..30).map(|i| tick(i * 60, "0.9997")).collect();
    let series = AssetSeries {
        class: "stable_fiat".into(),
        market_feed: Some("USDC/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None,
        nav_feed: None,
        numeraire_feed: None,
        ticks,
    };
    let thresholds = [("drift", 15_u32), ("depeg", 50), ("critical", 200)]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();
    let (result, _) = xtask::backtest::runner::run_asset(
        "USDC",
        &series,
        &thresholds,
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .unwrap();
    assert!(result.transitions.is_empty(), "USDC must not leave PEGGED");
    assert_eq!(result.max_state, "PEGGED");
}

#[test]
fn premium_sanity_unknown_clears_candidate_before_recovery() {
    let series = AssetSeries {
        class: "lst".into(),
        market_feed: Some("LST/USD".into()),
        intrinsic: None,
        intrinsic_feed: Some("LST/USD.RR".into()),
        nav_feed: None,
        numeraire_feed: None,
        ticks: vec![
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(0, "0.995")
            },
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(60, "0.995")
            },
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(120, "1.5")
            },
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(240, "0.65")
            },
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(360, "1.0")
            },
        ],
    };

    let (result, bundles) = xtask::backtest::runner::run_asset(
        "LST",
        &series,
        &thresholds(45, 110, 250),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    let recovery = result
        .transitions
        .iter()
        .find(|transition| transition.from == "UNKNOWN" && transition.to == "PEGGED")
        .expect("eventual recovery to PEGGED");
    assert_eq!(recovery.t, "1970-01-01T00:06:00+00:00");

    let recovery_bundle = bundles
        .iter()
        .find(|bundle| bundle.receipt.expected_receipt_sha256 == recovery.receipt_sha256)
        .expect("recovery receipt");
    assert_eq!(
        recovery_bundle.inputs_frozen.candidate_since,
        chrono::DateTime::from_timestamp(240, 0),
        "premium-sanity must clear the old candidate and restart confirmation"
    );
    let rederived =
        methodology::rederive(&recovery_bundle.inputs_frozen).expect("rederive recovery");
    assert_eq!(
        rederived.discount_raw,
        recovery_bundle.expected_computed.discount_raw
    );
    assert_eq!(
        rederived.discount_smooth,
        recovery_bundle.expected_computed.discount_smooth
    );
    assert_eq!(
        rederived.final_state,
        recovery_bundle.expected_computed.final_state
    );
}

#[test]
fn discount_sanity_backtest_forces_unknown_then_confirms_and_self_verifies() {
    // Garbage-HIGH intrinsic (2.0 vs a real ~1.0) → a healthy market of 1.0
    // reads 50% "below" NAV = 5000 bps discount, past NAV_DISCOUNT_SANITY_BPS
    // (3000), SUSTAINED for 6 minutes. ADR-0039 (extended in the P1 audit
    // 2026-07-18): a discount beyond the sanity bound is masked UNKNOWN only
    // while UNCONFIRMED — a SUSTAINED extreme (garbage OR a real >30% collapse;
    // magnitude cannot tell them apart) confirms BLACK_SWAN through the
    // hysteresis window rather than being masked FOREVER. So this goes
    // UNKNOWN → BLACK_SWAN. The primary assertion below (runner == rederive) is
    // what matters: all THREE implementations now share `override_final_state`
    // and agree by construction (this test previously PASSED only because the
    // runner carried the buggy hand-rolled copy that missed the carve-out — the
    // exact drift the P1 audit's finding #12 identified).
    let series = AssetSeries {
        class: "lst".into(),
        market_feed: Some("LST/USD".into()),
        intrinsic: None,
        intrinsic_feed: Some("LST/USD.RR".into()),
        nav_feed: None,
        numeraire_feed: None,
        ticks: (0..6)
            .map(|i| Tick {
                intrinsic_usd: Some(Decimal::from_str("2.0").unwrap()),
                ..tick(i * 60, "1.0")
            })
            .collect(),
    };

    let (result, bundles) = xtask::backtest::runner::run_asset(
        "LST",
        &series,
        &thresholds(45, 110, 250),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    // The sustained garbage/extreme is UNKNOWN while unconfirmed, then confirms
    // BLACK_SWAN (ADR-0039) — and NEVER a mid-band CRITICAL (the sanity path +
    // carve-out only ever produce UNKNOWN or the committed BLACK_SWAN).
    let states: Vec<String> = bundles
        .iter()
        .map(|b| xtask::backtest::runner::state_str(b.expected_computed.final_state))
        .collect();
    assert_eq!(
        states.first().map(String::as_str),
        Some("UNKNOWN"),
        "the first (unconfirmed) tick must mask to UNKNOWN, got {states:?}"
    );
    assert!(
        states.iter().any(|s| s.as_str() == "BLACK_SWAN"),
        "a SUSTAINED beyond-sanity extreme must confirm BLACK_SWAN (ADR-0039), got {states:?}"
    );
    assert!(
        !states.iter().any(|s| s.as_str() == "CRITICAL"),
        "must never publish a mid-band CRITICAL off the garbage, got {states:?}"
    );

    // Every receipt re-derives to the SAME verdict — this is the assertion that
    // caught the missing gate (runner CRITICAL vs rederive UNKNOWN).
    for bundle in &bundles {
        let rederived = methodology::rederive(&bundle.inputs_frozen).expect("rederive");
        assert_eq!(
            xtask::backtest::runner::state_str(rederived.final_state),
            xtask::backtest::runner::state_str(bundle.expected_computed.final_state),
            "runner verdict must equal the engine's rederive"
        );
    }
    let _ = result;
}

#[test]
fn pyth_confidence_gate_backtest_forces_unknown_and_self_verifies() {
    // Healthy market (1.0) but a WIDE Pyth confidence (0.06/1.0 = 600 bps >
    // PYTH_CONFIDENCE_GATE_BPS = 500, ADR-0032) → the verdict must be forced to
    // UNKNOWN even though the price itself is fine, and the self-verifying
    // rederive (which reads pyth_entries) must agree.
    let series = AssetSeries {
        class: "stable_fiat".into(),
        market_feed: Some("USDC/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None,
        nav_feed: None,
        numeraire_feed: None,
        ticks: (0..4)
            .map(|i| Tick {
                pyth_conf: Some(Decimal::from_str("0.06").unwrap()),
                ..tick(i * 60, "1.0")
            })
            .collect(),
    };

    let (_result, bundles) = xtask::backtest::runner::run_asset(
        "USDC",
        &series,
        &thresholds(15, 50, 200),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    assert!(!bundles.is_empty());
    for bundle in &bundles {
        // The conf actually materialised into a receipt entry (not dropped).
        assert_eq!(
            bundle.inputs_frozen.pyth_entries.len(),
            1,
            "pyth_conf must materialise one entry"
        );
        assert_eq!(
            xtask::backtest::runner::state_str(bundle.expected_computed.final_state),
            "UNKNOWN",
            "wide Pyth confidence must force UNKNOWN"
        );
        let rederived = methodology::rederive(&bundle.inputs_frozen).expect("rederive");
        assert_eq!(
            xtask::backtest::runner::state_str(rederived.final_state),
            "UNKNOWN"
        );
    }
}

#[test]
fn narrow_pyth_confidence_does_not_gate_no_false_positive() {
    // Boundary control: a NARROW conf (0.01/1.0 = 100 bps < 500) must NOT gate —
    // a healthy asset stays PEGGED. Proves the gate isn't a blanket "any conf
    // present → UNKNOWN" and that materialising entries is side-effect-free
    // below the threshold.
    let series = AssetSeries {
        class: "stable_fiat".into(),
        market_feed: Some("USDC/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None,
        nav_feed: None,
        numeraire_feed: None,
        ticks: (0..4)
            .map(|i| Tick {
                pyth_conf: Some(Decimal::from_str("0.01").unwrap()),
                ..tick(i * 60, "1.0")
            })
            .collect(),
    };

    let (result, bundles) = xtask::backtest::runner::run_asset(
        "USDC",
        &series,
        &thresholds(15, 50, 200),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    assert!(
        result.transitions.is_empty(),
        "narrow conf must not leave PEGGED"
    );
    assert_eq!(result.max_state, "PEGGED");
    for bundle in &bundles {
        assert_eq!(
            xtask::backtest::runner::state_str(bundle.expected_computed.final_state),
            "PEGGED"
        );
    }
}

#[test]
fn intrinsic_liveness_gate_backtest_forces_unknown_and_self_verifies() {
    // A frozen stale backing (ADR-0038) on an otherwise-healthy LST → UNKNOWN,
    // and the self-verifying rederive (which reads intrinsic_stale) must agree.
    let series = AssetSeries {
        class: "lst".into(),
        market_feed: Some("LST/USD".into()),
        intrinsic: None,
        intrinsic_feed: Some("LST/USD.RR".into()),
        nav_feed: None,
        numeraire_feed: None,
        ticks: (0..4)
            .map(|i| Tick {
                intrinsic_usd: Some(Decimal::ONE), // perfectly at NAV — would be PEGGED
                intrinsic_stale: Some(true),
                ..tick(i * 60, "1.0")
            })
            .collect(),
    };

    let (_result, bundles) = xtask::backtest::runner::run_asset(
        "LST",
        &series,
        &thresholds(45, 110, 250),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    assert!(!bundles.is_empty());
    for bundle in &bundles {
        assert!(bundle.inputs_frozen.intrinsic_stale, "stale must be frozen");
        assert_eq!(
            xtask::backtest::runner::state_str(bundle.expected_computed.final_state),
            "UNKNOWN",
            "a frozen stale backing must force UNKNOWN"
        );
        let rederived = methodology::rederive(&bundle.inputs_frozen).expect("rederive");
        assert_eq!(
            xtask::backtest::runner::state_str(rederived.final_state),
            "UNKNOWN"
        );
    }
}

#[test]
fn hyusd_cr_asset_is_hard_errored_not_silently_misclassified() {
    // The runner has no CR verdict path; hyUSD (stable_cdp) must hard-error
    // rather than silently classify on the bps spread (which the rederive
    // self-check couldn't catch, since the receipt would freeze threshold_kind
    // = "bps"). Guards a latent trap surfaced by the backend audit.
    let series = AssetSeries {
        class: "stable_cdp".into(),
        market_feed: Some("HYUSD/USD".into()),
        intrinsic: Some("fixed_1_usd".into()),
        intrinsic_feed: None,
        nav_feed: None,
        numeraire_feed: None,
        ticks: vec![tick(0, "1.0"), tick(60, "1.0")],
    };
    // `ReceiptBundle` isn't Debug, so match rather than expect_err.
    match xtask::backtest::runner::run_asset(
        "hyUSD",
        &series,
        &thresholds(45, 110, 250),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    ) {
        Ok(_) => panic!("hyUSD must hard-error, not silently classify on bps"),
        Err(e) => assert!(
            e.to_string().contains("no CR verdict path"),
            "unexpected error: {e}"
        ),
    }
}

#[test]
fn non_fixed_asset_skips_tick_without_intrinsic() {
    let series = AssetSeries {
        class: "stable_yield".into(),
        market_feed: Some("YIELD/USD".into()),
        intrinsic: None,
        intrinsic_feed: Some("YIELD/USD.RR".into()),
        nav_feed: None,
        numeraire_feed: None,
        ticks: vec![
            tick(0, "0.5"),
            Tick {
                intrinsic_usd: Some(Decimal::ONE),
                ..tick(60, "1.0")
            },
        ],
    };

    let (result, _) = xtask::backtest::runner::run_asset(
        "YIELD",
        &series,
        &thresholds(30, 100, 300),
        "perfect",
        "0.4.0",
        None,
        "ASSETS_CANON",
    )
    .expect("run_asset");

    assert_eq!(result.ticks, 1, "missing intrinsic tick must be skipped");
    assert!(result.transitions.is_empty());
}

#[test]
fn run_case_produces_deterministic_output() {
    let fixture_json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mini-inputs.json"
    ))
    .unwrap();
    let assets_toml = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mini-assets.toml"
    ))
    .unwrap();
    let first = xtask::backtest::compute_output("mini", &fixture_json, &assets_toml).unwrap();
    let second = xtask::backtest::compute_output("mini", &fixture_json, &assets_toml).unwrap();
    assert_eq!(
        serde_json::to_string_pretty(&first.0).unwrap(),
        serde_json::to_string_pretty(&second.0).unwrap(),
        "output must be byte-deterministic"
    );
    assert!(first.0.assets.contains_key("USDe"));
}

fn load_golden() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/backtests/2025-10-10-usde-depeg/methodology-output.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("golden present")).unwrap()
}

#[test]
fn golden_usde_reaches_at_least_depeg() {
    let golden = load_golden();
    let max = golden["assets"]["USDe"]["max_state"].as_str().unwrap();
    assert!(
        matches!(max, "DEPEG" | "CRITICAL" | "BLACK_SWAN"),
        "USDe max_state={max}"
    );
}

#[test]
fn golden_usdc_holds_and_usdt_alert_is_premium_only() {
    let golden = load_golden();
    assert_eq!(golden["assets"]["USDC"]["max_state"], "PEGGED");
    assert_eq!(
        golden["assets"]["USDC"]["transitions"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    // Pyth's minute series never puts USDT below $1 in this window. It does
    // contain a sustained premium up to $1.00704549. Methodology 0.4.0 treats
    // stable_fiat deviations symmetrically, so the premium produces DEPEG.
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/backtests/2025-10-10-usde-depeg/inputs.json"
    );
    let fixture: xtask::backtest::types::InputsFixture =
        serde_json::from_str(&std::fs::read_to_string(fixture_path).expect("fixture present"))
            .unwrap();
    assert!(fixture.series["USDT"]
        .ticks
        .iter()
        .all(|tick| tick.market_usd >= Decimal::ONE));
    assert_eq!(golden["assets"]["USDT"]["max_state"], "DEPEG");
}

#[test]
fn golden_pyusd_registers_an_alert() {
    let golden = load_golden();
    let max = golden["assets"]["PYUSD"]["max_state"].as_str().unwrap();
    assert!(
        matches!(max, "DRIFT" | "DEPEG" | "CRITICAL"),
        "PYUSD max_state={max}"
    );
}

#[test]
#[ignore = "builds and invokes the public replay CLI"]
fn emitted_receipt_verifies_with_public_cli() {
    let workspace = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let bundle = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json"
    );
    let output = std::process::Command::new(env!("CARGO"))
        .current_dir(workspace)
        .args(["run", "-p", "pegana-replay", "--", "--bundle", bundle])
        .output()
        .expect("run pegana-replay");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("PASS"));
}
