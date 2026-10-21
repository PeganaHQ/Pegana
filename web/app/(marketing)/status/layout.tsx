import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";

// The status page is a client component (live polling), so its metadata lives
// here in a thin server layout — otherwise the route inherits only the root
// title/description and has no page-specific SEO/social preview.
export const metadata: Metadata = {
  ...pageMetadata({
    title: "Status",
    description:
      "Live operational status of the Pegana peg-risk oracle: data-source freshness, feed liveness, and the public incident history.",
    path: "/status",
  }),
  // A plain string title here ends the root "%s · Pegana" template for child
  // segments, so /status/calibration rendered a bare "Calibration
  // self-monitor". `default` still takes the root template for /status itself;
  // `template` re-applies it to children.
  title: { default: "Status", template: "%s · Pegana" },
};

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
