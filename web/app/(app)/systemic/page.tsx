"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "@/components/atoms/intent-link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { TokenIcon } from "@/components/atoms/token-icon";
import { StatePip } from "@/components/atoms/state-pip";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  useSystemicFeed,
  type SystemicEntry,
} from "@/lib/hooks/use-systemic-feed";
import type { PegState } from "@/lib/api/types";

// Sub-C "Loop Intelligence" — the public depeg-cascade instrument. Reads the live
// tokens.xyz feed once and lets anyone pick a token + depeg depth and watch the
// cross-protocol liquidation cascade. Advisory, anonymous by construction
// (k-anonymised distributions, no wallet/owner ever read) — never a receipt.

const SHOCKS = [100, 250, 500, 1000, 2000] as const;
const PROTO_LABEL: Record<string, string> = {
  kamino: "Kamino",
  jupiter_lend: "Jupiter Lend",
};

function usdCompact(v?: string | number | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function shockLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
}
function protoList(protocols: string[]): string {
  return protocols.map((p) => PROTO_LABEL[p] ?? p).join(" + ");
}

export default function SystemicPage() {
  return (
    <Suspense fallback={null}>
      <SystemicPageInner />
    </Suspense>
  );
}

function SystemicPageInner() {
  const { entries, totalExposureUsd, error, isLoading } = useSystemicFeed();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Default to the biggest-exposure token that actually cascades, so the
  // instrument shows a real number on first paint.
  const defaultSymbol = useMemo(
    () => entries?.find((e) => e.hasCascade)?.symbol ?? entries?.[0]?.symbol,
    [entries],
  );
  const urlAsset = searchParams?.get("asset") ?? undefined;
  const selectedSymbol = urlAsset ?? defaultSymbol;
  const urlShock = Number(searchParams?.get("shock"));
  const [fallbackShock, setFallbackShock] = useState(1000);
  const shock = SHOCKS.includes(urlShock as (typeof SHOCKS)[number])
    ? urlShock
    : fallbackShock;

  const selected = useMemo(
    () => entries?.find((e) => e.symbol === selectedSymbol),
    [entries, selectedSymbol],
  );

  const setParam = useCallback(
    (next: { asset?: string; shock?: number }) => {
      const q = new URLSearchParams(searchParams?.toString());
      if (next.asset) q.set("asset", next.asset);
      if (next.shock != null) {
        q.set("shock", String(next.shock));
        setFallbackShock(next.shock);
      }
      router.replace(`/systemic?${q.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-28 pt-12 sm:px-6 sm:pt-16">
      {/* Hero — editorial, airy, one lead thought */}
      <header className="max-w-[42rem]">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-caption">
          Loop intelligence
        </p>
        <h1 className="mt-4 text-[clamp(32px,6.4vw,58px)] font-medium leading-[1.02] tracking-[-0.035em]">
          What breaks when a
          <br className="hidden sm:block" /> Solana peg{" "}
          <span className="text-coral">
            slips
          </span>
          ?
        </h1>
        <p className="mt-5 max-w-[52ch] text-[15.5px] leading-relaxed text-text-muted">
          A stablecoin or LST rarely breaks alone. It breaks the leverage
          stacked on top of it. Pick a token, pick a depeg depth, and watch how
          much collateral gets liquidated across Solana&rsquo;s lending markets.
        </p>
      </header>

      {/* Stats strip — clean, tokens.xyz-airy, no boxes */}
      <div className="mt-9 flex flex-wrap items-baseline gap-x-10 gap-y-4 border-t border-hairline pt-6">
        <Stat
          value={isLoading ? "-" : usdCompact(totalExposureUsd)}
          label="leverage tracked"
          lead
        />
        <Stat value={entries ? String(entries.length) : "-"} label="tokens" />
        <Stat value="2" label="lending venues" />
        <Stat
          value={
            entries ? String(entries.filter((e) => e.hasCascade).length) : "-"
          }
          label="with a modelled cascade"
        />
      </div>

      {/* The instrument */}
      <section className="mt-10">
        {selected ? (
          <Simulator
            entry={selected}
            entries={entries ?? []}
            shock={shock}
            onShock={(s) => setParam({ shock: s })}
            onPick={(sym) => setParam({ asset: sym })}
          />
        ) : (
          <div className="rounded-[16px] border border-hairline bg-surface-1 p-8 text-[13px] text-text-muted">
            {isLoading
              ? "Loading leverage exposure…"
              : error
                ? (
                    <span>Couldn't load leverage data.{" "}
                      <Link href="/systemic" className="underline decoration-dotted underline-offset-2 hover:text-text">Retry</Link>{" "}
                      or check{" "}
                      <Link href="/status" className="underline decoration-dotted underline-offset-2 hover:text-text">system status</Link>.
                    </span>
                  )
                : "No leveraged tokens tracked."}
          </div>
        )}
      </section>

      {/* Ranked overview */}
      <section className="mt-14">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-medium tracking-[-0.01em]">
            Every token with tracked leverage
          </h2>
          <span className="font-mono text-[11px] text-text-caption">
            {entries?.length ?? "-"} tokens · worst-first
          </span>
        </div>
        <SystemicTable
          entries={entries}
          selectedSymbol={selectedSymbol}
          onSelect={(sym) => {
            setParam({ asset: sym });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </section>
    </main>
  );
}

function Stat({
  value,
  label,
  lead,
}: {
  value: string;
  label: string;
  lead?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono leading-none tracking-[-0.02em] tabular-nums text-text",
          lead ? "text-[clamp(26px,4vw,34px)]" : "text-[clamp(20px,3vw,24px)]",
        )}
      >
        {value}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption">
        {label}
      </div>
    </div>
  );
}

// ── The instrument ────────────────────────────────────────────────────────────
function Simulator({
  entry,
  entries,
  shock,
  onShock,
  onPick,
}: {
  entry: SystemicEntry;
  entries: SystemicEntry[];
  shock: number;
  onShock: (shockBps: number) => void;
  onPick: (symbol: string) => void;
}) {
  const rungs = SHOCKS.map((bps) => {
    const r = entry.systemic.cascade.find((c) => c.shock_bps === bps);
    return {
      bps,
      liq: r ? Number(r.liquidatable_usd) || 0 : 0,
      positions: r?.positions ?? "-",
    };
  });
  const maxLiq = rungs.reduce((m, r) => Math.max(m, r.liq), 0);
  const sel = rungs.find((r) => r.bps === shock) ?? rungs[0];
  const sym = displaySymbol(entry.symbol);
  const noCascade = maxLiq === 0;
  // Two honest reasons a token has no modelled cascade, distinguished by the
  // feed's `cascade_coverage` (the API never reports `coverage: "full"` any
  // more): fresh health-factor bands exist (partial: k-floored) but nothing in
  // them liquidates even at the deepest shock, or there are no fresh bands and
  // the cascade is simply not modelled yet. Older API builds only send
  // `coverage`, where "full" meant the former.
  const cascadeCoverage = entry.systemic.cascade_coverage ?? entry.systemic.coverage;
  const coverageFull = cascadeCoverage === "partial" || cascadeCoverage === "full";

  return (
    <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1">
      {/* Control bar */}
      <div className="flex items-center justify-between gap-3 border-b border-hairline-soft px-5 py-4 sm:px-7">
        <TokenPicker entry={entry} entries={entries} onPick={onPick} />
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-text-caption sm:block">
          advisory · not a receipt
        </span>
      </div>

      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
        {/* Left — the statement (the hero moment) */}
        <div className="flex flex-col justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {noCascade
              ? `${sym} leverage exposure`
              : `A ${shockLabel(shock)} ${sym} depeg`}
          </p>
          {noCascade ? (
            <>
              {/* Lead with the exposure figure (not a muted dash) — it's the real
                  number here. Neutral tone, never the red liquidation colour. */}
              <div className="mt-2 font-mono text-[clamp(40px,7vw,64px)] font-medium leading-[0.95] tracking-[-0.03em] tabular-nums text-text">
                {usdCompact(entry.exposureUsd)}
              </div>
              {coverageFull ? (
                <p className="mt-3 max-w-[36ch] text-[13.5px] leading-relaxed text-text-muted">
                  deposited as collateral across{" "}
                  <span className="text-text">
                    {protoList(entry.systemic.protocols)}
                  </span>
                  . No position in the health-factor bands we track liquidates even
                  at a {shockLabel(2000)} depeg.
                  <span className="ml-1.5 inline-flex items-center rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-caption">
                    no cascade
                  </span>
                </p>
              ) : (
                <p className="mt-3 max-w-[36ch] text-[13.5px] leading-relaxed text-text-muted">
                  of leverage across{" "}
                  <span className="text-text">
                    {protoList(entry.systemic.protocols)}
                  </span>
                  . Health-factor coverage here is still thin. No cascade
                  modelled yet.
                  <span className="ml-1.5 inline-flex items-center rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-caption">
                    cascade pending
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              <div className="mt-2 font-mono text-[clamp(40px,7.5vw,68px)] font-medium leading-[0.95] tracking-[-0.03em] tabular-nums text-st-depeg-text">
                {sel.liq > 0 ? usdCompact(sel.liq) : "$0"}
              </div>
              <p className="mt-3 max-w-[36ch] text-[14px] leading-relaxed text-text-muted">
                {sel.liq > 0 ? (
                  <>
                    {/* "of collateral", not "of leveraged collateral": the
                        cascade runs over every position the health-factor
                        bands cover, which can exceed the leveraged total
                        above it (see lib/asset/loop-impact.ts). */}
                    of collateral crosses its liquidation threshold across{" "}
                    <span className="text-text">
                      {protoList(entry.systemic.protocols)}
                    </span>
                    , {sel.positions} positions.
                  </>
                ) : (
                  <>
                    no tracked positions liquidate this shallow.{" "}
                    <span className="text-text">{sym}</span> stays solvent until
                    a deeper depeg.
                  </>
                )}
              </p>
            </>
          )}
          <Link
            href={`/asset/${encodeURIComponent(entry.symbol)}`}
            className="mt-5 inline-flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-caption transition-colors hover:text-text"
          >
            {sym} peg detail →
          </Link>
        </div>

        {/* Right — the cascade (the control + viz in one) */}
        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
            The cascade. Click a depth
          </p>
          <div
            className="flex items-end gap-2.5 sm:gap-3.5"
            style={{ height: 168 }}
          >
            {rungs.map((r) => {
              const h =
                r.liq > 0 ? Math.max(6, Math.round((r.liq / maxLiq) * 132)) : 3;
              const active = r.bps === shock;
              return (
                <button
                  key={r.bps}
                  type="button"
                  onClick={() => onShock(r.bps)}
                  className="group flex flex-1 flex-col items-center justify-end gap-2 rounded-md outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
                  aria-label={`${shockLabel(r.bps)} depeg, ${usdCompact(r.liq)} liquidatable`}
                  aria-pressed={active}
                >
                  <span
                    className={cn(
                      "font-mono text-[11px] tabular-nums transition-colors duration-200",
                      active
                        ? "text-st-depeg-text"
                        : r.liq > 0
                          ? "text-text-muted group-hover:text-text"
                          : "text-text-caption",
                    )}
                  >
                    {r.liq > 0 ? usdCompact(r.liq) : "-"}
                  </span>
                  <span
                    className={cn(
                      "w-full rounded-t-[5px] transition-[height,background-color] duration-[420ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                      active
                        ? "bg-gradient-to-t from-st-depeg to-coral"
                        : r.liq > 0
                          ? "bg-st-depeg/25 group-hover:bg-st-depeg/40"
                          : "bg-white/[0.06]",
                    )}
                    style={{ height: h }}
                  />
                  <span
                    className={cn(
                      "font-mono text-[12px] tabular-nums transition-colors duration-200",
                      active
                        ? "font-medium text-text"
                        : "text-text-caption group-hover:text-text-muted",
                    )}
                  >
                    {shockLabel(r.bps)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer — context + honest floor, one quiet line */}
      <div className="flex flex-col gap-2 border-t border-hairline-soft px-5 py-4 text-[11px] leading-relaxed text-text-caption sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <span>
          <span className="font-mono uppercase tracking-[0.08em]">
            Total leverage
          </span>{" "}
          <span className="font-mono tabular-nums text-text-muted">
            {usdCompact(entry.exposureUsd)}
          </span>{" "}
          across {protoList(entry.systemic.protocols)}
        </span>
        <span className="max-w-[52ch] sm:text-right">
          Advisory estimate · k-anonymised, no wallets read · 2 of ~6 venues.
          an honest floor, not a ceiling.
        </span>
      </div>
    </div>
  );
}

// ── Dropdown token picker ─────────────────────────────────────────────────────
function TokenPicker({
  entry,
  entries,
  onPick,
}: {
  entry: SystemicEntry;
  entries: SystemicEntry[];
  onPick: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const sym = displaySymbol(entry.symbol);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2.5 rounded-full border py-2 pl-2.5 pr-3 transition-colors",
          open
            ? "border-outline bg-surface-2"
            : "border-hairline hover:border-outline",
        )}
      >
        <TokenIcon
          mint={entry.mint}
          symbol={sym}
          klass={entry.class}
          size={24}
        />
        <span className="font-mono text-[14px] font-medium text-text">
          {sym}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-text-caption">
          {usdCompact(entry.exposureUsd)}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          className={cn(
            "text-text-caption transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+8px)] z-30 max-h-[340px] w-[300px] overflow-y-auto rounded-[14px] border border-outline bg-surface-2 p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
        >
          {entries.map((e) => {
            const active = e.symbol === entry.symbol;
            return (
              <button
                key={e.symbol}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onPick(e.symbol);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                  active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                )}
              >
                <TokenIcon
                  mint={e.mint}
                  symbol={displaySymbol(e.symbol)}
                  klass={e.class}
                  size={20}
                />
                <span className="flex-1 truncate font-mono text-[13px] text-text">
                  {displaySymbol(e.symbol)}
                </span>
                {e.hasCascade ? (
                  <span className="font-mono text-[11px] tabular-nums text-st-depeg-text">
                    {usdCompact(e.peakLiquidatableUsd)}
                  </span>
                ) : e.systemic.coverage === "full" ? (
                  <span className="font-mono text-[11px] tabular-nums text-text-caption">
                    $0
                  </span>
                ) : (
                  <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-caption">
                    pending
                  </span>
                )}
                <span className="w-[52px] text-right font-mono text-[11px] tabular-nums text-text-caption">
                  {usdCompact(e.exposureUsd)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Ranked table (clean, logo-forward, subtle dividers) ───────────────────────
function SystemicTable({
  entries,
  selectedSymbol,
  onSelect,
}: {
  entries: SystemicEntry[] | undefined;
  selectedSymbol?: string;
  onSelect: (symbol: string) => void;
}) {
  if (!entries) {
    return (
      <div className="space-y-px overflow-hidden rounded-[16px] border border-hairline">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[52px] skeleton-sheen bg-text/[0.03]" />
        ))}
      </div>
    );
  }
  return (
    <>
      {/* Mobile card list. This was the ONLY data table in the app without one:
          every comparable surface (dashboard board, assets screener,
          account/alerts) ships a `sm:hidden` card list beside a
          `hidden sm:block` table, while this one left a min-w-[560px] table to
          scroll sideways inside its own box at 390px — so "Peak cascade" and
          "Venues" were only reachable by dragging a small inner pane, on the
          page whose entire job is a ranked comparison. Note the page-level
          scroll guard in tests/e2e/mobile-shell.spec.ts cannot catch this: the
          overflow is trapped inside `overflow-x-auto`, so the document's
          scrollWidth never grows. */}
      <ul className="divide-y divide-hairline-soft overflow-hidden rounded-[16px] border border-hairline sm:hidden">
        {entries.map((e) => {
          const active = e.symbol === selectedSymbol;
          return (
            <li key={e.symbol}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`Model the depeg cascade for ${e.symbol}`}
                onClick={() => onSelect(e.symbol)}
                className={cn(
                  "flex w-full flex-col gap-2 px-4 py-3 text-left transition-[background-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text",
                  active && "bg-white/[0.04]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <TokenIcon
                    mint={e.mint}
                    symbol={displaySymbol(e.symbol)}
                    klass={e.class}
                    size={22}
                  />
                  <span className="truncate font-mono text-[13.5px] font-medium text-text">
                    {displaySymbol(e.symbol)}
                  </span>
                  {e.state && (
                    <StatePip state={e.state as PegState} size={5} announce />
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[13.5px] tabular-nums text-text">
                    {usdCompact(e.exposureUsd)}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] text-text-caption">
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="uppercase tracking-[0.08em]">Peak</span>
                    {e.hasCascade ? (
                      <span className="text-[12.5px] tabular-nums text-st-depeg-text">
                        {usdCompact(e.peakLiquidatableUsd)}
                      </span>
                    ) : e.systemic.coverage === "full" ? (
                      <span className="text-[12.5px] tabular-nums">$0</span>
                    ) : (
                      <span className="text-[12.5px]">pending</span>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[11.5px] text-text-muted">
                    {protoList(e.systemic.protocols)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-[16px] border border-hairline sm:block">
      <table
        aria-label="Leveraged collateral by token, select a row to model its cascade"
        className="w-full min-w-[560px] table-fixed border-collapse"
      >
        <colgroup>
          <col className="w-[38%]" />
          <col className="w-[20%]" />
          <col className="w-[20%]" />
          <col className="w-[22%]" />
        </colgroup>
        <thead>
          <tr className="text-left">
            <Th>Token</Th>
            <Th align="right">Leverage</Th>
            <Th align="right">Peak cascade</Th>
            <Th>Venues</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const active = e.symbol === selectedSymbol;
            return (
              // Selecting a row is THE interaction on this page — it chooses
              // which asset's cascade is modelled — and it was a bare
              // `<tr onClick>`: no role, no tabIndex, no key handler, so it was
              // unreachable by keyboard and invisible to assistive tech.
              // `role="button"` + `tabIndex` + Enter/Space honours the ARIA
              // contract (a role="button" that ignores Enter/Space is worse
              // than no role at all), and aria-pressed exposes the selection.
              <tr
                key={e.symbol}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`Model the depeg cascade for ${e.symbol}`}
                onClick={() => onSelect(e.symbol)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelect(e.symbol);
                  }
                }}
                className={cn(
                  "cursor-pointer border-t border-hairline-soft transition-[background-color] duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text",
                  active && "bg-white/[0.04]",
                )}
              >
                <td className="px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <TokenIcon
                      mint={e.mint}
                      symbol={displaySymbol(e.symbol)}
                      klass={e.class}
                      size={22}
                    />
                    <span className="truncate font-mono text-[13.5px] font-medium text-text">
                      {displaySymbol(e.symbol)}
                    </span>
                    {e.state && (
                      <StatePip state={e.state as PegState} size={5} announce />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-[13.5px] tabular-nums text-text sm:px-5">
                  {usdCompact(e.exposureUsd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-[13.5px] tabular-nums sm:px-5">
                  {e.hasCascade ? (
                    <span className="text-st-depeg-text">
                      {usdCompact(e.peakLiquidatableUsd)}
                    </span>
                  ) : e.systemic.coverage === "full" ? (
                    <span className="text-text-caption">$0</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-text-caption">
                      pending
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12.5px] text-text-muted sm:px-5">
                  {protoList(e.systemic.protocols)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-surface-2/40 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption sm:px-5",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}
