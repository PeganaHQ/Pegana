// pegana-protocol-indexer — Sub-C loop-intelligence indexer entry point.
//
// Boots the health/metrics HTTP server, then starts one poll loop per protocol
// source. Sources are added incrementally: C1 = Kamino, C2 = Jupiter Lend.
// ADR-0036 variant A: only anonymous, aggregate leverage data is written; no
// position owner is ever read or persisted.

import * as Sentry from "@sentry/node";
import { buildApp } from "./transport";
import { runSource, type Source } from "./core/poll";
import { kaminoSource } from "./sources/kamino";
import { jupiterLendSource } from "./sources/jupiter-lend";
import { kaminoHfSource } from "./sources/kamino-hf";
import { jupiterLendHfSource } from "./sources/jupiter-lend-hf";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
  });
}

// Global unhandled-rejection handler. A native crash from bigint-buffer
// (CVE-2025-3194) or any other native addon would terminate the process
// without cleanup. This ensures Sentry captures it and the container
// restarts cleanly via the `restart: unless-stopped` policy.
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", String(reason));
  Sentry.captureException(reason);
  process.exit(1);
});

const PORT = Number(process.env.HTTP_PORT ?? 8091);

// Protocol sources, filled in per stage.
//   C1: Kamino loop_exposure (free REST) — LIVE.
//   C2: Jupiter Lend loop_exposure (free REST) — LIVE.
//   C3: Kamino HF distribution (Helius gPA enumeration) — self-gates on HELIUS_API_KEY.
//   C3b: Jupiter Lend HF distribution (Fluid tick math) — self-gates on HELIUS_API_KEY.
export const sources: Source[] = [
  kaminoSource,
  jupiterLendSource,
  ...(process.env.HELIUS_API_KEY ? [kaminoHfSource, jupiterLendHfSource] : []),
];

export const requiredSourceKeys = [kaminoSource.name, jupiterLendSource.name];

for (const src of sources) {
  // Each source owns its own loop + up-gauge guard; a throw in one never stops
  // the others or the process (liveness is surfaced via metrics, not restart).
  void runSource(src).catch((e) => {
    console.error(`[${src.name}] source loop exited:`, String(e));
    Sentry.captureException(e, { tags: { source: src.name } });
  });
}

const app = buildApp(requiredSourceKeys);
Bun.serve({ port: PORT, fetch: app.fetch });
console.log(
  `pegana-protocol-indexer up on :${PORT} — ${sources.length} source(s): ${
    sources.map((s) => s.name).join(", ") || "(none yet — C1/C2 pending)"
  }`,
);
