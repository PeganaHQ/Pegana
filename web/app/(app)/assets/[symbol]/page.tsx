import { permanentRedirect } from "next/navigation";

// B-023: the canonical asset detail route is the singular `/asset/[symbol]`
// (see app/(app)/asset/[symbol]/page.tsx). The plural `/assets` is the
// "Universe" listing page (app/(app)/assets/page.tsx), so `/assets/USDC` had
// no matching segment and 404'd while `/asset/USDC` returned 200.
//
// Least-surprising fix: treat `/assets/<symbol>` as an alias and redirect it to
// the canonical `/asset/<symbol>`. The symbol is re-encoded so values with
// special characters (e.g. "hyloSOL+") survive the redirect target.
//
// Server component using redirect() from next/navigation (Next 16). `params`
// is a Promise and must be awaited. redirect() throws NEXT_REDIRECT and
// terminates rendering, so no markup is returned.
//
// permanentRedirect() (308), not redirect() (307): both of these are PERMANENT
// architectural aliases — the comments above describe them as such — and a 307
// tells search engines the move is temporary, so the destination never inherits
// the alias's link equity and the alias keeps getting recrawled.
export default async function AssetsSymbolRedirectPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<never> {
  const { symbol } = await params;
  permanentRedirect(`/asset/${encodeURIComponent(symbol)}`);
}
