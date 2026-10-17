"use client";
/**
 * shadcn Dialog primitive — customized for Pegana brand.
 *
 * Defaults applied site-wide:
 *   - sharp corners (radius 0 — brand)
 *   - surface-1 background, hairline border (no ring, no shadow)
 *   - p-0 + gap-0 on Content — sections (Header / body / Footer) own their
 *     own padding via px-5 py-4. Callers can subdivide cleanly without
 *     fighting a phantom outer padding.
 *   - DialogFooter: NO negative margins (shadcn default's `-mx-4 -mb-4`
 *     assume Content has `p-4`; when we set p-0 the buttons get yanked
 *     outside the dialog box — exactly the bug we hit). Sits flush, with
 *     its own border-t and px/py.
 *   - DialogFooter is `flex-row` at every breakpoint (no flex-col-reverse
 *     on mobile — our 2-3 button rows fit, and the reverse order confuses).
 *   - DialogDescription uses text-text-muted (brand token).
 *   - Close X: minimal, top-right, surface-2 on hover.
 */

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-canvas/70 supports-backdrop-filter:backdrop-blur-sm",
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // Position
          "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          // Sizing
          "w-full max-w-[calc(100%-2rem)] sm:max-w-md",
          // Brand surface: sharp corners, hairline border, surface-1 bg.
          // No padding or gap — sections (Header/body/Footer) handle their own.
          "border border-hairline bg-surface-1 p-0",
          // Layout
          "grid gap-0 outline-none",
          // Animation
          "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Close"
            className={cn(
              "absolute top-3 right-3 inline-flex size-11 items-center justify-center",
              "text-text-muted hover:bg-surface-2 hover:text-text",
              "transition-colors",
            )}
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-2 border-b border-hairline px-5 py-4 pr-12",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Flush against Content edges. No negative margins.
        // Always row layout — 2-3 buttons fit in our 28rem-ish max width.
        "flex flex-row flex-wrap justify-end gap-2 border-t border-hairline px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        // Editorial sans, sentence case — brand-aligned. Mono/uppercase used
        // to be the default and produced a CLI/terminal vibe that contradicts
        // the rest of the product. Consumers can still override per-instance.
        "font-sans text-[20px] font-medium leading-tight tracking-tight text-text normal-case sm:text-[22px]",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-text-muted",
        "*:[a]:underline *:[a]:underline-offset-2 *:[a]:hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
