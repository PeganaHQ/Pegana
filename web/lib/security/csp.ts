/**
 * Content Security Policy builder for Pegana web.
 *
 * A nonce is generated per-request in proxy.ts and threaded through the
 * x-nonce request header to Server Components. Call `buildCsp(nonce)` to
 * produce the policy string that is set as the
 * `Content-Security-Policy-Report-Only` response header.
 *
 * Non-'self' origin rationale
 * ─────────────────────────────
 * - https://va.vercel-scripts.com — Vercel Analytics script injected by the
 *   <Analytics /> component in app/layout.tsx (@vercel/analytics/next)
 * - https://api.pegana.xyz, wss://api.pegana.xyz — the production REST + WebSocket
 *   API that every data-fetch hook calls (lib/api/base.ts uses NEXT_PUBLIC_API_BASE)
 * - https://*.sentry.io — Sentry event ingest endpoint; DSN host is
 *   o<orgid>.ingest.sentry.io. Note: Sentry browser requests are also tunneled
 *   through /monitoring (same-origin, see next.config.ts tunnelRoute), so the
 *   sentry.io wildcard is a belt-and-suspenders allowance for any direct SDK calls
 *   that bypass the tunnel (e.g. user-feedback endpoints, sourcemap uploads are
 *   server-only and don't need this)
 * - blob: in worker-src — Sentry Replay runs its session recorder in a Web Worker
 *   spawned from a blob: URL (instrumentation-client.ts uses replayIntegration)
 */

/**
 * Builds the CSP header value for a given per-request nonce.
 *
 * @param nonce - base64-encoded random UUID, generated in proxy.ts
 * @returns Flat single-line CSP policy string (semicolon-delimited directives)
 */
export function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",

    // 'strict-dynamic' allows scripts loaded by a nonced script to run without
    // needing their own nonce/host allowlist. This covers:
    //   – React/Next runtime bundles auto-nonced by the framework (Next reads
    //     the CSP from the incoming request headers to stamp nonce= on its
    //     generated <script> tags; proxy.ts sets it on both request + response)
    //
    // The explicit https://va.vercel-scripts.com host
    // entries are a CSP Level-2 FALLBACK for browsers that do not support
    // 'strict-dynamic' (primarily pre-2019 engines). Under CSP Level 3 with
    // 'strict-dynamic', host-source allowlists in script-src are IGNORED —
    // runtime trust propagates only via nonce. The host entries are harmless to
    // leave in (they become inert on modern browsers) but do NOT cover the
    // initial widget load under 'strict-dynamic'; that trust comes from the
    // nonce propagated off the now-nonced first-party Next.js bundle.
    //
    // 'unsafe-eval' is NOT added here — it is only needed in development mode;
    // proxy.ts adds it conditionally when NODE_ENV === 'development'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com`,

    // 'unsafe-inline' for styles is retained because:
    //   – framer-motion injects inline style= attributes extensively
    //   – Tailwind v4 uses inline CSS custom properties
    //   – Removing it would require auditing every component; deferred to a
    //     separate hardening pass with a nonce on styles
    "style-src 'self' 'unsafe-inline'",

    // data: for base64-encoded token icons; blob: for any canvas/Blob exports
    // Third-party thumbnails for the market feed. Scoped to the two CDN families
    // tokens.xyz actually serves (CoinGecko's image host and X's media host)
    // rather than a blanket `https:` — a news thumbnail is not worth turning
    // img-src into a wildcard on a product that sells verifiability. Anything
    // outside these hosts is blocked by CSP and the feed falls back to its
    // placeholder tile via the <img> onError handler, so it degrades quietly.
    "img-src 'self' data: blob: https://*.coingecko.com https://*.twimg.com",

    // Google Fonts are self-hosted via next/font (Geist + Geist Mono)
    "font-src 'self'",

    // api.pegana.xyz: all REST calls; wss://: WebSocket real-time feed
    // /monitoring: Sentry tunnel (same-origin, included via 'self')
    // *.sentry.io: direct Sentry ingest (belt-and-suspenders; DSN host is
    //   o<id>.ingest.sentry.io or o<id>.ingest.<region>.sentry.io)
    "connect-src 'self' https://api.pegana.xyz wss://api.pegana.xyz https://*.sentry.io",

    // No third-party frame origins: the product has no sign-in or widget frame.
    "frame-src 'self'",

    // Sentry Replay spawns its session-recording Web Worker from a blob: URL;
    // 'self' also permits any same-origin Web Worker (Next/SDK-registered).
    "worker-src 'self' blob:",

    // Deny plugins (Flash, Java, etc.) — belt-and-suspenders
    "object-src 'none'",

    // Prevent <base> tag injection attacks that could rewrite relative URLs
    "base-uri 'self'",

    // Restrict form submission targets to same-origin. default-src does NOT
    // cover form-action in Firefox, so set it explicitly (matches the Next.js
    // official CSP example). Every form posts same-origin.
    "form-action 'self'",

    // Prevent this page from being embedded in any foreign frame. NOTE: the
    // /embed/* route handlers set their own CSP header (they're excluded from
    // the proxy matcher): the BADGE routes use `frame-ancestors *` (cross-origin
    // embeddable).
    "frame-ancestors 'none'",

    // Collect CSP violations for analysis before enforcement
    "report-uri /api/csp-report",
  ];

  return directives.join("; ");
}

/**
 * In development mode, widen the policy for local tooling:
 *   – 'unsafe-eval' in script-src: React DevTools + Next.js error overlays use
 *     eval() for stack-trace reconstruction.
 *   – localhost origins in connect-src: `next dev` talks to the local backend
 *     (lib/api/base.ts → http://localhost; live-context.tsx → ws://localhost),
 *     which the prod connect-src (api.pegana.xyz only) would otherwise flag on
 *     every request, drowning the Report-Only signal.
 * Both are ONLY for development — never shipped in production.
 */
export function buildCspForEnv(nonce: string): string {
  const base = buildCsp(nonce);
  if (process.env.NODE_ENV === "development") {
    return base
      .replace(/script-src ([^;]+)/, "script-src $1 'unsafe-eval'")
      .replace(
        /connect-src ([^;]+)/,
        "connect-src $1 http://localhost:* ws://localhost:*",
      );
  }
  return base;
}
