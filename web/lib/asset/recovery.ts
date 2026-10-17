import type {
  AlertRow,
  AssetCardData,
  HistoryPoint,
  PegState,
} from "@/lib/api/types";
import {
  isDeprecated,
  isPlausibleDiscount,
  reconcileBps,
} from "@/lib/api/format";

// "What we think happens next" scoring — combined signal from real data:
//   - time-pegged 7d (from history)
//   - state flips 7d (from alerts)
//   - peer spread range (from the peers list)
//   - recovery p50 (from prior depeg recoveries)
//
// Extracted from the component so the rubric is unit-testable. The cardinal
// rule (mirrors the Status-page fix): an ABSENT alert stream is MISSING data,
// never a confirmation of stability — it must not bank the full flips credit.

export type RecoveryGrade = "A" | "B" | "C" | "D";

export interface RecoveryBreakdown {
  /** 0–50 — share of the window spent PEGGED (neutral 30 when unknown). */
  pegCredit: number;
  /** 0–25 — graduated by observed flips; neutral 15 when no alert signal. */
  flipsCredit: number;
  /** 0–25 — peer convergence (neutral 15 when no peers). */
  peerCredit: number;
}

export interface RecoveryComputed {
  pegPct: number | null;
  flips: number;
  peerSpreadBps: number | null;
  recoveryP50Min: number | null;
  score: number;
  grade: RecoveryGrade;
  breakdown: RecoveryBreakdown;
  /** True when there is no alert signal to reason about recovery (e.g. the
   *  calibration window): the flips dimension is scored neutral, and the UI
   *  surfaces a "calibrating" chip so the grade isn't read as a confirmed verdict. */
  calibrating: boolean;
  /** True when the asset's LIVE engine state is itself an active depeg/stress
   *  (DEPEG/CRITICAL/BLACK_SWAN). The grade is capped and the absolute
   *  "no leading indicators of stress" copy is suppressed — the H1/H9 rule:
   *  a confirmed stress state must never read as a clean recovery verdict. */
  stressed: boolean;
}

/** States that mean the asset is, right now, off-peg / under stress. A live
 *  reading of one of these must dominate any historical recovery optimism. */
const STRESS_STATES: ReadonlySet<PegState> = new Set<PegState>([
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
]);

/** Hard ceiling on the grade when the live state is an active stress event —
 *  a DEPEG asset can never grade A/B regardless of its historical rubric. */
const STRESS_GRADE_CAP: RecoveryGrade = "C";

function capGrade(grade: RecoveryGrade, cap: RecoveryGrade): RecoveryGrade {
  const order: RecoveryGrade[] = ["A", "B", "C", "D"];
  return order.indexOf(grade) >= order.indexOf(cap) ? grade : cap;
}

/** Neutral credit for the flips dimension when no alert signal exists — the
 *  same ~0.6 ratio the peg/peer dimensions use for "unknown" (15/25). */
const FLIPS_NEUTRAL_CREDIT = 15;

export function gradeFor(score: number): RecoveryGrade {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function computeRecoveryConfidence(
  asset: AssetCardData,
  history: HistoryPoint[] | undefined,
  alerts: AlertRow[] | undefined,
  peers: AssetCardData[] | undefined,
): RecoveryComputed {
  // time-pegged %
  let pegPct: number | null = null;
  if (history && history.length > 0) {
    let inPeg = 0;
    let kept = 0;
    for (const p of history) {
      if (!isPlausibleDiscount(p.discount)) continue;
      kept += 1;
      if (p.state === "PEGGED") inPeg += 1;
    }
    if (kept > 0) pegPct = inPeg / kept;
  }

  // Do we actually have an alert signal to reason about? An empty or missing
  // stream is the calibration / no-data case — NOT a confirmed-stable asset.
  const hasAlertSignal = alerts != null && alerts.length > 0;
  const flips = alerts?.length ?? 0;

  // peer spread range — max(|bps|) across peers of the same class.
  let peerSpreadBps: number | null = null;
  if (peers && peers.length > 0) {
    const sameClass = peers.filter(
      (p) =>
        p.class === asset.class &&
        p.symbol !== asset.symbol &&
        !isDeprecated(p.symbol),
    );
    if (sameClass.length > 0) {
      const bpsVals = sameClass
        .map((p) => Math.abs(reconcileBps(p).bps ?? 0))
        .filter((v) => Number.isFinite(v));
      if (bpsVals.length > 0) peerSpreadBps = Math.max(...bpsVals);
    }
  }

  // Recovery p50 — pair consecutive alerts (out-of-band → back to PEGGED).
  let recoveryP50Min: number | null = null;
  if (alerts && alerts.length > 0) {
    const chrono = alerts.slice().reverse();
    const recoveries: number[] = [];
    let outAt: number | null = null;
    for (const a of chrono) {
      if (a.to_state !== "PEGGED" && outAt == null) {
        outAt = new Date(a.detected_at).getTime();
      } else if (a.to_state === "PEGGED" && outAt != null) {
        recoveries.push((new Date(a.detected_at).getTime() - outAt) / 60_000);
        outAt = null;
      }
    }
    if (recoveries.length > 0) {
      recoveries.sort((a, b) => a - b);
      recoveryP50Min = recoveries[Math.floor(recoveries.length / 2)];
    }
  }

  // Score — additive on a 100-pt scale, exposed as a breakdown.
  const pegCredit = pegPct != null ? Math.round(50 * pegPct) : 30;
  // flips (max 25): only earn the graduated credit when we HAVE alert data;
  // otherwise neutral — an empty stream can't confirm stability.
  const flipsCredit = !hasAlertSignal
    ? FLIPS_NEUTRAL_CREDIT
    : flips <= 3
      ? 15
      : flips <= 10
        ? 5
        : 0;
  const peerCredit =
    peerSpreadBps == null
      ? 15
      : peerSpreadBps < 30
        ? 25
        : peerSpreadBps < 100
          ? 15
          : 0;
  const score = pegCredit + flipsCredit + peerCredit;

  // Live-state override: an asset that is RIGHT NOW in DEPEG/CRITICAL/BLACK_SWAN
  // must not grade A/B off a historically-pegged window. Cap the grade so the
  // editorial copy can't claim a clean recovery, and flag it so the absolute
  // "no leading indicators of stress" clause is suppressed.
  const stressed = STRESS_STATES.has(asset.state ?? "UNKNOWN");
  const rawGrade = gradeFor(score);
  const grade = stressed ? capGrade(rawGrade, STRESS_GRADE_CAP) : rawGrade;

  return {
    pegPct,
    flips,
    peerSpreadBps,
    recoveryP50Min,
    score,
    grade,
    breakdown: { pegCredit, flipsCredit, peerCredit },
    calibrating: !hasAlertSignal,
    stressed,
  };
}
