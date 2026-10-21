import { describe, it, expect } from "vitest";
import {
  classBucket,
  clusterAlerts,
  eventCounts,
  matchesEventFilters,
  resolveClassBucket,
  retiredSymbols,
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
    expect(classBucket("synth_lev")).toBe("retired");
    expect(classBucket("retired_class")).toBe("retired");
    expect(severityBucket("PEGGED")).toBe("RECOVERED");
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
    for (const k of ["lst", "stable", "retired"] as const) {
      expect(ROWS.filter((a) => matchesEventFilters(a, k, "all")).length).toBe(
        byClass[k],
      );
    }
    for (const k of [
      "DRIFT",
      "DEPEG",
      "CRITICAL",
      "RECOVERED",
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

describe("class from the live universe", () => {
  // The audit mapper stamps "unknown" on every row whose asset it could not
  // resolve, and on EVERY row when its /v1/assets call failed.
  const AUDIT_ROWS: AlertRow[] = [
    alert("jitoSOL", "unknown", "DRIFT", "2026-10-20T01:00:00Z"),
    alert("USDC", "unknown", "DEPEG", "2026-10-19T01:00:00Z"),
    alert("USDC", "unknown", "PEGGED", "2026-10-19T03:00:00Z"),
    ...Array.from({ length: 13 }, (_, i) =>
      alert(
        "pbUSDC",
        "unknown",
        "DRIFT",
        `2026-09-${String(i + 1).padStart(2, "0")}T01:00:00Z`,
      ),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      alert(
        "xSOL",
        "unknown",
        "UNKNOWN",
        `2026-08-${String(i + 1).padStart(2, "0")}T01:00:00Z`,
      ),
    ),
  ];
  const UNIVERSE = { jitoSOL: "lst", USDC: "stable_fiat" };

  it("files assets missing from a loaded universe under Retired", () => {
    const { byClass } = eventCounts(AUDIT_ROWS, UNIVERSE);
    expect(byClass).toEqual({ all: 20, lst: 1, stable: 2, retired: 17 });
    expect(byClass.lst! + byClass.stable! + byClass.retired!).toBe(byClass.all);
  });

  it("lists the retired symbols, most alerts first", () => {
    expect(retiredSymbols(AUDIT_ROWS, UNIVERSE)).toEqual([
      { symbol: "pbUSDC", count: 13 },
      { symbol: "xSOL", count: 4 },
    ]);
  });

  it("hides Retired when every asset is listed (empty bucket)", () => {
    const listed = AUDIT_ROWS.filter(
      (a) => a.asset !== "pbUSDC" && a.asset !== "xSOL",
    );
    expect(eventCounts(listed, UNIVERSE).byClass.retired).toBe(0);
    expect(retiredSymbols(listed, UNIVERSE)).toEqual([]);
  });

  it("has no synth bucket", () => {
    const { byClass } = eventCounts(AUDIT_ROWS, UNIVERSE);
    expect(Object.keys(byClass).sort()).toEqual(
      ["all", "lst", "retired", "stable"].sort(),
    );
  });

  it("reports class facets as unknown (null) when /v1/assets failed", () => {
    const { byClass, bySeverity } = eventCounts(AUDIT_ROWS, null);
    expect(byClass).toEqual({
      all: 20,
      lst: null,
      stable: null,
      retired: null,
    });
    // Severity does not depend on the universe and stays exact.
    expect(bySeverity.all).toBe(20);
    expect(bySeverity.DRIFT).toBe(14);
    expect(retiredSymbols(AUDIT_ROWS, null)).toEqual([]);
  });

  it("never misclassifies under a class filter when the universe is down", () => {
    for (const k of ["lst", "stable", "retired"] as const) {
      expect(
        AUDIT_ROWS.filter((a) => matchesEventFilters(a, k, "all", null)),
      ).toEqual([]);
    }
    expect(
      AUDIT_ROWS.filter((a) => matchesEventFilters(a, "all", "all", null))
        .length,
    ).toBe(20);
    expect(resolveClassBucket(AUDIT_ROWS[0], null)).toBeNull();
  });

  it("resolves a row's class from the universe, not its stamped class", () => {
    expect(resolveClassBucket(AUDIT_ROWS[0], UNIVERSE)).toBe("lst");
    expect(
      AUDIT_ROWS.filter((a) =>
        matchesEventFilters(a, "stable", "all", UNIVERSE),
      ).length,
    ).toBe(2);
  });

  it("buckets recoveries as Recovered", () => {
    expect(eventCounts(AUDIT_ROWS, UNIVERSE).bySeverity.RECOVERED).toBe(1);
  });
});
