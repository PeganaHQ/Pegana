-- Complete writer privileges required by INSERT ... ON CONFLICT paths.
-- PostgreSQL checks SELECT on conflict-key columns even for DO NOTHING, and
-- protocol aggregate upserts additionally require UPDATE.

GRANT SELECT ON
    intrinsic_snapshots,
    market_snapshots,
    oracle_snapshots,
    hylo_state_snapshots,
    liquidity_observations
TO pegana_indexer;

GRANT SELECT ON discount_snapshots TO pegana_engine;

GRANT SELECT ON
    loop_exposure_snapshots,
    loop_hf_distribution
TO pegana_protocol_indexer;
