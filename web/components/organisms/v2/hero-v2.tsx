"use client";

import Link from "@/components/atoms/intent-link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useAssets } from "@/lib/hooks/use-assets";
import { isRateLimited } from "@/lib/api/client";
import { RATE_LIMITED_BODY } from "@/lib/api/rate-limit-copy";
import { useLiveUpdatesPaused } from "@/lib/hooks/use-live-updates-paused";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { TokenIcon } from "@/components/atoms/token-icon";
import {
  BETA_BADGE_BODY,
  BETA_BADGE_LABEL,
} from "@/lib/asset/beta-badge-copy";
import { HeroRevealCanvas } from "@/components/organisms/v2/hero-reveal-canvas";
import { DistanceFieldCanvas } from "@/components/organisms/v2/distance-field-canvas";
import { SpreadSparkCanvas } from "@/components/organisms/v2/spread-spark-canvas";
import {
  BOARD_FILTERS,
  type BoardFilter,
  type BoardRow,
  PillGhost,
  PillPrimary,
  StatePillV2,
  selectBoardRows,
  sparkColorHex,
  v2SpreadSignClass,
} from "@/components/organisms/v2/shared";

// The desktop 8-column layout collapses to 3 visible columns (Asset / State /
// Spread) below 860px — this mirrors the artifact's `.hide-m` pattern
// (Market/Intrinsic/Band-proximity/Updated hide, and CSS grid auto-placement
// quietly leaves the trailing mobile track empty). Faithful port, not a bug.
const GRID_DESKTOP =
  "min-[860px]:grid-cols-[1.3fr_.9fr_.75fr_.75fr_.7fr_1.02fr_.82fr_.62fr]";
const GRID_MOBILE = "grid-cols-[1.4fr_1fr_.9fr_1.2fr]";
const HIDE_M = "hidden min-[860px]:block";
const HIDE_M_FLEX = "hidden min-[860px]:flex";
// The Spread · 24h sparkline needs more room than the other hide-below-860
// columns — artifact's own `.sparkcell{display:none}@media(max-width:900px)`
// carves out a wider breakpoint just for this cell.
const HIDE_SPARK = "hidden scene:flex";
const BOARD_ROW_COUNT = 8;

/** What the board can honestly claim right now. `loading` is also the SSR
 *  state: the server never has the asset list, so the first HTML paints a
 *  neutral skeleton, never numbers. */
export type BoardStatus =
  | "live"
  | "paused"
  | "reconnecting"
  | "loading"
  | "unavailable"
  | "rate_limited";

/** A 429 is the API asking this browser to slow down, not an outage. With
 *  rows already on screen the last good data stays; a short 429 changes
 *  nothing, and once nothing has refreshed for over 60s (`paused`, from
 *  useLiveUpdatesPaused) the pill turns a muted "paused" so frozen rows are
 *  never labelled live. This page has no app shell, so the pill is the only
 *  notice here. With nothing loaded yet a 429 gets the calm "paused" empty
 *  state (lib/api/rate-limit-copy.ts), never "offline". */
export function boardStatus(opts: {
  hasData: boolean;
  hasError: boolean;
  rateLimited?: boolean;
  paused?: boolean;
}): BoardStatus {
  if (opts.hasData) {
    if (opts.paused) return "paused";
    if (opts.hasError && opts.rateLimited) return "live";
    return opts.hasError ? "reconnecting" : "live";
  }
  if (opts.hasError && opts.rateLimited) return "rate_limited";
  return opts.hasError ? "unavailable" : "loading";
}

const STATUS_PILL: Record<BoardStatus, { label: string; dot: string }> = {
  live: { label: "live · 60s", dot: "bg-[var(--v2-peg)]" },
  paused: { label: "paused", dot: "bg-[var(--v2-unk)]" },
  reconnecting: { label: "reconnecting", dot: "bg-[var(--v2-unk)]" },
  loading: { label: "loading", dot: "bg-[var(--v2-unk)]" },
  unavailable: { label: "offline", dot: "bg-[var(--v2-unk)]" },
  rate_limited: { label: "paused", dot: "bg-[var(--v2-unk)]" },
};

export function HeroV2() {
  const reduced = useAppReducedMotion();
  const { data: assets, error, mutate } = useAssets();
  const [filter, setFilter] = useState<BoardFilter>("all");
  const { paused } = useLiveUpdatesPaused();

  // The "updated Xs ago" stamps tick on their own clock, so when refreshes
  // stop (a sustained 429 or an outage) the rows visibly age instead of
  // freezing at their last label. Rows only exist client-side, so the SSR
  // value of this clock never reaches the HTML.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasRows = !!assets && assets.length > 0;
  useEffect(() => {
    if (!hasRows) return;
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [hasRows]);
  const rows = useMemo(
    () => selectBoardRows(assets, nowMs, BOARD_ROW_COUNT, filter),
    [assets, filter, nowMs],
  );
  // Never a sample board: no real rows means a skeleton (loading, and the SSR
  // HTML) or an explicit unavailable state, and the "live" pill only shows
  // over real data.
  const status = boardStatus({
    hasData: !!assets && assets.length > 0,
    hasError: error != null || (!!assets && assets.length === 0),
    rateLimited: isRateLimited(error),
    paused,
  });
  const pill = STATUS_PILL[status];
  // null until the live list actually loads — never paint a hardcoded count on
  // the most-viewed page. The pill drops the "· N" suffix rather than asserting a
  // stale number (the previous `?? 69` was wrong against a live 68).
  const totalCount = assets?.length ?? null;

  // The h1 and sub are the LCP candidates, so they are NOT JS reveals (those
  // SSR at opacity 0 and only show after hydration plus a timer, which pushed
  // mobile LCP past 5s). They paint visible from the first byte and get a
  // CSS-only rise (`.v2-hero-rise`, v2.css) that never touches opacity.
  const cta = useRevealV2<HTMLDivElement>({ mode: "load", index: 2 });
  const trust = useRevealV2<HTMLParagraphElement>({ mode: "load", index: 3 });
  const stage = useRevealV2<HTMLDivElement>({ mode: "load", index: 4 });

  return (
    <header className="relative overflow-hidden pt-[172px] text-center">
      {/* Brand wash filling the dead band left by the retired prismatic
          triangle — peaks behind the nav/H1 at top-center and fades out by
          ~40% down the hero. Static (nothing to gate under reduced-motion),
          kept subtle so the fine white linework from the canvases below and
          the z-[2] copy above it both still read cleanly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[460px]"
        style={{
          background:
            "radial-gradient(120% 60% at 50% 0%, rgba(255,138,91,0.10), rgba(251,111,174,0.05) 34%, rgba(223,145,247,0.03) 55%, transparent 72%)",
        }}
      />
      <DistanceFieldCanvas />
      <HeroRevealCanvas />
      <div className="relative z-[2] mx-auto max-w-[1180px] px-6 sm:px-10">
        <h1
          style={{ animationDelay: "100ms" }}
          className="v2-hero-rise mx-auto max-w-[16ch] text-balance text-[clamp(42px,6.6vw,80px)] font-medium leading-[1.02] tracking-[-0.025em] text-[var(--v2-text)]"
        >
          Prove the peg of{" "}
          <span className="v2-iri-text">every asset you hold.</span>
        </h1>

        <p
          style={{ animationDelay: "210ms" }}
          className="v2-hero-rise mx-auto mt-[26px] max-w-[60ch] text-[clamp(16px,1.9vw,18px)] leading-[1.62] text-[var(--v2-muted)]"
        >
          Solana stablecoins, LSTs and yield-bearing stables,{" "}
          <b className="font-medium text-[var(--v2-text)]">watched live</b>.
          Every state change ships a{" "}
          <b className="font-medium text-[var(--v2-text)]">
            hashed, replayable receipt
          </b>
          , the moment it happens.
        </p>

        <div
          ref={cta.ref}
          style={cta.style}
          className="mt-[34px] flex flex-wrap justify-center gap-3 max-[759px]:mx-auto max-[759px]:max-w-[340px] max-[759px]:flex-col max-[759px]:items-stretch max-[759px]:gap-2.5"
        >
          <PillPrimary href={"/dashboard"}>open the dashboard</PillPrimary>
          <PillGhost href="https://docs.pegana.xyz/guides/rest-api">assets api</PillGhost>
        </div>

        <p
          ref={trust.ref}
          style={trust.style}
          className="mt-[22px] font-mono text-xs tracking-[0.03em] text-[var(--v2-dim)]"
        >
          For Protocols, Risk Teams and Treasuries
        </p>

        <div
          ref={stage.ref}
          style={stage.style}
          className="relative mx-auto mt-14 max-w-[1180px] pb-[92px]"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-70px] z-0 w-[min(1400px,140vw)] -translate-x-1/2"
          >
            <div
              className={cn(
                "absolute left-1/2 top-[18px] h-[310px] w-[88%] -translate-x-1/2 blur-[34px]",
                !reduced &&
                  "v2-anim-arc animate-[v2-arcbreathe_9s_var(--v2-ease)_infinite]",
              )}
              style={{
                background:
                  "radial-gradient(52% 100% at 50% 100%, rgba(251,111,174,.4), rgba(255,138,91,.18) 42%, rgba(223,145,247,.13) 60%, transparent 74%)",
              }}
            />
            <svg
              viewBox="0 0 1400 260"
              preserveAspectRatio="none"
              style={{ width: "100%", height: 260, overflow: "visible" }}
            >
              <defs>
                <linearGradient id="v2-hero-arc" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="#ff8a5b" stopOpacity="0" />
                  <stop offset="0.25" stopColor="#ff8a5b" />
                  <stop offset="0.5" stopColor="#fb6fae" />
                  <stop offset="0.75" stopColor="#df91f7" />
                  <stop offset="1" stopColor="#df91f7" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,250 Q700,-30 1400,250"
                fill="none"
                stroke="url(#v2-hero-arc)"
                strokeWidth="1.6"
                opacity="0.8"
              />
            </svg>
          </div>

          <div
            className={cn(
              "relative z-[2] overflow-hidden rounded-[20px] border border-[var(--v2-line2)] text-left v2-shadow-board",
              !reduced &&
                "v2-anim-board animate-[v2-boardfloat_9s_var(--v2-ease)_infinite]",
            )}
            style={{
              background:
                "linear-gradient(180deg, var(--color-surface-1), var(--color-canvas))",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-[var(--v2-line)] px-5 py-[15px] max-[760px]:px-4 max-[760px]:py-[13px]">
              <span className="text-sm font-medium whitespace-nowrap">
                Live peg board
              </span>
              <span
                role="group"
                aria-label="Filter the board by asset group"
                className="v2-board-tabs mr-auto flex items-center gap-1 overflow-x-auto rounded-full border border-[var(--v2-line)] bg-white/[0.04] p-[3px] font-mono"
              >
                {BOARD_FILTERS.map((f) => {
                  const active = filter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(f.id)}
                      className={cn(
                        "rounded-full px-3 py-[5px] text-[12px] whitespace-nowrap transition-colors duration-200 max-[760px]:px-[13px] max-[760px]:py-1.5 max-[760px]:text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--v2-text)]",
                        active
                          ? "bg-white/10 text-[var(--v2-text)]"
                          : "text-[var(--v2-dim)] hover:text-[var(--v2-text)]",
                      )}
                    >
                      {f.label}
                      {f.id === "all" && totalCount != null
                        ? ` · ${totalCount}`
                        : ""}
                    </button>
                  );
                })}
              </span>
              <span
                data-testid="board-status"
                data-status={status}
                className="inline-flex items-center gap-[7px] rounded-full border border-[var(--v2-line)] px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--v2-muted)] max-[760px]:ml-auto"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", pill.dot)} />
                {pill.label}
              </span>
            </div>

            <table
              className="v2-hero-btable"
              aria-label="Live peg board"
              aria-busy={status === "loading" ? true : undefined}
            >
              <thead>
                <tr
                  role="row"
                  className={cn(
                    "grid items-center gap-3 border-b border-[var(--v2-line)] px-5 pb-[13px] pt-[13px] font-mono text-[12px] uppercase tracking-[0.09em] text-[var(--v2-muted)]",
                    GRID_MOBILE,
                    GRID_DESKTOP,
                    "max-[859px]:hidden",
                  )}
                >
                  <th scope="col" className="text-left">
                    Asset
                  </th>
                  <th scope="col" className="text-left">
                    State
                  </th>
                  <th scope="col" className={cn("text-right", HIDE_M)}>
                    Market
                  </th>
                  <th scope="col" className={cn("text-right", HIDE_M)}>
                    Intrinsic
                  </th>
                  <th scope="col" className="text-right">
                    Spread
                  </th>
                  <th
                    scope="col"
                    title="How far the spread is from peg toward this asset's own depeg line"
                    className={cn("min-w-0 text-left text-[12px] whitespace-nowrap max-[1023px]:tracking-[0.04em]", HIDE_M)}
                  >
                    Band proximity
                  </th>
                  <th
                    scope="col"
                    className={cn("min-w-0 text-left text-[12px] whitespace-nowrap max-[1023px]:tracking-[0.04em]", HIDE_SPARK)}
                  >
                    Spread · 24h
                  </th>
                  <th scope="col" className={cn("text-right", HIDE_M)}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row, i) => (
                    <BoardRowView
                      key={row.symbol}
                      row={row}
                      rowIndex={i}
                      boardInView={stage.inView}
                    />
                  ))
                ) : status === "rate_limited" ? (
                  <tr role="row" className="flex min-h-[200px] items-center justify-center px-5 py-10">
                    <td className="flex max-w-[52ch] flex-col items-center gap-3 text-center font-mono text-[12.5px] text-[var(--v2-muted)]">
                      <span data-testid="board-rate-limited">
                        {RATE_LIMITED_BODY}
                      </span>
                    </td>
                  </tr>
                ) : status === "unavailable" ? (
                  <tr role="row" className="flex min-h-[200px] items-center justify-center px-5 py-10">
                    <td className="flex flex-col items-center gap-3 text-center font-mono text-[12.5px] text-[var(--v2-muted)]">
                      <span data-testid="board-unavailable">
                        Live data is unavailable right now.
                      </span>
                      <button
                        type="button"
                        onClick={() => void mutate?.()}
                        className="rounded-full border border-[var(--v2-line2)] px-3.5 py-1.5 text-[12px] uppercase tracking-[0.06em] text-[var(--v2-text)] transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--v2-text)]"
                      >
                        retry
                      </button>
                    </td>
                  </tr>
                ) : status === "loading" ? (
                  Array.from({ length: BOARD_ROW_COUNT }, (_, i) => (
                    <SkeletonRowView key={i} />
                  ))
                ) : (
                  <tr role="row" className="flex justify-center px-5 py-10">
                    <td className="font-mono text-[12.5px] text-[var(--v2-muted)]">
                      No tracked assets in this group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="flex justify-end border-t border-[var(--v2-line)] bg-white/[0.02] px-5 py-[13px]">
              <Link
                href={"/dashboard"}
                className="border-b border-[var(--v2-line2)] pb-px font-mono text-[12.5px] text-[var(--v2-text)] transition-colors hover:border-white"
              >
                OPEN THE DASHBOARD →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

// Neutral placeholder row: same grid as a real row, bars instead of numbers.
// Rendered while /v1/assets has not answered yet, which includes the SSR HTML.
function SkeletonRowView() {
  const bar = "block h-2.5 rounded-full bg-white/[0.06]";
  return (
    <tr
      role="row"
      aria-hidden
      data-testid="board-skeleton-row"
      className={cn(
        "grid items-center gap-3 border-b border-[var(--v2-line)] px-5 py-[11px] last:border-b-0",
        GRID_MOBILE,
        GRID_DESKTOP,
      )}
    >
      <td className="flex min-h-[34px] items-center gap-2.5">
        <span className="h-5 w-5 shrink-0 rounded-full bg-white/[0.06]" />
        <span className={cn(bar, "w-16")} />
      </td>
      <td>
        <span className={cn(bar, "h-5 w-16")} />
      </td>
      <td className={HIDE_M}>
        <span className={cn(bar, "ml-auto w-12")} />
      </td>
      <td className={HIDE_M}>
        <span className={cn(bar, "ml-auto w-12")} />
      </td>
      <td>
        <span className={cn(bar, "ml-auto w-10")} />
      </td>
      <td className={HIDE_M}>
        <span className={cn(bar, "w-full")} />
      </td>
      <td className={HIDE_SPARK}>
        <span className={cn(bar, "w-full")} />
      </td>
      <td className={HIDE_M}>
        <span className={cn(bar, "ml-auto w-6")} />
      </td>
    </tr>
  );
}

// One board row, its own component so per-row rendering stays isolated from
// the board's list logic.
function BoardRowView({
  row,
  rowIndex,
  boardInView,
}: {
  row: BoardRow;
  rowIndex: number;
  boardInView: boolean;
}) {
  // Same index-based delay idiom as useRevealV2 (there: `100 + index * 110`
  // for the hero's load-mode elements) — just tighter, since this is a
  // stagger WITHIN an already-revealed board, not the board's own reveal.
  // Only the first 5 rows get it; the rest arrive with the board as before,
  // so the effect reads as "the top of the list streaming in" rather than a
  // slow trickle down a long table. Gated by the same `boardInView` state
  // that already drives the board's own fade (`stage.inView` in HeroV2) —
  // no new timer, no new state, and the global prefers-reduced-motion guard
  // (globals.css `transition: none !important`) neutralizes it exactly like
  // every other reveal in this file.
  const rowStaggerMs = rowIndex < 5 ? rowIndex * 35 : 0;
  // No band reading (an UNKNOWN or stale row) means no trustworthy spread
  // history either — matches the artifact's `.nospark` "-" cell rather than
  // drawing a line for an asset with no verified source.
  const noData = row.gaugePct == null && !row.crBand;
  const sparkData = noData ? undefined : row.spark;
  const hasSpark = !!sparkData && sparkData.length >= 2;

  return (
    <tr
      role="row"
      // The row is a real <tr>; the whole-row link lives in the Asset cell as a
      // stretched <a> (after:inset-0 over this relative <tr>) — a <tr> can't be
      // an <a>. Same stretched-link mechanic as list-rows-v2 / the screener.
      className={cn(
        "v2-brow group relative grid cursor-pointer items-center gap-3 border-b border-[var(--v2-line)] px-5 py-[11px] text-[13.5px] transition-[background-color,opacity,transform] duration-300 ease-[var(--v2-ease)] last:border-b-0 hover:bg-white/[0.03]",
        GRID_MOBILE,
        GRID_DESKTOP,
      )}
      style={{
        ...(row.amberTint ? { background: "rgba(226,166,81,.05)" } : null),
        transitionDelay: `${rowStaggerMs}ms`,
        opacity: boardInView ? 1 : 0,
        transform: boardInView ? "none" : "translateY(6px)",
      }}
    >
      <td className="min-w-0">
        <Link
          href={`/asset/${encodeURIComponent(row.symbol)}`}
          className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 after:content-['']"
        >
          <TokenIcon
            mint={row.mint}
            symbol={displaySymbol(row.symbol)}
            klass={row.klass}
            size={20}
            loading="eager"
          />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-semibold text-[var(--v2-text)] transition-colors duration-200 group-hover:text-white">
                {displaySymbol(row.symbol)}
              </span>
              {row.monitoringOnly && (
                // Same BETA label and caveat as MonitoringBadge (dashboard,
                // screener, asset page). A plain span, not that badge's
                // <button>: this cell is inside the row's stretched link, and
                // a button nested in a link is invalid and unreachable.
                <span
                  data-testid="board-beta"
                  title={BETA_BADGE_BODY}
                  className="inline-flex h-5 shrink-0 items-center rounded-full border border-[var(--v2-line)] px-2 font-mono text-[12px] uppercase leading-none text-[var(--v2-muted)]"
                >
                  {BETA_BADGE_LABEL}
                  <span className="sr-only">: {BETA_BADGE_BODY}</span>
                </span>
              )}
            </span>
            <span className="truncate font-mono text-[12px] text-[var(--v2-muted)]">
              {row.classLabel}
            </span>
          </span>
        </Link>
      </td>
      <td>
        <StatePillV2 state={row.state} />
      </td>
      <td
        className={cn(
          "text-right font-mono text-xs tabular-nums text-[var(--v2-muted)]",
          HIDE_M,
        )}
      >
        {row.marketLabel}
      </td>
      <td
        className={cn(
          "text-right font-mono text-xs tabular-nums text-[var(--v2-muted)]",
          row.gaugePct == null && "text-[12px]",
          HIDE_M,
        )}
      >
        {row.intrinsicLabel}
      </td>
      <td
        className={cn(
          "text-right font-mono text-[13px] tabular-nums",
          v2SpreadSignClass(row.spreadBps),
        )}
      >
        {row.spreadLabel}
      </td>
      <td className={cn("items-center gap-2", HIDE_M_FLEX)}>
        {row.crBand ? (
          <abbr
            title="Banded on collateral ratio, not on this spread"
            className="font-mono text-[12px] text-[var(--v2-muted)] no-underline"
          >
            CR band
          </abbr>
        ) : row.gaugePct == null ? (
          <span className="font-mono text-[12px] text-[var(--v2-muted)]">
            -
          </span>
        ) : (
          <>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${row.gaugePct}%`,
                  background:
                    row.state === "PEGGED"
                      ? "var(--v2-peg)"
                      : row.state === "DRIFT"
                        ? "var(--v2-drift)"
                        : row.state === "DEPEG"
                          ? "var(--v2-depeg)"
                          : "var(--v2-crit)",
                }}
              />
            </span>
            <span className="w-8 text-right font-mono text-[12px] text-[var(--v2-muted)]">
              {row.gaugePct}%
            </span>
          </>
        )}
      </td>
      <td className={cn("min-w-0 items-center", HIDE_SPARK)}>
        {hasSpark ? (
          <SpreadSparkCanvas
            data={sparkData!}
            color={sparkColorHex(row.state)}
          />
        ) : (
          <span className="font-mono text-[12px] text-[var(--v2-muted)]">
            -
          </span>
        )}
      </td>
      <td
        className={cn(
          "text-right font-mono text-xs text-[var(--v2-muted)]",
          HIDE_M,
        )}
      >
        {row.updatedLabel}
      </td>
    </tr>
  );
}
