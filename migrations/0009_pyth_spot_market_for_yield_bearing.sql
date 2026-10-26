-- 0009: Switch 3 yield-bearing stables from Jupiter to Pyth spot market.
--
-- USDY, sUSDe, and syrupUSDC each publish TWO Pyth feeds:
--   - Crypto.XXX/USD.RR      → issuer-attested redemption rate (intrinsic NAV)
--   - Crypto.XXX/USD         → secondary-market spot price (what users pay)
--
-- Pegana's intrinsic-vs-market discount model fits this cleanly:
--   discount = 1 − (Pyth spot) ÷ (Pyth NAV)
--
-- Before this change, market for these three assets came from Jupiter quotes
-- — and the Jupiter lite-api was 429-rate-limiting hard (ROADMAP risk R2),
-- leaving the engine unable to compute discount even though intrinsic NAV
-- was flowing fine via Pyth Hermes. The pyth.rs source now also writes
-- market_snapshots for any asset whose market.kind is "pyth_spot".
--
-- ONyc, sUSD, and pbUSDC stay on Jupiter — they don't have a Pyth USD spot
-- feed, so they remain blocked by R2 until either Jupiter unblocks or an
-- alternative market source is wired.

UPDATE assets
SET market_kind = 'pyth_spot',
    market_cfg  = '{"feed":"USDY/USD"}'::jsonb
WHERE symbol = 'USDY';

UPDATE assets
SET market_kind = 'pyth_spot',
    market_cfg  = '{"feed":"SUSDE/USD"}'::jsonb
WHERE symbol = 'sUSDe';

UPDATE assets
SET market_kind = 'pyth_spot',
    market_cfg  = '{"feed":"SYRUPUSDC/USD"}'::jsonb
WHERE symbol = 'syrupUSDC';
