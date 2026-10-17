// Next.js 16 instrumentation hook. Picks the runtime-correct Sentry
// config so initialization happens exactly once per worker.
// See https://docs.sentry.io/platforms/javascript/guides/nextjs/.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Next.js 16 `onRequestError` hook → forward to Sentry. The Sentry SDK
// exports this as `captureRequestError` since v10.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
