// Trust-Layer v0.1.0 / calibration window constants.
//
// Single source of truth for the verdict gate date. Imported by
// CalibrationBanner and any page that needs to branch on the calibration
// window (audit index empty state, future trust-strip toggles).
//
// Date rationale: ADR-0015 (per-class verdict rule, supersedes ADR-0001) +
// ADR-0005 (early-evidence-rollout) — the engine ships evidence rows starting
// 2026-06-01 with FEATURE_PUBLIC_ALERTS=false, and the public surface
// flips on 2026-06-11.

export const VERDICT_GATE = new Date("2026-06-11T00:00:00Z");

export function inCalibrationWindow(now: Date = new Date()): boolean {
  return now < VERDICT_GATE;
}
