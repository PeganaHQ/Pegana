import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

// Docs live at https://docs.pegana.xyz (Mintlify custom domain).
// Legacy /docs/* paths are permanently redirected by web/vercel.json.
const DOCS_ORIGIN = "https://docs.pegana.xyz";

const nextConfig: NextConfig = {
  // The backtest page imports its committed golden + receipts from the
  // repository-level docs/backtests directory. Keep those artifacts as the
  // single source of truth while allowing Turbopack to resolve the monorepo.
  turbopack: {
    root: path.join(process.cwd(), ".."),
  },

  // Fewer, larger client chunks. On the Hobby plan every request that reaches
  // Vercel counts against 1M CDN requests a month, and a project that crosses
  // the quota is paused. Measured 2026-10-21 on production, a first visit to
  // the landing page made 68 requests, 39 of them /_next/static (32 JS chunks
  // under the default `maxChunkCountPerGroup: 40`, `minChunkSize: 50_000`,
  // `requestCost: 200_000`). The same code ships either way: merging changes
  // only how it is split into files. Cost: a navigation can re-download code
  // already held in another merged chunk, which is bytes (100 GB of Fast Data
  // Transfer on Hobby) rather than requests.
  //
  // Measured on two previews: 10 / 100 KB / 600 KB cut 6-7 JS files per first
  // visit; these values cut 9-10 (landing 32 -> 22, asset 29 -> 19, status
  // 23 -> 14) with first-load JS bytes unchanged (463 KB vs 467 KB on the
  // landing) and one client navigation re-fetching about 20 KB more. The
  // remaining files sit above `maxMergeChunkSize` or belong to separate chunk
  // groups, so pushing further buys little.
  experimental: {
    turbopackChunking: {
      maxChunkCountPerGroup: 4,
      minChunkSize: 200_000,
      requestCost: 2_000_000,
    },
  },

  // NO `experimental.viewTransition`. It is accepted by the config schema and
  // documented in this package's own bundled docs, but in 16.2.11 it turns on
  // the config flag WITHOUT switching to the React build that implements
  // `<ViewTransition>`: `next/dist/lib/needs-experimental-react.js` selects
  // that build from `taint || transitionIndicator || gestureTransition` only.
  // Rendering the component on the shipped reconciler throws React #306 and the
  // error boundary blanks the page. This branch found that on a preview after
  // it had passed typecheck, lint and 1700 unit tests.
  //
  // View transitions are driven from `lib/motion/view-transitions.tsx` against
  // the browser's own `document.startViewTransition`, which needs no React
  // feature and no experimental reconciler.

  // News thumbnails (components/organisms/market-feed.tsx): CoinGecko only
  // publishes full-size article images (up to ~440 KB) for a 48px tile, so
  // those go through the optimizer. Scoped to the one path, no query string.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.coingecko.com",
        port: "",
        pathname: "/articles/images/**",
        search: "",
      },
    ],
  },

  // Do not advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,

  async headers() {
    return [
      // Vendored token and partner logos outside /_next were served with
      // max-age=0, so every page view revalidated dozens of icons. They are
      // keyed by mint/name and change rarely, so a day of freshness plus a
      // week of stale-while-revalidate is safe without content hashes.
      //
      // The root icons and the brand art were still max-age=0, so every full
      // page load revalidated favicon.svg, favicon.ico and the brand wave: two
      // of the three or four requests a returning visitor makes per page, each
      // one billed as a CDN request on Hobby. A favicon or brand-art swap under
      // the same file name can now show stale for up to about 8 days in a
      // browser that already has the old one (1 day max-age + 7 days
      // stale-while-revalidate). For a real rebrand, rename the files.
      ...[
        "/tokens/:path*",
        "/logos/:path*",
        "/brand/:path*",
        "/favicon.ico",
        "/favicon.svg",
        "/favicon-16x16.png",
        "/favicon-32x32.png",
        "/apple-touch-icon.png",
        "/android-chrome-192x192.png",
        "/android-chrome-512x512.png",
        "/icon-maskable-512x512.png",
      ].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      })),
      // HSTS for the apex and every subdomain. Vercel's default is
      // `max-age=63072000` with no includeSubDomains. Checked 2026-10-21:
      // every pegana.xyz name answers over HTTPS (www, app, releases and the
      // wildcard on Vercel, api on Caddy, docs on Mintlify), so
      // includeSubDomains cannot strand a plain-HTTP host. No `preload`: with
      // it the apex becomes eligible for hstspreload.org, anyone can submit
      // it, and removal from the browser list takes months. Adding it is an
      // owner decision.
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      {
        source: "/((?!embed).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },

  // Legacy in-app doc routes now redirect to the docs subdomain.
  async redirects() {
    return [
      {
        source: "/concepts",
        destination: `${DOCS_ORIGIN}/concepts/peg-risk-101`,
        permanent: true,
      },
      {
        source: "/concepts/:slug",
        destination: `${DOCS_ORIGIN}/concepts/:slug`,
        permanent: true,
      },
      {
        source: "/learn",
        destination: `${DOCS_ORIGIN}/case-studies/overview`,
        permanent: true,
      },
      {
        source: "/learn/:slug",
        destination: `${DOCS_ORIGIN}/case-studies/:slug`,
        permanent: true,
      },
      {
        source: "/developers",
        destination: `${DOCS_ORIGIN}/guides/rest-api`,
        permanent: true,
      },
      {
        source: "/developers/examples",
        destination: `${DOCS_ORIGIN}/guides/rest-api`,
        permanent: true,
      },
      {
        source: "/developers/:path*",
        destination: `${DOCS_ORIGIN}/guides/rest-api`,
        permanent: true,
      },
      // /methodology is served locally by the Trust Layer v0.1.0 page
      // (`web/app/(marketing)/methodology/page.tsx`). Detailed Mintlify
      // methodology pages live at https://docs.pegana.xyz/methodology/*.
      { source: "/oracle", destination: "/", permanent: true },
      // /pricing: the tiered pricing page (and its earlier 307-to-home
      // redirect) were removed in the 2026-10-17 free open-source release —
      // every surface is free now, so the path intentionally 404s.
      // /alerts -> /events: "alerts" was the old naming for the live
      // state-change feed, "events" is the current page. Redirects, so it
      // doesn't need a sitemap entry (search engines follow the 308 that
      // Next emits for permanent:true).
      { source: "/alerts", destination: "/events", permanent: true },
      // /changelog was removed on 2026-07-18 (founder call) and replaced by
      // /whats-new for the product story; the canonical developer changelog
      // lives in the docs site. The route had been public for weeks and was
      // still linked from docs.json, faq.mdx and changelog.mdx, so it was
      // handing developers a 404. Point it at the docs changelog — that's what
      // anyone following a "changelog" link actually wants.
      { source: "/changelog", destination: `${DOCS_ORIGIN}/changelog`, permanent: true },
      // The RSS feed died with the route. Redirect rather than 404 so any
      // subscribed reader lands somewhere real.
      {
        source: "/feed/changelog.xml",
        destination: `${DOCS_ORIGIN}/changelog`,
        permanent: true,
      },
      // The manifest moved from public/site.webmanifest to app/manifest.ts,
      // which Next serves at /manifest.webmanifest. Anyone who already
      // installed Pegana has the old URL baked into their installation and
      // would start 404ing on manifest refresh. Temporary, not permanent: the
      // path is dead, not relocated for good.
      {
        source: "/site.webmanifest",
        destination: "/manifest.webmanifest",
        permanent: false,
      },
    ];
  },
};

// Wrap with Sentry to upload source maps + tunnel browser requests through
// /monitoring (ad-blocker bypass). The auth token is build-only and lives
// in Vercel project env vars; without it, the wrapper degrades to a
// passthrough so dev builds keep working.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Route Sentry browser requests through /monitoring so corporate proxies
  // and ad-blockers don't drop them.
  tunnelRoute: "/monitoring",
  // Don't fail the production build if Sentry uploads fail — better to
  // ship the deploy and re-upload later than to block a release on
  // sourcemap infra.
  disableLogger: true,
  automaticVercelMonitors: false,
});
