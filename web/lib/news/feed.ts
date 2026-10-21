/**
 * Peg-relevant news: pure parsing + filtering.
 *
 * Deliberately dependency-free and I/O-free so it can be unit-tested without a
 * network. `app/api/news/route.ts` does the fetching; everything that decides
 * what a reader actually sees lives here.
 *
 * WHY A FILTER AT ALL
 * -------------------
 * The founder asked for "notícias da Solana de LST e stablecoins", not a crypto
 * firehose. Of the issuer blogs we wanted to read directly, most are unusable:
 * Jito and Ethena return 403 to a server-side fetch (Cloudflare), Hylo's blog
 * host does not resolve, and Sanctum's returns 404. Verified 2026-08-10. So the
 * shape that actually works is: read a handful of broad feeds that DO serve us,
 * and filter hard on our own subject matter.
 *
 * That filter is the product. Without it this is a worse version of any crypto
 * news app; with it, it is the only feed that only shows pegs.
 */

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  /** ISO string, or null when the feed omits/garbles the date. */
  publishedAt: string | null;
  /** Which of our terms matched — shown as a chip, and the reason it is here. */
  matched: string[];
  /** Lead image, when the source provides one. RSS gives none; tokens.xyz does. */
  image?: string | null;
  /** True for an @tokens post rather than an article — rendered differently. */
  isPost?: boolean;
}

export interface FeedSource {
  name: string;
  url: string;
}

/**
 * Feeds verified reachable from a server-side fetch on 2026-08-10.
 * Each returned 200 with a parseable item count; the ones that 403'd or 404'd
 * are documented in the module header rather than left in as dead entries.
 */
export const FEEDS: readonly FeedSource[] = [
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss/tag/solana" },
  { name: "The Defiant", url: "https://thedefiant.io/api/feed" },
  { name: "Blockworks", url: "https://blockworks.co/feed" },
  { name: "Solana", url: "https://solana.com/news/rss.xml" },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { name: "BeInCrypto", url: "https://beincrypto.com/feed/" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
] as const;

/**
 * Subject matter. Two tiers, both required to be word-boundary matches so
 * "USDC" does not fire on "USDCoinbase" and "peg" does not fire on "Pegasus".
 *
 * Ticker matching is case-SENSITIVE (see `matchTerms`): lowercase "inf" appears
 * in "information", and "LST" would otherwise fire on any all-caps headline.
 */
const TICKERS = [
  "USDC", "USDT", "PYUSD", "USDS", "USDe", "sUSDe", "DAI", "FDUSD", "USDY",
  "USD1", "hyUSD", "JupUSD", "jitoSOL", "mSOL", "bSOL", "JupSOL", "INF",
  "bbSOL", "hSOL", "LST", "xSOL",
] as const;

const TOPICS = [
  "stablecoin", "stablecoins", "solana",
  "liquid staking", "liquid-staking", "restaking", "yield-bearing",
  "collateral", "redemption", "reserves", "attestation",
] as const;

/**
 * The peg family, as one rule instead of a list of inflections.
 *
 * Enumerating them ("peg", "pegged", "repegging", …) is brittle — the first
 * draft listed five and still missed "repegging". A bare prefix match is worse:
 * "Pegasus" also starts with "peg". So this allows only real inflectional
 * suffixes, which admits pegged/pegging/depegs/repegged and rejects Pegasus.
 *
 * Reported as the canonical term "peg" regardless of which inflection matched,
 * so the UI chip stays stable.
 */
const PEG_FAMILY = /(^|[^a-z0-9])(de-?|re-?)?peg(s|ged|ging)?([^a-z0-9]|$)/;

/** Remove tags until stable so nested input like `<scr<b>ipt>` cannot reassemble. */
function stripTags(input: string): string {
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(/<[a-zA-Z/!?][^>]*>/g, "");
  } while (out !== prev);
  return out;
}

/** Strip XML/HTML entities and tags from a feed field. */
export function decodeXmlText(raw: string): string {
  const decoded = stripTags(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // `&amp;` LAST: decoding it first would let "&amp;lt;" become "<".
    .replace(/&amp;/g, "&");
  // Entity decoding can mint new tags (`&lt;script&gt;`); strip again.
  return stripTags(decoded).replace(/\s+/g, " ").trim();
}

/**
 * Which subject terms a headline matches.
 *
 * Tickers compare case-sensitively against the original text; topics compare
 * case-insensitively. Both use word boundaries built from the term itself so a
 * multi-word topic ("liquid staking") still anchors correctly.
 */
/**
 * Ecosystem anchor. A headline must ALSO touch Solana or one of our issuers,
 * or a ticker we track, to count.
 *
 * Without this the filter is technically correct and practically useless.
 * Measured against 200 live headlines on 2026-08-10: the topic-only filter kept
 * 12, and they were almost entirely stablecoin *payments* news — Western Union,
 * Mastercard, Samsung Wallet, Cloudflare. Real stories, zero relevance to
 * whether a Solana peg is holding. Requiring this anchor cut it to 3.
 */
const ECOSYSTEM =
  /(^|[^a-z0-9])(solana|jito|marinade|sanctum|jupiter|hylo|ethena|drift|kamino|orca|raydium|meteora|spl)([^a-z0-9]|$)/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patterns compiled once at import, not per call.
 *
 * These were built inside `matchTerms`, which `parseFeed` calls per item: a
 * cold /api/news sweeps 8 feeds at ~50 items each, so ~400 calls x 33 patterns
 * was ~13,000 identical RegExp compilations per request. The term lists are
 * `as const` and never change at runtime, so this is pure startup work.
 */
const TICKER_RES: ReadonlyArray<readonly [string, RegExp]> = TICKERS.map(
  (t) => [t, new RegExp(`(^|[^A-Za-z0-9])${escapeRe(t)}([^A-Za-z0-9]|$)`)] as const,
);
const TOPIC_RES: ReadonlyArray<readonly [string, RegExp]> = TOPICS.map(
  (t) => [t, new RegExp(`(^|[^a-z0-9])${escapeRe(t)}([^a-z0-9]|$)`)] as const,
);

export function matchTerms(title: string): string[] {
  const hits = new Set<string>();
  for (const [t, re] of TICKER_RES) {
    if (re.test(title)) hits.add(t);
  }
  const lower = title.toLowerCase();
  if (PEG_FAMILY.test(lower)) hits.add("peg");
  for (const [t, re] of TOPIC_RES) {
    if (re.test(lower)) hits.add(t);
  }
  if (hits.size === 0) return [];

  // SCOPE: Solana, LSTs, stablecoins — the three subjects this product is about.
  // NOT "peg events only". An earlier draft required an ecosystem anchor on
  // every match, which correctly rejected "Bitcoin ETF inflows" but also
  // rejected "Western Union launches a stablecoin card" — and stablecoin
  // industry news IS in scope, whether or not Solana is named.
  //
  // So the rule is: a subject-defining term stands on its own; a merely
  // adjacent term (collateral, reserves, redemption) still needs an anchor,
  // because those words are common in unrelated finance writing.
  const standsAlone =
    TICKERS.some((t) => hits.has(t)) ||
    [...hits].some((h) => SUBJECT_TERMS.has(h));
  if (!standsAlone && !ECOSYSTEM.test(lower)) return [];

  return [...hits];
}

/**
 * Terms that define the subject rather than merely touch it. A headline
 * carrying one of these is in scope with no further qualification; anything
 * else has to name the ecosystem to earn its place.
 */
const SUBJECT_TERMS = new Set<string>([
  "stablecoin",
  "stablecoins",
  "peg",
  "liquid staking",
  "liquid-staking",
  "restaking",
  "yield-bearing",
  // Solana itself is one of the three subjects, not merely an anchor for the
  // other two. Treating it as anchor-only rejected "Solana set a record 159.5M
  // daily transactions" — measured against the curated feed, 25 items came back
  // and only 1 survived, because almost all of them were Solana ecosystem news.
  "solana",
]);

/** Pull `<item>` (RSS) and `<entry>` (Atom) blocks out of a feed document. */
function blocks(xml: string): string[] {
  return [
    ...(xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []),
    ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? []),
  ];
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXmlText(m[1]!) : null;
}

/** Atom puts the URL in `<link href="...">`; RSS puts it in the element body. */
function link(block: string): string | null {
  const href = block.match(/<link[^>]*href="([^"]+)"/);
  if (href) return href[1]!;
  const body = tag(block, "link");
  return body && /^https?:\/\//.test(body) ? body : null;
}

function published(block: string): string | null {
  for (const name of ["pubDate", "published", "updated", "dc:date"]) {
    const v = tag(block, name);
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Parse one feed document into peg-relevant items.
 *
 * Returns [] rather than throwing on malformed input: one feed changing its
 * shape must not blank the whole modal.
 */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const b of blocks(xml)) {
    const title = tag(b, "title");
    const url = link(b);
    if (!title || !url) continue;
    const matched = matchTerms(title);
    if (matched.length === 0) continue;
    out.push({ title, url, source, publishedAt: published(b), matched });
  }
  return out;
}

/**
 * Merge feeds: drop duplicate URLs and near-identical headlines (the same wire
 * story is routinely syndicated across two of these outlets), then sort newest
 * first with undated items last.
 */
export function mergeItems(lists: NewsItem[][], limit = 24): NewsItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const merged: NewsItem[] = [];

  for (const item of lists.flat()) {
    const urlKey = item.url.split("?")[0]!.replace(/\/$/, "");
    const titleKey = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;
    seenUrl.add(urlKey);
    seenTitle.add(titleKey);
    merged.push(item);
  }

  return merged
    .sort((a, b) => {
      if (a.publishedAt && b.publishedAt) {
        return b.publishedAt.localeCompare(a.publishedAt);
      }
      if (a.publishedAt) return -1;
      if (b.publishedAt) return 1;
      return 0;
    })
    .slice(0, limit);
}
