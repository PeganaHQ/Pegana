"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

// Sub-C — advisory cross-protocol leverage exposure for an asset.
export function useLoopExposure(symbol: string | null) {
  return useSWR(
    symbol ? `loop-exposure/${symbol}` : null,
    () => (symbol ? api.loopExposure(symbol) : null),
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );
}

// Sub-C — advisory depeg liquidation-cascade estimate at a single preset shock.
// The panel now reads the whole cascade from `useLoopExposure().cascade` in one
// call; this single-shock hook is kept for callers that want one point estimate.
export function useSimulateDepeg(symbol: string | null, shockBps: number) {
  return useSWR(
    symbol ? `simulate-depeg/${symbol}/${shockBps}` : null,
    () => (symbol ? api.simulateDepeg(symbol, shockBps) : null),
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );
}
