"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { formatDayUS } from "@/lib/api/format";

export interface AboutNowEntry {
  date: string;
  tag: "FEATURE" | "FIX" | "INTERNAL";
  blurb: string;
  url?: string;
  sha?: string;
}

// Category color carried by a borderless token-colored label (V5 W2,
// 2026-07-03 — re-skinned onto the pegana-v2 token set + panel treatment;
// same GSAP reveal + real GitHub data as before).
const TAG_COLOR: Record<AboutNowEntry["tag"], string> = {
  FEATURE: "var(--v2-peg)",
  FIX: "var(--v2-drift)",
  INTERNAL: "var(--v2-dim)",
};

export function AboutNowWidget({ entries }: { entries: AboutNowEntry[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useReducedMotionGsap((gsap, reduced) => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-now-row]");
    let tween: gsap.core.Tween | null = null;
    (async () => {
      await getScrollTrigger();
      tween = gsap.fromTo(
        rows,
        { y: 8, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.1,
          immediateRender: false,
          scrollTrigger: {
            trigger: root,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        },
      );
    })();
    return () => tween?.kill();
  }, []);

  return (
    <div ref={rootRef} className="v2-in-inc">
      <h3 className="flex items-center gap-2">
        <span
          aria-hidden
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--v2-peg)" }}
        />
        Working on right now
      </h3>
      {entries.map((entry, i) => (
        <div
          key={entry.sha ?? i}
          data-now-row
          className="border-t border-[var(--v2-line)] py-3 first:border-t-0"
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--v2-dim)]">
            <span className="v2-in-num">{formatDayUS(entry.date)}</span>
            {entry.sha && !/^[-\u2014]$/.test(entry.sha) && (
              <span>&middot; {entry.sha}</span>
            )}
            <span style={{ color: TAG_COLOR[entry.tag] }}>
              {entry.tag.toLowerCase()}
            </span>
          </div>
          {entry.url ? (
            <Link
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="block text-[14px] leading-[1.5] text-[var(--v2-body)] transition-colors hover:text-[var(--v2-text)]"
            >
              {entry.blurb}
            </Link>
          ) : (
            <p className="text-[14px] leading-[1.5] text-[var(--v2-body)]">
              {entry.blurb}
            </p>
          )}
        </div>
      ))}
      <Link
        href="https://github.com/PeganaHQ/ReplayCLI/commits/main"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--v2-muted)] transition-colors hover:text-[var(--v2-text)]"
      >
        Methodology + asset commits &#8594;
      </Link>
    </div>
  );
}
