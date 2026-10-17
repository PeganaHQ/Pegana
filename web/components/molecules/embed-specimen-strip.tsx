"use client";

import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";

interface SpecimenItem {
  symbol: string;
  name: string;
  spread: string;
  state: "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL";
  theme: "dark" | "light";
  series: number[];
}

const SPECIMENS: SpecimenItem[] = [
  {
    symbol: "bSOL",
    name: "Blazestake Staked SOL",
    spread: "-0.19% · pegged",
    state: "PEGGED",
    theme: "dark",
    series: [15, 14, 16, 12, 13],
  },
  {
    symbol: "jitoSOL",
    name: "Jito Liquid Staking",
    spread: "-0.28% · drift",
    state: "DRIFT",
    theme: "dark",
    series: [12, 11, 14, 10, 18],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    spread: "+0.03% · pegged",
    state: "PEGGED",
    theme: "light",
    series: [15, 15, 15, 15, 15],
  },
  {
    symbol: "xSOL",
    name: "Hylo Leveraged SOL",
    spread: "+11.2% · CRITICAL",
    state: "CRITICAL",
    theme: "dark",
    series: [28, 18, 12, 6, 2],
  },
];

// V5 marketing state tokens (`.pegana-v2` scope) — same idiom as audit/page.tsx.
// (Was `--color-st-*`, the app-scope tokens with 3 per-theme definitions — that
// old system leaked into V5; the dark values matched so this is a no-op visually.)
const STATE_STROKE = {
  PEGGED: "var(--v2-peg)",
  DRIFT: "var(--v2-drift)",
  DEPEG: "var(--v2-depeg)",
  CRITICAL: "var(--v2-crit)",
} as const;

function sparkPath(series: number[], w = 320, h = 34): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function EmbedSpecimenStrip() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useReducedMotionGsap((gsap, reduced) => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const cards = root.querySelectorAll<HTMLElement>("[data-specimen-card]");
    const tweens: gsap.core.Tween[] = [];
    (async () => {
      await getScrollTrigger();
      tweens.push(
        gsap.fromTo(
          cards,
          { y: 16, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.5,
            stagger: 0.15,
            ease: "power3.out",
            immediateRender: false,
            scrollTrigger: {
              trigger: root,
              start: "top 80%",
              toggleActions: "play none none none",
            },
          },
        ),
      );
      const paths = root.querySelectorAll<SVGPathElement>("svg path");
      if (paths.length > 0) {
        prepareDrawIn(paths);
        tweens.push(
          gsap.to(paths, {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power2.out",
            stagger: 0.15,
            scrollTrigger: { trigger: root, start: "top 80%" },
          }),
        );
      }
    })();
    return () => tweens.forEach((t) => t.kill());
  }, []);

  return (
    <div
      ref={rootRef}
      className="mb-8 rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6"
    >
      <span className="mb-3 block font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--v2-dim)]">
        Specimen: 4 assets · dark + light themes · with sparkline
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SPECIMENS.map((s) => {
          const isLight = s.theme === "light";
          const stroke = STATE_STROKE[s.state];
          // The spread NUMBER follows its own sign, like every other surface.
          // These are hand-written sample strings, so read the sign off the
          // string that is actually rendered — one source, no drift.
          const spreadColor = s.spread.trimStart().startsWith("+")
            ? "var(--v2-peg)"
            : /^[-−]/.test(s.spread.trimStart())
              ? "var(--v2-depeg)"
              : "var(--v2-text)";
          return (
            <div
              key={s.symbol}
              data-specimen-card
              className="border border-[var(--v2-line)] bg-[var(--v2-bg)] p-3"
            >
              <div className="mb-2 flex gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--v2-dim)]">
                <span>
                  {s.symbol} · {s.theme} · spark on
                </span>
              </div>
              {/* Deliberate light-mode specimen: this previews the embed as it
                  renders on a third-party light page, so it must NOT inherit
                  Pegana's dark theme tokens. The literals are the specimen's
                  own palette, not theme drift. */}
              <div
                className={`p-3 grid grid-cols-[1fr_auto] gap-3 items-center border ${isLight ? "bg-[#fafafa] text-canvas border-[#ccc]" : "border-[var(--v2-line)] bg-[var(--v2-bg)]"}`}
              >
                <div className="flex flex-col gap-0.5">
                  <b className="text-sm">{s.symbol}</b>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.06em] ${isLight ? "text-[#666]" : "text-[var(--v2-dim)]"}`}
                  >
                    {s.name}
                  </span>
                </div>
                <span
                  className="font-mono text-[13px] text-right"
                  style={{ color: spreadColor }}
                >
                  {s.spread}
                </span>
                <div className="col-span-2 h-9">
                  <svg
                    viewBox="0 0 320 34"
                    preserveAspectRatio="none"
                    className="h-full w-full"
                  >
                    <path
                      d={sparkPath(s.series)}
                      stroke={stroke}
                      strokeWidth="1.2"
                      fill="none"
                    />
                  </svg>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
