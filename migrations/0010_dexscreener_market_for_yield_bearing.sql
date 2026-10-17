-- 0010: Switch sUSD/ONyc/pbUSDC market source from Jupiter to DexScreener.
--
-- Jupiter lite-api is hard rate-limited (ROADMAP risk R2) so the engine
-- couldn't compute discount for any new yield-bearing asset that depends on
-- Jupiter for a market price. USDY/sUSDe/syrupUSDC were already unblocked
-- in migration 0009 by using Pyth USD-quoted spot feeds — but ONyc, sUSD,
-- and pbUSDC don't have Pyth spot feeds.
--
-- DexScreener's free API (api.dexscreener.com, ~300 req/min, no auth)
-- aggregates Raydium/Orca/Meteora and returns a USD price for any indexed
-- mint. Verified that all three assets have liquid pairs:
--   - sUSD     : Raydium pool ~$8k    liquidity
--   - ONyc     : Orca pool    ~$5.1M  liquidity
--   - pbUSDC   : Raydium pool ~$65k   liquidity
--
-- USD* stays on jupiter_usd — its intrinsic side is still BLOCKED (Save
-- Finance cToken layout not yet decodable), so a market price alone can't
-- produce a discount.
--
-- See `crates/indexer-rs/src/sources/dexscreener.rs` for the polling
-- implementation. Cadence 30s × 3 assets = 6 req/min, far inside DexScreener's
-- free-tier limit.

UPDATE assets
SET market_kind = 'dex_screener_usd',
    market_cfg  = '{}'::jsonb
WHERE symbol IN ('sUSD', 'ONyc', 'pbUSDC');
