// Allowlist for the Jupiter quote proxy (audit F-03).
//
// The /api/jupiter-quote route is unauthenticated (called from the public
// exit-liquidity widget) but it uses a BILLED server-side Jupiter API key.
// Restricting to the exact inputMint set the widget ever requests eliminates
// enumeration abuse and key drain without breaking logged-out users.
//
// Source of truth: assets.toml (active=true entries only).
// outputMint is always USDC — hardcoded in exit-liquidity.tsx.
//
// Mints NOT included:
//   - BRZ  (FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD) — active=false
//   - pbUSDC (F35yYmTR6PqkbTx449P1eGhB57mRhWAdYs93eCo2dMZR) — active=false

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// All active Pegana-tracked asset mints (from assets.toml — kept in sync by the
// drift test in route.test.ts). The exit-liquidity widget always swaps one of
// these → USDC.
export const TRACKED_INPUT_MINTS = new Set<string>([
  // LSTs (7)
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // jitoSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", // bSOL
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", // INF
  "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B", // bbSOL
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", // JupSOL
  "hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT", // hyloSOL
  "hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u", // hyloSOL+
  // Stablecoins (7)
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (also the outputMint; widget skips self-swap)
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", // USDe
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS
  "5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E", // hyUSD
  "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz", // sHYUSD
  // Synthetic leverage (1)
  "4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs", // xSOL
  // Yield-bearing stables (5 active; pbUSDC excluded — active=false)
  "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6", // USDY
  "Eh6XEPhSwoLv5wFApukmnaVSHQ6sAnoD9BmgmwQoN2sN", // sUSDe
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj", // syrupUSDC
  "susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X", // sUSD
  "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5", // ONyc
  // Phase-0 additions (Trust Layer v0.1.0, activated 2026-06-11)
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD", // JupUSD
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", // JLP
  "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr", // EURC
  "Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn", // dzSOL
  "vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7", // vSOL
  // Asset-expansion batch (2026-06-24) — stables + yield (8) + USD*
  "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG", // USX
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", // USDG
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", // USD1
  "9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy", // USDu
  "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH", // CASH
  "AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9", // AUSD
  "3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC", // eUSX
  "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw", // PST
  "star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM", // USD* (Perena)
  // Asset-expansion batch (2026-06-24) — Sanctum LSTs (25)
  "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85", // BNSOL
  "DYNoyS3x5qgbccZg7RPXagm4xQzfnm5iwd9o8pMyJtdE", // dynoSOL
  "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL", // PSOL
  "7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn", // JSOL
  "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A", // hSOL
  "edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt", // edgeSOL
  "jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV", // jagSOL
  "DEF1NXSZ8Th9n28hYBayrFtx9bj1EwwTiy3mhHEB9oyA", // definSOL
  "BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn", // BulkSOL
  "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs", // bonkSOL
  "CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE", // cgntSOL
  "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp", // LST
  "CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX", // CDCSOL
  "BPSoLzmLQn47EP5aa7jmFngRL8KC3TWAeAwXwZD8ip3P", // bpSOL
  "haSo1Vz5aTsqEnz8nisfnEsipvbAAWpgzRDh2WhhMEh", // haSOL
  "LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X", // laineSOL
  "XAnDeUmMcqFyCdef9jzpNgtZPjTj3xUMj9eXKn2reFN", // xandSOL
  "Ra1so1sTkvX3PorAM9ewqrsUMz9sPSbfFZ5oZUjN4oc", // raiSOL
  "picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX", // picoSOL
  "MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY", // mangoSOL
  "HALALGvdNJ8u1J3uFFSsba1tyYPRF3vnYfCQ3CpJasfD", // iASOL
  "LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg", // lanternSOL
  "roxDFxTFHufJBFy3PgzZcgz6kwkQNPZpi9RfpcAv4bu", // RoXSOL
  "jucy5XJ76pHVvtPZb5TKRcGQExkwit2P5s4vY8UzmpC", // proSOL
  // Asset-expansion batch (2026-06-24) — spl_stake_pool LSTs (3)
  "stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh", // STKESOL
  "rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp", // rkuSOL
  "CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg", // corvusSOL
  // LST-directory expansion (2026-07-15) — each mint verified via Sanctum's registry
  "cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm", // dumSOL
  "sctmAy9zFfZznZUWxEMgGtF6PHZ3gwoiCGcfwRua1AZ", // sctmSOL
  "xSoL18r4U1k2ALa4yF857VDZJqCKecLtty92nscre3o", // xSHIN
  "aeroXvCT6tjGVNyTvZy86tFDwE4sYsKCh7FbNDcrcxF", // aeroSOL
  "sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx", // dfdvSOL
  "gateMurAxe4YFoUR6J63gXGKtkbTfdkMdLjZrCmThFP", // GTSOL
  // dSOL removed 2026-07-17 — deferred back to active=false pending the
  // intrinsic-liveness gate (see assets.toml + ROADMAP backend-upgrade batch).
  // Re-add its mint here in lockstep when dSOL is reactivated.
]);

/**
 * Returns true only if the pair is one the exit-liquidity widget legitimately
 * requests: a tracked Pegana asset mint being swapped into USDC.
 */
export function isAllowedPair(inputMint: string, outputMint: string): boolean {
  return outputMint === USDC_MINT && TRACKED_INPUT_MINTS.has(inputMint);
}
