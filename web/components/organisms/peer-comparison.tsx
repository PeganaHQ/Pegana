"use client";

import Link from "@/components/atoms/intent-link";
import { useEffect, useMemo, useState } from "react";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive } from "@/lib/store/live-context";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  spreadSignClass } from "@/lib/state-class";
import {
  holderSignedPct,
  isDeprecated,
  reconcileBps,
  safetyGrade,
  safetyTotalGrade,
} from "@/lib/api/format";
import { effectiveState } from "@/lib/asset/freshness";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, AssetClass, PegState } from "@/lib/api/types";

interface Props {
  asset: AssetCardData;
  className?: string;
}

// "Peer" = anything in the same class with the same peg target. For LSTs this
// surfaces the natural jitoSOL/mSOL/bSOL/JupSOL comparison; for stables it
// shows USDC/USDT/PYUSD/USDS side by side. The user can take one click to
// /compare to actually overlay charts.
function isPeer(a: AssetCardData, focus: AssetCardData): boolean {
  if (a.symbol === focus.symbol) return false;
  if (isDeprecated(a.symbol)) return false;
  if (a.peg_target !== focus.peg_target) return false;
  return (
    a.class === focus.class || classFamily(a.class) === classFamily(focus.class)
  );
}

function classFamily(c: AssetClass): string {
  if (c === "lst") return "lst";
  if (c.startsWith("stable_")) return "stable";
  if (c === "synth_lev") return "synth";
  return c;
}

const GRADE_COLOR: Record<"A" | "B" | "C" | "D", string> = {
  A: "text-st-pegged",
  B: "text-text",
  C: "text-st-drift",
  D: "text-st-depeg-text",
};

// Real <table table-fixed> + <colgroup> + shared PEER_COL_PAD map — same
// mechanic as assets-screener-row.tsx / alert-policy.tsx's threshold ladder:
// one padding value per column, mirrored on the header <th> and every row's
// <td>, so a header label and its column's cells can never drift out of
// alignment. Card chrome matches the approved language (docs/design-
// research/2026-07-14-asset-reimagination-SPEC.md §2): rounded-[20px]
// border-hairline bg-surface-1, header band bg-surface-2/60, hairline
// divide between rows, full-bleed hover veil, stretched-link rows. Mobile
// gets a separate sibling card list — never a card smuggled through a
// colSpan cell (see assets-screener-row.tsx's header comment for the
// horizontal-scroll regression that pattern avoids).
const PEER_COL_PAD = {
  asset: "pl-5 pr-3",
  spread: "px-4",
  state: "px-4",
  safety: "pl-4 pr-5",
} as const;

const HEADER_CELL =
  "py-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption";

/** Capitalized state pill (canonical stateMeta) — mirrors the StatePillCell
 *  pattern in assets-screener-row.tsx. That file doesn't export it, and this
 *  pass is scoped to peer-comparison.tsx only, so it's reproduced locally
 *  rather than widening the touched-files surface. */
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

export function PeerComparison({ asset, className }: Props) {
  const { data: assets } = useAssets();
  // H1/H9 freshness: only trust the live WS frame while the socket is CONNECTED.
  // On a drop, `byAsset` keeps its last frame forever (live-context only flips
  // `connected`, never clears the map), so an ungated read would show stale live
  // data — and disagree with the REST-only hero on the SAME page. Gate every
  // `byAsset` read behind `connected`, exactly like the board / screener / palette.
  const { byAsset, connected } = useLive();

  // Page-level clock so the H1/H9 freshness gate (`effectiveState` below)
  // re-checks staleness on its own cadence instead of only when SWR happens
  // to revalidate. Mirrors the asset page's own tick (asset/[symbol]/page.tsx).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const peers = useMemo(() => {
    if (!assets) return [];
    const list = assets
      .filter((a) => isPeer(a, asset))
      .map((a) => {
        const live = connected ? byAsset[a.symbol] : undefined;
        const state = effectiveState(live, a, now);
        // Keep `bps` nullable — an asset with no reconciled spread must read as
        // "—", never a fabricated "0.00%" (perfectly-pegged) row.
        const bps = reconcileBps({
          discount: live?.discount ?? a.discount,
          intrinsic_usd: a.intrinsic_usd,
          market_usd: a.market_usd,
        }).bps;
        const grade = safetyTotalGrade(safetyGrade(a));
        return { a, state, bps, grade };
      });
    // Worst-first (descending |bps|) — the app-wide risk-oracle convention
    // (dashboard board, screener default). Previously sorted ascending
    // (closest-to-peg first), inverting that convention. Bug B, DECIDED
    // worst-first — see docs/design-research/2026-07-14-asset-
    // reimagination-SPEC.md §4.2. The focus row stays pinned first
    // regardless of this sort.
    // Missing spreads (null bps) sink to the bottom of the worst-first sort —
    // never float up as if "safely near zero".
    list.sort((p, q) => Math.abs(q.bps ?? 0) - Math.abs(p.bps ?? 0));
    return list.slice(0, 5);
  }, [assets, asset, byAsset, connected, now]);

  if (peers.length === 0) return (
    <p className="text-[13px] text-text-muted">No comparable assets found.</p>
  );

  const compareUrl = `/compare?s=${encodeURIComponent(
    [asset.symbol, ...peers.slice(0, 3).map((p) => p.a.symbol)].join(","),
  )}`;

  // Same H1/H9 freshness gate for the focus row — a stale snapshot for the
  // asset the user is currently reading about must degrade to UNKNOWN too,
  // not just its peers (and match the REST-only hero when the socket is down).
  const focusState = effectiveState(
    connected ? byAsset[asset.symbol] : undefined,
    asset,
    now,
  );
  const focusBps = reconcileBps(asset).bps;
  const focusGrade = safetyTotalGrade(safetyGrade(asset));

  return (
    <section
      className={cn(
        "border-t border-hairline px-5 py-10 sm:px-8 sm:py-12",
        className,
      )}
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          How {displaySymbol(asset.symbol)} compares
        </h2>
        <Link
          href={compareUrl}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:text-text"
        >
          Overlay on /compare
          <IconArrowRight size={11} />
        </Link>
      </header>

      <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1">
        {/* Mobile — sibling card list, sm:hidden. Focus row pinned first
            regardless of the peers' worst-first sort below. */}
        <div className="divide-y divide-hairline sm:hidden">
          <PeerMobileCard
            href={`/asset/${encodeURIComponent(asset.symbol)}`}
            symbol={asset.symbol}
            name={asset.name ?? null}
            mint={asset.mint}
            klass={asset.class}
            state={focusState}
            bps={focusBps}
            grade={focusGrade}
            isFocus
          />
          {peers.map((p) => (
            <PeerMobileCard
              key={p.a.symbol}
              href={`/asset/${encodeURIComponent(p.a.symbol)}`}
              symbol={p.a.symbol}
              name={p.a.name ?? null}
              mint={p.a.mint}
              klass={p.a.class}
              state={p.state}
              bps={p.bps}
              grade={p.grade}
            />
          ))}
        </div>

        {/* Desktop — real table. */}
        <div className="hidden overflow-x-auto sm:block">
          <table
            aria-label={`Assets comparable to ${displaySymbol(asset.symbol)}`}
            className="w-full table-fixed border-collapse text-left"
          >
            <colgroup>
              <col />
              <col className="w-[110px]" />
              <col className="w-[150px]" />
              <col className="w-[90px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-hairline bg-surface-2/60">
                <th scope="col" className={cn(HEADER_CELL, PEER_COL_PAD.asset)}>
                  Asset
                </th>
                <th
                  scope="col"
                  className={cn(HEADER_CELL, "text-right", PEER_COL_PAD.spread)}
                >
                  Spread
                </th>
                <th
                  scope="col"
                  className={cn(HEADER_CELL, "text-right", PEER_COL_PAD.state)}
                >
                  State
                </th>
                <th
                  scope="col"
                  className={cn(
                    HEADER_CELL,
                    "text-center",
                    PEER_COL_PAD.safety,
                  )}
                >
                  Safety
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              <PeerTableRow
                href={`/asset/${encodeURIComponent(asset.symbol)}`}
                symbol={asset.symbol}
                name={asset.name ?? null}
                mint={asset.mint}
                klass={asset.class}
                state={focusState}
                bps={focusBps}
                grade={focusGrade}
                isFocus
              />
              {peers.map((p) => (
                <PeerTableRow
                  key={p.a.symbol}
                  href={`/asset/${encodeURIComponent(p.a.symbol)}`}
                  symbol={p.a.symbol}
                  name={p.a.name ?? null}
                  mint={p.a.mint}
                  klass={p.a.class}
                  state={p.state}
                  bps={p.bps}
                  grade={p.grade}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PeerTableRow({
  href,
  symbol,
  name,
  mint,
  klass,
  state,
  bps,
  grade,
  isFocus,
}: {
  href: string;
  symbol: string;
  name: string | null;
  mint: string;
  klass: AssetClass;
  state: PegState;
  bps: number | null;
  grade: "A" | "B" | "C" | "D";
  isFocus?: boolean;
}) {
  return (
    <tr
      className={cn(
        "group relative h-16 transition-colors duration-150",
        "hover:bg-surface-2/50 has-[a:focus-visible]:bg-surface-2/50",
        // Focus-row tint — subtle, pinned at top regardless of sort.
        isFocus && "bg-text/[0.02]",
      )}
    >
      <td className={cn("h-16 py-0 align-middle", PEER_COL_PAD.asset)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenIcon
            mint={mint}
            symbol={displaySymbol(symbol)}
            klass={klass}
            size={20}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {/* Stretched-link row (same mechanic as assets-screener-row.tsx):
                  `after:inset-0` stretches to the nearest positioned
                  ancestor — this <tr> (`relative`) — so the whole row is one
                  click target while the <a> stays position:static. */}
              <Link
                href={href}
                className={cn(
                  "truncate text-[15px] font-medium text-text",
                  "after:absolute after:inset-0 after:content-['']",
                  "focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-outline",
                )}
              >
                {displaySymbol(symbol)}
              </Link>
              {isFocus && (
                <span className="shrink-0 rounded-full border border-hairline px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                  you are here
                </span>
              )}
            </div>
            {name && (
              <div className="truncate text-[12px] text-text-muted">{name}</div>
            )}
          </div>
        </div>
      </td>

      <td
        className={cn("h-16 py-0 align-middle text-right", PEER_COL_PAD.spread)}
      >
        <span
          className={cn(
            "font-mono text-[13px] font-medium tabular-nums",
            spreadSignClass(bps),
          )}
        >
          {holderSignedPct(bps)}
        </span>
      </td>

      <td
        className={cn("h-16 py-0 align-middle text-right", PEER_COL_PAD.state)}
      >
        <StatePillCell state={state} className="ml-auto" />
      </td>

      <td
        className={cn(
          "h-16 py-0 align-middle text-center",
          PEER_COL_PAD.safety,
        )}
      >
        <span
          className={cn(
            "font-mono text-[15px] font-medium",
            GRADE_COLOR[grade],
          )}
        >
          {grade}
        </span>
      </td>
    </tr>
  );
}

// Mobile card — same content parity the pre-table row always had (symbol,
// name, spread, state, safety), living in its own sibling list, never
// inside a colSpan cell of the desktop <table table-fixed> (see
// assets-screener-row.tsx's header comment for the horizontal-scroll
// regression that pattern avoids).
function PeerMobileCard({
  href,
  symbol,
  name,
  mint,
  klass,
  state,
  bps,
  grade,
  isFocus,
}: {
  href: string;
  symbol: string;
  name: string | null;
  mint: string;
  klass: AssetClass;
  state: PegState;
  bps: number | null;
  grade: "A" | "B" | "C" | "D";
  isFocus?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn("block px-4 py-3", isFocus && "bg-text/[0.02]")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TokenIcon
            mint={mint}
            symbol={displaySymbol(symbol)}
            klass={klass}
            size={24}
          />
          <span className="truncate text-[15px] font-medium text-text">
            {displaySymbol(symbol)}
          </span>
          {isFocus && (
            <span className="shrink-0 rounded-full border border-hairline px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
              you are here
            </span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[16px] font-medium tabular-nums",
            spreadSignClass(bps),
          )}
        >
          {holderSignedPct(bps)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <p className="truncate text-[12px] text-text-muted">{name ?? "-"}</p>
        <div className="flex shrink-0 items-center gap-3">
          <StatePillCell state={state} />
          <span
            className={cn(
              "font-mono text-[13px] font-medium",
              GRADE_COLOR[grade],
            )}
          >
            {grade}
          </span>
        </div>
      </div>
    </Link>
  );
}
