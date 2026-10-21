import { cache } from "react";
import { apiBase, serverApiHeaders } from "@/lib/api/base";
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
      headers: { Accept: "application/json", ...serverApiHeaders() },
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

export type AssetLookup =
  | { kind: "found"; asset: AssetCardData & ServerAsset }
  /** The API answered 404: the symbol is positively not tracked. */
  | { kind: "not_found" }
  /** 5xx, 429, timeout or network: we do not know, so never claim a 404. */
  | { kind: "unavailable" };

export const lookupAsset = cache(
  async (symbol: string): Promise<AssetLookup> => {
    try {
      const res = await fetch(
        `${apiBase()}/v1/assets/${encodeURIComponent(symbol)}`,
        {
          headers: { Accept: "application/json", ...serverApiHeaders() },
          next: { revalidate: 60 },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (res.status === 404) return { kind: "not_found" };
      if (!res.ok) return { kind: "unavailable" };
      return {
        kind: "found",
        asset: (await res.json()) as AssetCardData & ServerAsset,
      };
    } catch {
      return { kind: "unavailable" };
    }
  },
);

export const getAsset = cache(
  async (symbol: string): Promise<(AssetCardData & ServerAsset) | null> => {
    // Degrade, never throw: a dead API should render the page without its
    // server prose, not a 500. Same contract as fetch-pegana-lst.ts.
    const r = await lookupAsset(symbol);
    return r.kind === "found" ? r.asset : null;
  },
);
