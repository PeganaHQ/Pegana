/**
 * Central glossary — single source of truth for every technical term
 * surfaced to the user. Keep definitions short (≤ 2 short sentences),
 * power-user friendly but understandable on first read.
 *
 * Consumed by:
 *  - `<HelpIcon term="bps" />` — small "(?)" affordance with hover tooltip
 *  - `/glossary` page — full listing organized by section
 */

export type GlossaryTerm =
  // Value model
  | "intrinsic"
  | "market"
  | "spread"
  | "discount"
  | "premium"
  | "bps"
  | "market_cap"
  // Signals
  | "recovery_confidence"
  | "peg_stability"
  // Peg states
  | "pegged"
  | "drift"
  | "depeg"
  | "critical"
  | "black_swan"
  | "unknown"
  // Asset classes
  | "lst"
  | "stable_fiat"
  | "stable_cdp"
  | "stable_dn"
  | "stable_yield"
  | "stable_fx"
  | "synth_lev"
  // Sources
  | "sanctum"
  | "pyth"
  | "oracle_crosscheck"
  | "intrinsic_liveness"
  | "jupiter"
  | "hylo";

export const GLOSSARY: Record<GlossaryTerm, { title: string; body: string }> = {
  // ── Value model ─────────────────────────────────────────────────────
  intrinsic: {
    title: "Intrinsic value",
    body: "What the asset is worth based on its underlying mechanism. e.g. Sanctum's sol_value for LSTs, $1 for fiat stables, on-chain CR for Hylo. Source of truth, not market sentiment.",
  },
  market: {
    title: "Market value",
    body: "What you'd actually receive trading the asset right now: the deepest Jupiter route quote, repriced through Pyth into the peg target unit.",
  },
  spread: {
    title: "Spread",
    body: "The signed gap between an asset's intrinsic (fair) value and its market price. A NEGATIVE spread means the market trades ABOVE intrinsic, a premium. A POSITIVE spread means the market trades BELOW intrinsic, a discount (cheaper than fair).",
  },
  discount: {
    title: "Discount",
    body: "Market price below intrinsic: the asset is cheaper than fair value, shown as a POSITIVE spread. Often a sign of stress or illiquidity.",
  },
  premium: {
    title: "Premium",
    body: "Market price above an asset's intrinsic (fair) value, shown as a NEGATIVE spread. Often a small demand premium that arbitrage tends to pull back toward fair value.",
  },
  bps: {
    title: "Basis points (bps)",
    body: "100 bps = 1%. The underlying unit for state thresholds and alert subscriptions, e.g. a drift threshold of 20 bps fires at ±0.20%. The dashboard always renders spreads as % (so 20 bps shows as 0.20%); bps remains the canonical unit for configuration.",
  },
  market_cap: {
    title: "Market cap",
    body: "Circulating supply × price, a SIZE signal (not peg-safety). A large stablecoin can still depeg: USDC was $30B+ in market cap when its SVB-driven depeg hit in March 2023.",
  },

  // ── Signals ─────────────────────────────────────────────────────────
  recovery_confidence: {
    title: "Recovery confidence",
    body: "An editorial read on how likely the current spread is to mean-revert, combining time spent pegged, state flips, and peer convergence into an A–D grade. It is a heuristic, not a guarantee. During the calibration window the alert history is thin, so the grade is scored conservatively and marked “calibrating.”",
  },
  peg_stability: {
    title: "Peg stability (jitter)",
    body: "How much the spread has wobbled over the last 24h: the standard deviation of the spread series, in bps. A steady −0.30% and a whipsawing ±0.30% read identically in the spread number but very differently here. Rising jitter often precedes a depeg, so it acts as a leading indicator.",
  },

  // ── Peg states ──────────────────────────────────────────────────────
  pegged: {
    title: "Pegged",
    body: "Spread within ±0.20% of intrinsic. Normal state: the asset is trading at fair value.",
  },
  drift: {
    title: "Drift",
    body: "Spread between 0.20% and 1.00%. Early warning: peg is loosening but not yet broken. Orderbook may be repricing.",
  },
  depeg: {
    title: "Depeg",
    body: "Spread between 1.00% and 3.00%. Confirmed dislocation: the asset is trading meaningfully away from its peg.",
  },
  critical: {
    title: "Critical",
    body: "Spread beyond 3.00%. Severe break; usually requires immediate attention. Per-asset thresholds may differ.",
  },
  black_swan: {
    title: "Black Swan",
    body: "Catastrophic divergence: multi-percent break sustained for hours. Rare and historically tied to protocol-level failures.",
  },
  unknown: {
    title: "Unknown",
    body: "We have no recent reading for this asset. Could be an indexer hiccup, RPC outage, or a brand-new mint we haven't fully validated yet.",
  },

  // ── Asset classes ───────────────────────────────────────────────────
  lst: {
    title: "Liquid Staking Token (LST)",
    body: "A token representing staked SOL that earns rewards. Its intrinsic value grows over time relative to SOL as the stake pool accrues yield. Examples: jitoSOL, mSOL, bSOL.",
  },
  stable_fiat: {
    title: "Fiat-backed stablecoin",
    body: "Pegged 1:1 to a fiat currency (usually USD) and backed by off-chain reserves like cash or treasuries. Intrinsic = canonical $1.0000. Examples: USDC, USDT, PYUSD.",
  },
  stable_cdp: {
    title: "CDP stablecoin",
    body: "Soft-pegged stablecoin backed by on-chain collateral in an over-collateralized debt position. Intrinsic = collateralization ratio × $1. Example: hyUSD (Hylo).",
  },
  stable_dn: {
    title: "Delta-neutral stablecoin",
    body: "Pegged via a delta-neutral position (e.g. long spot + short perp). Intrinsic ≈ Pyth latest. Example: USDe (Ethena).",
  },
  stable_yield: {
    title: "Yield-bearing stable",
    body: "A stablecoin that accrues yield from an underlying pool. Intrinsic = pool balance ÷ supply × $1. Example: eHYUSD (Hylo Earn Pool).",
  },
  stable_fx: {
    title: "FX-pegged stable",
    body: "Stablecoin pegged to a non-USD fiat currency. Intrinsic is derived from a Pyth FX cross (e.g. EUR/USD). Example: EURC.",
  },
  synth_lev: {
    title: "Leveraged synthetic",
    body: "Token that gives leveraged exposure to an underlying asset (e.g. SOL). Intrinsic computed from the protocol's NAV formula. Example: xSOL (Hylo Exchange).",
  },

  // ── Sources ─────────────────────────────────────────────────────────
  sanctum: {
    title: "Sanctum",
    body: "Source of LST stake-pool accounting. We read each LST's canonical SOL backing per share from Sanctum's public data.",
  },
  pyth: {
    title: "Pyth",
    body: "First-party price oracle. We use its live feeds for SOL/USD, FX crosses (e.g. EUR/USD), and delta-neutral references.",
  },
  oracle_crosscheck: {
    title: "Oracle cross-check",
    body: "An independent Pyth spot feed for the asset's own USD price, used as a separate cross-check on the market quote, distinct from the pricing-numeraire feed behind 'Pyth oracle confidence'. The amber flag shows when this oracle diverges from the market, reads a wide confidence interval, or goes stale.",
  },
  intrinsic_liveness: {
    title: "Backing liveness",
    body: "An amber heads-up that this LST's backing may be frozen: the LST directory (maintained by Hylo) flags its rate as stale, the LST as deprecated, or the pool as dead. A frozen-but-still-served backing can otherwise read as a confident peg; this flag is the backing-side twin of the oracle cross-check.",
  },
  jupiter: {
    title: "Jupiter",
    body: "Solana's deepest swap aggregator. We read live quotes across the best route to get the realised market price.",
  },
  hylo: {
    title: "Hylo",
    body: "On-chain CDP protocol on Solana. We read its on-chain state to compute hyUSD's collateralization ratio and xSOL's NAV.",
  },
};
