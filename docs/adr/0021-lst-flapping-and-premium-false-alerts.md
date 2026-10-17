# ADR-0021: Kill LST false alerts — magnitude deadband + premium carve-out (methodology 0.2.0)

- **Status:** Accepted (2026-06-01)
- **Amends:** `05-methodology-crate.md` (classification), ADR-0009 (invokes its
  critical-bug exception). Builds on ADR-0019 (which kept 0.1.0 because it never
  changed a receipt-producing value — this one does, hence the version bump).

## Context

During the calibration window (2026-05-29 → 06-10) the engine emitted two
classes of **false alerts** on JupSOL, both rooted in v0.1.0's symmetric,
single-threshold classification:

1. **Flapping.** The smoothed discount sat near the 60 bps `drift` threshold and
   oscillated across it, so the verdict flapped DRIFT → PEGGED → DRIFT (observed:
   84.7 bps → 48.8 bps within minutes). The engine's time-hysteresis
   (`transition.rs` confirm_up=30s / decay_down=120s, the Prometheus
   `for`/`keep_firing_for` analog) debounces brief spikes but cannot suppress a
   signal that genuinely oscillates *at* the boundary — that is what a
   Schmitt-trigger / magnitude deadband is for. The threshold had already been
   raised once (40 → 60 bps) and still flapped.
2. **Premium DRIFT.** `state_for_bps_discount` classifies on `|discount|`, so an
   LST *premium* (market > intrinsic) fired 🚨 DRIFT identically to a discount.
   For an LST a premium is demand pressure, not stress — holders always redeem at
   the intrinsic rate. The real risk signal is the *discount* (sellers outrunning
   arbitrage), cf. stETH −7% in 2022 and the ezETH depeg. Yield-bearing stables
   already carved the premium side out (`state_for_bps_discount_aware`); LSTs did
   not.

Both produce notifications that are *wrong* — noise that erodes the trust pitch.

## Decision

Ship methodology **0.2.0** with two classification changes, and **activate
immediately** under the ADR-0009 *critical-bug exception* ("a bug is CRITICAL —
causing wrong alerts to fire"). We classify the flapping + premium-DRIFT as that
bug class rather than as a routine "breaking change" (which would require the
7-day announcement + 7-day passive run). Rationale: the harm is live false
alerts during calibration; the fix only ever makes a verdict *less* alarmist
(holds a state through a dead zone; silences a benign premium), never more.

1. **Magnitude deadband** — `classify_with_hysteresis(class, discount,
   thresholds, current, deadband_pct)`. Escalation uses the normal threshold;
   relaxation toward a looser state only commits below `threshold ×
   (1 − deadband_pct)`. Engine default `DEADBAND_PCT = 25` (e.g. drift enters at
   60 bps, exits at 45). Applied to the BPS path; the committed state seeds it,
   and the existing time-hysteresis still runs on top.
2. **LST premium carve-out** — `is_direction_sensitive` += `AssetClass::Lst`;
   a premium normalizes to PEGGED. Discount-side classification unchanged.

Governance artifacts: CHANGELOG 0.2.0; migration 0041 inserts the 0.2.0 row
(`active`) and marks 0.1.0 `deprecated` / `superseded_by = 0.2.0`. v0.1.0 is
**deprecated, not broken** — its receipts stay valid and replayable, so the
ADR-0003 retraction protocol does NOT fire.

### Scope / non-goals

- The **CR path** (hyUSD) keeps its current logic — the deadband is BPS-path
  only for now.
- This is a one-off calibration-time correction; it does **not** repeal
  ADR-0009. Post-launch bumps still follow the cadence + the 06-11→06-25 lock.

## Consequences

- Verdicts change for some valid inputs → MINOR bump (replay stays deterministic
  via `methodology_git_sha`; the recorded version distinguishes 0.1.0 vs 0.2.0).
- An LST premium will now read PEGGED; if a premium ever needs surfacing it must
  be a separate informational signal, not DRIFT.
- The deadband introduces intentional "stickiness" (an asset stays in a stricter
  state slightly longer before relaxing) — the accepted trade-off for stability.
- Activating mid-calibration means the calibration record must note the
  0.1.0 → 0.2.0 switch on 2026-06-01.

## Cross-refs

- `crates/methodology/src/thresholds.rs` (`classify_with_hysteresis`,
  `is_direction_sensitive`), `crates/engine-rs/src/main.rs` (`DEADBAND_PCT`).
- ADR-0009 (bump cadence + critical-bug exception), ADR-0019 (why 0.1.0 stayed),
  ADR-0003 (retraction — deliberately NOT triggered here).
- `crates/methodology/CHANGELOG.md` § 0.2.0, migration `0041`.
