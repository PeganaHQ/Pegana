import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo/page-metadata";

// `page.tsx` is a client component (live asset grid), so it cannot export
// metadata — the route therefore inherited the root title verbatim and showed
// up as "Pegana: peg-risk oracle for Solana" in the tab. Same thin-server-layout
// pattern already used by app/(app)/assets/layout.tsx.
export const metadata: Metadata = pageMetadata({
  title: "Every peg at once",
  description:
    "The whole peg surface on one screen: every tracked Solana stablecoin and LST as a single cell, sized by risk score and coloured by its committed peg state.",
  path: "/heatmap",
});

export default function HeatmapLayout({ children }: { children: ReactNode }) {
  return children;
}
