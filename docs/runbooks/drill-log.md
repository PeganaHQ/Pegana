# Disaster-recovery drill log

Validates the backup → restore path (`scripts/pg-backup.sh` → `scripts/pg-restore.sh`).
Each drill restores a backup into a **throwaway** database (`--into
pegana_restore_drill`), checks the smoke counts and the TimescaleDB version,
then drops it. Prod is never touched.

The procedure and the pass criteria live in [`restore.md`](restore.md#restore-drill-procedure).
Record for every drill: date, host, backup name and size, source (local or
R2), TimescaleDB version (dump and restored DB), smoke counts, wall-clock
restore time, and verdict.

## Status

- **No drill has run on the current Hostinger stack** (rebuilt 2026-10-16).
  The 2026-06-22 entry below was on the previous Hetzner box with the aws-CLI
  version of pg-restore.sh. A drill is due as soon as pg-backup.sh produces a
  backup on this box.

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
