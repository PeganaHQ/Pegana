/**
 * Cache-Control for generated social images (OG, Twitter, share cards).
 *
 * Unfurlers and crawlers fetch these repeatedly, and each fetch used to be an
 * uncached function invocation plus a satori render (`public, max-age=0`,
 * x-vercel-cache MISS, measured 2026-10-21). Two minutes at the CDN, then up
 * to ten more minutes served stale while one background render refreshes it.
 * A social card is a snapshot; it never needs to be fresher than that.
 */
export const OG_CACHE_CONTROL =
  "public, max-age=60, s-maxage=120, stale-while-revalidate=600";
