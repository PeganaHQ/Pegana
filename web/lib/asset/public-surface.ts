import type { AssetLookup } from "./fetch-asset";

/**
 * Whether a symbol may be shown with a peg verdict on a public surface.
 *
 * Two cases are "not tracked":
 * - the API answered 404 (unknown symbol), and
 * - the asset is a leveraged synth (`synth_lev`, e.g. xSOL). It has no peg, so
 *   a "Pegged" verdict on it is false. The asset page already 404s it, but
 *   the API still serves it, so every other surface that reads the API
 *   directly (OG and Twitter cards, share card, embed badges) must apply the
 *   same gate.
 *
 * `unavailable` (5xx, 429, timeout) is neither: we do not know, so surfaces
 * keep their existing soft-fail (an Unknown badge, a generic card) and never
 * claim the symbol is untracked.
 */
export type PublicSurface = "tracked" | "not_tracked" | "unavailable";

export const OFF_PUBLIC_SURFACE_CLASSES: ReadonlySet<string> = new Set([
  "synth_lev",
]);

export function publicSurfaceOf(lookup: AssetLookup): PublicSurface {
  if (lookup.kind === "not_found") return "not_tracked";
  if (lookup.kind === "unavailable") return "unavailable";
  return OFF_PUBLIC_SURFACE_CLASSES.has(lookup.asset.class)
    ? "not_tracked"
    : "tracked";
}
