"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useHistory(
  symbol: string | null,
  opts?: { bucket?: "raw" | "1m"; from?: string; to?: string; limit?: number },
) {
  const key = symbol
    ? ["history", symbol, JSON.stringify(opts ?? {})].join("|")
    : null;
  return useSWR(key, () => (symbol ? api.assetHistory(symbol, opts) : null));
}
