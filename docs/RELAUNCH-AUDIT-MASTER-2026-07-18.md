# 🎯 RELAUNCH · MASTER AUDIT & DELIVERABLES TRACKER — 2026-07-18

> The anchor doc so we **don't lose track**. Records exactly what Rafael asked for,
> the plan, and a live progress ledger. Updated as each piece completes.

## What Rafael asked for (verbatim intent)

1. **Merge runbook** — exact, COMPLETE, absolute certainty. The ordered activation
   to take the hardened branch to prod.
2. **Marketing CHANGELOG (to post) + a COMPLETE "what's new" page** — website & app
   rebuilt, feature launches, system improvements, as a whole. Marketing tone (not
   literal every-commit).
3. **The heaviest audit yet.** Validate EVERYTHING ever built (not just this window):
   every formula, oracle, the whole structure — complete, connected, secure.
   - Deep-research backend + frontend, using **context7** + skills fully.
   - Is the backend complete, validated, tested? Is Pegana **100% secure**? If not,
     what must we do?
   - Analyze **each persona from scratch**, each feature, **1:1**, grill complete.
   - "Is everything connected? Is everything we idealized ready?"
   - Run **multiple workflows**, **ultracode**. 100% analyzed + audited.
   - Create a plan & run a **complete LOOP**, skip no step.

## Standing constraints (do not violate)

- ⛔ NEVER push origin/main (= prod deploy). Local main diverged — merge via PR only.
- Commit per-path (never `git add -A`). Cred-guard blocks .env/key dumps.
- On-chain is ALREADY live on prod (verified 2026-07-18) — do not "re-enable".
- Prod runs methodology **0.5.0** (per the 07-05 mainnet anchor memo); branch = 0.7.0.
- Rafael: build-to-demand; when he says build, BUILD. In grill = DECIDE + report,
  don't interview. Cost-conscious (Sonnet finders, Opus synthesis) but ultracode ⇒
  exhaustiveness first.

## Plan (phased LOOP)

- **P0 · Merge runbook** (deterministic, validated 1:1) → `docs/MERGE-RUNBOOK-v0.7.0.md`
- **P1 · Deep technical audit** (Workflow, ultracode) — formulas/methodology · oracles &
  RPCs · backend services · frontend · **security (100% secure?)**. Adversarial verify
  each finding. context7 for external-API correctness (Pyth/Solana/rust_decimal/Next).
- **P2 · Personas-from-scratch + product coherence** (Workflow) — 4 personas walked
  1:1 · "is everything idealized connected + ready?" · feature-completeness matrix.
- **P3 · Synthesis** → `docs/AUDIT-COMPLETE-2026-07-18.md` (the definitive verdict:
  complete? validated? tested? 100% secure? + the ranked remainder).
- **P4 · Fix loop** — execute the branch-fixable findings P1/P2 surface, 1:1-gated
  (same discipline as Batches A–D). Re-audit until convergent.
- **P5 · Marketing CHANGELOG + "What's New" page** (Artifact, artifact-design skill) —
  reflects only VALIDATED reality.

## Progress ledger

| Phase | Status | Artifact |
|---|---|---|
| P0 Merge runbook | ✅ done | docs/MERGE-RUNBOOK-v0.7.0.md |
| P1 Technical audit | ✅ done (12 findings) | task wnppbaeny |
| P2 Personas + coherence | ✅ done (29 gaps: 3 P0/12 P1/9 P2/5 P3) | task w199xdlow |
| P3 Synthesis verdict | ✅ done | docs/AUDIT-COMPLETE-2026-07-18.md |
| P4 Fix loop | 🟩 ~33/41 done (all P0/security/trust + web) | many commits |
| P4′ Review-of-own-fixes | 🟩 5/8 done (doc/honesty) · 1 deferred+tracked · 3 code deferred | commits 3230d69, 45e0974 |
| P5 Marketing changelog + page | 🟩 changelog REMOVED · /whats-new full rebuild in progress | web + docs/CHANGELOG-RELAUNCH |

## P4′ — adversarial review of MY OWN relaunch fixes (2026-07-18)

Ran an adversarial pass over the fixes I shipped this cycle. 8 findings (5 HIGH).
Triage + disposition (all 1:1-verified against the real code, never the reviewer's claim):

**Fixed now (doc/honesty — commit 45e0974):**
- **#3** rederive.rs had a stale self-contradicting "Step 6" comment block → removed.
- **#7** `webhooks.mdx` documented `evidence_status` as `ready|pending` only; the
  dispatcher emits **4** values (`+ failed_permanent | unknown`, dispatcher main.rs:819) → completed.
- **#8** `faq.mdx` listed intrinsic-liveness among *live* hardening; the gate ships
  **opt-in, off by default** (ADR-0037/0038) → qualified.
- **#1 (claim half)** ADR-0039 + the rederive comment both asserted "the engine,
  rederive AND the xtask runner all **call** `override_final_state`, so they agree by
  construction." **False for the engine** — `try_recompute` MIRRORS the identical
  predicates inline (layering `force_unknown`/metrics/`state_reason`). Behaviorally
  identical today; corrected the docs to say *mirrors, not calls*.

**#1 (code half) — ✅ DONE (`7ec226d2`).** Unified the engine's hand-rolled override
chain to derive its state from the shared methodology fn. Added
`override_final_state_attributed -> (PegState, Option<OverrideReason>)` (single source
of truth for state AND attribution); `override_final_state` is now a thin wrapper
(rederive + runner unchanged); the engine calls the attributed variant and keys its
side-effects off the returned reason — no longer re-deriving the gate order. "Three
implementations agree by construction" is now structurally enforced. **Golden BYTE-EXACT
(no drift)** + methodology 128 (+4 new tests) + engine + clippy 0. ADR-0039 updated.

**Still deferred (branch-fixable, none trust-critical):**
- **#2** byte-exactness of the `g.last_state` split (analyze).
- **#4 / #5 / #6** — bot idempotency double-send · XAUTOCLAIM double-process · watchlist
  `?watch=` race.

## UI batch + page audit (2026-07-18, founder asks)

- **/whats-new** rebuilt in Pegana's V5 design system (`36f567da`+`1c44b03f`) + a 4-claim
  honesty pass; live-verified on preview. **Navbar** wordmark reveal now fires on
  nav-pill enter, not logo-hover; **temporary /whats-new popup** on the landing,
  self-cleaning (auto-retires 2026-08-15) — `bdc774f7`.
- **Page audit:** ALL `(marketing)` pages are V5-current; `/live` + `/assets/[symbol]`
  are graceful redirects. The "old versions" = the `(app)` product/console surfaces on
  the pre-V5 shell — `/dashboard`, `/assets`, `/asset/[symbol]`, `/compare`, `/account/*`
  (only `/events` is V5). This is the W3 app-reimagination migration (never done).
  **Awaiting founder direction** on revitalization scope/priority.

## Complete agentic loop — "faça tudo completo, menos merge" (2026-07-18)

Pre-flight baseline (rust+web green, golden byte-exact) → executed the 2 remaining
audit-review findings (#4 bot idempotency, #2 g.last_state byte-exactness) → ran a
**read-only adversarial sweep workflow** (6 subsystem dimensions × find→verify,
Sonnet; context7 for grammy error taxonomy) → surfaced **11 findings** → fixed 10,
documented 1 as designed-as-intended → **full validation gate GREEN** (rust fmt +
workspace tests + clippy + golden byte-exact + promtool 29; web tsc + eslint +
prettier + 788 vitest; bot typecheck + 77 tests + lint). NOTHING merged/deployed.

**Fixed (each 1:1-validated + committed):**
- **#4** bot: release the idempotency claim only on a definite non-delivery
  (`GrammyError`), keep it on ambiguous `HttpError` — kills the timeout double-send.
  Pure tested helper + **ADR-0040**. (`49b20f8e`)
- **#2** engine: g.last_state freeze is byte-exact by construction; documented the
  load-bearing serial-recompute invariant. (`f2ade1a0`)
- **#6** methodology: premium-sanity ALSO yields to a confirmed BLACK_SWAN — the LAST
  gate left unconditional reopened the ADR-0039 class (garbage-LOW NAV → apparent
  premium re-masks a committed collapse). All four gates now yield. Golden byte-exact.
  **ADR-0039 Amendment 2**. (`35d86afa`)
- **#8** dispatcher: webhook canonical payload emits `BLACK_SWAN` not `BLACKSWAN`
  (raw PegState serde `UPPERCASE`); routed through `format::label`, NOT touching the
  receipt-hash serde. (`7c1c70e9`)
- **#10** dispatcher: don't drop a re-pegged recovery after a >2h sustained drift
  (flap-key `None` → was suppressed). (`3c5ffa33`)
- **#1/#2/#3** web: peer-comparison WS freshness gate · PNG re-download on selection
  change · onboarding step reset on reopen. (`735c6058`)
- **#5** bot: never seed `users.chat_id` with a group id on first insert — a privacy
  leak routing personal alerts+digest to a group. DB-layer backstop. (`a1a6c049`)
- **#4-sched** bot: gate digest+janitor timers on the polling leader lock (duplicate
  digest under scale-out). (`4647b261`)
- **#7** api: free the WS per-IP slot on a FAILED upgrade, not just on close (per-IP
  DoS foothold); split RAII into gauge + slot guards. (`ef3d87c1`)
- **#11** dispatcher: periodic PEL reclaim, not just at startup (transient mid-process
  error stranded an alert until restart). (`a7d125a3`)

**Not fixed (deliberate):** **#9** webhook fan-out bypasses the per-severity dedup +
flap dampener — treated as designed-as-intended (a webhook is a machine firehose that
consumers dedupe themselves; the damping is a human-UX affordance for Telegram).
Changing it is a product decision, not a defect.

### Loop round 2 — fresh angles (db/contracts/auth/numeric/mcp), 2026-07-18

Second adversarial sweep (5 fresh dimensions × find→verify, no spend-limit this round,
0 agent errors) → **9 confirmed findings, ALL 9 FIXED**. Full gate GREEN again.

- **#R2-1 (P1 security)** open-redirect via backslash in the magic-link `next` sanitizer
  (`/\evil.com` bypassed the `//` check → `https://evil.com`); prefix + same-origin URL
  resolution. (`fd3f4eaf`)
- **#R2-3 (P1)** bot `getAsset`/`unsubscribe` case-sensitive → `/subscribe jitosol` false
  "unknown asset"; `lower(symbol)=lower($1)` (mig 0045 index). (`bec64894`)
- **#R2-6 (P1)** webhook Ed25519 timestamp+sig frozen before the retry loop → retries
  past 300s DOA vs spec receivers; moved inside the loop (fresh per attempt). (`c91b54f4`)
- **#R2-7 (P1)** AlertEvent deserialize failure silently dropped + poison-looped through
  XAUTOCLAIM; now `error!` + `pegana_dispatcher_alert_parse_failed_total`. (`c91b54f4`)
- **#R2-4 (P2)** `/v1/me/subs` unknown asset → 500 not 404; resolve + `unknown_asset`. (`fe9f3e9d`)
- **#R2-5 (P2)** ADR-0021 direction-sensitivity missing at 3 `bandProximity` sites (worst-sort,
  screener, dashboard) → benign LST premium ranked "closer to depeg". (`aa8cf8c1`)
- **#R2-8/#R2-9 (P2)** TS+Python SDK `verify` collapsed a pending receipt into `ok:false`
  (indistinguishable from tampered); added a `status` field, gated `ok` on `ready`. (`69988f76`)
- **#R2-2 (P3)** rate limiter was fixed-window despite the "sliding" doc (~2× boundary burst);
  implemented a real sliding-window counter + 2 tests. (`14c84e0e`)

**Two rounds → 20 findings, 19 fixed + 1 designed-as-intended.** The branch-fixable set is
finite and shrinking; a round 3 (freshest angles: async/concurrency, panic-paths, config,
N+1, test-quality) tests for convergence.

### Loop round 3 — convergence test (concurrency/panic/config/N+1/test-quality), 2026-07-18

Third sweep (5 fresh dimensions × find→verify, 0 agent errors) → **9 confirmed findings —
the severity has DROPPED to mostly perf + test-hygiene, the convergence signal.** Fixed the
correctness/availability/security ones NOW; scoped the perf + hot-path-refactor ones as a
small, documented backlog (rushing a delivery-critical parallelization at session-end would
risk a worse regression than the bug).

**Fixed + committed (gate green):**
- **#R3-3 (P1 ops)** dispatcher crash-looped the WHOLE alert pipeline (Telegram included) when
  `PEGANA_WEBHOOK_SIGNING_KEY` was unset — contradicting docker-compose's own "safe to leave
  empty" contract. Key is now optional (`from_env_optional`); Telegram + unsigned webhooks
  run without it, a signed webhook with no key skips gracefully. (`637b317b`)
- **#R3-2 (P2)** `/api/waitlist` `request.json()` unguarded → 500 on a malformed body; try/catch
  → structured 400. (`c2c1b537`)
- **#R3-6/#R3-7 (P2 trust)** two integration tests' comments claimed engine↔dispatcher / worker
  DRIFT protection they can't provide (they validate hand-copied literals) → corrected to say
  "fixture, not a drift guard" + noted the real fix. (`fe777f5d`)

**Scoped backlog (real, non-critical, deferred to focused passes — NOT rushed):**
- **#R3-1 (P1)** the process() Telegram fan-out is serial with real retry backoffs, so a degraded
  bot + many subscribers stalls the single stream consumer for ALL assets. Fix = parallelize
  per-target sends under a semaphore, mirroring `fan_out_bot_retraction` (keep the dedup gate
  serial). Delivery-critical hot path → deserves its own pass + load test. **Top follow-up.**
- **#R3-5** the sole per-attempt webhook-signature-rotation test self-skips forever
  (`PEGANA_RUN_SLOW_TESTS` never set, real 5s/30s backoffs) → needs injectable retry delays
  (pairs with #R3-1's hot-path work); this is the test that would cover the #R2-6 fix.
- **#R3-6/#R3-7 (deeper)** make the drift tests GENUINELY drift-proof (shared `pub(crate)` query
  helper; a shared `ReconciledEvent` type in `pegana-common`).
- **#R3-4 (P2 perf)** `/v1/peg/feed` bypasses the Redis cache `/v1/assets` uses (re-runs the
  LATERAL join per request); **#R3-8 (P3)** embed badge serializes 2 independent fetches;
  **#R3-9 (P3)** digest runs SELECT+UPDATE per recipient in a sequential loop.

**CONVERGENCE: after 3 thorough rounds → 29 findings, 23 fixed + 1 designed + 5 scoped backlog.**
The P0/P1 correctness·security·availability set is addressed; round 3 returned only perf +
test-hardening + one hot-path parallelization — diminishing returns. Full gate GREEN. An
honest stopping point; the scoped backlog above is small, non-critical, and named so it can't
get lost. NOTHING merged/deployed.

### Scoped backlog EXECUTED — 2026-07-19

The round-3 scoped backlog was NOT left as a TODO — all 7 items were executed as focused
per-item passes, each validated 1:1 (per-crate build+test+clippy, golden byte-exact, and the
web/bot gates where touched) and committed on `landing/v2-port`:

- **#R3-1 (P1)** dispatcher `process()` Telegram fan-out split into Phase 1 (serial dedup gate →
  `deliver` Vec) + Phase 2 (parallel `tokio::spawn` under the shared `webhook_sem`, await all).
  `send_with_retry` re-typed to `(bot_internal_url, bot_internal_secret)` so it's `Send`-spawnable.
  A degraded bot no longer stalls the single stream consumer for every asset. (`9242f916`)
- **#R3-5** `DispatchConfig.retry_backoffs_secs` is now injectable → the per-attempt
  signature-rotation test is un-gated (`vec![1,1]`, ~2s) and additionally asserts
  `x-pegana-timestamp` + `x-pegana-signature` rotate per attempt — this is the test that now
  covers the #R2-6 fresh-per-attempt fix. (`df793f98`)
- **#R3-4 (P2 perf)** `/v1/peg/feed` reuses `ASSETS_LIST_CACHE_KEY` (5s TTL) instead of re-running
  the LATERAL join per request; `AssetCard`/`OracleDegraded` gained `Clone,Serialize,Deserialize`.
  (`75d43832`)
- **#R3-8 (P3 perf)** embed badge route fetches asset + 24h history via `Promise.all`. (`9bded2a8`)
- **#R3-9 (P3 perf)** daily digest sends under `DIGEST_CONCURRENCY = 8` chunked `Promise.all`
  instead of one-recipient-at-a-time. (`91334a6c`)
- **#R3-6/#R3-7 (trust, deeper)** introduced `pegana_common::EvidenceReconciledEvent` — the engine
  now SERIALIZES it and the dispatcher + integration test DESERIALIZE the SAME contract type, so a
  field/name change fails compilation on all three (genuinely drift-proof, not a hand-copied
  literal). The gated SQL-mirror fixtures are honestly labelled "fixture, not a drift guard".
  (`b46a3e40`, comment corrections `fe777f5d`)

**Backlog burndown = 0 remaining.** Full gate re-run GREEN end-to-end: rust fmt clean +
`cargo test --workspace` pass + clippy 0 + golden `no drift ✓`; web tsc 0 + 788 vitest;
bot typecheck + tests + lint clean. Pushed to `landing/v2-port` (`be07a58f..b46a3e40`).
Still NOTHING merged/deployed.

### Loop round 4 — NOT convergence: 12 fixes incl. 4 P0s + a self-found launch-blocker, 2026-07-19

Ran a 4th adversarial sweep (6 surfaces × find→adversarial-verify, 19 agents, 0 errors) to
CONFIRM convergence. It did the opposite — **11 CONFIRMED findings (2 correctly REFUTED)**, and
the sweep's own `confirmed:[]` return was a post-processing bug in the workflow script (a stage
returned the raw `parallel()` array, not `{verified}`, so the filter read `undefined`). Reading
the journal 1:1 (per the never-trust-an-agent rule) surfaced the real harvest — and while
analysing one of its findings I found a **12th, higher-severity P0 the finders missed**. All 12
fixed, each validated 1:1 (per-crate build+test+clippy, golden byte-exact, web/bot gates) and
committed:

**P0s:**
- **#R4-10 (self-found, launch-blocker)** the bot `/send` idempotency key was `alert:{event.id}`
  — the alert UUID with NO chat_id — and the bot dedups on it (first-write-wins). At public
  launch every alert would reach exactly ONE of its N subscribers (the rest short-circuit as
  `duplicate`). Latent under single-chat dogfood. Retraction + evidence-ready fan-outs had the
  same defect. Suffixed all three keys with `chat_id` + a regression test. (`2d3f4a20`, `522c8710`)
- **#R4-7** R3-1 ran the parallel Telegram sends under the SHARED `webhook_sem`; one user's 50
  failing webhooks (each holding a permit through the ~2h35m retry ladder) could starve Telegram
  delivery for EVERY asset. Gave Telegram its own `telegram_sem`. (`d9440cae`)
- **#R4-2** the `pyth_spot` fan-out had NO price floor (unlike jupiter/dexscreener); a corrupt
  near-zero print could poison the EWMA and drive a false CRITICAL on USDC/USDT (not
  direction-sensitive → the engine's discount-sanity gate doesn't cover them). Added
  `is_plausible_spot_price`. (`2fb81e0e`)
- **#R4-4** `/web` + `menu:web` posted a single-use magic-link auto-login credential into
  whatever chat they ran in — in a group, anyone can tap it → unauthenticated account takeover.
  Added a strict `rejectIfGroup` (the existing `rejectGroupIfNoDm` only rejects users who've
  never DMed, so a known user still leaked). (`9fb6237f`)

**P1:**
- **#R4-8** R3-1's serial-Phase-1-dedup / parallel-Phase-2-send split widened a mid-fan-out crash
  from "lose the in-flight target" to "silently drop the ENTIRE cohort" (all dedup keys committed,
  nothing sent, PEL reclaim then SETNX-fails all). Moved the dedup gate INTO each task (per-task
  redis clone, fail-open on Redis error). (`d9440cae`)

**P2s:** #R4-0 PATCH/DELETE `/v1/me/subs` case-insensitive (`30109ea1`) · #R4-3 sanctum $0-lamports
guard (`2fb81e0e`) · #R4-5 bot one-active-sub-per-asset, stops the `/threshold` crash (`95a77970`)
· #R4-6 `/list`+`menu:subs` refused in groups (`9fb6237f`) · #R4-9 token-logo proxy no longer
auto-follows redirects — SSRF (`71581313`) · #R4-11 onboarding `localStorage` read guarded against
a throwing getter, was blanking the whole dashboard (`130df66d`) · #R4-1 audit-CSV mid-stream
truncation now emits `pegana_audit_csv_truncated_total` + Sentry instead of silently short
exports (`2b3ad74f`).

**REFUTED (verified non-reachable today, documented not coded):** engine discount-sanity can mask
a sustained CRITICAL as UNKNOWN only for a hypothetical future asset whose own `black_swan` band
exceeds `NAV_DISCOUNT_SANITY_BPS` — every configured asset is ≤3000bps and ADR-0039 already
documents the residual; `compute_discount`'s zero-intrinsic ordering is structurally prevented
upstream by `fresh_numeraire`'s zero-guard + atomic value_usd/value_sol publish.

**LESSON — two big ones.** (1) R3-1 (a round-3 "perf" backlog item I shipped) introduced a P0 + a
P1; a perf refactor on a delivery-critical hot path needed exactly the adversarial round that
caught it. (2) The single worst bug (#R4-10) was found by ME reading code 1:1, NOT by the finder
agents — and the workflow's own summary said "0 confirmed". Trusting the agent's return value
would have shipped a launch-blocker. **Full gate GREEN** (rust fmt+clippy0+43 suites+golden
byte-exact · web tsc0+789 vitest+eslint+prettier · bot tc+77+lint). Pushed
(`b46a3e40..2b3ad74f`). NOTHING merged/deployed.

### Loop rounds 5–7 — regression-hunting the fixes until convergence, 2026-07-19

Because round 4 proved the loop's value (R3-1 shipped a P0+P1), each subsequent round was aimed
squarely at **regression-verifying the PRIOR round's own fixes** on the diff, plus a fresh
convergence pass. This caught a regression from the prior round's fix EVERY round — exactly the
point — while count + severity fell monotonically:

**Round 5 (5 confirmed, 1 refuted):**
- **#R5-B (P1, regression of #R4-5)** `updateThreshold`'s new `DELETE` of the colliding row
  cascaded into `alert_deliveries` (the FK still has `ON DELETE CASCADE`; migration 0006 dropped
  the NOT NULL, not the cascade) → destroyed delivery history, silently breaking retraction
  fan-out. Redesigned to only flip `is_active` (reuse the target-threshold row, never delete).
  (`3ca860e2`)
- **#R5-A (P2 SSRF)** token-logo `isPrivateOrInvalidHost` missed IPv4-mapped IPv6
  (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`); added `::`-leading + `::ffff:` patterns + 5 tests.
  (`437a769c`)
- **#R5-C (P2)** `#R4-7` only isolated `process()`'s Telegram fan-out; retraction + evidence still
  shared `webhook_sem` → threaded `telegram_sem` into both. (`73977f07`)
- **#R5-D (P2)** `#R4-3`'s sanctum $0 guard had no metric → added
  `pegana_sanctum_zero_lamports_total{lst}`. (`e7abfdbe`)
- REFUTED: the in-task fail-open dedup gate during a Redis error — a deliberate, logged
  deliver-don't-drop trade-off (ADR-0040 philosophy).

**Round 6 (2 confirmed + 1 accepted):**
- **#R6 (P1, regression of #R5-B)** the `updateThreshold` REUSE branch reactivated a dormant row
  by flipping only `is_active`, resurrecting its stale `muted_until` (up to 7d) → silent alert
  suppression. Carry the keeper's current `muted_until` + `min_confidence` onto the reused row.
  (`dd1215fb`)
- **#R6 (P3 SSRF residual)** token-logo still missed NAT64 (`64:ff9b::/96`) + 6to4 (`2002::/16`)
  transition prefixes → added patterns + tests. (`bd812ad0`)
- **ACCEPTED (P3, not fixed):** `telegram_sem` is now shared across process()+retraction+evidence;
  a degraded-bot retraction burst can delay a live alert ~1–2 min (FIFO-fair, sequential acquire).
  Splitting pools risks exceeding Telegram's ~30 msg/s global limit — a bounded, rare degradation
  is the right trade-off. Documented, not coded.

**Round 7 (1 confirmed, then CONVERGED):**
- **#R7 (P1, incomplete #R6 fix)** the stale-mute resurrection was still reachable via the far
  more common `/subscribe` (and api `create_sub`): `INSERT … ON CONFLICT DO UPDATE SET
  is_active = TRUE` reactivates a dormant muted row. Set `muted_until = NULL` on (re)subscribe in
  BOTH the bot and api. Then **1:1-verified the whole class is closed** across all four
  alert-subscription reactivation paths (subscribe / updateThreshold-reuse / updateThreshold-move
  / api create_sub); `webhook_subscriptions` has no mute column. (`b3bdeb0b`)
- The other two round-7 surfaces (NAT64 regex over-breadth + a fresh whole-repo pass) returned
  **empty → converged.**

**CONVERGENCE after 7 rounds.** R4→R7: 12 → 5 → 2 → 1 confirmed, severity P0×4 → P1 → P1 → P1
(a shrinking, increasingly-narrow tail of "the prior fix missed a sibling path"). The mute class
is now closed everywhere; the SSRF blocklist covers every IPv4/IPv6 encoding traced; the
delivery hot path is isolated + crash-safe. Full gate GREEN end-to-end every round (rust
fmt+clippy0+43 suites+golden byte-exact · web tsc0+796 vitest+eslint · bot tc+77+lint). All 18
round-4-to-7 commits pushed to `landing/v2-port` (`b46a3e40..b3bdeb0b`). **STILL NOTHING
merged/deployed.**

**LESSON (the meta-lesson of the whole loop):** every round from R4 on caught a regression or an
incomplete fix in the IMMEDIATELY-PRIOR round's work — R3-1→R4, #R4-5→#R5-B, #R5-B→#R6, #R6→#R7.
A fix is not done when it compiles + passes the gate; it's done when the NEXT adversarial round
can't break it. And the single highest-severity find of the entire campaign (#R4-10, the
per-chat idempotency launch-blocker) came from a human reading code 1:1, while that same
workflow's summary reported "0 confirmed". Never trust an agent's — or a workflow's own —
return value: read the journal and the code.

Also removed the **/changelog** route entirely (founder call) — route + client +
`feed/changelog.xml` deleted; footer/sitemap/privacy/e2e refs cleaned; dead
`getChangelogCommits`/`getPublicReleases` exports stripped (commits 6f26ddd7, 3230d69).

## Session-so-far baseline (already done, feeds the audit + changelog)

- Batches A–D executed + committed (346 commits ahead of origin/main): NAV-sanity↔
  BLACK_SWAN fix (ADR-0039) + golden re-baseline debt · indexer numéraire-staleness +
  DexScreener liquidity floor · threaded API thresholds + embed reconcile + honest copy ·
  docs accuracy. Gate green: rust 568 + web 788 + clippy 0 + fmt + golden byte-exact +
  promtool 29.
- On-chain verified LIVE + PROVEN on mainnet (tx 3qrRYGaY…, 2026-07-05, SUCCESS).
