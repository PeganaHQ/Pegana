import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// The status page is a client component (live polling), so its metadata lives
// here in a thin server layout — otherwise the route inherits only the root
// title/description and has no page-specific SEO/social preview.
export const metadata: Metadata = pageMetadata({
  title: "Status",
  description:
    "Live operational status of the Pegana peg-risk oracle: data-source freshness, feed liveness, and the public incident history.",
  path: "/status",
});

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
