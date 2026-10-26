-- 0069: promote the batch-2 beta (monitoring-only) assets to calibrated.
--
-- Second beta->calibrated retro (2026-07-23), mirroring mig 0060. Clears the
-- monitoring_only flag for the 34 mig-0053-era betas that passed the ADR-0015 gate
-- over a fresh >=7-day window AND whose market leg is liquid (>= $25k,
-- DEXSCREENER_MIN_LIQUIDITY_USD / ADR-0026) + non-single-source. Full per-asset
-- justification + the prod retro-SQL evidence:
-- docs/operations/2026-07-23-beta-promotion-retro-report.md.
--
-- Evidence (prod, scripts/beta-promotion-retro.sql, 2026-07-23): ALL 43 betas
-- passed data-completeness (days=9, max_gap_h=0.0, 0 source_outage) and calibration
-- (p95 < drift, direction-sensitive per ADR-0029). Liquidity settled by
-- assets.liquidity_observations (tokens.xyz) + a Birdeye token_overview sweep.
--
-- This set is the MECHANICAL default (ADR-0015): 0 state transitions in the window
-- + liquidity >= $25k. Deliberately EXCLUDED here (stay beta, honestly):
--   * thin liquidity: USD* ($3.1k), RoXSOL ($4.2k), STKESOL ($22.6k), sharkSOL ($143)
--   * HARD BLOCK:     sHYUSD (market/intrinsic leg fix first — criteria step 5)
--   * PERMANENT:      xSOL (Class C, synth_lev by design)
--   * proSOL — override-declined (ADR-0015 D6): liquid ($1.1M) + p95=0, but one
--                     isolated 107/-98 bps print spike; promote after a clean window.
--
-- hyloSOL+ and corvusSOL ARE included via Rafael's ADR-0015 D6 override (2026-07-23):
-- both are liquid (Birdeye $964k / $2.70M) and calibrated (p95 15/16 < drift 30/55);
-- their few transitions are mild DRIFT-level (band-grazing / rare tail spikes reverting
-- in minutes), NOT false CRITICAL/DEPEG — and their responsive legs disprove the
-- frozen-signal premise. So the set is 34 mechanical + 2 override = 36 (calibrated 20->56).
--
-- eUSX IS included: Birdeye reported $1.1k, but that is a USDC-anchoring artifact —
-- its real market is $9.2M across Orca+Raydium eUSX/USX pools (~$187k/24h volume),
-- and the retro shows a live moving discount (p95 13 bps), i.e. a responsive,
-- non-frozen leg. Verified 1:1 (DexScreener pair inspection).
--
-- Touches only assets.metadata -> golden byte-exact UNAFFECTED (the backtest golden
-- replays the pinned docs/backtests/.../assets-snapshot.toml, not the live config;
-- same as mig 0060). Drops the beta label across every surface + re-enters these in
-- the calibrated denominator. No rebuild (deploy.sh --migrate --config-only).
-- Idempotent (removing an absent jsonb key is a no-op).

UPDATE assets
SET metadata = metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason'
WHERE symbol IN (
    -- stable_fiat / stable_dn (tokens.xyz liquidity, deep)
    'CASH', 'USD1', 'USDG', 'USDu', 'USX',
    -- stable_yield (Birdeye/DexScreener deep; ONyc's stale frozen-signal label void, eUSX 1:1-corrected)
    'JLP', 'ONyc', 'PST', 'eUSX',
    -- lst (liquid via tokens.xyz or Birdeye aggregated, >= $25k, 0 transitions)
    'BNSOL', 'PSOL', 'bpSOL', 'xandSOL', 'laineSOL', 'mangoSOL', 'lanternSOL',
    'iASOL', 'picoSOL', 'raiSOL', 'edgeSOL', 'haSOL', 'CDCSOL', 'cgntSOL',
    'LST', 'rkuSOL', 'bonkSOL', 'BulkSOL', 'definSOL', 'jagSOL', 'hSOL',
    'vSOL', 'JSOL', 'dzSOL', 'dynoSOL',
    -- lst — Rafael D6 override (liquid + calibrated; mild DRIFT-level transitions)
    'hyloSOL+', 'corvusSOL'
);
