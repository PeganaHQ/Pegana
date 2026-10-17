-- 0040: Deactivate pbUSDC — no liquid market source (2026-06-01).
--
-- pbUSDC's only market source is DexScreener (market = dex_screener_usd).
-- On 2026-06-01 the pair DexScreener returned collapsed to a ~$34-liquidity
-- dust pool printing garbage premiums ($1.46/$1.80/$2.34) against a ~$1.10
-- NAV. Two harms resulted: extreme prints ($2.34) tripped the engine's
-- |discount|>1 anomaly clamp, which returns before snapshot_to_pg and froze
-- engine_state_snapshot for hours (calibration-watch then spammed "📸 stale"
-- every 5min); milder prints ($1.46) slipped under the clamp and were
-- published as a fake −33% premium.
--
-- The source premium-gate (commit 9fb9104) now rejects these at ingestion,
-- but a gate cannot manufacture a market that does not exist. With no liquid
-- pair, the honest state is "not tracked" rather than a stale/garbage price.
--
-- Soft delete (is_active=false). Historical snapshot rows are preserved so the
-- asset page can render the timeline and the asset can be re-activated if a
-- deep-liquidity market source ships.
--
-- See also: assets.toml ([[assets]] pbUSDC: active=false),
-- memory/project_pbusdc_dexscreener_dataquality.md.

UPDATE assets
SET is_active = false
WHERE symbol = 'pbUSDC';
