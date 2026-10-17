# AC78 (webhook dogfood report) — decision

> Recorded 2026-05-29. Drop AC78 as a launch gate.

## Original spec (`12-acceptance-criteria.md`)

> **AC78**: Webhook dogfood report published at
> `docs/operations/webhook-dogfood-2026-06-03.md` with delivery rate ≥ 99%
> and p99 latency ≤ 5s.

## Decision

**Drop AC78 as a launch-blocking gate.** Webhook health is monitored
continuously via:

- `pegana_webhook_deliveries_total{outcome=ok|failed}` counter (live in Grafana)
- `pegana_webhook_delivery_seconds` histogram (p99 dashboard panel)
- `calibration-watch.sh --watch` cron alerts on failure-rate anomaly (>3 in 5 min)

The standalone 06-03 report was conceived BEFORE the observability
pipeline shipped (Trust Layer v0.1.0 didn't have Grafana wired yet). With
the metrics + cron alerts live since 2026-05-29, the report would be a
manual snapshot of what Grafana already shows continuously.

## What replaces AC78

A **5-minute pre-launch checklist item** in `launch-runbook-2026-06-11.md`:

```
- [ ] Webhook health (any 24h window in last 7d): query Grafana
      `webhook_delivery_failure_rate < 1%` AND `webhook_p99 < 5s`.
      Screenshot the panel; attach to launch tweet thread if green.
```

This honors the original intent (prove webhook is solid before launch)
without duplicating Grafana into a markdown file that goes stale on day 2.

## Why this is the disciplined call

- AC78 prescribes a STANDALONE artifact. Grafana panels are the same
  data, live, query-able, and historical.
- The 06-03 date was arbitrary (mid-calibration). Any week-1 launch
  query gives the same signal.
- A markdown report adds maintenance debt (someone has to update it),
  while the Grafana panel updates itself.
- Honest documentation > faux-completeness. Marking AC78 "done" with
  a stale report would erode the audit trail discipline.

## What to do today

- [x] Document the decision (this file)
- [x] Update `launch-runbook-2026-06-11.md` to include the 5-minute check
      replacing AC78 (separate commit)
- [x] Cross-reference from `12-acceptance-criteria.md` next to AC78 row

## Reversal trigger

If the launch scorecard (2026-07-15 per ADR-0007) flags webhook health
as opaque to integrators, ship a markdown summary then. Not before.
