import type { ServerAsset } from "@/lib/asset/fetch-asset";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { JsonLd } from "@/components/atoms/json-ld";

const SITE_URL = "https://www.pegana.xyz";

/**
 * Per-asset structured data.
 *
 * BreadcrumbList is the safe, honest choice here. schema.org has no vocabulary
 * that describes "current peg state of a synthetic dollar", and stretching an
 * unrelated type to fake one would be structured-data spam — on a product whose
 * entire pitch is not overstating what it knows. The `Dataset` entity that DOES
 * fit the product lives once, sitewide, on /methodology.
 */
export function AssetJsonLd({ asset }: { asset: ServerAsset }) {
  const sym = displaySymbol(asset.symbol);
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Assets",
            item: `${SITE_URL}/assets`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: sym,
            item: `${SITE_URL}/asset/${encodeURIComponent(asset.symbol)}`,
          },
        ],
      }}
    />
  );
}
