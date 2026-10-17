"use client";

import { useRef, type KeyboardEvent } from "react";
import { m } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// Tab strip for the asset detail page. V5 pill-tab language (the /assets
// class-filter container): one rounded-full track, active tab solid
// bg-text/text-canvas, mono uppercase 11px. No gradient anywhere here — the
// page budgets its one sanctioned iridescent moment elsewhere (the sticky
// subscribe CTA), so this strip stays plain. Pure presentation — caller owns
// state.
//
// Implements the WAI-ARIA tabs pattern: role=tablist/tab + aria-selected +
// roving tabIndex + Arrow/Home/End keyboard nav. The caller's panel must carry
// role="tabpanel" id="asset-tabpanel" aria-labelledby={`asset-tab-${active}`}.
//
// Shares the FLIP-spring "sliding pill" DNA with components/molecules/
// pill-tabs.tsx (tokens.xyz teardown, w3r3/walk.md §1.2) — the active pill is
// ONE shared `m.span` teleported via `layoutId`, animating via the same
// critically-damped spring — but does NOT route through that generic
// component: PillTabs' API is `aria-pressed`-based (a flat option group),
// while this strip's tablist/aria-selected/roving-tabIndex/Arrow-Home-End
// keyboard contract is a genuinely different a11y pattern that the caller
// (asset detail page, `?tab=` URL) depends on. Forcing it through PillTabs
// would mean dropping tablist semantics to fit a shape that was never meant
// to carry them.
const TAB_SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;

export type AssetTab =
  "overview" | "history" | "mechanism" | "risk" | "identity";

interface AssetTabsProps {
  active: AssetTab;
  onChange: (t: AssetTab) => void;
}

const TABS: { key: AssetTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "mechanism", label: "Mechanism" },
  { key: "risk", label: "Risk" },
  { key: "identity", label: "Identity" },
];

export function AssetTabs({ active, onChange }: AssetTabsProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduced = useAppReducedMotion();

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.key === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(TABS[next].key);
    btnRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Asset sections"
      // Arrow-key handling is delegated here while focus roves across the tabs
      // themselves (btnRefs). tabIndex={-1} makes the tablist programmatically
      // focusable — satisfying the interactive-role contract — without adding
      // it to the tab order, which is what the APG roving-tabindex pattern wants.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="inline-flex max-w-full snap-x items-center gap-1 overflow-x-auto rounded-full border border-hairline p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((t, idx) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            id={`asset-tab-${t.key}`}
            aria-selected={isActive}
            aria-controls="asset-tabpanel"
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative snap-start whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.09em] transition-colors duration-150",
              isActive ? "text-canvas" : "text-text-muted hover:text-text",
            )}
          >
            {/* Same shared-indicator mechanic as pill-tabs.tsx: ONE
                `m.span` teleported between tabs via `layoutId`, FLIP'd
                by a critically-damped spring — never a Tailwind
                translate/scale utility on this element (framer owns its
                transform exclusively). */}
            {isActive && (
              <m.span
                layoutId="asset-tabs-indicator"
                className="absolute inset-0 rounded-full bg-text"
                transition={reduced ? { duration: 0 } : TAB_SPRING}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
