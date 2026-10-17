# Validation Verdict — Post-QA Execution Sweep

**Date:** 2026-05-30
**Auditor:** Strict skeptical verifier (read-only)
**Scope:** Post-QA execution of B-017..B-028 + MCP-DEVNET P0, per
`docs/operations/qa-comprehensive-2026-05-29.md` and `HANDOFF-2026-05-29.md`.
Executor claims in `docs/operations/post-qa-execution-2026-05-29.md` treated as
unverified assertions.

---

## 1. OVERALL VERDICT: 🟡 YELLOW — deploy ok after 2 small fixes

The backend (Rust API), SDK, web onboarding/uptime, web redirect routes, and the
MCP-DEVNET P0 ADR/config work are all genuinely correct and complete. Two real
defects block a clean deploy, and both are small and localized:

1. **B-025 bot regression** — the helpers.ts UPPERCASE flip breaks 3 bot tests and
   silently drops pt-BR localization. Must be fixed before the bot redeploys.
2. **B-027 incomplete** — 2 of 5 docs `<Link>`s (the global desktop + mobile nav
   Docs links) still prefetch `/docs` and will keep firing the QA-reported 404 on
   every marketing page. Must be fixed before the web deploy claims B-027 closed.

A third, non-blocking but important issue: the execution report
(`post-qa-execution-2026-05-29.md`) is **stale and self-contradictory** — it claims
B-022 and B-025/helpers.ts were "not edited" when the working tree clearly edited
both. A human following its deploy runbook would mis-scope the rebuild. This does not
block deploy but must be reconciled so the operator runs the right deploy steps.

These were independently re-verified by this auditor (not taken from the executor):
`bun test test/helpers.test.ts` → **60 pass / 3 fail**; `grep` of
`marketing-header.tsx:44` and `mobile-menu.tsx:138` → both `<Link href={DOCS_HREF}>`
with **no `prefetch={false}`**; `git diff bot-ts/src/helpers.ts` → confirms
`CRITICAL: "Crítico"` → `"CRITICAL"` in COPY_PT.

---

## 2. ITEM-BY-ITEM TABLE

| Item | Verdict | Blocker? | Key issue (one line) |
|------|---------|----------|----------------------|
| P0 MCP-DEVNET | PASS | No | Repo env flipped to canonical mainnet genesis + ADR-0018 written; prod `.env` flip remains a (correctly-scoped) human step. |
| B-017 onboarding "23" + fabricated uptime | PASS | No | "23" now bound to live `useStats()`/`assets_tracked`; fabricated 99.97% uptime replaced with live PEGGED count. |
| B-027 docs RSC prefetch | **INCOMPLETE** | **YES** | Only 3 of 5 docs Links fixed; global nav desktop+mobile Docs Links (via `DOCS_HREF` const) still prefetch → 404 persists site-wide. |
| B-025 peg-state casing (bot) | PASS (code) / **REGRESSION** | **YES** | UPPERCASE flip is correct per the decision, but breaks 3 bot tests and drops pt-BR `Crítico` localization. |
| B-018/019/021 alerts limit | PASS (justified deviation) | No | `validate_limit()` → 400 "limit must be 1..=500"; used `(StatusCode,String)` since `ApiError::BadRequest` doesn't exist — correct adaptation. |
| B-020 bucket validation | PASS (justified deviation) | No | Scope-corrected to `/assets/{symbol}/history` (the only endpoint with a `bucket` param); 400 guard before branch consumption. |
| B-022 assets cache | PASS (justified deviation) | No | Caddy `cache{}` would crash stock `caddy:2`; swapped to Redis SETEX 5s memo, non-fatal fallback, shape unchanged. |
| B-023/B-024 web redirects | PASS | No | New Next-16 server-component redirects; await params + encodeURIComponent; route groups correct; default 307. |
| B-028 SDK phantom `cluster` | PASS | No | `cluster: string` removed from `OnchainCommitment`; grep `cluster` in sdk/ → 0; matches prod API shape. |
| B-026 id/alert_id | PASS (flag-only correct) | No | Non-bug confirmed by live curls — response field is `id` everywhere; QA premise was a misread of the path param. |
| deploy-sequence | PASS (justified deviation) | No | Step 3 force-recreates mcp-ts before step 4 fixes server env — ordering must be corrected (see §4). |
| completeness | **FAIL** | **YES** | Carries the B-025 regression + stale execution report; otherwise all items applied/deferred-with-reason. |
| builds (web/rust/bot) | PASS | No | Fresh re-run: web tsc = 6 pre-existing env-only TS2307 (no fix-introduced errors); cargo check clean; bot `tsc --noEmit` clean (but bot *tests* fail — see B-025). |

**Tally:** 7 PASS · 4 PASS-with-justified-deviation · 1 INCOMPLETE · 1 FAIL
(completeness, driven by the B-025 regression). No item is irredeemably broken; both
blockers are small.

---

## 3. BLOCKERS-BEFORE-DEPLOY (must fix first)

1. **B-025 bot regression (P1).** `bot-ts/src/helpers.ts` UPPERCASE flip breaks 3
   tests in `test/helpers.test.ts` (lines 196, 245, 274 assert `toContain("Drift")`,
   headlines now render `DRIFT`). The executor never ran the bot suite. **Fix:**
   update those 3 test expectations to the new UPPERCASE labels (the decision to
   uppercase was the human's intended outcome, so the *tests* are what's stale — but
   they MUST be reconciled and green before the bot ships).
2. **B-025 pt-BR localization loss (P1, UX).** Same edit changed
   `CRITICAL: "Crítico"` → `"CRITICAL"` in `COPY_PT`. Portuguese Telegram headlines
   now read English/shouting `CRITICAL`. **Decision needed:** the chosen convention
   is "UPPERCASE state labels in both locales" — if that is truly intended, keep it
   and just fix the tests; if localized casing was meant to survive, restore
   `Crítico` (uppercased to `CRÍTICO`) for pt-BR. Confirm intent before bot redeploy.
3. **B-027 incomplete (P1).** Add `prefetch={false}` to the two nav Docs Links:
   `web/components/organisms/marketing-header.tsx:44` (`<Link href={DOCS_HREF}>`) and
   the mobile nav Link at `web/components/molecules/mobile-menu.tsx:138` (which
   renders `mobileLinks`, including the `DOCS_HREF` entry). Until then the docs
   prefetch 404 that QA logged persists on **every** marketing page, so B-027 cannot
   be marked closed.

> Note: the MCP-DEVNET prod `.env` flip + force-recreate + the "x402 mainnet LIVE /
> 7 settlements" GTM-claim retraction + Solscan verification are **human/operator
> blockers for the GTM claim's truthfulness** (the claim stays untruthful until done
> before the 2026-06-11 verdict gate). They are correctly scoped as human steps and
> are not code blockers for the repo-side deploy, but they ARE prerequisites before
> any "mainnet live" external messaging.

---

## 4. DEPLOY-SEQUENCE CORRECTIONS

The 6-step plan is mostly sound but has one ordering defect and several scoping
corrections forced by the stale execution report:

1. **REORDER the MCP steps.** As written, step 3 runs `deploy.sh` (which includes
   mcp-ts in SERVICES) and force-recreates mcp-ts while the server `~/pegana/.env`
   is **still on devnet** — step 4 only fixes the env afterward. This means mcp-ts is
   recreated once on devnet, then must be recreated *again*. **Fix the order:** edit
   the live `~/pegana/.env` (SOLANA_NETWORK → mainnet genesis + CDP facilitator keys)
   **FIRST**, then `git pull`, then `docker compose up -d --force-recreate mcp-ts`
   (NOT `restart` — restart does not re-read env). I.e. **.env-before-mcp-ts-recreate**.
2. **Scope correction — B-022 requires a full Rust rebuild, not config-only.** The
   execution report wrongly says B-022 was "not edited." The working tree DOES contain
   the Redis SETEX memo in `crates/api-rs/src/routes/assets.rs`, so the api container
   needs a full `scripts/deploy.sh` rebuild + force-recreate, not a `--config-only`.
   Do not let the operator skip this believing B-022 was never coded.
3. **Scope correction — B-025 IS a bot code change.** The report says helpers.ts was
   "left UNTOUCHED." It was edited. The bot must be rebuilt/redeployed via
   `scripts/deploy.sh` — but only AFTER the 3 tests are green (blocker §3.1).
4. **Web (B-017, B-027, uptime, B-023, B-024) → Vercel via main** — but hold the
   "B-027 closed" claim until the two nav Links are fixed.
5. **Repo MCP-config default** (docker-compose.yml:161 + mcp-ts/.env.example:34) is a
   repo edit only; it does NOT change prod by itself. Prod is governed by the live
   `~/pegana/.env` override (step 1 above).

---

## 5. GAPS (QA/HANDOFF items not addressed, not explicitly deferred)

- **ADR-0018 §3 self-inconsistency (minor, documented-recipe not applied).** The
  executor-authored ADR-0018 §3 prescribes also flipping the compose
  `X402_FACILITATOR_URL` default to mainnet/CDP, but `docker-compose.yml:159` and
  `mcp-ts/.env.example:24` still default to the devnet-only `x402.org/facilitator`.
  Low impact (mcp-ts auto-routes to CDP when `CDP_API_KEY_*` are present), but it is a
  recipe item the ADR itself mandates and silently didn't apply. Either apply it or
  amend the ADR to match the "CDP-gated, default left as-is" reasoning.
- **Execution report integrity (process gap, not a code gap).** `post-qa-execution-
  2026-05-29.md` §1/§2(row B-022 ~L27)/§4/§7 contradict the actual working tree for
  B-022 (claims "proposed/no edit") and B-025 (claims helpers.ts "UNTOUCHED"). Memory
  + ROADMAP say "applied" correctly; the execution report is the odd one out and must
  be reconciled so the deploy runbook is scoped correctly.
- **AMENDMENTS.md / ADR-0018 relationship label (cosmetic).** AMENDMENTS row + ADR
  body describe "Amends ADR-0004," but the ADR header says "Supersedes: none / Amended
  by: none" and lists ADR-0004 only under "Related." Cosmetic, not a gap.
- **Out-of-scope honesty note (non-blocking, flagged not fixed).** The onboarding
  VisualConcept panel still hardcodes "Data sources = 6" and "Median tick = 1.2s" as
  illustrative figures under a "Live · system" header. Outside B-017 scope; worth a
  future ticket so these don't read as live telemetry.

Everything else from QA §5/§14/§16 and HANDOFF §5/§9 is either APPLIED-and-verified or
DEFERRED-with-reason (B-005/ADR-0017 and prior-batch B-006/B-007/B-011/B-013 correctly
remain deferred).

---

## 6. BOTTOM LINE

The sweep is **substantively good** — the Rust API validation/cache fixes, SDK cleanup,
web onboarding/uptime de-fabrication, the redirect routes, and the MCP-DEVNET ADR are
all genuinely correct (several with *justified* deviations from the QA recipe, e.g.
Redis memo instead of a Caddy directive that would have crashed the stock `caddy:2`
image, and `(StatusCode,String)` instead of a non-existent `ApiError::BadRequest`).
But do **not** ship as-is: (1) the B-025 bot label change breaks 3 bot tests and
silently drops the pt-BR `Crítico` localization — confirm the UPPERCASE-both-locales
intent, fix the tests, and only then redeploy the bot; (2) B-027 is only 3-of-5 done —
the two global-nav Docs Links still prefetch and will keep 404-ing on every marketing
page, so add `prefetch={false}` to `marketing-header.tsx:44` and `mobile-menu.tsx:138`
before calling it closed; and (3) ignore the execution report's "B-022/B-025 not
edited" claims — both WERE edited, so the API and bot need full rebuilds, and the MCP
deploy must do **.env-on-the-server-first, then force-recreate mcp-ts**. Land those two
small code fixes plus the doc reconciliation and this goes GREEN.
