"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { m } from "framer-motion";
import { XIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/atoms/brand-mark";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// CalibrationBannerClient — calibration window narrative surface.
//
// Onboarding-inspired layout rebrand:
//   1) Same larger modal rhythm as OnboardingModal: clear header, main
//      narrative, visual panel, and fixed footer, without copying the sidebar.
//   2) Title kept as h2 for a11y and leads with the verdict date.
//   3) Lead paragraph stays editorial sans; mono is scoped to dates and
//      technical tokens.
//   4) Timeline and trust pillars move into surface panels, matching the
//      onboarding information architecture.
//
// Zero CLI/terminal tells: no mono-everywhere, no uppercase tracking, no
// section pips, no card-grid template. Aligned with brand.md lineage
// (Phantom / Base / Helius editorial polish).

export function CalibrationBannerClient() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FloatingTrigger onOpen={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-1rem)] gap-0 overflow-hidden rounded-[20px] border border-outline bg-canvas p-0 sm:max-w-[760px] md:h-auto"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-clean">
              <div className="border-b border-hairline p-4">
                <div className="flex items-center justify-between gap-3">
                  <BrandMark />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close calibration window"
                    className="inline-flex size-10 items-center justify-center rounded-full text-text-muted outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted"
                  >
                    <XIcon className="size-4" aria-hidden />
                  </button>
                </div>
              </div>

              <div className="relative px-4 py-4 sm:px-6 sm:py-5 md:px-[18px] md:py-[18px]">
                <div className="max-w-[620px]">
                  <div className="mb-4">
                    <span className="inline-flex w-fit items-center justify-center rounded-full bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-text-muted">
                      Calibration window
                    </span>
                  </div>
                  <DialogTitle className="block max-w-[560px] text-[32px] font-medium leading-[1.02] tracking-normal text-text normal-case sm:text-[44px]">
                    Public launch checkpoint:{" "}
                    <span className="whitespace-nowrap">June 11, 2026</span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    Launch calibration details for June 11, 2026.
                  </DialogDescription>
                  <p className="mt-4 max-w-[610px] text-[14px] leading-[1.65] text-text-muted sm:text-[15px]">
                    The engine dogfooded through{" "}
                    <span className="text-text-body">June 10, 2026</span>.
                    Alerts and receipts now publish as live product output; this
                    note records the launch gate that confirmed{" "}
                    <b className="font-medium text-text-body">
                      calibration v1.
                    </b>
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                  <section className="rounded-[16px] bg-surface-1 p-4">
                    <div className="space-y-3">
                      <Pillar
                        num="01"
                        title="What we measure"
                        body="Every alert is a pure function over four inputs: intrinsic value, executable market quote, assets.toml thresholds, EWMA state."
                      />
                      <Pillar
                        num="02"
                        title="Why receipts matter"
                        body={
                          <>
                            Public alerting launched with measured{" "}
                            <span className="font-mono text-text-body">
                              p95
                            </span>
                            /
                            <span className="font-mono text-text-body">
                              p99
                            </span>{" "}
                            latency, receipt persistence, and a replayable audit
                            trail.
                          </>
                        }
                      />
                      <Pillar
                        num="03"
                        title="What launched at the gate"
                        body={
                          <>
                            <span className="font-mono text-text-body">
                              FEATURE_PUBLIC_ALERTS
                            </span>{" "}
                            is enabled, the audit ledger carries real receipts,
                            and RSS/Atom feeds are live.
                          </>
                        }
                      />
                    </div>
                  </section>

                  <section className="rounded-[16px] bg-surface-1 p-4">
                    <CalibrationVisual />
                  </section>
                </div>
              </div>
            </div>

            <footer className="flex h-auto shrink-0 flex-col gap-3 border-t border-hairline bg-canvas p-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:px-[18px] sm:py-0">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                <Link
                  href="/methodology"
                  className="text-text-muted underline-offset-4 transition-colors duration-200 hover:text-text hover:underline focus-visible:ring-2 focus-visible:ring-text-muted"
                  onClick={() => setOpen(false)}
                >
                  Methodology
                </Link>
                <Link
                  href="/audit"
                  className="text-text-muted underline-offset-4 transition-colors duration-200 hover:text-text hover:underline focus-visible:ring-2 focus-visible:ring-text-muted"
                  onClick={() => setOpen(false)}
                >
                  Audit ledger
                </Link>
              </div>
            </footer>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// FloatingTrigger — fixed bottom-left pill. Brand-aligned `rounded-full` CTA,
// sans body, sentence case. Date stays in mono.
// ---------------------------------------------------------------------------

function FloatingTrigger({ onOpen }: { onOpen: () => void }) {
  const reduced = useAppReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldReduceMotion = mounted && reduced;

  return (
    <m.button
      type="button"
      onClick={onOpen}
      aria-label="Open calibration window details"
      initial={
        shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.45,
        delay: shouldReduceMotion ? 0 : 0.6,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={shouldReduceMotion ? undefined : { y: -2 }}
      className="group fixed bottom-5 left-5 z-40 inline-flex min-h-10 items-center gap-2.5 rounded-full border border-hairline bg-surface-1/95 px-4 py-2 text-[12px] text-text-muted shadow-sm backdrop-blur transition-colors hover:border-outline hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-text-muted"
    >
      <span
        aria-hidden
        className="relative flex h-2 w-2 items-center justify-center"
      >
        <span className="absolute h-2 w-2 rounded-full bg-st-drift" />
        <span className="absolute h-2 w-2 animate-ping rounded-full bg-st-drift opacity-75" />
      </span>
      <span className="font-medium">Calibration window</span>
      <span aria-hidden className="h-3 w-px bg-hairline" />
      <span className="text-text-caption">
        Launched{" "}
        <span className="text-text-muted group-hover:text-text">
          June 11, 2026
        </span>
      </span>
    </m.button>
  );
}

// ---------------------------------------------------------------------------
// Body pieces — onboarding rhythm without copying its sidebar.
// ---------------------------------------------------------------------------

function CalibrationVisual() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-text">Launch timeline</p>
          <p className="mt-1 text-[12px] text-text-caption">
            Deploy, dogfood, launch checkpoint.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-st-drift" aria-hidden />
          Dogfood
        </span>
      </div>

      <div className="border border-hairline">
        <TimelineRow label="Deploy" dateLabel="May 29, 2026" tone="muted" />
        <TimelineRow label="Dogfood" dateLabel="Calibrating" tone="drift" />
        <TimelineRow
          label="Launch gate"
          dateLabel="June 11, 2026"
          tone="accent"
          last
        />
      </div>

      <div className="border border-hairline p-4">
        <p className="text-[11px] text-text-caption">Verdict date</p>
        <p className="mt-2 text-[34px] font-medium leading-none text-text sm:text-[40px]">
          June 11, 2026
        </p>
        <div className="mt-4 h-px bg-hairline" />
        <p className="mt-3 text-[13px] leading-[1.55] text-text-muted">
          The gate cleared after the per-class verdict rule matched the measured
          calibration data.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pillar — one row of the vertical narrative stack. Quiet ordinal in a left
// gutter, editorial title + body on the right. No box, no hairline grid —
// the parent section's `divide-y` carries the visual separation.
// ---------------------------------------------------------------------------

function Pillar({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="flex gap-4 border border-hairline p-4">
      <span className="mt-[5px] w-5 shrink-0 font-mono text-[11px] tabular-nums text-text-caption">
        {num}
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-snug text-text">
          {title}
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-text-muted">
          {body}
        </p>
      </div>
    </div>
  );
}

function TimelineRow({
  label,
  dateLabel,
  tone,
  last = false,
}: {
  label: string;
  dateLabel: string;
  tone: "muted" | "drift" | "accent";
  last?: boolean;
}) {
  const dotClass =
    tone === "accent"
      ? "bg-coral"
      : tone === "drift"
        ? "bg-st-drift"
        : "bg-text-caption";

  return (
    <div
      className={
        last
          ? "flex items-center gap-3 px-4 py-3"
          : "flex items-center gap-3 border-b border-hairline px-4 py-3"
      }
    >
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
      <span className="min-w-0 flex-1 text-[13px] font-medium text-text">
        {label}
      </span>
      <span className="shrink-0 text-right text-[12px] text-text-caption">
        {dateLabel}
      </span>
    </div>
  );
}
