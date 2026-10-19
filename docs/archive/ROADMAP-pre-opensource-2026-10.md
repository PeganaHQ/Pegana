# Pegana API — Roadmap

Living roadmap for the public API surface (`api.pegana.xyz`). Last updated 2026-07-30.
Scope note: this file tracks **what to build next on the API**. For what already shipped, the
canonical record is `docs-site/changelog.mdx` (https://docs.pegana.xyz/changelog); for the whole
system, `ROADMAP.md` at the repo root.
Governing principle: **build to demand**. Pegana has 0 paying users; the gap is
DEMAND/outreach, not engineering. Ship non-breaking DX wins; gate bigger builds on a
concrete demand signal.

## ✅ Shipped & LIVE

| Item | What | Ref |
| --- | --- | --- |
| Output value normalization | Decimal strings trimmed of noise + USD aggregates cent-rounded; timestamps unified to RFC3339 ms-`Z`. Value-preserving, non-breaking. | PR #122 · ADR-0042 |
| DX headers | `x-request-id` (+ echo) and IETF `RateLimit-Limit/Remaining/Reset` (+ `X-RateLimit-*` mirror), CORS-exposed, on every response. | PR #123 |
| Docs completeness | New pages: Errors, Rate-limits, Pagination, Versioning, Data-model & glossary, Recipes ("API essentials" nav group). | PR #123 |
| LLMs.txt | `pegana.xyz/llms.txt` + `/llms-full.txt` served at root (Vercel rewrite → Mintlify auto-gen). | PR #123 |
| Structural output redesign | `/v1` reshape: list endpoints (+ peg feed) return the uniform envelope `{ok, generated_at, count, data}`; feed `data` map→array (each signal carries `mint`); one freshness field name (`updated_at`), advisory `advisory_note`, bucket `positions`; per-signal `methodology` moved to the envelope. Single resources stay bare (Stripe/GitHub). All in-repo consumers updated in lockstep. **Deployed 2026-07-24**; prod-verified (`/v1/assets` envelope `count=68`, `/v1/peg/feed` an array). | F1–F4 · ADR-0043 |

Validation standard for all of the above: `cargo test/clippy` + an in-process **e2e + stress**
test (sequential + concurrent) + `web`/`mcp-ts` suites green; surgical `--services api` deploy;
1:1 live verification. Zero consumer breakage.

## 🟡 Open decisions (not started)

### Envelope every single resource (`ApiOne`) — optional follow-up
The reshape enveloped lists but left single-resource GETs bare (Stripe/GitHub convention,
chosen to minimise the crossover surface — embeds/OG/MCP `structuredContent` stay simple).
A stricter "every response is `{ok, generated_at, data}`" is available as a purely **additive**
follow-up if a consumer wants uniform envelope handling. Also open: envelope the authed
`/v1/me/*` list endpoints (app-internal, not the public product surface).

## ⏸️ Deferred (validated, demand-gated)

### Full API Manager — "tokens.xyz-style" productization
Free API keys + GitHub/Solana-wallet login + a signed-in console (Overview + API Manager:
key management + live Playground) + a marketing landing.
- **Status:** fully analysed & validated — tokens.xyz captured 1:1 (6 screens), infra mapped,
  best-practices researched (context7), adversarially grilled. See
  `~/.claude*/memory/project_pegana_api_manager_2026_07_24.md` + the plan file.
- **Gating model DECIDED:** keys **optional + incentivized** — anon per-IP stays (embeds/partner
  unaffected), a free key buys higher limits + analytics + Playground; required-but-free only on
  new/expensive endpoints; x402 stays the paid top rung. (Grill proved "gate ALL /v1" is a P0
  mistake — embeds are client-side and can't hide a key; it breaks the partner + docs/CI.)
- **Hard pre-requisite:** identity re-architecture — today anchored on `telegram_id` only;
  needs an `account_id` + `identities(provider, provider_uid)` table before GitHub/wallet login.
- **ROI verdict:** NOT now. Weeks of work + auth-refactor risk + zero revenue (public good) while
  demand is the actual gap. **Trigger to build:** a concrete integrator asking, or the tokens.xyz
  relationship converting.

### Minor docs/OpenAPI polish
Numbered recommended-flow in the quickstart (tokens.xyz style); prune stale `docs-site/README.md`
refs (removed `openapi.yaml`, old colors/fonts); per-field `example`s + capability-grouped tags in
the OpenAPI. Low-priority, non-breaking, do opportunistically.

## Near-term leverage (not engineering)
The highest-leverage move at current demand is the **tokens.xyz relationship** — be the peg
dimension of their risk block — not building a competing API product. See
`docs/outreach/2026-07-24-steven-tokens-xyz-call-prep*`.
