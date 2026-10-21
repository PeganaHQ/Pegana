import { describe, it, expect } from "vitest";
import {
  classBucket,
  clusterAlerts,
  eventCounts,
  matchesEventFilters,
  severityBucket,
} from "@/lib/alerts/events";
import type { AlertRow, AssetCardData, PegState } from "@/lib/api/types";

function alert(
  asset: string,
  klass: string,
  to_state: PegState,
  detected_at: string,
  discount?: string,
): AlertRow {
  return {
    id: `${asset}-${detected_at}-${to_state}`,
    asset,
    class: klass,
    from_state: "PEGGED",
    to_state,
    detected_at,
    dispatched_at: null,
    discount: discount ?? null,
  } as AlertRow;
}

const ROWS: AlertRow[] = [
  alert("jitoSOL", "lst", "DRIFT", "2026-10-20T01:00:00Z"),
  alert("USDC", "stable_fiat", "DEPEG", "2026-10-19T01:00:00Z"),
  alert("USDC", "stable_fiat", "PEGGED", "2026-10-19T03:00:00Z"),
  alert("sUSD", "stable_yield", "UNKNOWN", "2026-10-18T01:00:00Z"),
  alert("FOO", "retired_class", "CRITICAL", "2026-10-17T01:00:00Z"),
  alert("BAR", "stable_cdp", "BLACK_SWAN", "2026-10-16T01:00:00Z"),
];

describe("event buckets", () => {
  it("puts every class and state in exactly one bucket", () => {
    expect(classBucket("lst")).toBe("lst");
    expect(classBucket("stable_fx")).toBe("stable");
    expect(classBucket("synth_lev")).toBe("synth");
    expect(classBucket("retired_class")).toBe("other");
    expect(severityBucket("PEGGED")).toBe("RECOVERY");
    expect(severityBucket("BLACK_SWAN")).toBe("CRITICAL");
    expect(severityBucket("UNKNOWN")).toBe("UNKNOWN");
  });

  it("tab counts sum to All in both groups", () => {
    const { byClass, bySeverity } = eventCounts(ROWS);
    const sum = (o: Record<string, number | null>) =>
      Object.entries(o)
        .filter(([k]) => k !== "all")
        .reduce((s, [, v]) => s + (v ?? 0), 0);
    expect(byClass.all).toBe(ROWS.length);
    expect(sum(byClass)).toBe(byClass.all);
    expect(sum(bySeverity)).toBe(bySeverity.all);
  });

  it("counts are null, not 0, before the stream arrives", () => {
    expect(eventCounts(undefined).byClass.all).toBeNull();
    expect(eventCounts(undefined).bySeverity.CRITICAL).toBeNull();
  });

  it("each tab filters to exactly its count", () => {
    const { byClass, bySeverity } = eventCounts(ROWS);
    for (const k of ["lst", "stable", "synth", "other"] as const) {
      expect(ROWS.filter((a) => matchesEventFilters(a, k, "all")).length).toBe(
        byClass[k],
      );
    }
    for (const k of [
      "DRIFT",
      "DEPEG",
      "CRITICAL",
      "RECOVERY",
      "UNKNOWN",
    ] as const) {
      expect(ROWS.filter((a) => matchesEventFilters(a, "all", k)).length).toBe(
        bySeverity[k],
      );
    }
  });
});

describe("clusterAlerts historical rows", () => {
  const assetMap: Record<string, AssetCardData> = {
    sHYUSD: {
      symbol: "sHYUSD",
      discount: "0.0028",
      intrinsic_usd: null,
      market_usd: null,
      series_24h: [0.001, 0.002, 0.003],
    } as unknown as AssetCardData,
  };

  it("uses the current spread and sparkline only for today's row", () => {
    const rows = [
      alert("sHYUSD", "stable_yield", "DRIFT", "2026-10-20T05:00:00Z"),
      alert("sHYUSD", "stable_yield", "DRIFT", "2026-08-22T05:00:00Z"),
    ];
    const [today, past] = clusterAlerts(rows, assetMap, "2026-10-20");
    expect(today.day).toBe("2026-10-20");
    expect(today.magnitudeLabel).toBe("current spread");
    expect(today.sparkline.length).toBeGreaterThan(1);
    expect(past.day).toBe("2026-08-22");
    expect(past.magnitudeBps).toBeNull();
    expect(past.magnitudeLabel).toBe("spread unavailable");
    expect(past.sparkline).toEqual([]);
  });

  it("keeps a past row's own alert spread when it has one", () => {
    const rows = [
      alert("sHYUSD", "stable_yield", "DRIFT", "2026-08-22T05:00:00Z", "0.01"),
    ];
    const [past] = clusterAlerts(rows, assetMap, "2026-10-20");
    expect(past.magnitudeLabel).toBe("alert spread");
    expect(past.magnitudeBps).toBeCloseTo(100);
  });
});
