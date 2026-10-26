//! Shared types between Pegana services.
//!
//! Public-safe types (the closed set needed to parse `assets.toml`, validate
//! an `AlertEvidence`, or enumerate `PegState`) live in the
//! `pegana-common-verify` crate, which mirrors to the public `pegana-replay`
//! repo. We re-export them from here so existing consumers (engine,
//! dispatcher, api, indexer, xtask, bot) keep the `use pegana_common::Foo`
//! path unchanged — no churn outside this crate, full forward-compat.
//!
//! Everything declared directly in this file is *server-side only* —
//! Redis channel namespaces, in-memory snapshot envelopes, the audit base
//! URL helper that reads env vars, Sentry init, prometheus exporter,
//! webhook signing / response truncation / URL validation. None of these
//! ship to `pegana-replay`.

pub mod observability;
pub mod webhook_channel;
pub mod webhook_response;
pub mod webhook_sign;
pub mod webhook_url;

// Public, verifier-safe types — re-exported so `pegana_common::AssetClass`,
// `pegana_common::PegState`, etc. continue to resolve.
pub use pegana_common_verify::*;

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

// ===== Snapshot types (cross-service Redis payloads) — server-only =====
//
// These types are the in-process envelope for the readings written to Redis
// channels by the indexer and consumed by the engine. They reference
// `pegana_common_verify::AssetClass` via the re-export above. They are NOT
// part of any audit receipt and explicitly stay private — leaking them
// would expose the engine's runtime contract.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntrinsicReading {
    pub asset: String,
    pub value_usd: Decimal,
    pub source: String,
    pub slot: Option<u64>,
    pub meta: serde_json::Value,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketReading {
    pub asset: String,
    pub value_usd: Decimal,
    pub numeraire: String,
    pub raw_in: u64,
    pub raw_out: u64,
    pub price_impact_pct: Option<Decimal>,
    pub route_label: Option<String>,
    pub ts: DateTime<Utc>,
}

/// In-memory shape of the `alerts` row emitted by the engine. Separate from
/// `AlertEvidence` (public, /v1/audit/:id payload): `AlertEvent` is the
/// transient state-transition delta the dispatcher fans out; `AlertEvidence`
/// is the persisted receipt the audit page renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertEvent {
    pub id: uuid::Uuid,
    pub asset: String,
    pub class: AssetClass,
    pub peg_target: PegTarget,
    pub from_state: PegState,
    pub to_state: PegState,
    pub discount: Decimal,
    pub intrinsic_usd: Decimal,
    pub market_usd: Decimal,
    pub extra: serde_json::Value,
    pub detected_at: DateTime<Utc>,
}

/// The `pegana:evidence_reconciled` pub/sub notification (engine → dispatcher,
/// ADR-0006). The engine publishes it when a pending audit row is promoted to a
/// live receipt; the dispatcher re-fires an `evidence_now_available` follow-up to
/// the chats/webhooks that got the original alert. Shared here so BOTH crates
/// serialize/parse the SAME contract — a field/name change fails compilation on
/// both sides (and the integration test) instead of silently drifting on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceReconciledEvent {
    /// Discriminator; always `"evidence_now_available"`.
    pub event: String,
    pub alert_id: uuid::Uuid,
}

// ===== Numeric helpers — server-only =====

/// Convert a `rust_decimal::Decimal` to `f64` for metrics emission (gauges).
///
/// Intentionally uses the `.to_string().parse()` round-trip rather than
/// `rust_decimal`'s `.to_f64()` (via `num_traits::ToPrimitive`) because the
/// latter is lossy for large values and can return `None` unexpectedly.
/// The string route gives a well-defined, consistent conversion: any value
/// that survives `Decimal::to_string` can be parsed by `f64::from_str`, and
/// only pathological inputs (shouldn't arise in metrics paths) fall back to
/// `0.0`. This is the canonical fallback used across all indexer sources.
#[inline]
pub fn decimal_to_f64(d: Decimal) -> f64 {
    d.to_string().parse::<f64>().unwrap_or(0.0)
}

pub const AUDIT_BASE_URL_ENV: &str = "AUDIT_BASE_URL";

/// Audit URL base used in webhook payloads + Telegram links. Reads
/// `AUDIT_BASE_URL` from env; defaults to the production origin so dev
/// configs don't need to set it.
pub fn audit_base_url() -> String {
    std::env::var(AUDIT_BASE_URL_ENV).unwrap_or_else(|_| "https://pegana.xyz".to_string())
}

// ===== Redis channels — server-only =====

pub mod channels {
    pub const SRC_SANCTUM: &str = "pegana:src:sanctum";
    pub const SRC_JUPITER: &str = "pegana:src:jupiter";
    pub const SRC_PYTH: &str = "pegana:src:pyth";
    pub const SRC_HYLO: &str = "pegana:src:hylo";
    pub const SRC_SOLAYER: &str = "pegana:src:solayer";
    pub const SRC_PIGGYBANK: &str = "pegana:src:piggybank";
    pub const SRC_SPL_STAKE_POOL: &str = "pegana:src:spl_stake_pool";
    pub const SRC_PERENA: &str = "pegana:src:perena";
    /// Generic `{asset, value_usd, ts}` intrinsic envelope shared by the
    /// free off-Pyth NAV sources (Jupiter Perps pool AUM, Ethereum view calls,
    /// HTTP FX median). Same shape as the Sanctum/Solayer/Perena channels.
    pub const SRC_INTRINSIC: &str = "pegana:src:intrinsic";
    pub const ALERTS_STREAM: &str = "pegana:alerts";
    /// Engine → dispatcher pub/sub channel (ADR-0006). The engine's
    /// `alert_evidence` reconcile worker publishes an `evidence_now_available`
    /// event here after a pending audit row is promoted; the dispatcher
    /// subscribes and re-fires the now-live audit link to the subscribers that
    /// received the original alert. Single source of truth for both crates —
    /// `engine_rs::evidence_reconcile::EVIDENCE_RECONCILED_CHANNEL` aliases this.
    pub const EVIDENCE_RECONCILED: &str = "pegana:evidence_reconciled";
    /// Engine → API fan-out. Every recompute publishes an `update` envelope;
    /// a background timer publishes a `heartbeat` so clients can detect engine
    /// liveness even when nothing changed.
    pub const DISCOUNT: &str = "pegana:discount";
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    #[test]
    fn decimal_to_f64_typical() {
        // Basic round-trip for a normal price-like value.
        let d = Decimal::from_str("1.23").unwrap();
        let got = decimal_to_f64(d);
        assert!((got - 1.23_f64).abs() < 1e-10, "expected ~1.23, got {got}");
    }

    #[test]
    fn decimal_to_f64_zero() {
        assert_eq!(decimal_to_f64(Decimal::ZERO), 0.0_f64);
    }

    #[test]
    fn decimal_to_f64_one() {
        assert_eq!(decimal_to_f64(Decimal::ONE), 1.0_f64);
    }

    #[test]
    fn decimal_to_f64_large() {
        // A large but representable value should survive the round-trip.
        let d = Decimal::from_str("999999999.999999999").unwrap();
        let got = decimal_to_f64(d);
        assert!(got > 999_999_999.0 && got < 1_000_000_001.0, "got {got}");
    }

    #[test]
    fn decimal_to_f64_matches_inline_idiom() {
        // Verify our helper is byte-identical to the original inlined expression.
        let cases = ["0", "1", "1.5", "0.999999", "123456789.123456789"];
        for s in cases {
            let d = Decimal::from_str(s).unwrap();
            let expected = d.to_string().parse::<f64>().unwrap_or(0.0);
            assert_eq!(decimal_to_f64(d), expected, "mismatch for {s}");
        }
    }
}
