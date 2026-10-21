# Runbook — Postgres backup and restore

> Drill the restore after any backup-pipeline, image or schema change, and at
> least quarterly. Record every drill in [`drill-log.md`](drill-log.md).

The pipeline that actually runs on the prod box:

- [`scripts/pg-backup.sh`](../../scripts/pg-backup.sh), cron every 6h
  (installed by [`scripts/install-pg-backup.sh`](../../scripts/install-pg-backup.sh)).
  `pg_dump --format=custom` → AES-256 (openssl, key `~/.pegana-backup-key`) →
  verified with `pg_restore --list` → kept in `~/backups` → uploaded to R2 via
  the `r2:` rclone remote.
- [`scripts/pg-restore.sh`](../../scripts/pg-restore.sh): `list`, `fetch`,
  `restore <NAME|PATH> [--into NEW_DB]`. Uses rclone, not the aws CLI.

`scripts/backup.sh` / `scripts/restore.sh` (plain `.sql.gz`, `/backups`) are an
older, unused pipeline. Do not use them for the prod database.

## Quick reference (on the box, as `deploy`, in `~/pegana`)

| I need to … | Run |
|---|---|
| Take a backup now | `./scripts/pg-backup.sh` (exit 0 = local + offsite OK, 4 = local OK but offsite FAILED) |
| See what backups exist | `./scripts/pg-restore.sh list` |
| Is the backup pipeline healthy? | `cat ~/.pegana-metrics/pegana_backup.prom` and `tail -20 ~/.pg-backup.log` |
| Drill restore of the newest local backup | `./scripts/pg-restore.sh restore "$(./scripts/pg-restore.sh list \| awk '$1=="local"{print $2; exit}')" --into pegana_restore_drill` |
| Drill restore from R2 | `./scripts/pg-restore.sh restore pegana-<TS>.dump.enc --into pegana_restore_drill` (a name not in `~/backups` is fetched from R2) |
| Copy an R2 backup to local disk | `./scripts/pg-restore.sh fetch pegana-<TS>.dump.enc` |
| Replace the live DB (rare, destructive) | `./scripts/pg-restore.sh restore <NAME>` and type the DB name |

## What is kept, where

| Copy | Where | Retention | Protects against |
|---|---|---|---|
| Local | `~/backups/pegana-<UTC ts>.dump.enc` (+ `.sha256`, `.meta`) | newest 4 (24h) plus the newest of each of the last 7 UTC days | bad migration, bad write, accidental delete. NOT disk or box loss (same disk as the DB) |
| Offsite | R2 bucket named by `R2_BUCKET` in `~/.pegana-r2-creds.env` | 30 days for top-level `pegana-*` objects, pruned one by one after each successful upload, and only when it is safe: never an object older than the first successful upload (the prune floor in `~/.pegana-offsite-prune-floor`), and only while at least 7 newer verified dumps exist offsite (1 once `archive/` holds a dump). Objects under `archive/` are never listed or pruned | losing the box or its volume |
| Encryption key | `~/.pegana-backup-key` on the box, plus the owner's off-host copy | forever | without it every backup is unrecoverable |

To keep a backup beyond the retention windows, copy it out of the rotation:
offsite with `rclone copyto r2:<bucket>/<NAME> r2:<bucket>/archive/<NAME>`
(plus its `.sha256` / `.meta`), locally into a directory other than
`~/backups`. A file you `fetch` into `~/backups` is subject to the local
rotation like any other. If you also add an R2 lifecycle rule in the
Cloudflare dashboard, scope it to the prefix `pegana-` so it cannot reach
`archive/`.

Knobs (env on the cron line): `PEGANA_BACKUP_KEEP_RECENT`, `PEGANA_BACKUP_KEEP_DAILY`,
`PEGANA_BACKUP_MIN_FREE_MB` (default 4096; it also needs 2x the previous dump free),
`PEGANA_BACKUP_OFFSITE=off` (local only, reported as disabled),
`PEGANA_BACKUP_OFFSITE_RETENTION_DAYS` (0 disables the offsite sweep),
`PEGANA_BACKUP_OFFSITE_MIN_NEWER` (default 7), `PEGANA_BACKUP_OFFSITE_PRUNE_FLOOR`
(path of the floor file). Deleting the floor file does not unlock old objects:
the next successful upload writes a new, LATER floor.

**RPO:** up to 6h (cron cadence). **RTO:** depends on dump size. The 2026-09-30
dump was 2.07 GB, and a sequential (`-j 1`) restore of that size takes tens of
minutes. Measure it in the drill and record the number in the drill log.

## How failure is surfaced

pg-backup.sh never deletes a verified local copy on failure, and every run
writes `~/.pegana-metrics/pegana_backup.prom`. The `node-exporter` compose
service serves that file to Prometheus, and these rules
(`ops/alerts/pegana.yml`, group `pegana.backups`) go to Alertmanager:

| Alert | Fires when |
|---|---|
| `PeganaBackupLocalStale` (critical) | no verified local backup for >8h (a value of 0 means never) |
| `PeganaBackupOffsiteStale` (warning) | offsite enabled and no confirmed R2 upload for >8h |
| `PeganaBackupLastRunFailed` (warning) | the last run exited non-zero |
| `PeganaBackupNotRunning` (warning) | no run finished for >7h, or the metric is missing |

The Sentry cron monitor `pegana-pg-backup` also gets an `error` check-in on
any non-zero exit (when `SENTRY_DSN` is set).

## Version matching (TimescaleDB)

A custom-format dump of a TimescaleDB database restores cleanly only into the
**same TimescaleDB extension version** it was taken with. The 2026-09-30 dump
failed exactly this way (`hypertable_num_dimensions_check` and FK violations
in `_timescaledb_catalog` when restored into 2.29.0; the dated restore plan is
withheld from the public mirror).
A database's extension version is whatever `CREATE`/`ALTER EXTENSION` last
set, which can lag the image, so the image pin alone does not tell you the
dump's version.

How the scripts handle it:

1. pg-backup.sh writes `timescaledb_version=` and `postgres_version=` into
   `<NAME>.meta` (also uploaded to R2).
2. pg-restore.sh reads it, checks `pg_available_extension_versions` in the
   running postgres, creates the extension in the new DB **at that version**,
   runs `timescaledb_pre_restore()` → `pg_restore -j 1` →
   `timescaledb_post_restore()`, then `ALTER EXTENSION timescaledb UPDATE` (for
   `--into`) so the drill DB matches the stack.
3. If that version is not installable in this image it exits 7 and prints the
   image tag to use. Then do the scratch-container restore below.

### Scratch-container restore (version not available, or no `.meta`)

```bash
cd ~/pegana
NAME=pegana-<TS>.dump.enc
V=$(sed -n 's/^timescaledb_version=//p' ~/backups/$NAME.meta)   # for example 2.17.2
# No .meta (backups taken before this change): the version is unknown. Use the
# extension version that was live when the dump was taken, or bisect
# timescale/timescaledb:<ver>-pg16 tags until _timescaledb_catalog restores
# with zero errors.

openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass file:$HOME/.pegana-backup-key \
  -in ~/backups/$NAME -out /tmp/scratch.dump
docker volume create pegana_restore_scratch
docker run -d --name pegana-restore-scratch -v pegana_restore_scratch:/var/lib/postgresql/data \
  -e POSTGRES_USER=pegana -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=postgres \
  timescale/timescaledb:${V}-pg16
sleep 10
docker cp /tmp/scratch.dump pegana-restore-scratch:/tmp/r.dump && rm -f /tmp/scratch.dump
docker exec pegana-restore-scratch psql -U pegana -d postgres -c 'CREATE DATABASE restored'
docker exec pegana-restore-scratch psql -X -U pegana -d restored \
  -c "CREATE EXTENSION timescaledb VERSION '${V}'" -c 'SELECT timescaledb_pre_restore()'
docker exec pegana-restore-scratch pg_restore -U pegana -d restored --no-owner --no-privileges -j 1 /tmp/r.dump
docker exec pegana-restore-scratch psql -X -U pegana -d restored -c 'SELECT timescaledb_post_restore()'
```

To bring it up to the version the stack runs: stop the scratch container,
start the **current pinned image** (`grep timescaledb docker-compose.yml`) on
the same volume, then run `ALTER EXTENSION timescaledb UPDATE` as the first
statement of a fresh `psql -X` session in `restored`. From there, take a fresh
`pg_dump --format=custom` of `restored` and restore that with pg-restore.sh
as usual (its version now matches). Remove the scratch container and volume
when done: `docker rm -f pegana-restore-scratch && docker volume rm pegana_restore_scratch`.

## Restore drill (procedure)

Run on the prod box as `deploy`. It never targets the prod DB.

```bash
cd ~/pegana
./scripts/pg-backup.sh; echo "exit=$?"     # 0, or 4 while R2 is down; both leave a verified local copy
./scripts/pg-restore.sh list | head -8

# A) Offsite chain (preferred once R2 works): restore by name from R2 into a temp dir.
LATEST=$(./scripts/pg-restore.sh list | awk '$1=="r2"{print $2; exit}')
# The guard matters: an empty LATEST would make the mv move EVERY local backup.
if [[ -n "$LATEST" ]]; then
  mkdir -p /tmp/drill && mv ~/backups/"$LATEST"* /tmp/drill/ 2>/dev/null || true   # force the download path
  time ./scripts/pg-restore.sh restore "$LATEST" --into pegana_restore_drill
  mv /tmp/drill/"$LATEST"* ~/backups/ 2>/dev/null || true
else
  echo "no r2 backup listed; use variant B"
fi

# B) Local copy (while R2 is down):
# LATEST=$(./scripts/pg-restore.sh list | awk '$1=="local"{print $2; exit}')
# time ./scripts/pg-restore.sh restore "$LATEST" --into pegana_restore_drill
```

Pass criteria (record all of them in drill-log.md):

- exit 0, `Checksum OK`, no `ERROR` lines in the pg_restore output
- the smoke counts printed by the script (`discount_snapshots`, `alerts`,
  `alert_evidence`) are close to prod (same query against `-d pegana`), and
  `latest_snapshot` is within minutes of the backup timestamp
- `timescaledb` in the drill DB equals prod's extension version
- the wall-clock time from `time` (your measured RTO)

Cleanup:

```bash
PGU=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '"')
docker compose exec -T postgres psql -U "$PGU" -d postgres -c 'DROP DATABASE pegana_restore_drill;'
```

## When a real restore is needed

1. Stop the writers so the restore does not race live traffic:
   `docker compose stop indexer engine dispatcher protocol-indexer`
   (api, mcp-ts and caddy stay up; api serves stale data meanwhile).
2. Restore into a sidecar DB first (`--into pegana_restore_<date>`) and check
   the smoke counts.
3. Cut over the read side only. Prefer pointing the services at the
   restored DB (`POSTGRES_DB=pegana_restore_<date>` in `.env`, plus any
   `*_DATABASE_URL` override) over `pg-restore.sh restore <NAME>` into the
   populated prod DB, which is not a clean overwrite. Then, from the laptop,
   `./scripts/deploy.sh --services 'api mcp-ts'`. deploy.sh deploys the
   laptop's HEAD: if a code bug caused the damage, check out the last-good
   SHA first ([`rollback.md`](rollback.md) §A step 2). Never use plain
   `deploy.sh` or `--config-only` here: the default service set restarts the
   writers stopped in step 1. deploy.sh then reports the stopped writers as
   missing; that is expected.
4. Bring the writers back on the same SHA:
   `./scripts/deploy.sh --services 'indexer engine dispatcher protocol-indexer'`,
   then `docker compose ps` and `docker compose logs --since 5m engine` on
   the box.
5. Tell users the outage window and the data gap.

## When a restore fails

| Symptom | Meaning | Fix |
|---|---|---|
| exit 7, `not installable in this postgres image` | the dump's TimescaleDB version differs from the image | Scratch-container restore above |
| `hypertable_num_dimensions_check`, FK errors in `_timescaledb_catalog` | version mismatch (no `.meta`, or forced) | Scratch-container restore above |
| `could not find hypertable with id N` | pre/post_restore wrap missing | Use pg-restore.sh, which wraps it |
| `relation "..." already exists` | target DB not empty | Use a fresh `--into` name |
| exit 3 `checksum verification failed` | file corrupted in transit or at rest | Try the other copy (local or R2) or an older backup |
| exit 3 `decryption failed` | wrong `~/.pegana-backup-key` | Restore the key from the owner's off-host copy |
| `AccessDenied ... 403` from rclone | R2 token lacks Object Read & Write on the bucket | Owner issues a new token; update the `r2` remote (`rclone config`) |
| exit 6 `post_restore FAILED` | triggers may still be disabled in that DB | Run the printed `timescaledb_post_restore()` command by hand |
