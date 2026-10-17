import { describe, it, expect } from "vitest";
import {
  stateBadgeClass,
  stateTextClass,
  severityTextClass,
} from "@/lib/state-class";

describe("state-class helpers", () => {
  it("maps badge classes with UNKNOWN fallback", () => {
    expect(stateBadgeClass("PEGGED")).toContain("text-st-pegged");
    expect(stateBadgeClass("garbage")).toContain("text-text-muted");
  });

  it("maps text classes with UNKNOWN fallback", () => {
    expect(stateTextClass("DRIFT")).toBe("text-st-drift");
    expect(stateTextClass("garbage")).toBe("text-text-muted");
  });

  // severityTextClass: colors a SPREAD value off the engine state so the number
  // can never contradict its own state pip. PEGGED must read NEUTRAL (not green)
  // — matching the dashboard table + asset hero — so a within-band LST like
  // INF at −1.20% PEGGED no longer renders amber next to a green pip.
  // DEPEG/CRITICAL/BLACK_SWAN collapse to a single severity color.
  it("severityTextClass colors STATE-bound values — PEGGED neutral, severities by class (AA text tokens). Spread numbers are sign-driven, see spread-sign-color.test.ts", () => {
    expect(severityTextClass("PEGGED")).toBe("text-text");
    expect(severityTextClass("DRIFT")).toBe("text-st-drift");
    // DEPEG/CRITICAL use the WCAG-AA *-text variants, not the saturated pip hue.
    expect(severityTextClass("DEPEG")).toBe("text-st-depeg-text");
    expect(severityTextClass("CRITICAL")).toBe("text-st-critical-text");
    expect(severityTextClass("BLACK_SWAN")).toBe("text-st-critical-text");
    expect(severityTextClass("UNKNOWN")).toBe("text-text-muted");
    expect(severityTextClass("garbage")).toBe("text-text-muted");
  });
});
