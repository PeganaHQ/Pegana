-- 0005: Seed hyloSOL + hyloSOL+ (Hylo's own LST line; Sanctum-indexed).
--
-- These are the LST collateral feeding the Hylo Exchange. We need them
-- BOTH because users want them monitored directly AND because the xSOL
-- NAV math needs hyloSOL/hyloSOL+ MCs to back out the leverage value.

INSERT INTO assets (symbol, mint, name, class, peg_target, decimals, token_program,
                    intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
                    pyth_feed_id, thresholds)
VALUES
  ('hyloSOL', 'hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT', 'Hylo Liquid Staking SOL',
   'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"hyloSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

  ('hyloSOL+', 'hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u', 'Hylo Liquid Staking SOL Plus',
   'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"hyloSOL+"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb)
ON CONFLICT (symbol) DO NOTHING;
