"use client";

import { useEffect } from "react";
import "@/app/(marketing)/v2.css";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { cn } from "@/lib/utils/cn";
import { NavV2 } from "@/components/organisms/v2/nav-v2";
import { ErrorSurfaceV2 } from "@/components/organisms/v2/error-surface-v2";

// Route-segment runtime error boundary (V5, W1 2026-07-03) — doesn't go
// through app/(marketing)/layout.tsx, so it brings its own .pegana-v2 scope +
// fonts + v2.css import, same as app/not-found.tsx.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pegana] runtime error", error);
  }, [error]);

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <NavV2 variant="site" />
      <ErrorSurfaceV2
        standalone
        eyebrow="Unexpected error"
        headline="The engine hit a state it can't explain."
        sub="The crash was recorded on our side. Try again, or come back through the dashboard."
        state="critical"
        endLabel="500"
        primary={{ label: "Try again", action: "reset", onReset: reset }}
        secondary={{ label: "Back to home", href: "/" }}
      />
    </main>
  );
}
