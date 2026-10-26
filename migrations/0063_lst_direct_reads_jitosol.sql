-- 0063: jitoSOL pilot — switch intrinsic source from Sanctum to direct SPL
-- stake-pool read (ADR-0031). Data-only: no schema change. Mirrors the
-- assets.toml flip so the DB configuration stays in sync with TOML.
--
-- Pool state account:  Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb
-- Owner program:       SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy  (canonical SPL stake-pool)
-- Verified 2026-07-01: getAccountInfo → account_type=1, pool_mint=J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn,
--   total_lamports=9972154023725643, pool_token_supply=7742915394496266, NAV≈1.2879 SOL/LST ∈ [0.99,2.0).
UPDATE assets
SET
    intrinsic_kind = 'spl_stake_pool',
    intrinsic_cfg  = '{"pool":"Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb","program":"SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"}'::jsonb
WHERE symbol = 'jitoSOL';
