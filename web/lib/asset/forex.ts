// Forex-weekend awareness for FX-pegged assets (EURC/EUR, BRZ/BRL).
//
// An FX-class asset takes its intrinsic from a Pyth FX feed (e.g. EUR/USD),
// and forex markets close over the weekend. While the market is closed the feed
// goes dark, the engine can't recompute, and the asset's snapshot legitimately
// freezes — so the generic "stale snapshot / indexer stale" warning is wrong: it
// reads as a fault when nothing is broken. These pure predicates let the UI tell
// "the FX market is closed (expected)" apart from "the data is genuinely stale".
//
// Pure module (no React, no DOM, no Date.now) so it is fully unit-testable: the
// caller passes the reference instant.

/** Minutes-into-the-UTC-day for the Friday close and Sunday reopen. The window
 *  is buffered (20:30 / 22:30) around the nominal 22:00 forex boundaries so it
 *  covers both DST regimes — mirrors the backend calibration-watch stale_snap
 *  exemption (scripts/calibration-watch.sh). Anchoring the UI variant to ACTUAL
 *  staleness as well means the buffer can never produce a false "closed" claim. */
const FRI_CLOSE_MIN = 20 * 60 + 30; // Fri 20:30 UTC
const SUN_OPEN_MIN = 22 * 60 + 30; // Sun 22:30 UTC

/**
 * Whether `now` falls inside the forex-closed weekend window, in UTC:
 * Friday from 20:30 onward, all of Saturday, and Sunday before 22:30.
 */
export function isForexWeekend(now: Date): boolean {
  const dow = now.getUTCDay(); // 0=Sun … 5=Fri … 6=Sat
  if (dow === 6) return true; // all Saturday
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (dow === 5) return minutes >= FRI_CLOSE_MIN; // Friday after close
  if (dow === 0) return minutes < SUN_OPEN_MIN; // Sunday before reopen
  return false;
}

/**
 * Whether an asset class is FX-pegged (tracks a fiat FX rate that closes on
 * weekends). Only `stable_fx` qualifies — matches the engine's `class` column
 * and the backend exemption. Absent/unknown values fail safe to false.
 */
export function isFxClass(assetClass: string | null | undefined): boolean {
  return assetClass === "stable_fx";
}
