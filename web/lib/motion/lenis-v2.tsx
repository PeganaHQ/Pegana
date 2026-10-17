"use client";

import { useEffect } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { getGsap, getScrollTrigger } from "@/lib/motion/gsap";

// Wraps the V2 landing (only) in Lenis smooth-scroll, wired to GSAP's
// ScrollTrigger ticker so the pinned trust scene (TrustSceneV2) scrubs
// against the smoothed scroll position instead of the raw native one
// (DESIGN.md §8: "Lenis wraps the landing only... OFF under reduced-motion").
// Renders nothing — it's a side-effect-only mount.
export function LenisV2() {
  const reduced = useAppReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let lenis: import("lenis").default | null = null;
    let rafCallback: ((time: number) => void) | null = null;
    let killed = false;

    (async () => {
      const [{ default: Lenis }, gsap, ScrollTrigger] = await Promise.all([
        import("lenis"),
        getGsap(),
        getScrollTrigger(),
      ]);
      if (killed) return;

      lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);

      rafCallback = (time: number) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(rafCallback);
      gsap.ticker.lagSmoothing(0);
    })();

    return () => {
      killed = true;
      if (rafCallback) {
        getGsap().then((gsap) => gsap.ticker.remove(rafCallback!));
      }
      lenis?.destroy();
    };
  }, [reduced]);

  return null;
}
