"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { useAssets } from "@/lib/hooks/use-assets";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useStats } from "@/lib/hooks/use-stats";
import { useCalibration } from "@/lib/hooks/use-calibration";
import { LiveProvider, useLive } from "@/lib/store/live-context";
import type { PegState } from "@/lib/api/types";
import { UptimeBars } from "@/components/molecules/uptime-bars";
import { apiBase } from "@/lib/api/base";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import {
  ListRowsV2,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import { StatStripV2 } from "@/components/organisms/v2/inner/stat-strip-v2";
import { IncidentCardV2 } from "@/components/organisms/v2/inner/incident-card-v2";
import { PillPrimary, PillGhost } from "@/components/organisms/v2/shared";
import {
  RELIABILITY_LOG_DESC,
  LAUNCH_DATE,
  daysSince,
  userFacingCount,
  RELIABILITY_LOG,
} from "@/lib/reliability/incidents";

// /status — public status page (V5 W2, 2026-07-03: moved from (app) to
// (marketing) so it gets the editorial article chrome, same public URL).
// Structure:
//   1. Hero banner — color/copy follow overall measured health.
//   2. Per-source 90-day uptime bars (real UptimeBars component; only today
//      is measured, prior days render as explicit no-data grey).
//   3. Alert activity — real by_state counts, rolling 24h.
//   4. Calibration — condensed prose (full per-asset table lived here
//      before; V5 keeps the honest counts, drops the density).
//   5. Incident log — every entry in RELIABILITY_LOG, permanently.
//
// This page moved out of the (app) route group, which means it no longer
// inherits LiveProvider from app/(app)/layout.tsx — so it mounts its own
// LiveProvider here to keep the real WS-heartbeat "Live channel" row
// working (LiveContext already defaults to a safe "disconnected" value
// when unmounted, so this is additive, not a behavior change elsewhere).

const USER_FACING_INCIDENTS = userFacingCount(RELIABILITY_LOG);

interface SourceFreshness {
  sanctum_secs: number | null;
  jupiter_secs: number | null;
  pyth_secs: number | null;
  hylo_secs: number | null;
}

interface ReadyzResp {
  status: "ready" | "not_ready";
  db: boolean;
  redis: boolean;
  last_snapshot_age_secs: number | null;
  sources: SourceFreshness;
}

async function fetchReadyz(): Promise<ReadyzResp> {
  const r = await fetch(`${apiBase()}/readyz`, { cache: "no-store" });
  // /readyz returns HTTP 503 with a useful JSON body when not ready.
  // Discarding that body forced every source row into "Outage" during
  // degraded-but-diagnosable periods. Parse the body regardless of status.
  const body = (await r.json().catch(() => null)) as ReadyzResp | null;
  if (body) return body;
  throw new Error("readyz failed");
}

interface SourceRow {
  key: keyof SourceFreshness;
  name: string;
  role: string;
  cadence: string;
  expectFreshSecs: number;
}

const SOURCES: ReadonlyArray<SourceRow> = [
  {
    key: "sanctum_secs",
    name: "Sanctum",
    role: "LST intrinsic · on-chain stake-pool value",
    cadence: "15s",
    expectFreshSecs: 60,
  },
  {
    key: "jupiter_secs",
    name: "Jupiter",
    role: "Market quote · best route",
    cadence: "30s",
    expectFreshSecs: 120,
  },
  {
    key: "pyth_secs",
    name: "Pyth",
    role: "Live price oracle",
    cadence: "~1s",
    expectFreshSecs: 30,
  },
  {
    key: "hylo_secs",
    name: "Hylo",
    role: "On-chain CR + stability pool",
    cadence: "30s",
    expectFreshSecs: 90,
  },
];

function freshnessState(ageSec: number | null, expect: number): PegState {
  if (ageSec == null) return "UNKNOWN";
  if (ageSec <= expect) return "PEGGED";
  if (ageSec <= expect * 3) return "DRIFT";
  return "DEPEG";
}

const SOURCE_COLUMNS = "210px 1fr 170px";

function SourceRowV2({
  name,
  // Named `sourceRole`, not `role`: a prop literally called `role` on a JSX
  // element reads as the ARIA attribute to a human AND to eslint-jsx-a11y,
  // which flagged "engine -> /v1/ws heartbeat" as an invalid ARIA role.
  sourceRole,
  state,
  detail,
}: {
  name: string;
  sourceRole: string;
  state: PegState;
  detail: string;
}) {
  const samples = useMemo(() => [state], [state]);
  // UNKNOWN needs its OWN branch. Without one it fell through to "Major outage"
  // + the critical colour — so after the delivery row correctly started
  // reporting UNKNOWN for 0 sent / 0 failed, /status painted a red "Major
  // outage" directly beside the words "no deliveries to report (24h)".
  //
  // That is a WORSE failure than the false-green it replaced: 0/0 is the steady
  // state in production, so the page claimed a permanent critical outage that
  // never self-heals. Absence of evidence has to render as absence, in the
  // label and the colour both — the same missing-data-is-not-confirming-data
  // rule the engine enforces (H1-H12).
  const label =
    state === "PEGGED"
      ? "Operational"
      : state === "DRIFT"
        ? "Degraded"
        : state === "DEPEG"
          ? "Outage"
          : state === "UNKNOWN"
            ? "No data"
            : "Major outage";
  const color =
    state === "PEGGED"
      ? "var(--v2-peg)"
      : state === "DRIFT"
        ? "var(--v2-drift)"
        : state === "UNKNOWN"
          ? "var(--v2-unk)"
          : "var(--v2-crit)";
  return (
    <ListRow columns={SOURCE_COLUMNS} className="items-center">
      <span>
        <b className="text-[14.5px] font-medium">{name}</b>
        <br />
        <span className="font-mono text-[11px] text-[var(--v2-muted)]">
          {sourceRole}
        </span>
      </span>
      <UptimeBars samples={samples} />
      <span className="text-right font-mono text-[11.5px] text-[var(--v2-muted)]">
        {detail} <span style={{ color }}>&middot; {label}</span>
      </span>
    </ListRow>
  );
}

function StatusBody() {
  const { data: ready, error: readyErr } = useSWR("readyz", fetchReadyz, {
    refreshInterval: 15_000,
  });
  const { data: stats } = useStats();
  const { data: assets } = useAssets();
  const { data: calibration } = useCalibration();
  const { connected: wsConnected, lastHeartbeatAt } = useLive();

  const since24h = useMemo(
    () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const { data: recentAlerts } = useAlerts({
    since: since24h,
    limit: 100,
    excludePegged: true,
  });

  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const heartbeatAgeSec =
    lastHeartbeatAt != null
      ? Math.max(0, Math.round((now - Date.parse(lastHeartbeatAt)) / 1000))
      : null;

  const calCounts = useMemo(
    () => ({
      miscalibrated:
        calibration?.filter((c) => c.health === "miscalibrated").length ?? 0,
      watch: calibration?.filter((c) => c.health === "watch").length ?? 0,
      ok: calibration?.filter((c) => c.health === "ok").length ?? 0,
    }),
    [calibration],
  );
  const miscalibratedSymbols = useMemo(
    () =>
      (calibration ?? [])
        .filter((c) => c.health === "miscalibrated" || c.health === "watch")
        .map((c) => c.symbol),
    [calibration],
  );

  const snapshotAge = ready?.last_snapshot_age_secs ?? null;

  // "the live leg has not reported yet" is NOT "the live leg is down" — the same
  // missing-data-is-not-confirming-data rule the engine enforces (H1-H12), which
  // this page previously inverted. `wsConnected` is false in the server render and
  // for the first moments after mount, because there is no socket yet. Deriving
  // liveDown from it directly made `overall` resolve to DEPEG and painted
  // "Investigating an outage." at a healthy API for every consumer that does not
  // execute JS: link unfurls, uptime checkers, crawlers, throttled connections.
  // Gate both signals on having actually observed the channel at least once.
  const liveObserved = wsConnected || lastHeartbeatAt != null;
  const liveDegraded =
    liveObserved &&
    (!wsConnected || (heartbeatAgeSec != null && heartbeatAgeSec > 15));
  const liveDown =
    liveObserved &&
    (!wsConnected || (heartbeatAgeSec != null && heartbeatAgeSec > 30));
  const liveState: PegState = !liveObserved
    ? "UNKNOWN"
    : liveDown
      ? "DEPEG"
      : liveDegraded
        ? "DRIFT"
        : "PEGGED";

  const overall: PegState =
    readyErr || liveDown
      ? "DEPEG"
      : !ready
        ? "UNKNOWN"
        : ready.status === "ready" &&
            !liveDegraded &&
            snapshotAge != null &&
            snapshotAge < 60
          ? "PEGGED"
          : ready.status === "ready"
            ? "DRIFT"
            : "DEPEG";

  const last24h = stats?.alerts_24h;
  const totalAssets = stats?.assets_tracked ?? assets?.length;
  const delivery = stats?.delivery_health ?? null;
  // Green only on positive evidence, never on the absence of failure. With zero
  // sent AND zero failed there is nothing to be healthy about — reporting that as
  // operational greenwashed the one subsystem whose track record is unproven.
  const deliveryState: PegState = !delivery
    ? "UNKNOWN"
    : delivery.failed_24h > 0
      ? "DRIFT"
      : delivery.sent_24h > 0
        ? "PEGGED"
        : "UNKNOWN";
  const deliveryDetail = !delivery
    ? "waiting for stats"
    : delivery.sent_24h === 0 && delivery.failed_24h === 0
      ? "no deliveries to report (24h)"
      : `${delivery.sent_24h} sent · ${delivery.failed_24h} failed`;

  const banner = (() => {
    switch (overall) {
      case "PEGGED":
        return { copy: "All systems operational.", color: "var(--v2-peg)" };
      case "DRIFT":
        return {
          copy: "Operating with degraded freshness.",
          color: "var(--v2-drift)",
        };
      case "UNKNOWN":
        return { copy: "Checking systems...", color: "var(--v2-dim)" };
      default:
        return { copy: "Investigating an outage.", color: "var(--v2-depeg)" };
    }
  })();

  const statItems = [
    {
      value: stats?.by_state?.PEGGED ?? "-",
      label: "Pegged",
      color: "var(--v2-peg)",
    },
    {
      value: stats?.by_state?.DRIFT ?? "-",
      label: "Drift",
      color: "var(--v2-drift)",
    },
    {
      value: stats?.by_state?.DEPEG ?? "-",
      label: "Depeg",
      color: "var(--v2-depeg)",
    },
    {
      value: stats?.by_state?.CRITICAL ?? "-",
      label: "Critical",
      color: "var(--v2-crit)",
    },
  ];

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Status"
        h1={
          <>
            <span style={{ color: banner.color }} aria-hidden>
              &#9679;
            </span>{" "}
            {banner.copy}
          </>
        }
        maxWidthCh={24}
        lede="Per-source health for the engine and every oracle it reads, plus a permanent incident log. We publish every issue our own monitoring catches: a watcher you can't audit isn't a watcher."
        meta={[
          snapshotAge != null
            ? `last snapshot ${snapshotAge}s ago`
            : "snapshot pending",
          `tracked ${totalAssets ?? "…"}`,
          `alerts 24h ${last24h ?? "…"}`,
          `api ${ready ? "200 ok" : readyErr ? "err" : "…"}`,
        ]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <h2 className="mb-1.5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Per-source uptime. Last 90 days.
        </h2>
        <p className="v2-in-prose mb-2">
          One bar per day, colored by the state Pegana observed. Earlier days
          show as no-data: we never paint history we didn&apos;t record.
        </p>
        {/* columns passed explicitly: rows here are wrapped in SourceRowV2,
            so ListRowsV2 can't see ListRow's own `columns` prop directly on
            its children to infer the <colgroup> from. */}
        <ListRowsV2
          label="Data source freshness"
          wide
          minWidth={560}
          columns={SOURCE_COLUMNS}
        >
          <SourceRowV2
            name="Live channel"
            sourceRole="engine -> /v1/ws heartbeat"
            state={liveState}
            detail={
              heartbeatAgeSec != null
                ? `${heartbeatAgeSec}s ago`
                : wsConnected
                  ? "waiting"
                  : "-"
            }
          />
          <SourceRowV2
            name="Alert delivery"
            sourceRole="webhook dispatch"
            state={deliveryState}
            detail={deliveryDetail}
          />
          {SOURCES.map((s) => {
            const sourceAge = ready?.sources?.[s.key] ?? null;
            const state = freshnessState(sourceAge, s.expectFreshSecs);
            const detail =
              sourceAge != null
                ? `${sourceAge}s ago · ${s.cadence}`
                : s.cadence;
            return (
              <SourceRowV2
                key={s.name}
                name={s.name}
                sourceRole={s.role}
                state={state}
                detail={detail}
              />
            );
          })}
        </ListRowsV2>

        <hr className="v2-in-hr" />
        <h2 className="mb-4 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Alert activity. Rolling 24h.
        </h2>
        <StatStripV2 items={statItems} />
        {recentAlerts && (
          <p className="mt-3 font-mono text-[12px] text-[var(--v2-muted)]">
            {recentAlerts.length >= 100 ? "100+" : recentAlerts.length}{" "}
            {recentAlerts.length === 1 ? "state transition" : "state transitions"}{" "}
            out of PEGGED in the last 24 hours.
          </p>
        )}

        <hr className="v2-in-hr" />
        <h2 className="mb-3 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Calibration. Are the bands still right?
        </h2>
        <p className="v2-in-prose">
          Each asset&apos;s trailing-8d p95 spread measured against its own
          drift / depeg bands.{" "}
          {calibration && calibration.length > 0 ? (
            <>
              {calCounts.miscalibrated} miscalibrated &middot; {calCounts.watch}{" "}
              watch &middot; {calCounts.ok} ok
              {miscalibratedSymbols.length > 0 && (
                <> ({miscalibratedSymbols.join(", ")})</>
              )}
              .
            </>
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-[14px] w-44 animate-pulse rounded-full align-middle"
              style={{ background: "var(--v2-panel2)" }}
            />
          )}
        </p>
        <p className="v2-in-prose">
          <Link href="/status/calibration">
            See the full per-asset table &rarr;
          </Link>
        </p>

        <hr className="v2-in-hr" />
        <h2 className="mb-3 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Incidents. Permanent log.
        </h2>
        <p className="v2-in-prose">
          {now > 0 && <>{daysSince(LAUNCH_DATE, now)} days since launch. </>}
          <b>
            {USER_FACING_INCIDENTS === 0
              ? "Zero user-facing incidents."
              : `${USER_FACING_INCIDENTS} user-facing incident${USER_FACING_INCIDENTS === 1 ? "" : "s"}.`}
          </b>{" "}
          We still publish every issue our own monitoring caught internally.
        </p>
        {RELIABILITY_LOG_DESC.map((entry) => (
          <IncidentCardV2
            key={entry.id}
            meta={
              <>
                <span>{entry.date}</span>
                <span>{entry.durationLabel}</span>
              </>
            }
            title={entry.title}
            commits={entry.commits}
          >
            <p>{entry.summary}</p>
            <p>
              <b>Detection.</b> {entry.detection}
            </p>
            <p>
              <b>Root cause.</b> {entry.rootCause}
            </p>
            <p>
              <b>The fix.</b> {entry.resolution}
            </p>
          </IncidentCardV2>
        ))}

        <div className="mt-14 flex flex-wrap gap-3.5">
          <PillPrimary href="/audit.xml">Atom feed of transitions</PillPrimary>
          <PillGhost href="/methodology">How states are computed</PillGhost>
        </div>
      </div>
    </main>
  );
}

export default function StatusPage() {
  return (
    <LiveProvider>
      <StatusBody />
    </LiveProvider>
  );
}
