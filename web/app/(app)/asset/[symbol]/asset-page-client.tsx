"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { AssetHeroV2 } from "@/components/organisms/asset-hero-v2";
import { AssetRail } from "@/components/organisms/asset-rail";
import { AssetTabs, type AssetTab } from "@/components/molecules/asset-tabs";
import { EditorialPullquote } from "@/components/molecules/editorial-pullquote";

import { RecoveryConfidence } from "@/components/organisms/recovery-confidence";
import { ExitLiquidity } from "@/components/organisms/exit-liquidity";
import { TimeToRecovery } from "@/components/organisms/time-to-recovery";
import { ComparableEvents } from "@/components/organisms/comparable-events";

// Mechanism / Risk / Identity tabs reuse existing organisms.
import { MechanismFlow } from "@/components/organisms/mechanism-flow";
import { NavBacking } from "@/components/molecules/nav-backing";
import { AlertPolicy } from "@/components/organisms/alert-policy";
import { StateStrip30d } from "@/components/molecules/state-strip-30d";
import { ActivityTimeline } from "@/components/organisms/activity-timeline";
import { PeerComparison } from "@/components/organisms/peer-comparison";
import { SafetyGrade } from "@/components/molecules/safety-grade";
import { SystemicImpact } from "@/components/organisms/systemic-impact";
import { ArbitrageHint } from "@/components/molecules/arbitrage-hint";
import { YieldSource } from "@/components/molecules/yield-source";
import { IdentityRow } from "@/components/molecules/identity-row";
import { AssetActionStrip } from "@/components/molecules/asset-action-strip";
import {
  ShareButton,
  ShareIconButton,
} from "@/components/molecules/share-button";
import { AssetNotFound } from "@/components/molecules/asset-not-found";
import { StaleBanner } from "@/components/molecules/stale-banner";

import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { useAsset } from "@/lib/hooks/use-asset";
import { useAssets } from "@/lib/hooks/use-assets";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useHistory } from "@/lib/hooks/use-history";
import { holderSignedPct, reconcileBps } from "@/lib/api/format";
import { effectiveState } from "@/lib/asset/freshness";
import { AssetStateAnnouncer } from "@/components/atoms/live-state-announcer";
import { thresholdsFor } from "@/lib/alerts/policy";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { spreadSignClass, spreadSignVar } from "@/lib/state-class";
import { cn } from "@/lib/utils/cn";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import {
  IconArrowLeft,
  IconArrowRight,
} from "@/components/atoms/icon-arrow-right";
import type { AssetCardData, PegState } from "@/lib/api/types";
import type {
  AssetChartBucket,
  AssetChartHandle,
  AssetChartMode,
} from "@/components/organisms/asset-chart";
// Pure bucket-window helpers, NOT from asset-chart.tsx itself — that module
// is dynamically imported with ssr:false to keep lightweight-charts off the
// initial payload; a static import from here would defeat that split.
import {
  loadedRangeForBucket,
  readPersistedBucket,
} from "@/lib/asset/chart-bucket";

// Recharts is ~95 KB gzipped; keep it off the initial JS payload.
const AssetChart = dynamic(
  () =>
    import("@/components/organisms/asset-chart").then((m) => ({
      default: m.AssetChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] w-full rounded-[14px] bg-text/[0.015]">
        <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Loading chart…
        </div>
      </div>
    ),
  },
);

// Class label used in the breadcrumb.
const CLASS_LABEL: Record<string, string> = {
  lst: "LSTs",
  stable_fiat: "Stables · fiat",
  stable_cdp: "Stables · CDP",
  stable_dn: "Stables · delta-neutral",
  stable_fx: "Stables · FX",
  stable_rwa: "Stables · RWA",
  stable_yield: "Stables · yield",
  synth_lev: "Synthetic",
};

// Hardcoded issuer-docs map until backend ships a metadata field. Optional;
// rail just omits the link when unknown.
const ISSUER_DOCS: Record<string, string> = {
  jitoSOL: "https://jito.network/docs/jitosol/",
  mSOL: "https://docs.marinade.finance/",
  bSOL: "https://stake.solblaze.org/app/help",
  JupSOL: "https://station.jup.ag/guides/sanctum/jupsol",
  bbSOL:
    "https://www.bybit.com/en/help-center/article/Bybit-Liquid-Staking-Solana",
  INF: "https://learn.sanctum.so/article/9-what-is-inf",
  USDC: "https://www.circle.com/en/usdc",
  USDT: "https://tether.to/en/transparency/",
  PYUSD: "https://www.paxos.com/pyusd/",
  USDS: "https://docs.sky.money/",
  USDe: "https://docs.ethena.fi/",
  sUSDe: "https://docs.ethena.fi/",
  hyUSD: "https://docs.hylo.so/",
  sHYUSD: "https://docs.hylo.so/",
  hyloSOL: "https://docs.hylo.so/",
  "hyloSOL+": "https://docs.hylo.so/",
  xSOL: "https://docs.hylo.so/",
};

export function AssetPageClient({
  fallbackAsset,
}: {
  fallbackAsset?: AssetCardData;
}) {
  return (
    <Suspense fallback={null}>
      <AssetPageInner fallbackAsset={fallbackAsset} />
    </Suspense>
  );
}

function AssetPageInner({ fallbackAsset }: { fallbackAsset?: AssetCardData }) {
  const params = useParams<{ symbol: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Next App Router returns the encoded segment. Decode defensively, then
  // resolve a display-alias URL (e.g. /asset/eHYUSD) back to the DB symbol.
  const symbol = params?.symbol
    ? resolveAliasSymbol(safeDecode(params.symbol))
    : undefined;

  const { data: asset, error, isLoading } = useAsset(symbol ?? null, fallbackAsset);
  const { data: alerts } = useAlerts({ asset: symbol, limit: 60 });
  const { data: peers } = useAssets();

  // Pre-fetch 24h history at page level so the hero KPIs render without
  // waiting for the chart's dynamic import to mount.
  const historyParams = useMemo(
    () => ({
      bucket: "1m" as const,
      from: new Date(Date.now() - 24 * 3600_000).toISOString(),
      limit: 2000,
    }),
    [],
  );
  const { data: history } = useHistory(symbol ?? null, historyParams);

  const activeTab = parseTab(searchParams?.get("tab")) ?? "overview";
  const chartBucket = parseBucket(searchParams?.get("range")) ?? undefined;
  const chartMode = parseMode(searchParams?.get("mode")) ?? undefined;

  const updatePermalink = useCallback(
    (next: {
      tab?: AssetTab;
      range?: AssetChartBucket;
      mode?: AssetChartMode;
    }) => {
      if (!symbol) return;
      const q = new URLSearchParams(searchParams?.toString());
      if (next.tab) q.set("tab", next.tab);
      if (next.range) q.set("range", next.range);
      if (next.mode) q.set("mode", next.mode);
      const query = q.toString();
      router.replace(
        `/asset/${encodeURIComponent(symbol)}${query ? `?${query}` : ""}`,
        { scroll: false },
      );
    },
    [router, searchParams, symbol],
  );

  // Timeline → chart scrub. The activity timeline lives on the History tab;
  // the chart lives on Overview and is UNMOUNTED while History is active (see
  // the tab-panel switch below), so a click there can't drive it directly.
  // Clicking a row instead: (1) pre-checks the target against the chart's
  // CURRENTLY LOADED bucket window (bounded — no fetch expansion), (2) if
  // in range, switches to Overview and hands the freshly-mounted chart an
  // `initialScrub` to apply once its history loads, (3) if out of range,
  // marks the row so it renders an honest "outside loaded range" hint instead
  // of silently doing nothing.
  const chartRef = useRef<AssetChartHandle | null>(null);
  const [scrubbedEventId, setScrubbedEventId] = useState<string | null>(null);
  const [pendingScrub, setPendingScrub] = useState<{
    id: string;
    tsSec: number;
    state: PegState;
  } | null>(null);
  const [outOfRangeId, setOutOfRangeId] = useState<string | null>(null);

  const handleClearScrub = useCallback(() => {
    chartRef.current?.clearScrub();
    setScrubbedEventId(null);
    setPendingScrub(null);
  }, []);

  const handleTimelineScrub = useCallback(
    (id: string, tsSec: number, state: PegState) => {
      if (scrubbedEventId === id) {
        // Second click on the same row — toggle off.
        handleClearScrub();
        return;
      }
      setOutOfRangeId(null);
      const bucket = chartBucket ?? readPersistedBucket();
      const { minSec, maxSec } = loadedRangeForBucket(bucket);
      if (tsSec < minSec || tsSec > maxSec) {
        setOutOfRangeId(id);
        return;
      }
      if (activeTab === "overview" && chartRef.current) {
        // Chart is already mounted — scrub against its REAL loaded time
        // domain (which can be narrower than the theoretical bucket window
        // checked above, e.g. a short-history asset). Only mark the row
        // active on a confirmed scrub; otherwise fall back to the honest
        // out-of-range hint rather than a phantom "active" row with no
        // marker.
        const ok = chartRef.current.scrubTo(tsSec, state);
        if (ok) setScrubbedEventId(id);
        else setOutOfRangeId(id);
        return;
      }
      // Chart isn't mounted yet (we're on another tab) — hand off a pending
      // scrub for it to attempt once it mounts. `handleScrubSettled`
      // reconciles the real outcome, which can still fail even though the
      // pre-check above passed.
      setScrubbedEventId(id);
      setPendingScrub({ id, tsSec, state });
      updatePermalink({ tab: "overview" });
    },
    [
      scrubbedEventId,
      activeTab,
      chartBucket,
      updatePermalink,
      handleClearScrub,
    ],
  );

  const handleScrubSettled = useCallback(
    (ok: boolean) => {
      if (!ok && pendingScrub) {
        setScrubbedEventId(null);
        setOutOfRangeId(pendingScrub.id);
      }
      setPendingScrub(null);
    },
    [pendingScrub],
  );

  // Esc clears an active scrub from anywhere on the page — including while
  // the timeline (not the chart) is the mounted tab.
  useEffect(() => {
    if (!scrubbedEventId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClearScrub();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scrubbedEventId, handleClearScrub]);

  // Mobile-only: a sticky compact header + a sticky bottom CTA both reveal once
  // the hero (symbol + big spread) scrolls out of view, so the answer and the
  // primary action never disappear. Callback ref so the observer attaches the
  // moment the hero node mounts (it only renders after the asset loads).
  const [heroOut, setHeroOut] = useState(false);
  // Callback ref with a React 19 cleanup return: the observer is disconnected
  // when the node detaches or the component unmounts (react-doctor:
  // effect-needs-cleanup — the old disconnect-on-next-call form was correct but
  // the return form is the idiomatic, lint-clean one).
  const heroRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => setHeroOut(!entry.isIntersecting),
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Hide the sticky bottom CTA once the footer scrolls into view, so it never
  // covers the footer. The footer lives in the (app) shell BELOW this page, so
  // we observe it directly by query rather than via a ref.
  const [nearBottom, setNearBottom] = useState(false);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const io = new IntersectionObserver(
      ([entry]) => setNearBottom(entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  // Page-level clock so the freshness gate (`effectiveState` below) re-checks
  // staleness on its own cadence instead of only when SWR happens to
  // revalidate. Mirrors the rail's internal 30s tick (asset-rail.tsx).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading || !symbol) {
    return (
      <main className="mx-auto max-w-[1440px] px-5 sm:px-6">
        <div className="pt-5 sm:pt-6">
          <div className="h-4 w-48 animate-pulse rounded-full bg-text/[0.06]" />
        </div>
        <section className="mt-4 grid gap-8 pb-12 sm:mt-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:pb-16">
          <div className="space-y-4">
            <div className="h-20 animate-pulse rounded-[16px] bg-text/[0.04]" />
            <div className="h-14 animate-pulse rounded-[14px] bg-text/[0.04]" />
            <div className="h-14 animate-pulse rounded-[14px] bg-text/[0.04]" />
          </div>
          <div className="h-64 animate-pulse rounded-[16px] bg-text/[0.04]" />
        </section>
        <div className="h-10 animate-pulse rounded-[8px] bg-text/[0.04]" />
        <section className="py-10 pb-24 sm:py-12 sm:pb-32">
          <div className="h-[320px] w-full rounded-[14px] bg-text/[0.03]" />
        </section>
      </main>
    );
  }

  if (error || !asset) {
    const status = (error as { status?: number } | undefined)?.status;
    const apiUnreachable = !!error && status !== 404;
    return (
      <>
        <main>
          <AssetNotFound symbol={symbol} apiUnreachable={apiUnreachable} />
        </main>
      </>
    );
  }

  // Leveraged synths (synth_lev, e.g. xSOL) are removed from the public peg-risk
  // surface — they have no peg, so a peg-verdict detail page reads as broken to
  // due-diligence reviewers (a leveraged junior tranche trades 60-85% off its own
  // NAV by design; "market vs intrinsic" is a leverage premium, not peg risk).
  // The API still returns the asset (so we can read its class here); the board,
  // screener, and aggregates already drop it. Analysis: xSOL keep/remove,
  // 2026-07-23. Show the not-found surface rather than a nonsensical peg page.
  if (asset.class === "synth_lev") {
    return (
      <>
        <main>
          <AssetNotFound symbol={symbol} apiUnreachable={false} />
        </main>
      </>
    );
  }

  const spread = reconcileBps(asset);
  const bps = spread.bps;
  // H1/H9 freshness gate: no `useLive()` WS frame exists for this page today,
  // so `live` is undefined — effectiveState degrades a stale REST snapshot to
  // UNKNOWN using `now` (ticked above), matching the dashboard's gating and
  // keeping this state consistent with StaleBanner's own staleness check.
  const state = effectiveState(undefined, asset, now);
  // Window-scoped alert slices. The alerts hook returns the last 60 events
  // regardless of age, so a raw .length would misrepresent a windowed count
  // for low-volatility assets with a long tail.
  //   - alerts7d feeds RecoveryConfidence (a genuinely 7-day view).
  //   - flips24h drives the rail's Health block, whose other KPIs (time
  //     pegged, median/worst spread) are computed from the 24h `history`
  //     above — so the whole block is honestly a 24h health snapshot.
  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const alerts7d = alerts?.filter(
    (a) => new Date(a.detected_at).getTime() >= sevenDaysAgo,
  );
  const oneDayAgo = Date.now() - 24 * 3600_000;
  const flips24h =
    alerts?.filter((a) => new Date(a.detected_at).getTime() >= oneDayAgo)
      .length ?? 0;

  return (
    <>
      <StaleBanner
        symbol={asset.symbol}
        updatedAt={asset.updated_at}
        assetClass={asset.class}
      />
      {/* Announce peg-state transitions to screen readers. /dashboard has had
          this since the a11y pass; this page did not, and it is where an
          analyst tracking one exposure actually sits. Colour + a pill were the
          only cues for a PEGGED->DEPEG flip. */}
      <AssetStateAnnouncer symbol={displaySymbol(asset.symbol)} state={state} />
      <main className="mx-auto max-w-[1440px] px-5 sm:px-6">
        {/* Mobile sticky header — keeps symbol + state + live spread on screen
            once the hero scrolls away; desktop relies on the sticky rail. */}
        <div
          className={cn(
            // fixed (not sticky) — an ancestor `overflow-x: hidden` on <body>
            // kills position:sticky here, and the bottom CTA already proves fixed
            // works. Slides down from the top once the hero leaves view.
            "fixed inset-x-0 top-0 z-40 border-b border-hairline bg-canvas/95 px-5 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-[opacity,transform] duration-200 lg:hidden",
            heroOut
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-full opacity-0",
          )}
        >
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <TokenIcon
                mint={asset.mint}
                symbol={displaySymbol(asset.symbol)}
                klass={asset.class}
                size={22}
              />
              <StatePip
                state={state}
                size={7}
                pulse={state !== "PEGGED" && state !== "UNKNOWN"}
                announce
              />
              <span className="truncate font-mono text-[15px] font-medium text-text">
                {displaySymbol(asset.symbol)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span
                className={cn(
                  "font-mono text-[15px] font-medium tabular-nums",
                  spreadSignClass(bps),
                )}
              >
                {bps != null ? holderSignedPct(bps) : "-"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
                {state.toLowerCase().replace("_", " ")}
              </span>
              {/* Compact copy-link — the only share affordance on phones; the
                  full two-pill ShareButton is sm:-gated on the breadcrumb row. */}
              <ShareIconButton symbol={asset.symbol} />
            </div>
          </div>
        </div>

        {/* Breadcrumb + share */}
        <div className="flex items-center justify-between gap-3 pt-5 sm:pt-6">
          <nav
            className="flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-[0.04em] text-text-caption"
            aria-label="Breadcrumb"
          >
            <Link
              href="/dashboard"
              // Pops back out of the drill-in: content slides right, the
              // mirror of the nav-forward that got the user here.
              data-vt="nav-back"
              className="inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-text"
            >
              <IconArrowLeft size={10} /> Dashboard
            </Link>
            <span className="opacity-50">/</span>
            <span>{CLASS_LABEL[asset.class] ?? asset.class}</span>
            <span className="opacity-50">/</span>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-text">
              <TokenIcon
                mint={asset.mint}
                symbol={displaySymbol(asset.symbol)}
                klass={asset.class}
                size={14}
              />
              <span className="truncate">{displaySymbol(asset.symbol)}</span>
            </span>
          </nav>
          <ShareButton
            symbol={asset.symbol}
            state={state}
            bps={bps}
            className="hidden shrink-0 sm:flex"
          />
        </div>

        {/* Above-fold: main column + sticky right rail */}
        <section className="mt-4 grid gap-8 pb-12 sm:mt-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:pb-16">
          <div ref={heroRef}>
            <AssetHeroV2
              asset={asset}
              bps={bps}
              state={state}
              history={history ?? undefined}
              editorial={
                <DerivedEditorial asset={asset} bps={bps} state={state} />
              }
            />
          </div>
          <div className="lg:sticky lg:top-6 lg:self-start">
            <AssetRail
              asset={asset}
              bps={bps}
              state={state}
              history={history ?? undefined}
              stateFlips={flips24h}
              issuerDocsHref={ISSUER_DOCS[asset.symbol]}
            />
          </div>
        </section>

        {/* Tabs. `id` is the scroll target for the hero's "Verified state
            history" link — a query-only tab switch doesn't move the viewport,
            so without this the link silently activated the History tab ~1000px
            below the fold and read as broken, esp. on mobile (QA 2026-07-23). */}
        <div id="asset-tabs" className="scroll-mt-16">
          <AssetTabs
            active={activeTab}
            onChange={(tab) => updatePermalink({ tab })}
          />
        </div>

        {/* Tab panels */}
        <section
          role="tabpanel"
          id="asset-tabpanel"
          aria-labelledby={`asset-tab-${activeTab}`}
          tabIndex={0}
          className="py-8 pb-20 outline-none sm:py-12 sm:pb-32"
        >
          {activeTab === "overview" && (
            <div className="flex flex-col gap-6 sm:gap-8">
              <div className="rounded-[20px] border border-hairline bg-surface-1 p-3 sm:p-5">
                <AssetChart
                  ref={chartRef}
                  symbol={asset.symbol}
                  thresholds={thresholdsFor(
                    asset.symbol,
                    asset.class,
                    asset.thresholds,
                  )}
                  directionSensitive={isDirectionSensitiveClass(asset.class)}
                  pegTarget={asset.peg_target}
                  alerts={alerts}
                  bucket={chartBucket}
                  mode={chartMode}
                  onBucketChange={(range) => updatePermalink({ range })}
                  onModeChange={(mode) => updatePermalink({ mode })}
                  initialScrub={pendingScrub}
                  onScrubSettled={handleScrubSettled}
                  onScrubCleared={() => setScrubbedEventId(null)}
                />
              </div>
              <RecoveryConfidence
                asset={asset}
                history={history ?? undefined}
                alerts={alerts7d}
                peers={peers}
                state={state}
              />
              <ExitLiquidity asset={asset} state={state} />
              <SystemicImpact asset={asset} />
              <ArbitrageHint
                symbol={asset.symbol}
                intrinsicUsd={asset.intrinsic_usd}
                marketUsd={asset.market_usd}
                discountBps={bps}
                state={state}
                klass={asset.class}
              />
            </div>
          )}

          {activeTab === "history" && (
            <div className="flex flex-col gap-6 sm:gap-8">
              {/* State timeline leads as the tab's anchor visual — the "what
                  happened at a glance" band — with the row-level detail
                  (recovery, comparable events, activity) drilling in below
                  (research F5, 2026-07-16 — Nansen/Solscan lead history tabs
                  with a density strip, not a bare table). */}
              <StateStrip30d symbol={asset.symbol} />
              <TimeToRecovery alerts={alerts} />
              <ComparableEvents
                alerts={alerts}
                symbol={asset.symbol}
                klass={asset.class}
                apiThresholds={asset.thresholds}
              />
              <ActivityTimeline
                alerts={alerts}
                onScrub={handleTimelineScrub}
                scrubbedId={scrubbedEventId}
                outOfRangeId={outOfRangeId}
              />
            </div>
          )}

          {activeTab === "mechanism" && (
            <div className="flex flex-col gap-6 sm:gap-8">
              <NavBacking asset={asset} />
              <MechanismFlow asset={asset} spread={spread} />
              <AlertPolicy asset={asset} />
              {asset.class === "stable_yield" && (
                <YieldSource symbol={asset.symbol} />
              )}
            </div>
          )}

          {activeTab === "risk" && (
            <div className="flex flex-col gap-6 sm:gap-8">
              <SafetyGrade asset={asset} />
              <PeerComparison asset={asset} />
            </div>
          )}

          {activeTab === "identity" && (
            <div className="flex flex-col gap-6 sm:gap-8">
              <IdentityRow asset={asset} />
              <AssetActionStrip asset={asset} />
            </div>
          )}

          {/* Trust cross-links — the asset page previously linked to neither
              the verifiable audit trail nor the methodology (finding #8).
              Rendered below the active tab's content on every tab. */}
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hairline pt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted sm:mt-12">
            <Link
              href={`/audit?asset=${encodeURIComponent(asset.symbol)}`}
              className="inline-flex items-center gap-1.5 transition-colors duration-300 hover:text-text"
            >
              Verifiable receipts for {displaySymbol(asset.symbol)}
              <IconArrowRight size={11} />
            </Link>
            <Link
              href="/methodology"
              className="inline-flex items-center gap-1.5 transition-colors duration-300 hover:text-text"
            >
              How Pegana classifies pegs
              <IconArrowRight size={11} />
            </Link>
          </div>
        </section>
      </main>

      {/* Sticky bottom CTA — thumb-reachable peg-alert subscribe; solid V5
          primary pill, revealed once the hero leaves. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md transition-[opacity,transform] duration-200 lg:hidden",
          heroOut && !nearBottom
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        <Link
          href="/events"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-text px-6 py-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-canvas transition-colors duration-300 hover:bg-text/85"
        >
          Follow live transitions <IconArrowRight size={13} />
        </Link>
      </div>
    </>
  );
}

/** Editorial copy derived from the asset's current numbers — used as the
 *  default body of the "What we think" pullquote in the hero. */
function DerivedEditorial({
  asset,
  bps,
  state,
}: {
  asset: AssetCardData;
  bps: number | null;
  state: PegState;
}) {
  // Display-only: the verdict prose shows the user-facing symbol (eHYUSD),
  // never the raw DB key. DerivedEditorial is pure narration — `sym` is used
  // only inside sentences, so wrapping it here is safe. (1:1 live-DOM catch:
  // the relabel pass missed this dynamic site — the grep-guard can't see it.)
  const sym = displaySymbol(asset.symbol);
  // MUST go through holderSignedPct — `bps` is the raw premium-NEGATIVE
  // methodology sign, and every other number on this page (hero at :437, rail,
  // 24h range, worst spread) is holder-signed. Building the sign locally made the
  // editorial contradict the hero on all 68 assets in both directions: jitoSOL
  // read "+0.07% … discount" against a −0.07% hero, hyUSD read "−0.02%" against a
  // +0.02% premium rail. This also inherits formatGap's magnitude-adaptive
  // precision, so tiny and large spreads no longer disagree with the hero either.
  // The premium/discount WORD below is correct as-is: raw bps < 0 ⟺ premium.
  const spreadStr = holderSignedPct(bps);
  // The sentence is prose, but this number is the SAME number as the 104px hero
  // directly above it, so it cannot be a different colour — that on-page
  // contradiction is what prompted the sign-colour standard in the first place.
  // Deliberately NOT applied to the synth_lev branch below: that one prints a
  // magnitude with no sign ("2.31% above NAV"), and an unsigned number stays
  // neutral (same rule as the rail's abs-valued "median spread").
  // Inline, not a class: EditorialPullquote defaults its numbers with
  // `[&_[data-num]]:text-text`, a descendant selector (0,2,0) that outranks any
  // utility class on the span itself (0,1,0). The class was applied and simply
  // lost — the number kept rendering white. spreadSignVar exists for exactly
  // this (inline style / SVG), and an inline colour is the one thing that beats
  // the wrapper without touching the other pullquotes that rely on the default.
  const numColor = spreadSignVar(bps);
  // Leveraged tokens (synth_lev, e.g. xSOL) have NO peg — they trade at a
  // premium/discount to NAV by design. Never describe them with peg language
  // ("drifting toward a depeg"); a premium is leverage demand, the risk signal
  // is a sustained discount.
  if (asset.class === "synth_lev") {
    const isPremium = bps != null && bps < 0;
    const magStr = bps != null ? `${(Math.abs(bps) / 100).toFixed(2)}%` : "-";
    return (
      <>
        {sym} is a <strong>leveraged token</strong>. No peg, so it trades at a
        premium or discount to NAV by design. It&rsquo;s currently{" "}
        <strong>
          <span data-num>{magStr}</span>
        </strong>{" "}
        {isPremium ? "above" : "below"} NAV.{" "}
        {isPremium
          ? "A premium is leverage demand, not stress. The signal to watch is a sustained discount, not this."
          : "A discount to NAV is the one to watch. It can mean exit or redemption friction."}
      </>
    );
  }
  if (state === "PEGGED") {
    return (
      <>
        {sym} is <strong>pegged</strong>. The current{" "}
        <strong>
          <span data-num style={{ color: numColor }}>
            {spreadStr}
          </span>
        </strong>{" "}
        spread sits inside Pegana&rsquo;s drift threshold. Treat it as normal
        secondary-market{" "}
        {bps != null && bps < 0 ? "premium over" : "discount against"}{" "}
        intrinsic.
      </>
    );
  }
  if (state === "DRIFT") {
    return (
      <>
        {sym} is <strong>drifting</strong> at{" "}
        <strong>
          <span data-num style={{ color: numColor }}>
            {spreadStr}
          </span>
        </strong>{" "}
        from intrinsic. Below the depeg threshold but worth watching for
        sustained widening.
      </>
    );
  }
  if (state === "DEPEG" || state === "CRITICAL" || state === "BLACK_SWAN") {
    return (
      <>
        {sym} is <strong>out of band</strong> at{" "}
        <strong>
          <span data-num style={{ color: numColor }}>
            {spreadStr}
          </span>
        </strong>
        . Cross-reference with peers and the recovery distribution below before
        sizing any trade.
      </>
    );
  }
  return (
    <>
      {sym} state is currently <strong>unknown</strong>. Pegana&rsquo;s engine
      is waiting on a fresh sample.
    </>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseTab(raw: string | null | undefined): AssetTab | null {
  return raw === "overview" ||
    raw === "history" ||
    raw === "mechanism" ||
    raw === "risk" ||
    raw === "identity"
    ? raw
    : null;
}

function parseBucket(raw: string | null | undefined): AssetChartBucket | null {
  return raw === "1h" || raw === "24h" || raw === "7d" || raw === "30d"
    ? raw
    : null;
}

function parseMode(raw: string | null | undefined): AssetChartMode | null {
  return raw === "baseline" ||
    raw === "area" ||
    raw === "line" ||
    raw === "candle" ||
    raw === "legs"
    ? raw
    : null;
}

// `EditorialPullquote` is re-exported here so dev tools can grep for it from
// the page file when debugging tab/copy issues — no runtime effect.
export { EditorialPullquote };
