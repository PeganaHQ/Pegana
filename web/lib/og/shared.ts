// Shared constants + helpers for all satori/ImageResponse surfaces (OG images,
// share cards, compare share). Satori cannot read CSS custom properties, so
// the brand palette + gradient are hardcoded here — these are the
// hand-maintained twins of `app/globals.css` `@theme` tokens.
//
// Docs: next/og ImageResponse supports only flexbox (no grid), a subset of
// CSS, max 500KB bundle, and ttf/otf/woff fonts (NOT woff2).

import type { PegState } from "@/lib/api/types";

// V5 iridescent gradient (matches globals.css --gradient-iridescent)
export const IRIDESCENT_GRADIENT =
  "linear-gradient(100deg, #ff8a5b, #ff7a3d 26%, #fb6fae 55%, #e878d8 78%, #df91f7)";

// Brand surface colors for satori (satori can't resolve var(--color-canvas))
export const SATORI_CANVAS = "#0a0a0b";
export const SATORI_TEXT = "#f5f5f6";
export const SATORI_MUTED = "#a3a3ad";
export const SATORI_HAIRLINE = "rgba(255,255,255,0.08)";

// Footer/muted text for satori card footers. Meets WCAG AA on #0a0a0b (6.30:1).
export const SATORI_FOOTER = "#9090a0";

// Brand state palette (matches globals.css --color-st-*)
export const STATE_COLOR: Record<string, string> = {
  PEGGED: "#5fd3a0",
  DRIFT: "#e2a651",
  DEPEG: "#e87089",
  CRITICAL: "#e0574e",
  BLACK_SWAN: "#e0574e",
  UNKNOWN: "#8f8aa3",
};

/**
 * Spread-number colors for satori, which cannot read CSS custom properties.
 * Hex twins of `--color-st-pegged` / `--color-st-depeg-text` / `--color-text`.
 */
export const SPREAD_SIGN_COLOR = {
  positive: "#5fd3a0", // premium
  negative: "#e87089", // discount
  neutral: "#f5f5f6",
} as const;

/**
 * Hex color for a spread number, driven by its displayed sign — the satori twin
 * of `spreadSignClass()` in lib/api/format.ts, with the SAME contract: pass the
 * RAW `reconcileBps`-convention bps (premium NEGATIVE), the exact value that
 * already feeds this card's text. Negates internally.
 *
 * Before 2026-08-10 these cards colored the number with `STATE_COLOR[state]`,
 * which has no neutral PEGGED, so a PEGGED asset's `−0.09%` rendered GREEN.
 * `STATE_COLOR` stays for pips/badges/labels — never for the number.
 */
export function satoriSpreadColor(rawBps: number | null | undefined): string {
  if (rawBps == null || !Number.isFinite(rawBps) || rawBps === 0) {
    return SPREAD_SIGN_COLOR.neutral;
  }
  return rawBps > 0 ? SPREAD_SIGN_COLOR.negative : SPREAD_SIGN_COLOR.positive;
}

export const STATE_LABEL: Record<string, string> = {
  PEGGED: "Pegged",
  DRIFT: "Drift",
  DEPEG: "Depeg",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black swan",
  UNKNOWN: "Unknown",
};

// Format a signed bps gap for display. Sign uses Unicode minus (not hyphen)
// for visual consistency with the web UI's formatGap.
export function formatGapBps(bps: number | null): string {
  if (bps == null) return "-";
  if (bps === 0) return "0.00%";
  const sign = bps > 0 ? "+" : "\u2212";
  const abs = Math.abs(bps);
  const pct = abs / 100;
  if (abs < 1000) return `${sign}${pct.toFixed(2)}%`;
  if (abs < 10000) return `${sign}${pct.toFixed(1)}%`;
  return `${sign}${Math.round(pct)}%`;
}

// Trim a stringified USD value to a fixed decimal display
export function trimDecimal(s: string | null | undefined): string {
  if (!s) return "-";
  const n = parseFloat(s);
  if (Number.isNaN(n)) return s;
  return Math.abs(n) >= 1 ? n.toFixed(4) : n.toFixed(6);
}

// Load a Google font as TTF (satori can't decode woff2; the v1 css API with
// an archaic UA serves .ttf urls). Best-effort — a failed fetch falls back to
// satori's built-in font so the card always renders.
async function loadFontTtf(
  family: string,
  weight: number,
): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css?family=${family.replace(/ /g, "+")}:${weight}`;
  const css = await (
    await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } })
  ).text();
  const m = css.match(/src:\s*url\(([^)]+\.ttf)\)/);
  if (!m?.[1]) throw new Error(`no ttf url for ${family}:${weight}`);
  const res = await fetch(m[1]);
  if (!res.ok) throw new Error(`ttf fetch ${res.status} for ${family}`);
  return res.arrayBuffer();
}

// Load Geist + Geist Mono fonts for satori. Returns the fonts array or
// undefined on failure (satori falls back to its built-in font).
export async function loadGeistFonts(): Promise<
  | {
      name: string;
      data: ArrayBuffer;
      weight: 400 | 500;
      style: "normal";
    }[]
  | undefined
> {
  try {
    const [sans, sansMed, mono] = await Promise.all([
      loadFontTtf("Geist", 400),
      loadFontTtf("Geist", 500),
      loadFontTtf("Geist Mono", 400),
    ]);
    return [
      { name: "Geist", data: sans, weight: 400, style: "normal" },
      { name: "Geist", data: sansMed, weight: 500, style: "normal" },
      { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
    ];
  } catch {
    return undefined;
  }
}

export const SATORI_SANS = "Geist";
export const SATORI_MONO = "Geist Mono";

// Format a timestamp as "9 Aug 2026, 22:08 UTC" for card footers
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatGeneratedAt(d: Date): string {
  const day = d.getUTCDate();
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm} UTC`;
}

// Convert a PegState to its satori-safe color + label. Falls back to UNKNOWN.
export function satoriStateMeta(state: PegState | string | null): {
  color: string;
  label: string;
} {
  const key = state ?? "UNKNOWN";
  return {
    color: STATE_COLOR[key] ?? STATE_COLOR.UNKNOWN!,
    label: STATE_LABEL[key] ?? STATE_LABEL.UNKNOWN!,
  };
}
