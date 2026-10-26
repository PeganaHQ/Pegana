// Per-source poll loop with the liveness drop-guard — the TS analog of
// crates/indexer-rs `spawn_source!` (main.rs:26-54). Each source runs its own
// interval loop; a throw in one poll NEVER kills the others (logged + counted),
// and the `..._source_task_up` gauge is reset in `finally` so an unwind can't
// leave it lying "up". Freshness is stamped after each successful poll.

import { incr, setGauge } from "../metrics";
import { redactSecrets } from "../fetch-util";

const UP = "pegana_protocol_source_task_up";
const LAST = "pegana_protocol_source_last_publish_timestamp";
const POLLS = "pegana_protocol_polls_total";

export const sourceLastSuccess = new Map<string, number>();

export interface Source {
  name: string; // e.g. "kamino" | "jupiter_lend"
  intervalMs: number;
  // One poll: fetch + upsert. Returns the number of rows written (for logs).
  poll: () => Promise<number>;
}

// Run a source forever. Never returns under normal operation; on an
// unrecoverable setup error it resets the up-gauge and rethrows.
export async function runSource(src: Source): Promise<void> {
  setGauge(UP, { source: src.name }, 1);
  try {
    for (;;) {
      const start = Date.now();
      try {
        const n = await src.poll();
        incr(POLLS, { source: src.name, status: "ok" });
        const publishedAt = Date.now();
        sourceLastSuccess.set(src.name, publishedAt);
        setGauge(LAST, { source: src.name }, Math.floor(publishedAt / 1000));
        console.log(`[${src.name}] wrote ${n} rows in ${Date.now() - start}ms`);
      } catch (e) {
        incr(POLLS, { source: src.name, status: "error" });
        console.error(`[${src.name}] poll failed:`, redactSecrets(String(e)));
      }
      await sleep(src.intervalMs);
    }
  } finally {
    setGauge(UP, { source: src.name }, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
