"use client";

import { useRef } from "react";
import Link from "@/components/atoms/intent-link";
import type { AssetCardData, HistoryPoint, PegState } from "@/lib/api/types";
import {
  formatMarketCapUsd,
  formatSupplyCompact,
  formatUsdValue,
  isPlausibleDiscount,
  parseCirculatingSupply,
  parseMarketCapUsd,
  spreadSignClass,
} from "@/lib/api/format";
import { stateReasonLabel } from "@/lib/asset/state-reason";
import { stateMeta } from "@/lib/asset/state-meta";
import { cn } from "@/lib/utils/cn";
import { useTickFlash } from "@/lib/motion/use-tick-flash";
import { HelpIcon } from "@/components/atoms/help-icon";
import { StatePip } from "@/components/atoms/state-pip";
import { PythConfidenceBadge } from "@/components/atoms/pyth-confidence-badge";
import { OracleDegradedBadge } from "@/components/atoms/oracle-degraded-badge";
import { IntrinsicDegradedBadge } from "@/components/atoms/intrinsic-degraded-badge";
import { useLstLiveness } from "@/lib/hooks/use-lst-liveness";
import { EditorialPullquote } from "@/components/molecules/editorial-pullquote";
import { MonitoringBadge } from "@/components/molecules/monitoring-badge";
import { SustainedBadge } from "@/components/molecules/sustained-badge";
import { TokenIcon, assetMorphName } from "@/components/atoms/token-icon";
import { displaySymbol } from "@/lib/asset/display-symbol";

// Above-fold left column — the VERDICT card. The whole hero now lives inside
// one premium rounded-[20px] card (same V5 card DNA as the board chrome in
// assets-screener-row.tsx) so it reads as a deliberate instrument instead of
// open-air page flow. Content answers, top to bottom, the three questions
// the page must answer first: (1) our verdict on this asset — the spread
// number as evidence, paired with the Capitalized state as a co-lead
// readout; (2) can I trust that number — the Pyth confidence badge sits
// right beside the verdict; (3) how do I verify it — the "Verified state
// history" link to the tamper-evident replay ledger (History tab).
//
// No eyebrow above the ticker (redundant with breadcrumb + below-spread
// state). No italic anywhere — brand.md locked rule.

interface AssetHeroV2Props {
  asset: AssetCardData;
  bps: number | null;
  state: PegState;
  history: HistoryPoint[] | undefined;
  /** Optional pre-built editorial copy (when omitted we render a derived
   *  default from the asset's current numbers). */
  editorial?: React.ReactNode;
}

const STATE_TEXT: Record<PegState, string> = {
  PEGGED: "Pegged",
  DRIFT: "Drifting",
  DEPEG: "Depegged",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black swan",
  UNKNOWN: "Unknown",
};

// Holder convention: `bps` follows reconcileBps (positive = discount, market
// BELOW intrinsic; negative = premium, market ABOVE intrinsic). Display
// flips that to the intuitive reading — `+` = premium, `−` = discount — same
// convention as /lst + merge.ts verdictFrom + the hero board's toBoardRow.
function fmtSpread(bps: number | null): string {
  if (bps == null) return "-";
  const sign = bps > 0 ? "−" : bps < 0 ? "+" : "";
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}`;
}

function fmtElapsed(ts: string | null): string {
  if (!ts) return "-";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

// Risk score tier label — mirrors the state-anchored bands in risk_score.rs:
// PEGGED 0-24, DRIFT 25-49, DEPEG 50-74, CRITICAL/BLACK_SWAN 75-100.
function riskTier(score: number | null): { label: string; color: string } | null {
  if (score == null) return null;
  if (score < 25) return { label: "Low", color: "var(--color-st-pegged)" };
  if (score < 50) return { label: "Moderate", color: "var(--color-st-drift)" };
  if (score < 75) return { label: "High", color: "var(--color-st-depeg-text)" };
  return { label: "Critical", color: "var(--color-st-critical-text)" };
}

/** Circulating supply reads as a token count, not USD — appends the asset's
 *  own symbol (e.g. "417.32M jitoSOL") rather than a currency prefix. Falls
 *  back to a bare "—" (no dangling symbol) when the field is null. */
function fmtSupply(value: number | null, symbol: string): string {
  const s = formatSupplyCompact(value);
  return s === "-" ? "-" : `${s} ${symbol}`;
}

function bpsFromPrices(asset: AssetCardData): number | null {
  const intrinsic =
    asset.intrinsic_usd == null ? NaN : parseFloat(asset.intrinsic_usd);
  const market = asset.market_usd == null ? NaN : parseFloat(asset.market_usd);
  if (
    Number.isFinite(intrinsic) &&
    Number.isFinite(market) &&
    intrinsic !== 0
  ) {
    return Math.round(((intrinsic - market) / intrinsic) * 10000);
  }
  return null;
}

function navSideFromBps(
  value: number | null,
): "premium" | "discount" | "at-nav" | null {
  if (value == null) return null;
  if (value === 0) return "at-nav";
  return value < 0 ? "premium" : "discount";
}

export function AssetHeroV2({
  asset,
  bps,
  state,
  history,
  editorial,
}: AssetHeroV2Props) {
  // Tick-flash the spread number on each live update.
  const spreadRef = useRef<HTMLSpanElement | null>(null);
  useTickFlash(spreadRef, asset.discount);

  // Intrinsic-liveness advisory (LST-only): the directory maintainer's own
  // stale/deprecated/dead flags for this backing. No-op fetch for non-LSTs.
  const { data: livenessFlags } = useLstLiveness(asset.mint, asset.class);

  // 24h drift floor (median of pegged points) — surfaced under the spread.
  // Derived from the 24h `history` prop, so it's labelled 24h (not 7d).
  let driftFloor: number | null = null;
  if (history && history.length > 0) {
    const peggedBps = history
      .filter((p) => isPlausibleDiscount(p.discount) && p.state === "PEGGED")
      .map((p) => Math.round(parseFloat(p.discount) * 10000));
    if (peggedBps.length > 0) {
      const sorted = peggedBps.slice().sort((a, b) => a - b);
      driftFloor = sorted[Math.floor(sorted.length / 2)];
    }
  }

  // 24h range
  let rangeMin: number | null = null;
  let rangeMax: number | null = null;
  if (history && history.length > 0) {
    for (const p of history) {
      if (!isPlausibleDiscount(p.discount)) continue;
      const v = Math.round(parseFloat(p.discount) * 10000);
      if (rangeMin == null || v < rangeMin) rangeMin = v;
      if (rangeMax == null || v > rangeMax) rangeMax = v;
    }
  }

  // Use the reconciled `bps` (reconcileBps: smoothed/declared, cross-checked
  // against the raw prices) — the SAME value the rail, the editorial "% above
  // NAV", and the chart series all derive from — so the big hero number can't
  // disagree with them (the founder saw header +80.00 vs editorial 79.25 —
  // header was `bpsFromPrices`, everything else was `bps`). Fall back to the raw
  // price ratio only when there's no reconciled value. (QA audit 2026-07-23.)
  const displayBps = bps ?? bpsFromPrices(asset);
  const navSide = navSideFromBps(displayBps);

  // Secondary detail strip under the verdict readout — state_reason (on
  // UNKNOWN), navSide, drift floor, and the honest liveness timestamp.
  // Built as a list + "·" separators (rather than the old hand-rolled
  // conditional chain) because the leading dot+label item moved up into the
  // verdict readout, so nothing here is unconditionally first anymore.
  const detailItems: string[] = [];
  if (state === "UNKNOWN") {
    const reason = stateReasonLabel(asset.state_reason);
    if (reason) detailItems.push(reason);
  }
  if (navSide && navSide !== "at-nav") {
    // Only NAV-anchored assets (LSTs, yield stables) trade against a NAV. A
    // fiat/CDP/delta-neutral stable is measured against its $1 peg, and USDC
    // was labelled "discount to NAV".
    const ref =
      asset.anchor && asset.anchor.toUpperCase() !== "NAV" ? "peg" : "NAV";
    detailItems.push(
      navSide === "premium" ? `premium to ${ref}` : `discount to ${ref}`,
    );
  }
  // "drift floor" is a peg concept — meaningless for a leveraged token (no peg).
  if (driftFloor != null && asset.class !== "synth_lev") {
    detailItems.push(`drift floor ${(driftFloor / 100).toFixed(2)}% (24h)`);
  }
  detailItems.push(`updated ${fmtElapsed(asset.updated_at)}`);

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-8">
      {/* Iridescent top-edge accent — one sanctioned gradient moment on this card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--gradient-iridescent)", opacity: 0.5 }}
      />
      {/* Identity — quiet ticker + name subtitle. */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Receiving end of the shared-element morph: the 20-24px mark in
              the board/screener row grows into this 36px one, so the same
              object persists across the cut instead of one disappearing while
              another appears. `assetMorphName` is the only place the name is
              spelled, on both sides. */}
          <TokenIcon
            mint={asset.mint}
            symbol={displaySymbol(asset.symbol)}
            klass={asset.class}
            size={36}
            loading="eager"
            morphName={assetMorphName(asset.symbol)}
          />
          <h1 className="text-[28px] font-medium leading-[1.05] tracking-[-0.02em] text-text sm:text-[36px]">
            {displaySymbol(asset.symbol)}
          </h1>
          {asset.monitoring_only && (
            <MonitoringBadge
              reason={asset.monitoring_reason}
              since={asset.monitoring_since}
              className="mt-1"
            />
          )}
        </div>
        {asset.name && (
          <p className="mt-1.5 text-[16px] leading-[1.4] text-text-muted">
            {asset.name}
          </p>
        )}
      </div>

      {/* The verdict's evidence — the spread number stays the single
          dominant element on the page. */}
      <div className="mt-7 flex items-baseline gap-1 sm:mt-12">
        <span
          ref={spreadRef}
          className={cn(
            "font-mono text-[clamp(42px,12vw,64px)] font-medium leading-[0.9] tracking-[-0.04em] tabular-nums sm:text-[104px]",
            spreadSignClass(displayBps),
          )}
        >
          {fmtSpread(displayBps)}
        </span>
        <span className="font-mono text-[clamp(18px,5vw,28px)] font-normal leading-none text-text-caption sm:text-[34px]">
          %
        </span>
      </div>

      {/* Verdict readout — the Capitalized state, co-leading the number (not
          a buried strip), paired with the Pyth trust signal. Answers
          "what's the verdict" and "can I trust this reading" together. The
          pip carries the state COLOR only — no glow; liveness is the
          timestamp in the strip below, never light (spec §1 law 3). */}
      <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[14px] font-medium",
            stateMeta(state).badgeClass,
          )}
        >
          <StatePip state={state} pulse={false} size={7} />
          {STATE_TEXT[state]}
        </span>
        <PythConfidenceBadge
          confidence={asset.confidence}
          updatedAt={asset.updated_at}
        />
      </div>

      {/* Oracle-degraded flag — its OWN line under the verdict readout, not
          crammed into the pill+confidence row above. PythConfidenceBadge
          reports the raw conf BUCKET; this is the actionable amber heads-up
          that the oracle leg is degraded RIGHT NOW. Renders nothing when
          absent/stale, so it costs zero layout when healthy. */}
      <OracleDegradedBadge
        oracleDegraded={asset.oracle_degraded}
        updatedAt={asset.updated_at}
        className="mt-2.5"
      />

      {/* Intrinsic-liveness flag (LST-only) — the backing-side twin of the
          oracle flag above. Amber heads-up that the directory maintainer marks
          this LST's rate stale / deprecated / dead (the frozen-backing dSOL
          failure mode). Renders nothing for non-LSTs or healthy backings. */}
      <IntrinsicDegradedBadge flags={livenessFlags} className="mt-2.5" />

      {/* Composite risk score badge — the 0-100 peg-risk score (state-anchored,
          risk_score.rs) as a prominent instrument-grade gauge. Sits between the
          verdict readout and the detail strip, so the page reads: spread number
          → state pill → risk score → detail context. Renders nothing when null
          (UNKNOWN / CR-form assets) — the product never fakes a score it can't
          state honestly. */}
      {asset.risk_score != null && (() => {
        const tier = riskTier(asset.risk_score);
        const score = asset.risk_score;
        return (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-2.5 rounded-[14px] border border-hairline bg-surface-2/60 px-4 py-3">
              <div className="flex flex-col">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
                  Peg Risk
                </span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className="font-mono text-[28px] font-medium leading-none tabular-nums"
                    style={{ color: tier?.color ?? "var(--color-text)" }}
                  >
                    {score}
                  </span>
                  <span className="font-mono text-[12px] text-text-caption">
                    /100
                  </span>
                  {tier && (
                    <span
                      className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
                      style={{ color: tier.color }}
                    >
                      {tier.label}
                    </span>
                  )}
                </div>
              </div>
              {/* Mini gauge bar — same gradient as the board row's, but
                  slightly larger here for the hero context. */}
              <div className="ml-2 h-[40px] w-[6px] overflow-hidden rounded-full bg-text/[0.06]">
                <div
                  className="w-full rounded-full transition-[height] duration-500 ease-out"
                  style={{
                    height: `${score}%`,
                    background:
                      "linear-gradient(180deg, var(--color-st-critical), var(--color-st-depeg), var(--color-st-drift), var(--color-st-pegged))",
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] text-text-muted">
        {detailItems.map((item, i) => (
          <span key={item} className="inline-flex items-center gap-3">
            {i > 0 && (
              <span className="text-text-caption/50" aria-hidden="true">
                ·
              </span>
            )}
            {item}
          </span>
        ))}
        <SustainedBadge
          state={state}
          durationSecs={asset.current_state_duration_secs}
          sustained={asset.sustained}
        />
        {/* Help affordance stays at the end of the strip — inline next to
            the "premium" label it broke the text flow and the 40px touch
            target blew up the row height. */}
        {navSide && navSide !== "at-nav" && (
          <HelpIcon
            term={navSide === "premium" ? "premium" : "discount"}
            size="xs"
            side="bottom"
          />
        )}
      </div>

      {/* Reference stats — grouped in two tiers, CoinGecko/CMC-style. PRIMARY
          tier is the evidence that feeds the verdict number above (market vs
          intrinsic price + the 24h range that bounds it); SECONDARY tier is
          pure SIZE/CONTEXT (market cap + circulating supply) — visually
          quieter and explicitly labelled "not a safety signal", because a
          large market cap never implies a peg is safe (USDC was $30B+ in
          market cap when its SVB-driven depeg hit in March 2023). A hairline
          divider (not a nested box) keeps both tiers inside the one hero
          card instead of stacking a card-in-a-card. */}
      <div className="mt-7 border-t border-hairline pt-6 sm:mt-8 sm:pt-7">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <HeroStat
            label="Market price"
            value={formatUsdValue(asset.market_usd ?? null)}
          />
          <HeroStat
            label="Intrinsic price"
            value={formatUsdValue(asset.intrinsic_usd ?? null)}
          />
          <HeroStat
            // Spans both mobile columns: at 375px each column is ~140px and the
            // value renders ~153px of mono, so `truncate` was clipping a DATA
            // value to "+0.04% - -0.…". It already sits alone on row 2 of the
            // 2-col mobile grid, so this is free.
            className="max-sm:col-span-2"
            label="24h range"
            value={
              rangeMin != null && rangeMax != null
                ? `${fmtSpread(rangeMin)}% – ${fmtSpread(rangeMax)}%`
                : "-"
            }
          />
        </dl>

        <div className="mt-6 flex items-center gap-1 border-t border-hairline pt-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
            Size: not a safety signal
          </p>
          <HelpIcon term="market_cap" size="xs" side="top" />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <HeroStat
            label="Market cap"
            tone="muted"
            value={formatMarketCapUsd(parseMarketCapUsd(asset.market_cap))}
          />
          <HeroStat
            label="Circulating supply"
            tone="muted"
            value={fmtSupply(
              parseCirculatingSupply(asset.circulating_supply),
              displaySymbol(asset.symbol),
            )}
          />
        </dl>
      </div>

      {/* Moat affordance — the signature: a tamper-evident, byte-exact
          replayable state ledger. Now carries the "byte-exact replayable"
          framing (mirrors the dashboard verdict) so the differentiator is
          legible, not just a bare link. Understated: this is the moat, not a CTA. */}
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-text-caption">
        Byte-exact replayable ·{" "}
        <Link
          href={`/asset/${encodeURIComponent(asset.symbol)}?tab=history`}
          // `scroll={false}`: Next's default post-navigation scroll-to-top would
          // otherwise clobber the scrollIntoView below (it runs, then Next resets
          // to y=0), so the link appeared to do nothing (QA audit 2026-07-23).
          scroll={false}
          onClick={() => {
            // A query-only tab switch doesn't move the viewport, so bring the tab
            // section (History) into view — otherwise this link silently activates
            // a tab ~1000px below the fold and reads as broken, esp. on mobile.
            requestAnimationFrame(() =>
              document
                .getElementById("asset-tabs")
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="inline-flex items-center gap-1 text-text-muted transition-colors duration-150 ease-out hover:text-text motion-reduce:transition-none"
        >
          Verified state history
          <span aria-hidden="true">→</span>
        </Link>
      </p>

      {/* Editorial pullquote — coral left-bar, no italic. */}
      {editorial && (
        <div className="mt-10 sm:mt-12">
          <EditorialPullquote>{editorial}</EditorialPullquote>
        </div>
      )}
    </div>
  );
}

/** A single labelled reference stat inside the hero's grouped `<dl>` grids.
 *  `tone="primary"` (default) is the market/intrinsic/range tier that feeds
 *  the verdict number above — full-contrast, slightly larger. `tone="muted"`
 *  is the SIZE tier (market cap / circulating supply) — deliberately
 *  quieter and NEVER risk-colored, since size is context, not a peg-safety
 *  signal. `dt`/`dd` pair with the two `<dl>` wrappers at the call site. */
function HeroStat({
  label,
  value,
  tone = "primary",
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "primary" | "muted";
  /** Grid-span escape hatch — a value too wide for one mobile column can claim
   *  both instead of being ellipsised. `min-w-0` below is what ENABLES the
   *  truncate, so widening the cell is the correct fix, not removing it. */
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1.5 truncate font-mono tabular-nums leading-none",
          tone === "primary"
            ? "text-[17px] font-medium text-text sm:text-[19px]"
            : "text-[14px] text-text-muted",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
