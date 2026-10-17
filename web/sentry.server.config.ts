// Server-side (Node runtime) Sentry. Catches RSC/SSR + Route Handler
// errors that don't surface to the client. DSN reads from the same env
// var as the client so a single secret rotation covers both surfaces.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.05,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  release: process.env.SENTRY_RELEASE,
});
