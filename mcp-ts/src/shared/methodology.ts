// Methodology copy returned by the get_methodology tool, so agents can
// explain Pegana's mechanism to users without scraping the marketing site.
// Full prose lives at https://pegana.xyz/methodology; this is the summary.
//
// R1 audit idx 32: the copy used to be one static paragraph per class, which
// misdescribed real assets (USDS got the Hylo/hyUSD CDP text, USDC/USDT were
// said to use a Jupiter quote though they read Pyth spot, JLP got
// "yield-bearing stable" copy). It is now built per asset from the asset's
// actual intrinsic and market sources in assets.toml (via the generated
// @/shared/asset-registry), with a short class paragraph for context only.

import type { AssetClass } from "@/shared/types";
import type { AssetRegistryEntry, AssetSource } from "@/shared/asset-registry";

// What the class means, deliberately free of source claims (sources vary
// per asset inside a class; they are described per asset below).
const PER_CLASS: Record<AssetClass, string> = {
  lst: "Liquid staking token, pegged to SOL through stake-pool accounting: one token is worth the pool's SOL per token, which rises as staking rewards accrue.",
  stable_fiat:
    "Fiat-backed stablecoin, redeemable 1:1 for USD with the issuer, so its intrinsic value is $1.",
  stable_yield:
    "Yield-bearing token: its intrinsic value is a NAV / exchange rate that changes over time, so the discount compares the market price to that NAV, not to $1.",
  stable_cdp:
    "Crypto-collateralized stablecoin targeting $1.",
  stable_dn:
    "Delta-neutral synthetic dollar targeting $1. Its mechanism allows transient drift (for example when funding rates invert), so its alert thresholds are wider.",
  stable_fx:
    "Stablecoin pegged to a non-USD fiat currency: its intrinsic value is that currency's USD value from an FX feed.",
  stable_rwa:
    "RWA-backed token whose intrinsic value is the issuer's attested NAV.",
  synth_lev:
    "Synthetic / leveraged asset, informational rather than pegged in the conventional sense, so its bands are wide by design.",
};

function intrinsicText(src: AssetSource): string {
  switch (src.kind) {
    case "sanctum_lst":
      return "Intrinsic: the SOL value of one token from Sanctum's sol-value API, times Pyth SOL/USD.";
    case "spl_stake_pool":
      return "Intrinsic: total_lamports / pool_token_supply read from the on-chain SPL stake-pool account, times Pyth SOL/USD.";
    case "fixed_1_usd":
      return "Intrinsic: fixed at $1.";
    case "hylo_cr":
      return "Intrinsic: $1, backed by the on-chain Hylo Exchange collateral ratio (CR), which Pegana decodes directly; below the Stability-Mode floor the CR itself is the alert dimension.";
    case "hylo_xsol_nav":
      return "Intrinsic: xSOL NAV decoded from Hylo Exchange state, (collateral SOL - hyUSD supply in SOL) / xSOL supply, times Pyth SOL/USD.";
    case "hylo_shyusd_rate":
      return "Intrinsic: the Hylo Stability Pool exchange rate, pool hyUSD balance / sHYUSD supply, times $1.";
    case "pyth_fx_cross":
      return `Intrinsic: the peg currency's USD value from the Pyth ${src.feed ?? "FX"} feed${src.invert ? " (inverted)" : ""}.`;
    case "pyth_redemption_rate":
      return `Intrinsic: the issuer's NAV / redemption rate as published on Pyth (${src.feed ?? "redemption-rate feed"}).`;
    case "solayer_susd_rate":
      return "Intrinsic: the sUSD share rate read from Solayer's on-chain share account.";
    case "perena_usd_star_nav":
      return "Intrinsic: the USD* NAV read from Perena's on-chain reserve account.";
    case "piggybank_pb_vault":
      return "Intrinsic: the NAV read from the Piggybank vault account.";
    default:
      return `Intrinsic: source '${src.kind}'.`;
  }
}

function marketText(src: AssetSource): string {
  switch (src.kind) {
    case "jupiter_usd":
      return `Market: the Jupiter swap quote against ${src.numeraire ?? "the numeraire"}, times Pyth ${src.numeraire_feed ?? "USD"}.`;
    case "pyth_spot":
      return `Market: the Pyth ${src.feed ?? "spot"} spot price.`;
    case "dex_screener_usd":
      return "Market: the DexScreener USD price of the asset's top-liquidity Solana pair.";
    default:
      return `Market: source '${src.kind}'.`;
  }
}

// Applies to every asset (crates/engine-rs/src/main.rs EWMA_ALPHA,
// CONFIRM_UP_SECS, DECAY_DOWN_SECS).
const ENGINE_TEXT =
  "Pegana computes discount = 1 - market/intrinsic, smooths it with an EWMA (alpha 0.3) and applies hysteresis: a stricter state must hold for 30s to be entered and 120s to be exited.";

const FOOTER = "Full methodology + state machine: https://pegana.xyz/methodology";

export function methodologyFor(
  asset: string,
  cls: AssetClass | undefined,
  entry?: AssetRegistryEntry,
): string {
  const klass = entry?.class ?? cls;
  if (!klass) {
    return `Asset '${asset}' methodology: class unknown to this MCP server. See https://pegana.xyz/methodology for the full per-asset breakdown.`;
  }
  const parts = [PER_CLASS[klass]];
  if (entry) parts.push(`${intrinsicText(entry.intrinsic)} ${marketText(entry.market)}`);
  parts.push(ENGINE_TEXT);
  return `Asset '${asset}' (${klass}):\n\n${parts.join("\n\n")}\n\n${FOOTER}`;
}
