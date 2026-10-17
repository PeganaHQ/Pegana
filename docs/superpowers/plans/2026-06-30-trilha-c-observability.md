# Trilha C — Observability Implementation Plan

> **For agentic workers:** Implemented by **Codex** (Sonnet 4.6 fallback if Codex stalls/errors), reviewed 1:1 by **Opus**. Task-altitude pointers + acceptance + tests. All changes are ADDITIVE (new alert rules, new metric emits, new middleware) — **zero receipt-hash impact**.

**Goal:** Make the trust layer's silent failures visible and alertable, and give a per-asset state view — so when the methodology catches a garbage NAV (forces UNKNOWN), or an integrity/persistence write fails, someone is paged and it's demo-able.

**Architecture:** Alert rules in `ops/alerts/pegana.yml` (the metrics + most panels already exist — only alerting is missing). A new per-asset state gauge + an API request-latency histogram are additive metric emits in `engine-rs` / `api-rs`. No methodology/discount/receipt change.

**Tech Stack:** Prometheus alerting rules (YAML), `metrics` crate gauges/histograms (Rust), axum middleware, Grafana dashboard JSON (optional panels).

**Parent spec:** `docs/superpowers/specs/2026-06-29-audit-remediation-campaign-design.md` (§3 Sprint C).

**Per-task gate:** `cargo build`/`clippy`/`fmt`/test for Rust tasks + the Task 0 hash baseline; `promtool check rules` (or YAML parse) for alert-rule tasks. Opus reviews 1:1 + re-verifies. `/code-review` on the full sprint diff.

---

## Verified integration points (2026-06-30)

- `ops/alerts/pegana.yml` — Prometheus `groups: → rules:` (alert/expr/for/labels{severity,service}/annotations{summary,description}). **NONE** of `nav_sanity_unknown_total`, `methodology_broken_total`, `audit_persist_failed_total`, `startup_check_failed_total`, or webhook `dead_letter` are alerted yet.
- Metrics confirmed to EXIST in code: `pegana_engine_nav_sanity_unknown_total{asset,class}` (engine main.rs:~791), `pegana_engine_methodology_broken_total` (:86), `pegana_audit_persist_failed_total`, `pegana_engine_startup_check_failed_total{check}` (:1591), `pegana_webhook_dispatches_total{status="dead_letter"}` (dispatcher main.rs:621). Panels exist for methodology_broken + audit_persist (dashboard.json:491,470); nav_sanity + startup_check have no panel.
- Engine gauge emit pattern: `metrics::gauge!("name", "label"=>val).set(x)` (engine main.rs:262-264). `final_state` resolved ~798; `prev` (previous state) available; `set_last_published_state` ~876.
- `api-rs` already uses `tower_http::trace::TraceLayer` (main.rs:24); the app Router is built at main.rs:224. No request-latency histogram exists.

---

## File Structure

| File | Change | Tasks |
|---|---|---|
| `ops/alerts/pegana.yml` | new alert rules (trust-layer integrity + UNKNOWN spike) | C1 (H7/M13) |
| `crates/engine-rs/src/main.rs` | `pegana_engine_asset_state{asset,state}` gauge, zero-old-on-transition | C2 (H8) |
| `crates/api-rs/src/main.rs` (+ a small middleware fn) | request-latency histogram | C3 (p95/p99) |
| `ops/alerts/pegana.yml` | webhook `dead_letter` alert, **commented/disabled** | C4 (H9) |
| `ops/grafana/dashboard.json` | OPTIONAL panels for asset_state + API latency | C2/C3 (if clean) |

---

## Task 0: Hash-invariance baseline

- [ ] Run `cargo run -q -p pegana-replay-cli --bin pegana-replay -- --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json` → confirm `recomputed receipt:31c06db4fc9a matches stored receipt:31c06db4fc9a`. Re-run after each Rust task (C is additive; the hash MUST not change).

---

## Task C1 (H7 + M13): alert rules for the trust-layer silent failures

**File:** `ops/alerts/pegana.yml`

Add a new group `pegana.trust_integrity` (interval: 30s) with these rules. Embed the metric expr in `description` (house style). Use `severity: critical` for integrity/persistence (these are "the trust layer is silently degraded" — must page), `severity: warning` for the UNKNOWN-rate signal.

- [ ] **Step 1:** add rules:
  - `PeganaMethodologyBroken` — `expr: sum(pegana_engine_methodology_broken_total) > 0`, `for: 0m`, critical/engine. (Engine refused to start on a broken methodology version → deploy must roll back.)
  - `PeganaAuditPersistFailing` — `expr: increase(pegana_audit_persist_failed_total[10m]) > 0`, `for: 0m`, critical/engine. (Non-recoverable audit-write failures = receipts not landing = trust layer broken.)
  - `PeganaStartupCheckFailed` — `expr: increase(pegana_engine_startup_check_failed_total[10m]) > 0`, `for: 0m`, warning/engine. (Wallet-balance / startup invariant check failed.)
  - `PeganaNavSanityUnknownSpike` — `expr: increase(pegana_engine_nav_sanity_unknown_total[15m]) > 0`, `for: 0m`, warning/engine. (Methodology forced an asset to UNKNOWN off a broken NAV anchor — the differentiator firing; surface it so it's seen, not paged-hard.)
- [ ] **Step 2 (verify):** `promtool check rules ops/alerts/pegana.yml` if promtool is installed; else `python3 -c "import yaml,sys; yaml.safe_load(open('ops/alerts/pegana.yml'))"` to confirm valid YAML. Confirm the new group parses and expressions are syntactically valid PromQL (no unbalanced braces).
- [ ] **Step 3:** commit `feat(ops): alert rules for trust-layer integrity + NAV-sanity UNKNOWN spike — H7/M13` + trailer.

> **Acceptance:** the 4 rules load (promtool/YAML valid); each carries severity+service+summary+description with the metric expr embedded. No code change.

---

## Task C2 (H8): per-asset state gauge `pegana_engine_asset_state{asset,state}`

**File:** `crates/engine-rs/src/main.rs`

A gauge that is `1` for an asset's current state and `0` for the states it left — powers a state heatmap and "stuck in UNKNOWN for 2h" alerting. Keep labels to `asset × state` ONLY (L17 cardinality: ~65 assets × 6 states is fine; do not add more label dims).

- [ ] **Step 1 (TDD where possible):** the emit itself isn't easily unit-tested (it's a side-effect in the async recompute), but factor the label string for a `PegState` into a small pure helper if one doesn't exist (reuse `peg_state_label`). Add a focused test only if a pure seam exists; otherwise rely on the prod /metrics check (Step 4) + review.
- [ ] **Step 2:** after `final_state` is resolved and just before/after `set_last_published_state` (~main.rs:876), emit:
  - `metrics::gauge!("pegana_engine_asset_state", "asset"=>asset, "state"=>peg_state_label(final_state)).set(1.0);`
  - On a transition (when `prev` is `Some(p)` and `p != final_state`), zero the old series: `metrics::gauge!("pegana_engine_asset_state", "asset"=>asset, "state"=>peg_state_label(p)).set(0.0);`
  (This keeps exactly one `state` series at 1 per asset without writing all 6 every tick. `prev` is already computed near :875.)
- [ ] **Step 3:** verify `cargo build` + `cargo test -p engine-rs` + clippy 0 + fmt clean + hash gate unchanged.
- [ ] **Step 4:** commit `feat(engine): per-asset state gauge pegana_engine_asset_state{asset,state} — H8` + trailer.

> **Acceptance:** after deploy, `curl …/metrics | grep pegana_engine_asset_state` shows one `=1` series per asset for its current state; a transitioned asset's old state reads `0`. Cardinality bounded to asset×state.

---

## Task C3 (API p95/p99): request-latency histogram

**Files:** `crates/api-rs/src/main.rs` (+ a small middleware fn, e.g. in a new `metrics.rs` or inline)

- [ ] **Step 1:** add an axum middleware (`axum::middleware::from_fn`) that times each request and records `metrics::histogram!("pegana_api_request_duration_seconds", "method"=>…, "status"=>…).record(elapsed_secs)`. Keep labels LOW-cardinality: method + status class (e.g. "2xx"/"4xx"/"5xx") — do NOT label by full path (cardinality blowup) unless a small fixed route-group label is easy; method+status-class is the safe default.
- [ ] **Step 2:** wire `.layer(axum::middleware::from_fn(track_latency))` onto the app Router (main.rs:224), alongside the existing TraceLayer.
- [ ] **Step 3 (TDD where possible):** factor the status→class mapping into a pure fn and unit-test it (200→"2xx", 404→"4xx", 503→"5xx"). The middleware timing itself is integration-level; rely on the prod /metrics check + review.
- [ ] **Step 4:** verify `cargo build` + `cargo test -p api-rs` + clippy 0 + fmt clean + hash gate unchanged.
- [ ] **Step 5:** commit `feat(api): request-latency histogram for p95/p99 — Sprint C` + trailer.

> **Acceptance:** after deploy, `curl …/metrics` (api) exposes `pegana_api_request_duration_seconds_bucket{...}`; a Grafana `histogram_quantile(0.95, …)` yields p95. Labels bounded to method×status-class.

---

## Task C4 (H9): webhook dead-letter alert — written DISABLED (no consumer yet)

**File:** `ops/alerts/pegana.yml`

The dispatcher already emits `pegana_webhook_dispatches_total{status="dead_letter"}` and a latency histogram. There is no external webhook consumer yet, so monitoring it now is monitoring an empty room — but the rule should EXIST, commented out, with a one-line trigger note, so it's a one-line uncomment the day the first consumer signs.

- [ ] **Step 1:** add (COMMENTED OUT) in a `pegana.webhook_delivery` group:
  ```yaml
  # Enable when the first external webhook consumer is live (see ROADMAP / H9).
  # - alert: PeganaWebhookDeadLetters
  #     expr: increase(pegana_webhook_dispatches_total{status="dead_letter"}[10m]) > 0
  #     for: 0m
  #     labels: { severity: warning, service: dispatcher }
  #     annotations:
  #       summary: "Webhook deliveries are dead-lettering"
  #       description: |
  #         increase(pegana_webhook_dispatches_total{status="dead_letter"}[10m]) > 0 —
  #         a subscriber stopped receiving alerts. Check dispatcher logs + the
  #         webhook_dead_letter table; replay via POST /v1/me/webhooks/{id}/replay.
  ```
- [ ] **Step 2:** YAML still parses (the comment block must not break the file). `python3 -c "import yaml; yaml.safe_load(open('ops/alerts/pegana.yml'))"`.
- [ ] **Step 3:** commit `docs(ops): dead-letter webhook alert (disabled until first consumer) — H9` + trailer.

> **Acceptance:** the file parses; the rule is present but inert; uncommenting it is the only action needed later.

---

## Task C5 (OPTIONAL): Grafana panels for asset_state + API latency

**File:** `ops/grafana/dashboard.json`

ONLY if it can be done without breaking the JSON (unique panel `id`, non-overlapping `gridPos`). If risky, SKIP and note — the metrics are queryable in Grafana Explore regardless.

- [ ] Add a state-timeline/heatmap panel for `pegana_engine_asset_state` and a p95/p99 graph for `histogram_quantile(0.95, sum(rate(pegana_api_request_duration_seconds_bucket[5m])) by (le))`. Validate `python3 -c "import json; json.load(open('ops/grafana/dashboard.json'))"`. Commit separately or skip.

---

## Sprint exit criteria

- [ ] C1–C4 committed (C5 optional). `ops/alerts/pegana.yml` + `dashboard.json` parse.
- [ ] `cargo build`/`clippy`(0)/`fmt`(clean)/`cargo test --workspace` green.
- [ ] Hash baseline `31c06db4fc9a` byte-identical (C is additive).
- [ ] Opus 1:1 review + `/code-review` high; findings fixed.
- [ ] Deploy `scripts/deploy.sh` (no migration). Prod-verify: `pegana_engine_asset_state` + `pegana_api_request_duration_seconds` appear on /metrics; Prometheus loads the new rules (no config error).

## Self-review (author)

- **Coverage:** H7/M13 → C1 · H8 → C2 (L17 cardinality bounded) · API p95/p99 → C3 · H9 → C4 (disabled) · panels → C5 (optional).
- **Additive-only:** alert YAML + new metric emits + middleware; no methodology/discount/receipt surface → hash unchanged (assert via Task 0 each Rust task).
- **Cardinality discipline:** asset_state = asset×state only; API histogram = method×status-class only. No per-path / per-user labels.
- **Cut from C (per spec):** M12 source-divergence (already observable via discount_raw), L18 freshness gauges (redundant). Not in this plan.
