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
  // (5k events/mo) is easily blown by a public site.
  //
  // INGESTION STATUS (verified 2026-10-21): Sentry rejects every event for
  // this DSN with 403 `event submission rejected with_reason: ProjectId`,
  // both through the /monitoring tunnel and posted straight to
  // ingest.us.sentry.io. A bad key gives 401 instead, so the tunnel forwards
  // fine and the DSN's project is what Sentry refuses (deleted, disabled or
  // mismatched). This is NOT a quota problem, as an older note here guessed.
  // The fix is dashboard-side: point NEXT_PUBLIC_SENTRY_DSN at an existing,
  // enabled project (or unset it, which makes init a no-op).
  tracesSampleRate: 0.01,

  // Session Replay is deliberately NOT registered. Session sampling was
  // already 0%, error-session replays never reached Sentry (see above), and
  // registering `replayIntegration()` eagerly put rrweb into the main chunk on
  // every page (~75-83 KiB flagged unused by Lighthouse). Re-add it lazily
  // (Sentry.lazyLoadIntegration) only once ingestion is confirmed working.

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
