//! Per-asset runtime state for the engine: latest readings, EWMA, hysteresis.

use anyhow::Context;
use chrono::{DateTime, Utc};
use pegana_common::{
    AssetConfig, AssetsFile, IntrinsicStrategy, MarketStrategy, PegState, PythStalenessConfig,
};
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// Row shape returned by the `engine_state_snapshot` hydration query.
/// (asset, ewma_discount, candidate_state, candidate_since, last_state).
/// Aliased to keep clippy::type_complexity happy on `load_from_pg`.
type SnapshotRow = (
    String,
    Option<Decimal>,
    Option<String>,
    Option<DateTime<Utc>>,
    String,
    Option<DateTime<Utc>>, // band_since
    Option<DateTime<Utc>>, // state_since
);

/// Inverse of `crate::peg_state_label` — parse a stored DB label back into
/// the enum. Used by `load_from_pg` to hydrate `last_state` / `candidate_state`
/// from `engine_state_snapshot`. Returns `None` for unknown labels so a stale
/// row from an older methodology version is skipped instead of panicking.
fn parse_peg_state(s: &str) -> Option<PegState> {
    match s {
        "PEGGED" => Some(PegState::Pegged),
        "DRIFT" => Some(PegState::Drift),
        "DEPEG" => Some(PegState::Depeg),
        "CRITICAL" => Some(PegState::Critical),
        "BLACK_SWAN" => Some(PegState::BlackSwan),
        "UNKNOWN" => Some(PegState::Unknown),
        _ => None,
    }
}

/// The committed bands that represent a real alert (DRIFT and worse). PEGGED and
/// UNKNOWN are deliberately excluded — that is the ADR-0024 guard.
fn is_alerting(s: PegState) -> bool {
    matches!(
        s,
        PegState::Drift | PegState::Depeg | PegState::Critical | PegState::BlackSwan
    )
}

/// Per-band "sustained" threshold in seconds. DRIFT is the slow mechanism-depeg
/// case (long: 6h — longer than any routine intra-day band excursion in the
/// calibration data). DEPEG/CRITICAL/BLACK_SWAN are alarming the moment they
/// persist at all (1h). PEGGED/UNKNOWN never qualify.
fn sustained_threshold_secs(s: PegState) -> i64 {
    match s {
        PegState::Drift => 6 * 3600,
        PegState::Depeg | PegState::Critical | PegState::BlackSwan => 3600,
        PegState::Pegged | PegState::Unknown => i64::MAX,
    }
}

/// Pure `sustained` decision. Keys ONLY on committed alerting-band residence:
/// PEGGED/UNKNOWN are NEVER sustained regardless of duration (ADR-0024), and an
/// unknown duration (None) is never sustained (ADR-0019 — missing ≠ confirming).
fn sustained_for(state: PegState, duration_secs: Option<i64>) -> bool {
    match duration_secs {
        Some(s) => is_alerting(state) && s >= sustained_threshold_secs(state),
        None => false,
    }
}

#[cfg(test)]
mod time_below_peg_tests {
    use super::*;

    #[test]
    fn sustained_keys_only_on_committed_alerting_band() {
        use pegana_common::PegState::*;
        let huge = Some(10 * 365 * 24 * 3600_i64); // 10 years
                                                   // PEGGED / UNKNOWN are NEVER sustained — the ADR-0024 guard.
        assert!(!sustained_for(Pegged, huge));
        assert!(!sustained_for(Unknown, huge));
        // None duration (unknown / pre-migration) → never sustained.
        assert!(!sustained_for(Drift, None));
        // DRIFT: sustained only at/after the 6h threshold.
        assert!(!sustained_for(Drift, Some(6 * 3600 - 1)));
        assert!(sustained_for(Drift, Some(6 * 3600)));
        // Severe bands: sustained at/after 1h.
        assert!(!sustained_for(Depeg, Some(3600 - 1)));
        assert!(sustained_for(Depeg, Some(3600)));
        assert!(sustained_for(Critical, Some(3600)));
        assert!(sustained_for(BlackSwan, Some(3600)));
    }
}

/// Freshest (most recent) of two optional observation timestamps. Pure so the
/// end-to-end signal-latency instrumentation can be unit/stress-tested without
/// an `EngineState`. Observability only — never touches classification.
pub fn freshest_observation(
    a: Option<DateTime<Utc>>,
    b: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

/// End-to-end signal latency in seconds, clamped ≥ 0. A clock skew that puts
/// `observed_at` slightly in the future must never surface a negative latency
/// (which would corrupt the histogram), so the difference floors at zero.
pub fn signal_latency_secs(now: DateTime<Utc>, observed_at: DateTime<Utc>) -> f64 {
    (now - observed_at).num_milliseconds().max(0) as f64 / 1000.0
}

#[derive(Debug, Clone, Default)]
pub struct AssetRuntime {
    pub last_intrinsic: Option<Decimal>,
    pub last_market: Option<Decimal>,
    /// SOL-denominated intrinsic for LSTs — `sol_per_lst` from Sanctum.
    /// When both `last_intrinsic_sol` and `last_market_sol` are set the
    /// engine computes discount in SOL terms (multiplier cancels) instead
    /// of USD (where Sanctum and Jupiter may have used different
    /// pyth(SOL/USD) snapshots).
    pub last_intrinsic_sol: Option<Decimal>,
    /// SOL-denominated market for LSTs — `lst_per_sol` from a Jupiter
    /// quote where numeraire = SOL. `None` for USDC/USDT-quoted markets.
    pub last_market_sol: Option<Decimal>,
    /// Engine-receive timestamps per input side, stamped when the matching
    /// `set_*` writes. `snapshot`/`snapshot_sol` gate on these so a non-Pyth
    /// source that stops publishing ages out to "no fresh snapshot" instead of
    /// re-serving its last value as if it were current (hardening H6/H7).
    pub last_intrinsic_at: Option<DateTime<Utc>>,
    pub last_market_at: Option<DateTime<Utc>>,
    pub last_intrinsic_sol_at: Option<DateTime<Utc>>,
    pub last_market_sol_at: Option<DateTime<Utc>>,
    pub ewma_discount: Option<Decimal>,
    pub last_state: PegState,
    pub candidate_state: Option<PegState>,
    pub candidate_since: Option<DateTime<Utc>>,
    pub last_published_state: Option<PegState>,
    /// When the engine last PUBLISHED a state for this asset (stamped in
    /// `set_last_published_state`). Read by `classify_freshness` to surface an
    /// asset that has stopped recomputing entirely — the totally-dead-source
    /// case the snapshot-gating can't catch because it never recomputes (H12b).
    pub last_recompute_at: Option<DateTime<Utc>>,
    /// Top-pair USD liquidity from DexScreener (server-only metadata; NOT part
    /// of the discount computation or the receipt hash). Surfaced in
    /// `event.extra` so a future depth/liquidity gate (ADR-0024, "observe
    /// first") can calibrate against observed liquidity. `None` until a
    /// DexScreener tick arrives.
    pub last_liquidity_usd: Option<Decimal>,
    /// When `last_liquidity_usd` was last written (Phase-1 depth gate
    /// freshness guard, ADR-0026). `None` until the first tick.
    pub last_liquidity_usd_at: Option<DateTime<Utc>>,
    /// When the asset last ENTERED its current committed FSM band (set in
    /// `transition` on a committed state change; reset to None by `force_unknown`).
    /// Drives the time-below-peg `sustained` signal (Spec 03). Persisted in
    /// engine_state_snapshot; NOT a receipt input (ADR-0010). None = duration
    /// unknown (pre-first-transition / pre-migration row) → never `sustained`.
    pub band_since: Option<DateTime<Utc>>,
    /// Timestamp of the first snapshot of the current PUBLISHED-state run
    /// (`discount_snapshots.state`). Unlike `band_since` it follows the
    /// published stream and is never reset by `force_unknown`. Persisted in
    /// engine_state_snapshot (migration 0079) so GET /state `since` is a PK
    /// read. NOT a receipt input (ADR-0010).
    pub state_since: Option<DateTime<Utc>>,
}

/// Next value of `AssetRuntime::state_since` after publishing `new` at `ts`.
/// Moves only on a real published-state change observed in-process
/// (`prev_published` known and different); otherwise it holds. It never
/// fabricates a start from "no prior state": after a restore failure or a
/// deliberate TRUNCATE (migration 0035) both inputs are None and the value
/// stays None until `seed_state_since_from_history` derives the exact run
/// start from `discount_snapshots`. Pure for unit testing.
pub fn next_state_since(
    prev_published: Option<PegState>,
    new: PegState,
    current: Option<DateTime<Utc>>,
    ts: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    match prev_published {
        Some(p) if p != new => Some(ts),
        _ => current,
    }
}

/// Read-only freshness buckets for the H12b observability sweep.
#[derive(Debug, Default, Clone)]
pub struct FreshnessReport {
    pub fresh: usize,
    /// Published before but `last_recompute_at` aged past the threshold.
    pub stale: Vec<String>,
    /// Never published this run.
    pub dead: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct PythEntry {
    pub price: Decimal,
    pub publish_time: DateTime<Utc>,
    /// Pyth's confidence interval (1-sigma) in the same units as `price`.
    /// `conf/price` ratio is the canonical "how trustworthy is this tick"
    /// signal — see https://docs.pyth.network/price-feeds/best-practices.
    pub confidence: Decimal,
    /// `true` when the indexer read this print from an on-chain push-oracle
    /// account (every print since the Hermes stream was removed; `false` only
    /// for an envelope without `origin`, from an older indexer). On-chain
    /// prints step at the push-feed heartbeat (55s or a 0.5% move for Pyth's
    /// documented Solana sponsored feeds) plus the indexer's poll interval, so
    /// they get at least [`DEFAULT_PYTH_ONCHAIN_STALENESS_SECS`] instead of the
    /// 30s base. Never part of a receipt.
    pub onchain: bool,
}

/// Staleness window (seconds) for Pyth prints the indexer read on-chain.
/// Matches the indexer's numeraire gate (`PYTH_NUMERAIRE_STALE_SECS`, 120s):
/// a 55s push-feed heartbeat plus a 12s poll fits inside it with margin, so
/// normal poll jitter never reads as a missing feed (on the 30s base window
/// the confidence label flipped high/unknown every few seconds). Slower
/// feeds get per-feed `[pyth_staleness.overrides]`.
pub const DEFAULT_PYTH_ONCHAIN_STALENESS_SECS: i64 = 120;

pub struct EngineState {
    /// Per-asset runtime (mutex per asset).
    runtimes: RwLock<HashMap<String, Arc<RwLock<AssetRuntime>>>>,
    /// Canonical asset configs by symbol.
    configs: HashMap<String, AssetConfig>,
    /// Latest hyUSD CR (separate signal).
    hyusd_cr: RwLock<Option<Decimal>>,
    /// Latest Pyth prices keyed by symbolic feed name (e.g. "USD/BRL"), with
    /// `publish_time` so `pyth_price` can gate stale readings before the
    /// engine commits to a derived intrinsic.
    pyth: RwLock<HashMap<String, PythEntry>>,
    /// Default max age (seconds) accepted from a cached Pyth reading before
    /// it is treated as missing. Overridable per-feed via `staleness`.
    pyth_staleness_secs: i64,
    /// Floor on the staleness window for on-chain-origin Pyth prints.
    pyth_onchain_staleness_secs: i64,
    /// Per-feed staleness overrides loaded from `assets.toml`. NAV / RR
    /// feeds (USDY, sUSDe, syrupUSDC, ONyc) step at daily cadence and need
    /// a much wider window than the global default.
    staleness: PythStalenessConfig,
    /// Canonical re-serialised assets.toml captured at startup. Used by
    /// `push_alert` to compute the sha256 included in alert receipts and
    /// audit evidence rows. Re-serialising through `toml::Value` strips
    /// comments / whitespace so the hash is stable across formatting-only
    /// edits — matches `pegana_methodology::canonical_assets_hash`.
    assets_toml_canonical: String,
    /// Phase-1 depth-gate (ADR-0026) confidence-cap floor in USD. `0`
    /// (the default from `new`) disables the gate entirely — a real
    /// liquidity reading is always > 0. Only set via `with_depth_gate`.
    depth_gate_floor_usd: Decimal,
    /// Freshness window (seconds) for the depth gate's liquidity read.
    /// Defaults to 600s from `new`; only set via `with_depth_gate`.
    depth_gate_freshness_secs: i64,
    /// Intrinsic-liveness gate (ADR-0038). `false` (the default from `new`)
    /// ships the gate DISABLED — the engine never reads the `intrinsic_liveness`
    /// signal nor freezes `intrinsic_stale`, so verdicts + receipt hashes are
    /// byte-identical. Only set via `with_intrinsic_liveness_gate`.
    intrinsic_liveness_gate_enabled: bool,
    /// Freshness window (seconds) for the liveness read: a liveness row older
    /// than this is ignored (fail-open — a dead liveness SOURCE must not force
    /// UNKNOWN; the engine's own staleness gate handles a dead intrinsic).
    intrinsic_liveness_freshness_secs: i64,
}

/// Default staleness window (seconds) for a non-Pyth input side. Generous on
/// purpose: source polls run every 15–60s, so 600s only ever fires on a real
/// source OUTAGE, never on normal cadence — avoids a false-stale blanking the
/// live dashboard. (Can be tightened per-source via assets.toml later.)
const SOURCE_STALENESS_SECS: i64 = 600;

/// Staleness window (seconds) for an intrinsic side, by source. `None` = no
/// gate (a fixed $1 intrinsic is a constant with no source to go stale).
///
/// Pyth-fed sides ARE gated, by the SAME per-feed window Pyth itself uses
/// (spot ~30s; NAV/RR widened via overrides). `pyth_entry`'s staleness only
/// feeds the confidence label — it does NOT block the PegState verdict — so the
/// engine snapshot MUST re-gate here, or a feed that stops updating while the
/// indexer keeps forwarding lets the engine publish a peg over dead data (F2). Match is
/// exhaustive so a NEW variant is a compile error, never a silent false-stale
/// default (F6).
fn intrinsic_window_secs(
    s: &IntrinsicStrategy,
    staleness: &PythStalenessConfig,
    pyth_default: i64,
) -> Option<i64> {
    match s {
        IntrinsicStrategy::Fixed1Usd => None,
        IntrinsicStrategy::PythFxCross { feed, .. }
        | IntrinsicStrategy::PythRedemptionRate { feed } => {
            // Floor at SOURCE_STALENESS_SECS: the engine receives pyth-fed values
            // at the indexer's FORWARDING throttle (~intrinsic_interval_ms, 30s),
            // NOT the 1Hz feed cadence — so the bare 30s feed-staleness window
            // would false-stale every cycle. The per-feed override (wide for
            // daily NAV/RR) still wins when larger. (F2 cadence fix.)
            Some(
                staleness
                    .limit_for(feed, pyth_default)
                    .max(SOURCE_STALENESS_SECS),
            )
        }
        IntrinsicStrategy::SanctumLst { .. }
        | IntrinsicStrategy::HyloCr { .. }
        | IntrinsicStrategy::HyloXsolNav { .. }
        | IntrinsicStrategy::HyloShyusdRate { .. }
        | IntrinsicStrategy::SolayerSusdRate { .. }
        | IntrinsicStrategy::JupiterPerpsPoolNav { .. }
        | IntrinsicStrategy::EvmViewNav { .. }
        | IntrinsicStrategy::FxHttpMedian { .. }
        | IntrinsicStrategy::SplStakePool { .. }
        | IntrinsicStrategy::PiggybankPbVault { .. } => Some(SOURCE_STALENESS_SECS),
        // The Perena envelope is stamped with the vault's own last_update_ts
        // (the NAV's age), not the poll time, so this window must cover the
        // real crank cadence: see PERENA_NAV_WINDOW_SECS.
        IntrinsicStrategy::PerenaVaultNav { .. } => Some(PERENA_NAV_WINDOW_SECS),
    }
}

/// Freshness window for the Perena USD* NAV, measured against the vault's
/// `last_update_ts`. `crank_nav` was measured on mainnet (2026-10-22, 21
/// cranks over 2.5h) at a median gap of ~825s and a max of 857s, so the NAV
/// is routinely ~14 min old just before a crank; plus the indexer's 60s poll
/// the worst normal age is ~920s, past the generic 600s window. 1200s (~1.4x
/// the max gap) reads one missed crank as stale.
const PERENA_NAV_WINDOW_SECS: i64 = 1200;

/// Staleness window (seconds) for a market side, by source. Pyth spot is gated
/// by its per-feed Pyth window (same reasoning as the intrinsic side, F2);
/// Jupiter + DexScreener are single sources gated by the generous default (H7).
fn market_window_secs(
    s: &MarketStrategy,
    staleness: &PythStalenessConfig,
    pyth_default: i64,
) -> Option<i64> {
    match s {
        // Same forwarding-throttle floor as the pyth-fed intrinsic side (F2).
        MarketStrategy::PythSpot { feed } => Some(
            staleness
                .limit_for(feed, pyth_default)
                .max(SOURCE_STALENESS_SECS),
        ),
        MarketStrategy::JupiterUsd { .. } | MarketStrategy::DexScreenerUsd => {
            Some(SOURCE_STALENESS_SECS)
        }
    }
}

/// Is this input side stale? `window = None` means "no gate". A side with a
/// value but no recorded timestamp is treated as fresh (pre-gate data). Pure
/// for testability — the caller supplies `now`.
fn side_is_stale(window: Option<i64>, last_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    match (window, last_at) {
        (Some(w), Some(at)) => (now - at).num_seconds() > w,
        _ => false,
    }
}

impl EngineState {
    pub fn new(
        assets: &AssetsFile,
        assets_toml_canonical: String,
        pyth_staleness_secs: i64,
    ) -> Self {
        let mut configs = HashMap::new();
        for a in &assets.assets {
            configs.insert(a.symbol.clone(), a.clone());
        }
        Self {
            runtimes: RwLock::new(HashMap::new()),
            configs,
            hyusd_cr: RwLock::new(None),
            pyth: RwLock::new(HashMap::new()),
            pyth_staleness_secs,
            pyth_onchain_staleness_secs: DEFAULT_PYTH_ONCHAIN_STALENESS_SECS,
            staleness: assets.pyth_staleness.clone(),
            assets_toml_canonical,
            depth_gate_floor_usd: Decimal::ZERO,
            depth_gate_freshness_secs: 600,
            intrinsic_liveness_gate_enabled: false,
            intrinsic_liveness_freshness_secs: 3600,
        }
    }

    /// Configure the Phase-1 depth gate (ADR-0026, narrow confidence-cap-only
    /// slice). `floor_usd = 0` disables it (a real liquidity reading is
    /// always > 0, see `tokens_xyz.rs`'s `valid_liquidity`). Builder so
    /// existing `EngineState::new` call sites (all current tests) are
    /// unaffected — only the production wiring in `main()` opts in.
    pub fn with_depth_gate(mut self, floor_usd: Decimal, freshness_secs: i64) -> Self {
        self.depth_gate_floor_usd = floor_usd;
        self.depth_gate_freshness_secs = freshness_secs;
        self
    }

    /// Override the staleness floor for on-chain-origin Pyth prints
    /// (`PYTH_ONCHAIN_STALENESS_SECS`). Builder, like `with_depth_gate`.
    pub fn with_pyth_onchain_staleness(mut self, secs: i64) -> Self {
        self.pyth_onchain_staleness_secs = secs.max(0);
        self
    }

    pub fn depth_gate_floor_usd(&self) -> Decimal {
        self.depth_gate_floor_usd
    }

    pub fn depth_gate_freshness_secs(&self) -> i64 {
        self.depth_gate_freshness_secs
    }

    /// Configure the intrinsic-liveness gate (ADR-0038). `enabled = false`
    /// (the default from `new`) ships it DISABLED — provably inert + byte-exact.
    /// Builder so existing `EngineState::new` call sites (all tests) are
    /// unaffected; only the production wiring in `main()` opts in.
    pub fn with_intrinsic_liveness_gate(mut self, enabled: bool, freshness_secs: i64) -> Self {
        self.intrinsic_liveness_gate_enabled = enabled;
        self.intrinsic_liveness_freshness_secs = freshness_secs;
        self
    }

    pub fn intrinsic_liveness_gate_enabled(&self) -> bool {
        self.intrinsic_liveness_gate_enabled
    }

    pub fn intrinsic_liveness_freshness_secs(&self) -> i64 {
        self.intrinsic_liveness_freshness_secs
    }

    /// Canonical re-serialised assets.toml captured at engine boot. Read-only
    /// once stored. Consumed by `push_alert` when building receipts so every
    /// alert pins the exact asset config that produced it.
    pub fn assets_toml_canonical(&self) -> &str {
        &self.assets_toml_canonical
    }

    /// Snapshot of the EWMA-smoothed discount cached for `sym`, or `None`
    /// when no prior value has been written. Used by `push_alert` to freeze
    /// the pre-mutation EWMA into the audit evidence row.
    pub async fn previous_ewma(&self, sym: &str) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.ewma_discount
    }

    /// Currently-pending candidate state for `sym` (hysteresis half-life),
    /// or `None` if no candidate is staged. Read by `push_alert` so the
    /// receipt records which transition was in flight at decision time.
    pub async fn candidate_state(&self, sym: &str) -> Option<PegState> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.candidate_state
    }

    /// Timestamp the current candidate state was first observed at, or
    /// `None` if no candidate is staged. Pairs with `candidate_state`.
    pub async fn candidate_since(&self, sym: &str) -> Option<chrono::DateTime<chrono::Utc>> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.candidate_since
    }

    /// Most recent MARKET-price observation behind this asset's current reading
    /// (USD or SOL leg, whichever is freshest). Feeds the end-to-end
    /// signal-latency metric only — pure observability, never a receipt or
    /// classification input. `None` before any market tick (cold start). The
    /// market leg is the depeg-relevant clock: "how long from seeing the price
    /// move to publishing the verdict".
    pub async fn market_observed_at(&self, sym: &str) -> Option<DateTime<Utc>> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        freshest_observation(g.last_market_at, g.last_market_sol_at)
    }

    /// Non-on-chain (legacy envelope) shorthand for
    /// [`Self::set_pyth_with_origin`] (tests).
    #[cfg(test)]
    pub async fn set_pyth(
        &self,
        feed: &str,
        price: Decimal,
        publish_time: DateTime<Utc>,
        confidence: Decimal,
    ) {
        self.set_pyth_with_origin(feed, price, publish_time, confidence, false)
            .await;
    }

    /// Same as [`Self::set_pyth`], recording whether the print came from the
    /// on-chain fallback (`origin: "onchain"` on the Redis envelope).
    pub async fn set_pyth_with_origin(
        &self,
        feed: &str,
        price: Decimal,
        publish_time: DateTime<Utc>,
        confidence: Decimal,
        onchain: bool,
    ) {
        self.pyth.write().await.insert(
            feed.to_string(),
            PythEntry {
                price,
                publish_time,
                confidence,
                onchain,
            },
        );
    }

    pub async fn pyth_price(&self, feed: &str) -> Option<Decimal> {
        self.pyth_entry(feed).await.map(|e| e.price)
    }

    /// Map a Pyth feed's confidence interval to the discrete confidence bucket
    /// the `discount_snapshots.confidence` column expects. Buckets follow
    /// Pyth's own "best practices" doc: <0.1% conf/price → high, <1% → medium,
    /// otherwise low.
    ///
    /// Returns `None` when there is NO usable signal — the feed is missing,
    /// stale (gated by `pyth_entry`), the price is zero, or the confidence
    /// interval is absent. A real Pyth feed never reports an exactly-zero
    /// 1-sigma confidence, so `conf == 0` means "defaulted/omitted", not
    /// "perfectly tight". Callers MUST treat `None` as "unknown / do not
    /// confirm" rather than silently upgrading to the best bucket — missing
    /// data is not confirming data (hardening H1/H9/H12).
    pub async fn pyth_confidence_label(&self, feed: &str) -> Option<&'static str> {
        let entry = self.pyth_entry(feed).await?; // missing or stale → None
        if entry.price.is_zero() || entry.confidence.is_zero() {
            return None; // no computable ratio / no real confidence signal
        }
        // checked_div, NOT raw `/`: a near-zero price overflows Decimal on divide,
        // which PANICS the engine inline in the per-tick hot path (audit F-12,
        // same reason derive_intrinsic below uses checked_div). An un-computable
        // ratio → None (no label), consistent with the zero-guard above.
        let ratio = entry.confidence.checked_div(entry.price)?;
        let bps_100 = Decimal::new(1, 3); // 0.001
        let bps_1000 = Decimal::new(1, 2); // 0.01
        Some(if ratio < bps_100 {
            "high"
        } else if ratio < bps_1000 {
            "medium"
        } else {
            "low"
        })
    }

    /// Fetch the full cached entry (price + confidence + publish_time),
    /// gated by the staleness threshold. Use this when the caller wants the
    /// confidence interval too (e.g. for the discount confidence label).
    ///
    /// The staleness window is resolved per-feed: an explicit override in
    /// `[pyth_staleness.overrides]` wins, otherwise the global default
    /// (configured at boot) applies. NAV / redemption-rate feeds need a
    /// much wider window than spot feeds.
    pub async fn pyth_entry(&self, feed: &str) -> Option<PythEntry> {
        let entry = {
            let cache = self.pyth.read().await;
            cache.get(feed).copied()
        }?;
        let age_secs = (Utc::now() - entry.publish_time).num_seconds();
        let mut limit = self.staleness.limit_for(feed, self.pyth_staleness_secs);
        if entry.onchain {
            limit = limit.max(self.pyth_onchain_staleness_secs);
        }
        if age_secs > limit {
            // debug, not warn: this runs on every recompute for every asset
            // that reads the feed, so a dark feed produced thousands of warn
            // lines per hour. The counter below is the signal (alerted on).
            debug!(
                feed,
                age_secs, limit, "pyth reading stale · refusing to use"
            );
            metrics::counter!("pegana_engine_pyth_stale_total", "feed" => feed.to_string())
                .increment(1);
            return None;
        }
        Some(entry)
    }

    /// Derive intrinsic from asset config when it's not directly published by a source.
    /// Returns None if config requires external data not yet cached.
    pub async fn derive_intrinsic(&self, sym: &str) -> Option<Decimal> {
        let cfg = self.configs.get(sym)?;
        match &cfg.intrinsic {
            IntrinsicStrategy::Fixed1Usd => Some(Decimal::ONE),
            IntrinsicStrategy::PythFxCross { feed, invert } => {
                let p = self.pyth_price(feed).await?;
                if *invert {
                    if p.is_zero() {
                        return None;
                    }
                    // Checked: a near-zero feed price overflows Decimal on invert,
                    // which PANICS the engine inline (audit F-12). None = skip.
                    Decimal::ONE.checked_div(p)
                } else {
                    Some(p)
                }
            }
            IntrinsicStrategy::PythRedemptionRate { feed } => {
                // Issuer-attested redemption rate is the NAV directly (e.g.
                // USDY/USD.RR carries Ondo's per-share redemption price in
                // USD). No inversion, no scaling.
                self.pyth_price(feed).await
            }
            // SanctumLst, HyloCr, and per-issuer adapters: provided by their own sources.
            _ => None,
        }
    }

    pub fn asset_config(&self, sym: &str) -> Option<&AssetConfig> {
        self.configs.get(sym)
    }

    async fn rt(&self, sym: &str) -> Arc<RwLock<AssetRuntime>> {
        {
            let map = self.runtimes.read().await;
            if let Some(rt) = map.get(sym) {
                return rt.clone();
            }
        }
        let mut map = self.runtimes.write().await;
        map.entry(sym.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(AssetRuntime::default())))
            .clone()
    }

    pub async fn set_intrinsic(&self, sym: &str, v: Decimal, observed_at: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_intrinsic = Some(v);
        g.last_intrinsic_at = Some(observed_at);
    }

    pub async fn set_market(&self, sym: &str, v: Decimal, observed_at: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_market = Some(v);
        g.last_market_at = Some(observed_at);
    }

    /// Record the top-pair USD liquidity from DexScreener/tokens.xyz. Server-only
    /// metadata — does NOT participate in the discount computation, the FSM, or
    /// the receipt hash. Read by `push_alert` into `event.extra` (ADR-0026 depth
    /// gate, "observe first") and by `liquidity_usd_fresh` for the Phase-1
    /// confidence-cap gate.
    pub async fn set_liquidity(&self, sym: &str, v: Decimal, observed_at: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_liquidity_usd = Some(v);
        g.last_liquidity_usd_at = Some(observed_at);
    }

    /// Last-seen USD liquidity for `sym`, if any DexScreener tick has arrived.
    pub async fn liquidity_usd(&self, sym: &str) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.last_liquidity_usd
    }

    /// Freshness-gated liquidity read for the Phase-1 depth gate (ADR-0026). A
    /// reading older than `within_secs` reads as ABSENT — never stale-high
    /// (would wrongly un-gate) nor stale-low (would wrongly gate). `None`
    /// also covers "never observed" and (by construction, since only
    /// `has_market=true` positive ticks ever reach `set_liquidity`) a
    /// `has_market=false` reading — absence is never a signal (ADR-0026).
    pub async fn liquidity_usd_fresh(&self, sym: &str, within_secs: i64) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let (Some(v), Some(at)) = (g.last_liquidity_usd, g.last_liquidity_usd_at) else {
            return None;
        };
        if side_is_stale(Some(within_secs), Some(at), Utc::now()) {
            return None;
        }
        Some(v)
    }

    /// Record the SOL-denominated intrinsic (Sanctum's `sol_per_lst`).
    /// LSTs use this in `snapshot_sol` to cancel the pyth(SOL/USD)
    /// multiplier when computing discount.
    pub async fn set_intrinsic_sol(&self, sym: &str, v: Decimal, observed_at: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_intrinsic_sol = Some(v);
        g.last_intrinsic_sol_at = Some(observed_at);
    }

    /// Record the SOL-denominated market price (Jupiter quote with
    /// numeraire = SOL, expressed as `lst_per_sol` or the inverse depending
    /// on quote direction — see `sources/jupiter.rs`).
    pub async fn set_market_sol(&self, sym: &str, v: Decimal, observed_at: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_market_sol = Some(v);
        g.last_market_sol_at = Some(observed_at);
    }

    pub async fn snapshot(&self, sym: &str) -> Option<(Decimal, Decimal)> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let (i, m) = match (g.last_intrinsic, g.last_market) {
            (Some(i), Some(m)) => (i, m),
            _ => return None,
        };
        // H6/H7: gate each side on freshness — a non-Pyth source that stopped
        // publishing must not have its last value re-served as if it were
        // current (which the state machine would read as a confirmed peg).
        if let Some(cfg) = self.configs.get(sym) {
            let now = Utc::now();
            let iw =
                intrinsic_window_secs(&cfg.intrinsic, &self.staleness, self.pyth_staleness_secs);
            let mw = market_window_secs(&cfg.market, &self.staleness, self.pyth_staleness_secs);
            let i_stale = side_is_stale(iw, g.last_intrinsic_at, now);
            let m_stale = side_is_stale(mw, g.last_market_at, now);
            if i_stale || m_stale {
                metrics::counter!(
                    "pegana_engine_source_stale_total",
                    "asset" => sym.to_string(),
                    "side" => match (i_stale, m_stale) {
                        (true, true) => "both",
                        (true, false) => "intrinsic",
                        _ => "market",
                    }
                    .to_string(),
                )
                .increment(1);
                return None;
            }
        }
        Some((i, m))
    }

    /// SOL-denominated snapshot used by LSTs to avoid the multiplier race.
    /// Returns `None` if either side hasn't published a SOL value yet (the
    /// caller falls back to the USD path).
    pub async fn snapshot_sol(&self, sym: &str) -> Option<(Decimal, Decimal)> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let (i, m) = match (g.last_intrinsic_sol, g.last_market_sol) {
            (Some(i), Some(m)) => (i, m),
            _ => return None,
        };
        // H6/H7: same freshness gate on the SOL-denominated sides. (The counter
        // is bumped by `snapshot`; here we just fall back to the USD path.)
        if let Some(cfg) = self.configs.get(sym) {
            let now = Utc::now();
            let iw =
                intrinsic_window_secs(&cfg.intrinsic, &self.staleness, self.pyth_staleness_secs);
            let mw = market_window_secs(&cfg.market, &self.staleness, self.pyth_staleness_secs);
            if side_is_stale(iw, g.last_intrinsic_sol_at, now)
                || side_is_stale(mw, g.last_market_sol_at, now)
            {
                return None;
            }
        }
        Some((i, m))
    }

    /// Returns `None` on EWMA overflow — unreachable in practice, since `raw`
    /// always passes `is_plausible_discount_sample` (`|raw| < 1`) before
    /// reaching here and `g.ewma_discount` is itself always a prior output of
    /// this same bounded function, but `apply_ewma_pure` is shared with
    /// `rederive` (untrusted inputs) so the caller must still handle it.
    /// On `None`, `g.ewma_discount` is left untouched (skip, don't lie).
    pub async fn apply_ewma(&self, sym: &str, raw: Decimal, alpha: Decimal) -> Option<Decimal> {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        let new = pegana_methodology::apply_ewma_pure(raw, g.ewma_discount, alpha)?;
        g.ewma_discount = Some(new);
        Some(new)
    }

    /// Apply hysteresis. `confirm_up_secs` is how long a stricter state must persist
    /// to actually transition up; `decay_down_secs` for transitions toward PEGGED.
    pub async fn transition(
        &self,
        sym: &str,
        candidate: PegState,
        now: chrono::DateTime<chrono::Utc>,
        confirm_up_secs: i64,
        decay_down_secs: i64,
    ) -> PegState {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        let decision = pegana_methodology::transition_decide(
            g.last_state,
            candidate,
            g.candidate_state,
            g.candidate_since,
            now,
            confirm_up_secs,
            decay_down_secs,
        );
        // Spec 03: stamp band_since ONLY on a committed band change (not on
        // candidate staging) so the duration reflects residence in the CURRENT
        // committed state. A flapping candidate must not reset the clock.
        let prev_committed = g.last_state;
        g.last_state = decision.new_last_state;
        g.candidate_state = decision.new_candidate_state;
        g.candidate_since = decision.new_candidate_since;
        if decision.new_last_state != prev_committed {
            g.band_since = Some(now);
        }
        g.last_state
    }

    /// Force the committed FSM state to UNKNOWN and clear any in-flight
    /// candidate. Used when a publish-time gate (the NAV-sanity premium cap in
    /// `try_recompute`) overrides the classified state with honest-dark UNKNOWN.
    /// Keeping `last_state` in sync with the published UNKNOWN keeps the FSM
    /// consistent — no desync. RECOVERY SEMANTICS (corrected per the P1 audit,
    /// 2026-07-18): because `last_state` is now UNKNOWN (severity-0), a recovering
    /// input toward PEGGED is a RELAXATION, so `transition_decide` requires the
    /// full `decay_down_secs` (120s) confirmation before UNKNOWN clears back to a
    /// healthy state — it is NOT an immediate cold-start resume. This is
    /// deliberate hysteresis (don't flap out of UNKNOWN on a single recovered
    /// tick), not a cold start (which only applies when `last_state` defaults to
    /// PEGGED with no history). `last_published_state` is then set from
    /// `final_state` by the persist path (`set_last_published_state`).
    pub async fn force_unknown(&self, sym: &str) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_state = PegState::Unknown;
        g.candidate_state = None;
        g.candidate_since = None;
        // Spec 03: UNKNOWN is a committed band change → duration resets. (Known
        // interaction: a transient NAV-sanity UNKNOWN resets a sustained DRIFT's
        // clock; honest — UNKNOWN means "we don't know" — and acceptable per the
        // overview hazard note.)
        g.band_since = None;
    }

    /// Committed FSM state for `sym` (`g.last_state`), which is the value
    /// `transition_decide` consumed as `current_last_state` on the prior tick.
    /// Distinct from `last_published_state` on cold-start: `last_state` defaults
    /// to `Pegged` (via `AssetRuntime::default()`), while `last_published_state`
    /// is `None` until the first persist. Used by `try_recompute` to capture
    /// `inputs_frozen.previous_state` (schema v2, GAP-3 fix) so the frozen value
    /// matches what `transition_decide` actually consumed — mirrors
    /// `last_published_state` but never returns `None`.
    pub async fn last_state(&self, sym: &str) -> PegState {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.last_state
    }

    /// Duration in the current committed band + whether it is a SUSTAINED
    /// alerting episode. Reads the committed `last_state` + `band_since`. Safe
    /// by construction: a PEGGED/UNKNOWN asset is never `sustained` (see
    /// `sustained_for`). Surfaced as enrichment on the alert event — NOT in the
    /// receipt.
    pub async fn band_duration(&self, sym: &str, now: DateTime<Utc>) -> (Option<i64>, bool) {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let secs = g.band_since.map(|t| (now - t).num_seconds().max(0));
        (secs, sustained_for(g.last_state, secs))
    }

    pub async fn last_published_state(&self, sym: &str) -> Option<PegState> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.last_published_state
    }

    /// Current `state_since` (None until hydrated, derived, or stamped).
    pub async fn state_since(&self, sym: &str) -> Option<DateTime<Utc>> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        g.state_since
    }

    /// One-off exact derivation of `state_since` from `discount_snapshots` for
    /// an asset whose value is None (new asset, TRUNCATEd cache, pre-backfill
    /// row): the first snapshot after the most recent row of a DIFFERENT state
    /// than the latest snapshot, else the asset's first snapshot. Call AFTER
    /// the tick's snapshot is persisted so a brand-new asset resolves to this
    /// tick. Returns without changing anything on error or no history (retried
    /// next tick); never overwrites an existing value.
    pub async fn seed_state_since_from_history(&self, pg: &sqlx::PgPool, sym: &str) {
        let derived: Result<Option<DateTime<Utc>>, sqlx::Error> = sqlx::query_scalar(
            "SELECT min(d.ts) FROM discount_snapshots d \
             WHERE d.asset = $1 AND d.ts > COALESCE( \
                 (SELECT max(x.ts) FROM discount_snapshots x \
                  WHERE x.asset = $1 AND x.state IS DISTINCT FROM \
                      (SELECT l.state FROM discount_snapshots l \
                       WHERE l.asset = $1 ORDER BY l.ts DESC LIMIT 1)), \
                 '-infinity'::timestamptz)",
        )
        .bind(sym)
        .fetch_one(pg)
        .await;
        match derived {
            Ok(Some(t)) => {
                let rt = self.rt(sym).await;
                let mut g = rt.write().await;
                if g.state_since.is_none() {
                    g.state_since = Some(t);
                }
            }
            Ok(None) => {}
            Err(e) => {
                warn!(asset = sym, error = %e, "state_since history seed failed (will retry)")
            }
        }
    }

    /// Stamp `state_since` for a state about to be published at `ts`. Call
    /// BEFORE `set_last_published_state` (it reads the prior published state).
    pub async fn stamp_state_since(&self, sym: &str, new: PegState, ts: DateTime<Utc>) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.state_since = next_state_since(g.last_published_state, new, g.state_since, ts);
    }

    pub async fn set_last_published_state(&self, sym: &str, s: PegState) {
        let rt = self.rt(sym).await;
        let mut g = rt.write().await;
        g.last_published_state = Some(s);
        g.last_recompute_at = Some(Utc::now());
    }

    /// Read-only freshness classification for observability (H12b). Buckets
    /// every ACTIVE asset by how recently it last published a state
    /// (`last_recompute_at`): `dead` = never published this run; `stale` =
    /// published but aged past `stale_after_secs`; `fresh` otherwise. Inactive
    /// assets (`assets.toml active=false`) are excluded — they are not expected
    /// to publish.
    ///
    /// NEVER mutates state. This is the observability-first half of H12b
    /// (ADR-0019): surface a totally-dead asset (no ticks at all, which the
    /// snapshot-gating cannot catch because it never recomputes) WITHOUT the
    /// false-stale risk of flipping it to UNKNOWN. The state-flip phase is
    /// deliberately deferred.
    pub async fn classify_freshness(
        &self,
        now: DateTime<Utc>,
        stale_after_secs: i64,
    ) -> FreshnessReport {
        let mut report = FreshnessReport::default();
        let syms: Vec<String> = self
            .configs
            .iter()
            .filter(|(_, c)| c.active)
            .map(|(s, _)| s.clone())
            .collect();
        for sym in syms {
            let rt = self.rt(&sym).await;
            let last = rt.read().await.last_recompute_at;
            match last {
                None => report.dead.push(sym),
                Some(at) if (now - at).num_seconds() > stale_after_secs => report.stale.push(sym),
                Some(_) => report.fresh += 1,
            }
        }
        report
    }

    pub async fn set_hyusd_cr(&self, cr: Decimal) {
        *self.hyusd_cr.write().await = Some(cr);
    }

    pub async fn hyusd_cr(&self) -> Option<Decimal> {
        *self.hyusd_cr.read().await
    }

    /// `true` if `sym` is one of the assets loaded from `assets.toml` at boot.
    /// Used by `load_from_pg` to skip DB rows for assets that were removed
    /// between deploys — those forensic rows stay in the table.
    pub fn has_asset(&self, sym: &str) -> bool {
        self.configs.contains_key(sym)
    }

    /// Total number of assets configured at boot. Used for the
    /// `restored=N total=M` log line on hydration.
    pub fn configs_count(&self) -> usize {
        self.configs.len()
    }

    /// Hydrate per-asset runtime state from `engine_state_snapshot`
    /// (ADR-0010). Restores `ewma_discount`, `candidate_state`,
    /// `candidate_since`, and `last_state` so a restart does not reset the
    /// 30-tick EWMA warmup or lose an in-flight hysteresis candidate.
    ///
    /// Missing row for an asset → that asset starts fresh (None/Pegged), same
    /// as pre-ADR-0010 behavior. Returns the count of assets actually
    /// restored (rows whose `asset` is still in the active config).
    pub async fn load_from_pg(&self, pg: &sqlx::PgPool) -> anyhow::Result<usize> {
        let rows: Vec<SnapshotRow> = sqlx::query_as(
            "SELECT asset, ewma_discount, candidate_state, candidate_since, last_state, band_since, state_since \
             FROM engine_state_snapshot",
        )
        .fetch_all(pg)
        .await
        .context("load engine_state_snapshot")?;

        let mut restored = 0usize;
        for (asset, ewma, candidate, candidate_since, last, band_since, state_since) in rows {
            // Skip if the asset is no longer in our active config (e.g.
            // removed between deploys). The DB row stays as forensic record.
            if !self.has_asset(&asset) {
                continue;
            }
            let rt = self.rt(&asset).await;
            let mut g = rt.write().await;
            g.ewma_discount = ewma;
            g.candidate_state = candidate.as_deref().and_then(parse_peg_state);
            g.candidate_since = candidate_since;
            g.band_since = band_since;
            g.state_since = state_since;
            let last_st = parse_peg_state(&last).unwrap_or(PegState::Pegged);
            g.last_state = last_st;
            // Re-seed last_published_state from the snapshot's last_state.
            // Otherwise every engine restart looks like a "cold start" — the
            // next recompute sees last_published_state=None, defaults
            // from_state=Unknown, and emits "Unknown → <current>" for every
            // asset whose snapshot we just successfully restored. The
            // approximation is bounded: snapshot_to_pg runs every cycle, so
            // the worst case (crash between alert dispatch and snapshot
            // write) produces one duplicate alert per asset on restart,
            // which is fine vs. the current behavior of producing one
            // Unknown alert per asset on EVERY restart.
            g.last_published_state = Some(last_st);
            restored += 1;
        }

        // Measure the duplicate-on-restart window the comment above describes.
        //
        // If an asset's newest `alerts` row already advanced to a state that the
        // restored snapshot does NOT reflect, then the crash landed between
        // push_alert and snapshot_to_pg — and this boot is about to re-emit that
        // transition. Today that surfaces as a duplicate notification, which is
        // bounded and observable but has never been QUANTIFIED, so nobody knows
        // whether it happens on every restart or has never happened at all.
        //
        // Deliberately measure before changing emission semantics. The obvious
        // "fix" (deterministic alert IDs) would convert this duplicate into a
        // SILENT MISS at three layers — the alerts PK, alert_evidence, and the
        // bot's `alert:<uuid>:<chat>` idempotency claim — and for BLACK_SWAN
        // that per-uuid claim is the only duplicate guard there is, since the
        // dispatcher bypasses dedup for it entirely. Changing a safety property
        // on an unmeasured failure rate is how a duplicate becomes a loss.
        //
        // One read-only query at boot, never on the hot path.
        match sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM engine_state_snapshot s \
             WHERE EXISTS ( \
                 SELECT 1 FROM alerts a \
                 WHERE a.asset = s.asset \
                   AND a.detected_at = ( \
                       SELECT max(a2.detected_at) FROM alerts a2 WHERE a2.asset = s.asset \
                   ) \
                   AND a.to_state::text IS DISTINCT FROM s.last_state \
             )",
        )
        .fetch_one(pg)
        .await
        {
            Ok(pending) => {
                metrics::gauge!("pegana_engine_restart_replay_assets").set(pending as f64);
                if pending > 0 {
                    tracing::warn!(
                        assets = pending,
                        "restored snapshots lag their newest alert — these assets will \
                         re-emit their last transition on this boot (duplicate-on-restart)"
                    );
                }
            }
            Err(e) => {
                // Observability only — never block startup on it.
                tracing::warn!(error = %e, "restart-replay probe failed (non-fatal)");
            }
        }

        Ok(restored)
    }

    /// Upsert one asset's current cache state into `engine_state_snapshot`.
    /// Called in-band by `try_recompute` after every successful cycle so the
    /// DB row is at most one cycle stale on hard crash. The DB labels match
    /// `crate::peg_state_label` (PEGGED / DRIFT / DEPEG / CRITICAL /
    /// BLACK_SWAN / UNKNOWN) so `load_from_pg` can round-trip them.
    pub async fn snapshot_to_pg(&self, pg: &sqlx::PgPool, sym: &str) -> anyhow::Result<()> {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let last_state_str = crate::peg_state_label(g.last_state);
        let candidate_str = g.candidate_state.map(crate::peg_state_label);
        sqlx::query(
            "INSERT INTO engine_state_snapshot \
                 (asset, ewma_discount, candidate_state, candidate_since, last_state, band_since, state_since, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) \
             ON CONFLICT (asset) DO UPDATE SET \
                 ewma_discount   = EXCLUDED.ewma_discount, \
                 candidate_state = EXCLUDED.candidate_state, \
                 candidate_since = EXCLUDED.candidate_since, \
                 last_state      = EXCLUDED.last_state, \
                 band_since      = EXCLUDED.band_since, \
                 state_since     = EXCLUDED.state_since, \
                 updated_at      = EXCLUDED.updated_at",
        )
        .bind(sym)
        .bind(g.ewma_discount)
        .bind(candidate_str)
        .bind(g.candidate_since)
        .bind(last_state_str)
        .bind(g.band_since)
        .bind(g.state_since)
        .execute(pg)
        .await
        .with_context(|| format!("upsert engine_state_snapshot for {sym}"))?;
        Ok(())
    }

    /// Best-effort iterate-all snapshot used by the SIGTERM/SIGINT flush.
    /// Per-asset errors are logged but never propagate — losing one asset's
    /// row on shutdown is preferable to skipping the remaining flushes.
    /// Returns the count of assets successfully flushed.
    ///
    /// Failures bump `pegana_state_snapshot_failed_total{phase=shutdown_flush}`
    /// and a Sentry Warning. Shutdown is the worst time to silently lose
    /// state — the next startup hydrates from this table (ADR-0010), so a
    /// dropped row means that asset's EWMA + hysteresis reset from None.
    pub async fn snapshot_all_to_pg(&self, pg: &sqlx::PgPool) -> usize {
        let mut count = 0;
        for asset in self.configs.keys() {
            match self.snapshot_to_pg(pg, asset).await {
                Ok(_) => count += 1,
                Err(e) => {
                    tracing::error!(asset, ?e, "engine_state_snapshot flush failed for asset");
                    metrics::counter!(
                        "pegana_state_snapshot_failed_total",
                        "asset" => asset.to_string(),
                        "phase" => "shutdown_flush"
                    )
                    .increment(1);
                    sentry::capture_message(
                        &format!(
                            "pegana engine_state_snapshot shutdown flush failed: asset={asset} err={e:?}"
                        ),
                        sentry::Level::Warning,
                    );
                }
            }
        }
        count
    }
}

#[cfg(test)]
mod integration_tests {
    //! Engine integration tests covering the recompute pipeline end-to-end at
    //! the `EngineState` level — no Redis, no Postgres. Validates the parts of
    //! the loop we can deterministically exercise: intrinsic + market caching,
    //! EWMA smoothing, hysteresis state machine, and Pyth confidence labels.

    use super::*;
    use pegana_common::AssetsFile;

    fn fixture_assets() -> AssetsFile {
        let raw = include_str!("../../../assets.toml");
        toml::from_str(raw).expect("workspace assets.toml parses")
    }

    fn fresh_engine() -> EngineState {
        let raw = include_str!("../../../assets.toml");
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        EngineState::new(&fixture_assets(), canonical, 30)
    }

    fn ts(m: i64) -> DateTime<Utc> {
        use chrono::TimeZone;
        Utc.timestamp_opt(1_800_000_000 + m * 60, 0).unwrap()
    }

    #[tokio::test]
    async fn stamp_state_since_uses_prior_published_state() {
        let e = fresh_engine();
        // No prior state, no stored value: never fabricated.
        e.stamp_state_since("USDC", PegState::Pegged, ts(0)).await;
        assert_eq!(e.state_since("USDC").await, None);
        e.set_last_published_state("USDC", PegState::Pegged).await;
        e.stamp_state_since("USDC", PegState::Pegged, ts(1)).await;
        assert_eq!(e.state_since("USDC").await, None);
        e.set_last_published_state("USDC", PegState::Pegged).await;
        e.stamp_state_since("USDC", PegState::Drift, ts(2)).await;
        let rt = e.rt("USDC").await;
        assert_eq!(rt.read().await.state_since, Some(ts(2)));
    }

    async fn test_engine_with_asset(sym: &str) -> EngineState {
        let mut assets = fixture_assets();
        let mut asset = assets.assets.remove(0);
        asset.symbol = sym.to_string();
        assets.assets = vec![asset];
        let canonical = toml::to_string(&assets).unwrap();
        EngineState::new(&assets, canonical, 30)
    }

    #[tokio::test]
    async fn snapshot_none_until_both_inputs_arrive() {
        let e = fresh_engine();
        let observed_at = chrono::Utc::now();
        assert!(e.snapshot("USDC").await.is_none(), "no inputs yet");
        e.set_intrinsic("USDC", Decimal::ONE, observed_at).await;
        assert!(
            e.snapshot("USDC").await.is_none(),
            "intrinsic alone is insufficient"
        );
        e.set_market("USDC", Decimal::new(9999, 4), observed_at)
            .await; // 0.9999
        let (i, m) = e.snapshot("USDC").await.expect("both inputs cached");
        assert_eq!(i, Decimal::ONE);
        assert_eq!(m, Decimal::new(9999, 4));
    }

    #[tokio::test]
    async fn liquidity_is_server_only_metadata() {
        let e = fresh_engine();
        // None until a DexScreener tick arrives.
        assert!(e.liquidity_usd("sUSD").await.is_none());
        e.set_liquidity("sUSD", Decimal::new(51000, 0), Utc::now())
            .await;
        // Round-trips.
        assert_eq!(e.liquidity_usd("sUSD").await, Some(Decimal::new(51000, 0)));
        // CRITICAL invariant: liquidity is metadata only — setting it must NOT
        // fabricate a snapshot (no intrinsic/market), so it can never leak into
        // the discount, the FSM, or the receipt hash.
        assert!(
            e.snapshot("sUSD").await.is_none(),
            "liquidity must not participate in the discount snapshot"
        );
    }

    #[tokio::test]
    async fn liquidity_usd_fresh_round_trips_after_set() {
        let e = fresh_engine();
        assert!(e.liquidity_usd_fresh("sUSD", 600).await.is_none());
        e.set_liquidity("sUSD", Decimal::new(51000, 0), Utc::now())
            .await;
        assert_eq!(
            e.liquidity_usd_fresh("sUSD", 600).await,
            Some(Decimal::new(51000, 0))
        );
    }

    #[tokio::test]
    async fn liquidity_usd_fresh_none_for_unknown_asset() {
        let e = fresh_engine();
        assert!(e.liquidity_usd_fresh("NOPE", 600).await.is_none());
        // A larger window doesn't manufacture a reading out of thin air.
        assert!(e.liquidity_usd_fresh("NOPE", 60 * 60 * 24).await.is_none());
    }

    #[tokio::test]
    async fn liquidity_usd_fresh_none_when_stale() {
        let e = fresh_engine();
        let stale_at = Utc::now() - chrono::Duration::seconds(900);
        e.set_liquidity("sUSD", Decimal::new(1000, 0), stale_at)
            .await;
        // 900s old, 600s window -> stale, reads as absent.
        assert!(e.liquidity_usd_fresh("sUSD", 600).await.is_none());
        // But still fresh under a wider window.
        assert_eq!(
            e.liquidity_usd_fresh("sUSD", 3600).await,
            Some(Decimal::new(1000, 0))
        );
    }

    #[tokio::test]
    async fn ewma_smooths_across_ticks() {
        let e = fresh_engine();
        let alpha: Decimal = "0.3".parse().unwrap();
        // First tick seeds the EWMA at the raw value.
        let v1 = e
            .apply_ewma("USDC", Decimal::new(100, 4), alpha)
            .await
            .expect("bounded inputs never overflow");
        assert_eq!(v1, Decimal::new(100, 4));
        // Second tick blends: 0.3 * new + 0.7 * old.
        let v2 = e
            .apply_ewma("USDC", Decimal::new(0, 0), alpha)
            .await
            .expect("bounded inputs never overflow");
        // 0.3 * 0 + 0.7 * 0.01 = 0.007
        assert_eq!(v2, Decimal::new(70, 4));
    }

    #[tokio::test]
    async fn transition_is_two_phase_with_hysteresis() {
        let e = fresh_engine();
        let now = chrono::Utc::now();
        // First sighting of DRIFT must NOT immediately flip — it becomes a
        // candidate that needs to persist for confirm_up_secs first.
        let s1 = e.transition("USDC", PegState::Drift, now, 30, 120).await;
        assert_eq!(s1, PegState::default(), "first observation stays as before");
        // Same candidate, but with a 0-second confirm window, becomes active.
        let s2 = e.transition("USDC", PegState::Drift, now, 0, 120).await;
        assert_eq!(s2, PegState::Drift);
    }

    #[tokio::test]
    async fn transition_takes_explicit_now_argument() {
        let e = fresh_engine();
        let now1 = chrono::Utc::now();
        let r1 = e.transition("USDC", PegState::Drift, now1, 30, 120).await;
        assert_eq!(r1, PegState::default(), "first sighting stays as default");

        // Second call at same `now` should behave deterministically
        let r2 = e.transition("USDC", PegState::Drift, now1, 0, 120).await;
        assert_eq!(
            r2,
            PegState::Drift,
            "with 0s confirm window, second sighting matures"
        );
    }

    #[tokio::test]
    async fn band_since_stamps_on_commit_and_resets_on_unknown() {
        use pegana_common::PegState::*;
        // Build a single-asset EngineState via the same helper the existing
        // integration_tests use (see state.rs `integration_tests` mod for the
        // exact constructor). Call it `eng` with one asset "X".
        let eng = test_engine_with_asset("X").await;
        let t0 = "2026-06-24T00:00:00Z".parse::<DateTime<Utc>>().unwrap();

        // Commit Pegged -> Drift (the first observation stages the candidate;
        // confirm_up_secs = 0 lets the second observation commit immediately).
        eng.transition("X", Drift, t0, 0, 0).await;
        eng.transition("X", Drift, t0, 0, 0).await;
        let later = t0 + chrono::Duration::hours(7);
        let (secs, sustained) = eng.band_duration("X", later).await;
        assert_eq!(secs, Some(7 * 3600));
        assert!(sustained, "7h in DRIFT >= 6h => sustained");

        // force_unknown resets the clock.
        eng.force_unknown("X").await;
        let (secs2, sustained2) = eng.band_duration("X", later).await;
        assert_eq!(secs2, None);
        assert!(!sustained2);
    }

    #[tokio::test]
    async fn pyth_confidence_label_buckets_high_medium_low() {
        let e = fresh_engine();
        let now = chrono::Utc::now();
        // High: conf/price = 0.05% < 0.1%
        e.set_pyth("HIGH/USD", Decimal::new(100, 0), now, Decimal::new(5, 2))
            .await;
        assert_eq!(e.pyth_confidence_label("HIGH/USD").await, Some("high"));
        // Medium: conf/price = 0.5% (>= 0.1%, < 1%)
        e.set_pyth("MED/USD", Decimal::new(100, 0), now, Decimal::new(50, 2))
            .await;
        assert_eq!(e.pyth_confidence_label("MED/USD").await, Some("medium"));
        // Low: conf/price = 5%
        e.set_pyth("LOW/USD", Decimal::new(100, 0), now, Decimal::new(5, 0))
            .await;
        assert_eq!(e.pyth_confidence_label("LOW/USD").await, Some("low"));
        // Missing feed → None (no signal; must NOT confirm as "high"). H1/H12.
        assert_eq!(e.pyth_confidence_label("GHOST/USD").await, None);
        // Zero price → None (no computable ratio). H1.
        e.set_pyth("ZEROP/USD", Decimal::ZERO, now, Decimal::new(5, 2))
            .await;
        assert_eq!(e.pyth_confidence_label("ZEROP/USD").await, None);
        // Zero/absent confidence → None (must NOT confirm as "high"). H9.
        e.set_pyth("ZEROC/USD", Decimal::new(100, 0), now, Decimal::ZERO)
            .await;
        assert_eq!(e.pyth_confidence_label("ZEROC/USD").await, None);
    }

    /// A 45s-old print is stale on the 30s base window but fine when it came
    /// from an on-chain push account (60s push heartbeat + poll). Past the
    /// on-chain window it is refused like any other stale print. Regression
    /// for the confidence label flapping high/unknown on poll jitter.
    #[tokio::test]
    async fn onchain_prints_get_the_wider_staleness_window() {
        let e = fresh_engine();
        let now = chrono::Utc::now();
        let p = Decimal::new(150, 0);
        let c = Decimal::new(5, 2);
        let t45 = now - chrono::Duration::seconds(45);
        e.set_pyth_with_origin("SOL/USD", p, t45, c, false).await;
        assert!(
            e.pyth_entry("SOL/USD").await.is_none(),
            "base-window print 45s old is stale"
        );
        e.set_pyth_with_origin("SOL/USD", p, t45, c, true).await;
        assert_eq!(e.pyth_confidence_label("SOL/USD").await, Some("high"));
        let t200 = now - chrono::Duration::seconds(200);
        e.set_pyth_with_origin("SOL/USD", p, t200, c, true).await;
        assert!(
            e.pyth_entry("SOL/USD").await.is_none(),
            "on-chain print past 120s is stale"
        );
        // The builder can tighten it.
        let tight = fresh_engine().with_pyth_onchain_staleness(40);
        tight.set_pyth_with_origin("SOL/USD", p, t45, c, true).await;
        assert!(tight.pyth_entry("SOL/USD").await.is_none());
    }

    /// Slow-heartbeat push feeds (measured on mainnet 2026-10-22, see the
    /// `[pyth_staleness.overrides]` comment in assets.toml) get a per-feed
    /// window that covers one heartbeat with margin, so a print one heartbeat
    /// old still carries a real confidence label instead of "unknown". A print
    /// past the window is still refused, and the global defaults are untouched:
    /// a 55s-heartbeat feed with no override stays on the 120s on-chain window.
    #[tokio::test]
    async fn slow_heartbeat_feeds_get_per_feed_windows_without_loosening_defaults() {
        let e = fresh_engine();
        let now = chrono::Utc::now();
        let p = Decimal::ONE;
        let c = Decimal::new(1, 5); // conf/price 0.001% -> "high"
                                    // (feed, measured heartbeat secs)
        let cases = [
            ("PYUSD/USD", 1200),
            ("SUSDE/USD", 300),
            ("USX/USD", 300),
            ("USDS/USD", 300),
            ("USDG/USD", 240),
        ];
        for (feed, heartbeat) in cases {
            let window = e.staleness.limit_for(feed, e.pyth_staleness_secs);
            // Margin: at least 1.25x heartbeat plus the 12s poll, at most 2x,
            // so the override tracks the real cadence rather than "forever".
            assert!(
                window >= heartbeat * 5 / 4 + 12 && window <= heartbeat * 2,
                "{feed}: window {window}s does not match a {heartbeat}s heartbeat"
            );
            // Observed worst case: a print one full heartbeat (+ poll) old.
            let at_heartbeat = now - chrono::Duration::seconds(heartbeat + 12);
            e.set_pyth_with_origin(feed, p, at_heartbeat, c, true).await;
            assert_eq!(
                e.pyth_confidence_label(feed).await,
                Some("high"),
                "{feed}: a print one heartbeat old must keep its confidence label"
            );
            let past = now - chrono::Duration::seconds(window + 5);
            e.set_pyth_with_origin(feed, p, past, c, true).await;
            assert!(
                e.pyth_entry(feed).await.is_none(),
                "{feed}: a print past its {window}s window must read stale"
            );
        }

        // Global defaults unchanged.
        assert_eq!(e.staleness.default_secs, Some(30));
        assert_eq!(DEFAULT_PYTH_ONCHAIN_STALENESS_SECS, 120);
        for feed in ["USDC/USD", "SOL/USD", "JLP/USD", "USDE/USD"] {
            assert!(
                !e.staleness.overrides.contains_key(feed),
                "{feed} runs on the documented 55s heartbeat and must not be widened"
            );
            let t200 = now - chrono::Duration::seconds(200);
            e.set_pyth_with_origin(feed, p, t200, c, true).await;
            assert!(
                e.pyth_entry(feed).await.is_none(),
                "{feed}: a 200s-old on-chain print must still read stale"
            );
        }
    }

    /// P2-3: the Perena envelope carries the NAV's own update time, so its
    /// window must cover the measured ~14 min crank (+ poll) but still read a
    /// missed crank as stale.
    #[test]
    fn perena_nav_window_covers_the_crank_cadence() {
        let st = PythStalenessConfig::default();
        let w = intrinsic_window_secs(
            &IntrinsicStrategy::PerenaVaultNav {
                vault: "v".into(),
                program: "p".into(),
            },
            &st,
            30,
        );
        assert_eq!(w, Some(PERENA_NAV_WINDOW_SECS));
        let now = chrono::Utc::now();
        // 857s max crank gap + 60s poll: still fresh.
        assert!(!side_is_stale(
            w,
            Some(now - chrono::Duration::seconds(917)),
            now
        ));
        // A missed crank (two gaps) reads stale.
        assert!(side_is_stale(
            w,
            Some(now - chrono::Duration::seconds(1700)),
            now
        ));
        // Every other non-Pyth source keeps the generic 600s window.
        assert_eq!(
            intrinsic_window_secs(
                &IntrinsicStrategy::SolayerSusdRate {
                    share_account: "s".into(),
                    program: "p".into(),
                },
                &st,
                30
            ),
            Some(SOURCE_STALENESS_SECS)
        );
    }

    #[test]
    fn side_is_stale_only_fires_with_window_and_age() {
        let now = chrono::Utc::now();
        let fresh = now - chrono::Duration::seconds(10);
        let old = now - chrono::Duration::seconds(700);
        // No window (Pyth/Fixed) → never stale, even with an old timestamp.
        assert!(!side_is_stale(None, Some(old), now));
        // No recorded timestamp → treated as fresh (pre-gate data).
        assert!(!side_is_stale(Some(600), None, now));
        // Within window → fresh.
        assert!(!side_is_stale(Some(600), Some(fresh), now));
        // Past window → stale.
        assert!(side_is_stale(Some(600), Some(old), now));
    }

    #[tokio::test]
    async fn intrinsic_and_market_freshness_use_observation_timestamp() {
        let e = fresh_engine();
        let sym = "USDC";
        let now = chrono::Utc::now();
        let observed_at = now - chrono::Duration::minutes(20);
        let stale_window = Some(600);

        e.set_intrinsic(sym, Decimal::ONE, observed_at).await;
        e.set_market(sym, Decimal::new(9999, 4), observed_at).await;

        let rt = e.rt(sym).await;
        let g = rt.read().await;

        assert!(
            side_is_stale(stale_window, g.last_intrinsic_at, now),
            "intrinsic side should be stale from observation ts {observed_at}, not receive time"
        );
        assert!(
            side_is_stale(stale_window, g.last_market_at, now),
            "market side should be stale from observation ts {observed_at}, not receive time"
        );
    }

    #[test]
    fn window_resolvers_classify_sources() {
        let st = PythStalenessConfig::default();
        let pd = 30; // pyth default window (seconds)
                     // Fixed intrinsic = constant, never gated.
        assert_eq!(
            intrinsic_window_secs(&IntrinsicStrategy::Fixed1Usd, &st, pd),
            None
        );
        // Pyth-fed sides ARE gated, but floored at SOURCE_STALENESS_SECS because
        // the engine receives them at the ~30s forwarding throttle, not 1Hz (F2).
        assert_eq!(
            intrinsic_window_secs(
                &IntrinsicStrategy::PythRedemptionRate {
                    feed: "X/USD.RR".into()
                },
                &st,
                pd
            ),
            Some(SOURCE_STALENESS_SECS)
        );
        assert_eq!(
            market_window_secs(
                &MarketStrategy::PythSpot {
                    feed: "USDC/USD".into()
                },
                &st,
                pd
            ),
            Some(SOURCE_STALENESS_SECS)
        );
        // A wide per-feed override (e.g. daily NAV) still wins over the floor.
        let mut wide = PythStalenessConfig::default();
        wide.overrides.insert("ONYC/USD.NAV".into(), 129_600); // 36h
        assert_eq!(
            intrinsic_window_secs(
                &IntrinsicStrategy::PythRedemptionRate {
                    feed: "ONYC/USD.NAV".into()
                },
                &wide,
                pd
            ),
            Some(129_600)
        );
        // Non-Pyth single sources → generous 600s window. H6/H7.
        assert_eq!(
            intrinsic_window_secs(
                &IntrinsicStrategy::SanctumLst {
                    symbol: "jitoSOL".into()
                },
                &st,
                pd
            ),
            Some(SOURCE_STALENESS_SECS)
        );
        assert_eq!(
            market_window_secs(&MarketStrategy::DexScreenerUsd, &st, pd),
            Some(SOURCE_STALENESS_SECS)
        );
        assert_eq!(
            market_window_secs(
                &MarketStrategy::JupiterUsd {
                    numeraire: "SOL".into(),
                    numeraire_feed: "SOL/USD".into()
                },
                &st,
                pd
            ),
            Some(SOURCE_STALENESS_SECS)
        );
    }

    #[tokio::test]
    async fn stale_pyth_reading_is_refused() {
        let e = fresh_engine();
        let stale = chrono::Utc::now() - chrono::Duration::seconds(120);
        e.set_pyth("STALE/USD", Decimal::ONE, stale, Decimal::ZERO)
            .await;
        assert!(
            e.pyth_price("STALE/USD").await.is_none(),
            "reading older than threshold must be refused"
        );
        // The cache entry still exists internally but the gate filters it.
        assert!(e.pyth_entry("STALE/USD").await.is_none());
    }

    /// Reproduce the 2026-05-25 23:09 burst: a single SOL/USD spot move
    /// (~0.7%) between Sanctum and Jupiter polls caused all 6 LSTs to
    /// "drift" by the same delta in USD terms — but in SOL terms the LSTs
    /// hadn't moved at all (sol_per_lst was unchanged). The SOL-path
    /// discount must read zero even when the USD inputs are skewed.
    #[tokio::test]
    async fn lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift() {
        let e = fresh_engine();
        let sol_per_lst: Decimal = "1.117".parse().unwrap();
        let observed_at = chrono::Utc::now();
        e.set_intrinsic_sol("jitoSOL", sol_per_lst, observed_at)
            .await;
        e.set_market_sol("jitoSOL", sol_per_lst, observed_at).await; // identical SOL ratio
                                                                     // Simulate the multiplier race: Sanctum captured SOL @ $100,
                                                                     // Jupiter captured the next tick @ $100.78. Same LST, no real drift.
        let sol_usd_old: Decimal = "100".parse().unwrap();
        let sol_usd_new: Decimal = "100.78".parse().unwrap();
        e.set_intrinsic("jitoSOL", sol_per_lst * sol_usd_old, observed_at)
            .await;
        e.set_market("jitoSOL", sol_per_lst * sol_usd_new, observed_at)
            .await;

        // USD path would scream "DRIFT": 1 - (1.117 * 100.78) / (1.117 * 100)
        //                             = 1 - 100.78/100 = -0.0078 (synthetic).
        let (i_usd, m_usd) = e.snapshot("jitoSOL").await.unwrap();
        let usd_discount = Decimal::ONE - (m_usd / i_usd);
        assert!(
            usd_discount.abs() > Decimal::new(50, 4), // > 50 bps
            "USD path inherits the multiplier desync (this is the bug)"
        );

        // SOL path correctly reads zero (no real movement in sol_per_lst).
        let (i_sol, m_sol) = e.snapshot_sol("jitoSOL").await.unwrap();
        let sol_discount = Decimal::ONE - (m_sol / i_sol);
        assert_eq!(
            sol_discount,
            Decimal::ZERO,
            "SOL path cancels the pyth(SOL/USD) multiplier and reads no drift"
        );
    }

    /// NAV / redemption-rate feeds only step daily; the per-feed override in
    /// `[pyth_staleness.overrides]` widens THAT feed's window so a stale-by-hours
    /// reading is still fresh enough to use. The override targets the INTRINSIC
    /// `.RR` redemption-rate feed (T3 audit fix) — NOT the continuously-updating
    /// spot feed, which must keep the tight 30s default.
    #[tokio::test]
    async fn per_feed_staleness_override_widens_window() {
        let e = fresh_engine();
        let four_hours_ago = chrono::Utc::now() - chrono::Duration::hours(4);

        // (USDY moved off Pyth to an Ethereum view call in 2026-10, so the
        // still-Pyth syrupUSDC pair carries this check.)
        // The daily-stepping INTRINSIC feed HAS the 36h override → a 4h-old
        // reading (well past the 30s default) is still fresh enough to use.
        e.set_pyth(
            "SYRUPUSDC/USDC.RR",
            Decimal::ONE,
            four_hours_ago,
            Decimal::ZERO,
        )
        .await;
        assert!(
            e.pyth_price("SYRUPUSDC/USDC.RR").await.is_some(),
            "SYRUPUSDC/USDC.RR (intrinsic NAV) must survive its per-feed override window"
        );

        // The continuously-updating SPOT feed is NOT overridden — the pre-fix bug
        // keyed the override here, leaving the intrinsic stuck at the default and
        // USDY frozen ~23h/day. A 4h-old spot reading must now hit the 30s default.
        e.set_pyth("SYRUPUSDC/USD", Decimal::ONE, four_hours_ago, Decimal::ZERO)
            .await;
        assert!(
            e.pyth_price("SYRUPUSDC/USD").await.is_none(),
            "SYRUPUSDC/USD (spot) must hit the 30s default; the override targets the .RR feed"
        );

        // A feed with no override at all also hits the 30s default.
        e.set_pyth("RANDOM/USD", Decimal::ONE, four_hours_ago, Decimal::ZERO)
            .await;
        assert!(
            e.pyth_price("RANDOM/USD").await.is_none(),
            "feed without override must still hit the global default"
        );
    }

    #[tokio::test]
    async fn classify_freshness_buckets_dead_fresh_stale() {
        let e = fresh_engine();
        let now = chrono::Utc::now();
        // USDC (active) just published → fresh; never-published actives → dead.
        e.set_last_published_state("USDC", PegState::Pegged).await;
        let r = e.classify_freshness(now, 900).await;
        assert!(r.fresh >= 1, "USDC just published → fresh");
        assert!(
            r.dead.iter().any(|s| s == "jitoSOL"),
            "jitoSOL never published → dead"
        );
        assert!(
            !r.dead.iter().any(|s| s == "USDC"),
            "USDC published → not dead"
        );
        // Evaluated far in the future, USDC's stamp ages past the window → stale.
        let future = now + chrono::Duration::seconds(1000);
        let r2 = e.classify_freshness(future, 900).await;
        assert!(
            r2.stale.iter().any(|s| s == "USDC"),
            "USDC last published 1000s before `now` → stale (> 900)"
        );
    }

    #[tokio::test]
    async fn classify_freshness_is_pure_no_mutation() {
        let e = fresh_engine();
        e.set_last_published_state("USDC", PegState::Drift).await;
        let before = {
            let rt = e.rt("USDC").await;
            let g = rt.read().await;
            (
                g.last_state,
                g.last_published_state,
                g.ewma_discount,
                g.last_recompute_at,
            )
        };
        let _ = e.classify_freshness(chrono::Utc::now(), 900).await;
        let after = {
            let rt = e.rt("USDC").await;
            let g = rt.read().await;
            (
                g.last_state,
                g.last_published_state,
                g.ewma_discount,
                g.last_recompute_at,
            )
        };
        assert_eq!(
            before, after,
            "classify_freshness must not mutate runtime state"
        );
    }
}

/// Engine-side round-trip test for F-13b: proves the engine's frozen receipt
/// inputs re-derive to the frozen computed values.
///
/// Each test replicates the EXACT capture→mutate→freeze ordering that
/// `try_recompute` uses (GAP-1/2/3 fix, schema v2). The capture order is
/// the thing under test — a regression that moves a capture to AFTER its
/// mutation would make `rederive` produce a different `(discount_raw,
/// discount_smooth, final_state)` than the engine computed, and the assertion
/// below would fail.
///
/// Scenarios:
///   A. Cold-start escalation  — GAP-1 (ewma_prev=None cold-start path).
///   B. Matured transition     — GAP-2/3 (candidate_since, last_state pre-mutation).
///   C. hyUSD CR path          — CR branch of classify, not bps.
///   D. Premium-sanity override — NAV-sanity override forces Unknown.
#[cfg(test)]
mod receipt_rederive_roundtrip {
    use super::*;
    use pegana_common::AssetClass;
    use pegana_common::AssetsFile;
    use pegana_methodology::{
        classify_cr_with_hysteresis, classify_with_hysteresis, compute_discount,
        is_plausible_discount_sample, premium_sanity_violated, rederive, InputsFrozen,
        CR_DEADBAND_PCT, DEADBAND_PCT,
    };
    use rust_decimal::Decimal;
    use std::collections::HashMap;

    // ── Engine construction (no pg/redis) ────────────────────────────────────

    fn fixture_assets() -> AssetsFile {
        let raw = include_str!("../../../assets.toml");
        toml::from_str(raw).expect("workspace assets.toml parses")
    }

    fn fresh_engine() -> EngineState {
        let raw = include_str!("../../../assets.toml");
        let canonical = toml::to_string(&toml::from_str::<toml::Value>(raw).unwrap()).unwrap();
        EngineState::new(&fixture_assets(), canonical, 30)
    }

    // ── Threshold helpers (mirror rederive.rs tests) ─────────────────────────

    fn bps_thresholds() -> HashMap<String, u32> {
        let mut m = HashMap::new();
        m.insert("drift".into(), 20);
        m.insert("depeg".into(), 100);
        m.insert("critical".into(), 300);
        m
    }

    fn cr_thresholds() -> HashMap<String, u32> {
        let mut m = HashMap::new();
        m.insert("drift".into(), 150);
        m.insert("depeg".into(), 130);
        m.insert("critical".into(), 110);
        m.insert("black_swan".into(), 100);
        m
    }

    // Engine constants — mirrors main.rs top-level constants.
    const ALPHA_STR: &str = "0.3";
    const CONFIRM_UP_SECS: i64 = 30;
    const DECAY_DOWN_SECS: i64 = 120;

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario A: Cold-start escalation (USD stable, USDC)
    //
    // Fresh runtime: no prior ewma, no candidate, last_state=Pegged.
    // Market at 30bps discount → classifies DRIFT → transition stages candidate
    // but keeps Pegged (timer just started). GAP-1: ewma_prev=None.
    // ─────────────────────────────────────────────────────────────────────────
    #[tokio::test]
    async fn scenario_a_cold_start_escalation() {
        let e = fresh_engine();
        let sym = "USDC";
        let alpha: Decimal = ALPHA_STR.parse().unwrap();
        let class = AssetClass::StableFiat;

        // Intrinsic=1.00, market=0.997 → raw discount = 0.003 (30bps > drift=20).
        let intrinsic: Decimal = "1.00".parse().unwrap();
        let market: Decimal = "0.997".parse().unwrap();

        let observed_at = chrono::Utc::now();
        e.set_intrinsic(sym, intrinsic, observed_at).await;
        e.set_market(sym, market, observed_at).await;

        let now = chrono::Utc::now();

        // Step 1: compute_discount (USD path, no SOL).
        let discount_raw =
            compute_discount(intrinsic, market, None, None, class).expect("should compute");
        assert!(is_plausible_discount_sample(discount_raw));

        // Step 2 (GAP-1): capture ewma_prev BEFORE apply_ewma.
        let ewma_prev = e.previous_ewma(sym).await; // None on cold-start
        assert_eq!(ewma_prev, None, "cold-start: no prior EWMA");

        // Step 3: apply_ewma mutates the runtime.
        let discount_smooth = e
            .apply_ewma(sym, discount_raw, alpha)
            .await
            .expect("bounded inputs never overflow");

        // Step 4: classify (bps path). Use last_published_state for current (same
        // as engine) — None on cold-start → unwrap_or(Pegged).
        let current_for_classify = e
            .last_published_state(sym)
            .await
            .unwrap_or(PegState::Pegged);
        let thresholds = bps_thresholds();
        let new_state = classify_with_hysteresis(
            class,
            discount_smooth,
            &thresholds,
            current_for_classify,
            DEADBAND_PCT,
        );

        // Step 5 (GAP-2/3): capture pre-transition FSM state BEFORE transition.
        let candidate_state_frozen = e.candidate_state(sym).await; // None (cold-start)
        let candidate_since_frozen = e.candidate_since(sym).await; // None
        let fsm_prev_state_frozen = e.last_state(sym).await; // Pegged (default)

        // Step 5b: run transition (mutates runtime).
        let mut final_state = e
            .transition(sym, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
            .await;

        // Step 6: premium-sanity override (StableFiat is not direction-sensitive,
        // so this is a no-op here — but included for completeness).
        if premium_sanity_violated(class, discount_smooth) {
            final_state = PegState::Unknown;
        }

        // Build InputsFrozen exactly as try_recompute does.
        let inputs = InputsFrozen {
            asset: sym.to_string(),
            class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev,
            hyusd_cr: None,
            previous_state: fsm_prev_state_frozen,
            candidate_state: candidate_state_frozen,
            candidate_since: candidate_since_frozen,
            thresholds: thresholds.clone(),
            threshold_kind: "bps".to_string(),
            pyth_entries: HashMap::new(),
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale: false,
        };

        // Assert: rederive must reproduce the exact engine outputs.
        let r = rederive(&inputs).expect("rederive: scenario A");
        assert_eq!(
            (r.discount_raw, r.discount_smooth, r.final_state),
            (discount_raw, discount_smooth, final_state),
            "scenario A (cold-start escalation): rederive mismatch"
        );

        // Sanity: timer just started → transition keeps Pegged.
        assert_eq!(
            final_state,
            PegState::Pegged,
            "candidate staged but not yet matured"
        );
        // And ewma_prev was None (GAP-1 exercised).
        assert_eq!(inputs.ewma_prev, None);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario B: Matured transition (USD stable, USDC)
    //
    // Seed a prior DRIFT candidate by running a first transition call with
    // `t0`, then run the real capture→mutate cycle at `t0 + 31s`. The
    // candidate matures into DRIFT. Tests GAP-2 (candidate_since pre-mutation)
    // and GAP-3 (last_state pre-mutation).
    // ─────────────────────────────────────────────────────────────────────────
    #[tokio::test]
    async fn scenario_b_matured_transition() {
        let e = fresh_engine();
        let sym = "USDC";
        let alpha: Decimal = ALPHA_STR.parse().unwrap();
        let class = AssetClass::StableFiat;

        let intrinsic: Decimal = "1.00".parse().unwrap();
        let market: Decimal = "0.997".parse().unwrap(); // 30bps → DRIFT band

        let observed_at = chrono::Utc::now();
        e.set_intrinsic(sym, intrinsic, observed_at).await;
        e.set_market(sym, market, observed_at).await;

        // ── First tick at t0: seed the candidate ──────────────────────────
        let t0 = chrono::Utc::now() - chrono::Duration::seconds(31);

        // First EWMA tick (seeds from raw; ewma_prev = None).
        let _ = e
            .apply_ewma(sym, "0.003".parse::<Decimal>().unwrap(), alpha)
            .await;

        // First transition: candidate stages at t0, last_state stays Pegged.
        let _ = e
            .transition(sym, PegState::Drift, t0, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
            .await;

        // After first tick: last_published_state is still None (no persist call).
        // Sync last_published_state ← last_state (= Pegged) so both agree —
        // mirrors the engine's set_last_published_state after persist.
        e.set_last_published_state(sym, PegState::Pegged).await;

        // ── Second tick at t0+31s: the real capture→mutate cycle ──────────
        let now = t0 + chrono::Duration::seconds(31);

        let discount_raw = compute_discount(intrinsic, market, None, None, class).unwrap();
        assert!(is_plausible_discount_sample(discount_raw));

        // GAP-1: capture ewma_prev BEFORE apply_ewma (now Some from first tick).
        let ewma_prev = e.previous_ewma(sym).await;
        assert!(ewma_prev.is_some(), "second tick has a prior EWMA");

        let discount_smooth = e
            .apply_ewma(sym, discount_raw, alpha)
            .await
            .expect("bounded inputs never overflow");

        // Classify using last_published_state (= Pegged after first tick).
        let current_for_classify = e
            .last_published_state(sym)
            .await
            .unwrap_or(PegState::Pegged);
        let thresholds = bps_thresholds();
        let new_state = classify_with_hysteresis(
            class,
            discount_smooth,
            &thresholds,
            current_for_classify,
            DEADBAND_PCT,
        );

        // GAP-2/3: capture BEFORE transition.
        let candidate_state_frozen = e.candidate_state(sym).await; // Some(Drift) from tick 1
        let candidate_since_frozen = e.candidate_since(sym).await; // Some(t0) from tick 1
        let fsm_prev_state_frozen = e.last_state(sym).await; // Pegged (still, pre-tick-2 transition)

        // Run transition — this will mature the candidate into Drift.
        let mut final_state = e
            .transition(sym, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
            .await;

        if premium_sanity_violated(class, discount_smooth) {
            final_state = PegState::Unknown;
        }

        let inputs = InputsFrozen {
            asset: sym.to_string(),
            class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev,
            hyusd_cr: None,
            previous_state: fsm_prev_state_frozen,
            candidate_state: candidate_state_frozen,
            candidate_since: candidate_since_frozen,
            thresholds: thresholds.clone(),
            threshold_kind: "bps".to_string(),
            pyth_entries: HashMap::new(),
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale: false,
        };

        let r = rederive(&inputs).expect("rederive: scenario B");
        assert_eq!(
            (r.discount_raw, r.discount_smooth, r.final_state),
            (discount_raw, discount_smooth, final_state),
            "scenario B (matured transition): rederive mismatch"
        );

        // Sanity: 31s elapsed ≥ confirm_up(30s) → candidate matured to DRIFT.
        assert_eq!(final_state, PegState::Drift, "candidate must have matured");
        // Candidate_since was frozen pre-transition, so the maturation was driven
        // by the gap between candidate_since_frozen and now — GAP-2/3 exercised.
        assert_eq!(inputs.candidate_state, Some(PegState::Drift));
        assert_eq!(inputs.previous_state, PegState::Pegged);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario C: hyUSD CR path
    //
    // class=StableCdp, threshold_kind="cr", hyusd_cr=1.40 (below drift=150%).
    // First tick → candidate DRIFT stages, timer not elapsed → Pegged.
    // Uses classify_cr_with_hysteresis, not classify_with_hysteresis.
    // ─────────────────────────────────────────────────────────────────────────
    #[tokio::test]
    async fn scenario_c_hyusd_cr_path() {
        let e = fresh_engine();
        // We use "hyUSD" because the engine branches on class=StableCdp && asset=="hyUSD".
        // In the test we mirror rederive's branch on threshold_kind=="cr" — same result.
        // But we still need a valid EngineState asset (for `rt` to be accessible).
        // Any symbol works for state.rs methods; we use a sentinel not in assets.toml
        // so snapshot/staleness gates are skipped (configs.get returns None → no gate).
        let sym = "hyUSD_test_cr";
        let alpha: Decimal = ALPHA_STR.parse().unwrap();
        let class = AssetClass::StableCdp;

        // Intrinsic/market for discount path (CR path ignores them for classify,
        // but compute_discount still runs first in the engine pipeline).
        let intrinsic: Decimal = "1.00".parse().unwrap();
        let market: Decimal = "0.999".parse().unwrap(); // small discount, plausible

        // Frozen CR value (1.40 → 140% < drift=150% → DRIFT band on CR path).
        let hyusd_cr: Decimal = "1.40".parse().unwrap();

        // Seed state.
        let observed_at = chrono::Utc::now();
        e.set_intrinsic(sym, intrinsic, observed_at).await;
        e.set_market(sym, market, observed_at).await;
        e.set_hyusd_cr(hyusd_cr).await;

        let now = chrono::Utc::now();

        let discount_raw = compute_discount(intrinsic, market, None, None, class).unwrap();
        assert!(is_plausible_discount_sample(discount_raw));

        // GAP-1.
        let ewma_prev = e.previous_ewma(sym).await;
        let discount_smooth = e
            .apply_ewma(sym, discount_raw, alpha)
            .await
            .expect("bounded inputs never overflow");

        // CR path: classify_cr_with_hysteresis.
        let cr_thresholds = cr_thresholds();
        let current_for_classify = e
            .last_published_state(sym)
            .await
            .unwrap_or(PegState::Pegged);
        let new_state = classify_cr_with_hysteresis(
            hyusd_cr,
            &cr_thresholds,
            current_for_classify,
            CR_DEADBAND_PCT,
        );

        // GAP-2/3: capture pre-transition.
        let candidate_state_frozen = e.candidate_state(sym).await;
        let candidate_since_frozen = e.candidate_since(sym).await;
        let fsm_prev_state_frozen = e.last_state(sym).await;

        let mut final_state = e
            .transition(sym, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
            .await;

        // premium_sanity_violated: StableCdp is not direction-sensitive → no-op.
        if premium_sanity_violated(class, discount_smooth) {
            final_state = PegState::Unknown;
        }

        // Freeze hyusd_cr as the engine does: engine.hyusd_cr().await at receipt-build time.
        let frozen_hyusd_cr = e.hyusd_cr().await;

        let inputs = InputsFrozen {
            asset: sym.to_string(),
            class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev,
            hyusd_cr: frozen_hyusd_cr,
            previous_state: fsm_prev_state_frozen,
            candidate_state: candidate_state_frozen,
            candidate_since: candidate_since_frozen,
            thresholds: cr_thresholds.clone(),
            threshold_kind: "cr".to_string(),
            pyth_entries: HashMap::new(),
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale: false,
        };

        let r = rederive(&inputs).expect("rederive: scenario C");
        assert_eq!(
            (r.discount_raw, r.discount_smooth, r.final_state),
            (discount_raw, discount_smooth, final_state),
            "scenario C (hyUSD CR path): rederive mismatch"
        );

        // CR=1.40 < drift=150% → new_state=DRIFT. Timer just started → stays Pegged.
        assert_eq!(
            final_state,
            PegState::Pegged,
            "DRIFT staged but not matured"
        );
        assert_eq!(frozen_hyusd_cr, Some(hyusd_cr));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario D: Premium-sanity override (LST with >10% premium)
    //
    // LST class, market premium of 15% → discount_smooth = -0.15 < -0.10.
    // premium_sanity_violated → final_state forced to Unknown.
    // rederive must also force Unknown.
    // ─────────────────────────────────────────────────────────────────────────
    #[tokio::test]
    async fn scenario_d_premium_sanity_override() {
        let e = fresh_engine();
        let sym = "jitoSOL";
        let alpha: Decimal = ALPHA_STR.parse().unwrap();
        let class = AssetClass::Lst;

        // Intrinsic=1.00, market=1.15 → discount = 1 - 1.15/1.00 = -0.15 (−1500bps premium).
        // No SOL-denominated path — use USD path so the premium is visible.
        let intrinsic: Decimal = "1.00".parse().unwrap();
        let market: Decimal = "1.15".parse().unwrap();

        let observed_at = chrono::Utc::now();
        e.set_intrinsic(sym, intrinsic, observed_at).await;
        e.set_market(sym, market, observed_at).await;

        let now = chrono::Utc::now();

        // USD path (no SOL-denominated values set).
        let discount_raw = compute_discount(intrinsic, market, None, None, class).unwrap();
        assert!(
            is_plausible_discount_sample(discount_raw),
            "premium still plausible (< 1.0)"
        );
        assert!(discount_raw < Decimal::ZERO, "negative discount = premium");

        // GAP-1.
        let ewma_prev = e.previous_ewma(sym).await;
        let discount_smooth = e
            .apply_ewma(sym, discount_raw, alpha)
            .await
            .expect("bounded inputs never overflow");

        // Classify (bps path, direction-sensitive LST: premium → PEGGED).
        let thresholds = bps_thresholds();
        let current_for_classify = e
            .last_published_state(sym)
            .await
            .unwrap_or(PegState::Pegged);
        let new_state = classify_with_hysteresis(
            class,
            discount_smooth,
            &thresholds,
            current_for_classify,
            DEADBAND_PCT,
        );

        // GAP-2/3.
        let candidate_state_frozen = e.candidate_state(sym).await;
        let candidate_since_frozen = e.candidate_since(sym).await;
        let fsm_prev_state_frozen = e.last_state(sym).await;

        let mut final_state = e
            .transition(sym, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
            .await;

        // Step 6: premium-sanity override — -0.15 on Lst → violated.
        if premium_sanity_violated(class, discount_smooth) {
            // Engine also calls force_unknown, but we only test the state value
            // that gets frozen into InputsFrozen / Computed (force_unknown
            // side-effects the runtime but the receipt value is final_state).
            final_state = PegState::Unknown;
        }

        let inputs = InputsFrozen {
            asset: sym.to_string(),
            class,
            now,
            alpha,
            intrinsic_usd: intrinsic,
            market_usd: market,
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev,
            hyusd_cr: None,
            previous_state: fsm_prev_state_frozen,
            candidate_state: candidate_state_frozen,
            candidate_since: candidate_since_frozen,
            thresholds: thresholds.clone(),
            threshold_kind: "bps".to_string(),
            pyth_entries: HashMap::new(),
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale: false,
        };

        let r = rederive(&inputs).expect("rederive: scenario D");
        assert_eq!(
            (r.discount_raw, r.discount_smooth, r.final_state),
            (discount_raw, discount_smooth, final_state),
            "scenario D (premium-sanity override): rederive mismatch"
        );

        // Sanity: final_state must be Unknown (NAV-sanity forced it).
        assert_eq!(
            final_state,
            PegState::Unknown,
            "premium sanity must force Unknown"
        );
        assert!(
            premium_sanity_violated(class, discount_smooth),
            "sanity gate must fire"
        );
    }
}

#[cfg(test)]
mod latency_tests {
    //! End-to-end signal-latency instrumentation (Step 1). Pure functions +
    //! the `market_observed_at` reader — all observability, no classification.
    use super::*;
    use chrono::TimeZone;
    use pegana_common::AssetsFile;

    fn t(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(1_700_000_000 + secs, 0).unwrap()
    }

    fn engine() -> EngineState {
        let raw = include_str!("../../../assets.toml");
        let assets: AssetsFile = toml::from_str(raw).unwrap();
        let canonical = toml::to_string(&assets).unwrap();
        EngineState::new(&assets, canonical, 30)
    }

    #[test]
    fn freshest_picks_the_newer_leg() {
        assert_eq!(freshest_observation(None, None), None);
        assert_eq!(freshest_observation(Some(t(5)), None), Some(t(5)));
        assert_eq!(freshest_observation(None, Some(t(9))), Some(t(9)));
        assert_eq!(freshest_observation(Some(t(5)), Some(t(9))), Some(t(9)));
        assert_eq!(freshest_observation(Some(t(9)), Some(t(5))), Some(t(9)));
        assert_eq!(freshest_observation(Some(t(7)), Some(t(7))), Some(t(7)));
    }

    #[test]
    fn latency_normal_zero_and_subsecond() {
        assert_eq!(signal_latency_secs(t(30), t(0)), 30.0);
        assert_eq!(signal_latency_secs(t(0), t(0)), 0.0);
        let now = Utc.timestamp_opt(1_700_000_000, 750_000_000).unwrap();
        let obs = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        assert!((signal_latency_secs(now, obs) - 0.75).abs() < 1e-9);
    }

    #[test]
    fn latency_clamps_future_clock_skew_to_zero() {
        // observed_at AHEAD of now (skew) must never record a negative latency.
        assert_eq!(signal_latency_secs(t(0), t(5)), 0.0);
    }

    // Deterministic stress sweep — every (now, observed_at) pair in a grid must
    // satisfy the invariants: never negative, exact when now≥obs, clamped to 0
    // under skew, and monotonic in `now`. `freshest_observation` must be
    // commutative and equal to the max.
    #[test]
    fn latency_stress_invariants() {
        for now_s in 0..48i64 {
            for obs_s in 0..48i64 {
                let l = signal_latency_secs(t(now_s), t(obs_s));
                assert!(l >= 0.0, "latency is never negative");
                if now_s >= obs_s {
                    assert!((l - (now_s - obs_s) as f64).abs() < 1e-9);
                    if now_s > obs_s {
                        assert!(l >= signal_latency_secs(t(now_s - 1), t(obs_s)));
                    }
                } else {
                    assert_eq!(l, 0.0, "future skew clamps to 0");
                }
                let ab = freshest_observation(Some(t(now_s)), Some(t(obs_s)));
                let ba = freshest_observation(Some(t(obs_s)), Some(t(now_s)));
                assert_eq!(ab, ba, "freshest is commutative");
                assert_eq!(ab, Some(t(now_s.max(obs_s))));
            }
        }
    }

    #[tokio::test]
    async fn market_observed_at_reads_freshest_leg() {
        let e = engine();
        assert_eq!(e.market_observed_at("USDC").await, None, "cold start");
        e.set_market("USDC", Decimal::from(1), t(10)).await;
        assert_eq!(e.market_observed_at("USDC").await, Some(t(10)));
        e.set_market_sol("USDC", Decimal::from(1), t(25)).await;
        assert_eq!(
            e.market_observed_at("USDC").await,
            Some(t(25)),
            "SOL leg is newer → wins"
        );
    }
}

#[cfg(test)]
mod state_since_tests {
    use super::*;
    use chrono::TimeZone;

    fn t(m: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(1_800_000_000 + m * 60, 0).unwrap()
    }

    #[test]
    fn state_since_holds_within_a_state_and_moves_on_transition() {
        // Hydrated value holds across ticks in the same state.
        let mut cur = Some(t(0));
        for m in 1..5 {
            cur = next_state_since(Some(PegState::Pegged), PegState::Pegged, cur, t(m));
            assert_eq!(cur, Some(t(0)));
        }
        // Transition moves it; re-entry restarts it.
        cur = next_state_since(Some(PegState::Pegged), PegState::Drift, cur, t(5));
        assert_eq!(cur, Some(t(5)));
        cur = next_state_since(Some(PegState::Drift), PegState::Drift, cur, t(6));
        assert_eq!(cur, Some(t(5)));
        cur = next_state_since(Some(PegState::Drift), PegState::Pegged, cur, t(7));
        assert_eq!(cur, Some(t(7)));
    }

    #[test]
    fn state_since_is_never_fabricated_without_a_prior_state() {
        // Restart after TRUNCATE / restore failure: no prior published state and
        // no stored value -> stay None (API falls back / history seed derives it).
        assert_eq!(next_state_since(None, PegState::Pegged, None, t(9)), None);
        // Same state with a missing value also stays None (seeded from history).
        assert_eq!(
            next_state_since(Some(PegState::Pegged), PegState::Pegged, None, t(9)),
            None
        );
        // A stored value survives a no-prior-state tick untouched.
        assert_eq!(
            next_state_since(None, PegState::Pegged, Some(t(1)), t(9)),
            Some(t(1))
        );
        // A real observed transition is stamped even if the value was missing.
        assert_eq!(
            next_state_since(Some(PegState::Pegged), PegState::Drift, None, t(9)),
            Some(t(9))
        );
    }
}
