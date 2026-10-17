"use client";

import { useCallback, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { StatePip } from "@/components/atoms/state-pip";
import { TokenIcon } from "@/components/atoms/token-icon";
import {
  IconArrowRight,
  IconArrowUpRight,
} from "@/components/atoms/icon-arrow-right";
import { cardSurface } from "@/components/atoms/surface-card";
import { AssetPicker } from "@/components/molecules/asset-picker";
import { SparklineCell } from "@/components/molecules/sparkline-cell";
import { PillTabs } from "@/components/molecules/pill-tabs";
import { useAssets } from "@/lib/hooks/use-assets";
import { useWatchlist } from "@/lib/store/watchlist";
import { spreadSignClass } from "@/lib/state-class";
import { stateMeta } from "@/lib/asset/state-meta";
import { seriesColor } from "@/lib/compare/series-colors";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  reconcileBps,
  formatGap,
  formatUsdValue,
  isLowLiquidity,
  safetyGrade,
  safetyTotalGrade,
} from "@/lib/api/format";
import type { AssetCardData, PegState } from "@/lib/api/types";

const CompareChart = dynamic(
  () =>
    import("@/components/organisms/compare-chart").then((m) => ({
      default: m.CompareChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const MAX = 4;

const MAJOR_LSTS = ["jitoSOL", "mSOL", "bSOL", "JupSOL"];

const PRESETS: ReadonlyArray<{
  label: string;
  pick: (assets: AssetCardData[]) => string[];
}> = [
  {
    label: "Major LSTs",
    pick: (assets) =>
      assets
        .filter((a) => ["jitoSOL", "mSOL", "bSOL", "JupSOL"].includes(a.symbol))
        .map((a) => a.symbol),
  },
  {
    label: "USD stables",
    pick: (assets) =>
      assets
        .filter((a) => ["USDC", "USDT", "PYUSD", "USDS"].includes(a.symbol))
        .map((a) => a.symbol),
  },
  {
    label: "Hylo stack",
    pick: (assets) =>
      assets
        .filter((a) =>
          ["hyUSD", "sHYUSD", "xSOL", "hyloSOL"].includes(a.symbol),
        )
        .map((a) => a.symbol),
  },
];

function ComparePageBody() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: assets, error, mutate } = useAssets();
  const { symbols: watch, add: addToWatchlist } = useWatchlist();
  const [hours, setHours] = useState<24 | 168 | 720>(24);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pngExportTick, setPngExportTick] = useState(0);

  // Distinguishes "backend unreachable" from "nothing selected yet" — a hard
  // API failure has no cached `data`, so without this a failed fetch would
  // silently render as an empty compare (or worse, drop a populated `?s=`
  // selection down to "No assets selected", masking the outage as user
  // intent). Mirrors /assets and /dashboard's `!!error && !data` gate.
  const backendDown = !!error && !assets;

  // URL-driven selection: ?s=A,B,C,D
  const requested = useMemo(() => {
    const s = params?.get("s");
    if (!s) return [];
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, MAX);
  }, [params]);

  // Only the symbols the live universe actually has. `requested` is raw URL
  // input, and counting it made the page contradict itself: /compare?s=BOGUS
  // rendered "1/4 selected" and "NO ASSETS SELECTED" in the same viewport,
  // because the counter read the URL while the board read resolved assets.
  //
  // While `assets` is still loading the universe is unknown, so nothing is
  // dropped — otherwise a real selection would flash 0/4 on every load.
  // Matching is case-insensitive because a hand-typed or shared link often is.
  const selected = useMemo(() => {
    if (!assets) return requested;
    const bySymbol = new Map(assets.map((a) => [a.symbol.toLowerCase(), a.symbol]));
    return requested
      .map((sym) => bySymbol.get(sym.toLowerCase()))
      .filter((sym): sym is string => sym != null);
  }, [requested, assets]);

  // Named so the reader is told their link was partly ignored rather than
  // silently served a shorter comparison than they asked for.
  const dropped = useMemo(
    () =>
      assets
        ? requested.filter(
            (sym) => !selected.some((s) => s.toLowerCase() === sym.toLowerCase()),
          )
        : [],
    [requested, selected, assets],
  );

  const setSelected = (next: string[]) => {
    const q = next.slice(0, MAX).join(",");
    router.replace(q ? `/compare?s=${encodeURIComponent(q)}` : "/compare");
  };

  const selectedAssets: AssetCardData[] = useMemo(() => {
    if (!assets) return [];
    const map = new Map(assets.map((a) => [a.symbol, a]));
    return selected
      .map((s) => map.get(s))
      .filter((a): a is AssetCardData => !!a);
  }, [assets, selected]);

  // Comparison summary across the current selection.
  const summary = useMemo(() => {
    if (selectedAssets.length < 2) return null;
    const withBps = selectedAssets
      .map((a) => ({ a, bps: reconcileBps(a).bps }))
      .filter((x): x is { a: AssetCardData; bps: number } => x.bps != null);
    if (withBps.length === 0) return null;
    const sorted = [...withBps].sort(
      (p, q) => Math.abs(p.bps) - Math.abs(q.bps),
    );
    const tightest = sorted[0];
    const widest = sorted[sorted.length - 1];
    const minBps = Math.min(...withBps.map((x) => x.bps));
    const maxBps = Math.max(...withBps.map((x) => x.bps));
    const spreadBetween = maxBps - minBps;
    return { tightest, widest, spreadBetween, minBps, maxBps };
  }, [selectedAssets]);

  // Presets — use known canonical picks when the API is unavailable so the
  // URL/share contract still works during calibration or rate-limit fallback.
  const availablePresets = useMemo(() => {
    if (!assets) {
      return [{ label: "Major LSTs", picks: MAJOR_LSTS }];
    }
    const computed = [
      {
        label: "Widest now",
        picks: assets
          .map((a) => ({ symbol: a.symbol, bps: reconcileBps(a).bps }))
          .filter((x): x is { symbol: string; bps: number } => x.bps != null)
          .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps))
          .slice(0, MAX)
          .map((x) => x.symbol),
      },
      {
        label: "Drifting",
        picks: assets
          .filter(
            (a) => a.state && a.state !== "PEGGED" && a.state !== "UNKNOWN",
          )
          .sort(
            (a, b) =>
              Math.abs(reconcileBps(b).bps ?? 0) -
              Math.abs(reconcileBps(a).bps ?? 0),
          )
          .slice(0, MAX)
          .map((a) => a.symbol),
      },
    ];
    const resolved: Array<{ label: string; picks: string[] }> = [
      ...computed,
      ...PRESETS.map((p) => ({ label: p.label, picks: p.pick(assets) })),
    ].filter((p) => p.picks.length >= 2);
    return resolved.length > 0
      ? resolved
      : [{ label: "Major LSTs", picks: MAJOR_LSTS }];
  }, [assets]);

  const shareCompare = useCallback(async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt("Copy compare link", href);
    }
  }, []);

  const exportCsv = useCallback(() => {
    if (selectedAssets.length === 0) return;
    const rows = [
      [
        "symbol",
        "state",
        "spread_bps",
        "intrinsic_usd",
        "market_usd",
        "updated_at",
      ],
      ...selectedAssets.map((a) => {
        // Holder convention: reconcileBps().bps is raw-API-signed (positive =
        // discount, negative = premium) — negate so the exported column
        // matches what the UI shows (+ = premium, − = discount).
        const bps = reconcileBps(a).bps;
        return [
          a.symbol,
          a.state ?? "UNKNOWN",
          String(bps != null ? -bps : ""),
          a.intrinsic_usd ?? "",
          a.market_usd ?? "",
          a.updated_at ?? "",
        ];
      }),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(
      csv,
      `pegana-compare-${selected.join("-")}.csv`,
      "text/csv;charset=utf-8",
    );
  }, [selected, selectedAssets]);

  const handlePng = useCallback(
    (dataUrl: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `pegana-compare-${selected.join("-") || "chart"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [selected],
  );

  // Branded share-card PNG — distinct from `handlePng`'s raw chart-canvas
  // export above. Server-rendered by the /compare/share Route Handler (mark +
  // wordmark + per-asset holder-signed spread), so this just points a
  // temporary anchor at it and lets the browser download the response.
  // Only meaningful once at least one asset is selected.
  const handleCard = useCallback(() => {
    if (selected.length === 0) return;
    const href = `/compare/share?s=${encodeURIComponent(selected.join(","))}`;
    const a = document.createElement("a");
    a.href = href;
    a.download = `pegana-compare-${selected.map(displaySymbol).join("-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [selected]);

  return (
    <>
      <main className="mx-auto max-w-[1280px] px-5 pt-10 sm:px-8 sm:pt-14 lg:px-12 lg:pb-24 xl:px-20">
        {" "}
        {/* pb handled by app layout on mobile; explicit on desktop */}
        {/* Compact app-density PageHero — eyebrow + title + one-line lede +
            mono meta row. Same V5 language as /assets (DESIGN.md governs the
            marketing hero separately). */}
        <section className="pb-7 sm:pb-9">
          <span className="mb-3 inline-flex rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
            Compare
          </span>
          <h1 className="max-w-[46ch] text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
            Stack assets. Spot drifts.
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-text-body sm:text-[15px]">
            Overlay the spread history of up to four assets. Pick between
            equivalents (jitoSOL vs mSOL), watch correlated pairs under stress
            (USDC vs USDT), or stack a whole protocol (Hylo&apos;s hyUSD /
            eHYUSD / xSOL).
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-text-caption">
            <span>
              {selected.length}/{MAX} selected
            </span>
            {dropped.length > 0 && (
              <span className="text-st-drift">
                {dropped.join(", ")} not tracked
              </span>
            )}
            {summary && (
              <span>
                spread band{" "}
                <span className="text-text">
                  {(summary.spreadBetween / 100).toFixed(2)}%
                </span>{" "}
                across the set
              </span>
            )}
          </div>
        </section>

        {/* Backend unreachable — distinct from "nothing selected yet": a hard
            API failure has no cached `data`, so the picker/presets/summary/
            chart below (all derived from `assets`) would otherwise render as
            a silently blank compare, or drop a populated `?s=` URL selection
            down to "No assets selected". Mirrors /assets, /dashboard and
            /events' `!!error && !data` gate. */}
        {backendDown && <CompareBackendDown onRetry={() => mutate()} />}

        {!backendDown && (
          <>
            {/* Selection control bar */}
            <section className="border-t border-hairline py-6">
              <div className="flex flex-wrap items-center gap-3">
                {/* Selected as removable pills */}
                {selectedAssets.length > 0 ? (
                  <ul className="flex flex-wrap items-center gap-1.5">
                    {selectedAssets.map((a, i) => (
                      <li key={a.symbol}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected(selected.filter((s) => s !== a.symbol))
                          }
                          className="group inline-flex items-center gap-2 rounded-full border border-outline px-3 py-[6px] font-mono text-[11px] transition-colors duration-300 hover:border-text hover:bg-text/[0.04]"
                          aria-label={`Remove ${displaySymbol(a.symbol)} from compare`}
                        >
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: seriesColor(i) }}
                          />
                          <span className="text-text">
                            {displaySymbol(a.symbol)}
                          </span>
                          <span className="text-text-muted/60 group-hover:text-text">
                            ×
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                    No assets selected
                  </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {assets && (
                    <AssetPicker
                      assets={assets}
                      selected={selected}
                      onChange={setSelected}
                      max={MAX}
                    />
                  )}
                  {selectedAssets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected([])}
                      className="rounded-full border border-outline px-3 py-[6px] font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:bg-text/[0.04] hover:text-text"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Presets */}
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                  Presets
                </span>
                {availablePresets.map((p) => {
                  const isActive =
                    p.picks.length === selected.length &&
                    p.picks.every((s) => selected.includes(s));
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setSelected(p.picks.slice(0, MAX))}
                      className={cn(
                        "rounded-full border px-3 py-[6px] font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-300",
                        isActive
                          ? "border-text bg-text text-canvas"
                          : "border-outline text-text-muted hover:border-text hover:bg-text/[0.04] hover:text-text",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
                {watch.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => setSelected(watch.slice(0, MAX))}
                    className={cn(
                      "rounded-full border px-3 py-[6px] font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-300",
                      selected.length === Math.min(watch.length, MAX) &&
                        watch.slice(0, MAX).every((s) => selected.includes(s))
                        ? "border-text bg-text text-canvas"
                        : "border-outline text-text-muted hover:border-text hover:bg-text/[0.04] hover:text-text",
                    )}
                  >
                    My watchlist ({watch.length})
                  </button>
                )}
              </div>
            </section>

            {/* Empty-state: faint chart preview + prompt overlay */}
            {selected.length === 0 && (
              <section className="border-t border-hairline py-10 sm:py-12">
                <div className="relative min-h-[540px]">
                  {/* Faint ghost chart — real data, 30% opacity, not interactive */}
                  <div className="opacity-50 pointer-events-none select-none">
                    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                      <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        Spread overlay
                      </h2>
                    </div>
                    <CompareChart symbols={MAJOR_LSTS} hours={24} preview />
                  </div>
                  {/* Prompt overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[16px] bg-canvas/60 px-6 text-center backdrop-blur-[2px]">
                    <b className="text-2xl font-normal text-text">
                      Pick a preset or add assets to begin.
                    </b>
                    <p className="max-w-[380px] text-sm text-text-body leading-[1.5]">
                      The chart above is a faint preview of{" "}
                      <span className="text-text">Major LSTs</span>. Click any
                      preset to lock it in, or use the picker to build your own
                      stack of up to 4 assets.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelected(MAJOR_LSTS)}
                      className="inline-flex items-center gap-2 rounded-full bg-text px-6 py-3 font-mono text-[12px] uppercase tracking-[0.06em] text-canvas font-semibold transition-colors duration-300 hover:bg-text/85"
                    >
                      Try &ldquo;Major LSTs&rdquo;
                      <IconArrowRight size={11} />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Comparison summary */}
            {summary && (
              <section className="border-t border-hairline py-8">
                <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  Snapshot
                </h2>
                <dl className="grid gap-x-8 gap-y-4 font-mono text-[12px] sm:grid-cols-3">
                  <Stat
                    label="Tightest now"
                    value={
                      <Link
                        href={`/asset/${summary.tightest.a.symbol}`}
                        className="hover:underline underline-offset-4"
                      >
                        <span className="text-text">
                          {displaySymbol(summary.tightest.a.symbol)}
                        </span>{" "}
                        {/* Holder convention: summary.*.bps is raw-API-signed
                            (positive = discount, negative = premium) — negate
                            for display so `+` = premium, `−` = discount. */}
                        <span className={spreadSignClass(summary.tightest.bps)}>
                          {formatGap(-summary.tightest.bps)}
                        </span>
                      </Link>
                    }
                  />
                  <Stat
                    label="Widest now"
                    value={
                      <Link
                        href={`/asset/${summary.widest.a.symbol}`}
                        className="hover:underline underline-offset-4"
                      >
                        <span className="text-text">
                          {displaySymbol(summary.widest.a.symbol)}
                        </span>{" "}
                        {/* Was a third, magnitude-based scheme (>300bps red,
                            >30bps amber). Retired 2026-08-10: it made the SAME
                            number amber here and green on /dashboard. "Widest"
                            is already stated by the label — the number itself
                            only has to answer premium-or-discount. */}
                        <span className={spreadSignClass(summary.widest.bps)}>
                          {formatGap(-summary.widest.bps)}
                        </span>
                      </Link>
                    }
                  />
                  <Stat
                    label="Range across selection"
                    value={
                      <span>
                        {/* minBps/maxBps are raw-API-signed; negated and
                            swapped so the pair still reads ascending
                            left-to-right under the holder-signed convention
                            (most-discount … most-premium). */}
                        <span className={spreadSignClass(summary.maxBps)}>
                          {formatGap(-summary.maxBps)}
                        </span>
                        <span className="mx-1 text-text-muted/40">…</span>
                        <span className={spreadSignClass(summary.minBps)}>
                          {formatGap(-summary.minBps)}
                        </span>
                        <span className="ml-2 text-text">
                          band {(summary.spreadBetween / 100).toFixed(2)}%
                        </span>
                      </span>
                    }
                  />
                </dl>
              </section>
            )}

            {/* Overlay chart */}
            {selectedAssets.length > 0 && (
              <section className="border-t border-hairline py-10 sm:py-12">
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    Spread overlay
                  </h2>
                  {/* V5 pill-tab tracks — same idiom as asset-chart's
                  SegmentedButtons (rounded-full border p-1, active bg-text). */}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-hairline p-1">
                      <button
                        type="button"
                        onClick={shareCompare}
                        aria-label="Copy link"
                        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors duration-200 hover:text-text"
                      >
                        <span aria-hidden="true">
                          {copied ? "Copied" : "Copy link"}
                        </span>
                      </button>
                      <span
                        role="status"
                        aria-live="polite"
                        className="sr-only"
                      >
                        {copied ? "Link copied" : ""}
                      </span>
                      <button
                        type="button"
                        onClick={exportCsv}
                        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors duration-200 hover:text-text"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => setPngExportTick((n) => n + 1)}
                        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors duration-200 hover:text-text"
                      >
                        PNG
                      </button>
                      <button
                        type="button"
                        onClick={handleCard}
                        className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors duration-200 hover:text-text"
                      >
                        CARD
                      </button>
                    </div>
                    <PillTabs
                      ariaLabel="Chart range"
                      value={String(hours)}
                      onChange={(k) => setHours(Number(k) as 24 | 168 | 720)}
                      items={[
                        { key: "24", label: "24h" },
                        { key: "168", label: "7d" },
                        { key: "720", label: "30d" },
                      ]}
                    />
                  </div>
                </div>
                <CompareChart
                  symbols={selected}
                  hours={hours}
                  exportKey={pngExportTick}
                  onExportPng={handlePng}
                />
              </section>
            )}

            {/* Add the compared set to the watchlist. Writes through the real
            `useWatchlist` store (`pegana.watchlist.v1`) that the dashboard
            Watchlist view + peek-pane Pin read — so the round-trip actually
            lands instead of vanishing into a key nothing reads. */}
            {selected.length > 0 && (
              <div className="flex items-center justify-end gap-3 pb-2">
                {saved && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-st-pegged">
                    Added to watchlist →
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Only symbols the live universe actually contains.
                    // `selected` comes straight off the URL, so
                    // /compare?s=BOGUSXYZ123 used to write that string into
                    // `pegana.watchlist.v1` verbatim. The dashboard then
                    // counted it ("WATCHLIST · 1") while rendering zero rows,
                    // because the filter matches against real assets — and the
                    // only removal control is a per-row toggle on a row that
                    // can never render. A permanent ghost with no way out.
                    const known = new Set((assets ?? []).map((a) => a.symbol));
                    const real = selected.filter((sym) => known.has(sym));
                    for (const sym of real) addToWatchlist(sym);
                    if (real.length === 0) return;
                    setSaved(true);
                    setTimeout(() => setSaved(false), 3000);
                  }}
                  className="mt-4 rounded-full border border-outline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors hover:border-text hover:text-text"
                >
                  Add to watchlist
                </button>
              </div>
            )}

            {/* Side-by-side cards */}
            {selectedAssets.length > 0 && (
              <section className="border-t border-hairline py-10 sm:py-12">
                <h2 className="mb-6 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  Side by side
                </h2>
                <div
                  className={cn(
                    "grid gap-3 sm:gap-4",
                    selectedAssets.length === 1 && "sm:grid-cols-1",
                    selectedAssets.length === 2 && "sm:grid-cols-2",
                    selectedAssets.length === 3 && "sm:grid-cols-3",
                    selectedAssets.length === 4 &&
                      "sm:grid-cols-2 lg:grid-cols-4",
                  )}
                >
                  {selectedAssets.map((a, i) => (
                    <CompareCard
                      key={a.symbol}
                      asset={a}
                      colorIndex={i}
                      onRemove={() =>
                        setSelected(selected.filter((s) => s !== a.symbol))
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <ComparePageBody />
    </Suspense>
  );
}

// Backend-unreachable state — same copy/shape as /assets, /dashboard and
// /events: this means the Pegana API itself failed, not that nothing is
// selected yet (see the `backendDown` gate above).
function CompareBackendDown({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="border-t border-hairline py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
        ● Live feed unreachable
      </p>
      <p className="mx-auto mt-3 max-w-[360px] text-[13px] leading-[1.6] text-text-muted">
        The Pegana API isn&apos;t responding right now, so assets can&apos;t be
        loaded for comparison. Your selection is preserved in the URL and will
        resolve automatically once the feed is healthy.
      </p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
        >
          Retry now
        </button>
        <Link
          href="/status"
          className="inline-flex items-center rounded-full border border-hairline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption transition-colors duration-300 hover:border-outline hover:text-text"
        >
          Check status
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted uppercase tracking-[0.08em] text-[10px]">
        {label}
      </dt>
      <dd className="mt-1.5 text-[14px] sm:text-[15px]">{value}</dd>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[360px] w-full items-center justify-center border border-hairline font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted sm:h-[440px]">
      Loading chart…
    </div>
  );
}

function CompareCard({
  asset,
  colorIndex,
  onRemove,
}: {
  asset: AssetCardData;
  colorIndex: number;
  onRemove: () => void;
}) {
  const bps = reconcileBps(asset).bps;
  const state = (asset.state ?? "UNKNOWN") as PegState;
  const lowLiq = isLowLiquidity(asset.symbol);
  const grade = safetyTotalGrade(safetyGrade(asset));
  // Color the spread off engine state (PEGGED neutral), not raw magnitude, so a
  // wide-band asset's large in-band spread never reads as an alarm. Thin markets
  // stay muted (their gap isn't a realisable signal).
  const spreadColor = lowLiq ? "text-text-muted" : spreadSignClass(bps);

  return (
    <article
      className={cardSurface({
        radius: 16,
        animateBorder: true,
        className: "relative flex flex-col gap-3 overflow-hidden p-4 sm:p-5",
      })}
    >
      {/* Series-color accent — matches the chart line for this slot. A thin
          top edge on the panel object, not a full-height border. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: seriesColor(colorIndex) }}
      />
      {/* Top: symbol + remove */}
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/asset/${asset.symbol}`}
          className="group flex min-w-0 items-center gap-2.5"
        >
          <TokenIcon
            mint={asset.mint}
            symbol={displaySymbol(asset.symbol)}
            klass={asset.class}
            size={32}
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-medium leading-tight tracking-tight text-text group-hover:underline underline-offset-4">
                {displaySymbol(asset.symbol)}
              </span>
              <span className="text-text-muted group-hover:text-text">
                <IconArrowUpRight size={10} />
              </span>
            </div>
            {asset.name && (
              <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                {asset.name}
              </div>
            )}
          </div>
        </Link>
        <button
          type="button"
          onClick={onRemove}
          className="font-mono text-[14px] text-text-muted transition-colors hover:text-text"
          aria-label={`Remove ${displaySymbol(asset.symbol)} from compare`}
        >
          ×
        </button>
      </div>

      {/* Hero spread metric */}
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted">
          Spread now
        </div>
        <div
          className={cn(
            "mt-1 text-[28px] font-medium leading-none tracking-[-0.02em] tabular-nums sm:text-[32px]",
            spreadColor,
          )}
        >
          {/* Holder convention: `bps` follows reconcileBps (positive =
              discount, negative = premium) — negate for display so `+` =
              premium, `−` = discount (matching the board). */}
          {bps != null ? formatGap(-bps) : "-"}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium",
              stateMeta(state).badgeClass,
            )}
          >
            <StatePip
              state={state}
              pulse={state !== "PEGGED"}
              size={5}
              announce
            />
            {stateMeta(state).label}
          </span>
          {lowLiq && (
            <span className="rounded-full border border-hairline px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">
              thin
            </span>
          )}
        </div>
      </div>

      {/* Sparkline */}
      <div className="h-8 w-full">
        <SparklineCell
          symbol={asset.symbol}
          series={asset.series_24h}
          className="h-8 w-full"
          color={seriesColor(colorIndex)}
        />
      </div>

      {/* Metadata */}
      <dl className="grid gap-y-1.5 font-mono text-[11px]">
        <Row k="Intrinsic">{formatUsdValue(asset.intrinsic_usd ?? null)}</Row>
        <Row k="Market">{formatUsdValue(asset.market_usd ?? null)}</Row>
        <Row k="Class">{classGroupLabel(asset.class)}</Row>
        <Row k="Safety">
          <span className={gradeColorForGrade(grade)}>{grade}</span>
          {/* Always-visible disclosure — the grade is a static class-based
              heuristic, not a live peg verdict (finding #10). Same caveat the
              dashboard board's column header + mobile card carry. */}
          <span className="mt-0.5 block text-[9px] uppercase tracking-[0.06em] text-text-caption">
            Heuristic, not a live verdict
          </span>
        </Row>
      </dl>
    </article>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[68px_1fr] items-baseline gap-3">
      <dt className="text-text-muted uppercase tracking-[0.06em] text-[10px]">
        {k}
      </dt>
      <dd className="text-text break-all">{children}</dd>
    </div>
  );
}

function classGroupLabel(c: string): string {
  return c === "lst"
    ? "Liquid Staking"
    : c === "stable_fiat"
      ? "Fiat Stable"
      : c === "stable_cdp"
        ? "CDP Stable"
        : c === "stable_dn"
          ? "Delta-Neutral"
          : c === "stable_fx"
            ? "FX Stable"
            : c === "stable_rwa"
              ? "RWA Stable"
              : c === "stable_yield"
                ? "Yield-Bearing"
                : c === "synth_lev"
                  ? "Leveraged Synth"
                  : c;
}

function gradeColorForGrade(g: "A" | "B" | "C" | "D"): string {
  switch (g) {
    case "A":
      return "text-st-pegged";
    case "B":
      return "text-text";
    case "C":
      return "text-st-drift";
    case "D":
      return "text-st-depeg-text";
  }
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
