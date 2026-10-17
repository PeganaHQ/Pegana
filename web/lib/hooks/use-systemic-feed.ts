"use client";
import { useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/api/client";
import type { PegFeedSignal, SystemicSignal } from "@/lib/api/types";

// A token that carries a systemic block, enriched with derived scalars for ranking.
export interface SystemicEntry extends PegFeedSignal {
  systemic: SystemicSignal;
  exposureUsd: number;
  peakLiquidatableUsd: number;
  hasCascade: boolean;
}

// Sub-C — reads the tokens.xyz feed ONCE and returns every token carrying a
// systemic block, ranked by leverage exposure. Powers the /systemic page (the
// public "test the simulate" surface) without any per-token round-trip.
export function useSystemicFeed() {
  const { data, error, isLoading } = useSWR(
    "peg-feed-systemic",
    () => api.pegFeed(),
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );

  const entries = useMemo<SystemicEntry[] | undefined>(() => {
    if (!data) return undefined;
    return data.data
      .filter(
        (s): s is PegFeedSignal & { systemic: SystemicSignal } => !!s.systemic,
      )
      .map((s) => {
        const exposureUsd = Number(s.systemic.loop_exposure_usd) || 0;
        // Peak liquidatable across the shock grid — the worst-case cascade.
        const peakLiquidatableUsd = s.systemic.cascade.reduce(
          (m, r) => Math.max(m, Number(r.liquidatable_usd) || 0),
          0,
        );
        return {
          ...s,
          exposureUsd,
          peakLiquidatableUsd,
          // Exposure with no modelled liquidation (Jupiter-Lend-only, no Kamino
          // HF band) — honestly flagged "cascade pending" on the surface.
          hasCascade: peakLiquidatableUsd > 0,
        };
      })
      .sort((a, b) => b.exposureUsd - a.exposureUsd);
  }, [data]);

  const totalExposureUsd = useMemo(
    () => entries?.reduce((sum, e) => sum + e.exposureUsd, 0) ?? 0,
    [entries],
  );

  return { entries, totalExposureUsd, error, isLoading };
}
