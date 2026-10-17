"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";
import { useGlossary } from "@/lib/store/glossary-context";
import { cn } from "@/lib/utils/cn";

interface Section {
  title: string;
  terms: GlossaryTerm[];
}

const SECTIONS: Section[] = [
  {
    title: "Value model",
    terms: [
      "intrinsic",
      "market",
      "spread",
      "discount",
      "premium",
      "bps",
      "market_cap",
    ],
  },
  {
    title: "Peg states",
    terms: ["pegged", "drift", "depeg", "critical", "black_swan", "unknown"],
  },
  {
    title: "Asset classes",
    terms: [
      "lst",
      "stable_fiat",
      "stable_cdp",
      "stable_dn",
      "stable_yield",
      "stable_fx",
      "synth_lev",
    ],
  },
  {
    title: "Data sources",
    terms: ["sanctum", "pyth", "jupiter", "hylo"],
  },
];

export function GlossarySheet() {
  const { open, setOpen, focusTerm } = useGlossary();

  React.useEffect(() => {
    if (!open || !focusTerm) return;
    // Wait one frame so the sheet content is mounted before scrolling.
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`glossary-${focusTerm}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [open, focusTerm]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        // `data-[side=right]:w-full` (not a bare `w-full`): the base SheetContent
        // sets `data-[side=right]:w-3/4`, a DIFFERENT twMerge variant group from
        // bare `w-full`, so both survived and the attribute-qualified rule won →
        // the sheet rendered at 75vw on mobile. Same-variant override dedupes it
        // to full-bleed; `sm:max-w-md` still caps it to a panel on desktop.
        className="overflow-hidden border-l border-hairline bg-canvas p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="gap-1 border-b border-hairline px-6 py-5">
          <SheetTitle className="text-[22px] font-medium leading-none tracking-tight text-text">
            Glossary
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Every term in Pegana, explained.
          </SheetDescription>
        </SheetHeader>
        <div className="h-[calc(100%-5.5rem)] overflow-y-auto px-6 py-6">
          {SECTIONS.map((section) => (
            <section key={section.title} className="mb-10 last:mb-2">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                {section.title}
              </h3>
              <dl className="space-y-5">
                {section.terms.map((term) => {
                  const entry = GLOSSARY[term];
                  if (!entry) return null;
                  const focused = focusTerm === term;
                  return (
                    <div
                      key={term}
                      id={`glossary-${term}`}
                      className={cn(
                        "scroll-mt-6 transition-colors duration-700",
                        focused &&
                          "-mx-3 border-l-2 border-text bg-surface-1/40 px-3 py-2",
                      )}
                    >
                      <dt className="text-[14px] font-medium text-text">
                        {entry.title}
                      </dt>
                      <dd className="mt-1 text-[13px] leading-[1.55] text-text-muted">
                        {entry.body}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
