import type { AssetClass } from "@/lib/api/types";

// Muted, on-brand tints used ONLY by the monogram fallback (rare). Keyed by the
// asset's structural class so a missing logo still reads as the right family.
const CLASS_TINT: Record<AssetClass, string> = {
  lst: "#7c8cf8", // SOL-family indigo
  stable_fiat: "#5aa9d6", // cool blue
  stable_cdp: "#6bd6b0", // teal
  stable_rwa: "#c9a86a", // gold
  stable_dn: "#b07cd6", // violet
  stable_fx: "#6b9fd6", // blue
  stable_yield: "#a8c65a", // olive-lime — harmonized with V5's greens but
  // deliberately NOT --color-st-pegged (#5fd3a0): a monogram must never
  // double as a state pip.
  synth_lev: "#ff8a5b", // coral
};

// Warm neutral gray — harmonized with V5's muted palette but deliberately
// NOT --color-st-unknown (#8f8aa3), for the same class-vs-state reason above.
const NEUTRAL = "#96918c";

export function classTint(klass: AssetClass | undefined): string {
  return (klass && CLASS_TINT[klass]) || NEUTRAL;
}

/** First two alphanumeric characters of the symbol, case preserved. */
export function monogramInitials(symbol: string): string {
  const cleaned = symbol.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.slice(0, 2) || "?";
}
