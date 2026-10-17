# Phase A — completion evidence

Snapshot to be filled during Task 20 (E2E 1h mainnet smoke).

## Pipeline status — `SELECT asset, source, count, max(ts)` over last 1 hour

Run before declaring Task 20 done:

```sql
SELECT asset, source, count(*) AS rows, max(ts) AS last_ts
FROM intrinsic_snapshots
WHERE ts > NOW() - INTERVAL '1 hour'
GROUP BY asset, source
ORDER BY asset;
```

Expected: at least one row per minute for each of the 29 verified assets.

## NAV cross-check (≤5 bps tolerance vs issuer dashboard)

Manual browser check at fill-in time:

| Asset | Pegana NAV (latest) | Issuer dashboard | Δ (bps) | Pass? |
|---|---|---|---|---|
| USDY | _fill_ | https://ondo.finance/usdy | | |
| sUSD | _fill_ | https://solayer.org/restake/susd | | |
| syrupUSDC | _fill_ | https://app.maple.finance | | |
| sUSDe | _fill_ | https://ethena.fi | | |
| ONyc | _fill_ | https://app.rwa.xyz/assets/ONyc | | |
| pbUSDC | _fill_ | https://www.piggybank.fi | | |

## Engine recompute → discount_snapshots

```sql
SELECT asset, state, discount_smooth, ts
FROM discount_snapshots
WHERE ts > NOW() - INTERVAL '1 hour'
ORDER BY asset, ts DESC LIMIT 50;
```

Expected: at least one state computation per asset (requires Jupiter to be
unblocked — Phase A doesn't address the existing R2 rate-limit risk).

## Dashboard visual check

Visit http://localhost:8081/dashboard and confirm:
- [ ] 30 assets visible
- [ ] All 7 yield-bearing show in Yield filter
- [ ] vSOL/compassSOL/BNSOL/picoSOL/hSOL show in LST filter
- [ ] Visit /asset/USDY → Yield
