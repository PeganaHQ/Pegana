-- 0055: Perena USD* savings-vault NAV adapter (2026-06-24).
INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  ('USD*','star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM','Perena USD Star','stable_yield','USD',6,'spl',
   'perena_usd_star_nav','{"reserve":"sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A","program":"save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H"}'::jsonb,
   'jupiter_usd','{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '','{"drift_bps":50,"depeg_bps":200,"critical_bps":500}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-24 perena usd*"}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  mint = EXCLUDED.mint, name = EXCLUDED.name, class = EXCLUDED.class,
  peg_target = EXCLUDED.peg_target, decimals = EXCLUDED.decimals,
  token_program = EXCLUDED.token_program, intrinsic_kind = EXCLUDED.intrinsic_kind,
  intrinsic_cfg = EXCLUDED.intrinsic_cfg, market_kind = EXCLUDED.market_kind,
  market_cfg = EXCLUDED.market_cfg, pyth_feed_id = EXCLUDED.pyth_feed_id,
  thresholds = EXCLUDED.thresholds, is_active = EXCLUDED.is_active,
  metadata = assets.metadata || EXCLUDED.metadata;
