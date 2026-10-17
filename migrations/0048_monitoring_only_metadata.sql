-- 0048: formal monitoring-only metadata.
--
-- The launch verdict downgraded five calibrated-window failures to
-- monitoring-only, xSOL has always been Class C monitoring, and the five
-- Phase-0 assets activated on 2026-06-11 without a calibration history.
-- Store that distinction in the DB catalog so API/UI can render it formally
-- instead of relying on comments in assets.toml.

UPDATE assets
SET metadata = metadata || jsonb_build_object(
  'monitoring_only', true,
  'monitoring_since', '2026-06-10',
  'monitoring_reason', 'Calibration v1 downgrade: p95 exceeded drift band or structural anomaly; monitored but excluded from calibrated launch denominator.'
)
WHERE symbol IN ('mSOL', 'INF', 'bbSOL', 'hyloSOL', 'sHYUSD');

UPDATE assets
SET metadata = metadata || jsonb_build_object(
  'monitoring_only', true,
  'monitoring_since', '2026-06-10',
  'monitoring_reason', 'Class C monitoring-only asset; no calibrated peer denominator.'
)
WHERE symbol = 'xSOL';

UPDATE assets
SET metadata = metadata || jsonb_build_object(
  'monitoring_only', true,
  'monitoring_since', '2026-06-11',
  'monitoring_reason', 'Phase-0 launch activation with zero calibration history; provisional thresholds until the 7-day retro.'
)
WHERE symbol IN ('JupUSD', 'JLP', 'EURC', 'dzSOL', 'vSOL');

UPDATE assets
SET metadata = metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason'
WHERE symbol NOT IN ('mSOL', 'INF', 'bbSOL', 'hyloSOL', 'sHYUSD', 'xSOL', 'JupUSD', 'JLP', 'EURC', 'dzSOL', 'vSOL');
