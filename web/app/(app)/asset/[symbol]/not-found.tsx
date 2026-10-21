"use client";

import { useParams } from "next/navigation";
import { AssetNotFound } from "@/components/molecules/asset-not-found";

// Rendered (with a real HTTP 404) when page.tsx calls notFound(): the API
// positively denied the symbol, or it is a leveraged synth that is off the
// public peg surface. Keeps the asset-specific 404 (suggestions + coverage
// request) instead of the generic site 404.
export default function AssetNotFoundPage() {
  const params = useParams<{ symbol?: string }>();
  let symbol = params?.symbol ?? "";
  try {
    symbol = decodeURIComponent(symbol);
  } catch {
    /* keep the raw segment */
  }
  return (
    <main>
      <AssetNotFound symbol={symbol} />
    </main>
  );
}
