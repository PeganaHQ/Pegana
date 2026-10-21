import { resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { notFound } from "next/navigation";
import { lookupAsset } from "@/lib/asset/fetch-asset";
import { AssetPageClient } from "./asset-page-client";
import { AssetSeoSection } from "./asset-seo-section";
import { AssetJsonLd } from "./asset-json-ld";

export default async function AssetPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = resolveAliasSymbol(decodeURIComponent(symbol));
  const lookup = await lookupAsset(sym);
  // A symbol the API positively denies is a real 404, not a 200 page that
  // the client later swaps for "No asset matches" (a soft 404 to crawlers).
  if (lookup.kind === "not_found") notFound();
  const asset = lookup.kind === "found" ? lookup.asset : null;
  // Leveraged synths (synth_lev, e.g. xSOL) have no peg and are off the public
  // surface; the client already shows not-found for them. Serving a 200 page
  // whose server brief said "xSOL is holding its peg" to crawlers was a false,
  // indexable verdict, so the server answers 404 too.
  if (asset?.class === "synth_lev") notFound();

  return (
    <>
      <AssetPageClient fallbackAsset={asset ?? undefined} />
      {asset ? (
        <>
          <AssetSeoSection asset={asset} />
          <AssetJsonLd asset={asset} />
        </>
      ) : null}
    </>
  );
}
