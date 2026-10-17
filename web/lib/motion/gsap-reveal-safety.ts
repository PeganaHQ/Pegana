/**
 * GSAP + ScrollTrigger can leave an element stuck at opacity:0 when the
 * trigger never fires (element above the start position on mount, dynamic
 * imports racing with first paint, hydration timing). This helper schedules
 * a one-shot fallback that force-shows any element still at computed
 * opacity:0 after the safety window.
 *
 * Mirrors the inline pattern proven in pinged-cta.tsx. Use it in every
 * GSAP entrance tween that hides content via opacity:0.
 *
 * Returns a cleanup that cancels the pending fallback. Always wire it into
 * the matchMedia cleanup list so unmounts don't leak timers.
 */
export function revealSafety(
  elements: HTMLElement[] | NodeListOf<HTMLElement>,
  ms = 2000,
): () => void {
  if (typeof window === "undefined") return () => {};
  const id = window.setTimeout(() => {
    elements.forEach((el) => {
      if (window.getComputedStyle(el).opacity === "0") {
        el.style.opacity = "1";
        el.style.transform = "none";
      }
    });
  }, ms);
  return () => window.clearTimeout(id);
}
