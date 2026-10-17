// Centralised peg-state -> Tailwind class maps.
//
// Two patterns are used across the app:
//   - BADGE: full pill-style with border + tinted bg + colored text.
//   - TEXT:  colored text only, no surface (used in compact rows).
//
// State enum values come straight from the API (uppercase, snake-case
// for BLACK_SWAN). UNKNOWN is the safe fallback for any string that
// doesn't match — keeps render paths total.
//
// The three state-keyed functions delegate to lib/asset/state-meta.ts, the
// single canonical per-PegState record (label/badge/text/severity/dot/wash).
// Signatures are string-typed so any API string is total.
//
// SPREAD NUMBERS ARE NOT STATE-KEYED. They are colored by their own displayed
// sign (`spreadSignClass`, re-exported at the bottom from lib/api/format.ts,
// which owns the raw-vs-holder sign convention).
//
// Note: dashboard/page.tsx and status/page.tsx still hold local copies
// because they encode different design decisions (dashboard collapses
// DEPEG/CRITICAL/BLACK_SWAN into a single severity color). If we ever
// want them on the canonical helper, refactor them in a separate change.

import { stateMeta } from "@/lib/asset/state-meta";

/**
 * Return Tailwind classes for a full state badge (border + bg + text).
 * Falls back to UNKNOWN classes for any unrecognised state string.
 */
export function stateBadgeClass(state: string): string {
  return stateMeta(state).badgeClass;
}

/**
 * Return Tailwind classes for colored state text (no surface).
 * Falls back to UNKNOWN for any unrecognised state string.
 */
export function stateTextClass(state: string): string {
  return stateMeta(state).textClass;
}

/**
 * Tailwind text color for a value whose meaning is bound to the engine STATE
 * and which carries no sign of its own — a verdict headline sentence, a 0-100
 * risk score, a band-distance metric.
 *
 * ⚠️ NOT for spread numbers. Since 2026-08-10 a spread is colored by its own
 * displayed sign (premium green, discount red) via `spreadSignClass()` in
 * lib/api/format.ts, re-exported below. This function was called
 * `severityTextClass` until that change; it was renamed because the old name
 * invited exactly the wrong call.
 *
 * Falls back to UNKNOWN for any unrecognised state string.
 */
export function severityTextClass(state: string): string {
  return stateMeta(state).severityTextClass;
}

/**
 * Sign-driven color for spread numbers. Re-exported here so call sites that
 * already import from this module only swap the identifier.
 * @see lib/api/format.ts for the contract (takes RAW reconcileBps-convention bps).
 */
export { spreadSignClass, spreadSignVar } from "@/lib/api/format";
