"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import type { Pagination as PaginationState } from "@/lib/hooks/use-pagination";

/**
 * The one pagination control. Replaces four hand-rolled copies whose a11y had
 * already diverged into two incompatible patterns (a `<nav aria-live>` wrapper
 * on /assets and /events, versus a `div` plus a separate `sr-only role=status`
 * twin on /dashboard and /lst).
 *
 * The contract settled on here is the `<nav>` one, with an explicit
 * `role="status"` so the announcement is a status message rather than an
 * incidental live region, and `aria-disabled` alongside `disabled` so the
 * buttons stay discoverable to a screen reader at the ends of the range
 * instead of disappearing from the tab order without explanation.
 */
export function Pagination<T>({
  state,
  ariaLabel,
  className,
}: {
  state: PaginationState<T>;
  /** e.g. "Screener pages". Distinguishes multiple controls on one document. */
  ariaLabel: string;
  className?: string;
}) {
  const { totalPages, hasPrev, hasNext, nextPage, prevPage, label } = state;

  // A control that can never do anything is noise, not affordance.
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        // Room to breathe from the table above. The dashboard used to override
        // this to `mt-0 border-t-0 pt-0`, which put the controls flush against
        // the board's rounded card with a 0px gap — measured, not guessed.
        // Spacing belongs to this component so every surface gets the same one.
        "mt-5 flex items-center justify-between gap-2 border-t border-hairline pt-4 sm:mt-6 sm:gap-3 sm:pt-5",
        className,
      )}
    >
      <PageButton onClick={prevPage} disabled={!hasPrev} label="Previous page">
        ← Prev
      </PageButton>

      {/* One announcement, not two. The visible text and the announced text
          are the same node, so they can never drift out of agreement the way
          the old visible-span + sr-only-twin pairs could. */}
      <span
        role="status"
        aria-live="polite"
        className="min-w-0 truncate text-center font-mono text-[11px] uppercase tracking-[0.06em] text-text-caption"
      >
        {label}
      </span>

      <PageButton onClick={nextPage} disabled={!hasNext} label="Next page">
        Next →
      </PageButton>
    </nav>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={label}
      // 40px, not 44. The pills were 82x44 around 10px text: a box roughly
      // three times the height of what it contained, which on a 350px row next
      // to a 10px label reads as oversized. DESIGN.md §3 asks for compact
      // interactive pills (11-12px vertical padding) and "NEVER large/fat".
      // 40px still clears the WCAG 2.5.8 AA floor (24px) with room to spare;
      // the 11px label also gives the box something to hold.
      className="inline-flex min-h-10 items-center rounded-full border border-hairline px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 ease-default hover:border-outline hover:text-text disabled:pointer-events-none disabled:border-transparent disabled:text-text-caption/40"
    >
      {children}
    </button>
  );
}
