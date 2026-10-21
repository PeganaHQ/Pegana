//! Indexer configuration — env + assets.toml.

use anyhow::{Context, Result};
use pegana_common::AssetsFile;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)] // feature_brz is reserved for v1.5; solana_rpc_url_fallback is now live
pub struct Config {
    pub database_url: String,
    pub redis_url: String,

    #[serde(default = "default_sanctum_url")]
    pub sanctum_api_url: String,
    /// Max tolerated disagreement (bps) between the Sanctum API NAV and its
    /// reference (`SANCTUM_NAV_DRIFT_BPS`). Default = `sanctum_nav::NAV_MAX_DRIFT_BPS`
    /// (100 = 1%). Reference is the on-chain NAV when readable, else the Jupiter
    /// market-implied NAV (one-sided: API below market). The Sanctum batch endpoint
    /// can serve a stale-low NAV while its HTTP still returns 200 (2026-10-19: ~2.4%
    /// low across 38 LSTs, every one rendered PEGGED); this bound catches that.
    #[serde(default = "default_sanctum_nav_drift_bps")]
    pub sanctum_nav_drift_bps: i64,
    #[serde(default = "default_jupiter_url")]
    pub jupiter_api_url: String,
    #[serde(default = "default_pyth_url")]
    pub pyth_hermes_url: String,
    /// Keyed Hermes host goes in PYTH_HERMES_URL (already supported via env);
    /// the key goes in PYTH_HERMES_API_KEY.
    #[serde(default)]
    pub pyth_hermes_api_key: Option<String>,
    /// On-chain Pyth fallback master switch (`PYTH_ONCHAIN_FALLBACK`). Kept as
    /// a string because envy/serde's bool only accepts `true`/`false`, and the
    /// documented form is `PYTH_ONCHAIN_FALLBACK=1`. Unset = enabled. Parsed by
    /// `sources::pyth::parse_onchain_flag`.
    #[serde(default)]
    pub pyth_onchain_fallback: Option<String>,
    #[serde(default = "default_rpc_url")]
    pub solana_rpc_url: String,
    #[serde(default = "default_rpc_fallback")]
    pub solana_rpc_url_fallback: String,

    #[serde(default = "default_assets_path")]
    pub assets_file: PathBuf,

    // polling cadences (env overrides — assets.toml [polling] section provides backup defaults)
    pub poll_tick_ms: Option<u64>,
    pub sanctum_poll_ms: Option<u64>,
    pub hylo_poll_ms: Option<u64>,
    pub solayer_poll_ms: Option<u64>,
    pub piggybank_poll_ms: Option<u64>,
    pub spl_stake_pool_poll_ms: Option<u64>,
    pub perena_poll_ms: Option<u64>,
    /// Cadence for the `token_supply` source (circulating-supply size/context
    /// signal — isolated from NAV/discount). Falls back to 10 minutes in the
    /// adapter when unset — mint `supply` changes slowly (mints/burns/epoch
    /// unstakes), so there is no benefit to polling at the NAV cadence.
    pub token_supply_poll_ms: Option<u64>,

    #[serde(default)]
    pub jupiter_api_key: Option<String>,
    /// How many Jupiter quotes to fire in parallel per tick. Default 2 keeps
    /// the keyless budget reasonable while halving asset latency; bump to 4–8
    /// when JUPITER_API_KEY is set.
    #[serde(default = "default_jupiter_concurrent")]
    pub jupiter_max_concurrent: usize,
    /// tokens.xyz market-snapshots API key (`x-api-key`). When unset the
    /// tokens.xyz liquidity source stays idle. Provisioned via app.tokens.xyz;
    /// lives in the host `.env` only (never committed).
    #[serde(default)]
    pub tokens_xyz_api_key: Option<String>,

    #[serde(default = "default_true")]
    pub feature_hylo: bool,
    #[serde(default = "default_true")]
    pub feature_brz: bool,
    #[serde(default = "default_true")]
    pub feature_solayer: bool,
    #[serde(default = "default_true")]
    pub feature_piggybank: bool,
    #[serde(default = "default_true")]
    pub feature_spl_stake_pool: bool,
    #[serde(default = "default_true")]
    pub feature_perena: bool,
    /// Circulating-supply/market-cap size-context source (migration 0065).
    /// Isolated from the NAV/discount pipeline — safe to disable independently.
    #[serde(default = "default_true")]
    pub feature_token_supply: bool,
    /// Postgres pool ceiling. Default 15 — the source fan-out (jupiter, pyth,
    /// sanctum, dexscreener, …) can exceed sqlx's default of 10 during a poll
    /// cycle, starving the write path. Override via DB_MAX_CONNECTIONS.
    #[serde(default = "default_db_max_connections")]
    pub db_max_connections: u32,
    /// Per-connection `statement_timeout`, in ms (0 = unlimited). 30s backstop
    /// so a write stalled on a TimescaleDB chunk lock fails fast instead of
    /// freezing ingestion. Override via DB_STATEMENT_TIMEOUT_MS.
    #[serde(default = "default_db_statement_timeout_ms")]
    pub db_statement_timeout_ms: u64,
}

fn default_sanctum_url() -> String {
    "https://extra-api.sanctum.so".into()
}
fn default_sanctum_nav_drift_bps() -> i64 {
    crate::sources::sanctum_nav::NAV_MAX_DRIFT_BPS
}
fn default_jupiter_url() -> String {
    "https://lite-api.jup.ag".into()
}
fn default_pyth_url() -> String {
    "https://hermes.pyth.network".into()
}
fn default_rpc_url() -> String {
    "https://api.mainnet-beta.solana.com".into()
}
fn default_rpc_fallback() -> String {
    "https://solana-rpc.publicnode.com".into()
}
fn default_assets_path() -> PathBuf {
    PathBuf::from("./assets.toml")
}
fn default_true() -> bool {
    true
}
fn default_jupiter_concurrent() -> usize {
    // 1 is the only safe default for the keyless lite-api (0.5 RPS budget).
    // Bump via JUPITER_MAX_CONCURRENT when JUPITER_API_KEY is set.
    1
}
fn default_db_max_connections() -> u32 {
    15
}
fn default_db_statement_timeout_ms() -> u64 {
    30_000
}

/// `Authorization` value for Hermes. An empty/blank key counts as no key:
/// docker-compose passes `PYTH_HERMES_API_KEY=` through as an empty string,
/// and `Bearer ` with nothing after it is not a credential.
pub(crate) fn pyth_bearer(key: Option<&str>) -> Option<String> {
    effective_pyth_key(key).map(|k| format!("Bearer {k}"))
}

/// The configured Hermes key, trimmed, or `None` when unset or blank.
pub(crate) fn effective_pyth_key(key: Option<&str>) -> Option<&str> {
    key.map(str::trim).filter(|k| !k.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let _ = dotenvy::dotenv();
        envy::prefixed("").from_env::<Self>().context("parse env")
    }

    pub fn load_assets(&self) -> Result<AssetsFile> {
        let raw = std::fs::read_to_string(&self.assets_file)
            .with_context(|| format!("read assets file {}", self.assets_file.display()))?;
        toml::from_str(&raw).context("parse assets.toml")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_config_toml(extra: &str) -> String {
        format!(
            r#"
database_url = "postgres://localhost/pegana"
redis_url = "redis://localhost:6379"
{extra}
"#
        )
    }

    #[test]
    fn deserializes_pyth_hermes_api_key_and_defaults_to_none() {
        let cfg: Config =
            toml::from_str(&minimal_config_toml("")).expect("minimal config should deserialize");
        assert_eq!(cfg.pyth_hermes_api_key, None);

        let cfg: Config = toml::from_str(&minimal_config_toml(
            r#"pyth_hermes_api_key = "hermes-secret""#,
        ))
        .expect("config with pyth hermes key should deserialize");
        assert_eq!(cfg.pyth_hermes_api_key.as_deref(), Some("hermes-secret"));
    }

    #[test]
    fn deserializes_pyth_onchain_fallback_flag_and_defaults_to_none() {
        let cfg: Config =
            toml::from_str(&minimal_config_toml("")).expect("minimal config should deserialize");
        assert_eq!(cfg.pyth_onchain_fallback, None);

        let cfg: Config = toml::from_str(&minimal_config_toml(r#"pyth_onchain_fallback = "1""#))
            .expect("config with on-chain flag should deserialize");
        assert_eq!(cfg.pyth_onchain_fallback.as_deref(), Some("1"));
    }

    #[test]
    fn pyth_bearer_formats_optional_authorization_value() {
        assert_eq!(pyth_bearer(None), None);
        assert_eq!(pyth_bearer(Some("")), None, "empty env value is no key");
        assert_eq!(pyth_bearer(Some("   ")), None, "blank env value is no key");
        assert_eq!(
            pyth_bearer(Some("hermes-secret")),
            Some("Bearer hermes-secret".to_string())
        );
    }
}
