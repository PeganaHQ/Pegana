-- 0011: Deactivate 6 assets that have no usable market source.
--
-- BNSOL, compassSOL, hSOL, picoSOL, vSOL — all 5 Sanctum-backed LSTs added
-- in Phase A Task 1. Intrinsic from Sanctum batch endpoint flows fine, but
-- their market source (jupiter_usd) sits behind Jupiter's lite-api rate
-- limit (R2 in the risk register), which 429s for these specific mints
-- indefinitely. None of them has a Pyth USD spot feed either (only
-- XXXSOL/SOL.RR redemption-rate feeds — which is the same kind of signal
-- as Sanctum already provides). Without a market price the engine can't
-- compute discount and they stay at state=UNKNOWN on the dashboard.
--
-- USD* (Perena) — confirmed Save Finance cToken, not Perena LP. Save
-- reserve fork uses a custom 1560-byte layout not publicly documented.
-- Pyth Crypto.USD*/USD.RR exists but has no publishers. Removed until
-- either Save publishes their IDL or Pyth feed goes live.
--
-- This is a soft delete (is_active=false). Historical snapshot rows are
-- preserved so we can re-activate the asset without losing context.
--
-- To re-add later: set is_active=true and either (a) re-add the entry to
-- assets.toml (so the indexer polls it again) AND wire one of:
--   - DexScreener as market source (same pattern as sUSD/ONyc/pbUSDC)
--   - Helius LST USD pricing via a SOL-denominated quote × Pyth SOL/USD
--   - Jupiter unblocked (R2 resolution)

UPDATE assets
SET is_active = false
WHERE symbol IN ('vSOL', 'compassSOL', 'BNSOL', 'picoSOL', 'hSOL', 'USD*');
