"use client";

// Shared screener cluster: class filter + text search + URL-driven sort +
// a 30s freshness clock, reduced to one hook so any asset-list surface
// (the /assets screener today, the dashboard next) gets the exact same
// filter/sort/staleness semantics instead of a second hand-rolled copy.
//
// Crown jewels: staleness, severity ordering and PegState are NEVER
// recomputed here — every row's `state`/`prox` comes straight out of
// `effectiveState`/`isStale` (lib/asset/freshness), `bandProximity`
// (lib/asset/band) via `thresholdsFor` (lib/alerts/policy), and the "state"
// column delegates its ranking to `compareWorstFirst` (lib/asset/worst-sort)
// rather than re-deriving a severity ramp.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { replaceQuery } from "@/lib/url/replace-query";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive } from "@/lib/store/live-context";
import {
  isDeprecated,
  jitterLabel,
  parseMarketCapUsd,
  pegJitter,
  reconcileBps,
  safetyGrade,
  safetyTotalGrade,
  type JitterBucket,
} from "@/lib/api/format";
import { bandProximity } from "@/lib/asset/band";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import { compareWorstFirst, type LiveOverride } from "@/lib/asset/worst-sort";
import { thresholdsFor } from "@/lib/alerts/policy";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, AssetClass, PegState } from "@/lib/api/types";

export const CLASS_TABS = [
  { key: "all" as const, label: "All" },
  { key: "lst" as const, label: "LSTs" },
  { key: "stable" as const, label: "Stables" },
  // "Synthetic" (synth_lev) removed 2026-07-23: leveraged synths have no peg and
  // are excluded from the public peg surface (API ASSETS_LIST_SQL), so the tab
  // would always be empty. See the xSOL keep/remove analysis.
];
export type ClassFilterKey = (typeof CLASS_TABS)[number]["key"];

export function matchesClassFilter(
  klass: AssetClass,
  filter: ClassFilterKey,
): boolean {
  if (filter === "all") return true;
  if (filter === "lst") return klass === "lst";
  if (filter === "stable") return klass.startsWith("stable_");
  return true;
}

export const CLASS_LABEL: Record<AssetClass, string> = {
  lst: "LST",
  stable_fiat: "Fiat stable",
  stable_cdp: "CDP stable",
  stable_dn: "Delta-neutral",
  stable_fx: "FX stable",
  stable_rwa: "RWA",
  stable_yield: "Yield-bearing",
  synth_lev: "Synth",
};

export type SortKey =
  | "state"
  | "symbol"
  | "class"
  | "spread"
  | "band"
  | "jitter"
  | "safety"
  | "risk"
  | "marketCap";
export type SortDir = "asc" | "desc";

const SORT_KEYS: ReadonlySet<string> = new Set([
  "state",
  "symbol",
  "class",
  "spread",
  "band",
  "jitter",
  "safety",
  "risk",
  "marketCap",
]);

// Human-readable column names for the sr-only sort announcement.
export const SORT_LABEL: Record<SortKey, string> = {
  state: "State",
  symbol: "Asset",
  class: "Class",
  spread: "Spread",
  band: "Proximity to depeg",
  jitter: "Stability",
  safety: "Safety",
  risk: "Risk",
  marketCap: "Market cap",
};

const SAFETY_RANK: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

export interface ScreenerRow {
  a: AssetCardData;
  state: PegState;
  bps: number | null;
  prox: number | null;
  jitter: number | null;
  jLabel: JitterBucket;
  safety: "A" | "B" | "C" | "D";
  /** Parsed `market_cap` (circulating_supply × price, USD) — a size/context
   *  signal, NOT a peg-safety signal. Null until the backend ships the
   *  market-cap migration + indexer. */
  marketCapUsd: number | null;
}

const EMPTY_OVERRIDES: Record<string, LiveOverride> = {};

function compareRows(
  p: ScreenerRow,
  q: ScreenerRow,
  sortKey: SortKey,
  sortDir: SortDir,
  liveOverrides: Record<string, LiveOverride>,
  now: number,
): number {
  // H1/H9: a row with no reconciled spread (stale, or otherwise unreadable)
  // must never be ranked as if it were real data. It sinks to the bottom
  // for EVERY column and EVERY direction — never floating to the top of an
  // ascending sort as "safely near zero", never read as a confirmed
  // worst-case on a descending one. This check runs before the per-key
  // comparator and ignores `sortDir` entirely, on purpose.
  const pMissing = p.bps == null;
  const qMissing = q.bps == null;
  if (pMissing !== qMissing) return pMissing ? 1 : -1;

  let cmp = 0;
  switch (sortKey) {
    case "symbol":
      cmp = p.a.symbol.localeCompare(q.a.symbol);
      break;
    case "class":
      cmp = (CLASS_LABEL[p.a.class] ?? p.a.class).localeCompare(
        CLASS_LABEL[q.a.class] ?? q.a.class,
      );
      break;
    case "state":
      // Crown jewel: compareWorstFirst already encodes "most severe first,
      // ties broken by proximity to the depeg line" off the same freshness
      // gate used above — reuse it instead of re-deriving a severity ramp.
      // Its convention is "worst first" (negative when `p` is worse), the
      // opposite of this switch's plain-ascending convention, so it's
      // negated here; the shared sortDir flip below then restores "worst
      // first" as the default (desc) reading, matching every other column.
      cmp = -compareWorstFirst(p.a, q.a, liveOverrides, now);
      break;
    case "band":
      cmp = (p.prox ?? 0) - (q.prox ?? 0);
      break;
    case "jitter":
      cmp = (p.jitter ?? -1) - (q.jitter ?? -1);
      break;
    case "safety":
      cmp = SAFETY_RANK[p.safety] - SAFETY_RANK[q.safety];
      break;
    case "marketCap": {
      // Size/context signal, deliberately kept OUT of the worst-first
      // ranking's severity ramp (compareWorstFirst never reads it) — this
      // case only fires when the user explicitly sorts THIS column. Nulls
      // (not yet backfilled by the backend) sink to the bottom regardless
      // of direction, same "never rank missing data as good" rule as the
      // pMissing/qMissing gate above — hence the early `return`, which
      // skips the shared sortDir flip below.
      const pNull = p.marketCapUsd == null;
      const qNull = q.marketCapUsd == null;
      if (pNull !== qNull) return pNull ? 1 : -1;
      if (pNull && qNull) return p.a.symbol.localeCompare(q.a.symbol);
      cmp = p.marketCapUsd! - q.marketCapUsd!;
      break;
    }
    default:
      cmp = Math.abs(p.bps ?? 0) - Math.abs(q.bps ?? 0);
      break;
  }
  // Stable tie-break on symbol so equal keys don't shuffle between renders.
  if (cmp === 0) cmp = p.a.symbol.localeCompare(q.a.symbol);
  return sortDir === "asc" ? cmp : -cmp;
}

export interface UseScreenerStateResult {
  assets: AssetCardData[] | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
  /** Live (non-deprecated) asset count — for header meta rows. */
  total: number;
  /** Global (unfiltered) count of assets in drift-or-worse, from the same
   *  deprecated-suppressed population as `total` and the same H1/H9
   *  freshness gate as `rows` — so the hero meta always describes the
   *  whole tracked universe, not just the active class filter/search. */
  atRisk: number;
  classFilter: ClassFilterKey;
  setClassFilter: (key: ClassFilterKey) => void;
  search: string;
  setSearch: (q: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  setSort: (key: SortKey) => void;
  /** sr-only "Sorted by X, ascending." announcement text — empty until the
   *  first user-initiated re-sort. */
  sortAnnounce: string;
  /** 30s-ticking wall clock, for freshness gating (H1/H9). */
  now: number;
  rows: ScreenerRow[];
}

/**
 * The filter/search/sort/clock cluster shared by every asset-list surface.
 * Client-only (reads useSearchParams) — callers must render the component
 * that invokes this hook inside a <Suspense> boundary, same as today's
 * screener.
 */
export function useScreenerState(): UseScreenerStateResult {
  const { data: assets, isLoading, error, mutate } = useAssets();
  // H1/H9 (frozen WS shadows REST): only trust the live frame while the
  // socket is `connected`. On disconnect, live-context keeps the LAST
  // byAsset frame (it only flips `connected`, never clears the map), so
  // reading it unguarded lets a now-frozen frame's state/spread shadow the
  // fresher REST snapshot for up to STALE_AFTER_MS.
  const { byAsset, connected } = useLive();
  const liveOverrides: Record<string, LiveOverride> = connected
    ? byAsset
    : EMPTY_OVERRIDES;

  const params = useSearchParams();

  const [classFilter, setClassFilter] = useState<ClassFilterKey>("all");
  const [search, setSearch] = useState("");

  // Ticking wall-clock for freshness gating (H1/H9). Callers are CSR
  // bailouts (useSearchParams), so there's no server HTML to mismatch —
  // seed the real clock immediately and re-evaluate isStale() every 30s so
  // a row that goes silent visibly degrades to UNKNOWN instead of holding
  // a frozen PEGGED+green snapshot forever.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Screen-reader announcement for re-sorts. The visible cue lives in the
  // header arrows; this text feeds an sr-only aria-live region so a
  // non-sighted user hears the ranking change (the aria-label alone only
  // updates on focus and announces nothing on click).
  const [sortAnnounce, setSortAnnounce] = useState("");

  // Sort is URL-driven so a ranking is shareable: ?sort=spread&dir=desc.
  const sortKey: SortKey = (() => {
    const s = params?.get("sort");
    return s && SORT_KEYS.has(s) ? (s as SortKey) : "spread";
  })();
  const sortDir: SortDir = params?.get("dir") === "asc" ? "asc" : "desc";

  const setSort = (key: SortKey) => {
    // Toggle direction when re-clicking the active key; otherwise default to
    // the most-useful direction for that column (desc for magnitudes, asc
    // for names).
    const nextDir: SortDir =
      sortKey === key
        ? sortDir === "desc"
          ? "asc"
          : "desc"
        : key === "symbol" || key === "class"
          ? "asc"
          : "desc";
    const sp = new URLSearchParams(params?.toString() ?? "");
    sp.set("sort", key);
    sp.set("dir", nextDir);
    replaceQuery(sp);
    setSortAnnounce(
      `Sorted by ${SORT_LABEL[key]}, ${nextDir === "desc" ? "descending" : "ascending"}.`,
    );
  };

  const rows: ScreenerRow[] = useMemo(() => {
    if (!assets) return [];
    const q = search.trim().toLowerCase();
    const enriched: ScreenerRow[] = assets
      .filter((a) => !isDeprecated(a.symbol))
      .filter((a) => matchesClassFilter(a.class, classFilter))
      .filter(
        (a) =>
          !q ||
          `${a.symbol} ${displaySymbol(a.symbol)} ${a.name} ${a.class}`
            .toLowerCase()
            .includes(q),
      )
      .map((a) => {
        const live = liveOverrides[a.symbol];
        const effectiveUpdatedAt = live?.updated_at ?? a.updated_at;
        const stale = isStale(effectiveUpdatedAt, now);
        const state = effectiveState(live, a, now);
        const rawBps = reconcileBps({
          discount: live?.discount ?? a.discount,
          intrinsic_usd: a.intrinsic_usd,
          market_usd: a.market_usd,
        }).bps;
        // Null when stale so the gauge renders "—" and the sort drops it
        // last rather than ranking a frozen snapshot as safely far-from-line.
        const bps = stale ? null : rawBps;
        const t = thresholdsFor(a.symbol, a.class, a.thresholds);
        const jitter = pegJitter(a.series_24h);
        return {
          a,
          state,
          bps,
          prox: stale
            ? null
            : bandProximity(bps, t, isDirectionSensitiveClass(a.class)),
          jitter,
          jLabel: jitterLabel(jitter),
          safety: safetyTotalGrade(safetyGrade(a)),
          marketCapUsd: parseMarketCapUsd(a.market_cap),
        };
      });

    enriched.sort((p, q2) =>
      compareRows(p, q2, sortKey, sortDir, liveOverrides, now),
    );
    return enriched;
  }, [assets, liveOverrides, classFilter, search, sortKey, sortDir, now]);

  const total = assets
    ? assets.filter((a) => !isDeprecated(a.symbol)).length
    : 0;

  // Same unfiltered, deprecated-suppressed population as `total` — NOT
  // `rows` (which is narrowed by classFilter/search) — so the hero's two
  // numbers ("N tracked live" / "N in drift or worse") both describe the
  // whole universe. Freshness-gated via the same `effectiveState`: a stale
  // row counts as UNKNOWN, never as drift-or-worse.
  const atRisk = assets
    ? assets
        .filter((a) => !isDeprecated(a.symbol))
        .filter((a) => {
          const state = effectiveState(liveOverrides[a.symbol], a, now);
          return state !== "PEGGED" && state !== "UNKNOWN";
        }).length
    : 0;

  return {
    assets,
    isLoading,
    error,
    mutate,
    total,
    atRisk,
    classFilter,
    setClassFilter,
    search,
    setSearch,
    sortKey,
    sortDir,
    setSort,
    sortAnnounce,
    now,
    rows,
  };
}
