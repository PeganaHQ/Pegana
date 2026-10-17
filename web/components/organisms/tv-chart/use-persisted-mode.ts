"use client";

import { useEffect, useState } from "react";

/**
 * Tiny localStorage-backed string preference. Used to remember the chart's
 * view mode (baseline / area / line / candle) across reloads.
 *
 * Reads on mount (so SSR sees the default), writes synchronously on change.
 * Validates against `allowed` so a stale localStorage value never poisons the
 * UI after we change the option set.
 */
export function usePersistedMode<T extends string>(
  storageKey: string,
  initial: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw && (allowed as readonly string[]).includes(raw)) {
        setValue(raw as T);
      }
    } catch {
      /* private mode / quota — fall back to initial */
    }
  }, [storageKey, allowed]);

  const set = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  };

  return [value, set];
}
