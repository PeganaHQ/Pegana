import { cn } from "@/lib/utils/cn";
import { stateMeta } from "@/lib/asset/state-meta";
import type { PegState } from "@/lib/api/types";

interface StatePipProps {
  state: PegState | null | undefined;
  pulse?: boolean;
  size?: number;
  className?: string;
  /** Render text for assistive tech. Off by default because pips usually sit
   *  next to a written label; flip on for standalone usage (e.g. headers). */
  announce?: boolean;
}

const labelByState: Record<PegState, string> = {
  PEGGED: "pegged",
  DRIFT: "drifting",
  DEPEG: "depegged",
  CRITICAL: "critical",
  BLACK_SWAN: "black swan",
  UNKNOWN: "unknown",
};

export function StatePip({
  state,
  pulse: _pulse,
  size = 6,
  className,
  announce = false,
}: StatePipProps) {
  if (!state) return null;
  const color = stateMeta(state).dotVar;
  // Liveness is shown via real timestamps only — never a glow/pulse on a
  // state dot. `pulse` is intentionally a no-op here; kept in the signature
  // because many call sites still pass it. The dot is always flat.
  return (
    <span
      className={cn("inline-block rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
      }}
      role={announce ? "img" : undefined}
      aria-label={announce ? labelByState[state] : undefined}
      aria-hidden={announce ? undefined : true}
    />
  );
}
