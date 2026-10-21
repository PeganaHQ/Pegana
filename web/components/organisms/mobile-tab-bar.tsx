"use client";

import Link from "@/components/atoms/intent-link";
import { usePathname } from "next/navigation";
import { Activity, House, ListFilter, Scale } from "lucide-react";
import { m } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

const ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: House,
    match: (p: string) => p === "/dashboard",
  },
  {
    href: "/assets",
    label: "Assets",
    icon: ListFilter,
    match: (p: string) => p === "/assets" || p.startsWith("/asset/"),
  },
  {
    href: "/events",
    label: "Events",
    icon: Activity,
    match: (p: string) => p.startsWith("/events"),
  },
  {
    href: "/compare",
    label: "Compare",
    icon: Scale,
    match: (p: string) => p.startsWith("/compare"),
  },
] as const;

// Critically damped, ~270ms, zero overshoot — the same spring pill-tabs and
// asset-tabs already use for their sliding indicators, so every moving
// indicator in the app shares one feel.
const TAB_SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;

export function MobileTabBar() {
  const pathname = usePathname() ?? "";
  const reduced = useAppReducedMotion();

  // Asset detail owns the thumb zone with a contextual "Set peg alert" CTA.
  // Keep the global app tab bar off that route so two fixed bottom bars never
  // compete for the same safe-area space.
  if (pathname.startsWith("/asset/")) return null;

  return (
    <nav
      aria-label="Mobile app navigation"
      // Pinned during route transitions — see the chrome-anchor block in
      // globals.css. A tab bar that slides with the page is the clearest way
      // to make a push read as "the whole app moved".
      style={{ viewTransitionName: "app-tabbar" }}
      // FLOATING AND INSET, not a full-width bar welded to the bottom edge.
      //
      // This was a flush, full-width bar with a hairline top border and a
      // white indicator line above the active cell. That is the Material
      // bottom-navigation pattern, and on an iPhone it reads immediately as
      // "a website pretending to be an app". iOS 26 moved the tab bar OFF the
      // edge: a floating pill inset from left, right and bottom, with the
      // active tab carried by tint and a capsule rather than an underline.
      // ADR-0045 committed this app to that interaction language, and
      // DESIGN.md §3 already says interactive surfaces are pills, so the
      // shape is on-brand rather than an iOS transplant.
      //
      // The wrapper is pointer-events-none so the inset gutters do not eat
      // taps meant for content behind them; the pill re-enables them.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      {/* Scrim. Content scrolls UNDER a floating bar, so without this the last
          row of a table collides with the pill's edges. iOS 26 solves the same
          problem by fading content as it reaches the bottom of the screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+1.5rem)] bg-gradient-to-t from-canvas via-canvas/85 to-transparent"
      />
      <div className="app-tabbar-pill pointer-events-auto flex w-full max-w-[440px] items-center gap-1 rounded-full border border-outline bg-surface-1 p-1.5">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              // Siblings at the same depth. Lateral moves crossfade rather
              // than slide, because sliding would assert a forward/back
              // hierarchy between four peer destinations that have none.
              data-vt="nav-lateral"
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors duration-200 ease-default",
                // Press feedback. The tab bar is the most-tapped surface in the
                // app and had none; `button.tsx` has carried this exact
                // treatment for every other control all along.
                "active:scale-[0.94] motion-reduce:active:scale-100",
                active ? "text-text" : "text-text-muted hover:text-text",
              )}
            >
              {/* ONE shared capsule that framer teleports between tabs and
                  FLIPs, rather than four indicators cutting on and off. Same
                  `layoutId` mechanic as pill-tabs and asset-tabs, so every
                  moving indicator in the app shares one feel.

                  A capsule BEHIND the tab, not a bar above it: the underline
                  is the Material idiom, and it was the single strongest tell
                  that this bar was not native. Flat solid fill, never the
                  gradient — DESIGN.md rations that to 5 moments per page and
                  per-tab state is not one. */}
              {active && (
                <m.span
                  layoutId="mobile-tab-indicator"
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-text/[0.09]"
                  transition={reduced ? { duration: 0 } : TAB_SPRING}
                />
              )}
              <Icon
                className="relative h-[22px] w-[22px]"
                aria-hidden
                strokeWidth={active ? 2.1 : 1.7}
              />
              <span className="relative leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
