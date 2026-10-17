"use client";

import { useMemo } from "react";
import { stateMeta } from "@/lib/asset/state-meta";
import { Sparkline } from "@/components/atoms/sparkline";
import { Skeleton } from "@/components/atoms/skeleton";
import { cardSurface } from "@/components/atoms/surface-card";
import { useHistory } from "@/lib/hooks/use-history";
import { isPlausibleDiscount } from "@/lib/api/format";
import { thresholdsFor } from "@/lib/alerts/policy";
import type {
  AlertRow,
  AssetCardData,
  AssetClass,
  PegState,
} from "@/lib/api/types";

// Last 3 out-of-band events for this asset — pattern matching for the user
// looking at the current spread and asking "what does it usually mean when
// I see this number?".
//
// Each card: date · worst state reached · recovery time · the ACTUAL discount
// arc for that window (server-computed `HistoryPoint.discount`, minute
// buckets). This is the moat: a tamper-evident record of what the peg
// actually did during a past depeg — time-below-peg, the recovery shape —
// which a point-in-time proof-of-reserves can't show. Falls back to the
// honest stats-only card (no fabricated curve) when the window has too few
// points — outside the 365d retention window, or a fetch error.

interface ComparableEventsProps {
  alerts: AlertRow[] | undefined;
  symbol: string;
  klass: AssetClass;
  /** Authoritative per-asset bands (`asset.thresholds`) for the sparkline's
   *  depeg reference line; falls back to the local table when absent. */
  apiThresholds?: AssetCardData["thresholds"];
}

const STATE_LABEL: Record<PegState, string> = {
  PEGGED: "Recovery",
  DRIFT: "Drift",
  DEPEG: "Depeg",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black swan",
  UNKNOWN: "-",
};

interface EventPair {
  id: string;
  date: Date;
  worstState: PegState;
  recoveryMin: number | null;
}

function pairEvents(alerts: AlertRow[]): EventPair[] {
  // Group consecutive out-of-band alerts together until a PEGGED returns.
  const chrono = alerts.slice().reverse();
  const events: EventPair[] = [];
  let openId: string | null = null;
  let openDate: Date | null = null;
  let openWorst: PegState = "UNKNOWN";
  const stateRank: Record<PegState, number> = {
    PEGGED: 0,
    DRIFT: 1,
    DEPEG: 2,
    CRITICAL: 3,
    BLACK_SWAN: 4,
    UNKNOWN: -1,
  };

  for (const a of chrono) {
    if (a.to_state !== "PEGGED") {
      if (!openId) {
        openId = a.id;
        openDate = new Date(a.detected_at);
        openWorst = a.to_state;
      } else if (stateRank[a.to_state] > stateRank[openWorst]) {
        openWorst = a.to_state;
      }
    } else if (openId && openDate) {
      const dt =
        (new Date(a.detected_at).getTime() - openDate.getTime()) / 60_000;
      events.push({
        id: openId,
        date: openDate,
        worstState: openWorst,
        recoveryMin: dt > 0 ? dt : null,
      });
      openId = null;
      openDate = null;
      openWorst = "UNKNOWN";
    }
  }
  // If we have an open (unrecovered) episode, surface it too.
  if (openId && openDate) {
    events.push({
      id: openId,
      date: openDate,
      worstState: openWorst,
      recoveryMin: null,
    });
  }
  // Newest first.
  return events.reverse().slice(0, 3);
}

function fmtDate(d: Date): string {
  // Explicit UTC: this renders during SSR, so an implicit local timezone
  // would diff between the server's TZ and the visitor's browser TZ
  // (a date near midnight can even show a different calendar day) and trip
  // a hydration mismatch.
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtRecovery(min: number | null): string {
  if (min == null) return "ongoing";
  if (min < 60) return `${min.toFixed(0)} min`;
  if (min < 1440) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
}

export function ComparableEvents({
  alerts,
  symbol,
  klass,
  apiThresholds,
}: ComparableEventsProps) {
  const events = useMemo(() => (alerts ? pairEvents(alerts) : []), [alerts]);

  return (
    <div>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Comparable events
      </h2>
      <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        Most recent out-of-band episodes · worst state · recovery time
      </p>

      {events.length === 0 ? (
        <div className="border border-hairline bg-text/[0.015] p-10 text-center font-mono text-[11px] text-text-caption">
          No out-of-band episodes on record in the visible window.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {events.map((ev) => (
            <EpisodeCard
              key={ev.id}
              ev={ev}
              symbol={symbol}
              klass={klass}
              apiThresholds={apiThresholds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One episode's card. Extracted from the `events.map(...)` above so the
 * per-episode `useHistory` fetch (a hook) can be called safely — a hook
 * cannot live directly inside a `.map` callback (Rules of Hooks).
 *
 * Renders the same stats card as before, plus — when the server returns ≥2
 * plausible samples across the episode's window — a quiet sparkline of the
 * episode's ACTUAL discount arc (server-computed `HistoryPoint.discount`,
 * never recomputed client-side) sitting above the recovery stat. Degrades
 * honestly: a loading placeholder while the fetch is in flight, and no
 * sparkline at all (stats-only, exactly like today) when the window returns
 * fewer than 2 points — e.g. an episode older than the 365d retention
 * window, or a fetch error. Never fabricates a curve.
 */
function EpisodeCard({
  ev,
  symbol,
  klass,
  apiThresholds,
}: {
  ev: EventPair;
  symbol: string;
  klass: AssetClass;
  apiThresholds?: AssetCardData["thresholds"];
}) {
  // Ongoing (unrecovered) episodes have no recovery timestamp yet — window
  // extends to now.
  const end = useMemo(
    () =>
      ev.recoveryMin != null
        ? new Date(ev.date.getTime() + ev.recoveryMin * 60_000)
        : new Date(),
    [ev.date, ev.recoveryMin],
  );

  const { data: history, isLoading } = useHistory(symbol, {
    bucket: "1m",
    from: ev.date.toISOString(),
    to: end.toISOString(),
    limit: 500,
  });

  // Crown jewel: never chart a raw discount value — isPlausibleDiscount is
  // the documented per-sample sanity gate for history points. discount is
  // server-computed; only the bps conversion happens here.
  const spark = useMemo(() => {
    if (!history) return [];
    return history
      .filter((p) => isPlausibleDiscount(p.discount))
      .map((p) => parseFloat(p.discount) * 10000);
  }, [history]);
  const hasSpark = spark.length >= 2;

  return (
    <article
      className={cardSurface({ radius: 16, className: "flex flex-col gap-3 p-5" })}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
        {fmtDate(ev.date)}
      </div>
      <div
        className={`font-mono text-[24px] font-medium tabular-nums leading-none tracking-[-0.02em] ${stateMeta(ev.worstState).textClass}`}
      >
        {STATE_LABEL[ev.worstState]}
      </div>

      {isLoading ? (
        <Skeleton className="h-9 w-full rounded-sm" />
      ) : hasSpark ? (
        <Sparkline
          points={spark}
          height={36}
          stroke={stateMeta(ev.worstState).dotVar}
          thresholdBps={thresholdsFor(symbol, klass, apiThresholds).depeg_bps}
        />
      ) : null}

      <dl className="mt-auto flex flex-col gap-1 text-[12px] text-text-muted">
        <div className="flex justify-between gap-3">
          <dt>Recovered in</dt>
          <dd className="font-mono text-text">{fmtRecovery(ev.recoveryMin)}</dd>
        </div>
      </dl>
    </article>
  );
}
