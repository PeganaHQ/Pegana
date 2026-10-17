# ADR-0020: Public `/v1/audit` index + feeds gated by `FEATURE_PUBLIC_ALERTS`

- **Status:** Accepted (2026-05-31)
- **Amends:** [ADR-0005](0005-early-evidence-rollout.md) (early evidence rollout)
  and the public-surface semantics in `07-api-surface.md` / `08-external-surfaces.md`.
- **Supersedes:** none.

## Context

ADR-0005 brought the evidence pipeline to production early
(live 2026-05-29 03:55 UTC) with `FEATURE_PUBLIC_ALERTS=false`, on the premise
that "`FEATURE_PUBLIC_ALERTS=false` keeps surface internal." During the launch
audit (2026-05-31) two findings showed that premise was only half-true:

1. **The contradiction.** ADR-0005 simultaneously says the flag "keeps the
   surface internal" AND that the calibration report "can link to specific
   `/audit/[id]` URLs that anyone can verify offline." Both cannot be true if
   the flag gates *everything* audit-related.

2. **Decoupled gates.** The flag was understood to gate dispatch-side behaviour
   (whether dispatched webhook/Telegram copy includes `evidence_url`), but the
   public **read** surface — the `/v1/audit` INDEX listing and the RSS/Atom
   feeds — was not consistently gated. That meant the full calibration ledger
   (every dogfood alert) was publicly *discoverable* before launch, even though
   the whole point of the dogfood window is that it stays quiet until 06-11.

The launch deploy one-pagers also wrongly claimed the flag flip "starts
`evidence_url` stamping" and "makes `/audit/[id]` live" — neither is true:
`evidence_url` is stamped into the evidence record unconditionally, and the
detail endpoint has always been live (ungated direct lookup).

## Decision

Gate the **discoverable read surface** of the calibration ledger on
`FEATURE_PUBLIC_ALERTS`, while keeping **direct verification** ungated:

- **Gated by the flag in api-rs** (empty list / empty CSV until the flag is `true`):
  - `GET /v1/audit` — the public **index/listing** of alerts.
  - `GET /v1/alerts` — the discoverable **alert list** (same ledger, different shape).
  - `GET /v1/audit.csv` — the bulk **CSV** export.
  - The web Atom/RSS feeds inherit the gate transitively: `pegana.xyz/audit.xml`
    fetches `/v1/audit`, `pegana.xyz/feed/events.xml` fetches `/v1/alerts`, so both
    degrade to empty (still well-formed) feeds while the flag is false. (These feeds
    are Next.js routes in `web/`, not api-rs endpoints — there is no `/v1/audit.rss`.)
    `pegana.xyz/calibration.xml` is methodology/asset-mutation derived and is
    intentionally **not** gated.
- **Always public** (ungated, regardless of the flag):
  - `GET /v1/audit/{id}` — direct receipt **detail** lookup by alert id.
  - `GET /v1/audit/{id}/replay-bundle` — the replay bundle.
  - `GET /v1/audit/{id}/onchain` — the on-chain anchor.

Rationale for the split: the index/feed is what makes the ledger *browseable*
and is the thing that should stay quiet during calibration. A direct lookup
requires already knowing the alert id (e.g. from a link the calibration report
deliberately publishes), and the on-chain anchor is already public on Solana —
so keeping detail/onchain ungated costs nothing and preserves the "anyone can
verify a specific receipt offline" property ADR-0005 depends on.

`evidence_url` stamping is **unconditional** (a property of the evidence record,
not the flag). The flag's only jobs are (a) the discoverable index/feed gate
above and (b) whether dispatched webhook/Telegram copy surfaces the
human-readable `evidence_url`.

## Consequences

- The calibration ledger is not publicly enumerable before launch: scrapers and
  casual visitors cannot list dogfood alerts, but the launch verdict report can
  still hand out specific `/audit/[id]` links that resolve and replay.
- The 06-11 launch flip (`FEATURE_PUBLIC_ALERTS=false → true`) is what turns the
  index + feeds on; it does **not** turn on `/audit/[id]` (already live) and does
  **not** start `evidence_url` stamping (already unconditional). Deploy docs
  corrected accordingly (`deploy-2026-06-11.md` § 0 / § 3).
- Web `/audit` index page consumes the gated `/v1/audit` index, so it is
  effectively empty/internal until launch, consistent with the API.
- ADR-0005's "keeps surface internal" mitigation is now concrete and
  non-contradictory (see its amendment note).

## Verification

- `FEATURE_PUBLIC_ALERTS=false`: `GET /v1/audit` (index) and the feeds return
  no public listing; `GET /v1/audit/{id}` + `/onchain` still return the receipt.
- `FEATURE_PUBLIC_ALERTS=true`: index + feeds enumerate alerts.
- Deploy one-pagers and ADR-0005 updated to match (no residual "flag makes
  `/audit/[id]` live" or "flag starts stamping" claims).

## Cross-refs

- [ADR-0005](0005-early-evidence-rollout.md) — early evidence rollout (amended)
- [ADR-0014](0014-csv-index-rate-limits.md) — bounded `/v1/audit.csv` + index endpoints
- `docs/pegana-trust-layer-v0.1.0/07-api-surface.md` — API surface
- `docs/pegana-trust-layer-v0.1.0/08-external-surfaces.md` — external surfaces
- `docs/operations/deploy-2026-06-11.md` § 0, § 3 — launch flag semantics
