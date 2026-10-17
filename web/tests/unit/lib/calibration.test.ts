import { describe, it, expect } from "vitest";
import { VERDICT_GATE, inCalibrationWindow } from "@/lib/calibration";

describe("VERDICT_GATE", () => {
  it("is pinned to 2026-06-11T00:00:00Z (ADR-0001)", () => {
    expect(VERDICT_GATE.toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });

  it("is a stable Date instance (no NaN)", () => {
    expect(Number.isNaN(VERDICT_GATE.getTime())).toBe(false);
  });
});

describe("inCalibrationWindow", () => {
  it("is true the day before the gate", () => {
    expect(inCalibrationWindow(new Date("2026-06-10T23:59:59Z"))).toBe(true);
  });

  it("is true a year before the gate", () => {
    expect(inCalibrationWindow(new Date("2025-06-11T00:00:00Z"))).toBe(true);
  });

  it("is false AT the gate exactly", () => {
    // The window is [-infinity, VERDICT_GATE), so equality flips to closed.
    expect(inCalibrationWindow(new Date("2026-06-11T00:00:00Z"))).toBe(false);
  });

  it("is false the second after the gate", () => {
    expect(inCalibrationWindow(new Date("2026-06-11T00:00:01Z"))).toBe(false);
  });

  it("is false a year after the gate", () => {
    expect(inCalibrationWindow(new Date("2027-06-11T00:00:00Z"))).toBe(false);
  });

  it("defaults to current time when called without args", () => {
    // We can't pin `new Date()` in this test, but the function must return a
    // boolean either way — calling it shouldn't throw or return undefined.
    expect(typeof inCalibrationWindow()).toBe("boolean");
  });
});
