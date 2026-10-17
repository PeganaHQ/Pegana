> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 04 — Data Model

> Postgres schema changes for Trust Layer v0.1.0: 4 new migrations (0028-0031), 1 codified view, 1 column addition. JSONB payload shapes for `inputs_frozen`, `computed`, and `replay_artifact`. All append-only where it counts.

---

## 1. Migration overview

| File | Purpose | Touches |
|---|---|---|
| `migrations/0028_alert_evidence.sql` | New append-only audit table | NEW table + 2 triggers + 2 indexes |
| `migrations/0029_alert_events_view.sql` | Codify production view used by MCP | NEW view (`CREATE OR REPLACE`) |
| `migrations/0030_methodology_versions.sql` | Methodology lifecycle tracking | NEW table + seed row |
| `migrations/0031_alert_evidence_onchain_sig.sql` | On-chain SAS attestation tx signature | ALTER TABLE — add column + partial index |

All four are **additive** — no existing table is modified destructively, no data is migrated, no `DROP` statements. Rollback is `DROP TABLE alert_evidence; DROP TABLE methodology_versions; DROP VIEW alert_events; ALTER TABLE alert_evidence DROP COLUMN onchain_tx_sig;` — safe to run during a hot reboot.

---

## 2. Migration 0028 — `alert_evidence` table

```sql
-- migrations/0028_alert_evidence.sql

CREATE TABLE alert_evidence (
    alert_id              UUID        PRIMARY KEY REFERENCES alerts(id),

    -- Methodology identity ("what rule was in force?")
    methodology_version   TEXT        NOT NULL,
    methodology_git_sha   TEXT,
    assets_toml_sha256    CHAR(64)    NOT NULL,

    -- Frozen inputs ("what did the rule see?")
    inputs_frozen         JSONB       NOT NULL,

    -- Computed outputs ("what conclusion did it reach?")
    computed              JSONB       NOT NULL,

    -- Replay artifact (NULL for DRIFT alerts; populated for DEPEG/CRITICAL/BLACK_SWAN)
    replay_artifact       JSONB,

    -- Canonical receipt hash ("how to detect tampering?")
    receipt_sha256        CHAR(64)    NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only enforcement via PL/pgSQL triggers
CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_evidence_no_update
    BEFORE UPDATE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

CREATE TRIGGER alert_evidence_no_delete
    BEFORE DELETE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

-- Indexes for common queries
CREATE INDEX idx_alert_evidence_methodology ON alert_evidence (methodology_version);
CREATE INDEX idx_alert_evidence_assets_hash ON alert_evidence (assets_toml_sha256);
```

**Why append-only via triggers** (not just `REVOKE UPDATE,DELETE FROM ...`):
- DB superuser can bypass GRANT/REVOKE.
- Triggers raise at execution time, log to Postgres audit log.
- An attacker needing to alter a receipt must drop the trigger first, which itself leaves a trace.

**Trigger raises SQLSTATE `P0001`** — Rust sqlx error pattern: `e.to_string().contains("append-only")`.

---

## 3. Migration 0029 — codify `alert_events` view

The MCP server (`mcp-ts/src/tools/subscribe-peg-events.ts`) queries `alert_events` but no migration creates it. Likely created out-of-band on production. This migration codifies it so a fresh database build works.

```sql
-- migrations/0029_alert_events_view.sql

CREATE OR REPLACE VIEW alert_events AS
SELECT
    id,
    asset,
    from_state,
    to_state,
    discount,
    detected_at AS ts
FROM alerts;

COMMENT ON VIEW alert_events IS
    'Backward-compat view consumed by mcp-ts/src/tools/subscribe-peg-events.ts. '
    'Source: alerts table. Update this view when column semantics change.';
```

**Pre-flight check** (Phase 0, Task 0.1): run `\d alert_events` on production. If view exists with matching column set, this migration is a no-op (`CREATE OR REPLACE` is idempotent). If view is absent, the migration creates it and MCP recovers from whatever broken state it was in.

---

## 4. Migration 0030 — `methodology_versions` lifecycle table

```sql
-- migrations/0030_methodology_versions.sql

CREATE TABLE methodology_versions (
    version       TEXT        PRIMARY KEY,        -- semver: "0.1.0"
    git_tag       TEXT        NOT NULL,           -- "methodology-v0.1.0"
    released_at   TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('active', 'deprecated', 'broken')),
    status_reason TEXT,                           -- "EWMA off-by-one when prev=None"
    superseded_by TEXT REFERENCES methodology_versions(version),
    notes         TEXT
);

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.1.0',
    'methodology-v0.1.0',
    NOW(),
    'active',
    'Initial release. Extracted from engine v0.1.0; no behavior change.'
);
```

**Status semantics**:
- **active**: producing trusted alerts NOW.
- **deprecated**: superseded by a newer version; past alerts from this version remain valid.
- **broken**: bug confirmed; past alerts from this version show a warning banner on `/audit/[id]` web page. Engine refuses to run a broken version (startup check, see `06-engine-changes.md § Startup`).

**Future versions are inserted manually by PR**:
```sql
INSERT INTO methodology_versions VALUES (
    '0.1.1', 'methodology-v0.1.1', NOW(), 'active',
    NULL, NULL, 'Fix EWMA seeding bug discovered 2026-07-XX'
);
UPDATE methodology_versions SET status='broken', status_reason='EWMA bug', superseded_by='0.1.1' WHERE version='0.1.0';
```

The `UPDATE` works on this table — it is NOT append-only (intentionally, versions need status transitions). The `alert_evidence` table records the version at the time of the alert, so historical decisions remain checkable.

---

## 5. Migration 0031 — on-chain commit signature column

```sql
-- migrations/0031_alert_evidence_onchain_sig.sql

ALTER TABLE alert_evidence
    ADD COLUMN onchain_tx_sig TEXT;

-- Partial index for the "pending commit" background worker (if added later)
CREATE INDEX idx_alert_evidence_onchain_pending
    ON alert_evidence (created_at)
    WHERE onchain_tx_sig IS NULL;

COMMENT ON COLUMN alert_evidence.onchain_tx_sig IS
    'Solana transaction signature of the on-chain receipt commit '
    '(via Solana Attestation Service, or SPL Memo fallback). '
    'NULL until commit_receipt() completes async post-alert.';
```

The trigger from migration 0028 blocks `UPDATE`. **BUT** the engine needs to SET `onchain_tx_sig` after the alert is committed. Resolution: a `BEFORE UPDATE` trigger with column-specific allow-list.

**Updated trigger** (migration 0028 must be amended OR migration 0031 redefines the trigger):

```sql
-- migrations/0031_alert_evidence_onchain_sig.sql (updated trigger)

CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    -- Allow ONLY onchain_tx_sig updates when transitioning from NULL → non-NULL
    IF TG_OP = 'UPDATE' THEN
        IF NEW.alert_id IS DISTINCT FROM OLD.alert_id
            OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
            OR NEW.methodology_git_sha IS DISTINCT FROM OLD.methodology_git_sha
            OR NEW.assets_toml_sha256 IS DISTINCT FROM OLD.assets_toml_sha256
            OR NEW.inputs_frozen IS DISTINCT FROM OLD.inputs_frozen
            OR NEW.computed IS DISTINCT FROM OLD.computed
            OR NEW.replay_artifact IS DISTINCT FROM OLD.replay_artifact
            OR NEW.receipt_sha256 IS DISTINCT FROM OLD.receipt_sha256
            OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'alert_evidence is append-only — only onchain_tx_sig may be set once';
        END IF;
        -- onchain_tx_sig may be set ONCE: NULL → non-NULL is allowed; non-NULL → anything is rejected
        IF OLD.onchain_tx_sig IS NOT NULL THEN
            RAISE EXCEPTION 'onchain_tx_sig is write-once';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;
```

**Test**: `crates/engine-rs/tests/alert_evidence_append_only.rs` MUST cover:
1. UPDATE of `methodology_version` raises exception.
2. DELETE raises exception.
3. UPDATE of `onchain_tx_sig` from NULL → "abc..." succeeds.
4. UPDATE of `onchain_tx_sig` from "abc..." → "def..." raises exception (write-once).

---

## 6. JSONB schemas — `inputs_frozen`

```json
{
  "asset": "USDe",
  "class": "stable_dn",
  "now": "2026-05-28T14:33:12.043Z",
  "alpha": "0.3",
  "intrinsic_usd": "1.000000",
  "market_usd": "0.987432",
  "intrinsic_sol": null,
  "market_sol": null,
  "ewma_prev": "0.001234",
  "hyusd_cr": null,
  "previous_state": "PEGGED",
  "candidate_state": "DRIFT",
  "candidate_since": "2026-05-28T14:32:38.012Z",
  "thresholds": { "drift": 25, "depeg": 100, "critical": 300 },
  "threshold_kind": "bps",
  "pyth_entries": {
    "USDe/USD": {
      "price": "0.987432",
      "confidence": "0.000891",
      "publish_time": "2026-05-28T14:33:11.987Z"
    }
  },
  "confirm_up_secs": 30,
  "decay_down_secs": 120
}
```

**Field requirements**:
- All `Decimal` values serialized as **strings** (e.g., `"0.987432"`), not JSON numbers — avoids float ambiguity.
- All timestamps serialized as RFC 3339 with millisecond precision.
- `intrinsic_sol`/`market_sol` are `null` for non-LST assets.
- `hyusd_cr` is `null` for non-CDP assets.
- `thresholds` is the threshold map AT THE TIME of the decision (captured from `assets.toml` parsed values). Future calibration changes don't invalidate past receipts.
- `pyth_entries` includes every Pyth feed this asset depends on (intrinsic + market). For LSTs that don't use Pyth (e.g., JupSOL with Sanctum-only intrinsic), this map is empty.

**Serialization order**: when encoded for `canonical_receipt_hash`, keys sorted alphabetically per JCS (RFC 8785). The methodology crate handles this via `serde_json_canonicalizer`.

---

## 7. JSONB schemas — `computed`

```json
{
  "discount_raw": "0.012568",
  "discount_smooth": "0.005934",
  "final_state": "DRIFT",
  "confidence_label": "high"
}
```

**4 fields, all required**:
- `discount_raw`: pre-EWMA discount value
- `discount_smooth`: post-EWMA
- `final_state`: the PegState after hysteresis (the actual alert state)
- `confidence_label`: derived from Pyth confidence intervals — `"high"` | `"medium"` | `"low"`

Decimal values serialized as strings.

---

## 8. JSONB schemas — `replay_artifact`

Self-contained bundle for offline replay (populated for DEPEG, CRITICAL, BLACK_SWAN; NULL for DRIFT).

```json
{
  "schema_version": "v1",
  "methodology_version": "0.1.0",
  "methodology_git_sha": "d4a60ff...",
  "assets_toml_canonical": "<full canonicalized TOML string>",
  "inputs_frozen": { /* see Section 6 */ },
  "expected_computed": { /* see Section 7 */ },
  "expected_receipt_sha256": "abc123..."
}
```

**Sizing**:
- Without canonical TOML: ~2-4 KB
- With canonical TOML (~7-10 KB for 28 assets): ~10-15 KB total
- 50 critical alerts/month × 15 KB = 750 KB/month = ~10 MB/year. Negligible.

**Why include canonical TOML in artifact**: the `assets.toml` file in git evolves. If a past version of `assets.toml` is needed to reproduce an old alert, the artifact carries it. The replay CLI doesn't need to `git checkout` — it has everything.

---

## 9. Receipt hash (canonical)

```
receipt_sha256 = SHA256(
    methodology_version
    || 0x00
    || methodology_git_sha (or "" if None)
    || 0x00
    || assets_toml_canonical
    || 0x00
    || JCS(inputs_frozen)
    || 0x00
    || JCS(computed)
)
```

Where:
- `JCS(...)` = canonical JSON per RFC 8785 via `serde_json_canonicalizer`
- `||` = byte concatenation
- `0x00` = null byte separator (prevents prefix-collision attacks across the 5 concatenated parts)

**Hex-encoded** (lowercase, 64 chars) when stored in `alert_evidence.receipt_sha256` (CHAR(64)).

Implementation: `crates/methodology/src/canonical.rs::canonical_receipt_hash`. See `05-methodology-crate.md § canonical hashing`.

---

## 10. Storage growth projections

| Metric | Today (21 active) | At 06-11 (26 active) | Post-Phase 14 (32 active) |
|---|---|---|---|
| Snapshots/day | ~100k (existing) | ~125k | ~150k |
| `discount_snapshots` row size | ~200 bytes | same | same |
| `discount_snapshots` 90d retention | ~1.8 GB | ~2.2 GB | ~2.7 GB |
| `alerts` rows/month | ~500 (DRIFT) + ~50 (critical) | ~600 + ~60 | ~750 + ~75 |
| `alert_evidence` rows/month | — | ~660 | ~825 |
| `alert_evidence` size/month | — | ~3 MB (avg 4 KB row) | ~4 MB |
| `alert_evidence` size/year (all retained) | — | ~36 MB | ~48 MB |

Postgres + TimescaleDB on Hetzner CPX32 has 80 GB SSD. Years of headroom.

---

## 11. Failure modes (data-level)

| Failure | DB impact | Recovery |
|---|---|---|
| `alert_evidence` insert fails (constraint violation, e.g. NULL on NOT NULL) | Alert row exists, no evidence row → `/v1/audit/:id` returns `evidence_missing` 404 | Manual `INSERT` from logged inputs if recoverable; otherwise document as known gap |
| `alert_evidence` insert succeeds, `onchain_tx_sig` async never lands | Evidence is queryable, `onchain` endpoint returns 404 `not_committed_yet` | Background worker retries; ops checks `pegana_commit_wallet_balance_sol` |
| `methodology_versions` UPDATE marks `0.1.0` broken | Engine refuses to start on next deploy; cannot rollback within same version | Operator deploys `0.1.1` and updates the table |
| Trigger blocks UPDATE attempt | Caller (engine onchain_commit) sees Postgres error `P0001`; logs + counter increments | Investigated; legitimate update paths must use column-allow-list trigger |
| `assets.toml` mutated mid-flight (race with engine startup) | Inconsistent `assets_toml_sha256` across alerts | File watcher OR engine restart required when `assets.toml` changes (operational discipline) |

---

## 12. Existing tables NOT modified

Trust Layer v0.1.0 does NOT touch:
- `alerts` (existing schema preserved)
- `discount_snapshots` (existing hypertable)
- `intrinsic_snapshots`, `market_snapshots` (existing source tables)
- `assets` (existing config snapshots, used by web `/v1/assets`)
- `users`, `subscriptions`, `bot_sessions`, `user_digest_pref`, etc. (existing user data)
- `webhook_subscriptions`, `webhook_deliveries`, `alert_deliveries`
- `bot_runtime_kv`, `bot_magic_links`, `bot_idempotency`
- `user_source` (Phase 3B feature)

**Rule**: Trust Layer is additive. If a change requires modifying an existing table, escalate to spec discussion before implementing.

---

## 13. Cross-references

- For the engine's read/write code touching `alert_evidence`, see `06-engine-changes.md § push_alert`.
- For methodology version startup check, see `06-engine-changes.md § Engine startup sequence`.
- For canonical hashing implementation, see `05-methodology-crate.md § canonical module`.
- For the API endpoint that returns this data, see `07-api-surface.md § GET /v1/audit/:alert_id`.
- For acceptance criteria AC10-AC15, AC81 mapping migrations, see `12-acceptance-criteria.md § Audit persistence`.
