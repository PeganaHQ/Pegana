import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

// Sharp (no radius) to match the editorial data-table aesthetic, mono caption
// idiom (allowed for technical labels per brand.md). Tones map to the existing
// peg-state tokens so badges stay on the single-accent palette.
const badgeVariants = cva(
  "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-hairline text-text-muted",
        success: "border-st-pegged/40 text-st-pegged",
        warning: "border-st-drift/40 text-st-drift",
        danger: "border-st-depeg/50 text-st-depeg-text",
        // Brand signature accent (coral #ff8a5b) — high-contrast on the dark
        // canvas. NOT shadcn's `--accent`, which is a muted surface color and
        // rendered the chat-channel badges nearly invisible.
        accent: "border-coral/50 bg-coral/10 text-coral",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
