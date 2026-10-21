// The tracked-asset registry, generated from the repo-root assets.toml.
//
// Gives the MCP server, without any network call:
//   * which symbols Pegana tracks (so a tracked asset with no live snapshot
//     is reported as such, not as "not tracked"), and
//   * each asset's class and its actual intrinsic + market sources, so
//     get_methodology explains the real mechanism per asset instead of a
//     per-class guess.
//
// DO NOT EDIT the entries by hand: run `bun run scripts/gen-asset-registry.ts`
// (from mcp-ts/). test/unit/asset-registry.test.ts fails on any drift from
// assets.toml.

import type { AssetClass, PegTarget } from "@/shared/types";

export interface AssetSource {
  kind: string;
  feed?: string;
  invert?: boolean;
  numeraire?: string;
  numeraire_feed?: string;
}

export interface AssetRegistryEntry {
  symbol: string;
  class: AssetClass;
  peg_target: PegTarget;
  /** `active = false` in assets.toml: listed, but not polled. */
  active: boolean;
  intrinsic: AssetSource;
  market: AssetSource;
}

export const ASSET_REGISTRY: readonly AssetRegistryEntry[] = [
  // @generated-entries
  {"symbol":"jitoSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"spl_stake_pool"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"mSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"bSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"INF","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"bbSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"JupSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"USDC","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"USDC/USD"}},
  {"symbol":"USDT","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"USDT/USD"}},
  {"symbol":"PYUSD","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"USDe","class":"stable_dn","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"USDS","class":"stable_cdp","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"hyUSD","class":"stable_cdp","peg_target":"USD","active":true,"intrinsic":{"kind":"hylo_cr"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"hyloSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"hyloSOL+","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"sHYUSD","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"hylo_shyusd_rate"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"xSOL","class":"synth_lev","peg_target":"USD","active":true,"intrinsic":{"kind":"hylo_xsol_nav"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"BRZ","class":"stable_fx","peg_target":"BRL","active":false,"intrinsic":{"kind":"pyth_fx_cross","feed":"USD/BRL","invert":true},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"USDY","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"USDY/USD.RR"},"market":{"kind":"pyth_spot","feed":"USDY/USD"}},
  {"symbol":"sUSDe","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"SUSDE/USDE.RR"},"market":{"kind":"pyth_spot","feed":"SUSDE/USD"}},
  {"symbol":"syrupUSDC","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"SYRUPUSDC/USDC.RR"},"market":{"kind":"pyth_spot","feed":"SYRUPUSDC/USD"}},
  {"symbol":"sUSD","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"solayer_susd_rate"},"market":{"kind":"dex_screener_usd"}},
  {"symbol":"ONyc","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"ONYC/USD.NAV"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"pbUSDC","class":"stable_yield","peg_target":"USD","active":false,"intrinsic":{"kind":"piggybank_pb_vault"},"market":{"kind":"dex_screener_usd"}},
  {"symbol":"JupUSD","class":"stable_dn","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"JLP","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"JLP/USD.RR"},"market":{"kind":"pyth_spot","feed":"JLP/USD"}},
  {"symbol":"EURC","class":"stable_fx","peg_target":"EUR","active":true,"intrinsic":{"kind":"pyth_fx_cross","feed":"EUR/USD","invert":false},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"dzSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"vSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"USX","class":"stable_dn","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"USX/USD"}},
  {"symbol":"USDG","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"USDG/USD"}},
  {"symbol":"USD1","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"USD1/USD"}},
  {"symbol":"USDu","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"CASH","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"AUSD","class":"stable_fiat","peg_target":"USD","active":true,"intrinsic":{"kind":"fixed_1_usd"},"market":{"kind":"pyth_spot","feed":"AUSD/USD"}},
  {"symbol":"eUSX","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"EUSX/USX.RR"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"PST","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"pyth_redemption_rate","feed":"PST/USDC.RR"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  {"symbol":"BNSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"dynoSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"PSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"JSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"hSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"edgeSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"jagSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"definSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"sharkSOL","class":"lst","peg_target":"SOL","active":false,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"BulkSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"bonkSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"cgntSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"LST","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"CDCSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"bpSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"haSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"laineSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"xandSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"raiSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"picoSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"mangoSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"iASOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"lanternSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"RoXSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"proSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"STKESOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"spl_stake_pool"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"rkuSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"spl_stake_pool"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"corvusSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"spl_stake_pool"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"dumSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"sctmSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"xSHIN","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"aeroSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"dfdvSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"GTSOL","class":"lst","peg_target":"SOL","active":true,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"dSOL","class":"lst","peg_target":"SOL","active":false,"intrinsic":{"kind":"sanctum_lst"},"market":{"kind":"jupiter_usd","numeraire":"SOL","numeraire_feed":"SOL/USD"}},
  {"symbol":"USD*","class":"stable_yield","peg_target":"USD","active":true,"intrinsic":{"kind":"perena_usd_star_nav"},"market":{"kind":"jupiter_usd","numeraire":"USDC","numeraire_feed":"USDC/USD"}},
  // @end-generated-entries
];

const BY_SYMBOL = new Map(ASSET_REGISTRY.map((e) => [e.symbol, e]));

/**
 * Classes served by no public surface. REST answers 404 for them on every
 * /v1/assets route (crates/api-rs/src/schema.rs NON_PUBLIC_CLASSES), so the
 * MCP tools treat them as not tracked too. They stay in the generated
 * entries above (the drift test mirrors assets.toml exactly) but are hidden
 * by registryEntry() / isNonPublicSymbol().
 */
const NON_PUBLIC_CLASSES: ReadonlySet<string> = new Set(["synth_lev"]);

/** True for a registry symbol whose class is off every public surface (xSOL). */
export function isNonPublicSymbol(symbol: string): boolean {
  const e = BY_SYMBOL.get(symbol);
  return e !== undefined && NON_PUBLIC_CLASSES.has(e.class);
}

/**
 * Registry entry for an exact (case-sensitive) symbol, if Pegana lists it
 * publicly. Off-surface classes (xSOL) read as not tracked, like REST.
 */
export function registryEntry(symbol: string): AssetRegistryEntry | undefined {
  return isNonPublicSymbol(symbol) ? undefined : BY_SYMBOL.get(symbol);
}

/**
 * Error text for a symbol with no live snapshot, worded by what is actually
 * known: listed and active (no snapshot yet), listed but inactive, or not
 * listed at all. Same wording family as REST
 * (`asset 'X' is tracked but has no snapshot yet`).
 */
export function missingSnapshotMessage(symbol: string, what = "snapshot"): string {
  const entry = registryEntry(symbol);
  if (!entry) {
    return `Error: asset '${symbol}' not tracked. Use get_assets() to list tracked symbols.`;
  }
  if (!entry.active) {
    return `Error: asset '${symbol}' is listed but inactive (not polled), so it has no live ${what}.`;
  }
  return `Error: asset '${symbol}' is tracked but has no live ${what} yet (state UNKNOWN). Retry later; get_assets() lists the assets with live data.`;
}
