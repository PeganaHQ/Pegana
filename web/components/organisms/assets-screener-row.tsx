"use client";

import Link from "@/components/atoms/intent-link";
import { memo, type ReactNode } from "react";
import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TokenIcon, assetMorphName } from "@/components/atoms/token-icon";
import { StatePip } from "@/components/atoms/state-pip";
import { BandGauge } from "@/components/atoms/band-gauge";
import { Sparkline } from "@/components/atoms/sparkline";
import { MonitoringBadge } from "@/components/molecules/monitoring-badge";
import { SustainedBadge } from "@/components/molecules/sustained-badge";
import { HelpIcon } from "@/components/atoms/help-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  formatGap,
  formatJitterPct,
  formatMarketCapUsd,
  cleanSeries,
} from "@/lib/api/format";
import {
  spreadSignClass } from "@/lib/state-class";
import { isCollateralRatioThresholds, thresholdsFor } from "@/lib/alerts/policy";
import { JITTER_COLOR, SAFETY_COLOR } from "@/lib/asset/row-color";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  CLASS_LABEL,
  type ScreenerRow as Row,
  type SortKey,
  type SortDir,
} from "@/lib/hooks/use-screener-state";
import type { PegState } from "@/lib/api/types";

// Universe screener board — the SAME approved <table>/<colgroup> mechanic as
// the dashboard's board (see dashboard-board-row.tsx's header comment for
// the full rationale + the tokens.xyz teardown citation this all traces
// back to): real <table table-fixed>, an explicit <colgroup> pinning every
// column width ONCE, and th/td padding mirrored from ONE shared map
// (SCREENER_COL_PAD) so a header label and its column's cells can never
// drift out of alignment with each other. Same V5 card chrome as the
// dashboard board too (surface-1, r20, header band bg-surface-2/60, 64px
// rows, hairline divide, full-bleed hover veil).
//
// Differs from the dashboard board in two ways, both deliberate:
//  1. More columns (8 data cols — Asset · Market cap · Spread · Depeg ·
//     Stability · Safety · 24h · State) — this is the deep/sortable surface;
//     the dashboard is a fixed worst-first ranking with no column sort at
//     all. Both tables share the same visual treatment (no "→" prefix on
//     Depeg, no trailing arrow column, centered Safety grade with no
//     per-row "heuristic" caption, compact h-14 rows) so the pair reads as
//     one system. Market cap sits right after Asset, deliberately OUTSIDE
//     the Spread/Depeg/Stability/Safety risk cluster — it's a size/context
//     signal (circulating_supply × price), never a peg-safety one, and
//     `compareWorstFirst`'s default worst-first ranking never reads it. It's
//     independently sortable (its own `?sort=marketCap`) but null (pre-
//     backend-migration) rows always sink to the bottom regardless of
//     direction — see `use-screener-state.ts`'s `marketCap` case.
//  2. Sortable headers: each sortable <th> wraps a <button> (tokens.xyz's
//     own pattern — chevrons-up-down -> a solid chevron on activation) BUT
//     fixes their one real a11y gap (walk.md §6 "NÃO COPIAR" #2): the <th>
//     itself carries `aria-sort="ascending"|"descending"` when active, and
//     the screener's existing sr-only announcer (unchanged, in page.tsx)
//     keeps speaking "Sorted by X, ascending." on every click.
//
// No dedicated "Class" column — the class label moves into the Asset cell's
// muted second line instead (mirrors what the mobile card already showed),
// freeing width for the columns that carry live risk signal. `?sort=class`
// remains a valid URL value (use-screener-state is untouched) even though no
// header button currently targets it — only the UI entry point for that one
// column is gone, not the sort key.
export const SCREENER_COL_PAD = {
  asset: "pl-5 pr-3",
  marketCap: "px-4",
  spread: "px-4",
  band: "px-4",
  jitter: "px-4",
  safety: "px-4",
  spark: "px-4",
  state: "px-4",
} as const;

const HEADER_CELL =
  "py-3 font-mono text-[10px] uppercase tracking-[0.08em] whitespace-nowrap text-text-caption";

function sparkStroke(state: PegState): string {
  return state === "PEGGED"
    ? "var(--color-st-pegged)"
    : state === "DRIFT"
      ? "var(--color-st-drift)"
      : "var(--color-st-depeg)";
}

/** Capitalized state pill (canonical stateMeta) — the explicit, readable
 *  state readout at the row's end. The quiet StatePip dot beside the symbol
 *  stays too (glance-speed signal); this is the named, Capitalized one
 *  (brand.md: state labels always Capitalized). */
function StatePillCell({
  state,
  className,
}: {
  state: PegState;
  className?: string;
}) {
  const m = stateMeta(state);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium",
        m.badgeClass,
        className,
      )}
    >
      <StatePip state={state} pulse={state !== "PEGGED"} size={5} />
      {m.label}
    </span>
  );
}

// <colgroup> + <thead>, shipped as one component so the column count/order
// and the header labels naming those columns can never drift apart (same
// discipline as DashboardBoardHead).
export function AssetsScreenerHead({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <>
      <colgroup>
        <col className="w-[28%]" />
        <col className="w-[156px]" />
        <col className="w-[104px]" />
        <col className="w-[170px]" />
        <col className="w-[110px]" />
        <col className="w-[96px]" />
        <col className="w-[170px]" />
        <col className="w-[128px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-hairline bg-surface-2/60">
          <SortableTh
            label="Asset"
            k="symbol"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            pad={SCREENER_COL_PAD.asset}
          />
          <SortableTh
            label="Market cap"
            k="marketCap"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
            pad={SCREENER_COL_PAD.marketCap}
            help={
              <HeaderHint label="Column definition: Market cap">
                Circulating supply × price, a size signal, not a peg-safety
                signal.
              </HeaderHint>
            }
          />
          <SortableTh
            label="Spread"
            k="spread"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
            pad={SCREENER_COL_PAD.spread}
          />
          <SortableTh
            // "Band", not "Depeg". This column is a 0-100% PROXIMITY gauge,
            // while the State column in the SAME ROW can literally read "Depeg"
            // as one of the five peg states — so one row showed the word twice
            // meaning two unrelated things, distinguishable only by hovering a
            // tooltip. The internal sort key was already `band`; the header now
            // matches it.
            label="Band"
            k="band"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
            pad={SCREENER_COL_PAD.band}
            help={
              <HeaderHint label="Column definition: Depeg">
                Proximity to each asset&apos;s own depeg threshold
              </HeaderHint>
            }
          />
          <SortableTh
            label="Stability"
            k="jitter"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
            pad={SCREENER_COL_PAD.jitter}
            help={<HelpIcon term="peg_stability" size="xs" side="top" />}
          />
          <SortableTh
            label="Safety"
            k="safety"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="center"
            pad={SCREENER_COL_PAD.safety}
            help={
              <HeaderHint label="Column definition: Safety">
                Heuristic structural grade (not a live verdict)
              </HeaderHint>
            }
          />
          {/* 24h sparkline — not a scalar, so (like tokens.xyz's own
              disabled "Last 24h" header) it gets a plain label, no sort
              button. */}
          <th
            scope="col"
            className={cn(HEADER_CELL, "text-center", SCREENER_COL_PAD.spark)}
          >
            24h
          </th>
          <SortableTh
            label="State"
            k="state"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
            pad={SCREENER_COL_PAD.state}
          />
        </tr>
      </thead>
    </>
  );
}

function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  pad,
  help,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right" | "center";
  pad: string;
  /** Optional column-definition affordance (HelpIcon or a bare Tooltip),
   *  rendered next to the label — never inside the sort <button> itself, so
   *  the sort click target stays clean and separately focusable. */
  help?: ReactNode;
}) {
  const active = sortKey === k;
  // The a11y fix tokens.xyz's own board doesn't have (walk.md §6 "NÃO
  // COPIAR" #2): aria-sort lives on the <th> itself, not just an aria-label
  // on the button, so assistive tech gets the standard grid-sort signal.
  const ariaSort = active
    ? sortDir === "asc"
      ? ("ascending" as const)
      : ("descending" as const)
    : undefined;
  const button = (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Sort by ${label}${active ? `, currently ${sortDir === "desc" ? "descending" : "ascending"}` : ""}`}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-text",
        !help && "w-full",
        align === "right"
          ? "justify-end"
          : align === "center"
            ? "justify-center"
            : "justify-start",
        active && "text-text",
      )}
    >
      {label}
      {active ? (
        sortDir === "asc" ? (
          <ChevronUp size={11} aria-hidden />
        ) : (
          <ChevronDown size={11} aria-hidden />
        )
      ) : (
        <ChevronsUpDown size={11} className="opacity-40" aria-hidden />
      )}
    </button>
  );
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        HEADER_CELL,
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
        pad,
      )}
    >
      {help ? (
        <span
          className={cn(
            "inline-flex w-full items-center gap-1",
            align === "right"
              ? "justify-end"
              : align === "center"
                ? "justify-center"
                : "justify-start",
          )}
        >
          {button}
          {help}
        </span>
      ) : (
        button
      )}
    </th>
  );
}

// Non-glossary column-definition hint — same visual affordance as HelpIcon
// (a small hoverable/focusable "?" chip) but for definitions that aren't
// worth a glossary entry. Keyboard/touch reachable (real <button>), unlike
// the native `title=` it replaces.
function HeaderHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="ml-1 inline-flex h-[18px] min-w-[18px] shrink-0 cursor-help items-center justify-center rounded-full bg-text/[0.08] px-1 align-middle font-mono text-[11px] leading-none text-text-muted transition-colors duration-200 hover:bg-text/[0.16] hover:text-text lg:h-4 lg:min-w-4 lg:text-[9px]"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{children}</TooltipContent>
    </Tooltip>
  );
}

// One skeleton <tr> at the real 64px row height — mirrors
// DashboardBoardSkeletonRow (single pulse bar at the real row height, inside
// the SAME <table>/<colgroup> as the live rows).
export function AssetsScreenerSkeletonRow() {
  return (
    <tr className="h-14">
      <td
        colSpan={8}
        className={cn("py-0 align-middle", SCREENER_COL_PAD.asset)}
      >
        <div className="h-3 w-2/3 max-w-[360px] animate-pulse rounded-full bg-text/[0.06]" />
      </td>
    </tr>
  );
}

// Mobile's skeleton placeholder — same silhouette as
// AssetsScreenerMobileCard, a plain sibling <div> (not inside the desktop
// table's colSpan cell — same split as DashboardBoardMobileSkeletonCard, for
// the same table-fixed/colgroup reason documented on that component).
export function AssetsScreenerMobileSkeletonCard() {
  return (
    <div className="px-4 py-3">
      <div className="h-3 w-2/3 max-w-[220px] animate-pulse rounded-full bg-text/[0.06]" />
    </div>
  );
}

// Mobile card — same content/paridade the pre-table row always had (band
// gauge, sparkline, stability, safety all present, per the "paridade
// mobile" crown jewel), but living in its own sibling list, NEVER inside a
// colSpan cell of the desktop `<table table-fixed>` — the exact mobile
// horizontal-scroll regression the dashboard board already fixed once (see
// DashboardBoardMobileCard's header comment): a table-fixed table's
// <colgroup> pins the table to its fixed column widths at every viewport,
// so a mobile card smuggled through a colSpan cell is forced to that width
// and scrolls sideways with its right half off-screen.
export function AssetsScreenerMobileCard({ row }: { row: Row }) {
  const { a, state, bps, jitter, jLabel, safety, marketCapUsd } = row;
  const t = thresholdsFor(a.symbol, a.class, a.thresholds);
  const sparkBps = a.series_24h
    ? cleanSeries(a.series_24h).map((v) => v * 10000)
    : [];
  const hasSpark = sparkBps.length > 1;
  return (
    <Link
      href={`/asset/${encodeURIComponent(a.symbol)}`}
      data-vt="nav-forward"
      className="block px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Morphs into the asset hero's mark. Safe to name both this card
              icon and the desktop cell's below: the two halves are toggled
              with `display: none` and an element with no box is never
              captured, so only one is ever a rendered holder of this name. */}
          <TokenIcon
            mint={a.mint}
            symbol={displaySymbol(a.symbol)}
            klass={a.class}
            size={24}
            morphName={assetMorphName(a.symbol)}
          />
          <StatePip
            state={state}
            pulse={state !== "PEGGED"}
            size={6}
            announce
          />
          <span className="truncate text-[15px] font-medium text-text">
            {displaySymbol(a.symbol)}
          </span>
          <span className="shrink-0 rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-text-caption">
            {CLASS_LABEL[a.class] ?? a.class}
          </span>
          {a.monitoring_only && (
            <MonitoringBadge
              reason={a.monitoring_reason}
              since={a.monitoring_since}
              className="shrink-0"
            />
          )}
          {a.sustained && (
            <SustainedBadge
              state={a.state}
              durationSecs={a.current_state_duration_secs}
              sustained={a.sustained}
              className="shrink-0"
            />
          )}
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[16px] font-medium tabular-nums",
            bps == null ? "text-text-muted" : spreadSignClass(bps),
          )}
        >
          {/* Holder convention: `bps` follows reconcileBps (positive =
              discount, negative = premium) — negate for display so `+` =
              premium, `−` = discount (matching /lst + the hero board). */}
          {bps != null ? formatGap(-bps) : "-"}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <p className="truncate text-[12px] text-text-muted">{a.name}</p>
        <StatePillCell state={state} className="shrink-0" />
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <div className="flex-1">
          <BandGauge
            bps={bps}
            thresholds={t}
            state={state}
            klass={a.class}
            crBand={isCollateralRatioThresholds(a.thresholds)}
          />
        </div>
        {hasSpark && (
          <Sparkline
            points={sparkBps}
            height={24}
            showFill={false}
            stroke={sparkStroke(state)}
            thresholdBps={t.depeg_bps}
            className="w-16 shrink-0 opacity-80"
          />
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.06em]">
        {jitter != null && jLabel !== "unknown" && (
          <span className="text-text-caption">
            stability{" "}
            <span className={JITTER_COLOR[jLabel]}>
              {jLabel} {formatJitterPct(jitter)}
            </span>
          </span>
        )}
        <span className="text-text-caption">
          safety{" "}
          <span className={SAFETY_COLOR[safety] ?? "text-text-muted"}>
            {safety}
          </span>
        </span>
        {/* Size/context signal, deliberately uncolored (never risk-coded) —
            see the header comment's rationale for why this sits outside the
            stability/safety cluster above. */}
        <span className="text-text-caption">
          mkt cap{" "}
          <span className="text-text-muted">
            {formatMarketCapUsd(marketCapUsd)}
          </span>
        </span>
      </div>
    </Link>
  );
}

export const AssetsScreenerRow = memo(function AssetsScreenerRow({
  row,
}: {
  row: Row;
}) {
  const { a, state, bps, jitter, jLabel, safety, marketCapUsd } = row;
  const t = thresholdsFor(a.symbol, a.class, a.thresholds);
  const sparkBps = a.series_24h
    ? cleanSeries(a.series_24h).map((v) => v * 10000)
    : [];
  const hasSpark = sparkBps.length > 1;
  const href = `/asset/${encodeURIComponent(a.symbol)}`;

  return (
    <tr
      className={cn(
        // transition ONLY background-color, not border-color — same fix as the
        // dashboard board row: `transition-colors` fades the Tailwind v4
        // `divide-y` divider (a border-BOTTOM defaulting to near-white
        // currentColor) from white to white/[0.04] over 150ms when rows
        // reorder on filter/sort, flashing a white line. Scoping to
        // background-color snaps the divider instantly. See dashboard-board-row.
        "group relative h-14 transition-[background-color] duration-150",
        "hover:bg-surface-2/50 has-[a:focus-visible]:bg-surface-2/50",
      )}
    >
      <td className={cn("h-14 py-0 align-middle", SCREENER_COL_PAD.asset)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <StatePip
            state={state}
            pulse={state !== "PEGGED"}
            size={6}
            announce
          />
          <TokenIcon
            mint={a.mint}
            symbol={displaySymbol(a.symbol)}
            klass={a.class}
            size={20}
            morphName={assetMorphName(a.symbol)}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {/* Stretched-link row (same mechanic as the dashboard board):
                  `after:inset-0` stretches an invisible pseudo-element to
                  the nearest positioned ancestor — this <tr> (`relative`) —
                  so the ENTIRE row is one click target while the <a> itself
                  stays position:static. */}
              <Link
                href={href}
                data-vt="nav-forward"
                className={cn(
                  "truncate text-[15px] font-medium text-text",
                  "after:absolute after:inset-0 after:content-['']",
                  "focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-outline",
                )}
              >
                {displaySymbol(a.symbol)}
              </Link>
              {a.monitoring_only && (
                <MonitoringBadge
                  reason={a.monitoring_reason}
                  since={a.monitoring_since}
                  className="shrink-0"
                />
              )}
              {a.sustained && (
                <SustainedBadge
                  state={a.state}
                  durationSecs={a.current_state_duration_secs}
                  sustained={a.sustained}
                  className="shrink-0"
                />
              )}
            </div>
            <div className="truncate text-[12px] text-text-muted">
              {a.name}
              {/* Class label lives here (no dedicated column — see this
                  file's header comment) so the info survives without
                  spending one of the 8 column slots on it. */}
              <span className="ml-1.5 text-text-caption">
                · {CLASS_LABEL[a.class] ?? a.class}
              </span>
            </div>
          </div>
        </div>
      </td>

      <td
        className={cn(
          "h-14 py-0 align-middle text-right",
          SCREENER_COL_PAD.marketCap,
        )}
      >
        {/* Size/context signal only — deliberately quiet (muted, uncolored,
            never risk-coded) so it doesn't compete with the Spread column's
            live risk signal right next to it. Degrades to "—" until the
            backend backfills `market_cap` (null today for every asset). */}
        <span className="font-mono text-[12px] tabular-nums text-text-muted">
          {formatMarketCapUsd(marketCapUsd)}
        </span>
      </td>

      <td
        className={cn(
          "h-14 py-0 align-middle text-right",
          SCREENER_COL_PAD.spread,
        )}
      >
        <span
          className={cn(
            "font-mono text-[13px] font-medium tabular-nums",
            bps == null ? "text-text-muted" : spreadSignClass(bps),
          )}
        >
          {/* Holder convention: `bps` follows reconcileBps (positive =
              discount, negative = premium) — negate for display so `+` =
              premium, `−` = discount (matching /lst + the hero board). */}
          {bps != null ? formatGap(-bps) : "-"}
        </span>
      </td>

      <td className={cn("h-14 py-0 align-middle", SCREENER_COL_PAD.band)}>
        <BandGauge
          bps={bps}
          thresholds={t}
          state={state}
          klass={a.class}
          crBand={isCollateralRatioThresholds(a.thresholds)}
        />
      </td>

      <td
        className={cn(
          "h-14 py-0 align-middle text-right",
          SCREENER_COL_PAD.jitter,
        )}
      >
        {jitter != null && jLabel !== "unknown" ? (
          <div
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.06em]",
              JITTER_COLOR[jLabel],
            )}
          >
            {jLabel}
            <span className="ml-1 text-[10px] tabular-nums text-text-caption">
              {formatJitterPct(jitter)}
            </span>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-text-muted">-</span>
        )}
      </td>

      <td
        className={cn(
          "h-14 py-0 align-middle text-center leading-none",
          SCREENER_COL_PAD.safety,
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A <button>, not a <span>: this badge's tooltip carries the caveat that
            stops the number beside it from being over-trusted, and a bare <span>
            is not focusable, so Radix's asChild trigger never fires onFocus —
            the caveat was mouse-only. `align-middle` is required on the button
            (the span never needed it) or the taller inline-block box shifts the
            row height. */}
            <button
              type="button"
              className={cn(
                "cursor-help align-middle font-mono text-[13px] font-medium",
                SAFETY_COLOR[safety] ?? "text-text-muted",
              )}
            >
              {safety}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Heuristic structural grade (class + liquidity), not a live verdict
          </TooltipContent>
        </Tooltip>
      </td>

      <td className={cn("h-14 py-0 align-middle", SCREENER_COL_PAD.spark)}>
        <div className="flex h-8 items-center">
          {hasSpark ? (
            <Sparkline
              points={sparkBps}
              height={28}
              showFill={false}
              stroke={sparkStroke(state)}
              thresholdBps={t.depeg_bps}
              className="w-full opacity-80"
            />
          ) : (
            <span className="w-full text-center font-mono text-[10px] text-text-caption">
              -
            </span>
          )}
        </div>
      </td>

      <td
        className={cn(
          "h-14 py-0 align-middle text-right",
          SCREENER_COL_PAD.state,
        )}
      >
        <StatePillCell state={state} className="ml-auto" />
      </td>
    </tr>
  );
});
