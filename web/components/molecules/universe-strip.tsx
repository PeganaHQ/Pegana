import { cn } from "@/lib/utils/cn";

// Command Center — the one-line vitals strip that sits above the verdict.
// Craft pass (2026-07-14): the composition SPLIT (Pegged N / Drift+ N) used to
// live here too, restating the exact numbers DashboardVerdict's headline leads
// with one line below — zero new information, just a louder echo. That split is
// gone. What stays: the universe SIZE (which the verdict states on a calm day
// but only implies on a drift day, e.g. "2 drifting. 61 holding peg") as a
// vitals anchor, plus the ops facts (alerts, delivery, freshness) that live
// nowhere else. Liveness law (MASTER LEIS NOVAS #3): the only "is this alive"
// signal here is a real relative timestamp — no pulse, no glow, no motion.
export function UniverseStrip({
  tracked,
  alerts24h,
  deliverySent,
  deliveryFailed,
  updatedAgo,
  className,
}: {
  /** Universe size — count of tracked (non-deprecated) assets. */
  tracked: number;
  alerts24h: number;
  deliverySent: number;
  deliveryFailed: number;
  /** Relative freshness stamp of the most recent snapshot in the universe,
   *  e.g. "8s ago". Omitted entirely (not "—") when there's no data yet. */
  updatedAgo?: string;
  className?: string;
}) {
  const deliveryTotal = deliverySent + deliveryFailed;
  return (
    <div
      className={cn(
        // Secondary vitals row (2026-07-14): sits UNDER the verdict-hero now,
        // so it reads one notch quieter — smaller, dimmer, and it no longer
        // owns a border (the call site passes one when it's the last row
        // before the answer-cards).
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 font-mono text-[10px] tracking-[0.04em] text-text-caption/80",
        className,
      )}
    >
      <span>{tracked} tracked</span>
      <Dot />
      <span>alerts 24h {alerts24h}</span>
      {/* Nothing dispatched in 24h means there is nothing to report on —
          "delivery 0/0" reads like a bug, so the fact only speaks when real. */}
      {deliveryTotal > 0 && (
        <>
          <Dot />
          <span>
            delivery {deliverySent}/{deliveryTotal}
          </span>
        </>
      )}
      {updatedAgo && (
        <>
          <Dot />
          <span>updated {updatedAgo}</span>
        </>
      )}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-hairline">
      ·
    </span>
  );
}
