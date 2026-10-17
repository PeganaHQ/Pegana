import { describe, it, expect } from "vitest";
import { isForexWeekend, isFxClass } from "@/lib/asset/forex";

// Reference week (verified against prod): 2026-06-12 = Friday, 2026-06-13 =
// Saturday, 2026-06-14 = Sunday, 2026-06-15 = Monday, 2026-06-10 = Wednesday.
// The forex-closed window is Fri 20:30 UTC → Sun 22:30 UTC (DST-buffered to
// match the backend calibration-watch exemption); during it the Pyth FX feed
// is dark and an FX asset legitimately freezes.

describe("isForexWeekend — forex-closed window in UTC (Fri 20:30 → Sun 22:30)", () => {
  it("is closed all day Saturday", () => {
    expect(isForexWeekend(new Date("2026-06-13T00:00:00Z"))).toBe(true);
    expect(isForexWeekend(new Date("2026-06-13T12:00:00Z"))).toBe(true);
    expect(isForexWeekend(new Date("2026-06-13T23:59:00Z"))).toBe(true);
  });

  it("is closed Friday from 20:30 UTC onward, open before", () => {
    expect(isForexWeekend(new Date("2026-06-12T18:00:00Z"))).toBe(false);
    expect(isForexWeekend(new Date("2026-06-12T20:29:00Z"))).toBe(false);
    expect(isForexWeekend(new Date("2026-06-12T20:30:00Z"))).toBe(true); // boundary >=
    expect(isForexWeekend(new Date("2026-06-12T23:00:00Z"))).toBe(true);
  });

  it("is closed Sunday before 22:30 UTC, open after (forex reopens)", () => {
    expect(isForexWeekend(new Date("2026-06-14T12:00:00Z"))).toBe(true);
    expect(isForexWeekend(new Date("2026-06-14T21:00:00Z"))).toBe(true); // EURC still dark
    expect(isForexWeekend(new Date("2026-06-14T22:29:00Z"))).toBe(true);
    expect(isForexWeekend(new Date("2026-06-14T22:30:00Z"))).toBe(false); // boundary <
    expect(isForexWeekend(new Date("2026-06-14T23:00:00Z"))).toBe(false); // EURC resumed
  });

  it("is open on every weekday (full week coverage — guards against a dow off-by-one)", () => {
    expect(isForexWeekend(new Date("2026-06-15T12:00:00Z"))).toBe(false); // Mon
    expect(isForexWeekend(new Date("2026-06-15T03:00:00Z"))).toBe(false); // Mon early
    expect(isForexWeekend(new Date("2026-06-09T12:00:00Z"))).toBe(false); // Tue
    expect(isForexWeekend(new Date("2026-06-10T12:00:00Z"))).toBe(false); // Wed
    expect(isForexWeekend(new Date("2026-06-11T12:00:00Z"))).toBe(false); // Thu
    expect(isForexWeekend(new Date("2026-06-11T23:30:00Z"))).toBe(false); // Thu late — must NOT be treated as Fri-evening
  });
});

describe("isFxClass — only stable_fx assets track a (weekend-closing) FX rate", () => {
  it("is true only for stable_fx", () => {
    expect(isFxClass("stable_fx")).toBe(true);
  });
  it("is false for every other class and for absent values", () => {
    for (const c of [
      "stable_fiat",
      "lst",
      "stable_yield",
      "stable_cdp",
      "stable_rwa",
      "synth_lev",
      "",
    ]) {
      expect(isFxClass(c)).toBe(false);
    }
    expect(isFxClass(null)).toBe(false);
    expect(isFxClass(undefined)).toBe(false);
  });
});
