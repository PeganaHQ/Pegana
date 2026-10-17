"use client";

import { useRef } from "react";
import {
  isMarketDepthUsable,
  safetyGrade,
  safetyRationale,
  safetyTotalGrade,
  type SafetyInput,
  type SafetyScore,
} from "@/lib/api/format";
import { cn } from "@/lib/utils/cn";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

interface SafetyGradeProps {
  asset: SafetyInput;
  className?: string;
}

const dimLabel: Record<keyof SafetyScore, string> = {
  peg: "Peg",
  liquidity: "Liquidity",
  mechanism: "Mechanism",
};

function Dots({ value, max = 3 }: { value: number; max?: number }) {
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      aria-label={`${value} of ${max}`}
    >
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < value ? "bg-text" : "bg-text-muted/30",
          )}
        />
      ))}
    </span>
  );
}

function gradeColor(g: "A" | "B" | "C" | "D"): string {
  switch (g) {
    case "A":
      return "text-st-pegged";
    case "B":
      return "text-text";
    case "C":
      return "text-st-drift";
    // AA-safe variant: the saturated text-st-depeg pip hue fails WCAG-AA as text.
    case "D":
      return "text-st-depeg-text";
  }
}

function gradeNarrative(g: "A" | "B" | "C" | "D"): string {
  switch (g) {
    case "A":
      return "Top-tier across every dimension.";
    case "B":
      return "Solid. Understand the weaker dimension before sizing.";
    case "C":
      return "Acceptable. Don't treat the peg as a hard floor under stress.";
    case "D":
      return "Carries real tail risk. Position size and hedge accordingly.";
  }
}

// Section layout: big grade letter on the left, three dimension rows on the
// right. Each dimension shows the dot pattern, the score, AND a one-line
// rationale so the badge doesn't read as opaque. The bottom takeaway sentence
// holds the catch-all advice.
export function SafetyGrade({ asset, className }: SafetyGradeProps) {
  const score = safetyGrade(asset);
  const rationale = safetyRationale(asset);
  const grade = safetyTotalGrade(score);
  // Honest label: only the liquidity dimension is measured. Peg and mechanism
  // are still class heuristics, so the header must not imply full live cover.
  const liquidityIsLive = isMarketDepthUsable(asset);

  const gradeRef = useRef<HTMLSpanElement | null>(null);

  useReducedMotionGsap((gsap, reduced) => {
    const el = gradeRef.current;
    if (!el || reduced) return;
    let tween: gsap.core.Tween | null = null;
    const safety = revealSafety([el]);
    (async () => {
      await getScrollTrigger();
      tween = gsap.fromTo(
        el,
        { scale: 0.6, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.8,
          ease: "power2.out",
          immediateRender: false,
          scrollTrigger: {
            trigger: el,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        },
      );
    })();
    return () => {
      tween?.kill();
      safety();
    };
  }, []);

  return (
    <section
      className={cn(
        "rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6",
        className,
      )}
    >
      <header className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          Safety grade
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {liquidityIsLive ? "Measured + heuristic" : "Heuristic v1"}
        </span>
      </header>

      <div className="grid items-baseline gap-8 sm:grid-cols-[auto_1fr] sm:gap-14">
        <div className="relative inline-block pb-2">
          <span
            ref={gradeRef}
            role="img"
            aria-label={`Overall safety grade ${grade}`}
            className={cn(
              "block font-light text-[96px] leading-[0.85] tracking-[-0.05em] sm:text-[200px]",
              gradeColor(grade),
            )}
          >
            {grade}
          </span>
          {/* Solid grade-colored underline — no gradient here; the page's one
              sanctioned iridescent moment lives on the sticky subscribe CTA. */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 bottom-0 h-[3px] opacity-70",
              gradeColor(grade).replace("text-", "bg-"),
            )}
          />
        </div>

        {/* The measure column is capped at the SAME width as the rationale
            below it. Without the cap the `justify-between` row stretched to the
            full grid track, so at desktop widths the label sat at the far left
            and its score at the far right with ~700px of dead space between,
            while the rationale underneath stopped at 640px. That broke the
            column the eye is supposed to read down. */}
        <dl className="grid gap-6 font-mono text-[12px]">
          {(Object.keys(score) as Array<keyof SafetyScore>).map((dim) => (
            <div key={dim} className="grid max-w-[640px] gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text uppercase tracking-[0.08em] text-[10px]">
                  {dimLabel[dim]}
                </dt>
                <dd className="flex items-center gap-2">
                  <Dots value={score[dim]} />
                  <span className="text-text-muted/70">{score[dim]}/3</span>
                </dd>
              </div>
              <p className="text-[12px] leading-relaxed text-text-muted">
                {rationale[dim]}
              </p>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-7 border-l-2 border-text/40 pl-4 font-mono text-[12px] leading-relaxed text-text-muted">
        {gradeNarrative(grade)}
      </div>
    </section>
  );
}
