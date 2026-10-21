"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { apiBase } from "@/lib/api/base";
import { useCalibration } from "@/lib/hooks/use-calibration";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  CALIBRATION_HEALTH_META,
  compareCalibrationWorstFirst,
  calibrationStatusLabel,
  type CalibrationHealthStatus,
  type CalibrationHealthMeta,
} from "@/lib/asset/calibration-health";
import {
  PageHeroV2,
  LiveDot,
} from "@/components/organisms/v2/inner/page-hero-v2";
import {
  ListRowsV2,
  ListRowHead,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import {
  StatStripV2,
  type StatItem,
} from "@/components/organisms/v2/inner/stat-strip-v2";
import { PillGhost } from "@/components/organisms/v2/shared";

// /status/calibration — full per-asset calibration self-monitor table.
//
// This used to live inline on /status (see that page's comment ~line 39):
// V5 condensed it to a prose summary + counts, dropping the density. This
// page restores the full table as its own deep-dive, linked from /status's
// calibration section ("See the full per-asset table ->").
//
// Client component (not server): the data comes from useCalibration(), a
// SWR hook (client-only), same as /status's own useCalibration() call — a
// server component can't call a hook, so this mirrors /status's own
// "use client" + no `metadata` export convention (the page inherits the
// root layout's default <title> via its "%s — Pegana" template).

const CAL_COLUMNS = "150px 128px 148px 84px 84px 104px 104px";

const TONE_COLOR: Record<CalibrationHealthMeta["tone"], string> = {
  peg: "var(--v2-peg)",
  drift: "var(--v2-drift)",
  crit: "var(--v2-crit)",
  unk: "var(--v2-unk)",
};

const TONE_BG: Record<CalibrationHealthMeta["tone"], string> = {
  peg: "rgba(95,211,160,.12)",
  drift: "rgba(226,166,81,.13)",
  crit: "rgba(224,87,78,.14)",
  unk: "rgba(143,138,163,.12)",
};

function HealthPill({ health }: { health: CalibrationHealthStatus }) {
  const meta = CALIBRATION_HEALTH_META[health];
  const color = TONE_COLOR[meta.tone];
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] font-medium"
      style={{ background: TONE_BG[meta.tone], color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {meta.label}
    </span>
  );
}

// V2 convention: DESIGN.md bans a visible em-dash anywhere (see shared.tsx's
// `dashSafe`) — a plain hyphen stands in for every omitted numeric field
// (CDP / no-data assets don't carry a bps threshold or a measured spread).
function bpsCell(v: number | undefined | null): string {
  return v == null ? "-" : `${v}`;
}

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-full bg-[var(--v2-line2)]",
        className,
      )}
    />
  );
}

function LoadingRows() {
  return (
    <div
      className="mt-6 space-y-2"
      role="status"
      aria-label="Loading calibration data"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <Bar key={i} className="h-[46px] w-full rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="v2-in-inc mt-6">
      <h3>No assets tracked yet.</h3>
      <p className="v2-in-prose">
        The calibration feed returned zero rows. Either nothing is being
        monitored yet, or every asset was filtered out server-side.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="v2-in-inc mt-6">
      <h3>Calibration feed unreachable.</h3>
      <p className="v2-in-prose">
        We couldn&apos;t load <code>/v1/calibration</code> just now. This page
        polls every 60 seconds and will recover on its own, or query the
        endpoint directly below.
      </p>
      <div className="mt-4">
        <PillGhost href={`${apiBase()}/v1/calibration`}>
          GET /v1/calibration
        </PillGhost>
      </div>
    </div>
  );
}

function CalibrationBody() {
  const { data, error } = useCalibration();

  const sorted = useMemo(
    () => (data ? [...data].sort(compareCalibrationWorstFirst) : null),
    [data],
  );

  const counts = useMemo(
    () => ({
      miscalibrated:
        data?.filter((c) => c.health === "miscalibrated").length ?? 0,
      watch: data?.filter((c) => c.health === "watch").length ?? 0,
      ok: data?.filter((c) => c.health === "ok").length ?? 0,
    }),
    [data],
  );

  // Gate on `error` too, not just `data`: SWR keeps the last successful `data`
  // on a failed background revalidation, so without this the strip would show
  // stale live-looking counts next to the hero's "feed unreachable" + the
  // ErrorState table below — a self-contradiction on a self-monitoring page.
  const statItems: StatItem[] =
    !error && data && data.length > 0
      ? [
          { value: data.length, label: "Assets tracked" },
          {
            value: counts.miscalibrated,
            label: "Miscalibrated",
            color: "var(--v2-crit)",
          },
          { value: counts.watch, label: "Watch", color: "var(--v2-drift)" },
          { value: counts.ok, label: "Ok", color: "var(--v2-peg)" },
        ]
      : [];

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Status"
        h1="Calibration self-monitor."
        maxWidthCh={22}
        lede={
          <>
            Are the bands still right? Each row is one asset&apos;s trailing-
            8-day p95/p99 spread, measured against{" "}
            <b className="font-medium text-[var(--v2-text)]">
              that asset&apos;s own
            </b>{" "}
            drift and depeg bands, never a fleet-wide average. A watcher you
            can&apos;t audit isn&apos;t a watcher, so this table is the same
            data the engine uses to grade itself, not a summary of it.
          </>
        }
        meta={[
          error ? (
            <span key="live" style={{ color: "var(--v2-crit)" }}>
              feed unreachable
            </span>
          ) : data ? (
            <LiveDot key="live">refreshes every 60s</LiveDot>
          ) : (
            "loading..."
          ),
          error ? null : data ? `${data.length} assets` : "...",
        ].filter(Boolean)}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <StatStripV2 items={statItems} />

        {error ? (
          <ErrorState />
        ) : !sorted ? (
          <LoadingRows />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ListRowsV2 label="Per-asset calibration bands" wide minWidth={760}>
              <ListRowHead columns={CAL_COLUMNS}>
                <span>Asset</span>
                <span>Status</span>
                <span>Health</span>
                <span>p95 (bps)</span>
                <span>p99 (bps)</span>
                <span>Drift (bps)</span>
                <span>Depeg (bps)</span>
              </ListRowHead>
              {sorted.map((c) => (
                <ListRow
                  key={c.symbol}
                  columns={CAL_COLUMNS}
                  href={`/asset/${encodeURIComponent(c.symbol)}`}
                  linkLabel={`View ${displaySymbol(c.symbol)} detail`}
                >
                  <b className="text-[13.5px] font-medium">
                    {displaySymbol(c.symbol)}
                  </b>
                  <span className="inline-flex w-fit items-center rounded-full border border-[var(--v2-line2)] px-2 py-1 font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--v2-muted)]">
                    {calibrationStatusLabel(c)}
                  </span>
                  <HealthPill health={c.health} />
                  <span className="v2-in-num text-[12.5px] text-[var(--v2-muted)]">
                    {bpsCell(c.p95_bps)}
                  </span>
                  <span className="v2-in-num text-[12.5px] text-[var(--v2-muted)]">
                    {bpsCell(c.p99_bps)}
                  </span>
                  <span className="v2-in-num text-[12.5px] text-[var(--v2-muted)]">
                    {bpsCell(c.drift_bps)}
                  </span>
                  <span className="v2-in-num text-[12.5px] text-[var(--v2-muted)]">
                    {bpsCell(c.depeg_bps)}
                  </span>
                </ListRow>
              ))}
            </ListRowsV2>
            <p className="mt-2 font-mono text-[12px] text-[var(--v2-muted)]">
              click a row for the asset detail &middot; sorted worst-health
              first
            </p>
          </>
        )}

        <hr className="v2-in-hr" />
        <div className="flex flex-wrap gap-3.5">
          <PillGhost href="/status">Back to status</PillGhost>
          <PillGhost href="/methodology">How states are computed</PillGhost>
          <PillGhost href={`${apiBase()}/v1/calibration`}>
            GET /v1/calibration
          </PillGhost>
        </div>
      </div>
    </main>
  );
}

export default function CalibrationSelfMonitorPage() {
  return <CalibrationBody />;
}
