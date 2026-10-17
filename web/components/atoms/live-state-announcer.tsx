"use client";

import { useEffect, useRef, useState } from "react";
import type { AssetCardData, PegState } from "@/lib/api/types";

// Screen-reader announcer for peg-state transitions. The product's entire value
// is state changes, yet the dashboard pips are aria-hidden and there's no live
// region — a PEGGED→DEPEG flip is announced to nobody (and color is the only
// other cue, which fails for color-blind users). This renders one visually-
// hidden polite live region driven by diffing the live state per asset. The
// first populated frame is seeded silently so we don't read out the whole
// universe on load — only genuine transitions are announced.

const LABEL: Record<PegState, string> = {
  PEGGED: "pegged",
  DRIFT: "drifting",
  DEPEG: "off peg",
  CRITICAL: "critical",
  BLACK_SWAN: "black swan",
  UNKNOWN: "unknown",
};

export function LiveStateAnnouncer({
  assets,
  liveOverrides,
}: {
  assets: AssetCardData[] | undefined;
  liveOverrides: Record<string, { state?: PegState }>;
}) {
  const prev = useRef<Record<string, PegState>>({});
  const seeded = useRef(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!assets) return;
    const cur: Record<string, PegState> = {};
    for (const a of assets) {
      cur[a.symbol] = (liveOverrides[a.symbol]?.state ??
        a.state ??
        "UNKNOWN") as PegState;
    }
    if (!seeded.current) {
      prev.current = cur;
      seeded.current = true;
      return;
    }
    const changes: string[] = [];
    for (const sym of Object.keys(cur)) {
      const before = prev.current[sym];
      if (before && before !== cur[sym]) {
        changes.push(`${sym} ${LABEL[before]} to ${LABEL[cur[sym]]}`);
      }
    }
    prev.current = cur;
    if (changes.length > 0) setMessage(`${changes.slice(0, 3).join("; ")}.`);
  }, [assets, liveOverrides]);

  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}

/**
 * Single-asset variant, for `/asset/[symbol]`.
 *
 * `LiveStateAnnouncer` above diffs a whole list and is mounted on `/dashboard`.
 * The detail page needs the same guarantee but has no list to diff — and it is
 * arguably where the guarantee matters MORE: the dashboard is a scanning
 * surface, whereas an analyst tracking one specific exposure sits on this page.
 * Until now a PEGGED→DEPEG flip here was announced to nobody, with colour and a
 * pill as the only cues.
 *
 * Same seeding discipline as the list version: the first populated frame is
 * recorded silently, so arriving on the page does not read the current state
 * out as though it had just changed. Only genuine transitions speak.
 */
export function AssetStateAnnouncer({
  symbol,
  state,
}: {
  symbol: string | undefined;
  state: PegState | null | undefined;
}) {
  const prev = useRef<PegState | null>(null);
  const seeded = useRef(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!symbol || !state) return;
    if (!seeded.current) {
      prev.current = state;
      seeded.current = true;
      return;
    }
    if (prev.current && prev.current !== state) {
      setMessage(`${symbol} ${LABEL[prev.current]} to ${LABEL[state]}.`);
    }
    prev.current = state;
  }, [symbol, state]);

  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
