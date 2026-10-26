-- intrinsic_liveness uses INSERT ... ON CONFLICT DO UPDATE; conflict-key
-- evaluation requires SELECT in addition to the existing INSERT/UPDATE grants.

GRANT SELECT ON intrinsic_liveness TO pegana_indexer;
