"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "pegana.watchlist.v1";

// localStorage-backed watchlist. No auth, no backend — first-party data lives
// on the client until we ship account-based subscriptions. Keys are simple
// asset symbols; we store insertion order so the UI can render "your" list in
// the order the user added items.

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

function write(symbols: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    // Notify other tabs / hook instances via storage event.
    window.dispatchEvent(new CustomEvent("pegana:watchlist-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>([]);

  // Sync from localStorage on mount + listen for cross-tab + same-tab changes.
  useEffect(() => {
    setSymbols(read());
    const onChange = () => setSymbols(read());
    window.addEventListener("storage", onChange);
    window.addEventListener("pegana:watchlist-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("pegana:watchlist-changed", onChange);
    };
  }, []);

  const has = useCallback(
    (symbol: string) => symbols.includes(symbol),
    [symbols],
  );

  const toggle = useCallback((symbol: string) => {
    const current = read();
    const next = current.includes(symbol)
      ? current.filter((s) => s !== symbol)
      : [...current, symbol];
    write(next);
  }, []);

  const add = useCallback((symbol: string) => {
    const current = read();
    if (!current.includes(symbol)) write([...current, symbol]);
  }, []);

  const remove = useCallback((symbol: string) => {
    const current = read();
    write(current.filter((s) => s !== symbol));
  }, []);

  const clear = useCallback(() => write([]), []);

  // Merge a batch of symbols into the watchlist (dedupe, preserve existing
  // order, append new ones). Uncapped — a device-local convenience for the
  // "Import" action. Returns the number of symbols actually added.
  const importSymbols = useCallback((incoming: string[]): number => {
    const current = read();
    const merged = [...current];
    for (const s of incoming) {
      if (typeof s === "string" && s.length > 0 && !merged.includes(s)) {
        merged.push(s);
      }
    }
    const added = merged.length - current.length;
    if (added > 0) write(merged);
    return added;
  }, []);

  return {
    symbols,
    has,
    toggle,
    add,
    remove,
    clear,
    importSymbols,
    count: symbols.length,
  };
}

/**
 * Parse a "Copy watchlist" URL (or a bare comma/space-separated symbol list)
 * back into an ordered symbol array. Accepts the `?watch=` param this store's
 * copy action emits, or the `?s=` param /compare uses (same symbol-list-in-URL
 * pattern), or a raw pasted list. Pure — safe to unit-test.
 */
export function parseWatchlistInput(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  let raw = trimmed;
  try {
    const u = new URL(trimmed);
    raw = u.searchParams.get("watch") ?? u.searchParams.get("s") ?? trimmed;
  } catch {
    // Not a URL — treat the whole string as a delimited symbol list.
  }
  const seen = new Set<string>();
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}
