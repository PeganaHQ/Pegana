import type { AssetClass } from "@/lib/api/types";

// The eight tokens offered by the landing's token picker. Each one is in the
// live /v1/assets list, has a vendored icon at public/tokens/<mint>.webp and
// had a non-UNKNOWN reading when this list was curated (2026-10-20). A unit
// test pins the icon file and the asset-list membership.

export interface CuratedToken {
  symbol: string;
  mint: string;
  klass: AssetClass;
}

export const CURATED_TOKENS: readonly CuratedToken[] = [
  { symbol: "jitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", klass: "lst" },
  { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", klass: "lst" },
  { symbol: "JupSOL", mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", klass: "lst" },
  { symbol: "INF", mint: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", klass: "lst" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", klass: "stable_fiat" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", klass: "stable_fiat" },
  { symbol: "PYUSD", mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", klass: "stable_fiat" },
  { symbol: "USDe", mint: "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", klass: "stable_dn" },
];

export const DEFAULT_TOKEN = CURATED_TOKENS[0];
