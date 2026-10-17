"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils/cn";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

// V5 skin lives in the primitive (2026-07-14) so every tooltip is right by
// default — the stock shadcn look was an inverted LIGHT bubble (bg-foreground /
// text-background), a bright white popover on the dark canvas that every
// call-site had to override by hand (help-icon did; the badges did NOT, which
// is the "our tooltips look broken" defect). Now: a dark panel matching the
// GlossarySheet / dropdown vocabulary — hairline border, canvas bg, sans body,
// one soft shadow. Block layout (not inline-flex) so multi-line content stacks.
// No arrow caret — no other V5 popover uses one. Animation degrades under
// reduced motion.
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit max-w-[280px] origin-(--radix-tooltip-content-transform-origin) rounded-[10px] border border-hairline bg-canvas px-3 py-2.5 font-sans text-[12px] leading-[1.5] text-text shadow-[0_8px_24px_rgba(0,0,0,0.6)]",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
