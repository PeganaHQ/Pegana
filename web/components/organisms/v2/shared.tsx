"use client";

import Link from "next/link";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { formatValue, reconcileBps } from "@/lib/api/format";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
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
// Board rows — the hero's live peg board. Real rows come from useAssets();
// the exact sample set below is the artifact's own fallback, shown with the
// honest "sample" caption whenever live data isn't available yet.
// ---------------------------------------------------------------------------

export interface BoardRow {
  symbol: string;
  /** SPL mint — feeds TokenIcon (`/tokens/{mint}.webp`). */
  mint: string;
  klass: AssetClass;
  classLabel: string;
  state: PegState | null;
  marketLabel: string;
  intrinsicLabel: string;
  spreadLabel: string;
  /** HOLDER-signed bps (positive = premium), already negated from the raw
   *  reconcileBps convention. Feeds `v2SpreadSignClass`. Null when unknown. */
  spreadBps: number | null;
  gaugePct: number | null;
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

export const SAMPLE_BOARD_ROWS: BoardRow[] = [
  {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    klass: "stable_fiat",
    classLabel: "Stablecoin",
    state: "PEGGED",
    marketLabel: "0.9999",
    intrinsicLabel: "1.0000",
    // Holder convention: market (0.9999) < intrinsic (1.0000) ⇒ a discount ⇒ "−".
    spreadLabel: "−0.01%",
    spreadBps: -1,
    gaugePct: 2,
    updatedLabel: "12s",
    amberTint: false,
  },
  {
    symbol: "USDT",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    klass: "stable_fiat",
    classLabel: "Stablecoin",
    state: "PEGGED",
    marketLabel: "1.0001",
    intrinsicLabel: "1.0000",
    // Holder convention: market (1.0001) > intrinsic (1.0000) ⇒ a premium ⇒ "+".
    spreadLabel: "+0.01%",
    spreadBps: 1,
    gaugePct: 2,
    updatedLabel: "12s",
    amberTint: false,
  },
  {
    symbol: "PYUSD",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    klass: "stable_fiat",
    classLabel: "Stablecoin",
    state: "PEGGED",
    marketLabel: "0.9994",
    intrinsicLabel: "1.0000",
    // Holder convention: market (0.9994) < intrinsic (1.0000) ⇒ a discount ⇒ "−".
    spreadLabel: "−0.06%",
    spreadBps: -6,
    gaugePct: 12,
    updatedLabel: "30s",
    amberTint: false,
  },
  {
    symbol: "jitoSOL",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    klass: "lst",
    classLabel: "LST · NAV",
    state: "DRIFT",
    marketLabel: "176.42",
    intrinsicLabel: "177.15",
    // Holder convention: market (176.42) < intrinsic (177.15) ⇒ a discount ⇒
    // "−" (a real discount on an LST — the risky side, hence DRIFT + amber).
    spreadLabel: "−0.41%",
    spreadBps: -41,
    gaugePct: 58,
    updatedLabel: "18s",
    amberTint: true,
  },
  {
    symbol: "mSOL",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    klass: "lst",
    classLabel: "LST · NAV",
    state: "PEGGED",
    marketLabel: "189.03",
    intrinsicLabel: "189.21",
    // Holder convention: market (189.03) < intrinsic (189.21) ⇒ a discount ⇒ "−".
    spreadLabel: "−0.10%",
    spreadBps: -10,
    gaugePct: 14,
    updatedLabel: "18s",
    amberTint: false,
  },
  {
    symbol: "INF",
    mint: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm",
    klass: "lst",
    classLabel: "LST · NAV",
    state: "PEGGED",
    marketLabel: "142.77",
    intrinsicLabel: "142.88",
    // Holder convention: market (142.77) < intrinsic (142.88) ⇒ a discount ⇒ "−".
    spreadLabel: "−0.08%",
    spreadBps: -8,
    gaugePct: 9,
    updatedLabel: "24s",
    amberTint: false,
  },
  {
    symbol: "sUSD",
    mint: "susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X",
    klass: "stable_yield",
    classLabel: "Yield stable · redemption",
    state: "DRIFT",
    marketLabel: "0.9772",
    intrinsicLabel: "1.0006",
    // Holder convention: market (0.9772) < intrinsic (1.0006) ⇒ a discount ⇒ "−".
    spreadLabel: "−2.34%",
    spreadBps: -234,
    gaugePct: 78,
    updatedLabel: "30s",
    amberTint: true,
  },
  {
    symbol: "sHYUSD",
    mint: "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz",
    klass: "stable_yield",
    classLabel: "Yield stable",
    state: "UNKNOWN",
    marketLabel: "-",
    intrinsicLabel: "no verified source",
    spreadLabel: "-",
    spreadBps: null,
    gaugePct: null,
    updatedLabel: "-",
    amberTint: false,
  },
];

/**
 * Deterministic per-symbol sample spread series for the board's "Spread ·
 * 30d" sparkline when the hero is showing sample rows (no live data yet).
 * Verbatim port of the artifact's `series(sym)` (pegana-v5.html) — same LCG
 * seed derivation and per-symbol shape overrides — so the sample sparklines
 * match the approved artifact pixel-for-pixel.
 */
export function sampleSparkSeries(sym: string): number[] {
  const n = 48;
  const out: number[] = [];
  let seed = 0;
  for (let i = 0; i < sym.length; i++) seed += sym.charCodeAt(i) * 7;
  function rnd(): number {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280 - 0.5;
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v = rnd() * 0.16; // flat noise ~ pegged
    if (sym === "jitoSOL") v += t * 0.75 + Math.sin(t * 9) * 0.06; // rising drift
    if (sym === "sUSD") v += (t > 0.8 ? (t - 0.8) * 4.6 : 0) + rnd() * 0.05; // spike at end
    if (sym === "PYUSD") v += Math.sin(t * 5) * 0.1;
    out.push(v);
  }
  return out;
}

/**
 * Literal hex twins of `--v2-peg` / `--v2-drift` (v2.css). Canvas gradients
 * build `color + alphaHex` strings (`SpreadSparkCanvas`), which only works
 * with a real color literal — `ctx.strokeStyle` doesn't resolve `var(...)`.
 */
/**
 * V2/marketing twin of `spreadSignClass` (lib/api/format.ts): SAME sign rule,
 * DIFFERENT input contract. This takes an ALREADY HOLDER-SIGNED bps (positive =
 * premium), matching V2's own data layer — `toBoardRow` negates above, and
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

export const SPARK_PEG_HEX = "#5fd3a0";
export const SPARK_DRIFT_HEX = "#e2a651";

/** Board sparkline stroke color for a row's committed state. */
export function sparkColorHex(state: PegState | null): string {
  return state === "DRIFT" ? SPARK_DRIFT_HEX : SPARK_PEG_HEX;
}

/**
 * Coarse severity bucket for the "band proximity" gauge on LIVE rows. There
 * is no per-asset drift/depeg threshold exposed to the client today (that
 * lives in the engine's calibration config), so this can't reproduce the
 * artifact's exact per-asset percentage honestly — it buckets by the asset's
 * *actual* committed state instead of inventing a number. Sample rows above
 * keep the artifact's real hardcoded percentages.
 *
 * Direction-sensitive (ADR-0021 carve-out): pass `opts.bps` (reconcileBps
 * convention — positive = discount, negative = premium) and `opts.klass` to
 * carve out LST / stable_yield. A premium on one of those classes is benign
 * (holders always redeem at the intrinsic rate) and must never read as
 * "close to depeg" — it clamps to the same calm floor as PEGGED regardless
 * of the committed `state` bucket. Symmetric classes (and calls that omit
 * `opts`) keep the plain state-bucketed reading.
 */
export function bandProximityPct(
  state: PegState | null,
  opts?: { bps?: number | null; klass?: AssetClass },
): number | null {
  if (
    opts?.klass &&
    isDirectionSensitiveClass(opts.klass) &&
    opts?.bps != null &&
    opts.bps < 0
  ) {
    return 8; // benign premium — same calm floor as PEGGED, never off-scale
  }
  switch (state) {
    case "PEGGED":
      return 8;
    case "DRIFT":
      return 55;
    case "DEPEG":
      return 80;
    case "CRITICAL":
    case "BLACK_SWAN":
      return 96;
    default:
      return null;
  }
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
  const { bps } = reconcileBps(asset);
  const gaugePct = bandProximityPct(asset.state, { bps, klass: asset.class });
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
    state: asset.state,
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
    updatedLabel: timeAgoShort(asset.updated_at, nowMs),
    amberTint: asset.state === "DRIFT" && !benignPremium,
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

/**
 * Pick a representative slice of the live universe for the hero board: a
 * round-robin across asset classes (so the board reads as "class mix", not
 * just the first N rows returned), biased toward whichever asset in each
 * class is currently most interesting (UNKNOWN > CRITICAL/BLACK_SWAN > DEPEG
 * > DRIFT > PEGGED). Always keeps at least one UNKNOWN row visible if the
 * universe has one, even if it wouldn't otherwise make the cut — DESIGN.md
 * requires UNKNOWN stay visible, never hidden.
 */
export function selectBoardRows(
  assets: AssetCardData[] | undefined,
  nowMs: number,
  max = 8,
): BoardRow[] {
  if (!assets || assets.length === 0) return [];

  const rank = (s: PegState | null) => {
    switch (s) {
      case "UNKNOWN":
        return 0;
      case "CRITICAL":
      case "BLACK_SWAN":
        return 1;
      case "DEPEG":
        return 2;
      case "DRIFT":
        return 3;
      default:
        return 4;
    }
  };

  const byClass = new Map<string, AssetCardData[]>();
  for (const a of assets) {
    const list = byClass.get(a.class) ?? [];
    list.push(a);
    byClass.set(a.class, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => rank(a.state) - rank(b.state));
  }
  const classes = Array.from(byClass.keys());

  const picked: AssetCardData[] = [];
  const seen = new Set<string>();
  let round = 0;
  while (picked.length < max && round < 20) {
    let addedThisRound = false;
    for (const c of classes) {
      if (picked.length >= max) break;
      const candidate = byClass.get(c)?.[round];
      if (candidate && !seen.has(candidate.symbol)) {
        picked.push(candidate);
        seen.add(candidate.symbol);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }

  if (!picked.some((a) => a.state === "UNKNOWN")) {
    const unknown = assets.find((a) => a.state === "UNKNOWN");
    if (unknown && picked.length > 0) {
      picked[picked.length - 1] = unknown;
    } else if (unknown) {
      picked.push(unknown);
    }
  }

  return picked.map((a) => toBoardRow(a, nowMs));
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
