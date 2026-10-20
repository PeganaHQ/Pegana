import { describe, expect, it } from "vitest";
import {
  GLASS_LEAD_PX,
  GLASS_RANGE_PX,
  HERO_LEAD_PX,
  HERO_RANGE_PX,
  glassProgress,
  quantizeProgress,
} from "@/lib/landing/nav-glass";

describe("glassProgress (board top edge)", () => {
  const navBottom = 80;
  it("stays at the light start state until the board is within the lead", () => {
    expect(glassProgress(navBottom + GLASS_LEAD_PX, navBottom)).toBe(0);
    expect(glassProgress(1200, navBottom)).toBe(0);
  });
  it("is frosted (1) once the board top reaches the nav bottom, and beyond", () => {
    expect(glassProgress(navBottom + GLASS_LEAD_PX - GLASS_RANGE_PX, navBottom)).toBe(1);
    expect(glassProgress(-300, navBottom)).toBe(1);
  });
  it("ramps linearly over 120px", () => {
    expect(glassProgress(navBottom + 60, navBottom)).toBeCloseTo(0.5, 6);
    expect(glassProgress(navBottom + 30, navBottom)).toBeCloseTo(0.75, 6);
  });
  it("hero fallback keeps the wider ramp", () => {
    expect(glassProgress(navBottom + 200, navBottom, HERO_RANGE_PX, HERO_LEAD_PX)).toBeCloseTo(0.5, 6);
  });
  it("quantizes to the endpoints for reduced motion", () => {
    expect(quantizeProgress(0.49)).toBe(0);
    expect(quantizeProgress(0.5)).toBe(1);
  });
});
