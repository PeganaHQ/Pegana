"use client";

import { useState, type MouseEvent } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// W2 (2026-07-03): copyable receipt-hash chip for the audit ledger + receipt
// detail pages. Click copies the FULL hash (not the truncated display text)
// to the clipboard — same clipboard/execCommand-fallback pattern as
// code-block-v2.tsx.

export function HashChip({
  full,
  display,
  className,
}: {
  /** Full hash string copied to the clipboard. */
  full: string;
  /** What's shown — usually a truncated `slice(0, 8) + …`. Defaults to `full`. */
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full);
        ok = true;
      }
    } catch {
      // fall through
    }
    if (!ok && typeof document !== "undefined") {
      const ta = document.createElement("textarea");
      ta.value = full;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className={
            className
              ? `v2-in-hashchip cursor-pointer appearance-none ${className}`
              : "v2-in-hashchip cursor-pointer appearance-none"
          }
          aria-label={copied ? "Copied receipt hash" : "Copy receipt hash"}
        >
          {copied ? "copied" : (display ?? full)}
          <span aria-hidden>&#x2398;</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : full}</TooltipContent>
    </Tooltip>
  );
}
