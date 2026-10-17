"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useStats() {
  return useSWR("stats", api.stats, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
}
