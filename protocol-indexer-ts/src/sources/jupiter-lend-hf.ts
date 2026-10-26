// Jupiter Lend HF-distribution adapter — Sub-C (needs HELIUS_API_KEY).
//
// The anonymous cascade input for Jupiter Lend (Fluid) borrow vaults. For each
// vault where a tracked asset is the COLLATERAL, it enumerates positions
// (batchGetUserPositions — vault-scoped by {vaultId, positionId}, NEVER
// per-wallet), computes each position's health factor from the Fluid tick math +
// exchange prices + oracle USD prices, folds them into k-floored HF bands, and
// discards the positions. Writes loop_hf_distribution (protocol="jupiter_lend").
//
// ADR-0036 variant A enforced here:
//   • vault-scoped enumeration only; no *UserPosition*(wallet) call; owner never
//     read (batchGetUserPositions returns NO owner field — verified).
//   • bands k-floored (< 5 dropped) + dominance-suppressed (> 45%) via computeHfBands.
//   • positions at/past their liquidation threshold (LTV >= liqThreshold) are
//     EXCLUDED — the SDK recomputes those post-liquidation via reads we avoid, so
//     skipping them is a conservative honest floor (never an over-estimate).
//
// The tick→borrow math is ported 1:1 from @jup-ag/lend-read and validated against
// the SDK's own buildNftPositionFromPositionAccount: supply + borrow match exactly
// for every healthy position (the SDK's blessed getAllPositionsWithRiskRatio can't
// run here — it uses an oracle-price tx `.simulate()` that Helius rejects).

import { Client } from "@jup-ag/lend-read";
import BN from "bn.js";
import { trackedAssets, upsertHfBand } from "../db";
import type { LoopHfBandRow, TrackedAsset } from "../db";
import type { Source } from "../core/poll";
import { computeHfBands, sleep, type HfEntry } from "../core/hf-bands";
import { num } from "../core/loop-util";
import { fetchJsonWithTimeout, redactSecrets } from "../fetch-util";
import { incr } from "../metrics";
import {
  isQuotaExhausted,
  isRetryableRpcFailure,
  QuotaExhaustedError,
} from "../rpc-quota";

const API = process.env.JUPITER_LEND_API_URL ?? "https://lite-api.jup.ag";
const VAULT_DELAY_MS = Number(process.env.JUPITER_HF_VAULT_DELAY_MS ?? 1200);
const CHUNK = 100; // batchGetUserPositions → one getMultipleAccounts per chunk.
const EXCHANGE_PREC = new BN(10).pow(new BN(12)); // Fluid EXCHANGE_PRICES_PRECISION.
const LIQ_SCALE = 1000; // liquidationThreshold is per-mille (900 = 90%).
// Fluid normalises position supply/borrow to a FIXED 9-decimal internal
// precision (NOT the token's own decimals). Verified 1:1 vs the REST vault totals:
// JLP vault (6-dec token) Σ supply ÷1e9 = $291M vs REST $291M; WSOL vault (9-dec)
// = $2.09M vs REST $2.09M. Both supply AND borrow use this scale (the LTV is
// consistent either way; only the absolute USD depends on it).
const INTERNAL_UNIT = 1e9;

// ── Fluid tick math (getRatioAtTick), ported verbatim from @jup-ag/lend-read ────
const FACTORS = [
  "18446744073709551616", "18419115400608638658", "18391528108445969703",
  "18336477419114433396", "18226869890870665593", "18009616477100071088",
  "17582847377087825313", "16759408633341240198", "15226414841393184936",
  "12568272644527235157", "8563108841104354677", "3975055583337633975",
  "856577552520149366", "39775317560084773", "85764505686420", "398745188",
].map((x) => new BN(x));
const MIN_TICK = -16383;
const MAX_TICK = 16383;
const mulShift64 = (a: BN, b: BN) => a.mul(b).shrn(64);

export function getRatioAtTick(tick: number): BN {
  const a = Math.abs(tick);
  let f = FACTORS[0];
  if (a & 1) f = FACTORS[1];
  if (a & 2) f = mulShift64(f, FACTORS[2]);
  if (a & 4) f = mulShift64(f, FACTORS[3]);
  if (a & 8) f = mulShift64(f, FACTORS[4]);
  if (a & 16) f = mulShift64(f, FACTORS[5]);
  if (a & 32) f = mulShift64(f, FACTORS[6]);
  if (a & 64) f = mulShift64(f, FACTORS[7]);
  if (a & 128) f = mulShift64(f, FACTORS[8]);
  if (a & 256) f = mulShift64(f, FACTORS[9]);
  if (a & 512) f = mulShift64(f, FACTORS[10]);
  if (a & 1024) f = mulShift64(f, FACTORS[11]);
  if (a & 2048) f = mulShift64(f, FACTORS[12]);
  if (a & 4096) f = mulShift64(f, FACTORS[13]);
  if (a & 8192) f = mulShift64(f, FACTORS[14]);
  if (a & 16384) f = mulShift64(f, FACTORS[15]);
  let precision = new BN(0);
  if (tick > 0) {
    f = new BN(2).pow(new BN(128)).sub(new BN(1)).div(f);
    if (!f.mod(new BN(65536)).isZero()) precision = new BN(1);
  }
  return f.shrn(16).add(precision);
}

function heliusRpcUrl(): string | null {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : null;
}

interface JlToken {
  address: string;
  decimals: number;
  price?: string;
}
interface JlRestVault {
  id: number;
  supplyToken: JlToken;
  borrowToken: JlToken;
  liquidationThreshold: number | string;
}

// Retry an RPC-backed call on a Helius RATE LIMIT with backoff.
//
// A quota exhaustion is NOT retried: it is also a 429, but the allowance does
// not come back within a backoff window, so every retry just spends another
// request against an allowance that is already gone. See src/rpc-quota.ts for
// the incident this encodes (8 days dark, ~250k wasted calls).
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (isQuotaExhausted(e)) throw new QuotaExhaustedError("jupiter_lend_hf", e);
      if (!isRetryableRpcFailure(e) || attempt >= retries) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// One vault's anonymous HF entries. No owner is ever read; positions at/past
// their liquidation threshold are excluded (honest floor).
async function vaultHfEntries(
  client: Client,
  rv: JlRestVault,
): Promise<HfEntry[]> {
  const vid = Number(rv.id);
  const liq = num(rv.liquidationThreshold) / LIQ_SCALE;
  const supPx = num(rv.supplyToken.price);
  const borPx = num(rv.borrowToken.price);
  if (!(liq > 0) || supPx <= 0 || borPx <= 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vault = client.vault as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vd: any = await withRetry(() => vault.getVaultEntireData(vid));
  const exSup = new BN(vd.exchangePricesAndRates.vaultSupplyExchangePrice.toString());
  const exBor = new BN(vd.exchangePricesAndRates.vaultBorrowExchangePrice.toString());
  const ids: number[] = await withRetry(() =>
    client.vault.getAllPositionIdsForVault(vid),
  );

  const entries: HfEntry[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids
      .slice(i, i + CHUNK)
      .map((positionId) => ({ vaultId: vid, positionId }));
    const raw = await withRetry(() => client.vault.batchGetUserPositions(chunk));
    for (const p of raw) {
      // Skip supply-only (no debt) — never read identity.
      if (!p || p.isSupplyOnlyPosition) continue;
      const t = p.tick as number;
      if (t < MIN_TICK || t > MAX_TICK) continue;
      const supRaw = new BN(p.supplyAmount.toString());
      if (supRaw.isZero()) continue;
      const supply = supRaw.mul(exSup).div(EXCHANGE_PREC);
      let bRaw = getRatioAtTick(t).mul(supRaw).shrn(48);
      const dust = new BN((p.dustDebtAmount ?? 0).toString());
      bRaw = bRaw.gt(dust) ? bRaw.sub(dust) : new BN(0);
      if (bRaw.isZero()) continue;
      const borrow = bRaw.mul(exBor).div(EXCHANGE_PREC);

      const colUsd = (num(supply.toString()) / INTERNAL_UNIT) * supPx;
      const debtUsd = (num(borrow.toString()) / INTERNAL_UNIT) * borPx;
      if (colUsd <= 0) continue;
      const ltv = debtUsd / colUsd;
      if (ltv >= liq) continue; // at/past liquidation → conservative floor skip
      entries.push({
        hf: liq / ltv,
        collateralUsd: colUsd,
        debtUsd,
        liquidationLtv: liq,
      });
    }
    await sleep(150); // small pace between chunks (Helius Dev tier)
  }
  return entries;
}

export async function fetchJupiterLendHfDistribution(
  tracked: TrackedAsset[],
): Promise<LoopHfBandRow[]> {
  const url = heliusRpcUrl();
  if (!url) {
    console.warn("[jupiter_lend_hf] HELIUS_API_KEY not set — enumeration disabled");
    return [];
  }
  const client = new Client(url);
  const byMint = new Map(tracked.map((a) => [a.mint, a.symbol]));

  let restVaults: JlRestVault[];
  try {
    restVaults = await fetchJsonWithTimeout<JlRestVault[]>(`${API}/lend/v1/borrow/vaults`, {
      headers: { accept: "application/json" },
    });
  } catch (e) {
    console.warn("[jupiter_lend_hf] vaults REST fetch failed:", redactSecrets(String(e)));
    return [];
  }

  // An asset can be collateral in several vaults (e.g. JLP → USDC/USDT/WSOL/…).
  // Accumulate a token's positions ACROSS all its vaults, then run one
  // computeHfBands per token — so k-anonymity + dominance apply over the whole
  // per-token distribution (not per-vault) and each band is written once.
  const entriesBySymbol = new Map<string, HfEntry[]>();
  let paced = false;
  for (const rv of restVaults) {
    const symbol = byMint.get(rv.supplyToken?.address);
    if (!symbol) continue; // collateral is not a tracked asset
    if (paced) await sleep(VAULT_DELAY_MS); // stay under the Helius rate limit
    paced = true;
    try {
      const entries = await vaultHfEntries(client, rv);
      const acc = entriesBySymbol.get(symbol) ?? [];
      acc.push(...entries);
      entriesBySymbol.set(symbol, acc);
    } catch (e) {
      // Quota exhaustion ends the CYCLE, not just this vault. Continuing would
      // walk every remaining vault into the same wall, which is precisely the
      // storm that burned the allowance for 8 days.
      if (e instanceof QuotaExhaustedError) {
        incr("pegana_protocol_rpc_quota_exhausted_total", {
          source: "jupiter_lend_hf",
        });
        console.error(
          `[jupiter_lend_hf] RPC quota exhausted at vault ${rv.id} — aborting cycle. ` +
            `Retrying cannot help until the Helius allowance resets.`,
        );
        break;
      }
      console.warn(
        `[jupiter_lend_hf] ${symbol} vault ${rv.id} failed:`,
        redactSecrets(String(e)),
      );
    }
  }

  const ts = new Date().toISOString();
  const out: LoopHfBandRow[] = [];
  for (const [symbol, entries] of entriesBySymbol) {
    out.push(...computeHfBands(symbol, "jupiter_lend", entries, ts, null));
  }
  return out;
}

async function poll(): Promise<number> {
  const rows = await fetchJupiterLendHfDistribution(await trackedAssets());
  for (const row of rows) await upsertHfBand(row);
  return rows.length;
}

export const jupiterLendHfSource: Source = {
  name: "jupiter_lend_hf",
  // 60 min, NOT 10 — see the note on kamino-hf. Same allowance, same incident.
  // Override with JUPITER_HF_POLL_MS if the plan allows more.
  intervalMs: Number(process.env.JUPITER_HF_POLL_MS ?? 3_600_000),
  poll,
};
