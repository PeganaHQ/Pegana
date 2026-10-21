"use client";

import Link from "@/components/atoms/intent-link";
import { cn } from "@/lib/utils/cn";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  CONFIRM_UP_SECS,
  DECAY_DOWN_SECS,
  dedupSecondsFor,
  formatDedupWindow,
  formatThreshold,
  thresholdsFor,
} from "@/lib/alerts/policy";
import type { AssetCardData } from "@/lib/api/types";

interface AlertPolicyProps {
  asset: AssetCardData;
  className?: string;
}

// hyUSD is the only asset measured in collateralization ratio (CR), not bps.
// Hard-coded here so the UI shows the actual rule even when CR data isn't on
// the asset payload. Mirrors /assets.toml::thresholds_cr.
const HYUSD_CR_THRESHOLDS = {
  drift_cr: 130,
  depeg_cr: 115,
  critical_cr: 105,
  black_swan_cr: 100,
};

// Threshold-ladder table column contract — the single source of truth other
// cells must not duplicate: <col> widths (inline in the JSX below, next to
// the thead they name) and this padding map are both read by every th/td,
// so a header label and its column's cells can never drift out of alignment
// (same discipline as SCREENER_COL_PAD / BOARD_COL_PAD).
const LADDER_COL_PAD = {
  tier: "pl-5 pr-3",
  condition: "px-4",
  meaning: "px-4 pr-5",
} as const;

const LADDER_HEADER_CELL =
  "py-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption";

/**
 * "When Pegana flags a transition" — explains the exact policy that governs
 * whether a state change is emitted at all. Pulls thresholds and timing from
 * `/lib/alerts/policy.ts` (mirrors backend config).
 */
export function AlertPolicy({ asset, className }: AlertPolicyProps) {
  const isHyUsd = asset.symbol === "hyUSD";
  const thresholds = thresholdsFor(asset.symbol, asset.class, asset.thresholds);
  const dedupSecs = dedupSecondsFor(asset.class);
  const dedupLabel = formatDedupWindow(dedupSecs);

  return (
    <section
      className={cn(
        "border-t border-hairline px-5 py-10 sm:px-8 sm:py-12",
        className,
      )}
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
          When Pegana flags a transition
        </h2>
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 rounded-full border border-outline px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
        >
          Live feed
          <IconArrowRight size={10} />
        </Link>
      </header>

      <p className="max-w-[760px] text-[15px] leading-relaxed text-text-body">
        {isHyUsd ? (
          <>
            Pegana emits a transition when hyUSD&apos;s on-chain
            collateralization ratio crosses one of these levels. hyUSD is the
            only asset Pegana measures in CR (not spread) because solvency, not
            secondary-market price, is the relevant peg signal.
          </>
        ) : (
          <>
            Pegana emits a transition the first time{" "}
            {displaySymbol(asset.symbol)}
            &apos;s smoothed spread crosses a threshold below, and again when
            it recovers back to PEGGED.
          </>
        )}
      </p>

      {/* Threshold ladder — the actual numbers for THIS asset. Real
          <table table-fixed> + <colgroup> + shared LADDER_COL_PAD (same
          mechanic as assets-screener-row.tsx: header label and its column's
          cells share ONE padding value, so they can never drift apart),
          wrapped in the approved premium card (rounded-[20px] border
          border-hairline bg-surface-1, header band bg-surface-2/60). Row
          height is intentionally natural (not the boards' fixed h-16) —
          Meaning is prose that wraps, not a single-line scalar. */}
      <div className="mt-7 max-w-[760px] overflow-hidden rounded-[20px] border border-hairline bg-surface-1">
        <table
          aria-label="Alert threshold tiers for this asset"
          className="w-full table-fixed border-collapse text-left"
        >
          <colgroup>
            <col className="w-[92px] sm:w-[110px]" />
            <col className="w-[132px] sm:w-[200px]" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline bg-surface-2/60">
              <th
                scope="col"
                className={cn(LADDER_HEADER_CELL, LADDER_COL_PAD.tier)}
              >
                Tier
              </th>
              <th
                scope="col"
                className={cn(LADDER_HEADER_CELL, LADDER_COL_PAD.condition)}
              >
                Condition
              </th>
              <th
                scope="col"
                className={cn(LADDER_HEADER_CELL, LADDER_COL_PAD.meaning)}
              >
                Meaning
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            <ThresholdRow
              tier="Drift"
              tierColor="text-st-drift"
              condition={
                isHyUsd
                  ? `CR ≤ ${HYUSD_CR_THRESHOLDS.drift_cr}%`
                  : `|spread| ≥ ${formatThreshold(thresholds.drift_bps)}`
              }
              meaning="First alarm. Worth knowing about; not yet a depeg."
            />
            <ThresholdRow
              tier="Depeg"
              tierColor="text-st-depeg-text"
              condition={
                isHyUsd
                  ? `CR ≤ ${HYUSD_CR_THRESHOLDS.depeg_cr}%`
                  : `|spread| ≥ ${formatThreshold(thresholds.depeg_bps)}`
              }
              meaning="Material gap. Position-sizing territory."
            />
            <ThresholdRow
              tier="Critical"
              tierColor="text-st-critical-text"
              condition={
                isHyUsd
                  ? `CR ≤ ${HYUSD_CR_THRESHOLDS.critical_cr}%`
                  : `|spread| ≥ ${formatThreshold(thresholds.critical_bps)}`
              }
              meaning="Tail-risk territory. Read the mechanism before adding."
            />
            {isHyUsd && (
              <ThresholdRow
                tier="Black swan"
                tierColor="text-st-critical-text"
                condition={`CR ≤ ${HYUSD_CR_THRESHOLDS.black_swan_cr}%`}
                meaning="Undercollateralized. Bypasses all silence windows; fires every tick."
              />
            )}
          </tbody>
        </table>
      </div>

      {/* The mechanics behind the threshold check */}
      <dl className="mt-8 grid max-w-[760px] gap-x-8 gap-y-5 sm:grid-cols-2">
        <PolicyItem term="Confirmation">
          The new state must hold for ≥{CONFIRM_UP_SECS}s when worsening or ≥
          {DECAY_DOWN_SECS / 60} min when recovering; filters out one-tick
          noise so you don&apos;t get pinged on a single bad oracle sample.
        </PolicyItem>
        <PolicyItem term="Silence between repeats">
          {dedupLabel} per severity level. If {displaySymbol(asset.symbol)}{" "}
          stays in Drift for hours, you get one alert, not one every refresh.
          Escalations (e.g. Drift → Depeg) fire instantly even mid-silence.
        </PolicyItem>
        <PolicyItem term="Recovery is always delivered">
          You&apos;ll hear about the return to PEGGED exactly once per cycle.
          Recovery has its own dedup bucket, so it&apos;s not muted by the
          earlier alarm.
        </PolicyItem>
        <PolicyItem term="Black-swan bypass">
          A BLACK_SWAN classification (only hyUSD today, when CR ≤ 100%) skips
          confirmation and silence entirely. The next tick fires.
        </PolicyItem>
      </dl>

      <p className="mt-7 max-w-[760px] font-mono text-[11px] leading-relaxed text-text-muted">
        Want the source? Thresholds live in{" "}
        <Link
          href="https://github.com/PeganaHQ/ReplayCLI/blob/main/assets.toml"
          className="underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          assets.toml
        </Link>
        ; dedup and confirmation windows in{" "}
        <Link
          href="/methodology"
          className="underline-offset-2 hover:underline"
        >
          /methodology
        </Link>
        .
      </p>
    </section>
  );
}

function ThresholdRow({
  tier,
  tierColor,
  condition,
  meaning,
}: {
  tier: string;
  tierColor: string;
  condition: string;
  meaning: string;
}) {
  return (
    <tr>
      <td className={cn("py-3 align-top", LADDER_COL_PAD.tier)}>
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.12em]",
            tierColor,
          )}
        >
          {tier}
        </span>
      </td>
      <td className={cn("py-3 align-top", LADDER_COL_PAD.condition)}>
        <span className="font-mono text-[13px] tabular-nums text-text">
          {condition}
        </span>
      </td>
      <td className={cn("py-3 align-top", LADDER_COL_PAD.meaning)}>
        <span className="text-[12px] leading-relaxed text-text-muted">
          {meaning}
        </span>
      </td>
    </tr>
  );
}

function PolicyItem({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
        {term}
      </dt>
      <dd className="mt-1.5 text-[13px] leading-relaxed text-text-body">
        {children}
      </dd>
    </div>
  );
}
