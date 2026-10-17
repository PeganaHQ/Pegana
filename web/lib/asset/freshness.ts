// Freshness gating for live/REST asset snapshots.
//
// H1/H9 invariant: a STALE snapshot must never render as confirming/good data.
// A snapshot whose `updated_at` is older than STALE_AFTER_MS is treated as
// UNKNOWN downstream — muted pip, spread "—", no good-band coloring.
//
// Pure module (no React, no DOM) so the threshold logic is unit-testable.

import type { PegState } from "@/lib/api/types";

/** A snapshot older than this (vs the caller's `now`) is KNOWN-stale. Aligned to
 *  the SERVER's own 15-minute serving window (routes/assets.rs + stats.rs both
 *  gate `ds.ts >= now() - INTERVAL '15 minutes'`): the API serves any snapshot
 *  inside that window as valid live state, so the client must not degrade one to
 *  UNKNOWN *earlier* than the server does. The previous 2-minute gate only ever
 *  produced FALSE staleness — most catastrophically when `now` is a skewed
 *  client wall clock: a PC running a few minutes fast marked EVERY asset stale at
 *  once, blanking all states and dropping the freshness-gated cards. Client
 *  surfaces should ALSO anchor `now` to server time where they can (the
 *  dashboard measures the offset from the freshest snapshot in the payload); this
 *  15-min window is the shared safety net for the ones that still tick off the
 *  raw local clock. */
export const STALE_AFTER_MS = 900_000;

/**
 * Age of a snapshot in milliseconds relative to `nowMs`.
 *
 * Returns `null` when `updatedAt` is missing or unparseable — absence is NOT
 * an age, and callers must handle "no timestamp" via the existing null-state
 * path rather than treating it as fresh or stale.
 */
export function ageMs(
  updatedAt: string | null | undefined,
  nowMs: number,
): number | null {
  if (updatedAt == null) return null;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return null;
  return nowMs - t;
}

/**
 * Whether a snapshot is KNOWN-stale: it has a parseable timestamp AND that
 * timestamp is older than `thresholdMs`.
 *
 * A missing/unparseable `updated_at` returns `false` here on purpose — absence
 * is handled by the existing null-state path (the row already degrades to
 * UNKNOWN when state/spread are missing), so this helper must not blanket-flag
 * everything without a timestamp as stale.
 */
export function isStale(
  updatedAt: string | null | undefined,
  nowMs: number,
  thresholdMs: number = STALE_AFTER_MS,
): boolean {
  const age = ageMs(updatedAt, nowMs);
  return age != null && age > thresholdMs;
}

/**
 * The state to RENDER/COUNT for an asset, with the H1/H9 freshness gate applied.
 *
 * Prefers the live WS frame's state over the REST snapshot's, but if the
 * effective `updated_at` (live frame's, else REST's) is KNOWN-stale the asset
 * degrades to "UNKNOWN" — so a frozen snapshot can never be counted as
 * drifting/depegged/pegged (it must read as UNKNOWN everywhere: rows AND the
 * summary counts/headlines that sit above them). A missing timestamp is NOT
 * stale (absence is handled by the null-state fallback to "UNKNOWN").
 *
 * Single source of truth for the gating that the dashboard rows, the mobile
 * hero counts, and the sidebar view counts all share.
 */
export function effectiveState(
  live: { state?: PegState; updated_at?: string } | undefined,
  asset: { state?: PegState | null; updated_at?: string | null },
  nowMs: number,
  thresholdMs: number = STALE_AFTER_MS,
): PegState {
  if (isStale(live?.updated_at ?? asset.updated_at, nowMs, thresholdMs)) {
    return "UNKNOWN";
  }
  return (live?.state ?? asset.state ?? "UNKNOWN") as PegState;
}
