import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `app/(app)/compare/page.tsx` is a client component (live data), so it cannot export
// metadata. Without this thin server layout the route inherited the ROOT
// title + description verbatim — i.e. it was indistinguishable from the
// homepage in search results, despite carrying sitemap priority up to 0.9.
export const metadata: Metadata = pageMetadata({
  title: "Compare assets side by side",
  description:
    "Put any two Solana pegged assets head to head: spread, band proximity, stability and state history, computed from the same methodology that produces every Pegana receipt.",
  path: "/compare",
});

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
