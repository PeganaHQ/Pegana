import { describe, it, expect } from "vitest";
import {
  CALIBRATION_HEALTH_META,
  CALIBRATION_HEALTH_SEVERITY,
  compareCalibrationWorstFirst,
  calibrationStatusLabel,
  type CalibrationHealthStatus,
} from "@/lib/asset/calibration-health";
import type { CalibrationHealth } from "@/lib/api/types";

function row(
  symbol: string,
  health: CalibrationHealthStatus,
  extra: Partial<CalibrationHealth> = {},
): CalibrationHealth {
  return { symbol, monitoring_only: false, health, ...extra };
}

describe("CALIBRATION_HEALTH_META", () => {
  it("labels every health value distinctly", () => {
    expect(CALIBRATION_HEALTH_META.miscalibrated.label).toBe("Miscalibrated");
    expect(CALIBRATION_HEALTH_META.watch.label).toBe("Watch");
    expect(CALIBRATION_HEALTH_META.no_data.label).toBe("No data");
    expect(CALIBRATION_HEALTH_META.na.label).toBe("N/A");
    expect(CALIBRATION_HEALTH_META.ok.label).toBe("Ok");
  });

  it("assigns the critical tone to miscalibrated and the peg tone to ok", () => {
    expect(CALIBRATION_HEALTH_META.miscalibrated.tone).toBe("crit");
    expect(CALIBRATION_HEALTH_META.ok.tone).toBe("peg");
  });

  it("assigns the drift (amber) tone to watch", () => {
    expect(CALIBRATION_HEALTH_META.watch.tone).toBe("drift");
  });

  it("groups no_data and na under the unknown/muted tone (neither confirms nor denies)", () => {
    expect(CALIBRATION_HEALTH_META.no_data.tone).toBe("unk");
    expect(CALIBRATION_HEALTH_META.na.tone).toBe("unk");
  });
});

describe("compareCalibrationWorstFirst", () => {
  it("sorts miscalibrated -> watch -> no_data -> na -> ok, regardless of input order", () => {
    const rows = [
      row("Z_OK", "ok"),
      row("A_NA", "na"),
      row("M_MISC", "miscalibrated"),
      row("N_NODATA", "no_data"),
      row("W_WATCH", "watch"),
    ];
    const sorted = [...rows].sort(compareCalibrationWorstFirst);
    expect(sorted.map((r) => r.health)).toEqual([
      "miscalibrated",
      "watch",
      "no_data",
      "na",
      "ok",
    ]);
  });

  it("tie-breaks equal-severity rows alphabetically by symbol", () => {
    const rows = [
      row("ZZZ", "watch"),
      row("AAA", "watch"),
      row("MMM", "watch"),
    ];
    const sorted = [...rows].sort(compareCalibrationWorstFirst);
    expect(sorted.map((r) => r.symbol)).toEqual(["AAA", "MMM", "ZZZ"]);
  });

  it("is stable/idempotent — sorting an already-sorted array is a no-op", () => {
    const rows = [
      row("A", "miscalibrated"),
      row("B", "watch"),
      row("C", "no_data"),
      row("D", "na"),
      row("E", "ok"),
    ];
    const sorted = [...rows].sort(compareCalibrationWorstFirst);
    expect(sorted.map((r) => r.symbol)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("covers every health value in the severity ramp with a distinct rank", () => {
    const ranks = Object.values(CALIBRATION_HEALTH_SEVERITY);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("calibrationStatusLabel", () => {
  it("prefers the explicit `calibration` field when present, even over a conflicting monitoring_only", () => {
    expect(
      calibrationStatusLabel(
        row("X", "ok", { calibration: "calibrated", monitoring_only: true }),
      ),
    ).toBe("Calibrated");
    expect(
      calibrationStatusLabel(
        row("X", "ok", { calibration: "provisional", monitoring_only: false }),
      ),
    ).toBe("Provisional");
  });

  it("falls back to monitoring_only when `calibration` is omitted", () => {
    expect(
      calibrationStatusLabel(row("X", "ok", { monitoring_only: true })),
    ).toBe("Provisional");
    expect(
      calibrationStatusLabel(row("X", "ok", { monitoring_only: false })),
    ).toBe("Calibrated");
  });
});
