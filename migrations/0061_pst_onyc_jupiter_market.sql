-- 0061: switch PST + ONyc market source dex_screener_usd -> jupiter_usd (numeraire USDC).
--
-- Both are DEEP on Jupiter (verified $1k/$10k probe, 0.02-0.03% impact) but the DexScreener
-- "top pair" picker can lock onto a thin/dust pool (the pbUSDC failure mode) -> PST flapped 14x
-- on 2026-06-24. jupiter_usd/USDC is the proven USDu/CASH path. Keeps the DB market_kind/market_cfg
-- in sync with assets.toml (the runtime source of truth). Not a methodology change. Idempotent.
UPDATE assets
SET market_kind = 'jupiter_usd',
    market_cfg  = '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb
WHERE symbol IN ('PST', 'ONyc');
