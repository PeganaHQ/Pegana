"use client";

import "@/app/(marketing)/v2.css";
import { usePathname } from "next/navigation";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { cn } from "@/lib/utils/cn";
import { NavV2 } from "@/components/organisms/v2/nav-v2";
import { FooterV2 } from "@/components/organisms/v2/footer-v2";

// W1 (2026-07-03): the V5 chrome (nav-v2 / footer-v2) mounted once for every
// (marketing) + /backtest page, replacing the old shared header/footer pair.
// The landing ("/") ships its own NavV2 + FooterV2 baked into the page itself
// (app/(marketing)/page.tsx), so both components here render nothing on "/" —
// otherwise the landing would get double chrome.

export function SiteNavV2() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <div
      className={cn(
        "pegana-v2",
        switzerV2.variable,
        geistMonoV2.variable,
        "z-50",
      )}
    >
      <NavV2 variant="site" />
    </div>
  );
}

export function SiteFooterV2() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <div className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <FooterV2 />
    </div>
  );
}
