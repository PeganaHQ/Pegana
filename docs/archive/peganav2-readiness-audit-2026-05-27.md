# Pegana v2 readiness audit

**Date:** 2026-05-27  
**Branch audited:** `V2`  
**Purpose:** decide what is actually ready for Phase 3, what must be fixed before public launch, and what should be added to make Pegana feel like a trustworthy product rather than a good demo.

## Executive verdict

Pegana v2 is ready to **prepare** Phase 3 distribution, but not ready for a full public launch thread that claims every v2 surface is production-grade. The frontend reframe is largely done, the MCP and webhook code exists, and several security findings from the 2026-05-26 audit have already been fixed. The remaining gap is proof: calibration, live paid-call verification, webhook dogfood, directory listings, and launch artifacts.

The product direction is correct. Do not broaden into wallet tracking, portfolio monitoring, NFT alerts, or generic DeFi notifications. Pegana wins if it becomes the most credible Solana-native answer to one question: **is this pegged asset still behaving according to its mechanism?**

## What is done

| Area | Status | Evidence |
|---|---|---|
| Oracle-first positioning | Done | Landing/metadata/docs now frame Pegana as a specialized peg-risk oracle. README updated to remove the old watchdog headline. |
| Frontend v2 foundation | Done | Phase 0/1 plan marks marketing reframe, `/oracle`, `/methodology`, `/developers`, nav, dashboard subtitle, a11y sweep, launch screenshots, and health sweep as done. |
| Accessibility baseline | Done | Phase 0/1 records axe-core 0 violations across 6 routes; Lighthouse a11y 100 on `/`, 95 on `/developers`. |
| MCP package | Code exists | `mcp-ts/` has tool implementations, transport, x402 wiring, metrics, Dockerfile, unit tests, and README. |
| Webhook channel | Code exists | `crates/dispatcher-rs/src/webhook.rs`, queries, migration `0022`, API routes, `/account/webhooks`, and 3 reference receivers exist. |
| API hardening | Mostly done | CORS allowlist, X-Forwarded-For rate-limit extraction, JWT min length, Redis auth in compose, bot constant-time internal secret compare. |
| Security audit | Done, needs status addendum | `docs/security/audit-2026-05-26.md` exists; several HIGH/MEDIUM findings are already remediated in code. |
| Competitive reframe | Done | Chaos/StableGuard/agent-oracle positioning captured in landscape docs and outreach docs. |

## Not ready yet

| Gate | Current truth | Why it matters |
|---|---|---|
| `docs/CALIBRATION-v1.md` | Missing / pending | This is the most important trust artifact. Without it, "oracle" still reads as marketing. |
| 14-day dogfood | Pending | Needed to prove thresholds, false positives, and per-asset p95/p99 behavior. |
| MCP devnet/mainnet paid-call proof | Pending in `docs/CALIBRATION-v2-mcp-spike.md` | Do not claim x402 mainnet production until one real paid call is recorded with tx signature. |
| MCP directory listings | Pending operator action | Smithery/mcp.run docs are templates, not listings. |
| Webhook 7-day dogfood | Not proven | Signed webhook code exists, but public launch should show success rate and one real receiver. |
| Launch content | Draft plan exists, artifacts not created | Twitter/HN/Superteam/Awesome Solana docs still need concrete files. |
| Protocol integration | Not yet confirmed | Phase 3 should aim for at least one written integration/quote before strong social-proof claims. |

## Product gaps to add before loud launch

### P0 launch blockers

1. **Calibration report**
   - Create `docs/CALIBRATION-v1.md`.
   - Include per-asset p50/p95/p99, alert count, false positives, threshold deltas, and notes by mechanism class.
   - Publish a summarized version on `/methodology` or `/status` before broad launch.

2. **MCP payment proof**
   - Complete `docs/CALIBRATION-v2-mcp-spike.md`.
   - Record devnet run, then first mainnet paid call with tx signature.
   - Only after this should launch copy say "paid via x402 on Solana mainnet."

3. **Webhook dogfood proof**
   - Register Rafael's own Cloudflare Worker receiver.
   - Run at least 7 days.
   - Record delivery count, success rate, p99 dispatch latency, and any dead letters.

4. **Security audit status**
   - Add an addendum to `docs/security/audit-2026-05-26.md` mapping each finding to `fixed`, `pending`, or `accepted`.
   - Launch should not quote "security audit done" while the document still says unresolved HIGH findings.

5. **Accurate asset count everywhere**
   - Current `assets.toml` has 27 entries, 5 inactive (`BRZ`, `JupUSD`, `EURC`, `dzSOL`, `vSOL`), therefore **22 active assets** (verified 2026-05-29).
   - Use "22 active assets" or "20+ Solana pegged assets" in launch copy. Avoid "23 active" or "25 active" unless the DB/UI truly exposes that number.
   - Source of truth: `grep -cE "^active\s*=\s*false" assets.toml` → 5 inactive; total symbols 27; 27 − 5 = 22.

### P1 high-leverage improvements

1. **Alert evidence pages**
   - Route: `/events/{alert_id}`.
   - Show intrinsic, market, route/source, timestamps, confidence, threshold, EWMA, hysteresis, state transition, and raw JSON.
   - This is the page a protocol can link to when explaining a risk action.

2. **Confidence labels in public payloads**
   - Engine already computes Pyth-derived confidence labels.
   - Make sure REST, WS, MCP, webhook, bot, and asset pages expose it consistently.
   - Add reasons later: `thin_market`, `pyth_conf_low`, `source_stale`, `single_source`.

3. **OpenAPI + agent discovery**
   - Add `/openapi.json`.
   - Add `/llms.txt`.
   - Add a small `/developers/agents` or section under `/developers#mcp` with tool catalog, example prompts, and known limitations.

4. **Webhook test endpoint**
   - Add a self-service "send test webhook" action from `/account/webhooks`.
   - It should send a signed sample payload and show delivery result.

5. **Integration packet**
   - Create `docs/launch/integration-checklist.md`.
   - Include read-only path, webhook path, failure semantics, dedupe rules, confidence handling, and "what not to use Pegana for."

6. **One agent demo**
   - A small public demo where an agent refuses to allocate into an asset when Pegana state is not `PEGGED`.
   - This proves "AI as user" better than a claim in the hero.

## Competitive truth

Pegana should not sell itself as smaller Chaos Labs. Chaos Labs is the institutional horizontal risk platform. Pegana's defensible lane is narrower: **Solana peg-state by mechanism semantics**.

The closest product pressure is not Chaos today. It is:

- **StableGuard / Webacy / StableLens-style trust packaging:** methodology, scoring, API docs, evidence exports, status, security, pricing clarity.
- **Alertio-style notification breadth:** they win if the buyer wants generic DeFi alerts; Pegana wins if the buyer wants peg-state correctness.
- **Generic oracles:** they win price distribution; Pegana wins by explaining whether the price is lying relative to the asset's own mechanism.

Therefore the launch narrative must be:

> Price oracles tell you what it traded at. Pegana tells you whether the peg mechanism is still intact.

## Phase 3 sequencing

Phase 3 should be split into two tracks:

1. **Phase 3A — launch prep now**
   - Draft launch content.
   - Prepare screenshots/GIFs.
   - Build integration checklist.
   - Prepare outreach messages.
   - Submit MCP directory templates once endpoint is live.

2. **Phase 3B — public launch after gates**
   - Calibration report committed.
   - MCP paid mainnet proof recorded.
   - Webhook dogfood recorded.
   - Security audit addendum current.
   - At least one real integration, agent demo, or credible dogfood story ready.

Do not run the major public launch until Phase 3B gates are green. Quiet outreach and private demos can start during 3A.

## Recommended next docs/code tasks

| Priority | Task | File / surface |
|---|---|---|
| P0 | Update Phase 3 plan to separate prep vs launch gates | `docs/superpowers/plans/2026-05-26-pegana-v2-phase-3-distribution.md` |
| P0 | Add security audit remediation addendum | `docs/security/audit-2026-05-26.md` |
| P0 | Start calibration artifact | `docs/CALIBRATION-v1.md` |
| P0 | Complete MCP spike artifact | `docs/CALIBRATION-v2-mcp-spike.md` |
| P1 | Add integration checklist | `docs/launch/integration-checklist.md` |
| P1 | Add launch drafts | `docs/launch/*.md` |
| P1 | Add evidence-page spec | new v2.1 spec or Phase 3 hardening addendum |
| P1 | Add OpenAPI/llms.txt spec | new v2.1 spec or Phase 3 hardening addendum |
