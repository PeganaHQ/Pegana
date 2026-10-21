"use client";

import { memo, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Check, ChevronsUpDown, Copy } from "lucide-react";
import { TokenIcon } from "@/components/atoms/token-icon";
import { cn } from "@/lib/utils/cn";
import { tokenIconUrl } from "@/lib/static-assets";
import { api } from "@/lib/api/client";
import { wsUrl } from "@/lib/api/base";
import { createWsClient } from "@/lib/api/ws";
import { useAssets } from "@/lib/hooks/use-assets";
import { formatThreshold, thresholdsFor } from "@/lib/alerts/policy";
import { STALE_AFTER_MS, ageMs, isStale } from "@/lib/asset/freshness";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { discountToBps, holderSignedPct } from "@/lib/api/format";
import { CURATED_TOKENS, DEFAULT_TOKEN, type CuratedToken } from "@/lib/landing/curated-tokens";
import { stateReasonLabel } from "@/lib/asset/state-reason";
import { relativeStamp } from "@/lib/asset/relative-stamp";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { useCopy } from "@/lib/landing/use-copy";
import {
  formatUsd,
  markerPercent,
  requestLine,
  scaleBands,
  type SurfaceId,
} from "@/lib/landing/verdict-scale";
import type { AssetCardData, PegState } from "@/lib/api/types";

// DESIGN.md §5.4 - "Ask it yourself". A live verdict, not documentation: pick
// an asset and the section shows what the API says right now. The four open
// surfaces are a single quiet line underneath.
//
// Data path: the app's own `api` client (same SWR cache key the hero board
// uses for the asset list), polled every 30s (every 60s while the WebSocket
// is live), plus the app's existing `createWsClient` for sub-second updates. On Vercel previews the API base
// resolves through lib/api/base.ts exactly as the live board does.

// 30s, not 10s: at 10s this one card cost 6 of a tab's API requests per
// minute against what was then a 60/min per-IP budget (measured 2026-10-21;
// production is now 240/min). While the
// socket is live, frames carry the updates and REST only backstops them.
const POLL_MS = 30_000;
const POLL_WHILE_LIVE_MS = 60_000;
const WS_MAX_FAILURES = 3;

const VALID_STATES: ReadonlySet<string> = new Set([
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
]);

const STATE_VAR: Record<string, string> = {
  PEGGED: "var(--v2-peg)",
  DRIFT: "var(--v2-drift)",
  DEPEG: "var(--v2-depeg)",
  CRITICAL: "var(--v2-crit)",
  BLACK_SWAN: "var(--v2-crit)",
  UNKNOWN: "var(--v2-unk)",
};

const BAND_VAR: Record<string, string> = {
  pegged: "var(--v2-peg)",
  drift: "var(--v2-drift)",
  depeg: "var(--v2-depeg)",
  critical: "var(--v2-crit)",
};

const SURFACES: Array<{ id: SurfaceId; label: string }> = [
  { id: "rest", label: "REST" },
  { id: "ws", label: "WS" },
  { id: "mcp", label: "MCP" },
  { id: "cli", label: "CLI" },
];

interface Live {
  state?: PegState;
  discount?: string;
  intrinsic_usd?: string;
  market_usd?: string;
  updated_at?: string;
}

function narrow(payload: Record<string, unknown>): Live {
  const out: Live = {};
  if (typeof payload.state === "string" && VALID_STATES.has(payload.state))
    out.state = payload.state as PegState;
  if (typeof payload.discount === "string") out.discount = payload.discount;
  if (typeof payload.intrinsic_usd === "string")
    out.intrinsic_usd = payload.intrinsic_usd;
  if (typeof payload.market_usd === "string")
    out.market_usd = payload.market_usd;
  if (typeof payload.updated_at === "string")
    out.updated_at = payload.updated_at;
  return out;
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** True once the element has scrolled into view (and stays true). */
function useSeen(el: HTMLElement | null): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  return seen;
}

/** The selected asset's snapshot: REST poll plus live WebSocket frames. */
function useLiveVerdict(
  symbol: string,
  seed: AssetCardData | undefined,
  wsEnabled: boolean,
) {
  const socketRef = useRef<"connecting" | "live" | "polling">("connecting");
  const rest = useSWR<AssetCardData>(
    `landing-verdict/${symbol}`,
    () => api.asset(symbol),
    {
      refreshInterval: () =>
        socketRef.current === "live" ? POLL_WHILE_LIVE_MS : POLL_MS,
      shouldRetryOnError: false,
      keepPreviousData: false,
    },
  );
  const [frame, setFrame] = useState<{ symbol: string; live: Live } | null>(
    null,
  );
  const [socket, setSocket] = useState<"connecting" | "live" | "polling">(
    "connecting",
  );
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);
  const symbolRef = useRef(symbol);
  const clientRef = useRef<ReturnType<typeof createWsClient> | null>(null);
  const openRef = useRef(false);

  // ONE socket for the section, opened only once it has been seen. Token
  // changes never reconnect: they swap the subscription on the live socket.
  useEffect(() => {
    if (!wsEnabled) return;
    if (typeof WebSocket === "undefined") {
      setSocket("polling");
      return;
    }
    let active = true;
    let failures = 0;
    let everOpened = false;
    const client = createWsClient(wsUrl(), {
      onUpdate: (asset, payload) => {
        if (!active || asset !== symbolRef.current) return;
        setFrame({ symbol: asset, live: narrow(payload) });
      },
      onOpen: () => {
        if (!active) return;
        everOpened = true;
        openRef.current = true;
        client.send({ op: "subscribe", assets: [symbolRef.current] });
        setSocket("live");
      },
      onClose: () => {
        if (!active) return;
        openRef.current = false;
        setSocket("polling");
        // Give up only when the handshake has NEVER completed (e.g. a Vercel
        // preview origin refused with 403). A socket that was once open keeps
        // reconnecting through createWsClient's own backoff.
        if (!everOpened) {
          failures += 1;
          if (failures >= WS_MAX_FAILURES) client.disconnect();
        }
      },
      onStale: () => {
        if (active) setSocket("polling");
      },
    });
    clientRef.current = client;
    client.connect();
    return () => {
      active = false;
      openRef.current = false;
      clientRef.current = null;
      client.disconnect();
    };
  }, [wsEnabled]);

  // Swap the subscription when the token changes.
  useEffect(() => {
    const prev = symbolRef.current;
    symbolRef.current = symbol;
    const client = clientRef.current;
    if (client && openRef.current && prev !== symbol) {
      client.send({ op: "unsubscribe", assets: [prev] });
      client.send({ op: "subscribe", assets: [symbol] });
    }
  }, [symbol]);

  const base = rest.data ?? (seed?.symbol === symbol ? seed : undefined);
  const live = frame?.symbol === symbol ? frame.live : undefined;
  // A socket frame only wins when it is newer than the REST snapshot.
  const useFrame =
    live?.updated_at != null &&
    (base?.updated_at == null ||
      Date.parse(live.updated_at) >= Date.parse(base.updated_at));
  const merged: AssetCardData | undefined = base
    ? { ...base, ...(useFrame ? live : {}) }
    : undefined;
  return {
    asset: merged,
    isLoading: !merged && !rest.error,
    error: !merged && rest.error ? true : false,
    refreshFailed: Boolean(rest.error && merged),
    retry: () => void rest.mutate(),
    socket,
  };
}

/** Off-screen (not display:none) eager copies of the picker icons, decoded
 *  ahead of time. The popover tiles use the identical src, so they paint from
 *  the decoded cache on first open. The picker itself still mounts on open. */
const IconPreload = memo(function IconPreload() {
  const box = useRef<HTMLDivElement | null>(null);
  // Decode once on mount (the parent re-renders every second via useNow).
  useEffect(() => {
    box.current?.querySelectorAll("img").forEach((img) => {
      void img.decode?.().catch(() => {});
    });
  }, []);
  return (
    <div
      ref={box}
      aria-hidden
      data-testid="icon-preload"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {CURATED_TOKENS.map((t) => (
        <img
          key={t.mint}
          src={tokenIconUrl(t.mint)}
          alt=""
          loading="eager"
          decoding="sync"
        />
      ))}
    </div>
  );
});

const HOVER_OPEN_MS = 100;
const HOVER_CLOSE_MS = 200;

/** Hover popover anchored to the token chip, rendered above the selector. */
function TokenPicker({
  value,
  list,
  container,
  onChange,
}: {
  value: CuratedToken;
  list: AssetCardData[];
  container: HTMLElement | null;
  onChange: (t: CuratedToken) => void;
}) {
  const [open, setOpen] = useState(false);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<string>("");
  const focusGrid = useRef(false);
  const returnFocus = useRef(false);
  const now = Date.now();

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const later = (to: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => {
      // Never hover-close under keyboard focus.
      if (!to && contentRef.current?.contains(document.activeElement)) return;
      setOpen(to);
    }, ms);
  };
  const hoverIn = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    later(true, HOVER_OPEN_MS);
  };
  const hoverOut = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    later(false, HOVER_CLOSE_MS);
  };

  const selectedIdx = Math.max(
    0,
    CURATED_TOKENS.findIndex((t) => t.mint === value.mint),
  );

  // Esc / selection hand focus back to the chip after the panel unmounts.
  // Keyboard-open focus goes through onOpenAutoFocus, which runs once the
  // portalled panel (and so the tile refs) actually exists.
  useEffect(() => {
    if (!open && returnFocus.current) {
      chipRef.current?.focus();
      returnFocus.current = false;
    }
  }, [open, selectedIdx]);

  function openFromKeyboard() {
    clear();
    focusGrid.current = true;
    setFocusIdx(selectedIdx);
    setOpen(true);
  }

  function onGridKey(e: React.KeyboardEvent, i: number) {
    const n = CURATED_TOKENS.length;
    const top = refs.current[0]?.offsetTop ?? 0;
    const cols = Math.max(
      1,
      refs.current.filter((r) => r && r.offsetTop === top).length,
    );
    let next = i;
    if (e.key === "ArrowRight") next = Math.min(n - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "ArrowDown") next = Math.min(n - 1, i + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, i - cols);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Tab") {
      // The panel is portalled to the end of the section: hand focus back to
      // the chip so Tab continues in natural order (Shift+Tab stays on it).
      if (e.shiftKey) e.preventDefault();
      setOpen(false);
      chipRef.current?.focus();
      return;
    } else return;
    e.preventDefault();
    setFocusIdx(next);
    refs.current[next]?.focus();
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        // A kept-mounted (closed) layer also reports dismissals: ignore them.
        if (!o && !open) return;
        clear();
        if (!o) focusGrid.current = false;
        setOpen(o);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={chipRef}
          type="button"
          aria-label={`${displaySymbol(value.symbol)}. Change token`}
          aria-haspopup="dialog"
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
          }}
          onPointerEnter={hoverIn}
          onPointerLeave={(e) => {
            // Touch fires pointerleave BEFORE click; only a mouse resets here.
            if (e.pointerType === "mouse") pointer.current = "";
            hoverOut(e);
          }}
          onBlur={() => {
            pointer.current = "";
          }}
          onClick={(e) => {
            // Take over Radix's toggle: hover already opened it for a mouse.
            e.preventDefault();
            clear();
            if (pointer.current === "mouse") {
              setOpen(true);
            } else if (pointer.current === "") {
              // keyboard activation (Enter / Space)
              if (open) setOpen(false);
              else openFromKeyboard();
            } else {
              setOpen((o) => !o);
            }
            pointer.current = "";
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (open) refs.current[selectedIdx]?.focus();
              else openFromKeyboard();
            }
          }}
          className="group flex min-h-[56px] w-full items-center gap-3 rounded-[12px] border border-[var(--v2-line2)] bg-[var(--v2-bg2)] px-3 py-2 text-left transition-colors duration-200 hover:border-[var(--v2-text)] focus-visible:border-[var(--v2-text)] focus-visible:outline-2 focus-visible:outline-[var(--v2-text)]"
        >
          <TokenIcon
            mint={value.mint}
            symbol={value.symbol}
            klass={value.klass}
            size={36}
            loading="eager"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[16px] text-[var(--v2-text)]">
            {displaySymbol(value.symbol)}
          </span>
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-[var(--v2-dim)] transition-colors group-hover:text-[var(--v2-text)]"
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          ref={contentRef}
          // On top of the selector, per the owner. Radix flips to the bottom
          // when there is no room above.
          side="top"
          align="start"
          sideOffset={0}
          collisionPadding={16}
          avoidCollisions
          aria-label="Choose a token"
          onPointerEnter={() => clear()}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") later(false, HOVER_CLOSE_MS);
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            if (focusGrid.current) refs.current[selectedIdx]?.focus();
            focusGrid.current = false;
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={() => {
            if (open) returnFocus.current = true;
          }}
          className="z-[80] max-w-[var(--radix-popover-content-available-width)] pb-2 outline-none data-[side=bottom]:pb-0 data-[side=bottom]:pt-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=top]:data-[state=open]:slide-in-from-bottom-1 data-[side=bottom]:data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150 motion-reduce:animate-none"
        >
          {/* The pb-2 / pt-2 above is a transparent hover bridge between the
              chip and the panel, so a diagonal move never closes it. */}
          <div
            role="group"
            aria-label="Tokens"
            className="grid w-[min(400px,calc(100vw-32px))] max-w-full grid-cols-4 gap-1.5 rounded-[14px] border border-[var(--v2-line2)] bg-[var(--v2-panel2)] p-2 shadow-[0_18px_50px_rgba(0,0,0,.5)]"
          >
            {CURATED_TOKENS.map((t, i) => {
              const row = list.find((a) => a.symbol === t.symbol);
              const fresh =
                row && !isStale(row.updated_at, now) ? row.state : null;
              const dot =
                fresh && fresh !== "UNKNOWN" ? STATE_VAR[fresh] : null;
              const selected = t.mint === value.mint;
              return (
                <button
                  key={t.mint}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  aria-pressed={selected}
                  tabIndex={i === focusIdx ? 0 : -1}
                  onKeyDown={(e) => onGridKey(e, i)}
                  onFocus={() => setFocusIdx(i)}
                  onClick={() => {
                    returnFocus.current = true;
                    onChange(t);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex min-w-0 flex-col items-center gap-1.5 rounded-[10px] border px-1 py-2.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-[var(--v2-text)]",
                    selected
                      ? "border-[var(--v2-text)] bg-white/[0.06]"
                      : "border-transparent hover:bg-white/[0.05]",
                  )}
                >
                  <TokenIcon
                    mint={t.mint}
                    symbol={t.symbol}
                    klass={t.klass}
                    size={32}
                    loading="eager"
                  />
                  <span className="max-w-full truncate font-mono text-[12px] text-[var(--v2-text)]">
                    {displaySymbol(t.symbol)}
                  </span>
                  {dot && (
                    <span
                      aria-hidden
                      data-testid={`dot-${t.symbol}`}
                      className="absolute right-1.5 top-1.5 size-1.5 rounded-full"
                      style={{ background: dot }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function ThresholdScale({
  bps,
  thresholds,
  state,
}: {
  bps: number | null;
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number };
  state: string;
}) {
  const bands = scaleBands(thresholds);
  const pos = bps == null ? null : markerPercent(bps, thresholds);
  const edges = [
    { label: "drift", bps: thresholds.drift_bps, at: bands[1].from },
    { label: "depeg", bps: thresholds.depeg_bps, at: bands[2].from },
    { label: "critical", bps: thresholds.critical_bps, at: bands[3].from },
  ];
  return (
    <div className="min-w-0">
      <div
        role="img"
        aria-label={
          bps == null
            ? "Threshold scale. No live discount to place."
            : `Threshold scale. Discount ${formatThreshold(Math.abs(bps))}, state ${state}. Drift from ${formatThreshold(thresholds.drift_bps)}, depeg from ${formatThreshold(thresholds.depeg_bps)}, critical from ${formatThreshold(thresholds.critical_bps)}.`
        }
        className="relative h-3 w-full"
      >
        {bands.map((b) => (
          <span
            key={b.id}
            className="absolute inset-y-0"
            style={{
              left: `${b.from}%`,
              width: `${b.to - b.from}%`,
              background: BAND_VAR[b.id],
              opacity: b.id === "pegged" ? 0.28 : 0.42,
            }}
          />
        ))}
        {pos != null && (
          <span
            data-testid="scale-marker"
            data-percent={pos.toFixed(2)}
            className="absolute -top-1.5 h-[24px] w-[3px] -translate-x-1/2 rounded-full bg-[var(--v2-text)] transition-[left] duration-200"
            style={{ left: `${pos}%` }}
          />
        )}
      </div>
      <div className="relative mt-2 h-9 font-mono text-[12px] text-[var(--v2-dim)]">
        <span className="absolute left-0">0</span>
        {edges.map((e) => (
          <span
            key={e.label}
            className="absolute -translate-x-1/2 text-center tabular-nums"
            style={{ left: `${e.at}%` }}
          >
            <span className="block">{formatThreshold(e.bps)}</span>
            <span className="block">{e.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProductTabsV2() {
  const [token, setToken] = useState<CuratedToken>(DEFAULT_TOKEN);
  const symbol = token.symbol;
  const [sectionEl, setSectionEl] = useState<HTMLElement | null>(null);
  const seen = useSeen(sectionEl);

  const [surface, setSurface] = useState<SurfaceId>("rest");
  const { data: list } = useAssets();
  const seed = list?.find((a) => a.symbol === symbol);
  const { asset, isLoading, error, refreshFailed, retry, socket } =
    useLiveVerdict(symbol, seed, seen);
  const now = useNow();
  const copy = useCopy();

  const h2 = useRevealV2<HTMLHeadingElement>({ index: 0 });
  const lead = useRevealV2<HTMLParagraphElement>({ index: 1 });
  const chrome = useRevealV2<HTMLDivElement>({ index: 2 });

  const stale =
    asset != null &&
    (ageMs(asset.updated_at, now) ?? 0) > STALE_AFTER_MS;
  const state: string = !asset || stale ? "UNKNOWN" : (asset.state ?? "UNKNOWN");
  // `discount` is the raw methodology sign (premium negative). The display
  // goes through holderSignedPct, the same helper the asset page uses.
  const rawBps = asset && !stale ? discountToBps(asset.discount) : null;
  const bps = rawBps;
  const thresholds = asset
    ? thresholdsFor(asset.symbol, asset.class, asset.thresholds)
    : null;
  const line = requestLine(surface, symbol);
  const stamp = asset?.updated_at
    ? relativeStamp(asset.updated_at, now)
    : undefined;
  const reason = asset ? stateReasonLabel(asset.state_reason) : null;

  return (
    <section ref={setSectionEl} className="py-[110px]" id="product">
      {seen && <IconPreload />}
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <h2
          ref={h2.ref}
          style={h2.style}
          className="text-balance text-[clamp(30px,4.2vw,50px)] font-medium leading-[1.05] tracking-[-0.022em]"
        >
          One verdict, four open surfaces.
        </h2>
        <p
          ref={lead.ref}
          style={lead.style}
          className="mt-[18px] max-w-[56ch] text-[17px] leading-[1.62] text-[var(--v2-muted)]"
        >
          Pick an asset and ask it. This is the verdict the API returns right
          now, not a screenshot.
        </p>

        <div
          ref={chrome.ref}
          style={chrome.style}
          className="mt-[34px] min-w-0 rounded-[20px] border border-[var(--v2-line)] bg-[var(--v2-panel)]"
        >
          <div className="grid min-w-0 gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-10">
            <div className="min-w-0">
              <TokenPicker
                value={token}
                list={list ?? []}
                container={sectionEl}
                onChange={setToken}
              />
              <p
                className="mt-4 font-mono text-[12px] leading-[1.7] text-[var(--v2-dim)]"
              >
                {asset?.updated_at ? (
                  <>
                    updated {stamp ?? "recently"}
                    <br />
                    {socket === "live"
                      ? "live over WebSocket"
                      : `polling every ${POLL_MS / 1000}s`}
                  </>
                ) : (
                  "waiting for the first reading"
                )}
              </p>
            </div>

            <div className="min-w-0" data-testid="verdict" aria-busy={isLoading}>
              {isLoading && (
                <p className="text-[15px] text-[var(--v2-muted)]">
                  Loading the live verdict...
                </p>
              )}
              {error && (
                <div role="alert" className="text-[15px] text-[var(--v2-body)]">
                  Could not reach the API for {displaySymbol(symbol)}.
                  <button
                    type="button"
                    onClick={retry}
                    className="ml-3 border-b border-[var(--v2-line2)] pb-px font-mono text-[12.5px] text-[var(--v2-muted)] hover:text-[var(--v2-text)]"
                  >
                    retry
                  </button>
                </div>
              )}
              {asset && thresholds && (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span
                      data-testid="verdict-state"
                      className="text-[clamp(34px,5vw,52px)] font-medium leading-none tracking-[-0.025em]"
                      style={{ color: STATE_VAR[state] ?? STATE_VAR.UNKNOWN }}
                    >
                      {state}
                    </span>
                    <span
                      data-testid="verdict-discount"
                      className="font-mono text-[18px] tabular-nums text-[var(--v2-text)]"
                    >
                      {rawBps == null ? "no reading" : holderSignedPct(rawBps)}
                    </span>
                  </div>
                  {refreshFailed && (
                    <p className="mt-2 text-[14px] text-[var(--v2-muted)]">
                      Live refresh failed. Showing the last reading received.
                    </p>
                  )}
                  {stale && (
                    <p className="mt-2 text-[14px] text-[var(--v2-muted)]">
                      Last reading {stamp}. Older than 15 minutes, so it is
                      shown as UNKNOWN.
                    </p>
                  )}
                  {!stale && state === "UNKNOWN" && (
                    <p className="mt-2 text-[14px] text-[var(--v2-muted)]">
                      {reason ??
                        "No confirmed reading for this asset right now."}
                    </p>
                  )}

                  <div className="mt-7">
                    <ThresholdScale
                      bps={bps}
                      thresholds={thresholds}
                      state={state}
                    />
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-6 font-mono text-[13px] tabular-nums">
                    <div className="min-w-0">
                      <dt className="text-[var(--v2-dim)]">intrinsic</dt>
                      <dd
                        data-testid="verdict-intrinsic"
                        className="mt-0.5 text-[16px] text-[var(--v2-text)]"
                      >
                        {formatUsd(asset.intrinsic_usd)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[var(--v2-dim)]">market</dt>
                      <dd
                        data-testid="verdict-market"
                        className="mt-0.5 text-[16px] text-[var(--v2-text)]"
                      >
                        {formatUsd(asset.market_usd)}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          </div>

          <div className="min-w-0 border-t border-[var(--v2-line)] px-5 py-4 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className="text-[14px] text-[var(--v2-muted)]">
                Same verdict over REST, WebSocket, MCP and the CLI.
              </p>
              <div
                role="group"
                aria-label="Surface"
                className="inline-flex rounded-[8px] border border-[var(--v2-line)] p-0.5"
              >
                {SURFACES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={surface === s.id}
                    onClick={() => setSurface(s.id)}
                    className={cn(
                      "rounded-[6px] px-3 py-1 font-mono text-[12px] transition-colors duration-200",
                      surface === s.id
                        ? "bg-white/[0.08] text-[var(--v2-text)]"
                        : "text-[var(--v2-dim)] hover:text-[var(--v2-muted)]",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2">
              <code
                data-testid="request-line"
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-[var(--v2-line)] bg-[var(--v2-bg2)] px-3 py-2 font-mono text-[12.5px] text-[var(--v2-muted)]"
              >
                {line}
              </code>
              <button
                type="button"
                aria-label="Copy request"
                onClick={() => void copy.copy(line)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--v2-line)] px-2.5 py-2 font-mono text-[12px] text-[var(--v2-dim)] transition-colors duration-200 hover:border-[var(--v2-line2)] hover:text-[var(--v2-text)]"
              >
                {copy.copied ? (
                  <Check aria-hidden className="size-3.5" />
                ) : (
                  <Copy aria-hidden className="size-3.5" />
                )}
                {copy.copied ? "copied" : "copy"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
