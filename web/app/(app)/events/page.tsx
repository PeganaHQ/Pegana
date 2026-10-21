"use client";

import { isRateLimited } from "@/lib/api/client";
import {
  RATE_LIMITED_BODY,
  RATE_LIMITED_LABEL,
} from "@/lib/api/rate-limit-copy";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "@/components/atoms/intent-link";
import { Check, ListFilter } from "lucide-react";
import { PillTabs, type PillTabItem } from "@/components/molecules/pill-tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CLASS_TABS } from "@/lib/hooks/use-screener-state";
import { useAlertsWindow } from "@/lib/hooks/use-alerts";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive, useWsDrivenPage } from "@/lib/store/live-context";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import { Sparkline } from "@/components/atoms/sparkline";
import { EventsHeatmap } from "@/components/molecules/events-heatmap";
import { Pagination } from "@/components/molecules/pagination";
import { usePagination } from "@/lib/hooks/use-pagination";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  formatDayUS,
  formatGap,
  isDeprecated,
  reconcileBps,
} from "@/lib/api/format";
import {
  clusterAlerts,
  eventCounts,
  matchesEventFilters,
  retiredSymbols,
  type ClassFilter,
  type EventCluster,
  type SeverityFilter,
} from "@/lib/alerts/events";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AlertRow, PegState, AssetCardData } from "@/lib/api/types";
import { spreadSignClass } from "@/lib/state-class";

// /events: Linear-style transition log. One toolbar row above the timeline
// (the /dashboard idiom: two canonical PillTabs groups split by a hairline)
// carries the Class and Severity facets; the 52-week heatmap and the off-peg
// scoreboard open the page as a summary.

// 12px type floor for the canonical PillTabs on this page (the component's
// own label is 11px and its count 10px). Scoped here, not in the component,
// so the other call-sites are untouched.
const PILL_TYPE_FLOOR =
  "[&_button]:text-[12px] [&_button_span]:text-[12px] max-sm:[&_button]:gap-1 max-sm:[&_button]:px-2 max-sm:[&_button]:tracking-normal";

function classLabel(c: string): string {
  return c === "lst" ? "LST" : c.startsWith("stable_") ? "Stable" : "Retired";
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
  // The 52-week heatmap needs a full year. The /v1/audit ledger serves at most
  // 100 rows per page, so `useAlertsWindow` pages it server-side (`since` +
  // `before` cursor) until the window is exhausted or a 10-page cap is hit. If
  // the cap is hit, days at or before `coverageFloorDay` are drawn as "not
  // loaded", never as quiet days. Memoized so the SWR key does not thrash.
  const since = useMemo(
    () => new Date(Date.now() - 365 * MS_PER_DAY).toISOString(),
    [],
  );
  const {
    data: windowData,
    isLoading,
    error,
    mutate,
  } = useAlertsWindow({
    since,
    maxPages: 10,
  });
  const alerts = windowData?.rows;
  const coverageFloorDay = windowData?.coverageFloorDay ?? null;
  const { data: assets } = useAssets();
  const { byAsset } = useLive();
  useWsDrivenPage();
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
  // Every alert lands in exactly one class bucket and one severity bucket
  // (lib/alerts/events.ts), so each tab group sums to All. It used to drop
  // retired classes and recoveries into PEGGED, so 74+349+0 != 440.
  //
  // Class comes from the live asset universe, never from the row's own
  // `class`: the audit mapper stamps every row "unknown" when its /v1/assets
  // call fails (e.g. a 429), which used to file the whole year under "Other".
  // While the universe is unavailable the class facets read an en dash and are
  // disabled; an asset missing from a loaded universe is Retired.
  const universe = useMemo<Record<string, string> | null>(() => {
    if (!assets) return null;
    const m: Record<string, string> = {};
    for (const a of assets) m[a.symbol] = a.class;
    return m;
  }, [assets]);

  const { byClass: classCounts, bySeverity: severityCounts } = useMemo(
    () => eventCounts(alerts, universe),
    [alerts, universe],
  );
  const retired = useMemo(
    () => retiredSymbols(alerts, universe),
    [alerts, universe],
  );

  // Facet items. Empty buckets are hidden: Retired only when it holds
  // alerts; Recovered and Unknown only when they are not a confirmed 0.
  // Every alert still lands in exactly one bucket of each group, so the
  // visible tabs sum to All whenever a hidden tab is 0.
  const classItems: PillTabItem<ClassFilter>[] = [
    ...CLASS_TABS.map((c) => ({
      key: c.key,
      label: c.label,
      count: classCounts[c.key],
      disabled: c.key !== "all" && universe === null,
    })),
    ...((classCounts.retired ?? 0) > 0
      ? [
          {
            key: "retired" as const,
            label: "Retired",
            count: classCounts.retired,
          },
        ]
      : []),
  ];
  const severityItems: PillTabItem<SeverityFilter>[] = [
    { key: "all", label: "All", count: severityCounts.all },
    {
      key: "DRIFT",
      label: "Drift",
      count: severityCounts.DRIFT,
      swatch: stateMeta("DRIFT").dotVar,
    },
    {
      key: "DEPEG",
      label: "Depeg",
      count: severityCounts.DEPEG,
      swatch: stateMeta("DEPEG").dotVar,
    },
    {
      key: "CRITICAL",
      label: "Critical",
      count: severityCounts.CRITICAL,
      swatch: stateMeta("CRITICAL").dotVar,
    },
    ...(severityCounts.RECOVERED !== 0
      ? [
          {
            key: "RECOVERED" as const,
            label: "Recovered",
            count: severityCounts.RECOVERED,
            swatch: stateMeta("PEGGED").dotVar,
          },
        ]
      : []),
    ...(severityCounts.UNKNOWN !== 0
      ? [
          {
            key: "UNKNOWN" as const,
            label: "Unknown",
            count: severityCounts.UNKNOWN,
            swatch: stateMeta("UNKNOWN").dotVar,
          },
        ]
      : []),
  ];

  // The filter actually applied: a selection whose tab is hidden or disabled
  // (empty bucket, universe unavailable) falls back to All instead of
  // rendering a filtered view nobody can see the control for.
  const activeClass: ClassFilter = classItems.some(
    (i) => i.key === classFilter && !i.disabled,
  )
    ? classFilter
    : "all";
  const activeSeverity: SeverityFilter = severityItems.some(
    (i) => i.key === severityFilter,
  )
    ? severityFilter
    : "all";

  const clusters = useMemo(() => {
    const rows = [...liveRows, ...(alerts ?? [])];
    if (rows.length === 0) return [];
    const filtered = rows.filter((a) =>
      matchesEventFilters(a, activeClass, activeSeverity, universe),
    );
    return clusterAlerts(filtered, assetMap);
  }, [alerts, assetMap, activeClass, liveRows, activeSeverity, universe]);

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
    resetKey: `${activeClass}|${activeSeverity}`,
    // The unit the page copy defines: one row per asset per day.
    itemNoun: "row",
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

  const filtersActive = activeClass !== "all" || activeSeverity !== "all";

  // Timeline row — idiom ported from the V2 changelog spine (spine + dots +
  // type pills), adapted to app density — not the scoped `.pegana-v2`
  // component itself. Factored out of the flat `.map` so it can be reused
  // per time-bucket `<ol>` below without duplicating the row markup.
  function renderCluster(c: EventCluster) {
    const meta = assetMap[c.asset];
    const m = stateMeta(c.worst);
    // The row's own `class` is "unknown" whenever the audit mapper could not
    // reach /v1/assets, so resolve it from the universe; print nothing
    // rather than a guess while the universe is unavailable.
    const klass = meta ? classLabel(meta.class) : universe ? "Retired" : null;
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
            <span className="rounded-full border border-st-pegged/30 px-2 py-0.5 text-[12px] uppercase tracking-[0.08em] text-st-pegged">
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
            <h3 className="text-[22px] font-medium tracking-[-0.015em] text-text decoration-hairline decoration-1 underline-offset-[6px] group-hover:underline">
              {displaySymbol(c.asset)}
            </h3>
            {meta?.name && (
              <span className="text-[13px] text-text-muted">{meta.name}</span>
            )}
            {klass && (
              <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-text-caption">
                · {klass}
              </span>
            )}
            {/* Type pill — bordered chip colored by state, the
                worst transition of the day, Capitalized label. */}
            <span
              className={cn(
                "ml-auto inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] font-medium",
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
    // <main>, not <div>: the skip link and any "jump to content" affordance
    // target this landmark. Same shell geometry as /assets and /compare now
    // that the 248px filter rail is gone (pb handled by the app layout on
    // mobile; explicit on desktop).
    <main className="mx-auto w-full max-w-[1280px] px-5 pt-10 sm:px-8 sm:pt-14 lg:px-12 lg:pb-24 xl:px-20">
      {/* Compact app-density PageHero: eyebrow pill + h1 + one-line lede +
          mono meta row, the /assets and /compare pattern (12px floor). */}
      <section className="pb-7 sm:pb-9">
        <span className="mb-3 inline-flex rounded-full border border-hairline px-3 py-1 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-text-caption">
          Events
        </span>
        <h1 className="max-w-[46ch] text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
          Every depeg, replayable.
        </h1>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-text-body sm:text-[15px]">
          Each row is one asset on one day with at least one state transition,
          recoveries to Pegged included. Click into the asset for the exact
          spread chart.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px] text-text-caption">
          <span className="tabular-nums">
            {severityCounts.all == null
              ? "\u2013"
              : severityCounts.all.toLocaleString("en-US")}{" "}
            {severityCounts.all === 1 ? "transition" : "transitions"}{" "}
            {/* A capped paging run does not cover the full year; say where
                coverage starts instead of claiming 52 weeks. */}
            {coverageFloorDay
              ? `since ${formatDayUS(coverageFloorDay)}`
              : "in 52 weeks"}
          </span>
          <Link
            href="/audit"
            className="text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
          >
            Every event here has a verifiable receipt →
          </Link>
        </div>
      </section>

      <div>
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
              return (rank[a.state ?? ""] ?? 9) - (rank[b.state ?? ""] ?? 9);
            })
            .slice(0, 4);
          if (offPeg.length === 0) return null;
          return (
            <section className="mb-12">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.12em] text-text-caption">
                Currently off-peg · {offPeg.length}{" "}
                {offPeg.length === 1 ? "asset" : "assets"}
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
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[12px] font-medium",
                              m.badgeClass,
                            )}
                          >
                            {m.label}
                          </span>
                          <span
                            className={cn(
                              "font-mono text-[12px] tabular-nums",
                              spreadSignClass(bps),
                            )}
                          >
                            {bps != null ? formatGap(-bps) : "-"}
                          </span>
                        </div>
                      </div>
                      <span
                        aria-hidden
                        className="text-text-caption transition-colors group-hover:text-text"
                      >
                        →
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Heatmap — summary above the timeline */}
        <section className="mb-12">
          <h2 className="mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-text-caption">
            52-week heatmap
          </h2>
          <p className="mb-3 text-[12px] text-text-caption/80">
            Each cell is one day. Intensity reflects the number of state
            transitions.
          </p>
          <EventsHeatmap
            buckets={heatmapBuckets}
            unknownThroughDay={coverageFloorDay}
          />
        </section>

        {/* Toolbar: the /dashboard idiom. Class and Severity as two
              canonical PillTabs groups split by a hairline, one row on
              desktop; on a phone each group gets its own row and the wider
              Severity row scrolls under a right-edge fade. */}
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2">
          <ScrollFadeRow>
            <PillTabs
              items={classItems}
              value={activeClass}
              onChange={setClassFilter}
              ariaLabel="Event class filter"
              className={PILL_TYPE_FLOOR}
            />
            {retired.length > 0 && <RetiredHint symbols={retired} />}
          </ScrollFadeRow>
          <span
            aria-hidden
            className="hidden h-4 w-px shrink-0 bg-hairline sm:block"
          />
          <ScrollFadeRow>
            <PillTabs
              items={severityItems}
              value={activeSeverity}
              onChange={setSeverityFilter}
              ariaLabel="Event severity filter"
              className={PILL_TYPE_FLOOR}
            />
          </ScrollFadeRow>
        </div>

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
            <p
              className={`font-mono text-[12px] uppercase tracking-[0.08em] ${isRateLimited(error) ? "text-text-muted" : "text-st-drift"}`}
            >
              ●{" "}
              {isRateLimited(error)
                ? RATE_LIMITED_LABEL
                : "Live feed unreachable"}
            </p>
            <p className="mt-3 max-w-[480px] text-[14px] leading-[1.6] text-text-muted">
              {isRateLimited(error) ? (
                RATE_LIMITED_BODY
              ) : (
                <>
                  The Pegana API isn&apos;t responding right now, so the event
                  timeline can&apos;t load. It will reappear automatically as
                  soon as the feed is healthy.
                </>
              )}
            </p>
            {/* A slow-down request resumes on its own: no Retry button. */}
            {!isRateLimited(error) && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => mutate()}
                  className="inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[12px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
                >
                  Retry now
                </button>
                <Link
                  href="/status"
                  className="inline-flex items-center rounded-full border border-hairline px-4 py-2 font-mono text-[12px] uppercase tracking-[0.08em] text-text-caption transition-colors duration-300 hover:border-outline hover:text-text"
                >
                  Check status
                </Link>
              </div>
            )}
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
                  className="mt-1 inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[12px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
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
                    No public receipts for this window yet.
                  </p>
                  <p className="mt-1.5 max-w-[46ch] text-[13px] leading-[1.6] text-text-muted">
                    Live states are on the dashboard.
                  </p>
                </div>
                <Link
                  href="/audit"
                  className="mt-1 inline-flex items-center font-mono text-[12px] uppercase tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
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
              // Alerts, the same unit as the filter counts; the row count is
              // visible directly beneath.
              const alertCount = items.reduce((s, c) => s + c.alerts.length, 0);
              return (
                <section key={key}>
                  <h2 className="mb-4 flex items-baseline gap-3 font-mono text-[12px] uppercase tracking-[0.12em] text-text-caption">
                    <span>{label}</span>
                    <span className="text-text-caption/60">
                      {alertCount} {alertCount === 1 ? "alert" : "alerts"}
                    </span>
                  </h2>
                  <ol className="relative grid gap-10 pl-6 sm:pl-8 before:absolute before:left-[3px] before:top-[6px] before:bottom-0 before:w-px before:bg-hairline">
                    {items.map(renderCluster)}
                  </ol>
                </section>
              );
            })}
          </div>
        )}

        <Pagination
          state={pagination}
          ariaLabel="Event pages"
          className="mt-10 pt-6"
        />
      </div>
    </main>
  );
}

/** A horizontally scrollable row that fades its right edge only while more
 *  content sits past it, so a row that fits shows no fade at all. */
function ScrollFadeRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      data-fade={more ? "true" : "false"}
      className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={
        more
          ? {
              maskImage:
                "linear-gradient(to right, #000 calc(100% - 40px), transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, #000 calc(100% - 40px), transparent)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Accessible explainer for the Retired tab: which delisted assets the
 *  bucket holds. The button's own label carries the full list, so it reads
 *  the same with or without the hover/focus tooltip. */
function RetiredHint({
  symbols,
}: {
  symbols: ReadonlyArray<{ symbol: string; count: number }>;
}) {
  const list = symbols
    .map(
      (s) => `${displaySymbol(s.symbol)} (${s.count.toLocaleString("en-US")})`,
    )
    .join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Retired assets: ${list}. No longer on the public peg surface; their receipts stay in the ledger.`}
          className="inline-flex h-[22px] min-w-[22px] shrink-0 cursor-help items-center justify-center rounded-full bg-text/[0.08] px-1 font-mono text-[12px] leading-none text-text-muted transition-colors duration-200 hover:bg-text/[0.16] hover:text-text"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <div className="mb-1 font-mono text-[12px] uppercase tracking-[0.08em] text-text-muted">
          Retired
        </div>
        <ul className="grid gap-0.5">
          {symbols.map((s) => (
            <li key={s.symbol} className="flex justify-between gap-4">
              <span>{displaySymbol(s.symbol)}</span>
              <span className="font-mono tabular-nums text-text-muted">
                {s.count.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-text-muted">
          No longer on the public peg surface. Their receipts stay in the
          ledger.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
