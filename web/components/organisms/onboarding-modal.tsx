"use client";

/**
 * OnboardingModal — five-step pedagogical walkthrough for /dashboard.
 *
 * 2026-07-16 "ruthless simplification" pass. Rejected three times for looking
 * "busy / diagram-y / ugly" — every prior version crammed 2-3 small data-viz
 * widgets (band gauge + threshold ladder + mini-table + 4-frame flow) into
 * each step. That clutter WAS the ugliness. This pass applies one rule
 * everywhere: ONE big, real, art-directed focal element per step, vertically
 * centered with generous air around it, mono + a single accent hit — never a
 * grid of competing mini-cards. Any mechanism-explaining paragraph is gone;
 * the lede/support pair above the visual already carries the copy.
 *
 * What survives from the shell Rafael explicitly likes (and every prior
 * rejection kept): the left step-nav sidebar (Concept/Model/Signal/Surface/
 * Action), the iPad-horizontal card, the "Step n of 5" eyebrow, and the
 * footer's Back/Next + segmented progress bar. The sidebar itself changes
 * shape though — it's now a fading trail, not a menu: the current step is
 * full weight with an accent marker, completed steps shrink to a check +
 * label at ~50% opacity (still clickable — going back is always allowed),
 * and future steps show only a number at ~25% opacity and are inert (you
 * advance via Next or the footer's progress tabs, not by skipping ahead in
 * the rail). That's it — going back is a click, going forward is a decision.
 *
 * Motion (within brand: ease only, no springs) — at most ONE motion cue per
 * step, always gated off under `useAppReducedMotion` to a static end-state:
 *   - Concept: a slow breathing brand-gradient glow behind the live count.
 *   - Model: the two values + spread count up once on mount (no loop).
 *   - Signal: the verdict pill cycles PEGGED→DRIFT→DEPEG→CRITICAL every 2s —
 *     the one deliberately looping cue in the whole modal.
 *   - Surface: a single soft fade/slide-up reveal on mount (no loop).
 *   - Action: the one alert card arrives via a subtle slide/fade (no loop).
 *   - Step-to-step: AnimatePresence crossfade + 8px Y-slide, as before.
 *
 * Storage: `pegana:onboarding_v1`. Dismissal is permanent until cleared.
 * `useOnboardingState` (the first-visit persistence gate) is only ever
 * *consumed* here, never re-implemented.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/atoms/intent-link";
import { AnimatePresence, m } from "framer-motion";
import {
  Activity,
  Bell,
  Check,
  Gauge,
  Home,
  LayoutDashboard,
  Send,
  ShieldCheck,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { spreadSignClass } from "@/lib/state-class";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/atoms/brand-mark";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import { BandGauge } from "@/components/atoms/band-gauge";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { SparklineCell } from "@/components/molecules/sparkline-cell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useOnboardingState } from "@/lib/hooks/use-onboarding-state";
import { useStats } from "@/lib/hooks/use-stats";
import { stateMeta } from "@/lib/asset/state-meta";
import { thresholdsFor } from "@/lib/alerts/policy";
import type { PegState } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface StepRenderProps {
  isAuthed: boolean;
  onClose: () => void;
}

interface StepSpec {
  id: string;
  badge: string;
  title: string;
  /** One punchy takeaway line — never a paragraph. */
  lede: string;
  /** One short supporting line — never a paragraph. */
  support: string;
  Icon: LucideIcon;
  /** The ONE focal element for this step — real, art-directed, ~2x scale. */
  Visual: React.ComponentType;
  /** Optional slim action row below the visual (Action step's CTAs only) —
   *  never a mechanism-explaining paragraph. */
  Actions?: React.ComponentType<StepRenderProps>;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level modal
// ─────────────────────────────────────────────────────────────────────────

export function OnboardingModal() {
  const { open, hydrated, dismiss, close } = useOnboardingState();
  // Pegana is fully open: there is no account state to branch on, so the
  // action step always renders its visitor variant.
  const isAuthed = false;
  const [stepIndex, setStepIndex] = useState(0);

  // Restart the walkthrough at Step 1 every time it opens. The modal is mounted
  // once by the dashboard and never unmounts (the Radix Dialog only toggles
  // `open`), so `stepIndex` otherwise survives across opens — reopening via the
  // topbar "How it works" while already on /dashboard would resume mid-walkthrough
  // instead of restarting. Runs only on the open transition, never mid-flow.
  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  // Live count of tracked assets — bound to the API so the welcome copy never
  // drifts from reality (the universe size changes as assets are added or
  // deactivated). `assets_tracked` is the canonical figure the backend reports
  // from /v1/stats. While the fetch is in flight we omit the number rather than
  // print a stale literal.
  const { data: stats } = useStats();
  const assetCount = stats?.assets_tracked ?? null;

  const steps = useMemo(() => withLiveCount(STEPS, assetCount), [assetCount]);

  if (!hydrated) return null;

  const isLast = stepIndex === steps.length - 1;
  const step = steps[stepIndex];

  return (
    <Dialog
      open={open}
      // Escape and an outside tap are ACCIDENTS, especially on a phone where the
      // card leaves real backdrop margin on all four sides. They close for this
      // visit only. Permanent dismissal is reserved for the deliberate controls:
      // the X, "Skip onboarding", and the final CTA. Before this, one mis-tap
      // wrote the permanent flag and there was no way back — `reopenOnboarding`
      // had zero callers anywhere in the app.
      onOpenChange={(next) => !next && close()}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          // iPad-horizontal + generous: a 1216×816 (~3:2, inside the
          // 4:3–16:10 landscape band) card once there's room for it.
          // `w-full max-w-[...]` resolves against the viewport (this is
          // `position: fixed`), so it scales down fluidly below that — never
          // overflows a narrower window. Below `md` (768px) it reverts to a
          // near-fullscreen sheet that scrolls, so small mobile never breaks
          // (the first-visit auto-open in useOnboardingState now fires on
          // every viewport, so this responsive sheet is the primary mobile
          // experience — not just the "How it works" reopen path).
          "h-[min(640px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-1rem)] gap-0 overflow-hidden rounded-[20px] border border-outline bg-canvas p-0",
          // Ambient glow, backdrop only: `box-shadow` paints OUTSIDE the
          // element's own border-box and is never clipped by this element's
          // `overflow-hidden` (that only clips descendants) — so this reads
          // as a soft coral→lavender halo bleeding into the dimmed backdrop
          // around the card, while the card itself stays fully opaque
          // (`bg-canvas`, no `backdrop-filter` anywhere in this component —
          // raw `backdrop-filter` computes `none` through this fixed+rounded
          // ancestor chain, see the brand rule).
          "shadow-[0_-40px_140px_-70px_rgba(255,138,91,0.45),0_60px_170px_-70px_rgba(223,145,247,0.4)]",
          "sm:max-w-[calc(100%-2rem)]",
          "md:h-[min(816px,calc(100dvh-4rem))] md:max-h-[min(816px,calc(100dvh-4rem))] md:max-w-[1216px]",
        )}
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="relative hidden w-[272px] shrink-0 flex-col overflow-hidden border-r border-hairline bg-surface-1 md:flex">
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-7">
              <BrandMark size="md" />
              {/* A fading trail, not a menu: current = full weight + accent
                  marker; completed = check + label at ~50% opacity, still
                  clickable (going back is always fine); future = a number
                  only, ~25% opacity, inert (advance via Next / the footer's
                  progress tabs, not by skipping ahead here). */}
              <nav
                className="mt-10 flex min-h-0 flex-1 flex-col gap-1"
                aria-label="Onboarding steps"
              >
                {STEPS.map((s, i) => {
                  const Icon = s.Icon;
                  const isCurrent = i === stepIndex;
                  const isCompleted = i < stepIndex;
                  const isFuture = i > stepIndex;

                  if (isFuture) {
                    return (
                      <div
                        key={s.id}
                        className="flex min-h-12 w-full items-center gap-3 py-3 pl-4 pr-3"
                      >
                        <span className="w-4 shrink-0 text-center font-mono text-[11px] tabular-nums text-text-muted">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
                          {s.badge}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStepIndex(i)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={cn(
                        "group relative flex min-h-12 w-full items-center gap-3 rounded-lg py-3 pl-4 pr-3 text-left font-mono text-[11px] uppercase tracking-[0.1em] outline-none transition-[opacity,background-color,color]",
                        "focus-visible:ring-2 focus-visible:ring-text-muted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
                        isCurrent
                          ? "bg-surface-2 text-text"
                          : "text-text-muted opacity-50 hover:bg-surface-2/60 hover:opacity-100 hover:text-text",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-2 left-0 w-[2.5px] rounded-full transition-opacity duration-150",
                          isCurrent ? "opacity-100" : "opacity-0",
                        )}
                        style={{ background: "var(--color-coral)" }}
                      />
                      {isCompleted ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : (
                        <Icon className="size-4 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{s.badge}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="relative z-10 flex h-[76px] shrink-0 items-center border-t border-hairline bg-surface-1 px-7">
              <button
                type="button"
                onClick={dismiss}
                className="min-h-10 text-left text-[12px] text-text-muted outline-none transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
              >
                Skip onboarding
              </button>
            </div>
          </aside>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-clean">
              <div className="border-b border-hairline p-4 md:hidden">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <BrandMark />
                  <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Close onboarding"
                    className="inline-flex size-10 items-center justify-center rounded-full text-text-muted outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted"
                  >
                    <XIcon className="size-4" aria-hidden />
                  </button>
                </div>
                <div
                  // Was `overflow-x-auto`: at 390 the row needs 516px in a
                  // 340px box, so "Surface" and "Action" sat entirely off-screen
                  // with no scroll affordance — two of five steps unreachable by
                  // tap. Wrapping keeps all five reachable at every width.
                  className="flex flex-wrap gap-1.5 pb-1"
                  role="tablist"
                  aria-label="Onboarding steps"
                >
                  {STEPS.map((s, i) => {
                    const Icon = s.Icon;
                    const isCurrent = i === stepIndex;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="tab"
                        aria-selected={isCurrent}
                        onClick={() => setStepIndex(i)}
                        className={cn(
                          "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-text-muted",
                          isCurrent
                            ? "border-outline bg-surface-2 text-text"
                            : "border-hairline text-text-muted hover:border-outline hover:text-text",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {s.badge}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative flex min-h-0 flex-1 flex-col justify-start px-5 py-8 sm:px-8 sm:py-9 md:px-14 md:py-10 lg:justify-center">
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Close onboarding"
                  className="absolute right-5 top-5 hidden size-10 items-center justify-center rounded-full text-text-muted outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted md:inline-flex"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>

                <AnimatePresence mode="wait" initial={false}>
                  <m.div
                    key={step.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: EASE }}
                  >
                    <div className="mx-auto w-full max-w-[820px]">
                      <div className="mb-5">
                        <span className="inline-flex w-fit items-center justify-center rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
                          Step {stepIndex + 1} of {steps.length}
                        </span>
                      </div>
                      <DialogTitle className="block max-w-[640px] text-[30px] font-medium leading-[1.05] tracking-[-0.02em] text-text normal-case sm:text-[36px] md:text-[42px]">
                        {step.title}
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        Step {stepIndex + 1} of {steps.length}: {step.title}
                      </DialogDescription>
                      <p className="mt-5 max-w-[640px] text-[16px] font-medium leading-[1.5] text-text md:text-[18px]">
                        {step.lede}
                      </p>
                      <p className="mt-3 max-w-[620px] text-[14px] leading-[1.65] text-text-muted md:text-[15px]">
                        {step.support}
                      </p>
                    </div>

                    {/* The ONE focal element — vertically centered, generous
                        air on every side. No side-by-side body column, no
                        supporting mini-widgets. */}
                    <div className="mx-auto mt-10 flex min-h-[260px] w-full max-w-[900px] items-center justify-center rounded-[20px] bg-surface-1 p-8 md:min-h-[320px] md:p-14">
                      <div className="w-full">
                        <step.Visual />
                      </div>
                    </div>

                    {step.Actions && (
                      <div className="mx-auto mt-6 flex w-full max-w-[900px] justify-center">
                        <step.Actions isAuthed={isAuthed} onClose={dismiss} />
                      </div>
                    )}
                  </m.div>
                </AnimatePresence>
              </div>
            </div>

            <footer className="flex h-auto shrink-0 flex-col gap-3 border-t border-hairline bg-canvas p-4 sm:h-[76px] sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-0">
              <div
                className="flex min-w-0 flex-1 items-center gap-1.5"
                role="tablist"
                aria-label="Onboarding progress"
              >
                {STEPS.map((s, i) => {
                  const isCurrent = i === stepIndex;
                  const isPast = i < stepIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      aria-label={`Step ${i + 1}: ${s.title}`}
                      onClick={() => setStepIndex(i)}
                      className={cn(
                        "h-4 max-w-[44px] flex-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-text-muted",
                        "before:block before:h-1 before:rounded-full before:transition-colors",
                        isCurrent
                          ? "before:bg-st-drift"
                          : isPast
                            ? "before:bg-text-muted/55 hover:before:bg-text-muted"
                            : "before:bg-surface-2 hover:before:bg-outline",
                      )}
                    />
                  );
                })}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={stepIndex === 0}
                  className="inline-flex min-h-11 min-w-[88px] items-center justify-center rounded-full border border-outline px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted outline-none transition-colors hover:border-text hover:text-text disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-outline disabled:hover:text-text-muted focus-visible:ring-2 focus-visible:ring-text-muted"
                >
                  Back
                </button>
                {isLast ? (
                  <button
                    type="button"
                    onClick={dismiss}
                    className="inline-flex min-h-11 min-w-[118px] items-center justify-center gap-2 rounded-full bg-text px-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-canvas outline-none transition-colors hover:bg-text/85 focus-visible:ring-2 focus-visible:ring-text-muted"
                  >
                    Open dashboard
                    <IconArrowRight size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))
                    }
                    className="inline-flex min-h-11 min-w-[88px] items-center justify-center gap-2 rounded-full bg-text px-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-canvas outline-none transition-colors hover:bg-text/85 focus-visible:ring-2 focus-visible:ring-text-muted"
                  >
                    Next
                    <IconArrowRight size={12} />
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Count-up hook — animates from 0 to target on mount, ~700ms cubic ease-out
// ─────────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700) {
  const reduced = useAppReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    setValue(0);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return value;
}

// Illustrative jitoSOL example, threaded through Model/Surface/Action so the
// same asset carries the whole walkthrough. Holder-signed convention: `+` =
// premium (market above intrinsic, benign for an LST), `−` = discount (market
// below intrinsic — the direction that actually counts toward an LST's depeg
// band, per the ADR-0021 carve-out). This example is a mild discount, which
// is why it classifies as Drift throughout.
const EXAMPLE_SPREAD_PCT = -0.29;
const EXAMPLE_STATE: PegState = "DRIFT";
const JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

// ─────────────────────────────────────────────────────────────────────────
// STEP 01 — Concept (Welcome): one brand-forward moment. A single live
// figure, iridescent — not a grid of stat cells.
// ─────────────────────────────────────────────────────────────────────────

function VisualConcept() {
  // `assets_tracked` from /v1/stats — the same feed the dashboard reads, so
  // this figure never drifts from reality. Falls back to 0 while the fetch
  // is in flight (rare — the count-up finishes in under a second either way).
  const { data: stats } = useStats();
  const liveTracked = stats?.assets_tracked ?? null;
  const reduced = useAppReducedMotion();
  const assets = useCountUp(liveTracked ?? 0, 900);

  return (
    <div className="relative flex flex-col items-center gap-7 py-6 text-center">
      <m.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[90px]"
        style={{ background: "var(--color-coral)" }}
        animate={
          reduced
            ? { opacity: 0.22 }
            : { opacity: [0.16, 0.28, 0.16], scale: [1, 1.06, 1] }
        }
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 4.5, repeat: Infinity, ease: "easeInOut" }
        }
      />
      <BrandMark size="md" className="relative z-10 text-[22px]" />
      <div className="relative z-10">
        <div className="font-mono text-[92px] font-medium leading-none tabular-nums text-coral md:text-[128px]">
          {liveTracked == null ? "–" : assets.toFixed(0)}
        </div>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-text-caption">
          Pegged assets tracked · live from /v1/stats
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 02 — Model (Two values): one clean intrinsic-vs-market readout. Two
// large tabular-nums values, the signed spread below. No band gauge, no
// state badge — that's Signal's job, one step later.
// ─────────────────────────────────────────────────────────────────────────

function VisualIntrinsic() {
  const intrinsic = useCountUp(1.0421, 700);
  const market = useCountUp(1.0392, 850);
  const spreadPct = useCountUp(EXAMPLE_SPREAD_PCT, 1000);

  return (
    <div className="flex flex-col items-center gap-8 py-2 text-center">
      <div className="flex items-center gap-2.5">
        <TokenIcon mint={JITOSOL_MINT} symbol="jitoSOL" klass="lst" size={26} />
        <span className="font-mono text-[13px] font-medium text-text">
          jitoSOL
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
          · example
        </span>
      </div>

      <div className="flex w-full min-w-0 flex-col items-center gap-6 lg:flex-row lg:items-stretch lg:gap-16">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
            Intrinsic
          </div>
          <div className="mt-3 flex items-baseline justify-center gap-1.5">
            <span className="font-mono text-[32px] font-medium leading-none tabular-nums text-text sm:text-[38px] lg:text-[54px]">
              {intrinsic.toFixed(4)}
            </span>
            <span className="font-mono text-[12px] text-text-caption">SOL</span>
          </div>
        </div>
        <div aria-hidden className="h-px w-16 shrink-0 bg-hairline lg:h-auto lg:w-px lg:self-stretch" />
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
            Market
          </div>
          <div className="mt-3 flex items-baseline justify-center gap-1.5">
            <span className="font-mono text-[32px] font-medium leading-none tabular-nums text-text sm:text-[38px] lg:text-[54px]">
              {market.toFixed(4)}
            </span>
            <span className="font-mono text-[12px] text-text-caption">SOL</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-full border border-hairline bg-surface-2/50 px-5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
          Spread
        </span>
        <span
          className={cn(
            "font-mono text-[20px] font-medium tabular-nums",
            // `spreadPct` is already HOLDER-signed (it renders its own +/−),
            // while spreadSignClass takes the RAW convention — negate to cross.
            spreadSignClass(-spreadPct),
          )}
        >
          {spreadPct >= 0 ? "+" : "−"}
          {Math.abs(spreadPct).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 03 — Signal (Spread → state): the real verdict pill, cycling through
// the state vocabulary every ~2s. The one deliberately looping cue in the
// modal — frozen on Drift (continuing the jitoSOL thread) under reduced
// motion.
// ─────────────────────────────────────────────────────────────────────────

const CYCLE_STATES: PegState[] = ["PEGGED", "DRIFT", "DEPEG", "CRITICAL"];
const CYCLE_MS = 2000;

function VisualStates() {
  const reduced = useAppReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % CYCLE_STATES.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const state = reduced ? EXAMPLE_STATE : CYCLE_STATES[index];
  const meta = stateMeta(state);

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <AnimatePresence mode="wait" initial={false}>
        <m.span
          key={state}
          initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3, ease: EASE }}
          className={cn(
            "inline-flex items-center gap-3 rounded-full border px-7 py-3.5",
            meta.badgeClass,
          )}
        >
          <StatePip state={state} size={14} />
          <span className="font-mono text-[22px] font-medium uppercase tracking-[0.04em] sm:text-[26px]">
            {meta.label}
          </span>
        </m.span>
      </AnimatePresence>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-caption">
        Same five states, everywhere on the site
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 04 — Surface (Your dashboard): one real dashboard row at ~2x — the
// same column vocabulary (Asset · Spread · →Depeg · 24h) and the same
// primitives (TokenIcon, StatePip, BandGauge, SparklineCell) the actual
// board renders. A real <table>, not a hand-drawn mock.
// ─────────────────────────────────────────────────────────────────────────

function VisualDashboard() {
  const reduced = useAppReducedMotion();
  const t = thresholdsFor("jitoSOL", "lst");
  const series = [0.0009, 0.0014, 0.0018, 0.0021, 0.0025, 0.0027, 0.0029];

  return (
    <m.div
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="w-full"
    >
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        <span>Dashboard preview</span>
        <span>Illustrative</span>
      </div>
      {/* BandGauge's tooltip needs a Radix TooltipProvider ancestor; the app
          root (app/layout.tsx) supplies one globally, but this local wrapper
          keeps the preview self-contained rather than assuming a distant
          ancestor is always there. */}
      <TooltipProvider>
        <table
          aria-label="Example peg board"
          className="w-full table-fixed border-collapse overflow-hidden rounded-[14px] border border-hairline bg-surface-2/30 text-[11px] lg:text-inherit"
        >
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[20%]" />
            <col className="w-[24%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline">
              <th
                scope="col"
                className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption"
              >
                Asset
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption"
              >
                Spread
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption"
              >
                → Depeg
              </th>
              <th
                scope="col"
                className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption"
              >
                24h
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-5 py-6">
                <div className="flex items-center gap-3.5">
                  <StatePip state={EXAMPLE_STATE} size={8} />
                  <TokenIcon
                    mint={JITOSOL_MINT}
                    symbol="jitoSOL"
                    klass="lst"
                    size={34}
                  />
                  <span className="font-mono text-[16px] font-medium text-text">
                    jitoSOL
                  </span>
                </div>
              </td>
              <td className="px-4 py-6 text-right">
                <span
                  className={cn(
                    "font-mono text-[16px] font-medium tabular-nums",
                    // Hardcoded "−0.29%" below is holder-signed; raw is +0.29.
                    spreadSignClass(-EXAMPLE_SPREAD_PCT),
                  )}
                >
                  −0.29%
                </span>
              </td>
              <td className="px-4 py-6">
                <BandGauge
                  bps={29}
                  thresholds={t}
                  state={EXAMPLE_STATE}
                  klass="lst"
                />
              </td>
              <td className="px-5 py-6">
                <div className="flex justify-end">
                  <SparklineCell
                    symbol="jitoSOL"
                    series={series}
                    thresholdBps={t.depeg_bps}
                    className="h-9 w-14 lg:w-24"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </TooltipProvider>
    </m.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 05 — Action (Follow transitions): one real transition card arriving
// with a subtle slide/fade. Not a 4-frame flow.
// ─────────────────────────────────────────────────────────────────────────

function VisualAlerts() {
  const reduced = useAppReducedMotion();
  return (
    <div className="flex justify-center">
      <m.div
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-2/40 p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
            <Send className="size-3.5 text-st-pegged" aria-hidden />
            Live feed · state transition
          </div>
          <span className="shrink-0 font-mono text-[10px] text-text-caption">
            12s ago
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <TokenIcon
            mint={JITOSOL_MINT}
            symbol="jitoSOL"
            klass="lst"
            size={28}
          />
          <StatePip state={EXAMPLE_STATE} size={8} />
          <span className="font-mono text-[15px] font-medium text-text">
            jitoSOL
          </span>
        </div>

        <p className="mt-3 font-mono text-[16px] leading-[1.5] text-text">
          Drifted to <span className="text-st-drift">−0.38%</span> · Threshold{" "}
          <span className="text-text-muted">−0.50%</span>
        </p>

        <div className="mt-4 flex items-center gap-1.5 border-t border-hairline pt-3.5 font-mono text-[10px] uppercase tracking-[0.08em] text-st-pegged">
          <ShieldCheck className="size-3.5" aria-hidden />
          Verified · signed receipt
        </div>
      </m.div>
    </div>
  );
}

function ActionsAlerts({ isAuthed, onClose }: StepRenderProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {!isAuthed && (
        <Link
          href="/events"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-text bg-text px-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-canvas outline-none transition-colors hover:bg-text/85 focus-visible:ring-2 focus-visible:ring-text-muted"
        >
          Open the live feed
          <IconArrowRight size={11} />
        </Link>
      )}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted outline-none transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-text-muted"
      >
        {isAuthed ? (
          <>
            Start exploring
            <IconArrowRight size={11} />
          </>
        ) : (
          "I'll explore first"
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// STEP registry
// ─────────────────────────────────────────────────────────────────────────

// Interpolate the live tracked-asset count into any lede/support carrying a
// `{count}` token. Falls back to "the universe of" when the count hasn't
// loaded yet, so the copy is never wrong — just count-free for the first
// paint.
function withLiveCount(steps: StepSpec[], count: number | null): StepSpec[] {
  const hasToken = (s: string) => s.includes("{count}");
  if (!steps.some((s) => hasToken(s.lede) || hasToken(s.support))) {
    return steps;
  }
  const replacement = count != null ? String(count) : "the universe of";
  const sub = (s: string) => s.replace(/\{count\}/g, replacement);
  return steps.map((s) => ({
    ...s,
    lede: sub(s.lede),
    support: sub(s.support),
  }));
}

const STEPS: StepSpec[] = [
  {
    id: "concept",
    badge: "Concept",
    title: "Welcome to Pegana",
    lede: "A real-time watchdog for {count} monitored pegged assets on Solana.",
    // `{count}` is interpolated at render time from /v1/stats (assets_tracked)
    // via withLiveCount() so the universe size never goes stale.
    support:
      "We track {count} Solana pegged assets, compare intrinsic vs. market value, and stream the transition the moment they drift apart.",
    Icon: Home,
    Visual: VisualConcept,
  },
  {
    id: "model",
    badge: "Model",
    title: "Two values per asset",
    lede: "Every pegged asset has two values that should match.",
    support:
      "When they don't, that gap is the signal; surfaced fast, before the orderbook reprices.",
    Icon: Activity,
    Visual: VisualIntrinsic,
  },
  {
    id: "signal",
    badge: "Signal",
    title: "Spread becomes state",
    lede:       "The spread isn't just a number; it's one of five states.",
    support:
      "Same colors everywhere: this pill, the dashboard board, and every chart on the site.",
    Icon: Gauge,
    Visual: VisualStates,
  },
  {
    id: "surface",
    badge: "Surface",
    title: "Your dashboard",
    lede:       "One verdict, two answer cards, then the board; worst-first.",
    support:
      "Press / to search, ⌘K to jump anywhere, click any row for the full asset page.",
    Icon: LayoutDashboard,
    Visual: VisualDashboard,
  },
  {
    id: "action",
    badge: "Action",
    title: "Follow the flip before the orderbook",
    lede: "Every asset has a calibrated threshold; the transition is published with its receipt.",
    support:
      "Every alert traces back to a signed, byte-exact receipt; verify it yourself.",
    Icon: Bell,
    Visual: VisualAlerts,
    Actions: ActionsAlerts,
  },
];
