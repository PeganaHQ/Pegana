import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `app/(app)/dashboard/page.tsx` is a client component (live data), so it cannot export
// metadata. Without this thin server layout the route inherited the ROOT
// title + description verbatim — i.e. it was indistinguishable from the
// homepage in search results, despite carrying sitemap priority up to 0.9.
export const metadata: Metadata = pageMetadata({
  title: "Dashboard",
  description:
    "The live peg board: current state, intrinsic-vs-market spread, band proximity and freshness for every Solana stablecoin, LST and yield-bearing token Pegana tracks.",
  path: "/dashboard",
});

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
