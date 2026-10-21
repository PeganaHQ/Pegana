"use client";

import Link from "@/components/atoms/intent-link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import {
  HERO_LEAD_PX,
  HERO_RANGE_PX,
  glassProgress,
  quantizeProgress,
  scrollGlassProgress,
} from "@/lib/landing/nav-glass";
import { MobileMenu } from "@/components/molecules/mobile-menu";
import { AnimatedBrandMark } from "@/components/atoms/animated-brand-mark";
import { PillGhost, PillPrimary } from "@/components/organisms/v2/shared";

// Floating glass pill nav (DESIGN.md §5.1). Fixed, backdrop-blur, shrinks its
// vertical padding once the page scrolls past 16px — matches the artifact's
// `.nav.scr` state exactly.

// Every label maps to exactly ONE destination — EN-only anchors, no
// duplicates. (The old nav shipped Portuguese anchor slugs and pointed two
// labels each at the same section; "Developers" duplicated "Product" and is
// dropped — devs are served by the persistent "assets api" pill.) The landing
// has one in-page anchor, #product (ProductTabsV2). Methodology goes to its
// own page on every route (it used to jump to the #trust replay band on the
// landing, a different destination under the same label); Verify is its own
// interactive page.
const LANDING_LINKS = [
  { href: "#product", label: "Product" },
  { href: "/methodology", label: "Methodology" },
  { href: "/audit", label: "Verify" },
  { href: "https://docs.pegana.xyz", label: "Docs" },
];

// "site" variant (every non-landing marketing + backtest page): the landing's
// in-page anchors don't exist on these routes, so Product resolves back to the
// landing section via /#product and Methodology resolves to its own page.
const SITE_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/methodology", label: "Methodology" },
  { href: "/audit", label: "Verify" },
  { href: "https://docs.pegana.xyz", label: "Docs" },
];

// The glass is driven by one CSS custom property, --nav-glass (0 clear .. 1
// frosted), written straight onto the pill so scrolling never re-renders React.
// Unset (landing without a hero, mobile) it falls back to 1: frosted.
const G = "var(--nav-glass, 1)";
const GLASS_STYLE: React.CSSProperties = {
  backgroundColor: `rgba(12,12,14,calc(.38 + .38 * ${G}))`,
  borderColor: `rgba(255,255,255,calc(.05 + .07 * ${G}))`,
  backdropFilter: `blur(calc(12px + 16px * ${G})) saturate(calc(1 + .1 * ${G}))`,
  WebkitBackdropFilter: `blur(calc(12px + 16px * ${G})) saturate(calc(1 + .1 * ${G}))`,
  boxShadow: `0 8px 40px rgba(0,0,0,calc(.35 * ${G}))`,
};
// No backdrop-filter support: a more opaque tint, no blur.
// Exactly what the nav shipped before the dynamic glass: used on mobile and on
// a landing render without a hero.
const BASE_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(12,12,14,.62)",
  borderColor: "var(--v2-line)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "0 8px 40px rgba(0,0,0,.35)",
};
const GLASS_FALLBACK_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(12,12,14,.9)",
  borderColor: "rgba(255,255,255,.12)",
  boxShadow: "0 8px 40px rgba(0,0,0,.35)",
};

export function NavV2({
  variant = "landing",
}: {
  variant?: "landing" | "site";
}) {
  const LINKS = variant === "site" ? SITE_LINKS : LANDING_LINKS;
  const [scrolled, setScrolled] = useState(false);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const reduced = useAppReducedMotion();
  const [blurOk, setBlurOk] = useState(true);
  // True only while the landing desktop glass is actually driving the pill.
  const [glassOn, setGlassOn] = useState(false);

  useEffect(() => {
    const css = typeof CSS !== "undefined" ? CSS : undefined;
    if (css?.supports) {
      setBlurOk(
        css.supports("backdrop-filter", "blur(1px)") ||
          css.supports("-webkit-backdrop-filter", "blur(1px)"),
      );
    }
  }, []);

  // Dynamic glass (desktop only), rAF-throttled and written as a CSS
  // variable. Landing: progress is derived from the hero's live board (else
  // its bottom edge) passing under the nav, one rect read per element per
  // frame. Every other route ("site"): it ramps over the first
  // SITE_GLASS_RANGE_PX of scroll, so the pill is light at the top of the page
  // and frosted once content scrolls under it, the same curve as the landing.
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    let hero: Element | null = null;
    let frame: number | null = null;
    const desktop =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 920px)")
        : null;

    const update = () => {
      frame = null;
      if (variant !== "landing") {
        if (!desktop?.matches) {
          pill.style.removeProperty("--nav-glass");
          setGlassOn(false);
          return;
        }
        setGlassOn(true);
        let p = scrollGlassProgress(window.scrollY);
        if (reduced) p = quantizeProgress(p);
        pill.style.setProperty("--nav-glass", p.toFixed(3));
        return;
      }
      if (!hero || !hero.isConnected) hero = document.querySelector("main > header");
      if (!hero || !desktop?.matches) {
        pill.style.removeProperty("--nav-glass");
        setGlassOn(false);
        return;
      }
      setGlassOn(true);
      // The live board sits INSIDE the hero: the light state must only cover
      // the intro, so the ramp follows the board's top edge reaching the nav.
      // DEPENDENCY: `.v2-hero-btable` is the live board's <table> class in
      // hero-v2.tsx and its parent is the board card. hero-v2 is frozen to this
      // component, so we only query it. If that class ever changes the lookup
      // returns undefined and we fall back to the hero's bottom edge (wider,
      // earlier ramp): the nav is still correct, just less precise.
      const board = hero.querySelector(".v2-hero-btable")?.parentElement;
      const navBottom = pill.getBoundingClientRect().bottom;
      let p = board
        ? glassProgress(board.getBoundingClientRect().top, navBottom)
        : glassProgress(
            hero.getBoundingClientRect().bottom,
            navBottom,
            HERO_RANGE_PX,
            HERO_LEAD_PX,
          );
      if (reduced) p = quantizeProgress(p);
      pill.style.setProperty("--nav-glass", p.toFixed(3));
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    desktop?.addEventListener?.("change", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      desktop?.removeEventListener?.("change", schedule);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [variant, reduced]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 top-0 z-[60] transition-[padding] duration-[350ms] ease-[var(--v2-ease)]",
        scrolled ? "py-[9px]" : "py-4",
      )}
    >
      {/* Desktop (>=920px, where the reveal happens): the pill is content-width
          + centered, so when the wordmark ("egana") reveals the WHOLE pill
          grows/shrinks as one unit instead of the nav items repositioning
          (full-width justify-between used to shove the links). The wordmark's
          own max-width transition drives the smooth grow. The pill carries
          `group/nav` so the reveal fires on entering the WHOLE navbar, not just
          the logo (Rafael 2026-07-18). Mobile keeps the full-width logo-left /
          burger-right layout — no hover there, so no reflow to fix. */}
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10 navpill:flex navpill:justify-center">
        <div
          ref={pillRef}
          data-testid="nav-pill"
          style={{
            ...(glassOn
              ? blurOk
                ? GLASS_STYLE
                : GLASS_FALLBACK_STYLE
              : BASE_STYLE),
            // Anchored across route transitions (globals.css chrome-anchor
            // block). It MUST live on the pill, not on an ancestor: a
            // non-none view-transition-name makes its element a backdrop root,
            // and a backdrop-filter only samples content up to its nearest
            // backdrop-root ancestor. On <nav> the pill's blur sampled nothing
            // (text stayed sharp behind it). On the pill itself the element
            // is the root for its descendants only, so its own blur works.
            viewTransitionName: "marketing-nav",
          }}
          className="group/nav flex w-full items-center justify-between gap-4 rounded-full border py-2.5 pl-[22px] pr-3 navpill:inline-flex navpill:w-auto navpill:justify-normal"
        >
          <Link
            href="/"
            aria-label="Pegana home"
            // The hit box measured 20.8x24.8 — under the 44px floor in BOTH
            // dimensions, and this is the one constant way home. min-h-11
            // fixes the height; `px-3 -mx-3` widens the box to ~45px while the
            // negative margin cancels the padding for layout, so the mark does
            // not move a pixel. The pill is 66px tall, so 44 fits inside it.
            className="group -mx-3 inline-flex min-h-11 shrink-0 items-center px-3"
          >
            <AnimatedBrandMark
              gradientId="v2-nav-wave"
              className="text-[16.5px]"
              wordmarkClassName="tracking-[-0.02em]"
            />
          </Link>

          <div className="hidden items-center gap-0.5 navpill:flex">
            {LINKS.map((l, i) => (
              <Link
                key={l.label + i}
                href={l.href}
                className="rounded-full px-3.5 py-2 text-sm text-[var(--v2-muted)] transition-colors duration-[250ms] hover:bg-white/5 hover:text-[var(--v2-text)]"
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* The marketing drawer used to be a plain <div> with a
              max-height transition: no focus trap, no body scroll lock, no
              Escape, no backdrop dismiss. The app shell had solved all four
              years-of-bugs-later with a native <dialog>, and the only thing
              stopping reuse was that MobileMenu hardcoded `lg:hidden` while
              this nav switches at 920px. It takes a breakpoint now, so both
              surfaces get the same hardened sheet instead of the phone
              visitor on marketing getting the weaker one. */}
          <MobileMenu
            links={LINKS.map((l) => ({ href: l.href, label: l.label }))}
            breakpointClassName="navpill:hidden"
            // The pill's 22px/12px left-right padding already compensates most
            // of the touch target's 14px of dead space, but not all of it: the
            // logo sat 23px inside the pill and this glyph 27px. -4px closes it.
            triggerClassName="-mr-1"
            // The pill centres at y=49 (16px nav padding + half of its 66px
            // height) and its logo sits 23px inside it. top 27 puts the X's
            // centre on 49; right 35 puts its glyph 23px inside the pill too
            // (the 20px X is inset 12px in its 44px target).
            // It was top-4/right-5 — centre 38, floating above the pill.
            closeClassName="right-[35px] top-[calc(env(safe-area-inset-top)+27px)]"
            panelTopClassName="top-[calc(72px+env(safe-area-inset-top))]"
            footer={
              // `min-h-11` on both: the nav pill variant is px-4 py-2, which
              // is right for the desktop bar but rendered these two at 36px
              // inside the sheet, below the 44px floor every other row there
              // meets. Scoped to the sheet so the desktop pills are untouched.
              <div className="mt-5 flex gap-2 [&>a]:min-h-11">
                <PillGhost
                  href="https://docs.pegana.xyz/guides/rest-api"
                  nav
                  className="flex-1 justify-center"
                >
                  assets api
                </PillGhost>
                <PillPrimary
                  href="/dashboard"
                  nav
                  icon={false}
                  className="flex-1 justify-center"
                >
                  open dashboard
                </PillPrimary>
              </div>
            }
          />

          <div className="hidden items-center gap-2 sm:flex">
            <PillGhost href="https://docs.pegana.xyz/guides/rest-api" nav>
              assets api
            </PillGhost>
            <PillPrimary href="/dashboard" nav icon={false}>
              open dashboard
            </PillPrimary>
          </div>
        </div>

      </div>
    </nav>
  );
}
