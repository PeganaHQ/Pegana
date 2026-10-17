// Static per-class methodology copy. Returned by the getMethodology
// tool so agents can explain Pegana's mechanism to users without
// scraping the marketing site. Full prose lives at
// https://pegana.xyz/methodology — this is the executive summary.

import type { AssetClass } from "@/shared/types";

const PER_CLASS: Record<AssetClass, string> = {
  lst: "LSTs price in two places — Sanctum's stake-pool calculator (intrinsic, in SOL terms × Pyth SOL/USD) and Jupiter's market quote (effective rate × Pyth SOL/USD). Pegana takes the EWMA of (1 − market/intrinsic) over a sliding window and applies per-asset hysteresis windows of 30s entry / 120s exit.",
  stable_fiat:
    "Fiat-backed stables (USDC, USDT, PYUSD, USDS) are pegged to $1 — intrinsic is hardcoded; market is Jupiter quote vs USDC.",
  stable_yield:
    "Yield-bearing stables use NAV semantics — intrinsic is the issuer's attested NAV via Pyth Redemption Rate feeds (USDY, syrupUSDC, sUSDe) or Token-2022 InterestBearing rebasing rate (sUSD). Market is Jupiter quote.",
  stable_cdp:
    "CDP stables (hyUSD) decode the on-chain Hylo Exchange state to compute collateral ratio (CR). Intrinsic is implicit at $1 above the Stability-Mode floor; below floor, CR itself is the alert dimension.",
  stable_dn:
    "Delta-neutral stables (USDe) — intrinsic is $1; market is Jupiter. Pegana applies wider thresholds because the mechanism allows transient drift under funding-rate inversion.",
  stable_fx:
    "FX-pegged stables (e.g. EUR/BRL-pegged) — intrinsic target is derived from the relevant Pyth FX feed (e.g. EUR/USD, USD/BRL). Market is Jupiter. Wide thresholds reflect thin Jupiter FX-stable liquidity.",
  stable_rwa:
    "RWA-backed stables — intrinsic comes from issuer NAV attestations via Pyth Redemption Rate feeds. Market is Jupiter quote vs USDC.",
  synth_lev:
    "Synthetic / leveraged assets (xSOL) — wide bands by design. The asset is informational, not pegged in the conventional sense.",
};

export function methodologyFor(
  asset: string,
  cls: AssetClass | undefined,
): string {
  if (!cls) {
    return `Asset '${asset}' methodology: class unknown to this MCP server. See https://pegana.xyz/methodology for the full per-asset breakdown.`;
  }
  return `Asset '${asset}' (${cls}):\n\n${PER_CLASS[cls]}\n\nFull methodology + state machine: https://pegana.xyz/methodology`;
}
