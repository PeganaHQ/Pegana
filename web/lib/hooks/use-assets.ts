"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

// keepPreviousData prevents the table from collapsing to `undefined` while a
// refetch is in flight (60s poll, or when callers pass a different filter).
// Without it, every filter click that changes the SWR key flashes a skeleton.
export function useAssets(opts?: { class?: string; peg?: string }) {
  const key = ["assets", opts?.class ?? "", opts?.peg ?? ""].join("|");
  return useSWR(key, () => api.assets(opts), {
    refreshInterval: 60_000,
    keepPreviousData: true,
  });
}
