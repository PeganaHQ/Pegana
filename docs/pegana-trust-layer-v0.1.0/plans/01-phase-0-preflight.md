> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 0 — Pre-Flight (parallel with engineering phases)

**Spec reference**: `../01-business-rules.md § 3. Calibration gates`, `../03-asset-coverage.md § Phase 0`
**Acceptance criteria covered**: AC77, AC78, AC79, AC80, AC81-AC85
**Dependencies**: none — runs in parallel with all engineering phases
**Calendar gate**: 2026-05-27 (calibration v1 already started) → 2026-06-10 (verdict due)

---

## Overview

Phase 0 has TWO purposes:

1. **Add 5 new assets** (JupUSD, JLP, EURC, dzSOL, vSOL) to `assets.toml` with `active=false` so they accumulate calibration data alongside the 21 currently active assets. On launch day (06-11), they flip to `active=true`.
2. **Close the existing calibration v1 dogfood window** (already running, ends 06-10) with measured per-asset p50/p95/p99 + launch verdict.

Phase 0 is a **calendar-gated** phase, not engineering-gated — most of the time is waiting for data to accumulate. The deliverables (asset entries, monitoring panel, report docs) are small chunks of work spread over 14 days.

---

## Task 0.1 — Confirm `alert_events` view on production

**Files**: none (operational check + optional `migrations/0029_alert_events_view.sql` if missing)
**Why**: MCP `subscribe_peg_events` queries `alert_events`, but the view exists out-of-band on prod with no migration. If absent, MCP is silently broken. We need to know NOW, not at deploy.

- [ ] **Step 1**: SSH to Hetzner

```bash
ssh ${PEGANA_DEPLOY_SERVER}
```

- [ ] **Step 2**: Inspect the view

```bash
cd /opt/pegana
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "\d+ alert_events"
```

**Expected if exists**: output shows a VIEW with columns `id, asset, from_state, to_state, discount, ts`.

**If "Did not find any relation named 'alert_events'"**: MCP is broken in prod RIGHT NOW. Stop everything and apply migration 0029 immediately (out-of-band):

```bash
docker compose run --rm api sqlx migrate run --source /app/migrations
```

After applying, test MCP subscribe_peg_events with a sample call to confirm recovery.

- [ ] **Step 3**: Document findings

Create `docs/operations/pre-deploy-notes-trust-layer.md`:

```markdown
# Trust Layer pre-deploy notes

## alert_events view check (YYYY-MM-DD)

- Status: [EXISTS | MISSING]
- Columns observed: id, asset, from_state, to_state, discount, ts
- Action: [none | migration 0029 applied out-of-band on YYYY-MM-DD HH:MM UTC]
- MCP subscribe_peg_events smoke test: [PASS | FAIL]
```

- [ ] **Step 4**: Commit operational note

```bash
git add docs/operations/pre-deploy-notes-trust-layer.md
git commit -m "$(cat <<'EOF'
docs(ops): pre-deploy check for alert_events view

Confirmed status of alert_events view on production. Documented for
Phase 0 acceptance criterion AC80.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 0.2 — Add 5 new assets to `assets.toml` with `active=false`

**Files**: `assets.toml` (modify), `crates/common/src/lib.rs` (test assertion update)
**Why**: 5 new assets enter passive calibration today; they activate on 06-11 if p99 stays within plausible threshold ranges.

- [ ] **Step 1**: Verify mint addresses against mainnet

```bash
solana account 27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4 --output json | jq '.account.lamports'   # JLP — confirmed via solscan
# For JupUSD, dzSOL, vSOL, EURC: search Jupiter / DoubleZero / Sanctum / Circle docs.
```

**Mint sources to verify before commit**:
- **JupUSD** — Jupiter launch announcement (January 2026)
- **JLP** — `27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4` (confirmed)
- **EURC** — Circle developer docs (`developers.circle.com`)
- **dzSOL** — DoubleZero docs (LST launched mid-2025)
- **vSOL** — Sanctum Infinity pool docs (validator-optimized LST)

The existing CI workflow `verify-assets` automatically validates mint addresses on every push.

- [ ] **Step 2**: Append entries to `assets.toml`

After the existing `[[assets]]` blocks (last entry currently is `pbUSDC`), append:

```toml
# ===== Phase 0 additions (Trust Layer v0.1.0) =====
# Added 2026-05-28 in passive calibration mode (active=false).
# Calibration window: 2026-05-27 → 2026-06-10.
# Flip to active=true at deploy time (06-11) per Phase 13.

[[assets]]
symbol         = "JupUSD"
mint           = "REPLACE_WITH_VERIFIED_MINT"  # CONFIRM in Jupiter docs
name           = "Jupiter USD"
verified       = true
decimals       = 6
token_program  = "spl"
class          = "stable_dn"                   # Delta-neutral synthetic (matches USDe)
peg_target     = "USD"
intrinsic      = { kind = "fixed_1_usd" }
market         = { kind = "pyth_spot", feed = "JUPUSD/USD" }  # CONFIRM Pyth feed name
pyth_feed_id   = "0x..."                       # CONFIRM in Pyth catalog
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }
active         = false

[[assets]]
symbol         = "JLP"
mint           = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4"
name           = "Jupiter Perps LP"
verified       = true
decimals       = 6
token_program  = "spl"
class          = "stable_yield"                # Conservative — JLP is index-basket but we treat as discount-only-sensitive
peg_target     = "USD"
intrinsic      = { kind = "pyth_redemption_rate", feed = "JLP/USD.NAV" }  # CONFIRM feed exists
market         = { kind = "pyth_spot", feed = "JLP/USD" }
pyth_feed_id   = "0xc811abc82b4bad1f9bd711a2773ccaa935b03ecef974236942cec5e0eb845a3a"
thresholds_bps = { drift = 60, depeg = 200, critical = 500 }
active         = false

[[assets]]
symbol         = "EURC"
mint           = "REPLACE_WITH_VERIFIED_MINT"  # CONFIRM Circle docs
name           = "Euro Coin"
verified       = true
decimals       = 6
token_program  = "spl"
class          = "stable_fiat"
peg_target     = "EUR"                          # First non-USD peg
intrinsic      = { kind = "fixed_1_usd" }       # ⚠️ TODO: implement Fixed1Eur or use PythFxCross EUR/USD
market         = { kind = "pyth_spot", feed = "EURC/USD" }
pyth_feed_id   = "0x..."
thresholds_bps = { drift = 20, depeg = 75, critical = 250 }
active         = false

[[assets]]
symbol         = "dzSOL"
mint           = "REPLACE_WITH_VERIFIED_MINT"  # CONFIRM DoubleZero docs
name           = "DoubleZero SOL"
verified       = true
decimals       = 9
token_program  = "spl"
class          = "lst"
peg_target     = "SOL"
intrinsic      = { kind = "sanctum_lst", symbol = "dzSOL" }  # If supported via Sanctum
market         = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id   = ""
thresholds_bps = { drift = 50, depeg = 120, critical = 280 }
active         = false

[[assets]]
symbol         = "vSOL"
mint           = "REPLACE_WITH_VERIFIED_MINT"  # CONFIRM Sanctum Infinity pool list
name           = "Validator SOL"
verified       = true
decimals       = 9
token_program  = "spl"
class          = "lst"
peg_target     = "SOL"
intrinsic      = { kind = "sanctum_lst", symbol = "vSOL" }
market         = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id   = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }
active         = false
```

- [ ] **Step 3**: Update test assertion to reflect new count

In `crates/common/src/lib.rs::tests::assets_toml_parses` (around line 340), change:

```rust
assert!(
    parsed.assets.len() >= 23,
    "expected at least 23 assets, found {}",
    parsed.assets.len()
);
```

to:

```rust
assert!(
    parsed.assets.len() >= 28,
    "expected at least 28 assets (23 existing + 5 Phase 0 additions), found {}",
    parsed.assets.len()
);
```

- [ ] **Step 4**: Run test to confirm parsing

```bash
cargo test -p pegana-common --lib assets_toml_parses
```

Expected: passes. If any new entry has invalid TOML, test fails and shows which.

- [ ] **Step 5**: Wait for `verify-assets` CI job

Push branch to GitHub. CI runs `verify-assets` job that validates each mint exists on Solana mainnet. If any new mint is wrong, CI fails — go back to Step 1 and find correct mint.

- [ ] **Step 6**: Commit

```bash
git add assets.toml crates/common/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(assets): Phase 0 additions — JupUSD + JLP + EURC + dzSOL + vSOL (active=false)

5 new assets enter passive 14-day calibration window. Activate to
active=true at Phase 13 deploy (2026-06-11) if calibration p99 stays
within thresholds. Mints verified against mainnet via verify-assets CI.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 0.3 — Add Grafana calibration panel for new assets

**Files**: `ops/grafana/dashboard.json`
**Why**: Daily monitoring of p99 |discount| for the 5 new assets during the calibration window.

- [ ] **Step 1**: Add panel JSON to dashboard

In `ops/grafana/dashboard.json` `panels[]` array, append:

```json
{
  "id": 100,
  "type": "timeseries",
  "title": "Phase 0 calibration — p99 |discount| for new assets",
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 50 },
  "targets": [{
    "datasource": { "type": "prometheus", "uid": "$datasource" },
    "expr": "histogram_quantile(0.99, sum(rate(pegana_engine_discount_raw_bucket{asset=~\"JupUSD|JLP|EURC|dzSOL|vSOL\"}[1h])) by (asset, le))",
    "legendFormat": "{{asset}}",
    "refId": "A"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "percentunit",
      "thresholds": {
        "mode": "absolute",
        "steps": [
          { "value": null, "color": "green" },
          { "value": 0.005, "color": "yellow" },
          { "value": 0.02, "color": "red" }
        ]
      }
    }
  }
}
```

(Adjust `gridPos.y` to land at the bottom of the existing dashboard layout.)

- [ ] **Step 2**: Reload Grafana

```bash
ssh ${PEGANA_DEPLOY_SERVER}
cd /opt/pegana
docker compose restart grafana
```

Visit dashboard URL — verify new panel renders.

- [ ] **Step 3**: Commit

```bash
git add ops/grafana/dashboard.json
git commit -m "$(cat <<'EOF'
chore(observability): Grafana panel for Phase 0 calibration p99

Tracks |discount| p99 over 1h for JupUSD, JLP, EURC, dzSOL, vSOL.
Threshold lines at 0.5% (yellow) and 2% (red) for daily eyeball
during 14-day calibration window.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 0.4 — Webhook dogfood report (target 2026-06-03)

**Files**: `docs/operations/webhook-dogfood-2026-06-03.md` (new)
**Why**: AC78 — webhook delivery rate ≥ 99% + p99 ≤ 5s, gates Phase 13 deploy.

- [ ] **Step 1**: Query webhook deliveries from prod DB

```bash
ssh ${PEGANA_DEPLOY_SERVER}
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" <<'SQL'
SELECT
    COUNT(*) AS total_attempts,
    COUNT(*) FILTER (WHERE status = 'delivered' AND status_code BETWEEN 200 AND 299) AS delivered_2xx,
    COUNT(*) FILTER (WHERE status = 'failed_final') AS failed_final,
    COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - queued_at))) AS p50_seconds,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - queued_at))) AS p95_seconds,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - queued_at))) AS p99_seconds
FROM webhook_deliveries
WHERE attempted_at > '2026-05-27';
SQL
```

- [ ] **Step 2**: Capture per-receiver breakdown

```sql
SELECT
    ws.url,
    COUNT(wd.*) AS attempts,
    AVG(CASE WHEN wd.status = 'delivered' THEN 1.0 ELSE 0.0 END) AS success_rate,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (wd.delivered_at - wd.queued_at))) AS p99_sec
FROM webhook_subscriptions ws
JOIN webhook_deliveries wd ON wd.webhook_id = ws.id
WHERE wd.attempted_at > '2026-05-27'
GROUP BY ws.url
ORDER BY attempts DESC;
```

- [ ] **Step 3**: Write report

Create `docs/operations/webhook-dogfood-2026-06-03.md`:

```markdown
# Webhook Dogfood Report — 2026-06-03

**Window**: 2026-05-27 → 2026-06-03 (7 days)
**Purpose**: AC78 gate for Trust Layer v0.1.0 deploy

## Summary

| Metric | Value | Target | Status |
|---|---|---|---|
| Total delivery attempts | TBD | — | — |
| 2xx delivery rate | TBD% | ≥ 99% | TBD |
| Failed final | TBD | — | — |
| Dead-letter rows | TBD | — | — |
| p50 latency (s) | TBD | — | — |
| p95 latency (s) | TBD | ≤ 5s | TBD |
| p99 latency (s) | TBD | ≤ 5s | TBD |

## Per-receiver breakdown

| URL | Attempts | Success rate | p99 (s) |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

## Verdict

[PASS — meets AC78, Trust Layer deploy gate satisfied]
[OR FAIL — items to address before retry: ...]
```

- [ ] **Step 4**: Commit + push report

```bash
git add docs/operations/webhook-dogfood-2026-06-03.md
git commit -m "$(cat <<'EOF'
docs(ops): webhook dogfood report 2026-06-03

Closes AC78 gate. [PASS/FAIL] verdict with metrics.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 0.5 — Calibration v1 report + launch verdict (target 2026-06-10)

**Files**: `docs/CALIBRATION-v1.md` (update — existing file)
**Why**: AC77 — final gate for Trust Layer deploy.

- [ ] **Step 1**: Query per-asset calibration statistics

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" <<'SQL'
SELECT
    asset,
    COUNT(*) AS samples,
    (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(discount_raw)) * 10000)::int AS p50_bps,
    (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ABS(discount_raw)) * 10000)::int AS p95_bps,
    (PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ABS(discount_raw)) * 10000)::int AS p99_bps
FROM discount_snapshots
WHERE ts > '2026-05-27'
GROUP BY asset
ORDER BY asset;
SQL
```

- [ ] **Step 2**: Classify alerts emitted during window

```sql
SELECT
    asset,
    from_state || ' → ' || to_state AS transition,
    COUNT(*) AS count
FROM alerts
WHERE detected_at > '2026-05-27'
GROUP BY asset, transition
ORDER BY count DESC;
```

For each transition, classify as `actionable | noisy | false_positive | source_outage` (per CALIBRATION-v1.md classification rules).

- [ ] **Step 3**: Update CALIBRATION-v1.md

Fill in all the `TBD` rows in the per-asset table:

```markdown
| Asset | Class | Samples | p50 bps | p95 bps | p99 bps | Current drift/depeg/critical | Proposed change | Notes |
|---|---|---:|---:|---:|---:|---|---|---|
| jitoSOL | LST | 247,832 | 12 | 34 | 47 | 45 / 110 / 250 | none | tight, well-calibrated |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |
```

Fill summary table:

```markdown
| Metric | Result |
|---|---|
| Assets observed | 21 (active) + 5 (Phase 0 passive) |
| Total alerts | TBD |
| Actionable alerts | TBD |
| False-positive alerts | TBD |
| Worst noisy asset | TBD |
| Threshold changes required | TBD |
| Launch verdict | **SHIP** / **TUNE** / **EXTEND** |
```

- [ ] **Step 4**: Decide launch verdict

Per spec `../01-business-rules.md § 5. Deploy gate`:

- **SHIP**: all assets have enough samples for p95/p99; no severe false-positive pattern; threshold changes either committed or explicitly deferred → **Phase 13 deploy proceeds 06-11**
- **TUNE**: thresholds need adjustment; commit `assets.toml` changes; run 7-day mini-calibration → **slip to 06-17 minimum**
- **EXTEND**: insufficient data or major issues found; restart 14-day window → **slip to 06-24 minimum**

- [ ] **Step 5**: If SHIP — proceed; if TUNE — apply threshold changes

If TUNE: edit `assets.toml` per-asset threshold deltas, commit, run another 7-day mini-calibration.

```bash
git add assets.toml
git commit -m "feat(assets): calibrate thresholds after v1 dogfood (asset X: drift Y→Z)"
```

- [ ] **Step 6**: Commit report

```bash
git add docs/CALIBRATION-v1.md
git commit -m "$(cat <<'EOF'
docs(calibration): v1 report — verdict SHIP / TUNE / EXTEND

[Verdict rationale]. Threshold changes [applied to assets.toml / deferred].
Trust Layer deploy [proceeds 06-11 / slips to YYYY-MM-DD].

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 0

- [ ] AC77 — Calibration v1 report committed with all TBD filled
- [ ] AC78 — Webhook dogfood report shows delivery rate ≥ 99%, p99 ≤ 5s
- [ ] AC79 — 5 new assets have at least 7 days of calibration data in `discount_snapshots`
- [ ] AC80 — `alert_events` view confirmed on prod (or migration 0029 applied)
- [ ] AC81 — `assets.toml` contains 28 entries (verified by `cargo test -p pegana-common --lib`)
- [ ] AC82 — All 5 new mints verified by `verify-assets` CI job
- [ ] AC83 — Per-asset Pyth feeds documented or fallback specified
- [ ] AC84 — `assets_toml_parses` test passes with new floor
- [ ] AC85 — Phase 13 task ready to flip new assets to `active=true`

---

## Cross-references

- For the asset list rationale, see `../03-asset-coverage.md`.
- For deploy gate logic, see `../01-business-rules.md § 5. Deploy gate`.
- For calibration philosophy, see `../03-asset-coverage.md § Threshold calibration philosophy`.
- For Phase 13 deploy steps that consume Phase 0 outputs, see `13-phase-13-deploy-outreach.md`.
