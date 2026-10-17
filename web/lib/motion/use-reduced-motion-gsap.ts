"use client";

import { useEffect } from "react";
import { getGsap } from "./gsap";

/**
 * Run `setup` inside a `gsap.matchMedia` context that respects prefers-reduced-motion.
 * The setup callback receives `gsap` and a `reduced` flag. When reduced, return the
 * `reducedFallback` (typically a no-op or instant reveal).
 */
export function useReducedMotionGsap(
  setup: (
    gsap: typeof import("gsap").gsap,
    reduced: boolean,
  ) => void | (() => void),
  deps: unknown[] = [],
) {
  useEffect(() => {
    let cleanup: void | (() => void);
    let mm: gsap.MatchMedia | null = null;
    let killed = false;
    (async () => {
      const gsap = await getGsap();
      if (killed) return;
      mm = gsap.matchMedia();
      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          reduced: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const reduced = !!context.conditions?.reduced;
          const ret = setup(gsap, reduced);
          if (typeof ret === "function") cleanup = ret;
        },
      );
    })();
    return () => {
      killed = true;
      if (cleanup) cleanup();
      mm?.kill();
    };
  }, deps);
}
