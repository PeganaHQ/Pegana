import type { PegState } from "@/lib/api/types";
import { STATE_SEVERITY } from "@/lib/asset/worst-sort";

// Reuse the single source of truth for state severity (UNKNOWN<PEGGED<DRIFT<
// DEPEG<CRITICAL<BLACK_SWAN) so a collapsed cluster always surfaces the most
// serious state it reached — including BLACK_SWAN over CRITICAL.
function severity(state: PegState): number {
  return STATE_SEVERITY[state] ?? -1;
}

/**
 * Collapse rapid flapping into readable markers. Flappy assets (e.g. hyUSD
 * pre-fix flipped PEGGED↔DRIFT dozens of times) spam the chart with arrows;
 * each round-trip is noise, not signal. Walk the time-sorted seeds and group
 * any marker within `minGapSec` of the previous one in the run, then emit ONE
 * marker per cluster — the MOST SEVERE one (returned unchanged, so it keeps its
 * own timestamp + id), so a real DEPEG/CRITICAL inside a flap is never hidden.
 * Markers spaced further apart than the gap stay distinct.
 *
 * Input MUST be sorted ascending by `time`.
 */
export function collapseFlaps<T extends { time: number; state: PegState }>(
  seeds: T[],
  minGapSec: number,
): T[] {
  if (seeds.length <= 1) return seeds.slice();
  const out: T[] = [];
  let cluster: T[] = [seeds[0]];
  const flush = () => {
    let worst = cluster[0];
    for (const s of cluster) {
      if (severity(s.state) > severity(worst.state)) worst = s;
    }
    out.push(worst);
  };
  for (let i = 1; i < seeds.length; i++) {
    if (seeds[i].time - cluster[cluster.length - 1].time <= minGapSec) {
      cluster.push(seeds[i]);
    } else {
      flush();
      cluster = [seeds[i]];
    }
  }
  flush();
  return out;
}
