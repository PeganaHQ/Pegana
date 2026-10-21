"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mutate as globalMutate } from "swr";
import { createWsClient } from "@/lib/api/ws";
import type { PegState } from "@/lib/api/types";

interface AssetUpdate {
  state?: PegState;
  discount?: string;
  intrinsic_usd?: string;
  market_usd?: string;
  updated_at?: string;
}

const VALID_STATES: ReadonlySet<PegState> = new Set([
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
]);

function narrowUpdate(payload: Record<string, unknown>): AssetUpdate {
  const out: AssetUpdate = {};
  if (
    typeof payload.state === "string" &&
    VALID_STATES.has(payload.state as PegState)
  ) {
    out.state = payload.state as PegState;
  }
  if (typeof payload.discount === "string") out.discount = payload.discount;
  if (typeof payload.intrinsic_usd === "string")
    out.intrinsic_usd = payload.intrinsic_usd;
  if (typeof payload.market_usd === "string")
    out.market_usd = payload.market_usd;
  if (typeof payload.updated_at === "string")
    out.updated_at = payload.updated_at;
  return out;
}

interface LiveContextValue {
  /** True inside a mounted LiveProvider (the app shell, /status). Hooks use
   *  it to tell "no socket on this page" apart from "socket down". */
  available?: boolean;
  /** True while the current page renders values from the socket (see
   *  useWsDrivenPage). Only then does a streaming socket make a REST pause
   *  harmless enough to hide the notice. */
  wsDrivenPage?: boolean;
  registerWsDrivenPage?: () => () => void;
  byAsset: Record<string, AssetUpdate>;
  connected: boolean;
  disconnectedSinceMs: number | null;
  /** Server-clock timestamp of the most recent engine heartbeat we received,
   *  or `null` if none has arrived since this connection opened. The engine
   *  publishes one every ~5s, so an age > ~15s implies the engine is silent
   *  or the WS connection is half-broken. */
  lastHeartbeatAt: string | null;
}

const LiveContext = createContext<LiveContextValue>({
  byAsset: {},
  connected: false,
  disconnectedSinceMs: null,
  lastHeartbeatAt: null,
});

const DISCONNECT_BANNER_THRESHOLD_MS = 5 * 60 * 1000;

/** Minimum gap between transition-driven REST refreshes (see below). */
export const TRANSITION_REFRESH_MIN_GAP_MS = 60_000;

/** SWR keys whose data changes when an asset changes peg state. */
export function isTransitionKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    (key === "stats" ||
      key.startsWith("assets|") ||
      key.startsWith("alerts|") ||
      key.startsWith("alerts-window|"))
  );
}

/**
 * While the socket is up, the asset list, the receipts feed and the state
 * counters poll slowly (lib/api/poll-policy.ts). A state transition pushed
 * over the socket is exactly when those change, so refresh them then instead: at most once a
 * minute (trailing), and never from a hidden tab (focus revalidation catches
 * up when it is shown again).
 */
export function createTransitionRefresher(
  refresh: () => void,
  minGapMs: number = TRANSITION_REFRESH_MIN_GAP_MS,
) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    )
      return;
    last = Date.now();
    refresh();
  };
  return {
    trigger() {
      if (timer) return;
      const wait = Math.max(0, last + minGapMs - Date.now());
      timer = setTimeout(fire, wait);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [byAsset, setByAsset] = useState<Record<string, AssetUpdate>>({});
  const [connected, setConnected] = useState(false);
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  const [disconnectedSinceMs, setDisconnectedSinceMs] = useState<number | null>(
    null,
  );
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const ref = useRef<ReturnType<typeof createWsClient> | null>(null);
  const lastStateRef = useRef<Record<string, PegState>>({});
  const [wsPages, setWsPages] = useState(0);
  const registerWsDrivenPage = useCallback(() => {
    setWsPages((n) => n + 1);
    return () => setWsPages((n) => Math.max(0, n - 1));
  }, []);
  const refresherRef = useRef<ReturnType<
    typeof createTransitionRefresher
  > | null>(null);

  useEffect(() => {
    const r = createTransitionRefresher(() => {
      void globalMutate(isTransitionKey);
    });
    refresherRef.current = r;
    return () => {
      r.cancel();
      refresherRef.current = null;
    };
  }, []);

  const onUpdate = useCallback(
    (asset: string, payload: Record<string, unknown>) => {
      const narrowed = narrowUpdate(payload);
      if (narrowed.state) {
        const prev = lastStateRef.current[asset];
        lastStateRef.current[asset] = narrowed.state;
        // The first frame for an asset is a sync, not a transition.
        if (prev && prev !== narrowed.state) refresherRef.current?.trigger();
      }
      setByAsset((prev) => ({
        ...prev,
        [asset]: { ...prev[asset], ...narrowed },
      }));
    },
    [],
  );

  const onHeartbeat = useCallback((ts: string) => {
    setLastHeartbeatAt(ts);
  }, []);

  const onOpen = useCallback(() => {
    setConnected(true);
    setDisconnectedAt(null);
    setDisconnectedSinceMs(null);
  }, []);

  const onClose = useCallback(() => {
    setConnected(false);
    setDisconnectedAt((prev) => prev ?? Date.now());
  }, []);

  // Feed went silent (no frame within the heartbeat window) while the socket
  // still reads 'open'. Drop the live indicator immediately so the dashboard
  // can't keep showing frozen "live" numbers; the watchdog force-closes right
  // after, which runs the normal onClose → reconnect path.
  const onStale = useCallback(() => {
    setConnected(false);
  }, []);

  useEffect(() => {
    // `??` only falls through for null/undefined, but Vercel may bake the
    // env in as an empty string when the value is missing at build time.
    // Treat empty as missing too, then prefer the prod URL when running in
    // a browser (vs SSR / local dev). Localhost fallback is last resort.
    const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    // *.vercel.app previews count as prod hosts, same rationale as
    // lib/api/base.ts — never let a preview silently point at localhost.
    const url =
      fromEnv && fromEnv.length > 0
        ? fromEnv
        : host.endsWith("pegana.xyz") || host.endsWith(".vercel.app")
          ? "wss://api.pegana.xyz/v1/ws"
          : "ws://localhost:8080/v1/ws";
    const client = createWsClient(url, {
      onUpdate,
      onHeartbeat,
      onOpen,
      onClose,
      onStale,
    });
    ref.current = client;
    client.connect();
    return () => {
      client.disconnect();
      ref.current = null;
    };
  }, [onUpdate, onHeartbeat, onOpen, onClose, onStale]);

  // Tick to update disconnectedSinceMs every 30s while disconnected.
  useEffect(() => {
    if (disconnectedAt == null) return;
    const tick = () => setDisconnectedSinceMs(Date.now() - disconnectedAt);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [disconnectedAt]);

  const exposedSince =
    disconnectedSinceMs != null &&
    disconnectedSinceMs >= DISCONNECT_BANNER_THRESHOLD_MS
      ? disconnectedSinceMs
      : null;

  const value = useMemo(
    () => ({
      available: true,
      wsDrivenPage: wsPages > 0,
      registerWsDrivenPage,
      byAsset,
      connected,
      disconnectedSinceMs: exposedSince,
      lastHeartbeatAt,
    }),
    [
      byAsset,
      connected,
      exposedSince,
      lastHeartbeatAt,
      wsPages,
      registerWsDrivenPage,
    ],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  return useContext(LiveContext);
}

export function useLiveAsset(symbol: string): AssetUpdate | undefined {
  const { byAsset } = useLive();
  return byAsset[symbol];
}

/**
 * Declare that the current page renders values pushed over the socket (the
 * dashboard board, the screener, the events feed). The app-shell
 * HealthBanner then stays quiet about a REST slow-down while the socket is
 * streaming, because this page is still live. Pages that read nothing from
 * the socket (the asset page) do not call this, so they get the notice.
 */
export function useWsDrivenPage(): void {
  const { registerWsDrivenPage } = useLive();
  useEffect(() => registerWsDrivenPage?.(), [registerWsDrivenPage]);
}
