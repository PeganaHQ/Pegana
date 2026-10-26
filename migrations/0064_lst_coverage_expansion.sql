-- 0064: LST coverage expansion (2026-07-15). assets.toml is the engine/indexer
-- source of truth; the snapshot hypertables FK into public.assets, so
-- materialize the 6 newly-verified LSTs here. (The dSOL reactivation originally
-- bundled in this batch was SPLIT OUT 2026-07-17 — deferred pending the
-- intrinsic-liveness gate; see the note where its UPDATE used to be.)
--
-- All 6 new mints cross-confirmed against extra-api.sanctum.so/v1/lsts
-- (exact mint+symbol match) and lst-directory.com/api/directory (TVL,
-- non-stale/non-dead/non-deprecated). Six other candidates handed to this
-- batch (dynoSOL, PSOL, JSOL, hSOL, jagSOL, definSOL) were already added in
-- migration 0053 (2026-06-23) — skipped here as no-ops to avoid a
-- redundant re-INSERT (ON CONFLICT would have been a silent no-op anyway,
-- but leaving them out keeps this migration's diff honest about what's new).

INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  ('dumSOL','cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm','Dum Staked SOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"dumSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":150109707}'::jsonb),
  ('sctmSOL','sctmAy9zFfZznZUWxEMgGtF6PHZ3gwoiCGcfwRua1AZ','Sanctum Staked SOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"sctmSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":140442792}'::jsonb),
  ('xSHIN','xSoL18r4U1k2ALa4yF857VDZJqCKecLtty92nscre3o','Shinobi Performance Pool Token','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"xSHIN"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":86647307}'::jsonb),
  ('aeroSOL','aeroXvCT6tjGVNyTvZy86tFDwE4sYsKCh7FbNDcrcxF','aeroSOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"aeroSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":84422130}'::jsonb),
  ('dfdvSOL','sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx','DeFi Development Corp Staked SOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"dfdvSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":65071741}'::jsonb),
  ('GTSOL','gateMurAxe4YFoUR6J63gXGKtkbTfdkMdLjZrCmThFP','Gate Wrapped SOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"GTSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-07-15 lst-coverage-expansion batch","tvl_usd_at_add":48381033}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  mint = EXCLUDED.mint,
  name = EXCLUDED.name,
  class = EXCLUDED.class,
  peg_target = EXCLUDED.peg_target,
  decimals = EXCLUDED.decimals,
  token_program = EXCLUDED.token_program,
  intrinsic_kind = EXCLUDED.intrinsic_kind,
  intrinsic_cfg = EXCLUDED.intrinsic_cfg,
  market_kind = EXCLUDED.market_kind,
  market_cfg = EXCLUDED.market_cfg,
  pyth_feed_id = EXCLUDED.pyth_feed_id,
  thresholds = EXCLUDED.thresholds,
  is_active = EXCLUDED.is_active,
  metadata = assets.metadata || EXCLUDED.metadata;

-- dSOL reactivation — SPLIT OUT / DEFERRED 2026-07-17.
-- The pool is demonstrably alive (rate 1.20497 rising, validator voting, backing
-- intact, exploit hit the perps admin NOT the SanctumSpl stake pool). BUT a
-- backend launch-readiness audit found the intrinsic side has NO liveness gate:
-- sanctum.rs re-stamps ts=Utc::now() every poll, so a frozen-but-served backing
-- passes the 600s timestamp-only staleness as a confident false PEGGED (the exact
-- 2026-04-01 dSOL failure). monitoring_only can't contain it either (it became a
-- beta LABEL, not an egress gate, 2026-06-16). So dSOL stays is_active=false
-- (unchanged from mig 0020, matching prod) until the intrinsic-liveness gate
-- (backing-advancement / epoch-clock) ships — it is then reactivated WITH the gate.
-- assets.toml keeps the dSOL entry at active=false. No UPDATE here.
