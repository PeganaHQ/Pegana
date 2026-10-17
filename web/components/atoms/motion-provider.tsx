"use client";

import { LazyMotion } from "framer-motion";
import type { ReactNode } from "react";

// Lazily code-splits the full ("domMax") Framer Motion feature bundle out of the
// initial JS payload; `m.*` components render immediately and gain animation once
// the bundle resolves. domMax (not the lighter domAnimation) is required because
// the tab indicators animate via `layoutId` FLIP — a domAnimation swap would
// silently drop those layout animations (react-doctor: use-lazy-motion).
const loadFeatures = () => import("framer-motion").then((mod) => mod.domMax);

export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
