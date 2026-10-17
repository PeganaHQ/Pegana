# Sprint 2026-05-29 — Final execution runbook

> Use this runbook to close the last 2 fases of the audit quality-lift
> sprint. Order: **Exercise #101 first, then deploy.**
>
> Total time: ~2h with margin (90 min exercise + 30 min deploy + smoke).

---

## Phase A — Exercise issue #101 (Run 1 + Run 2)

Per [ADR-0017](../adr/0017-pre-evidence-threshold-exercise.md). Hard
deadline: **2026-05-31 23:59 UTC** (end of pre-evidence sub-window).

### A.0 — Pre-flight on Hetzner

```bash
ssh ${PEGANA_DEPLOY_SERVER}
cd /opt/pegana

# Assert safe state
grep "^FEATURE_PUBLIC_ALERTS=" .env
# expected: FEATURE_PUBLIC_ALERTS=false  (alerts route to dogfood TG, not subscribers)

docker compose ps engine
# expected: pegana-engine ... Up X minutes (healthy)

# Capture baseline assets.toml epoch hash (this will be the pre/post baseline)
sha256sum assets.toml | cut -d' ' -f1 > /tmp/pre-epoch.sha
cat /tmp/pre-epoch.sha
# save this value — it appears as `assets_toml_sha256` in alert_evidence
# for any row produced before Run 1
```

### A.1 — Run 1: drift path (Pegged → Drift, no on-chain commit)

Edits USDC's `drift` threshold from 20 to 1 bp. Holds 90 s, then reverts.

```bash
# Backup current assets.toml
cp assets.toml assets.toml.run1-backup

# Tighten USDC drift to 1 bp.
# NOTE: assets.toml uses aligned `key = value` formatting. The sed below
# targets the USDC [thresholds] block specifically by anchoring to its
# surrounding context. Verify the change before restart.
awk '
  /^\[asset\.USDC/ { in_usdc=1 }
  /^\[asset\./ && !/^\[asset\.USDC/ { in_usdc=0 }
  in_usdc && /^drift\s*=\s*20/ { sub(/= 20/, "= 1") }
  { print }
' assets.toml.run1-backup > assets.toml

# Verify exactly one line changed
diff assets.toml.run1-backup assets.toml
# expected: one < / > pair showing drift = 20 vs drift = 1

# Restart engine so it picks up the new threshold
docker compose restart engine
sleep 8  # engine boot + hydrate

# Wait for the transition to mature (30s confirm_up_secs + margin)
sleep 90

# Capture the alert_id produced during this window
ALERT_1=$(docker compose exec -T postgres psql -U pegana -tAc "
  SELECT alert_id FROM alert_evidence
  WHERE created_at > now() - interval '3 minutes'
  ORDER BY created_at DESC LIMIT 1;
")
echo "Run 1 alert_id: $ALERT_1"

# REVERT immediately
cp assets.toml.run1-backup assets.toml
rm assets.toml.run1-backup
docker compose restart engine
sleep 8

# Quick sanity: assets.toml back to baseline
sha256sum assets.toml | cut -d' ' -f1
# must match /tmp/pre-epoch.sha
```

### A.2 — Run 1 gates (5 SQL checks)

```bash
docker compose exec -T postgres psql -U pegana <<EOF
-- Gate 1: alert_evidence row exists with full payload
SELECT alert_id, methodology_version, length(receipt_sha256) AS sha_len,
       commit_status, inputs_frozen IS NOT NULL AS has_inputs,
       computed IS NOT NULL AS has_computed
  FROM alert_evidence
 WHERE alert_id = '$ALERT_1';
-- expected: sha_len=64, commit_status='not_applicable', has_inputs=t, has_computed=t

-- Gate 2: nothing pending
SELECT count(*) FROM alert_evidence_pending WHERE alert_id = '$ALERT_1';
-- expected: 0

-- Gate 3: no commit failures
SELECT count(*) FROM alert_evidence_commit_failures WHERE alert_id = '$ALERT_1';
-- expected: 0
EOF

# Gate 4: /v1/audit/<id> returns 200 with full payload
curl -sS "https://api.pegana.xyz/v1/audit/$ALERT_1" \
  | jq '{receipt_sha256, methodology_version, commit_status, evidence_status}'

# Gate 5: pegana-replay verifies offline
pegana-replay --alert-id $ALERT_1
# expected: PASS  USDC  PEGGED → DRIFT  @ <timestamp>
```

Mark Run 1 gates in `docs/operations/issue-101-exercise-log.md`.

### A.3 — Run 2: on-chain commit path (Drift/Pegged → Depeg)

**Wait ≥1 hour after Run 1** to give EWMA + hysteresis headroom.

```bash
# Backup current (should match pre-epoch baseline)
cp assets.toml assets.toml.run2-backup

# Tighten USDC depeg to 2 bp (drift stays at 20)
awk '
  /^\[asset\.USDC/ { in_usdc=1 }
  /^\[asset\./ && !/^\[asset\.USDC/ { in_usdc=0 }
  in_usdc && /^depeg\s*=\s*100/ { sub(/= 100/, "= 2") }
  { print }
' assets.toml.run2-backup > assets.toml

diff assets.toml.run2-backup assets.toml
# expected: single change depeg = 100 → depeg = 2

docker compose restart engine
sleep 8
sleep 90  # confirm_up + margin

ALERT_2=$(docker compose exec -T postgres psql -U pegana -tAc "
  SELECT alert_id FROM alert_evidence
  WHERE created_at > now() - interval '3 minutes'
    AND alert_id != '$ALERT_1'
  ORDER BY created_at DESC LIMIT 1;
")
echo "Run 2 alert_id: $ALERT_2"

# Wait for the on-chain commit task to complete (≤30 s typical)
sleep 45

TX_SIG=$(docker compose exec -T postgres psql -U pegana -tAc "
  SELECT onchain_tx_sig FROM alert_evidence WHERE alert_id = '$ALERT_2';
")
echo "Run 2 tx_sig: $TX_SIG"
echo "Solscan: https://solscan.io/tx/$TX_SIG"

# REVERT
cp assets.toml.run2-backup assets.toml
rm assets.toml.run2-backup
docker compose restart engine
sleep 8

# Sanity baseline
sha256sum assets.toml | cut -d' ' -f1
# must match /tmp/pre-epoch.sha
```

### A.4 — Run 2 gates

```bash
docker compose exec -T postgres psql -U pegana <<EOF
-- Gate 1: committed + tx_sig present
SELECT alert_id, commit_status, onchain_tx_sig IS NOT NULL AS has_sig,
       length(receipt_sha256) AS sha_len
  FROM alert_evidence
 WHERE alert_id = '$ALERT_2';
-- expected: commit_status='committed', has_sig=t, sha_len=64

-- Gate 2: no commit failures
SELECT count(*) FROM alert_evidence_commit_failures WHERE alert_id = '$ALERT_2';
-- expected: 0
EOF

# Gate 3: Solscan resolves
curl -sS -o /dev/null -w "%{http_code}\n" "https://solscan.io/tx/$TX_SIG"
# expected: 200

# Gate 4: /v1/audit/<id> exposes onchain_tx_sig
curl -sS "https://api.pegana.xyz/v1/audit/$ALERT_2" \
  | jq '.onchain_tx_sig, .commit_status'

# Gate 5: replay --verify-onchain
pegana-replay --alert-id $ALERT_2 --verify-onchain
# expected: PASS  USDC  *  →  DEPEG  @ <ts>
#           onchain anchor verified: <TX_SIG>
```

### A.5 — Fill the log + close issue #101

Edit `docs/operations/issue-101-exercise-log.md` on your laptop:
- Replace `_TBD_` with the values captured above
- Tick the gate checkboxes that passed
- Commit with `docs(ops): fill issue #101 exercise log with prod values`

```bash
gh issue close 101 --comment "Closed via ADR-0017 exercise. Run 1: $ALERT_1 (drift path, evidence ready). Run 2: $ALERT_2 (depeg + on-chain commit, solscan.io/tx/$TX_SIG). See docs/operations/issue-101-exercise-log.md."
```

---

## Phase B — Deploy the sprint to prod

### B.0 — Pre-deploy

```bash
ssh ${PEGANA_DEPLOY_SERVER}
cd /opt/pegana

# Sync latest main (the sprint branch must be merged to main first)
git fetch origin
git log HEAD..origin/main --oneline   # expected: 11 sprint commits

# Run the existing pre-deploy gauntlet
./scripts/pre-deploy-check.sh
# fix anything red before proceeding
```

### B.1 — Deploy

```bash
git pull origin main
./scripts/deploy.sh
```

`deploy.sh` already handles `docker compose up -d --build` with the
right ordering and waits for `healthcheck`.

### B.2 — Smoke (15 min watch window)

```bash
# 1. AC42 — server-side state filter
curl -sS "https://api.pegana.xyz/v1/audit?state=DRIFT&limit=5" | jq 'length'
curl -sS "https://api.pegana.xyz/v1/audit?state=GARBAGE" | jq '.error'
# expected: 5 (or fewer if few DRIFT alerts); "invalid_state"

# 2. CAT-G — discount_raw exposed
curl -sS "https://api.pegana.xyz/v1/assets/USDC/history?bucket=raw&limit=3" \
  | jq '.[0] | keys'
# expected: array containing both "discount" and "discount_raw"

# 3. CAT-B — audit detail badge renders correct color
# (eye-check) open https://pegana.xyz/audit/$ALERT_2 — to_state badge color
# matches DEPEG palette, not DRIFT

# 4. CAT-H — asset chart raw+smoothed
# (eye-check) open https://pegana.xyz/asset/USDC — switch to LINE mode,
# hover over chart — tooltip shows both "smoothed +X" and "raw +Y" lines

# 5. Receipt for $ALERT_2 still resolves
curl -sS "https://api.pegana.xyz/v1/audit/$ALERT_2" | jq '.evidence_status'
# expected: "ready"

# 6. Sentry — zero new error events in 30 min after deploy
#    (check https://sentry.io/organizations/pegana-prod/issues/)

# 7. Grafana — engine_state_snapshot counter exists
#    (check grafana.pegana.xyz — search for pegana_state_snapshot_failed_total)
```

### B.3 — Outreach update (skipped per session pivot)

The original sprint plan included updating 4 outreach drafts with
`$ALERT_2` UUID. Per the 2026-05-29 pivot ("foco em aprimorar e
encontrar bugs, não outreach"), this step is skipped. The UUIDs remain
available for future use.

---

## Rollback (if anything goes wrong)

```bash
# Phase A rollback — restore assets.toml from backup (already automated
# above; manual fallback if a step crashed mid-way):
cd /opt/pegana
git checkout HEAD -- assets.toml
docker compose restart engine

# Phase B rollback — back to pre-deploy tag
# (deploy.sh writes a `pre-deploy-2026-05-29` tag automatically)
git checkout pre-deploy-2026-05-29
./scripts/deploy.sh
```

---

## DoD final after both phases

- [ ] Issue #101 closed with 2 real alert_ids + 1 solscan.io URL
- [ ] `assets.toml` SHA equals `/tmp/pre-epoch.sha` (no permanent drift)
- [ ] All 11 sprint commits live in prod
- [ ] All 7 smoke checks above pass
- [ ] Sentry quiet for 30 min after deploy
- [ ] `feat/deploy-script-hardened` branch can be deleted from origin
