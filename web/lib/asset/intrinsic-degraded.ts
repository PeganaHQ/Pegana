// Intrinsic-liveness advisory — the intrinsic-side analogue of the API's
// `oracle_degraded` amber flag (ADR-0035), but kept FRONTEND-ONLY (ADR-0037).
// It reads lst-directory.com's own maintainer flags (already fetched by /lst)
// to surface a "backing may be frozen" heads-up: the 2026-04-01 dSOL failure
// mode, where a frozen-but-served backing passes Pegana's timestamp-only
// intrinsic staleness as a confident false PEGGED. Advisory only, OUT-OF-HASH:
// never a verdict or receipt input.

export interface LstLivenessFlags {
  stale: boolean;
  deprecated: boolean;
  dead: boolean;
}

export type IntrinsicDegradedReason =
  "backing_dead" | "backing_deprecated" | "backing_stale";

export interface IntrinsicDegraded {
  reason: IntrinsicDegradedReason;
}

/**
 * Classify the amber intrinsic-liveness advisory from the directory flags.
 * Worst-first: a dead pool outranks a deprecated one, which outranks a merely
 * stale (non-advancing) rate. Returns null when none fire — a healthy or
 * directory-uncovered LST simply has no flag and the badge renders nothing.
 *
 * Deliberately NOT a software freeze-inference (rate == ratePrev over a
 * window): that would edge toward the ADR-0024-rejected constancy detection.
 * These are the directory maintainer's OWN explicit liveness determination —
 * an independent, curated signal, no continuum inference required.
 */
export function classifyIntrinsicDegraded(
  flags: LstLivenessFlags | null | undefined,
): IntrinsicDegraded | null {
  if (!flags) return null;
  if (flags.dead) return { reason: "backing_dead" };
  if (flags.deprecated) return { reason: "backing_deprecated" };
  if (flags.stale) return { reason: "backing_stale" };
  return null;
}
