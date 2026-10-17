"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import {
  StatePillV2,
  v2SpreadSignClass,
} from "@/components/organisms/v2/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// DESIGN.md §5.5 — the pinned trust scene: "Don't trust the score. Replay
// it." A 340vh wrapper pins a full-viewport scene; scroll progress lights the
// four steps (01 Ingest → 02 Measure → 03 Judge → 04 Receipt) while the sUSD
// receipt object builds row-by-row. The artifact drove this with a raw scroll
// handler; production uses GSAP ScrollTrigger (scrub via onUpdate progress)
// on top of the Lenis-smoothed scroll (LenisV2 wires lenis → ScrollTrigger).
//
// Reduced-motion or <900px: no pin — the scene unrolls static with every
// step and receipt row visible (DESIGN.md §4 matrix).

const STEPS = [
  {
    n: "01",
    title: "Ingest",
    desc: "prices, NAV, redemption, depth. 14 protocols",
  },
  {
    n: "02",
    title: "Measure",
    desc: "spread = 1 − market / intrinsic, EWMA α=0.3",
  },
  {
    n: "03",
    title: "Judge",
    desc: "per-asset thresholds, 30s/120s hysteresis, 5-state FSM",
  },
  {
    n: "04",
    title: "Receipt",
    desc: "sealed, published, replayable to the byte",
  },
];

function useStaticScene(): boolean | null {
  // null on SSR/first paint; resolved after mount. Static = reduced motion OR
  // narrow viewport. Width is sampled once on mount (matches the artifact's
  // `innerWidth<900` check at setup time) plus on resize for orientation flips.
  const reduced = useAppReducedMotion();
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    setNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  if (narrow === null) return null;
  return reduced || narrow;
}

/** Copy-to-clipboard state for one target — mirrors share-button.tsx's
 *  `useCopyPermalink` pattern. Independent per copyable element. */
function useCopyState(delayMs = 1400) {
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked (permissions/unsupported) — no-op */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), delayMs);
  }
  return { copied, copy };
}

/** Pill hairline chip for the receipt's "inputs" row (Pyth, Jupiter, …). */
function InChip({ children }: { children: ReactNode }) {
  return (
    <span className="my-0.5 mr-1.5 inline-flex items-center rounded-full border border-[var(--v2-line)] px-2.5 py-[3px] font-mono text-[10.5px] text-[var(--v2-muted)]">
      {children}
    </span>
  );
}

/** Formula chip — filled hairline pill used for the "measure" row's formula. */
const FX_CHIP_CLASS =
  "inline-flex items-center rounded-lg border border-[var(--v2-line)] bg-white/[0.03] px-[9px] py-[3px] font-mono text-xs text-[var(--v2-text)]";

function FxChip({ children }: { children: ReactNode }) {
  return <span className={FX_CHIP_CLASS}>{children}</span>;
}

const RECEIPT_HASH = "0x9f3a1d84c21b";
const RECEIPT_CMD = `pegana-replay ${RECEIPT_HASH}`;

export function TrustSceneV2() {
  const isStatic = useStaticScene();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLSpanElement | null>(null);
  const [step, setStep] = useState(0);
  const hash = useCopyState();
  const cmd = useCopyState();

  useEffect(() => {
    if (isStatic !== false) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let st: { kill: () => void } | null = null;
    let killed = false;
    (async () => {
      // getScrollTrigger resolves gsap internally and registers the plugin.
      const ScrollTrigger = await getScrollTrigger();
      if (killed) return;
      st = ScrollTrigger.create({
        trigger: wrap,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {
          // Rail fill height is driven straight on the DOM node — 60fps
          // scroll updates have no business going through React state.
          if (railRef.current) {
            railRef.current.style.height = `${self.progress * 100}%`;
          }
          // Slight bias so step 04 lands before the unpin (artifact: p*4.35).
          setStep(Math.min(3, Math.floor(self.progress * 4.35)));
        },
      });
    })();
    return () => {
      killed = true;
      st?.kill();
    };
  }, [isStatic]);

  // While unresolved (SSR), render the static expanded scene — progressive
  // enhancement, never a blank pin.
  const staticScene = isStatic !== false;
  const activeStep = staticScene ? 3 : step;

  const rowOn = (at: number) => staticScene || at <= activeStep;

  // NOTE: no outer <section> here — the page wraps TrustSceneV2 + CandorV2 in
  // one `#trust` band (bg2 + border-y), mirroring the artifact where the
  // pinned scene and the candor rows share a single `.trustsec` section.
  return (
    <div ref={wrapRef} className={cn("relative", !staticScene && "h-[340vh]")}>
      <div
        className={cn(
          "flex flex-col justify-center overflow-hidden",
          staticScene
            ? "py-20 scene:py-24"
            : "sticky top-0 min-h-screen pb-10 pt-[90px]",
        )}
      >
        <div className="mx-auto w-full max-w-[1180px] px-6 sm:px-10">
          <div className="mb-10">
            <div className="mb-4 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--v2-dim)]">
              verifiable, not a black box
            </div>
            <h2 className="text-balance text-[clamp(30px,4.2vw,50px)] font-medium leading-[1.05] tracking-[-0.022em]">
              Don&rsquo;t trust the score. Replay it.
            </h2>
            <p className="mt-[18px] max-w-[56ch] text-[17px] leading-[1.62] text-[var(--v2-muted)]">
              This is how every Pegana verdict is made, and how the receipt lets
              you remake it.
            </p>
          </div>

          <div className="grid items-start gap-9 scene:grid-cols-[.95fr_1.05fr] scene:gap-[60px]">
            {/* steps */}
            <div className="relative flex flex-col">
              {!staticScene && (
                <span
                  aria-hidden
                  className="absolute inset-y-4 left-0 w-0.5 rounded-full bg-white/[0.06]"
                >
                  <span
                    ref={railRef}
                    className="absolute left-0 top-0 w-full rounded-full bg-white/30"
                    style={{ height: 0 }}
                  />
                </span>
              )}
              {STEPS.map((s, i) => {
                const on = staticScene || i <= activeStep;
                return (
                  <div
                    key={s.n}
                    className="relative border-b border-[var(--v2-line)] py-[17px] pl-6 transition-colors duration-[400ms] ease-[var(--v2-ease)] last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute bottom-4 left-0 top-4 w-0.5 bg-white transition-opacity duration-[400ms] ease-[var(--v2-ease)]",
                        on ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div
                      className={cn(
                        "font-mono text-[11px] transition-colors duration-[400ms]",
                        on ? "text-[var(--v2-muted)]" : "text-[var(--v2-dim)]",
                      )}
                    >
                      {s.n}
                    </div>
                    <h4
                      className={cn(
                        "mt-[3px] text-[21px] font-medium tracking-[-0.015em] transition-colors duration-[400ms] ease-[var(--v2-ease)]",
                        on ? "text-[var(--v2-text)]" : "text-[var(--v2-dim)]",
                      )}
                    >
                      {s.title}
                    </h4>
                    <p
                      className={cn(
                        "mt-[5px] font-mono text-[11px] uppercase tracking-[0.08em] transition-[color,opacity] duration-[400ms]",
                        on
                          ? "text-[var(--v2-muted)] opacity-100"
                          : "text-[var(--v2-dim)] opacity-65",
                      )}
                    >
                      {s.desc}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* receipt object */}
            <div
              className="overflow-hidden rounded-[16px] border border-[var(--v2-line2)] v2-shadow-receipt"
              style={{
                background:
                  "linear-gradient(180deg, var(--color-surface-1), var(--color-canvas))",
              }}
            >
              <div className="flex items-center justify-between border-b border-[var(--v2-line)] px-5 py-[15px]">
                <span className="font-mono text-[12.5px] font-medium">
                  receipt · sUSD
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--v2-dim)]">
                  06/15/2026, 09:02 UTC
                </span>
              </div>
              <div className="flex flex-col px-5 pb-3 pt-2">
                {[
                  {
                    at: 0,
                    k: "inputs",
                    v: (
                      <>
                        <InChip>Pyth</InChip>
                        <InChip>Jupiter</InChip>
                        <InChip>Redemption value</InChip>
                        <InChip>Liquidity depth</InChip>
                      </>
                    ),
                  },
                  {
                    at: 1,
                    k: "measure",
                    v: (
                      <>
                        <FxChip>spread = 1 − 0.9772 / 1.0006</FxChip>
                        <span className="mx-[5px] font-mono text-[11px] text-[var(--v2-dim)]">
                          →
                        </span>
                        {/* The formula right above resolves to a DISCOUNT
                            (0.9772 market < 1.0006 intrinsic), so the sign has
                            to be "−" and the colour has to come from that sign,
                            not from the DRIFT state token this used to borrow.
                            Same −234 bps as the canonical sUSD row in shared. */}
                        <span
                          className={cn("font-medium", v2SpreadSignClass(-234))}
                        >
                          −2.34%
                        </span>{" "}
                        below reference
                      </>
                    ),
                  },
                  {
                    at: 2,
                    k: "verdict",
                    v: (
                      <>
                        <span className="inline-flex items-center gap-2">
                          <StatePillV2 state="PEGGED" />
                          <span className="font-mono text-[11px] text-[var(--v2-dim)]">
                            →
                          </span>
                          <StatePillV2 state="DRIFT" />
                        </span>
                        <span className="mt-[7px] block text-[12.5px] leading-normal text-[var(--v2-muted)]">
                          crossed sUSD&rsquo;s own drift threshold, held 120s
                        </span>
                      </>
                    ),
                  },
                  {
                    at: 3,
                    k: "receipt",
                    v: (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code
                              role="button"
                              tabIndex={0}
                              className={cn(
                                FX_CHIP_CLASS,
                                "cursor-pointer hover:underline hover:decoration-white/25 hover:underline-offset-[3px]",
                              )}
                              onClick={() => hash.copy(RECEIPT_HASH)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  hash.copy(RECEIPT_HASH);
                                }
                              }}
                            >
                              0x9f3a1d84…c21b
                              {hash.copied && (
                                <span className="text-[var(--v2-peg)]">
                                  {" "}
                                  copied
                                </span>
                              )}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent>click to copy</TooltipContent>
                        </Tooltip>{" "}
                        · methodology v0.7.0
                      </>
                    ),
                  },
                ].map((row) => (
                  <div
                    key={row.k}
                    className={cn(
                      "flex gap-4 border-b border-dashed border-[var(--v2-line)] py-3 transition-[transform,opacity] duration-[550ms] ease-[var(--v2-ease)] last:border-b-0",
                      rowOn(row.at)
                        ? "translate-y-0 opacity-100"
                        : "translate-y-1.5 opacity-15",
                    )}
                  >
                    <span className="w-24 shrink-0 pt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--v2-dim)]">
                      {row.k}
                    </span>
                    <span className="text-[13.5px] leading-[1.5] text-[var(--v2-muted)]">
                      {row.v}
                    </span>
                  </div>
                ))}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "mx-5 mb-4 mt-1.5 flex cursor-pointer items-center gap-2.5 overflow-x-auto rounded-xl border border-[var(--v2-line)] px-4 py-3 font-mono text-[12.5px] text-[var(--v2-text)] transition-[transform,opacity] duration-[550ms] ease-[var(--v2-ease)] hover:underline hover:decoration-white/25 hover:underline-offset-[3px]",
                      rowOn(3)
                        ? "translate-y-0 opacity-100"
                        : "translate-y-1.5 opacity-15",
                    )}
                    onClick={() => cmd.copy(RECEIPT_CMD)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        cmd.copy(RECEIPT_CMD);
                      }
                    }}
                  >
                    <span className="text-[var(--v2-dim)]">$</span>{" "}
                    pegana-replay 0x9f3a1d84…c21b
                    {cmd.copied && (
                      <span className="text-[var(--v2-peg)]"> copied</span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>click to copy</TooltipContent>
              </Tooltip>
              {/* Radical-candor disclosure, same pattern as the hero board's
                  "sample rows: production binds to /v1/assets" caption — the
                  hash + CLI command above are illustrative, not independently
                  replayable by a visitor. Don't remove the hash, just label
                  it honestly. */}
              <div
                className={cn(
                  "mx-5 mb-3 font-mono text-[10.5px] tracking-[0.02em] text-[var(--v2-dim)] transition-opacity duration-[550ms] ease-[var(--v2-ease)]",
                  rowOn(3) ? "opacity-100" : "opacity-0",
                )}
              >
                illustrative hash: production receipts replay against your own
                pull
              </div>
              <div
                className={cn(
                  "flex items-center justify-between gap-2.5 border-t border-[var(--v2-line)] px-5 py-3 transition-opacity duration-[550ms] ease-[var(--v2-ease)]",
                  rowOn(3) ? "opacity-100" : "opacity-0",
                )}
              >
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--v2-peg)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--v2-peg)]" />
                  byte-identical, or it fails loudly
                </span>
                <Link
                  href="/audit"
                  className="border-b border-[var(--v2-line2)] pb-px font-mono text-xs text-[var(--v2-muted)] transition-colors hover:border-white hover:text-[var(--v2-text)]"
                >
                  verify in your browser →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
