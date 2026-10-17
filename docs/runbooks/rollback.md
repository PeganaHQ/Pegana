# Runbook — Rolling back a bad deploy

Pegana ships **forward-only migrations** (no down scripts). Rollback strategy
is deliberately simple: code rolls back via `git`, data rolls back via
`scripts/restore.sh` against a recent backup. Don't try to undo a migration
in place — restore the prior dump instead.

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
backup (§B). Expect ~15min RTO,
~24h RPO.
```

## §A — Code-only rollback

Use when: API panics, dispatcher misroutes, engine miscalculates — but
`subscriptions`, `alerts`, `users` are still intact in Postgres.

```bash
ssh pegana@<server-ip>
cd /opt/pegana

# Identify the last-good SHA (the deploy that worked yesterday)
git log --oneline -10

# Checkout that SHA
git checkout <last-good-sha>

# Rebuild only the services with code change
docker compose up -d --build api engine dispatcher indexer bot

# Confirm everyone is healthy
docker compose ps
docker compose logs --since 2m
```

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

The full procedure lives in [`restore.md`](restore.md). Summary:

> ⚠️ **USE `scripts/pg-restore.sh`, not the `rclone` + `scripts/restore.sh` flow shown
> below.** The pipeline actually running + drilled in prod is `scripts/pg-backup.sh` →
> Cloudflare R2 (6h cron, Sentry check-ins) restored by `scripts/pg-restore.sh` (the
> 2026-06-22 drill restored 3.75M rows end-to-end — see `drill-log.md`). The commands
> in this block describe an older `backup.sh`/`restore.sh` pipeline that is NOT the one
> on the box. This section is pending a rewrite around `pg-restore.sh`.

```bash
# 1. Stop writers so the restore isn't racing live traffic
docker compose stop indexer engine dispatcher bot

# 2. Pull a pre-incident backup from R2
rclone copy r2:pegana-backups/pegana-<YYYYMMDD-HHMMSS>.sql.gz /tmp/

# 3. Test the restore against a sidecar DB first
./scripts/restore.sh /tmp/pegana-<TS>.sql.gz pegana_restore_test

# 4. If the sidecar smoke passes, replace live
PEGANA_RESTORE_FORCE=1 ./scripts/restore.sh /tmp/pegana-<TS>.sql.gz pegana

# 5. Bring the writers back, watch them catch up
docker compose up -d indexer engine dispatcher bot
docker compose logs --since 5m engine

# 6. Roll the code back too (§A) so the writers don't reintroduce the bug
git checkout <last-good-sha>
docker compose up -d --build api engine dispatcher indexer bot
```

**RPO:** up to 24h (one daily backup at 04:00 UTC).
**RTO:** ~15 minutes for the data part. New VPS adds ~30min.

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
docker compose ps

# API serves real data
curl https://api.pegana.xyz/v1/stats

# WebSocket emitting heartbeats
wscat -c wss://api.pegana.xyz/v1/ws    # ^C after 10s

# Dispatcher dequeues alerts (look for "delivery sent" lines)
docker compose logs --since 5m dispatcher

# Bot replies to /status from a test account
```

If any of these fails post-rollback, you have a second incident; treat it
as a fresh debug session, not a rollback re-do.
