"use client";

import { useEffect, useRef, useState } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { EyebrowPillV2 } from "@/components/organisms/v2/shared";

// DESIGN.md §5.5 (second half) — the candor strike rows. Each false claim is
// typographically "depegged": a 2px rose line draws through it (scaleX 0→1,
// origin left, .9s physical ease) the first time the row is ~55% in view.
// The strike uses the semantic depeg rose, NOT the iridescent gradient
// (§1 hard rule). Reduced-motion: strikes pre-drawn.

const ROWS: Array<{ no: string; yes: React.ReactNode }> = [
  {
    no: "Predicting the next depeg.",
    yes: (
      <>
        Pegana measures the distance{" "}
        <b className="font-medium text-[var(--v2-text)]">as it exists now</b>.
        It does not forecast.
      </>
    ),
  },
  {
    no: "A score for every asset.",
    yes: (
      <>
        No verifiable source means{" "}
        <b className="font-medium text-[var(--v2-text)]">UNKNOWN</b>, never a
        guess.
      </>
    ),
  },
  {
    no: "Paid ratings.",
    yes: (
      <>
        <b className="font-medium text-[var(--v2-text)]">
          One public methodology
        </b>
        , versioned in the open, identical for every asset.
      </>
    ),
  },
];

function StrikeRow({
  row,
  index,
}: {
  row: (typeof ROWS)[number];
  index: number;
}) {
  const reduced = useAppReducedMotion();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [struck, setStruck] = useState(false);
  const reveal = useRevealV2<HTMLDivElement>({ index });

  useEffect(() => {
    if (reduced || typeof IntersectionObserver === "undefined") {
      setStruck(true);
      return;
    }
    const el = rowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setStruck(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div
      ref={(node) => {
        rowRef.current = node;
        reveal.ref.current = node;
      }}
      style={reveal.style}
      className="grid grid-cols-1 gap-x-11 gap-y-2 border-t border-[var(--v2-line)] py-7 last:border-b last:border-b-[var(--v2-line)] min-[860px]:grid-cols-[.9fr_1.1fr] min-[860px]:items-baseline"
    >
      <span className="relative inline-block w-fit text-[clamp(19px,2.6vw,27px)] font-medium tracking-[-0.015em] text-[var(--v2-dim)]">
        {row.no}
        <span
          aria-hidden
          className="absolute -left-[3px] -right-[3px] top-[54%] h-0.5 origin-left bg-[var(--v2-depeg)] opacity-90 transition-transform delay-200 duration-[900ms] ease-[var(--v2-ease-phys)]"
          style={{ transform: struck ? "scaleX(1)" : "scaleX(0)" }}
        />
      </span>
      <span className="text-[15.5px] leading-[1.58] text-[var(--v2-muted)]">
        {row.yes}
      </span>
    </div>
  );
}

export function CandorV2() {
  const pill = useRevealV2<HTMLDivElement>({ index: 0 });
  return (
    <div className="pb-24 pt-[88px]">
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div ref={pill.ref} style={pill.style}>
          <EyebrowPillV2>what pegana does not claim</EyebrowPillV2>
        </div>
        {ROWS.map((row, i) => (
          <StrikeRow key={row.no} row={row} index={i} />
        ))}
      </div>
    </div>
  );
}
