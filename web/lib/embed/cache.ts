// Edge cache policy shared by the embed surfaces (/embed/<asset>,
// /embed/badge/<symbol>).
//
// A partner page that shows "Unknown" while the API has a real verdict is the
// failure this guards. An Unknown render is usually a soft-fail (a 429 or 5xx
// from the API, a timeout), so it must never sit at the edge: at most
// UNKNOWN_EDGE_SECONDS and no stale-while-revalidate, which would otherwise
// let the edge keep serving it for minutes after the API recovered. A degraded
// render (last good state, marked stale) gets the same short window, so the
// next request after the API recovers sees the live read.

export const UNKNOWN_EDGE_SECONDS = 10;

export const DEGRADED_CACHE_CONTROL = `public, s-maxage=${UNKNOWN_EDGE_SECONDS}`;

/**
 * Cache-Control for an embed render. `liveSeconds` is the s-maxage a live,
 * non-Unknown verdict gets; `swrSeconds` its stale-while-revalidate.
 */
export function embedCacheControl(opts: {
  state: string;
  degraded: boolean;
  liveSeconds: number;
  swrSeconds: number;
}): string {
  if (opts.degraded || opts.state === "UNKNOWN") return DEGRADED_CACHE_CONTROL;
  return `public, s-maxage=${opts.liveSeconds}, stale-while-revalidate=${opts.swrSeconds}`;
}
