# Runbook — Postgres restore

> Drill this on day 2 of the deploy, then once a month. Don't wait for
> a real incident.

The active scripts that this runbook wraps:

- [`scripts/backup.sh`](../../scripts/backup.sh) — runs from cron,
  pg_dumps to `/backups`, prunes to last 14, optionally pushes R2.
- [`scripts/restore.sh`](../../scripts/restore.sh) — TimescaleDB-aware
  restore with smoke check; refuses to clobber `pegana` unless forced.

## Quick reference

| I need to … | Run |
|---|---|
| Take a backup right now | `PEGANA_PG_CONTAINER=pegana-postgres-1 PEGANA_BACKUP_DIR=/backups PEGANA_BACKUP_R2=r2:pegana-backups ./scripts/backup.sh` |
| Drill restore of latest local backup | `./scripts/restore.sh "$(ls -1t /backups/*.sql.gz \| head -1)"` |
| Drill restore from R2 (specific date) | `rclone copy r2:pegana-backups/pegana-20260525-040000.sql.gz /tmp && ./scripts/restore.sh /tmp/pegana-20260525-040000.sql.gz` |
| Actually replace live DB (rare) | `PEGANA_RESTORE_FORCE=1 ./scripts/restore.sh <dump> pegana` |

## What's recoverable

| Recovery point | Mechanism | Wait |
|---|---|---|
| Last 14 days of daily backups | Local `/backups` + R2 | Minutes |
| Any point in time within last 24h | **Not configured.** TimescaleDB continuous archiving + WAL shipping would unlock this; not in v1. |
| Older than 14 days | R2 retention rules (configure separately) |

## Realistic RPO/RTO for v1

- **RPO (data loss tolerance):** up to **24 hours**. We take one
  backup per day at 04:00 UTC. An incident at 03:59 UTC loses ~24h
  of `discount_snapshots`, `alerts`, `bot_sessions`, etc.
- **RTO (recovery time):** ~**15 minutes** for the data part of a
  full recovery. New VPS provision adds ~30min if a complete box
  rebuild is also needed.

If RPO or RTO needs to tighten (e.g. paying customers), the cheapest
next step is enabling WAL archiving — see TimescaleDB docs on
continuous archiving. Skipped for v1 because Pegana's data is
re-derivable from the on-chain sources (we'd just lose history).

## Restore drill checklist (monthly)

Run this once a month. ~10 minutes start to finish.

```bash
# 1. Pull a backup from R2 (don't use the local one — drill the
#    full chain you'd actually do in an incident).
rclone copy r2:pegana-backups/$(rclone lsf r2:pegana-backups | sort | tail -1) /tmp/

# 2. Restore to sidecar DB
DUMP=/tmp/$(rclone lsf r2:pegana-backups | sort | tail -1)
./scripts/restore.sh "$DUMP" pegana_restore_test

# 3. Smoke is already run by the script. For extra confidence,
#    spot-check a known recent asset:
docker exec pegana-postgres-1 psql -U pegana -d pegana_restore_test \
  -c "SELECT asset, state, discount_smooth, ts FROM discount_snapshots
       WHERE asset='jitoSOL' ORDER BY ts DESC LIMIT 3"

# 4. Drop the sidecar
docker exec pegana-postgres-1 psql -U pegana -d postgres \
  -c "DROP DATABASE pegana_restore_test"

# 5. Note the run in docs/runbooks/drill-log.md (if it exists) so you
#    can prove to yourself the chain still works.
```

## When a real restore is needed

1. **Stop the services that write to Postgres** so the restore isn't
   racing live traffic:
   ```bash
   cd /opt/pegana
   docker compose stop indexer engine dispatcher bot
   # Leave postgres + api + caddy running — api will 503/empty until
   # engine comes back, but the box stays reachable.
   ```
2. **Drill the restore into a sidecar DB first** to confirm the dump
   is good (same script as above). Don't replace live until smoke
   passes.
3. **Cut over**:
   ```bash
   PEGANA_RESTORE_FORCE=1 ./scripts/restore.sh <dump> pegana
   ```
4. **Restart the writers**:
   ```bash
   docker compose up -d indexer engine dispatcher bot
   docker compose ps                          # all healthy?
   docker compose logs --since 5m engine      # engine catching up?
   ```
5. **Tell users.** A real restore probably means alerts are silently
   wrong during the gap. Post in the bot's status / Twitter / Discord
   that the system was offline X→Y UTC and historical data between
   those times is missing.

## When restore drill fails

| Symptom | What it means | Fix |
|---|---|---|
| `could not find hypertable with id N` | TimescaleDB pre/post_restore wrap missing | Use `scripts/restore.sh` — it handles this. If still failing, the backup itself may be corrupt; try an older one. |
| `relation "..." already exists` | You're restoring into a non-empty DB | Drop the target first; the script handles this for non-prod, refuses for `pegana` without _FORCE |
| `permission denied` on `/backups/...` | File owned by root from a cron run | `sudo chown pegana:pegana /backups/*.sql.gz` |
| `rclone: directory not found` | R2 bucket missing or token expired | `rclone config show r2` to inspect; re-token from Cloudflare dashboard |
| Smoke check `assets < 14` | Backup is from before the asset seed migrations applied | Use a newer backup |
| Smoke check `discount_snapshots empty` | Backup ran before any data was ingested OR pg_dump truncated | Use a newer backup; investigate the failed backup run separately |

## Backup health verification (no incident needed)

`scripts/backup.sh` already exits non-zero on failure. Add this to
cron's monitoring so failed backups page someone:

```cron
0 4 * * * /opt/pegana/scripts/backup.sh >> /var/log/pegana-backup.log 2>&1 || curl -X POST https://your-paging-webhook/...
```

A nicer pattern — make backup.sh ping a healthchecks.io URL on
success, configure dead-man's-switch alerting there:

```bash
PEGANA_HEALTHCHECK_URL=https://hc-ping.com/<uuid> ./scripts/backup.sh && curl -fsS --retry 3 "$PEGANA_HEALTHCHECK_URL"
```

(That last line is left as a follow-up; current backup.sh doesn't
ping a URL on success.)
