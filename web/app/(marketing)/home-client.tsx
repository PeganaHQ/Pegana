"use client";

import "./v2.css";
import dynamic from "next/dynamic";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { cn } from "@/lib/utils/cn";
import { LenisV2 } from "@/lib/motion/lenis-v2";
import { NavV2 } from "@/components/organisms/v2/nav-v2";
import { HeroV2 } from "@/components/organisms/v2/hero-v2";
import { SourcesV2 } from "@/components/organisms/v2/sources-v2";
// Footer is static links, so it is server-rendered (it used to be a
// client-only dynamic import, which left every footer link out of the SSR
// HTML that crawlers and no-JS clients read).
import { FooterV2 } from "@/components/organisms/v2/footer-v2";

// Below-the-fold organisms are code-split to reduce the initial JS payload
// and improve LCP. The hero (NavV2, HeroV2, SourcesV2) stays static so the
// above-the-fold content is in the first paint's HTML. Each lazy component
// gets a minimal loading placeholder so there's never a blank gap.
const ProductTabsV2 = dynamic(
  () => import("@/components/organisms/v2/product-tabs-v2").then((m) => m.ProductTabsV2),
  { ssr: false, loading: () => <div className="min-h-[400px]" /> },
);
const TrustSceneV2 = dynamic(
  () => import("@/components/organisms/v2/trust-scene-v2").then((m) => m.TrustSceneV2),
  { ssr: false, loading: () => <div className="min-h-[600px]" /> },
);
const CandorV2 = dynamic(
  () => import("@/components/organisms/v2/candor-v2").then((m) => m.CandorV2),
  { ssr: false, loading: () => <div className="min-h-[300px]" /> },
);
const CloseV2 = dynamic(
  () => import("@/components/organisms/v2/close-v2").then((m) => m.CloseV2),
  { ssr: false, loading: () => <div className="min-h-[400px]" /> },
);
const WhatsNewPopup = dynamic(
  () => import("@/components/organisms/v2/whats-new-popup").then((m) => m.WhatsNewPopup),
  { ssr: false },
);

// Landing V2 — approved 2026-07-02 (DESIGN.md at repo root governs; the
// artifact pegana-v3.html is pixel-truth). Sequence per DESIGN.md §5:
//
//   Nav (floating glass pill)
//   1. Hero        — h1 + reveal-mask canvas + arc + live board (/v1/assets)
//   2. Sources     — numbers grid (/v1/stats) + protocol logo marquee
//   3. Product     — pill tabs: rest / websocket / mcp / cli  (lazy)
//   4. Trust       — pinned scroll-scene (Lenis + GSAP ScrollTrigger) + candor  (lazy)
//   5. Close       — statement + ICP line + wave-logo parallax scenario  (lazy)
//   Footer         (server-rendered, static links)
//
// The old v3 landing organisms (hero-landing, channels-section, methodology-
// formula, live-this-week, pinged-cta, logo-marquee, site-footer) are
// replaced on this route, not edited — other pages that import them are
// untouched. The (marketing) layout's SiteNavV2/SiteFooterV2 (W1, 2026-07-03)
// render nothing on "/" so this page's own NavV2/FooterV2 stay the only
// chrome here.

export function HomeClient() {
  return (
    <main
      className={cn(
        switzerV2.variable,
        geistMonoV2.variable,
        "pegana-v2 overflow-x-clip",
      )}
    >
      <LenisV2 />
      <NavV2 />
      <HeroV2 />
      <SourcesV2 />
      <ProductTabsV2 />
      {/* One #trust band: pinned scene + candor rows share the bg2
          surface and hairline borders, exactly like the artifact's .trustsec. */}
      <section
        id="trust"
        className="border-y border-[var(--v2-line)] bg-[var(--v2-bg2)]"
      >
        <TrustSceneV2 />
        <CandorV2 />
      </section>
      <CloseV2 />
      <FooterV2 />
      {/* TEMPORARY relaunch announcement → /whats-new (auto-retires 2026-09-15). */}
      <WhatsNewPopup />
    </main>
  );
}
