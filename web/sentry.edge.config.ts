// Edge runtime Sentry — covers Middleware and any Edge route handler.
// API routes that depend on `node:fs` etc. run in the Node config
// instead.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.05,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  release: process.env.SENTRY_RELEASE,
});
