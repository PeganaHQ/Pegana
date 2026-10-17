"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// Port of the artifact's `.rv` reveal system (DESIGN.md §4 "Scroll reveals").
// Hero elements reveal on LOAD (staggered, not scroll-triggered); everything
// else reveals once via IntersectionObserver the first time it's ~10% in
// view, staggered by its index mod 6. Returns a ref + inline style so callers
// can apply it directly to the real element (h1, p, span…) without an extra
// wrapper — matching the artifact's flat markup.
export function useRevealV2<T extends HTMLElement = HTMLElement>(
  opts: {
    mode?: "load" | "scroll";
    index?: number;
  } = {},
) {
  const { mode = "scroll", index = 0 } = opts;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const reduced = useAppReducedMotion();

  useEffect(() => {
    if (reduced) {
      setInView(true);
      return;
    }
    if (mode === "load") {
      const t = setTimeout(() => setInView(true), 100 + index * 110);
      return () => clearTimeout(t);
    }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            revealTimer = setTimeout(() => setInView(true), (index % 6) * 70);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (revealTimer) clearTimeout(revealTimer);
    };
    // `index` is intentionally not a dep: it's stable per call site, and
    // re-running the effect on change would re-observe an already-revealed
    // element. (This repo's eslint config has no react-hooks plugin.)
  }, [reduced, mode]);

  const style: CSSProperties = {
    transition:
      "opacity .85s var(--v2-ease, cubic-bezier(.22,1,.36,1)), transform .85s var(--v2-ease, cubic-bezier(.22,1,.36,1)), filter .85s var(--v2-ease, cubic-bezier(.22,1,.36,1))",
    opacity: inView ? 1 : 0,
    transform: inView ? "none" : "translateY(18px)",
    filter: inView ? "blur(0px)" : "blur(5px)",
  };

  return { ref, style, inView };
}
