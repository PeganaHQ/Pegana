"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/utils/cn";

interface ExpandShellProps {
  /** Rendered both inline and inside the fullscreen modal. Receives `inModal`
   *  so the child can pick different heights / paddings per surface. */
  children: (ctx: { inModal: boolean }) => ReactNode;
  /** Optional title displayed in the modal header. */
  title?: string;
  /** Optional subtitle line under the title. */
  subtitle?: string;
  /** Optional controls rendered in the modal header next to the close button
   *  (e.g. an Absolute/Normalized toggle). */
  controls?: ReactNode;
}

/**
 * Wraps a chart with a discreet "expand" affordance in the top-right corner.
 * When clicked, opens a near-fullscreen modal that re-renders the chart via
 * the same render-prop. We deliberately mount a second chart instance inside
 * the modal (rather than re-parenting the DOM node) so each chart keeps its
 * own resize observer and lifecycle clean.
 */
export function ExpandShell({ children, title, subtitle, controls }: ExpandShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        {controls && (
          <div className="absolute right-12 top-2 z-10 lg:right-10">
            {controls}
          </div>
        )}
        {children({ inModal: false })}
        <Dialog.Trigger asChild>
          <button
            type="button"
            aria-label="Expand chart"
            className={cn(
              "absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center lg:h-7 lg:w-7",
              "border border-hairline bg-canvas/80 text-text-muted backdrop-blur-sm",
              "transition-colors hover:border-outline hover:text-text",
            )}
          >
            <ExpandIcon />
          </button>
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-canvas/85 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          className={cn(
            "fixed inset-x-3 top-3 bottom-3 z-50 flex flex-col",
            "border border-hairline bg-canvas",
            "sm:inset-x-6 sm:top-6 sm:bottom-6",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        >
          <div className="flex items-start justify-between border-b border-hairline px-5 py-4 sm:px-6">
            <div>
              {title && (
                <Dialog.Title className="font-mono text-[11px] uppercase tracking-[0.08em] text-text">
                  {title}
                </Dialog.Title>
              )}
              {subtitle && (
                <Dialog.Description className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <div className="flex items-center gap-3">
              {controls}
              <Dialog.Close
                aria-label="Close"
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center border border-hairline text-text-muted lg:h-7 lg:w-7",
                  "transition-colors hover:border-outline hover:text-text",
                )}
              >
              <CloseIcon />
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-3 py-3 sm:px-5 sm:py-5">
            {children({ inModal: true })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path d="M1 5V1H5" stroke="currentColor" strokeWidth="1" />
      <path d="M11 7V11H7" stroke="currentColor" strokeWidth="1" />
      <path d="M1 1L5 5" stroke="currentColor" strokeWidth="1" />
      <path d="M11 11L7 7" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
