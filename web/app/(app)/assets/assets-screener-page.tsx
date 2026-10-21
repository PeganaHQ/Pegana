"use client";

import { isRateLimited } from "@/lib/api/client";
import { RATE_LIMITED_BODY, RATE_LIMITED_LABEL } from "@/lib/api/rate-limit-copy";
import { Suspense, useEffect, useRef } from "react";
import Link from "@/components/atoms/intent-link";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { Counter } from "@/components/atoms/counter";
import { PillTabs } from "@/components/molecules/pill-tabs";
import {
  AssetsScreenerHead,
  AssetsScreenerMobileCard,
  AssetsScreenerMobileSkeletonCard,
  AssetsScreenerRow,
  AssetsScreenerSkeletonRow,
} from "@/components/organisms/assets-screener-row";
import { useScreenerState, CLASS_TABS } from "@/lib/hooks/use-screener-state";
import { usePagination } from "@/lib/hooks/use-pagination";
import { Pagination } from "@/components/molecules/pagination";
import { cn } from "@/lib/utils/cn";

// Universe screener — desktop board migrated from a CSS-grid row to the same
// approved <table>/<colgroup> mechanic as the dashboard's board (craft pass
// 2026-07-11, tokens.xyz teardown — see assets-screener-row.tsx's header
// comment for the full rationale). This file now only orchestrates: hero,
// controls (PillTabs class filter + search), the mobile sort-pill row, and
// switching between the mobile card list / desktop table — the row markup
// itself lives in assets-screener-row.tsx (same split as
// page.tsx/dashboard-board-row.tsx).

function AssetsScreener() {
  const screener = useScreenerState();
  const {
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
    rows,
  } = screener;

  const searchRef = useRef<HTMLInputElement | null>(null);

  // Client-side pagination — 25 rows/page, through the shared hook: clamping,
  // reset-on-shuffle, `?page=` in the URL, the scroll-back-to-the-table and the
  // animated swap all come from there rather than being re-derived here.
  const pagination = usePagination({
    items: rows,
    pageSize: 25,
    resetKey: `${classFilter}|${search}|${sortKey}|${sortDir}`,
    itemNoun: "asset",
  });
  const pagedRows = pagination.pageItems;

  // `/` focuses the filter box; Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const backendDown = !!error && !assets;

  return (
    <main className="mx-auto max-w-[1280px] px-5 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-10 sm:px-8 sm:pb-24 sm:pt-14 lg:px-12 xl:px-20">
      {/* sr-only sort announcer — speaks "Sorted by X, ascending" on every
          re-sort so non-sighted users hear the ranking change (a11y P1). */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {sortAnnounce}
      </div>

      {/* Compact app-density PageHero — eyebrow + title + one-line lede +
          mono meta row. Not the marketing landing hero (DESIGN.md governs
          that surface separately); this is the V5 language at app density. */}
      <section className="pb-7 sm:pb-9">
        <span className="mb-3 inline-flex rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
          Universe
        </span>
        <h1 className="max-w-[46ch] text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
          Every pegged asset Pegana monitors, ranked by risk.
        </h1>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-text-body sm:text-[15px]">
          Sort by how close each sits to its own depeg line, how steadily
          it&rsquo;s held, and its structural safety. Click any row for the full
          spread history, alerts, and mechanism analysis.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-text-caption">
          <span className={assets ? "text-st-pegged" : undefined}>
            <span aria-hidden>&#9679;</span>{" "}
            {assets ? (
              <>
                {/* Ramps once on mount, then subsequent values (SWR refresh
                    every 60s, WS ticks) land instantly. A counter that
                    re-ramps on every poll is a distraction, not feedback, and
                    on a live dashboard it never stops moving. Instant under
                    reduced motion. */}
                <Counter target={total} /> assets tracked live
              </>
            ) : (
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-28 animate-pulse rounded-full bg-text/[0.06] align-middle"
              />
            )}
          </span>
          {assets && atRisk > 0 && (
            <span>
              <Counter target={atRisk} /> in drift or worse
            </span>
          )}
        </div>
      </section>

      {/* Controls: class filter (shared PillTabs, FLIP-spring indicator) +
          search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline py-4 sm:py-5">
        <PillTabs
          items={CLASS_TABS}
          value={classFilter}
          onChange={setClassFilter}
          ariaLabel="Filter by asset class"
        />
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  e.currentTarget.blur();
                }
              }}
              aria-label="Filter assets by symbol, name, or class"
              placeholder="Filter assets"
              className="h-8 w-[150px] rounded-full border border-outline bg-transparent pl-3.5 pr-7 font-mono text-[11px] text-text transition-[width] placeholder:text-text-caption focus:w-[190px] focus:border-text focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-caption">
              /
            </kbd>
          </div>
          <Link
            href="/compare"
            className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text sm:inline-flex"
          >
            Compare <IconArrowRight size={10} />
          </Link>
        </div>
      </div>

      {/* Mobile sort — the desktop column headers are hidden on phones, so
          without this a ?sort= URL silently reorders by an invisible signal. */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:hidden">
        {(
          [
            ["spread", "Spread"],
            ["band", "→ depeg"],
            ["jitter", "Stability"],
            ["safety", "Safety"],
            ["marketCap", "Mkt cap"],
            ["state", "State"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(key)}
            aria-pressed={sortKey === key}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] transition-colors",
              sortKey === key
                ? "border-text bg-text text-canvas"
                : "border-outline text-text-muted hover:border-text hover:text-text",
            )}
          >
            {label}
            {sortKey === key && (
              <span className="text-[9px]">
                {sortDir === "desc" ? "▼" : "▲"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body — real <table>/<colgroup> board (desktop) + a separate sibling
          card list (mobile), inside the same V5 card chrome as the
          dashboard's board (surface-1, r20, hairline divide). The two
          responsive variants are separate DOM, never one inside the other's
          colSpan cell — see assets-screener-row.tsx's header comment for
          why (the mobile-scroll regression the dashboard board already
          fixed once). */}
      {isLoading && !backendDown ? (
        <div
          className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1"
        >
          <div className="divide-y divide-hairline-soft sm:hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <AssetsScreenerMobileSkeletonCard key={i} />
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table
              aria-label="Loading assets"
              className="w-full min-w-[1342px] table-fixed border-collapse text-left"
            >
              <thead>
                <tr>
                  {["Asset", "State", "Discount", "Class", "Liquidity", "Updated"].map(
                    (label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-soft">
                {Array.from({ length: 8 }).map((_, i) => (
                  <AssetsScreenerSkeletonRow key={i} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : backendDown ? (
        <ScreenerBackendDown
          onRetry={() => mutate()}
          rateLimited={isRateLimited(error)}
        />
      ) : rows.length === 0 ? (
        <div className="py-16 text-center font-mono text-[12px] text-text-muted">
          {search.trim()
            ? `No assets match “${search.trim()}”.`
            : "No assets match this filter."}
          {/* A way back. The empty state named the query and then left the
              reader to find the input and clear it by hand — the one screen
              where every row has vanished is the worst place to withhold the
              undo. /events offers this on its equivalent state. */}
          {(search.trim() !== "" || classFilter !== "all") && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setClassFilter("all");
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-outline px-4 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 ease-default hover:border-text hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-muted"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={pagination.anchorRef}
          className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1"
        >
            <div className="divide-y divide-hairline-soft sm:hidden">
              {pagedRows.map((row) => (
                <AssetsScreenerMobileCard key={row.a.symbol} row={row} />
              ))}
            </div>
            <div
              data-scroll-contain
              className="hidden overflow-x-auto sm:block"
            >
              <table
                aria-label="Universe screener, sortable"
                className="w-full min-w-[1342px] table-fixed border-collapse text-left"
              >
                <AssetsScreenerHead
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                />
                <tbody className="divide-y divide-hairline-soft">
                  {pagedRows.map((row) => (
                    <AssetsScreenerRow key={row.a.symbol} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
        </div>
      )}

      <Pagination state={pagination} ariaLabel="Screener pages" />
    </main>
  );
}

function ScreenerBackendDown({
  onRetry,
  rateLimited = false,
}: {
  onRetry: () => void;
  rateLimited?: boolean;
}) {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
        ● {rateLimited ? RATE_LIMITED_LABEL : "Live feed unreachable"}
      </p>
      <p className="mx-auto mt-3 max-w-[360px] text-[13px] leading-[1.6] text-text-muted">
        {rateLimited ? (
          RATE_LIMITED_BODY
        ) : (
          <>
            The Pegana API isn&apos;t responding right now. Assets will reappear
            automatically as soon as it&apos;s healthy.
          </>
        )}
      </p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onRetry}
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
  );
}

export function AssetsScreenerPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <AssetsScreener />
    </Suspense>
  );
}
