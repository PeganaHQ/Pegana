// HTTP surface: GET /health (container healthcheck) + GET /metrics (Prometheus).
// Mirrors mcp-ts/src/transport.ts, minus the MCP POST handler — this service is
// an internal DB writer with no public route (no Caddy entry).

import { sourceLastSuccess } from "./core/poll";
import { checkDb } from "./db";
import { Hono } from "hono";
import { renderProm } from "./metrics";

export function buildApp(requiredSources: readonly string[]): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.text("ok"));
  app.get("/livez", (c) => c.text("ok"));
  app.get("/readyz", async (c) => {
    const now = Date.now();
    const STALE_MS = 10 * 60 * 1000;
    const dbOk = await checkDb().catch(() => false);
    const sources: Record<string, number | null> = {};
    let allFresh = true;
    for (const key of requiredSources) {
      const ts = sourceLastSuccess.get(key);
      if (ts === undefined) {
        sources[key] = null;
        allFresh = false;
        continue;
      }
      sources[key] = Math.round((now - ts) / 1000);
      if (now - ts >= STALE_MS) allFresh = false;
    }
    const ready = dbOk && allFresh;
    return c.json(
      { status: ready ? "ready" : "not_ready", db: dbOk, sources },
      ready ? 200 : 503,
    );
  });
  app.get("/metrics", (c) =>
    c.text(renderProm(), 200, {
      "content-type": "text/plain; version=0.0.4",
    }),
  );
  return app;
}
