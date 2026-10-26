-- 0054: Tier-2 non-Sanctum LSTs via the spl_stake_pool adapter (2026-06-23).
INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  ('STKESOL','stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh','SOL Strategies Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"StKeDUdSu7jMSnPJ1MPqDnk3RdEwD2QbJaisHMebGhw","program":"SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb),
  ('rkuSOL','rkubjTrZYioRSeXwDnhwGQzvW3qkcin72JSxUt3WMVp','Raiku Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"ERhozr6u9drmAANXGRNP1oh3quSqPKEwioKH5b8v9Kkt","program":"SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb),
  ('corvusSOL','CorvuSSoLxPKLoXWXSfn8pFSMhCRHhe7Uwqe874cmwvg','Corvus Staked SOL','lst','SOL',9,'spl',
   'spl_stake_pool','{"pool":"E5NXU96SgMEm49RBW8ZoAzs9MBr8fgxzLtypBNGKUS66","program":"SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"}'::jsonb,
   'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 spl_stake_pool adapter"}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  mint = EXCLUDED.mint, name = EXCLUDED.name, class = EXCLUDED.class,
  peg_target = EXCLUDED.peg_target, decimals = EXCLUDED.decimals,
  token_program = EXCLUDED.token_program, intrinsic_kind = EXCLUDED.intrinsic_kind,
  intrinsic_cfg = EXCLUDED.intrinsic_cfg, market_kind = EXCLUDED.market_kind,
  market_cfg = EXCLUDED.market_cfg, pyth_feed_id = EXCLUDED.pyth_feed_id,
  thresholds = EXCLUDED.thresholds, is_active = EXCLUDED.is_active,
  metadata = assets.metadata || EXCLUDED.metadata;
