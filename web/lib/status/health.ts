import type { PegState } from "@/lib/api/types";
import { STALE_AFTER_MS } from "@/lib/asset/freshness";

/**
 * Pure health derivation for /status. Kept out of the page so the rules are
 * unit-tested, not grepped.
 *
 * The page used to decide "All systems operational" from /readyz alone: the
 * max(ts) age of each source table. That stayed green on 2026-10-21 while 10 of
 * 67 assets were UNKNOWN with state_reason stale_source, because a source table
 * stays fresh as long as ANY asset writes to it. Asset coverage now counts.
 */

export interface CoverageAsset {
  symbol: string;
  state: PegState | null;
  state_reason?: string;
  updated_at: string | null;
}

export interface AssetCoverage {
  total: number;
  /** Symbols with no trustworthy reading: UNKNOWN, or a snapshot older than
   *  the server's 15-minute serving window. Sorted. */
  dark: string[];
  /** How many of `dark` carry state_reason stale_source. */
  staleSource: number;
}

export function assetCoverage(
  assets: CoverageAsset[],
  nowMs: number,
): AssetCoverage {
  const dark: string[] = [];
  let staleSource = 0;
  for (const a of assets) {
    const t = a.updated_at ? Date.parse(a.updated_at) : Number.NaN;
    const stale = Number.isFinite(t) && nowMs - t > STALE_AFTER_MS;
    if (a.state == null || a.state === "UNKNOWN" || stale) {
      dark.push(a.symbol);
      if (a.state_reason === "stale_source") staleSource += 1;
    }
  }
  dark.sort((x, y) => x.localeCompare(y));
  return { total: assets.length, dark, staleSource };
}

export interface OverallInput {
  readyErr: boolean;
  ready: { status: "ready" | "not_ready" } | null;
  snapshotAgeSec: number | null;
  liveDown: boolean;
  liveDegraded: boolean;
  /** null while /v1/assets has not loaded, or when it failed to load. */
  coverage: AssetCoverage | null;
  /** True when the /v1/assets fetch failed (not merely still loading), so a
   *  null `coverage` will not resolve on its own. */
  coverageErr?: boolean;
}

/**
 * PEGGED = operational, DRIFT = degraded, DEPEG = outage, UNKNOWN = not yet
 * measured. Any dark asset caps the page at degraded: a peg-risk oracle with
 * assets it cannot price is not "operational" for the people holding them.
 */
export function overallState(i: OverallInput): PegState {
  if (i.readyErr || i.liveDown) return "DEPEG";
  if (!i.ready) return "UNKNOWN";
  if (i.ready.status !== "ready") return "DEPEG";
  if (!i.coverage) {
    // Never "operational" without the asset list. While it is still loading
    // that is UNKNOWN ("Checking systems..."); once the fetch has failed it
    // will not resolve by waiting, so say so: degraded, coverage unavailable.
    return i.coverageErr ? "DRIFT" : "UNKNOWN";
  }
  const fresh = i.snapshotAgeSec != null && i.snapshotAgeSec < 60;
  const dark = i.coverage.dark.length > 0;
  if (fresh && !i.liveDegraded && !dark) return "PEGGED";
  return "DRIFT";
}

export function bannerCopy(
  overall: PegState,
  coverage: AssetCoverage | null,
  coverageErr = false,
): string {
  const darkN = coverage?.dark.length ?? 0;
  switch (overall) {
    case "PEGGED":
      return "All systems operational.";
    case "DRIFT":
      if (!coverage && coverageErr) {
        return "Degraded: asset coverage is unavailable right now.";
      }
      return darkN > 0 && coverage
        ? `Degraded: ${darkN} of ${coverage.total} assets have no fresh reading.`
        : "Operating with degraded freshness.";
    case "UNKNOWN":
      return "Checking systems...";
    default:
      return "Investigating an outage.";
  }
}
