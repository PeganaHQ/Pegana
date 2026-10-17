import { CalibrationBanner } from "@/components/molecules/calibration-banner";
import { SkipTarget } from "@/components/atoms/skip-target";
import {
  SiteNavV2,
  SiteFooterV2,
} from "@/components/organisms/v2/site-chrome-v2";

export default function BacktestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <CalibrationBanner />
      <SiteNavV2 />
      <SkipTarget />
      {children}
      <SiteFooterV2 />
    </>
  );
}
