"use client";

import Link from "@/components/atoms/intent-link";
import { memo, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SortKey, SortDir } from "@/lib/hooks/use-screener-state";
import { TokenIcon, assetMorphName } from "@/components/atoms/token-icon";
import { StatePip } from "@/components/atoms/state-pip";
import { BandGauge } from "@/components/atoms/band-gauge";
import { HelpIcon } from "@/components/atoms/help-icon";
import { SparklineCell } from "@/components/molecules/sparkline-cell";
import { MonitoringBadge } from "@/components/molecules/monitoring-badge";
import { SustainedBadge } from "@/components/molecules/sustained-badge";
import {
  CalibrationGauge,
  calibrationShownByBetaBadge,
} from "@/components/atoms/calibration-gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { stateMeta } from "@/lib/asset/state-meta";
import { JITTER_COLOR } from "@/lib/asset/row-color";
import { formatGap, formatJitterPct } from "@/lib/api/format";
import { severityTextClass, spreadSignClass } from "@/lib/state-class";
import { isCollateralRatioThresholds, thresholdsFor } from "@/lib/alerts/policy";
import { useTickFlash } from "@/lib/motion/use-tick-flash";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, PegState } from "@/lib/api/types";

// Command Center board — REAL <table> (craft pass 2026-07-11, "hover
// quadrado feio" + "colunas tortas" fix). The prior CSS-grid row (one grid
// template repeated per row, `gap-4`) never actually locked column edges:
// each row's SparklineCell/BandGauge could report a slightly different
// intrinsic width, so numbers/gauges drifted a few px left/right row to row
// and the header text never lined up with the cells beneath it — exactly the
// "board apertado, células tortas" complaint. tokens.xyz's own board is a
// literal HTML <table table-fixed> with an explicit <colgroup>: column widths
// are locked ONCE, by construction, and every cell (header or body) simply
// fills its column — they cannot drift apart because there is only one
// layout algorithm (the browser's table algorithm) instead of N independent
// flex/grid measurements. This file ports that mechanic, adapted to V5 dark
// (mono uppercase header labels, no sort — dashboard is worst-first fixed,
// not re-orderable).
//
// COLUMN CONTRACT — the single source of truth other files must not
// duplicate: <col> widths here (DashboardBoardHead) and the matching <td>
// padding in DashboardBoardRow both read from BOARD_COL_PAD, so a header
// label and its column's cells can never drift out of alignment with each
// other (the exact bug this rebuild fixes). Order: Asset (30%) · Spread
// (104px) · Depeg (170px) · Stability (110px) · Risk (84px, right) · 24h
// (170px) · State (128px). Risk is the live 0-100 peg-risk score (state-anchored,
// risk_score.rs) — it replaced the old static Safety heuristic here (Safety lives
// on the asset detail page now). The hover "→" arrow column was retired (Rafael) —
// the whole row is a stretched link, so it was never the click target anyway.
// The Market cap column is intentionally HIDDEN until the backend backfills
// `market_cap` (null for every asset today, so it rendered a full column of
// "—"). The colgroup/thead/desktop-row/mobile-card all drop it together so the
// real <table>'s column count stays consistent (per AGENTS.md). Restore all
// four sites in lockstep once `market_cap` is live.
export const BOARD_COL_PAD = {
  asset: "pl-5 pr-3",
  spread: "px-5",
  band: "px-5",
  stability: "px-4",
  risk: "px-4",
  h24: "px-5",
  state: "px-5",
} as const;

const HEADER_CELL =
  "py-2 font-mono text-[10px] uppercase tracking-[0.08em] whitespace-nowrap text-text-caption";

// <colgroup> + <thead>, shipped together as one component (never two files
// that can drift): a <colgroup>'s column count/order is only meaningful in
// lockstep with the header row naming those same columns.
// A sortable header cell: a <th aria-sort> wrapping a click-to-sort <button>
// (chevron shows the active direction). Reuses the exact SortKey + aria pattern
// the /assets screener's SortableTh established. When `onSort` is absent — the
// loading-skeleton head — it degrades to a plain, non-interactive label.
function BoardSortTh({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "right",
  pad,
  help,
}: {
  label: string;
  k: SortKey;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (k: SortKey) => void;
  align?: "left" | "right" | "center";
  pad: string;
  /** Optional column-definition affordance (HeaderHint or HelpIcon), rendered
   *  next to the label — never inside the sort <button> itself, so the sort
   *  click target stays clean and separately focusable. Mirrors the /assets
   *  screener's SortableTh `help` prop (A5, 2026-07-16). */
  help?: ReactNode;
}) {
  const alignCls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  if (!onSort) {
    return (
      <th scope="col" className={cn(HEADER_CELL, alignCls, pad)}>
        {label}
      </th>
    );
  }
  const activeCol = sortKey === k;
  const ariaSort = activeCol
    ? sortDir === "asc"
      ? ("ascending" as const)
      : ("descending" as const)
    : undefined;
  const button = (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Sort by ${label}${activeCol ? `, currently ${sortDir === "desc" ? "descending" : "ascending"}` : ""}`}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-text",
        !help && "w-full",
        align === "right"
          ? "justify-end"
          : align === "center"
            ? "justify-center"
            : "justify-start",
        activeCol && "text-text",
      )}
    >
      {label}
      {activeCol ? (
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
      className={cn(HEADER_CELL, alignCls, pad)}
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
// worth a glossary entry. Ported verbatim from the /assets screener
// (assets-screener-row.tsx's HeaderHint, which isn't exported) so the Depeg
// column carries the identical copy on both surfaces (A5, 2026-07-16).
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

export function DashboardBoardHead({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (k: SortKey) => void;
} = {}) {
  const s = { sortKey, sortDir, onSort };
  return (
    <>
      <colgroup>
        <col className="w-[30%]" />
        <col className="w-[104px]" />
        <col className="w-[150px]" />
        <col className="w-[110px]" />
        <col className="w-[84px]" />
        <col className="w-[144px]" />
        <col className="w-[116px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-hairline bg-surface-2/60">
          <BoardSortTh
            label="Asset"
            k="symbol"
            align="left"
            pad={BOARD_COL_PAD.asset}
            {...s}
          />
          {/* Market cap column HIDDEN until `market_cap` is backfilled — see the
              COLUMN CONTRACT note above. Kept sortable on the /assets screener. */}
          <BoardSortTh
            label="Spread"
            k="spread"
            align="right"
            pad={BOARD_COL_PAD.spread}
            {...s}
          />
          <BoardSortTh
            // "Band", not "Depeg". This column is a 0-100% PROXIMITY gauge,
            // while the State column in the SAME ROW can literally read "Depeg"
            // as one of the five peg states — so one row showed the word twice
            // meaning two unrelated things, distinguishable only by hovering a
            // tooltip. The internal sort key was already `band`; the header now
            // matches it.
            label="Band"
            k="band"
            align="left"
            pad={BOARD_COL_PAD.band}
            help={
              <HeaderHint label="Column definition: Depeg">
                Proximity to each asset&apos;s own depeg threshold
              </HeaderHint>
            }
            {...s}
          />
          <BoardSortTh
            label="Stability"
            k="jitter"
            align="right"
            pad={BOARD_COL_PAD.stability}
            help={<HelpIcon term="peg_stability" size="xs" side="top" />}
            {...s}
          />
          <BoardSortTh
            label="Risk"
            k="risk"
            align="right"
            pad={BOARD_COL_PAD.risk}
            help={
              <HeaderHint label="Column definition: Risk">
                Composite 0-100 peg-risk score, anchored to the peg state; it
                never disagrees with the classification.
              </HeaderHint>
            }
            {...s}
          />
          {/* 24h is a chart, not a sortable scalar — plain label. */}
          <th
            scope="col"
            className={cn(HEADER_CELL, "text-left", BOARD_COL_PAD.h24)}
          >
            24h
          </th>
          <BoardSortTh
            label="State"
            k="state"
            align="right"
            pad={BOARD_COL_PAD.state}
            {...s}
          />
        </tr>
      </thead>
    </>
  );
}

// One skeleton <tr> at the real 64px row height, colSpan across every
// column, live inside the SAME <table>/<colgroup> as the real rows (task:
// "skeleton dentro da tabela") so the loading state previews the board's
// actual silhouette instead of an unrelated generic placeholder grid.
export function DashboardBoardSkeletonRow() {
  return (
    <tr className="h-14">
      <td colSpan={7} className={cn("py-0 align-middle", BOARD_COL_PAD.asset)}>
        <div className="h-3 w-2/3 max-w-[360px] skeleton-sheen rounded-full bg-text/[0.06]" />
      </td>
    </tr>
  );
}

// Mobile's skeleton placeholder — same silhouette as
// DashboardBoardMobileCard, but a plain <div> (not a colSpan cell of the
// desktop table; see DashboardBoardMobileCard's header comment for why the
// two responsive variants live in separate DOM entirely).
export function DashboardBoardMobileSkeletonCard() {
  return (
    <div className="px-4 py-3">
      <div className="h-3 w-2/3 max-w-[220px] skeleton-sheen rounded-full bg-text/[0.06]" />
    </div>
  );
}

// Mobile card — same visual shape the pre-table row always had, but now a
// standalone component instead of living inside a colSpan cell of the
// desktop's `<table table-fixed>`. Fix for the mobile horizontal-scroll
// regression: a table-fixed table's <colgroup> pins the table to its fixed
// column widths (920px here) at every viewport, so a mobile card smuggled
// through a colSpan cell inside that same table was forced to a 920px-wide
// row and scrolled sideways with its right half off-screen. This component
// renders in its own sibling `sm:hidden` list (see page.tsx) — never inside
// the `<table>` — so it's never subject to table-fixed's column math. It
// does NOT carry `data-asset` or the roving-tabindex `rowRef` — those stay
// on DashboardBoardRow's desktop cell, which is the one the e2e suite's
// default desktop viewports (dashboard.spec.ts @1440, smoke.spec.ts's default
// Chromium project) and the arrow-key roving system actually exercise.
// Native Tab order and click-through work identically at every width
// regardless (both are plain <Link>s); only the ArrowDown/Up/Home/End
// `.focus()` shortcut is desktop-scoped, matching where this surface's
// keyboard-power-user affordance was designed for.
export function DashboardBoardMobileCard({
  asset,
  state,
  bps,
  hasBps,
  discount,
  jitter,
  jLabel,
  riskScore,
  velocity,
  rovingActive,
}: {
  asset: AssetCardData;
  state: PegState;
  bps: number;
  hasBps: boolean;
  discount: string | undefined | null;
  jitter: number | null;
  jLabel: string;
  riskScore: number | null;
  velocity: number | null;
  rovingActive: boolean;
}) {
  // Tick-flash parity with the desktop row (A-craft 2026-07-16): the desktop
  // DashboardBoardRow's Spread cell flashes on a live-feed tick via
  // useTickFlash(spreadRef, discount) — the mobile card renders the
  // identical Spread value but never wired the same hook, so a live update
  // silently changed the number with no visual cue on mobile. Same hook,
  // same signed `discount` value — never re-derived, just observed.
  const spreadRef = useRef<HTMLSpanElement | null>(null);
  useTickFlash(spreadRef, discount ?? undefined);
  const t = thresholdsFor(asset.symbol, asset.class, asset.thresholds);
  const m = stateMeta(state);
  const href = `/asset/${encodeURIComponent(asset.symbol)}`;

  return (
    <Link
      href={href}
      data-vt="nav-forward"
      // Same hook as the desktop cell below. It identifies "this row is for
      // asset X" and had existed on only ONE of the two responsive variants,
      // so `[data-asset]` resolved at every viewport but was display:none at
      // phone width. smoke.spec.ts waits on it being VISIBLE, which is why
      // that spec fails on production the moment it is run at 390 rather than
      // at desktop. Nothing else queries the attribute (the board's roving
      // keyboard nav uses refs), so this is markup made consistent, not a
      // test-shaped hole.
      data-asset={asset.symbol}
      tabIndex={rovingActive ? 0 : -1}
      className="block px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Shared-element morph into the asset hero's mark.
              This same row component renders a TokenIcon twice — here in the
              `sm:hidden` card and again in the `hidden sm:table-cell` desktop
              cell below — and a view-transition-name must be unique among
              RENDERED elements. It is safe because both halves are toggled with
              `display: none`, and an element with no box is never captured, so
              exactly one carries the name at any viewport. If either half is
              ever switched to `visibility`/`opacity` hiding, both become
              rendered, the name duplicates, and the browser drops the whole
              transition rather than just this pair. */}
          <TokenIcon
            mint={asset.mint}
            symbol={displaySymbol(asset.symbol)}
            klass={asset.class}
            size={22}
            morphName={assetMorphName(asset.symbol)}
          />
          <StatePip
            state={state}
            pulse={state !== "PEGGED" && state !== "UNKNOWN"}
            size={6}
            announce
          />
          <span className="truncate text-[15px] font-medium text-text">
            {displaySymbol(asset.symbol)}
          </span>
          {asset.monitoring_only && <MonitoringBadge className="shrink-0" />}
          {asset.sustained && (
            <SustainedBadge
              state={asset.state}
              durationSecs={asset.current_state_duration_secs}
              sustained={asset.sustained}
              className="shrink-0"
            />
          )}
          {!calibrationShownByBetaBadge(asset) && (
            <CalibrationGauge asset={asset} className="shrink-0" />
          )}
        </div>
        <span
          ref={spreadRef}
          className={cn(
            "shrink-0 font-mono text-[15px] font-medium tabular-nums",
            hasBps ? spreadSignClass(bps) : "text-text-caption",
          )}
        >
          {/* Holder convention: `bps` follows reconcileBps (positive =
              discount, negative = premium) — negate for display so `+` =
              premium, `−` = discount (matching /lst + the hero board). */}
          {hasBps ? formatGap(-bps) : "-"}
        </span>
        {hasBps && velocity != null && velocity !== 0 && (
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              velocity > 0 ? "text-st-depeg-text" : "text-st-pegged",
            )}
          >
            {velocity > 0 ? (
              <ArrowUp size={12} strokeWidth={2.5} />
            ) : (
              <ArrowDown size={12} strokeWidth={2.5} />
            )}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="truncate text-[12px] text-text-muted">{asset.name}</p>
        <span
          className={cn(
            "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] font-medium",
            m.badgeClass,
          )}
        >
          {m.label}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <BandGauge
          bps={hasBps ? bps : null}
          thresholds={t}
          state={state}
          klass={asset.class}
          crBand={isCollateralRatioThresholds(asset.thresholds)}
          className="flex-1"
        />
        <SparklineCell
          symbol={asset.symbol}
          series={asset.series_24h}
          thresholdBps={t.depeg_bps}
          className="h-7 w-16 shrink-0"
        />
      </div>
      {/* Stability + Safety footer — the mobile card used to drop both risk
          signals entirely (A2, 2026-07-16); ported verbatim from the /assets
          screener's AssetsScreenerMobileCard footer block so a dashboard-
          mobile user sees the same risk signal a desktop or /assets visitor
          gets. */}
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
          risk{" "}
          <span
            className={cn(
              "tabular-nums",
              riskScore != null ? severityTextClass(state) : "text-text-muted",
            )}
          >
             {riskScore != null ? riskScore : "-"}
          </span>
          {riskScore != null && (
            <span className="ml-1.5 inline-block h-[2px] w-[32px] overflow-hidden rounded-full align-middle">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${riskScore}%`,
                  background:
                    "linear-gradient(90deg, var(--color-st-pegged), var(--color-st-drift), var(--color-st-depeg), var(--color-st-critical))",
                }}
              />
            </span>
          )}
        </span>
        {/* Market cap field HIDDEN until `market_cap` is surfaced here — matches
            the desktop board's suppressed column (see COLUMN CONTRACT note). */}
      </div>
    </Link>
  );
}

export const DashboardBoardRow = memo(function DashboardBoardRow({
  asset,
  state,
  bps,
  hasBps,
  discount,
  jitter,
  jLabel,
  riskScore,
  velocity,
  rowRef,
  rovingActive,
}: {
  asset: AssetCardData;
  state: PegState;
  bps: number;
  hasBps: boolean;
  discount: string | undefined | null;
  jitter: number | null;
  jLabel: string;
  riskScore: number | null;
  /** Spread velocity: direction of the last tick delta.
   *  +1 = widening (riskier), -1 = narrowing (safer), 0 = flat, null = unknown. */
  velocity: number | null;
  rowRef: (el: HTMLAnchorElement | null) => void;
  rovingActive: boolean;
}) {
  const spreadRef = useRef<HTMLSpanElement | null>(null);
  useTickFlash(spreadRef, discount ?? undefined);
  const t = thresholdsFor(asset.symbol, asset.class, asset.thresholds);
  const m = stateMeta(state);
  const href = `/asset/${encodeURIComponent(asset.symbol)}`;

  return (
    <tr
      className={cn(
        // transition ONLY background-color (the hover tint), NOT border-color.
        // `transition-colors` also transitions border-color, and this row's
        // divider is a Tailwind v4 `divide-y` border-BOTTOM whose default color
        // falls back to currentColor (near-white text #f5f5f6). On filter
        // switch, rows reorder/insert and that divider transitions from the
        // near-white currentColor to its real white/[0.04] over 150ms — a bright
        // white 1px line that fades out over exactly the transition duration
        // (the "branco no meio da tabela"). Scoping the transition to
        // background-color makes border-color snap instantly, killing the flash.
        // (Empirically verified: peak scanline luminance 0.96 -> 0.24, flat.)
        "group relative h-14 cursor-pointer transition-[background-color] duration-150",
        "hover:bg-surface-2/50 has-[a:focus-visible]:bg-surface-2/50",
      )}
    >
      {/* Desktop cells — hidden entirely below `sm`. Each <td>'s padding is
          the SAME BOARD_COL_PAD entry as its <th> in DashboardBoardHead
          (imported, not re-typed), which is what makes header/body alignment
          a construction guarantee rather than a hope. */}
      <td
        className={cn(
          "hidden h-14 py-0 align-middle sm:table-cell",
          BOARD_COL_PAD.asset,
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <StatePip
            state={state}
            pulse={state !== "PEGGED" && state !== "UNKNOWN"}
            size={6}
            announce
          />
          <TokenIcon
            mint={asset.mint}
            symbol={displaySymbol(asset.symbol)}
            klass={asset.class}
            size={20}
            morphName={assetMorphName(asset.symbol)}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {/* The clickable row. Its own text box is small (just the
                  symbol), but `after:inset-0` stretches an invisible pseudo-
                  element to the nearest positioned ancestor — the <tr> above
                  (`relative`) — so the ENTIRE row is one click target. The
                  <a> itself stays position:static so the pseudo escapes past
                  it; hovering/focusing anywhere in that stretched area still
                  matches `a:hover`/`a:focus-visible` (standard "stretched
                  link" mechanics), which is what drives the <tr>'s own
                  `hover:`/`has-[a:focus-visible]:` background above. */}
              <Link
                ref={rowRef}
                href={href}
                data-vt="nav-forward"
                data-asset={asset.symbol}
                tabIndex={rovingActive ? 0 : -1}
                className={cn(
                  // shrink-0: the symbol is the row's identity and must never
                  // be the thing that gives way. With truncate alone, a row
                  // carrying BETA + SUSTAINED + PROVISIONAL (eHYUSD in DRIFT)
                  // collapsed the symbol to 0px and pushed the badges over
                  // the Spread column.
                  "shrink-0 font-mono text-[13px] font-medium text-text",
                  "after:absolute after:inset-0 after:content-['']",
                  "focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-outline",
                )}
              >
                {displaySymbol(asset.symbol)}
              </Link>
              {/* Badges absorb the squeeze instead: they clip inside the
                  cell (min-w-0 + overflow-hidden) rather than overflowing
                  into the next column. */}
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {asset.monitoring_only && (
                  <MonitoringBadge className="shrink-0" />
                )}
                {asset.sustained && (
                  <SustainedBadge
                    state={asset.state}
                    durationSecs={asset.current_state_duration_secs}
                    sustained={asset.sustained}
                    className="shrink-0"
                  />
                )}
                {!calibrationShownByBetaBadge(asset) && (
                  <CalibrationGauge asset={asset} className="shrink-0" />
                )}
              </span>
            </div>
            <div className="truncate text-[11px] text-text-muted">
              {asset.name}
            </div>
          </div>
        </div>
      </td>

      {/* Market cap <td> HIDDEN until `market_cap` is backfilled — see the
          COLUMN CONTRACT note; the colgroup/thead drop it in lockstep. */}
      <td
        className={cn(
          "hidden h-14 py-0 align-middle text-right sm:table-cell",
          BOARD_COL_PAD.spread,
        )}
      >
        <span
          ref={spreadRef}
          className={cn(
            "font-mono text-[13px] font-medium tabular-nums",
            hasBps ? spreadSignClass(bps) : "text-text-caption",
          )}
        >
          {/* Holder convention: `bps` follows reconcileBps (positive =
              discount, negative = premium) — negate for display so `+` =
              premium, `−` = discount (matching /lst + the hero board). */}
          {hasBps ? formatGap(-bps) : "-"}
        </span>
        {hasBps && velocity != null && velocity !== 0 && (
          <span
            aria-hidden
            className={cn(
              "ml-1 inline-flex shrink-0 items-center transition-opacity duration-300",
              velocity > 0
                ? "text-st-depeg-text"
                : "text-st-pegged",
            )}
          >
            {velocity > 0 ? (
              <ArrowUp size={10} strokeWidth={2.5} />
            ) : (
              <ArrowDown size={10} strokeWidth={2.5} />
            )}
          </span>
        )}
      </td>

      <td
        className={cn(
          "hidden h-14 py-0 align-middle sm:table-cell",
          BOARD_COL_PAD.band,
        )}
      >
        <BandGauge
          bps={hasBps ? bps : null}
          thresholds={t}
          state={state}
          klass={asset.class}
          crBand={isCollateralRatioThresholds(asset.thresholds)}
        />
      </td>

      <td
        className={cn(
          "hidden h-14 py-0 align-middle text-right sm:table-cell",
          BOARD_COL_PAD.stability,
        )}
      >
        {jitter != null && jLabel !== "unknown" ? (
          // Two lines (label over ±value) so it fits the 110px column instead
          // of overflowing it — the "torto" fix; mirrors the Safety column's
          // grade-over-caption stack right below.
          <div className="leading-tight">
            <div
              className={cn(
                "font-mono text-[11px] uppercase tracking-[0.06em]",
                JITTER_COLOR[jLabel],
              )}
            >
              {jLabel}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tabular-nums text-text-caption">
              {formatJitterPct(jitter)}
            </div>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-text-muted">-</span>
        )}
      </td>

      <td
        className={cn(
          "hidden h-14 py-0 align-middle text-right leading-none sm:table-cell",
          BOARD_COL_PAD.risk,
        )}
      >
        {riskScore != null ? (
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "font-mono text-[13px] font-medium tabular-nums",
                severityTextClass(state),
              )}
            >
              {riskScore}
            </span>
            <div className="h-[3px] w-[56px] overflow-hidden rounded-full bg-text/[0.06]">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${riskScore}%`,
                  background:
                    "linear-gradient(90deg, var(--color-st-pegged), var(--color-st-drift), var(--color-st-depeg), var(--color-st-critical))",
                }}
              />
            </div>
          </div>
        ) : (
          <span
            className="font-mono text-[13px] text-text-caption"
            title="No score, state unknown or collateral-ratio asset"
          >
            -
          </span>
        )}
      </td>

      <td
        className={cn(
          "hidden h-14 py-0 align-middle sm:table-cell",
          BOARD_COL_PAD.h24,
        )}
      >
        <div className="flex justify-end">
          <SparklineCell
            symbol={asset.symbol}
            series={asset.series_24h}
            thresholdBps={t.depeg_bps}
            className="h-8 w-full"
          />
        </div>
      </td>

      <td
        className={cn(
          "hidden h-14 py-0 align-middle text-right sm:table-cell",
          BOARD_COL_PAD.state,
        )}
      >
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium",
            m.badgeClass,
          )}
        >
          {m.label}
        </span>
      </td>
    </tr>
  );
});
