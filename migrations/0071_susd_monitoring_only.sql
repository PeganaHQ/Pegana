-- 0071: mark sUSD calibration provisional because its market leg is too thin.
--
-- sUSD's DexScreener market is an approximately $8k-liquidity pool, below the
-- existing global $25k reliability floor. Keep the floor unchanged and encode
-- the operational limitation in the DB-driven calibration contract.

DO $susd$
DECLARE
    updated_rows bigint;
BEGIN
    UPDATE assets
    SET metadata = metadata || jsonb_build_object(
      'monitoring_only', true,
      'monitoring_since', '2026-08-03',
      'monitoring_reason', 'Thin market liquidity; no reliable market tick.'
    )
    WHERE symbol = 'sUSD';

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN
        RAISE EXCEPTION 'expected to update exactly one sUSD asset row, updated %', updated_rows;
    END IF;
END
$susd$;
