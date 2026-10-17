// Single source of truth for the Pegana API base URL.
//
// `??` only falls through for null/undefined, but Vercel may inline an EMPTY
// string when NEXT_PUBLIC_API_BASE is missing at build time — so an unguarded
// `process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080"` silently ships
// a *production* bundle that talks to localhost. This helper treats empty as
// missing and, when it can tell it's running on a prod host without the env set,
// returns the prod API default instead of localhost.
//
// Used by lib/api/client.ts (the cached browser client) and by every
// server-side route / OG-image / page that fetches the API directly
// (audit.xml, embed.js, embed/[asset], embed/badge, feed/events.xml,
// opengraph-image, status, auth/magic). Keeping the fallback logic here means
// a stale build can never quietly point at localhost in production.

const PROD_API = "https://api.pegana.xyz";
const LOCAL_API = "http://localhost:8080";

/** True when this code is executing on a Pegana production host (browser tab on
 *  *.pegana.xyz, or a Vercel production/preview server runtime). */
function onProdHost(): boolean {
  // Browser: trust the address bar. Vercel previews (*.vercel.app) count as
  // prod hosts — the API is public, its CORS reflects vercel.app origins, and
  // the page CSP already allowlists api.pegana.xyz; without this, previews
  // built without NEXT_PUBLIC_API_BASE silently point at localhost.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    return host.endsWith("pegana.xyz") || host.endsWith(".vercel.app");
  }
  // Server (route handlers, OG images, RSC): Vercel sets these.
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  ) {
    return true;
  }
  const vercelUrl = process.env.VERCEL_URL ?? "";
  if (vercelUrl.endsWith("pegana.xyz") || vercelUrl.endsWith(".vercel.app")) {
    return true;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return siteUrl.includes("pegana.xyz");
}

/**
 * Resolve the API base URL.
 *
 * Priority:
 *   1. NEXT_PUBLIC_API_BASE when explicitly set (and non-empty).
 *   2. The prod API default when we detect a prod host but the env var is
 *      missing — never localhost in production.
 *   3. localhost for local dev.
 */
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (env && env.length > 0) return env;
  return onProdHost() ? PROD_API : LOCAL_API;
}
