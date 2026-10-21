// Pure /events logic: buckets, filter matching, counts and day clustering.
// Extracted from app/(app)/events/page.tsx so the counts and the historical
// spread rules are unit-tested.

import { cleanBpsSeries, isDeprecated, reconcileBps } from "@/lib/api/format";
import type { AlertRow, AssetCardData, PegState } from "@/lib/api/types";

export type ClassFilter = "all" | "lst" | "stable" | "synth" | "other";
export type SeverityFilter =
  | "all"
  | "DRIFT"
  | "DEPEG"
  | "CRITICAL"
  | "RECOVERY"
  | "UNKNOWN";

type ClassBucket = Exclude<ClassFilter, "all">;
type SeverityBucket = Exclude<SeverityFilter, "all">;

/** Every class lands in exactly one bucket, so the class tabs sum to All. */
export function classBucket(klass: string | null | undefined): ClassBucket {
  const c = klass ?? "";
  if (c === "lst") return "lst";
  if (c.startsWith("stable_")) return "stable";
  if (c === "synth_lev") return "synth";
  return "other";
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
      return "RECOVERY";
    default:
      return "UNKNOWN";
  }
}

export function matchesEventFilters(
  a: AlertRow,
  classFilter: ClassFilter,
  severityFilter: SeverityFilter,
): boolean {
  if (isDeprecated(a.asset)) return false;
  if (classFilter !== "all" && classBucket(a.class) !== classFilter)
    return false;
  if (severityFilter !== "all" && severityBucket(a.to_state) !== severityFilter)
    return false;
  return true;
}

export type EventCounts<K extends string> = Record<K, number | null>;

/**
 * Alert counts per tab. `null` (not 0) while the stream has not arrived: a
 * literal "CRITICAL 0" reads as a confirmed fact when nothing loaded.
 */
export function eventCounts(alerts: AlertRow[] | undefined): {
  byClass: EventCounts<ClassFilter>;
  bySeverity: EventCounts<SeverityFilter>;
} {
  if (!alerts) {
    return {
      byClass: { all: null, lst: null, stable: null, synth: null, other: null },
      bySeverity: {
        all: null,
        DRIFT: null,
        DEPEG: null,
        CRITICAL: null,
        RECOVERY: null,
        UNKNOWN: null,
      },
    };
  }
  const byClass = { all: 0, lst: 0, stable: 0, synth: 0, other: 0 };
  const bySeverity = {
    all: 0,
    DRIFT: 0,
    DEPEG: 0,
    CRITICAL: 0,
    RECOVERY: 0,
    UNKNOWN: 0,
  };
  for (const a of alerts) {
    if (isDeprecated(a.asset)) continue;
    byClass.all += 1;
    byClass[classBucket(a.class)] += 1;
    bySeverity.all += 1;
    bySeverity[severityBucket(a.to_state)] += 1;
  }
  return { byClass, bySeverity };
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
