import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { CONSOLE_HOST, normalizeHost } from "@/lib/routing/host-routing";

const SITEMAP_URL = "https://www.pegana.xyz/sitemap.xml";
const SITE_URL = "https://www.pegana.xyz";

/**
 * Host-aware robots.txt.
 *
 * Pegana is fully open and free: every product surface is public, so the www
 * policy now allows everything except the API (which is machine-facing) and
 * internal reporting endpoints. The app host remains disallowed outright — it
 * is a duplicate origin serving the same pages, and indexing both would split
 * ranking signals.
 *
 * This reads the request Host, which opts the route out of static generation.
 * That is fine for a file this small, and it is the only way one robots.ts can
 * answer two hosts correctly. It is reachable on the app host because the proxy
 * matcher excludes `robots.txt` (like sitemap and llms.txt).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = normalizeHost((await headers()).get("host") ?? "");

  if (host === CONSOLE_HOST) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/monitoring"],
      },
    ],
    sitemap: SITEMAP_URL,
    host: SITE_URL,
  };
}
