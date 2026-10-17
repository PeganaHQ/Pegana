import { describe, it, expect } from "vitest";
import {
  RELIABILITY_LOG,
  LAUNCH_DATE,
  daysSince,
  sortByDateDesc,
  userFacingCount,
} from "@/lib/reliability/incidents";

describe("daysSince — whole days between an ISO date and now", () => {
  it("floors the elapsed days (UTC)", () => {
    expect(daysSince("2026-06-11", Date.parse("2026-06-13T12:00:00Z"))).toBe(2);
    expect(daysSince("2026-06-11", Date.parse("2026-06-11T23:59:00Z"))).toBe(0);
  });
  it("never returns negative for a future date", () => {
    expect(daysSince("2026-06-20", Date.parse("2026-06-13T00:00:00Z"))).toBe(0);
  });
  it("returns 0 for an unparseable date", () => {
    expect(daysSince("not-a-date", Date.parse("2026-06-13T00:00:00Z"))).toBe(0);
  });
});

describe("sortByDateDesc — newest first", () => {
  it("orders entries by date descending without mutating the input", () => {
    const input = [
      { date: "2026-06-11" },
      { date: "2026-06-13" },
      { date: "2026-06-12" },
    ] as Parameters<typeof sortByDateDesc>[0];
    const out = sortByDateDesc(input);
    expect(out.map((e) => e.date)).toEqual([
      "2026-06-13",
      "2026-06-12",
      "2026-06-11",
    ]);
    expect(input.map((e) => e.date)).toEqual([
      "2026-06-11",
      "2026-06-13",
      "2026-06-12",
    ]);
  });
});

describe("userFacingCount — the honest headline metric", () => {
  it("counts only entries that actually reached users (degraded/outage), not internal catches", () => {
    // The 2026-06-14 freeze-detector false-alarm on public JupSOL is a real
    // user-facing degradation; the JupUSD + egress-gap entries were caught
    // internally (userImpact: none).
    const expected = RELIABILITY_LOG.filter(
      (e) => e.userImpact !== "none",
    ).length;
    expect(userFacingCount(RELIABILITY_LOG)).toBe(expected);
    expect(userFacingCount(RELIABILITY_LOG)).toBe(1);
  });
});

describe("RELIABILITY_LOG — published post-mortems", () => {
  it("has the launch date and at least the two 2026-06-12 internal catches", () => {
    expect(LAUNCH_DATE).toBe("2026-06-11");
    expect(RELIABILITY_LOG.length).toBeGreaterThanOrEqual(2);
    // Every published entry must carry the full blameless post-mortem fields.
    for (const e of RELIABILITY_LOG) {
      expect(e.summary).toBeTruthy();
      expect(e.detection).toBeTruthy();
      expect(e.rootCause).toBeTruthy();
      expect(e.resolution).toBeTruthy();
      expect(["none", "degraded", "outage"]).toContain(e.userImpact);
    }
  });
});
