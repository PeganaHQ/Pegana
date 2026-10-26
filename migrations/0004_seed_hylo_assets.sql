-- 0004: Seed the Hylo xSOL (leverage) and sHYUSD (yield-bearing) assets.
--
-- Idempotent — re-running is a no-op via the ON CONFLICT clause.

INSERT INTO assets (symbol, mint, name, class, peg_target, decimals, token_program,
                    intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
                    pyth_feed_id, thresholds)
VALUES
  ('sHYUSD', 'HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz', 'Staked Hylo USD',
   'stable_yield', 'USD', 6, 'spl',
   'hylo_shyusd_rate',
   '{"stability_pool":"HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ"}'::jsonb,
   'jupiter_usd',
   '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":300}'::jsonb),

  ('xSOL', '4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs', 'Hylo Leveraged SOL',
   'synth_lev', 'SOL', 6, 'spl',
   'hylo_xsol_nav',
   '{"exchange_program":"HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn"}'::jsonb,
   'jupiter_usd',
   '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":100,"depeg_bps":300,"critical_bps":800}'::jsonb)
ON CONFLICT (symbol) DO NOTHING;
