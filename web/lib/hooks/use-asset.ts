"use client";
import useSWR from "swr";
import type { AssetCardData } from "@/lib/api/types";
import { api } from "@/lib/api/client";

export function useAsset(symbol: string | null, fallback?: AssetCardData) {
  return useSWR<AssetCardData>(
    symbol ? `asset/${symbol}` : null,
    async () => api.asset(symbol!),
    {
      fallbackData: fallback,
      refreshInterval: 30_000,
      shouldRetryOnError: false,
    },
  );
}
