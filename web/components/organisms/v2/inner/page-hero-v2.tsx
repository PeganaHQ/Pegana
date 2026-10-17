import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { EyebrowPillV2 } from "@/components/organisms/v2/shared";

// W2 (2026-07-03): shared inner-page hero — eyebrow pill + h1 (weight 500,
// clamp) + lede + a mono meta row. Every rewritten marketing inner page
// (methodology/audit/audit/[id]/status/changelog/about/agents) opens with
// this. Pure presentation — pages pass in real copy/data, this only lays it
// out. Server-safe (no hooks), matches the artifact's `.phero` block.

export function PageHeroV2({
  eyebrow,
  h1,
  lede,
  meta,
  maxWidthCh = 20,
  className,
}: {
  eyebrow: string;
  h1: ReactNode;
  lede: ReactNode;
  /** Mono meta row items — each rendered with a separating gap, no manual middots needed. */
  meta?: ReactNode[];
  /** h1 max-width in `ch` units (artifact default 16ch; some headlines need more room). */
  maxWidthCh?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[880px] px-5 pb-16 pt-24 sm:px-8 sm:pt-28",
        className,
      )}
    >
      <EyebrowPillV2>{eyebrow}</EyebrowPillV2>
      <h1
        className="mb-[22px] text-balance text-[clamp(34px,5vw,54px)] font-medium leading-[1.05] tracking-[-0.028em] text-[var(--v2-text)]"
        style={{ maxWidth: `${maxWidthCh}ch` }}
      >
        {h1}
      </h1>
      <p className="max-w-[56ch] text-[17px] leading-[1.7] text-[var(--v2-muted)]">
        {lede}
      </p>
      {meta && meta.length > 0 && (
        <div className="mt-[30px] flex flex-wrap gap-[18px] font-mono text-[11.5px] text-[var(--v2-dim)]">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A "live"-tinted meta item, e.g. `● methodology v0.5.0 · active`. */
export function LiveDot({ children }: { children: ReactNode }) {
  return (
    <span className="text-[var(--v2-peg)]">
      <span aria-hidden>&#9679;</span> {children}
    </span>
  );
}
