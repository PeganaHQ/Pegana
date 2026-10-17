import { resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { getAsset } from "@/lib/asset/fetch-asset";
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
  const asset = await getAsset(sym);

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
