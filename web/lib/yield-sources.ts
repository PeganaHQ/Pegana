/**
 * Per-asset yield mechanism descriptions for yield-bearing stables.
 *
 * Surfaces on `/asset/[symbol]` pages where `class === "stable_yield"`.
 * Tells the user WHERE the yield comes from + KEY RISKS, in plain language.
 *
 * Phase A coverage (Task 16): 7 issuers — USDY (Ondo), sUSDe (Ethena),
 * syrupUSDC (Maple), sUSD (Solayer), USD* (Perena), ONyc (OnRe), pbUSDC
 * (Piggybank). Note: sHYUSD has its own Hylo-specific surface and is not
 * included here.
 */

export interface YieldSourceMeta {
  /** Short label for the mechanism, e.g. "T-bills" or "Funding-rate arbitrage". */
  mechanism: string;
  /** One-paragraph description suitable for non-technical readers. */
  description: string;
  /** What can go wrong — Pegana's job is to alert on these. */
  risks: string;
  /** Issuer's own docs / canonical reference. */
  link: string;
}

export const YIELD_SOURCES: Record<string, YieldSourceMeta> = {
  USDY: {
    mechanism: "T-bills",
    description:
      "Ondo holds short-term U.S. Treasury bills and high-quality bank deposits. Yield accrues automatically as the NAV (redemption price) grows daily.",
    risks:
      "Treasury market shock; Ondo issuer credit; bridge attestation lag for non-Ethereum chains.",
    link: "https://ondo.finance/usdy",
  },
  sUSDe: {
    mechanism: "Funding-rate arbitrage",
    description:
      "Ethena holds delta-neutral positions across perpetual DEXs and earns funding rates while staying delta-zero.",
    risks:
      "Negative funding regime; centralized custody of perp collateral; Solana-side attestation lag vs Ethereum source rate.",
    link: "https://ethena.fi",
  },
  syrupUSDC: {
    mechanism: "Institutional lending",
    description:
      "Maple lends pooled USDC to KYC'd institutional borrowers at over-collateralized fixed rates. NAV grows as borrowers pay interest.",
    risks:
      "Borrower default; collateral price shock; liquidity window during withdrawals.",
    link: "https://app.maple.finance",
  },
  sUSD: {
    mechanism: "T-bills + restaking MEV",
    description:
      "Solayer holds T-bills via OpenEden and earns additional yield from MEV captured by its restaking infrastructure. Rebasing token. Your wallet balance grows.",
    risks: "T-bill market shock; restaking slashing; MEV regime change.",
    link: "https://solayer.org/susd",
  },
  // `USD*` is keyed by the symbol literally as it appears in `assets.toml`.
  // Map this from the symbol field on AssetCardData — no URL encoding needed
  // since lookups happen in JS via property access.
  "USD*": {
    mechanism: "Multi-stable pool",
    description:
      "Perena's Numéraire seed pool combines USDC + USDT + PYUSD into a single LP token. NAV grows from AMM fees + redirected underlying yield.",
    risks:
      "Underlying stable depeg; pool composition skew under stress; LP fee compression.",
    link: "https://app.perena.org",
  },
  ONyc: {
    mechanism: "Reinsurance",
    description:
      "OnRe collateralizes short-duration reinsurance contracts. NAV reflects underwriting performance + collateral yield. Notably NOT pegged to $1. It's yield-bearing by design.",
    risks:
      "Catastrophic claim event; underwriting cycle reversal; NAV is not pegged to $1 by design.",
    link: "https://onre.finance",
  },
  pbUSDC: {
    mechanism: "Funding-rate arbitrage (multi-DEX)",
    description:
      "Piggybank runs delta-neutral funding-rate arbitrage across ~10 perpetual DEXs with automated risk management.",
    risks:
      "Funding regime shift; DEX-side exploit exposure (cf. April 2026 Drift incident); strategy unwind under stress.",
    link: "https://www.piggybank.fi",
  },
};
