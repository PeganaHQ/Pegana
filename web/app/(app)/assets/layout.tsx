import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `app/(app)/assets/page.tsx` is a client component (live data), so it cannot export
// metadata. Without this thin server layout the route inherited the ROOT
// title + description verbatim — i.e. it was indistinguishable from the
// homepage in search results, despite carrying sitemap priority up to 0.9.
export const metadata: Metadata = pageMetadata({
  // Was "Every asset Pegana monitors", which the template rendered as
  // "Every asset Pegana monitors · Pegana" — the brand twice in one title.
  title: "Every tracked asset",
  description:
    "The full peg-risk screener: every tracked Solana stablecoin, LST, CDP and synthetic ranked by how close each sits to its own depeg line, with live spread and stability.",
  path: "/assets",
});

export default function AssetsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
