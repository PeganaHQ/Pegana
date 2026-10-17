"use client";
/**
 * shadcn Switch customized for Pegana brand:
 *  - keeps rounded-full (universal switch idiom — going square would confuse)
 *  - off state: hairline border on surface-2
 *  - on state: text color background
 *  - thumb: canvas (off) → black-on-text (on)
 */

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils/cn";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none",
        "border-hairline bg-surface-2 data-checked:bg-text data-checked:border-text",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "after:absolute after:-inset-x-2 after:-inset-y-2", // hit padding
        "relative",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full transition-transform",
          "bg-text-muted data-checked:bg-canvas",
          "translate-x-[1px] data-checked:translate-x-[15px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
