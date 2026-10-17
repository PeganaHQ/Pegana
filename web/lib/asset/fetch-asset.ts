import { cache } from "react";
import { apiBase } from "@/lib/api/base";
import type { AssetCardData } from "@/lib/api/types";

/**
 * Server-side single-asset fetch, shared by `generateMetadata` and the page body.
 *
 * DO NOT reuse `lib/api/client.ts` here. `fetchJson` hardcodes
 * `cache: "no-store"` and spreads the caller's `init` BEFORE it, so a caller
 * cannot override it — using it from a Server Component would opt the whole
 * route out of the Data Cache and force dynamic rendering on all 68 asset
 * pages, turning every crawler hit into a live API round-trip. This mirrors the
 * recipe already proven by `lib/lst/fetch-pegana-lst.ts`:
 * `next: { revalidate }` + a bounded signal + never throw.
 *
 * `cache()` deduplicates within a single render pass. It is load-bearing here:
 * Next's own fetch memoization keys on URL **plus options**, and
 * `AbortSignal.timeout()` produces a fresh, non-equal signal on every call — so
 * without this wrapper `generateMetadata` and the page body would each pay for
 * their own round-trip.
 */

export type ServerAsset = {
  symbol: string;
  name: string | null;
  class: string;
  anchor: string | null;
  peg_target: string | null;
  state: string | null;
  /** RAW methodology sign — premium-NEGATIVE. Never render without holderSignedPct. */
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
  market_cap: string | null;
  updated_at: string | null;
};

/**
 * Server-side full-universe fetch. Same contract as `getAsset`: cached per
 * render, ISR-friendly, degrades to `[]` rather than throwing.
 *
 * `/v1/assets` returns the ADR-0043 list envelope `{ok, generated_at, count, data}`.
 */
export const getAssetsList = cache(async (): Promise<ServerAsset[]> => {
  try {
    const res = await fetch(`${apiBase()}/v1/assets`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: ServerAsset[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
});

export const getAsset = cache(
  async (symbol: string): Promise<(AssetCardData & ServerAsset) | null> => {
    try {
      const res = await fetch(
        `${apiBase()}/v1/assets/${encodeURIComponent(symbol)}`,
        {
          headers: { Accept: "application/json" },
          next: { revalidate: 60 },
          // Bounded: HTML-limited unfurl crawlers block on generateMetadata, and
          // a hung upstream must never hold a page render open.
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) return null;
      return (await res.json()) as AssetCardData & ServerAsset;
    } catch {
      // Degrade, never throw: a dead API should render the page without its
      // server prose, not a 500. Same contract as fetch-pegana-lst.ts.
      return null;
    }
  },
);
