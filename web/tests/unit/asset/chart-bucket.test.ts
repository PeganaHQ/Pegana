import { describe, it, expect, beforeEach } from "vitest";
import {
  BUCKET_RANGE_MS,
  CHART_BUCKET_STORAGE_KEY,
  loadedRangeForBucket,
  readPersistedBucket,
  scrubHalfWidthSeconds,
} from "@/lib/asset/chart-bucket";

// This jsdom install doesn't ship a working Storage implementation
// (window.localStorage exists but its methods are missing) — same reason
// `usePersistedMode` wraps every access in try/catch. Swap in a minimal
// working in-memory shim so the persisted-value branches are actually
// exercised, not just the "unavailable → fallback" catch path.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

describe("loadedRangeForBucket — the timeline scrub boundary check", () => {
  it("returns the [now - bucket, now] window in whole seconds", () => {
    const now = Date.parse("2026-07-10T12:00:00Z");
    expect(loadedRangeForBucket("24h", now)).toEqual({
      minSec: Math.floor(now / 1000) - 24 * 3600,
      maxSec: Math.floor(now / 1000),
    });
  });

  it("scales with the bucket (30d loads a much wider window than 1h)", () => {
    const now = Date.parse("2026-07-10T12:00:00Z");
    const oneHour = loadedRangeForBucket("1h", now);
    const thirtyDays = loadedRangeForBucket("30d", now);
    expect(thirtyDays.maxSec).toBe(oneHour.maxSec);
    expect(thirtyDays.minSec).toBeLessThan(oneHour.minSec);
  });
});

describe("scrubHalfWidthSeconds — the ±window a scrub opens", () => {
  it("matches the spec's ±6h example for the 24h bucket", () => {
    expect(scrubHalfWidthSeconds("24h")).toBe(6 * 3600);
  });

  it("is a quarter of the bucket's total span for every bucket", () => {
    for (const bucket of ["1h", "24h", "7d", "30d"] as const) {
      expect(scrubHalfWidthSeconds(bucket)).toBe(
        Math.round(BUCKET_RANGE_MS[bucket] / 1000 / 4),
      );
    }
  });
});

describe("readPersistedBucket — best-effort peek without mounting the chart", () => {
  beforeEach(() => {
    installLocalStorageShim();
  });

  it("falls back to the chart's own default when nothing is persisted", () => {
    expect(readPersistedBucket()).toBe("24h");
  });

  it("reads back whatever the chart last persisted", () => {
    window.localStorage.setItem(CHART_BUCKET_STORAGE_KEY, "7d");
    expect(readPersistedBucket()).toBe("7d");
  });

  it("falls back on an invalid/stale stored value", () => {
    window.localStorage.setItem(CHART_BUCKET_STORAGE_KEY, "3y");
    expect(readPersistedBucket()).toBe("24h");
  });
});
