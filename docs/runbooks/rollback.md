# Runbook — Rolling back a bad deploy

Pegana ships **forward-only migrations** (no down scripts). Rollback strategy
is deliberately simple: code rolls back by redeploying an earlier commit with
`scripts/deploy.sh`, data rolls back via `scripts/pg-restore.sh` against a
verified backup. Don't try to undo a migration in place: restore the prior
dump instead.

Box layout: `ssh "$PEGANA_DEPLOY_SERVER"` (user `deploy`; the host itself is
only in the private `docs/ops/` runbook), stack in `~/pegana`. App services
that `deploy.sh` builds: `api engine dispatcher indexer mcp-ts
protocol-indexer`. There is no `bot` service (retired).

## Decision tree

```
Did the migration succeed?           ──no──▶  Code rollback (§A) is enough.
            │ yes
            ▼
Is the new code merely broken,                ┐
or did it corrupt data?              ──code──▶│ Code rollback (§A) + restart.
            │ data corrupted                  │
            ▼                                  ┘
Stop writers + restore last good
backup (§B). RPO: 6h from the local
copies on the same box; see §B for
what offsite does and does not hold.
```

## §A — Code-only rollback

Use when: API panics, the engine miscalculates, a source misparses, but the
data already in Postgres is still correct (only the code is bad).

> **WARNING: rolling back below the R2 merge (2026-10-21) re-arms a blind
> offsite prune.** Cron runs `~/pegana/scripts/pg-backup.sh` from the checkout
> and `deploy.sh` resets the checkout, so the rollback also restores the old
> script (8c957d1b). Its sweep is `rclone delete --min-age 30d --include
> '/pegana-*.dump.enc*'`, run right after the first upload that succeeds: with
> the R2 token working it deletes every top-level `pegana-202609*` dump older
> than 30 days. `archive/` is safe (the include is anchored to the top level).
> Before deploying such a SHA, do one of:
>
> - complete the `archive/` copy of every `pegana-202609*` object (dump,
>   `.sha256`, `.meta`) in `docs/ops/2026-10-21-launch-r2-runbook.md` step
>   4.2, or
> - add `PEGANA_BACKUP_OFFSITE_RETENTION_DAYS=0` to the pg-backup cron line
>   (`crontab -e` on the box). The old script honours it: its sweep is guarded
>   by `if (( OFFSITE_RETENTION_DAYS > 0 ))`, so 0 disables the sweep.
>
> Remove the cron-line override once the box is back on the new script.

There is no image registry: every deploy builds on the box from a git SHA
(`--no-cache`, with `PEGANA_GIT_SHA` baked in so receipts name the code that
produced them), and `deploy.sh` prunes old images afterwards. A rollback is
therefore a normal `deploy.sh` run of an earlier commit. It keeps the current
containers serving while it builds, recreates health-gated (`--wait`), and
smoke-tests the result. Expect the build to take several minutes on the
2-vCPU box; restrict `--services` to what changed to save time.

```bash
# On the laptop, in a clean checkout of the private repo.
export PEGANA_DEPLOY_SERVER=deploy@<prod-host>

# 1. What is deployed now, and what was deployed before it?
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && git rev-parse HEAD && git reflog -10 --date=iso'
#    Each deploy is a "reset: moving to <sha>" or "checkout: moving from ... to <sha>"
#    entry. The entry before the bad deploy is the last-good SHA.

# 2. Put that SHA on a rollback branch. deploy.sh deploys HEAD of the current
#    branch and pushes THAT branch, so main is never pushed by a rollback.
git fetch origin
git switch -c "rollback/$(date -u +%Y%m%dT%H%MZ)" <last-good-sha>

# 3. Deploy it. deploy.sh warns that you are not on main; answer y.
./scripts/deploy.sh                                   # all app services
./scripts/deploy.sh --services 'api engine'           # or only the broken ones

# 4. deploy.sh exits non-zero if a container is unhealthy, a compose service
#    has no running container, or the canary / mcp smoke fails. Then:
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose ps && docker compose logs --since 2m'
```

Deploying an older SHA runs that SHA's own `scripts/deploy.sh` (the
laptop's checkout), so the guards above (health-gated `--wait`, the
untracked-files guard, the canary) are only as good as that version's copy.
Read it before relying on them for a SHA from before 2026-10-21.

Afterwards: fix forward on a normal branch, merge to `main`, and deploy `main`
again with `./scripts/deploy.sh` from `main` (the box moves off the rollback
SHA the same way). Delete the rollback branch once `main` is deployed. Pushing
the rollback branch also makes Vercel build a preview of it; that is harmless
(previews do not touch production).

Do **not** roll back on the box by hand (`git checkout <sha>` plus
`docker compose up -d --build`): it skips the SHA build arg, the health gate,
the smoke test and the build-cache prune.

If a forward migration was applied with the new code but the new code is
buggy, the prior code may not know how to read the new columns. Two safe
paths:

- **Best:** the migration added columns nullable (the v1.x convention). Old
  code ignores unknown columns; just downgrade and move on.
- **Fallback:** if the migration changed semantics (rename, type narrowing,
  NOT NULL), code-only rollback alone is not safe — jump to §B.

## §B — Data restore from backup

Use when: a bug wrote corrupt rows, a migration unexpectedly changed
semantics, or the disk caught fire.

> **WARNING: same offsite-prune trap as §A, and it bites harder here.** §B
> rolls the box to an older SHA, which restores the old `pg-backup.sh` from
> the checkout. Its blind `rclone delete --min-age 30d` sweep then runs on the
> first successful upload and deletes every top-level `pegana-202609*` dump
> older than 30 days, the only copies older than the 2026-10-16 rebuild. A
> restore drill from a dump that no longer exists is not a drill. Before the
> writers come back in step 5, either the `archive/` copy of every
> `pegana-202609*` object is complete (runbook step 4.2) or the pg-backup cron
> line carries `PEGANA_BACKUP_OFFSITE_RETENTION_DAYS=0`; the old script's
> sweep is guarded by `if (( OFFSITE_RETENTION_DAYS > 0 ))`, so 0 disables it.

The full procedure lives in [`restore.md`](restore.md). The pipeline on the
box is `scripts/pg-backup.sh` (6h cron, verified local copies in `~/backups`,
offsite to R2) restored by `scripts/pg-restore.sh`. Summary:

```bash
cd ~/pegana
# 1. Stop writers so the restore isn't racing live traffic
docker compose stop indexer engine dispatcher protocol-indexer

# 2. Pick a pre-incident backup (local copies first, then R2)
./scripts/pg-restore.sh list | head -20

# 3. Restore it into a sidecar DB and check the smoke counts it prints
./scripts/pg-restore.sh restore pegana-<YYYYMMDDTHHMMSSZ>.dump.enc --into pegana_restore_<date>

# 4. Cut over the read side ON THE LAST-GOOD CODE, writers still stopped.
#    On the box: set POSTGRES_DB=pegana_restore_<date> in .env (and any
#    *_DATABASE_URL override, which wins over POSTGRES_DB). Then from the
#    laptop, on the rollback branch from §A step 2 (deploy.sh deploys the
#    laptop's HEAD and refuses a dirty tree; if the code was never the
#    problem, e.g. a lost disk, use main instead):
#      ./scripts/deploy.sh --services 'api mcp-ts'
#    Never run plain `./scripts/deploy.sh` or `--config-only` here: the
#    default service set force-recreates the four writers stopped in step 1,
#    on whatever code the laptop has checked out, and a still-buggy writer
#    would start corrupting the restored DB at once.
#    A deploy.sh with the missing-services check (2026-10-21 on) exits
#    non-zero naming indexer, engine, dispatcher and protocol-indexer as
#    "compose services without a running container", and the canary may flag
#    stale data. That is the writers you stopped; do not follow its
#    "docker compose up -d" hint. Check api and mcp-ts are healthy.

# 5. Bring the writers back on the same last-good SHA (same branch), then
#    watch them catch up
#      ./scripts/deploy.sh --services 'indexer engine dispatcher protocol-indexer'
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose ps && docker compose logs --since 5m engine'
```

Then fix forward as in §A. Steps 4 and 5 already are the code rollback, so
the writers never run the buggy code against the restored data.

**RPO:** up to 6h (backup cadence) for anything short of losing the box,
because the 6h copies in `~/backups` live on the same disk. Offsite is only as
good as the last successful R2 upload: check
`cat ~/.pegana-last-offsite-backup.txt` and
`grep offsite_last_success ~/.pegana-metrics/pegana_backup.prom` (0 means
never). As of 2026-10-21 no upload has succeeded since the 2026-10-16
rebuild (R2 token 403), so the current database has **no offsite copy** and
losing the box would lose everything since it was rebuilt. **RTO:** measured
in the latest [drill](drill-log.md); dump-size dependent (tens of minutes at
~2 GB).

## §C — Migration safety contract

All migrations under `migrations/` MUST:

1. **Be additive.** New tables, new columns (nullable default), new indexes.
2. **Be re-runnable.** `IF NOT EXISTS` on every CREATE, `IF EXISTS` on every
   destructive op (rare).
3. **Not drop data.** No `DROP TABLE`, no `DROP COLUMN`, no narrowing type
   changes without a multi-deploy migration plan (see §D).

This contract is what makes §A safe — old code can read forward-migrated
databases because old code doesn't reference the new columns.

When the contract must be broken (e.g. removing a column whose data is
genuinely dead), use §D.

## §D — Multi-deploy schema change (expand → contract)

When you really need to remove or rename a column:

| Deploy | Migration | Code |
|---|---|---|
| 1 | Add new column, dual-write | Read old, write both |
| 2 | Backfill in-place | Read both, prefer new |
| 3 | (No migration) | Read new only |
| 4 | `DROP` old column | — |

This keeps every step rollbackable to the prior step. Plan it in advance,
write each step as a separate PR.

## Quick verification post-rollback

```bash
# All services healthy
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose ps'

# API serves real data, and the readiness gate is green
curl https://api.pegana.xyz/v1/stats
curl https://api.pegana.xyz/readyz          # expect "status":"ready"
curl https://mcp.pegana.xyz/health

# WebSocket emitting heartbeats
wscat -c wss://api.pegana.xyz/v1/ws    # ^C after 10s

# Which code is live (must be the SHA you deployed)
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && git rev-parse HEAD'
```

If any of these fails post-rollback, you have a second incident; treat it
as a fresh debug session, not a rollback re-do.
