# Wave 3B implementation notes

> Generated from the Wave 3A `/review-and-iterate` pass on 2026-05-28.
> These are operational gotchas the Wave 3B engine code MUST handle.

---

## Note 1 — engine MUST INSERT critical alerts with `commit_status = 'pending'`

Migration 0033 added `commit_status TEXT NOT NULL DEFAULT 'not_applicable'`.
The append-only trigger treats `not_applicable` as **terminal** (cannot
advance to any other state).

This means: if `push_alert` does a plain `INSERT INTO alert_evidence (...)`
for a critical alert, the row lands with `commit_status='not_applicable'`,
and the subsequent `UPDATE ... SET commit_status='pending'` from
`onchain_commit::commit_receipt` will be **rejected by the trigger**.

### Correct usage

```rust
// In push_alert (Wave 3B Task 3.5):
let initial_commit_status = if matches!(
    final_state,
    PegState::Depeg | PegState::Critical | PegState::BlackSwan
) {
    "pending"
} else {
    "not_applicable"
};

sqlx::query(
    r#"INSERT INTO alert_evidence
           (alert_id, methodology_version, methodology_git_sha,
            assets_toml_sha256, inputs_frozen, computed, replay_artifact,
            receipt_sha256, commit_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
)
.bind(alert_id)
.bind(methodology_version)
.bind(methodology_git_sha)
.bind(assets_toml_sha256)
.bind(inputs_frozen_jsonb)
.bind(computed_jsonb)
.bind(replay_artifact_jsonb)
.bind(receipt_sha256_hex)
.bind(initial_commit_status)
.execute(pg)
.await?;
```

### Verification

The integration test
`commit_status_terminal_not_applicable_blocks_advance` would catch the
wrong-INSERT bug at engine startup against a real DB. Run before deploy.

---

## Note 2 — background retry worker MUST validate `alert_evidence_pending.payload` schema

Migration 0034's `alert_evidence_pending.payload` is an opaque JSONB blob
holding "everything that should land in `alert_evidence` on retry success".

Scenario: engine v0.1.0 inserts a pending payload with schema-v1; engine
v0.1.1 ships with a new required column (e.g., a future ADR adds a
`compute_duration_ms BIGINT NOT NULL`). The retry worker reading old
payloads will fail every retry forever — row stays pending past the 24h
window and gets `failed_permanently_at` set.

That outcome is actually correct for v0.1.0 → v0.1.1, BUT the failure
reason should be **explicit** ("schema_drift") not the generic SQL error,
so ops knows to skip the row vs investigate a corrupted payload.

### Implementation requirements for Wave 3B retry worker

1. Embed payload schema version in the JSONB blob:
   ```json
   { "schema": 1, "payload": { ... } }
   ```
2. Worker reads `payload.schema` field. If mismatch with current engine
   version's schema, set `failed_permanently_at` immediately with
   `last_error = 'schema_drift: payload v1 vs engine v2'` and Sentry capture.
3. Don't retry rows with schema mismatch.

### Defer to v0.1.1+

For v0.1.0 launch, only schema-v1 exists, so the worker can just retry.
The schema-version field is forward-compat: when v0.1.1 ships, the
worker code adds the validation. Not blocking for 2026-06-11 launch.

---

## Note 3 — DROP TABLE is NOT blocked by the trigger

Migration 0037 closes the TRUNCATE bypass, but `DROP TABLE alert_evidence`
still works for any role with DDL privileges (including the `pegana` app
user that owns the table on the prod DB).

### Operational mitigation

Document in the deploy runbook:
- Create a separate `pegana_migrate` role with DDL privileges, used only
  by the migration runner.
- `pegana` (app user) gets only DML privileges via `REVOKE`:
  ```sql
  REVOKE CREATE, DROP, TRUNCATE ON SCHEMA public FROM pegana;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pegana;
  ```
- Re-grant per-table as needed.

This is org-level setup, not Wave 3B engine work. Captured here so it
gets to the runbook eventually.

---

## Cross-refs

- Migration 0033 (commit_status): `migrations/0033_commit_status_and_failures.sql`
- Migration 0034 (alert_evidence_pending): `migrations/0034_alert_evidence_pending.sql`
- Migration 0037 (TRUNCATE block): `migrations/0037_block_truncate.sql`
- Integration test: `crates/engine-rs/tests/alert_evidence_append_only.rs`
- ADR-0004 (commit policy): `docs/adr/0004-onchain-commit-policy.md`
- ADR-0006 (persistence failure): `docs/adr/0006-alert-evidence-persistence-failure.md`
