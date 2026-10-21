"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";
import { usePollInterval } from "@/lib/api/poll-policy";

// keepPreviousData prevents the table from collapsing to `undefined` while a
// refetch is in flight (a poll, or when callers pass a different filter).
// Without it, every filter click that changes the SWR key flashes a skeleton.
export function useAssets(opts?: { class?: string; peg?: string }) {
  const key = ["assets", opts?.class ?? "", opts?.peg ?? ""].join("|");
  // Slow while the WebSocket streams live state, 30s without it
  // (lib/api/poll-policy.ts).
  const refreshInterval = usePollInterval("assets");
  return useSWR(key, () => api.assets(opts), {
    refreshInterval,
    keepPreviousData: true,
  });
}
