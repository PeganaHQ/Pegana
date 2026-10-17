-- 0068: intrinsic-liveness signal (ADR-0038).
--
-- The engine's intrinsic-liveness gate reads this per-asset "the backing is
-- stale" verdict and force-UNKNOWNs a frozen-but-served NAV (the 2026-04-01
-- dSOL failure mode). The gate ships DISABLED (env INTRINSIC_LIVENESS_GATE
-- unset) — while disabled the engine never reads this table, so it stays
-- observe-only until the founder calibrates + enables it.
--
-- Written by the indexer:
--   * lst_directory_audit → sanctum_lst rows, stale = lst-directory.com's own
--     `flags.stale` corroborated by rate==ratePrev (reason 'directory_stale')
--   * spl_stake_pool      → SplStakePool rows, stale = epoch_lag >= 2
--     (reason 'epoch_lag')
--   * hylo                → hyUSD + xSOL rows, stale = total_sol_cache
--     epoch_lag >= 2 (reason 'epoch_lag'); sHYUSD excluded (pool-balance-based)
-- One row per covered asset, upserted each poll. The engine reads the latest
-- row with a freshness guard, so a dead liveness SOURCE fails OPEN (never
-- forces UNKNOWN on missing data — the engine's own staleness gate owns that).

CREATE TABLE IF NOT EXISTS intrinsic_liveness (
  asset      TEXT PRIMARY KEY REFERENCES assets(symbol),
  stale      BOOLEAN     NOT NULL,
  reason     TEXT        NOT NULL,   -- 'directory_stale' | 'epoch_lag'
  detail     JSONB,                  -- forensics: {epoch_lag, current_epoch, ...}
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
