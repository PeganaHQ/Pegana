import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PegState } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

/** The committed alerting bands. A PEGGED/UNKNOWN asset is never `sustained`,
 *  so the badge renders nothing for them — this only ever shows on a real
 *  alerting episode. */
const ALERTING: ReadonlySet<string> = new Set([
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
]);

const STATE_LABEL: Record<string, string> = {
  DRIFT: "drift",
  DEPEG: "depeg",
  CRITICAL: "critical",
  BLACK_SWAN: "black swan",
};

/** Seconds → compact human duration (numbers only → mono): 45s, 12m, 5h, 3d, 4mo. */
function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3_600) return `${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `${Math.round(secs / 3_600)}h`;
  if (secs < 2_592_000) return `${Math.round(secs / 86_400)}d`;
  return `${Math.round(secs / 2_592_000)}mo`;
}

/**
 * "Time in state" indicator for the time-below-peg signal (Spec 03).
 *
 * Renders ONLY for a committed alerting band (DRIFT+) with a known duration —
 * a PEGGED/UNKNOWN asset shows nothing. When the episode is `sustained` it gets
 * an emphasized, state-toned pill: the "this has been depegging for months — a
 * slow mechanism failure, not a blip" signal that an instantaneous reading
 * cannot convey. Returns `null` until the engine has stamped the duration, so
 * it degrades cleanly on assets/deploys without the field.
 */
export function SustainedBadge({
  state,
  durationSecs,
  sustained,
  className,
}: {
  state: PegState | null | undefined;
  durationSecs: number | null | undefined;
  sustained?: boolean;
  className?: string;
}) {
  if (!state || !ALERTING.has(state) || durationSecs == null) return null;

  const dur = fmtDuration(durationSecs);
  const label = STATE_LABEL[state] ?? state.toLowerCase();
  const severe = state !== "DRIFT";
  const body = sustained
    ? `Held ${label} for ${dur}. A sustained episode (a slow mechanism depeg), not a transient blip.`
    : `In ${label} for ${dur}. Not yet a sustained episode.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A <button>, not a <span>: this badge's tooltip carries the caveat that
            stops the number beside it from being over-trusted, and a bare <span>
            is not focusable, so Radix's asChild trigger never fires onFocus —
            the caveat was mouse-only. `align-middle` is required on the button
            (the span never needed it) or the taller inline-block box shifts the
            row height. */}
        <button
          type="button"
          aria-label={`Held ${label} for ${dur}. ${sustained ? "A sustained episode." : "Not yet sustained."}`}
          className={cn(
            "inline-flex align-middle cursor-help h-5 shrink-0 items-center rounded-full border px-2 font-mono text-[9px] uppercase tracking-[0.08em]",
            // Literal class strings (Tailwind JIT cannot see interpolated names).
            sustained
              ? severe
                ? "border-st-depeg/40 text-st-depeg-text"
                : "border-st-drift/40 text-st-drift"
              : "border-hairline text-text-caption",
            className,
          )}
        >
          {sustained ? `sustained · ${dur}` : `${dur} in ${label}`}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span className="block max-w-[260px]">{body}</span>
      </TooltipContent>
    </Tooltip>
  );
}
