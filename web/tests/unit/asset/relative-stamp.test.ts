import { describe, it, expect } from "vitest";
import { relativeStamp } from "@/lib/asset/relative-stamp";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("relativeStamp", () => {
  it("reads 'just now' under 10s", () => {
    expect(relativeStamp(at(0), NOW)).toBe("just now");
    expect(relativeStamp(at(5_000), NOW)).toBe("just now");
  });

  it("reads seconds in [10s, 60s)", () => {
    expect(relativeStamp(at(30_000), NOW)).toBe("30s ago");
    expect(relativeStamp(at(59_000), NOW)).toBe("59s ago");
  });

  it("coarsens to minutes in [1m, 1h)", () => {
    expect(relativeStamp(at(120_000), NOW)).toBe("2m ago");
    expect(relativeStamp(at(45 * 60_000), NOW)).toBe("45m ago");
  });

  it("coarsens to hours in [1h, 1d)", () => {
    expect(relativeStamp(at(2 * 3_600_000), NOW)).toBe("2h ago");
  });

  it("coarsens to days at >= 1d", () => {
    expect(relativeStamp(at(2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("returns undefined for an unparseable timestamp", () => {
    expect(relativeStamp("not-a-date", NOW)).toBeUndefined();
  });

  it("clamps a future timestamp to 'just now' (no negative ages)", () => {
    expect(relativeStamp(new Date(NOW + 60_000).toISOString(), NOW)).toBe(
      "just now",
    );
  });
});
