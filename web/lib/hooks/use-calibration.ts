"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

// Per-asset calibration self-monitor (p95 vs band, 8d). 8-day aggregate that
// changes slowly — poll every 60s, server caches 30s.
export function useCalibration() {
  return useSWR("calibration", api.calibration, { refreshInterval: 60_000 });
}
