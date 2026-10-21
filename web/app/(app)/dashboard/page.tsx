"use client";

import { isRateLimited } from "@/lib/api/client";
import { RATE_LIMITED_BODY, RATE_LIMITED_LABEL } from "@/lib/api/rate-limit-copy";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "@/components/atoms/intent-link";
import { useSearchParams } from "next/navigation";
import { MarketFeed } from "@/components/organisms/market-feed";
import { OnboardingModal } from "@/components/organisms/onboarding-modal";
import { LiveStateAnnouncer } from "@/components/atoms/live-state-announcer";
import { SystemStatusHoverCard } from "@/components/organisms/system-status-hovercard";
import { SpreadTape } from "@/components/organisms/spread-tape";
import {
  DashboardBoardHead,
  DashboardBoardMobileCard,
  DashboardBoardMobileSkeletonCard,
  DashboardBoardRow,
  DashboardBoardSkeletonRow,
} from "@/components/organisms/dashboard-board-row";
import { PillTabs } from "@/components/molecules/pill-tabs";
import { Pagination } from "@/components/molecules/pagination";
import { replaceQuery } from "@/lib/url/replace-query";
import { usePagination } from "@/lib/hooks/use-pagination";
import { useAssets } from "@/lib/hooks/use-assets";
import { useStats } from "@/lib/hooks/use-stats";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useLive, useWsDrivenPage } from "@/lib/store/live-context";
import { useWatchlist, parseWatchlistInput } from "@/lib/store/watchlist";
import {
  cleanSeries,
  dispersionBps,
  formatBandAwayPct,
  formatGap,
  formatJitterPct,
  isDeprecated,
  jitterLabel,
  parseMarketCapUsd,
  pegJitter,
  reconcileBps,
} from "@/lib/api/format";
import { compareWorstFirst, type LiveOverride } from "@/lib/asset/worst-sort";
import { bandProximity } from "@/lib/asset/band";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import {
  CLASS_TABS,
  matchesClassFilter,
  type ClassFilterKey,
  type SortKey,
  type SortDir,
} from "@/lib/hooks/use-screener-state";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import { relativeStamp } from "@/lib/asset/relative-stamp";
import {
  closestToBand,
  computeVerdictCounts,
  lastRealTransition,
  mostVolatile,
} from "@/lib/asset/digest";
import { AnswerCard } from "@/components/molecules/answer-card";
import { BandGauge } from "@/components/atoms/band-gauge";
import { SparklineCell } from "@/components/molecules/sparkline-cell";
import { severityTextClass, spreadSignClass } from "@/lib/state-class";
import { JITTER_COLOR } from "@/lib/asset/row-color";
import { thresholdsFor } from "@/lib/alerts/policy";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, PegState } from "@/lib/api/types";

// Table-first rebuild (2026-07-14, Rafael's call): the board — every tracked
// asset, worst-first, one click to its full page — IS the dashboard now
// (tokens.xyz DNA), paginated 10/page. The verdict-hero + universe strip that
// used to sit on top of every visit (the original Command Center single-
// column shell, see docs/design-research/2026-07-11-app-reimagination-
// MASTER.md) moved into the System status hover-card (components/organisms/
// system-status-hovercard.tsx) behind a compact toolbar trigger — same
// components, same crown-jewel data, just relocated out of the default view.
// Same spine on mobile: no separate branch, just responsive rows.
//
// Toolbar polish (2026-07-14, founder feedback): the status trigger is a
// glance-only affordance, not a filter — it now sits alone on the RIGHT
// (`ml-auto`) of the toolbar row, separated from the view/class filter pills
// and search on the left, so the row reads "filters, then status" instead of
// a crammed pill soup. It also opens on HOVER/FOCUS now (see
// system-status-hovercard.tsx), not click.

type ViewKey = "all" | "watchlist" | "driftplus";

const VIEW_TABS: ReadonlyArray<{ key: ViewKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist" },
  { key: "driftplus", label: "Drifting+" },
];

// A4 taxonomy unification (2026-07-16): the class filter used to be a local
// 8-facet breakdown (LSTs/Fiat/CDP/Yield/FX/RWA/Delta/Synth) that diverged
// from the /assets screener's canonical 4-tab taxonomy — and disagreed on
// the label for the same class ("Synth" here vs "Synthetic" there). Now both
// surfaces render the SAME `CLASS_TABS` (All/LSTs/Stables/Synthetic) and
// filter with the SAME `matchesClassFilter` predicate from
// use-screener-state.ts, so there's one source of truth for "what is a
// stable" instead of two hand-maintained copies that can drift again.

// Board column sort (Rafael's "filtro pra clicar"). Mirrors the /assets
// screener's compareRows EXACTLY — same keys, same crown-jewel discipline: a
// row with no reconciled spread (stale/unreadable) sinks to the bottom for
// EVERY column and direction (H1/H9), never floating up as "safely near zero".
// The default (sortKey "state", desc) reproduces the old fixed worst-first
// order, so the board reads identically until the user clicks a header.

// Valid ?sort= values for THIS board (A6, 2026-07-16) — the columns
// DashboardBoardHead actually exposes a sort button for. Narrower than the
// /assets screener's SortKey union (no "class" column here), so an
// out-of-scope or garbage URL value falls back to the default below rather
// than being trusted.
const BOARD_SORT_KEYS: ReadonlySet<string> = new Set([
  "state",
  "symbol",
  "spread",
  "band",
  "jitter",
  "risk",
  // "marketCap" intentionally omitted — the board's Market cap column is hidden
  // until `market_cap` is backfilled, so a stale ?sort=marketCap URL must fall
  // back to the default rather than sort by an invisible column. Restore
  // alongside the DashboardBoardHead column when the field ships.
]);

interface BoardSortRow {
  a: AssetCardData;
  bps: number | null;
  prox: number | null;
  jitter: number | null;
  /** Composite 0-100 peg-risk score (state-anchored). Null for UNKNOWN / CR-form
   *  assets — sinks to the bottom of a Risk sort like a missing market cap. */
  riskScore: number | null;
  /** Parsed `market_cap` (circulating_supply × price, USD) — a size/context
   *  signal, NOT a peg-safety signal. Null until the backend ships the
   *  market-cap migration + indexer. Mirrors the /assets screener's
   *  ScreenerRow.marketCapUsd exactly. */
  marketCapUsd: number | null;
}

function compareBoard(
  p: BoardSortRow,
  q: BoardSortRow,
  sortKey: SortKey,
  sortDir: SortDir,
  liveOverrides: Record<string, LiveOverride>,
  now: number,
): number {
  const pMissing = p.bps == null;
  const qMissing = q.bps == null;
  if (pMissing !== qMissing) return pMissing ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "symbol":
      cmp = p.a.symbol.localeCompare(q.a.symbol);
      break;
    case "state":
      // compareWorstFirst is "worst first" (negative when p is worse) — negate
      // to this switch's plain-ascending convention; the sortDir flip below
      // restores worst-first as the default (desc) reading.
      cmp = -compareWorstFirst(p.a, q.a, liveOverrides, now);
      break;
    case "band":
      cmp = (p.prox ?? 0) - (q.prox ?? 0);
      break;
    case "jitter":
      cmp = (p.jitter ?? -1) - (q.jitter ?? -1);
      break;
    case "risk": {
      // Composite 0-100 severity (state-anchored). Null (UNKNOWN / CR-form
      // assets) sinks to the bottom regardless of direction — the same "never
      // rank missing data as safe" rule as marketCap, hence the early `return`
      // that skips the shared sortDir flip. Higher score = riskier.
      const pNull = p.riskScore == null;
      const qNull = q.riskScore == null;
      if (pNull !== qNull) return pNull ? 1 : -1;
      if (pNull && qNull) return p.a.symbol.localeCompare(q.a.symbol);
      cmp = p.riskScore! - q.riskScore!;
      break;
    }
    case "marketCap": {
      // Size/context signal, deliberately kept OUT of the worst-first
      // ranking's severity ramp (compareWorstFirst never reads it) — this
      // case only fires when the user explicitly sorts THIS column. Nulls
      // (not yet backfilled by the backend) sink to the bottom regardless of
      // direction, same "never rank missing data as good" rule as the
      // pMissing/qMissing gate above — hence the early `return`, which skips
      // the shared sortDir flip below. Mirrors use-screener-state.ts's
      // "marketCap" case exactly.
      const pNull = p.marketCapUsd == null;
      const qNull = q.marketCapUsd == null;
      if (pNull !== qNull) return pNull ? 1 : -1;
      if (pNull && qNull) return p.a.symbol.localeCompare(q.a.symbol);
      cmp = p.marketCapUsd! - q.marketCapUsd!;
      break;
    }
    default: // spread
      cmp = Math.abs(p.bps ?? 0) - Math.abs(q.bps ?? 0);
      break;
  }
  if (cmp === 0) cmp = p.a.symbol.localeCompare(q.a.symbol);
  return sortDir === "asc" ? cmp : -cmp;
}

function DashboardBoard() {
  const params = useSearchParams();
  const { data: assets, isLoading, error, mutate } = useAssets();
  const { data: stats } = useStats();
  const { data: alerts } = useAlerts({ limit: 15 });
  const { byAsset, connected } = useLive();
  useWsDrivenPage();
  const { symbols: watchlist, importSymbols } = useWatchlist();
  const [watchCopied, setWatchCopied] = useState(false);

  // Ticking clock for freshness gating (H1/H9) — every derived state below
  // (verdict counts, board rows) re-evaluates against this every 30s so a
  // silent asset visibly degrades to UNKNOWN. This is the raw LOCAL clock; the
  // server-anchored `now` used for gating is derived from it below (see
  // serverSkew) so a skewed client clock can't blank the whole board.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Watchlist portability (device-local convenience): map raw/pasted symbols to
  // canonical casing against the live universe when it's loaded; otherwise pass
  // them through (copied URLs already carry canonical symbols).
  const resolveWatchSymbols = useCallback(
    (raw: string[]): string[] => {
      if (!assets) return raw;
      const bySym = new Map(
        assets.map((a) => [a.symbol.toLowerCase(), a.symbol]),
      );
      const out: string[] = [];
      for (const r of raw) {
        const canon = bySym.get(r.toLowerCase());
        if (canon && !out.includes(canon)) out.push(canon);
      }
      return out;
    },
    [assets],
  );

  // "Copy watchlist" → a shareable URL using the same symbol-list-in-URL
  // pattern /compare uses (?watch=SYM1,SYM2), round-tripped by the auto-import
  // effect below + the "Import" action.
  const handleCopyWatchlist = useCallback(() => {
    if (watchlist.length === 0) return;
    const url = `${window.location.origin}/dashboard?view=watchlist&watch=${encodeURIComponent(
      watchlist.join(","),
    )}`;
    const done = () => {
      setWatchCopied(true);
      window.setTimeout(() => setWatchCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => {
        window.prompt("Copy your watchlist URL:", url);
      });
    } else {
      window.prompt("Copy your watchlist URL:", url);
    }
  }, [watchlist]);

  // "Import" → paste a copied URL (or a bare comma/space list) and merge into
  // the watchlist, uncapped.
  const handleImportWatchlist = useCallback(() => {
    const input = window.prompt(
      "Paste a watchlist URL or a comma-separated list of symbols:",
    );
    if (!input) return;
    const parsed = parseWatchlistInput(input);
    if (parsed.length === 0) return;
    const resolved = resolveWatchSymbols(parsed);
    importSymbols(assets ? resolved : parsed);
  }, [assets, importSymbols, resolveWatchSymbols]);

  // Auto-import a `?watch=` param so a copied watchlist link "just works" when
  // opened, then strip the param so a reload doesn't re-import.
  //
  // Gate on the asset universe having SETTLED (`!isLoading` — loaded OR errored)
  // before importing + stripping. `assets` loads async, so without this gate the
  // first run fires while `assets` is still undefined: it imports the RAW parsed
  // symbols via the `assets ? … : parsed` passthrough (so a hand-typed lower-case
  // `?watch=jitosol` never canonicalises to `jitoSOL`) AND strips the param — so
  // when `assets` finally arrives the param is already gone and the canonical
  // resolution never runs. Waiting for the load to settle makes the resolved
  // (canonical) path the one that actually executes; if the load errors we still
  // import raw so a copied link (already canonical) works with the API down.
  useEffect(() => {
    if (isLoading) return;
    const watchParam = params?.get("watch");
    if (!watchParam) return;
    const parsed = parseWatchlistInput(watchParam);
    if (parsed.length > 0) {
      const resolved = resolveWatchSymbols(parsed);
      importSymbols(assets ? resolved : parsed);
    }
    const sp = new URLSearchParams(params?.toString() ?? "");
    sp.delete("watch");
    replaceQuery(sp);
  }, [params, assets, isLoading, resolveWatchSymbols, importSymbols]);

  // Distinguishes "backend unreachable" from "filter matched nothing" — a
  // hard API failure has no cached `data`, so this must be checked before
  // any empty-state copy renders.
  const backendDown = !!error && !assets;

  // Crown jewel, preserved verbatim: liveOverrides is only trusted while the
  // socket is `connected`. On disconnect the last live frame is stale and
  // must NOT shadow the fresher REST snapshot (H1/H9) — we return {} so every
  // downstream `liveOverrides[sym]` falls through to the REST asset fields.
  const liveOverridesRef = useRef<
    Record<string, { state?: PegState; discount?: string; updated_at?: string }>
  >({});
  const liveOverrides = useMemo(() => {
    if (!connected) {
      liveOverridesRef.current = {};
      return {} as Record<
        string,
        { state?: PegState; discount?: string; updated_at?: string }
      >;
    }
    const prev = liveOverridesRef.current;
    const out: Record<
      string,
      { state?: PegState; discount?: string; updated_at?: string }
    > = {};
    for (const [sym, v] of Object.entries(byAsset)) {
      const state = v.state as PegState | undefined;
      const discount = typeof v.discount === "string" ? v.discount : undefined;
      const updated_at =
        typeof v.updated_at === "string" ? v.updated_at : undefined;
      const prior = prev[sym];
      out[sym] =
        prior &&
        prior.state === state &&
        prior.discount === discount &&
        prior.updated_at === updated_at
          ? prior
          : { state, discount, updated_at };
    }
    liveOverridesRef.current = out;
    return out;
  }, [byAsset, connected]);

  // Deprecated assets are excluded from the entire surface (strip, verdict,
  // cards, board) — their stale data would poison every derived signal.
  const liveAssets = useMemo(
    () => assets?.filter((a) => !isDeprecated(a.symbol)) ?? [],
    [assets],
  );

  // Freshness is measured against SERVER time, not the raw client wall clock.
  // isStale()/effectiveState() compare each snapshot's `updated_at` to `now`;
  // driving that off the local clock meant a PC whose clock ran fast marked
  // EVERY asset stale at once — the board went all-UNKNOWN, verdict counts
  // blanked, and the freshness-gated "Closest to band" card vanished (only the
  // non-gated "Most volatile" card survived, so the page rendered a single
  // card). We anchor `now` to server time by measuring the offset between the
  // freshest snapshot in the payload (server-generated `updated_at`) and the
  // local clock when the data arrives, then let the local clock tick from that
  // anchor — so a genuinely dark feed still ages into UNKNOWN, but a skewed
  // client clock cancels out. Clock-skew-proof.
  const serverSkewRef = useRef(0);
  const serverSkew = useMemo(() => {
    let freshest = 0;
    for (const a of liveAssets) {
      const t = Date.parse(a.updated_at ?? "");
      if (!Number.isNaN(t) && t > freshest) freshest = t;
    }
    for (const o of Object.values(liveOverrides)) {
      const t = Date.parse(o.updated_at ?? "");
      if (!Number.isNaN(t) && t > freshest) freshest = t;
    }
    if (freshest > 0) serverSkewRef.current = freshest - Date.now();
    return serverSkewRef.current;
  }, [liveAssets, liveOverrides]);
  const now = nowTick + serverSkew;

  // ── Verdict + digest (the signature) ──────────────────────────────────
  const counts = useMemo(
    () => computeVerdictCounts(liveAssets, liveOverrides, now),
    [liveAssets, liveOverrides, now],
  );
  const closest = useMemo(
    () => closestToBand(liveAssets, liveOverrides, now),
    [liveAssets, liveOverrides, now],
  );
  const transition = useMemo(() => lastRealTransition(alerts), [alerts]);
  const volatile = useMemo(
    () => mostVolatile(liveAssets, liveOverrides, now),
    [liveAssets, liveOverrides, now],
  );
  const closestAsset = useMemo(
    () =>
      closest ? liveAssets.find((a) => a.symbol === closest.symbol) : undefined,
    [closest, liveAssets],
  );
  const volatileAsset = useMemo(
    () =>
      volatile
        ? liveAssets.find((a) => a.symbol === volatile.symbol)
        : undefined,
    [volatile, liveAssets],
  );
  // 24h high-low swing (A7, 2026-07-16). Prefer the backend's authoritative
  // `jitter_bps_24h` (BSRV-03: peak-to-trough over MINUTE-level `discount_1m`
  // extremes) over re-deriving the range from the hourly-AVERAGED `series_24h`
  // — averaging first smooths away intra-hour spikes, muting real tail-risk on
  // the one card named "Most volatile", worst during the exact stress episodes
  // this product exists to catch. Fall back to the series range only when the
  // field is absent (older backend / no discount_1m rows). `pegJitter` (stddev,
  // driving the ranking + buckets) is a DISTINCT, complementary metric and is
  // deliberately left untouched.
  const volatileRangeBps = useMemo(() => {
    const authoritative = dispersionBps(volatileAsset?.jitter_bps_24h);
    if (authoritative != null) return authoritative;
    const series = volatileAsset?.series_24h;
    if (!series) return null;
    const clean = cleanSeries(series).map((v) => v * 10000);
    if (clean.length < 2) return null;
    return Math.max(...clean) - Math.min(...clean);
  }, [volatileAsset]);

  // Unfiltered, worst-first — independent of the board's view/class/search
  // pills (those scope the table below; the hero must always reflect the WHOLE
  // tracked universe). Reuses the same compareWorstFirst the board uses so
  // "worst" means one thing everywhere on this page. Freshness-gated: a stale
  // asset degrades to UNKNOWN (dropped from the problem list) and shows "—"
  // for bps, never a fabricated number.
  const problemAssets = useMemo(() => {
    return liveAssets
      .slice()
      .sort((a, b) => compareWorstFirst(a, b, liveOverrides, now))
      .map((a) => {
        const live = liveOverrides[a.symbol];
        const state = effectiveState(live, a, now);
        const stale = isStale(live?.updated_at ?? a.updated_at, now);
        const reconciled = reconcileBps({
          discount: live?.discount ?? a.discount,
          intrinsic_usd: a.intrinsic_usd,
          market_usd: a.market_usd,
        });
        return {
          symbol: a.symbol,
          state,
          bps: reconciled.bps ?? 0,
          hasBps: !stale && reconciled.bps != null,
        };
      })
      .filter(
        (r) =>
          r.state === "DRIFT" ||
          r.state === "DEPEG" ||
          r.state === "CRITICAL" ||
          r.state === "BLACK_SWAN",
      )
      .slice(0, 4); // cap the row — this is a glance, not the board
  }, [liveAssets, liveOverrides, now]);

  // ── Universe strip ─────────────────────────────────────────────────────
  // driftPlus still feeds the "Drifting+" view tab count below — the
  // strip itself no longer renders it (DashboardVerdict owns that
  // narrative now, see universe-strip.tsx's header comment).
  const driftPlus = counts.offPeg + counts.drift;
  const freshestIso = useMemo(() => {
    let max: number | null = null;
    let iso: string | null = null;
    for (const a of liveAssets) {
      const ts = liveOverrides[a.symbol]?.updated_at ?? a.updated_at;
      if (!ts) continue;
      const t = Date.parse(ts);
      if (Number.isNaN(t)) continue;
      if (max == null || t > max) {
        max = t;
        iso = ts;
      }
    }
    return iso;
  }, [liveAssets, liveOverrides]);
  const updatedAgo = freshestIso ? relativeStamp(freshestIso, now) : undefined;

  // ── Board: filter pills + search + worst-first order (no column sort on
  //    this surface — the whole point is one ranking, not re-derivable ones) ──
  const [classFilter, setClassFilter] = useState<ClassFilterKey>("all");
  // Seeded from `?view=` once (not URL-synced afterwards) so a copied watchlist
  // link (?view=watchlist&watch=…) lands on the Watchlist view showing the
  // freshly-imported symbols.
  const [view, setView] = useState<ViewKey>(() => {
    const v = params?.get("view");
    return v === "watchlist" || v === "driftplus" || v === "all" ? v : "all";
  });
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Column sort ("filtro pra clicar", 2026-07-14), URL-persisted (A6,
  // 2026-07-16): mirrors the /assets screener's use-screener-state.ts
  // EXACTLY — same `?sort=`/`?dir=` param names, same router.replace pattern
  // — so a board ranking is shareable the same way a screener ranking is.
  // Read directly off the URL on every render (no separate init effect
  // needed); default "state"/"desc" reproduces the old fixed worst-first
  // order, so a bare /dashboard visit with no query string reads identically
  // to before any header was ever clickable.
  const sortKey: SortKey = (() => {
    const s = params?.get("sort");
    return s && BOARD_SORT_KEYS.has(s) ? (s as SortKey) : "state";
  })();
  const sortDir: SortDir = params?.get("dir") === "asc" ? "asc" : "desc";
  const setSort = useCallback(
    (k: SortKey) => {
      // Toggle direction when re-clicking the active key; otherwise default
      // to the most-useful direction for that column (desc for magnitudes,
      // asc for the Asset name, which reads better A→Z).
      const nextDir: SortDir =
        sortKey === k
          ? sortDir === "desc"
            ? "asc"
            : "desc"
          : k === "symbol"
            ? "asc"
            : "desc";
      const sp = new URLSearchParams(params?.toString() ?? "");
      sp.set("sort", k);
      sp.set("dir", nextDir);
      replaceQuery(sp);
    },
    [sortKey, sortDir, params],
  );

  // Table-first pagination (tokens.xyz DNA) — the board is worst-first and
  // never re-sortable, so "page 2" always means "the next 10 worst-ranked
  // assets", a stable, predictable meaning even as live data ticks underneath.
  const PER_PAGE = 10;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Counts per canonical tab (not per raw AssetClass) — mirrors
  // matchesClassFilter's own bucketing so a class can never land in a count
  // that its predicate wouldn't also match.
  const classCounts: Record<ClassFilterKey, number> = useMemo(() => {
    const out: Record<ClassFilterKey, number> = {
      all: liveAssets.length,
      lst: 0,
      stable: 0,
    };
    for (const a of liveAssets) {
      if (matchesClassFilter(a.class, "lst")) out.lst += 1;
      else if (matchesClassFilter(a.class, "stable")) out.stable += 1;
    }
    return out;
  }, [liveAssets]);

  const viewCounts: Record<ViewKey, number> = useMemo(
    () => ({
      all: liveAssets.length,
      watchlist: watchlist.length,
      driftplus: driftPlus,
    }),
    [liveAssets.length, watchlist.length, driftPlus],
  );

  const board = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = liveAssets.filter((a) => {
      if (!matchesClassFilter(a.class, classFilter)) return false;
      if (
        q &&
        !`${a.symbol} ${displaySymbol(a.symbol)} ${a.name} ${a.class}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      if (view === "watchlist") return watchlist.includes(a.symbol);
      if (view === "driftplus") {
        const s = effectiveState(liveOverrides[a.symbol], a, now);
        return (
          s === "DRIFT" ||
          s === "DEPEG" ||
          s === "CRITICAL" ||
          s === "BLACK_SWAN"
        );
      }
      return true;
    });
    // Precompute the per-column sort values ONCE (not inside the O(n log n)
    // comparator), then sort. Default (state, desc) reproduces the old fixed
    // worst-first order exactly; a header click re-sorts by that column.
    const rows: BoardSortRow[] = filtered.map((a) => {
      const live = liveOverrides[a.symbol];
      const stale = isStale(live?.updated_at ?? a.updated_at, now);
      const { bps } = reconcileBps({
        discount: live?.discount ?? a.discount,
        intrinsic_usd: a.intrinsic_usd,
        market_usd: a.market_usd,
      });
      const hasBps = !stale && bps != null;
      const t = thresholdsFor(a.symbol, a.class, a.thresholds);
      return {
        a,
        bps: hasBps ? bps : null,
        prox:
          hasBps && bps != null
            ? bandProximity(bps, t, isDirectionSensitiveClass(a.class))
            : null,
        jitter: pegJitter(a.series_24h),
        riskScore: a.risk_score,
        marketCapUsd: parseMarketCapUsd(a.market_cap),
      };
    });
    rows.sort((p, qq) =>
      compareBoard(p, qq, sortKey, sortDir, liveOverrides, now),
    );
    return rows.map((r) => r.a);
  }, [
    liveAssets,
    classFilter,
    view,
    query,
    watchlist,
    liveOverrides,
    now,
    sortKey,
    sortDir,
  ]);

  // `board` is already worst-first sorted + filtered, so slicing it is the
  // entire pagination mechanic (no re-sort/re-filter per page). The shared
  // hook owns the clamping, the reset when a filter/search/view change
  // re-scopes the ranked list (a page index from the previous scope is
  // meaningless and can point past the new end), the `?page=` URL mirror and
  // the animated swap.
  const pagination = usePagination({
    items: board,
    pageSize: PER_PAGE,
    resetKey: `${classFilter}|${view}|${query}|${sortKey}|${sortDir}`,
    itemNoun: "asset",
  });
  const pagedBoard = pagination.pageItems;

  // Per-row view-model (effective state/spread), derived once and shared by
  // both the mobile card list and the desktop table below — they render the
  // SAME sliced page in two separate DOM trees (see the mobile
  // horizontal-scroll fix in dashboard-board-row.tsx), so this keeps their
  // state-derivation logic from drifting into two hand-copied versions.
  const boardRows = useMemo(
    () =>
      pagedBoard.map((a) => {
        const live = liveOverrides[a.symbol];
        const effUpdatedAt = live?.updated_at ?? a.updated_at;
        const stale = isStale(effUpdatedAt, now);
        const state: PegState = effectiveState(live, a, now);
        const reconciled = reconcileBps({
          discount: live?.discount ?? a.discount,
          intrinsic_usd: a.intrinsic_usd,
          market_usd: a.market_usd,
        });
        const hasBps = !stale && reconciled.bps != null;
        const bps = reconciled.bps ?? 0;
        const jitter = pegJitter(a.series_24h);
        // Velocity: compare last two points of the 24h series to determine
        // if the spread is widening (riskier) or narrowing (safer).
        let velocity: number | null = null;
        if (hasBps && a.series_24h && a.series_24h.length >= 2) {
          const series = a.series_24h.filter((v) => v != null);
          if (series.length >= 2) {
            const last = series[series.length - 1];
            const prev = series[series.length - 2];
            const delta = last - prev;
            if (Math.abs(delta) > 0.0001) {
              // Positive delta = discount increasing = spread widening = riskier
              velocity = delta > 0 ? 1 : -1;
            }
          }
        }
        return {
          asset: a,
          state,
          bps,
          hasBps,
          discount: live?.discount ?? a.discount,
          jitter,
          jLabel: jitterLabel(jitter),
          riskScore: a.risk_score,
          velocity,
        };
      }),
    [pagedBoard, liveOverrides, now],
  );

  // Roving tabindex — one Tab stop for the CURRENT PAGE; Arrow/Home/End move
  // it within the visible 10 rows (not the whole filtered board — those rows
  // aren't in the DOM). Clamped to the current page's row count so a page
  // change or a shrinking filter can't leave the anchor pointing past the end.
  const [active, setActive] = useState(0);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeIndex =
    pagedBoard.length === 0 ? 0 : Math.min(active, pagedBoard.length - 1);
  const onBoardKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTableElement>) => {
      const n = pagedBoard.length;
      if (n === 0) return;
      const cur = Math.min(active, n - 1);
      let next = -1;
      if (e.key === "ArrowDown") next = Math.min(cur + 1, n - 1);
      else if (e.key === "ArrowUp") next = Math.max(cur - 1, 0);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      if (next < 0) return;
      e.preventDefault();
      setActive(next);
      rowRefs.current[next]?.focus();
    },
    [pagedBoard.length, active],
  );

  return (
    <>
      <OnboardingModal />
      <MarketFeed />
      <LiveStateAnnouncer assets={assets} liveOverrides={liveOverrides} />
      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-6 sm:px-8 sm:pt-8 lg:px-10">
        {isLoading && !backendDown && (
          <div className="py-8">
            <div className="h-9 w-2/3 animate-pulse rounded-full bg-text/[0.06]" />
            <div className="mt-4 h-4 w-1/2 animate-pulse rounded-full bg-text/[0.04]" />
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="h-[160px] animate-pulse rounded-[16px] border border-hairline bg-text/[0.02]" />
              <div className="h-[160px] animate-pulse rounded-[16px] border border-hairline bg-text/[0.02]" />
            </div>
            {/* Board skeleton — real <table>/<colgroup>, same silhouette as
                the live board (task: "skeleton dentro da tabela", td colSpan
                at the real 64px row height) instead of an unrelated generic
                grid placeholder. Desktop table and mobile card list are
                separate DOM below `sm` (see the live board's identical split
                a few lines down for the rationale — a table-fixed table's
                colgroup pins its 920px width at every viewport, so a mobile
                variant can never live inside it). */}
            <div className="mt-8 overflow-hidden rounded-[20px] border border-hairline bg-surface-1">
              <div className="divide-y divide-hairline-soft sm:hidden">
                {Array.from({ length: 8 }).map((_, i) => (
                  <DashboardBoardMobileSkeletonCard key={i} />
                ))}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table
                  // Loading placeholder: announcing an empty grid of shimmer
                  // cells to a screen reader is noise, not information. The real
                  // table that replaces it carries the aria-label.
                  aria-hidden="true"
                  className="w-full min-w-[976px] table-fixed border-collapse text-left"
                >
                  <DashboardBoardHead />
                  <tbody className="divide-y divide-hairline-soft">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <DashboardBoardSkeletonRow key={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {backendDown && (
          <BackendDownState
            onRetry={() => mutate()}
            rateLimited={isRateLimited(error)}
            className="py-16"
          />
        )}

        {!isLoading && !backendDown && (
          <>
            <SpreadTape
              assets={assets}
              liveOverrides={liveOverrides}
              now={now}
            />

            {/* Highlight cards — tokens.xyz-style featured cards ABOVE the
                table (Closest to its band + Most volatile 24h), restored
                2026-07-14. The board table sits centered below them.

                On a phone these two used to stack, and each is roughly a full
                screen tall. Between them, the 56px header, the tab bar and the
                spread tape, the board — the reason the page exists — began on
                the third screen. They are one swipeable, snapping row below
                `sm` instead: both cards keep their full content, the vertical
                cost halves, and horizontal paging is the native idiom for
                peer cards on touch. `sm:` restores the side-by-side grid
                untouched.

                The negative margin + padding pair lets the row bleed to the
                screen edges (so a card can sit flush while its neighbour peeks
                in) without the page itself gaining horizontal scroll, which
                mobile-shell.spec.ts asserts at 390px. */}
            <section
              data-scroll-contain
              aria-label="Highlights"
              className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:py-8 border-b border-hairline/60 [&>*]:w-[86%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto"
            >
              {closest && (
                <AnswerCard
                  eyebrow="Closest to its band"
                  href={`/asset/${encodeURIComponent(closest.symbol)}`}
                  symbol={displaySymbol(closest.symbol)}
                  name={closest.name}
                  mint={closest.mint}
                  klass={closest.class}
                  metric={`${formatBandAwayPct(closest.bpsAway)} away`}
                  metricClassName={severityTextClass(closest.state)}
                >
                  <div className="space-y-2.5">
                    <BandGauge
                      bps={closest.bps}
                      thresholds={thresholdsFor(
                        closest.symbol,
                        closest.class,
                        closest.thresholds,
                      )}
                      state={closest.state}
                      klass={closest.class}
                    />
                    <div className="flex items-center justify-between font-mono text-[11px] text-text-caption">
                      <span>Spread</span>
                      <span className={spreadSignClass(closest.bps)}>
                        {/* Holder convention: closest.bps follows reconcileBps
                            (positive = discount, negative = premium) — negate
                            for display so `+` = premium (market ABOVE
                            intrinsic), `−` = discount (below), matching /lst +
                            the hero board. Without this a healthy LST at a
                            +1% premium rendered as a scary "−1%". */}
                        {formatGap(closest.bps == null ? null : -closest.bps)}
                      </span>
                    </div>
                    <SparklineCell
                      symbol={closest.symbol}
                      series={closestAsset?.series_24h}
                      thresholdBps={
                        thresholdsFor(
                          closest.symbol,
                          closest.class,
                          closest.thresholds,
                        ).depeg_bps
                      }
                      className="h-8 w-full"
                    />
                  </div>
                </AnswerCard>
              )}

              {volatile && (
                <AnswerCard
                  eyebrow="Most volatile 24h"
                  href={`/asset/${encodeURIComponent(volatile.symbol)}`}
                  symbol={displaySymbol(volatile.symbol)}
                  name={volatile.name}
                  mint={volatile.mint}
                  klass={volatile.class}
                  metric={formatJitterPct(volatile.jitterBps)}
                  metricClassName={
                    JITTER_COLOR[jitterLabel(volatile.jitterBps)] ?? "text-text"
                  }
                >
                  <div className="space-y-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
                      {jitterLabel(volatile.jitterBps).replace(/^\w/, (c) =>
                        c.toUpperCase(),
                      )}
                    </div>
                    {/* 24h high-low swing (A7, 2026-07-16) — real data from
                        the same series feeding the sparkline below, matching
                        the "Closest to its band" card's label+value Spread
                        row so the two hero cards carry the same content
                        depth. */}
                    <div className="flex items-center justify-between font-mono text-[11px] text-text-caption">
                      <span>24h range</span>
                      <span className="text-text">
                        {volatileRangeBps != null
                          ? formatBandAwayPct(volatileRangeBps)
                          : "-"}
                      </span>
                    </div>
                    <SparklineCell
                      symbol={volatile.symbol}
                      series={volatileAsset?.series_24h}
                      thresholdBps={
                        thresholdsFor(
                          volatile.symbol,
                          volatile.class,
                          volatile.thresholds,
                        ).depeg_bps
                      }
                      className="h-8 w-full"
                    />
                  </div>
                </AnswerCard>
              )}
            </section>

            {/* Board — one control section (view pills + class pills + search
                on the left, status trigger on the right), worst-first rows
                below, paginated 10/page. Single markup for every viewport;
                the row component handles its own responsive layout (mirrors
                the /assets screener pattern). */}
            <section className="pt-6">
              <div className="flex flex-wrap items-center gap-3 py-3">
                {/* Filters — the actual board controls (which subset of the
                    tracked universe, narrowed by class, narrowed by text).
                    Grouped together on the left so the row reads "filters,
                    then status" (2026-07-14 toolbar polish). */}
                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
                  <PillTabs
                    items={VIEW_TABS.map((v) => ({
                      key: v.key,
                      label: v.label,
                      count: viewCounts[v.key],
                    }))}
                    value={view}
                    onChange={setView}
                    ariaLabel="Dashboard view filter"
                  />
                  <span aria-hidden className="h-4 w-px shrink-0 bg-hairline" />
                  <PillTabs
                    items={CLASS_TABS.map((c) => ({
                      key: c.key,
                      label: c.label,
                      count: classCounts[c.key],
                    }))}
                    value={classFilter}
                    onChange={setClassFilter}
                    ariaLabel="Dashboard asset class filter"
                  />
                </div>
                {/* Search — screener parity (A8, 2026-07-16): a leading
                    icon taught nothing about the "/" shortcut; swapped for
                    the /assets screener's trailing `kbd` hint so the
                    affordance is consistent across both surfaces. */}
                <div className="relative shrink-0">
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuery("");
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label="Filter assets by symbol, name, or class"
                    placeholder="Filter"
                    className="h-8 w-[140px] rounded-full border border-outline bg-transparent pl-3.5 pr-7 font-mono text-[11px] text-text transition-[width] placeholder:text-text-caption focus:w-[180px] focus:border-text focus:outline-none"
                  />
                  <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-caption">
                    /
                  </kbd>
                </div>
                {/* Status trigger — a glance-only affordance, not a filter, so
                    it's visually separated on the right (`ml-auto`) instead of
                    crammed in with the board controls. The verdict-hero +
                    universe strip that used to sit on top of every visit now
                    live behind this compact pill, revealed on hover/focus
                    (table-first rebuild, 2026-07-14; hover-not-click + toolbar
                    polish, 2026-07-14). */}
                <SystemStatusHoverCard
                  counts={counts}
                  closest={closest}
                  transition={transition}
                  problemAssets={problemAssets}
                  nowMs={now}
                  tracked={liveAssets.length}
                  alerts24h={stats?.alerts_24h ?? 0}
                  deliverySent={stats?.delivery_health.sent_24h ?? 0}
                  deliveryFailed={stats?.delivery_health.failed_24h ?? 0}
                  updatedAgo={updatedAgo}
                  className="ml-auto"
                />
              </div>

              {/* Watchlist portability — Copy (as a /compare-style ?watch= URL)
                  + Import (paste a URL or symbol list). Device-local, uncapped;
                  only shown on the Watchlist view. */}
              {view === "watchlist" && (
                <div className="flex flex-wrap items-center gap-2 border-b border-hairline py-2.5">
                  <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
                    Watchlist · {watchlist.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyWatchlist}
                    disabled={watchlist.length === 0}
                    className="inline-flex items-center rounded-full border border-outline px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {watchCopied ? "Copied" : "Copy watchlist"}
                  </button>
                  <button
                    type="button"
                    onClick={handleImportWatchlist}
                    className="inline-flex items-center rounded-full border border-outline px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
                  >
                    Import
                  </button>
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-caption">
                    device-local · not synced
                  </span>
                </div>
              )}

              {board.length === 0 ? (
                <div className="flex flex-col items-center gap-5 rounded-[20px] border border-hairline bg-surface-1 px-6 py-20 text-center">
                  {/* Visual element: concentric radar rings — subtle,
                      non-generic, on-brand (search not finding a signal). */}
                  <div aria-hidden className="relative flex h-16 w-16 items-center justify-center">
                    <div className="absolute h-16 w-16 rounded-full border border-hairline" />
                    <div className="absolute h-11 w-11 rounded-full border border-hairline" />
                    <div className="absolute h-6 w-6 rounded-full border border-hairline" />
                    <div className="h-2 w-2 rounded-full bg-text-caption/40" />
                  </div>
                  <div>
                    <p className="text-[16px] font-medium text-text">
                      {query.trim()
                        ? `No assets match "${query.trim()}".`
                        : view === "watchlist" && watchlist.length === 0
                          ? "Your watchlist is empty."
                          : "No assets match this filter."}
                    </p>
                    <p className="mt-2 max-w-[42ch] text-[13px] leading-[1.6] text-text-muted">
                      {query.trim()
                        ? "Try a different search term, or clear the filter to see all tracked assets."
                        : view === "watchlist" && watchlist.length === 0
                          ? "Saved on this device only, not synced to your account. Add assets from any list."
                          : "Try a different class filter or clear all filters to see the full board."}
                    </p>
                  </div>
                  {(query.trim() ||
                    classFilter !== "all" ||
                    view !== "all") && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setClassFilter("all");
                        setView("all");
                      }}
                      className="inline-flex items-center rounded-full border border-outline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Desktop table and mobile card list are separate DOM (fix:
                      the mobile card used to live inside a colSpan cell of this
                      same table — a table-fixed table's <colgroup> pins the
                      table to its fixed column widths [920px] at EVERY viewport,
                      so the mobile card was forced to that width and scrolled
                      sideways with its right half off-screen; see
                      dashboard-board-row.tsx's DashboardBoardMobileCard comment).
                      Real <table>, not a `role="list"` — DashboardBoardHead ships
                      the <colgroup> + <thead> together (see that file's header
                      comment) so column widths and header labels can never drift
                      out of alignment with the <td>s below them. Table semantics
                      (thead/th scope="col"/tbody/td) replace the previous
                      role="list"/role="listitem" pairing: a real <table> already
                      gives assistive tech row/column/header navigation for free,
                      so the manual ARIA list pattern is redundant now that the
                      markup is actually tabular (it wasn't before). */}
                  <div
                    ref={pagination.anchorRef}
                    className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1"
                  >
                    <div className="divide-y divide-hairline-soft sm:hidden">
                      {boardRows.map((r, idx) => (
                        <DashboardBoardMobileCard
                           key={r.asset.symbol}
                           asset={r.asset}
                           state={r.state}
                           bps={r.bps}
                           hasBps={r.hasBps}
                           discount={r.discount}
                           jitter={r.jitter}
                           jLabel={r.jLabel}
                           riskScore={r.riskScore}
                           velocity={r.velocity}
                           rovingActive={idx === activeIndex}
                         />
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto sm:block">
                      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
                          Deliberate: the board implements roving arrow-key
                          navigation across rows, and the handler is delegated
                          here rather than bound to 69 rows. The table has an
                          accessible name and its rows are individually
                          reachable — this is the a11y feature, not a gap. */}
                      <table
                        aria-label="Tracked assets"
                        className="w-full min-w-[976px] table-fixed border-collapse text-left"
                        onKeyDown={onBoardKeyDown}
                      >
                        <DashboardBoardHead
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={setSort}
                        />
                        <tbody className="divide-y divide-hairline-soft">
                          {boardRows.map((r, idx) => (
                            <DashboardBoardRow
                               key={r.asset.symbol}
                               asset={r.asset}
                               state={r.state}
                               bps={r.bps}
                               hasBps={r.hasBps}
                               discount={r.discount}
                               jitter={r.jitter}
                               jLabel={r.jLabel}
                               riskScore={r.riskScore}
                               velocity={r.velocity}
                               rowRef={(el) => {
                                 rowRefs.current[idx] = el;
                               }}
                               rovingActive={idx === activeIndex}
                             />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination — one shared control. Hidden entirely when the
                      whole filtered board fits on a page (tokens.xyz-style: a
                      control that can never do anything is just noise). */}
                  <Pagination state={pagination} ariaLabel="Board pages" />
                </>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router (A6,
// 2026-07-16 — the board's column sort became URL-driven) — same split as
// app/(app)/asset/[symbol]/page.tsx: the default export is a thin Suspense
// shell, all the real logic lives in DashboardBoard.
export default function DashboardPage() {
  return (
    <>
      {/* /dashboard was the only route in the app with no <h1> at all. The
          page's heading used to be DashboardVerdict's headline, but the
          2026-07-14 hover-not-click rebuild moved that component inside a
          Radix HoverCard, which does not mount its content until the user
          hovers — so on load the heading was not hidden, it was absent, and
          screen-reader users got a page with no landmark heading.

          It is sr-only rather than visible on purpose: taking the big verdict
          text out of the default view was a deliberate design call, and this
          restores the semantics without putting it back on screen.

          tests/e2e/a11y.spec.ts covers this route but scopes axe to
          wcag2a/wcag2aa, and `page-has-heading-one` is tagged best-practice,
          which is why an a11y suite that runs on this exact page never once
          flagged it. tests/public/page-contract.spec.ts now asserts it
          directly against production instead of relying on the tag set. */}
      <h1 className="sr-only">
        Dashboard: live peg state for every asset Pegana monitors
      </h1>
      <Suspense fallback={null}>
        <DashboardBoard />
      </Suspense>
    </>
  );
}

// Backend-unreachable state — distinct from the empty-filter copy: this
// means the Pegana API itself failed, not that the filter is too narrow.
function BackendDownState({
  onRetry,
  rateLimited = false,
  className,
}: {
  onRetry: () => void;
  rateLimited?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("text-center", className)}>
      <p className={`font-mono text-[11px] uppercase tracking-[0.08em] ${rateLimited ? "text-text-muted" : "text-st-drift"}`}>
        ● {rateLimited ? RATE_LIMITED_LABEL : "Live feed unreachable"}
      </p>
      <p className="mx-auto mt-3 max-w-[360px] text-[13px] leading-[1.6] text-text-muted">
        {rateLimited ? (
          RATE_LIMITED_BODY
        ) : (
          <>
            The Pegana API isn&apos;t responding right now. Assets will reappear
            automatically as soon as it&apos;s healthy.
          </>
        )}
      </p>
      {/* A slow-down request resumes on its own: no Retry button. */}
      {!rateLimited && (
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
      )}
    </div>
  );
}
