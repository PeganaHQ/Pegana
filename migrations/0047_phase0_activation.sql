-- 0047: Phase-0 launch activation (2026-06-11).
--
-- assets.toml is the runtime source of truth for engine/indexer, but the
-- snapshot hypertables still FK into public.assets. These five assets were
-- inactive throughout calibration, so they were not present in prod DB before
-- launch. Materialize them here and mark them active; BRZ and pbUSDC remain
-- inactive.
--
-- They launch as monitoring-grade with provisional thresholds per
-- docs/operations/phase0-activation-2026-06-11.md.

INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  (
    'JupUSD',
    'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
    'Jupiter USD',
    'stable_dn',
    'USD',
    6,
    'spl',
    'fixed_1_usd',
    '{}'::jsonb,
    'jupiter_usd',
    '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
    '0x8ed858a2214e892c9371694fb6c8a9037b6ed4052c4edf209f8cb988484e81d9',
    '{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb,
    TRUE,
    '{"phase0_activation":"2026-06-11 owner override; monitoring-grade until tuned"}'::jsonb
  ),
  (
    'JLP',
    '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
    'Jupiter Perpetuals LP',
    'stable_yield',
    'USD',
    6,
    'spl',
    'pyth_redemption_rate',
    '{"feed":"JLP/USD.RR"}'::jsonb,
    'pyth_spot',
    '{"feed":"JLP/USD"}'::jsonb,
    '0xc811abc82b4bad1f9bd711a2773ccaa935b03ecef974236942cec5e0eb845a3a',
    '{"drift_bps":200,"depeg_bps":500,"critical_bps":1500}'::jsonb,
    TRUE,
    '{"phase0_activation":"2026-06-11 owner override; monitoring-grade until tuned"}'::jsonb
  ),
  (
    'EURC',
    'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
    'Circle Euro Coin',
    'stable_fx',
    'EUR',
    6,
    'spl',
    'pyth_fx_cross',
    '{"feed":"EUR/USD","invert":false}'::jsonb,
    'jupiter_usd',
    '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
    '0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c',
    '{"drift_bps":20,"depeg_bps":75,"critical_bps":250}'::jsonb,
    TRUE,
    '{"phase0_activation":"2026-06-11 owner override; monitoring-grade until tuned"}'::jsonb
  ),
  (
    'dzSOL',
    'Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn',
    'DoubleZero Staked SOL',
    'lst',
    'SOL',
    9,
    'spl',
    'sanctum_lst',
    '{"symbol":"dzSOL"}'::jsonb,
    'jupiter_usd',
    '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
    '',
    '{"drift_bps":50,"depeg_bps":120,"critical_bps":280}'::jsonb,
    TRUE,
    '{"phase0_activation":"2026-06-11 owner override; monitoring-grade until tuned"}'::jsonb
  ),
  (
    'vSOL',
    'vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7',
    'The Vault Staked SOL (Sanctum)',
    'lst',
    'SOL',
    9,
    'spl',
    'sanctum_lst',
    '{"symbol":"vSOL"}'::jsonb,
    'jupiter_usd',
    '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
    '',
    '{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,
    TRUE,
    '{"phase0_activation":"2026-06-11 owner override; monitoring-grade until tuned"}'::jsonb
  )
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

UPDATE assets SET is_active = FALSE WHERE symbol IN ('BRZ', 'pbUSDC');
