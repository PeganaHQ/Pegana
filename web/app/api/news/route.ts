import { NextResponse, type NextRequest } from "next/server";
import { FEEDS, mergeItems, parseFeed, type NewsItem } from "@/lib/news/feed";
import { fetchTokensXyzNews } from "@/lib/news/tokens-xyz";

/**
 * Peg-relevant headlines, merged from a few public RSS feeds.
 *
 * No new infrastructure: no migration, no indexer task, no /v1 route, no cron.
 * Next's fetch cache does the work — `revalidate` is the same primitive already
 * used by app/sitemap.ts, app/audit.xml/route.ts and the embed routes, so this
 * introduces no new caching concept to the codebase.
 *
 * Everything that decides WHAT a reader sees is in lib/news/feed.ts, which is
 * pure and unit-tested. This file only fetches.
 */

export const runtime = "nodejs";
/** Upstream outlets publish a few times a day; 15 min is well inside that. */
const REVALIDATE_SECONDS = 900;
const FETCH_TIMEOUT_MS = 6_000;

async function readFeed(name: string, url: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some outlets 403 a bare fetch. A plain identifying UA is enough for
        // the four kept here; the ones that still refuse (Jito, Ethena) were
        // dropped from FEEDS rather than worked around.
        "User-Agent": "PeganaNewsBot/1.0 (+https://www.pegana.xyz)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseFeed(await res.text(), name);
  } catch {
    // One outlet being slow, down, or newly hostile must never blank the modal.
    return [];
  }
}

export async function GET(request: NextRequest) {
  // Driven by the feed's own options menu. Bounded here rather than trusted:
  // `limit` reaches an upstream API, and `source` selects a code path.
  const sp = request.nextUrl.searchParams;
  const limit = clampInt(sp.get("limit"), 1, 50, 24);
  const source = parseSource(sp.get("source"));

  // tokens.xyz first: curated, carries an image per item, and can be asked for a
  // specific token. It returns null (not []) when the key is missing or the call
  // fails, which is how we tell "no credential" from "nothing to show".
  const curated = await fetchTokensXyzNews({ limit, source }, REVALIDATE_SECONDS);
  if (curated.items && curated.items.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        count: curated.items.length,
        data: curated.items,
        sources: [{ name: "tokens.xyz", items: curated.items.length }],
      },
      { headers: cacheHeaders() },
    );
  }

  // Fallback: our own RSS sweep. Blunter and image-less, but it needs no
  // credential, so the panel still has something when the key is absent.
  // The RSS fallback has no posts — it is articles by construction — so a
  // posts-only filter has nothing to fall back TO. Say so with an empty list
  // rather than silently serving articles the reader just filtered out.
  const lists =
    source === "posts"
      ? []
      : await Promise.all(FEEDS.map((f) => readFeed(f.name, f.url)));
  const items = mergeItems(lists, limit);

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      count: items.length,
      data: items,
      // Which outlets answered this round. Surfaced so a silently-dead feed is
      // visible instead of just quietly shrinking the list.
      sources: FEEDS.map((f, i) => ({ name: f.name, items: lists[i]?.length ?? 0 })),
      // Why the curated source was skipped. Without this a fallback is
      // indistinguishable from a working feed, which is how a dead upstream
      // hides in plain sight — the same failure mode as a media upload that
      // returns ok:true.
      curated_skipped: curated.skip ?? "empty",
      ...(curated.status ? { curated_status: curated.status } : {}),
    },
    { headers: cacheHeaders() },
  );
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseSource(raw: string | null): "all" | "news" | "posts" {
  return raw === "news" || raw === "posts" ? raw : "all";
}

/** ADR-0043's list envelope shape is used above; this is just the cache policy. */
function cacheHeaders() {
  return {
    "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=3600`,
  };
}
