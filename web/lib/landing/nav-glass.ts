// Scroll-linked glass progress for the landing nav. 0 = over the hero (near
// clear), 1 = frosted. Pure so the maths is unit-testable.

/** Board-driven ramp: from the board's top edge 120px below the nav to the
 *  edge reaching the nav's bottom. */
export const GLASS_RANGE_PX = 120;
export const GLASS_LEAD_PX = 120;
/** Fallback when no board is found: ramp off the hero's bottom edge instead. */
export const HERO_RANGE_PX = 240;
export const HERO_LEAD_PX = 320;

/**
 * `edge` is the tracked edge in viewport px (the live board's top, else the
 * hero's bottom) and `navBottom` the nav's bottom edge. While the edge is
 * `lead` px or more below the nav the glass is at its light start state (0); it
 * ramps linearly over `range` px and is fully frosted (1) once the edge is
 * `lead - range` px below the nav.
 */
export function glassProgress(
  edge: number,
  navBottom: number,
  range: number = GLASS_RANGE_PX,
  lead: number = GLASS_LEAD_PX,
): number {
  const p = (navBottom + lead - edge) / range;
  return Math.min(1, Math.max(0, p));
}

/** Under reduced motion the glass jumps between its endpoints at the edge. */
export function quantizeProgress(p: number): 0 | 1 {
  return p >= 0.5 ? 1 : 0;
}

/** Non-landing routes have no hero to track: the glass ramps from its light
 *  start state at the top of the page to frosted over the first
 *  SITE_GLASS_RANGE_PX of scroll, the same 0..1 curve the landing uses. */
export const SITE_GLASS_RANGE_PX = 120;

export function scrollGlassProgress(
  scrollY: number,
  range: number = SITE_GLASS_RANGE_PX,
): number {
  if (!Number.isFinite(scrollY) || range <= 0) return 1;
  return Math.min(1, Math.max(0, scrollY / range));
}
