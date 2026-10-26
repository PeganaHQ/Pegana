# ADR-0043 — Uniform `/v1` response shapes (envelope lists, unify fields), in place

- **Status:** Accepted (2026-07-24). On `landing/v2-port`, **NOT deployed** at time of writing.
- **Scope:** the JSON *shape* of the `/v1` read surface — list envelopes, the peg-feed structure,
  and a handful of field names on the Sub-C / feed responses. Builds on ADR-0042 (which normalized
  value *representation* without touching shape).
- **Supersedes** the "Structural output redesign — deferred to /v2" open decision in
  `docs/ROADMAP.md`.

## Context

After ADR-0042 the *values* were clean but the *shapes* were inconsistent:

- List endpoints returned bare JSON arrays; the peg feed returned a mint-keyed object
  (`data[<mint>]`); single resources returned bare objects. Three shapes, no uniform place to
  add top-level metadata (paging, freshness) without a break.
- Freshness was `updated_at` on some endpoints but `as_of` on the feed and Sub-C endpoints; the
  advisory string was `model_note` in two places and `note` in a third; the bucketed
  obligation range was `positions_affected` in three structs and `position_bucket` in a fourth;
  the global `methodology` version was repeated on every one of ~68 feed signals.

The blocker that had deferred this was "it's breaking, and we'd break the tokens.xyz partner
feed + public embeds + docs/CI". Re-checked 2026-07-24: **tokens.xyz does not yet consume the
feed**, and there are no external API-key holders. So there is no external party to version
against — "breaking" reduces to "update every in-repo consumer in the same change".

## Decision

Reshape `/v1` **in place** (not a `/v2`), as a one-time coordinated change:

1. **Lists are enveloped.** `GET /v1/assets`, `/v1/alerts`, `/v1/calibration`,
   `/v1/assets/{s}/history`, and `/v1/peg/feed` return
   `{ ok, generated_at, count, data: [ … ] }` — a top-level object, never a bare array, so new
   top-level fields never break a consumer (Zalando/Stripe convention). Implemented as a thin
   `ApiList<T>` re-serialization wrapper (`crates/api-rs/src/response.rs`) over the payload each
   handler already computes.
2. **Single resources stay bare.** `/v1/assets/{s}`, `/state`, `/loop-exposure`,
   `/simulate-depeg`, `/stats`, `/methodology/current`, `/peg/feed/by-mint`, `/audit/*` return
   the resource object directly (Stripe/GitHub convention). Chosen over enveloping everything
   (`ApiOne`) to keep the crossover surface small — the client-side `embed.js` partners load,
   the OG-image routes, and the MCP `structuredContent` validation path all read fields off the
   object directly, and wrapping them buys marginal uniformity for real risk. `ApiOne` exists
   (ready) so "envelope singles too" remains a purely additive follow-up.
3. **Peg feed `data` map → array.** Each signal carries its own `mint`; consumers index
   `data[]` by `signal.mint`. The global `methodology` is stamped once on the envelope, not on
   every signal. The array is sorted by mint so the weak `ETag` stays deterministic.
4. **Field names unified:** `as_of` → `updated_at`; `model_note` / `note` → `advisory_note`;
   `positions_affected` / `position_bucket` → `positions` (the DB column keeps its name via
   `#[sqlx(rename)]`).
5. **Errors unchanged:** still `{ error, message, asset? }`.

## Zero-break rollout

Consumers accept **both** shapes during the crossover, then the old branch is removed once prod
serves the new shape:

- Web reads list rows via `Array.isArray(b) ? b : (b?.data ?? [])`; the six independent fetchers
  and the systemic-feed hook do the same; renamed fields read `new ?? old`.
- MCP `outputSchema`s carry both the new and (relaxed-to-optional) old keys, so
  `structuredContent` validates against either shape.
- Deploy order is safe in both directions: web ships via Vercel (defensive) independently of the
  api (`--services api`), so neither ordering has a break window.

Phased F1 (list envelopes) → F2 (field renames) → F3 (feed array) → F4 (docs + remove the
defensive fallbacks after prod is verified), each fully tested (`cargo`/`web`/`mcp` suites +
an in-process envelope contract test) before the next.

## Consequences

- **Positive:** one self-describing shape for every list; one freshness field name; no repeated
  methodology; the feed is consistent with every other collection; headroom to add top-level
  metadata without a break.
- **Negative / accepted:** a real (if coordinated) breaking change to `/v1`; a mixed shape would
  exist transiently if the api and web deploys are far apart (absorbed by the defensive readers);
  the authed `/v1/me/*` lists are left bare for now (app-internal, not the public surface).
- **Revisit if** an external integrator appears mid-rollout (then coordinate/announce), or a
  consumer wants uniform envelope handling on single resources (do the additive `ApiOne` pass).
