// Kamino HF-distribution adapter — Sub-C C3 (needs HELIUS_API_KEY).
//
// The anonymous cascade input. For each tracked asset's Kamino reserve, it
// enumerates obligations (getAllObligationsByDepositedReserve — reserve-scoped,
// NEVER *ByWallet*), computes each obligation's health factor from refreshedStats
// (liquidationLtv / loanToValue — NEVER reads `.owner`/`.state.owner`), folds them
// into k-floored HF bands, and discards the obligation objects. Writes
// loop_hf_distribution.
//
// ADR-0036 variant A enforced here:
//   • reserve-scoped enumeration only; owner never touched.
//   • a band with < K_MIN (5) obligations is DROPPED entirely (inv.7).
//   • a band where one obligation holds > 45% of the band collateral is
//     SUPPRESSED (l-diversity, inv.7).
//   • position_bucket is a k-floored RANGE; no raw counts, no pubkeys persisted.

import { createSolanaRpc, address, type Address } from "@solana/kit";
import { KaminoMarket, KaminoObligation, Obligation } from "@kamino-finance/klend-sdk";
import type Decimal from "decimal.js";
import { trackedAssets, upsertHfBand } from "../db";
import type { LoopHfBandRow, TrackedAsset } from "../db";
import type { Source } from "../core/poll";
import { computeHfBands, sleep, type HfEntry } from "../core/hf-bands";
import { incr } from "../metrics";
import { redactSecrets } from "../fetch-util";
import { isQuotaExhausted, QuotaExhaustedError } from "../rpc-quota";
import { pagedProgramAccounts, type GpaFilter } from "../rpc-paged";

const KLEND_MAIN = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const SLOT_MS = 450;

function heliusRpcUrl(): string | null {
  if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL; // test/one-off override
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : null;
}

// Enumerating every reserve back-to-back hammers the Helius Dev tier → 429.
// Pace between reserves + retry a rate-limited call with backoff.
const RESERVE_DELAY_MS = Number(process.env.KAMINO_HF_RESERVE_DELAY_MS ?? 1500);

const DEPOSITS_LIMIT = 8; // klend ObligationCollateral slots per obligation.
const OBLIGATION_SPAN = Obligation.layout.span + 8; // + 8-byte discriminator.
const OBLIGATION_RESERVE_BUDGET_MS = Number(
  process.env.KAMINO_HF_RESERVE_BUDGET_MS ?? 15 * 60_000,
);
const GPA_PAGE_SIZE = Number(process.env.KAMINO_HF_GPA_PAGE_SIZE ?? 1000);

type PageFn = typeof pagedProgramAccounts;

/**
 * Fold every obligation that deposited `reserve` into anonymous HfEntry rows,
 * STREAMING: at most one bounded gPA page (~GPA_PAGE_SIZE x 4.6 KB) is in memory
 * at a time and each obligation is folded then dropped. This replaces the SDK's
 * getAllObligationsByDepositedReserve, whose unpaginated getProgramAccounts
 * buffered hundreds of MB per call and OOM-looped the container (2026-10-21).
 * Throws PagingBudgetExceededError rather than returning a partial (misleading)
 * distribution.
 */
export async function streamReserveEntries(
  market: KaminoMarket,
  url: string,
  reserve: Address,
  slot: bigint,
  pager: PageFn = pagedProgramAccounts,
): Promise<HfEntry[]> {
  const deadlineMs = Date.now() + OBLIGATION_RESERVE_BUDGET_MS;
  const collateralExchangeRates = new Map<Address, Decimal>();
  const cumulativeBorrowRates = new Map<Address, Decimal>();
  const entries: HfEntry[] = [];
  for (let i = 0; i < DEPOSITS_LIMIT; i++) {
    const filters: GpaFilter[] = [
      { dataSize: OBLIGATION_SPAN },
      { memcmp: { offset: 96 + 136 * i, bytes: reserve.toString(), encoding: "base58" } },
      { memcmp: { offset: 32, bytes: market.address.toString(), encoding: "base58" } },
    ];
    try {
      for await (const page of pager(url, KLEND_PROGRAM, filters, {
        pageSize: GPA_PAGE_SIZE,
        deadlineMs,
      })) {
        for (const acct of page) {
          const state = Obligation.decode(Buffer.from(acct.data, "base64"));
          if (!state) continue;
          KaminoObligation.addRatesForObligation(
            market,
            state.deposits,
            state.borrows,
            collateralExchangeRates,
            cumulativeBorrowRates,
            slot,
          );
          const o = new KaminoObligation(
            market,
            acct.pubkey as Address,
            state,
            collateralExchangeRates,
            cumulativeBorrowRates,
          );
          const s = o.refreshedStats;
          const ltv = Number(s.loanToValue);
          const liq = Number(s.liquidationLtv);
          if (ltv <= 0) continue; // no borrow -> not part of the liquidation cascade
          const dep = o.deposits.get(reserve);
          entries.push({
            hf: liq / ltv,
            collateralUsd: dep ? Number(dep.marketValueRefreshed) : 0,
            debtUsd: Number(s.userTotalBorrow),
            liquidationLtv: liq,
          });
          // `o` (incl. its owner pubkey) goes out of scope here — never persisted.
        }
      }
    } catch (e) {
      if (isQuotaExhausted(e)) throw new QuotaExhaustedError("kamino_hf", e);
      throw e;
    }
  }
  return entries;
}

export async function fetchKaminoHfDistribution(
  tracked: TrackedAsset[],
): Promise<LoopHfBandRow[]> {
  const url = heliusRpcUrl();
  if (!url) {
    console.warn("[kamino_hf] HELIUS_API_KEY not set — C3 enumeration disabled");
    return [];
  }
  const rpc = createSolanaRpc(url);
  const slot = await rpc.getSlot().send();
  // The top-level @solana/kit (bumped in the tree by @jup-ag/lend-read) is a
  // different module instance than klend-sdk's nested one — same runtime RPC API,
  // mismatched nominal types. Cast to bridge; the rpc is a valid klend rpc at run.
  const market = await KaminoMarket.load(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc as any,
    address(KLEND_MAIN),
    SLOT_MS,
    address(KLEND_PROGRAM),
  );
  if (!market) throw new Error("[kamino_hf] market load returned null");

  // reserve-by-mint index (canonical join to Pegana assets).
  const reserveByMint = new Map<string, { addr: Address }>();
  for (const r of market.reserves.values()) reserveByMint.set(r.getLiquidityMint(), { addr: r.address });

  const ts = new Date().toISOString();
  const out: LoopHfBandRow[] = [];
  let paced = false;
  for (const a of tracked) {
    const res = reserveByMint.get(a.mint);
    if (!res) continue;
    if (paced) await sleep(RESERVE_DELAY_MS); // stay under the Helius rate limit
    paced = true;
    let entries: HfEntry[];
    try {
      entries = await streamReserveEntries(market, url, res.addr, slot);
    } catch (e) {
      // Quota exhaustion ends the CYCLE: walking the remaining reserves would
      // hit the same wall and burn more of an allowance that is already spent.
      if (e instanceof QuotaExhaustedError) {
        incr("pegana_protocol_rpc_quota_exhausted_total", { source: "kamino_hf" });
        console.error(
          `[kamino_hf] RPC quota exhausted at ${a.symbol} — aborting cycle. ` +
            `Retrying cannot help until the Helius allowance resets.`,
        );
        break;
      }
      console.warn(`[kamino_hf] ${a.symbol} enumeration failed (skipping reserve):`, redactSecrets(String(e)));
      continue;
    }
    out.push(...computeHfBands(a.symbol, "kamino", entries, ts, Number(slot)));
  }
  return out;
}

async function poll(): Promise<number> {
  const rows = await fetchKaminoHfDistribution(await trackedAssets());
  for (const row of rows) await upsertHfBand(row);
  return rows.length;
}

export const kaminoHfSource: Source = {
  name: "kamino_hf",
  // 60 min, NOT 10. This is the heaviest Helius consumer in the repo
  // (getAllObligationsByDepositedReserve enumerates every obligation in every
  // tracked reserve), and at 10 minutes it exhausted the plan allowance on
  // 2026-08-02, taking the whole HF surface dark for 8 days. The signal does
  // not need that rate: observed band counts held steady (18/36/10) across
  // consecutive 5-7 minute cycles, so liquidation bands are slow-moving.
  // Override with KAMINO_HF_POLL_MS if the plan allows more.
  intervalMs: Number(process.env.KAMINO_HF_POLL_MS ?? 3_600_000),
  poll,
};
