// Jupiter Lend adapter — Sub-C C2 "loop_exposure" (FREE, no key).
//
// Jupiter Lend (Fluid/Instadapp) borrow vaults ARE CDP leverage by construction:
// a vault supplies `supplyToken` (collateral) to borrow `borrowToken` (debt).
// Free REST: GET lite-api.jup.ag/lend/v1/borrow/vaults → per-vault
//   { supplyToken{address,decimals,price}, borrowToken{...}, totalSupply,
//     totalBorrow, totalPositions, liquidationThreshold }.
//
// Per asset (joined by mint to Pegana's tracked assets):
//   collateral_lev_usd = Σ (supply → USD) where the asset is the vault collateral
//   debt_usd           = Σ (borrow → USD) where the asset is the vault debt
//   position_bucket    = k-FLOORED range of Σ totalPositions (ADR-0036 inv.7)
//
// ADR-0036: aggregate vault totals only; no per-position read, no owner.

import { trackedAssets, upsertLoopExposure } from "../db";
import type { LoopExposureRow, TrackedAsset } from "../db";
import type { Source } from "../core/poll";
import { positionBucket, num, usdFromRaw } from "../core/loop-util";
import { fetchJsonWithTimeout } from "../fetch-util";

const API = process.env.JUPITER_LEND_API_URL ?? "https://lite-api.jup.ag";

interface JlToken {
  address: string;
  decimals: number;
  price?: string;
}
interface JlVault {
  supplyToken: JlToken;
  borrowToken: JlToken;
  totalSupply?: string;
  totalBorrow?: string;
  totalPositions?: string | number;
}

interface PerMint {
  collateralLevUsd: number;
  debtUsd: number;
  obligations: number;
}

/** A token usable for USD conversion: integer decimals >= 0 and a finite price > 0. */
function isPricedToken(token: JlToken | null | undefined): token is JlToken {
  return (
    !!token &&
    Number.isInteger(token.decimals) &&
    token.decimals >= 0 &&
    token.price != null &&
    Number.isFinite(Number(token.price)) &&
    Number(token.price) > 0
  );
}

export async function fetchJupiterLendExposure(
  tracked: TrackedAsset[],
): Promise<LoopExposureRow[]> {
  const byMint = new Map(tracked.map((a) => [a.mint, a.symbol]));
  const agg = new Map<string, PerMint>();
  const bump = (mint: string): PerMint => {
    let v = agg.get(mint);
    if (!v) { v = { collateralLevUsd: 0, debtUsd: 0, obligations: 0 }; agg.set(mint, v); }
    return v;
  };

  let coverage: LoopExposureRow["coverage"] = "full";
  let vaults: JlVault[];
  try {
    vaults = await fetchJsonWithTimeout<JlVault[]>(`${API}/lend/v1/borrow/vaults`, {
      headers: { accept: "application/json" },
    });
  } catch (e) {
    console.warn(`[jupiter_lend] vaults fetch failed:`, String(e));
    return []; // no data → nothing to upsert this cycle
  }

  let skipped = 0;
  for (const v of vaults) {
    if (!isPricedToken(v.supplyToken) || !isPricedToken(v.borrowToken)) {
      coverage = "partial";
      skipped += 1;
      continue;
    }
    const sMint = v.supplyToken?.address;
    const bMint = v.borrowToken?.address;
    if (sMint && byMint.has(sMint)) {
      const e = bump(sMint);
      e.collateralLevUsd += usdFromRaw(v.totalSupply, v.supplyToken.decimals, v.supplyToken.price);
      e.obligations += Math.round(num(v.totalPositions));
    }
    if (bMint && byMint.has(bMint)) {
      bump(bMint).debtUsd += usdFromRaw(v.totalBorrow, v.borrowToken.decimals, v.borrowToken.price);
    }
  }

  // One line per poll, not per vault: the cause of a "partial" row must be visible.
  if (skipped > 0) {
    console.warn(`[jupiter_lend] skipped ${skipped} invalid vaults; coverage=partial`);
  }

  const ts = new Date().toISOString();
  const rows: LoopExposureRow[] = [];
  for (const [mint, e] of agg) {
    const symbol = byMint.get(mint);
    if (!symbol) continue;
    if (e.collateralLevUsd === 0 && e.debtUsd === 0) continue;
    rows.push({
      asset: symbol,
      protocol: "jupiter_lend",
      // In a borrow vault, supplied collateral IS the leverage collateral.
      collateral_usd: e.collateralLevUsd ? e.collateralLevUsd.toString() : null,
      collateral_lev_usd: e.collateralLevUsd.toString(),
      debt_usd: e.debtUsd.toString(),
      loop_basis: "typed",
      position_bucket: positionBucket(e.obligations),
      coverage,
      source_slot: null,
      ts,
    });
  }
  return rows;
}

async function poll(): Promise<number> {
  const rows = await fetchJupiterLendExposure(await trackedAssets());
  for (const row of rows) await upsertLoopExposure(row);
  return rows.length;
}

export const jupiterLendSource: Source = {
  name: "jupiter_lend",
  intervalMs: Number(process.env.JUPITER_LEND_POLL_MS ?? 300_000),
  poll,
};
