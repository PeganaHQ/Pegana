# Phase-0 retro — 2026-06-18

Purpose: decide whether the 5 Phase-0 assets activated on launch day can move
from monitoring-grade to calibrated-grade thresholds.

Assets:

- `JupUSD`
- `JLP`
- `EURC`
- `dzSOL`
- `vSOL`

Run:

```bash
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-pegana}" -d "${POSTGRES_DB:-pegana}" \
  -P pager=off -f /dev/stdin' < scripts/phase0-retro-queries.sql
```

Decision rule:

- No promotion if any asset has `UNKNOWN`, `DEPEG`, `CRITICAL`, or
  `BLACK_SWAN` samples without a source-level explanation.
- No promotion if sample gaps show source outages large enough to invalidate
  the 7-day window.
- Tune thresholds from observed p95/p99 only after excluding known upstream
  outage windows.
- Keep monitoring-only if the p95 band is too wide to defend publicly.

If promoted, update `assets.metadata.monitoring_only=false` for that asset and
record the threshold rationale in `docs/CALIBRATION-v1.md` or its successor.
