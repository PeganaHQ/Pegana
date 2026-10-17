import type { PegState } from "@/lib/api/types";

// Canonical per-PegState metadata (W3a foundation). Every component that
// needs a color/label/class for a peg state should read from here instead of
// keeping its own local `Record<PegState, string>` copy — those local copies
// are how the app ended up with a dozen near-identical (and occasionally
// drifting) STATE_COLOR/STATE_TEXT_CLS maps across components/organisms and
// components/molecules.
//
// ⚠️ CHANGED 2026-08-10. This file used to expose `severityTextClass`, with
// PEGGED deliberately neutral so an in-band spread never looked "extra good"
// next to a calm pip. That rule is RETIRED: spread numbers are now colored by
// their own displayed sign (premium green, discount red) via `spreadSignClass`
// in lib/api/format.ts, because the same number was rendering neutral on the
// app and GREEN on the share cards, and a negative number in green is
// indefensible on any surface.
//
// The field is now `severityTextClass` and is ONLY for values whose meaning is
// bound to the state and which carry no sign of their own: a verdict headline
// sentence, a 0-100 risk score, a band-distance metric. Do not reach for it to
// color a spread.
//
// BLACK_SWAN reuses CRITICAL's color treatment everywhere (badge/text/dot/
// wash) — the product never renders it as a visually distinct severity — but
// keeps its own label ("Black Swan") so copy can still name the event
// precisely when it matters (e.g. audit/incident views).

export interface StateMeta {
  /** Capitalized, human-readable label. */
  label: string;
  /** Full pill/badge classes: border + tinted bg + colored text. */
  badgeClass: string;
  /** Colored text only, no surface (compact rows, inline values). */
  textClass: string;
  /** Text color for a STATE-bound value that has no sign of its own — a verdict
   *  headline, a 0-100 risk score, a band-distance metric. Same ramp as
   *  textClass but PEGGED stays neutral so a calm verdict does not shout.
   *  ⚠️ Not for spread numbers: those use `spreadSignClass` (lib/api/format.ts). */
  severityTextClass: string;
  /** CSS `var(...)` string for inline style / canvas / SVG stroke use. */
  dotVar: string;
  /** CSS `var(...)` wash string for a faint state-tinted background/row fill. */
  washClass: string;
}

const FALLBACK_KEY = "UNKNOWN";

const STATE_META: Record<Exclude<PegState, null>, StateMeta> = {
  PEGGED: {
    label: "Pegged",
    badgeClass: "border-st-pegged/30 bg-st-pegged/10 text-st-pegged",
    textClass: "text-st-pegged",
    severityTextClass: "text-text",
    dotVar: "var(--color-st-pegged)",
    washClass: "var(--color-wash-pegged)",
  },
  DRIFT: {
    label: "Drift",
    badgeClass: "border-st-drift/40 bg-st-drift/10 text-st-drift",
    textClass: "text-st-drift",
    severityTextClass: "text-st-drift",
    dotVar: "var(--color-st-drift)",
    washClass: "var(--color-wash-drift)",
  },
  DEPEG: {
    label: "Depeg",
    badgeClass: "border-st-depeg/40 bg-st-depeg/10 text-st-depeg",
    // AA-safe text variant — the saturated depeg pip hue is the one used for
    // TEXT too (see globals.css: --color-st-depeg-text aliases the base hue,
    // both clear 4.5:1 on all three V5 surfaces as of the 2026-07-03 pass).
    textClass: "text-st-depeg-text",
    severityTextClass: "text-st-depeg-text",
    dotVar: "var(--color-st-depeg)",
    washClass: "var(--color-wash-depeg)",
  },
  CRITICAL: {
    label: "Critical",
    badgeClass: "border-st-critical/40 bg-st-critical/10 text-st-critical",
    textClass: "text-st-critical-text",
    severityTextClass: "text-st-critical-text",
    dotVar: "var(--color-st-critical)",
    washClass: "var(--color-wash-critical)",
  },
  BLACK_SWAN: {
    label: "Black Swan",
    badgeClass: "border-st-critical/40 bg-st-critical/10 text-st-critical",
    textClass: "text-st-critical-text",
    severityTextClass: "text-st-critical-text",
    dotVar: "var(--color-st-critical)",
    washClass: "var(--color-wash-critical)",
  },
  UNKNOWN: {
    label: "Unknown",
    badgeClass: "border-hairline bg-surface-1 text-text-muted",
    textClass: "text-text-muted",
    severityTextClass: "text-text-muted",
    dotVar: "var(--color-st-unknown)",
    washClass: "rgba(var(--color-text-rgb), 0.06)",
  },
};

/**
 * Return the canonical metadata for a peg state. Falls back to UNKNOWN's
 * metadata for any unrecognised/null/undefined state string — keeps render
 * paths total, same contract as the old per-file `Record` + `?? FALLBACK`
 * pattern this replaces. Accepts a plain `string` (not just `PegState`) so
 * callers that only have an untyped state string (e.g. lib/state-class.ts's
 * existing `string`-typed signatures) can delegate here directly.
 */
export function stateMeta(
  state: PegState | string | null | undefined,
): StateMeta {
  if (state && state in STATE_META) {
    return STATE_META[state as Exclude<PegState, null>];
  }
  return STATE_META[FALLBACK_KEY];
}
