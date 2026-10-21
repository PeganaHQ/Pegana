// Single source of truth for where vendored token and partner logos load from.
//
// The files live in web/public/tokens and web/public/logos. In production the
// browser fetches them from the API box (https://api.pegana.xyz/static/...,
// Caddy serving the same repo directories read-only), not from Vercel: on the
// Hobby plan every request that reaches Vercel counts against 1M CDN requests
// a month, cache HITs included, and a page view loads 9 to 30 of these icons.
//
// NEXT_PUBLIC_STATIC_BASE overrides the base (previews, tests, a staging box).
// Set it to "/" to serve them from the web origin again, which is the rollback
// lever: no code change, one web redeploy. OG and share-card routes do not use
// this helper; they never load these files.
//
// The page CSP (lib/security/csp.ts) allows the origin this resolves to, so the
// two can never disagree.

export const DEFAULT_STATIC_BASE = "https://api.pegana.xyz/static";

// scheme://host[:port] and nothing else: safe to place in a CSP source list.
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/;

/**
 * Resolve the static asset base, without a trailing slash.
 *
 *   - unset or empty: the API box default;
 *   - "/": same origin, returns "" so URLs stay root-relative (/tokens/...);
 *   - an http(s) URL: used as given.
 *
 * Anything else is a misconfiguration and falls back to the default rather
 * than shipping broken image URLs. Read on every call so tests can stub it.
 */
export function staticBase(): string {
  const raw = (process.env.NEXT_PUBLIC_STATIC_BASE ?? "").trim();
  if (raw === "") return DEFAULT_STATIC_BASE;
  if (raw === "/") return "";
  if (/^https?:\/\/[^/]/i.test(raw)) {
    try {
      // The origin goes into the CSP img-src verbatim (staticOrigin), so it
      // must be a plain scheme://host[:port]. That rejects a wildcard host
      // (`https://*`, `https://*.x.com`) and quote or semicolon injection
      // (`https://a.com;script-src ...`, `https://a.com'`), any of which
      // would widen or break the policy.
      if (!SAFE_ORIGIN.test(new URL(raw).origin)) return DEFAULT_STATIC_BASE;
      return raw.replace(/\/+$/, "");
    } catch {
      return DEFAULT_STATIC_BASE;
    }
  }
  return DEFAULT_STATIC_BASE;
}

/**
 * The origin the static base points at, for the CSP `img-src` allowlist.
 * Null when the files are same-origin ('self' already covers them).
 */
export function staticOrigin(): string | null {
  const base = staticBase();
  if (base === "") return null;
  return new URL(base).origin;
}

/** Vendored icon for an SPL mint: public/tokens/{mint}.webp. */
export function tokenIconUrl(mint: string): string {
  return `${staticBase()}/tokens/${encodeURIComponent(mint)}.webp`;
}

/** Partner / venue logo: public/logos/{slug}.svg. */
export function partnerLogoUrl(slug: string): string {
  return `${staticBase()}/logos/${encodeURIComponent(slug)}.svg`;
}
