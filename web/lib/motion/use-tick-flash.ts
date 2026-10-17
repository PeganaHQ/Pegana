"use client";

import { useEffect, useRef } from "react";
import { getGsap } from "./gsap";

/**
 * 120ms iridescent color flash → 180ms fade back to normal.
 * Pass any RefObject<HTMLElement>; the flash applies via `color` tween.
 * Triggers when `signal` changes (signal can be the WS timestamp, asset state, etc).
 */
export function useTickFlash(
  ref: React.RefObject<HTMLElement | null>,
  signal: unknown,
  opts: { color?: string; restore?: string } = {},
) {
  const { color, restore } = opts;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const node = ref.current;
    if (!node) return;
    // Respect prefers-reduced-motion. The flash is a GSAP *JS* tween, so the
    // CSS media-query guard in globals.css does NOT cover it — without this,
    // up to 21 spread cells strobe per WS tick (a WCAG 2.3.3 defect).
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let killed = false;
    (async () => {
      const gsap = await getGsap();
      if (killed || !node) return;
      const styles = getComputedStyle(node);
      // Default flash color comes from a brand token, not a magic hex sprinkled
      // across call sites. Callers may still override per-surface.
      const flashColor =
        color ??
        (styles.getPropertyValue("--color-tick-flash").trim() ||
          "rgb(255, 138, 91)");
      // Restore to the element's OWN current color, not a hardcoded token.
      //
      // This used to fade back to `--color-text` (#f5f5f6) unconditionally, and
      // GSAP writes that as an INLINE style — which beats the element's class
      // forever. It went unnoticed because spread cells were state-coloured and
      // PEGGED's class was `text-text`, the very same #f5f5f6: the bug restored
      // the right color by coincidence. The moment spreads became sign-coloured
      // (2026-08-10) every flashed cell silently reverted to white, class and
      // all. Found by reading computed styles on the deployed page.
      const restoreColor = restore ?? styles.color;
      gsap
        .timeline()
        .to(node, { color: flashColor, duration: 0.12, ease: "none" })
        .to(node, {
          color: restoreColor,
          duration: 0.18,
          ease: "power2.out",
          // Drop the inline color once the tween lands so the class governs
          // again — otherwise the colour freezes at whatever it was when the
          // flash started, and a later re-render with a new sign is ignored.
          onComplete: () => node.style.removeProperty("color"),
        });
    })();
    return () => {
      killed = true;
    };
  }, [signal, color, restore, ref]);
}
