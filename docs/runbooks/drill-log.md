# Disaster-recovery drill log

Validates the encrypted-R2 → Postgres restore path (`scripts/pg-restore.sh`). Each
drill restores the latest backup into a **throwaway** database (`--into
pegana_restore_drill`), validates decryption + row counts, then drops it — prod is
never touched.

To run a drill (on Hetzner as `deploy`):

```sh
cd ~/pegana
LATEST=$(./scripts/pg-restore.sh list | head -1 | awk '{print $NF}')
./scripts/pg-restore.sh restore "$LATEST" --into pegana_restore_drill
PGU=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '"')
docker compose exec -T postgres psql -U "$PGU" -d pegana_restore_drill -c \
  "SELECT (SELECT count(*) FROM discount_snapshots) AS discount_snapshots,
          (SELECT count(*) FROM alerts) AS alerts,
          (SELECT count(*) FROM alert_evidence) AS alert_evidence,
          (SELECT max(ts) FROM discount_snapshots) AS latest_snapshot;"
docker compose exec -T postgres psql -U "$PGU" -d postgres -c \
  "DROP DATABASE pegana_restore_drill;"
```

---

## 2026-06-22 — F-41b drill ✅ PASS

- **Backup restored:** `pegana-20260621T210001Z.dump.enc` (421 MB, R2 `pegana-backups`, taken 2026-06-21 21:00 UTC — the latest 6-hourly backup).
- **Decryption:** OK — `~/.pegana-backup-key` (AES-256-CBC, pbkdf2 100k) decrypted the archive without error.
- **Restore:** OK — `pg_restore -j 1` into scratch DB `pegana_restore_drill`; TimescaleDB `pre_restore()`/`post_restore()` ran clean (the BLOCK-TRUNCATE trigger was disabled during restore and re-enabled after, both returned `t`); prod DB untouched.
- **Validation (restored scratch DB):**
  - `discount_snapshots` = **3,754,126**
  - `alerts` = **266**
  - `alert_evidence` = **184**
  - `max(discount_snapshots.ts)` = **2026-06-21 21:00:00 UTC** — matches the backup timestamp, so the dump is complete and current (no truncation).
- **Cleanup:** scratch DB dropped (`DROP DATABASE`).
- **Verdict:** the encrypted-R2 restore path is exercised and working end-to-end (download → decrypt → TimescaleDB-aware restore → validated row counts). The previously-untested DR path (audit finding F-41b) is now drilled.
- **Operator note:** restore ran sequentially (`-j 1`, required for TimescaleDB catalog FK ordering — see the comment block in `scripts/pg-restore.sh`); completed without manual intervention.

_Next drill: re-run after any backup-pipeline or schema change, or quarterly._
