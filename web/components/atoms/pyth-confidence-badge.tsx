"use client";

import { cn } from "@/lib/utils/cn";
import { HelpIcon } from "@/components/atoms/help-icon";
import type { PythConfidence } from "@/lib/api/types";

// Pyth oracle-confidence badge. Scopes the PRICE-ORACLE conf/price interval
// only — NOT market-quote / route-depth reliability (named explicitly so users
// don't read it as overall data quality). Gated on updated_at freshness: a
// stale or missing value is rendered as "no signal" (neutral), never upgraded
// to a positive bucket (hardening H1/H9).

const FRESH_MS = 10 * 60 * 1000;

const MAP: Record<PythConfidence, { label: string; cls: string; dot: string }> =
  {
    high: {
      label: "High",
      cls: "text-st-pegged",
      dot: "var(--color-st-pegged)",
    },
    medium: {
      label: "Medium",
      cls: "text-st-drift",
      dot: "var(--color-st-drift)",
    },
    low: {
      label: "Low",
      cls: "text-st-depeg-text",
      dot: "var(--color-st-depeg)",
    },
    unknown: {
      label: "No signal",
      cls: "text-text-caption",
      dot: "var(--color-st-unknown)",
    },
  };

export function PythConfidenceBadge({
  confidence,
  updatedAt,
}: {
  confidence?: PythConfidence;
  updatedAt?: string | null;
}) {
  const fresh = updatedAt
    ? Date.now() - new Date(updatedAt).getTime() < FRESH_MS
    : false;
  // Stale or missing → neutral "no signal". Never upgrade a missing value.
  const bucket: PythConfidence = fresh && confidence ? confidence : "unknown";
  const m = MAP[bucket];

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center font-mono text-[9px] uppercase tracking-[0.16em] text-text-caption">
        Pyth oracle confidence
        <HelpIcon term="pyth" size="xs" side="top" />
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-[11px] font-medium",
          m.cls,
        )}
      >
        <span
          aria-hidden
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: m.dot }}
        />
        {m.label}
      </span>
    </div>
  );
}
