import type { Metadata } from "next";

/**
 * One builder for every page's metadata.
 *
 * WHY THIS EXISTS — it closes three defects that were all the same structural
 * gap (no shared builder), each verified live before this landed:
 *
 *  1. **Duplicate titles.** `/dashboard`, `/assets`, `/compare` and `/systemic`
 *     exported no metadata at all, so all four served the homepage's verbatim
 *     `<title>` and `<meta description>` — four sitemap entries (two at priority
 *     0.9) that search engines read as duplicates of `/`.
 *
 *  2. **No canonical anywhere.** The root layout deliberately omits
 *     `alternates.canonical` (a hardcoded `/` would canonicalise every page to
 *     the homepage — a real regression this repo has shipped before), leaving it
 *     to each page. Exactly ONE route ever set it: `/asset/[symbol]`. Every
 *     other route shipped none, so `?state=`/`?symbol=` query variants all
 *     competed as separate URLs.
 *
 *  3. **Every inner page unfurled as the homepage.** The root's static
 *     `openGraph` object carries `url: siteUrl`. A page that sets only
 *     `{title, description}` inherits that object WHOLESALE — so an audit
 *     receipt shared on X or Telegram rendered the homepage card. That is
 *     directly hostile to "share a verifiable receipt", which is the product's
 *     trust pitch and its best moment of organic attention.
 *
 * Passing `title` BARE is load-bearing. The root layout sets
 * `title.template = "%s · Pegana"`, so a page passing `"Methodology · Pegana"`
 * rendered `"Methodology · Pegana · Pegana"`. Eight routes shipped that.
 *
 * @see web/app/(app)/asset/[symbol]/layout.tsx — the route this generalises.
 */

/** Canonical host. Mirrors `siteUrl` in `web/app/layout.tsx`. */
const SITE_URL = "https://www.pegana.xyz";

/**
 * The site-wide social card (app/opengraph-image.png, app/twitter-image.png,
 * both 1200x630). Next replaces the parent's `openGraph`/`twitter` objects
 * WHOLESALE when a page sets its own, so without these every inner page
 * unfurled with `summary_large_image` and no image at all. A route with its
 * own colocated opengraph-image file (asset, audit receipt) still wins:
 * file-based metadata overrides config-based metadata in the same segment.
 */
const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Pegana: peg-risk oracle for Solana",
};
const DEFAULT_TWITTER_IMAGE = {
  url: "/twitter-image.png",
  width: 1200,
  height: 630,
  alt: "Pegana: peg-risk oracle for Solana",
};

/** Brand suffix for social cards. `title` itself stays bare for the template. */
const OG_SUFFIX = " | Pegana";

export type PageMetadataInput = {
  /**
   * Page title WITHOUT any brand suffix — the root template appends it.
   * Aim for <= 60 chars once " · Pegana" is added, or Google truncates.
   */
  title: string;
  description: string;
  /** Root-relative path, e.g. `/methodology`. Becomes canonical + og:url. */
  path: string;
  /** Set for pages that must not be indexed (none today; here for account/*). */
  noindex?: boolean;
};

export function pageMetadata({
  title,
  description,
  path,
  noindex,
}: PageMetadataInput): Metadata {
  const ogTitle = `${title}${OG_SUFFIX}`;
  // Absolute og:url. `metadataBase` would resolve a relative one, but being
  // explicit here keeps the value correct even if metadataBase ever changes.
  const url = `${SITE_URL}${path}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: ogTitle,
      description,
      url,
      type: "website",
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [DEFAULT_TWITTER_IMAGE],
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
