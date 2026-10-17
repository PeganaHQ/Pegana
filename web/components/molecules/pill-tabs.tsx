"use client";

// `m`, never `motion`. `motion` pulls the full framer bundle in eagerly and
// defeats the `LazyMotion` split that components/atoms/motion-provider.tsx
// exists to provide (it loads `domMax` on demand, which is what makes
// `layoutId` work). `m` is the same component with the feature set injected by
// that provider. asset-tabs.tsx already did this correctly; this file was the
// one straggler.
import { m } from "framer-motion";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { cn } from "@/lib/utils/cn";

// Reusable pill-tab group — the tokens.xyz DNA (see
// docs/.../w3r3/walk.md §1.2 "sliding indicator branco"), ported to V5 dark
// and generalized so every call-site (dashboard view/class filters, /assets
// class filter, asset-chart's view-mode switcher) shares ONE component
// instead of N hand-rolled bordered-pill copies.
//
// Mechanic, measured from their runtime (not guessed): the "sliding pill" is
// NOT a fixed indicator translating under a static track — it is a SINGLE
// shared element that unmounts/remounts into whichever button is active
// (framer-motion's `layoutId`), and framer computes the FLIP transform
// between the old and new position for you. That transform animates via a
// critically-damped spring (~270ms, zero overshoot) — never a CSS
// `transition: left/width`, which is why their pill never feels "linear".
// `motion-reduce`/`useReducedMotion` collapses that spring to an instant
// (duration: 0) jump, honoring `prefers-reduced-motion` like every other V5
// surface.
//
// `aria-pressed` (not role=tablist/tab): matches the existing V5 pill
// pattern this replaces everywhere it's adopted (dashboard's old PillButton,
// /assets' CLASS_TABS buttons) — a single consistent a11y pattern for
// "pressed filter/option", not "tab panel switcher" (asset-tabs.tsx and
// asset-chart.tsx's range switcher keep their own tablist/44px-touch-target
// semantics respectively; see call-site report for why those don't route
// through this component).
export interface PillTabItem<T extends string = string> {
  key: T;
  label: string;
  /** Optional trailing count badge, e.g. "All 42". */
  count?: number;
  disabled?: boolean;
}

interface PillTabsProps<T extends string> {
  items: ReadonlyArray<PillTabItem<T>>;
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
  className?: string;
}

// Critically-damped, ~270ms, zero overshoot — matches the measured tokens.xyz
// spring (see walk.md: "t=272ms: transform vira none... sem oscilar").
const PILL_SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: PillTabsProps<T>) {
  const reduced = useAppReducedMotion();

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex w-max flex-nowrap items-center gap-0.5 rounded-full bg-text/[0.06] p-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.key)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150",
              active ? "text-canvas" : "text-text-muted hover:text-text",
              item.disabled &&
                "cursor-not-allowed opacity-40 hover:text-text-muted",
            )}
          >
            {/* The ONE shared indicator — framer teleports this span between
                whichever button is currently active and computes the FLIP
                transform. NEVER pair a Tailwind translate/scale utility on
                this element — framer owns its transform exclusively
                (Tailwind v4 trap: mixing the two fights for the same CSS
                property and one silently wins). */}
            {active && (
              <m.span
                layoutId={`pill-tabs-indicator-${ariaLabel}`}
                className="absolute inset-0 rounded-full bg-text"
                transition={reduced ? { duration: 0 } : PILL_SPRING}
              />
            )}
            <span className="relative z-10">{item.label}</span>
            {item.count !== undefined && (
              <span
                className={cn(
                  "relative z-10 font-mono text-[10px]",
                  active ? "text-canvas/70" : "text-text-caption",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
