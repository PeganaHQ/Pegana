import type { Metadata } from "next";
import "@/app/(marketing)/v2.css";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { cn } from "@/lib/utils/cn";
import { ErrorSurfaceV2 } from "@/components/organisms/v2/error-surface-v2";

// Global 404 (V5, W1 2026-07-03) — matches every unmatched route in the app,
// so it doesn't go through app/(marketing)/layout.tsx and has to bring its
// own .pegana-v2 scope + fonts + v2.css import.

// Without this the 404 inherited the homepage <title>, so a dead link looked
// like the landing page in a tab, a share card or a crawler log.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <ErrorSurfaceV2
        standalone
        eyebrow="Signal lost"
        headline="This frequency isn't on the peg board."
        sub="The feed is live. Read it over REST, WebSocket, MCP, or the Atom feed."
        state="unknown"
        endLabel="404"
        primary={{ label: "Back to home", href: "/" }}
        secondary={{ label: "Open dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
