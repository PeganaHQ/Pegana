-- 0065: asset circulating supply (2026-07-16). Additive, isolated size/context
-- signal — NOT part of the NAV/discount/state pipeline. Both columns are
-- nullable so existing rows (and any asset the new `token_supply` indexer
-- source hasn't observed yet) are unaffected. Populated by a new, separate
-- indexer task (`sources::token_supply`) that reads the SPL Mint account's
-- `supply` field on a slow (~10 min) cadence and writes ONLY these two
-- columns — it never touches `discount_snapshots`, `intrinsic_snapshots`,
-- thresholds, or any calibrated value.

ALTER TABLE assets
  ADD COLUMN circulating_supply numeric,
  ADD COLUMN supply_updated_at timestamptz;
