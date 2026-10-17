"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

interface AnimatedBrandMarkProps {
  className?: string;
  /** Override the "egana" wordmark's own classes (tracking, etc). */
  wordmarkClassName?: string;
  size?: "sm" | "md";
  /** Delay before the wordmark auto-collapses after mount, in ms. */
  settleDelayMs?: number;
  /** Override the SVG gradient id (defaults to a generated one via useId). */
  gradientId?: string;
  /** Reverse mode (dashboard): default shows the full "[P]egana" lockup and
   *  HOVER/focus collapses it to just the winged-P mark — the opposite of the
   *  landing default. No mount auto-collapse; under reduced motion it stays
   *  fully expanded (hover changes nothing). */
  reverse?: boolean;
}

// Navbar-only variant of `BrandMark`: the winged-P mark (SVG path + gradient,
// untouched — see brand-mark.tsx) is permanent chrome, but the "egana"
// wordmark performs a ONE-TIME collapse (max-width + opacity → 0) shortly
// after mount, leaving just the mark in steady state. Hovering or
// keyboard-focusing the enclosing link re-reveals the full "[P]egana"
// lockup; mouse-leave/blur collapses it back.
//
// Deliberately CSS-driven, not framer: the reveal/collapse is read straight
// off ancestor state via Tailwind group variants — no mouseenter/mouseleave/
// focus listeners here; the only JS is the one-shot mount timer that flips the
// *default* (non-hover) state from expanded to collapsed.
//   • Landing/site nav (default mode): reveals on `group-hover/nav` — the
//     pointer entering the whole NAV pill (which carries `group/nav`), not just
//     the logo — plus `group-focus-visible` on the enclosing `<Link className=
//     "group">` so keyboard focus on the logo still reveals the name.
//   • Dashboard (reverse mode): reveals/collapses off the enclosing `<Link
//     className="group">`'s own `:hover`/`:focus-visible` (logo-scoped).
// Call-sites must provide the matching `group`/`group/nav` ancestor.
//
// Reduced motion: the auto-collapse never runs and the lockup stays fully
// expanded ("[P]egana") at all times, including on hover/focus. A UI that
// defaults to a bare, unlabeled "P" and only reveals its name on `:hover` is
// a trap for anyone who can't or won't hover — touch-only visitors, or
// keyboard users tabbing straight past it — and reduced-motion is exactly
// the signal that a visitor may not have (or want) that affordance. Full
// lockup, always, is the safe static choice; hover/focus classes are still
// present but change nothing since the default state already matches them.
//
// Accessible name: the enclosing `<Link>` in every call-site carries its own
// `aria-label` ("Pegana" / "Pegana home" / "Pegana — dashboard home"), which
// wins the name computation regardless of the wordmark's visual state. The
// wordmark span itself is never `display:none`/`hidden`/`aria-hidden` — only
// clipped via `overflow-hidden` + `max-width` + `opacity` — so it stays a
// real, inspectable DOM text node even while visually collapsed.
export function AnimatedBrandMark({
  className,
  wordmarkClassName,
  size = "sm",
  settleDelayMs = 1000,
  gradientId,
  reverse = false,
}: AnimatedBrandMarkProps) {
  const autoGradientId = useId();
  const resolvedGradientId = gradientId ?? autoGradientId;
  const prefersReducedMotion = useAppReducedMotion();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Reverse mode has no mount-time collapse — it starts (and stays) full.
    if (prefersReducedMotion || reverse) return;
    const timer = window.setTimeout(() => setSettled(true), settleDelayMs);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion, reverse, settleDelayMs]);

  const collapsed = !reverse && settled && !prefersReducedMotion;
  const sizeClass = size === "sm" ? "text-[15px]" : "text-[18px]";

  return (
    <span
      role="img"
      aria-label="Pegana"
      className={cn(
        "inline-flex items-center gap-[0.1em] leading-none text-text",
        sizeClass,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="279 313 699 633"
        className="h-[1.05em] w-auto shrink-0"
        fill="none"
      >
        <defs>
          <linearGradient
            id={resolvedGradientId}
            gradientUnits="userSpaceOnUse"
            x1="300"
            y1="600"
            x2="1000"
            y2="560"
          >
            <stop offset="0" stopColor="#ff8a1e" />
            <stop offset="0.26" stopColor="#fd662c" />
            <stop offset="0.5" stopColor="#f7269b" />
            <stop offset="0.75" stopColor="#c02ef2" />
            <stop offset="1" stopColor="#9b34fa" />
          </linearGradient>
        </defs>
        <path
          d="M 287 323.934 C 287 328.862, 291.688 351.485, 295.511 365 C 317.550 442.933, 360.132 474.683, 459 486.903 C 489.323 490.650, 504.864 490.991, 646.026 490.995 C 734.121 490.998, 786.598 491.370, 792.026 492.029 C 837.249 497.522, 869.597 530.169, 874.143 574.907 C 876.987 602.900, 869.593 629.363, 853.315 649.450 C 842.850 662.364, 825.453 674.519, 810.479 679.379 C 794.834 684.457, 797.787 684.311, 697.500 684.958 L 603.500 685.564 591.845 688.689 C 555.282 698.493, 525.956 723.615, 508.576 760.018 C 503.907 769.797, 499.794 781.950, 488.613 819 C 460.957 910.641, 452.840 938.173, 453.332 938.665 C 453.896 939.229, 498.088 928.979, 514.589 924.456 C 537.947 918.055, 553.272 910.433, 566.543 898.620 C 579.974 886.663, 587.822 873.590, 596.040 849.482 C 598.811 841.351, 602.619 831.365, 604.501 827.291 C 616.455 801.418, 635.133 786.537, 663.500 780.286 C 669.231 779.023, 682.828 778.618, 738.500 778.051 C 802.912 777.395, 807.133 777.241, 818.500 775.131 C 909.455 758.246, 971 681.865, 971 585.869 C 971 552.516, 965.142 525.514, 951.972 498.167 C 926.465 445.198, 873.687 408.757, 812.789 402.067 C 806.516 401.378, 764.223 400.994, 693.289 400.984 C 557.719 400.964, 530.883 400.055, 484.761 393.927 C 411.995 384.259, 349.190 362.101, 298 328.036 C 293.325 324.925, 288.938 322.043, 288.250 321.631 C 287.359 321.097, 287 321.760, 287 323.934 M 334 493.630 C 334 496.161, 339.707 518.813, 342.573 527.654 C 359.727 580.582, 397.803 615.523, 452.500 628.530 C 478.310 634.668, 470.179 634.379, 627.179 634.743 C 784.020 635.107, 777.516 635.320, 789.099 629.450 C 799.458 624.200, 807.938 614.018, 812.053 601.887 C 813.854 596.577, 814.136 593.982, 813.725 586.500 C 812.714 568.099, 802.498 554.698, 784.913 548.707 L 778.500 546.522 638.500 545.930 C 541.273 545.519, 495.292 544.978, 488 544.159 C 420.010 536.522, 375.723 522.507, 341.765 497.884 C 335.049 493.013, 334 492.439, 334 493.630"
          fillRule="evenodd"
          fill={`url(#${resolvedGradientId})`}
        />
      </svg>
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap font-semibold transition-[max-width,opacity] duration-[650ms] ease-default",
          reverse
            ? [
                // Dashboard: full by default; collapse to the bare mark on
                // hover/focus. Disabled under reduced motion (stays full).
                "max-w-[3.6em] opacity-100",
                !prefersReducedMotion &&
                  "group-hover:max-w-0 group-hover:opacity-0 group-focus-visible:max-w-0 group-focus-visible:opacity-0",
              ]
            : [
                // Landing: collapse to the mark after mount; reveal when the
                // pointer enters the whole NAV pill (`group/nav`, not just the
                // logo — Rafael 2026-07-18), OR when the logo link itself is
                // keyboard-focused (`group-focus-visible` on the enclosing Link,
                // so tab-to-logo still reveals the name for keyboard users).
                "group-hover/nav:max-w-[3.6em] group-hover/nav:opacity-100 group-focus-visible:max-w-[3.6em] group-focus-visible:opacity-100",
                collapsed ? "max-w-0 opacity-0" : "max-w-[3.6em] opacity-100",
              ],
          wordmarkClassName ?? "tracking-[-0.04em]",
        )}
      >
        egana
      </span>
    </span>
  );
}
