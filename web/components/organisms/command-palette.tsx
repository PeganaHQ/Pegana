"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive } from "@/lib/store/live-context";
import { useWatchlist } from "@/lib/store/watchlist";
import { reconcileBps, holderSignedPct, isDeprecated } from "@/lib/api/format";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import {
  spreadSignClass } from "@/lib/state-class";
import { StatePip } from "@/components/atoms/state-pip";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { PegState } from "@/lib/api/types";

// Global Cmd-K / Ctrl-K command palette: jump to any asset or surface in under a
// second. The power-user companion to the dashboard's inline `/` filter. Mounted
// once in the app shell. Editorial dark register — rounded modal corners (matches
// onboarding-modal's card language), coral active accent, mono reserved for the
// spread number + kbd hints (brand law). It also opens from a touch icon in the
// mobile topbar, so below `sm` it swaps the keyboard-only affordances (Esc kbd,
// footer hints) for a tappable close button instead.

const OPEN_EVENT = "pegana:command-open";

/** Fire-and-forget opener so a topbar button (or anything) can launch the palette. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const ACTIONS = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    hint: "Live 3-pane workbench",
  },
  {
    id: "assets",
    label: "Assets screener",
    href: "/assets",
    hint: "Sort & scan the universe",
  },
  {
    id: "events",
    label: "Events",
    href: "/events",
    hint: "Peg-state transition feed",
  },
  {
    id: "compare",
    label: "Compare",
    href: "/compare",
    hint: "Overlay up to 4 assets",
  },
  {
    id: "status",
    label: "Status",
    href: "/status",
    hint: "Engine & delivery health",
  },
] as const;

type Item =
  | { kind: "action"; key: string; label: string; hint: string; href: string }
  | {
      kind: "asset";
      key: string;
      symbol: string;
      name: string;
      href: string;
      state: PegState;
      bps: number | null;
    }
  | { kind: "verb"; key: string; label: string; run: () => void };

/** Cap on verb rows shown per query — 3 matched assets × 2 verbs each. Keeps
 *  the "Actions" group scannable instead of flooding the list with 63×2 rows
 *  when the query is broad. */
const MAX_VERB_ASSETS = 3;

export function CommandPalette() {
  const router = useRouter();
  const { data: assets } = useAssets();
  const { byAsset, connected } = useLive();
  const { has: inWatchlist, toggle: toggleWatchlist } = useWatchlist();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus when the palette opened, so closing can hand it back.
  // Without this, Escape dropped focus to <body>: a keyboard user who opened
  // Cmd-K, changed their mind and pressed Escape was returned to the top of the
  // document and had to Tab from the skip-link again. Verified on production.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 30s-ticking wall clock for the H1/H9 freshness gate, mirroring
  // use-screener-state.ts — so an asset that goes silent visibly degrades to
  // UNKNOWN here instead of the palette showing a frozen state as confirmed.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Global open: Cmd/Ctrl-K, plus the custom event for explicit triggers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset query + selection + any stale confirmation each time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setAnnounce("");
    }
  }, [open]);

  // Remember the invoker on open; restore it on close. Skipped when the palette
  // closed because it navigated somewhere — the destination owns focus then,
  // and yanking it back to a control on the page being left is worse than
  // dropping it. `preventScroll` so the restore never jumps the viewport.
  useEffect(() => {
    if (open) {
      const el = document.activeElement;
      restoreFocusRef.current =
        el instanceof HTMLElement && el !== document.body ? el : null;
      return;
    }
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!target || !target.isConnected) return;
    target.focus({ preventScroll: true });
  }, [open]);

  const { actions, assetItems } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const actions: Item[] = ACTIONS.filter(
      (a) =>
        !q ||
        a.label.toLowerCase().includes(q) ||
        a.hint.toLowerCase().includes(q),
    ).map((a) => ({
      kind: "action",
      key: `a:${a.id}`,
      label: a.label,
      hint: a.hint,
      href: a.href,
    }));

    const assetItems: Item[] = (assets ?? [])
      .filter((a) => !isDeprecated(a.symbol))
      .filter(
        (a) =>
          !q ||
          `${a.symbol} ${displaySymbol(a.symbol)} ${a.name} ${a.class}`
            .toLowerCase()
            .includes(q),
      )
      .slice(0, q ? 60 : 8)
      .map((a) => {
        // Only trust the live WS frame while `connected` — a frozen frame on a
        // dropped socket must not shadow the fresher REST snapshot (H1/H9).
        const live = connected ? byAsset[a.symbol] : undefined;
        const state = effectiveState(live, a, now);
        // Null the spread when the effective snapshot is KNOWN-stale so the row
        // renders "—" instead of a frozen number read as a confirmed reading.
        const stale = isStale(live?.updated_at ?? a.updated_at, now);
        const bps = stale
          ? null
          : reconcileBps({
              discount: live?.discount ?? a.discount,
              intrinsic_usd: a.intrinsic_usd,
              market_usd: a.market_usd,
            }).bps;
        return {
          kind: "asset" as const,
          key: `s:${a.symbol}`,
          symbol: a.symbol,
          name: a.name,
          href: `/asset/${encodeURIComponent(a.symbol)}`,
          state,
          bps,
        };
      });

    return { actions, assetItems };
  }, [assets, byAsset, connected, now, query]);

  // Per-asset verbs — only surfaced once the query actually matches specific
  // assets (never on the default top-8 list), and capped so a broad query
  // can't flood the list with 63×2 rows. One "Actions" group, ~6 rows max.
  const verbItems = useMemo<Item[]>(() => {
    if (!query.trim()) return [];
    const targets = assetItems
      .filter((i): i is Extract<Item, { kind: "asset" }> => i.kind === "asset")
      .slice(0, MAX_VERB_ASSETS);
    const out: Item[] = [];
    for (const a of targets) {
      const watched = inWatchlist(a.symbol);
      const shown = displaySymbol(a.symbol);
      out.push({
        kind: "verb",
        key: `v:watch:${a.symbol}`,
        label: watched
          ? `Remove ${shown} from watchlist`
          : `Add ${shown} to watchlist`,
        run: () => {
          toggleWatchlist(a.symbol);
          setAnnounce(
            watched
              ? `${shown} removed from watchlist`
              : `${shown} added to watchlist`,
          );
        },
      });
      out.push({
        kind: "verb",
        key: `v:compare:${a.symbol}`,
        label: `Compare ${shown}…`,
        run: () => router.push(`/compare?s=${encodeURIComponent(a.symbol)}`),
      });
    }
    return out.slice(0, MAX_VERB_ASSETS * 2);
  }, [assetItems, query, inWatchlist, toggleWatchlist, router]);

  const flat = useMemo(
    () => [...actions, ...assetItems, ...verbItems],
    [actions, assetItems, verbItems],
  );

  // Keep the active index in range as results change.
  useEffect(() => {
    setActive((i) => Math.min(Math.max(i, 0), Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  // Scroll the active row into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const select = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "verb") {
      const isWatchVerb = item.key.startsWith("v:watch:");
      item.run();
      // Watchlist toggles announce before the dialog unmounts the aria-live
      // region — never a silent mutation. Navigation verbs (Compare) close
      // immediately; the destination page is confirmation enough.
      if (isWatchVerb) {
        window.setTimeout(() => setOpen(false), 450);
      } else {
        setOpen(false);
      }
      return;
    }
    setOpen(false);
    router.push(item.href);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(flat[active]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] left-1/2 grid translate-y-0 gap-0 overflow-hidden rounded-[20px] p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          // Let the search input keep focus; radix would focus the first child.
          e.preventDefault();
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLInputElement>("input")
            ?.focus();
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-text-caption" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to an asset or page…"
            aria-label="Search assets and pages"
            aria-expanded
            aria-controls="cmdk-list"
            aria-activedescendant={flat[active] ? `cmdk-${active}` : undefined}
            role="combobox"
            className="w-full bg-transparent text-[15px] text-text placeholder:text-text-caption focus:outline-none"
          />
          {/* Touch has no Esc key and no visible close otherwise (the shared
              DialogContent close button is disabled above) — a tappable X
              stands in below `sm`. Desktop keeps the keyboard-only Esc kbd
              exactly as before. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close command palette"
            className="inline-flex size-11 shrink-0 items-center justify-center text-text-caption transition-colors hover:text-text sm:hidden"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
          <kbd className="hidden shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption sm:inline">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="cmdk-list"
          role="listbox"
          aria-label="Results"
          className="scrollbar-clean max-h-[min(60vh,380px)] overflow-y-auto py-2"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-text-muted">
              No results for <span className="text-text">“{query.trim()}”</span>
              .
            </div>
          ) : (
            <>
              {actions.length > 0 && <GroupLabel>Go to</GroupLabel>}
              {actions.map((item) => {
                const idx = flat.indexOf(item);
                return (
                  <Row
                    key={item.key}
                    idx={idx}
                    active={active === idx}
                    onHover={() => setActive(idx)}
                    onSelect={() => select(item)}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-text-caption"
                      aria-hidden
                    >
                      <IconArrowRight size={12} />
                    </span>
                    <span className="text-[14px] text-text">
                      {(item as Extract<Item, { kind: "action" }>).label}
                    </span>
                    <span className="ml-auto truncate text-[12px] text-text-caption">
                      {(item as Extract<Item, { kind: "action" }>).hint}
                    </span>
                  </Row>
                );
              })}

              {assetItems.length > 0 && <GroupLabel>Assets</GroupLabel>}
              {assetItems.map((item) => {
                const a = item as Extract<Item, { kind: "asset" }>;
                const idx = flat.indexOf(item);
                return (
                  <Row
                    key={item.key}
                    idx={idx}
                    active={active === idx}
                    onHover={() => setActive(idx)}
                    onSelect={() => select(item)}
                  >
                    <StatePip state={a.state} pulse={false} size={6} />
                    <span className="text-[14px] font-medium text-text">
                      {displaySymbol(a.symbol)}
                    </span>
                    <span className="truncate text-[13px] text-text-muted">
                      {a.name}
                    </span>
                    <span
                      className={cn(
                        "ml-auto font-mono text-[12px] tabular-nums",
                        a.bps == null
                          ? "text-text-caption"
                          : spreadSignClass(a.bps),
                      )}
                    >
                      {a.bps != null ? holderSignedPct(a.bps) : "-"}
                    </span>
                  </Row>
                );
              })}

              {verbItems.length > 0 && <GroupLabel>Actions</GroupLabel>}
              {verbItems.map((item) => {
                const v = item as Extract<Item, { kind: "verb" }>;
                const idx = flat.indexOf(item);
                return (
                  <Row
                    key={item.key}
                    idx={idx}
                    active={active === idx}
                    onHover={() => setActive(idx)}
                    onSelect={() => select(item)}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-text-caption"
                      aria-hidden
                    >
                      <IconArrowRight size={12} />
                    </span>
                    <span className="text-[14px] text-text">{v.label}</span>
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
                      ↵ run
                    </span>
                  </Row>
                );
              })}
            </>
          )}
        </div>

        {/* Verb confirmation — visually rendered AND aria-live, so a
            watchlist toggle from the palette is never a silent mutation
            (matches the pin button's own on-page feedback pattern). */}
        {announce && (
          <div
            role="status"
            aria-live="polite"
            className="border-t border-hairline px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text"
          >
            {announce}
          </div>
        )}

        {/* Footer hint — keyboard-only affordances, irrelevant (and
            misleading) on a touch device, so it's desktop-only. */}
        <div className="hidden items-center gap-4 border-t border-hairline px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption sm:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-text-caption">
      {children}
    </div>
  );
}

function Row({
  idx,
  active,
  onHover,
  onSelect,
  children,
}: {
  idx: number;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={`cmdk-${idx}`}
      data-idx={idx}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100",
        active
          ? "bg-surface-2 before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:bg-coral"
          : "hover:bg-surface-2/50",
      )}
    >
      {children}
    </button>
  );
}
