import type { NextRequest } from "next/server";
import { apiBase, serverApiHeaders } from "@/lib/api/base";
import { siteOrigin } from "@/lib/seo/site-origin";

// Lazy-imported so build doesn't fail when the API base isn't reachable; the
// route fetches at request time and degrades to an empty (still well-formed)
// feed when upstream is down.
const API_BASE = apiBase();
const SITE_URL = siteOrigin();

// `GET /v1/audit` index row (bare array). It has no class or discount.
interface AlertRow {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
}

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

function rfc822(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}

function alertToItem(a: AlertRow): string {
  const title = `${a.asset}: ${a.from_state} → ${a.to_state}`;
  const url = `${SITE_URL}/asset/${encodeURIComponent(a.asset)}`;
  const desc = `Pegana detected a state transition on ${a.asset}: ${a.from_state} to ${a.to_state}.`;
  return `
    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="false">${xmlEscape(a.id)}</guid>
      <pubDate>${rfc822(a.detected_at)}</pubDate>
      <description>${xmlEscape(desc)}</description>
      <category>${xmlEscape(a.to_state)}</category>
    </item>`.trim();
}

export async function GET(_req: NextRequest) {
  let items: string[] = [];
  let lastBuildDate = new Date().toUTCString();

  try {
    // exclude_pegged is left at the server default (true): the feed lists
    // transitions INTO a non-PEGGED state only, unlike the in-app views
    // (api.alerts), which also include recoveries to PEGGED.
    const res = await fetch(`${API_BASE}/v1/audit?limit=100`, {
      headers: { Accept: "application/json", ...serverApiHeaders() },
      // Cache for 5 minutes — the feed is consumed by readers polling on
      // their own schedule (RSS clients typically poll 15–60 min).
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const alerts = (await res.json()) as AlertRow[];
      items = alerts.map(alertToItem);
      if (alerts[0]?.detected_at) lastBuildDate = rfc822(alerts[0].detected_at);
    }
  } catch {
    // Empty feed — still a valid response; readers will retry.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Pegana. Depeg events</title>
    <link>${xmlEscape(SITE_URL)}/events</link>
    <atom:link href="${xmlEscape(SITE_URL)}/feed/events.xml" rel="self" type="application/rss+xml" />
    <description>State transitions out of PEGGED for the Solana assets Pegana monitors.</description>
    <language>en</language>
    <ttl>15</ttl>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    ${items.join("\n    ")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
