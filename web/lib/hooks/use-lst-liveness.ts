"use client";
import useSWR from "swr";
import type { LstLivenessFlags } from "@/lib/asset/intrinsic-degraded";

interface LstLivenessResponse {
  mint: string;
  flags: LstLivenessFlags;
  rate: number | null;
}

async function fetchLiveness(mint: string): Promise<LstLivenessFlags | null> {
  const res = await fetch(`/api/lst-liveness?mint=${encodeURIComponent(mint)}`);
  // 404 = uncovered LST / unreachable directory / missing mint → no flag.
  if (!res.ok) return null;
  const body = (await res.json()) as LstLivenessResponse;
  return body?.flags ?? null;
}

/**
 * LST-only: reads the directory liveness flags for `mint` via the same-origin
 * `/api/lst-liveness` proxy (the directory fetch itself is server-only). SWR
 * is disabled (key = null) for non-LST assets or a missing mint, so no request
 * fires there. Resolves to `null` for an uncovered LST or an unreachable
 * directory — the caller renders nothing. Refreshes on the directory's own
 * 15-min cadence; the flags move on a per-epoch (~2-day) timescale, so no
 * faster poll is warranted.
 */
export function useLstLiveness(
  mint: string | null | undefined,
  klass: string | null | undefined,
) {
  const enabled = klass === "lst" && !!mint;
  return useSWR(
    enabled ? `lst-liveness/${mint}` : null,
    () => fetchLiveness(mint as string),
    {
      refreshInterval: 15 * 60_000,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    },
  );
}
