"use client";

import { useReducedMotion as useFramerReducedMotion } from "framer-motion";

// Honour the OS-level `prefers-reduced-motion: reduce` setting. Wraps framer's
// hook so consumers stay framework-agnostic and we have a single chokepoint if
// the policy ever needs to broaden again.
export function useAppReducedMotion(): boolean {
  return Boolean(useFramerReducedMotion());
}
