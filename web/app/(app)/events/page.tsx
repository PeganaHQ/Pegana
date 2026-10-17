"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ListFilter } from "lucide-react";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive } from "@/lib/store/live-context";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import { Sparkline } from "@/components/atoms/sparkline";
import { EventsHeatmap } from "@/components/molecules/events-heatmap";
import { Pagination } from "@/components/molecules/pagination";
import { usePagination } from "@/lib/hooks/use-pagination";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  cleanBpsSeries,
  formatDayUS,
  formatGap,
  isDeprecated,
  reconcileBps,
} from "@/lib/api/format";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AlertRow, PegState, AssetCardData } from "@/lib/api/types";
import { spreadSignClass } from "@/lib/state-class";

// /events — Linear-style transition log with a 240px filter rail on the
// left to match the dashboard shell. Class + severity facets live in the
// rail; main column is the chronological timeline (with the 52-week
// heatmap as an opening summary).

type ClassFilter = "all" | "lst" | "stable" | "synth";
type SeverityFilter = "all" | "DRIFT" | "DEPEG" | "CRITICAL";

interface EventCluster {
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
  // Alert rows carry only the engine's authoritative `discount` — the backend
  // emits no intrinsic/market on this endpoint, so there's nothing to
  // cross-check against; read the declared spread directly.
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

function clusterAlerts(
  rows: AlertRow[],
  assetMap: Record<string, AssetCardData>,
): EventCluster[] {
  const map = new Map<string, EventCluster>();
  for (const a of rows) {
    const day = a.detected_at.slice(0, 10);
    const key = `${a.asset}__${day}`;
    const ex = map.get(key);
    const ownBps = alertBps(a);
    const fallbackBps = reconcileBps(
      assetMap[a.asset] ?? {
        discount: null,
        intrinsic_usd: null,
        market_usd: null,
      },
    ).bps;
    if (ex) {
      ex.alerts.push(a);
      if (STATE_RANK[a.to_state] > STATE_RANK[ex.worst]) ex.worst = a.to_state;
      if (a.detected_at > ex.latestAt) ex.latestAt = a.detected_at;
      if (ex.magnitudeBps == null && ownBps != null) {
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
        sparkline: assetSparkline(assetMap[a.asset]),
        live: a.id.startsWith("live:"),
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0,
  );
}

function classLabel(c: string): string {
  return c === "lst"
    ? "LST"
    : c.startsWith("stable_")
      ? "Stable"
      : c === "synth_lev"
        ? "Synth"
        : c;
}

// Time-bucket headers (Today / Yesterday / This week / Earlier) — the Linear
// inbox / Vercel activity-log / GitHub feed idiom, so a long flat cluster
// list reads as "recent activity" instead of an undifferentiated scroll.
// Bucketed on `c.day` (already the calendar-day key clusterAlerts groups by)
// rather than `latestAt`, so the bucket a cluster lands in always matches
// the date printed on its own row.
type TimeBucket = "today" | "yesterday" | "week" | "earlier";

const BUCKET_ORDER: ReadonlyArray<{ key: TimeBucket; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "earlier", label: "Earlier" },
];

const MS_PER_DAY = 86_400_000;

function bucketForDay(day: string, todayKey: string): TimeBucket {
  if (day === todayKey) return "today";
  const diffDays = Math.round(
    (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
      MS_PER_DAY,
  );
  // diffDays <= 0 covers clock-skew / same-UTC-day edge cases — never file a
  // cluster as older than "Today".
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return "week";
  return "earlier";
}

export default function EventsPage() {
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  // The 52-week heatmap needs a full year of data. /v1/alerts defaults to a
  // ~7-day window when `since` is omitted, so ~51 of the 52 weeks rendered as
  // falsely calm. Request an explicit 365-day window matching the visual.
  // Memoized (computed once per mount) so the SWR key doesn't thrash — an
  // inline Date.now() would change the `since` string on every render.
  const since = useMemo(
    () => new Date(Date.now() - 365 * MS_PER_DAY).toISOString(),
    [],
  );
  const {
    data: alerts,
    isLoading,
    error,
    mutate,
  } = useAlerts({ limit: 500, since });
  const { data: assets } = useAssets();
  const { byAsset } = useLive();
  const previousLiveStates = useRef<Record<string, PegState>>({});
  const [liveRows, setLiveRows] = useState<AlertRow[]>([]);

  // Distinguish "backend unreachable" from "no events matched the filters". On a
  // hard API failure SWR has no cached `data`, so without this branch the
  // timeline would silently render the empty-window copy and imply a calm market.
  const backendDown = !!error && !alerts;

  const assetMap = useMemo(() => {
    const m: Record<string, AssetCardData> = {};
    for (const a of assets ?? []) m[a.symbol] = a;
    return m;
  }, [assets]);

  useEffect(() => {
    const nextSeen = { ...previousLiveStates.current };
    const generated: AlertRow[] = [];

    for (const [symbol, update] of Object.entries(byAsset)) {
      if (!update.state) continue;
      const prev = previousLiveStates.current[symbol];
      nextSeen[symbol] = update.state;
      if (!prev || prev === update.state) continue;
      const meta = assetMap[symbol];
      if (!meta || isDeprecated(symbol)) continue;
      generated.push({
        id: `live:${symbol}:${Date.now()}:${prev}:${update.state}`,
        asset: symbol,
        class: meta.class,
        from_state: prev,
        to_state: update.state,
        detected_at: update.updated_at ?? new Date().toISOString(),
        dispatched_at: null,
        discount: update.discount ?? meta.discount,
      });
    }

    previousLiveStates.current = nextSeen;
    if (generated.length > 0) {
      setLiveRows((prev) => [...generated, ...prev].slice(0, 20));
    }
  }, [assetMap, byAsset]);

  // Class filter counts derived from full alert stream
  // `null`, not 0, while the stream has not arrived. A literal "CRITICAL 0"
  // beside a 52-week heatmap reads as a confirmed fact — "no critical peg
  // events all year" — when in truth nothing loaded. During an outage it
  // rendered directly above this page's own "LIVE FEED UNREACHABLE" block:
  // two contradictory claims in one viewport. Missing data must not be
  // presentable as confirming data; that is the whole product.
  const classCounts = useMemo<Record<"all" | "lst" | "stable" | "synth", number | null>>(() => {
    if (!alerts) return { all: null, lst: null, stable: null, synth: null };
    const c = { all: 0, lst: 0, stable: 0, synth: 0 };
    for (const a of alerts) {
      if (isDeprecated(a.asset)) continue;
      c.all += 1;
      if (a.class === "lst") c.lst += 1;
      else if (a.class.startsWith("stable_")) c.stable += 1;
      else if (a.class === "synth_lev") c.synth += 1;
    }
    return c;
  }, [alerts]);

  const severityCounts = useMemo<Record<"all" | "DRIFT" | "DEPEG" | "CRITICAL", number | null>>(() => {
    if (!alerts) return { all: null, DRIFT: null, DEPEG: null, CRITICAL: null };
    const s = { all: 0, DRIFT: 0, DEPEG: 0, CRITICAL: 0 };
    for (const a of alerts) {
      if (isDeprecated(a.asset)) continue;
      s.all += 1;
      if (a.to_state === "DRIFT") s.DRIFT += 1;
      else if (a.to_state === "DEPEG") s.DEPEG += 1;
      else if (a.to_state === "CRITICAL" || a.to_state === "BLACK_SWAN")
        s.CRITICAL += 1;
    }
    return s;
  }, [alerts]);

  const clusters = useMemo(() => {
    const rows = [...liveRows, ...(alerts ?? [])];
    if (rows.length === 0) return [];
    const filtered = rows.filter((a) => {
      if (isDeprecated(a.asset)) return false;
      if (classFilter !== "all") {
        if (classFilter === "lst" && a.class !== "lst") return false;
        if (classFilter === "stable" && !a.class.startsWith("stable_"))
          return false;
        if (classFilter === "synth" && a.class !== "synth_lev") return false;
      }
      if (severityFilter !== "all") {
        if (severityFilter === "CRITICAL") {
          if (a.to_state !== "CRITICAL" && a.to_state !== "BLACK_SWAN")
            return false;
        } else if (a.to_state !== severityFilter) return false;
      }
      return true;
    });
    return clusterAlerts(filtered, assetMap);
  }, [alerts, assetMap, classFilter, liveRows, severityFilter]);

  // `null` while the stream is absent: an all-dark 52-week grid is a strong,
  // specific claim ("a quiet year"), and it was rendered from nothing.
  const heatmapBuckets = useMemo<Record<string, number> | null>(() => {
    if (!alerts) return null;
    const out: Record<string, number> = {};
    alerts.forEach((a) => {
      if (isDeprecated(a.asset)) return;
      const day = a.detected_at?.slice(0, 10);
      if (day) out[day] = (out[day] ?? 0) + 1;
    });
    return out;
  }, [alerts]);

  // Shared pagination. /events was the one surface with no reset-on-filter
  // effect at all, so changing a filter could leave the reader on a page that
  // no longer existed in the new set; the hook resets for every consumer.
  const pagination = usePagination({
    items: clusters,
    pageSize: 25,
    resetKey: `${classFilter}|${severityFilter}`,
    itemNoun: "cluster",
  });
  const pagedClusters = pagination.pageItems;

  // Group the already-sorted (latestAt desc) cluster list into time buckets.
  // Filtering an ordered array into buckets preserves relative order within
  // each bucket, so no re-sort is needed.
  const bucketedClusters = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const out: Record<TimeBucket, EventCluster[]> = {
      today: [],
      yesterday: [],
      week: [],
      earlier: [],
    };
    for (const c of pagedClusters) out[bucketForDay(c.day, todayKey)].push(c);
    return out;
  }, [pagedClusters]);

  const filtersActive = classFilter !== "all" || severityFilter !== "all";

  // Timeline row — idiom ported from the V2 changelog spine (spine + dots +
  // type pills), adapted to app density — not the scoped `.pegana-v2`
  // component itself. Factored out of the flat `.map` so it can be reused
  // per time-bucket `<ol>` below without duplicating the row markup.
  function renderCluster(c: EventCluster) {
    const meta = assetMap[c.asset];
    const m = stateMeta(c.worst);
    return (
      <li key={c.asset + c.day} className="relative grid gap-3">
        <span
          aria-hidden
          className="absolute -left-[30px] top-[8px] h-[8px] w-[8px] rounded-full"
          style={{
            background: m.dotVar,
          }}
        />
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-text-body">
          <span>{formatDayUS(c.day)}</span>
          {c.live && (
            <span className="rounded-full border border-st-pegged/30 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-st-pegged">
              live
            </span>
          )}
        </div>
        <Link
          href={`/asset/${encodeURIComponent(c.asset)}?at=${encodeURIComponent(c.latestAt)}`}
          className="group block transition-colors duration-300"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {meta && (
              <TokenIcon
                mint={meta.mint}
                symbol={displaySymbol(c.asset)}
                klass={meta.class}
                size={26}
                className="self-center"
              />
            )}
            <h3 className="text-[22px] font-medium tracking-[-0.015em] text-text transition-colors duration-300 group-hover:text-coral">
              {displaySymbol(c.asset)}
            </h3>
            {meta?.name && (
              <span className="text-[13px] text-text-muted">{meta.name}</span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
              · {classLabel(c.klass)}
            </span>
            {/* Type pill — bordered chip colored by state, the
                worst transition of the day, Capitalized label. */}
            <span
              className={cn(
                "ml-auto inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium",
                m.badgeClass,
              )}
            >
              <StatePip
                state={c.worst}
                pulse={c.worst !== "PEGGED"}
                size={5}
                announce
              />
              {m.label}
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px] sm:items-end">
            <p className="text-[14px] leading-[1.55] text-text-muted">
              <b className="font-medium text-text">{c.alerts.length}</b>{" "}
              {c.alerts.length === 1 ? "alert" : "alerts"} across the day, worst{" "}
              <b className={cn("font-medium", m.textClass)}>{m.label}</b>
              <span className="mx-2 text-text-caption">·</span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  // Sign, not state. This used to be `m.textClass`, so a day
                  // whose worst state was PEGGED printed its `−0.21%` in
                  // GREEN — the exact contradiction the sign standard exists
                  // to kill. The `{m.label}` word above it stays state-colored
                  // on purpose: it names a state and carries no sign.
                  c.magnitudeBps == null
                    ? "text-text-caption"
                    : spreadSignClass(c.magnitudeBps),
                )}
              >
                {/* Holder convention: magnitudeBps follows
                    reconcileBps/alertBps (positive = discount,
                    negative = premium) — negate for display so
                    `+` = premium, `−` = discount. */}
                {formatGap(c.magnitudeBps == null ? null : -c.magnitudeBps)}
              </span>{" "}
              <span className="text-text-caption">{c.magnitudeLabel}</span>
            </p>
            {c.sparkline.length >= 2 && (
              <div className="h-9 overflow-hidden border-l border-hairline pl-3">
                <Sparkline
                  points={c.sparkline}
                  height={34}
                  stroke={m.dotVar}
                  fill="transparent"
                  showFill={false}
                />
              </div>
            )}
          </div>
        </Link>
      </li>
    );
  }

  return (
    // <main>, not <div>: /events had no main landmark at all, so the skip link
    // and any "jump to content" affordance had nothing to target here. The
    // <aside> filter rail is a sibling INSIDE it, which is correct — it is
    // page-scoped filtering, not site navigation.
    <main className="flex min-h-[calc(100dvh-60px)] flex-col lg:flex-row">
      {/* Sidebar — filter facets, V5 pill-tab tracks (same idiom as the
          /assets class-filter container). */}
      <aside className="hidden shrink-0 border-r border-hairline py-6 lg:block lg:w-[248px]">
        <div className="sticky top-0 flex flex-col gap-6 px-5">
          <FilterPillGroup
            label="Class"
            active={classFilter}
            onChange={setClassFilter}
            options={[
              { value: "all", label: "All", count: classCounts.all },
              { value: "lst", label: "LSTs", count: classCounts.lst },
              { value: "stable", label: "Stables", count: classCounts.stable },
              { value: "synth", label: "Synthetic", count: classCounts.synth },
            ]}
          />
          <FilterPillGroup
            label="Severity"
            active={severityFilter}
            onChange={setSeverityFilter}
            options={[
              { value: "all", label: "All", count: severityCounts.all },
              {
                value: "DRIFT",
                label: "Drift",
                count: severityCounts.DRIFT,
                swatch: stateMeta("DRIFT").dotVar,
              },
              {
                value: "DEPEG",
                label: "Depeg",
                count: severityCounts.DEPEG,
                swatch: stateMeta("DEPEG").dotVar,
              },
              {
                value: "CRITICAL",
                label: "Critical",
                count: severityCounts.CRITICAL,
                swatch: stateMeta("CRITICAL").dotVar,
              },
            ]}
          />
        </div>
      </aside>

      {/* Main timeline pane */}
      <section className="flex-1 px-5 py-10 sm:px-8 sm:py-12 lg:px-12 lg:py-14 xl:px-16">
        <div className="mx-auto max-w-[960px]">
          {/* Compact app-density PageHero — same V5 language as /assets and
              /compare (eyebrow + title + one-line lede). */}
          <header className="mb-10 sm:mb-12">
            <span className="mb-3 inline-flex rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
              Events
            </span>
            <h1 className="max-w-[46ch] text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
              Every depeg, replayable.
            </h1>
            <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-text-body sm:text-[15px]">
              Each row is one asset on one day with at least one state
              transition out of PEGGED. Click into the asset for the exact
              spread chart.
            </p>
            <Link
              href="/audit"
              className="mt-4 inline-flex items-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
            >
              Every event here has a verifiable receipt →
            </Link>
          </header>

          {/* Mobile filter pills — same FilterPillGroup as the desktop rail,
              horizontally scrollable rather than wrapped. */}
          <div className="mb-8 flex flex-col gap-3 lg:hidden">
            <FilterPillGroup
              label="Class"
              active={classFilter}
              onChange={setClassFilter}
              scroll
              options={[
                { value: "all", label: "All", count: classCounts.all },
                { value: "lst", label: "LSTs", count: classCounts.lst },
                {
                  value: "stable",
                  label: "Stables",
                  count: classCounts.stable,
                },
                {
                  value: "synth",
                  label: "Synthetic",
                  count: classCounts.synth,
                },
              ]}
            />
            <FilterPillGroup
              label="Severity"
              active={severityFilter}
              onChange={setSeverityFilter}
              scroll
              options={[
                { value: "all", label: "All", count: severityCounts.all },
                {
                  value: "DRIFT",
                  label: "Drift",
                  count: severityCounts.DRIFT,
                  swatch: stateMeta("DRIFT").dotVar,
                },
                {
                  value: "DEPEG",
                  label: "Depeg",
                  count: severityCounts.DEPEG,
                  swatch: stateMeta("DEPEG").dotVar,
                },
                {
                  value: "CRITICAL",
                  label: "Critical",
                  count: severityCounts.CRITICAL,
                  swatch: stateMeta("CRITICAL").dotVar,
                },
              ]}
            />
          </div>

          {/* Off-peg scoreboard — a compact summary of assets currently off
              their peg, shown above the timeline. Reads from the live assets
              data (not the alerts feed) so it reflects the CURRENT state, not
              historical events. */}
          {(() => {
            const offPeg = (assets ?? [])
              .filter((a) => !isDeprecated(a.symbol))
              .filter(
                (a) =>
                  a.state === "DRIFT" ||
                  a.state === "DEPEG" ||
                  a.state === "CRITICAL" ||
                  a.state === "BLACK_SWAN",
              )
              .sort((a, b) => {
                const rank: Record<string, number> = {
                  CRITICAL: 0,
                  BLACK_SWAN: 0,
                  DEPEG: 1,
                  DRIFT: 2,
                };
                return (
                  (rank[a.state ?? ""] ?? 9) -
                  (rank[b.state ?? ""] ?? 9)
                );
              })
              .slice(0, 4);
            if (offPeg.length === 0) return null;
            return (
              <section className="mb-12">
                <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
                  Currently off-peg · {offPeg.length} {offPeg.length === 1 ? "asset" : "assets"}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {offPeg.map((a) => {
                    const m = stateMeta(a.state);
                    const { bps } = reconcileBps(a);
                    return (
                      <Link
                        key={a.symbol}
                        href={`/asset/${encodeURIComponent(a.symbol)}`}
                        className="group flex items-center gap-3 rounded-[14px] border border-hairline bg-surface-1 px-4 py-3 transition-colors duration-300 hover:border-outline"
                      >
                        <TokenIcon
                          mint={a.mint}
                          symbol={displaySymbol(a.symbol)}
                          klass={a.class}
                          size={28}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block font-mono text-[13px] font-medium text-text">
                            {displaySymbol(a.symbol)}
                          </span>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-medium",
                                m.badgeClass,
                              )}
                            >
                              {m.label}
                            </span>
                            <span
                              className={cn(
                                "font-mono text-[10px] tabular-nums",
                                spreadSignClass(bps),
                              )}
                            >
                              {bps != null
                                ? formatGap(-bps)
                                : "-"}
                            </span>
                          </div>
                        </div>
                        <span aria-hidden className="text-text-caption transition-colors group-hover:text-text">→</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* Heatmap — summary above the timeline */}
          <section className="mb-12">
            <h2 className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
              52-week heatmap
            </h2>
            <p className="mb-3 text-[12px] text-text-caption/80">
              Each cell is one day. Intensity reflects the number of state transitions.
            </p>
            <EventsHeatmap buckets={heatmapBuckets} />
          </section>

          {/* Timeline */}
          {isLoading && !backendDown && (
            <div className="grid gap-10">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="grid gap-2">
                  <div className="h-3 w-24 animate-pulse bg-text-muted/15" />
                  <div className="mt-3 h-5 w-40 animate-pulse bg-text-muted/15" />
                  <div className="mt-1 h-3 w-64 animate-pulse bg-text-muted/10" />
                </div>
              ))}
            </div>
          )}

          {backendDown && (
            <div role="status" aria-live="polite">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
                ● Live feed unreachable
              </p>
              <p className="mt-3 max-w-[480px] text-[14px] leading-[1.6] text-text-muted">
                The Pegana API isn&apos;t responding right now, so the event
                timeline can&apos;t load. It will reappear automatically as soon
                as the feed is healthy.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => mutate()}
                  className="inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
                >
                  Retry now
                </button>
                <Link
                  href="/status"
                  className="inline-flex items-center rounded-full border border-hairline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption transition-colors duration-300 hover:border-outline hover:text-text"
                >
                  Check status
                </Link>
              </div>
            </div>
          )}

          {!isLoading && !backendDown && clusters.length === 0 && (
            // A quiet feed is the healthy default (few peg events = markets
            // calm), so the genuinely-empty case is framed as reassurance,
            // not as a dead end — distinct from the filtered-empty case,
            // which is just "loosen your filters" and stays neutral-toned.
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-4 rounded-[16px] border border-hairline px-6 py-16 text-center"
            >
              {filtersActive ? (
                <>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline text-text-caption">
                    <ListFilter className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[15px] font-medium text-text">
                      No events match these filters.
                    </p>
                    <p className="mt-1.5 max-w-[42ch] text-[13px] leading-[1.6] text-text-muted">
                      Try a different class or severity, or clear the filters to
                      see the full feed.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setClassFilter("all");
                      setSeverityFilter("all");
                    }}
                    className="mt-1 inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-st-pegged/30 bg-st-pegged/10 text-st-pegged">
                    <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                  </span>
                  <div>
                    <p className="text-[15px] font-medium text-text">
                      No peg events in this window.
                    </p>
                    <p className="mt-1.5 max-w-[46ch] text-[13px] leading-[1.6] text-text-muted">
                      Every tracked asset held its peg. A quiet feed is the
                      healthy default.
                    </p>
                  </div>
                  <Link
                    href="/audit"
                    className="mt-1 inline-flex items-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
                  >
                    Every event here has a verifiable receipt →
                  </Link>
                </>
              )}
            </div>
          )}

          {clusters.length > 0 && (
            // Grouped under Today / Yesterday / This week / Earlier headers
            // (Linear inbox / Vercel activity-log idiom) — each bucket keeps
            // its own continuous spine (the `before:` line + `-left-[30px]`
            // dots ported from the V2 changelog timeline), so a bucket still
            // reads as one unbroken timeline rather than a disconnected box.
            <div ref={pagination.anchorRef} className="grid gap-10">
              {BUCKET_ORDER.map(({ key, label }) => {
                const items = bucketedClusters[key];
                if (items.length === 0) return null;
                const eventCount = items.reduce((s, c) => s + c.alerts.length, 0);
                return (
                  <section key={key}>
                    <h2 className="mb-4 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
                      <span>{label}</span>
                      <span className="text-text-caption/60">{eventCount} {eventCount === 1 ? "event" : "events"}</span>
                    </h2>
                    <ol className="relative grid gap-10 pl-6 sm:pl-8 before:absolute before:left-[3px] before:top-[6px] before:bottom-0 before:w-px before:bg-hairline">
                      {items.map(renderCluster)}
                    </ol>
                  </section>
                );
              })}
            </div>
          )}

          <Pagination state={pagination} ariaLabel="Event pages" className="mt-10 pt-6" />
        </div>
      </section>
    </main>
  );
}

/** V5 pill-tab filter track — one rounded-full border container with
 *  individual rounded-full option buttons (the /assets class-filter idiom),
 *  reused for both the desktop rail and the mobile row. `scroll` swaps the
 *  wrap behavior for a horizontally-scrolling strip on narrow viewports. */
function FilterPillGroup<T extends string>({
  label,
  options,
  active,
  onChange,
  scroll = false,
}: {
  label: string;
  options: ReadonlyArray<{
    value: T;
    label: string;
    count: number | null;
    swatch?: string;
  }>;
  active: T;
  onChange: (v: T) => void;
  scroll?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        {label}
      </div>
      <div
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-hairline p-1",
          scroll
            ? "max-w-full overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "flex-wrap",
        )}
      >
        {options.map((o) => {
          const isActive = active === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200",
                isActive
                  ? "bg-text text-canvas"
                  : "text-text-muted hover:text-text",
              )}
            >
              {o.swatch && (
                <span
                  aria-hidden
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ background: o.swatch }}
                />
              )}
              {o.label}
              <span
                className={cn(
                  "tabular-nums",
                  isActive ? "text-canvas/70" : "text-text-caption",
                )}
              >
                {/* `-` is this repo's data-null convention (see dashSafe).
                    Printing 0 here asserted a count we did not have. */}
                {o.count ?? "-"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
