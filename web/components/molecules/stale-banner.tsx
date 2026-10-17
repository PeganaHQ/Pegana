"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { STALE_AFTER_MS } from "@/lib/asset/freshness";
import { isForexWeekend, isFxClass } from "@/lib/asset/forex";
import { displaySymbol } from "@/lib/asset/display-symbol";

interface Props {
  symbol: string;
  updatedAt: string | null;
  /** Asset class. For an FX-pegged asset (`stable_fx`), a stale snapshot during
   *  the forex weekend is EXPECTED (the FX feed is closed), not a fault — the
   *  banner switches to a calm "FX market closed" variant instead of alarming. */
  assetClass?: string | null;
  /** When the elapsed time crosses this threshold, the banner switches from
   *  a soft "stale" tone to a hard "down" tone. */
  hardThresholdMs?: number;
  /** Minimum elapsed time to start showing the banner at all. Defaults to
   *  STALE_AFTER_MS — the same 15-min server-aligned gate the lists/dashboard use
   *  to degrade a snapshot to UNKNOWN — so the banner and the list gating fire
   *  from one source of truth (H1/H9: no confident pip without a stale warning). */
  softThresholdMs?: number;
}

// Prominent stale-data warning rendered above the asset hero. Pegana's whole
// pitch is "live peg watchdog"; a multi-minute stale indicator must not be a
// muted footnote — it has to be the first thing the user sees and offer one
// click to retry every SWR cache entry on the page.
export function StaleBanner({
  symbol,
  updatedAt,
  assetClass,
  hardThresholdMs = 30 * 60_000,
  softThresholdMs = STALE_AFTER_MS,
}: Props) {
  const { mutate } = useSWRConfig();
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!updatedAt) return null;
  const elapsed = now - new Date(updatedAt).getTime();
  if (elapsed < softThresholdMs) return null;

  const hard = elapsed >= hardThresholdMs;
  const elapsedLabel = formatElapsed(elapsed);
  const shown = displaySymbol(symbol);

  // FX-pegged assets (stable_fx, e.g. EURC) freeze legitimately while the forex
  // market is closed — show a calm "market closed (expected)" variant instead of
  // the alarming stale/indexer tone. Anchored to the actual staleness gate above,
  // so it can never claim "closed" while the asset is in fact fresh.
  const fxClosed = isFxClass(assetClass) && isForexWeekend(new Date(now));

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await mutate(() => true, undefined, { revalidate: true });
    } finally {
      setRetrying(false);
    }
  };

  const tone = fxClosed
    ? // Calm/neutral: the "expected, not an outage" tone comes from the muted pip
      // + hairline border + no pulse — NOT from low-contrast text. The label keeps
      // full-contrast text-text so it stays WCAG-AA readable (text-text-muted is
      // ~4.46:1, just under AA for this 11px keyword).
      {
        border: "border-hairline",
        text: "text-text",
        pip: "bg-text-muted",
        pulse: false,
      }
    : hard
      ? {
          border: "border-st-depeg/40",
          text: "text-st-depeg-text",
          pip: "bg-st-depeg",
          pulse: true,
        }
      : {
          border: "border-st-drift/40",
          text: "text-st-drift",
          pip: "bg-st-drift",
          pulse: true,
        };

  return (
    <div
      // H1/H9: the hard ≥30-min tone says "numbers may be wrong" — that must
      // interrupt assistive tech (assertive), not sit in the polite queue. The
      // soft tone and the FX-closed (expected) tone are informational →
      // role="status".
      role={hard && !fxClosed ? "alert" : "status"}
      className={`border-b ${tone.border} bg-canvas/80 backdrop-blur-md`}
    >
      {/* Align with the asset page shell (max-w-[1440px] px-5 sm:px-6) so the
          banner lines up with the breadcrumb/hero, not a narrower column. */}
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 font-mono text-[11px] tracking-[0.04em] sm:px-6">
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${tone.pip}`}
        />
        <span className={`uppercase ${tone.text}`}>
          {fxClosed
            ? "fx market closed"
            : hard
              ? "indexer stale"
              : "stale snapshot"}
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text">
          {fxClosed ? (
            <>
              {shown} tracks a fiat FX rate, and forex markets close on weekends
              ; its reference feed is paused, so there&apos;s no live peg signal
              until trading resumes (Sunday evening, UTC). Expected, not an
              outage.
            </>
          ) : (
            <>
              {shown} hasn&apos;t updated for {elapsedLabel}.
              {hard
                ? " Data shown may not reflect current state. See /status for upstream health."
                : " The next refresh should land within the indexer cadence."}
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!fxClosed && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 border border-hairline px-2 py-[3px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-outline hover:text-text disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          <Link
            href="/status"
            className="inline-flex items-center gap-1 text-text-muted transition-colors duration-300 hover:text-text"
          >
            Status
            <IconArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}
