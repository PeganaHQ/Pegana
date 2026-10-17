use std::collections::BTreeMap;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

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
pub struct Window {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetSeries {
    pub class: String,
    #[serde(default)]
    pub market_feed: Option<String>,
    #[serde(default)]
    pub intrinsic: Option<String>, // e.g. "fixed_1_usd"
    #[serde(default)]
    pub intrinsic_feed: Option<String>, // e.g. "SUSDE/USDE.RR"
    #[serde(default)]
    pub nav_feed: Option<String>, // LST: "<LST>/SOL.RR"
    #[serde(default)]
    pub numeraire_feed: Option<String>, // LST: "SOL/USD"
    pub ticks: Vec<Tick>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tick {
    /// Unix seconds (UTC).
    pub t: i64,
    pub market_usd: Decimal,
    #[serde(default)]
    pub intrinsic_usd: Option<Decimal>,
    #[serde(default)]
    pub market_sol: Option<Decimal>,
    #[serde(default)]
    pub intrinsic_sol: Option<Decimal>,
    /// Optional 1-sigma Pyth confidence (USD, same units as `market_usd`) on
    /// this asset's oracle leg. When present, the runner materialises a
    /// `pyth_entries` row so the ADR-0032 confidence gate can be replayed;
    /// `None` (every historical fixture to date, which captured no Pyth data)
    /// leaves `pyth_entries` empty exactly as before — byte-exact preserved.
    #[serde(default)]
    pub pyth_conf: Option<Decimal>,
    /// Optional frozen intrinsic-liveness verdict (ADR-0038): `Some(true)`
    /// replays a stale backing so the force-UNKNOWN gate can be exercised.
    /// `None`/`false` (every historical fixture) → omitted from the hash →
    /// byte-exact golden.
    #[serde(default)]
    pub intrinsic_stale: Option<bool>,
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
    pub fidelity: String, // "perfect" | "market-proxied" | "doubly-proxied"
    pub transitions: Vec<Transition>,
    pub time_to_first_alert_secs: Option<i64>,
    pub max_state: String,
    pub ticks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transition {
    pub t: String, // RFC3339
    pub from: String,
    pub to: String,
    pub discount_smooth: Decimal,
    pub receipt_sha256: String,
}
