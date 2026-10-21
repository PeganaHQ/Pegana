import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { apiBase, serverApiHeaders } from "@/lib/api/base";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";

// The asset page itself is a client component (live WS data), so per-asset
// <title>/description can't live there. This server layout owns the metadata so
// a shared /asset/<symbol> link unfurls with the asset's name + current state
// (the og:image is supplied by the colocated opengraph-image.tsx).

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const sym = resolveAliasSymbol(decodeURIComponent(symbol));

  let name = sym;
  let state: string | null = null;
  // Distinguishes "this asset does not exist" from "we could not reach the
  // API". Both used to fall through the same silent catch, so /asset/<garbage>
  // returned HTTP 200 with <title>GARBAGE peg state</title> and a description
  // asserting it was "tracked in real time by Pegana" — an indexable, canonical
  // page claiming a product fact about an asset that does not exist. Verified
  // live on /asset/NOTAREALSYMBOL before this change.
  let unknownAsset = false;
  // The symbol as the API spells it, once we know. Falls back to what was typed
  // when the API cannot answer, so an outage does not move canonicals around.
  let canonicalSym = sym;
  try {
    // Bound this fetch: Next 16 streams metadata for JS-capable clients, but
    // HTML-limited unfurl crawlers (Slack/X/facebookexternalhit) still BLOCK on
    // it — so a slow /v1/assets/{sym} would hold their render for the whole
    // request. 5s cap; the catch below already degrades to generic metadata.
    const r = await fetch(`${apiBase()}/v1/assets/${encodeURIComponent(sym)}`, {
      headers: serverApiHeaders(),
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5_000),
    });
    if (r.ok) {
      const a = (await r.json()) as {
        symbol?: string | null;
        name?: string | null;
        state?: string | null;
        class?: string | null;
      };
      // Leveraged synths are off the public peg surface and page.tsx answers
      // 404 for them; their metadata must not say "Currently pegged".
      if (a?.class === "synth_lev") unknownAsset = true;
      name = a?.name ?? sym;
      state = a?.state ?? null;
      // The API normalises casing — /v1/assets/jitosol and /JITOSOL both answer
      // with symbol "jitoSOL". The page did not use it, so every casing
      // self-canonicalised: /asset/jitoSOL, /asset/jitosol and /asset/JITOSOL
      // were three indexable URLs for one asset, each claiming to be the
      // original. Adopting the canonical symbol collapses them onto one.
      if (a?.symbol) canonicalSym = a.symbol;
    } else if (r.status === 404) {
      // The API is answering and says it does not have this symbol. That is a
      // fact; a 5xx or a timeout is not, so only this branch changes the copy.
      unknownAsset = true;
    }
  } catch {
    /* unreachable API — keep the generic metadata below, and stay indexable:
       a real asset whose state we momentarily could not read is still a real
       asset, and the copy below simply omits the state. */
  }

  const title = unknownAsset
    ? `${displaySymbol(sym)} is not tracked`
    : `${displaySymbol(canonicalSym)} peg state`;
  const prettyState = state ? state.replace("_", " ").toLowerCase() : null;
  const description = unknownAsset
    ? `Pegana does not track ${displaySymbol(sym)}. Browse every asset it does cover.`
    : `Live peg-risk read on ${name}${
        prettyState ? `. Currently ${prettyState}` : ""
      }. Intrinsic-vs-market spread and every state transition, tracked in real time by Pegana.`;
  const path = `/asset/${encodeURIComponent(canonicalSym)}`;

  // This route was the ONE that got metadata right, and `pageMetadata` was
  // generalised from exactly this shape. Routed through the helper so the two
  // can no longer drift — and so `og:url` becomes absolute here too.
  // noindex only for the symbol the API positively denied. Otherwise any
  // string becomes a canonical, indexable page in the sitemap's shape, which
  // is both a soft-404 to a crawler and a claim we cannot support.
  return pageMetadata({ title, description, path, noindex: unknownAsset });
}

export default function AssetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
