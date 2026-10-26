# ADR 0014 — Bounded `/v1/audit.csv` and `/v1/audit` index endpoints

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; public audit endpoint operational limits

## Problem

`07-api-surface.md § 5` notes that `/v1/audit.csv` "Consider tightening
to 10/min via tower middleware in a follow-up. Out of scope for v0.1.0."

But CSV with `?from=2024-01-01&to=2026-06-30` (a 2.5-year range) could
stream millions of rows in one request. The default 300/min IP limit lets
a single client originate ~50 of these per minute. Postgres becomes the
chokepoint; legitimate users get slow queries.

Same risk on `/v1/audit?limit=…` if `limit` is unbounded.

## Decision

### `/v1/audit.csv`
- Rate limit: **10/min per IP** (overrides global 300/min for this route).
- Max date range: **90 days per request**. Larger range → `400 Bad
  Request` with hint to paginate via `?from`.
- Max rows: **50,000 per response**. Larger → truncate + `X-Truncated:
  true` header + next-cursor in `Link: <next>` header.
- Asset filter (`?asset=USDe`) recommended but not required.

### `/v1/audit` index
- Rate limit: keep global 300/min (it's a small page response).
- `limit` parameter: default 50, max 100. Larger → 400 Bad Request.
- Cursor pagination: `?cursor=<base64-encoded-ts>` for older entries.

### `/v1/audit/:id` (single receipt)
- No extra limit (immutable, hot, browser-cacheable).
- ETag on response based on `receipt_sha256`.

### `/audit.xml` and `/calibration.xml` RSS
- Caddy reverse proxy caches for 60s.
- Origin regenerates on demand; `Cache-Control: public, max-age=60`.
- ETag on RSS body for conditional GET (most readers support
  `If-None-Match`).

### Operational alerts
- Metric: `pegana_api_rate_limited_total{route}` (counter).
- Sentry alert if any route exceeds 100 rate-limited responses per 5 min
  (suggests targeted scrape or misbehaving consumer).

## Why bound now vs defer

- "Out of scope for v0.1.0" was acceptable when scrutiny was low. Trust
  Layer launch invites adversarial scrutiny including scraping. Better
  to bound up front than fix during incident.
- Bounds are documented as part of the public API contract; clients code
  to them from day one.
- Cost is small (~0.5 day for middleware + headers + ETag).

## Consequences

- +0.5 task in Phase 4 (API): per-route rate limit middleware, max-range
  parameter validation, ETag headers.
- OpenAPI spec must document the limits.
- Bot help text + `/methodology` page reference the limits.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/07-api-surface.md § 5 /v1/audit.csv`
- `docs/pegana-trust-layer-v0.1.0/plans/05-phase-4-api.md`
- `docs/pegana-trust-layer-v0.1.0/11-observability.md`
