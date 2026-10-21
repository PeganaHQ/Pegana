"use client";

import Link from "@/components/atoms/intent-link";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { formatValue, reconcileBps } from "@/lib/api/format";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { bandProximity } from "@/lib/asset/band";
import { effectiveState } from "@/lib/asset/freshness";
import { isCollateralRatioThresholds, thresholdsFor } from "@/lib/alerts/policy";
import { relativeStamp } from "@/lib/asset/relative-stamp";
import type { AssetCardData, AssetClass, PegState } from "@/lib/api/types";

// Shared vocabulary for the V2 landing organisms (DESIGN.md). Centralised so
// every section spells colors, copy fallbacks and formatting the same way —
// the individual organism files stay focused on one section's markup.

// ---------------------------------------------------------------------------
// Buttons (DESIGN.md §3) — compact mono-label pills. Primary = solid white
// with a nested arrow-in-circle; secondary = ghost outline. Never gradient.
// ---------------------------------------------------------------------------

const pillBase =
  "inline-flex items-center gap-2 rounded-full whitespace-nowrap font-mono text-[12px] font-medium uppercase tracking-[0.09em] transition-[transform,box-shadow,background,border-color] duration-[280ms] ease-[var(--v2-ease)]";

export function PillPrimary({
  href,
  children,
  className,
  nav,
  icon = true,
  external,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  nav?: boolean;
  /** Arrow-in-circle glyph. Artifact CTA: on for hero/close, off for the nav
   *  pill (DESIGN.md/QA parity: nav's "open dashboard" has no icon). */
  icon?: boolean;
  /** Open in a new tab with `rel="noreferrer"` — for off-site CTAs (Telegram,
   *  X) so a click doesn't drop the visitor out of pegana.xyz. */
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cn(
        pillBase,
        "group bg-white text-[#141118] shadow-[0_4px_20px_rgba(0,0,0,.35)] hover:-translate-y-px hover:bg-[#efeaf6] hover:shadow-[0_10px_30px_rgba(0,0,0,.5)] active:scale-[0.97]",
        nav
          ? "px-[18px] py-[9px]"
          : "px-6 py-3 max-[759px]:min-h-[46px] max-[759px]:justify-center",
        className,
      )}
    >
      {children}
      {icon && (
        <span
          aria-hidden
          className="-my-1 ml-0.5 -mr-2.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(20,17,24,.09)] text-[12px] transition-transform duration-500 ease-[var(--v2-ease-phys)] group-hover:translate-x-0.5"
        >
          →
        </span>
      )}
    </Link>
  );
}

export function PillGhost({
  href,
  children,
  className,
  nav,
  hideOnSmall,
  external,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  nav?: boolean;
  hideOnSmall?: boolean;
  /** Open in a new tab with `rel="noreferrer"` — for off-site CTAs. */
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cn(
        pillBase,
        "border border-[var(--v2-line2)] bg-white/[0.02] text-[var(--v2-text)] hover:border-white/[0.42] hover:bg-white/[0.05]",
        nav
          ? "px-4 py-2"
          : "px-[22px] py-[11px] max-[759px]:min-h-[46px] max-[759px]:justify-center",
        hideOnSmall && "hidden sm:inline-flex",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function EyebrowPillV2({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mb-9 inline-flex rounded-full border border-[var(--v2-line)] px-3.5 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--v2-dim)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Peg state → color / label (DESIGN.md §1 semantic status). BLACK_SWAN reuses
// the critical treatment — the artifact never renders it separately and
// DESIGN.md doesn't allocate it its own token.
// ---------------------------------------------------------------------------

export interface StateMeta {
  label: string;
  pillClass: string;
  dotClass: string;
}

const STATE_META: Record<Exclude<PegState, null> | "NULL", StateMeta> = {
  PEGGED: {
    label: "Pegged",
    pillClass: "bg-[rgba(95,211,160,.12)] text-[var(--v2-peg)]",
    dotClass: "bg-[var(--v2-peg)]",
  },
  DRIFT: {
    label: "Drift",
    pillClass: "bg-[rgba(226,166,81,.13)] text-[var(--v2-drift)]",
    dotClass: "bg-[var(--v2-drift)]",
  },
  DEPEG: {
    label: "Depeg",
    pillClass: "bg-[rgba(232,112,137,.13)] text-[var(--v2-depeg)]",
    dotClass: "bg-[var(--v2-depeg)]",
  },
  CRITICAL: {
    label: "Critical",
    pillClass: "bg-[rgba(224,87,78,.14)] text-[var(--v2-crit)]",
    dotClass: "bg-[var(--v2-crit)]",
  },
  BLACK_SWAN: {
    label: "Critical",
    pillClass: "bg-[rgba(224,87,78,.14)] text-[var(--v2-crit)]",
    dotClass: "bg-[var(--v2-crit)]",
  },
  UNKNOWN: {
    label: "Unknown",
    pillClass: "bg-[rgba(143,138,163,.12)] text-[var(--v2-unk)]",
    dotClass: "bg-[var(--v2-unk)]",
  },
  NULL: {
    label: "Unknown",
    pillClass: "bg-[rgba(143,138,163,.12)] text-[var(--v2-unk)]",
    dotClass: "bg-[var(--v2-unk)]",
  },
};

export function stateMeta(state: PegState | null): StateMeta {
  return STATE_META[state ?? "NULL"];
}

export function StatePillV2({ state }: { state: PegState | null }) {
  const m = stateMeta(state);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] font-medium",
        m.pillClass,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dotClass)} />
      {m.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Class label — short mono metadata under the asset symbol (max one middot).
// ---------------------------------------------------------------------------

const CLASS_LABEL: Record<AssetClass, string> = {
  stable_fiat: "Stablecoin",
  stable_cdp: "CDP stable",
  stable_rwa: "RWA stable",
  stable_dn: "Delta-neutral stable",
  stable_fx: "FX stable",
  stable_yield: "Yield stable",
  synth_lev: "Leveraged synthetic",
  lst: "LST · NAV",
};

export function classLabel(klass: AssetClass): string {
  return CLASS_LABEL[klass] ?? klass;
}

// ---------------------------------------------------------------------------
// Board rows — the hero's live peg board. Rows come ONLY from useAssets()
// (/v1/assets). There is deliberately no sample/fallback row set: a peg board
// that paints invented prices and states under a "live" badge while the API is
// slow or rate-limited (and in the SSR HTML every crawler reads) is false
// data. Until real rows arrive the hero renders a neutral skeleton, and on a
// failed fetch an explicit "live data unavailable" state.
// ---------------------------------------------------------------------------

export interface BoardRow {
  symbol: string;
  /** SPL mint — feeds TokenIcon (`/tokens/{mint}.webp`). */
  mint: string;
  klass: AssetClass;
  classLabel: string;
  /** Freshness-gated committed state: a KNOWN-stale snapshot reads UNKNOWN
   *  (H1/H9), and a null state is UNKNOWN. */
  state: PegState;
  marketLabel: string;
  intrinsicLabel: string;
  spreadLabel: string;
  /** HOLDER-signed bps (positive = premium), already negated from the raw
   *  reconcileBps convention. Feeds `v2SpreadSignClass`. Null when unknown. */
  spreadBps: number | null;
  /** Whole-percent share of the way from peg to this asset's OWN depeg line
   *  (0..100, clamped), from its real thresholds. Null when there is no
   *  trustworthy reading (UNKNOWN / stale / no spread). */
  gaugePct: number | null;
  /** The asset is banded on collateral ratio (hyUSD), so the spread has no
   *  proximity reading; the cell says so instead of "-". */
  crBand: boolean;
  updatedLabel: string;
  amberTint: boolean;
  /** Hourly-averaged discount series for the "Spread · 24h" cell, oldest ->
   *  newest, straight off `/v1/assets`. Carried on the row ON PURPOSE: the
   *  board used to fetch this per row via `useAssetSparkline` ->
   *  `useHistory30d`, which paged up to 10 windows of 5000 one-minute buckets
   *  PER ASSET to draw 48 pixels. Measured on production: 68 API requests for
   *  a single homepage load, 65 of them `/history?limit=5000`, against a
   *  300/min per-IP limit. Roughly 4.4 page views a minute from one IP (an
   *  office, CGNAT, a mobile carrier) started returning 429, and the cell then
   *  fell back to "-" with no error shown. This series is already in the
   *  payload the board has fetched anyway, so the cell now costs nothing. */
  spark?: number[];
}

/**
 * V2/marketing twin of `spreadSignClass` (lib/api/format.ts): SAME sign rule,
 * DIFFERENT input contract. This takes an ALREADY HOLDER-SIGNED bps (positive =
 * premium), matching V2's own data layer — `toBoardRow` negates below, and
 * lib/lst/merge.ts's `verdictFrom` stores `spreadBps: -raw`.
 *
 * ⚠️ Do NOT feed this a raw `reconcileBps().bps` — that is the opposite sign
 * and would silently invert every call site.
 * @see lib/api/format.ts spreadSignClass (the raw-input twin).
 */
export function v2SpreadSignClass(holderSignedBps: number | null | undefined): string {
  if (holderSignedBps == null || !Number.isFinite(holderSignedBps) || holderSignedBps === 0) {
    return "text-[var(--v2-text)]";
  }
  return holderSignedBps > 0 ? "text-[var(--v2-peg)]" : "text-[var(--v2-depeg)]";
}

/**
 * Literal hex twins of `--v2-peg` / `--v2-drift` (v2.css). Canvas gradients
 * build `color + alphaHex` strings (`SpreadSparkCanvas`), which only works
 * with a real color literal — `ctx.strokeStyle` doesn't resolve `var(...)`.
 */
export const SPARK_PEG_HEX = "#5fd3a0";
export const SPARK_DRIFT_HEX = "#e2a651";

/** Board sparkline stroke color for a row's committed state. */
export function sparkColorHex(state: PegState | null): string {
  return state === "DRIFT" ? SPARK_DRIFT_HEX : SPARK_PEG_HEX;
}

/**
 * The "Band proximity" reading for one board row: how far the current spread
 * sits from peg toward the asset's OWN depeg line, as a whole percent clamped
 * to 0..100. Same definition, thresholds and carve-outs as the dashboard's
 * BandGauge (`bandProximity` over `thresholdsFor`, which prefers the
 * per-asset `thresholds` served by /v1/assets), so the landing and the app
 * can never disagree about the same asset.
 *
 * `bps` follows the reconcileBps convention (positive = discount). A premium
 * on a direction-sensitive class (LST / stable_yield, ADR-0021) or on
 * synth_lev (display carve-out, see BandGauge) is benign and reads 0. An
 * UNKNOWN state (including a stale snapshot) or a missing spread has no
 * trustworthy reading and returns null, which the board renders as "-".
 */
export function boardGaugePct(
  asset: Pick<AssetCardData, "symbol" | "class" | "thresholds">,
  state: PegState,
  bps: number | null,
): number | null {
  if (state === "UNKNOWN" || bps == null) return null;
  // Collateral-ratio-banded assets (hyUSD) have no spread depeg line of their
  // own; a % here would come from the class fallback table.
  if (isCollateralRatioThresholds(asset.thresholds)) return null;
  const directionSensitive =
    isDirectionSensitiveClass(asset.class) || asset.class === "synth_lev";
  const prox = bandProximity(
    bps,
    thresholdsFor(asset.symbol, asset.class, asset.thresholds),
    directionSensitive,
  );
  if (prox == null) return null;
  return Math.min(Math.round(prox * 100), 100);
}

/**
 * `formatValue`/`formatGap` (lib/api/format) fall back to an em-dash "—" for
 * null input. DESIGN.md bans visible em-dashes anywhere, so every V2 call
 * site runs the result through this to swap it for a plain hyphen instead.
 */
export function dashSafe(s: string): string {
  return s === "\u2014" ? "-" : s;
}

/** Compact "12s" / "3m" / "2h" / "1d" — relativeStamp without the " ago". */
export function timeAgoShort(
  iso: string | null | undefined,
  nowMs: number,
): string {
  if (!iso) return "-";
  const stamp = relativeStamp(iso, nowMs);
  if (!stamp) return "-";
  return stamp === "just now" ? "now" : stamp.replace(/\s*ago$/, "");
}

function toBoardRow(asset: AssetCardData, nowMs: number): BoardRow {
  const state = effectiveState(undefined, asset, nowMs);
  const { bps } = reconcileBps(asset);
  const gaugePct = boardGaugePct(asset, state, bps);
  // Direction-sensitive (ADR-0021 carve-out): a premium (bps < 0) on an LST /
  // stable_yield is benign and must never wear the amber "drifting" tint even
  // if the raw committed state briefly reads DRIFT (e.g. a live-override lag) —
  // only a genuine discount counts as stress for these classes.
  const benignPremium =
    isDirectionSensitiveClass(asset.class) && bps != null && bps < 0;
  return {
    symbol: asset.symbol,
    mint: asset.mint,
    klass: asset.class,
    classLabel: classLabel(asset.class),
    state,
    marketLabel: dashSafe(formatValue(asset.market_usd)),
    intrinsicLabel: dashSafe(formatValue(asset.intrinsic_usd)),
    // % for end users — "bps" is internal jargon. Holder convention (same as
    // /lst + merge.ts verdictFrom): `+` = premium (market ABOVE intrinsic),
    // `−` = discount (below). reconcileBps is signed intrinsic−market (a
    // premium is NEGATIVE), so negate for display — otherwise a healthy LST at
    // a +0.94% premium rendered as a scary "−0.94%".
    spreadLabel:
      bps == null
        ? "-"
        : dashSafe(`${-bps > 0 ? "+" : ""}${(-bps / 100).toFixed(2)}%`),
    // Same negation as spreadLabel above, kept on the row so the color helper
    // and the label can never be derived from opposite signs.
    spreadBps: bps == null ? null : -bps,
    gaugePct,
    crBand: isCollateralRatioThresholds(asset.thresholds),
    updatedLabel: timeAgoShort(asset.updated_at, nowMs),
    amberTint: state === "DRIFT" && !benignPremium,
    // Same `discount` convention the old per-row fetch used (the API builds it
    // as avg(avg_discount) per hour, ordered oldest -> newest), so the line
    // keeps its orientation. Under two points cannot draw a line; the cell
    // renders "-" rather than a fabricated flat one.
    spark:
      asset.series_24h && asset.series_24h.length >= 2
        ? asset.series_24h
        : undefined,
  };
}

/** Hero board filter tabs. `all` keeps every class; the others narrow the
 *  universe BEFORE selection, so each tab shows its own worst-first slice. */
export type BoardFilter = "all" | "stables" | "lsts" | "yield";

export const BOARD_FILTERS: Array<{ id: BoardFilter; label: string }> = [
  { id: "all", label: "all" },
  { id: "stables", label: "stables" },
  { id: "lsts", label: "LSTs" },
  { id: "yield", label: "yield" },
];

const STABLE_CLASSES: ReadonlySet<AssetClass> = new Set<AssetClass>([
  "stable_fiat",
  "stable_cdp",
  "stable_rwa",
  "stable_dn",
  "stable_fx",
]);

export function boardFilterMatches(
  filter: BoardFilter,
  klass: AssetClass,
): boolean {
  switch (filter) {
    case "stables":
      return STABLE_CLASSES.has(klass);
    case "lsts":
      return klass === "lst";
    case "yield":
      return klass === "stable_yield";
    default:
      return true;
  }
}

/** Board ordering, most severe first: CRITICAL > DEPEG > DRIFT > UNKNOWN
 *  (including a null or stale state) > PEGGED. */
const BOARD_RANK: Record<PegState, number> = {
  BLACK_SWAN: 0,
  CRITICAL: 0,
  DEPEG: 1,
  DRIFT: 2,
  UNKNOWN: 3,
  PEGGED: 4,
};

/**
 * Pick the hero board's rows, worst first:
 *  1. every alerting asset (DRIFT and worse), most severe first, tie-broken by
 *     proximity to its own depeg line;
 *  2. ONE UNKNOWN row when the universe has one (DESIGN.md: UNKNOWN stays
 *     visible, never hidden), capped at one so unknowns cannot crowd out real
 *     risk;
 *  3. PEGGED assets fill the rest as a round-robin across classes (so the
 *     board reads as a class mix), each class's closest-to-its-band first;
 *  4. only if slots are still empty, the remaining UNKNOWN rows.
 * State is freshness-gated (`effectiveState`): null and stale both read
 * UNKNOWN, exactly as the row then renders.
 */
export function selectBoardRows(
  assets: AssetCardData[] | undefined,
  nowMs: number,
  max = 8,
  filter: BoardFilter = "all",
): BoardRow[] {
  if (!assets || assets.length === 0) return [];

  const scored = assets
    .filter((a) => boardFilterMatches(filter, a.class))
    .map((a) => {
      const state = effectiveState(undefined, a, nowMs);
      const prox = boardGaugePct(a, state, reconcileBps(a).bps) ?? 0;
      return { a, state, prox };
    });
  type Scored = (typeof scored)[number];
  const worstFirst = (x: Scored, y: Scored) =>
    BOARD_RANK[x.state] - BOARD_RANK[y.state] || y.prox - x.prox;

  const alerting = scored
    .filter((s) => BOARD_RANK[s.state] < BOARD_RANK.UNKNOWN)
    .sort(worstFirst);
  const unknown = scored.filter((s) => s.state === "UNKNOWN");
  const pegged = scored.filter((s) => s.state === "PEGGED");

  const picked: Scored[] = alerting.slice(
    0,
    unknown.length > 0 ? Math.max(max - 1, 0) : max,
  );
  if (unknown.length > 0 && picked.length < max) picked.push(unknown[0]);

  const byClass = new Map<string, Scored[]>();
  for (const s of pegged) {
    const list = byClass.get(s.a.class) ?? [];
    list.push(s);
    byClass.set(s.a.class, list);
  }
  for (const list of byClass.values()) list.sort(worstFirst);
  const lists = Array.from(byClass.values());
  for (let round = 0; picked.length < max; round += 1) {
    let added = false;
    for (const list of lists) {
      if (picked.length >= max) break;
      const s = list[round];
      if (s) {
        picked.push(s);
        added = true;
      }
    }
    if (!added) break;
  }

  for (const s of unknown.slice(1)) {
    if (picked.length >= max) break;
    picked.push(s);
  }

  return picked.map((s) => toBoardRow(s.a, nowMs));
}

// ---------------------------------------------------------------------------
// Protocol logos for the SourcesV2 marquee — real SVGs from web/public/logos,
// order matches the approved artifact.
// ---------------------------------------------------------------------------

// Issuers whose assets we actually cover, plus the venues/oracles the numbers are
// read from. Every entry here must be live on /v1/assets or be a real data source
// — this strip sits under "Where the numbers come from" and is a factual claim.
// REMOVED 2026-07-30: `drift` (dSOL) and `piggybank` (pbUSDC) — both assets are
// deactivated and appear nowhere in the live 68, so showing their marks claimed
// coverage that does not exist.
export const LOGO_ITEMS: Array<{ slug: string; label: string }> = [
  { slug: "sanctum", label: "sanctum" },
  { slug: "jupiter", label: "jupiter" },
  { slug: "hylo", label: "hylo" },
  { slug: "jito", label: "jito" },
  { slug: "marinade", label: "marinade" },
  { slug: "solana", label: "solana" },
  { slug: "circle", label: "circle" },
  { slug: "paypal", label: "paypal" },
  { slug: "ethena", label: "ethena" },
  { slug: "pyth", label: "pyth" },
  { slug: "solayer", label: "solayer" },
  { slug: "dexscreener", label: "dexscreener" },
];

// ---------------------------------------------------------------------------
// Brand-mark SVG (the winged-P monogram) — same path/gradient as
// web/components/atoms/brand-mark.tsx and lib/brand/wave.ts. This is the crisp
// nav/footer LOGO only; the close-section ambient glow uses the retired wave
// shape instead (decor-wave.tsx), so the CTA background reads as it did before
// the mark change.
// ---------------------------------------------------------------------------

export const WAVE_PATH =
  "M 287 323.934 C 287 328.862, 291.688 351.485, 295.511 365 C 317.550 442.933, 360.132 474.683, 459 486.903 C 489.323 490.650, 504.864 490.991, 646.026 490.995 C 734.121 490.998, 786.598 491.370, 792.026 492.029 C 837.249 497.522, 869.597 530.169, 874.143 574.907 C 876.987 602.900, 869.593 629.363, 853.315 649.450 C 842.850 662.364, 825.453 674.519, 810.479 679.379 C 794.834 684.457, 797.787 684.311, 697.500 684.958 L 603.500 685.564 591.845 688.689 C 555.282 698.493, 525.956 723.615, 508.576 760.018 C 503.907 769.797, 499.794 781.950, 488.613 819 C 460.957 910.641, 452.840 938.173, 453.332 938.665 C 453.896 939.229, 498.088 928.979, 514.589 924.456 C 537.947 918.055, 553.272 910.433, 566.543 898.620 C 579.974 886.663, 587.822 873.590, 596.040 849.482 C 598.811 841.351, 602.619 831.365, 604.501 827.291 C 616.455 801.418, 635.133 786.537, 663.500 780.286 C 669.231 779.023, 682.828 778.618, 738.500 778.051 C 802.912 777.395, 807.133 777.241, 818.500 775.131 C 909.455 758.246, 971 681.865, 971 585.869 C 971 552.516, 965.142 525.514, 951.972 498.167 C 926.465 445.198, 873.687 408.757, 812.789 402.067 C 806.516 401.378, 764.223 400.994, 693.289 400.984 C 557.719 400.964, 530.883 400.055, 484.761 393.927 C 411.995 384.259, 349.190 362.101, 298 328.036 C 293.325 324.925, 288.938 322.043, 288.250 321.631 C 287.359 321.097, 287 321.760, 287 323.934 M 334 493.630 C 334 496.161, 339.707 518.813, 342.573 527.654 C 359.727 580.582, 397.803 615.523, 452.500 628.530 C 478.310 634.668, 470.179 634.379, 627.179 634.743 C 784.020 635.107, 777.516 635.320, 789.099 629.450 C 799.458 624.200, 807.938 614.018, 812.053 601.887 C 813.854 596.577, 814.136 593.982, 813.725 586.500 C 812.714 568.099, 802.498 554.698, 784.913 548.707 L 778.500 546.522 638.500 545.930 C 541.273 545.519, 495.292 544.978, 488 544.159 C 420.010 536.522, 375.723 522.507, 341.765 497.884 C 335.049 493.013, 334 492.439, 334 493.630";

export const WaveLogoSvg = forwardRef<
  SVGSVGElement,
  { gradientId: string; className?: string }
>(function WaveLogoSvg({ gradientId, className }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="279 313 699 633"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="300"
          y1="600"
          x2="1000"
          y2="560"
        >
          <stop offset="0" stopColor="#ff8a1e" />
          <stop offset="0.26" stopColor="#fd662c" />
          <stop offset="0.5" stopColor="#f7269b" />
          <stop offset="0.75" stopColor="#c02ef2" />
          <stop offset="1" stopColor="#9b34fa" />
        </linearGradient>
      </defs>
      <path fillRule="evenodd" fill={`url(#${gradientId})`} d={WAVE_PATH} />
    </svg>
  );
});

/** Nav/footer brand lockup: gradient wave + "pegana" wordmark. */
export function BrandLockupV2({
  gradientId,
  href = "/",
  className,
  chroma = false,
}: {
  gradientId: string;
  href?: string;
  className?: string;
  /** Render the animated brand chroma wave (footer lockup). */
  chroma?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="Pegana home"
      className={cn(
        "inline-flex shrink-0 items-center gap-[0.1em] text-[16.5px]",
        className,
      )}
    >
      {chroma ? (
        <>
          {/* animated chroma wave (SMIL); static wave under reduced motion */}
          <img
            src="/brand/pegana-wave-chroma.svg"
                    loading="lazy"
            alt=""
            aria-hidden="true"
            className="v2-chroma h-[1.05em] w-auto object-contain"
          />
          <WaveLogoSvg
            gradientId={gradientId}
            className="v2-chroma-static h-[1.05em] w-auto"
          />
        </>
      ) : (
        <WaveLogoSvg gradientId={gradientId} className="h-[1.05em] w-auto" />
      )}
      <b className="font-semibold tracking-[-0.02em]">egana</b>
    </Link>
  );
}
