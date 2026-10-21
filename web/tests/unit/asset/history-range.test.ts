import { describe, it, expect } from "vitest";
import {
  HISTORY_BEGINS_AT,
  HISTORY_BEGINS_MS,
  RANGE_PLAN,
  downsampleHistory,
  fetchHistoryRange,
  historyCoverageNote,
  type HistoryFetcher,
} from "@/lib/asset/history-range";
import type { HistoryPoint, PegState } from "@/lib/api/types";

const MIN = 60_000;
const NOW = Date.parse("2026-11-30T12:00:00Z");

/** A fake /history that holds one row per minute back to `oldestMs`, newest
 *  first, honouring from / to / limit like the API. */
function fakeApi(oldestMs: number, state: PegState = "PEGGED") {
  const calls: Array<{ from: string; to?: string; limit: number }> = [];
  const fetcher: HistoryFetcher = async (_sym, o) => {
    calls.push({ from: o.from, to: o.to, limit: o.limit });
    const fromMs = Math.max(Date.parse(o.from), oldestMs);
    let t = Math.floor((o.to ? Date.parse(o.to) : NOW) / MIN) * MIN;
    const rows: HistoryPoint[] = [];
    while (t >= fromMs && rows.length < o.limit) {
      rows.push({ ts: new Date(t).toISOString(), discount: "0.001", state });
      t -= MIN;
    }
    return rows;
  };
  return { fetcher, calls };
}

describe("fetchHistoryRange", () => {
  it("7D pages back with `to` until the range start, not one 2000-row page", async () => {
    const { fetcher, calls } = fakeApi(0);
    const r = await fetchHistoryRange("INF", "7d", fetcher, { nowMs: NOW });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.limit === 5000)).toBe(true);
    expect(calls[0].to).toBeUndefined();
    expect(calls[1].to).toBeDefined();
    expect(r.truncated).toBe(false);
    // Averaged to 5-minute buckets covering the whole week.
    const oldest = Date.parse(r.points[r.points.length - 1].ts);
    const newest = Date.parse(r.points[0].ts);
    expect(newest - oldest).toBeGreaterThan(6.9 * 24 * 60 * MIN);
    expect(r.points.length).toBeLessThanOrEqual(7 * 24 * 12 + 1);
  });

  it("7D and 30D load different spans", async () => {
    const a = await fetchHistoryRange("X", "7d", fakeApi(0).fetcher, { nowMs: NOW });
    const b = await fetchHistoryRange("X", "30d", fakeApi(0).fetcher, { nowMs: NOW });
    const span = (r: typeof a) =>
      Date.parse(r.points[0].ts) - Date.parse(r.points[r.points.length - 1].ts);
    expect(span(b)).toBeGreaterThan(span(a) * 4);
    expect(RANGE_PLAN["30d"].stepSec).toBe(3600);
  });

  it("stops at the first short page when history is shorter than the range", async () => {
    const oldest = NOW - 3 * 24 * 60 * MIN;
    const { fetcher, calls } = fakeApi(oldest);
    const r = await fetchHistoryRange("X", "30d", fetcher, { nowMs: NOW });
    expect(calls).toHaveLength(1);
    expect(r.truncated).toBe(false);
  });

  it("flags a page cap that stopped short of the range start", async () => {
    const { fetcher, calls } = fakeApi(0);
    const r = await fetchHistoryRange("X", "30d", fetcher, {
      nowMs: NOW,
      maxPages: 3,
    });
    expect(calls).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("keeps the short ranges to one call with their own bucket", async () => {
    const one = fakeApi(0);
    await fetchHistoryRange("X", "1h", one.fetcher, { nowMs: NOW });
    expect(one.calls).toHaveLength(1);
    const day = fakeApi(0);
    const r = await fetchHistoryRange("X", "24h", day.fetcher, { nowMs: NOW });
    expect(day.calls).toHaveLength(1);
    expect(r.points.length).toBe(1441);
  });
});

describe("downsampleHistory", () => {
  it("averages the discount and keeps the worst state in each bucket", () => {
    const base = Date.parse("2026-10-21T10:00:00Z");
    const pts: HistoryPoint[] = [
      { ts: new Date(base).toISOString(), discount: "0.001", state: "PEGGED" },
      { ts: new Date(base + MIN).toISOString(), discount: "0.003", state: "DRIFT" },
      { ts: new Date(base + 2 * MIN).toISOString(), discount: "5", state: "PEGGED" },
      { ts: new Date(base + 6 * MIN).toISOString(), discount: "0.002", state: "PEGGED" },
    ];
    const out = downsampleHistory(pts, 300);
    expect(out).toHaveLength(2);
    // Newest first.
    expect(out[0].ts).toBe(new Date(base + 5 * MIN).toISOString());
    expect(parseFloat(out[1].discount)).toBeCloseTo(0.002, 9);
    expect(out[1].state).toBe("DRIFT");
  });
});

describe("historyCoverageNote", () => {
  const pts = (fromMs: number) => [{ ts: new Date(fromMs).toISOString() }];

  it("is null when the data covers the range", () => {
    const from = Date.parse("2026-10-20T12:00:00Z");
    expect(historyCoverageNote(pts(from + 30 * MIN), from)).toBeNull();
  });

  it("names where the data starts and the history start for ranges before it", () => {
    const from = HISTORY_BEGINS_MS - 10 * 24 * 60 * MIN;
    const note = historyCoverageNote(pts(HISTORY_BEGINS_MS), from);
    expect(note).toBe(
      "Showing data from 2026-10-17 09:20 UTC. Pegana's stored history begins 2026-10-17 09:20 UTC.",
    );
    expect(HISTORY_BEGINS_AT).toBe("2026-10-17T09:20:00Z");
  });

  it("does not blame the history start for a range that begins after it", () => {
    const from = HISTORY_BEGINS_MS + 24 * 60 * MIN;
    const note = historyCoverageNote(pts(from + 2 * 24 * 60 * MIN), from);
    expect(note).toBe("Showing data from 2026-10-20 09:20 UTC.");
  });

  it("says when a page cap left older data unloaded", () => {
    const from = HISTORY_BEGINS_MS + 24 * 60 * MIN;
    const note = historyCoverageNote(pts(from + 5 * 24 * 60 * MIN), from, true);
    expect(note).toMatch(/Older data in this range was not loaded\.$/);
  });

  it("explains an empty range that predates the history", () => {
    expect(historyCoverageNote([], HISTORY_BEGINS_MS - MIN)).toMatch(
      /^No data in this range\. Pegana's stored history begins/,
    );
  });

  it("contains no em-dash", () => {
    const note = historyCoverageNote(pts(HISTORY_BEGINS_MS), 0) ?? "";
    expect(note).not.toContain("\u2014");
  });
});

