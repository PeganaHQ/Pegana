import { describe, it, expect, vi } from "vitest";
import { fetchHistory30d } from "@/lib/hooks/use-history-30d";
import type { HistoryPoint } from "@/lib/api/types";

// Helper to build synthetic rows with descending timestamps.
// `baseMs` is the "newest" ms timestamp in the window; rows count back by 1
// minute each so the last row is the oldest — mirrors the real API response.
function makeRows(count: number, newestMs: number): HistoryPoint[] {
  const rows: HistoryPoint[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      ts: new Date(newestMs - i * 60_000).toISOString(),
      discount: "0",
      state: "PEGGED",
    });
  }
  return rows;
}

describe("fetchHistory30d", () => {
  it("merges rows from multiple windows and stops on empty response", async () => {
    // Window 1: 5 rows
    const now = Date.now();
    const window1 = makeRows(5, now);
    // Window 2: 3 rows (older than window 1)
    const oldestInW1 = Date.parse(window1[window1.length - 1].ts);
    const window2 = makeRows(3, oldestInW1 - 1000);
    // Window 3: empty → stop
    const callCount = { n: 0 };

    const mockApiFn = vi.fn(async () => {
      const call = callCount.n++;
      if (call === 0) return window1;
      if (call === 1) return window2;
      return [] as HistoryPoint[];
    });

    const result = await fetchHistory30d("USDC", mockApiFn);

    // Should have called the API exactly 3 times (2 non-empty + 1 empty).
    expect(mockApiFn).toHaveBeenCalledTimes(3);
    // All rows from both windows should be in the result.
    expect(result).toHaveLength(5 + 3);
    // All rows from window1 present.
    for (const r of window1) expect(result).toContainEqual(r);
    // All rows from window2 present.
    for (const r of window2) expect(result).toContainEqual(r);
  });

  it("never exceeds MAX_WINDOWS calls even when the mock always returns rows", async () => {
    // Always return 2 rows so the loop never hits the empty-response break.
    // The rows must have ts values recent enough to not hit the 30-day cutoff,
    // but to avoid the 30-day-cutoff break we use very recent timestamps and
    // rely solely on the MAX_WINDOWS cap (10).
    const mockApiFn = vi.fn(async (_sym: string, opts: { from: string }) => {
      // Return rows whose oldest ts is just 1 minute before the window end
      // so windowTo keeps moving backward slowly — we'll hit MAX_WINDOWS (10).
      const windowTo = new Date(opts.from).getTime() + 5000 * 60_000;
      return makeRows(2, windowTo - 60_000);
    });

    await fetchHistory30d("USDC", mockApiFn);

    // Should have stopped at MAX_WINDOWS = 10.
    expect(mockApiFn).toHaveBeenCalledTimes(10);
  });

  it("stops early when windowFrom is older than the 30-day cutoff", async () => {
    // Simulate an asset whose data spans more than one WINDOW_MS (~3.47 days).
    // After window1 is fetched, the computed windowTo for window2 will be
    // older than 31 days. The fetcher's cutoff check fires AFTER fetching each
    // window (it checks the CURRENT window's `windowFrom`).
    //
    // Timeline:
    //   window1: windowTo = now, windowFrom = now - 3.47d (inside 30d)
    //            → fetch → oldest row = 31d ago → windowTo = 31d-1s
    //   window2: windowTo = 31d-1s, windowFrom = 31d-1s - 3.47d = ~34.5d ago
    //            → fetch → cutoff break fires AFTER fetching window2
    //
    // So it makes exactly 2 calls (not MAX_WINDOWS = 10).
    const DAY = 24 * 60 * 60_000;
    // window1 rows: span from 29d ago to 31d ago (oldest past the cutoff).
    const rows1: HistoryPoint[] = [
      {
        ts: new Date(Date.now() - 29 * DAY).toISOString(),
        discount: "0",
        state: "PEGGED",
      },
      {
        ts: new Date(Date.now() - 31 * DAY).toISOString(),
        discount: "0",
        state: "PEGGED",
      },
    ];
    // window2 rows: older still; after this the windowFrom will be > 34d.
    const rows2: HistoryPoint[] = [
      {
        ts: new Date(Date.now() - 32 * DAY).toISOString(),
        discount: "0",
        state: "PEGGED",
      },
      {
        ts: new Date(Date.now() - 34 * DAY).toISOString(),
        discount: "0",
        state: "PEGGED",
      },
    ];

    let call = 0;
    const mockApiFn = vi.fn(async () => {
      return call++ === 0 ? rows1 : rows2;
    });

    await fetchHistory30d("USDC", mockApiFn);

    // Exactly 2 calls: window1 (windowFrom inside 30d, no stop yet) +
    // window2 (windowFrom ~34.5d ago → cutoff break fires after this fetch).
    expect(mockApiFn).toHaveBeenCalledTimes(2);
  });

  it("passes correct bucket/limit to the API function", async () => {
    type ApiFn = Parameters<typeof fetchHistory30d>[1];
    const mockApiFn: ApiFn = vi.fn(async () => [] as HistoryPoint[]);
    await fetchHistory30d("jitoSOL", mockApiFn);

    expect(mockApiFn).toHaveBeenCalledTimes(1);
    // Retrieve call args through the mock's recorded calls.
    const calls = (mockApiFn as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      { bucket: string; from: string; to: string; limit: number },
    ][];
    expect(calls.length).toBeGreaterThan(0);
    const [sym, opts] = calls[0]!;
    expect(sym).toBe("jitoSOL");
    expect(opts.bucket).toBe("1m");
    expect(opts.limit).toBe(5000);
    expect(typeof opts.from).toBe("string");
    expect(typeof opts.to).toBe("string");
  });
});
