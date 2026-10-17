import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `app/(app)/systemic/page.tsx` is a client component (live data), so it cannot export
// metadata. Without this thin server layout the route inherited the ROOT
// title + description verbatim — i.e. it was indistinguishable from the
// homepage in search results, despite carrying sitemap priority up to 0.9.
export const metadata: Metadata = pageMetadata({
  title: "What breaks when a Solana peg slips",
  description:
    "Loop Intelligence: cross-protocol leveraged collateral tracked across Solana lending markets, and how much gets liquidated at each depeg depth. Advisory model, not a receipt.",
  path: "/systemic",
});

export default function SystemicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
