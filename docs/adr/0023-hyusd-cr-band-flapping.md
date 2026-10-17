# ADR-0023: Kill hyUSD CR-band flapping — CR-side magnitude deadband (methodology 0.3.0)

- **Status:** Accepted (2026-06-04)
- **Amends:** `05-methodology-crate.md` (classification), ADR-0009 (invokes its
  critical-bug exception). Completes the explicit non-goal ADR-0021 left open:
  "The CR path (hyUSD) keeps its current logic — the deadband is BPS-path only
  for now."

## Context

During the calibration window the engine emitted **hyUSD PEGGED↔DRIFT flapping**:
26 round-trips (52 transitions) over ~2 days (2026-06-02 → 06-04). Root cause —
the CR classification path (`engine main.rs`, `state_for_cr`) carried **neither**
mechanism the spread path already had: no EWMA smoothing of the input, and no
magnitude deadband (ADR-0021 added the latter to the BPS path only).

Measured over the window (`hylo_state_snapshots`, 9,955 ticks): hyUSD's
collateral ratio has **median 133.0%, σ ≈ 2.5pp**, and the `drift` threshold is
**130%** — i.e. drift sits at the CR's ~5th percentile. The CR "rests" at
131–135% and the oracle jitter (SOL-priced reserves) clips 130% on the downside
tail, so the verdict flapped. The engine's time-hysteresis (`transition.rs`
confirm_up=30s / decay_down=120s, the Prometheus `for`/`keep_firing_for` analog)
debounces brief spikes but cannot suppress a signal that oscillates *at* the
boundary — exactly the JupSOL situation ADR-0021 fixed for the spread path.

A replay of the real CR series under candidate fixes (time-hysteresis modelled
faithfully — the "no deadband" config reproduces the 52 observed transitions):

| strategy                | transitions | % time non-PEGGED |
|-------------------------|-------------|-------------------|
| current (raw CR)        | 52          | 2.9%              |
| EWMA(0.3) only          | 40          | 2.5%              |
| **deadband ~2% only**   | **10**      | ~19.6%            |
| EWMA + deadband         | 17          | 16%               |

EWMA alone barely helps (the jitter is low-frequency); EWMA + deadband is *worse*
than the deadband alone (the EWMA lag interacts badly). The deadband alone is the
fix.

## Decision

Ship methodology **0.3.0** with one classification change, **activated
immediately** under the ADR-0009 *critical-bug exception* ("a bug is CRITICAL —
causing wrong alerts to fire"), same precedent and rationale as ADR-0021: the
harm is live false alerts during calibration, and the fix only ever makes a
verdict *less* alarmist (holds DRIFT through a dead zone), never more.

- **CR magnitude deadband** — `classify_cr_with_hysteresis(cr, thresholds,
  current, deadband_pct)`, the CR analog of `classify_with_hysteresis` with the
  band **inverted** (for a collateral ratio a LOWER value is worse). Escalation
  uses the normal threshold (a dropping CR alarms immediately); relaxation toward
  a looser state only commits once CR rises above `threshold × (1 + deadband_pct)`
  via a new `raise_thresholds`. Engine default **`CR_DEADBAND_PCT = 2`** (drift
  enters at 130%, exits at ~132.6%). Wired into the hyUSD branch in place of the
  bare `state_for_cr`; the committed state seeds it and the existing
  time-hysteresis still runs on top.

Governance artifacts: CHANGELOG 0.3.0; migration `0044` inserts the 0.3.0 row
(`active`) and marks 0.2.0 `deprecated` / `superseded_by = 0.3.0`. v0.2.0 is
**deprecated, not broken** — its receipts stay valid and replayable, so the
ADR-0003 retraction protocol does NOT fire.

### Scope / non-goals

- **EWMA on the CR is explicitly rejected** (the replay above): it adds lag
  without killing the flapping. The deadband is the whole fix.
- The drift threshold (130%) is **not** moved here. Whether 130% is the right
  warning level for hyUSD (the CR rests only ~3pp above it) is a separate
  *risk* decision about the Hylo protocol, not a noise filter — out of scope.
- `CR_DEADBAND_PCT = 2` is the knee of the trade-off curve (≈80% flap reduction
  for ~20% DRIFT-time). It is a tunable constant, not a methodology-versioned
  threshold.
- Does **not** repeal ADR-0009; post-launch bumps still follow the cadence + the
  06-11 → 06-25 lock.

## Consequences

- Verdicts change for some valid hyUSD inputs → MINOR bump (replay stays
  deterministic via `methodology_git_sha`; the recorded version distinguishes
  0.2.0 vs 0.3.0).
- hyUSD now shows DRIFT in fewer, longer, *meaningful* episodes (~10 vs 52
  transitions over the window) instead of jitter flaps — better for the
  about-to-go-public feed and for the calibration false-positive quality bar.
- The deadband introduces intentional "stickiness" (hyUSD sits in DRIFT slightly
  longer before relaxing) — the accepted trade-off for stability, identical to
  ADR-0021's BPS-path stickiness.
- Activating mid-calibration means the calibration record must note the
  0.2.0 → 0.3.0 switch on 2026-06-04.

## Cross-refs

- `crates/methodology/src/thresholds.rs` (`classify_cr_with_hysteresis`,
  `raise_thresholds`), `crates/engine-rs/src/main.rs` (`CR_DEADBAND_PCT`).
- ADR-0021 (BPS-path deadband — this is its deferred CR follow-through),
  ADR-0009 (bump cadence + critical-bug exception), ADR-0003 (retraction —
  deliberately NOT triggered here).
- `crates/methodology/CHANGELOG.md` § 0.3.0, migration `0044`.
