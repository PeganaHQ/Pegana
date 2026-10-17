# Grafana — mcp-ts dashboard panels

The MCP server emits Prometheus metrics at `/metrics` (see
`mcp-ts/src/metrics.ts`). This document specifies the panels to add to
the existing **oracle dashboard** in Grafana — the JSON export below
is a template; the real export comes from clicking "Export → JSON" on
the panels once they're authored against the live Prometheus.

## Panels to add

### 1. Tool calls / sec (counter rate)

```promql
sum by (tool) (rate(pegana_mcp_tool_calls_total{status="success"}[5m]))
```

- Visualization: Time series, stacked area
- Y-axis: `req/s`
- Legend: `{{tool}}`

### 2. Tool error rate

```promql
sum by (tool) (rate(pegana_mcp_tool_calls_total{status="error"}[5m]))
  /
sum by (tool) (rate(pegana_mcp_tool_calls_total[5m]))
```

- Visualization: Time series, with alerting threshold at 0.01 (1%)
- Y-axis: percent
- **Sentry alert** mirrors this — tool error rate > 1% over 15 min
  (SPEC decision #5 telemetry).

### 3. Latency p50 / p99 by tool

```promql
pegana_mcp_tool_latency_seconds{quantile="0.5"}
pegana_mcp_tool_latency_seconds{quantile="0.99"}
```

- Visualization: Time series, multi-series
- Y-axis: milliseconds (the metric is exposed in ms despite the name —
  one of the historical Prom-convention sins we inherit; rename later)
- **Annotation thresholds** (from SPEC decision #5):
  - free-tool p99: 50ms
  - paid-tool p99: 200ms

### 4. x402 cumulative USDC settled (counter, paid tools only)

When the dispatcher records settlements, it will emit
`pegana_mcp_payments_total{status, network}`. Once that wire-up
lands (Plan 2 Track C complete + on-chain confirmation), add:

```promql
sum by (network) (rate(pegana_mcp_payments_total{status="success"}[5m]))
```

- Visualization: Counter (single stat) with rate annotation
- Subtitle: "USDC settled / 5m window"

## Provisioning

Once these panels are authored:

1. Save them onto the existing oracle dashboard (not a new one — keeps
   the operator's one-glance surface intact).
2. Export JSON: dashboard settings → JSON Model → copy.
3. Write to `docs/grafana/dashboards/mcp-ts.json`.
4. Commit + version-control going forward.

The JSON file is intentionally not committed here as a stub — it'd
diverge from the live dashboard within days. The PromQL queries +
intent are the source of truth.
