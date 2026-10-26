// Kamino Lend adapter — Sub-C C1 "loop_exposure" (FREE, no Helius key).
//
// Reads Kamino's public REST (api.kamino.finance) — the aggregate leverage
// path, which needs NO on-chain enumeration and NO API key:
//   GET /kamino-market/{market}/reserves/metrics  → reserve → {mint, symbol, USD totals}
//   GET /kamino-market/{market}/leverage/metrics  → per reserve-PAIR leverage stats
//
// Per asset (joined by on-chain mint to Pegana's tracked assets):
//   collateral_lev_usd = Σ totalDepositedUsd where the asset is the deposit (loop collateral)
//   debt_usd           = Σ totalBorrowedUsd  where the asset is the borrow  (loop short leg)
//   collateral_usd     = the reserve's totalSupplyUsd (all supply, not just leverage)
//   position_bucket    = k-FLOORED range of Σ totalObligations (ADR-0036 inv.7 — NEVER a raw count)
//
// ADR-0036: reserve-scoped, anonymous, aggregate only. No obligation is
// enumerated; no owner is read. Validated 1:1 against live data (main market
// leveraged collateral = $80.2M, matches Kamino's own figure).

import { trackedAssets, upsertLoopExposure } from "../db";
import type { LoopExposureRow, TrackedAsset } from "../db";
import type { Source } from "../core/poll";
import { positionBucket, num } from "../core/loop-util";
import { fetchJsonWithTimeout } from "../fetch-util";

const API = process.env.KAMINO_API_URL ?? "https://api.kamino.finance";
const KLEND_MAIN = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

interface KaminoReserve {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  totalSupplyUsd?: string;
  totalBorrowUsd?: string;
}
interface KaminoLevPair {
  depositReserve: string;
  borrowReserve: string;
  totalDepositedUsd?: string;
  totalBorrowedUsd?: string;
  totalObligations?: string | number;
}
interface KaminoMarketInfo {
  lendingMarket?: string;
  isPrimary?: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  return fetchJsonWithTimeout<T>(url, { headers: { accept: "application/json" } });
}

// Markets to poll: whatever /kamino-market advertises, plus any in the
// KAMINO_MARKETS env override, always including the main market.
async function markets(): Promise<{ list: string[]; complete: boolean }> {
  const set = new Set<string>([KLEND_MAIN]);
  let complete = true;
  try {
    const list = await getJson<KaminoMarketInfo[]>(`${API}/kamino-market`);
    for (const m of list) if (m.lendingMarket) set.add(m.lendingMarket);
  } catch (e) {
    // The reason a poll is "partial" must be visible in the logs.
    console.warn(`[kamino] market list fetch failed; coverage=partial:`, String(e));
    complete = false;
  }
  for (const m of (process.env.KAMINO_MARKETS ?? "").split(",").map((s) => s.trim())) {
    if (m) set.add(m);
  }
  return { list: [...set], complete };
}

interface PerMint {
  collateralLevUsd: number;
  debtUsd: number;
  collateralUsd: number;
  obligations: number;
}

// Fetch + join Kamino leverage into per-asset rows for the given tracked assets.
// Pure of the DB (no reads/writes) so it can be dry-run and unit-tested against
// live or fixture data. Returns the rows that WOULD be upserted.
export async function fetchKaminoExposure(
  tracked: TrackedAsset[],
): Promise<LoopExposureRow[]> {
  const byMint = new Map(tracked.map((a) => [a.mint, a.symbol]));
  const agg = new Map<string, PerMint>(); // mint -> aggregate
  const bump = (mint: string): PerMint => {
    let v = agg.get(mint);
    if (!v) { v = { collateralLevUsd: 0, debtUsd: 0, collateralUsd: 0, obligations: 0 }; agg.set(mint, v); }
    return v;
  };

  const discovered = await markets();
  let coverage: LoopExposureRow["coverage"] = discovered.complete ? "full" : "partial";
  for (const mkt of discovered.list) {
    let reserves: KaminoReserve[];
    let pairs: KaminoLevPair[];
    try {
      [reserves, pairs] = await Promise.all([
        getJson<KaminoReserve[]>(`${API}/kamino-market/${mkt}/reserves/metrics`),
        getJson<KaminoLevPair[]>(`${API}/kamino-market/${mkt}/leverage/metrics`),
      ]);
    } catch (e) {
      console.warn(`[kamino] market ${mkt} fetch failed:`, String(e));
      coverage = "partial";
      continue;
    }
    const rmap = new Map(reserves.map((r) => [r.reserve, r]));
    // Total supply USD per mint (all collateral, not just leverage).
    for (const r of reserves) {
      if (byMint.has(r.liquidityTokenMint)) bump(r.liquidityTokenMint).collateralUsd += num(r.totalSupplyUsd);
    }
    for (const p of pairs) {
      const dep = rmap.get(p.depositReserve);
      const bor = rmap.get(p.borrowReserve);
      const n = Math.round(num(p.totalObligations));
      if (dep && byMint.has(dep.liquidityTokenMint)) {
        const v = bump(dep.liquidityTokenMint);
        v.collateralLevUsd += num(p.totalDepositedUsd);
        v.obligations += n;
      }
      if (bor && byMint.has(bor.liquidityTokenMint)) {
        bump(bor.liquidityTokenMint).debtUsd += num(p.totalBorrowedUsd);
      }
    }
  }

  const ts = new Date().toISOString();
  const rows: LoopExposureRow[] = [];
  for (const [mint, v] of agg) {
    const symbol = byMint.get(mint);
    if (!symbol) continue;
    // Skip assets with no Kamino leverage at all — a zero row is noise.
    if (v.collateralLevUsd === 0 && v.debtUsd === 0) continue;
    rows.push({
      asset: symbol,
      protocol: "kamino",
      collateral_usd: v.collateralUsd ? v.collateralUsd.toString() : null,
      collateral_lev_usd: v.collateralLevUsd.toString(),
      debt_usd: v.debtUsd.toString(),
      loop_basis: "typed",
      position_bucket: positionBucket(v.obligations),
      coverage,
      source_slot: null,
      ts,
    });
  }
  return rows;
}

async function poll(): Promise<number> {
  const rows = await fetchKaminoExposure(await trackedAssets());
  for (const row of rows) await upsertLoopExposure(row);
  return rows.length;
}

export const kaminoSource: Source = {
  name: "kamino",
  intervalMs: Number(process.env.KAMINO_POLL_MS ?? 300_000),
  poll,
};
