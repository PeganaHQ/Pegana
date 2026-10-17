"use client";

import { useMemo } from "react";
import { RecoveryGauge } from "@/components/atoms/recovery-gauge";
import { HelpIcon } from "@/components/atoms/help-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  AlertRow,
  AssetCardData,
  HistoryPoint,
  PegState,
} from "@/lib/api/types";
import { computeRecoveryConfidence } from "@/lib/asset/recovery";
import { formatJitterPct } from "@/lib/api/format";
import { displaySymbol } from "@/lib/asset/display-symbol";

// "What we think happens next" panel — combined signal from real data:
//   - time-pegged 7d (from history)
//   - state flips 7d (from alerts)
//   - peer spread range (from useAssets-supplied peers list)
//   - recovery p50 (from prior depeg recoveries — falls back to "n/a" when
//     no transitions in window)
//
// Score = weighted sum → letter grade A/B/C/D. Editorial copy adapts.

interface RecoveryConfidenceProps {
  asset: AssetCardData;
  history: HistoryPoint[] | undefined;
  alerts: AlertRow[] | undefined;
  peers: AssetCardData[] | undefined;
  /** Current engine state — widget is suppressed when UNKNOWN because a letter
   *  grade + recovery % on an unclassifiable asset is contradictory. */
  state?: PegState;
}

export function RecoveryConfidence(props: RecoveryConfidenceProps) {
  // Engine can't classify the asset — suppress the confident grade + sub-bars.
  // Gate ABOVE the hook-bearing inner so a mid-session flip to/from UNKNOWN
  // (e.g. a WebSocket reconnect degrading the asset) unmounts the inner
  // instead of changing this component's hook count — early-returning before
  // the useMemos below is a Rules-of-Hooks crash (white-screens the page).
  if (props.state === "UNKNOWN") return (
    <p className="text-[13px] text-text-muted">Recovery data unavailable for this state.</p>
  );
  return <RecoveryConfidenceInner {...props} />;
}

function RecoveryConfidenceInner({
  asset,
  history,
  alerts,
  peers,
}: RecoveryConfidenceProps) {
  const c = useMemo(
    () => computeRecoveryConfidence(asset, history, alerts, peers),
    [asset, history, alerts, peers],
  );

  // Editorial copy adapts to grade. Avoid generic-LLM phrasing; speak in
  // observed numbers.
  const editorial = useMemo(() => {
    if (c.grade === "A") {
      return (
        <>
          Combined signal from{" "}
          <strong>
            time-pegged{" "}
            <span data-num>
              {c.pegPct != null ? `${(c.pegPct * 100).toFixed(1)}%` : "n/a"}
            </span>{" "}
            (7d)
          </strong>
          {c.peerSpreadBps != null && (
            <>
              , peers within{" "}
              <strong>
                <span data-num>{formatJitterPct(c.peerSpreadBps)}</span>
              </strong>
            </>
          )}
          {c.recoveryP50Min != null && (
            <>
              , recovery distribution median{" "}
              <strong>
                <span data-num>{c.recoveryP50Min.toFixed(0)} min</span>
              </strong>
            </>
          )}{" "}
          suggests the current spread mean-reverts inside the hour.{" "}
          {/* Suppress the absolute "no stress" claim when the live state is an
              active depeg — H1/H9: a confirmed stress reading must never read
              as a clean verdict (the grade is also capped to C upstream). */}
          {c.stressed ? (
            <strong>
              Live state is off-peg; recovery history does not override the
              current reading.
            </strong>
          ) : (
            <strong>
              {c.calibrating
                ? "Alert history still calibrating; not yet a confirmed verdict."
                : "No leading indicators of stress."}
            </strong>
          )}
        </>
      );
    }
    if (c.grade === "B") {
      return (
        <>
          {displaySymbol(asset.symbol)} is within band with{" "}
          <strong>moderate confidence</strong>
          {c.flips > 0 && (
            <>
              {" "}
              {c.flips} state {c.flips === 1 ? "flip" : "flips"} in the
              visible window
            </>
          )}
          .
          {c.peerSpreadBps != null && (
            <>
              {" "}
              Peer convergence at{" "}
              <strong>
                <span data-num>{formatJitterPct(c.peerSpreadBps)}</span>
              </strong>{" "}
              still suggests synchronized behavior.
            </>
          )}{" "}
          Monitor for sustained drift.
        </>
      );
    }
    if (c.grade === "C") {
      return (
        <>
          Recovery confidence reduced.{" "}
          {c.flips > 3 && (
            <>
              <strong>
                <span data-num>{c.flips}</span> state flips
              </strong>{" "}
              indicate elevated volatility.
            </>
          )}
          {c.peerSpreadBps != null && c.peerSpreadBps >= 100 && (
            <>
              {" "}
              Peers spread out by{" "}
              <strong>
                <span data-num>{formatJitterPct(c.peerSpreadBps)}</span>
              </strong>{" "}
              suggests idiosyncratic stress.
            </>
          )}{" "}
          Recovery profile remains plausible but not reliable.
        </>
      );
    }
    return (
      <>
        <strong>Stress signal active.</strong>
        {c.pegPct != null && (
          <>
            {" "}
            Time-pegged dropped to{" "}
            <strong>
              <span data-num>{(c.pegPct * 100).toFixed(1)}%</span>
            </strong>{" "}
            over the visible window.
          </>
        )}{" "}
        Recovery distribution unreliable from current sample.
      </>
    );
  }, [asset.symbol, c]);

  return (
    <div>
      <h2 className="flex items-center text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Recovery confidence
        <HelpIcon term="recovery_confidence" side="bottom" />
      </h2>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
          Pegana editorial · what we think happens next
        </p>
        {c.calibrating && (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A <button>, not a <span>: this badge's tooltip carries the caveat that
            stops the number beside it from being over-trusted, and a bare <span>
            is not focusable, so Radix's asChild trigger never fires onFocus —
            the caveat was mouse-only. `align-middle` is required on the button
            (the span never needed it) or the taller inline-block box shifts the
            row height. */}
              <button
                type="button"
                className="border border-hairline px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-text-caption"
              >
                Calibrating
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              No alert history yet, so this grade is provisional; not a
              confirmed verdict.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-[20px] border border-hairline bg-surface-1 p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6">
        <RecoveryGauge pct={c.score} grade={c.grade} />
        <div className="flex flex-1 flex-col">
          <p className="text-[13px] leading-[1.5] text-text-body sm:text-[14px] [&_strong]:font-medium [&_strong]:text-text [&_[data-num]]:font-mono [&_[data-num]]:font-medium [&_[data-num]]:tabular-nums [&_[data-num]]:text-text">
            {editorial}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-caption">
            <Fact
              k="peg time"
              v={c.pegPct != null ? `${(c.pegPct * 100).toFixed(1)}%` : "-"}
            />
            <Fact k="peer spread" v={formatJitterPct(c.peerSpreadBps)} />
            <Fact
              k="recovery p50"
              v={
                c.recoveryP50Min != null
                  ? `${c.recoveryP50Min.toFixed(0)} min`
                  : "-"
              }
            />
            <Fact k="flips" v={String(c.flips)} />
          </div>
          {/* Rubric breakdown — the grade is auditable, not an opaque letter. */}
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
            <RubricBar
              label="Peg time"
              credit={c.breakdown.pegCredit}
              max={50}
            />
            <RubricBar
              label="Flips"
              credit={c.breakdown.flipsCredit}
              max={25}
              muted={c.calibrating}
            />
            <RubricBar label="Peers" credit={c.breakdown.peerCredit} max={25} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span>
      {k} · <b className="font-medium text-text">{v}</b>
    </span>
  );
}

function RubricBar({
  label,
  credit,
  max,
  muted,
}: {
  label: string;
  credit: number;
  max: number;
  muted?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((credit / max) * 100)));
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-text-caption">
        <span>{label}</span>
        <span className="tabular-nums text-text-muted">
          {credit}/{max}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-text/[0.08]">
        <div
          className="h-full rounded-full bg-text-muted"
          style={{ width: `${pct}%`, opacity: muted ? 0.45 : 1 }}
        />
      </div>
    </div>
  );
}
