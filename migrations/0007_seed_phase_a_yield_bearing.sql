-- 0007: Phase A — seed 5 new Sanctum LSTs + 7 yield-bearing stables.
--
-- Sanctum LSTs (config-only — no new adapter, batch sol-value handles them):
--   vSOL, compassSOL, BNSOL, picoSOL, hSOL
--
-- Yield-bearing stables (5 live adapters + 2 placeholders for Tasks 10/11):
--   USDY (Ondo · Pyth USDY/USD.RR)
--   sUSDe (Ethena · Pyth SUSDE/USDE.RR)
--   syrupUSDC (Maple · Pyth SYRUPUSDC/USDC.RR)
--   sUSD (Solayer · Token-2022 InterestBearing extension)
--   ONyc (OnRe · Pyth NAV.ONYC/USD)
--   USD* (Perena · placeholder — multi-underlying pool adapter pending)
--   pbUSDC (Piggybank · placeholder — vault NAV adapter pending)
--
-- USD+ (Streamflow) intentionally NOT seeded — not yet live on mainnet
-- as of 2026-05-22 (announced 2025-12-24, waitlist open). Add when shipped.

INSERT INTO assets (symbol, mint, name, class, peg_target, decimals, token_program,
                    intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
                    pyth_feed_id, thresholds)
VALUES
  -- ============================================================
  -- Sanctum LSTs (5 new)
  -- ============================================================
  ('vSOL', 'vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7',
   'The Vault Staked SOL', 'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"vSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

  ('compassSOL', 'Comp4ssDzXcLeu2MnLuGNNFC4cmLPMng8qWHPvzAMU1h',
   'Solana Compass Staked SOL', 'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"compassSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

  ('BNSOL', 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85',
   'Binance Staked SOL', 'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"BNSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   -- Blue-chip tier (matches jitoSOL/mSOL): Binance-backed liquidity is deep.
   '{"drift_bps":20,"depeg_bps":100,"critical_bps":300}'::jsonb),

  ('picoSOL', 'picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX',
   'Pico Staked SOL', 'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"picoSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

  ('hSOL', 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A',
   'Helius Staked SOL', 'lst', 'SOL', 9, 'spl',
   'sanctum_lst', '{"symbol":"hSOL"}'::jsonb,
   'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

  -- ============================================================
  -- Yield-bearing stables — live adapters (5)
  -- ============================================================
  ('USDY', 'A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6',
   'Ondo USD Yield', 'stable_yield', 'USD', 6, 'spl',
   'pyth_redemption_rate', '{"feed":"USDY/USD.RR"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '0xe393449f6aff8a4b6d3e1165a7c9ebec103685f3b41e60db4277b5b6d10e7326',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb),

  ('sUSDe', 'Eh6XEPhSwoLv5wFApukmnaVSHQ6sAnoD9BmgmwQoN2sN',
   'Ethena Staked USDe', 'stable_yield', 'USD', 9, 'spl',
   'pyth_redemption_rate', '{"feed":"SUSDE/USDE.RR"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '0xca3ba9a619a4b3755c10ac7d5e760275aa95e9823d38a84fedd416856cdba37c',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":300}'::jsonb),

  ('syrupUSDC', 'AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj',
   'Maple syrupUSDC', 'stable_yield', 'USD', 6, 'spl',
   'pyth_redemption_rate', '{"feed":"SYRUPUSDC/USDC.RR"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb),

  ('sUSD', 'susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X',
   'Solayer USD', 'stable_yield', 'USD', 6, 'token_2022',
   'solayer_susd_rate',
   '{"share_account":"susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X","program":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb),

  ('ONyc', '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5',
   'OnRe Onchain Yield Coin', 'stable_yield', 'USD', 9, 'spl',
   'pyth_redemption_rate', '{"feed":"ONYC/USD.NAV"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   -- Wider thresholds — ONyc NAV drifts upward by design (reinsurance yield).
   '{"drift_bps":100,"depeg_bps":300,"critical_bps":800}'::jsonb),

  -- ============================================================
  -- Yield-bearing stables — placeholders (adapters pending)
  -- ============================================================
  ('USD*', 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM',
   'Perena USD Star', 'stable_yield', 'USD', 6, 'spl',
   'perena_usd_star_pool',
   '{"pool":"TODO","underlying":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],"program":"NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb),

  ('pbUSDC', 'TODO_pbusdc_mint',
   'Piggybank pbUSDC vault', 'stable_yield', 'USD', 6, 'spl',
   'piggybank_pb_vault',
   '{"vault":"TODO","program":"TODO"}'::jsonb,
   'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '',
   '{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb)
ON CONFLICT (symbol) DO NOTHING;

-- Fix up threshold key naming for any rows seeded earlier with the
-- short-form keys ("drift"/"depeg"/"critical") to match the canonical
-- _bps suffix convention. The engine accepts both forms but consistent
-- DB shape avoids ambiguity.
UPDATE assets SET thresholds = jsonb_build_object(
    'drift_bps', (thresholds->>'drift')::int,
    'depeg_bps', (thresholds->>'depeg')::int,
    'critical_bps', (thresholds->>'critical')::int
)
WHERE thresholds ? 'drift'
  AND NOT thresholds ? 'drift_bps';
