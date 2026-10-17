"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";
import { useGlossary } from "@/lib/store/glossary-context";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { cn } from "@/lib/utils/cn";

interface HelpIconProps {
  term: GlossaryTerm;
  /** Visual size — defaults to `sm` (14px). Use `xs` for inline placement
   *  next to small mono labels. */
  size?: "xs" | "sm";
  /** Tooltip placement. */
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Optional aria-label override. Defaults to "Help: {title}". */
  label?: string;
}

/**
 * Discreet "(?)" affordance for newcomers. Hover/focus opens a quick
 * definition tooltip; click opens the full GlossarySheet scrolled to
 * this term. Power users ignore; beginners discover help without polluting
 * the surrounding copy.
 */
export function HelpIcon({
  term,
  size = "sm",
  side = "top",
  className,
  label,
}: HelpIconProps) {
  const entry = GLOSSARY[term];
  const { openAt } = useGlossary();
  if (!entry) return null;

  // A small, soft help chip: a subtle FILLED circle (not the old heavy 40px
  // bordered "ball") with a clearly-visible "?" in muted text — reads as an
  // interactive tooltip without dominating the row. Brightens + fills a touch
  // more on hover. min-w == height so it stays circular around the glyph.
  const sizeCls =
    size === "xs"
      ? "h-[18px] min-w-[18px] text-[11px] lg:h-4 lg:min-w-4 lg:text-[9px]"
      : "h-[22px] min-w-[22px] text-[12px] lg:h-[18px] lg:min-w-[18px] lg:text-[10px]";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => openAt(term)}
          aria-label={label ?? `Help: ${entry.title}. Click to open glossary.`}
          className={cn(
            "ml-1 inline-flex shrink-0 cursor-help items-center justify-center rounded-full bg-text/[0.08] px-1 align-middle font-mono leading-none text-text-muted transition-colors duration-200 hover:bg-text/[0.16] hover:text-text",
            sizeCls,
            className,
          )}
        >
          ?
        </button>
      </TooltipTrigger>
      {/* Skin (border/bg/shadow/type) now comes from the TooltipContent
          primitive itself — only the multi-line content structure below is
          this call site's own. */}
      <TooltipContent side={side} align="center">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {entry.title}
        </div>
        <div className="text-text">{entry.body}</div>
        <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Click to open glossary
          <IconArrowRight size={10} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
