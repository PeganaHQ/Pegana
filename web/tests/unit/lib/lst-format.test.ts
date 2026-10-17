import { describe, expect, it } from "vitest";
import { formatApyPct, formatCompactUsd, formatRate } from "@/lib/lst/format";

describe("formatCompactUsd", () => {
  it("formats billions/millions/thousands", () => {
    expect(formatCompactUsd(1_500_000_000)).toBe("$1.50B");
    expect(formatCompactUsd(784_202_863)).toBe("$784.20M");
    expect(formatCompactUsd(45_990)).toBe("$46.0K");
    expect(formatCompactUsd(120)).toBe("$120.00");
  });

  it("returns - for null/NaN, never a fabricated $0", () => {
    expect(formatCompactUsd(null)).toBe("-");
    expect(formatCompactUsd(Number.NaN)).toBe("-");
  });
});

describe("formatApyPct", () => {
  it("converts a decimal fraction to a friendly percentage", () => {
    expect(formatApyPct(0.0499)).toBe("4.99%");
  });

  it("returns - for null", () => {
    expect(formatApyPct(null)).toBe("-");
  });
});

describe("formatRate", () => {
  it("formats a SOL/LST rate", () => {
    expect(formatRate(1.2261)).toBe("1.2261 SOL/LST");
  });

  it("returns null (not a dash) so callers can omit the secondary line", () => {
    expect(formatRate(null)).toBeNull();
  });
});
