# Pegana — Roadmap

> **Updated 2026-08-11 — mobile + onboarding repaired, market feed shipped, and a silent
> production outage found.** The onboarding modal — the first thing every new visitor sees — was
> broken at 390 and 768: its content column used `justify-center` in a box shorter than its
> content, and centred overflow spills BOTH ways, so the heading rode 25px up into the step nav;
> two of five steps sat entirely off-screen. Root cause of why it shipped: `mobile-shell.spec.ts`
> is the only suite that runs at 390x844 and **every test in it dismisses the onboarding modal
> before rendering**, so the component had never been seen by Playwright at the viewport it broke
> on. A new `onboarding-modal.spec.ts` asserts no descendant paints outside the dialog box across
> all five steps at 390/768/1280; it failed six ways on main before any fix.
>
> Also shipped: the Telegram login widget's white box (the embedded document declared no
> `color-scheme`, so the UA painted an opaque light canvas under a transparent body — proven by
> painting the iframe element lime and watching the white survive) plus `data-lang="en"`, which
> had been serving a Portuguese button on an EN-only product; the tab-title template `"%s. Pegana"`
> → `"%s · Pegana"` with titles added to `/account` (5 routes) and `/heatmap`, which had been
> falling back to the 34-char marketing default; `/systemic`'s missing mobile card list; the
> `/account/subscriptions` threshold slider, which had ~0-20px of track at 390; four sub-44px
> touch targets that were each the ONLY way to perform their action on a phone.
>
> **Market feed** (floating pill, modelled on tokens.xyz's `floating-market-feed.tsx`, MIT):
> `/v1/news/feed` with our existing `TOKENS_XYZ_API_KEY` gives CoinGecko's curated feed with
> imagery, per-token, without a CoinGecko Pro subscription; an 8-feed RSS sweep is the fallback
> when the key is absent. Filters (articles/posts/size) persist and can never both be off.
>
> **`scripts/ci-local.sh`** mirrors `ci.yml` job-for-job because GitHub Actions is still blocked on
> billing ("recent account payments have failed or your spending limit needs to be increased").
> 13/13 locally, including the `verify-assets` job that shows red on GitHub — it is red for
> billing, not content: 72 checked / 0 failed.
>
> ⚠️ **Found by accident: the tokens.xyz key had been rotated and the production indexer ran
> blind on the old one** — `ok:0, errors:68` every 30 min and a 401 liquidity poll every 60s.
> Key replaced on the box (backup at `~/pegana/.env.bak.<epoch>`), indexer recreated, recovery
> confirmed: `ok:61, not_found:7, errors:0`.
>
> **The monitoring was not at fault, and this correction is the point.** I first recorded this as
> a silent outage and claimed the Prometheus rule counted polls rather than successes. Both were
> wrong, and verifying rather than asserting took four attempts:
> `PeganaTokensXyzRiskErrors` (`increase(...{status="error"}[1h]) > 10`) was loaded, fired, and
> its own description reads *"Likely an expired API key, a rate limit, or an upstream outage"*;
> Alertmanager routed it to `telegram-warning`, unsilenced; and its counters show
> **565 notifications delivered, 0 failed**. The alert reached Telegram. What failed was that
> nobody acted on it — an operational gap, not an instrumentation one, and no new rule fixes it.
>
> Two wrong turns worth remembering: I grepped `/etc/alertmanager/alertmanager.yml` (the unused
> image default, which does hold the `web.hook` example receiver) instead of `/tmp/alertmanager.yml`,
> the rendered file the process actually runs with; and I read "no notify lines in the log" as
> "nothing was sent", when Alertmanager logs delivery failures, not successes.

> **Updated 2026-08-10 — tokens.xyz open-sourced (MIT); mined and shipped.** Market-context
> enrichment live: holder count, 24h volume and liquidity for **62 of 69** assets via
> `risk-details?mint=` (migration 0075), plus a derived `market_depth` score. The asset page's
> liquidity dimension is now measured instead of a hardcoded 5-symbol set. New ops: `cargo xtask
> smoke` (latency-budgeted canary, wired into `deploy.sh` as a double pass), `cargo xtask hygiene`,
> stale-response fallback on `/v1/assets`, `scripts/secret-scan.sh`, 6 new alert rules.
> Migrations through **0076**; **68 active** assets (sharkSOL deactivated, see below); 650 Rust
> tests; 44 ADRs. Three production bugs found and fixed by monitoring the deploy, not by testing:
> Prometheus had been serving a rules file frozen since 08-04 (single-file bind mount pins the
> inode, `git reset --hard` replaces it) so **every alert-rule edit since then had been silently
> ignored**; a coverage alert I wrote would have paged on every indexer restart; and Sub-C's
> health-factor sources had been dark for 8 days.
>
> ⚠️ **Corrections to the 08-09 line below.** Sub-C is **partially** deployed, not fully: the
> aggregate exposure surface is healthy (11,465 rows/24h, free public REST), but the
> health-factor distribution has written **nothing since 2026-08-02** — the Helius plan allowance
> is spent, and both HF adapters were treating `429 max usage reached` as a retryable rate limit,
> burning ~31k wasted calls a day for 8 days. Fixed (classify, circuit-break, 10min → 60min
> cadence) but the data stays dark until the allowance resets or the plan changes. The public peg
> surface is now **67** published (68 active minus `synth_lev`), not 68.
>
> **Updated 2026-08-09 — Complete project audit + housekeeping. Methodology 0.7.0 in production since 2026-07-23; 68 assets on the public peg surface (72 canon · 69 active · 56 calibrated). Verifier CLI 0.5.2, three crates on crates.io, 39 REST endpoints + WebSocket + MCP. TypeScript SDK 0.3.1 on npm, Python SDK 0.3.0. 631 Rust tests, 631 vs 617 prior. Migrations through 0074. Sub-C Loop Intelligence deployed (31 assets, $837M, 2 protocols). Product is Technical Preview — engineering complete, Gates 1/3/5 PASS, Gates 2/4 BLOCKED (founder-gated non-engineering).**
> Canonical developer changelog: `docs-site/changelog.mdx`. Methodology history:
> `crates/methodology/CHANGELOG.md`. The dated sections below are the operator log, newest first.
>
> <details><summary>Historical banner (2026-06-22) — superseded, kept for the record</summary>
>
> Updated 2026-06-22 (deferred audit-roadmap batch — Phase 1+2 [Helius mask · F-41c · nonce-CSP · pepper] + **Phase 3 F-13b** [CLI v0.4.1 re-derivation released + engine schema-v2 deployed] all DEPLOYED, `main` at `8c200fd`, post-launch T+11). 2026-06-22: F-41b restore drill ✅ DONE (PASS); **CSP now ENFORCING** (`6bd25a0` — Telegram widget isolated in a sandboxed iframe, real login confirmed under enforce); v2 re-derive demonstrated. Open: F-06 deferred (only). **2026-06-22 (later): ✅ Phase 14 backtest BUILT + MERGED + LIVE** (`main` `a83cf2f`; `/backtest/2025-10-10-usde-depeg` deployed, in-browser receipt verify confirmed live). **⚠️ STRATEGIC SHIFT (see Current state — 2026-06-22): the bottleneck is now DEMAND/DISTRIBUTION, not more building.** Tech is strong (formula STRONG, /product-review 7.8), but willingness-to-pay is UNPROVEN (0 paying customers, thesis WEAK). Next priority = close tokens.xyz (Solana Foundation inbound), land 1 design partner, talk to 5-10 demand-side people — NOT another feature. ⏰ Jupiter key expires 30 Jun (indexer risk). Sentry browser tunnel returns 403 (founder action — DSN key/quota, pre-existing, no user impact).
> Trust Layer v0.1.0 is **LIVE and PUBLIC** since the 2026-06-11 launch (FEATURE_PUBLIC_ALERTS flipped). Calibration v1 verdict (2026-06-10): SHIP via DOWNGRADE of 5 LSTs to monitoring-only. Now in the **stability lock (2026-06-11 → 06-25)** — broken twice by founder call: (1) the methodology 0.4.0 honesty cluster (ADR-0025), ✅ DEPLOYED + VERIFIED LIVE 2026-06-15; **(2) the BETA RELEASE — all 13 `monitoring_only` assets un-gated and now alert publicly as "beta", ✅ DEPLOYED + VERIFIED LIVE 2026-06-16** (reverses the 06-12 egress gate; see "Current state — 2026-06-16"). **2026-06-18: grant M1 `anchor` field LIVE on `/v1/assets` (+ M1 reference adapter shipped); on-chain verification hardening + methodology proptest (53→72) merged; ✅ GitHub Actions billing RESOLVED (GitHub Pro) → CLI `v0.4.0` RELEASED via cargo-dist+Sigstore (signer-pin now reaches public CLI users; was v0.2.0). ✅ CI `bun audit` CVEs fixed (PR #86: shadcn→devDeps for web hono CVE, @opentelemetry/core 2.8.0 override for bot-ts). ✅ **Helius free-tier RPC swap LIVE in prod** (env-only `SOLANA_RPC_URL`; tested local then prod-verified: 87 NAV writes/90s, 19 assets, 0 RPC errors, indexer recreated, engine untouched). **2026-06-19: ✅ chat-leaked keys ROTATED** — tokens.xyz → prod host `.env` (correct var name `TOKENS_XYZ_API_KEY`; the local `.env` had the wrong `TOKENS_API_KEY`) via `deploy.sh --config-only --services indexer` (source active `published:14`, 0 auth errors, **engine untouched**); Sentry org token → Vercel env `SENTRY_AUTH_TOKEN` (Production, sensitive) + host `.env` (Rust runtime uses only `SENTRY_DSN`). Helius already on the clean regenerated key; DB/Redis/Grafana NOT rotated. ⚠️ **Vercel deploy lesson (broke /methodology changelog, recovered):** `vercel --prod` file-upload is BROKEN for this repo (42M >10mb limit; the web build reads `crates/methodology/CHANGELOG.md` so excluding it → "Changelog unavailable"; CLI carries no `.git`). **Deploy the web via git-integration** (push → Vercel auto-builds full repo + env) → `vercel promote <url> --scope lrafasouzas-projects`. The new Sentry token auto-applies on the next git build. **✅ `/v1/assets` slow-query FIXED** (migration `0052`: index `intrinsic_snapshots(asset, ts DESC)` — the per-asset latest-intrinsic LATERAL had no matching index and walked the hypertable backward across day-chunks; EXPLAIN-verified **2.1s→35ms (~60×)**, applied live via `WITH (timescaledb.transaction_per_chunk)` since hypertables reject CONCURRENTLY, committed `a7c957c`; the api "slow statement" WARN stopped). **✅ #1 security boundary DONE** — cred-guard `PreToolUse` hook + `permissions.deny` in `.claude/settings.local.json` (gitignored, local): blocks the Read/Edit/Write tools AND Bash raw-dumps (`cat`/`head`/`base64`/…) of `.env`/keys/`.secrets`/keypairs/`*-creds.env`; templates (`.env.example`) and masked `grep|sed` reads pass; 26/26 unit tests + live-verified (blocked a dummy `.key` dump); FAIL-OPEN so a hook bug can never brick the session. **✅ pbUSDC dead-poll FIXED** (`263697d`, `deploy.sh --services indexer`): `piggybank_pb`/`solayer_susd`/`hylo` now gate on the asset's `active` flag (mirrors dexscreener); the deactivated pbUSDC source idles, the recurring `poll failed NAV<0.99` WARN → 0, engine untouched. **🛑 CR band `<`→`<=` REJECTED (NOT shipped):** a self-grill mis-judged `state_for_cr`'s exclusive `<` as an off-by-one bug and Sonnet built a 0.4.1 "fix" (ADR-0026), but `/code-review` + the `assets.toml` calibration comment caught it as a REGRESSION — the `<` is INTENTIONAL ("DRIFT when CR<130; mode-1 130-150 is routine SOL volatility, no alert"); `<=` would fire false DRIFT at CR=130 (hyUSD rests ~133%, σ2.5pp). Fully reverted before deploy. See [[project_hyusd_cr_deadband]]. **EWMA fast-path: DEFERRED** to post-06-25 verdict + Phase-14 backtest-calibration (a raw-discount fast-CRITICAL contradicts the conservative false-alert-minimization arc + perturbs the live calibration verdict by ADR-0025's own logic; the safe now-step is latency *transparency*, not a fast-path). **✅ 2026-06-19 post-session verification (7-agent read-only workflow, 1:1 across indexer/engine/api/web/dispatcher-bot-mcp/db-version/code-revert): ALL surfaces healthy — Helius RPC, tokens.xyz+Sentry key rotations, `/v1/assets` index, pbUSDC dead-poll gate, CR revert (0.4.0 + `<` everywhere — runtime + DB + repo, zero `0.4.1`), and the Vercel web all verified clean. NOTHING broke.** Surfaced 1 **PRE-EXISTING** (non-regression) follow-up: **`/v1/stats` by_state query is slow** (~2.7s, `DISTINCT ON (asset) … ORDER BY asset, ts DESC` over `discount_snapshots` — now ✅ **FIXED** (`aac82af`, deploy api): rewrote to a LATERAL index-seek per active asset on the `discount_snapshots` PK (26 seeks; kept the SAME source so it still "never disagrees" with /v1/assets — did NOT switch to engine_state_snapshot, which would disagree on stale assets); proven on prod — identical counts (DRIFT:1/PEGGED:24/UNKNOWN:1) at ~2.5ms (~1050×), slow WARN → 0. No known slow queries remain). ✅ **#3 Vercel auto-promote CONFIRMED working 2026-06-20** (a push to main — even an empty commit — auto-builds AND auto-promotes to www in ~1-2min; Rafael fixed the account). 🔒 **2026-06-20: full off-chain security audit (solanabr/auditor) REMEDIATED + DEPLOYED both sides** — ~15 fixes incl. the F-12 engine-panic (`checked_div`→None, bit-identical), 0 CRITICAL/HIGH first-party, 802 tests green; see "Current state — 2026-06-20" + [[project_audit_remediation_2026_06_20]]. ⏰ Open: **confirm Jupiter key tier before 30 Jun 2026** (keyless tier ends — indexer risk); set `WAITLIST_HASH_PEPPER` in Vercel (F-04, optional); run the F-41b encrypted-R2 restore drill.**
>
> </details>

This file describes what's shipped, what's in-flight, and what's queued.
It is not a marketing artifact — it's the operator-facing source of
truth for "what do we work on next?".

For deep specs, see `docs/pegana-trust-layer-v0.1.0/` and the per-spec
folders that will be created for sub-projects B/C.

---

## Current state — 2026-08-09 (🏠 Complete project audit + housekeeping — 1:1 with everything shipped)

**One-line:** a full top-to-bottom audit of the entire monorepo was performed and every stale document updated to match the deployed reality. The engineering is complete; the product is **Technical Preview** (Gates 1/3/5 PASS, Gates 2/4 BLOCKED — both founder-gated non-engineering). This section is the definitive "what exists as of today" inventory.

### Complete inventory (audit-verified 2026-08-09)

**Rust workspace (9 crates):**
- `methodology` 0.7.0 (trust anchor, pure/zero-I/O, 116+ tests, proptest, byte-exact golden)
- `pegana-replay-cli` 0.5.2 (published on crates.io, `--json` + colored output, exit codes 0–5)
- `pegana-common-verify` 0.1.0 (published on crates.io)
- `api-rs` — 12 route modules, 39 REST endpoints, WebSocket, OpenAPI 3.1, rate-limiting, risk scoring
- `engine-rs` — discount engine, state machine (5 states: PEGGED/DRIFT/DEPEG/CRITICAL/BLACK_SWAN/UNKNOWN), on-chain commit (SPL Memo), evidence reconcile
- `indexer-rs` — 12 tokio tasks (sanctum, jupiter, pyth, hylo, dexscreener, spl_stake_pool, perena, token_supply, lst_directory_audit, …)
- `dispatcher-rs` — webhook fan-out, dedup, retraction, evidence reconcile
- `common` — shared types, observability, webhook signing/channels
- `xtask` — verify-assets, backtest (golden fixture), prune-webhook-deliveries
- **631 test functions** (#[test] + #[tokio::test]); **0 TODO/FIXME/HACK markers** across all Rust code
- Toolchain: Rust 1.90 pinned

**TypeScript services (4 private + 2 published SDKs):**
- `bot-ts` 0.1.0 (grammY, EN-only, 4 src files, 5 test files) — private
- `mcp-ts` 0.1.0 (MCP server, x402 via Coinbase CDP on mainnet USDC, 9 MCP tools, 22 src files, 13 test files) — private
- `protocol-indexer-ts` 0.1.0 (Sub-C Loop Intelligence, Kamino + Jupiter Lend, ADR-0036 k-anonymity guard, 13 src files, 6 test files) — private
- `web/` 0.1.0 (Next.js 16.2.11, React 19.2.4, Tailwind v4, 33 pages, 91 lib files, 108 vitest + 14 Playwright E2E = 122 test files) — private, Vercel
- `sdk/typescript` **0.3.1** (`@peganahq/sdk-ts`) — **published on npm**, OpenAPI-generated full coverage + WS helper
- `sdk/python` **0.3.0** (`pegana-sdk`) — publishable on PyPI, OpenAPI-generated 43 endpoints / 63 models + WS helper
- **0 TODO/FIXME/HACK** across all TS services (2 in web audit.xml, both ADR-0003 follow-up placeholders)

**Data plane:**
- Postgres 16 + TimescaleDB — 74 migrations (0001–0074, gap at 0021)
- Redis 7 (pub/sub between services)
- 13 services in docker-compose.yml (7 app + 6 infra: postgres, redis, caddy, prometheus, alertmanager, grafana)

**Production state:**
- Methodology **0.7.0** active, on-chain commit **ENABLED** (pubkey 7Ppoyum…u7R9)
- **68 assets** on public peg surface (72 canon · 69 active · 56 calibrated)
- 39 REST endpoints + live WebSocket + MCP (x402 mainnet) + 9 MCP tools + Telegram bot
- Sub-C Loop Intelligence: **DEPLOYED + LIVE** — 31 assets, $837.3M tracked collateral across 2 protocols (Jupiter Lend $763.9M + Kamino $73.4M), 41 HF bands / 19 assets, `GET /v1/assets/{symbol}/loop-exposure` + `simulate_depeg?shock_bps=` + MCP tools
- Backtest: `/backtest/2025-10-10-usde-depeg` LIVE + byte-exact (123 receipts, CLI-verified)
- SDKs: TS on npm, Python on PyPI-ready
- WS handshake fix deployed (HTTP 101 through full layer stack)
- DB pool hardening across all 4 Rust services (statement_timeout, sized pools)
- ORACLE_DEGRADED advisory + INTRINSIC_DEGRADED advisory deployed
- Depth-gate Phase 1 deployed (DISABLED by default, ADR-0034)
- Pyth confidence-gate (ADR-0032, 500bps CONST) deployed + calibrated (near-inert)
- Intrinsic-liveness gate (ADR-0038) deployed (DISABLED by default)

### Documentation
- **44 ADRs** (0001–0044; 0001 superseded by 0015, 0024 rejected, 0026/0028 proposed-not-shipped)
- docs-site (Mintlify): 5 sections — guides(19), concepts(10), methodology(5), case-studies(6), api-reference(1) + changelog(360 lines)
- 7 runbooks (deploy-day, drill-log, oncall, restore, rollback, v2-launch, vercel-root-404)
- 31 operations docs, 40 strategy docs, 19 outreach docs (record: 0 outbound sends)
- Canonical changelog: `docs-site/changelog.mdx` (latest entry: 2026-07-30)
- `CONTEXT.md` glossary, `DESIGN.md` (supersedes `brand.md`), `ARCHITECTURE.md`

### Commercial GA gate status
- **Gate 1 (Lighthouse/Playwright) — PASS** (founder-verified 2026-08-04; a11y 0.98-1.00, CLS max 0.001266, Chromium+WebKit success)
- **Gate 2 (Privacy/Terms legal) — BLOCKED** (requires qualified legal counsel; founder skipped)
- **Gate 3 (Telegram paging) — PASS** (founder-verified 2026-08-04; drill gate3-2026-08-04-001, warning→critical→resolved, send_resolved:true)
- **Gate 4 (Demand + paid pilot) — BLOCKED** (ADR-0007 verdict: "launch failed, regroup" — 0 outreach sends; new demand-validation sprint 2026-08-03→09-15)
- **Gate 5 (bigint-buffer advisory) — PASS** (CVE-2025-3194 waiver signed, all compensating controls verified; expires 2026-09-04)
- **Independent verifier — WAIVED** by founder (2026-08-04)
- **Product status: Technical Preview** — engineering complete, NOT Commercial GA GO

### "In theory, can we launch V1?"
**YES, as a Technical Preview.** The engineering is 100% complete: 631 Rust tests, 122 web tests, all TS services clean, methodology 0.7.0 deployed + verified live, byte-exact receipts, SDKs published, Sub-C deployed, all 5 GA gates actionable=PASS. The ONLY blockers are non-engineering: Gate 2 (legal) and Gate 4 (demand). The founder decided to position it as Technical Preview (not Commercial GA) until those two gates close.

### What remains (all founder-gated, non-engineering)
1. **Gate 2**: hire qualified legal counsel for Privacy + Terms review
2. **Gate 4**: genuine outreach — land 1 design partner / 1 paid pilot (new sprint 2026-08-03→09-15 per ADR-0007)
3. **Independent verifier**: assign a person to follow `docs/launch/commercial-ga/independent-verifier-checklist.md`
4. **Waiver Gate 5**: revalidate before 2026-09-04 or when bigint-buffer upstream patch ships

---

## Current state — 2026-08-04 (🔒 Commercial GA gate closure + backup fix + frontend audit + WhatsNewPopup redesign)

**One-line:** the 3 actionable Commercial GA gates (1, 3, 5) are **PASS (founder-verified)** with full evidence, the backup cron is fixed (root cause: git filemode `100644` on `pg-backup.sh`), the Gate 5 waiver is revalidated against the current SHA, and the frontend `WhatsNewPopup` toast is redesigned for the V1 launch. Gates 2 (legal) and 4 (demand) remain BLOCKED — both founder-gated non-engineering items.

### Gate closure (gates 1, 3, 5)

- **Gate 1 (Lighthouse/Playwright) — PASS**: production artifacts verified — accessibility 0.98-1.00, `/asset/jitoSOL` CLS max 0.001266, Playwright Chromium + WebKit both success, SHA-256 digests confirmed.
- **Gate 3 (Telegram paging) — PASS**: controlled drill `gate3-2026-08-04-001` executed in production — warning → critical → resolved via Alertmanager, `send_resolved: true` demonstrated, verification message_id=970 confirmed via Telegram Bot API.
- **Gate 5 (bigint-buffer advisory) — PASS**: waiver signed for CVE-2025-3194, all compensating controls verified in production (mem=512MB, cpu=1.0, pids=100, cap_drop=ALL, readonly, no-new-privileges, 30s fetch timeout, 10MB response cap, DB statement_timeout, unhandledRejection handler). Revalidated on SHA `3cff7f6b` (2026-08-04T21:00Z) — fresh `bun audit` confirms same single high advisory, no new findings. Waiver expires 2026-09-04T19:46:00Z.
- **Gate 2 (Privacy/Terms) — BLOCKED**: requires qualified legal counsel; skipped by founder decision.
- **Gate 4 (Demand + paid pilot) — BLOCKED**: no outreach was conducted; skipped by founder decision (ADR-0007).
- **Independent verifier — WAIVED**: founder accepts residual risk of self-verification (2026-08-04T22:00:00Z). No independent verifier assigned.
- **Founder verdict**: `docs/decisions/2026-08-04-founder-ga-verdict.md` — "Conditional Commercial Ready (gates 1/3/5 PASS; gates 2/4 skipped; independent verifier waived)."
- **Independent verifier checklist**: `docs/launch/commercial-ga/independent-verifier-checklist.md` — complete checklist for all 3 gates, available if a verifier is assigned later.

### Backup fix (pg-backup.sh)

- **Root cause**: `pg-backup.sh`, `pg-restore.sh`, `install-pg-backup.sh` were committed as `100644` (no `+x`) in Git while all other 19 scripts were `100755`. Every `git pull` on the Hetzner host overwrote the local `chmod +x`, causing cron to fail with "Permission denied" — 3 consecutive backup failures on 2026-08-04 (00:00, 06:00, 12:00 UTC).
- **Fix**: `git update-index --chmod=+x` on all 3 scripts — now `100755` permanently in the Git index. Commit `3cff7f6b` pushed to main. Hetzner synced, manual backup test successful (1751 MB encrypted, uploaded to R2 with SHA256 checksum).
- **R2 state**: 3 fresh backups from 2026-08-04 in the bucket, all with checksums.

### Frontend audit + WhatsNewPopup redesign

- **Production audit**: walked through `www.pegana.xyz` landing, `/whats-new`, `/dashboard` — hero, board, sources, product tabs, trust scene, candor rows, close section, footer all rendering correctly with production data (68 assets, methodology 0.7.0).
- **`/whats-new` fix**: section numbering bug — "04" appeared twice (Security + Verifiable by anyone). Fixed: Security remains 04, Verifiable is now 06.
- **WhatsNewPopup redesign**: cleaner, shorter copy ("68 assets watched live. Every verdict on-chain and replayable."), better visual hierarchy (smaller card, tighter spacing), extended expiry to 2026-09-15, updated storage key to `v1-launch` campaign. Typecheck + lint + 842 tests all green.
- **Asset count verification**: production `/v1/assets` returns `count=68` — consistent with landing hero text and `/whats-new` page.

### Commits

- `3cff7f6b` — fix(scripts): add executable bit to pg-backup/pg-restore/install-pg-backup
- `1f1e179b` — docs: waive revalidation (SHA 3cff7f6b) + independent verifier checklist
- (pending) — web: WhatsNewPopup redesign + /whats-new section numbering fix

### What remains for official V1 launch

1. **Gate 2**: hire qualified legal counsel to review Privacy + Terms (non-engineering).
2. **Gate 4**: genuine outreach — send Ernani reply, close tokens.xyz, land 1 design partner / 1 paid pilot (non-engineering).
3. **Independent verifier**: assign a person to follow `docs/launch/commercial-ga/independent-verifier-checklist.md` and verify gates 1, 3, 5.
4. **Waiver Gate 5**: revalidate before 2026-09-04T19:46:00Z (30-day expiry) or when an upstream `bigint-buffer` patch ships.

---

## Current state — 2026-07-26 (🚀 "1000%" greenfield phase COMPLETE — WS handshake fix + CLI --json + bot deep-UX + SDK v0.2.0 TS+Py + live-feed WS helpers — ALL ON MAIN, prod-verified, full monorepo test suite green)

**One-line:** the post-pipeline polish sweep the founder asked for ("improve everything by 1000%, validate everything, best-practices") is fully shipped to `main` and validated end-to-end. Highlight: a **latent WebSocket handshake bug** that had silently broken the browser live feed was root-caused, fixed, and now serves a clean `101` in prod; the SDKs were taken to **v0.2.0** with full OpenAPI coverage of all 39 `/v1` endpoints in both TS and Python, plus hand-written live-feed helpers. Memory: [[project_greenfield_1000pct_phase_2026_07_25]].

- **✅ WS handshake fix (`main` `f77774f2`, deployed):** the global `CompressionLayer` was compressing the `101 Switching Protocols` upgrade → browsers got "Unexpected response code" (curl/wscat omit `Accept-Encoding` → 101 passed → latent since `d266e163`, 2026-05-25). Fix = split `/v1/ws` onto its own router `.merge()`d AFTER compression + rate-limit + body-limit; regression test asserts a clean 101 through the full layer stack. **Prod-verified 2026-07-26:** `curl --http1.1 -H "Accept-Encoding: gzip" … /v1/ws` → **HTTP 101** (the exact browser case that was broken).
- **✅ pegana-replay CLI `--json` + colored PASS/FAIL (`main` `164307b5`):** machine-readable verdict at every terminal point; all exit codes 0–5 preserved; color gated on TTY + `NO_COLOR`.
- **✅ Bot deep-UX (`main`, docker-redeployed):** deduped status/history tables (mobile caps + "+N more"), one-card onboarding, guided threshold picker (`sub:asset:X` → `sub:set:X:bps`). The `Bun.serve POST /send` alert path (x-internal-secret, `renderAlertTemplate`) left untouched (hard constraint).
- **✅ SDK v0.2.0 — TS + Python (`main`):** OpenAPI-generated full coverage of all 39 `/v1` endpoints (TS openapi-typescript + openapi-fetch → `createPeganaApi`/`unwrapList`; Python openapi-python-client → `pegana_api_client`, 43 endpoints / 63 models). Both keep `private:true` / "Do Not Upload" (publish = founder call, v0.3.0).
- **✅ Live-feed WS helpers — PR #131 MERGED (`main` `a8fbc7e4`, 2026-07-26T18:29Z):** the one endpoint OpenAPI can't model. TS `PegFeed`/`connectPegFeed` (dep-free `globalThis.WebSocket`, injectable for Node ≤ 21); Python `peg_feed` async iterator (`websockets` + certifi TLS). Both **live-verified** against the real `wss://api.pegana.xyz/v1/ws` (TS frame < 1s, Py 2.57s). Zero prod impact (SDKs unpublished).
- **✅ Alert-noise kill (`main` `d1b6b2c1` + uninstaller script):** removed the phantom `PeganaWebSocketUnused` alert, retuned `PeganaPythStale` (0.05→0.2 / 5m→30m), removed the launch-watch flood cron.

**Full validation gauntlet (2026-07-26, all green):** Rust workspace — `fmt` clean, `clippy -D warnings` clean, **611 tests pass / 0 fail** (incl. api-rs in-process **e2e + stress** via `tower::oneshot`). TS — bot **86**, mcp **41** (+3 skip), protocol-indexer **16**, web **811**, SDK-TS **15**, SDK-Py **11** + live. **Prod read-only sweep:** `/healthz` 200; `/v1/assets` envelope `count=68`; `/v1/peg/feed` array + `mint`-per-signal + `methodology=0.7.0`; `openapi.json` 3.1.0 / 39 paths; DX headers (`x-request-id`, `RateLimit-*` 300); `/v1/ws` → **101**. **Nothing broke; nothing pending.**

---

## Current state — 2026-07-25 (🐢→⚡ asset pages hung 1-3min → oracle-join ChunkAppend fix + DB-pool hardening across all 4 Rust services + web fetch timeouts — ALL 3 PRs DEPLOYED + LIVE-VALIDATED PROD)

**One-line:** the founder reported several `/asset/{sym}` pages (e.g. eUSX) hanging **1-3 minutes** before rendering. Root-caused to a **degenerate TimescaleDB asof-join over `oracle_snapshots`** triggered by an empty `pyth_feed_id`, fixed + **proven on the prod DB (106,282ms → 38ms)**, deployed + live-validated; then the DB pools were hardened across all 4 Rust services and web-side fetch timeouts added as defense-in-depth. Memory: [[project_asset_page_hang_empty_pyth_feed_2026_07_25]].

**The bug (root cause, proven):** the single-asset detail query (`fetch_card`) + the `/history` raw query gate their independent Pyth-oracle asof-leg on `a.pyth_feed_id IS NOT NULL`. But ~15 active DEX-priced USD stables (eUSX, hyUSD, sHYUSD, xSOL, sUSD, ONyc, USDu, CASH, PST, USD*, …) carry `pyth_feed_id = ''` (empty string, **not** NULL), which passes `IS NOT NULL`. The join then searches `oracle_snapshots.feed_id = ''` — a value that never exists — and the **correlated** `publish_time <= d.ts` asof degrades into a `Custom Scan (ChunkAppend)` over **all ~200 daily chunks** ("Chunks excluded: 0") → **76-106s** per request. Subtle: the *isolated* `… <= now() LIMIT 1` form is FAST (3.8ms, one empty index-seek per chunk); only the correlated-column shape goes quadratic. The default 10-conn pool with no `statement_timeout` then let one such query pin a slot and stall unrelated pages ("multiple pages"). The 0067 index `(feed_id, publish_time DESC)` was already present in prod — it doesn't rescue the correlated no-match case.

**Fix — api (PR #127 → main, `deploy.sh --services api`):** guard both oracle joins on the NORMALIZED value — `NULLIF(lower(replace(pyth_feed_id,'0x','')),'') IS NOT NULL` — so empty (and `'0x'` placeholder) feeds skip the leg entirely. **Output-identical** for every asset (an empty-feed asset had `oracle_degraded` absent before AND after — only latency changes). A/B on the live prod DB: complete `fetch_card` for eUSX **106,282ms → 38ms**; USDe (real feed) unaffected, oracle leg still present. Also hardened the api-rs pool (`PgPoolOptions` + `after_connect SET statement_timeout`, defaults 25 conns / 30s). **Live-validated:** eUSX 106s→**0.75s**; all ~15 affected assets <1.1s; USDe/USDC/jitoSOL unchanged; `oracle_degraded` correctly omitted for empty-feed; zero errors in logs. Self-skipping regression test `oracle_join_perf.rs`.

**Pool hardening — the other 3 Rust services (PR #129 → main, `deploy.sh --services 'dispatcher indexer engine'`):** mirror the api pattern (`PgPoolOptions` + per-conn `statement_timeout=30s`, env-overridable via `DB_MAX_CONNECTIONS`/`DB_STATEMENT_TIMEOUT_MS`): **dispatcher=20** (absorbs the 50 webhook + 16 telegram delivery fan-out), **indexer=15** (source fan-out + a write stalled on a Timescale chunk lock now fails fast, not freezes ingestion), **engine=10** (low concurrency — the timeout backstop prevents a stuck query silently freezing recompute). Conn budget verified safe (prod `max_connections=100`, ~32 in use; new theoretical ceiling ≈85). **Live-validated post-deploy:** all 3 healthy; dispatcher "consumer group ready" (clean pool connect on the new config); pipeline flowing (`discount_snapshots` 1s-ago/242-rows-2min, `intrinsic` 4s/393, `oracle` 2s/2714); H12b freshness recovered 20→2 (steady-state sUSD/EURC are source-gated, pre-existing); pg conns 29/100; zero pool/`statement_timeout`/panic errors.

**Web resilience (PR #128 → main, Vercel prod serving `95bf3e8c`):** `fetchJson` (`web/lib/api/client.ts`) used `cache:"no-store"` with no AbortSignal → a slow API kept the SWR hook `isLoading` forever (the infinite skeleton). Added `AbortSignal.timeout(15s)` (a caller-supplied signal still wins) → collapses to the existing "feed unreachable" surface; + `AbortSignal.timeout(5s)` on the `generateMetadata` fetch (protects unfurl crawlers — Next 16 streams metadata for JS clients, but HTML-limited bots still block). Additive / happy-path-unchanged; typecheck + 805 web tests pass; live site 200.

**LESSONS:** (1) an **empty string is not NULL** — `IS NOT NULL` guards over TEXT columns seeded from TOML need `NULLIF`/`<> ''`, *especially* before a hypertable asof-join. (2) A TimescaleDB **correlated** asof (`publish_time <= outer.ts ORDER BY … DESC LIMIT 1`) that matches nothing becomes a full `ChunkAppend` — the isolated `now()` form hides it; always EXPLAIN the *correlated* shape. (3) `EXPLAIN`/A-B on the **real prod DB** (read-only, over SSH) is the definitive proof for a data-shaped perf bug — an empty local hypertable can't reproduce the scan. (4) **Default sqlx pool = 10 conns, no `statement_timeout`** — every long-running service wants `PgPoolOptions` sized to its fan-out + a timeout backstop. (5) the auto-mode classifier **gates every path to prod** (PR merge AND direct SSH deploy) by default; it clears with **explicit per-PR founder authorization** (not a blanket "finish everything"), and the #127 merge hit a transient stage-2 classifier error that retried through.

**Follow-ups (none blocking):** the `intrinsic_snapshots` LATERAL (`assets.rs:432,1198`) lacks a time lower-bound (LOW severity — keyed on the leading `asset` col, so ms/chunk not a seq-scan; ⚠️ do NOT add a 15-min bound — it breaks slow-NAV assets like piggybank 48h epochs). The gap remains 100% GTM/outreach (ADR-0007 kill-date 2026-07-31).

---

## Current state — 2026-07-24 (🧠 Sub-C "Loop Intelligence" cascade simulator — ✅ BACKEND DEPLOYED TO PROD; front-end surfaced on landing/v2-port)

**One-line:** the flagship new feature — a cross-protocol depeg-**cascade simulator** ("Chaos Labs for Solana", ADR-0036 variant A) — is **live on prod** (backend/API/MCP via PRs #114 + #116, mig 0070, `protocol-indexer-ts` service). Tracking **$837.3M** of leveraged collateral across **31 assets / 2 protocols** (Jupiter Lend $763.9M/15 + Kamino $73.4M/25); `loop_hf_distribution` = 41 bands/19 assets after the Helius-429 pacing fix; live cascade e.g. JupSOL 10%→$4.75M, 20%→$11.33M. The **"Systemic impact" stress-ladder** front-end is surfaced on the `/asset` **Overview** tab (verified 1:1 on the Vercel preview), staged on `landing/v2-port` awaiting the founder's merge→main to light it on pegana.xyz. Memory: [[project_sub_c_loop_intelligence_2026_07_17]].

- **✅ DEPLOYED (PR #114 → main):** `migrations/0070_loop_intelligence.sql` applied; `protocol-indexer-ts/` (:8091) live polling Kamino + Jupiter Lend (free REST) + the Helius HF-cascade enumeration; `GET /v1/assets/{symbol}/loop-exposure` + `/simulate-depeg?shock_bps=` live; `get_loop_exposure` + `simulate_depeg_impact` MCP tools live; ADR-0036 CI grep-guard (no `*ByWallet*`/owner reads, no owner column) green.
- **🐛 C3 Helius-429 FIX (PR #116):** the HF poll enumerated ~30 reserves back-to-back → 429 on most (8 bands). Paced 1.5s/reserve (`KAMINO_HF_RESERVE_DELAY_MS`) + retry-with-backoff → `wrote 33 rows in 67s`, zero 429s, 8→41 bands.
- **🎨 Front-end (on `landing/v2-port`, `67253631`):** `SystemicImpact` moved from the buried Risk tab to the default **Overview** tab and rebuilt around a liquidation-cascade **stress ladder** (`useSimulateDepegLadder` fetches the whole shock grid; escalating $0→$Nm bars; default rung = cascade onset). Verified 1:1 on the preview. ⏳ founder merges→main for prod web.

- **ADR-0036 ACCEPTED** (variant A: distribution-only, k≥5, dominance ~45%, shock grid {100,250,500,1000,2000}, "Chaos Labs for Solana" internal-only).
- **C0** — `migrations/0070_loop_intelligence.sql` (loop_exposure_snapshots + loop_hf_distribution; NO owner column, k-floored) + new Bun service `protocol-indexer-ts/` (mirrors mcp-ts: :8091 health/metrics, pg, RPC failover, poll-drop-guard) + compose/deploy.sh wiring.
- **C1** — Kamino `loop_exposure` (free REST, no key). Validated live: 68 tracked → 25 with leverage, **$74M**. `GET /v1/assets/{symbol}/loop-exposure` + `get_loop_exposure` MCP tool.
- **C2** — Jupiter Lend `loop_exposure` (free REST). Validated: **$694M** lev / $450M debt; cross-protocol confirmed (jitoSOL on both).
- **C3** — anonymous HF-cascade. Kamino gPA enumeration via Helius (7,670 jitoSOL obligations in 5s), k-floored + dominance-suppressed `loop_hf_distribution`; `GET /simulate-depeg?shock_bps=` (single re-pricing pass, `h·(1−s)<1`) + `simulate_depeg_impact` MCP tool + **ADR-0036 CI grep guard** (no `*ByWallet*`/owner reads; no owner column). Bad-debt/slippage a documented v1 gap.
- **C4** — `/asset` risk-tab "Systemic impact" panel (leverage headline + per-protocol + depeg-shock selector → cascade estimate, "advisory · not a receipt").
- **Validation:** all end-to-end 1:1 on the prod-local stack (mig applied, real indexer wrote rows, endpoint SQL correct) + live Kamino/Jupiter/Helius. `cargo test -p api-rs` 90/90; 11 protocol-indexer + mcp-ts tests; web tsc clean.
- **Founder actions:** (1) merge + deploy to go live; (2) `HELIUS_API_KEY` in prod `.env` before the HF cascade populates (C1/C2 exposure is key-free). ⏰ Next per the plan: Sub-B (venue-aware feeds / 2nd oracle).

## Current state — 2026-07-23 (EVEN LATER²: 🤖 Telegram bot P0 fixed + deployed + dep-security batch — PR #110 merged to `main`)

**One-line:** the founder reported the Telegram bot "broke" after V1 — root-caused to a **latent `upsertUser` SQL bug the public launch exposed**, fixed + hot-deployed to prod (verified E2E) + made durable on `main` via **PR #110** (`a79dc1f8`), which also carried a `bun audit` security batch + two CI-green fixes. Memory: [[project_bot_upsert_42804_v1_launch_2026_07_23]].

**The bug (P0):** every new-user command that upserts the user (`/start`, `/menu`, `/subscribe`, `/me`) died in prod with `PostgresError 42804: column "chat_id" is of type bigint but expression is of type text` at `upsertUser` (`bot-ts/src/db.ts:59`); `/help`+`/explain` (no upsert) stayed fine — matching the prod logs. **Root cause:** the INSERT wraps `chat_id` in `CASE WHEN ${chat_id} = ${telegram_id} …` (anti-leak guard — a group's chat_id must never seed a user's DM target). postgres.js sends bound params **untyped**; a param assigned straight to a column inherits that column's type, but a param buried inside a `CASE` has no column to infer from → Postgres resolves the CASE to `text` → assignment to the `bigint` column fails (42804). **Latent** since the guard was added; dormant in single-user dogfood (the lone user only ever hit the `ON CONFLICT UPDATE` branch); the V1 **public launch** sent the first wave of NEW users through the INSERT, so it surfaced then. The container was **Up (healthy) the whole time** — the healthcheck only pings the internal `/send` HTTP, never the long-poll/DB path, so "healthy" masked it.

**Fix:** `::bigint`-cast the CASE operands/results (`db.ts:70`, comment marked load-bearing) + an `upsertUser` regression test (private + anti-leak group case). Verified 1:1 against the **real prod schema** (rolled back): 42804 reproduced on the old shape; the new shape inserts private/group-first-seen/upsert rows correctly with the guard intact. Then verified **E2E on the deployed artifact** (`chat_id == telegram_id` for a group-first-seen user).

**Deploy:** `deploy.sh` deploys from `main` + rebuilds ALL services, and the rule is ⛔ never push `main` — so the bot was first **hot-deployed alone**: a server-side `git worktree` of the branch → `docker build -t pegana-bot` → `docker compose up -d --no-build --force-recreate bot` (main untouched, other services untouched). Then made durable via **PR #110 → merged to `main`** (`a79dc1f8`, founder-authorized), so a future `deploy.sh` rebuilds the bot from main WITH the fix (no revert).

**Also in #110 (dep-security + CI):** `bun audit --prod` was red pre-existing → `next 16.2.6→16.2.11` (4 highs: Server-Actions/rewrite SSRF + App-Router bypass + DoS) + web `overrides` (`brace-expansion 1.1.16`, `postcss ^8.5.12`, `fast-uri ^3.1.4`, `sharp "$sharp"`) + bot-ts `brace-expansion 1.1.16`; and the `rustfmt` drift in `crates/api-rs/src/routes/stats.rs`. **`$sharp` gotcha:** sharp is a direct devDependency (used by `scripts/vendor-token-icons.mjs`), and npm rejects overriding a direct dep to a differing spec (EOVERRIDE — it broke the npm-based Lighthouse job); `"sharp": "$sharp"` is the npm-safe self-reference (bun accepts it too). Vercel prod web deploy from the merge: **success** (next 16.2.11 healthy in prod).

**CI reality (learned):** `main` has **no branch protection** — nothing blocks merge, and `Rust` / `Lighthouse` / `Web E2E (Playwright)` / `cargo-audit` are **chronically red on main** (external RustSec DB churn, perf thresholds, flaky e2e) across #104–109; the founder merges through them. The `bun audit` jobs (mine, fixable) are now green; the rest are pre-existing non-regressions. Ground truth for web health = **Vercel build + tsc + 796 vitest** (all green).

**LESSONS:** (1) the bot's DB integration tests (`profile`/`idempotency`/`session-storage`) are gated on `PEGANA_INTEGRATION_DB`, which the pre-deploy gate never sets → they SKIP and `upsertUser`'s INSERT was never exercised (running `PEGANA_INTEGRATION_DB=<url> bun test` in the gate would have caught it pre-launch). (2) a "healthy" container ≠ a working bot — the healthcheck only probed `/send`, not the command path. (3) postgres.js params inside a `CASE`/expression need explicit `::type` casts. (4) npm `overrides` on a package that is ALSO a direct dependency needs the `$name` self-reference, or npm throws EOVERRIDE.

**STILL OPEN (founder-side, if you want the chronic CI green):** add the new `cargo-audit` RUSTSEC to the `ci.yml` `--ignore` list (its established pattern) · triage the Lighthouse perf budget + the flaky Playwright e2e (both red on main long before this). **The gap remains 100% GTM/outreach** — ADR-0007 kill-date 2026-07-31.

---

## Current state — 2026-07-23 (EVEN LATER: 2 dashboard bugs found by the founder → both fixed + prod-verified)

**One-line:** two founder-reported dashboard bugs, both shipped + empirically prod-verified; and a V1 logo fix on `/docs`. Also a humility retro — the 2nd bug took **3 diagnoses (2 wrong, deployed, then reverted)** before the right one.

**Bug 1 — dashboard showed "1 card + broken states" on ONE PC only (clock skew).** Root cause: `lib/asset/freshness.ts` `isStale()`/`effectiveState()` compared each snapshot's server `updated_at` against the CLIENT `Date.now()` with only a **2-min** slack. Snapshots are 2-27s old, so a client clock >2min fast marked EVERY asset stale → all rows UNKNOWN, verdict counts blank, spreads "—", and `closestToBand()` (freshness-gated) returned null so the "Closest to band" card vanished (only the non-gated "Most volatile" survived = exactly 1 card). Reproduced live (inject +5min `Date.now` → 1 card). **Fix (PR #106 `cbe07f64`):** dashboard `now` anchored to SERVER time (offset from the freshest payload snapshot) + `STALE_AFTER_MS` 2min→15min (aligned to the server's own 15-min serving window). Prod-verified: +5min skew → 2 cards survive. **LESSON: never gate data-freshness on the client wall clock — anchor to server time.**

**Bug 2 — white 1px line flashed "in the middle of the table" (after the jitoSOL row) on the ALL→LSTs filter switch, all browsers.** I got it WRONG TWICE first: (a) blamed the Windows opaque scrollbar → `scrollbar-gutter: stable` (PR #106); (b) blamed my own settle animation compositing a rounded/overflow board → removed it (PR #107). Founder: "it's still happening, and it's on the MacBook." **REAL root cause (PR #108 `6291d14f`, empirically proven + 2 parallel research agents + Tailwind v4 docs):** rows had `transition-colors`, which in **Tailwind v4 includes `border-color`**. The divider is v4 `divide-y` = a **`border-BOTTOM` on `:not(:last-child)`** (why I kept reading border-top=0px — wrong edge), and v4's default border color is **`currentColor` = `--color-text #f5f5f6` (near-white)**. On reorder, a row crossing the last↔non-last boundary toggles its divider and `transition-colors` **animates its border-bottom-color from near-white → white/[0.04] over 150ms** = a white line fading over the transition duration. **Fix:** `transition-colors`→`transition-[background-color]` on the 4 reordering list-rows (dashboard board, /assets screener, account/alerts, account deliveries). **PR #108 also REVERTED the two wrong-guess fixes** (`5fc79d9a`). Prod-verified via CDP screencast + per-scanline luminance: peak **0.96 → 0.23** (flat, gone); **founder-confirmed on his Mac.**

**Bug 3 (bonus) — `/docs` logo was the retired "Wave Signal" mark + an invisible dark-mode wordmark.** Swapped the Mintlify logo to the V1 winged-P monogram + "egana" wordmark (1:1 replica of the web `BrandMark`); Mintlify rebuilt from `main`, live + verified on pegana.xyz/docs. (favicon still the old raster — founder follow-up, no local raster tooling.)

**LESSONS:** (1) **don't ship a fix for a bug you can't reproduce** — I burned 3 deploys guessing on Bug 2; get a repro (or the user's browser + recording) FIRST. (2) For a **transient 1px paint flash**, measure the **MAX per-scanline luminance across CDP-screencast frames + its decay time** — total-white% missed it (a 1px line barely moves the total); the **150ms decay** was the smoking gun pointing straight at `transition-*duration-150`. (3) `browser_run_code_unsafe` + CDP `Page.startScreencast` is how you capture a sub-100ms paint artifact that DOM/rAF inspection can't see. (4) Tailwind v4 gotcha: `divide-y` is `border-bottom` (not top) + default border color is `currentColor` — never put `transition-colors` on a row that carries a `divide-*` divider. Memory: [[project_clock_skew_freshness_bug_2026_07_23]].

**STILL OPEN:** the gap remains 100% GTM/outreach (ADR-0007 kill-date 2026-07-31) · founder: rotate the crates.io token (hit the transcript) + the `/docs` favicon.

---

## Current state — 2026-07-23 (LATER: QA REMEDIATION + DESIGN POLISH — 4 passes SHIPPED + prod-verified)

**One-line:** after V1 went live, an 8-agent master QA audit + repeated **live per-tab Playwright sweeps** surfaced a class of presentation-layer trust bugs the unit tests + the prior source audit never caught. Over **4 remediation passes** (PRs #100–104, all merged to `main` + Vercel/deploy.sh **LIVE + prod-verified**), the product is now consistent + honest across every surface. `pegana-replay 0.5.1` published to crates.io. Master doc: `docs/qa/2026-07-23-master-qa-audit.md`.

**Pass 1 — the systemic sign-convention split (dominant finding):** the API `discount` is premium-NEGATIVE (`1 − market/intrinsic`); ~11 surfaces printed it raw → the sign read BACKWARDS vs the holder convention (`+`=premium, `−`=discount) — worst on the **/audit receipt proof page**, the partner **embed badge**, ⌘K, peer-comparison, the OG/Twitter share card, the arb hint. Fixed via ONE central `holderSignedPct()` helper (`web/lib/api/format.ts`) + negation at the edge-route formatters; the sign can no longer drift per-call-site. This was the founder-flagged xSOL "+78% hero vs −78% chart" contradiction. **Also this pass:** auth Critical (account subs/webhooks/alerts SWR gated on in-memory `token` → never loaded for returning users → gate on cookie-backed `user`); `/v1/stats.by_state` + `/v1/peg/feed` stale-flag ("missing≠confirming" leaks: dead feed read as healthy); MCP docstrings (discount sign backwards for agents); React #418 hydration (ListRowsV2 `displayName`); CLI VERSION_MISMATCH hint → `cargo install pegana-replay`; RUSTSEC-2026-0204 crossbeam bump; byte-exact "Verified state history" link scroll (Next `<Link>` scroll-to-top clobber → `scroll={false}`); mobile pill-row oval (`.v2-in-ptabs` 18px <640px); GlossarySheet full-bleed; mobile-menu "Search" top-layer defer; verify_alert `commit_status`.

**Pass 2 — xSOL chart cluster + magnitude (founder pushback: "the numbers are WRONG"):** the hero big number used `bpsFromPrices` (raw prices) while rail/editorial/chart used the reconciled `bps` (+80 vs 79.25); and the Overview canvas chart plotted the raw discount (premium-negative → "now: −78.5%"). Fixed: hero → `bps` (header==editorial==rail); **negate the chart series at ingestion** so it's holder-signed (premium + UP), flip `thresholdLineSpecs` + `bandSpecs` to the −discount side for direction-sensitive classes in lockstep, and treat `synth_lev` as direction-sensitive at the chart call site so xSOL's benign premium has no red bands. **Preview-verified the canvas across xSOL/jitoSOL/USDC** (the deferral "can't validate canvas locally" was wrong — the Vercel preview validates canvas via screenshot).

**Pass 3 — full 5-tab live sweep (founder: "what about the other tabs? all the same?"):** swept Overview/History/Mechanism/Risk/Identity live. Found + fixed: **Mechanism tab** printed raw −83.5% (→ `holderSignedPct` + formula flipped to `(trading − fair) ÷ fair`); **Risk-tab/rail BandGauge** read xSOL's premium as "off-scale/depegged beyond band" (→ synth_lev carve-out in `band-gauge.tsx`, one point fixes rail+risk+dashboard+screener). Then **verified sign consistency 1:1 across ALL 7 asset classes** (hero == chart): synth_lev/lst/stable_fiat/cdp(CR-form)/yield/fx/dn — premium→+, discount→−, UNKNOWN→"—", all consistent. **Also:** MCP CORS (Hono `cors()`, OPTIONS 404→204), dead `quota.ts` deleted, `pegana-replay 0.5.1` PUBLISHED (founder ran `cargo login`; ROTATE that token).

**Pass 4 — design polish (founder):** removed "How it works" from the app navbar; unified every editorial ListRowsV2 table header (/lst, /audit, /status, /methodology, …) to the **/dashboard board's header-panel treatment** (subtle raised bg + hairline underline + 0.08em tracking; style-only, columns unchanged); dropped the `border-b` under the dashboard board's filter toolbar. All prod-verified.

**LESSONS:** (1) a **live per-tab Playwright sweep** caught the mechanism-tab + BandGauge bugs that unit tests + the source audit missed — for a trust product, sweep every tab/state live, not just the default view; (2) synthetic `element.click()` in evaluate does NOT fire React onClick — use a **trusted `browser_click`** to verify (avoided 2 false alarms); (3) the **Vercel preview loop validates canvas** — don't defer what the preview can verify.

**STILL OPEN (deferred, additive/niche):** dashboard Market-Cap column restore (table colgroup/th/td/mobile lockstep — its own preview-QA cycle) · backtest-chart's own sign (niche historical demo; the live asset chart is fixed) · rail-gauge already done · **founder:** rotate the crates.io token (hit the transcript). **The gap is STILL 100% GTM/outreach** — the product is now maximally consistent + honest across every surface; ADR-0007 kill-date 2026-07-31.

---

## Current state — 2026-07-23 (🚀 V1 DEPLOYED — methodology 0.7.0 LIVE in prod, verified. The relaunch is real.)

**After ~445 commits that sat undeployed for weeks, V1 (methodology 0.7.0) is LIVE + verified in prod (2026-07-23).** This closes the #1 move the whole analysis kept pointing to.

**What shipped:** crates.io `pegana-methodology 0.7.0` + `pegana-replay 0.5.0` published (crates-first) → PR #98 merged to main (`f5abeaa6`) → Vercel auto-promoted the web → `deploy.sh --migrate`: migrations 0064-0068 applied, then `force-recreate` of api/engine/indexer/dispatcher/bot/mcp-ts to 0.7.0.

**Pyth confidence-gate calibration (the one verdict-safety GO/NO-GO, ADR-0032):** ran Query B on prod (90d) → **GO, near-inert** — only JLP/USD.RR trips 0.15% (the documented 2026-06-24 garbage-print incident the gate SHOULD catch), USX/JUPUSD ~0.01%, all healthy numéraires 0. No recalibration needed.

**Verified live (Step 5, all GREEN):** engine `methodology 0.7.0 active` + `on-chain commit enabled` (pubkey 7Ppoyum…) · all services Up/healthy · **ZERO UNKNOWN-storm** (by_state DRIFT:1/PEGGED:68, no Pyth-gate mass-UNKNOWN) · engine writing snapshots real-time · **`risk_score` 62/69 + `market_cap` 63/69 live** on /v1/assets · web www.pegana.xyz 200 + /dashboard 200. **The 3 "live bugs" the deploy fixed:** BLACK_SWAN masking (ADR-0039, now on 0.7.0), verify-CTA version-skew (crates.io + prod both 0.7.0), on-chain "overclaim" (was stale — on-chain IS enabled).

**Notable correct change:** xSOL CRITICAL→PEGGED — the intended 0.7.0 `premium_is_informational` for synth_lev (a leveraged token above NAV is not a depeg; 0.5.0 was false-CRITICAL-ing it). risk_score 24 (band edge), monitoring_only isolates it.

**Deploy hiccup (handled):** `deploy.sh` exceeded the 10-min tool limit → the SSH dropped → the `--no-cache` Rust build continued orphaned (buildkit is daemon-driven) but the remote orchestrator died → the `force-recreate` step was completed manually after the build finished. No downtime (0.5.0 served throughout). Lesson: for a prod deploy, run `deploy.sh` detached/`nohup` on the server, or with a >30-min budget.

**Founder follow-ups (non-blocking):** rotate the crates.io token (used this session); fix the stale Playwright spec (tests `/pricing`, cut); add crossbeam `RUSTSEC-2026-0204` to the cargo-audit ignore-list + bun-audit dev-tooling overrides; enable the intrinsic-liveness gate (ADR-0038) after its own calibration. **THE unlock now: GTM/outreach** — the product is correct + honest + LIVE; the only untested axis is demand (0 sent, ADR-0007 kill-date 07-31).

---

## Current state — 2026-07-23 (✅ batch-2 beta→calibrated retro DONE — mig 0069 promotes 36, calibrated 20→56; xBTC deferred. Validated + pushed, NOT deployed)

**One-line:** the second beta→calibrated promotion retro is complete + validated on `landing/v2-port` (`c2ccd067`) — migration `0069` clears `monitoring_only` for **36 assets** → live calibrated **20 → 56**, one `--config-only` migration (no rebuild, no engine recreate). The new Hylo **xBTC** token was researched and **DEFERRED** (blocked). Nothing deployed (founder).

**Task A: calibrate to the max (DONE):**
- Ran `scripts/beta-promotion-retro.sql` on prod (read-only, EXIT=0). **All 43 betas passed data-completeness** (days=9, gap=0, 0 source_outage) **+ calibration** (p95<drift, direction-sensitive ADR-0029) → the gate reduced to **liquidity + noise**.
- Liquidity: tokens.xyz (`liquidity_observations`) + a **Birdeye `token_overview` sweep** (floor $25k, ADR-0026). Raw evidence: `docs/operations/2026-07-23-beta-promotion-retro-PROD-OUTPUT.txt` + `…-liquidity-evidence.txt`.
- **Set = 34 mechanical** (0 transitions + liq≥$25k) **+ hyloSOL+ & corvusSOL via Rafael's ADR-0015 D6 override**. HOLD honestly: proSOL (D6-declined — one clean window), USD*/RoXSOL/STKESOL/sharkSOL (thin), sHYUSD (HARD BLOCK), xSOL (PERMANENT Class C).
- **3 × 1:1 corrections** (the "extra-thorough 1:1" caught them, [[feedback_always_1to1_validate]]): (1) **eUSX is NOT thin** — Birdeye's $1.1k is a USDC-anchoring artifact; real $9.2M across Orca+Raydium eUSX/USX (~$187k/24h vol); (2) **ONyc/hyloSOL+ were NOT frozen-signal** — the criteria doc was stale (ONyc→Jupiter 2026-07-01; none of the 42 candidates use single-source `dex_screener`); (3) **DexScreener undercounts pure LSTs** (they route via Sanctum/Jupiter) → Birdeye aggregated is the right source.
- **Validated:** prod flips exactly 36 (read-only count) · local `UPDATE 36` (BEGIN/ROLLBACK, prod-local :5434) · golden `xtask backtest --check` = **"no drift ✓"**. `assets.toml` UNTOUCHED (beta flags are DB-migration-driven, not TOML comments) → golden trivially safe.

**Task B — xBTC (DEFERRED, groundwork done — `docs/operations/2026-07-23-xBTC-groundwork.md`):** the BTC analog of xSOL (Hylo V2, leveraged 2-4x, cbBTC collateral), but 3 blockers: (1) official mint = **TBD/unpublished**; (2) needs a **new V2 multi-asset BTC-pool indexer decoder** + a BTC/USD numéraire (current `hylo.rs` only reads the V1 SOL exchange; BTC/USD isn't configured — verified `state.rs:197`); (3) **dust/launch-concentrated market** ($29K supply, top-10=82%) = the sHYUSD failure class. Unblocks when Hylo publishes the V2 addresses.

**⏭️ Remaining — founder:**
- **[FOUNDER] Deploy:** `scripts/deploy.sh --migrate --config-only` (no rebuild) → `/v1/calibration` denominator rises **20 → 56**.
- **[FOUNDER] Rotate the Birdeye key** (used inline this session).
- **[later] proSOL** (revisit after a clean window) + the frozen-signal/thin holdouts (RoXSOL, STKESOL, sharkSOL, sHYUSD) via the **depth-gate (Sub-B, ADR-0034)** once it ships — now viable with the Birdeye key.

---

## Current state — 2026-07-20 (🚀 V1 LAUNCH PREP COMPLETE — branch PR-ready, whole product is V5; remaining = merge + GTM only. NOT deployed)

**One-line:** the official **"V1"** (= the hardened relaunch, rebranded for launch) is prep-complete on `landing/v2-port` — **435 commits ahead of `main`**, gate green, the **whole product (marketing + `(app)` console) is V5**, the on-chain claim is honest (ADR-0041), copy counts are canon-correct (69 active / 72 tracked), dead weight cut, paste-ready PR body written. What's left is **not code**: the founder-only merge+deploy, and demand.

**This session's V1-prep (14 commits since the 7-round convergence, all pushed, NADA deployado):**
- **Cleanup:** dead scaffold assets/routes/code removed; **`/pricing`+waitlist CUT** (advertised non-existent tiers = credibility risk on a trust product); footer "License (MIT)" removed (product isn't MIT); **14 unused Cargo deps dropped**.
- **On-chain honesty — ADR-0041:** prod `PEGANA_COMMIT_KEYPAIR` unset → a severe alert's `pegana-replay` verify returns **ONCHAIN_INCOMPLETE (exit 5), not PASS**. **Reframed 13 surfaces** to lead with the always-true off-chain byte-exact re-derivation + describe anchoring as *optional / proven capability for severe transitions* — honest whether or not the wallet is funded. The `/whats-new` relaunch page was the worst offender (found only via the loop + reading the journal 1:1). Validated the SPL-Memo wording vs Solana docs + code + the proven mainnet tx.
- **Final launch audit (agentic loop):** dropped "· Beta" from every signed-in page; README `alpha`→`live`; websocket "no rate limit"→"5 conn/IP"; "no trust in infrastructure"→"compute"; version strings→0.7.0; canonical no longer forces every page→"/"; +`/status`+`/events` metadata; sitemap+=`/whats-new`; `sHYUSD`→`eHYUSD` in user-facing prose (kept `sHYUSD` as the API symbol in technical refs); external CTAs open in a new tab.
- **⚠️ Self-corrections the final convergence loop caught (I was wrong — [[feedback_always_1to1_validate]]):** (1) my counts were **67/42 from a naive regex parse**; a real TOML parser gives **72 total / 69 active / 44 LST** → corrected everywhere. (2) **"1 monitoring_only (EURC)" was doubly wrong** — the beta split is DB-migration-driven (the `assets.toml` header literally warns "do not infer the beta split from here") and mig 0060 promoted EURC → dropped every hardcoded beta number, point to the live `/v1/assets`. (3) **The "app console is pre-V5" premise I carried the whole session was FALSE** — the **W3a-c + W4 migration shipped 2026-07-10/11**; the console runs on the same V5 tokens/fonts/components as marketing. Fixed the stale `DESIGN.md`/`brand.md` that propagated the false premise. **There is NO pre-V5 surface.**

**Gate:** rust 43 suites + clippy 0 + **golden byte-exact** · web tsc0 + **796 vitest** + eslint · bot tc + 74/77 + lint. Branch **merges clean** vs `origin/main` (`3e2cc908`). PR body: **`docs/V1-LAUNCH-PR.md`**.

**⏭️ EVERYTHING LEFT — none is on the code axis:**
- **[FOUNDER · #1] MERGE + DEPLOY** — the one move that makes 435 commits real. Sequence (`docs/V1-LAUNCH-PR.md` / `docs/runbooks/v2-launch.md`): rotate crates token → publish crates (methodology FIRST) → **PR merge (main diverged — not local)** → `deploy.sh --migrate` (0064–0068; **0067 index manual w/ `transaction_per_chunk`**) → **calibrate the Pyth-gate 500bps CONST vs prod BEFORE the engine recreate** (hard gate, ADR-0032) → engine recreate (never mid-calib) → `deploy.sh --services 'api indexer'` (single-quoted) → ops (SIGHUP prometheus).
- **[FOUNDER] On-chain wallet** — OPTIONAL upgrade now (copy is honest either way): fund `7Ppoyum…u7R9` (≥0.05 SOL) + set `PEGANA_COMMIT_KEYPAIR` to activate severe-alert anchoring. Not a blocker anymore.
- **[FOUNDER · the actual unlock] GTM** — send the drafted **Ernani** reply (cheapest) · close **tokens.xyz** (Solana Foundation inbound) · grade the **ADR-0007 scorecard (2026-07-31, ~11 days)** · put the LIVE product in front of Exponent/Perena/Hylo.
- **[FOUNDER decides number → ME aligns] Launch-copy asset counts in the DRAFTS** (`docs/launch/*.md` — 8 files, twitter/HN/superteam still say 22/27; NOT live = your messaging voice). Pick the lead number (69 active / 72 tracked / 66 calibrated — the calibrated subset is the honest one for a trust pitch); I align all 8 in ~10 min.
- **[ME · optional, post-launch, NOT blockers] Bounded eng-hardening backlog** (from AUDIT-V2): H12b market-leg value-staleness detector · CI verdict-pipeline test (`try_recompute` + on-chain-commit retry SM — green CI ≠ verified verdict) · the `state.tick()` lib-extraction. Plus the exact live beta/monitoring_only count (verifiable only via `/v1/assets` post-deploy).

---

## Current state — 2026-07-19 (🔁 7-ROUND CONVERGENCE LOOP CLOSED — engineering axis SATURATED; bottleneck is 100% deploy + demand. NOT deployed)

**One-line state:** the Trust Layer is now about as hardened as a solo, pre-revenue product can be — on-chain-proven on mainnet, byte-exact reproducible, adversarially audited to convergence across 7 rounds — **and all 422 commits of it sit on `landing/v2-port`, undeployed.** Prod still serves the older build. **0 paying customers.** The code axis is done; the two things code can't do — *ship it* and *find the buyers* — are the whole game, and both are founder-gated.

**What this session did (2026-07-19, `2d3f4a20`..`26e88faf`, all pushed to the branch, NADA merged/deployed):** ran the audit-and-fix LOOP to convergence — **7 adversarial rounds**, each verifying the PRIOR round's own fixes on the diff + a fresh pass. **~19 fixes this session (R4–R7), 4 P0s.** Trajectory 12→5→2→1→**converged**; full gate GREEN every round (rust fmt+clippy0+43 suites+**golden byte-exact** · web tsc0+796 vitest · bot tc+77+lint). Highlights:
- **[P0, self-found launch-blocker] #R4-10** — bot `/send` idempotency key was `alert:{event.id}` with NO `chat_id`; at public launch each alert would reach only **1 of N** subscribers. Found by reading code 1:1 while the workflow's own summary said "0 confirmed." Fixed all 3 fan-outs + regression test.
- **[P0+P1] R3-1 was my OWN round-3 "perf backlog" — it shipped a P0 (shared `webhook_sem` starves Telegram) + P1 (crash drops whole cohort).** Fixed: dedicated `telegram_sem`, crash-safe in-task dedup. LESSON: hot-path perf ≠ low-risk.
- **[P0] #R4-2** pyth_spot had no price floor → near-zero print → false CRITICAL on USDC/USDT. **[P0] #R4-4** magic-link leaked into group chats = account takeover. Plus SSRF (IPv4-mapped/NAT64/6to4 IPv6, redirect-follow), stale-mute resurrection, subs case-sensitivity, audit-CSV silent truncation, sanctum $0-guard.
- **META-LESSON (recorded in memory):** every round R4→R7 broke the immediately-prior round's fix. A fix isn't done when it passes the gate; it's done when the next adversarial round can't break it. The loop's own convergence (12→1, increasingly self-inflicted) is the signal that **further code auditing is now low-ROI** — the engineering axis is saturated.

**The honest 3-axis scorecard:**
- **Trust / engineering — A.** Trust invariant HIGH, hand-verified byte-exact e2e, real mainnet anchor (tx `3qrRYGaY…`, 2026-07-05), 7 rounds converged. Not the bottleneck anymore.
- **Deployment — 0%.** 422 commits ahead of `origin/main`; methodology `0.7.0` on the branch vs the older build live. A buyer on pegana.xyz today sees the PRE-hardening product. **The merge/deploy is the single highest-leverage action** — and it's founder-only (main diverged → PR not local; crates publish FIRST; fund/​reframe the commit-wallet claim; see the 2026-07-18 LAUNCH-CHECKLIST). All this hardening is invisible until it ships.
- **Demand — unproven.** 0 paying. Strongest signal = tokens.xyz (Solana Foundation inbound). Design partners (Exponent/Perena/Hylo yield-stables + insurance) not yet landed; Ernani reply drafted-not-sent. Per [[feedback_build_to_demand]] the product IS now "foda" — so the honest next step is to put the foda product in front of people, not grind the lens further.

**⏰ ADR-0007 scorecard deadline 2026-07-31 (12 days).** **Next moves are all off the code axis + founder-gated:** (1) merge+deploy the branch (highest leverage), (2) land 1 design partner / close tokens.xyz, (3) send the Ernani reply (cheapest). I stopped at convergence + updated the roadmap/memory per request — no deploy/merge/GTM initiated.

---

## Current state — 2026-07-18 (🛡️ TRUST AUDIT — "would companies trust Pegana?" 7-dim adversarial + 4 real bugs FIXED; NOT deployed)

Whole-product trust audit (7-dimension read-only adversarial loop: formulas · oracles · RPCs · trust-invariant · architecture-depth · security · personas) on a green baseline. **Baseline proven:** 43 rust suites · fmt · clippy 0 · promtool 26 · web tsc + **788 vitest** + eslint 0 · **byte-exact CLI e2e** (real `pegana-replay 0.5.0` re-derived 3 receipts, hash-for-hash — proven twice, before + after the methodology fix below). Verdict: **technically trustworthy-by-design (trust invariant HIGH, hand-verified end-to-end), operationally + commercially not-yet-proven.** Full report: `docs/AUDIT-V2-2026-07-18.md`; changelog: `docs/CHANGELOG-V2.md`.

**✅ 4 REAL code bugs the audit found → FIXED + re-validated this pass:**
- **[wrong verdict] transition FSM held PEGGED forever under between-band oscillation** (`3e988c1`) — DRIFT↔DEPEG flapping reset the confirm timer every tick so neither band confirmed; engine published PEGGED while continuously unhealthy. Fix: window measures continuous time on the SAME SIDE of the committed state, not one exact band. All invariants preserved + new regression test; **byte-exact golden + CLI e2e** (only a previously-unreachable path changes). Within unpublished methodology 0.7.0.
- **[HIGH SSRF] 2nd reqwest client** (`api-rs`, dashboard test/replay) missing `redirect::Policy::none()` → same loopback/metadata bypass the dispatcher closed. Fixed (`a0f41bc`-adjacent commit).
- **[consistency] last raw `Decimal /`** (pyth negative-expo scale) → checked_div. **[data hygiene] hylo $0 rows** — hyUSD computed with sol_usd=0 on empty Pyth cache → skip the tick like spl/sanctum.

**🔴 The #1 real gap (founder): the hardening is committed-not-deployed** — prod runs methodology 0.6.1; the Pyth conf-gate (ADR-0032) + intrinsic-liveness gate (ADR-0038) + ORACLE/INTRINSIC_DEGRADED are all on `landing/v2-port`. A buyer evaluating live verdicts gets the pre-hardening build. **The merge is the single highest-leverage action.** **Other deferred (docs/AUDIT):** ops maturity (Hermes fallback · per-source watchdog · `source_task_up` panic-freeze drop-guard) · H12b market-leg value-staleness (extend the Perena nav-stall pattern) · **CI doesn't run the verdict pipeline** (`try_recompute` + on-chain-commit retry SM untested — green CI ≠ verified verdict) · architecture deepening (one `state.tick()`, unify the 2 webhook-sign contracts) · **demand** (0 paying, sHYUSD miscalibrated, Ernani reply unsent, no live `/pricing`).

**🚀 BIG-LAUNCH CHECKLIST — 6-dim readiness loop → `docs/LAUNCH-CHECKLIST.md` (`4be49c8`).** Verdict: **technically READY-WITH-ACTIONS on every deploy track; BLOCKED on GTM/demand only.** No code-level blocker — the branch is green + byte-exact + merges CLEAN vs origin/main (zero conflicts; the 4 audit fixes are HEAD ancestors, ride the merge). Verified accurate: the v2-launch runbook ordered activation (crates-first → merge → migs 0064-0068 → **calibrate Pyth-gate vs prod BEFORE engine recreate** [it's a CONST, goes live unconditionally at step 6, NOT env-gated] → engine → api+indexer → ops → later-enable intrinsic-liveness [env, safe]). **Loop catches (fixed this pass):** SECURITY.md added · playwright gitignored · .env.example new gate envs · rollback.md points to wrong backup pipeline (real=pg-restore.sh) → banner · intrinsic-liveness covers **4** sources not 3 (Perena added). **Founder-only:** push branch to origin (47 ahead) + merge via **PR not local** (main diverged) · rotate crates token · publish crates FIRST · **fund the commit wallet OR reframe the public "on-chain by default" claim** (prod PEGANA_COMMIT_KEYPAIR unset → the advertised verify cmd returns exit-5 not PASS — reputational) · the GTM block. **Highest-leverage: merge+deploy. Cheapest: send the Ernani reply.**

**✅ V2 COMPLETENESS PASS — feature+persona 1:1 loop → branch-fixable backlog CLEARED (2026-07-18, `3e988c1`→ hylo-alert).** Convergence framing (the user's "every time, more shows up": adversarial audits are unbounded, but the branch-fixable set is finite + shrinking; the rest is genuinely founder-only). Loop found 10 gaps (6S/3M/1L). **Cleared this pass (all validated, gate green):** `source_task_up` panic-freeze drop-guard · jupiter absolute $1M ceiling + justified the dexscreener asymmetry · **finished the sHYUSD→eHYUSD relabel** (7 files: Account page/alerts/subs/webhook-list + /audit H1 & OG-image + embed generator — a user saw the wrong symbol in their own account + the flagship receipt page self-contradicted + social-share PNG) · embed-widget doc (X-Frame-Options→CSP frame-ancestors) · MCP guides (`{asset:}`→`{symbol:}` — was copy-paste-breaking for integrators) · `PeganaHyloSanityFailures` alert (metric had no rule → 27 rules). **🟠 The BOUNDED V2-hardening backlog (engineering projects, NOT bugs — scoped so they stop re-appearing):** (1) test the verdict pipeline in CI — `try_recompute` + on-chain-commit retry SM (needs the `state.tick()` lib-extraction; the L item), (2) retraction-worker `poll_once`/`reset_inflight` test (the one worker in its family without one), (3) H12b market-leg value-staleness detector (extend the Perena nav-stall pattern to Jupiter/DexScreener), (4) architecture deepening (one `state.tick()` under one lock; unify the 2 hand-dup webhook-sign contracts), (5) verify webhooks-docs "delivery history" claim vs the actual UI. **These + the founder-only launch items are the COMPLETE finite remainder — nothing else outstanding on the code side.**

---

## Current state — 2026-07-17 (🔬 FULL V2 DEEP AUDIT — 33-agent, verdict needs-fixes→FIXED; new ARCHITECTURE map; NOT deployed)

Whole-V2 audit (33-agent workflow across engine/methodology/indexer/api/egress/web/contracts/commits/formulas/docs, each verified 1:1 + adversarially refuted). Baseline pre-audit + post-fix ALL GREEN: `cargo test --workspace` 43 suites, `fmt --all`+clippy clean, web tsc + **792 vitest**, promtool 26 rules, **CLI e2e byte-exact PASS** (real `pegana-replay` binary verifies a receipt). Verdict: well-built + fully-wired end-to-end, but 5 broken seams.

**✅ FIXED (`95637b5`, `40dd582`, `47d01c1`):** **[CRITICAL] webhook SSRF** — the dispatcher's reqwest client had no redirect policy → a 3xx `Location` bypassed the 5-layer `webhook_url` guard to loopback/metadata (`.redirect(Policy::none())`); **[HIGH] SSRF DNS** rebinding (validate moved inside the retry loop); **[MEDIUM]** cumulative Retry-After cap. **[HIGH] F-12 Decimal-division panics** (raw `/` panics on overflow, reproduced at price=1e-28) in `pyth_confidence_gate_violated` — reachable via the PUBLIC verifier (rederive on a crafted receipt) AND the live engine every tick → crash-loop — plus `pyth_confidence_label` + hylo's 3 NAV formulas → all `checked_div`, **byte-exact for valid inputs** (golden unchanged). **[HIGH] state_reason** UI mapped 3/5 → the 2 hard-override reasons (pyth conf + intrinsic liveness) now render. Plus doc/lint/type accuracy (recovery-policy, hylo-writer comments, eslint stray-disables, OracleDegraded `|null`).

**⏭️ DEFERRED (founder decision, user away — recommendation recorded):** **single-source-of-truth** — backend emits authoritative `thresholds`/`anchor`/`risk_side`/`worst_abs_24h` but the UI re-derives them in parallel hardcoded tables → a Postgres recalibration silently no-ops the UI (recommend: adopt the API field w/ fallback). `AlertRow.intrinsic_usd/market_usd` reconcileBps cross-check dead (recommend: drop the dead TS or wire a snapshot join). NOT launch-blockers (nothing deployed/recalibrated yet).

**📄 New docs:** `docs/ARCHITECTURE.md` (canonical backend+frontend map) · `docs/CLEANUP-MANIFEST-2026-07-17.md` (temp junk removed; tracked-docs cut left as a reviewed KEEP/REMOVE plan for approval). **⚠️ Coverage gaps:** engine dimension's agent died (overloaded) → covered indirectly; no live-prod validation (296 commits ahead of main); decoders not fuzzed; Piggybank/Perena uncovered by the liveness gate.

**✅ FOLLOW-UP PASS — deferreds executed + 3 gaps 1:1-closed + cleanup + lint (2026-07-17, `5f47bb8`→`f5b6c1f`, still `landing/v2-port`, NOT deployed).** Founder said "do everything, completely". Gate all green after: cargo 43 suites · fmt · clippy · web tsc · **eslint 0** · **784 vitest** (dropped 3 orphan-component tests).
- **Single-source-of-truth (`5f47bb8`):** UI now prefers the API's authoritative `assets.thresholds` over the hardcoded local table (`thresholdsFor` + `isValidBpsThresholds` validated fallback → hyUSD CR + malformed safely drop to local); a Postgres recalibration reflects immediately. **`anchor`/`risk_side`/`worst_abs_24h`/jitter 1:1'd → NOT a mechanical dedup** (unlike thresholds): `risk_side`=pure fn of `anchor`=pure fn of `class` (server-derived, no stored duplicate); frontend `pegJitter`=**stddev** while backend `jitter_bps_24h`=**peak-to-trough range** (different statistics — swapping would change rankings + break the calibrated jitter buckets) → founder-decision follow-up, no silent metric swap.
- **AlertRow dead cross-check (`dc7c597`):** dropped `AlertRow.intrinsic_usd/market_usd` (backend never emits them → reconcileBps always fell back to `discount`) + the synthetic-alert literal.
- **Gap 1 (engine dim):** deep-read main.rs/state.rs/onchain_commit.rs — NO live-data unwrap/expect/raw-arith, 4-gate override order matches `rederive`. Clean.
- **Gap 2 (no prod validation):** founder-gated (deploy), acknowledged, not a code fix.
- **Gap 3a (decoders fuzzed, `b0cf10a`):** 6 proptest no-panic props across perena/piggybank/spl (arbitrary bytes + valid-prefix-fuzzed numerics reaching the checked_div/sanity arithmetic); hardened piggybank's lone raw `nav=assets/shares`→`checked_div`. **Gap 3b (Piggybank/Perena liveness, ADR-0038 §Open #4, `d73e023`):** ASYMMETRIC — Perena (USD\*) ACTIVE but reserve carries NO on-chain freshness marker (`MIN_RESERVE_LEN=360`, layout confirmed) → structural blind spot, real close = RE research not code; Piggybank DEACTIVATED + `epoch_id` 48h → `epoch_lag>=2` wrong (needs `lag>=1`) → reactivation-checklist item. Both fail-OPEN + gate disabled-default = "when-enabled uncovered" note, not live risk.
- **Repo cleanup (`884cabc`, `29a531a`):** removed a verified dead web cluster — **12 files (9 source + 3 tests)**: `cta-link`/`anchor-number`/`dashed-corner-marks`/`live-ticker-card`/`active-mini-chart` + the retired `<Background/>`→`dot-grid`/`mouse-spotlight`/`use-spotlight` cluster — + 4 unreferenced handoff docs. **The CLEANUP-MANIFEST was 1:1-re-verified, NOT trusted** — several "safe to remove" targets were actually live-referenced (pre-V2 dirs cited by ADR-0022/0023 + pricing code; the interlinked design-research archive referenced from README/SPECs/e2e tests) → KEPT. **Lint (`f5b6c1f`):** cleared 7 pre-existing eslint errors (all from other commits) to green the gate.
- **🔴 F-12 raw-`*` recurrence CAUGHT + FIXED (`6c02528`) — the agentic loop earned its keep.** A read-only adversarial verification workflow (3 Sonnet falsifiers) confirmed cleanup + fuzz + ADR/dedup, but flagged one raw `Decimal *` the *original* F-12 sweep had rationalized as "safe": `spl_stake_pool nav_sol * sol_usd` (bounds only ONE operand — `sol_usd` is an unbounded external Pyth price). A discipline-driven re-sweep found the full recurrence (the raw-`*` twin of the raw-`/` ×5 class): **6 sites** → all `checked_mul` + skip: `pyth.rs scale_price` (positive-expo × large mantissa, the ROOT price input → Err, +regression test), `jupiter`/`sanctum`/`spl` (`× price` → skip tick/LST), `hylo` sHYUSD `rate × NAV` + xSOL `hyusd_supply × NAV` (labeled-block → None so the combined snapshot still publishes). **Workspace-wide re-sweep of engine/api/dispatcher/methodology/common = clean** (the one engine `m_usd/i_usd` hit is a `#[tokio::test]`, not a live path — gap-1 deep-read holds). Indexer-only → zero hash/golden impact. LESSON: the F-12 sweep must cover EVERY crate's `× price`/`/ value`, not just methodology/engine — the indexer sources were under-swept. Final gate: 43 rust + **98 indexer** + eslint 0 + 784 web, clippy/fmt clean.

**🔬 FOLLOW-UP DECISIONS — researched (context7 + web) + adversarial-loop-validated (`9fc8fbc`, `16d2906`). "Research the best option for the project + run a loop."** context7 had no Perena index; domain research (peer stablecoin peg-risk frameworks) confirmed stddev + peak-to-trough range + worst-case are ALL standard COMPLEMENTARY metrics. A 3-agent read-only validation loop then **REVISED all 3 preliminary decisions** with real evidence (it earned its keep again):
- **D1 jitter → WIRED (not just "keep + document").** Loop caught: `worst_abs_24h`/`jitter_bps_24h` are LIVE + public + **in the OpenAPI** (my "not in OpenAPI" was wrong → deleting was never on the table), AND the dashboard "Most Volatile" card already re-derived a "24h range" client-side from the **hourly-AVERAGED** `series_24h` — smoothing away intra-hour spikes on the one card named "Most Volatile" (a signal-honesty gap, worst during stress). Backend `jitter_bps_24h` (BSRV-03, minute-level extremes) is more precise + was spec'd a month ago to replace it. **Fixed** (`9fc8fbc`): typed both fields on `AssetCardData`, `dispersionBps()` parse helper (+4 tests), dashboard prefers the backend value w/ series fallback. `pegJitter` (stddev ranking+buckets) untouched. `worst_abs_24h` typed-but-deferred (net-new signal → build-to-demand). 788 web tests.
- **D2 Perena → disposition upgraded (`16d2906`).** Accept in-hash blind spot (fixture byte-scan confirms no timestamp/slot field). Replaced vague "reverse-engineer a field / future observation" with: (a) MEASURE the NAV cadence from the 3+ weeks of USD\* history already in `intrinsic_snapshots` (mig 0055, 30s) via a founder-run SQL query; (b) prefer a zero-inference `backing_unverifiable` advisory (ADR-0037 pattern) OVER a nav-accrual-stall heuristic. Added the explicit **USD\*-vs-dSOL deactivation asymmetry** as a founder-ratifiable note.
- **D6 xtask discount_sanity → already DONE** (`1377cce`, test at `backtest_runner.rs:215`) — the launch-readiness "deferred" label was stale. **D3 archive:** removed the one genuinely-orphaned file the loop found (`SYNTHESIS.md` v1, superseded by v2). **D4/D5** (deploy+dSOL / pbUSDC) remain founder-gated.

**🩺 FOUNDER-GATED ITEMS EXECUTED — "do everything except the MERGE" (2026-07-18, `d62aade`→`55e6194`, NOT deployed/merged).** Founder authorized the prod-touching items except the merge; did the read-only prod SQL + all code/decisions on `landing/v2-port`:
- **USD\* cadence SQL on prod (read-only, SSH):** 21d / 60,461 polls @30s — NAV ticks ~every 20 min (median), p95 ~1h17m, **MAX healthy flat ~3h35m**. This **flipped the decision**: USD\* is measurable → **cover it, don't just disclose**.
- **Perena intrinsic-liveness NOW COVERED (`d62aade`→`a3012f5`):** `nav_accrual_stall` writer, 12h window (~3.3× the observed max flat), fail-open, observe-only until the gate ships. Was the ADR's "live gap" → closed. **The adversarial loop hardened it twice:** `55e6194` self-caught a dip-and-recover false-fire (dropped strict monotonicity); then the "our workflow" loop found an **outage false-fire** (wall-clock "time since last change" mistakes a >12h indexer outage for a freeze) → `a3012f5` reformulated to an OBSERVATION-STATS window (`distinct<=1` flat AND `oldest_age>=90%` spanned AND `max_gap<=5min` continuously observed), which ALSO fixed the loop's cold-start-into-frozen miss. 99 indexer tests (6-case stall test). Loop also CONFIRMED observe-only/zero-hash + dSOL consistency + the ratification.
- **USD\*-vs-dSOL → RATIFIED keep-active** (ADR-0038): exposure now closed via coverage + the disabled-default gate, no incident history, 1 of 3 public yield-stables → deactivation would be a real regression.
- **dSOL reconcile → ALREADY DONE (verified, no change):** mig 0064 explicitly **split out / deferred** the reactivation ("dSOL stays is_active=false, no UPDATE"); all 4 surfaces agree dSOL is off (assets.toml `active=false` · DB `is_active=false` · web `DEPRECATED_SYMBOLS` · jupiter allowlist removed). The launch-readiness "reconcile at deploy" note was stale.
- **pbUSDC (`69a1cff`):** still NOT wired (deactivated, un-calibratable, dead code = anti-build-to-demand) — but corrected the reactivation checklist: its 48h `epoch_id` is a self-counter with no external clock, so it's a **monotonic stall (mirror `perena.rs`, ~96h window)**, NOT the `epoch_lag` the ADR previously said.
- **NOT done (respected):** the MERGE to `main` / prod deploy (`[[feedback_no_push_to_main]]`). Everything committed on `landing/v2-port`, gate green, nothing pushed.

---

## Current state — 2026-07-17 (🩺 BACKEND UPGRADE batch — trust-primitive + intrinsic-liveness sweep on `landing/v2-port`, NOT deployed)

Whole-backend audit (grill-with-docs → build → 1:1 → adversarial loop, per-item). The audit collapsed to one root defect: **the intrinsic side has NO liveness gate** — `sanctum.rs` re-stamps `ts=Utc::now()` every poll, so a frozen-but-served backing passes the 600s timestamp-only staleness as a confident false PEGGED (the exact 2026-04-01 dSOL failure). Sequenced fixes; the out-of-hash safe ones ship now, the verdict-affecting force-UNKNOWN work is founder-gated (CLI-first re-release).

- **✅ Item 1 — dSOL defer / split of mig 0064** (`c07fd47`): dSOL stays `is_active=false` (matching prod, mig 0020) NOT because it's unhealthy (pool is alive — rate 1.20497 rising, validator voting, backing intact, exploit hit the perps admin not the SanctumSpl pool) but because the intrinsic-liveness GATE that would catch a real freeze doesn't exist yet, and `monitoring_only` can't contain it (it became a beta LABEL, not an egress gate, 2026-06-16). Removed the reactivation UPDATE from mig 0064 (kept the 6 clean LST inserts); `assets.toml` dSOL → `active=false` with the rationale. Reactivates WITH the gate.
- **✅ Item 4 — state-aware `not_applicable` in the public verifier** (`9461d88`): the 404 handler skipped `commit_status="not_applicable"` silently for EVERY state ("expected for cost-gated transitions") → a user verifying the most SEVERE alert (Depeg/Critical/BlackSwan) got a green PASS (exit 0) while that alert carried zero on-chain anchor (engine writes not_applicable even for critical when `PEGANA_COMMIT_KEYPAIR` is unset — the current prod state). Fix: `not_applicable` is silently exempt ONLY for states the anchor policy never covers (Pegged/Drift/Unknown, via `state_expects_anchor()` mirroring `engine-rs`); a `not_applicable` on a severe state now surfaces as **ONCHAIN_INCOMPLETE (exit 5, ADR-0033)** — off-chain re-derivation still PASSED, on-chain leg honestly reported unverifiable, never a false PASS and never a tamper exit 4. Founder-chosen semantics (exit 5 over exit 4/warn-PASS). Strictly stricter (a Drift claim still skips; only honest severe receipts newly surface — no new attack surface). 18 unit + 14 integration green (incl. new severe→exit5); backtest golden byte-exact (methodology untouched).
- **✅ INTRINSIC_DEGRADED advisory — BUILT + validated (ADR-0037, `154830a`; the #1 upgrade of the batch).** Amber "backing may be frozen" badge on `/asset`, the backing-side twin of ORACLE_DEGRADED. **Research reshaped it:** the "wire the epoch fields" framing only covers 2 assets (jitoSOL SplStakePool + hyUSD Hylo) — Sanctum's sol-value API has NO epoch, so the ~41 `sanctum_lst` blast radius has no native signal. But **lst-directory.com already serves per-row `flags{stale,deprecated,dead}`** for exactly that universe (verified live 2026-07-17; `/lst` already parses it; dSOL row confirmed `deprecated=false,dead=false,rate=1.20497` — pool ALIVE). **Founder chose frontend-only + directory-flags-only:** same-origin route `/api/lst-liveness` proxies the server-only directory fetch → `useLstLiveness` SWR hook (LST-only) → `classifyIntrinsicDegraded` (worst-first dead>deprecated>stale, deliberately NOT rate-constancy per ADR-0024) → amber `st-drift` badge + `intrinsic_liveness` glossary. **OUT-OF-HASH** (zero methodology/engine/migration/API — ships with the Vercel web deploy, zero backend risk). 16 new tests, **791 web green**, tsc+eslint clean. **⚠️ 1:1 caught a regression from Item 1** (`9e68950`): the dSOL defer left dSOL's mint in the web `jupiter-quote` allowlist → the assets.toml↔allowlist drift guard failed → removed it (lockstep note). v2 open (ADR-0037 §Open): native epoch-lag for the 2 chain-read assets · software rate-freeze · in-hash force-UNKNOWN (the real gate close).
- **✅ Item 3 — lst self-audit recalibrated off a FALSE premise** (`8b00458`). The audit compared our_rate (Sanctum sol-value = **realizable**) vs directory `rate` (**booked** NAV) as if "the same fact" — they're not: a permanent redemption haircut, **verified LIVE ~114bps (bSOL) / ~124bps (jupSOL)**. The 75bps WARN/alert sat BELOW it → paged on every LST every poll. Recalibrated to 300bps (feed-integrity tripwire only) + fixed the "same stake pool" false comment. AND decoded the discarded `flags{stale,deprecated,dead}`+`ratePrev` → `pegana_lst_directory_flagged` gauge + WARN + new `PeganaLstDirectoryFlagged` alert = **backend twin of INTRINSIC_DEGRADED**. 19 tests, promtool OK (24 rules), backtest byte-exact.
- **✅ Item 5 — backtest coverage uncovered a REAL runner bug** (`1377cce`). The xtask runner's sanity branch checked only premium_sanity + an always-empty pyth gate — it **never called `discount_sanity_violated`** (self-admitted "pre-existing inconsistency from 0.5.0"), so a garbage-HIGH intrinsic → runner CRITICAL vs engine UNKNOWN, a silent divergence the golden would bake in. Fixed: all three gates fire (matches engine `rederive`). Added optional `Tick.pyth_conf` (serde-default None → golden byte-exact) so the ADR-0032 pyth gate replays end-to-end. 3 new tests (discount_sanity→UNKNOWN self-verify · wide-conf→UNKNOWN · narrow-conf→PEGGED control); 14 xtask green incl. byte-exact golden.
- **✅ Backend adversarial audit** (2-agent read-only sweep, findings 1:1-verified) → **Item 6 + safe hardening** (`c8a9380`, `19caa13`). The audit targeted the two proven defect classes (verdict-logic divergence · false-premise/discarded-signal) and found more: **(1) `SplStakePool` frozen-backing gap [Item 6]** — jitoSOL et al. decode `last_update_epoch` then DISCARD it, and the Item-3 directory `stale` flag covers only `SanctumLst`, so a stalled crank freezes the NAV undetected → wired `pegana_spl_stake_pool_epoch_lag` gauge + WARN + `PeganaStakePoolEpochLag` alert (≥2 epochs). **(2) sanctum per-LST `errs`** invisible in metrics (only ALL-fail paged) → `pegana_sanctum_lst_errs_total{lst}`. **(3) `PeganaHyloDown`** cited a dead DefiLlama dependency (false premise) → fixed. **(4) runner CR latent trap** — hyUSD would silently misclassify on bps (rederive self-check blind to it) → hard-error guard. Audit ruled the oracle asof-join, oracle_degraded, compute_discount, calibration joins SOUND. Deferred (lower value): hylo epoch-lag (partially mitigated), piggybank `flags` byte (SUSPECTED, pbUSDC deactivated). 90 indexer + 15 xtask green, promtool 25 rules, golden byte-exact.
- **✅ In-hash intrinsic-liveness gate — BUILT + validated (ADR-0038, `59a0075`; founder GO given).** The *real* close of the gap: a frozen backing force-UNKNOWNs instead of publishing a confident peg. **Built DISABLED-default** (env `INTRINSIC_LIVENESS_GATE`, depth-gate/ADR-0034 pattern) so it ships **provably inert + byte-exact**. Mechanism: new `InputsFrozen.intrinsic_stale` with `skip_serializing_if` → false OMITTED from the JCS hash → every existing receipt + the golden byte-identical; the engine sets it true ONLY when enabled → disabled = no DB read, field omitted, verdicts unchanged. **The plumbing (the coverage split → engine):** new `intrinsic_liveness` table (mig 0068) upserted by `lst_directory_audit` (sanctum_lst `flags.stale`) + `spl_stake_pool` (epoch-lag ≥2), read by the engine per asset (freshness-guarded, fail-open). Founder calls: **into 0.7.0** (unpublished bundle, no version bump) · **staleness-only** (dead/deprecated stay advisory). methodology 116 tests incl. the byte-exact omission invariant · golden byte-exact · full `cargo test --workspace` green. **To ENABLE: calibrate vs prod → set the env** (no new code deploy — ADR-0038 §Open). Still bundled for the same release: depth-gate shallow-market force-UNKNOWN, depth floor at ingestion (separate, not built here).
- **✅ Gate calibrated + hylo wired (`4843834`).** **LIVE calibration** (vs lst-directory.com, no prod): of our 41 tracked sanctum_lst, **1 tripped `flags.stale` — sharkSOL** (active, $141 dust) — but its rate is ADVANCING → a **false-positive**. Fix (founder call): the gate signal is now **`flags.stale AND rate==ratePrev`** (`directory_gate_stale`) — corroborate the flag with a confirmed frozen rate; sharkSOL no longer trips, a truly-frozen LST still does. Calibration caught the false-positive *before* the gate ever fired (ADR-0032/0035 discipline). **hylo epoch-lag WIRED** (the deferred item): `total_sol_cache.update_epoch` → `pegana_hylo_epoch_lag` gauge + `PeganaHyloEpochLag` alert + `intrinsic_liveness` upsert for **hyUSD+xSOL** (both read total_sol; sHYUSD excluded — pool-balance-based). So the gate now covers all 3 intrinsic-source types (directory-flag-corroborated · SplStakePool epoch-lag · Hylo epoch-lag). 91 indexer tests, promtool 26 rules.
- **⏭️ Deferred (documented skip):** **piggybank flags byte** (off 208) — SUSPECTED (the paused/halted flag semantics aren't reverse-engineered) AND **pbUSDC is deactivated** (mig 0040) → not worth reverse-engineering an unknown byte for a dead asset; if pbUSDC is ever reactivated, decode the flag first. Audit **ruled SOUND:** oracle asof-join, oracle_degraded, compute_discount, calibration joins.

---

## Current state — 2026-07-17 (🚦 V2 LAUNCH-READINESS AUDIT — verdict READY-AFTER-FIXES; blockers + HIGH fixed, 3 medium deferred. NOT deployed)

Holistic launch-readiness audit of the whole V2 (`landing/v2-port`): full pre-flight (**522 Rust + 774 web tests + tsc + clippy + promtool all GREEN**, branch synced) + a 4-frente agentic loop (backend / web-live / ops-docs / **/product-review**) → Opus verdict **`ready-after-fixes`**: "the V2 spine (V5 rebrand, methodology 0.7.0 safety, verifier default-on, market-cap, ops hardening) is solid + shippable." Per-feature go/no-go: **SHIP** = V5 rebrand · Pyth conf-gate (ADR-0032) · verifier default-on · ORACLE_DEGRADED · market-cap · depth-gate(disabled) · 4 frontend wins · self-calib alert · AC72.

- **✅ Fixed this pass:** (1) **[deploy-blocker] cargo fmt** — 6 files had rustfmt drift that would fail CI's blocking `cargo fmt --all --check` → `cargo fmt --all` (`00a7ab0`, formatting-only, backtest byte-exact). (2) **[HIGH product] sources-disagree color-clash** — removed the redundant red/green "sources disagree/agree" chart badge (kept the magenta oracle leg; hero amber ORACLE_DEGRADED is the single divergence home; neutralized the hover) (`837c995`). (3) **[deploy-blocker] Prometheus reload** — `curl prometheus:9090/-/reload` (compose DNS, unreachable from host) → `docker compose kill -s SIGHUP prometheus` (`6aed576`). (4) ADR-0036 stale "BLOCKING PRECONDITION" text (already reconciled).
- **🔒 Flagged (founder security call, no code changed):** **dSOL** — mig 0064 reactivates it but `web/.../format.ts:218` still lists it `DEPRECATED` → reconcile at deploy (reactivate+unlist, or defer+split). Runbook step 3 now spells out both options.
- **⏸️ Deferred (medium polish, non-blocking):** /asset hero **signal-density** (6-8 chips → one evidence strip — the badge removal already helped; full refactor is a focused follow-up) · **eHYUSD↔sHYUSD verify note** (code already documents the split in `display-symbol.ts`; low user exposure, no clean affordance) · **xtask backtest discount_sanity coverage** (falsifiability gap — discount_sanity is unit-tested in methodology, just not exercised in the replay; test-completeness, not launch-blocking).

---

## Current state — 2026-07-17 (🟡 ORACLE_DEGRADED — first FULL-STACK V2 feature BUILT (backend + V5 front) on `landing/v2-port`, NOT deployed)

Founder chose "full-stack the new features" for the V2 front push. Built **ORACLE_DEGRADED** end-to-end (the "amber" oracle-trust layer below the 500bps hard Pyth gate). **Sub-C deferred** — it needs the ADR-0016 anonymous-reads sign-off, which only the founder can give (pending).

- **Backend** (`7969dfd`): additive, **OUT-OF-HASH** advisory `oracle_degraded` on the single-asset detail `/v1/assets/{symbol}` (+by-mint) — NOT the list/screener. Pure `classify_oracle_degraded()` (new `crates/api-rs/src/oracle_degraded.rs`) over the independent Pyth oracle leg (asof-joined in `fetch_card` via the exact `lower(replace(pyth_feed_id,'0x',''))` key — no DOA repeat): `oracle_divergence` (|market−oracle|/oracle > 75bps) · `oracle_confidence_wide` (oracle conf/price in [100,500)) · `oracle_stale` (oracle publish age > 90s). Guards: oracle>0, skip if already `pyth_confidence_gate` UNKNOWN, checked-arithmetic overflow→None, worst-first reason. **Zero methodology/engine/Receipt/hash/migration touch → backtest golden byte-exact.** 1:1-reviewed + 81 api-rs tests (+10) + clippy.
- **Front** (`85cd6de`): V5 amber badge (`oracle-degraded-badge.tsx`, `st-drift` token) in `asset-hero-v2` on its OWN line below the verdict — complements `PythConfidenceBadge` (raw conf bucket), doesn't duplicate. Freshness-gated (H1/H9). tsc + 6 badge + 5 hero-regression vitest. Mirrors the existing badge idiom (no AI-slop).
- **✅ Live-DOM validated** (Playwright fetch-injection on the deployed preview): the amber badge renders — text "Oracle diverges · 142bps", color **`rgb(226,166,81)` = the `st-drift` amber token** (not the depeg rose), on its own line under the verdict, the Pyth-confidence badge still present (reconciliation intact), zero h-scroll. Reads as premium V5, not slop (screenshot confirmed).
- **🔁 /code-review + /product-review loop (fixes `9e5cd4a`) — caught + fixed 2 real issues:** (1) **[MEDIUM] conf window `[100,500)` dropped the worst case** — the engine's hard Pyth gate inspects the asset's NUMERAIRE feed (`pyth_feeds_for_asset` pushes only the numeraire for jupiter_usd), NOT the asset's own `<TICKER>/USD` oracle leg that `oracle_degraded` reads, so `conf_bps≥500` on that independent feed was neither amber-flagged nor gated → fell through. Fixed: **no upper bound** (removed the wrong `PYTH_HARD_GATE_BPS`), flipped the test into a regression guard (500/800/2500 now fire). (2) **[LOW] shared generic `pyth` tooltip** couldn't distinguish the numeraire conf bucket from this independent-oracle cross-check → new **`oracle_crosscheck` glossary term**. Both re-validated (cargo 81 + clippy · tsc + 6 badge + 5 glossary). **Noted, not blocking:** the legs-chart "sources disagree" (red/green, 3-way) vs this amber badge use different color vocab — but the main contradiction is impossible (legs takes the WIDEST pairwise gap ⊇ market↔oracle), so it's a minor snapshot-timing/color nuance → future "unify divergence source" item, not a launch bug.
- Thresholds are conservative founder-calibratable defaults (depth-gate/conf-gate pattern): divergence 75bps · conf ≥100bps (no ceiling) · stale 90s.
- **📄 ADR-0035** (`f8f2f14`) + **#3 CALIBRATION RUN vs prod (`22ee10d`) — defaults VALIDATED.** Ran Queries A/B/C against prod (SSH read-only, 14d/7d, statement_timeout): divergence 75bps → 0 trips USDC/USDT, 3/14d JupUSD (0.017%, genuine outliers); conf 100bps → 0 trips (max 89.9); staleness 90s → 0 trips (max gap 45s). **All three shipped defaults correct** (conservative-inert). ⚠️ Only JupUSD/USDC/USDT subscribed in prod today — re-run after the PYUSD/USDe/USDS `[pyth_feeds]` backfill deploys. **Runbooks updated:** v2-launch (api step 7 + self-calib alert step 7.5 + AC72 + calibration + Block C status) · oncall (PeganaAssetMiscalibrated playbook) · reproducible-builds (AC72 closes the v0.2.0 gap) · deploy-day.
- **🔒 Sub-C gated on ADR-0036** (`a3df136`, **PROPOSED but accept-ready** — founder "rethink before coding"): the anonymous-position data boundary — cascade-math (in-scope per ADR-0016) vs the killed per-wallet Sub-D. **Validated by a 3-angle adversarial loop → `accept_with_refinements`:** core decision CONFIRMED (variant A = what Chaos Labs/Risk DAO/DeFiLlama already publish; Pegana's distribution-only is MORE conservative — DeFiLlama even surfaces top-100 *individual* positions). Loop found real reconstruction/differencing holes → **hardened 6→9 invariants** (owner-field allowlist · k-anonymity k≥5 + dominance floor · simulate preset-shock-grid/bucketing anti-differencing · niche-asset suppression · copy guardrails incl. "Chaos Labs for Solana" internal-only). Design doc reconciled (dropped `loop_positions` → k-floored `loop_hf_distribution`). Build-facts VERIFIED (klend-sdk 9.1.5 + Jupiter Lend, Helius Dev $49 20-50× headroom). **NO indexer code written.** Starts only once you Accept ADR-0036 + the §0 reconciliation.

---

## Current state — 2026-07-17 (🧱 BLOCK C overnight — 2 safe features SHIPPED to branch (self-calib alert + Docker pinning) + Sub-B/Sub-C researched & spec'd; heavy verdict-facing features greenlight-gated. NOT deployed)

Overnight autonomous run on **Block C** (founder asleep, explicit order: "do all of block C completely... at every checkpoint code-review, test, validate, LOOP... research carefully, we can't get this wrong in the product"). Same workflow: grill + Context7 → Sonnet builds → **Opus 1:1 diff-review** → cargo/tsc/promtool → adversarial loop → commit per path → push `landing/v2-port` → note in ROADMAP+memory. **Nothing deployed.**

- **✅ Feature 1 — self-calibration Prometheus alert** (`953c3e6`). Turns the on-demand `/v1/calibration` self-monitor into a **continuously-exported metric + paging alert**. Extracted the health query into a shared `compute_calibration_health(pg)` (one SQL, two consumers — the `/v1/calibration` handler + a new 60s api-rs metrics task — so the gauge **never drifts** from the endpoint). Exports `pegana_calibration_health_code{asset}` (ok=0/watch=1/miscalibrated=2/no_data=-1/na=-2, unknown→-2 fail-safe) + `pegana_calibration_p95_bps`/`p99_bps` (skip-None so no stale gauge). New alert **`PeganaAssetMiscalibrated`** (`ops/alerts/pegana.yml`, group `pegana.calibration`): `expr: pegana_calibration_health_code >= 2` (miscalibrated ONLY), `for: 30m`, `severity: warning`, `service: api` (fixed from `engine` — see loop below). **Observability only — no peg/discount/state/verdict change; the `/v1/calibration` JSON contract is byte-unchanged.** New `ops/alerts/pegana_test.yml` promtool rule-test. Gate: `cargo test -p api-rs` **71 passed/0 fail**; promtool 23 rules + rule-test SUCCESS (**re-run locally w/ promtool 3.13.1**).
- **🔁 Feature 1 adversarial validation loop (fixes `433893c`) — caught + fixed 2 REAL bugs I'd missed** (5-surface Sonnet audit → Opus verify; the whole point of the loop). (1) **Stale-gauge false-page:** the query filters `WHERE a.is_active` and the Prometheus exporter has **NO `idle_timeout`** (my earlier "staleness clears it" note was wrong), so a deactivated *miscalibrated* asset's gauge froze at 2 → `PeganaAssetMiscalibrated` paged for a retired asset until restart. Fixed: the 60s task now diffs the asset set each tick and resets any dropped-out asset to `CALIBRATION_HEALTH_INACTIVE` (-3, below `>= 2`). (2) **Wrong `service` label:** the metric is api-exported (`api:9092` → `service=api`) but the alert hardcoded `service: engine`, breaking alertmanager `group_by`/inhibit routing → fixed to `service: api` (matches the sibling api-owned `PeganaWebSocketUnused`). Also corrected the Sub-B Switchboard doc (Surge is PAID, `ad200f7`+`d60e83a`). Both code fixes re-validated (cargo 71 / clippy / fmt / promtool +`-3` case + `service:api` assertion) + **adversarially re-verified: all 3 RESOLVED, no regressions.** Docker/Sub-C audits came back **clean** (0 findings). **Loop closed.**
- **✅ Feature 2 — Docker base-image @sha256 pinning + Dependabot (AC72)** (`59291d9`). All 12 `FROM` across the 6 service Dockerfiles pinned to their multi-arch INDEX digest (tag kept; each verified to contain `linux/amd64` — prod host is amd64) → reproducible deploy build, immune to registry tag-moves. `.github/dependabot.yml` (docker, monthly, grouped) re-pins to the latest digest per tag so pins don't rot / miss CVEs. Complements the existing `reproducible-build.yml` stub (closes its "Docker layer reproducibility" v0.2.0 gap). Digest-resolution verified via Docker Hub API; can't `docker build` locally (no daemon/heavy-proc rule) so build-proof defers to next `deploy.sh`.
- **📐 Sub-B Risk Signals — RESEARCHED + SPEC'D (design doc `3af4b1a`, `docs/design-research/2026-07-17-sub-b-risk-signals-DESIGN.md`).** Deep Context7/Solana-docs research. **ORACLE_DEGRADED** = amber oracle-trust layer, recommended as **API-synth annotate-only** (mirrors `stale_source`, zero methodology/engine/`Receipt`/hash/backtest touch) — **spec'd + ready to build on a one-line founder greenlight** (thresholds 100bps/75bps/45s + which surface). Venues: **Phoenix (orderbook/depth) + Switchboard (free Crossbar-simulate poll; ⚠️ Surge is PAID ~$3k/mo, not free — corrected `ad200f7`) are the real adds**; **Orca "TWAP" does not exist → drop**; **Pyth Lazer non-fit → defer**. **VenueFragmentation should NOT be a new PegState** (orthogonal to peg-distance; breaks the public "Five states" + backtest golden) → model as annotation. Founder-decision list in the doc.
- **📐 Sub-C Loop Intelligence — RESEARCHED + SPEC'D** (`docs/design-research/2026-07-17-sub-c-loop-intelligence-DESIGN.md`). "Chaos Labs for Solana" cascade simulator. **Kamino + Jupiter Lend = GREEN** (typed leverage → a REAL cascade model, not a heuristic); MarginFi/Save AMBER (inferred loops); **Loopscale RED → defer** (no public data path). New **`protocol-indexer-ts`** Bun service (SDKs are TS → don't reimplement in Rust), writes `loop_exposure_snapshots`+`loop_positions` (anonymous, ADR-0016) to the same Timescale; `simulate_depeg_impact` tiered model (Tier-1 = position-HF + shared DEX slippage curve + profitability gate → bad-debt). **Advisory only, walled off from the verifiable receipt** (no methodology bump). Realistic **v1 = Kamino+Jupiter ~2.5–3.5wk** (NOT the roadmap's 5-protocol/4–6wk). 5 founder decisions in the doc — critically **§8-A the ADR-0016 anonymous-reads line** + **§8-E v1-worthy-now given demand-gap** (recommend greenlight staged, go/no-go after C1).

**Honest gating of the rest of Block C (why not blind-built overnight, "we can't get this wrong in the product"):**
- **ORACLE_DEGRADED / venue legs / Sub-C** add **user-facing product surfaces + verdict-adjacent signals** → founder owns the thresholds/semantics/scope. Spec'd, one greenlight from build. The 2 shipped features are safe precisely because they're **internal** (an ops metric+alert; build hygiene) — no user-facing product decision.
- **AC70 reproducible-build** — stub EXISTS (`.github/workflows/reproducible-build.yml`); promoting to `on: pull_request` needs **3 green manual runs first** (its own comment) = founder action, can't run GH Actions autonomously.
- **AC67 devnet on-chain-commit integration test** — needs a **funded devnet keypair + live devnet RPC**; I can't run it to 1:1-validate (cred-guard blocks secrets; won't ship an unvalidatable test) → founder/infra-gated.
- **M10-ext** — a `task_up==0` alert would **re-introduce false-fires** on idle-Ok sources (the reason it was cut); promtool coverage is marginal → skip unless asked.

**▶️ Immediate next (all founder-gated):**
1. **Biggest lever — merge + deploy V2.** *Everything* above (V5 rebrand, market cap, the 4 product items, 3-leg, self-calib alert, AC72) rides `landing/v2-port`; **nothing is live**. The ordered activation is `docs/runbooks/v2-launch.md` (crates publish methodology-first → merge→main = Vercel → migs 0064-0067 → calibrate Pyth + depth GO/NO-GO → env → engine recreate → `deploy.sh --services 'api indexer'` → e2e). Merge = your call.
2. **Greenlight a heavy feature to build next** (same grill→build→1:1→test→adversarial-loop pipeline): **Sub-C Loop Intelligence** is the roadmap "killer"/demand-magnet — decide §8 (ADR-0016 anonymous-reads line, Kamino+Jupiter v1 scope, advisory wall-off, Helius $49 vs $499, v1-worth-now); **ORACLE_DEGRADED** is a ~3-5d fully-safe build (approve thresholds + surface). Venues (Phoenix + Switchboard-Crossbar) after.
3. **AC70/AC67** need *your* hands: run `reproducible-build.yml` 3× manually → promote; provision a devnet keypair+RPC → I build the AC67 test.

---

## Current state — 2026-07-17 (🔀 3-leg source-divergence "sources disagree" — BUILT + loop-hardened on `landing/v2-port`, NOT deployed)

The roadmap "killer" — intrinsic (NAV) vs market (DEX) vs **oracle (Pyth)** as a 3rd chart leg + a **"sources disagree"** badge on `/asset` Legs mode. Greenlit + built via grill-me/grill-with-docs + Context7 + a full adversarial verification loop.

- **Built:** pure `sourcesDisagree()` (`f030413`, +tests) · api `oracle_usd` on `/v1/assets/{symbol}/history` (asof-join from `oracle_snapshots`, honest-gated on `market_kind`) + **mig 0067** (index `oracle_snapshots(feed_id, publish_time DESC)`, `354dd34`) · chart 3rd leg (magenta/dotted) + badge (`fdf868d`).
- **⚠️ The loop caught it DEAD ON ARRIVAL** (`2e1894b`): `oracle_snapshots.feed_id` is stored **0x-stripped + lowercased** (indexer `pyth.rs`) while `assets.pyth_feed_id` is seeded **with `0x`** → the join never matched → `oracle_usd` NULL for every asset forever. **My live mock-validation gave FALSE GREEN (it bypassed the SQL); only the adversarial 1:1 loop caught it.** Fixed (`lower(replace(a.pyth_feed_id,'0x',''))`) + added the `oracle > 0` guard (JupUSD zero-price false-signal class) + corrected the honest-gate doc. Re-verified: `overallDeadOnArrivalResolved: true`.
- **Honest-gating reality:** the leg lights up ONLY for `jupiter_usd`/`dex_screener_usd` assets whose `pyth_feed_id` is actually SUBSCRIBED (in `[pyth_feeds]`) — USX/USDG/USD1/USDu/AUSD/JUPUSD/EURC/EUSX/PST. **NOT PYUSD/USDe/USDS** — their `<asset>/USD` feeds aren't in `[pyth_feeds]`, so the asof-join returns NULL and the leg hides gracefully. `assets.pyth_feed_id`/`market_kind` are display metadata, NOT engine-read (ADR-0034).
- **Gate:** cargo + 70 api-rs tests · tsc · **768 vitest** · mock-DOM live. Ships via `docs/runbooks/v2-launch.md` (mig 0067 + api rebuild). Memory: [[project_three_leg_source_divergence_2026_07_17]].
- **✅ `[pyth_feeds]` backfill DONE** (`a5d4321`) — PYUSD/USD, USDE/USD, USDS/USD verified live on Hermes 2026-07-17 (each id === the asset's own `pyth_feed_id`) + backfilled (oracle-stream ONLY, engine-inert — `pyth_feeds_for_asset` reads strategies not `[pyth_feeds]`) + `peg_target='USD'` gate (excludes LST/BRZ/EURC; also fixed a LATENT BRZ garbage-`oracle_usd` bug). The oracle leg lights up for PYUSD/USDe/USDS on deploy. **Backfill loop clean** (`backfillCorrect: true`, 0 issues across engine-impact/routing/peg-gate/correctness/regression). The whole 3-leg = DONE + 2× loop-hardened.

---

## Current state — 2026-07-16 (🎨 V2 frontend batch #2 — 4 net-new wins BUILT + BROWSER-VALIDATED on `landing/v2-port` @ `2ef4899`, NOT deployed)

`landing/v2-port` @ `2ef4899` (**preview only, nothing in main/prod**; merge/deploy founder-gated). Session orchestrated by Fable/Opus/Sonnet, preceded by grill-me + grill-with-docs + Context7. **Grill finding (saved the work): most of "Wave 1+2" was already shipped**, sparkline board (A7, wave W3), compare CSV + PNG (`compare/page.tsx` + lightweight-charts `takeScreenshot`), M10 dead-source (`PeganaSourceNotPublishing`), public alerts feed (=`/events` + RSS). Real scope collapsed to **4 net-new items**, all built + validated 1:1 (Sonnet implemented, Opus reviewed the diff, gate run by hand):

- **Asset-chart shaded bands** (`f2cd1b2` + test `9e442f3`): DRIFT/DEPEG/CRITICAL bands filled in behind the dashed guide lines, via a custom **lightweight-charts v5** primitive (`web/components/organisms/asset-chart-bands.ts`; `attachPrimitive` + `useBitmapCoordinateSpace` + `priceToCoordinate`, `zOrder:'bottom'`). Direction mirrors `thresholdLineSpecs`/`addThresholdLines` EXACTLY (only the +discount side for LST/stable_yield ADR-0021; symmetric otherwise; does not engage in legs mode). Validated: **live pixel-sampling on `/asset/xSOL`** (44 full-width lines with amber tint in the threshold zones) + **6 unit tests** covering the A10 sign risk + 1:1 review against the threshold code.
- **`/status/calibration`** (`8b7640b`): per-asset deep-dive of the calibration self-monitor that V5 had condensed into prose on `/status`. Real `<table>` (`ListRowsV2`) reading `GET /v1/calibration`, ordered worst-first (miscalibrated→watch→no_data→na→ok), health badges, graceful `-` for CDP/no-data. Linked from `/status` + sitemap. Pure logic in `web/lib/asset/calibration-health.ts` (+**10 unit tests**). Validated: **live mock-render** (exact worst-first order + all columns/badges).
- **Branded /compare share-card PNG** (`d3bc03d`): `GET /compare/share?s=SYM1,SYM2` via a **next/og `ImageResponse` Route Handler** (Context7-validated for Next 16), reusing the `opengraph-image.tsx` idiom (winged-P mark + wordmark + per-asset state + **holder-signed** spread). Server-side fetch from `/v1/assets`, no CORS. Additive **CARD** button on /compare (chart CSV+PNG stay). Validated: **200 `image/png` 1200×630** + **1:1 sign match with the board** (card and /compare show identical USDC −0.01% / USDT −0.09%, A10 trap eliminated).
- **/alerts → /events** (`2ef4899`): 308 permanent redirect in `next.config.ts` (clean alias, outside the sitemap). Validated live (308 + `Location: /events`).

**Also this round:** X3-safe (`6b0bde0`, a drift-guard test that breaks the build if `--color-st-*` ≠ `--v2-*`, killing the drift risk WITHOUT the risky cascade refactor) · a11y `/status/calibration` in the axe suite · nav compact-pill (`527747d`) screenshot-confirmed, **pending the founder's eye** (keep/revert).

**🔁 Completeness audit (adversarial workflow `wf_1a25020d`, 19 agents, Sonnet audits / Opus verifies+synthesizes):** initial verdict = NOT 100%, found **4 real defects** → all fixed (`d5c529a`) + re-audited adversarially (Opus, overallClean):
- **HIGH**: the share-card PNG used a copied **50bps** reconciliation while the board+CSV use the canonical `reconcileBps` (**200bps**); in the 50-200bps window the card would diverge >3× from the board it claims to mirror. Fix: import and use `reconcileBps`, parity by construction. (My USDC/USDT spot-check passed by luck, pegged stables have drift ~0.)
- **MED**: `/status/calibration` showed stale counters ("N assets" + stat strip) next to "feed unreachable" + ErrorState on a transient SWR error. Fix: consistent gate on `error`.
- **LOW×2**: the CARD filename used the canonical symbol (sHYUSD) vs displaySymbol (eHYUSD) in the body · the redirect comment said 301 (Next emits 308).

**Final gate:** tsc clean · **760/760 vitest** · DOM/pixel/PNG/redirect verified on preview · **audit loop closed (dry)**.

**⚠️ Founder (backend/infra, founder-gated):** `GET /v1/calibration` only has CORS for the PROD origin (`https://pegana.xyz`, returns ACAO), NOT for the `*.vercel.app` previews (unlike `/v1/assets`, which allows both). So the calibration page + the `/status` counters show "feed unreachable"/0 on **preview**, but **work in prod** (confirmed via curl: prod ACAO present, endpoint healthy 200/63 rows). Fix = align the calibration route's CORS list with `/v1/assets`'s (Caddy/api). Not a frontend bug.

**Deferred (recommendation, your call):** X3 stateMeta consolidation (zero visual payoff + `.pegana-v2`/X2 scope risk [[feedback_backdrop_filter_dead_use_opaque]]) · a11y color-contrast (brand decision locked, issue #74; the axe suite is already structurally complete). **Block C (needs your backend/deploy):** 3-leg oracle-divergence (backend M12 was cut, no oracle feed) · self-calib Prometheus alert · M10 extension. **Pending your eye:** nav compact-pill (`527747d`).

---

## Current state — 2026-07-16 (V2 batch — 4 product items BUILT + FULLY VALIDATED on `landing/v2-port`, awaiting founder merge/deploy. NOTHING is live.)

**The whole V2 lives on `landing/v2-port` (preview only) — `main` is untouched, nothing deployed.** Founder-gated to activate (see "What's LEFT" below). Everything here was built + 1:1-validated (tests re-run by hand + live-DOM + backtest replay-diff), not just claimed. Memory: [[project_v2_product_batch_2026_07_16]], [[project_landing_v2_rebuild_2026_07_01]], [[project_market_cap_feature_2026_07_16]]. Frontend detail (V5 rebrand + 4 polish rounds + market cap + inner-pages loop + OG-in-code) is in the ROUND-2 / market-cap / Round-1 sections immediately below.

**4 product items (greenlit 2026-07-16 via founder Q&A), built + validated, on the branch — NOTHING deployed:**
1. **eHYUSD relabel** (`a7a0c43`+`dff574a`) — Hylo's sHYUSD→eHYUSD as a DISPLAY-ONLY overlay (`web/lib/asset/display-symbol.ts`, ~70 sites); DB/receipt identity symbol stays `sHYUSD` (zero migration/replay change). A live-DOM 1:1 caught + fixed a missed prose site (DerivedEditorial `dff574a`); re-verified live 2026-07-16 (`/asset/eHYUSD` verdict prose renders "eHYUSD", 0 visible "sHYUSD").
2. **Verifier default-on + honesty** (`43b7fe8`) — pegana-replay **v0.5.0**: `--verify-onchain` default-on (`--offline` escape), new exit-5 ONCHAIN_INCOMPLETE (pending/RPC-down, never a false PASS), honest wording across CLI/README/web (closes the HIGH "verify-oversells-tamper" finding). **ADR-0033**. Root README SAS→SPL-Memo fix. (Agent falsely claimed fmt-clean → caught + fixed `cbe1a9f`; Prettier reflow of the web copy `5d694c0`.)
3. **Pyth confidence-gate** (`03de27e`) — methodology **0.7.0** (mig 0066), **ADR-0032**: conf/price >500bps → UNKNOWN (conservative-only). 500bps is a conservative default; founder calibrates via Query A/B vs `oracle_snapshots`.
4. **Depth-gate Phase 1** (`1d44095`) — engine, **ADR-0034** (ADR-0026's P1): thin-liquidity caps confidence→"medium" (never final_state). **SHIPS DISABLED** (`DEPTH_GATE_FLOOR_USD=0`) — inert until the founder runs the GO/NO-GO SQL + sets the env. **ADR-0026 memory correction: it IS the depth-gate, not a CR-deadband collision (that's ADR-0023).**

**Full validation loop (2026-07-16, all re-run by hand — "validate everything, e2e, backtest, stress-test everything"):** `cargo test --workspace` **508 passed / 0 fail** · clippy clean · fmt clean · **backtest 2025-10-10-usde-depeg reproduces BYTE-EXACT at 0.7.0** and its verdicts are **IDENTICAL to 0.6.1** (every asset's max_state/transitions/ttfa/discount unchanged — the Pyth gate is provably inert; only version+hashes differ) · web `tsc` clean + **738 vitest** · e2e **smoke 5/5** vs the live preview. Full e2e needs the CI backend-provisioned job — its tight 6s timeouts false-fail on a slow remote preview (Vercel cold-start + prod-API latency + WS-403); the pages DO render (DOM-verified). **1:1 caught 4 issues this loop, all fixed:** the DerivedEditorial miss (`dff574a`), a stale e2e assertion (dashboard heading retired by W3, `147f495`), the verifier fmt (`cbe1a9f`), a Prettier reflow (`5d694c0`).

**What's LEFT / founder-gated (to make ANY of the above live — the merge checklist):**
- **Merge `landing/v2-port` → main** (the whole V5 rebrand + market cap + the 4 items). Single gate for everything visual + web.
- **Publish `pegana-replay 0.5.0` to crates.io** BEFORE the engine rebuild (ADR-0030 CLI-first-then-engine; irreversible).
- **Run the calibration SQL vs prod**: Pyth Query B (confirm/adjust the 500bps) + depth-gate GO/NO-GO (then set `DEPTH_GATE_FLOOR_USD`). DB is founder-only (not reachable from the worktree).
- **Engine recreate** to pick up methodology 0.7.0 + the two gates (announce/dual-run cadence per ADR-0025/0030 — founder's call to compress or not).
- **Deploy market cap** (mig 0065 + `deploy.sh --services indexer`; engine untouched).
- **Full e2e run** on the CI backend-provisioned job (auth/data/latency specs can't run against a live preview locally).
- Older founder-gated carry-overs still open: engine synth_lev B fix + latency instrumentation deploy; accountSubscribe green-light (a rearchitecture — deferred); ADR-0007 launch-scorecard before 07-31.
- **Strategic reminder (unchanged):** the bottleneck is DEMAND, not more building — 0 paying, ADR-0007 kill-checkpoint 07-31.

---

## Current state — 2026-07-16 (🎨 V2 polish ROUND 2 COMPLETE — 5-wave survey→validate→fix (30 findings) + A4 taxonomy + nav pill grow — `landing/v2-port` @ `65e258f`, NOT deployed)

`landing/v2-port` at `65e258f` (**preview only; nothing in `main`/prod**; merge + deploy are founder-gated). **V2 polish Block CLOSED** (A4 done, X3 deferred, final validation live).

**Round-2 polish (2026-07-16):** 5-agent survey of the entire V2 (34 findings) → **adversarial validation** (5-verifier workflow: 31 CONFIRMED + 2 refined) + live Playwright/DOM pass BEFORE fixing (L14 refuted, A10 confirmed live) → **5 waves** implemented (Sonnet, disjoint files, tsc+vitest gate + commit by path + per-wave DOM verification): W1 hero+atmosphere (X1: DotGrid+MouseSpotlight retired, dashboard 3→1 background layers), W2 backtest+embed→V5 + audit skeleton + dead-code deleted, W3 dashboard (A1 hovercard-tap, SustainedBadge, sort-in-URL, the 2 cards), W4 **A10 sign bug fixed in /compare+/events** (premium showed −; now +) + account (webhook confirm/edit, settings error, hub table), W5 cleanup. **⚠️ X2 regression caught+reverted:** extracting the nav glass to plain-CSS computed `backdrop-filter: none` (the law of [[feedback_backdrop_filter_dead_use_opaque]]), restored the arbitrary Tailwind (blur(20px)), caught by DOM verification (tsc/vitest don't catch computed CSS). **Nav logo (his request):** revealing "egana" now **grows the whole pill** (content-width centered ≥920px) instead of repositioning the items; mobile intact. **A4 DONE (`65e258f`):** dashboard unified on the screener's canonical taxonomy (8 facets → 4 tabs All/LSTs/Stables/Synthetic via `CLASS_TABS`+`matchesClassFilter` as a single source), verified live. **X3 DEFERRED** (14-file refactor, zero visible drift, regression risk like X2, do it when the next class/state is added). Final live validation: A4, backtest V5 (0 old tokens), embed V5 (pill-tabs, +demo-link), ⚠️ residue: `EmbedSpecimenStrip` with 4 old-token elements (minor). tsc clean · **705 vitest** · key surfaces DOM-verified. Full doc: `docs/design-research/2026-07-16-v2-polish-round2-inventory.md`. See [[project_landing_v2_rebuild_2026_07_01]].

---

**📣 MARKET CAP: demand-driven feature (X, 2026-07-16), BUILT + 1:1-validated, awaiting his deploy.** A prospect praised the logo/UI + asked for a market cap column on the stables. **Implemented full-stack (additive/isolated, zero touch to NAV/discount/state/calibration):** migration `0065` (columns `circulating_supply` + `supply_updated_at` nullable) + isolated source `crates/indexer-rs/src/sources/token_supply.rs` (reads the SPL Mint supply @ offset 36, Token-2022-safe, ~10min cadence, panic-free, 12th task separate from the NAV ones) + sink `update_circulating_supply` (only 2 columns) + `AssetCard.market_cap`/`circulating_supply` (= `circulating_supply × d.market_usd`, `null` when the factor is missing, like `discount`) in the **3 REST endpoints** + OpenAPI + column on the `/assets` screener (compact USD, sortable, framing "size signal, NOT safety", graceful "—"). Commits: `f987ac2` backend · `739318f` contract fix · `ad34a5d` column. **Full 1:1 (I ran cargo build+test + tsc+vitest myself; caught a skip-if-none-vs-required contract bug that ALL the tests were passing):** cargo green (83+api), 705 vitest, "—" column verified live (0 overflow, zero NaN). **FRAMING (critical):** "bigger=safer" is the fallacy Pegana corrects (USDC $30B+ mar/2023), market cap is **size context, NOT safety**. **Your side to activate:** migration `0065` + `deploy.sh --services indexer` (engine untouched). All on `landing/v2-port`, nothing in main.

### Round 1 — V2 finishing pass (2026-07-15)

**`/lst`: public peg-risk directory for LSTs (new, on preview):** the lst-directory.com universe (Hylo, 244 LSTs, 15m refresh) + live Pegana verdict (`/v1/assets?class=lst`, 60s), merged by mint, with a graceful fallback to Pegana's own LSTs if the directory goes down. Table: **real logo on EVERY row**, covered ones via vendored TokenIcon (`/tokens/{mint}.webp`), uncovered ones via a **same-origin proxy** `app/api/token-logo/route.ts` (relays the directory's `logoUri` through our origin because the `img-src 'self'` CSP blocks external CDNs; SSRF-safe, the client only sends the `mint`, the fetched URL is always the logoUri the directory published for that mint; http(s)-only, private hosts blocked, content-type `image/*`, 5s timeout, 1MB cap, any failure→404→monogram), 209 proxied images verified 200 on preview; own **"vs NAV"** column (premium + / discount − in the holder convention); header "The universe" + credit to lst-directory.com. Hylo partnership proposal in `docs/outreach/2026-07-15-hylo-lst-directory-integration.md` (the /lst demo IS the pull-test). See [[project_landing_v2_rebuild_2026_07_01]].

**Final V2 finishing pass (waves post-`9852bc6`, all on preview):**
- **App-wide direction-sensitive fix (ADR-0021):** LST/stable_yield with a PREMIUM now reads as calm, never "depegged", the "Closest to its band" card showed a ~1% premium (mSOL) as "100% off-scale"; fixed to 0%/benign/+1.03%. `BandGauge` gained a `klass` prop; carve-out in band-gauge/dashboard-board-row/asset-rail/screener.
- **bps→% across the ENTIRE user-facing app** (keeping literal `spread_bps` only in JSON/API samples) + holder-signed spread on every surface (board, /lst, dashboard, product-tabs, backtest, alert-policy).
- **`/lst` table enriched:** sortable headers (aria-sort + chevron, client-side, nulls sink) + direction-sensitive "vs NAV" mini-bar (premium→empty/calm, discount→fills toward the threshold).
- **Onboarding redone (3 attempts → approved):** rejected 2× ("terrible"); final version = **iPad-horizontal 1216×816** card (~3:2), rich Concept/Model/Signal/Surface/Action sidebar back, no redundancy (title "Welcome to Pegana" visible 1×; the 2nd occurrence is sr-only), no text wall (lede ≤14 words), opaque card. Verified via DOM on preview.
- **Hero + background (this session, `6495b4d`/`c055052`):** the hero's "prismatic triangle" had a bug: the `v2-arcbreathe` keyframe forced `opacity: .8–1`, ignoring the code's `0.14` (CSS animation beats inline), so it rendered ~6× stronger and the rays crossed the H1. **Rafael asked to remove it, so it was removed entirely** (cone + rays + apex); the light arc behind the board stays. **Dashboard BLUR:** `AmbientGlowBg` (in `layout.tsx` = EVERY logged-in page) went from an almost-invisible whisper to a **coral→magenta→lavender brand wash** (3 radials, max alpha 0.055, weighted toward the corners so it doesn't wash out the tables). Both verified via DOM on preview (`prismBeamGone: true`; 3-radial glow present). ⚠️ Found while measuring: the dashboard still has a **dotted-grid** + a **cursor-following glow**, 3 background layers stacking; I suggested retiring the dotted-grid for the premium-clean look (Rafael's call, not done).

**The 4 flags from "1001% validated," all closed:**
1. **bps→% + spread sign:** the /lst showed LST premium as a discount (inverted sign from the internal `discount` field, which signs `intrinsic−market`); fixed at the data layer (`lib/lst/merge.ts` negates → `spreadBps` holder-signed). Playwright-verified on preview (JupSOL +1.12%, mSOL +1.03%…).
2. **Divergence alert (self-audit #1):** `PeganaIntrinsicDivergence` (warning/indexer, `pegana_intrinsic_divergence_bps > 75` for 30m) in `ops/alerts/pegana.yml`, complementing the `lst_directory_audit`'s metric+WARN. `promtool check rules` OK (22 rules). 4 judgment calls decided and documented (denominator = our rate; match-by-mint with no symbol-fallback; 75bps = `INTRINSIC_DIVERGENCE_TOLERANCE_BPS`).
3. **Real icons for the 7 new LSTs:** vendored from the Sanctum registry (`extra-api.sanctum.so/v1/lsts`); `MONOGRAM_FALLBACK` removed from the guard; `vendor-token-icons.mjs` restored (had been accidentally deleted in a react-doctor pass, `712c6ca`).
4. **"Pegged −1%":** was the #1 sign bug (not threshold); resolved by #1. LST thresholds (drift 55/depeg 140/critical 300) are correct.

**Bonus (2 mobile bugs found on Playwright, both fixed):** (1) the **marketing** nav drawer (`.v2-ndrawer`) leaked the hero behind the links: `backdrop-filter` computed `none` (loses to the Tailwind v4 cascade / iOS fixed+rounded), so any translucency leaked through; swapped for a **solid** background (`#141418`); see [[feedback_backdrop_filter_dead_use_opaque]]. (2) the **app-shell**'s native `<dialog>` menu (dashboard-topbar) opened **EMPTY** on mobile: the `<dialog>` is `fixed top+bottom` but the UA gives it `height: fit-content` and all children are absolute/fixed, so it collapsed to ~0px; `height: auto` on `.mobile-menu-dialog` makes the top+bottom stretch (0px→771px). Both Playwright-verified on preview (`9852bc6`/`e61dc58`).

**Real-`<table>` pattern CONFIRMED universal:** audit of ALL data surfaces (dashboard board, /assets screener, /account/alerts, peer-comparison, exit-liquidity, alert-policy, audit-calibration, /lst + marketing via `ListRowsV2`) found **100% real semantic `<table>`s, zero `<div>`-table**. Formalized in `web/AGENTS.md` (§ "V2 data tables — always a real `<table>`"). **Nothing to migrate**, the dashboard board and /lst already use the same approved `<table>`/`<colgroup>` mechanism.

**Validation:** tsc clean · **705/705 vitest** · Playwright/DOM on preview (desktop + mobile; 0 horizontal page overflow; this backend's screenshot-tool times out at 5s, so verification was via DOM measurement) · `git push origin landing/v2-port` (preview branch, **NEVER `origin/main`**). Recent commits: `28cc2d7` final-consistency (bps→% + carve-out) · `c9f4fc8` onboarding iPad 1216×816 · `6495b4d` blur dashboard + tune prism · `c055052` remove hero triangle · `dd4e839` prettier. (previous /lst wave: `dd89a0d` icons · `95142f1` spread-sign · `86075eb` alert · `56e3824` /lst redesign · `9852bc6` drawer.)

**Founder-gated (outside my reach, NOT done):** engine deploy with the expanded `assets.toml` (the 7 LSTs + dSOL only light up "rated" on /lst AFTER that; today they show "not yet rated", which is honest); merge `landing/v2-port → main` (V5 rebrand).

---

## Current state — 2026-07-01 (🚀 methodology 0.5.0 LIVE — crates + engine + DB + tag; docs aligned)

`main` at `fbdc82e`, tag `methodology-v0.5.0`. **Complete 0.5.0 release (intrinsic-sanity, ADR-0030) EXECUTED and verified live:**

- **crates.io:** `pegana-methodology 0.5.0` + `pegana-replay 0.4.2` (embeds 0.5.0) **published**; `0.4.1` remains to verify 0.4.0 history (version-pinning).
- **Engine:** deployed (rebuild), `/v1/methodology` = **0.5.0 active** (mig `0062` marks 0.4.0 deprecated). Universe **63/63, 0 stale/null, no regression** (every asset we touched: sHYUSD/PST/ONyc/USDu/JLP, PEGGED and healthy).
- **Golden 2025-10-10 re-baselined + drift-gate "no drift"** (0 state changes; only the version). **Proven inert** (real max direction-sensitive discount = 245bps ≪ 3000).
- **Docs:** consume-the-peg-feed guide + public changelog (docs-site/pegana.xyz/docs) updated w/ the verify's version-pinning.
- **Validation (nothing broke):** 92 methodology + engine tests · merge validated (items 2/3 preserved) · codex + Opus 1:1 (caught 2 misses: `pegana-replay` dep pin + clippy).

**⚠️ Remaining founder-gated items (outside my reach):** **(1) rotate the crates.io token** (was pasted in chat, so it's burned); **(2)** GitHub release of the public repo `lrafasouza/pegana-replay` for the `curl|sh` path (cargo-dist + Sigstore, `cargo install` already gets 0.4.2, but the binary installer still serves 0.4.1 until the public repo's release).

---

## Current state — 2026-07-01 (technical backlog: PST/ONyc + H2-web DEPLOYED · 0.5.0 intrinsic-sanity READY)

`main` at `ccb7caa`. The "bundle 0.5.0" audit with **real data** (our own Jupiter $1k/$10k probe) **shrank** the bundle, and 3 items were implemented (codex + Opus 1:1; validation caught 2 misses from codex: the `pegana-replay` dep pin and a clippy warning, both fixed).

- **✅ Item 2, PST/ONyc `dex_screener`→`jupiter_usd` DEPLOYED** (`2eb831b`, mig 0061, `--migrate --config-only`). They're DEEP on Jupiter (0.02%); DexScreener's "top pair" was pool-dust (the pbUSDC mode) → **PST flapping DRIFT → stable PEGGED.** Verified. sUSD/pbUSDC untouched.
- **✅ Item 3, H2-web `state_reason` on UNKNOWN DEPLOYED** (`ccb7caa` → Vercel). Terse `stateReasonLabel` helper + render only in `asset-hero-v2`. **M4 (sign flip) CUT**, the negative-sign-for-premium is a **tested** design decision (the existing test caught it); don't override our convention. Validated: tsc + **475 vitest tests** (no `next build`).
- **⏸️ Item 1, intrinsic-sanity 0.5.0 READY, NOT deployed** (`feat/intrinsic-sanity-0.5.0` `87ca157`; **ADR-0030**). `discount_sanity_violated` (bound 3000bps), mirrors premium_sanity on the discount side (the JLP garbage of 21817 vs 3.41). **"Nothing can break" validation:** 92 tests; **drift-gate backtest = 0 state changes** (only the version changes); **0 current assets flip** (real max 245bps ≪ 3000). **Deploy = founder-gated CLI-first release** (the published `pegana-replay` 0.4.1 CLI gives `exit(3)` on a 0.5.0 receipt, so the CLI needs a re-release embedding 0.5.0 on crates.io BEFORE the engine, per F-13b; publish is irreversible + the leaked token). **Recommendation: no urgency (inert), deploy when there's a reason or alongside a future methodology change** (amortizes the announce + CLI release).

**0.5.0 audit findings (real data):** depth-gate **marginal** (only sHYUSD is thin at $1k/$10k, and it's already contained by premium_sanity; the 22 LSTs are deep, depth verified); H1-xSOL **cut** (unsafe without M6); PST/ONyc = **source swap**, not depth-gate. **Hermes (H3) validated, non-issue** (the public endpoint continues post-07/31 with a redirect).

---

## Current state — 2026-07-01 (later: 7-asset promotion + JLP root-cause + intrinsic-sanity gap)

`main` at `510ff8f`. Technical backlog pulled + validated (read-only agent fan-out + codex + Opus 1:1). **1 safe-today item SHIPPED; the other 3 are bundle 0.5.0 verdict-affecting, not today.**

- **✅ 7 beta→calibrated promotions** (`510ff8f`, migration `0060`, `deploy.sh --migrate --config-only`). Post-ADR-0029 all read `ok`, 0 transitions: **mSOL, INF, bbSOL, hyloSOL** (calib-v1 downgrades) + **JupUSD, EURC** (Phase-0) + **AUSD** (expansion). Verified live: all `monitoring_only=false`/`calibrated`/PEGGED. **Beta universe 50→43, calibrated 13→20.** Holds intact (hyloSOL+/ONyc/sHYUSD/xSOL/JLP stay beta; the sHYUSD annotation kept = HARD BLOCK). 45 engine-rs tests parse the `assets.toml`.
- **🔬 JLP BLACK_SWAN (06-24) root-caused** via a public history endpoint (no SSH): the **Pyth `JLP/USD.RR` feed (intrinsic) printed `21817.55`** vs. the correct `3.41` (garbage ~6400×) → discount 99.98% → false BLACK_SWAN. The market was right. **Artifact explained, but JLP stays HELD** (not promoted).
- **🆕 Real new gap, intrinsic-sanity:** a garbage-HIGH intrinsic generates a ~99.98% discount that **slips under the only `|d|<1.0` guard** (`discount.rs:68`) and under `premium_sanity` (only catches the premium side). A garbage feed triggers a false terminal BLACK_SWAN that reaches the public egress (beta). Fix = symmetric NAV-sanity on the discount side. Goes into **bundle 0.5.0**.

**Bundle 0.5.0 (the only big remaining technical lever, verdict-affecting, founder-gated, NOT a priority):** depth-gate Phase 1 (ADR-0028/0026, **Phase 0 is ALREADY live**: mig `0056_liquidity_observations` + Jupiter $1k depth-probe in metrics) + **H1** (premium_sanity→synth_lev via a separate predicate + a per-class bound that **needs to come from observation, not a guess**, M6/M7) + **intrinsic-sanity (new)**. All in a single 0.4.0→0.5.0 bump (ADR-0028 §5) → **7-day announce + replay drift-gate diff + ~2 weeks of observe-calibration + founder go.** Held until then: JLP, the 22 new LSTs without Pyth (depth), USDG/USD1 (medium-conf).

**⚠️ STRATEGIC:** nothing technical is urgent. **Demand is the priority** (Rafael working it in another agent, awaiting responses 2026-07-01). 0.5.0 is the founder's decision, no rush.

---

## Current state — 2026-07-01 (calibration honesty + USDu revive — tech PROVEN solid, the gap is demand)

`main` at `cd85175`. **3 fixes DEPLOYED + verified live** (codex-implemented + Opus 1:1 + clean `codex exec review`):

- **ADR-0029, `/v1/calibration` direction-sensitive** (`b4e5d89`, `deploy.sh --services api`). The endpoint measured p95 over `abs(discount_smooth)` **symmetrically**, labeling **30 premium-side LSTs + INF as `watch`** on a public trust surface, contradicting the engine itself (ADR-0021 premium carve-out). Now it mirrors the engine: the discount side counts; benign lst/stable_yield premium is carved out; premium >1000bps (NAV-sanity 0.4.0) counts in full; symmetric classes follow `abs()`. **Read-only, no methodology bump, no migration, no receipt/FSM impact.** Live: **beta health 31 watch → 1 watch**; INF/mSOL/… `ok` (p95=0); **sHYUSD stays `miscalibrated`** (1490); **PST stays `watch`** (37). + `no_data` guard (<200 samples/8d). Retro `docs/operations/retro-recalibracao-2026-07-01.md`; ADR-0029; promotion-criteria's criterion 4 amended.
- **USDu revived** (`cd85175`, config-only recreate engine+indexer). The Pyth `USDu/USD` feed was **DEAD for ~179 days** (verified via Hermes), so the asset read null across the board. USDu **is Jupiter-tradable** (1→0.9984 USDC, 0.0002% impact) → market swapped to `jupiter_usd` (CASH pattern), the dead `pyth_feed_id` cleared. `assets.toml` is a `:ro` mount → config-only recreate, no rebuild; validated by `engine-rs`'s 45 tests. Live: PEGGED, high-conf. **Universe now 63/63 alive, 0 null.**
- **deploy.sh auto-prune** (`b74bdde`): every `--no-cache` build now does an `image + builder prune` after the recreate (audit M16, disk bloat; skipped on `--config-only`).

**False-alarm self-check (the recurring lesson: VERIFY, don't assume):** the LSTs' premium is **REAL** (Pyth cross-check: jitoSOL 88/79, INF 162/161, bSOL 83/72), so the carve-out is correct, it doesn't hide signal. **The trap is in PROMOTION, not the metric:** `health=ok` **≠** market-verified, the **22 new LSTs without a Pyth feed** are priced from the 1-unit Jupiter quote the audit flagged (C1/C2), so they **stay beta** until depth verification (ADR-0028/0026; the audit roster = INVESTIGATE >$1M or skip). **DO NOT mass-promote.** **The "86%" M16 disk finding was STALE (real: 14%); "Jupiter unpaid" is NOT breaking anything** (62/63 fresh; the free Quote-API tier continues, only the legacy grace period + the unused Content-API expired 06/30–07/01). state_reason/H2 + H4/H8/M3/Track D already deployed.

**⚠️ STRATEGIC (holds the line):** after **5 verification passes** the tech is **empirically solid**, every "urgent" audit item dissolved into already-done or a false alarm; the only thing genuinely broken was USDu (fixed). **The gap is DEMAND, not code** (06-22 verdict, [[project_demand_gap_verdict_2026_06_22]]). **Rafael is reaching out about demand (2026-07-01).** Next technical lever (only if pulled, NOT a priority): market leg with depth (C1/C2) via **tokens.xyz** (ADR-0026, **zero Jupiter cost**, correct since we won't pay), built **validated on the local stack, not blind.**

---

## Current state — 2026-07-01 (brand "Wave Signal" LIVE + CI hardening — hygiene, not growth)

Closing session, **hardening/brand, does NOT move demand** (the real bottleneck remains 06-28/CURRENT FOCUS + demand; see [[project_demand_gap_verdict_2026_06_22]]). **4 PRs merged into `main` (`c3febcf`)**, CI green on the final commit; the calibration batch `252dbb0` (ADR-0029) was **preserved**, the merge combines diffs, nothing overwritten.

- **#88, Brand "Wave Signal" LIVE** (`236da54`): logo `[ pegana ]` (Threshold Brackets, retired) → **gradient wave + wordmark** in web (`brand-mark.tsx`, favicon chain, OG/twitter cards, `global-error`) + docs-site Mintlify (logos/favicons/`docs.json`). Single source = `web/lib/brand/wave.ts`; zero `[ pegana ]` remaining. Vercel + Mintlify deploy live. **Supersedes the "AGENT ACTIVE, never touch" note in the 06-30 entry below:** `brand/wave-signal-swap` was merged.
- **#89, `pegana.xyz/docs` logo fixed** (`7d02d9e`): it rendered broken, `web/proxy.ts`'s strict CSP was applied to the `/docs`→Mintlify rewrite, blocking the `mintcdn.com` logo (`img-src`) + the Mintlify scripts. Fix = exclude `docs` from the proxy matcher (Mintlify has its own CSP) + `web/proxy.test.ts` as a regression guard. Verified live.
- **#90, `cargo-audit` green** (`cef3438`): 3 new advisories outside the allowlist. Lockfile bump (`quinn-proto` 0.11.15 [DoS QUIC], `anyhow` 1.0.103 [downcast_mut unsound]) + a justified `--ignore RUSTSEC-2026-0186` (memmap2: Solana pins 0.5, no reachable fix, and Pegana doesn't load genesis, dead path). Restores the green-when-clean gate; zero reachability (grep-verified).
- **#91, de-flake the worker integration tests** (`c3febcf`): `commit_retry_worker.rs` + `evidence_reconcile_worker.rs` raced on a shared Postgres (the workers scan the whole table, no `alert_id` filter), causing random red on the Rust job on main. Fix = drop the racy aggregate assertions (`stats.X >= 1`), keep the per-`alert_id` ones (the `retry_skips_when_parent_not_pending` pattern, which never flaked). **Zero production code.** See [[project_flaky_commit_retry_test_2026_07_01]].

---

## Current state — 2026-07-02 (hardening backlog — 3 shipped, 3 cut, 1 incident fixed)

`main` at `e073118`, deployed + verified live. Ran the tech-hardening backlog via 3 parallel worktree agents (Sonnet impl) + Opus 1:1 review; pruned against ADR-0007 + the proof-trap lesson. **Shipped:** **M10** per-source liveness gauges (`pegana_source_task_up` / `pegana_source_last_publish_timestamp`) · **Spec 02** embeddable badge made honest (the "✓ verifiable" link was hollow — `audit/page.tsx` ignored `?asset=`; wired the filter + `/audit?asset=` link + NEW SVG route for README `<img>` + live `/v1/assets` picker + state-conditional TTL; 520 web tests green) · **Spec 05** jitoSOL **direct SPL stake-pool read** (pool `Jito4A…Awbb`, verified on-chain; removes Sanctum from jitoSOL's trust path; **no methodology bump**; migration `0063`, ADR `0031`; post-deploy overlap 19.3 bps = SOL/USD drift, not divergence; universe 63/63 healthy). **Cut (ADR-0007 / proof-trap / auth-risk):** Spec 06 (non-event attestation + incident page), Spec 07 (backtest expansion), F-06 (JWT→httpOnly cookie). **M12** ongoing intrinsic cross-check descoped to the fan-out (a snapshot-diff dies silently once the flip drops jitoSOL from Sanctum's poll). **🛑 INCIDENT + durable lesson:** M10's initial design force-restarted the indexer on any unexpected source-task exit → **crash-looped prod** because idle sources legitimately `return Ok(())` (deactivated single-asset sources). Reverted the auto-restart to log-and-continue, kept ONLY the liveness gauges. **DO NOT force-restart the indexer on a source *return* (Ok/Err) — only a panic is an uncontrolled crash.** See [[project_hardening_batch_2026_07_02]]. **Strategic line unchanged: demand is the gap — this was hardening, not growth.**

**2026-07-02 (later) — M10 completed + residual backlog re-validated.** Shipped **`PeganaSourceNotPublishing`** (`d37564b`, `deploy.sh --config-only --services prometheus`): `time() - pegana_source_last_publish_timestamp > 300` for 2m, warning → Telegram; fires **~8m earlier** than the engine-side `PeganaDeadAssets` (`STALE_AFTER_SECS=900`/15m) + names the source; **self-selecting** (the gauge is set only on a successful publish → idle sources never create the series → never false-fire). Validated: `promtool SUCCESS: 21 rules`, confirmed live in the running Prometheus API (21 alerting rules, all 20 originals intact). context7-confirmed the design is the canonical OpenMetrics `*_last_*_timestamp` + `time() - gauge` idiom. **This makes the M10 gauges actionable — M10 is now complete.** Senior re-analysis of the residual backlog (validated, not guessed): **`task_up==0` alert DROPPED** (would false-fire on idle sources — the same idle-Ok class that crash-looped M10's auto-restart); **M10 auto-restart CUT permanently** (the alert replaces it — visibility→manual restart beats a restart that can crash-loop); **Spec 05 fan-out + M12 DEFERRED** (demand-gated — the jitoSOL pilot already carries the trust-min narrative; fan-out is grind for marginal gain); **Specs 06/07/F-06/04-P1 stay CUT** (no new signal). Net: the technical backlog is now closed — everything material is shipped or cut with a specific reason.

---

## Current state — 2026-06-28 (🎯 CURRENT FOCUS: full audit + validation + plan)

**Master document (source of truth):** [`docs/call-prep-2026-06-18/audit-2026-06-28/2026-06-28-MASTER-auditoria-validacao-plano.md`](docs/call-prep-2026-06-18/audit-2026-06-28/2026-06-28-MASTER-auditoria-validacao-plano.md). Consolidates the audit (60 findings) + independent adversarial validation + live verification in prod (SSH) + decision tables + a 7/14/30 plan. Companions: `TASKS.md` (checklist) + the 2 component reports.

**Full multi-agent audit** (from the master prompt `docs/call-prep-2026-06-18/pegana_prompt_mestre_auditoria_claude.md`): 60 findings (🔴 3 · 🟠 13 · 🟡 21 · 🔵 23). **Validated** adversarially: **46 CONFIRMED · 13 PARTIAL · 0 REFUTED · 1 NEEDS-PROD-CONFIG** (nothing fabricated; ~25% had an imprecise number/example, corrected). **Verified in prod via SSH** (`${PEGANA_DEPLOY_SERVER}`): C3→LOW (api:8080 not exposed, ufw active), H13 downgraded (220/224 receipts have git_sha in prod; only the backtest was null), H6 less urgent (`JUPITER_MAX_CONCURRENT=2` + active key), Helius confirmed.

**Technical root cause (sHYUSD class):** market leg = **1-unit** Jupiter quote (C1) + depth never enters the verdict/hash (C2) + **missing `state_reason`** (H2) + `premium_sanity` leaves xSOL/CDP exposed (H1).

**⚠️ New near-term findings:** **prod disk at 86%** (123G/150G; culprit = 111 GB of `--no-cache` build cache, `docker buildx prune -af` fixes it, awaiting OK) · **EURC bug** (`/v1/assets` `state:null` vs `/v1/assets/EURC/state` stale `PEGGED`).

**Immediate plan (7d):** clean up prod disk · EURC bug · `state_reason` (H2) · `assets.toml` header + honest cost · missing alerts (`nav_sanity_unknown_total`/webhook/integrity) · Jupiter billing decision. **14d:** anchor-gate for xSOL/CDP · `getMultipleAccounts`+slot · commit fallback · gauges+p95/p99. **30d:** tokens.xyz as a price source + depth-gate (root of C2) · TimescaleDB retention · Hermes migration (paid plan ~$500/mo). **Rule (unchanged):** without 1 paying design partner, do NOT build a big feature, **the bottleneck is demand, not tech.**

### ✅ Audit CLOSEOUT — DEPLOYED + INDEPENDENTLY VALIDATED 2026-06-30 (`main` `f5493a5`)
Tracks **A** (`state_reason` out-of-hash + `risk_side` + API/engine surfacing, LIVE on `/v1/assets`, 63 assets) · **C** (`pegana_audit_persist_total{outcome}`, `asset_state` gauge, XFF Caddy) · **D** (RPC fallback Err+None, `scale_price` i128, non-fatal `observed_at_or_now`) · **E** (webhook cap only on `is_active`) · **F1** (observe-first ~$1k depth probe, **failure-isolated**, 49 series collecting for B-Phase-1) · **F2** (TimescaleDB compression migration 0059, **no `drop_chunks`**) · **F4** (`decimal_to_f64` dedup) · **F5** (throttled probe, synced 15min; stagger reverted). EURC/L5/M4 **fixed+live**. 437 tests/0 failures, clippy 0, hash `31c06db4fc9a` intact, 12/12 healthy. Validated by 4 adversarial agents + live prod, **0 false-done**. **Durable lesson:** the "Jupiter 429 watch-item" was a NON-issue, the `PeganaJupiterRateLimited` alert fires on `polls_total{status="error"}` (always 0.00/s), not on `429_total` (self-healing retries). **Remaining:** B Phase 1 (0.4.0→0.5.0 bump, time-gated: ~2wk observe-first + 7d dual-run + founder OK).

### 🔧 NEXT PRIORITIZED HARDENING (logged 2026-06-30, founder: "decide later") — **M10**
The closeout's adversarial validation unearthed **1 real gap** that the original triage downgraded for an incomplete reason ("obviated by M3"): **M10, silent dead source.** `crates/indexer-rs/src/main.rs:51-57`, the `JoinSet` of 10 sources only **logs** when a task exits (clean/error/panic) and keeps running with the dead source forever; no re-spawn, no abort, no exit, no per-source liveness metric. M3 makes the *signal* fail-safe (assets→UNKNOWN) but **doesn't recover or alert**, contradicting the "missing data ≠ confirming data" thesis. **Fix (effort S):** abort-all/re-spawn on unexpected exit + `pegana_<source>_last_publish_timestamp` gauge. Bundle with **L18/M12** (liveness/divergence observability, nearly free alongside it). **H12** (anti-backdating text) is already caveated in METHODOLOGY.md, at most optional polish, not a gap. The rest, discarded (refuted M6/M7/M8/M21/L1/L14 + backlog L4/L6/L7/L9-L11/L15/L19-L21/M1), confirmed correct, **do NOT touch M7** (loosening `|d|<1` reintroduces the JupUSD 2026-06-12 crash).

**Re-audit of the deferred items (2026-06-30, founder pushed: "are you sure deferring was the right call?"):** re-challenged ALL 16 backlog + 6 refuted items against the code + the thesis. Honest verdict: **only M10 (+ the L18 freshness-gauge / M12 divergence-metric observability pair) is a genuine reconsideration**, all at the same "never silently lose data" altitude, cheap, currently invisible to ops. The rest is deferred with a real defense, and several deferrals **ALIGN with the demand reality** (L19 no SLA, L9 single-VPS, L10 opportunistic attest, don't build redundancy/SLA infra before a paying customer needs it). **Honest closeout impact:** strong on robustness/risk (D = 3 real failure modes closed) and on partner legibility (A), arms the one real product upgrade (B Phase 1, time-gated), BUT it's **hardening, not growth**, it doesn't move demand (the bottleneck). Best practical effect: the audit is CLOSED and verified, freeing the founder to focus 100% on demand with no open technical debt.

### 💸 GRANT STBR — M2 + M3 DELIVERED + LIVE-VERIFIED 2026-06-30 (branch `grant/stbr-delivery`)
Executed subagent-driven (Codex impl → Sonnet review → Opus final = SHIP-READY), from the spec+plan `docs/superpowers/{specs,plans}/2026-06-30-grant-stbr-delivery*`.
- **M2a crates.io ✅ PUBLISHED (irreversible):** clean 3-crate chain `pegana-common-verify 0.1.0` → `pegana-methodology 0.4.0` → **`pegana-replay 0.4.1`** (package renamed from `-cli`; carve-out excludes the server-side `pegana-common`). **`cargo install pegana-replay` reproduces `31c06db4fc9a` byte-exact** (KPI proven E2E). 2 tests that read an external file → feature-gated `workspace-tests` (published crates self-contained).
- **M2c verify-60s ✅** (public repo README) · **M3 builder guide ✅** `docs/guides/consume-the-peg-feed.md` (63≥40, FX BRZ+EURC, `state` includes BLACK_SWAN) · **public repo synced** `github.com/lrafasouza/pegana-replay@4ea3f43` · **5 weekly posts** `docs/strategy/2026-06-30-grant-weekly-updates.md`.
- **LIVE-verified 2026-06-30:** 3 crates on crates.io · prod API `/v1/assets` 63 assets with anchor/risk_side/state_reason · PROD `e23a853` 12/12 up healthy. **Nothing needs a deploy** (grant = crates.io+docs; closeout already live in prod).
- ⚠️ **Branch hygiene (founder pushed for it):** grant = `grant/stbr-delivery` ONLY (pushed, grant-only via cherry-pick of the doc-fixes). `brand/wave-signal-swap` = **a different matter (logo), AGENT ACTIVE, never touch/rebase**. Demand = `demand/outreach-2026-06-30`. Use `git worktree` for any op.
- **➡️ REMAINING (founder):** tokens.xyz consumer (KPI, with a dev) · post weekly updates · **send the 7 outreach messages** (`docs/strategy/2026-06-30-outreach-ready-to-send.md`, the #1 lever, the `won` gate only moves with these) · merge `grant/stbr-delivery`→main. crates.io token REVOKED.

---

## Current state — 2026-06-24 (later: improvement-specs batch — ✅ 5 parts DEPLOYED LIVE)

`main` at `8745572`. A **7-spec improvement batch** run end-to-end via the loop: full brainstorm → per-track codebase validation (read-only agents) → **Codex goal-mode** implementation → **Opus independent re-validation** → adversarial **pre-deploy /review** → deploy + smoke. **5 parts shipped + LIVE this session; the persistence feature is complete across ALL FOUR surfaces.** Specs `docs/superpowers/specs/2026-06-24-{00..07}-*`; plans `docs/superpowers/plans/2026-06-24-*`. See [[project_improvement_specs_batch_2026_06_24]] + [[project_tokens_xyz_liquidity_gate_2026_06_24]] + [[reference_codex_goal_mode_workflow]].

**✅ SHIPPED + LIVE:**
- **Spec 01 — tokens.xyz signal-out feed** (`fb293d3`, api recreate): `GET /v1/peg/feed` (batch, **mint-keyed**) + `/by-mint/:mint` — a clean versioned peg-signal contract for the tokens.xyz/Foundation integration (they have the assets, no peg signal). Read-only transform of `/v1/assets`; no migration, no methodology. ETag/Last-Modified/304 + 5s cache; honest beta via `calibration`/`monitoring_only`; freshness via `as_of`/`stale`. **The Codex review caught a real bug Opus missed** (ETag hashed `generated_at` → 304 never matched → fixed to a semantic ETag over `methodology`+`data` + RFC-9110 `If-Modified-Since`). Contract = the Rafael-validated `docs/strategy/2026-06-22-tokens-xyz-sample-LIVE.json`. **LIVE: count=63.**
- **Spec 04 Phase 0 — depth-gate OBSERVE** (`4ec91de`, indexer recreate, **migration 0056**): persist EVERY tokens.xyz liquidity tick — incl. `has_market=false`/junk → NULL — to a new `liquidity_observations` hypertable, so the Phase-1 floor is calibrated from the real distribution (NOT guessed — the ADR-0024 lesson). Redis publish kept **byte-identical** (engine `event.extra` unchanged). **LIVE: accruing both row types** (24 covered / 39 not).
- **Persistence / time-below-peg (Spec 03 + 03b + 03c + 03d)** — DEPLOYED across engine→api→web→bot; closes the confirmed **sUSD/Hylo mechanism-depeg blind spot** (a months-old DRIFT is now distinguished from a 5-min blip). **Zero methodology/receipt impact** (proven: empty `crates/methodology` diff + 86 methodology tests green). Keyed STRICTLY on committed alerting-band residence — PEGGED/UNKNOWN are NEVER `sustained` (the ADR-0024 trap, guarded by a proptest).
  - `c2e814b` **engine**: `band_since` on AssetRuntime (**migration 0057**) + pure `sustained_for` + `band_duration`; `AlertEvent.extra` carries `current_state_duration_secs`/`sustained`. (Codex caught my plan's FSM bug — `transition()` needs 2 ticks to commit.)
  - `5416bec` **api**: engine writes them to `discount_snapshots.extra` every tick → `/v1/assets` exposes them.
  - `741326a` **web**: `SustainedBadge` (on-brand mono pill, st-drift/st-depeg tones, no terminal aesthetic) on the asset hero + screener.
  - `037eeb8` **bot**: dispatcher pre-renders + bot-ts appends "Sustained — in DRIFT for 3d" to the Telegram alert (shows on the next transition).
  - **Pre-deploy /review-and-iterate + /grill-with-docs caught F1 (serious):** band_since only stamps going-forward + the bare ALTER left existing rows NULL → the badge/field would be INVISIBLE at deploy for assets ALREADY in a long episode (sUSD). **Fixed** (`56ef7ac`) by backfilling band_since from `discount_snapshots` history (the current band's entry boundary; bounded by 365d retention). **VERIFIED LIVE:** sUSD shows `state=DRIFT, ~2.4d, sustained=true` on day one.

**📋 Depth-gate Phase 1 — DEFERRED to ≥2026-07-01** (mechanical decision doc `docs/operations/depth-gate-phase1-decision.md`). Early read leans **GO**: the only thin covered assets are USD\* ($2.1k, monitoring) and **sUSD ($9k, PUBLIC/calibrated)** — a public asset on a ~$9k pool, exactly the dust-pool false-alert class the gate kills; ~50× gap to the deep cluster. Floor to be calibrated from ≥1wk observed data, NEVER guessed. ADRs: **0026** (depth gate), **0027** (persistence).

**🔜 REMAINING specs (written, NOT built):** **02** (embeddable badge — verify-under-enforced-CSP + make "verifiable" real [the `/audit?asset=` link is hollow] + SVG badge; web, distribution) · **05** (direct stake-pool reads — trust-min; indexer, migration 0059, ADR-0028; **mSOL/INF stay on Sanctum** — not SPL stake-pools) · **06** (non-event attestation + incident page; engine+api+web, migration 0058, ADR-0029 — **must exclude `sustained` from "clear"**) · **07** (backtest expansion — templatize + new Solana events, **gated on a Pyth `--capture` dry-run**) · **04-P1** (the depth gate itself, gated on 07-01; methodology bump). Cross-spec: 03/04-P1/06 edit overlapping `engine main.rs` → **sequential, not parallel worktrees**; migrations 0058/0059 pre-allocated.

**Durable lessons (this session):** repo has a **pre-commit prettier/lint-staged hook** (don't fight whole-file TS reformat on a touched file — it's enforced; revert only genuinely-unrelated broad reformats) · `deploy.sh` aborts on a dirty tree → `git stash -u` first, pop after · `--migrate` applies BEFORE the recreate (correct ordering for the F1 backfill) · Codex `codex exec -s workspace-write` can't write `.git` → it implements + verifies, **Opus commits + re-validates independently** — the loop caught bugs on BOTH sides (Codex: my ETag + FSM bugs; Opus: F1 + the bot-ts scope gap).

**⚠️ Strategic line STILL HELD: demand is the gap, not tech.** 01 = distribution, 03 = blind-spot-closer + demand wedge, 04-P0 = hardening. The tokens.xyz feed is LIVE — the next real lever is **DEMAND** (close tokens.xyz with @stevensarmi, land a design partner), NOT more hardening (02/05/06/07 are hardening — don't let the build crowd out demand). See [[project_demand_gap_verdict_2026_06_22]].

---

## Current state — 2026-06-24 (asset expansion +37 LIVE · demand still the priority)

`main` at `d2d3a75`. **Asset expansion SHIPPED + LIVE in prod.** Added **37 net-new significant pegged/yield assets** (>$1M Solana liquidity), demand-aligned with the tokens.xyz partnership. All `monitoring_only` (beta) — 7-day recalibration window (~2026-07-01, scheduled remote routine `trig_01Dm5px8jhjWx3WfrgxpcDjM`). Post-deploy: `/v1/assets` **37/37 PEGGED**, healthz 200, engine/indexer restarts=0.
- **Tier 1 (data-only, migration 0053):** 6 stables (USX, USDG, USD1, USDu, CASH, AUSD) + eUSX + PST (both `pyth_redemption_rate`) + 25 Sanctum LSTs.
- **Tier 2 adapters:** new `spl_stake_pool` source → STKESOL/rkuSOL/corvusSOL (migration 0054); new `perena_usd_star_nav` (migration 0055) → USD\* (Perena savings-vault reserve NAV ~$1.07; NAV-health-only — DEX liquidity is dust, so weak market-depeg signal by design).
- **Logos:** all 37 vendored to 96×96 webp (`bun run icons:sync`); Jupiter v2 + CoinGecko + Sanctum sources; 3 generated placeholder chips for dead-CDN LSTs (haSOL/mangoSOL/RoXSOL). `jupiter-quote` allowlist synced (drift-test caught it stale). Served live via Vercel.
- Built via **Codex goal-mode + Opus review + /code-review** (caught the missing engine subscribe-list + the stale allowlist) + local & prod E2E (all PEGGED). Validation: Rust 369 / web 461 / verify-assets 65 / icons-coverage 64, all green.
- Honest nuances: USX/USDG/USDu currently medium/unknown confidence (pyth_spot feed certainty — conf-gate working); revisit at recalibration. ⏰ Jupiter free keyed tier ends **30 Jun** (conc=2 today; then pay→4 or keyless→1).

**⚠️ Strategic line HELD: coverage is now STRONG — stop adding assets. The bottleneck is unchanged from 2026-06-22: DEMAND (0 paying customers).** The 37 assets are AMMUNITION for the demand conversation (net-new peg signal for tokens.xyz), NOT the goal. Highest leverage = close tokens.xyz, land 1 design partner, demand interviews — NOT more tech. Announcement post: `docs/strategy/2026-06-24-37-assets-announcement.md`. See [[project_asset_expansion_2026_06_23]] + [[project_demand_gap_verdict_2026_06_22]].

## Current state — 2026-06-22 (Phase 14 backtest LIVE + ⚠️ strategic priority shift to demand)

`main` at `a83cf2f`. **Phase 14 backtest BUILT, MERGED (FF), and LIVE in production.** Real Pyth Benchmarks replay of the 2025-10-10 ~$19B cascade (10 assets × 4321 one-minute ticks) through the **unmodified methodology 0.4.0**; runner (`crates/xtask/src/backtest/`) mirrors the engine `try_recompute`, emits **123 schema-v2 receipts** re-derivable by the public `pegana-replay` CLI. Built by **Codex goal-mode + Opus review + `/code-review`** (15 findings; real ones fixed in `01c7a3a`). ALL green re-validated by Opus (fmt/clippy/test, web build + vitest 424, CLI acceptance PASS). Web `/backtest/2025-10-10-usde-depeg` deployed (redeployed on the corrected Vercel account) and **in-browser verify confirmed live** ("Verified — hash matches."). Results: USDe→CRITICAL, PYUSD→DEPEG, USDC/sUSDe→PEGGED, **USDT→DEPEG (honest +70bps premium / flight-to-safety, documented, not hidden)**, USDS→DRIFT, LSTs DRIFT..CRITICAL. See [[project_phase14_backtest_2026_06_22]] + [[reference_codex_goal_mode_workflow]].

**⚠️ STRATEGIC VERDICT (founder asked "is my project bad?" — honest analysis):** **No — but the real risk is unproven DEMAND, not the tech.** See [[project_demand_gap_verdict_2026_06_22]].
- 🟢 **Strong:** engineering (verifiable methodology, on-chain receipts, signed CLI, 800+ tests), differentiated thesis (verifiable peg signal — stableguard/Chaos Labs validate the category), and **gold inbound distribution** (Solana Foundation/tokens.xyz *wants* the peg data — came to us).
- 🔴 **Weak (the real gap):** thesis WEAK per validation handoff · **0 paying customers** · pricing deferred *because no design partner signed* · classic technical-infra-founder trap — building proof (where strong) instead of pursuing demand/distribution (where weak).
- **The backtest was a credibility win, NOT traction.** A backtest proves the tech works; it does not prove anyone pays. Phase 14 was a *deferred, lower-leverage* roadmap item by design.
- **Next priority is NOT more code.** It is: (1) **close tokens.xyz** (Solana Foundation distribution, free, inbound — priority #1); (2) **land 1 design partner** who *depends* on it (protocol/treasury/fund holding these assets); (3) **talk to 5-10 demand-side people** ("how do you monitor depeg today, what would make you switch?"). The 3 numbers that decide good-vs-bad: real monthly users (not founder), grant/tokens.xyz responses, customer conversations in the last 2 weeks.

**🚀 DEMAND TEST IN FLIGHT (sent 2026-06-22):** outreach went out to 5 validated targets — tokens.xyz (@stevensarmi, inbound), Drift (@cindyleowtt), Kamino (@y2kappa), marginfi+Project0 (@macbrennan_cc), Sentora (Patrick Heusser/LinkedIn, institutional). Friendly intro + CTA = pegana.xyz/docs (paid-pilot ask moved to the call). Contacts deep-validated (caught/fixed 2 wrong handles + the Parity/StableGuard-are-dead swap → Hxro/Amulet). Next = follow-ups (Drift 06-26, Kamino/MacBrennan 06-27, Sentora 06-29), push replies → call → pilot. Per ADR-0007: ONE paid pilot before more features; kill checkpoint 07-31. Tracker: `docs/strategy/2026-06-22-outreach-READY-TO-SEND.md`. See [[project_demand_gap_verdict_2026_06_22]].

**Open follow-ups:** ⏰ confirm Jupiter key tier before 30 Jun (keyless ends — indexer risk) · Sentry browser tunnel `/monitoring` returns **403** (Sentry-side: DSN key disabled OR free-tier quota/spend-cap blown by `replaysOnErrorSampleRate: 1.0`; pre-existing, NOT a Phase-14 regression, no user impact, server-side Sentry unaffected — founder checks the `rust` project; optional PR to lower sample rates) · fixture 8.4 MB committed (under the 10 MB plan threshold; can drop to ~1.8 MB at 5-min resolution if the public mirror size matters) · Phase 14 not paired with a live USDe alert (USDe still PEGGED live).

---

## Current state — 2026-06-21 (deferred audit-roadmap batch, Phase 1+2 — ✅ DEPLOYED + VERIFIED LIVE both sides)

`main` at `4bf4286`. The deferred items from the 06-20 remediation, worked subagent-driven (Sonnet impl / Opus review) + `/code-review` xhigh + live verification. Design spec `docs/superpowers/specs/2026-06-21-deferred-roadmap-batch-design.md`. See [[project_deferred_batch_2026_06_21]].

**Phase 1 (Rust → Hetzner `deploy.sh --services 'engine indexer'`):** (1) **Helius key log mask** — `mask_rpc_url()` strips the query string at the "on-chain commit enabled" INFO line; VERIFIED live the log now prints `https://mainnet.helius-rpc.com/` with no `?api-key=`. (2) **F-41c RPC failover** — `solana_rpc_url_fallback` (was declared-but-dead) wired via new `crates/indexer-rs/src/rpc.rs::get_account_with_fallback` (try primary → on Err bump `pegana_rpc_primary_failed_total{source}` + warn + retry fallback, default publicnode); all `get_account` sites in hylo/piggybank_pb/solayer_susd routed; zero overhead/behavior-change on the happy path. (3) **2 `/code-review` fixes:** `ufix_to_decimal` was `Decimal::new` → **PANICS at scale>28** (F-12 class, unexpected on-chain `exp` byte) → `try_new().ok()` → None → graceful skip (regression test); hyUSD pool-ATA metric label was the base58 pubkey (unbounded cardinality) → stable `"hyusd_pool_ata"`. Verified live: engine restarts=0 healthy, 26 assets classifying (25 PEGGED + 1 UNKNOWN), fresh data. engine 15 + integration green, indexer 30 green, clippy clean.

**Phase 2 (web → Vercel git-integration auto-promote):** **F-07 full nonce-CSP, Report-Only first.** `proxy.ts` sets a per-request nonce on BOTH request headers (so Next auto-nonces its bundles — the review **Blocker** the first impl missed) AND the `Content-Security-Policy-Report-Only` response header; `layout.tsx` (async) threads it to `<ThemeProvider>` + JSON-LD; new `/api/csp-report` (204, 64KB cap, **console-only — no Sentry capture**, protects the free quota). Review hardenings: `form-action 'self'`, `worker-src 'self' blob:`, dev-only localhost connect-src, `/monitoring`+`/embed` excluded. Verified live on www: header present + **31 nonced `<script>` tags share one per-request nonce** (Blocker fix proven). vitest 26/26, tsc/lint clean. **F-04 `WAITLIST_HASH_PEPPER`** set in Vercel Prod. ✅ **CSP ENFORCING since 2026-06-22** (`6bd25a0`) — **F-07 fully complete.** The one blocker — the Telegram Login Widget's `eval()` (`telegram-widget.js` → `EvalError` under strict CSP, found via a live browser pass + reverted in `4c6d678`) — was resolved by isolating the widget in a **sandboxed same-origin iframe** (`/embed/telegram-login`, its own relaxed CSP, `frame-ancestors 'self'`) that postMessages the auth (to the exact www origin, never `*`) to the parent's UNCHANGED `login()`. Opus-reviewed (APPROVE, 0 blockers). Real Telegram login confirmed working under enforce; both `proxy.ts` header names flipped to `Content-Security-Policy` (`report-uri` kept → violations blocked AND reported). Playwright-verified clean site-wide (home 0/0; `/account` 0 errors, Telegram button renders in the iframe, 30 nonced scripts execute). `img-src` gap was moot.

**Phase 3 (F-13b true CLI re-derivation — ✅ DEPLOYED 2026-06-22, `main` `8c200fd`):** the grant thesis "anyone can recompute our history" — CLI now re-DERIVES the verdict from `inputs_frozen`, not just re-hashes (ADR-0019). `methodology::rederive` mirrors `try_recompute`'s exact pure pipeline; fixed 3 engine capture-ordering bugs (GAP-1 `ewma_prev`, GAP-2 `candidate_state/since`, GAP-3 `previous_state`→FSM `g.last_state`); `schema_version` v1→v2; CLI accepts v1 (re-hash) + v2 (re-hash + re-derive). **Zero-struct-change** → v1 historical/on-chain receipts re-hash byte-identically (`methodology_version` stays 0.4.0). Round-trip gate proves `rederive(frozen)==computed`. **Rollout (founder waived the 06-25 lock — 3rd override):** **CLI `v0.4.1` RELEASED** (cargo-dist+Sigstore, decoupled from methodology so it verifies v1 history + v2; `releases/latest`→v0.4.1) → **installer repointed** to latest-release → **engine v2 DEPLOYED** (`deploy.sh --services engine`, restarts=0, methodology 0.4.0). Verified: v0.4.1 re-hashes a LIVE v1 receipt (no history regression); in-browser verifier is version-agnostic (re-hashes v2 unchanged). Live v2-receipt re-derive self-confirms on the next organic transition. See [[project_deferred_batch_2026_06_21]].

---

## Current state — 2026-06-20 (security audit remediation — ✅ DEPLOYED + VERIFIED LIVE both sides)

`main` at `23f590c`. A full **off-chain security audit** (solanabr/auditor — 18 checklists / 1,182 items + 100 vectors, a 12-subagent two-pass fan-out) was run, **adversarially validated** (the validation REJECTED several false-positives and caught **F-02** whose proposed "fix" would have BROKEN prod — Caddy already strips spoofed XFF + `api:8080` is unexposed), **Opus re-verified + cross-checked with solana-ai-kit `audit-infra`**, then implemented **subagent-driven** (Sonnet impl / Opus review, 7 review layers + `/code-review` xhigh + auditor re-run) and **deployed to Hetzner + Vercel**. Artifacts: `docs/audit-2026-06-19-solanabr/{REPORT,REMEDIATION-SPEC}.md`, `docs/audits/infra-2026-06-19.md`, `docs/superpowers/plans/2026-06-19-pegana-audit-remediation.md`. **Verdict: 0 CRITICAL / 0 HIGH in first-party code** (1 sev-7 = transitive Solana-SDK crypto, already CI-`--ignore`d). Signer-pin re-confirmed a real hard fail-closed gate. Suites **802 / 0 fail**. See [[project_audit_remediation_2026_06_20]].

**THE finding — F-12 (engine):** `rust_decimal` operators PANIC on overflow; `compute_discount`'s `market/intrinsic` (+ `state.rs:346` FX-invert) ran **inline in the engine `select!` loop with no `catch_unwind`** → a panic crash-loops the WHOLE engine. Reachable only on a **Hylo hyUSD CR<1 free-collateral rounding residual** (xSOL NAV ≈ 1e-27) → blackout during exactly the depeg it exists to catch. Fix = `checked_div`/`checked_sub` → `None` (existing H8 skip), **proven bit-identical for all real inputs** (receipt-hash determinism intact; 73/73 methodology tests). `crates/methodology/src/discount.rs`, `crates/engine-rs/src/state.rs`. DON'T revert to bare `/`.

**Other shipped (senior-trimmed ~15 — belt-and-suspenders/YAGNI cut):** F-05 (drop `user_id` from Sentry extras), F-22 (Caddy 403 on public `/metrics`), F-34 (mcp-ts non-root `USER bun`), F-42 (least-priv `GITHUB_TOKEN` ×4 workflows), F-15 (ESLint blocking), F-31/F-32 (.gitignore/.env.example keys), F-13 (reworded the FALSE "re-executes the methodology" CLI claim ×8 surfaces incl. the public `pegana-replay` mirror → tamper-evidence). **Web (Vercel):** F-03 (jupiter-quote mint allowlist + `assets.toml` drift-guard → billed-key drain), F-04 (waitlist email→sha256 in logs + optional `WAITLIST_HASH_PEPPER`), F-07 (cheap headers; full nonce-CSP deferred), F-26/F-40 (example + CLI 404-gate). **Bonus:** `pre-deploy-check.sh` Gate 9 read the stale `0030` seed (v0.1.0) and **false-failed every deploy since v0.2.0** → fixed to read the latest `*methodology_v*.sql` (0.4.0).

**Deploy:** Hetzner via `deploy.sh` (all 6 services rebuilt+recreated, engine classifying restarts=0) + Caddy reloaded for F-22. Web via **git-integration** (`vercel --prod` CLI is BROKEN for this monorepo — re-confirmed the hard way; see [[project_vercel_ops_gotchas]]): an **empty trigger commit auto-promoted** → #3 auto-promote now CONFIRMED. **Verified live both sides:** engine restarts=0 + `readyz` classifying · `/metrics` 403 · jupiter-quote bad-pair → `unsupported_pair` + headers present.

**Roadmap DEFERRED (senior scope call — NOT bugs, REMEDIATION-SPEC §5):** ✅ **F-41c** RPC failover + ✅ **full nonce-CSP** (Report-Only) + ✅ Helius log mask + ✅ `WAITLIST_HASH_PEPPER` all SHIPPED 2026-06-21 (see "Current state — 2026-06-21"). ✅ **F-13b** *true* CLI re-derivation **DEPLOYED 2026-06-22** (CLI v0.4.1 released + engine v2 live; methodology stays 0.4.0 so history verifies). ✅ **F-41b** encrypted R2 restore drill **DONE 2026-06-22** (PASS — latest backup decrypted + restored into a scratch DB, 3.75M rows validated, dropped; `docs/runbooks/drill-log.md`). ✅ **CSP ENFORCING 2026-06-22** (Telegram widget isolated in a sandboxed iframe → strict `Content-Security-Policy` live; see Phase 2 above). Remaining: **F-06** JWT→httpOnly cookie (DEFERRED — cross-host SameSite=None reintroduces CSRF; needs same-origin proxy) — the only deferred audit item left.

The ~26 CUT findings are in REMEDIATION-SPEC Appendix A — don't re-raise.

---

## Consolidated backlog — 2026-06-17 (product review + tokens.xyz consume plan)

> Source: a senior `/product-review` (live web walkthrough + non-web re-validation)
> and the tokens.xyz consume analysis, **adversarially pruned** — generic/obvious/
> hard-to-justify items were cut (see "Cut" below). Every claim was validated 1:1
> against the code/live API on 2026-06-17. **Overall product score: 7.8/10 — Strong.**
> The two real wounds are both trust-thesis: public verification is broken end-to-end
> for outsiders, and beta/Unknown assets fail UNSAFE on the dashboard's default top row.
>
> **STATUS 2026-06-18 — both wounds CLOSED + the whole consolidated backlog SHIPPED.**
> Fail-unsafe Unknown → fixed (T2 #1). Public verification for outsiders → fixed via the
> **in-browser verifier** (T2 #2; a non-engineer verifies a receipt with one click, no CLI).
> Tiers 1 / 2 / 2b (a11y + `/v1/assets` perf) / 3 Step 0 / 3 Step 1 are all **DONE +
> DEPLOYED + VERIFIED**; CLS deferred (already "good"), dashboard-fetches was a non-issue,
> Step 2 depth-gate **cut** (data-backed). Everything safely shippable by me is done.
> **+ Sentry-quota flood fixed (`8451586`, engine):** the tokens.xyz liquidity-only
> envelope (Step 3 #1) had no `value_usd` → the SRC_JUPITER handler propagated a
> "missing key" → `capture_message` on every tick (280/20min, the "80% of 5k" email).
> Also fixed the silent twin: liquidity was parsed in the wrong (SRC_PYTH) handler so
> `extra.liquidity_usd` was always null → now stored where the sources publish.
> Prod flood 280/20min → 0; consumed errors reset next monthly cycle.
> **What remains:** (1) 🔴 **Tier 4** — the v0.4.0 CLI release, the *last* verification piece,
> blocked on founder GitHub billing; (2) ⏰ confirm the **Jupiter key tier before 30 Jun 2026**
> (keyless tier ends — indexer risk); (3) strategy, not features — distribution (tokens.xyz
> partnership) + a paid-pilot/pricing gate; (4) the longer-term Post-launch queue below.

### Tier 1 — Trust-protecting quick wins — ✅ DONE + DEPLOYED LIVE (2026-06-17)
> Implemented by Codex, **reviewed 1:1** (`/review-and-iterate`), all 3 suites green
> (web 316/316, bot/mcp 0 fail), `crates/` untouched. Committed `ec5c89a`. **Deployed:**
> bot+mcp via SSH recreate (engine/indexer/api/dispatcher untouched — calibration-safe);
> web via `vercel --prod` (dpl_9nN2NrPXm4…, www.pegana.xyz live). Verified live: items
> 1/6/8 confirmed on the site; bot+mcp healthy. + residual fixed: bot `/learn` "21 assets"→26.
- [x] **Kill the stale "June 11, 2026" calibration banner** — done (calibration-banner*, pinged-cta, releases, pricing); June-11 kept only as the launch marker. *(Note: the calibration-banner UI is dormant-by-design — `inCalibrationWindow()` returns null post-launch, ships no JS; left in place, see Cut.)*
- [x] **Fix the sHYUSD (Unknown) default top row** — gauge clamped to 100% + off-scale (band-gauge); inverted premium/discount sign fixed from prices; green icon dropped on UNKNOWN (asset-hero-v2, asset-preview-pane).
- [x] **Cold-start banner** — neutral "Connecting…" until first heartbeat (engine-flow-strip).
- [x] **MCP "22 assets" → dynamic "(call get_assets)"** — better than hardcoding 26 (won't drift); + behavior-preserving DI refactor of the paid x402 handlers for Bun-test compat.
- [x] **Cross-link `/events` ↔ `/audit`** — both links live.
- [x] **Bot beta badge in the picker** — `db.listAssets/getAsset` now select `monitoring_only`; 🧪 in picker + confirmations.
- [x] **Changelog releases → 0.4.0** — v0.4.0 entry at top.
- [x] **SDK honest docs** — clone/local, no npm/PyPI install claim.

### Tier 2 — Medium (1-3 days, me) — ✅ DONE + DEPLOYED + VERIFIED LIVE (2026-06-17)
- [x] **Fail-safe Unknown/beta (highest UX impact)** — when `state == UNKNOWN`/uncalibrated, suppress the confident derivatives (arb hint, exit-liquidity table, band-gauge) and show one honest "insufficient signal" state. (`15b0f61`) Gated strictly on `state === "UNKNOWN"`, applied app-wide via all 5 BandGauge callers. **Verified live on sHYUSD (Overview tab):** arb-hint absent · band-gauge "—" · exit-liquidity "Insufficient signal — the engine…" · recovery-confidence absent · honest "engine is waiting on a fresh sample" copy.
- [x] **In-browser "Verify receipt" (1-click)** — pure-JS re-hash of the frozen bundle (RFC 8785 JCS + Web Crypto SHA-256) → ✓ byte-exact match vs the Rust engine, no CLI/GitHub-billing needed. (`8323d1c`) Gold unit test matches two real prod receipts byte-for-byte (352 web tests green). **Verified live:** clicked "Verify in browser" on a real audit page → "VERIFIED — recomputed hash matches" (`5ae45763…`, same hash as the engine + unit test). Fixes the #1 product wound independent of the GitHub-billing blocker.
- [x] **Collapse/label pre-launch empty history → now shows FULL tracked history** — root cause was NOT a data gap: the 1m history API clamps `limit` to 5000 (~3.47 days/call) and `StateStrip30d` made a single call, so the strip could only ever show the most recent ~3.5 days. Final fix paginates: `useHistory30d()` pages backward in 1m windows (bounded — stops on empty response, the 30-day cutoff, or `MAX_WINDOWS=10`), merging into the existing worst-state-per-day reduction. (`79f686e` limit bump → `a6401af` pagination) **Verified live on USDC:** strip now shows **23 real day-cells (May 27 → Jun 18)** with accurate header "91% of tracked days pegged · 7 days no data" — and it surfaced real history that was previously hidden (May 28 *drift*, May 29 *depeg*). Pure `fetchHistory30d()` unit-tested (merge / stop-on-empty / cap / 30d cutoff); tsc 0 · eslint 0 · vitest 356/356. Web-only, calibration-safe.
  - **Future perf optimization (not a correctness gap):** at full 30-day maturity the pagination is ~9 calls / ~40k rows per strip load (on the non-default History tab). If that transfer cost matters, replace with a backend `discount_1d` continuous aggregate + `bucket=1d` storing **worst-state-per-day** (needs severity-ordered enum aggregation; additive/calibration-safe but a migration → validate vs a live stack first).

### Tier 2b — Dimension uplift: validated perf + a11y (live measurement 2026-06-17)
> Real Performance-API + axe-core 4.10 readings. CWV are already in Google's "good" band
> (LCP 1.3s cold home, CLS ≤0.043, 0 console errors, brotli + immutable static caching) —
> these are **incremental**, not emergencies. The prior review's a11y claims ("2 unnamed
> buttons", "color-only state", "SVG missing aria-hidden") were **false positives** (axe
> cleared them); the REAL a11y issues are below.
**a11y batch — ✅ DONE + DEPLOYED + VERIFIED LIVE 2026-06-17** (`8ae25ac`→`fba42b6`). Re-ran axe-core 4.10 live on every surface at mobile+desktop → **0 violations** on `/asset/USDC`, `/dashboard` (both widths), `/assets`.
- [x] **a11y CRITICAL — `aria-required-children`**: the flagged list was the DESKTOP `AssetTable` (visible at desktop) — wrap each `TableRow` in `<li role="listitem">` (an `<a>` can't carry listitem → `aria-allowed-role`). Same fix for the mobile `MobileAssetRow` list. Verified: list children are `<li>` at both widths, 0 violations.
- [x] **a11y — color-contrast**: `--color-st-drift` `#bd6200` (4.00:1) → `#a85800` (**4.84:1** on `#f7f8f2`, computed). Light theme only; dark untouched.
- [x] **a11y — landmarks**: `/dashboard` wrapped in one `<main>` + sidebar `<aside aria-label="Navigation">` → `landmark-*`/`region` cluster cleared. `/asset/USDC` `asset-rail` `<aside>` → `<div>` (it sat inside `<main>` → `landmark-complementary-is-top-level`, confirmed live then re-verified 0). +`safety-grade` inner `<aside>`→`<div>` (Risk tab).
- [x] **BONUS a11y — `definition-list` (serious)**: caught live — `asset-preview-pane` `<dl>` had a sr-only `<p>` direct child (only `dt`/`dd`/`div` allowed) → moved the `<p>` outside the `<dl>`.
- [x] **perf — chart bundle**: already `next/dynamic({ssr:false})` with an `h-[320px]` placeholder in-repo. No change needed (ROADMAP item was stale).
- [~] **perf — CLS on `/asset/USDC`** — DEFERRED (honestly): empirically measured CLS 0.046 (already in Google's "good" band <0.1); 99% is the **below-fold footer** being pushed down as content loads ABOVE it — a `min-height` on the footer is ineffective (its own height isn't the cause). Proper fix = reserve the async content height (skeleton) — low value vs. layout risk. Not shipped.
- [✗] **perf — `/dashboard` 65 fetches** — INVESTIGATED, NOT A REAL ISSUE (misdiagnosis). Live network trace: the dashboard fires only ~5 API calls (`/v1/assets`, `/v1/stats`, 2× `/v1/alerts`, 1 history). Sparklines already use the inline `series_24h` off the `/v1/assets` payload (`SparklineCell` only falls back to `/history` when `series == null`). The "65 fetches" are Next.js **RSC link-prefetches** (`/asset/SYMBOL?_rsc=`, ~0.7KB each) — a feature that makes row-clicks instant. Disabling prefetch would REGRESS nav. No fix warranted.
- [x] **perf (backend) — `/v1/assets` cold ≈ 3.3s** — ✅ DONE + DEPLOYED + VERIFIED LIVE (`6ca064e`, `deploy.sh --services 'api'`, engine/indexer untouched). The endpoint already had a 5s Redis cache (B-022); the cold cost was the **cache-miss** (after the 5s TTL lapses between visitors at low traffic) hitting cold TimescaleDB on the per-asset 24h LATERAL aggregation. Fix = a **background pre-warmer** (api main spawns a 4s loop calling `refresh_assets_list_cache`, just under the TTL) so the cache never expires cold; query extracted to a shared `fetch_assets_list()`. Validated locally vs the real schema (EXPLAIN + 26 rows; pre-warmer populates+re-populates `v1:assets:list`); build/clippy/test/fmt green. **Live: /v1/assets now ~0.95s across 7s idle gaps (was 3.0s cold) — cold spike eliminated; residual is network baseline (~0.68s, DE-box distance).**

### Tier 3 — tokens.xyz CONSUME = the liquidity ladder ONLY (F2; the rest CUT)
The validated value of consuming tokens.xyz is **liquidity, full stop** (their `risk`=marketScore not peg; their equity reference is 41d-stale/non-independent → no RWA tracking; "305 stablecoins" was wrong). ADR-0024 explicitly names a **liquidity/depth gate as the correct replacement** for the rejected freeze-detector, so this is sanctioned, not speculative. Plug points validated 1:1:
- [x] **Step 0 — stop discarding DexScreener liquidity** — ✅ DONE + DEPLOYED + engine healthy (`fff4373` + test `3a58685`, `deploy.sh --services 'indexer engine'`). indexer: `liquidity_usd` added to the engine envelope (null when absent). engine: `AssetRuntime.last_liquidity_usd` + `set_liquidity()`/`liquidity_usd()`; parsed in `handle_message` (NOT a recompute trigger); emitted in `event.extra.liquidity_usd`. Server-only/unhashed — no methodology, no migration. build/clippy/test/fmt green; new test locks the **no-snapshot-leak invariant** (engine 12→13). Post-deploy: 26/26 assets fresh, engine recomputing normally (calibration intact). **Verification note:** `event.extra` is internal (NOT exposed by `/v1/audit` — only `inputs_frozen`/`computed` are), and the consumer (Step 2 gate) is deferred, so the live data flow is validated by code + the no-leak test + deploy health, not an API read. Affects sUSD/ONyc (pbUSDC inactive).
- [x] **Step 1 — `tokens_xyz.rs` indexer source** — ✅ DONE + DEPLOYED + VERIFIED LIVE (`72e5069`, `deploy.sh --services 'indexer'`, key added to prod host `.env`). One batch `POST /v1/assets/market-snapshots` (≤250 mints) → raw `token.liquidity` per mint → liquidity-ONLY envelope per asset on `SRC_JUPITER` (no value/market → engine only `set_liquidity`, no recompute). 60s cadence; `hasMarket`/finite/positive guards. **Live: indexer log `published: 14`** (14/26 assets have a tokens.xyz market). No freshness gate needed — liquidity is inert metadata (only a *gate* would need one). build/clippy/test/fmt green. 🔑 key ✅ ROTATED 2026-06-19 (new key live in prod host `.env` as `TOKENS_XYZ_API_KEY`; source verified active `published:14`, 0 auth errors).
- [✗] **Step 2 — the depth GATE** — INVESTIGATED with live data → **recommend NOT building it** (challenged + cut). The liquidity distribution (now observable via Step 0+1): calibrated assets are nearly all deeply liquid ($2.4M–$728M) **except sUSD ($9k, currently DRIFT)** → a gate would target essentially ONE asset. Suppressing sUSD's real DRIFT because its pool is thin **contradicts the transparency thesis**. 12 assets have null tokens.xyz liquidity (real Solana liquidity untracked) → null≠suppress is a foot-gun. And calibrating off a single snapshot violates ADR-0024 "observe first" (data started flowing minutes ago). **Safe alternative if wanted:** surface liquidity as alert *context* (additive, on-thesis) rather than *suppression*. Let Step 0+1 accumulate; revisit only if a real low-liquidity-calibrated cluster emerges.

### Tier 4 — Major (🔴 founder + me) — the #1 product fix
- [x] **Installer self-versioning + honest fallback** — ✅ DONE + DEPLOYED + VERIFIED LIVE 2026-06-18 (`3bce93e`, web deploy). The installer no longer silently installs a `VERSION_MISMATCH`-broken v0.2.0: it auto-detects the live methodology version from `/v1/methodology/current`, HEAD-checks whether that release is published, and when it isn't (v0.4.0 today) prints an HONEST message pointing to the **in-browser verifier** (which works) + build-from-source + the latest pinnable tag. `PEGANA_VERSION` pin + the download/sha256/install happy path unchanged. Validated all 3 cases live. The durable anti-drift fix the ROADMAP wanted. Also re-proved the 0.4.0 CLI verifies a live receipt byte-exact (`5ae45763`).
- [x] **Unblock GitHub Actions billing (founder)** — ✅ DONE 2026-06-18: Rafael upgraded to GitHub Pro → re-triggered `sync-pegana-replay.yml` (✅) → tagged `v0.4.0` → `release.yml` (cargo-dist + Sigstore) ✅ published the **attested v0.4.0 verifier release** (now "Latest"). The self-versioning installer auto-resolves it. Signer-pin + exit-codes now reach public CLI users. (Original note, now historical:) 🔴 could NOT be done manually: the installer requires **Sigstore-signed + reproducible-attested** binaries whose signatures only come from the CI's OIDC identity; a manual release would force downgrading the security checks, and manually syncing the public mirror risks leaking private code. So the *attested* release genuinely needs CI/billing. (The in-browser verifier already covers the non-engineer "verify it yourself" path, so the trust thesis is no longer *broken* for outsiders — just missing the CLI half.)

### Cut (adversarial pass — removed as generic/obvious/unjustified)
- **"Pricing" footer link** — generic polish; `/agents` already carries pricing.
- **"Publish a real SDK"** — no demand (kept only the honest-docs half).
- **tokens.xyz F1/F4/F5/F6** (discovery, marketScore-as-confidence, canonical grouping, metadata enrichment) — marginal; only liquidity materially aggregates. Not worth the new external dependency now.
- **tokens.xyz F3** (tokenized-RWA tracking-error) — DEAD: their equity reference is 41d-stale + identical to the token price (verified across 8 equities). RWA tracking needs Pyth/Chainlink, not tokens.xyz.

---

## Current state — 2026-06-18 (grant M1 `anchor` field + verification hardening)

`main` at `f535dde`. Two things shipped today; they are distinct in deploy scope and release status.

### 1. `anchor` field on `GET /v1/assets` — ✅ DEPLOYED + LIVE (api container only)

`crates/api-rs` now exposes an `anchor` field on every asset row. **No DB migration** — derived at read time from `class`. Three values:

- **`USD`** — fixed $1 target: fiat-backed, CDP, RWA, delta-neutral stables (USDC, USDT, USDS, hyUSD, JupUSD, USDe, PYUSD, EURC is `FX` not here).
- **`FX`** — fixed non-USD fiat peg: read `peg_target` for the currency (EURC → EUR, BRZ → BRL).
- **`NAV`** — intrinsic / net-asset-value redemption: LSTs, yield-bearing stables, synthetic leverage (jitoSOL, mSOL, USDY, syrupUSDC, sUSDe, JLP, xSOL, …).

**Why:** this is grant M1 Feature A (Superteam/SolanaFdn submission 2026-06-17). Consumers (tokens.xyz, integrators, the M1 reference adapter) get a one-field signal for *what kind of peg target* a token has, without needing to reverse-engineer `class`. The `class` field remains the machine-readable mechanism sub-type; `anchor` is the human/programmatic shorthand for the target itself.

**Deploy:** `deploy.sh --services 'api'` (engine, indexer, dispatcher untouched — calibration-safe). Commit `f535dde`.

**What is NOT live yet:** the M1 reference adapter (`docs/examples/`) is being added separately under a parallel task. It will document how an integrator consumes `anchor` + `peg_target` + `state`. Not included here per task boundary.

### 2. On-chain verification hardening — ✅ MERGED (PR #83 / `f535dde`) + ✅ RELEASED as CLI `v0.4.0` (2026-06-18, billing resolved)

`crates/pegana-replay-cli` received three security-critical hardening changes in the same commit:

- **Commit-signer allowlist (hard gate):** `--verify-onchain` now checks the on-chain transaction signer against an explicit allowlist BEFORE collecting any memo. This closes a real forge-ability hole: a hostile RPC could return a non-JSON encoding with a forged inner-instruction memo and previously pass verification if the hash matched. The signer check now hard-gates that path.
- **Exact pipe-field equality on memo match:** the memo comparison is now exact pipe-field equality (no partial substring match), matching the engine's own serialization contract.
- **ERROR → exit code 2:** conditions that were errors (distinct from a clean FAIL) now exit `2`, honoring the documented exit-code contract (`0` = VERIFIED, `1` = FAIL, `2` = ERROR). Previously these collapsed to `1`.

**Status — ✅ RELEASED 2026-06-18:** the published binary is now **v0.4.0** (was v0.2.0). After Rafael upgraded to GitHub Pro (billing was the sole blocker — the failures were literally "job was not started because recent account payments have failed"), the `sync-pegana-replay.yml` mirror push succeeded and tag `v0.4.0` fired `release.yml` (cargo-dist 0.30.0 + Sigstore via CI OIDC) → Sigstore-signed binaries (aarch64-apple-darwin + x86_64-linux) published as the "Latest" GitHub Release. Verified the public HEAD (`eb60f1a`) carries `PEGANA_COMMIT_SIGNERS`, so the signed binary has the signer-pin. The self-versioning installer (`3bce93e`) now resolves v0.4.0. **The hardening now reaches public CLI users.** (Did NOT push a `methodology-v0.4.0` tag — would fire a duplicate release; optional traceability follow-up.)

---

## Current state — 2026-06-16 (BETA RELEASE — ✅ DEPLOYED + VERIFIED LIVE)

`main` at `ce3dc3c` (7 commits `0e07a51`→`ce3dc3c`). **Founder call: the 13 `monitoring_only`
assets are RELEASED as "beta"** — they now fire public alerts, labeled provisional. This
**reverses the 2026-06-12 egress gate** (and the calibration-verdict containment):
`monitoring_only` flipped from *suppress* → *deliver-with-beta-marker*. Rafael overrode the
recommendation to hold the 4 frozen-signal assets (sHYUSD/hyloSOL+/ONyc/xSOL) — all 13 ship
under an honest "beta" label (the 0.4.0 NAV-sanity guard maps a broken signal to UNKNOWN, not
a false alert; new anti-flap caps the rest).

**The 13:** mSOL, INF, bbSOL, hyloSOL, hyloSOL+, sHYUSD, xSOL, JupUSD, JLP, EURC, dzSOL, vSOL, ONyc.

**What shipped (no migration — reused the `monitoring_only` flag, behavior suppress→label):**
- **Dispatcher:** egress chokepoint no longer suppresses; captures a `beta` bool → Telegram
  (`vars.beta`) + webhook canonical (`"calibration":"provisional"`, additive, signs cleanly).
  **Anti-flap:** a beta BLACK_SWAN no longer bypasses dedup (30-min floor) so a provisional
  signal can't blast subscribers; real (calibrated) BLACK_SWANs still bypass + always alert.
- **Bot:** alert template appends a "🧪 Beta — provisional calibration" footer on `vars.beta`.
- **API:** the 4 read-surface egress gates removed (`/v1/alerts`, `/v1/audit` index + `.csv`,
  `/v1/stats.alerts_24h`) → the 13 are publicly listed; `AlertRow` + audit-index rows gain an
  additive `monitoring_only: bool` so the ledger labels beta rows.
- **Web:** badge `monitoring` → **`beta`**; hover stopped echoing the raw engineer
  `monitoring_reason` ("Phase-0 launch… p95… calibration v1 downgrade", ISO date) → a clean
  fixed copy. Glossary de-jargoned (Premium reworded, stale `BRZ`→`EURC`, infra jargon dropped).
- **Docs:** docs-site + `assets.toml` line-1 header reframed "monitoring_only = excluded from
  egress" → "beta, alerts live but provisional"; changelog entry.

**Deploy:** backend via `deploy.sh --services 'dispatcher api bot'` (engine/indexer NOT
recreated). Web via `vercel --prod --yes` from **repo ROOT** (root-dir="web"; from `web/` it
fails as `web/web`; needs a temp `.vercelignore` that KEEPS `crates/` because the web build
reads `crates/methodology/CHANGELOG.md`). Vercel git-auto-deploy **builds but does not promote**
the prod alias — must force `vercel --prod`.

**Verified live:** `/v1/alerts` 16→38 rows (21 beta, all carry the flag), `/v1/audit` 96 (23
beta), `/v1/stats.alerts_24h` now includes beta, asset cards intact, api/bot/dispatcher healthy.
Engine **confirmed 0.4.0** (newest receipt sUSD 2026-06-16T00:01Z stamped methv 0.4.0). Web badge
BETA + new hover Playwright-verified. Beta cohort behaving: sHYUSD (beta) emits UNKNOWN via
NAV-sanity — honest, not false.

**Also shipped this session:**
- **Public-link sweep (`711c07c`)** — every live-facing `github.com/lrafasouza/pegana` (PRIVATE,
  404) link → `…/pegana-replay` (public) or unlinked where the path is private-only: docs.json
  (nav/footer/**License (MIT)**/social), all guide mdx, crates.io `repository` (methodology +
  replay-cli), mcp-ts (package.json/smithery/README), `scripts/install.sh` REPO. The founder's
  "MIT link → private repo 404" concern is **resolved** (root `README.md` clone left —
  collaborator-only).
- **Open-source claims honesty (`10c98c6`)** — faq/introduction claimed "everything (engine,
  API…) is open at pegana-replay" — FALSE (public repo = verifier only). Reworded: methodology +
  verifier public; operational stack separate.
- **Verifier PROVEN** — built local replay-cli **0.4.0**, verified a **live 0.4.0 production
  receipt** end-to-end → **PASS** (`recomputed == stored`). The verifiability thesis is sound;
  replay-cli version bumped 0.3.0→0.4.0 (`ce3dc3c`) for lockstep.

### 🔴 Blocker + what's next (operator)

**ROOT BLOCKER = GitHub Actions BILLING (founder-only).** Diagnosed 2026-06-16: the
"Sync pegana-replay" workflow **fails in 3-4s** every push (public mirror stuck at 0.3.0 since
06-04); ALL CI jobs fail with **"log not found"** = jobs never START (billing, not code — local
suites all green). Blocks **three** things at once: the **P0 verifier release**, the **public
sync**, and **CI**.

1. **[FOUNDER] Fix GitHub Actions billing** — highest leverage; unblocks release + sync + CI together.
2. **[ME, after #1] Cut the v0.4.0 verifier release** — engine emits 0.4.0 receipts but no v0.4.0
   release exists (installer ships v0.2.0): sync repopulates the public repo with 0.4.0 source →
   `git tag v0.4.0 && git push --tags` on `pegana-replay` → cargo-dist builds (proven pipeline,
   math proven). `scripts/install.sh` (VERSION=latest) auto-serves it; bump the secondary
   `web/public/releases/…-installer.sh` default. **Closes the P0 verifiability gap.**
3. **[FOUNDER] Vercel auto-promote** — dashboard "auto-assign production domains".
4. **[FOUNDER] Open-source positioning** — make monorepo public (then "fully open" is true) vs
   keep the honest verifier-only framing shipped this session.
5. **[ME/FOUNDER] Beta cohort follow-up** — graduate the 9 well-signal beta assets → "live"
   (drop beta label) after the calibration retro (`docs/operations/monitoring-only-promotion-criteria.md`);
   fix/watch the 4 frozen-signal ones (emit UNKNOWN — honest but low-value); watch beta
   false-positive volume (anti-flap should contain).
6. **[ME] Confirm the bot 🧪 footer** renders on a real beta alert to a subscriber (organic).

### Follow-up shipped 2026-06-16 (later) — validation-fix batch (✅ DEPLOYED + VERIFIED LIVE)

`main` at `1697d2a` (code `3de2089` + scorecard `1697d2a`). Closed the 4 discrepancies
from the user-surface re-validation. **Backend DEPLOYED via direct SSH** (`deploy.sh`
equivalent, `--services 'api dispatcher'`; engine "Up 25h" + indexer "Up 4d" **untouched**,
calibration-safe). Web (TS types) auto-deploys on the main push.

- **#1 — `calibration` field across the REST read surfaces.** REST exposed only
  `monitoring_only` (consumers had to *know* it meant beta). Added a self-describing
  `calibration: "provisional"|"calibrated"` — the SAME vocabulary the dispatcher already
  puts on the webhook canonical event — to `/v1/alerts`, `/v1/assets`, `/v1/audit` (index)
  and `/v1/calibration`, plus a doc-only OpenAPI `Calibration` enum + `calibration_label()`
  helper + web TS types. Also declared `monitoring_only` on `AuditIndexRow` (runtime emitted
  it but the struct/OpenAPI didn't → drift closed). Purely additive, no migration, no
  `deny_unknown_fields` anywhere. **VERIFIED LIVE:** `/v1/assets` 26/26 carry `calibration`
  (13 provisional = exactly the monitoring_only set, 13 calibrated, zero mismatch);
  `/v1/alerts` rows consistent (sUSD=calibrated, sHYUSD=provisional).
- **#2 — `alerts.dispatched_at` was a dead column.** Nothing ever wrote it, yet the OpenAPI
  doc claimed it was "populated once a target accepted" (false). Wired `mark_dispatched()`
  (idempotent `WHERE dispatched_at IS NULL`) to stamp on the first successful fan-out
  (Telegram or webhook), so a non-null timestamp now honestly means "delivered to ≥1
  subscriber". Fixed the doc-comment + the stale egress-gate doc on `asset_is_monitoring_only`.
  (Still null on current rows — no subscriber matched; stamps on the next real delivery.)
  Residual: confirming the dispatch worker is *live* vs 0-subscribers needs
  `redis-cli XINFO GROUPS pegana:alerts` on the box (operator).
- **#3 — `monitoring-only-promotion-criteria.md`** reframed for the beta release (the 06-18
  retro is now "drop the beta label", not "silent → public"); cohort table 11→13.
- **#4 — `docs-site/README.md`** repointed off the retired `docs.pegana.xyz` subdomain to the
  live `pegana.xyz/docs` proxy (`DEPLOY.md` is source of truth).

**Also (strategic, same session):** outreach scorecard pre-send blockers closed — Drift
exploit fact-checked (~$285M, 1 Apr 2026, DPRK; draft body cites no number), handles
re-verified (all match except #2 `@_Jeevan_R`, unverified → use GitHub issue). **Two
founder-only blockers remain before the demand test can run:** the `rafael@pegana.xyz`
from-address must be real + monitored (operator acct on file is `rafael@pegana.xyz` →
bounce risk), and a USDC payment rail for the pilot fee.

---

## Current state — 2026-06-15 (methodology 0.4.0 cluster — ✅ DEPLOYED + VERIFIED LIVE)

The **methodology 0.4.0** honesty/correctness cluster (ADR-0025) is **DEPLOYED and
VERIFIED LIVE** (2026-06-15) — `main` at `31ab4f4`, tag `methodology-v0.4.0`; the
**live engine now runs 0.4.0** (`/v1/methodology/current` = `0.4.0` active, registered
by migration `0051`). The cluster closes three validation-handoff gaps:

- **NAV-sanity premium cap** — a >10% premium on a direction-sensitive class (LST,
  stable_yield) is treated as a broken NAV anchor, not demand pressure → published as
  honest-dark UNKNOWN instead of a confident PEGGED off a garbage anchor (sHYUSD case).
- **No-Pyth → confidence capped MEDIUM** — an asset with no Pyth cross-check anywhere
  can no longer report HIGH confidence (blast radius: sUSD only).
- **Spread-reachable BLACK_SWAN** — the bps path now has a black_swan band (`2 × critical`),
  so the publicly-advertised 5th state is reachable for all assets, not just the CR path
  (hyUSD). Landing copy corrected "Four states" → "Five states".

**Override:** Rafael **deliberately overrode the 2026-06-25 stability lock** for this
cluster. This is a **founder call**, *not* the ADR-0009 critical-bug exception (none of
the three are wrong-alerts-firing bugs). 0.4.0 is also a **MINOR** behavior change, which
per ADR-0009 normally requires a 7-day announce + passive dual-run; that obligation is
being consciously deferred/compressed under the same override (see ADR-0025 + ADR-0009).
**Deployed 2026-06-15** via `deploy.sh --migrate --services 'engine'` (engine rebuilt
`--no-cache` + healthy; migration `0051` registered 0.4.0 active / deprecated 0.3.0).
**Verified live:** sHYUSD −19.5% premium → UNKNOWN (NAV-sanity, gated, no public
dispatch), sUSD → MEDIUM confidence, no false BLACK_SWAN / no alert storm
(`by_state` UNKNOWN:1 PEGGED:25, `alerts_24h` unchanged); Mintlify docs + Vercel web
auto-deployed on the main push — whole stack aligned at 0.4.0. The honor-vs-override
decision is recorded here + in migration 0051 + ADR-0025.

## Current state — 2026-06-14 (post-launch T+3)

`main` is at `ee7301a`. Trust Layer launched PUBLIC 2026-06-11. Since then:

- **2026-06-13/14 — asset-detail deepening + transparency suite SHIPPED** (see the
  "Asset-detail deepening" + "Net-new" sections): symmetric chart guides,
  autoscale, Legs mode, BandGauge rail, marker dedup, `/events` discount, the
  public **reliability log** + **live calibration self-monitor** on `/status`
  (`GET /v1/calibration`), and `scripts/calibration-monitor.sql` (the 06-18
  promotion tool).
- **2026-06-14 — P0 from the validation handoff** (`docs/2026-06-14-pegana-validation-handoff.md`):
  **hyloSOL+ frozen-signal** (1 distinct discount / 2400 samples while it was
  PUBLIC) → **contained as `monitoring_only` (migration `0049`) — SHIPPED + holds.**
  The public gap is closed (the egress gate suppresses it regardless of state).
- **2026-06-14 — engine freeze-detector: shipped, reverted, and REJECTED** (ADR-0024).
  The consecutive-identical-discount detector (`ee7301a`) false-positived on illiquid
  LSTs incl. **public JupSOL** (~9min false alert, caught by the post-deploy e2e
  sweep, reverted `7aadf34`, recovered). The follow-up **max-consecutive-run validation**
  then proved the approach is unsound: a constant discount is a **continuum** (healthy
  public RWA **ONyc ~20h** > hyloSOL+ ~12.5h > vSOL 6.5h > … > JupSOL 52min, USDC 67min)
  — **no threshold separates frozen from healthy-illiquid.** A constant discount means
  "illiquid at a stable peg" far more often than "broken". **Correct fix = curation, not
  detection:** containment (`monitoring_only`, P0#1 did hyloSOL+) + a **liquidity/depth
  gate** as the systemic signal (TIER 2, needs Birdeye key, post-06-25). The false JupSOL
  alarm is owned publicly in the `/status` reliability log (1 user-facing incident).
  **ONyc — contained** (migration `0050`, founder-approved): public RWA with a frozen
  market leg, same "can't detect a real move" property → `monitoring_only` (13 total).
  Both public frozen-leg assets (hyloSOL+, ONyc) now contained. P1 confidence-cap
  deferred (Pyth-conf vs source-redundancy semantics).

### Earlier (2026-06-12, T+1)

- **2026-06-12 JupUSD false-CRITICAL** (a single `out_amount=0` Jupiter quote →
  `market_usd=0` → poisoned the α=0.3 EWMA → false CRITICAL ~7.5min, NOT a real
  depeg) — fixed `05245c1`; the near-zero (`out=1`) residual fixed `6b7bb53`
  (source-side jupiter NAV floor, 0.001 USD).
- **2026-06-12 monitoring_only egress gate** (`7e4bf8f`) — migration 0048's
  calibration "downgrade" was DISPLAY-ONLY; the engine + dispatcher had no
  `monitoring_only` awareness, so all 11 monitoring-only assets (incl. the 5
  zero-calibration Phase-0 additions) could blast public alerts ungated. Gated
  at EVERY public surface: `/v1/alerts` + `/v1/audit` index/`.csv` + `/v1/stats`
  counter (RSS/Atom inherit), dispatcher Telegram+webhook fan-out, and the
  engine on-chain SPL-memo commit. Internal alert rows are kept for the retro;
  by-id `/v1/audit/{id}` stays public by design.
- **Promotion criteria** for the ~06-18 retro now exist:
  [`docs/operations/monitoring-only-promotion-criteria.md`](docs/operations/monitoring-only-promotion-criteria.md).

**Stability lock 2026-06-11 → 06-25**: no methodology/engine-behavior changes
except (a) a documented critical-bug exception (ADR-0009 — the JupUSD + egress fixes
qualified) and (b) the **methodology 0.4.0 honesty cluster (ADR-0025)**, shipped under
a deliberate **founder override** of the lock (NOT the ADR-0009 exception — these are
honesty/correctness guards, not wrong-alert bugs). 0.4.0 is **committed on this branch
but NOT deployed** — the live engine is still 0.3.0. The calibration-era "do not recreate engine/indexer" guardrail is
LIFTED post-launch; backend deploys via `deploy.sh`, web via Vercel on push to
main. **GitHub Actions CI is RED (billing lapse — jobs never start)**; validate
locally until resolved.

## Asset-detail deepening — ✅ SHIPPED + DEPLOYED + VERIFIED LIVE 2026-06-13 (origin/main `ac1eb65`)

Brainstorm + grill (`docs/superpowers/specs/2026-06-12-asset-detail-deepening-design.md`),
built TDD, reviewed (workflow + `/code-review` + live empirical verification), deployed.
Of the 5 candidates, 3 were already shipped (C1 markers, C4 URL state, C5 LST backing),
C2 displaced by BandGauge → **2 built**, both stability-lock-safe (frontend + additive READ):

- ✅ **BandGauge in the asset-detail rail** ("Proximity to depeg") — LIVE (USDC rail shows ~4%).
- ✅ **market-vs-intrinsic "Legs" chart mode** — 5th mode, plots the two raw USD legs
  (market amber vs intrinsic·NAV dashed) on a `$` axis, pinned to 1h raw, USD tooltip with
  "raw gap". Additive read: `intrinsic_usd`/`market_usd` added to `/history?bucket=raw`
  (NOT NULL, omitted for 1m). **Gate = `peg_target === "USD"`** (allowlist — stricter than the
  spec's `class!=='lst'`, also excludes EURC/EUR + xSOL/SOL; fails safe). Verified LIVE:
  USDC renders 2 legs ($1.0000 / $0.9998), jitoSOL legs button DISABLED.
- ✅ **Fix:** BandGauge aria-label `direction` was inverted vs the engine convention
  `discount=(intrinsic−market)/intrinsic` (confirmed against 26 live assets) — every
  screen-reader caller (table/mobile/preview/rail) was corrected.

**✅ FIXED 2026-06-13 (origin/main `250c1de`)** — the pre-existing chart guide-line bug
(drift/depeg/critical drawn only on the negative side, so a stablecoin depeg moved away from
its guides) is resolved: guides are now **symmetric (±)** (the engine classifies on
|discount|). The multi-lens review then caught two issues the symmetric change introduced —
(HIGH) the +critical line forced autoscale to ±critical, squashing wide-band assets (xSOL),
and (MEDIUM) the baseline fill read premium as benign — both fixed (an `autoscaleInfoProvider`
scaling to data+depeg so guides reveal as approached; symmetric baseline fill). Plus, in the
same batch: **per-alert `discount` on `/v1/alerts`** (additive → `/events` historical spread
lit up), **verify-alert confirmed already-shipped** on the audit receipt page, and **Jupiter
keyed config verified** (real action = 30-Jun free-tier billing). Deferred (founder/lock):
public incident-log publishing (brand call), marker-dedup (optional polish), /status 90d
rollup (needs backend aggregate), TIER-2 engine-signal upgrades (stability lock until 06-25 +
API keys). vitest 241/241 · cargo 46/46.

**Deploy note:** GitHub→Vercel auto-deploy failed again (git build 0ms/UNKNOWN; promote 422 /
redeploy 400) → web shipped via CLI `vercel --prod --scope lrafasouzas-projects` from REPO
ROOT + temp `.vercelignore` (excl. 48G `target/` + artifacts; rootDirectory=web builds
server-side). api via `deploy.sh --services 'api'` (engine/indexer/dispatcher untouched).

**✅ Polish batch 3 SHIPPED 2026-06-13/14 (origin/main `1284da8`):** marker dedup for
flappy assets (collapseFlaps, reuses STATE_SEVERITY) + the public reliability log below.
`/review` caught a real factual error in the JupUSD post-mortem (credited the egress gate,
which shipped ~13h after the incident — real reason was zero subscribers) → corrected live.
CLI-deploy gotcha: exclude only `target/`+`docs/`+artifacts from `.vercelignore`, NOT
`crates/` (the methodology CHANGELOG is read at build). vitest 253/253.

## Net-new opportunities — beyond this roadmap (2026-06-12, challenged)

Surfaced when asked "what else can we do?", with the generic/obvious cut:

1. **✅ DONE — Public self-reliability page ("watch the watchers")** — shipped on `/status`
   2026-06-13/14: honest "zero user-facing incidents" headline + blameless post-mortems of
   the issues caught internally (JupUSD false-CRITICAL, monitoring_only egress gap), tagged
   "0 users affected". For a TRUST product, publicly auditing your own reliability is the
   moat (competitors don't). (False-alert-rate metric not computable without manual labels.)
2. **One-click "verify this alert yourself"** — ✅ already on the audit receipt page
   (replay installer cmd + `pegana-replay --alert-id` + bundle download + on-chain tx + how-to).
3. **Continuous-calibration self-monitoring** — automate the manual
   calibration/promotion: flag when an asset's live p95 drifts outside its band.
   A trust oracle that knows when it's miscalibrated (additive observability).
4. **(extension of Legs)** 3-leg source-divergence panel (intrinsic vs market vs
   oracle + a "sources disagree" flag).
5. **(strategic, demand-gated)** risk feed as a DeFi circuit-breaker input
   (pause-on-depeg, needs a design partner); lean into the agent economy
   (MCP + x402) as the distribution channel.

Cut as generic/covered: interactive backtest (Phase 14 covers publication),
embeddable-widget extension (/embed exists), methodology diff viewer (changelog).

Recent web hardening in this pass:

- E2E tests now match the current landing/audit/dashboard/asset shells and
classify local API `429` / unreachable fallback as an explicit local skip rather
than a product crash.
- `/status` surfaces `stats.delivery_health` as an explicit Alert delivery
component.
- `/events` enriches rows with spread magnitude when available, falls back to
current asset spread when alert history lacks the field, shows mini sparklines,
deep-links to the asset chart timestamp, and derives live transition rows from
the WS state stream while the page is open.
- `/compare` has a decorative preview mode for the empty-state chart and the
Major LSTs CTA/preset writes the shareable `?s=` URL even when live assets are
rate-limited.

Launch calendar:

```text
2026-06-09  final ADR-0015 review
2026-06-10  mechanical verdict with scripts/calibration-v1-queries.sql
2026-06-11  launch runbook + per-asset activation/deferral
```

Open trust/product gaps before or immediately after launch:

- Status: replace today's honest no-data uptime bars with a real 90-day rollup
  when the backend aggregate exists.
- Events: extend `/v1/alerts` / `AlertRow` to ship historical `discount`,
  `intrinsic_usd`, and `market_usd` for every event instead of relying on
  current-asset fallback.
- Compare: add explicit copy-to-share-link, CSV/PNG export, and computed presets
  such as "Widest now" / "Drifting".
- Asset detail: add state-transition markers, DRIFT/DEPEG chart regions,
  market-vs-intrinsic dual-line mode, URL-encoded tab/range/mode, and richer
  backing decomposition.
- Accessibility/design: keep sweeping `StatePip announce` for live-changing
  pips, replace raw `#feed7a` / `#ff8400` usages with tokens where they remain
  outside brand primitives, and reduce rounded/mono CTAs that still fight the
  visual system.

## Launch audit 2026-05-31 — fixes DEPLOYED to prod

> Pre-launch hardening pass from an 11-agent audit that cross-referenced
> ROADMAP/AMENDMENTS vs. the real repo. **MERGED (#70 + #76) and DEPLOYED to prod
> 2026-05-31** — backend via `deploy.sh` (HEAD `8981111`, all 12 containers healthy),
> web via Vercel. Verified live: ledger gate returns `[]` (FEATURE_PUBLIC_ALERTS=false),
> mcp-ts mainnet+CDP confirmed via SSH, engine recomputing every tick, workers idle
> (0 pending / 0 failures), Alertmanager paging confirmed end-to-end to Telegram.
> Validated pre-merge: `cargo build`/`clippy -D warnings`/`fmt`/test, `web` tsc + Next
> build, mcp-ts vitest (40), sdk TS+Py tests + 7-agent adversarial review.

- **SQL verdict (launch-blocking)** — `scripts/calibration-v1-queries.sql` would have ERRORed on the real schema: `FROM alert_events ... detected_at` (the view aliases it to `ts`) → query the base `alerts` table; `WHERE active` → `is_active` (migration 0001:42); window `2026-05-27` → `2026-05-29 03:55` (real evidence start, ADR-0015). The 06-10 verdict now runs on correct SQL.
- **False public claims** — `/agents` x402 price `$0.0005–$0.005` → `$0.0005–$0.001` (real tiers); MCP tools + `smithery.yaml` lead examples dSOL/BRZ (deactivated) → jitoSOL/USDC (active); MCP README "60 req/min Caddy" claim (no such limit) → real in-app limit; SDK READMEs flat receipt shape (re-taught B-012) → nested; `getOnchain` SDK type + 404 handling aligned to live API.
- **Ledger gate (ADR-0020)** — the public `/v1/audit` index + `/v1/alerts` + `.csv` + RSS/Atom feeds are now gated by `FEATURE_PUBLIC_ALERTS` in api-rs (calibration ledger stays quiet until the 06-11 flip; `/v1/audit/{id}` detail + `/onchain` stay public). Resolves the ADR-0005 contradiction **and** the decoupled-gates finding — one launch switch.
- **Engine workers (ADR-0004 + ADR-0006 — now SHIPPED, were "deferred")** — `run_commit_failures_retry` (1h dead-letter retry → `committed`/`retry_exhausted`/`wallet_drained`, makes audit.rs 410/retry_exhausted reachable) + `run_alert_evidence_reconcile` (30s pending→evidence, 24h→`failed_permanently_at`). engine-rs gained a `[lib]` target so tests drive the inner step fns. `assets.toml` confirmed runtime-authoritative for thresholds → **migration 0021 intentionally not written** (DB column display-only). _Follow-up: dispatcher subscriber for `pegana:evidence_reconciled` to re-fire `evidence_now_available` (currently a harmless no-op)._
- **x402 safety** — mcp-ts boot fail-fast when `SOLANA_NETWORK`=mainnet but CDP creds absent (kills the ADR-0018 silent devnet-fallback footgun).
- **Alerting (LIVE)** — Alertmanager service (internal-only, sed-renders `ops/alertmanager/config.yml` from `.env` at boot) + `alerting:` block in prometheus.yml + Telegram route; Grafana panels + alert rules for the previously-invisible hardening metrics (`receipt_hash_fallback_total` → page, `cr_unavailable_total`, `dead_assets`). **Deployed + paging WIRED 2026-05-31**: dedicated ops bot → owner Telegram, confirmed end-to-end. (#76 fixed a `chat_id: 0` crash-loop — AM treats int64 zero as "missing chat_id"; default is now `1`.)
- **CI / tests** — Postgres+Redis services wired into `ci.yml` (un-skips the integration suites), new Playwright job (`web-e2e.yml`), `verify-assets --strict`, SDK fixture tests (B-012/B-028) + npm build step, MCP paid-path + `fetchHistory` tests; a11y/e2e specs repointed off now-redirected routes; web server routes no longer fall back to `localhost:8080` on prod. ROADMAP migration count 39→38 (0021 skipped); `reproducible.yml`→`reproducible-build.yml`.
- **Docs** — 03-asset-coverage counts + INF active; AMENDMENTS calendar (05-29 early deploy, ADR-0015 verdict); deploy one-pagers (psql migrate loop, `up -d --force-recreate` flag flip, lightweight rollback tag, public-repo release path, false "flip enables /audit" claims); `docs.pegana.xyz`→`pegana.xyz/docs`; deferreds #1/#2 RESOLVED; new `sas-wallet-refund.md`; ADR-0005 amendment + new ADR-0020.

**Deferred from this PR (follow-up issues):** dispatcher subscriber for `pegana:evidence_reconciled` re-fire (#71); orphan-component cleanup via `bunx knip` (#72); bot-ts eslint flat config → blocking lint (#73); a11y WCAG color-contrast review on muted text (#74); backend-provisioned Playwright job for the data-dependent e2e specs (#75).

**Still operator-physical (cannot be done from the repo):** wallet refill (engine logged CRITICAL at 0.0499 SOL — most urgent), 1 x402 mainnet settlement on Solscan, R2 30d lifecycle visual confirm, Sentry UI alert rules, Smithery/mcp.run public flip, daily calibration ritual → 06-10, ops-bot token `/revoke` (exposed during setup).

**Still requires the operator (cannot be done from the repo):** SSH-verify prod `mcp-ts SOLANA_NETWORK=mainnet` + 1 real x402 settlement on Solscan · refill commit wallet (0.05 SOL floor) · R2 lifecycle visual confirm · Sentry alert rules in UI · flip Smithery/mcp.run public · restore drill · daily calibration ritual → 06-10 · mechanical verdict 06-10 · per-asset ADR-0002 activation 06-11 T-2h · final ADR-0015 review 06-09 · render Alertmanager Telegram secret at deploy · pegana-replay GitHub Actions billing.

---

## Live in production (as of 2026-05-29 22:00 UTC)

### Core pipeline

| Component | State | Where |
|---|---|---|
| **Trust Layer v0.1.0** | LIVE since 2026-05-29 03:55 UTC | Hetzner prod (<prod-host>) |
| **22 active + 6 inactive assets** | calibrating; 8 LST + 3 fiat + 2 CDP + 1 delta-neutral + 7 yield-bearing + 1 monitoring-only; **+ JLP added 2026-05-29 inactive** | `assets.toml` (28 entries) |
| **Engine (Rust)** | every-tick recompute; on-chain commit pipeline armed (PR #59 Run 2 verified on Solana mainnet slot 423001050) | `crates/engine-rs/` |
| **Indexer (Rust)** | 6 sources: Sanctum, Pyth Hermes, Jupiter lite-api, Hylo on-chain, DexScreener, Piggybank | `crates/indexer-rs/` |
| **API (Rust + axum)** | 21 routes: `/v1/audit/*`, `/v1/methodology/current`, `/v1/assets/*`, `/v1/stats`, `/v1/ws`. AC42 server-side `?state=` filter closed today | `crates/api-rs/` |
| **Dispatcher (Rust)** | webhook fan-out (HMAC ed25519) + Telegram + retraction worker per ADR-0003 | `crates/dispatcher-rs/` |
| **Methodology crate** | versioned `0.1.0`, refused-on-mismatch at engine boot | `crates/methodology/` |
| **Replay CLI** | offline verifier with `--verify-onchain` flag; Sigstore-attested installer at releases.pegana.xyz | `crates/pegana-replay-cli/` |

### Consumer surfaces

| Surface | State | Where |
|---|---|---|
| **Telegram bot `@PeganaWatchBot`** | grammY + Fluent i18n PT-BR/EN; Login Widget auth; Postgres session storage; evidence_url in 5 alert templates (AC26); F-005/F-006/F-008 mitigations applied (PR #25) | `bot-ts/` (~2,500 LoC, 63 tests passing) |
| **MCP server `mcp.pegana.xyz`** | x402 USDC mainnet via CDP facilitator; 8 tools: ping, get_assets, get_asset_state, get_methodology, get_asset_history (paid $0.001), subscribe_peg_events (paid $0.0005), verify_alert (free per ADR-0011), ping_paid; **B-008/B-009 normalizeDiscountSnapshot fixed PR #61; B-010 get_methodology AssetClass resolution fixed PR #66; heartbeat phantom cache filtered PR #67** | `mcp-ts/` (~1,500 LoC, 33 tests passing) |
| **Web (Next 16.2.11)** | marketing + dashboard + `/audit/[id]` + `/audit` index + `/methodology` + `/pricing` + `/agents` + `/embed` + `/status` + `/events` + `/about` + `/changelog` + `/privacy` + `/terms` + RSS/Atom; Vercel auto-deploy from main; `@vercel/analytics` + `@sentry/nextjs` wired (PR #66) | `web/` (~15,000 LoC) |
| **SDKs (TS + Python)** | hand-rolled, `private: true` per AC60-63; **getAudit/verifyAlert shape aligned with nested API response (PR #61 B-012 fix)**; smoke-tested against prod | `sdk/typescript/` + `sdk/python/` |
| **Embed widget** | `pegana.xyz/embed.js` ≤10KB + `/embed/<asset>` iframe; CORS verified; theme toggle (light/dark via `data-pegana-theme`) | `web/app/embed.js/`, `web/app/(marketing)/embed/` |
| **RSS/Atom feeds** | `pegana.xyz/audit.xml` (Trust Layer Receipts), `pegana.xyz/calibration.xml` (Methodology Calibration); `<link rel="alternate">` discovery tags in `<head>` (AC50) | `web/app/audit.xml/`, `web/app/calibration.xml/` |
| **Docs proxy `pegana.xyz/docs`** | Mintlify behind Vercel rewrite (PR #62 closes B-015); `docs.pegana.xyz` retired due to DEPLOYMENT_NOT_FOUND | `web/vercel.json` + `docs-site/` |
| **Releases mirror `releases.pegana.xyz`** | install one-liner + SHA256SUMS + pre-built aarch64-apple-darwin binary; proxy via Next 16 conventions (PR #43) | `web/proxy.ts` + `web/app/releases/` |

### Infrastructure

| Component | State | Where |
|---|---|---|
| **Postgres (TimescaleDB)** | 69 migrations applied (numbered 0001–0070, 0021 intentionally skipped); hypertables on `discount_snapshots`, `alert_evidence`; append-only triggers on evidence; continuous aggregate `discount_1m` | `migrations/` |
| **Redis 7** | pub/sub: 6 source channels + `pegana:discount` + `pegana:alerts` stream + `pegana:retraction`; AUTH enabled per F-004 mitigation (PR #25 #env) | `docker-compose.yml` |
| **Caddy 2** | auto-TLS for api.pegana.xyz, mcp.pegana.xyz, grafana.pegana.xyz; CSP `default-src 'none'` on api/mcp vhosts; X-Forwarded-For propagation (F-002 fix) | `Caddyfile` |
| **R2 backups** | Cloudflare R2 bucket `pegana-backups` (ENAM region, free tier); 6h cron; 30d retention; encrypted with `~/.pegana-backup-key`; TimescaleDB-aware restore via `pg-restore.sh list/restore` (PRs #36, #38-41); R2 lifecycle rule for retention (per cron installer) | `scripts/pg-backup.sh`, `scripts/pg-restore.sh`, `scripts/install-pg-backup.sh` |
| **Self-hosted Grafana** | `grafana.pegana.xyz` on Hetzner via Caddy (PR #46); Prometheus datasource auto-provisioned; `pegana-overview` dashboard + hardening-metric panels | `docker-compose.yml` + `ops/grafana/` |
| **Alertmanager** | internal-only (no host port); Prometheus rules in `ops/alerts/pegana.yml` route here; config sed-rendered from `.env` at boot; **Telegram paging LIVE 2026-05-31** (#76) — dedicated ops bot → owner DM, confirmed end-to-end | `docker-compose.yml` + `ops/alertmanager/config.yml` |
| **Sentry (`pegana-prod`)** | Rust services + bot-ts + mcp-ts + web all wired (PR #66 closed Q-005); release tags = git SHA; Sentry Crons monitoring 3 jobs (PR #50 + #51 status-in-body fix) | `~/pegana/.env` SENTRY_DSN |
| **Crons (Hetzner)** | `pg-backup.sh` 6h, `calibration-watch.sh --daily` 09:00 UTC, `calibration-watch.sh --watch` every 5min; idempotent installers; dedup by script path (PR #42); Sentry check-ins on EXIT trap | `scripts/install-*.sh` |
| **On-chain commit wallet** | `7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9` (Solflare-issued, 0.05 SOL funded); bind-mounted into engine container; CRITICAL Sentry capture throttled to 1/h (PR #45 — was firing every 5min before) | `/opt/pegana/.secrets/commit-keypair.json` |

---

## Calendar — pre and post launch

```
2026-05-29 03:55 UTC  ──  ✓ Trust Layer v0.1.0 deployed (early per ADR-0005)
2026-05-29 → 06-10   ──  ✓ Calibration window (12d 20h) per ADR-0015 hybrid criterion
2026-06-10            ──  ✓ Mechanical verdict: SHIP via DOWNGRADE(5 LSTs → monitoring-only) per ADR-0015
2026-06-11 T-0        ──  ✓ Public launch (FEATURE_PUBLIC_ALERTS=true; 11 assets monitoring-only)
2026-06-12 T+24h      ──  ◀ NOW — health sanity check; JupUSD fix + monitoring_only egress gate shipped
2026-06-18            ──  monitoring-only → calibrated 7-day retro (see promotion-criteria doc) + earliest Sub-project B
2026-06-15            ──  methodology 0.4.0 honesty cluster (ADR-0025) committed under founder override of the lock — NOT yet deployed (live engine still 0.3.0)
2026-06-25            ──  Methodology stability lock ENDS (per ADR-0009) — band re-tunes may ship
2026-07-15            ──  Launch scorecard cut per ADR-0007
2026-07-31            ──  Scorecard kill-rule decision per ADR-0007
```

---

## 2026-05-29 day-long sprint stats (one day across multiple sessions)

- **57 PRs closed** (range #12 to #68)
- **140 commits** merged to `main` during 2026-05-29 UTC
- **23 distinct branches** mergeados
- Components touched (sorted by PR count):
  - web: 24 PRs (design uplift waves, theme, mobile, docs proxy, Sentry, waitlist)
  - docs: 19 PRs (ADRs, ROADMAP, runbooks, outreach drafts)
  - ops-scripts: 14 PRs (R2 backups, restores, watch, cron installers)
  - api / mcp: 4 PRs each
  - ops-config / bot / dispatcher: 2-4 PRs each
  - engine / indexer / rust-libs / sdk / docs-site: 1-3 PRs each

---

## Active blockers (T-13 to launch)

- **R2 lifecycle rule** — visual confirm in Cloudflare dashboard (handled by `install-pg-backup.sh` graceful fallback, but operator should verify the rule landed)
- **Final ADR-0015 review** before 06-09 23:59 UTC cutoff
- **Mechanical verdict computation** on 06-10 via `scripts/calibration-v1-queries.sql`
- **Execute launch runbook** on 06-11 (`docs/operations/launch-runbook-2026-06-11.md`)
- **Wallet refill** (optional — PR #45 backoff makes 0.05 SOL cover ~500 commits ≈ 6 weeks)
- **Issue #101 evidence write path** — ✅ CLOSED 2026-05-29 (PR #59 Run 1 + Run 2 in prod with on-chain memo)

Note: outreach (Parity / StableGuard / SendAI / DefiLlama) is **cut from
T-13 scope** per 2026-05-29 user pivot. Drafts remain in `docs/outreach/`
but only 2 entries logged in `docs/outreach/log.md` — accept the R12
kill-rule risk per ADR-0007 (07-31 decision) OR reactivate before 07-15
scorecard cut.

---

## Post-launch queue (earliest 2026-06-18, 7d stable required)

Per `docs/pegana-trust-layer-v0.1.0/AMENDMENTS.md` + `project_trust_layer_followups.md`.

### 1. Hardening batch H1-H12 — ✅ DONE 2026-05-31

Implemented as ONE semantic invariant — **"missing data ≠ confirming data"** —
pulled forward from this queue when the owner dropped the launch calendar
(validate+fix mode). Commits `64752d2` · `96367c0` · `66497ab` · `c301800`. See
[ADR-0019](docs/adr/0019-hardening-missing-data-invariant.md) + session memory
`project_hardening_h1_h12.md`.

| # | Component | Fix | Status |
|---|---|---|---|
| H1/H9/H12 | engine `state.rs` | `pyth_confidence_label` → `Option`; missing/stale/zero-price/zero-conf → "unknown" (ranks strictest), never "high" | ✅ |
| H2 | engine `main.rs` | hyUSD CR early-return — an absent CR is no longer synthesized to 1.0 (which read as a false Critical) | ✅ |
| H3/H4 | engine | numéraire feed is now a confidence + receipt input (~20 Jupiter-quoted assets no longer report "high" on a broken numéraire) | ✅ |
| H5 | `assets.toml` | USDC↔USDT numéraire cycle broken — each prices via its own `pyth_spot` feed (the "numeraire=self" idea was wrong: same-mint Jupiter quote) | ✅ |
| H6/H7 | engine | staleness gating — non-Pyth AND pyth-fed sides timestamped; a source that stops publishing → skip, not PEGGED on dead data; counter `pegana_engine_source_stale_total` | ✅ |
| H8 | methodology | `compute_discount` → `Option` — a zero/absent intrinsic no longer reads as discount=0 / PEGGED (version stays 0.1.0; valid inputs unchanged) | ✅ |
| H10 | engine | a canonical-hash failure DROPS the receipt loudly — no all-zero sentinel persisted, served, or committed on-chain | ✅ |
| H11/H11b | indexer | decimals mint-coupled (`numeraire_meta`), no silent `_ => 6`; hylo/piggybank scale consts documented | ✅ |
| H12b | engine | active periodic sweep for a TOTALLY-dead asset (no ticks) | ⏸️ DEFERRED — gating + counter cover the common "one side dead" case; the sweep has false-stale risk, do observability-first later |

Two adversarial review passes each caught a real bug the impl missed (numéraire_feed
ALTO; intrinsic-seeding CRITICAL). Validated: `cargo test --workspace` (28 suites) +
`verify-assets` 28/28 + **live end-to-end on the prod-local stack** (USDC/USDT/USDY
compute PEGGED, no false-stale). **DEPLOYED to Hetzner 2026-05-31** (`943849c`; prod
now at `f0de8a7` after the close-deferred sweep — engine/indexer healthy, gate passed).
Pre-deploy gate cleared (no stray `0.1.0 broken` row in prod; the stray one was
prod-local only). Only **H12b** (active dead-asset sweep) remains deferred — see row above.

### 2. Sub-project B — Risk Signals (3-4 weeks)

Venue-aware feeds (Switchboard, Orca TWAP, Phoenix orderbook). Pyth Lazer
evaluation (15K compute units, sub-second). New `VenueFragmentation`
PegState. `ORACLE_DEGRADED` signal from Pyth confidence width +
divergence + staleness.

**Why first after hardening**: directly attacks the 2025-10-10 USDe-cascade detection gap. Composes nicely with H1 (`pyth_confidence_label` Option).

### 3. Sub-project C — Loop Intelligence (4-6 weeks, depends on B)

New `protocol-indexer-ts` reading Kamino / Jupiter Lend / MarginFi /
Loopscale / Save. Materialized `loop_exposure_usd(asset)`.
`simulate_depeg_impact(asset, shock_bps)` MCP tool + REST endpoint.

**Why**: killer feature. Solana-side equivalent of Chaos Labs for Ethereum.

### 4. Sub-project D — KILLED per ADR-0016 (2026-05-29)

~~Wallet-level Risk + `/connect <wallet>` + `wallet-monitor-rs`.~~

**Killed because** it violates Hard NO #3 (`01-business-rules.md § 2`).
Re-introduction requires the override conditions in
[ADR-0016](docs/adr/0016-kill-sub-d-defer-sub-e.md).

### 5. Sub-project E — DEFERRED INDEFINITELY per ADR-0016

~~Whale tracking, mint/burn anomaly, TVL flow.~~

Re-prioritized only on the explicit triggers in
[ADR-0016](docs/adr/0016-kill-sub-d-defer-sub-e.md).

### 6. Phase 0c — Major-stable asset additions (~1-2 days)

USD1 ($991M WLFI), USDG ($686M Paxos), USDTB ($43M Ethena), FDUSD ($8.5M)
— all `fixed_1_usd` + jupiter_usd numéraire pattern. Verified Pyth feeds
on hermes.pyth.network. Detail in
[`docs/operations/post-launch-asset-batch.md`](docs/operations/post-launch-asset-batch.md).

**Order**: AFTER H1-H5 numéraire confidence-gate ships, so new assets enter clean architecture.

### 7. Phase 0d — Yield-bearing asset additions (~1-2 days)

USX ($501M Solstice) + CASH ($116M) — both have Pyth NAV + spot + RR
feeds. Same code-path as USDY/sUSDe/syrupUSDC.

### 8. Phase 0e — BUIDL (post H7 fix)

BlackRock USD ($617M Solana circulating). No Pyth feed → requires
DexScreener multi-source failover (H7) to land first.

### 9. ✅ Phase 14 — Backtest 10/10 publication (DONE + MERGED + LIVE 2026-06-22)

Published the 10-asset, one-minute Pyth replay at
`docs/backtests/2025-10-10-usde-depeg/`, including schema-v2 receipts,
directional sanity tests, the `scripts/run-backtest.sh` drift gate, dedicated
CI, and `/backtest/2025-10-10-usde-depeg`. USDe reaches CRITICAL and the
public `pegana-replay` CLI re-derives the committed receipt. **Merged to `main`
(`a83cf2f`) + deployed; in-browser verify confirmed live.** Honest USDT finding
(premium→DEPEG) documented. See "Current state — 2026-06-22" + [[project_phase14_backtest_2026_06_22]].
**⚠️ This closed a credibility/marketing artifact, not the demand gap — the
higher-leverage next move is distribution (tokens.xyz) + a design partner, NOT
more features. See the strategic verdict in "Current state — 2026-06-22".**

### 10. Phase 15 — Pricing tiers (1-2 weeks + design partner)

Free / Pro / Realtime / Enterprise activation. Billing. `/account/api-keys`.

**Hard blocker**: ≥1 design partner signed per `01-business-rules.md § 7`.
Without that, AC60-63 SDK publish stays `private: true` and Phase 15 stays
in queue.

### 11. SDK publish (AC60-63, 0.5-1 day after Phase 15)

`npm publish @peganahq/sdk-ts` + `twine upload pegana-sdk` once Phase 15
has at least one design partner consuming it. Includes integration demo
README in each SDK.

### 12. SAS proper (3-4 days + 1 week devnet testing)

Migrate `crates/engine-rs/src/onchain_commit.rs` from SPL Memo to
Solana Attestation Service. `PeganaAuditAttestation` schema via SAS CLI.

**Trigger**: first partner requests SAS attestation OR v0.2.0 cycle.

### 13. SIWS / wallet login (1-2 weeks)

Sign In With Solana for B2B partners who don't use Telegram. Integrates
with existing user model.

**Trigger**: Sub-project C OR design partner requests wallet auth.

### 14. AC67 / AC70 / AC72 (deferred per AMENDMENTS)

- AC67: devnet integration test for on-chain commit path (~1 day)
- AC70: reproducible-build CI trigger via `.github/workflows/reproducible-build.yml` (~4h)
- AC72: Dockerfile `@sha256:` pinning across 6 Dockerfiles (~1h × maintenance cadence)

All low-priority. Address opportunistically.

---

## QA Bug triage matrix (B-001..B-016, Q-005..Q-007)

From the 2026-05-29 backend QA sweeps (PRs #60, #61, #62, #65, #66, #67):

| ID | Sev | Surface | Status | Closed by |
|---|---|---|---|---|
| **B-001** | P1 | web | Jupiter v6→v1 exit-liquidity rewrite | ✅ PR #60 |
| **B-005** | P2 | api | `/v1/audit/{id}/onchain` returns `not_committed_yet` for `not_applicable` — inconsistent semantics | ✅ 80a37f0 + dead-letter parity (2026-05-31) |
| **B-006** | P2 | api | `/v1/methodology/current` minimal — only `{version, status}` | ✅ 80a37f0 (+ `#lifecycle` fix_url anchor) |
| **B-007** | P2 | api | OpenAPI covers 21/33 routes (auth/me/ws missing) | ✅ 80a37f0 (32 paths + `telegram_jwt` scheme) |
| **B-008** | P0 | mcp | `get_assets` schema error — `normalizeDiscountSnapshot` was a no-op | ✅ PR #61 |
| **B-009** | P0 | mcp | `get_asset_state` same root cause as B-008 | ✅ PR #61 |
| **B-010** | P1 | mcp | `get_methodology` always returned "class unknown" fallback | ✅ PR #66 |
| **B-011** | P3 | mcp | x402 402-body resource URL defaulted the same for every paid tool (not upstream-hardcoded — `createPaymentWrapper` takes a `resource.url`) | ✅ per-tool `resource.url` via `createToolResourceUrl` (2026-05-31) |
| **B-012** | P1 | sdk | `getAudit`/`verifyAlert` declared flat shape, API returns nested | ✅ PR #61 |
| **B-013** | P2 | sdk | SDK covers 4 of 33+ endpoints | ⏸️ intentional (private:true) |
| **B-015** | P0 | web | `docs.pegana.xyz` DEPLOYMENT_NOT_FOUND on every path | ✅ PR #62 (Mintlify /docs proxy) |
| **B-016** | P0 | web | `vercel.json` `comment_rewrites` unknown field — every PR Vercel-rejected | ✅ PR #64 + #65 (Phase 0a schema gate) |
| **Q-005** | P1 | web | Zero client-side Sentry init | ✅ PR #66 (@sentry/nextjs wired) |
| **Q-007** | P1 | web | `/api/waitlist` no rate-limit | ✅ PR #66 (5 signups/h/IP) |
| **B-014** | (internal) | mcp | heartbeat phantom entry in asset cache | ✅ PR #67 |

14 of 15 closed; only **B-013** stays open — intentional (SDK `private:true`, not published; see note below). B-005/B-006/B-007 (API polish) + B-011 (mcp resource URL) closed in the 2026-05-31 close-deferred sweep (api-rs adopted at 80a37f0, then dead-letter parity + `#lifecycle` anchor + per-tool resource follow-ups).

### Post-QA sweep 2026-05-30 (B-017..B-028 + MCP-DEVNET)

From the 2026-05-29 comprehensive senior QA + the 2026-05-30 fix sweep. **DEPLOYED + verified in prod 2026-05-30** (web via Vercel, backend via `deploy.sh`; `main` HEAD `6b3bbd8`). Full report: [`docs/operations/post-qa-execution-2026-05-29.md`](docs/operations/post-qa-execution-2026-05-29.md) · validation: [`validation-2026-05-30.md`](docs/operations/validation-2026-05-30.md).

| ID | Sev | Surface | Status |
|---|---|---|---|
| **MCP-DEVNET** | 🔴 P0 | mcp | prod `mcp-ts` was on **devnet** (intended dogfood per C4, but the "7 mainnet settlements" claim was overstated). Root cause = `SOLANA_NETWORK` only — facilitator was already CDP (`x402.ts:45`; `CDP_WALLET_ID` irrelevant). **FIXED + verified 2026-05-30:** flipped `.env` → mainnet (owner-confirmed hardware-wallet receiver → completes the C4 rotation). Claim corrected to **3 mainnet settlements** ([ADR-0018](docs/adr/0018-mcp-x402-devnet-mainnet-retraction.md)). **Post-deploy mainnet settlement CONFIRMED 2026-05-31** — fresh `ping_paid` settled SUCCESS, tx `4z6fHL…`, +0.001 USDC → receiver (RPC-verified, [Solscan](https://solscan.io/tx/4z6fHLxTnkeXq4xaE25XcSgfk3DYkNVE81Vvi8JqY6Ny8G35WCrBp5CYkwd6cLWSzCwKi6nCNcK7UgBNcTPiaTyv)). |
| **B-017** | P1 | web | onboarding hardcoded "23 assets" → bound to live `/v1/stats`. ✅ |
| **uptime** | P1 | web | fabricated 99.97% "Uptime 30d" removed (no real source) → live PEGGED count. ✅ |
| **B-025** | P1 | api+mcp | docs/specs/agents already UPPERCASE; bot headlines flipped to UPPERCASE (serde untouched). ✅ |
| **B-027** | P1 | web | `/docs` RSC prefetch 404 → `prefetch={false}` on all docs Links. ✅ |
| **B-018/019/021** | P1 | api | `/v1/alerts?limit` out-of-range → 400. ✅ |
| **B-020** | P1 | api | `/v1/assets/{s}/history?bucket=invalid` → 400 (scope-corrected from /v1/alerts). ✅ |
| **B-022** | P2 | api | `/v1/assets` p50 ~1.2s → Redis 5s memo on list handler (stock caddy:2 has no cache plugin). ✅ |
| **B-023** | P3 | web | `/assets/USDC` 404 → redirect to `/asset/USDC`. ✅ |
| **B-024** | P3 | web | `/live` 404 → redirect to `/#live`. ✅ |
| **B-028** | P3 | sdk | phantom `OnchainCommitment.cluster` removed from TS SDK. ✅ |
| **B-026** | P2 | api | no `id`/`alert_id` rename bug (structural flat-vs-nested only) — flag-only, no change. |

All **DEPLOYED + prod-verified 2026-05-30** · 1 flag-only (B-026, not a bug) · B-025 core already-aligned + bot flipped. Validation (12 skeptical agents + Playwright) caught 3 residual defects before deploy. **B-005 closed 2026-05-31** (the `not_committed_yet` vs `not_applicable` semantics — enum per ADR-0004 + spec `07-api-surface.md:159` — plus dead-letter parity so `/onchain` agrees with `/detail`'s 202/410 meaning; see matrix above).

---

## Security audit findings (audit-2026-05-26)

Composite repository risk: **6 — MEDIUM** initially, residual after fixes **4 — LOW-MEDIUM**.

Full resolution mapping: [`docs/security/audit-2026-05-26-resolution.md`](docs/security/audit-2026-05-26-resolution.md).

| ID | Sev | Status | Fix commit / decision |
|---|---|---|---|
| F-001 | HIGH | ✅ FIXED | `0dd0160` (PR #25) — `bun.lock` committed + Dockerfile COPY |
| F-002 | HIGH | ✅ FIXED | `0ab67c6` (PR #25) — X-Forwarded-For propagation |
| F-003 | MED | ✅ FIXED | `b05b482` (PR #25) — CORS whitelist + extras env |
| F-004 | MED | ✅ FIXED | `4949f38` (PR #25) — Redis AUTH (`REDIS_PASSWORD` required) |
| F-005 | MED | ✅ FIXED | `4fe2ff5` (PR #25) — constant-time compare |
| F-006 | MED | ✅ FIXED | `4fe2ff5` (PR #25) — BOT_INTERNAL_SECRET min 32 |
| F-007 | MED | ✅ FIXED | `4bd96a3` (PR #25) — JWT secret length validated at boot |
| F-008 | LOW | ✅ FIXED | `4bd96a3` (PR #25) — verify_slice |
| F-009 | LOW | ✅ FIXED | `f0678f8` (PR #25) — WS origin + per-IP cap |
| F-010 | LOW | ✅ FIXED | `009a2e3` (PR #25) — unused config removed |
| F-011 | LOW | ✅ FIXED | `ee3bdd8` (PR #25) — CSP on Caddy API vhost |
| F-015 | INFO | ✅ FIXED | `cb9dd03` (PR #25) — CI runs `cargo audit` + `bun audit` |
| F-012 | LOW | 🟡 deferred | Dockerfile sha256 pin — same as AC72 |
| F-013 | LOW | 🟢 accepted | JWT-in-localStorage — design choice (see `web/lib/auth/context.tsx:5-13`) |
| F-014 | INFO | 🟢 accepted | Metrics bind 0.0.0.0 inside containers — standard pattern, ports not published |

---

## Trigger-based items (do NOT build without demand)

| Item | Effort | Trigger condition |
|---|---|---|
| Discord adapter | 2 days | launch+1wk OR user ask |
| Webhook channel v2 | 3 days | first protocol integration ask |
| Telegram Mini App | 5 days | 60%+ mobile traffic OR partner ask |
| USD+ (Streamflow) | 0.5 day once available | Streamflow mainnet launch with public mint OR Pyth feed (per [`docs/operations/usd-plus-pending.md`](docs/operations/usd-plus-pending.md)) |

---

## Anti-roadmap (do NOT build)

- Premium tier before ≥1 design partner signed
- On-chain Anchor feed (2-3 weeks, no demand)
- Switchboard publisher node (no demand)
- Multi-chain expansion (Solana is the moat)
- Wallet connect in v1.x (Telegram is the identity)
- More design uplift (fidelity already at 97.3% per `docs/design-research/audit-2026-05-24-shipped/ALL-PAGES-FIDELITY-AUDIT.md`)
- Any sub-project before 7d post-launch stable
- Outreach reactivation before kill-rule decision (per 2026-05-29 user pivot — accept R12 risk)

---

## Deferred ACs (per AMENDMENTS)

| AC | Item | Status |
|---|---|---|
| AC60-63 | SDK npm/PyPI publish | intentional `private: true` until ≥1 design partner |
| AC67 | devnet integration test on-chain commit | post-launch queue item 14 |
| AC70 | reproducible-build CI trigger | post-launch queue item 14 |
| AC72 | Dockerfile sha256 pinning (6 files) | post-launch queue item 14 |
| AC42 | server-side `/audit` state filter | **✅ CLOSED 2026-05-29** (PR #59 `1e99ee7`) |
| AC78 | webhook-dogfood-2026-06-03 standalone report | **dropped as gate 2026-05-29** — replaced by Grafana check in launch-runbook ([decision memo](docs/operations/ac78-webhook-dogfood-decision.md)) |

### Deferred assets (per ADR-0002)

6 assets in `assets.toml` with `active=false`:

- **BRZ** (Brazilian Real stable) — thin liquidity, kept inactive
- **JupUSD** (launched Jan 2026, fiat-backed) — calibrating, expected `active=true` at 06-11
- **EURC** (Circle EUR — Solana presence growing) — calibrating
- **dzSOL** (Drift LST — Drift exploited 2026-04-01) — inactive pending Drift recovery
- **vSOL** (Sanctum LST) — calibrating
- **JLP** (Jupiter Perpetuals LP — added 2026-05-29 Phase 0b) — calibrates 12 days; flips at 06-11 verdict

Re-evaluated per ADR-0002 at launch verdict (06-10) — per-asset decision.

### Post-launch asset batch (research-only)

Six additional candidates with confirmed Pyth feeds + >$1M Solana
circulating ($2.35B combined). See
[`docs/operations/post-launch-asset-batch.md`](docs/operations/post-launch-asset-batch.md).
Order: H1-H5 numéraire confidence gate first, THEN Phase 0c additions.

---

## Source of truth — where to look for what

| Question | File |
|---|---|
| What does the system do? | `docs/pegana-trust-layer-v0.1.0/00-README.md` |
| Business rules + invariants | `docs/pegana-trust-layer-v0.1.0/01-business-rules.md` |
| Architecture | `docs/pegana-trust-layer-v0.1.0/02-architecture.md` |
| Asset coverage | `docs/pegana-trust-layer-v0.1.0/03-asset-coverage.md` |
| ADRs (decisions that win over spec) | `docs/adr/0001..0043-*.md` + `docs/pegana-trust-layer-v0.1.0/AMENDMENTS.md` |
| Calibration v1 verdict rule | `docs/adr/0015-calibration-v1-per-class-verdict.md` (supersedes ADR-0001) |
| Pre-evidence threshold exercise rule | `docs/adr/0017-pre-evidence-threshold-exercise.md` |
| Launch runbook | `docs/operations/launch-runbook-2026-06-11.md` |
| 06-01 dogfood deploy | `docs/operations/deploy-2026-06-01.md` |
| 06-11 public deploy | `docs/operations/deploy-2026-06-11.md` |
| Reproducible builds | `docs/operations/reproducible-builds.md` |
| QA pre-launch workflow | `docs/operations/qa-pre-launch-workflow.md` (phases 0a + backend sweep) |
| Issue #101 exercise log | `docs/operations/issue-101-exercise-log.md` (Run 1 + Run 2 prod evidence) |
| Sprint runbook | `docs/operations/sprint-2026-05-29-final-execution-runbook.md` |
| Security audit resolution | `docs/security/audit-2026-05-26-resolution.md` |
| AC78 drop decision | `docs/operations/ac78-webhook-dogfood-decision.md` |
| USD+ pending external | `docs/operations/usd-plus-pending.md` |
| Post-launch asset batch | `docs/operations/post-launch-asset-batch.md` |
| Outreach drafts | `docs/outreach/{parity-colosseum,stableguard,sendai-solana-new,defillama-risk-oracle}.md` |
| Outreach activity log | `docs/outreach/log.md` (2 entries logged as of 2026-05-29) |
| Launch scorecard template | `docs/launch/launch-scorecard-2026-07-15.md` |
| Demo script | `docs/launch/demo-script-2026-06-11.md` |
| Twitter copy + thread | `docs/launch/twitter-copy-launch.md`, `twitter-thread-{en,pt}.md` |
| HN Show post | `docs/launch/hn-show-post.md` |
| Mintlify deploy runbook | `docs-site/DEPLOY.md` |
| Sub-project follow-ups | `project_trust_layer_followups.md` (claude memory) |
| Audit quality sprint history | `project_audit_quality_sprint_2026_05_29.md` (claude memory) |

---

## Component LoC (rough, 2026-05-29)

| Component | LoC (incl. tests) | Notes |
|---|---|---|
| `crates/methodology` | ~1,000 | Open-source crate; engine refuses mismatched version |
| `crates/engine-rs` | ~3,000 | State machine + on-chain commit + state snapshot |
| `crates/api-rs` | ~2,500 | 21 routes + auth + rate-limit + OpenAPI |
| `crates/dispatcher-rs` | ~2,200 | Webhook + TG + retraction worker |
| `crates/indexer-rs` | ~1,800 | 6 sources (Sanctum + Pyth + Jupiter + Hylo + DexScreener + Piggybank) |
| `crates/pegana-replay-cli` | ~400 | Offline verifier |
| `crates/common` + `common-verify` | ~600 | shared schema + cross-arch hash helpers |
| `bot-ts` | ~2,500 | grammY + Fluent + Postgres sessions; 63 tests |
| `mcp-ts` | ~1,500 | MCP server + x402 paid tools + telemetry; 33 tests |
| `web` (Next 16.2.11) | ~15,000 | Marketing + dashboard + audit + methodology + embed + Sentry-wrapped |
| `sdk/typescript` + `sdk/python` | ~600 | Hand-rolled, `private: true`, getAudit/verifyAlert shape fixed |
| `tools/pegana-replay-public` | ~400 | Public repo carve-out for cargo-dist releases |
| `docs-site/` | ~80 files | Mintlify content + DEPLOY.md runbook |
| `migrations` | 69 SQL files | All additive; manual apply (no `_sqlx_migrations` table). Numbered 0001–0070; **0021 is intentionally skipped** (number reserved then dropped), so 69 files for 70 numbers. |
| `docs/` | ~80 files | Spec, ADRs (43), operations, outreach, security |

**Total**: ~33K LoC + ~160 docs, all production.

---

## How to use this roadmap

1. **Daily**: Calibration window passive. Watch Grafana `pegana-overview`, check `~/.calibration-watch.log`, ignore wallet CRITICAL noise (throttled per PR #45).
2. **Pre-launch (T-13 to T-0)**: Active blockers list above. Verdict computation 06-10. Launch runbook 06-11.
3. **Stability lock (06-11 → 06-25)**: No methodology bumps except critical bug — plus the founder-overridden 0.4.0 honesty cluster (ADR-0025), committed-but-not-deployed. Stability for integrators.
4. **Post-launch hardening (06-18+)**: H1-H12 batch first, then Sub-project B.
5. **Anything not on this roadmap**: Cross-check against anti-roadmap section. If it conflicts with Hard NOs in `01-business-rules.md`, it stays out.

This file is intentionally short. Detail lives in `docs/`. If something
in this roadmap is unclear, the linked specs have the answer.
