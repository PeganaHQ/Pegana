"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useStats() {
  // 60s: the counters move on state changes (minutes apart), and five
  // components on a page share this key. See swr-config-provider.tsx for the
  // per-tab request budget.
  return useSWR("stats", api.stats, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
}
