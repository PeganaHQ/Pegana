# 🔬 PEGANA · COMPLETE AUDIT — 2026-07-18

> Definitive verdict from two ultracode workflows (P1 technical wnppbaeny · P2 personas w199xdlow),
> each finding adversarially verified + context7-validated. 41 confirmed findings. This is the
> execution backlog for the relaunch fix-loop (P4). Findings marked ✅ as they are fixed.

## Verdict (from the two synthesis leads)

- **Complete?** Substantially yes — fully wired end-to-end; findings are consistency/propagation gaps, not missing features. EXCEPT the product's flagship promise (gate money on peg state) has a broken documented path (`confidence` missing from the gating surfaces).
- **Validated?** Mostly byte-exact — but ADR-0039 (this session) reached only 2 of 3 override branches across 2 of 3 implementations → the 'three implementations agree' guarantee is currently FALSE for the catastrophic case (the P0).
- **Tested?** Strong unit/fuzz — 3 holes: CI backtest never exceeds ~3.12% discount (30% sanity path unexercised), Hylo decoder has no fixture test, no test asserts pyth-staleness keys match a declared feed.
- **100% secure?** No (no honest auditor says 100%). ONE genuine residual: webhook SSRF via DNS-rebinding TOCTOU (blind, internal-scoped, P2). Everything else defensively sound.
- **Adoptable by personas?** issuer NO · integrator ALMOST (one M fix) · treasury NO at portfolio scale · retail NO on mobile. Dominant pattern: **unwired last mile** (backend built+documented, never surfaced to UI/field/docs).

## A · TECHNICAL findings (P1 workflow — 12)

| # | Sev | Area | Finding | File | Status |
|---|---|---|---|---|---|
| T1 | P0 | formulas/correctness | Pyth confidence-gate and intrinsic-liveness gate re-mask a confirmed BLACK_SWAN — reopens the exact bug ADR-0039 just fixed, via a side door | `engine+rederive+runner` | ✅ FIXED (a6eee4d3)(mirrored in crates/m` | ⬜ |
| T2 | P1 | oracles/correctness | USDY's pyth_staleness override key is missing the ".RR" suffix — it silently widens the wrong feed | `assets.toml:1375 (cf. assets.toml:358-359, crates/engine-rs/` | ⬜ |
| T3 | P1 | backend/reliability | Bot /send claims idempotency key before sendMessage succeeds, with no release on failure — dispatcher retries after a transient Telegram error are reported as delivered but never sent | `bot-ts/src/index.ts:1097-1139 (interacts with bot-ts/src/db.` | ⬜ |
| T4 | P1 | backend/reliability | dispatcher-rs has no graceful shutdown and no Redis Streams consumer-group crash recovery — alerts read-but-unacked before a restart are permanently stuck in the PEL and never redelivered | `crates/dispatcher-rs/src/main.rs:56-148` | ⬜ |
| T5 | P1 | frontend/correctness | Command palette (Cmd+K) bypasses the H1/H9 freshness gate — can show a frozen state as confirmed | `web/components/organisms/command-palette.tsx:154-160` | ⬜ |
| T6 | P1 | frontend/correctness | Public embed/badge widgets and the marketing homepage board skip the app's 2-minute staleness gate, relying only on the API's looser 15-minute collapse | `web/app/(marketing)/embed/badge/[symbol]/route.ts:9-17,278-3` | ⬜ |
| T7 | P1 | trust-invariant/correctness | xtask backtest runner missing the ADR-0039 BLACK_SWAN carve-out — the 'three implementations' don't agree by construction | `crates/xtask/src/backtest/runner.rs:176-189` | ⬜ |
| T8 | P2 | formulas/correctness | transition_decide makes Unknown→Pegged recovery wait the full 120s decay window, contradicting the code's own 'resumes via the cold-start path' claim | `crates/methodology/src/transition.rs:26-103 (state_strictnes` | ⬜ |
| T9 | P2 | oracles/test-gap | Hylo's on-chain NAV decoder is the only source in indexer-rs/src/sources with no real-account fixture regression test | `crates/indexer-rs/src/sources/hylo.rs:548-617 (decode_hylo_t` | ⬜ |
| T10 | P2 | backend/data-integrity | subscribe_peg_events paid MCP tool's cursor rounds a microsecond timestamp to the nearest second, silently dropping (or duplicating) alert events at page boundaries — breaks its documented gap-free polling contract | `mcp-ts/src/tools/subscribe-peg-events.ts:60,122-133,140` | ⬜ |
| T11 | P2 | frontend/correctness | Peer Comparison table fabricates a '0.00%' (perfectly-pegged) reading for assets with no spread data | `web/components/organisms/peer-comparison.tsx:120-128,152` | ⬜ |
| T12 | P2 | security/security | Webhook SSRF guard is bypassable via DNS rebinding (TOCTOU between validate_url_runtime and the actual reqwest connect) | `crates/common/src/webhook_url.rs:152-190 (also crates/dispat` | ⬜ |

## B · PRODUCT / PERSONA findings (P2 workflow — 29)

| # | Sev | Persona | Finding | File | Status |
|---|---|---|---|---|---|
| P1 | P0 | issuer/onboarding-gap | No self-serve path to request asset coverage — new issuers hit a dead-end 404 | `web/components/molecules/asset-not-found.tsx` | ⬜ |
| P2 | P0 | integrator/unbacked-claim | `confidence` is missing from every endpoint/tool the docs recommend for automated gating — the documented "gate real money" example is broken | `crates/api-rs/src/routes/assets.rs:879-920` | ⬜ |
| P3 | P0 | retail/onboarding-gap | Onboarding walkthrough never opens on mobile and has no reachable re-open entry point | `web/lib/hooks/use-onboarding-state.ts:28-29` | ⬜ |
| P4 | P1 | issuer/missing-capability | Audit/receipt/on-chain-anchor pipeline is alert-only — a perfectly-pegged asset has zero proof artifacts | `web/app/(marketing)/audit/page.tsx:64` | ⬜ |
| P5 | P1 | issuer/half-wired | Embed widget integrity guard is applied inconsistently across the three embed surfaces | `web/app/embed.js/route.ts:146-164` | ⬜ |
| P6 | P1 | integrator/unbacked-claim | Webhook payload docs say "exactly" 6 fields but the real dispatched payload has 3 more — including the only field that flags a beta/uncalibrated asset | `crates/dispatcher-rs/src/main.rs:569-582` | ⬜ |
| P7 | P1 | integrator/onboarding-gap | The best-suited integrator endpoints (mint-keyed feed with confidence+calibration, and the per-asset miscalibration self-monitor) exist and are code-complete but are absent from every integration guide | `crates/api-rs/src/routes/peg.rs:1-291` | ⬜ |
| P8 | P1 | integrator/missing-capability | No SDK covers the core peg-state read path — the only shipped SDK functions are for the audit/receipt-verification flow | `sdk/typescript/README.md:1-46` | ⬜ |
| P9 | P1 | treasury/broken-flow | Public audit page's "CSV export" link is broken — hits a required-params 400 | `web/app/(marketing)/audit/page.tsx:353-355` | ⬜ |
| P10 | P1 | treasury/confusing-ux | "52-week heatmap" on /events is fed alerts that default to only the last 7 days | `web/app/(app)/events/page.tsx:168,264-272` | ⬜ |
| P11 | P1 | treasury/missing-capability | No portfolio-wide export exists anywhere except /compare, which caps at 4 assets | `web/app/(app)/dashboard/page.tsx (whole file)` | ⬜ |
| P12 | P1 | retail/broken-flow | "Custom threshold" CTA on every asset page links to alert history, not a threshold editor | `web/components/organisms/asset-rail.tsx:172-177` | ⬜ |
| P13 | P1 | retail/unbacked-claim | Safety grade (A–D) is a static class-based heuristic shown with the same visual weight as live risk data; its only disclaimer is a desktop-only hover tooltip | `web/lib/api/format.ts:260-308` | ⬜ |
| P14 | P1 | coherence/half-wired | Webhook delivery history + replay are fully built server-side and publicly documented, but the console has zero UI for them | `crates/api-rs/src/routes/webhooks.rs:577-639 (list_deli` | ⬜ |
| P15 | P1 | coherence/half-wired | Alert-delivery acknowledgment has a read path and a rendered UI chip, but zero write path outside raw SQL | `crates/api-rs/src/routes/stats.rs:156-165 vs web/app/(a` | ⬜ |
| P16 | P2 | issuer/confusing-ux | Embed configurator's Theme/Sparkline controls silently don't apply to the Markdown/README badge | `web/app/(marketing)/embed/badge/[symbol]/route.ts:180-2` | ⬜ |
| P17 | P2 | issuer/unbacked-claim | "Seen on" strip implies adoption by named protocols that don't actually embed Pegana | `web/app/(marketing)/embed/embed-client.tsx:342-386` | ⬜ |
| P18 | P2 | treasury/missing-capability | Alerting (webhooks + Telegram subscriptions) is strictly single-asset per registration, no bulk/portfolio subscribe | `crates/api-rs/src/routes/webhooks.rs:143-153,177-243 (C` | ⬜ |
| P19 | P2 | treasury/unbacked-claim | Safety grade is a static, hardcoded heuristic — disclosed inconsistently, and sortable as if it were a live risk signal | `web/lib/api/format.ts:260-308` | ⬜ |
| P20 | P2 | treasury/missing-capability | UI chart/history views cap at 30 days even though the backend retains full history indefinitely | `web/app/(app)/asset/[symbol]/page.tsx:731 (parseBucket ` | ⬜ |
| P21 | P2 | treasury/missing-capability | pegana-replay CLI verifies exactly one alert at a time — no batch/portfolio verify or aggregate report | `crates/pegana-replay-cli/src/main.rs:101-106,205-212` | ⬜ |
| P22 | P2 | treasury/half-wired | Alert delivery history is hard-capped at 30 days in the UI and has no export, though the API already supports a longer `since` | `web/app/(app)/account/alerts/page.tsx:216,275-277` | ⬜ |
| P23 | P2 | retail/unbacked-claim | Telegram bot's first message hardcodes a stale asset count instead of sourcing it live | `bot-ts/locales/en.ftl:8-13` | ⬜ |
| P24 | P2 | coherence/half-wired | /v1/me/preferences accepts and persists locale: pt-BR as a valid, effective setting — but the bot that would render it is hardcoded English-only per ADR-0022 | `crates/api-rs/src/routes/me.rs:63-109 vs docs/adr/0022-` | ⬜ |
| P25 | P3 | issuer/confusing-ux | Audit empty-state carries stale "sample rows below" copy left over from the removed calibration-window design | `web/app/(marketing)/audit/page.tsx:219-230` | ⬜ |
| P26 | P3 | integrator/missing-capability | The whole production stack integrators would depend on is a single VPS behind a single static IP, with no documented uptime/SLA and no distributed rate limiting | `crates/api-rs/src/rate_limit.rs:1-8` | ⬜ |
| P27 | P3 | integrator/unbacked-claim | FAQ's production-readiness answer is stale — it still frames the API as inside a "stability lock" window that ended weeks ago, with no updated versioning/breaking-change policy | `docs-site/faq.mdx:51-58` | ⬜ |
| P28 | P3 | treasury/missing-capability | Watchlist has no manual export/import path, so multi-terminal or multi-analyst desks have no supported way to move a list between devices | `web/lib/store/watchlist.ts:1-78` | ⬜ |
| P29 | P3 | retail/confusing-ux | "Market cap" board column renders "—" for every asset today, shown to every first-time visitor | `web/components/organisms/dashboard-board-row.tsx:596-60` | ⬜ |

## Fix-loop batches (P4)

- **E · P0 verdict-pipeline (BLOCKER):** T1 (ADR-0039 → pyth+intrinsic branches) + T12/T-runner (xtask carve-out) — extract/mirror the override carve-out to all 3 impls + regression test.
- **F · backend correctness/reliability:** USDY .RR key · bot idempotency · dispatcher PEL/shutdown · MCP cursor rounding · webhook DNS-rebinding SSRF · Hylo decoder fixture test.
- **G · frontend correctness:** command-palette freshness · embed staleness gate · peer-comparison fake 0.00%.
- **H · API + integrator (highest product leverage):** add `confidence`+`state_reason` to /state·MCP·WS·webhook · document /peg/feed + /calibration · webhook docs 6→9 fields.
- **I · retail/treasury/issuer UI:** threshold-CTA href · onboarding mobile · heatmap since=365d · CSV export range · request-coverage CTA · embed reconcileBps parity · safety-grade disclosure · etc.
- **J · docs/copy:** FAQ stability-lock · SDK README scope · bot stale count · market-cap column · locale validator.
- **Founder-only:** coverage-intake policy · positive-proof attestation cadence · SLA · positioning · sHYUSD · demand/GTM · merge.


## Fix-loop progress (P4)
- ✅ **T1 + T12** (P0 verdict-pipeline): ADR-0039 carve-out extended to all 3 gates + single-sourced in `override_final_state` (engine+rederive+runner agree by construction) — `a6eee4d3`. 3 regression tests, golden byte-exact.
- 🟡 **P7 confidence-gating loop**: `confidence` added to REST `/state` — `bdc46a1b`. Remaining surfaces (WS `update` frame via engine publish · MCP `get_asset_state` · webhook canonical payload · doc `/peg/feed`+`/calibration`) scoped as follow-up.
- ⬜ Remaining ~37 findings queued in Batches F–J (see plan above).


## Fix-loop progress (P4) — updated
- ✅ T1+T12 (P0 pipeline) · T2 (Unknown decay) · T3 (USDY .RR key) · T5 (bot idempotency) · T6 (dispatcher shutdown+PEL) · T7 (MCP cursor) · T11 (webhook DNS-rebinding SSRF pin) · /state confidence · webhook payload docs (T8) · FAQ.
- ⏳ Web batch (T8-freshness, T9-embed, T10-peer, + ~13 persona UI) running via delegated agent — validate + commit on completion.
- ⬜ Remaining: T4 (Hylo fixture test) · confidence WS/webhook/MCP + document /peg/feed+/calibration · coherence (alert-ack endpoint, locale validator, webhook-deliveries UI) · final stress gate · P5 changelog+page.
