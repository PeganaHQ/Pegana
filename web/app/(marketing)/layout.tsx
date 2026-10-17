import { CalibrationBanner } from "@/components/molecules/calibration-banner";
import { SkipTarget } from "@/components/atoms/skip-target";
import {
  SiteNavV2,
  SiteFooterV2,
} from "@/components/organisms/v2/site-chrome-v2";
import { ViewTransitions } from "@/lib/motion/view-transitions";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
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
