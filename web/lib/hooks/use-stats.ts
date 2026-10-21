"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";
import { usePollInterval } from "@/lib/api/poll-policy";

export function useStats() {
  // The counters move on state changes (minutes apart), and five components
  // on a page share this key. Interval per lib/api/poll-policy.ts.
  const refreshInterval = usePollInterval("stats");
  return useSWR("stats", api.stats, {
    refreshInterval,
    revalidateOnFocus: true,
  });
}
