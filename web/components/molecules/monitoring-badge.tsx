import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

// Copy lives in lib/asset/beta-badge-copy.ts so surfaces that cannot use this
// <button> (a cell inside a stretched link) can share it without pulling in
// the tooltip.
import { BETA_BADGE_BODY, BETA_BADGE_LABEL } from "@/lib/asset/beta-badge-copy";
export { BETA_BADGE_BODY, BETA_BADGE_LABEL };

export function MonitoringBadge({
  className,
}: {
  /**
   * Accepted for call-site compatibility but intentionally NOT rendered — the
   * raw API `monitoring_reason` / `monitoring_since` are engineer-facing. The
   * user always sees the clean {@link BETA_BADGE_BODY} instead.
   */
  reason?: string;
  since?: string;
  className?: string;
}) {
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
          aria-label="Beta. Provisional calibration. Track for noise, not for trust."
          className={cn(
            "inline-flex align-middle cursor-help h-5 shrink-0 items-center rounded-full border border-hairline bg-surface-2 px-2 font-mono text-[9px] uppercase text-text-caption",
            className,
          )}
        >
          {BETA_BADGE_LABEL}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span className="block max-w-[260px]">{BETA_BADGE_BODY}</span>
      </TooltipContent>
    </Tooltip>
  );
}
