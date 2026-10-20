//! Intrinsic self-audit + liveness cross-check against lst-directory.com.
//!
//! Pegana derives each `sanctum_lst` asset's intrinsic rate (SOL per LST
//! share) from Sanctum's `/v1/sol-value/current` API — see `sources::sanctum`.
//! lst-directory.com (maintained by Hylo, already surfaced on Pegana's own
//! `/lst` public directory page) reports a `rate` per LST, plus per-row
//! liveness `flags{stale,deprecated,dead}` and the previous rate (`ratePrev`).
//!
//! This source surfaces two independent things. It is a SELF-AUDIT, not a peg
//! signal: it never touches `AppState::sanctum_cache`, never writes
//! `intrinsic_snapshots`, and is invisible to `engine-rs`. Pegana's own
//! Sanctum-derived rate stays authoritative even when this audit fires.
//!
//! 1. **Rate divergence — a FEED-INTEGRITY tripwire, not a peg signal.**
//!    ⚠️ Our rate and the directory's `rate` are NOT the same quantity:
//!    Sanctum's sol-value/current is the *realizable* value (what you'd get
//!    unstaking now, net of the pool's unstake fee), while the directory's
//!    `rate` is the *booked* NAV. So there is a permanent STRUCTURAL
//!    "redemption haircut" between them — measured live 2026-07-17 at ~114 bps
//!    (bSOL) / ~124 bps (jupSOL). This is expected, not a bug. The divergence
//!    tripwire therefore fires only WELL ABOVE that haircut band (see
//!    `DEFAULT_TOLERANCE_BPS`), to catch a genuinely broken pipeline (our
//!    Sanctum feed returning garbage → `our_rate` wildly off), which the
//!    directory's own flags below can't see.
//!
//! 2. **Directory liveness flags — a "go look" signal.** The backend twin of
//!    the frontend INTRINSIC_DEGRADED advisory (ADR-0037): when the directory
//!    marks a covered LST `stale` (rate stopped advancing — the frozen-backing
//!    dSOL failure mode), `deprecated`, or `dead`, we emit a per-flag gauge +
//!    WARN so ops is paged (see `PeganaLstDirectoryFlagged`). Offset-free —
//!    it's the maintainer's own liveness determination, not a rate comparison.

use crate::state::AppState;
use anyhow::{Context, Result};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

const DIRECTORY_URL: &str = "https://lst-directory.com/api/directory";

/// lst-directory.com's own web consumer (`web/lib/lst/fetch-directory.ts`)
/// caches it for 15 minutes, matching the directory's own refresh cadence —
/// polling faster wouldn't observe fresher data, just adds load to a third
/// party Pegana doesn't control. This is telemetry, not peg-critical, so a
/// 15-minute catch window for a real divergence is fine.
const DEFAULT_POLL_MS: u64 = 900_000;

/// Divergence tolerance (bps) before the FEED-INTEGRITY tripwire logs a WARN.
///
/// ⚠️ This is NOT a peg/noise threshold. `our_rate` (realizable sol-value) and
/// the directory's `rate` (booked NAV) differ by a permanent structural
/// redemption haircut — measured live 2026-07-17 at ~114 bps (bSOL) / ~124 bps
/// (jupSOL). The OLD default of 75 bps sat BELOW that haircut, so it fired on
/// every covered LST every poll (chronic false WARN + false page). The tripwire
/// must sit well ABOVE the haircut band so it only fires on a genuine anomaly:
/// our Sanctum feed returning garbage would push `our_rate` wildly off (many
/// hundreds-to-thousands of bps), nowhere near the ~120 bps haircut. 300 bps is
/// ~2.4× the largest haircut observed, leaving margin for higher-unstake-fee
/// LSTs not in the 2-asset sample while still catching a broken feed.
///
/// Calibrate against the full universe's haircut distribution if paging noise
/// appears (query analogous to ADR-0035's): the per-LST haircut ≈ that LST's
/// Sanctum unstake fee, so a high-fee LST could structurally run wider.
/// Override live via `INTRINSIC_DIVERGENCE_TOLERANCE_BPS`.
const DEFAULT_TOLERANCE_BPS: u32 = 300;

#[derive(Debug, Default, Deserialize)]
struct DirectoryResponse {
    #[serde(default)]
    rows: Vec<DirectoryRow>,
}

/// The directory maintainer's own per-LST liveness determination. `stale` means
/// the rate stopped advancing on-chain (the frozen-backing dSOL failure mode);
/// `deprecated`/`dead` mark an LST being wound down / dead. Any unknown flag key
/// the upstream adds is ignored (no `deny_unknown_fields`); a missing `flags`
/// object defaults all-false (treated as healthy).
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
struct DirectoryFlags {
    #[serde(default)]
    stale: bool,
    #[serde(default)]
    deprecated: bool,
    #[serde(default)]
    dead: bool,
}

#[derive(Debug, Deserialize)]
struct DirectoryRow {
    mint: String,
    #[serde(default)]
    rate: Option<f64>,
    /// The directory's PREVIOUS rate observation — `rate > rate_prev` means the
    /// backing advanced (healthy); equal means it hasn't since the last update.
    #[serde(default, rename = "ratePrev")]
    rate_prev: Option<f64>,
    #[serde(default)]
    flags: DirectoryFlags,
}

/// One `sanctum_lst` asset this audit can check: Pegana's own symbol (for
/// labeling), the Sanctum-side symbol (the `sanctum_cache` key — see
/// `AppState::sanctum_symbols`), and the mint (the directory join key).
#[derive(Debug, Clone, PartialEq)]
struct CoveredLst {
    asset_symbol: String,
    sanctum_symbol: String,
    mint: String,
}

/// One directory row's payload, keyed by mint. Unlike the old rate-only map,
/// EVERY row is kept — a `dead`/`stale` LST can legitimately carry a null rate,
/// and its flag signal must still surface even when the divergence check skips
/// it for want of a comparable rate.
#[derive(Debug, Clone, PartialEq)]
struct DirectoryEntry {
    /// Booked NAV rate — `None` when the directory reports null/zero/negative/
    /// non-finite (dropped rather than laundered into a 100%-divergence).
    rate: Option<Decimal>,
    rate_prev: Option<Decimal>,
    flags: DirectoryFlags,
}

/// One computed cross-check result, ready to publish.
#[derive(Debug, Clone, PartialEq)]
struct Divergence {
    asset_symbol: String,
    mint: String,
    our_rate: Decimal,
    directory_rate: Decimal,
    bps: Decimal,
}

/// One covered LST's directory-liveness signal (independent of our own rate).
#[derive(Debug, Clone, PartialEq)]
struct FlagSignal {
    asset_symbol: String,
    mint: String,
    flags: DirectoryFlags,
    /// `Some(true)` when the directory's rate advanced since its previous
    /// observation (`rate > rate_prev`), `Some(false)` when it hasn't, `None`
    /// when either rate is absent. Telemetry only — a single non-advancing tick
    /// is normal within an epoch (rates step ~once per ~2-day epoch), so the
    /// directory's own `stale` flag (a multi-epoch call) drives the WARN.
    rate_advancing: Option<bool>,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let covered = covered_lsts(&state);
    if covered.is_empty() {
        info!("no active sanctum_lst assets — intrinsic-divergence audit idle");
        return Ok(());
    }

    let cadence_ms = std::env::var("LST_DIRECTORY_POLL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_MS);
    let tolerance_bps = std::env::var("INTRINSIC_DIVERGENCE_TOLERANCE_BPS")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(DEFAULT_TOLERANCE_BPS);

    let mut tick = interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        cadence_ms,
        tolerance_bps,
        asset_count = covered.len(),
        "intrinsic-divergence self-audit ready (lst-directory.com cross-check)"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("intrinsic-divergence audit shutdown");
                return Ok(());
            }
        }

        match poll_once(&state, &covered, tolerance_bps).await {
            Ok(checked) => {
                metrics::counter!("pegana_lst_directory_polls_total", "status" => "ok")
                    .increment(1);
                if checked == 0 {
                    debug!(
                        "intrinsic-divergence audit: no covered LST matched by mint this tick \
                         (cold boot, or directory doesn't cover any of our sanctum_lst mints yet)"
                    );
                } else {
                    debug!(checked, "intrinsic-divergence audit tick complete");
                }
            }
            Err(e) => {
                // Directory unreachable/malformed → skip this tick, never crash.
                // Pegana's own intrinsic is completely unaffected; this source
                // only observes, it never feeds anything back.
                warn!(
                    error = %e,
                    "lst-directory.com unreachable — skipping this self-audit tick"
                );
                metrics::counter!("pegana_lst_directory_polls_total", "status" => "error")
                    .increment(1);
            }
        }
    }
}

/// Every active `sanctum_lst` asset — the only class this audit covers,
/// since the directory-vs-Pegana comparison only makes sense for the LSTs
/// whose intrinsic we derive from Sanctum's sol-value API in the first place.
fn covered_lsts(state: &AppState) -> Vec<CoveredLst> {
    use pegana_common::IntrinsicStrategy::*;
    state
        .assets
        .assets
        .iter()
        .filter(|a| a.active)
        .filter_map(|a| match &a.intrinsic {
            SanctumLst { symbol } => Some(CoveredLst {
                asset_symbol: a.symbol.clone(),
                sanctum_symbol: symbol.clone(),
                mint: a.mint.clone(),
            }),
            _ => None,
        })
        .collect()
}

async fn poll_once(state: &AppState, covered: &[CoveredLst], tolerance_bps: u32) -> Result<usize> {
    let resp = state
        .http
        .get(DIRECTORY_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .context("lst-directory request")?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("lst-directory http {status}");
    }
    let body: DirectoryResponse = resp.json().await.context("lst-directory decode")?;
    if body.rows.is_empty() {
        // Empty body reads the same as "directory currently has nothing" —
        // treat it like unreachable rather than silently leaving every
        // gauge at its last value with no signal either way.
        anyhow::bail!("lst-directory returned zero rows");
    }

    // Cache the parsed response for the duration of this single poll cycle —
    // every covered asset is checked against ONE fetch, never one fetch per
    // asset. (The next fetch happens on the next tick, per DEFAULT_POLL_MS.)
    let directory = build_directory_map(&body.rows);

    // Snapshot-read Pegana's own in-memory Sanctum cache (populated by
    // `sources::sanctum`) — never mutated here.
    let sanctum = state.sanctum_cache.read().await.clone();

    // ── 1. Feed-integrity tripwire (realizable-vs-booked haircut) ──────────
    let divergences = compute_divergences(covered, &sanctum, &directory);
    for d in &divergences {
        metrics::gauge!("pegana_intrinsic_divergence_bps", "asset" => d.asset_symbol.clone())
            .set(pegana_common::decimal_to_f64(d.bps));

        // Fires only WELL above the ~114-124 bps structural redemption haircut
        // (tolerance now 300 bps) — at that magnitude it's no longer the haircut
        // but a broken pipeline (our Sanctum feed returning garbage).
        if d.bps >= Decimal::from(tolerance_bps) {
            warn!(
                asset = %d.asset_symbol,
                mint = %d.mint,
                our_rate = %d.our_rate,
                directory_rate = %d.directory_rate,
                divergence_bps = %d.bps,
                tolerance_bps,
                "intrinsic self-audit: Pegana's sanctum_lst realizable rate diverges \
                 from lst-directory.com's booked rate FAR beyond the structural \
                 redemption haircut (~120 bps) — likely a broken/stale Sanctum feed \
                 producing garbage our_rate, NOT the normal haircut (informational \
                 only, NOT a peg signal; Pegana's own intrinsic remains authoritative)"
            );
        }
    }

    // ── 2. Directory liveness flags (backend twin of INTRINSIC_DEGRADED) ───
    let flag_signals = compute_flag_signals(covered, &directory);
    for s in &flag_signals {
        // Emit one 1/0 gauge per flag per covered LST so the series stays alive
        // (a continuous "0 = healthy" line, and the PeganaLstDirectoryFlagged
        // alert can fire on `> 0`).
        for (flag_name, active) in [
            ("stale", s.flags.stale),
            ("deprecated", s.flags.deprecated),
            ("dead", s.flags.dead),
        ] {
            metrics::gauge!(
                "pegana_lst_directory_flagged",
                "asset" => s.asset_symbol.clone(),
                "flag" => flag_name,
            )
            .set(if active { 1.0 } else { 0.0 });
        }

        // Backing-advancement telemetry (rate vs ratePrev). No WARN: a single
        // non-advancing tick is normal within an epoch — the directory's own
        // `stale` flag (a multi-epoch call) is what pages, below.
        if let Some(advancing) = s.rate_advancing {
            metrics::gauge!(
                "pegana_lst_directory_rate_advancing",
                "asset" => s.asset_symbol.clone(),
            )
            .set(if advancing { 1.0 } else { 0.0 });
        }

        if s.flags.stale || s.flags.deprecated || s.flags.dead {
            warn!(
                asset = %s.asset_symbol,
                mint = %s.mint,
                stale = s.flags.stale,
                deprecated = s.flags.deprecated,
                dead = s.flags.dead,
                "intrinsic self-audit: lst-directory.com flags this covered LST's \
                 backing (stale = rate stopped advancing / deprecated / dead) — go \
                 look: a frozen-but-served backing reads as a confident peg, and a \
                 dead/deprecated LST should be deactivated (informational only, NOT \
                 a peg signal; the verdict pipeline is untouched)"
            );
        }

        // Persist the intrinsic-liveness signal (ADR-0038) for the engine's
        // gate. The gate verdict is `flags.stale` CORROBORATED by the rate
        // actually not advancing (`directory_gate_stale`) — the raw flag alone
        // false-positives (calibration 2026-07-17: sharkSOL is flags.stale=true
        // but rate-ADVANCING, a $141 dust LST). The gauge/WARN above stay on the
        // RAW flag (that's the advisory truth); only the GATE signal is
        // corroborated. Observe-only until INTRINSIC_LIVENESS_GATE is enabled.
        let gate_stale = directory_gate_stale(s.flags.stale, s.rate_advancing);
        // Guarded: never wipe/replace a stale row another detector owns (e.g. the
        // Sanctum NAV drift/unverified flag) — the table has one row per asset.
        if let Err(e) = crate::sinks::postgres::upsert_intrinsic_liveness_guarded(
            &state.pg,
            &s.asset_symbol,
            gate_stale,
            "directory_stale",
            serde_json::json!({
                "gate_stale": gate_stale,
                "flag_stale": s.flags.stale,
                "rate_advancing": s.rate_advancing,
                "deprecated": s.flags.deprecated,
                "dead": s.flags.dead,
            }),
        )
        .await
        {
            warn!(asset = %s.asset_symbol, error = %e, "intrinsic_liveness upsert failed (directory_stale)");
        }
    }

    Ok(divergences.len())
}

/// mint → `DirectoryEntry`. EVERY row is kept (a `dead`/`stale` LST can carry a
/// null rate but must still surface its flag). Only the `rate`/`rate_prev`
/// FIELDS are sanitised to `None` on a malformed/null/zero/negative/non-finite
/// value — never laundered into a comparison that would look like a 100%
/// divergence; the divergence check skips a `None` rate, the flag check doesn't.
fn build_directory_map(rows: &[DirectoryRow]) -> HashMap<String, DirectoryEntry> {
    fn clean(v: Option<f64>) -> Option<Decimal> {
        v.filter(|x| x.is_finite() && *x > 0.0)
            .and_then(Decimal::from_f64_retain)
    }
    rows.iter()
        .map(|r| {
            (
                r.mint.trim().to_string(),
                DirectoryEntry {
                    rate: clean(r.rate),
                    rate_prev: clean(r.rate_prev),
                    flags: r.flags,
                },
            )
        })
        .collect()
}

/// Pure match-by-mint + bps-divergence computation — no IO, fully unit
/// tested below. Skips (rather than errors on) any asset missing either
/// side of the comparison: a cold-boot Sanctum cache or a mint the
/// directory doesn't cover yet are both "nothing to compare" states, not
/// failures.
fn compute_divergences(
    covered: &[CoveredLst],
    sanctum: &HashMap<String, u64>,
    directory: &HashMap<String, DirectoryEntry>,
) -> Vec<Divergence> {
    let mut out = Vec::new();
    for c in covered {
        let Some(entry) = directory.get(c.mint.trim()) else {
            continue;
        };
        let Some(directory_rate) = entry.rate else {
            continue;
        };
        let Some(&lamports) = sanctum.get(&c.sanctum_symbol) else {
            continue;
        };
        let our_rate = Decimal::from(lamports) / Decimal::from(1_000_000_000u64);
        let Some(bps) = divergence_bps(our_rate, directory_rate) else {
            continue;
        };
        out.push(Divergence {
            asset_symbol: c.asset_symbol.clone(),
            mint: c.mint.clone(),
            our_rate,
            directory_rate,
            bps,
        });
    }
    out
}

/// Pure liveness-flag extraction — one `FlagSignal` per covered LST the
/// directory actually carries a row for (independent of whether we have a
/// comparable Sanctum rate). Unlike `compute_divergences` this does NOT require
/// our own `sanctum_cache` entry: a `dead`/`stale` flag is worth surfacing even
/// on a cold-boot tick before Sanctum has published.
fn compute_flag_signals(
    covered: &[CoveredLst],
    directory: &HashMap<String, DirectoryEntry>,
) -> Vec<FlagSignal> {
    let mut out = Vec::new();
    for c in covered {
        let Some(entry) = directory.get(c.mint.trim()) else {
            continue;
        };
        let rate_advancing = match (entry.rate, entry.rate_prev) {
            (Some(r), Some(p)) => Some(r > p),
            _ => None,
        };
        out.push(FlagSignal {
            asset_symbol: c.asset_symbol.clone(),
            mint: c.mint.clone(),
            flags: entry.flags,
            rate_advancing,
        });
    }
    out
}

/// The intrinsic-liveness GATE verdict (ADR-0038) for a sanctum_lst — the raw
/// directory `flags.stale` CORROBORATED by the rate actually being frozen. The
/// directory over-flags: calibration 2026-07-17 found sharkSOL (a $141 dust LST
/// we track) `flags.stale=true` yet rate-ADVANCING (1.057490 > 1.057279), so the
/// raw flag alone would false-force it to UNKNOWN. Require BOTH: the flag AND a
/// CONFIRMED non-advancing rate (`rate_advancing == Some(false)`, i.e.
/// rate == ratePrev). `None` (rate/ratePrev absent → can't confirm) fails OPEN
/// (not stale) — never UNKNOWN on uncertainty. The advisory badge/gauge keep the
/// raw flag; only this gate signal is corroborated.
fn directory_gate_stale(flag_stale: bool, rate_advancing: Option<bool>) -> bool {
    flag_stale && rate_advancing == Some(false)
}

/// |our − directory| in bps, relative to Pegana's OWN rate. Measuring
/// against our own value as the reference (not the directory's) mirrors the
/// rest of the methodology's convention of always dividing by the intrinsic
/// side (see `pegana_methodology::compute_discount`, and the web's
/// `reconcileBps`) — this audit is checking the outside world against US,
/// not the other way around; the directory never gets to redefine what
/// "correct" means here.
///
/// `checked_div`/`checked_mul`, not `/`/`*`: a near-zero `our_rate` would
/// otherwise overflow `Decimal` and PANIC on divide — the same class of bug
/// as audit finding F-12 (see `sources::hylo::ufix_to_decimal`'s identical
/// guard). `None` here means "skip this asset this tick", never a crash.
fn divergence_bps(our_rate: Decimal, directory_rate: Decimal) -> Option<Decimal> {
    if our_rate.is_zero() || our_rate.is_sign_negative() {
        return None;
    }
    let diff = (our_rate - directory_rate).abs();
    diff.checked_div(our_rate)?
        .checked_mul(Decimal::from(10_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    // ── divergence_bps ──────────────────────────────────────────────────

    #[test]
    fn identical_rates_are_zero_bps() {
        assert_eq!(
            divergence_bps(dec("1.2345"), dec("1.2345")),
            Some(Decimal::ZERO)
        );
    }

    #[test]
    fn known_divergence_matches_hand_computed_bps() {
        // our=1.0000, directory=1.0075 → 0.75% = 75 bps.
        let bps = divergence_bps(dec("1.0000"), dec("1.0075")).unwrap();
        assert_eq!(bps, dec("75"));
    }

    #[test]
    fn direction_does_not_matter_absolute_value() {
        // directory above vs below our rate should give the same magnitude.
        let above = divergence_bps(dec("1.0000"), dec("1.0075")).unwrap();
        let below = divergence_bps(dec("1.0000"), dec("0.9925")).unwrap();
        assert_eq!(above, below);
    }

    #[test]
    fn zero_our_rate_returns_none_not_panic() {
        assert_eq!(divergence_bps(Decimal::ZERO, dec("1.0")), None);
    }

    #[test]
    fn negative_our_rate_returns_none() {
        // Should never happen (lamports are unsigned) but guard anyway —
        // never divide against a sign-flipped reference.
        assert_eq!(divergence_bps(dec("-1.0"), dec("1.0")), None);
    }

    #[test]
    fn tiny_our_rate_does_not_panic_and_produces_large_bps() {
        // Pathologically small reference (e.g. a corrupted lamports read) —
        // must return Some(huge) or None, never panic on overflow.
        let bps = divergence_bps(dec("0.0000000001"), dec("1.0"));
        assert!(bps.is_some());
    }

    // ── test helpers ────────────────────────────────────────────────────

    fn covered(asset_symbol: &str, sanctum_symbol: &str, mint: &str) -> CoveredLst {
        CoveredLst {
            asset_symbol: asset_symbol.into(),
            sanctum_symbol: sanctum_symbol.into(),
            mint: mint.into(),
        }
    }

    /// A rate-only directory entry (no prev, all flags false).
    fn entry(rate: Decimal) -> DirectoryEntry {
        DirectoryEntry {
            rate: Some(rate),
            rate_prev: None,
            flags: DirectoryFlags::default(),
        }
    }

    fn row(mint: &str, rate: Option<f64>) -> DirectoryRow {
        DirectoryRow {
            mint: mint.into(),
            rate,
            rate_prev: None,
            flags: DirectoryFlags::default(),
        }
    }

    // ── build_directory_map ─────────────────────────────────────────────

    #[test]
    fn build_directory_map_keeps_all_rows_but_sanitises_bad_rates_to_none() {
        // Every row is kept now (a dead/stale LST can carry a null rate); only
        // the rate FIELD is sanitised to None on null/zero/negative/non-finite.
        let rows = vec![
            row("MintA", Some(1.5)),
            row("MintB", None),
            row("MintC", Some(0.0)),
            row("MintD", Some(-1.0)),
            row("MintE", Some(f64::NAN)),
            row("MintF", Some(f64::INFINITY)),
        ];
        let map = build_directory_map(&rows);
        assert_eq!(map.len(), 6);
        assert_eq!(map.get("MintA").unwrap().rate, Some(dec("1.5")));
        for m in ["MintB", "MintC", "MintD", "MintE", "MintF"] {
            assert_eq!(
                map.get(m).unwrap().rate,
                None,
                "{m} rate must sanitise to None"
            );
        }
    }

    #[test]
    fn build_directory_map_decodes_flags_and_rate_prev() {
        // Use exactly-f64-representable values (1.25 / 1.0) so from_f64_retain
        // round-trips exactly — 1.21 would carry float noise, as the drop-test
        // above already relies on for its 1.5 case.
        let rows = vec![DirectoryRow {
            mint: "MintA".into(),
            rate: Some(1.25),
            rate_prev: Some(1.0),
            flags: DirectoryFlags {
                stale: true,
                deprecated: false,
                dead: false,
            },
        }];
        let map = build_directory_map(&rows);
        let e = map.get("MintA").unwrap();
        assert_eq!(e.rate, Some(dec("1.25")));
        assert_eq!(e.rate_prev, Some(dec("1.0")));
        assert!(e.flags.stale && !e.flags.dead);
    }

    #[test]
    fn build_directory_map_trims_mint_whitespace() {
        let rows = vec![row("  MintA  ", Some(1.0))];
        let map = build_directory_map(&rows);
        assert_eq!(map.get("MintA").unwrap().rate, Some(dec("1.0")));
    }

    // ── compute_divergences (match-by-mint) ─────────────────────────────

    #[test]
    fn matches_by_mint_and_computes_bps() {
        let covered = vec![covered("mSOL", "mSOL", "MintMsol")];
        let mut sanctum = HashMap::new();
        // 1_000_000_000 lamports = 1.0 SOL/LST exactly.
        sanctum.insert("mSOL".to_string(), 1_000_000_000u64);
        let mut directory = HashMap::new();
        directory.insert("MintMsol".to_string(), entry(dec("1.01"))); // 1% above

        let out = compute_divergences(&covered, &sanctum, &directory);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].asset_symbol, "mSOL");
        assert_eq!(out[0].our_rate, dec("1"));
        assert_eq!(out[0].directory_rate, dec("1.01"));
        assert_eq!(out[0].bps, dec("100"));
    }

    #[test]
    fn skips_asset_missing_from_directory() {
        let covered = vec![covered("mSOL", "mSOL", "MintMsol")];
        let mut sanctum = HashMap::new();
        sanctum.insert("mSOL".to_string(), 1_000_000_000u64);
        let directory = HashMap::new(); // directory doesn't cover this mint

        assert!(compute_divergences(&covered, &sanctum, &directory).is_empty());
    }

    #[test]
    fn skips_asset_with_null_directory_rate() {
        // A dead/stale LST can carry a null rate — the divergence check skips it
        // (no comparable number), even though its flag signal still surfaces.
        let covered = vec![covered("mSOL", "mSOL", "MintMsol")];
        let mut sanctum = HashMap::new();
        sanctum.insert("mSOL".to_string(), 1_000_000_000u64);
        let mut directory = HashMap::new();
        directory.insert(
            "MintMsol".to_string(),
            DirectoryEntry {
                rate: None,
                rate_prev: None,
                flags: DirectoryFlags {
                    dead: true,
                    ..Default::default()
                },
            },
        );

        assert!(compute_divergences(&covered, &sanctum, &directory).is_empty());
    }

    #[test]
    fn skips_asset_missing_from_sanctum_cache() {
        // Cold boot: Sanctum hasn't published anything for this symbol yet.
        let covered = vec![covered("mSOL", "mSOL", "MintMsol")];
        let sanctum = HashMap::new();
        let mut directory = HashMap::new();
        directory.insert("MintMsol".to_string(), entry(dec("1.0")));

        assert!(compute_divergences(&covered, &sanctum, &directory).is_empty());
    }

    #[test]
    fn matches_by_mint_not_by_symbol() {
        // Sanctum-side symbol differs in case from what a naive symbol-match
        // would assume; mint is the join key, and matching must work purely
        // off it regardless of any symbol casing quirks.
        let covered = vec![covered("hyloSOL+", "hyloSOL+", "MintHyloSolPlus")];
        let mut sanctum = HashMap::new();
        sanctum.insert("hyloSOL+".to_string(), 1_050_000_000u64); // 1.05
        let mut directory = HashMap::new();
        directory.insert("MintHyloSolPlus".to_string(), entry(dec("1.05")));

        let out = compute_divergences(&covered, &sanctum, &directory);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].bps, Decimal::ZERO);
    }

    #[test]
    fn multiple_covered_assets_each_computed_independently() {
        let covered = vec![
            covered("mSOL", "mSOL", "MintMsol"),
            covered("bSOL", "bSOL", "MintBsol"),
            covered("noMatch", "noMatch", "MintNoMatch"),
        ];
        let mut sanctum = HashMap::new();
        sanctum.insert("mSOL".to_string(), 1_000_000_000u64);
        sanctum.insert("bSOL".to_string(), 1_020_000_000u64);
        // noMatch intentionally missing from sanctum cache.
        let mut directory = HashMap::new();
        directory.insert("MintMsol".to_string(), entry(dec("1.0")));
        directory.insert("MintBsol".to_string(), entry(dec("1.03")));
        directory.insert("MintNoMatch".to_string(), entry(dec("1.0")));

        let out = compute_divergences(&covered, &sanctum, &directory);
        assert_eq!(out.len(), 2);
        let bsol = out.iter().find(|d| d.asset_symbol == "bSOL").unwrap();
        // our=1.02, directory=1.03 → diff 0.01 / 1.02 * 10000 ≈ 98.03 bps
        assert!(bsol.bps > dec("98") && bsol.bps < dec("99"));
    }

    #[test]
    fn structural_haircut_stays_below_recalibrated_tolerance() {
        // The verified realizable-vs-booked haircut (~114-124 bps live) must NOT
        // trip the 300 bps tripwire — the whole point of the recalibration.
        // bSOL: our 1.290721 (realizable) vs directory 1.305430 (booked).
        let bps = divergence_bps(dec("1.290721131"), dec("1.3054302038965826")).unwrap();
        assert!(
            bps > dec("110") && bps < dec("120"),
            "haircut ~114 bps, got {bps}"
        );
        assert!(
            bps < Decimal::from(DEFAULT_TOLERANCE_BPS),
            "must not trip the tripwire"
        );
    }

    // ── compute_flag_signals (liveness) ─────────────────────────────────

    #[test]
    fn flag_signals_surface_even_without_a_sanctum_rate() {
        // A dead LST with a null rate produces NO divergence but MUST still
        // produce a flag signal (the whole reason flags don't gate on rate).
        let covered = vec![covered("dSOL", "dSOL", "MintDsol")];
        let mut directory = HashMap::new();
        directory.insert(
            "MintDsol".to_string(),
            DirectoryEntry {
                rate: None,
                rate_prev: None,
                flags: DirectoryFlags {
                    dead: true,
                    ..Default::default()
                },
            },
        );

        let out = compute_flag_signals(&covered, &directory);
        assert_eq!(out.len(), 1);
        assert!(out[0].flags.dead);
        assert_eq!(out[0].rate_advancing, None);
    }

    #[test]
    fn flag_signals_compute_rate_advancement_from_prev() {
        let covered = vec![
            covered("adv", "adv", "MintAdv"),
            covered("frozen", "frozen", "MintFrozen"),
        ];
        let mut directory = HashMap::new();
        directory.insert(
            "MintAdv".to_string(),
            DirectoryEntry {
                rate: Some(dec("1.2054")),
                rate_prev: Some(dec("1.2050")),
                flags: DirectoryFlags::default(),
            },
        );
        directory.insert(
            "MintFrozen".to_string(),
            DirectoryEntry {
                rate: Some(dec("1.2050")),
                rate_prev: Some(dec("1.2050")),
                flags: DirectoryFlags::default(),
            },
        );

        let out = compute_flag_signals(&covered, &directory);
        let adv = out.iter().find(|s| s.asset_symbol == "adv").unwrap();
        let frozen = out.iter().find(|s| s.asset_symbol == "frozen").unwrap();
        assert_eq!(adv.rate_advancing, Some(true));
        assert_eq!(frozen.rate_advancing, Some(false)); // equal = not advancing
    }

    #[test]
    fn flag_signals_skip_uncovered_mints() {
        let covered = vec![covered("mSOL", "mSOL", "MintMsol")];
        let directory = HashMap::new(); // directory doesn't carry this mint
        assert!(compute_flag_signals(&covered, &directory).is_empty());
    }

    // ── directory_gate_stale (ADR-0038 gate signal, corroborated) ─────────

    #[test]
    fn directory_gate_stale_corroborates_flag_with_frozen_rate() {
        // The sharkSOL false-positive (calibration 2026-07-17): flagged stale but
        // rate ADVANCING → the GATE must NOT fire (no false-UNKNOWN).
        assert!(!directory_gate_stale(true, Some(true)));
        // Genuinely frozen: flagged AND rate confirmed non-advancing → GATE fires.
        assert!(directory_gate_stale(true, Some(false)));
        // Not flagged → never, regardless of rate.
        assert!(!directory_gate_stale(false, Some(false)));
        assert!(!directory_gate_stale(false, Some(true)));
        // Can't confirm advancement (rate/ratePrev absent) → fail OPEN, not stale.
        assert!(!directory_gate_stale(true, None));
    }

    // ── covered_lsts ─────────────────────────────────────────────────────
    // (Config-shape filtering is exercised indirectly via compute_divergences
    // tests above using hand-built CoveredLst — AppState requires a live DB
    // pool / redis connection to construct, so covered_lsts() itself is not
    // separately unit tested here; its logic is a straightforward filter
    // mirroring the already-tested `AppState::sanctum_symbols`.)
}
