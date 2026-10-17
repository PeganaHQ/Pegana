import { getAssetsList } from "@/lib/asset/fetch-asset";
import { AssetsScreenerPage } from "./assets-screener-page";
import { AssetsIndexNav } from "./assets-index-nav";

/**
 * Server shell for /assets.
 *
 * The screener stays a client component — it owns sort, filter, search and the
 * live feed. But it calls `useSearchParams()` inside a `<Suspense>`, so that
 * whole subtree CSR-bails during prerender and the route shipped 101 words and
 * ZERO server-rendered `/asset/…` links, despite being the page named for all
 * 68 assets and carrying sitemap priority 0.9.
 *
 * Rendering the index nav here — outside that boundary, from a `cache()`-shared
 * fetch — puts 68 real crawlable links into the HTML without touching the
 * screener's behaviour.
 * CORRECTED 2026-07-31: an earlier version of this comment blamed a CSR bailout
 * from `useSearchParams()`. There is none — the root layout calls `headers()`,
 * so every route is dynamically rendered and `useSearchParams` resolves on the
 * server. The 28 words came from SWR having no server data, so the client
 * rendered its loading skeleton. The fix below is correct either way.
 */
export default async function AssetsPage() {
  const assets = await getAssetsList();

  return (
    <>
      <AssetsScreenerPage />
      <AssetsIndexNav assets={assets} />
    </>
  );
}
