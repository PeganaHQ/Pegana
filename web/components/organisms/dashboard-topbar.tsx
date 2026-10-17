"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { BrandMark } from "@/components/atoms/brand-mark";
import {
  MobileMenu,
  type MobileMenuSection,
} from "@/components/molecules/mobile-menu";
import { openCommandPalette } from "@/components/organisms/command-palette";
import { cn } from "@/lib/utils/cn";

// (app) shell chrome. Three jobs, left → right:
//   1. Identity. The brand returns to the app home (/dashboard, NOT the
//      marketing landing — clicking a logo inside a signed-in app should never
//      eject you to the homepage).
//   2. Primary navigation across the four real product surfaces. /assets (the
//      screener) is a first-class nav item now — the previous variant omitted it
//      on desktop, burying a core surface.
//   3. Search + account. Account is an avatar/menu here, not a nav link: it's a
//      different axis (who am I) from the product surfaces (what am I looking at).
const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    match: (p: string) => p === "/dashboard",
  },
  {
    label: "Assets",
    href: "/assets",
    match: (p: string) => p === "/assets" || p.startsWith("/asset/"),
  },
  {
    label: "Events",
    href: "/events",
    match: (p: string) => p.startsWith("/events"),
  },
  {
    label: "Compare",
    href: "/compare",
    match: (p: string) => p.startsWith("/compare"),
  },
  {
    label: "Loop",
    href: "/systemic",
    match: (p: string) => p.startsWith("/systemic"),
  },
] as const;

// "More" dropdown — secondary surfaces that live off the primary rail.
const MORE_LINKS = [
  { href: "/lst", label: "LST Directory" },
  { href: "/backtest", label: "Backtest" },
  { href: "/heatmap", label: "Risk Heatmap" },
  { href: "/status", label: "Status" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "About" },
] as const;

// The mobile sheet carries everything the bottom tab bar does NOT.
//
// It used to be a flat index of all ten routes, the first four of which were
// Dashboard / Assets / Events / Account — the exact four tabs already pinned to
// the bottom of the screen. Repeating the primary navigation inside the
// secondary one gave the user two ways to do the same thing, buried the six
// destinations that have no other entry point on a phone, and made the sheet
// read as a sitemap rather than a menu.
//
// So the tab bar owns the four primary destinations, and this owns the rest,
// grouped by what the user is trying to do. Account appears here as the
// identity group rather than a navigation peer: "who am I" is a different axis
// from "what am I looking at", which is the same reasoning the desktop header
// uses to make Account an avatar instead of a nav link.
const MOBILE_SECTIONS: MobileMenuSection[] = [
  {
    label: "Analyze",
    items: [
      { href: "/compare", label: "Compare" },
      { href: "/heatmap", label: "Risk heatmap" },
      { href: "/systemic", label: "Loop intelligence" },
    ],
  },
  {
    label: "Directory",
    items: [
      { href: "/lst", label: "LST directory" },
      { href: "/audit", label: "Audit ledger" },
    ],
  },
  {
    label: "Trust",
    items: [
      { href: "/methodology", label: "Methodology" },
      { href: "/status", label: "Status" },
      { href: "/faq", label: "FAQ" },
    ],
  },
];

// Dropdown menu — used for both the "More" nav item and the class filter.
// Pure CSS (no Radix dependency), keyboard-accessible, closes on outside-click
// and Escape. Mirrors the compact pill idiom of the app's existing chrome.
function NavDropdown({
  label,
  items,
  align = "right",
}: {
  label: string;
  items: ReadonlyArray<{ href: string; label: string }>;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 text-[14px] font-medium transition-colors duration-300",
          open ? "text-text" : "text-text-muted hover:text-text",
        )}
      >
        {label}
        <ChevronDown
          size={13}
          className={cn(
            "transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-[calc(100%+12px)] z-50 min-w-[180px] overflow-hidden rounded-[14px] border border-hairline bg-surface-1 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,.4)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-vt="nav-lateral"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-[13px] text-text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-text"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardTopBar() {
  const pathname = usePathname() ?? "";

  return (
    <header
      // Anchored across route transitions (globals.css chrome-anchor block):
      // the header is the user's one fixed reference while the page travels.
      style={{ viewTransitionName: "app-topbar" }}
      className="app-chrome-glass fixed inset-x-0 top-0 z-40 border-b border-hairline lg:sticky"
    >
      {/* Explicit height on phones rather than padding + whatever the tallest
          child happens to be. The old `py-4` around a 44px touch target
          resolved to 77px while every offset in the app was hardcoded to 73px,
          so content sat 4px under the header. Now the header IS
          --app-topbar-h, and the five consumers that offset against it cannot
          disagree with it. 56px is the iOS navigation-bar height and leaves the
          44px targets intact. */}
      {/* `-1px` because --app-topbar-h is the TOTAL height every offset in the
          shell reserves, and the 1px border-bottom lives on the <header> while
          this inner row carries the height. Without it the header measures 57px
          against a 56px reservation and content sits 1px under the chrome,
          which is the same class of drift the token was introduced to end.
          mobile-shell.spec.ts measures the header's border box against the
          token so this cannot silently come back. */}
      <div className="mx-auto flex h-[calc(var(--app-topbar-h)-1px)] max-w-[1240px] items-center gap-2 px-4 sm:gap-4 sm:px-8 lg:h-auto lg:py-3.5 lg:px-10">
        {/* Brand → app home (/dashboard) + live peg spine, pinned left */}
        <Link
          href="/dashboard"
          aria-label="Pegana, dashboard home"
          // `flex items-center`, not just `shrink-0`: BrandMark is an
          // inline-flex span, and a blockified <a> puts it on a text baseline
          // with the font's descender space underneath. Measured on iPhone 13
          // against production, that left the mark at cy 26.1 in a bar whose
          // search icon and menu glyph both sat at 27.5 — 1.4px high, which is
          // ~4 physical pixels at 3x and reads as the logo floating.
          // min-h-11: the hit box measured 22.5px tall, half the 44px floor,
          // on every route. The bar's content area is 55px so a 44px target
          // fits without moving the mark, which stays centred by items-center.
          className="flex min-h-11 shrink-0 items-center"
        >
          <BrandMark />
        </Link>

        {/* Nav + search, pushed right as one group. The mobile sheet renders
            once and self-toggles by breakpoint, so nothing mounts twice. */}
        <div className="ml-auto flex items-center gap-3 sm:gap-4 lg:gap-6">
          <nav
            className="hidden items-center gap-7 lg:flex"
            aria-label="App navigation"
          >
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-vt="nav-lateral"
                  className={cn(
                    "relative pb-1 text-[14px] font-medium transition-colors duration-300",
                    active ? "text-text" : "text-text-muted hover:text-text",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                  {/* Flat solid underline (V5 line-2 token), never the
                      iridescent gradient — DESIGN.md rations the gradient to 5
                      sanctioned moments and chrome nav-state isn't one. */}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 -bottom-[14px] h-px bg-outline"
                    />
                  )}
                </Link>
              );
            })}
            {/* "More" dropdown — secondary surfaces behind a single chevron,
                separated by a hairline divider from the primary rail. */}
            <span aria-hidden className="h-4 w-px shrink-0 bg-hairline" />
            <NavDropdown label="More" items={MORE_LINKS} />
          </nav>

          {/* Desktop: labelled ⌘K button */}
          <button
            type="button"
            onClick={() => openCommandPalette()}
            aria-label="Open command palette"
            className="hidden items-center gap-2 rounded-full border border-hairline px-3 py-1.5 text-[12px] text-text-muted transition-colors duration-300 hover:border-outline hover:text-text lg:inline-flex"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span>Search</span>
            <kbd className="border-l border-hairline pl-2 font-mono text-[10px] tracking-[0.04em] text-text-caption">
              ⌘K
            </kbd>
          </button>
          {/* Mobile: quick search icon (opens the palette without the sheet) */}
          <button
            type="button"
            onClick={() => openCommandPalette()}
            aria-label="Search assets"
            className="inline-flex h-11 w-11 items-center justify-center text-text-muted transition-colors duration-300 hover:text-text lg:hidden"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>

          {/* The topbar carries no identity affordance: every surface is
              public, so there is nothing to sign in to. Four controls in
              390px (logo, search, CTA, burger) is one too many, so the menu
              sheet holds the secondary destinations. */}
          <MobileMenu
            sections={MOBILE_SECTIONS}
            panelTopClassName="top-[calc(var(--app-topbar-h)+env(safe-area-inset-top))]"
            searchAction={() => openCommandPalette()}
            // The container pads 16px and the 44px touch target holds a 16px
            // glyph, so without this the bars sat 30px from the screen edge
            // while the logo sat at 16px. -14px puts the glyph on the same
            // 16px as the logo; the 44px target is untouched.
            triggerClassName="-mr-3.5"
            // Lands the X exactly where the hamburger was: centre 27.5 (the
            // bar is 56px with a 1px bottom border, so its content centres at
            // 27.5) and glyph 16px from the edge, matching the logo. The 20px
            // X sits 12px inside its 44px target, so right-1 lands it on 16.
            // It was top-4/right-5, i.e. centre 38 and glyph 28px in.
            closeClassName="right-1 top-[calc(env(safe-area-inset-top)+((var(--app-topbar-h)-1px-2.75rem)/2))]"
            // Reserve the floating tab bar's band plus a gap. Without it the
            // panel ran the full height: its last rows sat behind the bar, and
            // there was no backdrop left to tap, so tap-outside-to-dismiss was
            // dead on this surface. The panel scrolls, so the reservation costs
            // visible rows, not reachable ones.
            panelClassName="max-h-[calc(100%-var(--app-tabbar-h)-0.75rem)]"
          />
        </div>
      </div>
    </header>
  );
}
