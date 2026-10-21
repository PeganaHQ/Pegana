// pegana-protocol-indexer — Sub-C loop-intelligence indexer entry point.
//
// Boots the health/metrics HTTP server, then starts one poll loop per protocol
// source. Sources are added incrementally: C1 = Kamino, C2 = Jupiter Lend.
// ADR-0036 variant A: only anonymous, aggregate leverage data is written; no
// position owner is ever read or persisted.

import * as Sentry from "@sentry/node";
import { buildApp } from "./transport";
import { redactSecrets } from "./fetch-util";
import { installProcessGuards } from "./lifecycle";
import { filterSources } from "./core/source-filter";
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
    // Helius URLs carry ?api-key=...; never let one reach Sentry.
    beforeSend: (event) => JSON.parse(redactSecrets(JSON.stringify(event))),
  });
}

// Process guards: every exit path logs a clear line, and a stray rejection or
// exception NEVER ends the process (sources own their error handling; liveness
// is surfaced via metrics/readyz). See src/lifecycle.ts.
installProcessGuards((e) => Sentry.captureException(e));

const PORT = Number(process.env.HTTP_PORT ?? 8091);

// Protocol sources, filled in per stage.
//   C1: Kamino loop_exposure (free REST) — LIVE.
//   C2: Jupiter Lend loop_exposure (free REST) — LIVE.
//   C3: Kamino HF distribution (Helius gPA enumeration) — self-gates on HELIUS_API_KEY.
//   C3b: Jupiter Lend HF distribution (Fluid tick math) — self-gates on HELIUS_API_KEY.
// PROTOCOL_INDEXER_SOURCES (comma list of source names) optionally restricts
// which sources run — used by the canary container (ops/canary/protocol-indexer)
// so it does not double-poll kamino/jupiter_lend. Unset = all (production).
const allSources: Source[] = [
  kaminoSource,
  jupiterLendSource,
  ...(process.env.HELIUS_API_KEY ? [kaminoHfSource, jupiterLendHfSource] : []),
];
export const sources: Source[] = filterSources(allSources, process.env.PROTOCOL_INDEXER_SOURCES);

export const requiredSourceKeys = [kaminoSource.name, jupiterLendSource.name].filter((k) =>
  sources.some((s) => s.name === k),
);

const app = buildApp(requiredSourceKeys);
Bun.serve({ port: PORT, fetch: app.fetch });
console.log(
  `pegana-protocol-indexer up on :${PORT} — ${sources.length} source(s): ${
    sources.map((s) => s.name).join(", ") || "(none yet — C1/C2 pending)"
  }`,
);

// Health endpoint is up BEFORE any heavy source work starts.
for (const src of sources) {
  // Each source owns its own loop + up-gauge guard; a throw in one never stops
  // the others or the process (liveness is surfaced via metrics, not restart).
  void runSource(src).catch((e) => {
    console.error(`[${src.name}] source loop exited:`, redactSecrets(String(e)));
    Sentry.captureException(e, { tags: { source: src.name } });
  });
}
