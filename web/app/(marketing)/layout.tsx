import { CalibrationBanner } from "@/components/molecules/calibration-banner";
import { SkipTarget } from "@/components/atoms/skip-target";
import {
  SiteNavV2,
  SiteFooterV2,
} from "@/components/organisms/v2/site-chrome-v2";
import { ViewTransitions } from "@/lib/motion/view-transitions";
import { NO_JS_REVEAL_CSS } from "@/lib/motion/no-js-reveal";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Without JavaScript the JS reveals (useRevealV2, the hero board rows)
          never run, so everything they server-render at opacity 0 stayed
          invisible: the hero CTAs, the live board and the Sources stats
          (measured 2026-10-21 with JS disabled). This only applies when
          scripts are off. It matches `opacity:0` exactly (followed by `;` or
          at the end), so an intentional `opacity:0.4` is left alone. */}
      <noscript>
        <style>{NO_JS_REVEAL_CSS}</style>
      </noscript>
      <CalibrationBanner />
      <SiteNavV2 />
      <SkipTarget />
      {/* Marketing links carry no data-vt, so navigations here do not run a
          transition at all. `/` runs Lenis driving GSAP's ticker and
          TrustSceneV2 is a 340vh ScrollTrigger pin scrubbed off that same
          ticker; translating the outgoing document mid-pin fights it for the
          same scroll position. The orchestrator still mounts so the nav pill
          keeps its anchor when arriving FROM an app route. */}
      <ViewTransitions />
      {children}
      <SiteFooterV2 />
    </>
  );
}
