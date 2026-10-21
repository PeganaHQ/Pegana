"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getFreshnessSnapshot,
  isLiveUpdatesPaused,
  subscribeFreshness,
  type FailureKind,
  type FreshnessSnapshot,
} from "@/lib/api/freshness";

/**
 * Whether to show the quiet "live updates paused" notice, and why. Stays
 * `paused: false` until requests are failing AND nothing has refreshed for
 * more than 60s, so one failed poll or a short 429 wait never shows anything.
 */
export function useLiveUpdatesPaused(): {
  paused: boolean;
  kind: FailureKind | null;
} {
  const snap: FreshnessSnapshot = useSyncExternalStore(
    subscribeFreshness,
    getFreshnessSnapshot,
    getFreshnessSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const failing = snap.failureKind != null;
  // Tick only while something is failing; a healthy tab runs no timer.
  useEffect(() => {
    if (!failing) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [failing]);
  const paused = isLiveUpdatesPaused(snap, now);
  return { paused, kind: paused ? snap.failureKind : null };
}
