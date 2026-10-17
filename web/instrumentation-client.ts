// Browser-side Sentry initialization.
//
// In Next.js 15.3+/16 the CLIENT SDK is initialized from this
// `instrumentation-client.ts` file — the old `sentry.client.config.ts` is no
// longer auto-loaded by the framework, so the client SDK silently never
// initialized (DSN never inlined). Q-005 from the 2026-05-29 backend QA sweep.
//
// DSN ships via NEXT_PUBLIC_SENTRY_DSN. Empty DSN → init becomes a no-op
// (Sentry SDK detects empty string), so dev environments without the
// secret stay quiet.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance: keep tracing on but sample VERY low. The free Sentry tier
  // (5k events/mo) is easily blown by a public site; an exhausted quota /
  // spend-cap is the likely cause of the 403s seen on the /monitoring tunnel
  // (2026-06-22). Root cause (DSN key enabled? org over cap?) is dashboard-side;
  // this just stops the browser SDK from burning the quota.
  tracesSampleRate: 0.01,

  // Replay quota is the biggest spender. Drop blanket session replays entirely
  // (0%) and sample only a fraction of error sessions — still actionable for
  // real bug reports, ~5x cheaper than 1.0.
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 0.2,

  integrations: [
    Sentry.replayIntegration({
      // Mask everything text-ish by default — Pegana is mostly numeric data
      // so this won't hurt debugging.
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Same environment / release contract used by the Rust services.
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Drop noisy browser-extension errors before they hit the quota.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
    "Non-Error promise rejection captured",
    /^Hydration failed because the initial UI/, // React hydration message
  ],
});

// Instrument client-side App Router navigations (parity with the server
// `onRequestError` hook in instrumentation.ts). Available from
// @sentry/nextjs 9.12.0+; we're on 10.x.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
