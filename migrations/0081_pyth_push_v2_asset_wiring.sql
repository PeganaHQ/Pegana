-- 0081: asset wiring after the move to Pyth's post-upgrade on-chain push
-- program (2026-10-22). Syncs only the columns below (is_active, the USDY
-- market_kind/market_cfg and pyth_feed_id, the sUSD monitoring_reason) with
-- assets.toml, the runtime source of truth. It does NOT sync
-- assets.intrinsic_kind / intrinsic_cfg: those display columns still carry
-- the pre-2026-10 kinds for JLP, USDY, sUSDe, EURC and USD*, and nothing in
-- the API, web or MCP reads them (the engine and indexer read assets.toml).
-- Not a methodology change. Idempotent: every statement sets absolute values,
-- so re-running it is a no-op.
--
-- Evidence (mainnet reads, 2026-10-21, both push programs):
--
--   feed        v2 account (pyt2F414...)      legacy account (pythWSns...)
--   AUSD/USD    last print 15 days ago        last print 64 days ago
--   USDY/USD    last print ~15h ago           last print 64 days ago
--
-- 1. AUSD: retired. There is no Solana market (Jupiter liquidity about $43)
--    and no sponsored Pyth AUSD/USD push feed on Solana, so neither leg is
--    live and there is nothing honest to publish. Soft delete
--    (is_active=false), same as dSOL (0020), pbUSDC (0040) and sharkSOL
--    (0076): historical snapshot rows are preserved so the asset page still
--    renders its timeline and existing receipts stay reproducible.
--
-- 2. USDY: market leg pyth_spot(USDY/USD) -> jupiter_usd (numeraire USDC).
--    The Pyth USDY/USD spot print steps about once a day on-chain, so it
--    cannot detect a market move; Jupiter routes the ~$1.7M Whirlpool pool.
--    pyth_feed_id is cleared too (USDu precedent, 2026-07-01): with a DEX
--    market the API would otherwise show the day-old Pyth print as the
--    independent oracle leg and fire a permanent stale-oracle advisory.
--    Same shape as 0061 (PST/ONyc). The USDY intrinsic is not touched here.
--
-- 3. sUSD: stays tracked and monitoring-only (0071). The reason is reworded
--    to the honest user-facing fact. The $25k liquidity floor is unchanged.
--
-- See also: assets.toml ([[assets]] AUSD, USDY, sUSD), crates/indexer-rs/src/sources/pyth.rs.

DO $pyth_v2$
DECLARE
    updated_rows bigint;
BEGIN
    UPDATE assets
    SET is_active = false
    WHERE symbol = 'AUSD';
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN
        RAISE EXCEPTION 'expected to update exactly one AUSD asset row, updated %', updated_rows;
    END IF;

    UPDATE assets
    SET market_kind  = 'jupiter_usd',
        market_cfg   = '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
        pyth_feed_id = ''
    WHERE symbol = 'USDY';
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN
        RAISE EXCEPTION 'expected to update exactly one USDY asset row, updated %', updated_rows;
    END IF;

    UPDATE assets
    SET metadata = metadata || jsonb_build_object(
      'monitoring_only', true,
      'monitoring_reason', 'NAV live; no Solana market deep enough to price.'
    )
    WHERE symbol = 'sUSD';
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN
        RAISE EXCEPTION 'expected to update exactly one sUSD asset row, updated %', updated_rows;
    END IF;
END
$pyth_v2$;
