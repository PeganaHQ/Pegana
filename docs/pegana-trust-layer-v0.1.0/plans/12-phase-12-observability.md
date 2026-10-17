> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 12 — Observability + Trust Strip + Launch Artifacts

**Spec reference**: `../11-observability.md`
**Acceptance criteria covered**: AC74-AC76 (observability), AC86-AC88 (trust strip + launch copy)
**Dependencies**: Phase 11M (new metrics emitted from on-chain commit)
**Estimated duration**: 1 day

---

## Task 12.1 — Verify Prometheus counters/histograms (validation, not new code)

**NOTE**: Counters/histograms were instrumented in their respective phases:
- `pegana_audit_persist_total{outcome}` + `pegana_audit_persist_seconds` — added in Phase 3 Task 3.5
- `pegana_engine_methodology_broken_total` — added in Phase 3 Task 3.5
- `pegana_onchain_commit_total{outcome}` — added in Phase 11M.1
- `pegana_commit_wallet_balance_sol` — added in Phase 11M.1

This task just verifies they're exported correctly.

- [ ] **Step 1**: Check `/metrics` endpoint exposes them

```bash
ssh ${PEGANA_DEPLOY_SERVER}
docker compose exec engine curl http://localhost:9091/metrics | grep -E "pegana_(audit|onchain|methodology|commit)"
```

Expected: all 5 new metrics present.

- [ ] **Step 2**: Document in operations doc

Append to `docs/operations/observability.md` (or create):

```markdown
## Trust Layer metrics (added v0.1.0)

| Metric | Type | Source | Purpose |
|---|---|---|---|
| pegana_audit_persist_total{outcome} | counter | engine push_alert | Every audit row insert (ok|failed) |
| pegana_audit_persist_seconds | histogram | engine push_alert | Insert latency (target < 50ms p99) |
| pegana_engine_methodology_broken_total | counter | engine startup | Refused to start due to broken version |
| pegana_onchain_commit_total{outcome} | counter | onchain_commit | SAS commit attempts (ok|rpc_error|timeout) |
| pegana_commit_wallet_balance_sol | gauge | engine startup + periodic | Wallet balance for alerting |
```

- [ ] **Step 3**: Commit

```bash
git add docs/operations/observability.md
git commit -m "docs(ops): Trust Layer metrics catalog

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12.2 — Add Grafana panels for new metrics

**Files**: Modify `ops/grafana/dashboard.json`

- [ ] **Step 1**: Add 4 new panels to dashboard JSON

(Calibration panel for Phase 0 assets was added in Phase 0 Task 0.3.)

Add to `ops/grafana/dashboard.json` `panels[]`:

```json
{
  "id": 200,
  "type": "timeseries",
  "title": "Audit persist failure rate (5m)",
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 60 },
  "targets": [{
    "expr": "rate(pegana_audit_persist_total{outcome=\"failed\"}[5m])",
    "legendFormat": "failures/s",
    "refId": "A"
  }],
  "fieldConfig": {
    "defaults": {
      "thresholds": { "mode": "absolute", "steps": [
        { "value": null, "color": "green" },
        { "value": 0.01, "color": "red" }
      ] }
    }
  }
},
{
  "id": 201,
  "type": "timeseries",
  "title": "Audit persist p99 latency",
  "gridPos": { "h": 8, "w": 12, "x": 12, "y": 60 },
  "targets": [{
    "expr": "histogram_quantile(0.99, sum(rate(pegana_audit_persist_seconds_bucket[5m])) by (le))",
    "legendFormat": "p99",
    "refId": "A"
  }],
  "fieldConfig": { "defaults": { "unit": "s" } }
},
{
  "id": 202,
  "type": "timeseries",
  "title": "On-chain commit success rate (5m)",
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 68 },
  "targets": [{
    "expr": "sum(rate(pegana_onchain_commit_total{outcome=\"ok\"}[5m])) / sum(rate(pegana_onchain_commit_total[5m]))",
    "legendFormat": "success ratio",
    "refId": "A"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "percentunit",
      "thresholds": { "mode": "absolute", "steps": [
        { "value": null, "color": "red" },
        { "value": 0.95, "color": "green" }
      ] }
    }
  }
},
{
  "id": 203,
  "type": "stat",
  "title": "Engine wallet balance",
  "gridPos": { "h": 4, "w": 12, "x": 12, "y": 68 },
  "targets": [{
    "expr": "pegana_commit_wallet_balance_sol",
    "refId": "A"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "none",
      "thresholds": { "mode": "absolute", "steps": [
        { "value": null, "color": "red" },
        { "value": 0.5, "color": "yellow" },
        { "value": 2.0, "color": "green" }
      ] }
    }
  }
}
```

- [ ] **Step 2**: Reload Grafana

```bash
ssh ${PEGANA_DEPLOY_SERVER}
docker compose restart grafana
# Visit dashboard, verify 4 new panels render
```

- [ ] **Step 3**: Alert rules

In `ops/alerts/pegana.yml` append:

```yaml
- alert: PeganaAuditPersistFailing
  expr: rate(pegana_audit_persist_total{outcome="failed"}[5m]) > 0
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "Audit row insert is failing — alerts shipping without evidence"
    runbook: "Investigate via Sentry; alert_evidence is non-blocking for dispatch but receipts will return evidence_missing on /v1/audit/<id>."

- alert: PeganaOnchainCommitDegraded
  expr: |
    sum(rate(pegana_onchain_commit_total{outcome="ok"}[30m]))
    / sum(rate(pegana_onchain_commit_total[30m])) < 0.80
  for: 30m
  labels: { severity: warning }
  annotations:
    summary: "On-chain SAS commit success rate dropped below 80%"
    runbook: "Check Solana RPC endpoint health + wallet balance gauge."

- alert: PeganaCommitWalletLow
  expr: pegana_commit_wallet_balance_sol < 0.5
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "Engine SAS wallet balance below 0.5 SOL"
    runbook: "Refund wallet from treasury keypair. ~$5 SOL covers 10 years at current rates."
```

- [ ] **Step 4**: Commit

```bash
git add ops/grafana/dashboard.json ops/alerts/pegana.yml
git commit -m "$(cat <<'EOF'
chore(observability): Trust Layer Grafana panels + alert rules

4 new panels (audit failure rate, audit p99 latency, on-chain commit
success rate, wallet balance). 3 new Prometheus alert rules with
runbook annotations.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12.3 — Trust strip on home page (NEW from strategic P0)

**Files**:
- Create or modify: `web/lib/hooks/useStats.ts`
- Modify: `web/app/(marketing)/page.tsx`

- [ ] **Step 1**: Verify `assets_in_drift` field exists in API response

```bash
curl https://api.pegana.xyz/v1/stats | jq '.assets_in_drift'
```

Expected: integer. (Added in previous session per existing commits — see `crates/api-rs/src/routes/stats.rs::StatsResponse`.)

- [ ] **Step 2**: Create or update `useStats` hook

If `web/lib/hooks/useStats.ts` doesn't exist:

```tsx
// web/lib/hooks/useStats.ts
import useSWR from "swr";
import type { StatsResponse } from "@/lib/api/types";

const API_BASE = process.env.NEXT_PUBLIC_PEGANA_API ?? "https://api.pegana.xyz";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useStats() {
  const { data, error, isLoading } = useSWR<StatsResponse>(
    `${API_BASE}/v1/stats`,
    fetcher,
    { refreshInterval: 30_000 },
  );
  return { stats: data, error, isLoading };
}
```

- [ ] **Step 3**: Add trust strip to home page

In `web/app/(marketing)/page.tsx`, near the top of the JSX (above or below the hero section depending on existing layout):

```tsx
"use client";
import { useStats } from "@/lib/hooks/useStats";

// ... existing imports ...

function TrustStrip() {
  const { stats } = useStats();
  const driftCount = stats?.assets_in_drift ?? 0;
  return (
    <div className="border-y border-zinc-200 bg-zinc-50 py-3">
      <div className="mx-auto max-w-7xl px-4 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold text-amber-600">{driftCount}</span>
          {" "}
          <span className="text-zinc-600">
            {driftCount === 1 ? "asset" : "assets"} in DRIFT right now
          </span>
        </div>
        <a className="text-sm underline" href="/audit">view live audits →</a>
      </div>
    </div>
  );
}

// In the page component, render <TrustStrip /> in appropriate position
```

If page is a server component, refactor TrustStrip into its own client component file at `web/components/trust-strip.tsx` and import it.

- [ ] **Step 4**: Smoke test

Visit homepage. Trust strip should render with live count (typically 0 unless something is actively drifting).

- [ ] **Step 5**: Commit

```bash
git add web/lib/hooks/useStats.ts web/app/\(marketing\)/page.tsx web/components/trust-strip.tsx
git commit -m "$(cat <<'EOF'
feat(web): trust strip on home with live assets_in_drift count

Surfaces existing /v1/stats.assets_in_drift field (added in previous
session). SWR refresh 30s. Links to /audit index. Lightweight signal
of product activity without a full dashboard rebuild.

Per strategic P0 from prior session — replaces "static trust numbers"
with live data.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12.4 — Update launch artifacts (asset count) (NEW from strategic P0)

**Files**: search-and-replace across web copy

- [ ] **Step 1**: Find stale references

```bash
grep -rn "22 assets\|23 assets\|24 assets\|22 ativos\|23 ativos" \
  web/app/ web/components/ docs-site/ README.md \
  crates/api-rs/src/openapi.rs bot-ts/locales/ \
  2>/dev/null
```

Known stale references to fix:
- `crates/api-rs/src/openapi.rs` info description: "Read real-time peg state ... across **23 active mainnet assets**" → must update to "26 active mainnet assets"
- `bot-ts/locales/*.ftl` welcome message: "I watch **23 Solana LSTs and stablecoins**" → "26"
- Marketing copy in `web/app/(marketing)/page.tsx` and similar
- `README.md` at repo root if it mentions asset count

- [ ] **Step 2**: Update to "26 active assets" (post-launch count)

Replace each occurrence with appropriate copy based on context. Examples:

- `crates/api-rs/src/openapi.rs` info().description: `"... across 26 active mainnet assets (LSTs, stablecoins, yield-bearing, CDPs, synthetics) ..."`
- Home hero: "Watching 26 Solana stablecoins and LSTs 24/7"
- Methodology page: "currently monitoring 26 active assets"
- Bot welcome: "I watch 26 Solana LSTs and stablecoins"
- README: "Coverage: 26 active assets (Phase 0 added 5 new in calibration)"

NOTE: at deploy time, the actual count is 26 (21 existing + 5 Phase 0 assets that flip to active). Update only after Phase 13 Task 13.2 flips assets to active=true.

- [ ] **Step 3**: One-liner methodology copy

Ensure the line "Oracle/intrinsic + executable market quote = spread" appears on:
- Home hero subtitle
- `/methodology` What this is section (already done in Phase 11.4)
- Bot `/help` command (optional — keep brief in current format)

- [ ] **Step 4**: Commit (one commit per file or atomic across copy files)

```bash
git add <modified files>
git commit -m "$(cat <<'EOF'
chore(copy): update asset count to 26 + methodology one-liner

Removes stale "22/23/24 assets" references after Phase 0 + launch.
"Oracle/intrinsic + executable market quote = spread" added to home
hero subtitle and methodology page.

Per strategic P0 — fixes the credibility gap of inconsistent numbers
across launch artifacts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12.5 — Public demo video/post script (NEW from strategic P0)

**Files**: Create `docs/marketing/launch-demo-script.md`

- [ ] **Step 1**: Draft demo script

Write `docs/marketing/launch-demo-script.md`:

```markdown
# Trust Layer launch demo script

## Format: 60-second screen recording

### Scene 1: Live drift count (5s)
- Open https://pegana.xyz
- Zoom on trust strip: "X assets in DRIFT right now"
- Click "view live audits →"

### Scene 2: /audit index (10s)
- Show table of last 50 alerts
- Hover over a CRITICAL alert (red badge)
- Click into it

### Scene 3: /audit/[id] receipt page (15s)
- Show 6 sections: header, inputs, computed, methodology, replay, on-chain
- Highlight: "Receipt sha256 anchored on Solana"
- Click on-chain tx link → Solscan opens, transaction confirmed

### Scene 4: CLI verify (20s)
- Terminal: `curl ... pegana-replay-installer.sh | sh`
- `pegana-replay --alert-id <UUID>`
- Output: `✓ PASS  USDe  PEGGED → CRITICAL  @ 2026-06-12T14:33:12Z`
- `pegana-replay --alert-id <UUID> --verify-onchain`
- Output: `✓ PASS ... on-chain tx 5abc...xyz verified on Solscan`

### Scene 5: Tweet copy (10s) — overlay
> "Every Pegana alert is verifiable offline + on-chain.
> Methodology in open source. Replay CLI in one curl.
> The risk oracle Solana DeFi deserves.
> pegana.xyz/methodology"

## Distribution

- Twitter (Pegana account) — post with video
- Farcaster — same
- Tag: Solana ecosystem (Helius, Jupiter, Kamino) for amplification
```

- [ ] **Step 2**: Commit

```bash
git add docs/marketing/launch-demo-script.md
git commit -m "$(cat <<'EOF'
docs(marketing): launch demo video script (60s)

5-scene script for Trust Layer launch on Twitter/Farcaster.
Shows live drift count → audit page → on-chain anchor → CLI verify.
Visual proof of "verifiable infrastructure" claim.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 12

- [ ] AC74 — 5 new Prometheus metrics exported on `/metrics`
- [ ] AC75 — Grafana dashboard has 4 new panels + 3 new alert rules
- [ ] AC76 — Sentry captures new error categories
- [ ] AC86 — Home shows live `assets_in_drift` count from `/v1/stats`
- [ ] AC87 — Asset count "26 active" reflected in homepage, methodology, README, bot copy
- [ ] AC88 — Methodology one-liner present on home hero + /methodology page

---

## Cross-references

- For observability spec, see `../11-observability.md`.
- For Phase 13 deploy that activates everything, see `13-phase-13-deploy-outreach.md`.
