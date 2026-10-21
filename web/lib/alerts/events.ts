// Pure /events logic: buckets, filter matching, counts and day clustering.
// Extracted from app/(app)/events/page.tsx so the counts and the historical
// spread rules are unit-tested.

import { cleanBpsSeries, isDeprecated, reconcileBps } from "@/lib/api/format";
import type { AlertRow, AssetCardData, PegState } from "@/lib/api/types";

/**
 * Class taxonomy: the canonical CLASS_TABS (lib/hooks/use-screener-state.ts)
 * plus "retired", the one bucket for receipts whose asset is no longer on the
 * public peg surface (pbUSDC, xSOL). There is no synth bucket: no synth_lev
 * asset is listed, so the tab could only ever read 0.
 */
export type ClassFilter = "all" | "lst" | "stable" | "retired";
export type SeverityFilter =
  "all" | "DRIFT" | "DEPEG" | "CRITICAL" | "RECOVERED" | "UNKNOWN";

export type ClassBucket = Exclude<ClassFilter, "all">;
type SeverityBucket = Exclude<SeverityFilter, "all">;

/**
 * Symbol -> class for the live asset universe (/v1/assets).
 *
 * - `undefined`: trust each row's own `class` (pure callers, tests).
 * - `null`: the universe is not available (loading, or /v1/assets failed,
 *   e.g. 429). Every row's class is then unknown, and class buckets must not
 *   be guessed: the audit mapper has already stamped every row "unknown".
 */
export type AssetUniverse = Record<string, string> | null | undefined;

/** Every class lands in exactly one bucket, so the class tabs sum to All. */
export function classBucket(klass: string | null | undefined): ClassBucket {
  const c = klass ?? "";
  if (c === "lst") return "lst";
  if (c.startsWith("stable_")) return "stable";
  return "retired";
}

/**
 * The class bucket of one alert, or `null` when it cannot be known. An asset
 * missing from a loaded universe is retired (receipts outlive delisting).
 */
export function resolveClassBucket(
  a: AlertRow,
  universe: AssetUniverse,
): ClassBucket | null {
  if (universe === undefined) return classBucket(a.class);
  if (universe === null) return null;
  const k = universe[a.asset];
  return k ? classBucket(k) : "retired";
}

/**
 * Every to_state lands in exactly one bucket, so the severity tabs sum to All.
 * A transition INTO Pegged is a recovery; the ledger includes those.
 */
export function severityBucket(state: PegState): SeverityBucket {
  switch (state) {
    case "DRIFT":
      return "DRIFT";
    case "DEPEG":
      return "DEPEG";
    case "CRITICAL":
    case "BLACK_SWAN":
      return "CRITICAL";
    case "PEGGED":
      return "RECOVERED";
    default:
      return "UNKNOWN";
  }
}

/**
 * A class filter can only match when the class is known. With the universe
 * unavailable, a non-All class filter matches nothing rather than silently
 * filing every row under the wrong class (callers disable those tabs).
 */
export function matchesEventFilters(
  a: AlertRow,
  classFilter: ClassFilter,
  severityFilter: SeverityFilter,
  universe?: AssetUniverse,
): boolean {
  if (isDeprecated(a.asset)) return false;
  if (classFilter !== "all" && resolveClassBucket(a, universe) !== classFilter)
    return false;
  if (severityFilter !== "all" && severityBucket(a.to_state) !== severityFilter)
    return false;
  return true;
}

export type EventCounts<K extends string> = Record<K, number | null>;

const NULL_SEVERITY: EventCounts<SeverityFilter> = {
  all: null,
  DRIFT: null,
  DEPEG: null,
  CRITICAL: null,
  RECOVERED: null,
  UNKNOWN: null,
};

/**
 * Alert counts per tab. `null` (not 0) while the stream has not arrived: a
 * literal "CRITICAL 0" reads as a confirmed fact when nothing loaded. The
 * class facets (not All) are also `null` while the asset universe is
 * unavailable, because every row's class is then unknown.
 */
export function eventCounts(
  alerts: AlertRow[] | undefined,
  universe?: AssetUniverse,
): {
  byClass: EventCounts<ClassFilter>;
  bySeverity: EventCounts<SeverityFilter>;
} {
  if (!alerts) {
    return {
      byClass: { all: null, lst: null, stable: null, retired: null },
      bySeverity: { ...NULL_SEVERITY },
    };
  }
  const byClass = { all: 0, lst: 0, stable: 0, retired: 0 };
  const bySeverity = {
    all: 0,
    DRIFT: 0,
    DEPEG: 0,
    CRITICAL: 0,
    RECOVERED: 0,
    UNKNOWN: 0,
  };
  for (const a of alerts) {
    if (isDeprecated(a.asset)) continue;
    byClass.all += 1;
    const bucket = resolveClassBucket(a, universe);
    if (bucket) byClass[bucket] += 1;
    bySeverity.all += 1;
    bySeverity[severityBucket(a.to_state)] += 1;
  }
  if (universe === null) {
    return {
      byClass: { all: byClass.all, lst: null, stable: null, retired: null },
      bySeverity,
    };
  }
  return { byClass, bySeverity };
}

/**
 * Retired symbols with their alert counts, most alerts first, for the
 * Retired tab's tooltip. Empty while the universe is unavailable.
 */
export function retiredSymbols(
  alerts: AlertRow[] | undefined,
  universe: AssetUniverse,
): Array<{ symbol: string; count: number }> {
  if (!alerts || universe === null) return [];
  const counts = new Map<string, number>();
  for (const a of alerts) {
    if (isDeprecated(a.asset)) continue;
    if (resolveClassBucket(a, universe) !== "retired") continue;
    counts.set(a.asset, (counts.get(a.asset) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((x, y) => y.count - x.count || x.symbol.localeCompare(y.symbol));
}

export interface EventCluster {
  asset: string;
  klass: string;
  day: string;
  latestAt: string;
  alerts: AlertRow[];
  worst: PegState;
  magnitudeBps: number | null;
  magnitudeLabel: "alert spread" | "current spread" | "spread unavailable";
  sparkline: number[];
  live: boolean;
}

const STATE_RANK: Record<PegState, number> = {
  PEGGED: 0,
  UNKNOWN: 0,
  DRIFT: 1,
  DEPEG: 2,
  CRITICAL: 3,
  BLACK_SWAN: 4,
};

function alertBps(a: AlertRow): number | null {
  // Alert rows carry only the engine's authoritative `discount` (and the
  // /v1/audit list carries none at all), so read the declared spread directly.
  const spread = reconcileBps({
    discount: a.discount ?? null,
    intrinsic_usd: null,
    market_usd: null,
  });
  return spread.bps;
}

function assetSparkline(asset: AssetCardData | undefined): number[] {
  return cleanBpsSeries(
    asset?.series_24h?.map((v) => Math.round(v * 10000)),
  ).slice(-36);
}

/**
 * Group alerts into one row per asset per UTC day.
 *
 * The asset's CURRENT spread and 24h sparkline are only a fair stand-in for
 * today's row. On a past day they described the present next to an August
 * date (every historical eHYUSD row read "-0.28% current spread"), so past
 * rows without their own alert spread show "spread unavailable" and no
 * sparkline.
 */
export function clusterAlerts(
  rows: AlertRow[],
  assetMap: Record<string, AssetCardData>,
  todayKey: string = new Date().toISOString().slice(0, 10),
): EventCluster[] {
  const map = new Map<string, EventCluster>();
  for (const a of rows) {
    const day = a.detected_at.slice(0, 10);
    const isToday = day >= todayKey;
    const key = `${a.asset}__${day}`;
    const ex = map.get(key);
    const ownBps = alertBps(a);
    const fallbackBps = isToday
      ? reconcileBps(
          assetMap[a.asset] ?? {
            discount: null,
            intrinsic_usd: null,
            market_usd: null,
          },
        ).bps
      : null;
    if (ex) {
      ex.alerts.push(a);
      if (STATE_RANK[a.to_state] > STATE_RANK[ex.worst]) ex.worst = a.to_state;
      if (a.detected_at > ex.latestAt) ex.latestAt = a.detected_at;
      if (ex.magnitudeLabel !== "alert spread" && ownBps != null) {
        ex.magnitudeBps = ownBps;
        ex.magnitudeLabel = "alert spread";
      }
      ex.live = ex.live || a.id.startsWith("live:");
    } else {
      map.set(key, {
        asset: a.asset,
        klass: a.class,
        day,
        latestAt: a.detected_at,
        alerts: [a],
        worst: a.to_state,
        magnitudeBps: ownBps ?? fallbackBps,
        magnitudeLabel:
          ownBps != null
            ? "alert spread"
            : fallbackBps != null
              ? "current spread"
              : "spread unavailable",
        sparkline: isToday ? assetSparkline(assetMap[a.asset]) : [],
        live: a.id.startsWith("live:"),
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0,
  );
}
