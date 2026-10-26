-- 0042: Re-sync assets.thresholds to the engine's calibrated assets.toml
--       values (BSRV-01 companion data migration, 2026-06-03).
--
-- WHY THIS EXISTS
-- ---------------
-- The engine reads assets.toml at runtime and NEVER writes the calibrated
-- thresholds back to the `assets.thresholds` column. The column is therefore
-- stale-by-design: it still carries the v1 seed values from migrations
-- 0002/0004/0005/0007, while the live engine has been recalibrated multiple
-- times since (e.g. jitoSOL DB drift_bps=20 vs toml drift=45; INF DB 30/120/350
-- vs toml 140/280/560; xSOL DB 100/300/800 vs toml 1500/3000/6000; sUSD DB
-- 30/100/250 vs toml 275/500/800; hyUSD CR DB 150/130/110/100 vs toml CR
-- 130/115/105/100). Exposing the stale column verbatim on /v1/assets (BSRV-01)
-- would re-introduce the band-gauge "628%" bug, so we make the column
-- authoritative here. This is the DURABLE fix for `chart-thresholds-per-asset-bug`
-- that lets the FE delete its hand-maintained PER_ASSET_THRESHOLDS table.
--
-- KEY SHAPES (matched to the methodology reader at
-- crates/methodology/src/thresholds.rs, which accepts the DB _bps / cr_ keys):
--   * bps assets        -> {"drift_bps","depeg_bps","critical_bps"}
--   * hyUSD (stable_cdp) -> {"cr_drift","cr_depeg","cr_critical","cr_black_swan"}
--
-- SCOPE: only the 21 assets active on mainnet (active = true). The 7 inactive
-- toml entries (BRZ, JupUSD, JLP, EURC, dzSOL, vSOL, pbUSDC) and the soft-removed
-- dSOL are intentionally NOT touched — they have no live calibration to sync and
-- re-activating them is a separate decision.
--
-- IDEMPOTENT: keyed by symbol; re-running overwrites with the same values.
-- Defensive ADD COLUMN IF NOT EXISTS in case a future fresh-schema path lands
-- before the 0001 column (the column is NOT NULL there, so this is a no-op on
-- any DB migrated from 0001).

ALTER TABLE assets ADD COLUMN IF NOT EXISTS thresholds jsonb;

-- ===== LSTs (bps) =====
UPDATE assets SET thresholds = '{"drift_bps":45,"depeg_bps":110,"critical_bps":250}'::jsonb  WHERE symbol = 'jitoSOL';
UPDATE assets SET thresholds = '{"drift_bps":40,"depeg_bps":100,"critical_bps":250}'::jsonb  WHERE symbol = 'mSOL';
UPDATE assets SET thresholds = '{"drift_bps":45,"depeg_bps":110,"critical_bps":250}'::jsonb  WHERE symbol = 'bSOL';
UPDATE assets SET thresholds = '{"drift_bps":140,"depeg_bps":280,"critical_bps":560}'::jsonb WHERE symbol = 'INF';
UPDATE assets SET thresholds = '{"drift_bps":45,"depeg_bps":110,"critical_bps":250}'::jsonb  WHERE symbol = 'bbSOL';
UPDATE assets SET thresholds = '{"drift_bps":60,"depeg_bps":150,"critical_bps":300}'::jsonb  WHERE symbol = 'JupSOL';
UPDATE assets SET thresholds = '{"drift_bps":55,"depeg_bps":140,"critical_bps":280}'::jsonb  WHERE symbol = 'hyloSOL';
UPDATE assets SET thresholds = '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb  WHERE symbol = 'hyloSOL+';

-- ===== Stablecoins / fiat / dn (bps) =====
UPDATE assets SET thresholds = '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb   WHERE symbol = 'USDC';
UPDATE assets SET thresholds = '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb   WHERE symbol = 'USDT';
UPDATE assets SET thresholds = '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb   WHERE symbol = 'PYUSD';
UPDATE assets SET thresholds = '{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb  WHERE symbol = 'USDe';
UPDATE assets SET thresholds = '{"drift_bps":20,"depeg_bps":75,"critical_bps":250}'::jsonb   WHERE symbol = 'USDS';

-- ===== hyUSD — CDP collateral-ratio thresholds =====
UPDATE assets SET thresholds = '{"cr_drift":130,"cr_depeg":115,"cr_critical":105,"cr_black_swan":100}'::jsonb WHERE symbol = 'hyUSD';

-- ===== Yield-bearing stables (bps) =====
UPDATE assets SET thresholds = '{"drift_bps":30,"depeg_bps":100,"critical_bps":300}'::jsonb  WHERE symbol = 'sHYUSD';
UPDATE assets SET thresholds = '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb  WHERE symbol = 'USDY';
UPDATE assets SET thresholds = '{"drift_bps":30,"depeg_bps":100,"critical_bps":300}'::jsonb  WHERE symbol = 'sUSDe';
UPDATE assets SET thresholds = '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb  WHERE symbol = 'syrupUSDC';
UPDATE assets SET thresholds = '{"drift_bps":275,"depeg_bps":500,"critical_bps":800}'::jsonb WHERE symbol = 'sUSD';
UPDATE assets SET thresholds = '{"drift_bps":100,"depeg_bps":300,"critical_bps":800}'::jsonb WHERE symbol = 'ONyc';

-- ===== Synthetic leverage (bps) =====
UPDATE assets SET thresholds = '{"drift_bps":1500,"depeg_bps":3000,"critical_bps":6000}'::jsonb WHERE symbol = 'xSOL';
