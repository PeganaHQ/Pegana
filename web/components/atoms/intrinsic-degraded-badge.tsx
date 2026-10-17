"use client";

import { HelpIcon } from "@/components/atoms/help-icon";
import {
  classifyIntrinsicDegraded,
  type LstLivenessFlags,
} from "@/lib/asset/intrinsic-degraded";
import { cn } from "@/lib/utils/cn";

// The intrinsic-side analogue of OracleDegradedBadge (ADR-0035): an amber,
// advisory-only heads-up that an LST's BACKING may be frozen — the directory
// maintainer (lst-directory.com / Hylo) flags the rate as stale, the LST as
// deprecated, or the pool as dead. This is exactly the 2026-04-01 dSOL failure
// mode (a frozen-but-served backing passing as a confident PEGGED, which
// Pegana's timestamp-only intrinsic staleness can't catch). Out-of-hash
// (ADR-0037): never a verdict input.
//
// Silence IS the correct neutral — a healthy or directory-uncovered LST simply
// has no flag. Unlike OracleDegradedBadge there is deliberately NO `updatedAt`
// freshness gate: the flag is the directory maintainer's own slow-moving
// (per-epoch) liveness call fetched fresh from the same-origin proxy, not a
// reading off the live price snapshot — so tying it to the price timestamp
// would be the wrong freshness axis. An unreachable directory already resolves
// to null upstream (the hook), which renders nothing here.

const REASON_LABEL = {
  backing_dead: "Backing dead",
  backing_deprecated: "Backing deprecated",
  backing_stale: "Backing stale",
} as const;

export function IntrinsicDegradedBadge({
  flags,
  className,
}: {
  flags?: LstLivenessFlags | null;
  className?: string;
}) {
  const degraded = classifyIntrinsicDegraded(flags);
  if (!degraded) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 font-mono text-[11px] font-medium text-st-drift",
        className,
      )}
    >
      <span
        aria-hidden
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--color-st-drift)" }}
      />
      {REASON_LABEL[degraded.reason]}
      <HelpIcon term="intrinsic_liveness" size="xs" side="top" />
    </div>
  );
}
