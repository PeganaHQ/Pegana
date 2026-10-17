import type { CalibrationHealth } from "@/lib/api/types";

// Per-asset calibration self-monitor (GET /v1/calibration) — shared
// health -> {label, tone} map and worst-first sort, used by the full table on
// /status/calibration. Pure module (no hooks/DOM/CSS literals) so both are
// unit-testable in isolation, same convention as
// lib/asset/worst-sort.ts's STATE_SEVERITY/compareWorstFirst.

export type CalibrationHealthStatus = CalibrationHealth["health"];

export interface CalibrationHealthMeta {
  label: string;
  /** v2 token family this health reads as. Deliberately abstract (not a raw
   *  CSS var/hex) so this module stays framework-agnostic — the page maps
   *  each tone to the concrete `--v2-*` color, reusing the same peg/drift/
   *  crit/unk vocabulary as StatePillV2 (components/organisms/v2/shared.tsx)
   *  so a miscalibrated row reads with the same visual weight as a CRITICAL
   *  peg state. */
  tone: "peg" | "drift" | "crit" | "unk";
}

export const CALIBRATION_HEALTH_META: Record<
  CalibrationHealthStatus,
  CalibrationHealthMeta
> = {
  miscalibrated: { label: "Miscalibrated", tone: "crit" },
  watch: { label: "Watch", tone: "drift" },
  no_data: { label: "No data", tone: "unk" },
  na: { label: "N/A", tone: "unk" },
  ok: { label: "Ok", tone: "peg" },
};

/**
 * Worst-first severity ramp (lower = worse = sorts first): miscalibrated (the
 * watcher is provably wrong right now) outranks watch (drifting toward
 * wrong), which outranks the two "can't tell" states — no_data (window open,
 * genuinely empty) before na (check doesn't apply to this asset, one step
 * further from "something's wrong") — which outrank ok (bands hold).
 */
export const CALIBRATION_HEALTH_SEVERITY: Record<
  CalibrationHealthStatus,
  number
> = {
  miscalibrated: 0,
  watch: 1,
  no_data: 2,
  na: 3,
  ok: 4,
};

/**
 * Array.sort comparator: worst health first. Ties (equal severity) break
 * alphabetically by symbol so equal-severity rows render in a stable,
 * predictable order rather than whatever order the API happened to return.
 */
export function compareCalibrationWorstFirst(
  a: CalibrationHealth,
  b: CalibrationHealth,
): number {
  const sev =
    CALIBRATION_HEALTH_SEVERITY[a.health] -
    CALIBRATION_HEALTH_SEVERITY[b.health];
  if (sev !== 0) return sev;
  return a.symbol.localeCompare(b.symbol);
}

/**
 * Status column label. Prefers the API's self-describing `calibration`
 * field; falls back to the boolean `monitoring_only` for older/partial rows
 * that omit it (same fallback the API itself documents — `calibration` is
 * a self-describing form of `monitoring_only`).
 */
export function calibrationStatusLabel(
  c: Pick<CalibrationHealth, "calibration" | "monitoring_only">,
): "Provisional" | "Calibrated" {
  if (c.calibration === "calibrated") return "Calibrated";
  if (c.calibration === "provisional") return "Provisional";
  return c.monitoring_only ? "Provisional" : "Calibrated";
}
