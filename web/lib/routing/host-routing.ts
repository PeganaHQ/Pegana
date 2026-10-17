/**
 * Host handling for the www/app hosts.
 *
 * Originally this module routed console paths between two hosts
 * (docs/strategy/2026-10-17-www-app-split.md). Pegana is now fully open and
 * free: every surface is public, so there is nothing left to route. Both hosts
 * serve the same application, and the only remaining host-level rule is
 * presentational — the app host stays out of search indexes.
 *
 * Kept as pure functions with no Next.js imports so the rule is unit-testable
 * and the proxy stays a thin adapter.
 */

/** Marketing host. */
export const MARKETING_HOST = "www.pegana.xyz";
/** Apex host: canonicalises to www via the proxy. */
export const MARKETING_APEX_HOST = "pegana.xyz";
/** The app host. Serves the same pages as www, but noindex. */
export const CONSOLE_HOST = "app.pegana.xyz";

/** Where marketing paths land. */
export const MARKETING_ORIGIN = "https://pegana.xyz";
/** The app host origin. */
export const CONSOLE_ORIGIN = "https://app.pegana.xyz";

/**
 * Console route prefixes. These no longer move between hosts — they are public
 * pages on www now. The list is kept because `isConsolePath` still tells
 * product surfaces apart from marketing pages (and the footer/nav no longer
 * need to special-case them at all).
 */
export const CONSOLE_PREFIXES = [
  "/dashboard",
  "/compare",
  "/heatmap",
  "/events",
  "/systemic",
  "/assets",
] as const;

export type RoutingDecision = {
  /** Serve the request on this host. `noindex` marks the app host. */
  kind: "serve";
  noindex: boolean;
};

/** Lower-case the host and drop any `:port` suffix. */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().split(":")[0] ?? "";
}

/** Whole-segment prefix match: `/assets` matches `/assets` and `/assets/x`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when the path is a product/console section. */
export function isConsolePath(pathname: string): boolean {
  return CONSOLE_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/**
 * True for hosts where host-specific behaviour is disabled: Vercel preview
 * deployments and local development. These are never forced noindex.
 */
export function isSplitDisabledHost(host: string): boolean {
  const h = normalizeHost(host);
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".vercel.app")
  );
}

/**
 * The routing decision for a request. Every path is served on the host it was
 * requested from; only the app host is marked noindex. Previews and local dev
 * are exempt so a staging deployment stays crawlable-neutral rather than
 * pretending to be the production app host.
 */
export function routeRequest(host: string): RoutingDecision {
  const h = normalizeHost(host);
  if (isSplitDisabledHost(h)) return { kind: "serve", noindex: false };
  return { kind: "serve", noindex: h === CONSOLE_HOST };
}
