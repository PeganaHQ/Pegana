import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `app/(marketing)/status/calibration/page.tsx` is a client component (live data), so it cannot export
// metadata. Without this thin server layout the route inherited the ROOT
// title + description verbatim — i.e. it was indistinguishable from the
// homepage in search results, despite carrying sitemap priority up to 0.9.
export const metadata: Metadata = pageMetadata({
  title: "Calibration self-monitor",
  description:
    "Per-asset calibration health: the trailing 8-day p95 of each asset's effective discount against its own drift and depeg bands.",
  path: "/status/calibration",
});

export default function CalibrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
