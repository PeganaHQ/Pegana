import { describe, it, expect } from "vitest";
import {
  STALE_AFTER_MS,
  ageMs,
  isStale,
  effectiveState,
} from "@/lib/asset/freshness";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");

describe("ageMs", () => {
  it("returns the positive age for a past timestamp", () => {
    const ts = new Date(NOW - 5_000).toISOString();
    expect(ageMs(ts, NOW)).toBe(5_000);
  });

  it("returns 0 for a timestamp exactly equal to now", () => {
    const ts = new Date(NOW).toISOString();
    expect(ageMs(ts, NOW)).toBe(0);
  });

  it("returns a negative age for a future timestamp (clock skew)", () => {
    const ts = new Date(NOW + 3_000).toISOString();
    expect(ageMs(ts, NOW)).toBe(-3_000);
  });

  it("returns null for null", () => {
    expect(ageMs(null, NOW)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(ageMs(undefined, NOW)).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(ageMs("not-a-date", NOW)).toBeNull();
  });
});

describe("isStale", () => {
  it("is false for a fresh snapshot inside the window", () => {
    const ts = new Date(NOW - 30_000).toISOString();
    expect(isStale(ts, NOW)).toBe(false);
  });

  it("is false exactly at the threshold (not strictly older)", () => {
    const ts = new Date(NOW - STALE_AFTER_MS).toISOString();
    expect(isStale(ts, NOW)).toBe(false);
  });

  it("is true just past the threshold", () => {
    const ts = new Date(NOW - STALE_AFTER_MS - 1).toISOString();
    expect(isStale(ts, NOW)).toBe(true);
  });

  it("is true for a clearly old snapshot", () => {
    // Beyond the 15-min server-aligned window (STALE_AFTER_MS).
    const ts = new Date(NOW - 20 * 60_000).toISOString();
    expect(isStale(ts, NOW)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const ts = new Date(NOW - 10_000).toISOString();
    expect(isStale(ts, NOW, 5_000)).toBe(true);
    expect(isStale(ts, NOW, 30_000)).toBe(false);
  });

  it("returns false for missing/unparseable timestamps (absence handled elsewhere)", () => {
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale(undefined, NOW)).toBe(false);
    expect(isStale("garbage", NOW)).toBe(false);
  });

  it("does not flag a future timestamp as stale", () => {
    const ts = new Date(NOW + 60_000).toISOString();
    expect(isStale(ts, NOW)).toBe(false);
  });
});

describe("effectiveState", () => {
  const FRESH = new Date(NOW - 30_000).toISOString();
  const STALE = new Date(NOW - (STALE_AFTER_MS + 60_000)).toISOString();

  it("prefers a fresh live frame's state over the REST snapshot", () => {
    expect(
      effectiveState(
        { state: "DEPEG", updated_at: FRESH },
        { state: "PEGGED", updated_at: FRESH },
        NOW,
      ),
    ).toBe("DEPEG");
  });

  it("degrades a KNOWN-stale live frame to UNKNOWN even when its state is DEPEG", () => {
    expect(
      effectiveState(
        { state: "DEPEG", updated_at: STALE },
        { state: "PEGGED", updated_at: STALE },
        NOW,
      ),
    ).toBe("UNKNOWN");
  });

  it("falls back to the REST timestamp when there is no live frame", () => {
    expect(
      effectiveState(undefined, { state: "DRIFT", updated_at: STALE }, NOW),
    ).toBe("UNKNOWN");
    expect(
      effectiveState(undefined, { state: "DRIFT", updated_at: FRESH }, NOW),
    ).toBe("DRIFT");
  });

  it("treats a missing timestamp as NOT stale (absence is not an age) — keeps the state", () => {
    expect(
      effectiveState(undefined, { state: "PEGGED", updated_at: null }, NOW),
    ).toBe("PEGGED");
    expect(effectiveState({ state: "DRIFT" }, { state: "PEGGED" }, NOW)).toBe(
      "DRIFT",
    );
  });

  it("falls back to UNKNOWN when neither a state nor a timestamp is present", () => {
    expect(effectiveState(undefined, {}, NOW)).toBe("UNKNOWN");
    expect(
      effectiveState(undefined, { state: null, updated_at: null }, NOW),
    ).toBe("UNKNOWN");
  });

  it("falls back to the REST state when the live frame lacks a state", () => {
    expect(
      effectiveState(
        { updated_at: FRESH },
        { state: "DEPEG", updated_at: FRESH },
        NOW,
      ),
    ).toBe("DEPEG");
  });

  it("respects a custom staleness threshold", () => {
    const ts = new Date(NOW - 10_000).toISOString();
    expect(
      effectiveState(
        { state: "DEPEG", updated_at: ts },
        { state: "PEGGED" },
        NOW,
        5_000,
      ),
    ).toBe("UNKNOWN");
    expect(
      effectiveState(
        { state: "DEPEG", updated_at: ts },
        { state: "PEGGED" },
        NOW,
        30_000,
      ),
    ).toBe("DEPEG");
  });
});
