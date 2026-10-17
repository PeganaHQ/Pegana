import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// The events feed is a client component (live), so its metadata lives here in a
// thin server layout — otherwise the route inherits only the root
// title/description and has no page-specific SEO/social preview.
export const metadata: Metadata = pageMetadata({
  title: "Events",
  description:
    "The live peg-state event feed: every Solana LST, stablecoin and yield-bearing token transition the moment it happens, with a public receipt for each.",
  path: "/events",
});

export default function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
