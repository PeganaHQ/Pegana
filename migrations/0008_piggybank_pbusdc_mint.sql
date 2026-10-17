-- Migration 0008 — pin Piggybank pbUSDC addresses now that Task 11 resolved
-- them on mainnet (2026-05-22).
--
-- Discovery trail (see crates/indexer-rs/src/sources/piggybank_pb.rs for
-- the long-form notes):
--   * pbUSDC mint   = F35yYmTR6PqkbTx449P1eGhB57mRhWAdYs93eCo2dMZR
--                     (vanilla SPL Token, 6dp, mint authority owned by
--                     the Piggybank program — Pig1… vanity prefix)
--   * Vault PDA     = 91LYov1N1j62Q3ipuBi8w2e5GVqjVxWTdJ757roiWXdy
--                     (also the pbUSDC mint authority; holds the
--                     PBKTOKEN-prefixed state with total_shares /
--                     total_assets used to derive NAV)
--   * Program       = Pig1CsXnfDwN1NuoeNRBojohbjc14dogmJCXeb2vL3Y
--                     (cross-confirmed on piggybank.gitbook.io/docs and via
--                     on-chain ownership of the mint authority account)
--
-- NAV at deploy time = 3,555,662 USDC / 3,194,975 pbUSDC ≈ 1.1129 USD/share,
-- consistent with the protocol's published ~21% APY × ~7 months live
-- (epoch 105, where epochs are 48-hour cadence).
--
-- Migration 0007 seeded pbUSDC with `TODO_pbusdc_mint` and TODO intrinsic
-- params so the FK constraint on `intrinsic_snapshots.asset` already
-- referenced this symbol; here we patch the placeholders in-place.

UPDATE assets
   SET mint          = 'F35yYmTR6PqkbTx449P1eGhB57mRhWAdYs93eCo2dMZR',
       intrinsic_cfg = '{"vault":"91LYov1N1j62Q3ipuBi8w2e5GVqjVxWTdJ757roiWXdy","program":"Pig1CsXnfDwN1NuoeNRBojohbjc14dogmJCXeb2vL3Y"}'::jsonb
 WHERE symbol        = 'pbUSDC';
