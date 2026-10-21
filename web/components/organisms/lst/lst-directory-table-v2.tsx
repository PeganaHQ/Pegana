"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { classTint, monogramInitials } from "@/lib/token-icons/monogram";
import { TokenIcon } from "@/components/atoms/token-icon";
import { Pagination } from "@/components/molecules/pagination";
import { usePagination } from "@/lib/hooks/use-pagination";
import { formatApyPct, formatCompactUsd, formatRate } from "@/lib/lst/format";
import { formatGap } from "@/lib/api/format";
import {
  StatePillV2,
  stateMeta,
  v2SpreadSignClass,
} from "@/components/organisms/v2/shared";
import { bandProximity } from "@/lib/asset/band";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { thresholdsFor } from "@/lib/alerts/policy";
import type { LstDirectoryRow } from "@/lib/lst/types";
import type { PegState } from "@/lib/api/types";

// LST directory table (redesign 2026-08-05): rewritten from the grid-as-table
// mechanic (ListRow/v2-in-lrows) to a hand-rolled <table table-fixed> +
// explicit <colgroup>, matching the systemic/dashboard pattern the user
// requested. Same real-table semantics, same sortable headers, plus
// client-side pagination (25 rows/page).

const COL_WIDTHS = ["36%", "16%", "18%", "18%", "12%"];
const PER_PAGE = 25;

type Filter = "all" | "covered" | "drifting";

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "covered", label: "Covered" },
  { value: "drifting", label: "Drifting+" },
];

const DRIFTING_PLUS: ReadonlySet<PegState> = new Set([
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
]);

// ── Client-side sort ────────────────────────────────────────────────────────────

type LstSortKey = "tvl" | "apy" | "vsNav";
type SortDir = "asc" | "desc";

const SORT_LABEL: Record<LstSortKey, string> = {
  tvl: "TVL",
  apy: "APY",
  vsNav: "vs NAV",
};

function sortValue(row: LstDirectoryRow, key: LstSortKey): number | null {
  switch (key) {
    case "tvl":
      return row.tvlUsd;
    case "apy":
      return row.apy;
    case "vsNav":
      return row.spreadBps;
  }
}

function compareRows(
  a: LstDirectoryRow,
  b: LstDirectoryRow,
  key: LstSortKey,
  dir: SortDir,
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const aMissing = av == null;
  const bMissing = bv == null;
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  let cmp = aMissing || bMissing ? 0 : av! - bv!;
  if (cmp === 0) cmp = a.symbol.localeCompare(b.symbol);
  return dir === "asc" ? cmp : -cmp;
}

function SortChevron({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return <ChevronsUpDown size={11} className="opacity-40" aria-hidden />;
  }
  return dir === "asc" ? (
    <ChevronUp size={11} aria-hidden />
  ) : (
    <ChevronDown size={11} aria-hidden />
  );
}

function LstSortTh({
  label,
  colKey,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  colKey: LstSortKey;
  sort: { key: LstSortKey; dir: SortDir };
  onSort: (key: LstSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === colKey;
  const ariaSort = active
    ? sort.dir === "asc"
      ? ("ascending" as const)
      : ("descending" as const)
    : undefined;
  return (
    <th
      role="columnheader"
      scope="col"
      aria-sort={ariaSort}
      className="bg-[rgba(255,255,255,0.03)] px-4 py-2.5 sm:px-5"
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === "desc" ? "descending" : "ascending"}` : ""}`}
        className={cn(
          "inline-flex w-full items-center gap-1 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors hover:text-[var(--v2-text)]",
          align === "right" ? "justify-end" : "justify-start",
          active && "text-[var(--v2-text)]",
        )}
      >
        {label}
        <SortChevron active={active} dir={sort.dir} />
      </button>
    </th>
  );
}

export function PlainTh({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-[rgba(255,255,255,0.03)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--v2-muted)] sm:px-5",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

// ── vs-NAV proximity mini-bar ──────────────────────────────────────────────────

const LST_DIRECTION_SENSITIVE = isDirectionSensitiveClass("lst");

function VsNavProximityBar({
  spreadBps,
  state,
  symbol,
}: {
  spreadBps: number;
  state: PegState | null;
  symbol: string;
}) {
  if (state == null || state === "UNKNOWN") return null;

  const t = thresholdsFor(symbol, "lst");
  const engineBps = -spreadBps;
  const prox = bandProximity(engineBps, t, LST_DIRECTION_SENSITIVE);
  if (prox == null) return null;

  const isBenignPremium = spreadBps > 0;
  const fillPct = isBenignPremium ? 0 : Math.min(prox, 1) * 100;
  const offScale = !isBenignPremium && prox > 1;
  const driftFrac =
    t.depeg_bps > 0 ? Math.min(t.drift_bps / t.depeg_bps, 1) : 0;
  const displayPct = Math.min(Math.round(prox * 100), 100);
  const label = isBenignPremium
    ? "Premium, benign for an LST, doesn't count toward its depeg band"
    : `${displayPct}% of the way to this LST's depeg line${offScale ? ", off-scale" : ""}`;
  const fillClass = stateMeta(state).dotClass;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative mt-1 block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-white/10"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-white/30"
        style={{ left: `${driftFrac * 100}%` }}
      />
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0", fillClass)}
        style={{ width: `${fillPct}%` }}
      />
    </span>
  );
}

// ── Directory token icon (uncovered rows) ─────────────────────────────────────

function DirectoryTokenIcon({
  mint,
  symbol,
  size = 22,
}: {
  mint: string;
  symbol: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const tint = classTint("lst");

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--v2-bg2)]"
      style={{
        width: size,
        height: size,
        boxShadow: `inset 0 0 0 1px ${tint}66`,
      }}
    >
      {failed ? (
        <span
          className="font-mono font-semibold leading-none"
          style={{
            fontSize: Math.round(size * 0.38),
            color: tint,
            letterSpacing: "-0.02em",
          }}
        >
          {monogramInitials(symbol)}
        </span>
      ) : (
        <img
          src={`/api/token-logo?mint=${encodeURIComponent(mint)}`}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function LifecycleTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--v2-line2)] px-1.5 py-px font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--v2-muted)]">
      {label}
    </span>
  );
}

/** Two different facts, deliberately worded apart.
 *
 *  `covered=false` is a claim about this PRODUCT: Pegana does not track this
 *  LST. `verdictsUnavailable` is a claim about this MOMENT: our own API did not
 *  answer, so we cannot say either way. Collapsing the second into the first —
 *  which is what returning an empty overlay used to do — told every visitor
 *  during a sixty-second blip that Pegana covers nothing. */
function NotCoveredPill({ unavailable = false }: { unavailable?: boolean }) {
  if (unavailable) {
    return (
      <span
        role="status"
        aria-label="Peg verdict temporarily unavailable"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-solid border-[var(--v2-line2)] bg-white/[0.02] px-3.5 py-1.5 font-mono text-[12px] text-[var(--v2-muted)]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-st-unknown" />
        verdict unavailable
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-label="Not yet covered by Pegana"
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-solid border-[var(--v2-line2)] bg-white/[0.02] px-3.5 py-1.5 font-mono text-[12px] text-[var(--v2-muted)]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--v2-muted)]" />
      not yet covered
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LstDirectoryTableV2({
  rows,
  source,
  verdictsUnavailable = false,
}: {
  rows: LstDirectoryRow[];
  source: "directory" | "fallback";
  /** Pegana's own API did not answer for this render. Uncovered rows then say
   *  "verdict unavailable" instead of asserting "not yet covered". */
  verdictsUnavailable?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: LstSortKey; dir: SortDir }>({
    key: "tvl",
    dir: "desc",
  });
  const filtered = useMemo(() => {
    switch (filter) {
      case "covered":
        return rows.filter((r) => r.covered);
      case "drifting":
        return rows.filter(
          (r) => r.covered && r.state != null && DRIFTING_PLUS.has(r.state),
        );
      default:
        return rows;
    }
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => compareRows(a, b, sort.key, sort.dir));
    return copy;
  }, [filtered, sort]);

  // Shared pagination. This surface sits inside the `.pegana-v2` scope, whose
  // --v2-* tokens hold the same values as the app-side --color-* ones
  // (--v2-muted === --color-text-muted, --v2-line === --color-hairline), so the
  // shared control renders identically here without a second styling path.
  const pagination = usePagination({
    items: sorted,
    pageSize: PER_PAGE,
    resetKey: `${filter}|${sort.key}|${sort.dir}`,
    itemNoun: "LST",
  });
  const paged = pagination.pageItems;

  function onSort(key: LstSortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }

  return (
    <div>
      <div className="v2-in-ptabs" role="group" aria-label="Filter LSTs">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={cn("v2-in-ptab", filter === f.value && "v2-in-on")}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <p className="mt-6 font-mono text-[12.5px] text-[var(--v2-muted)]">
          No LSTs match this filter right now.
        </p>
      ) : (
        <>
          <div
            ref={pagination.anchorRef}
            data-scroll-contain
            className="mt-5 overflow-x-auto rounded-[16px] border border-[var(--v2-line)]"
          >
          <div style={{ minWidth: 720 }}>
            <table
              className="w-full table-fixed border-collapse text-left"
              role="table"
              aria-label="Solana LST directory, sortable"
            >
              <colgroup>
                {COL_WIDTHS.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <PlainTh>LST</PlainTh>
                  <LstSortTh
                    label={SORT_LABEL.tvl}
                    colKey="tvl"
                    sort={sort}
                    onSort={onSort}
                  />
                  <LstSortTh
                    label={SORT_LABEL.apy}
                    colKey="apy"
                    sort={sort}
                    onSort={onSort}
                  />
                  <LstSortTh
                    label={SORT_LABEL.vsNav}
                    colKey="vsNav"
                    sort={sort}
                    onSort={onSort}
                  />
                  <PlainTh align="right">Verdict</PlainTh>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const href =
                    row.covered && row.peganaSymbol
                      ? `/asset/${encodeURIComponent(row.peganaSymbol)}`
                      : undefined;
                  // `formatGap`, not a hand-rolled template. The local version
                  // took its minus from JS number formatting, so this column
                  // printed an ASCII hyphen-minus (U+002D) where every other
                  // spread on the site prints a typographic minus (U+2212) —
                  // two different glyphs for the same idea, side by side in the
                  // same product. It also hardcoded 2 decimals, losing
                  // formatGap's magnitude-adaptive precision above 10%.
                  // `row.spreadBps` is already holder-signed (merge.ts stores
                  // `-raw`), which is exactly what formatGap expects.
                  const spreadLabel = formatGap(row.spreadBps);
                  // Sign-driven like every other spread on the site.
                  // `row.spreadBps` is ALREADY holder-signed (merge.ts
                  // verdictFrom stores `-raw`), which matches this helper's
                  // contract. Uncovered rows have no reading at all.
                  const spreadTone = row.covered
                    ? v2SpreadSignClass(row.spreadBps)
                    : "text-[var(--v2-muted)]";
                  const rateLabel = formatRate(row.rate);

                  return (
                    <tr
                      key={row.mint}
                      className={cn(
                        "border-t border-[var(--v2-line)] transition-[background-color] duration-150 hover:bg-white/[0.02]",
                        href && "relative",
                      )}
                    >
                      {/* LST identity column */}
                      <td className="px-4 py-3.5 sm:px-5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          {row.covered ? (
                            <TokenIcon
                              mint={row.mint}
                              symbol={row.symbol}
                              klass="lst"
                              size={22}
                            />
                          ) : (
                            <DirectoryTokenIcon
                              mint={row.mint}
                              symbol={row.symbol}
                            />
                          )}
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5">
                              {href ? (
                                <a
                                  href={href}
                                  className="truncate text-[13.5px] font-medium text-[var(--v2-text)] after:absolute after:inset-0 after:content-[''] hover:underline"
                                >
                                  {row.symbol}
                                </a>
                              ) : (
                                <b className="truncate text-[13.5px] font-medium">
                                  {row.symbol}
                                </b>
                              )}
                              {row.dead ? (
                                <LifecycleTag label="dead" />
                              ) : row.deprecated ? (
                                <LifecycleTag label="deprecated" />
                              ) : null}
                            </span>
                            <span className="truncate font-mono text-[12px] text-[var(--v2-muted)]">
                              {row.name}
                            </span>
                          </span>
                        </span>
                      </td>
                      {/* TVL */}
                      <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums text-[var(--v2-text)] sm:px-5">
                        {formatCompactUsd(row.tvlUsd)}
                      </td>
                      {/* APY */}
                      <td className="px-4 py-3.5 text-right sm:px-5">
                        <span className="flex flex-col items-end">
                          <span className="font-mono text-[13px] tabular-nums text-[var(--v2-text)]">
                            {formatApyPct(row.apy)}
                          </span>
                          {rateLabel && (
                            <span className="font-mono text-[12px] tabular-nums text-[var(--v2-muted)]">
                              {rateLabel}
                            </span>
                          )}
                        </span>
                      </td>
                      {/* vs NAV */}
                      <td className="px-4 py-3.5 sm:px-5">
                        <span className="flex flex-col items-end justify-center">
                          <span
                            className={cn("font-mono text-[13px] tabular-nums", spreadTone)}
                          >
                            {row.covered ? spreadLabel : "-"}
                          </span>
                          {row.covered && row.spreadBps != null && (
                            <VsNavProximityBar
                              spreadBps={row.spreadBps}
                              state={row.state}
                              symbol={row.peganaSymbol ?? row.symbol}
                            />
                          )}
                        </span>
                      </td>
                      {/* Verdict */}
                      <td className="px-4 py-3.5 text-right sm:px-5">
                        <span className="flex items-center justify-end gap-2">
                          {row.covered ? (
                            <StatePillV2 state={row.state} />
                          ) : (
                            <NotCoveredPill unavailable={verdictsUnavailable} />
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination state={pagination} ariaLabel="LST directory pages" />
        </>
      )}

      {source === "fallback" && (
        <p className="mt-3 font-mono text-[12px] text-[var(--v2-muted)]">
          lst-directory.com is unreachable right now; showing Pegana&rsquo;s
          own tracked LSTs instead of the full market.
        </p>
      )}
    </div>
  );
}
