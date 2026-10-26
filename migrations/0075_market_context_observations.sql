-- 0075: market-context enrichment on liquidity_observations (2026-08-10).
--
-- Additive, isolated size/context signals sourced from tokens.xyz's
-- `GET /v1/assets/{assetId}/risk-details?mint=<mint>` — NOT part of the
-- NAV/discount/state pipeline, never a receipt input. Enforced structurally
-- (`sinks::postgres::*` is inert; only `sinks::redis_pub::publish_tracked`
-- reaches the engine) and guarded by `cargo xtask hygiene`, which fails if
-- `engine-rs` or `methodology` so much as names one of these columns.
--
-- WHY THIS TABLE and not `assets`: these are per-tick observations, and the
-- existing PK `(asset, source, ts)` already models multi-source history by
-- design. Holder count is included here rather than as a scalar on `assets`
-- so holder growth/decline gets 90 days of history for free, and so the API
-- needs ONE lateral join instead of a join plus a column read.
--
-- WHY A NEW SOURCE VALUE: the pre-existing `source = 'tokens_xyz'` rows come
-- from `POST /v1/assets/market-snapshots`, which reads tokens.xyz's legacy
-- `tokens` table and only resolves 26 of Pegana's 69 active assets (37%).
-- The new `source = 'tokens_xyz_risk'` rows come from `risk-details`, which
-- reads their per-variant `variant_markets_latest` and resolves 62/69 (89%),
-- measured against production on 2026-08-10. Both write here; the old source
-- simply leaves every column below NULL. Keeping them as distinct `source`
-- values preserves the existing depth-gate calibration series untouched while
-- lifting effective coverage from 37% to 89%.
--
-- NULL means "no market" or "not observed" — NEVER zero. tokens.xyz coerces
-- SQL NULL to 0 in its own response shape, so the indexer maps a non-positive
-- reading back to NULL before it ever reaches this table (ADR-0019: missing
-- data is not confirming data).

ALTER TABLE liquidity_observations
  ADD COLUMN volume_24h_usd NUMERIC(30,18),
  ADD COLUMN market_cap_usd NUMERIC(30,18),
  ADD COLUMN holder_count   BIGINT;

COMMENT ON COLUMN liquidity_observations.volume_24h_usd IS
  '24h USD trading volume (tokens.xyz risk-details). Context only; never an input to discount/state/thresholds.';
COMMENT ON COLUMN liquidity_observations.market_cap_usd IS
  'Third-party market cap (tokens.xyz risk-details). Cross-check against the locally derived assets.circulating_supply * market_usd; never authoritative.';
COMMENT ON COLUMN liquidity_observations.holder_count IS
  'Unique holder addresses (tokens.xyz risk-details). Context only; never an input to discount/state/thresholds.';

-- Serves the API lateral: "latest enrichment row for this asset".
-- Partial index because only the risk source populates these columns, and the
-- 60s market-snapshots ticks would otherwise dominate the index with NULLs.
CREATE INDEX liquidity_observations_enrichment_idx
  ON liquidity_observations (asset, ts DESC)
  WHERE source = 'tokens_xyz_risk';
