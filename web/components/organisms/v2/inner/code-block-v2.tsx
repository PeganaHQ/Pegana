"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// W2 (2026-07-03): the artifact's `.codeblk` — 16px-radius panel, mono label
// header + a real copy button (navigator.clipboard, execCommand fallback for
// non-secure contexts, matching the existing components/molecules/code-block.tsx
// pattern). `display` lets a caller render dim/green inline tints (`.v2-in-c`
// / `.v2-in-g`) for comments/highlighted tokens while `code` stays the exact
// plain-text string written to the clipboard.

export function CodeBlockV2({
  label,
  code,
  display,
  className,
}: {
  label: string;
  /** Plain text copied to the clipboard. */
  code: string;
  /** Optional richer rendering (tinted spans); defaults to `code` verbatim. */
  display?: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      // rejected — fall through to execCommand
    }
    if (!ok && typeof document !== "undefined") {
      const ta = document.createElement("textarea");
      ta.value = code;
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
    <div className={cn("v2-in-codeblk", className)}>
      <div className="v2-in-codeblk-head">
        <span>{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* A scrolling region with no focusable child is unreachable by
          keyboard: you can see that the line runs past the edge and have no
          way to scroll it. axe flags it as `scrollable-region-focusable`
          (serious), and it had been shipping on /methodology and /agents at
          phone width, where these blocks actually do overflow. Same treatment
          components/molecules/code-block.tsx already used. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={label ? `${label} code block` : "Code block"}
      >
        <code>{display ?? code}</code>
      </pre>
    </div>
  );
}
