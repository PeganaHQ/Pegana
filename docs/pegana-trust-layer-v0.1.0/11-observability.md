> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 11 — Observability

> Prometheus metrics + Grafana dashboard panels + Sentry integration + SLOs for the Trust Layer changes. Existing infrastructure extended additively.

---

## 1. Existing baseline (do not change)

Pegana already has:
- **Prometheus**: container in `docker-compose.yml`, config at `ops/prometheus/prometheus.yml`, scrapes indexer/engine/api/dispatcher/mcp-ts on ports 9090-9093 + 8090
- **Grafana**: container in compose, dashboard at `ops/grafana/dashboard.json` (UID `pegana-overview`, "Pegana — Live Pipeline Overview")
- **Alert rules**: `ops/alerts/pegana.yml` (Prometheus alerting)
- **Sentry**: wired in all Rust services via `crates/common/src/observability.rs::init_sentry`; bot via `@sentry/node`; mcp via `@sentry/node`

Trust Layer adds NEW metrics + NEW panels. Does not touch existing infrastructure.

---

## 2. New Prometheus metrics (5)

All exported on the existing `/metrics` HTTP endpoint of each service.

### From `engine-rs`

| Metric | Type | Labels | What it measures |
|---|---|---|---|
| `pegana_audit_persist_total` | counter | `outcome=ok|failed` | Every `alert_evidence` INSERT attempt |
| `pegana_audit_persist_seconds` | histogram | (none) | Latency of `alert_evidence` INSERT |
| `pegana_engine_methodology_broken_total` | counter | (none) | Engine startup detected broken version (and refused to start) |
| `pegana_onchain_commit_total` | counter | `outcome=ok|rpc_error|timeout` | Async SAS commit attempts |
| `pegana_commit_wallet_balance_sol` | gauge | (none) | Current engine wallet SOL balance |

### Existing metrics still used (for context)

- `pegana_alerts_emitted_total{class, transition}` — counter (existing)
- `pegana_engine_recompute_seconds{asset}` — histogram (existing)
- `pegana_engine_pyth_stale_total{feed}` — counter (existing)
- `pegana_engine_publishes_total{kind}` — counter (existing)

---

## 3. New Grafana panels

Add to `ops/grafana/dashboard.json` (existing dashboard `pegana-overview`):

### Panel A: Audit persist failure rate

- **Title**: "Audit persist failure rate"
- **Query**: `rate(pegana_audit_persist_total{outcome="failed"}[5m])`
- **Visualization**: time series
- **Alert**: pages oncall via Sentry/PagerDuty if `> 0` for 5 minutes
- **Why this matters**: every failure = an alert with no audit row = `/v1/audit/<id>` returns `evidence_missing`. Operational quality signal.

### Panel B: Audit persist latency (p99)

- **Title**: "Audit persist p99 latency"
- **Query**: `histogram_quantile(0.99, sum(rate(pegana_audit_persist_seconds_bucket[5m])) by (le))`
- **Visualization**: time series
- **Alert**: warns if `> 100ms` (the inline INSERT should be ~10ms)
- **Why this matters**: if persist is slow, alert dispatch is delayed (audit blocks Redis xadd in sequence — actually no, it doesn't per spec `06-engine-changes.md`, but the engine event loop is affected)

### Panel C: On-chain commit success rate

- **Title**: "SAS on-chain commit success rate (5m)"
- **Query**: `sum(rate(pegana_onchain_commit_total{outcome="ok"}[5m])) / sum(rate(pegana_onchain_commit_total[5m]))`
- **Visualization**: time series + threshold line at 95%
- **Alert**: pages if < 80% for 30 minutes
- **Why this matters**: if SAS commits start failing (RPC issues, wallet drained), receipt anchoring breaks. Audit page shows `not_committed_yet` longer than expected.

### Panel D: Engine wallet balance

- **Title**: "Engine SAS wallet balance (SOL)"
- **Query**: `pegana_commit_wallet_balance_sol`
- **Visualization**: stat with sparkline
- **Alert**: pages if `< 0.5 SOL`
- **Why this matters**: wallet runs out → all SAS commits fail. Operator refills (~$5 SOL covers 10 years).

### Panel E (NEW for Phase 0): Calibration p99 for new assets

- **Title**: "Calibration — Phase 0 assets p99 |discount|"
- **Query**:
  ```promql
  histogram_quantile(0.99, 
    sum(rate(pegana_engine_discount_raw_bucket{asset=~"JupUSD|JLP|EURC|dzSOL|vSOL"}[1h])) 
    by (asset, le)
  )
  ```
- **Visualization**: time series, one line per asset
- **Use**: daily eyeball check during 14-day calibration window. If p99 stays comfortably below configured `drift` threshold → asset is ready to activate.

---

## 4. Sentry integration

Existing pattern (per `crates/common/src/observability.rs::init_sentry`):
- DSN from `SENTRY_DSN` env
- `server_name` tag = service name (`engine`, `api`, `dispatcher`, etc.)
- `release` tag = git SHA (set via `SENTRY_RELEASE` env in Docker build)
- `environment` = `production` / `staging` from `SENTRY_ENVIRONMENT`

**New error categories surfaced to Sentry** (via `tracing::error!` macro, captured by Sentry tracing integration):

- `alert_evidence insert FAILED` — when `alert_evidence` INSERT errors
- `methodology version marked BROKEN — refusing to start` — engine startup failure
- `onchain commit failed` — SAS commit RPC error
- `onchain commit timeout` — SAS commit took > 60s
- `failed to persist onchain_tx_sig` — `UPDATE alert_evidence` failed after successful SAS commit
- `assets canonical hash failed` / `receipt canonical hash failed` — canonical hash computation errors (should never happen — input is from trusted source)

Sentry releases auto-tagged via the Docker build arg `SENTRY_RELEASE=$(git rev-parse HEAD)`. Stack traces auto-attached. PII NOT sent (`send_default_pii: false`).

---

## 5. Log levels + format

All Rust services use `tracing` crate with JSON formatter (existing). Filter from `RUST_LOG` env or default `info,sqlx=warn`.

**Trust Layer adds NEW log lines** at these levels:

- `info`: methodology validated; ALERT emitted (with `evidence_sha256` field); receipt committed on-chain; wallet OK
- `warn`: wallet balance low; methodology version not in DB (auto-inserting); alert_events view missing (rare, pre-flight should catch)
- `error`: alert_evidence INSERT failed; methodology broken; onchain commit failed/timeout; sig persist failed

All logs structured via `tracing::Field` syntax for grep-ability:
```rust
error!(alert_id = %event.id, ?e, "alert_evidence insert FAILED — alert continues");
```

---

## 6. SLO definitions

Trust Layer has 3 SLOs measurable via the new metrics:

| SLO | Target | Window | How measured |
|---|---|---|---|
| **Audit persistence** | ≥ 99.9% of alerts have matching evidence row | 30 days rolling | `pegana_audit_persist_total{outcome="ok"} / pegana_alerts_emitted_total` |
| **On-chain commitment** | ≥ 95% of critical alerts get `onchain_tx_sig` within 5 minutes | 30 days rolling | Query `alert_evidence` for critical alerts older than 5min where `onchain_tx_sig IS NULL` |
| **Audit endpoint availability** | ≥ 99.9% of `/v1/audit/:id` requests return non-5xx | 30 days rolling | API Prometheus / Caddy log analysis |

SLO violations are NOT automatic alerts (would page too often during early operation). Reviewed weekly. Surfaced on `/methodology#operational-history` page (optional, future).

---

## 7. Health endpoints (no change)

Existing `/healthz` (port 9095 for engine) and per-service health checks remain. Trust Layer changes do not add new health-check endpoints — the new metrics ARE the health signal.

Docker compose `healthcheck:` directives unchanged.

---

## 8. Observability for Phase 0 calibration

During the 14-day calibration window (2026-05-27 → 2026-06-10), the operator monitors:

1. **Panel E above**: p99 for new assets stays below thresholds → asset ready
2. `pegana_alerts_emitted_total{asset=~"JupUSD|JLP|EURC|dzSOL|vSOL"}` — should be near-zero during dogfood (active=false means no alerts dispatched, but the engine processes data)
3. `pegana_engine_pyth_stale_total{feed=~"<new asset feeds>"}` — should stay near-zero; spikes indicate Pyth feed issues
4. `pegana_engine_recompute_seconds{asset=~"<new assets>"}` — should be similar latency to existing assets

End of calibration: operator writes per-asset row into `docs/CALIBRATION-v1.md` with measured p50/p95/p99. See `plans/01-phase-0-preflight.md § Task 0.5`.

---

## 9. Test plan

- Synthetic load: send 1000 alerts in 60s, verify `pegana_audit_persist_total{outcome="ok"}` increments to 1000.
- Trigger persist failure (e.g., drop `alert_evidence` table on staging mid-test): verify counter goes to `failed`, alert is still dispatched.
- Force broken methodology: `UPDATE methodology_versions SET status='broken' WHERE version='0.1.0';`, restart engine, verify exits with error + `pegana_engine_methodology_broken_total` increments.
- Devnet SAS test: trigger a critical alert on devnet, verify `pegana_onchain_commit_total{outcome="ok"}` increments + `alert_evidence.onchain_tx_sig` populated within 60s.

---

## 10. Cross-references

- For engine startup methodology check, see `06-engine-changes.md § Engine startup sequence`.
- For SAS on-chain commit, see `06-engine-changes.md § onchain_commit.rs` + `10-distribution.md § cargo-dist`.
- For Grafana panel implementation tasks, see `plans/12-phase-12-observability.md`.
- For Sentry config, see `crates/common/src/observability.rs` (existing, no change).
- For acceptance criteria AC74-AC76, see `12-acceptance-criteria.md § Observability`.
