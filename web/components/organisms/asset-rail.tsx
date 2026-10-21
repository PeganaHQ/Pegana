"use client";

import Link from "@/components/atoms/intent-link";
import { useEffect, useMemo, useState } from "react";
import type { AssetCardData, HistoryPoint, PegState } from "@/lib/api/types";
import { formatGap, isPlausibleDiscount, spreadSignClass } from "@/lib/api/format";
import { isCollateralRatioThresholds, thresholdsFor } from "@/lib/alerts/policy";
import {
  IconArrowRight,
  IconArrowUpRight,
} from "@/components/atoms/icon-arrow-right";
import { BandGauge } from "@/components/atoms/band-gauge";
import { stateMeta } from "@/lib/asset/state-meta";
import { cn } from "@/lib/utils/cn";

// Sticky right rail of the asset detail page. Stays visible while the user
// scrolls through tab content on the left. Four sections:
//   - Live state (pip + state + spread + tick freshness)
//   - CTAs (Subscribe + Custom threshold)
//   - Health · 24h (4 KPIs derived from the 24h history + 24h alerts)
//   - Quick links (compare, solscan, issuer docs)

interface AssetRailProps {
  asset: AssetCardData;
  bps: number | null;
  state: PegState;
  history: HistoryPoint[] | undefined;
  /** Trailing-24h state-flip count — caller derives from alerts; we render it.
   *  Kept in the same window as the other KPIs (computed from the 24h history)
   *  so the "Health · 24h" header is honest. */
  stateFlips?: number;
  /** Custom issuer docs URL when known. */
  issuerDocsHref?: string;
}

const STATE_TEXT: Record<PegState, string> = {
  PEGGED: "Pegged",
  DRIFT: "Drifting",
  DEPEG: "Depegged",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black swan",
  UNKNOWN: "Unknown",
};

function fmtElapsed(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function AssetRail({
  asset,
  bps,
  state,
  history,
  stateFlips,
  issuerDocsHref,
}: AssetRailProps) {
  // Tick the "updated Ns ago" line every 30s without re-rendering callers.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const elapsed = asset.updated_at
    ? Date.now() - new Date(asset.updated_at).getTime()
    : null;

  const stats = useMemo(() => {
    if (!history || history.length === 0) {
      return { pegPct: null, medianBps: null, worstBps: null };
    }
    let inPeg = 0;
    let kept = 0;
    const absBps: number[] = [];
    let worst = 0;
    for (const p of history) {
      if (!isPlausibleDiscount(p.discount)) continue;
      kept += 1;
      if (p.state === "PEGGED") inPeg += 1;
      const v = Math.round(parseFloat(p.discount) * 10000);
      absBps.push(Math.abs(v));
      if (Math.abs(v) > Math.abs(worst)) worst = v;
    }
    if (kept === 0) return { pegPct: null, medianBps: null, worstBps: null };
    absBps.sort((a, b) => a - b);
    const median = absBps[Math.floor(absBps.length / 2)];
    return {
      pegPct: inPeg / kept,
      medianBps: median,
      worstBps: worst,
    };
  }, [history]);

  const thresholds = thresholdsFor(asset.symbol, asset.class, asset.thresholds);

  // A content rail nested inside <main>; as an <aside> it triggers axe
  // landmark-complementary-is-top-level (a complementary landmark must be
  // top-level, not inside main). It is supplementary inline content, not a
  // page-level region, so a plain div is the correct semantics.
  //
  // V5 verdict-page rail: a premium card (rounded-[20px], surface-1) matching
  // the hero verdict card. The four sections (live state, CTAs, health, quick
  // links) are internal hairline-divided blocks of this ONE card, never
  // individually boxed (anti card-in-card).
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-hairline bg-surface-1 p-5">
      {/* Iridescent top-edge accent — subtle premium signal. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--gradient-iridescent)", opacity: 0.35 }}
      />
      {/* Live state — the state + big spread + freshness duplicate the hero on
          mobile (where the rail stacks directly under it), so that block is
          desktop-only. (Pyth oracle-confidence moved up to the hero verdict
          card — the single source of the trust signal.) */}
      <div className="pb-5">
        <div className="hidden lg:block">
          <p className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
            Live state
          </p>
          <div
            className={`flex items-center gap-2.5 font-mono text-[13px] font-medium ${stateMeta(state).textClass}`}
          >
            <span
              aria-hidden
              className="block h-1.5 w-1.5 rounded-full"
              style={{
                background: stateMeta(state).dotVar,
              }}
            />
            <span>{STATE_TEXT[state]}</span>
          </div>
          <div
            className={cn(
              "mt-2 font-mono text-[34px] font-medium tabular-nums leading-none tracking-[-0.02em]",
              spreadSignClass(bps),
            )}
          >
            {/* Holder convention: `bps` follows reconcileBps (positive =
                discount, negative = premium) — negate for display so `+` =
                premium, `−` = discount (matching /lst + the hero board). */}
            {bps != null ? formatGap(-bps) : "-"}
          </div>
          <div className="mt-2.5 font-mono text-[10px] tracking-[0.04em] text-text-caption">
            {bps != null && bps !== 0
              ? `${bps < 0 ? "premium" : "discount"} to NAV · `
              : ""}
            updated {fmtElapsed(elapsed)}
          </div>
        </div>
        {/* Proximity to depeg — |spread| as a fraction of THIS asset's own
            depeg line (−40 bps = 80% for USDC, ~14% for INF). The on-thesis
            risk-oracle signal the hero's raw spread number hides; shown on all
            widths because it is new information, not a hero duplicate. */}
        <div className="lg:mt-3 lg:border-t lg:border-hairline lg:pt-3">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
            {asset.class === "synth_lev" ? "NAV spread" : "Proximity to depeg"}
          </p>
          <BandGauge
            bps={bps}
            thresholds={thresholds}
            state={state}
            klass={asset.class}
            crBand={isCollateralRatioThresholds(asset.thresholds)}
          />
        </div>
      </div>

      {/* CTAs */}
      <div className="flex flex-col gap-2 border-t border-hairline py-5">
        <Link
          href="/events"
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-text px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-canvas transition-colors duration-300 hover:bg-text/85"
        >
          Follow live transitions <IconArrowRight size={11} />
        </Link>
      </div>

      {/* Quick links — moved ABOVE Health · 24h so actionable navigation
          precedes passive stats (QA audit: quick links were buried at the
          bottom, easy to miss). */}
      <div className="border-t border-hairline py-5">
        <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
          Quick links
        </p>
        <ul className="flex flex-col">
          <RailLink
            href={`/compare?s=${encodeURIComponent(asset.symbol)}`}
            icon={<IconArrowRight size={10} />}
          >
            Compare with peers
          </RailLink>
          <RailLink
            href={`https://solscan.io/token/${asset.mint}`}
            external
            icon={<IconArrowUpRight size={10} />}
          >
            Open Solscan
          </RailLink>
          {issuerDocsHref && (
            <RailLink
              href={issuerDocsHref}
              external
              icon={<IconArrowUpRight size={10} />}
            >
              Issuer docs
            </RailLink>
          )}
        </ul>
      </div>

      {/* Health · 24h */}
      <div className="border-t border-hairline py-5">
        <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
          Health · 24h
        </p>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          <RailKpi
            k={asset.class === "synth_lev" ? "Time near NAV" : "Time pegged"}
            v={
              stats.pegPct != null ? `${(stats.pegPct * 100).toFixed(1)}%` : "-"
            }
            color={
              stats.pegPct != null && stats.pegPct > 0.95
                ? "good"
                : stats.pegPct != null && stats.pegPct > 0.85
                  ? "neutral"
                  : "warn"
            }
          />
          <RailKpi
            k="State flips"
            v={stateFlips != null ? String(stateFlips) : "-"}
          />
          <RailKpi
            k="Median spread"
            v={
              stats.medianBps != null
                ? `${(stats.medianBps / 100).toFixed(2)}%`
                : "-"
            }
          />
          <RailKpi
            k="Worst spread"
            v={stats.worstBps != null ? formatGap(-stats.worstBps) : "-"}
            valueClass={spreadSignClass(stats.worstBps)}
          />
        </dl>
      </div>
    </div>
  );
}

function RailKpi({
  k,
  v,
  color = "default",
  valueClass,
}: {
  k: string;
  v: string;
  color?: "default" | "good" | "neutral" | "warn";
  /** Overrides `color` — used for signed values that follow spreadSignClass. */
  valueClass?: string;
}) {
  const colorCls =
    color === "good"
      ? "text-st-pegged"
      : color === "warn"
        ? "text-st-drift"
        : color === "neutral"
          ? "text-text-muted"
          : "text-text";
  const finalCls = valueClass ?? colorCls;
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-caption">
        {k}
      </dt>
      <dd
        className={`mt-1.5 font-mono text-[14px] font-medium tabular-nums ${finalCls}`}
      >
        {v}
      </dd>
    </div>
  );
}

function RailLink({
  href,
  external,
  icon,
  children,
}: {
  href: string;
  external?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="flex items-center justify-between gap-2 border-b border-hairline py-2.5 text-[12px] text-text-muted transition-colors duration-200 last:border-b-0 hover:text-text"
      >
        <span>{children}</span>
        <span className="text-text-caption">{icon}</span>
      </Link>
    </li>
  );
}
