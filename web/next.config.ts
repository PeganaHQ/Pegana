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

  async headers() {
    return [
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
