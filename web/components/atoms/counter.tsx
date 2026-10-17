"use client";

import { useEffect, useRef, useState } from "react";

interface CounterProps {
  target: number;
  durationMs?: number;
  startOnMount?: boolean;
  className?: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Counter({
  target,
  durationMs = 1400,
  startOnMount = true,
  className,
}: CounterProps) {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const mountedRampedRef = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    if (target === 0) {
      setValue(0);
      return;
    }
    // After the initial mount-ramp, subsequent target changes jump directly
    // (no second ramp). Matches the spec: "ramp on mount only; updates from
    // WS appear immediately without re-ramping every 30s."
    if (mountedRampedRef.current || !startOnMount) {
      setValue(target);
      return;
    }
    mountedRampedRef.current = true;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, startOnMount]);

  return <span className={className}>{value}</span>;
}
