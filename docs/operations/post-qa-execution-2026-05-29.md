# Post-QA Execution Report — 2026-05-29 sweep

**Worktree:** `/Users/rafazaum/Desktop/Projetos/pegana/.claude/worktrees/trust-layer`
**Branch:** `feat/jlp-asset-+-docs-sweep`
**Date executed:** 2026-05-30
**Status:** all edits UNCOMMITTED — human review + deploy pending. Nothing here was auto-run, committed, pushed, or deployed.

> **⚠️ RECONCILIATION (2026-05-30, post-validation).** This report was written by the first execution pass. TWO more fixes were applied to the working tree afterward, so the original wording below for **B-022** and **B-025** is STALE — trust the working tree:
> - **B-022 = APPLIED** (not "proposed"): a Redis SETEX 5s memo is in `crates/api-rs/src/routes/assets.rs` → the **api** container needs a full `scripts/deploy.sh` rebuild.
> - **B-025 = APPLIED** (not "already-fixed/untouched"): `bot-ts/src/helpers.ts` `stateLabels` flipped to UPPERCASE in both locales; the 3 now-stale assertions in `bot-ts/test/helpers.test.ts` were updated (suite **63 pass / 0 fail**) → the **bot** container needs a full rebuild.
> - **B-027 = NOW COMPLETE** (was 3/5): the two global-nav Docs Links (`marketing-header.tsx:44`, `mobile-menu.tsx:143`) also got `prefetch={false}`.
> - **P0 (DONE + verified 2026-05-30):** root cause was `SOLANA_NETWORK=devnet` ONLY. The facilitator was already CDP (mcp-ts uses CDP whenever `CDP_API_KEY_ID`+`CDP_API_KEY_SECRET` are set — both present; it IGNORES `X402_FACILITATOR_URL` and NEVER reads `CDP_WALLET_ID`, per `mcp-ts/src/x402.ts:45`). Fixed by editing `~/pegana/.env` `SOLANA_NETWORK` → `solana:5eykt4…` (mainnet) + `docker compose up -d --force-recreate mcp-ts` → verified mainnet/healthy/200. No CDP_WALLET_ID, no facilitator change. See ADR-0018 §Clarification. **Still pending:** Solscan check of the 7 settlements + claim retraction.

---

## 1. Executive summary

A multi-phase recon + fix pass against the Trust Layer QA backlog (B-017..B-028 + the MCP-DEVNET P0 probe). **Applied** (code edited, left uncommitted): B-017 + uptime (live `/v1/stats` wired, fabricated 99.97% removed), B-027 (`prefetch={false}` on all `/docs*` Links), B-023 + B-024 (new redirect routes `/assets/[symbol]` → `/asset/...` and `/live` → `/#live`), B-018/B-019/B-020/B-021 (Rust input validation now 400s on bad `limit`/`bucket`), B-028 (phantom `cluster` field removed from the TS SDK), and the MCP-DEVNET **repo default** footgun (compose + `.env.example` now fail-safe to mainnet). **Proposed** (no edit, design captured): B-022 perf (in-handler 5s memo of `/v1/assets`; Caddy cache plugin is NOT compiled so the Caddyfile was deliberately untouched). **Flag-only:** B-026 (the hypothesized `id` vs `alert_id` divergence does NOT reproduce — only a structural `.alert` wrapper inconsistency remains; renaming would be breaking). **Already-fixed / false-positive:** B-025 (every in-scope surface already UPPERCASE; the one genuine Title-Case label lives out-of-scope in `bot-ts/src/helpers.ts`). **B-005 stays deferred (P2 cosmetic semantics; the `commit_status` enum is defined in ADR-0004 and the `/onchain` behaviour is at spec `07-api-surface.md:159` — NOT ADR-0017, which is unrelated to this endpoint).** Both build gates pass: web `tsc` has zero fix-introduced errors (6 pre-existing env-only TS2307s), `cargo check -p api-rs` is clean. **P0 VERDICT: DEVNET — REAL P0, BLOCKS the x402 "mainnet LIVE" GTM claim** (not the core Trust Layer calibration verdict). The live `mcp-ts` env on Hetzner resolves the devnet genesis hash AND the public devnet-only facilitator; the prior "RESOLVED / 7 mainnet settlements" claim must be retracted until those 7 signatures are verified on Solscan mainnet. ADR-0018 drafted (server env fix is a human step — probe was read-only).

---

## 2. Per-bug status table

| ID | Sev | Status | Files | Deploy path | Verify command |
|----|-----|--------|-------|-------------|----------------|
| **MCP-DEVNET** (prod env) | P0 | **proposed (server env — human only)** | server `~/pegana/.env` (host) | server-env + `deploy.sh --config-only --services 'mcp-ts'` | `ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T mcp-ts env \| grep -E "SOLANA\|X402"'` |
| MCP-DEVNET (repo default) | P0 | **applied** | `docker-compose.yml:161`, `mcp-ts/.env.example:34` | `deploy.sh --config-only` | `grep -n "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" docker-compose.yml mcp-ts/.env.example` |
| B-017 | P1 | **applied** | `web/components/organisms/onboarding-modal.tsx` | vercel | `curl -s https://api.pegana.xyz/v1/stats \| jq .assets_tracked` → modal shows live count |
| B-018 | P1 | **applied** | `crates/api-rs/src/routes/alerts.rs` | deploy.sh | `curl -s -o /dev/null -w '%{http_code}' 'https://api.pegana.xyz/v1/alerts?limit=-1'` → 400 |
| B-019 | P1 | **applied** | `crates/api-rs/src/routes/alerts.rs` | deploy.sh | `curl -s -o /dev/null -w '%{http_code}' 'https://api.pegana.xyz/v1/alerts?limit=0'` → 400 |
| B-020 | P1 | **applied** (scope-corrected: bucket lives on `/v1/assets/{symbol}/history`, not `/v1/alerts`) | `crates/api-rs/src/routes/assets.rs` | deploy.sh | `curl -s -o /dev/null -w '%{http_code}' 'https://api.pegana.xyz/v1/assets/USDC/history?bucket=invalid'` → 400 |
| B-021 | P1 | **applied** | `crates/api-rs/src/routes/alerts.rs` | deploy.sh | `curl -s -o /dev/null -w '%{http_code}' 'https://api.pegana.xyz/v1/alerts?limit=999999'` → 400 |
| B-022 | P2 | **applied** (Redis SETEX 5s memo, non-fatal fallback) | `crates/api-rs/src/routes/assets.rs` (Caddyfile untouched — stock `caddy:2` has no cache plugin) | deploy.sh (full Rust rebuild) | `for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{time_total}\n' https://api.pegana.xyz/v1/assets; done` → median < 0.3s |
| B-023 | P1 | **applied** | `web/app/(app)/assets/[symbol]/page.tsx` (new) | vercel | `curl -s -o /dev/null -w '%{http_code}' -L https://pegana.xyz/assets/USDC` → 200 (307→/asset/USDC) |
| B-024 | P1 | **applied** | `web/app/(marketing)/live/page.tsx` (new) | vercel | `curl -s -o /dev/null -w '%{http_code}' -L https://pegana.xyz/live` → 200 (307→/#live) |
| B-025 | P1 | **applied** — core already UPPERCASE; bot `helpers.ts` flipped + 3 tests updated (63/0) | `bot-ts/src/helpers.ts`, `bot-ts/test/helpers.test.ts` | deploy.sh (bot rebuild) | `curl -s https://api.pegana.xyz/v1/assets \| jq -r '.[].state' \| sort -u` → all UPPERCASE |
| B-026 | P2 | **flag-only (diverges from handoff — no `id`/`alert_id` rename bug)** | none | none | `curl -s https://api.pegana.xyz/v1/alerts?limit=1 \| jq '.[0].id'`; `curl .../v1/audit/<id> \| jq '.alert.id, .alert.alert_id'` → `.alert.alert_id` is null |
| B-027 | P1 | **applied** (also verified GONE in PROD by recon) | `web/components/molecules/util-strip.tsx`, `web/components/organisms/hero-landing.tsx`, `web/components/organisms/channels-section.tsx` | vercel | `curl -s -o /dev/null -w '%{http_code}' -L 'https://www.pegana.xyz/docs?_rsc=test'` → 200 (no console 404) |
| B-028 | P2 | **applied** | `sdk/typescript/src/index.ts` | sdk-publish | `grep -rn "cluster" sdk/` → no match |
| **uptime** (fabricated 99.97%) | P1 | **applied** | `web/components/organisms/onboarding-modal.tsx` | vercel | `grep -n "99.97" web/components/organisms/onboarding-modal.tsx` → only a comment, no rendered literal |
| B-005 | — | **deferred (P2 semantics; ADR-0004 + spec `07-api-surface.md:159`)** | none | none | P2 cosmetic — `/onchain` returns `not_committed_yet` for `not_applicable`; ~1h post-launch fix, not blocked by any ADR |

---

## 3. P0 — MCP-DEVNET

**Verdict: DEVNET. Real P0. Blocks the x402 "mainnet LIVE" claim (NOT the core Trust Layer calibration verdict).**

A read-only SSH probe of the production Hetzner host (`<prod-host>`, HEAD `c59132a`, all **11 containers Up/healthy**) on 2026-05-30 showed the live `mcp-ts` container env resolving:

```
SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   # DEVNET genesis hash
X402_FACILITATOR_URL=https://x402.org/facilitator        # public, devnet-only facilitator
CDP_API_KEY_ID=<present>
CDP_API_KEY_SECRET=<present>
```

The mainnet-beta genesis hash is `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. Two compounding defects:

1. **Network is devnet.** Every x402-paid MCP call in production has been settling in DEVNET USDC (no market value). `docker-compose.yml:161` hardcoded the devnet genesis hash as the fallback default, so any env without an explicit mainnet override silently runs devnet. (This repo default is now **applied/fixed**, fail-safe to mainnet — but the live host `~/pegana/.env` override is what governs prod and is unchanged by a repo edit.)
2. **Facilitator is devnet-only.** `X402_FACILITATOR_URL` is the public `x402.org/facilitator`, not the Coinbase CDP facilitator the memory claimed was swapped in — even though CDP keys ARE present. The intended mainnet path was never actually the active settlement path.

This contradicts `project_x402_facilitator_block.md` ("RESOLVED / MCP paid mainnet LIVE … 7 on-chain settlements as of 2026-05-27").

### Recommended action (human-executed — probe was strictly read-only)

On the host `~/pegana/.env`, set:
```
SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
```
then `docker compose up -d --force-recreate mcp-ts` (**force-recreate, NOT restart** — restart does not re-read env). Verify:
```
docker compose exec -T mcp-ts env | grep -E "SOLANA|X402"
```
Then **retract** the "mainnet LIVE / 7 on-chain settlements" claim from README/marketing/memory until the 7 signatures are verified on Solscan mainnet. Re-date the "first mainnet settlement" milestone to the first real call issued AFTER the env fix (confirm `PEGANA_PAYTO_USDC` + CDP wallet funded/correct first, to avoid a second false claim).

### Settlements check plan (verify the 7 cited settlements)

1. **Gather the 7 signatures** — read from prod Postgres (read-only), e.g. `docker compose exec -T postgres psql -U pegana -d pegana -c "select signature, network, amount, created_at from settlements order by created_at limit 10;"` (confirm table/column names via `\dt`/`\d` first). Alternatively grep commit `dc1b3c9`'s diff/fixtures for the literal signatures, or read the recipient wallet (`PEGANA_PAYTO_USDC`) tx history.
2. **Check mainnet** — `https://solscan.io/tx/<sig>` (defaults to mainnet-beta). Valid USDC transfer = real mainnet; "transaction not found" = not on mainnet.
3. **Cross-check devnet** — `https://solscan.io/tx/<sig>?cluster=devnet`. Given the live env is devnet, expect all 7 to resolve here.
4. **Programmatic** — `getTransaction` RPC against both clusters; whichever returns non-null is where it settled:
   ```
   curl -s https://api.mainnet-beta.solana.com -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["<sig>",{"maxSupportedTransactionVersion":0}]}'
   curl -s https://api.devnet.solana.com -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["<sig>",{"maxSupportedTransactionVersion":0}]}'
   ```
5. **Verdict** — all 7 devnet-only → retract the "7 mainnet settlements" claim; first true mainnet settlement is the post-ADR-0018 call. Some/all mainnet → claim holds for those sigs but env later regressed (still a current-state P0).

### ADR-0018 draft (apply if verdict = devnet — it is)

```markdown
# ADR-0018: MCP x402 ran on devnet in production — mainnet claim retraction

- **Status:** Accepted
- **Date:** 2026-05-30
- **Supersedes:** none
- **Amends:** ADR-0004 (on-chain commit policy) — clarifies settlement-network invariant for x402 paid tools
- **Related:** ADR-0011 (mcp verify-alert free with telemetry)

## Context

A read-only SSH probe of the production Hetzner host (<prod-host>, HEAD `c59132a`, all 11 containers
healthy) on 2026-05-30 showed the live `mcp-ts` container environment resolving:

    SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   # DEVNET genesis hash
    X402_FACILITATOR_URL=https://x402.org/facilitator        # public, devnet-only facilitator
    CDP_API_KEY_ID=<present>
    CDP_API_KEY_SECRET=<present>

`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` is the devnet genesis hash; the mainnet-beta hash is
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. Every x402-paid MCP call in production has been settling in
DEVNET USDC (no market value). This contradicts the public claim and `project_x402_facilitator_block.md`
asserting "MCP paid mainnet LIVE … 7 on-chain settlements as of 2026-05-27." Two compounding defects:

1. `SOLANA_NETWORK` resolves to devnet. `docker-compose.yml:161` hardcodes the devnet genesis hash as
   the fallback default, so any environment lacking an explicit mainnet override silently runs devnet.
2. `X402_FACILITATOR_URL` is the public x402.org facilitator (devnet-only), not the Coinbase CDP
   facilitator. CDP keys ARE present, yet the explicit facilitator URL + devnet network mean the
   intended mainnet path was never the active settlement path.

## Decision

1. **Settlement-network invariant.** Production `mcp-ts` MUST resolve
   `SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet-beta) and MUST route x402
   settlement through the Coinbase CDP facilitator (`https://api.cdp.coinbase.com/platform/v2/x402`).
   The public `x402.org/facilitator` is devnet-only and MUST NOT be the active facilitator in prod.

2. **Env fix + force-recreate (operator action, human-executed).** In `/opt/pegana/.env` (`~/pegana/.env`):
       SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
       X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
   then `docker compose up -d --force-recreate mcp-ts` (NOT restart — restart does not re-read env).
   Verify with `docker compose exec -T mcp-ts env | grep -E "SOLANA|X402"`.

3. **Remove the devnet footgun.** Change `docker-compose.yml:161` so the fallback is mainnet (or remove
   the default and fail fast on absence). Same treatment for `X402_FACILITATOR_URL:159`.

4. **Retract the mainnet claim until verified.** Pull "MCP paid mainnet LIVE / 7 on-chain settlements"
   from README/marketing/memory until the 7 settlement signatures are confirmed on Solscan mainnet. If
   they resolve only on devnet, reword GTM to "MCP paid tools wired; mainnet settlement pending verification."

5. **Block the verdict-gate claim.** This blocks the x402 "mainnet LIVE" GTM claim for the 2026-06-11
   verdict gate. It does NOT block the core Trust Layer (engine/API/web/bot), which are network-agnostic
   for the calibration verdict.

## Consequences

- Positive: settlement network becomes an explicit, verified invariant; the silent devnet default is
  eliminated; the GTM claim becomes truthful or is retracted.
- Negative / cost: any "first mainnet settlement" milestone must be re-dated to the actual post-fix
  mainnet call; prior "7 settlements" evidence is likely invalidated and must be regenerated on mainnet.
- Risk: a real mainnet paid call costs real USDC — confirm `PEGANA_PAYTO_USDC` and the CDP wallet are
  funded/correct before re-issuing the milestone call, to avoid a second false claim.
```

---

## 4. B-025 casing — convention applied

**Applied convention: UPPERCASE (docs/API alignment) — and in the authorized scope, ZERO edits were required because every surface already honors it.**

- **Prod ground truth:** `GET /v1/assets` distinct states = `['DEPEG','PEGGED']`; the engine's full set is `DRIFT / DEPEG / CRITICAL / BLACK_SWAN / PEGGED / UNKNOWN`. Serde enum at `crates/common-verify/src/lib.rs:278` is `rename_all="UPPERCASE"` — left untouched.
- **`docs/pegana-trust-layer-v0.1.0/**`:** every peg-state VALUE token is already UPPERCASE. Mixed-case hits are all non-labels: Rust enum identifiers (`PegState::Drift`), the protocol name "Drift", or the English adjective "Critical".
- **`web/app/(marketing)/agents/page.tsx`:** already emits UPPERCASE (`e.to_state === "DRIFT"`, `` `Pegana ${e.to_state}` ``). Only CamelCase grep hit is a source comment.
- **`bot-ts/locales/en.ftl` + `pt-BR.ftl`:** CamelCase hits are glossary HEADWORDS (`<b>Drift</b>`, `<b>Depeg</b>`, `<b>Black Swan</b>`) and the "Drift" protocol name; both files already use UPPERCASE for actual state references (e.g. "between PEGGED and DEPEG"). No change.

**Out-of-scope finding (left UNTOUCHED, flagged for the human):** the bot's only genuine human-facing peg-state VALUE label that is NOT UPPERCASE lives in `bot-ts/src/helpers.ts` — `COPY_EN.stateLabels` (`:165-170`) and `COPY_PT.stateLabels` (`:197-202`) map UPPERCASE engine states to Title-Case labels (`DRIFT→"Drift"`, `DEPEG→"Depeg"`, `CRITICAL→"Critical"/"Crítico"`, `BLACK_SWAN→"Black Swan"`, `PEGGED→"Pegged"`), emitted live in Telegram alert headlines (`:331` via `c.stateLabels[to.toUpperCase()]`). If B-025 intends alert headers to read `DRIFT` to match prod JSON, the fix belongs there (deploys via `scripts/deploy.sh`). It may be a deliberate UX choice (Title-Case reads cleaner in chat; pt-BR localizes `CRITICAL→"Crítico"`) — recommend the human decide before touching.

### Documented breaking alternative (REJECTED)

Flip serde at `crates/common-verify/src/lib.rs:278` from `rename_all="UPPERCASE"` to `rename_all="PascalCase"`, making the API emit `Pegged/Drift/Depeg/Critical/BlackSwan`. **Breaking** — changes the wire contract consumed by: (a) web string comparisons that switch on UPPERCASE `to_state` (`agents/page.tsx:93`); (b) the bot's `stateLabels` lookup (`helpers.ts:328`) and any literal `"DEPEG"` SQL/JSON filters; (c) SDK consumers + documented JSON examples (`04-data-model.md` `"to_state":"DRIFT"`, `12-acceptance-criteria.md` `?state=DEPEG`); (d) Atom/CSV exports. Would require touching all of those in lockstep, ideally with a dual-emit transition window — hence the chosen non-breaking direction (labels match prod, serde untouched).

---

## 5. Build / verify results

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| web typecheck | `bun run typecheck` (→ `tsc --noEmit`) in `web/` | **PASS (no fix-introduced errors)** | All edited fix files + 2 new redirect routes are TS-clean. |
| Rust check | `cargo check -p api-rs` | **PASS — zero errors, zero warnings** | Finished in 0.40s (cached); validation edits compile. |

**Pre-existing (NOT a fix to make):** `tsc` exits 1 with **6 environmental TS2307 "Cannot find module" errors** from a stale local `node_modules` — `@vercel/analytics/next` (in `bun.lock` but not installed) and `@sentry/nextjs` (declared in `package.json ^10.55.0` but absent from `bun.lock` AND `node_modules`). These hit `app/layout.tsx:3`, `instrumentation.ts:16`, `next.config.ts:2`, `sentry.client/edge/server.config.ts`. They are unrelated to every fix and will NOT manifest on Vercel (fresh install on build).

**Action for the human (optional, local-only):** run `bun install` in `web/` to sync `node_modules`. Note `bun.lock` is missing the `@sentry/nextjs` entry, so a lockfile update may be needed. Not done here per no-mutate instruction. tsc is the authoritative gate and passed for all fixes.

---

## 6. DEPLOY RUNBOOK (human-executed, AFTER validating the diff — nothing here is auto-run)

### A. Review
```
cd /Users/rafazaum/Desktop/Projetos/pegana/.claude/worktrees/trust-layer && git diff
```
Validate every change. New files (`git status`): `web/app/(app)/assets/[symbol]/page.tsx`, `web/app/(marketing)/live/page.tsx`.

### B. Commit on `feat/jlp-asset-+-docs-sweep`
Suggested single message:
```
fix(qa): post-QA sweep — web redirects/links/onboarding + API validation + SDK + MCP devnet default

- web: B-017 live asset count + remove fabricated 99.97% uptime (onboarding-modal)
- web: B-027 prefetch={false} on /docs* Links; B-023 /assets/[symbol]→/asset; B-024 /live→/#live
- api-rs: B-018/019/021 alerts limit validation 400; B-020 history bucket validation 400
- sdk/ts: B-028 remove phantom OnchainCommitment.cluster
- compose+mcp .env.example: MCP-DEVNET repo default fail-safe to mainnet genesis hash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Or split web vs backend:
- **web commit:** `onboarding-modal.tsx`, `util-strip.tsx`, `hero-landing.tsx`, `channels-section.tsx`, `app/(app)/assets/[symbol]/page.tsx`, `app/(marketing)/live/page.tsx`.
- **backend commit:** `crates/api-rs/src/routes/alerts.rs`, `crates/api-rs/src/routes/assets.rs`, `docker-compose.yml`, `mcp-ts/.env.example`, `sdk/typescript/src/index.ts`.

### C. WEB deploy
Merge `feat/jlp-asset-+-docs-sweep` → `main`, push → Vercel auto-deploys. Ships: **B-017, B-027, uptime, B-023, B-024**, and the agents-page casing (no-op, already UPPERCASE).

### D. BACKEND deploy from `main`
- **Full rebuild** (any Rust change B-018..B-021, and bot `.ftl` casing if ever touched):
  ```
  scripts/deploy.sh
  ```
- **Config-only** (Caddyfile/compose: MCP repo default, and B-022 only IF the in-handler memo is later implemented — note that becomes a Rust change requiring full `deploy.sh`):
  ```
  scripts/deploy.sh --config-only
  ```
- Service name is **`mcp-ts`**. `deploy.sh` **force-recreates** (never `restart`).

### E. SERVER ENV (ONLY if P0 = devnet — IT IS)
Set in `~/pegana/.env` on the host:
```
SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
```
then:
```
scripts/deploy.sh --config-only --services 'mcp-ts'
```
Verify:
```
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T mcp-ts env | grep -E "SOLANA|X402"'
```

### F. Post-deploy smoke (re-run the recon probes)
- Asset count: `curl -s https://api.pegana.xyz/v1/assets | jq length` → 22 (modal now binds live; was the 23 literal).
- Docs RSC: `curl -s -o /dev/null -w '%{http_code}' -L 'https://www.pegana.xyz/docs?_rsc=test'` → 200, no console 404.
- Alerts validation: `curl -s -o /dev/null -w '%{http_code}' 'https://api.pegana.xyz/v1/alerts?limit=-1'` → 400 (repeat `limit=0`, `limit=999999`); `.../v1/assets/USDC/history?bucket=invalid` → 400.
- Distinct states: `curl -s https://api.pegana.xyz/v1/assets | jq -r '.[].state' | sort -u` → all UPPERCASE.
- p50 latency: `for i in $(seq 5); do curl -s -o /dev/null -w '%{time_total}\n' https://api.pegana.xyz/v1/assets; done` → target < 0.3s (B-022 still ~1.23s until memo lands).

---

## 7. Memory + ROADMAP updates (drafts for human review)

### Draft rows for `project_qa_bug_triage_2026_05_29.md`

```
B-017 (onboarding hardcoded "23 assets") — FIXED (web). Wired useStats()→/v1/stats assets_tracked
  via withLiveCount() {count} token in onboarding-modal.tsx; degrades to count-free copy pre-load.
uptime (fabricated 99.97% "Uptime 30d") — FIXED (web). No real 30d uptime source exists (/status
  documents it's mocked). Replaced cell with live by_state.PEGGED "Pegged now"; relabelled static
  pip caption "Universe · 23" → "Universe · illustrative".
B-018/019/021 (no /v1/alerts limit validation) — FIXED (api-rs/routes/alerts.rs). New validate_limit()
  returns 400 "limit must be 1..=500" for out-of-range; utoipa 400 response added. Handler is
  routes/alerts.rs, NOT the QA-suggested handlers/alerts.rs (does not exist).
B-020 (silent bucket fallback) — FIXED, SCOPE-CORRECTED. Bug is on /v1/assets/{symbol}/history
  (routes/assets.rs HistoryQuery), NOT /v1/alerts. VALID_BUCKETS=[raw,1m] guard → 400. Update QA
  doc section-15 path.
B-022 (/v1/assets p50 ~1.23s) — PROPOSED, not fixed. Caddy has NO cache plugin (stock caddy:2) —
  shipping a cache{} block would crash TLS for api/grafana/mcp. Recommend in-handler 5s TTL memo
  keyed on (class,peg) in routes/assets.rs::list (AppState has pg+redis). Confirmed still ~4x over.
B-023 (/assets/USDC 404) — FIXED (web). New app/(app)/assets/[symbol]/page.tsx redirects to
  /asset/${symbol} (encodeURIComponent for symbols like hyloSOL+).
B-024 (/live 404) — FIXED (web). New app/(marketing)/live/page.tsx redirect()→"/#live" (navbar
  links to the home #live anchor, not a route).
B-025 (peg-state casing) — ALREADY-FIXED in authorized scope (docs/.ftl/agents all UPPERCASE).
  Real Title-Case label is OUT OF SCOPE in bot-ts/src/helpers.ts stateLabels (:165-170/:197-202),
  emitted in Telegram headlines — left untouched; human to decide if alert headers must shout.
B-026 (id vs alert_id) — FLAG ONLY, DIVERGES from handoff. No id/alert_id rename bug exists: both
  /v1/alerts[].id and /v1/audit/{id}.alert.id use "id"; .alert.alert_id is null. Only structural
  divergence: alerts returns flat, audit nests under .alert (+confidence/discount/intrinsic_usd/
  market_usd). Renaming is breaking (web types + comparable-events + activity-timeline + events.xml
  + SDK). Not changed.
B-027 (/docs RSC prefetch 404) — FIXED (web) + verified GONE in PROD. prefetch={false} on all
  /docs* Links (util-strip, hero-landing, channels-section). webhooks page is a plain <a> (no
  prefetch) — left as-is.
B-028 (phantom SDK cluster field) — FIXED (sdk/typescript). Removed OnchainCommitment.cluster
  (API returns only {tx_sig, explorer_url}). Python SDK untyped → already aligned. Note: same type
  still has stray alert_id and omits explorer_url — future ticket.
MCP-DEVNET — P0 CONFIRMED (verdict: DEVNET). Live mcp-ts on Hetzner resolves devnet genesis hash +
  public devnet facilitator despite CDP keys present. Repo default footgun FIXED in compose:161 +
  .env.example:34 (fail-safe to mainnet). SERVER env fix is a human step (see ADR-0018). Retract
  "mainnet LIVE / 7 settlements" until Solscan-mainnet-verified.
B-005 — DEFERRED (P2 semantics; ADR-0004 enum + spec 07-api-surface.md:159, NOT ADR-0017). Unchanged.
```

Also apply the **`project_x402_facilitator_block.md` status flip** (REOPENED 2026-05-30 — was running DEVNET in prod; keep old RESOLVED body as superseded history) per the ADR-0018 context above.

### ROADMAP bug-matrix note

```
2026-05-30 post-QA sweep: 11 of 13 sweep bugs actioned (9 applied uncommitted, 2 proposed/flag).
Applied: B-017, uptime, B-018/019/020/021, B-023, B-024, B-027, B-028, MCP-DEVNET repo default.
Proposed: B-022 (in-handler memo; no Caddy plugin). Flag-only: B-026 (no rename bug — structural
wrapper only). Already-fixed/false-positive: B-025 (real label out-of-scope in bot helpers.ts).
P0 MCP-DEVNET CONFIRMED devnet → blocks x402 "mainnet LIVE" GTM claim for the 2026-06-11 verdict
gate (does NOT block core Trust Layer calibration). ADR-0018 drafted. B-005 stays deferred (P2 semantics; ADR-0004 + spec 07-api-surface.md:159, not ADR-0017).
All edits UNCOMMITTED on feat/jlp-asset-+-docs-sweep pending human review + deploy.
```

---

## 8. §9 done-checklist (live status)

| # | Item | Status |
|---|------|--------|
| 1 | **P0 verdict reached?** | YES — **DEVNET**, real P0, blocks the x402 "mainnet LIVE" claim (not the core calibration verdict). ADR-0018 drafted; server env fix is a human step. |
| 2 | **QA report committed?** | YES — already done (`f352f2a`). This execution report is additionally written to `docs/operations/post-qa-execution-2026-05-29.md` (uncommitted). |
| 3 | **B-017 fixed?** | YES — applied (uncommitted). Live `/v1/stats assets_tracked` wired into onboarding-modal; fabricated 99.97% uptime removed in the same file. |
| 4 | **B-027 fixed?** | YES — applied (uncommitted), `prefetch={false}` on all `/docs*` Links. Also independently verified GONE in PROD by recon (308→200, not 404). |
| 5 | **Memory update draft ready?** | YES — §7 above: `project_qa_bug_triage_2026_05_29.md` rows (B-017..B-028 + MCP-DEVNET) + the `project_x402_facilitator_block.md` REOPENED flip. |
| 6 | **ROADMAP note drafted?** | YES — §7 bug-matrix note above. |

---

*All findings observational/uncommitted. No production mutation. No commit/push/deploy performed. A human validates the diff and deploys per §6.*
