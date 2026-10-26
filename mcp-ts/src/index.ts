// Entry point — boot Hono server with MCP transport.
//
// Bun.serve is invoked explicitly (rather than `export default { port,
// fetch }`) so we control the bind sequence and can log a single
// startup line. The export-default form also works on Bun.serve, but
// being explicit avoids the VERIFY scenario flagged in Plan 2 A2.

import * as Sentry from "@sentry/node";
import { buildApp, TRANSPORT_MAX_BODY_BYTES } from "@/transport";
import { startCacheWarming } from "@/redis";

// Initialize Sentry FIRST (before any code that could throw) when a
// DSN is provided. Off by default — local dev and tests don't ship
// errors anywhere.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV ?? "production",
  });
}

const port = Number(process.env.HTTP_PORT ?? 8090);

// Subscribe to pegana:discount BEFORE we open the HTTP port so the
// first request sees a populated (or actively-filling) cache rather
// than a cold miss. The first publish from engine-rs typically lands
// within ~1s after `startCacheWarming` resolves.
await startCacheWarming();

const app = await buildApp();

Bun.serve({
  port,
  fetch: app.fetch,
  // Backstop only. The real 64 KiB cap is the Hono bodyLimit on POST /,
  // which returns a JSON-RPC 413; this ceiling sits far above it so Bun never
  // resets the connection first (see TRANSPORT_MAX_BODY_BYTES).
  maxRequestBodySize: TRANSPORT_MAX_BODY_BYTES,
});

console.log(`pegana-mcp listening on :${port}`);
