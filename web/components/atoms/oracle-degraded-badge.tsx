"use client";

import { HelpIcon } from "@/components/atoms/help-icon";
import type { OracleDegraded } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

// The "amber" oracle-trust flag — advisory only, BELOW the hard 500bps Pyth
// confidence gate (which forces the state to UNKNOWN outright). Complements
// PythConfidenceBadge rather than duplicating it: that badge reports the raw
// conf/price BUCKET (High/Medium/Low); this one is the actionable heads-up
// that something is actively off with the oracle leg RIGHT NOW — a
// divergence from the market quote, a wide confidence interval, or a stale
// publish. Gated on `updatedAt` freshness exactly like PythConfidenceBadge: a
// stale or missing value renders nothing, never upgraded (hardening H1/H9).
// Unlike that badge, silence here IS the correct neutral — there's no
// "unknown" bucket to fall back to, an un-degraded/stale oracle just has no
// flag to show.

const FRESH_MS = 10 * 60 * 1000;

const REASON_LABEL: Record<OracleDegraded["reason"], string> = {
  oracle_divergence: "Oracle diverges",
  oracle_confidence_wide: "Oracle conf wide",
  oracle_stale: "Oracle stale",
};

function metric(d: OracleDegraded): string | null {
  switch (d.reason) {
    case "oracle_divergence":
      return d.spread_bps != null ? `${d.spread_bps}bps` : null;
    case "oracle_confidence_wide":
      return d.conf_bps != null ? `${d.conf_bps}bps` : null;
    case "oracle_stale":
      return d.age_secs != null ? `${d.age_secs}s` : null;
    default:
      return null;
  }
}

export function OracleDegradedBadge({
  oracleDegraded,
  updatedAt,
  className,
}: {
  oracleDegraded?: OracleDegraded | null;
  updatedAt?: string | null;
  className?: string;
}) {
  const fresh = updatedAt
    ? Date.now() - new Date(updatedAt).getTime() < FRESH_MS
    : false;
  // Stale or missing → render nothing. Advisory that only shows when
  // actively degraded AND fresh.
  if (!oracleDegraded || !fresh) return null;

  const m = metric(oracleDegraded);

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
      {REASON_LABEL[oracleDegraded.reason]}
      {m && <span>· {m}</span>}
      <HelpIcon term="oracle_crosscheck" size="xs" side="top" />
    </div>
  );
}
