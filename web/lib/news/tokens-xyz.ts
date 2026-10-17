import { matchTerms, type NewsItem } from "@/lib/news/feed";

/**
 * tokens.xyz `/v1/news/feed` — the primary news source.
 *
 * WHY THIS AND NOT OUR RSS SCRAPE
 * -------------------------------
 * The RSS path works but is blunt: it reads eight general outlets and filters by
 * keyword, so it surfaces the stablecoin/LST/Solana subject at large and carries
 * no imagery. This endpoint is curated, returns an `image` per item, and can be
 * asked for a SPECIFIC token — which is what makes a per-asset feed possible.
 *
 * We already hold the credential: `TOKENS_XYZ_API_KEY` is the same `x-api-key`
 * the Rust indexer uses for `assets/market-snapshots` and `assets/{id}/risk-details`
 * (crates/indexer-rs/src/sources/tokens_xyz.rs:148). The documented scope for
 * this route is `assets:read`, the same family.
 *
 * Underneath, tokens.xyz reads CoinGecko's **Pro** news API plus @tokens posts on
 * X (apps/api/src/app/api/v1/news/feed/route.ts:189 in solana-foundation/tokens,
 * MIT). Going through them means we get CoinGecko's feed without holding a
 * CoinGecko Pro subscription of our own.
 *
 * Contract mirrored from apps/docs/content/docs/v1/endpoints/news-feed.mdx.
 */

const BASE = process.env.TOKENS_XYZ_BASE?.trim() || "https://api.tokens.xyz/v1";

/** Below this many rows the panel reads as broken rather than curated. */
const MIN_ROWS = 6;

/** One item exactly as tokens.xyz returns it. */
interface TokensXyzArticle {
  title: string;
  url: string;
  image: string;
  author: string;
  posted_at: string;
  type: "news";
  source_name: string;
  related_coin_ids: string[];
  feed_source: "coingecko" | "x";
}

interface TokensXyzResponse {
  items?: TokensXyzArticle[];
}

export interface TokensXyzQuery {
  /** CoinGecko coin id, e.g. "solana". Omit for the global feed. */
  coinId?: string;
  /** Extra matching terms for @tokens posts, e.g. ["jitoSOL", "LST"]. */
  terms?: string[];
  limit?: number;
  /** Reserve slots for @tokens posts when mixing sources. */
  tweetReserve?: number;
  /** Which kinds to return. Ours says "posts"; upstream calls them "tweets". */
  source?: "all" | "news" | "posts";
}

/**
 * Fetch and normalise into our own `NewsItem`.
 *
 * Returns null — not [] — when the key is absent or the call fails, so the
 * caller can tell "no credential / upstream down" (fall back to RSS) apart from
 * "credential fine, genuinely nothing to show" (render the empty state).
 */
/** Why the curated path was skipped, so a silent fallback is never a mystery. */
export type CuratedSkip = "no_key" | "http_error" | "network_error" | "bad_shape";

export interface CuratedResult {
  items: NewsItem[] | null;
  /** Present only when `items` is null. Surfaced by the route for diagnosis. */
  skip?: CuratedSkip;
  /** HTTP status when the call was made and failed. */
  status?: number;
}

export async function fetchTokensXyzNews(
  q: TokensXyzQuery = {},
  revalidateSeconds = 900,
): Promise<CuratedResult> {
  const apiKey = process.env.TOKENS_XYZ_API_KEY?.trim();
  if (!apiKey) return { items: null, skip: "no_key" };

  const url = new URL(`${BASE.replace(/\/$/, "")}/news/feed`);
  // Our vocabulary is "posts"; theirs is "tweets".
  url.searchParams.set(
    "source",
    q.source === "posts" ? "tweets" : (q.source ?? "all"),
  );
  url.searchParams.set("limit", String(Math.min(Math.max(q.limit ?? 24, 1), 50)));
  url.searchParams.set("tweet_reserve", String(q.tweetReserve ?? 3));
  // `coin_id` is what actually narrows the ARTICLES. Measured 2026-08-10:
  // passing only `terms` leaves CoinGecko news unfiltered — a stablecoin/LST
  // term list came back with "OpenAI launches GPT-5.6" and a Fed rate story.
  // The docs say as much: terms match @tokens POSTS, coin_id matches news.
  url.searchParams.set("coin_id", q.coinId ?? "solana");
  if (q.terms?.length) url.searchParams.set("terms", q.terms.join(","));

  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { items: null, skip: "http_error", status: res.status };
    const json = (await res.json()) as TokensXyzResponse;
    if (!Array.isArray(json.items)) return { items: null, skip: "bad_shape" };
    // Dedup by URL. Only the RSS path ran through mergeItems, so this one had
    // none — and CoinGecko syndication returns the same article twice often
    // enough to matter. Two rows sharing a `url` mean a duplicate React key AND
    // a shared `brokenImages` entry, so one dead thumbnail would blank both.
    const seen = new Set<string>();
    const mapped: NewsItem[] = [];
    for (const raw of json.items) {
      const item = toNewsItem(raw);
      if (!item) continue;
      const key = item.url.split("?")[0]!.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push(item);
    }

    // Our subject filter on top of their curation. Even in token mode the feed
    // reserves slots for @tokens posts, which arrive off-topic (a SpaceX
    // acquisition showed up under coin_id=solana). They supply sourcing and
    // imagery; relevance stays ours.
    //
    // The top-up matters. A pure filter is all-or-nothing, and the upstream mix
    // varies per request: measured on one deploy, `limit=25` yielded 18 matches
    // while `limit=24` yielded 1 — and a panel with a single row reads as
    // broken, not as curated. So on-subject items come first, then the rest fill
    // up to MIN_ROWS in their original order. Nothing is hidden; the ordering
    // just stops a thin match from looking like a failure.
    const onSubject = mapped.filter((i) => i.matched.length > 0);
    if (onSubject.length >= MIN_ROWS) return { items: onSubject };

    const rest = mapped.filter((i) => i.matched.length === 0);
    return {
      items: [...onSubject, ...rest.slice(0, MIN_ROWS - onSubject.length)],
    };
  } catch {
    return { items: null, skip: "network_error" };
  }
}

/**
 * Normalise one upstream article.
 *
 * Drops anything whose URL is not http(s): the image and link both go straight
 * into the DOM, and `javascript:` in an href from a third-party feed is exactly
 * the shape of a stored-XSS delivery. tokens.xyz applies the same guard on their
 * side (`isSafeHref`, _feed-helpers.ts:82); we do not inherit it by calling them.
 */
function toNewsItem(a: TokensXyzArticle): NewsItem | null {
  if (!a?.title || !isSafeHttpUrl(a.url)) return null;
  const postedAt = Number.isNaN(Date.parse(a.posted_at))
    ? null
    : new Date(a.posted_at).toISOString();

  return {
    title: a.title,
    url: a.url,
    source: a.feed_source === "x" ? `@${a.author || "tokens"}` : a.source_name || "News",
    publishedAt: postedAt,
    // `related_coin_ids` is documented but empty on every item observed
    // (2026-08-10), so it cannot drive the chips OR the relevance gate. Our own
    // matcher runs on the headline instead — which is also what lets the same
    // subject rule apply to both sources.
    matched: matchTerms(a.title).slice(0, 3),
    image: isSafeHttpUrl(a.image) ? a.image : null,
    isPost: a.feed_source === "x",
  };
}

export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
