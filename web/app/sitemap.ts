import type { MetadataRoute } from "next";
import { serverApiHeaders } from "@/lib/api/base";

const SITE_URL = "https://www.pegana.xyz";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.pegana.xyz";

type AssetEntry = { symbol: string; updated_at?: string | null };
type AuditEntry = { id: string; detected_at?: string | null };

async function fetchAssets(): Promise<AssetEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/assets`, {
      headers: serverApiHeaders(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: AssetEntry[] };
    return body.data;
  } catch {
    return [];
  }
}

/**
 * Recent audit receipts.
 *
 * The receipt is the product's citable artifact — an immutable, hash-verifiable
 * record with real prose and real numbers — and NOT ONE of them was in the
 * sitemap. They were reachable only via the /audit index (which is itself
 * client-rendered) and the rolling Atom feed, so the permanent, quotable pages
 * were the least discoverable thing on the site.
 *
 * NOTE: `/v1/audit` returns a BARE ARRAY, not the ADR-0043 `{data}` envelope
 * used by `/v1/assets` above. That is a known scope gap in ADR-0043 (§2 sweeps
 * all of `/audit/*` into the "single resources stay bare" bucket, which was
 * written for the by-id receipts and accidentally caught the index). Read it
 * defensively so this keeps working through the eventual reshape.
 */
async function fetchRecentAudits(): Promise<AuditEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/audit?limit=100`, {
      headers: serverApiHeaders(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (Array.isArray(body)) return body as AuditEntry[];
    const data = (body as { data?: unknown })?.data;
    return Array.isArray(data) ? (data as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // `now` is used ONLY as a per-asset fallback below. It is deliberately no
  // longer stamped on the static pages: every one of them previously carried a
  // freshly-generated `lastModified`, so /privacy claimed to have changed on
  // every single crawl while its own page says "Last updated May 22, 2026".
  // A sitemap that reports everything as always-fresh trains crawlers to ignore
  // lastmod entirely — omitting it is strictly more honest and more useful.
  const now = new Date();
  const [assets, audits] = await Promise.all([
    fetchAssets(),
    fetchRecentAudits(),
  ]);

  // NOT LISTED, on purpose: `/live` is a 308 redirect stub to `/events`
  // (app/(marketing)/live/page.tsx calls permanentRedirect()). A redirect in a
  // sitemap is a crawl-budget defect, not a page.
  //
  // The product surfaces (/dashboard, /assets, /events, /compare, /systemic)
  // ARE listed: Pegana is fully open and free, so they are public, indexable
  // pages on www rather than console-only routes.

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/dashboard`,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/assets`,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/events`,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/compare`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/systemic`,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/status`,
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/status/calibration`,
      changeFrequency: "hourly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/lst`,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/methodology`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/audit`,
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/agents`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/embed`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/whats-new`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/backtest`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/backtest/2025-10-10-usde-depeg`,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/releases`,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/embed/demo`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/faq`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  const assetPages: MetadataRoute.Sitemap = assets.map((a) => ({
    url: `${SITE_URL}/asset/${encodeURIComponent(a.symbol)}`,
    lastModified: a.updated_at ? new Date(a.updated_at) : now,
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  // Receipts never change once written (content-addressed by receipt_sha256),
  // hence `never` — the honest value, and the one that spares crawl budget.
  const auditPages: MetadataRoute.Sitemap = audits
    .filter((r) => typeof r.id === "string" && r.id.length > 0)
    .map((r) => ({
      url: `${SITE_URL}/audit/${r.id}`,
      lastModified: r.detected_at ? new Date(r.detected_at) : undefined,
      changeFrequency: "never" as const,
      priority: 0.4,
    }));

  return [...staticPages, ...assetPages, ...auditPages];
}
