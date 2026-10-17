# Pegana — Audit Remediation Campaign (Design / Spec)

> **Date:** 2026-06-29 · **Author:** Opus 4.8 (orchestrator) · **Status:** Design — awaiting user review
> **Source audit:** `docs/call-prep-2026-06-18/audit-2026-06-28/2026-06-28-MASTER-auditoria-validacao-plano.md`
> **Independently re-validated against HEAD `c7f7b9c`** (HEAD = docs/style only ahead of prod baseline `8745572`; zero engine/API code drift since the 06-28 audit).

---

## 0. Mission anchor (read first, every session)

> **Não revisar o Pegana para adicionar coisas. Revisar para deixar o core mais correto, confiável, verificável e fácil de entender.**
> **E o passo decisivo NÃO é código — é DEMANDA.**

This campaign is the *right kind* of work — every retained item makes the core more **correct / reliable / verifiable / legible**, and **zero items add product features**. But it is **not a substitute for demand** (0 paying customers; thesis still WEAK per `project_demand_gap_verdict_2026_06_22`). The sequence is deliberately front-loaded so that **if a demand opportunity interrupts** (tokens.xyz / Solana Foundation call, a design partner), we can pause after any sprint with maximum trust-value already shipped and nothing risky left half-done.

**Guard-rail:** ❌ No large feature without 1 paid design partner. This spec contains no features — verify any future addition against the mission before starting it.

---

## 1. What changed vs. the audit (independent re-validation)

The 06-28 audit (60 findings + 1 new = 61) was correct on the macro diagnosis but **~40% of line-items are cuttable** — refuted, already-shipped, or subsumed. This was verified by reading the cited code directly (not just trusting sub-agents) for every high-risk cut.

### 1.1 REFUTED — working as designed (CUT; fixing them would *regress*)
| ID | Verified evidence | Why cut |
|---|---|---|
| **L1** | `jupiter.rs:312-316` sets `value_sol` only when `numeraire=="SOL"`; sHYUSD is `stable_yield`/USDC-quoted (`assets.toml:279`) | Omitting `value_sol` is **correct** — SOL-path is LST-only. |
| **M7** | `discount.rs:68-70` `|d|<1` strict; pinned by 2 proptests (`plausibility_boundary_swept` 4000 vals, `compute_discount_none_never_laundered`); doc + test cite the 2026-06-12 JupUSD incident | `|d|<1` ⇔ market∈(0,2×NAV); healthy xSOL is always inside. Loosening **re-opens a documented prod incident** ([[project_ewma_zero_price_fix_2026_06_12]]). |
| **M6** | `discount.rs:6-13,29-39` — LST uses SOL-path to cancel the SOL/USD multiplier; stables/synth use USD-path because "the USD value IS the invariant" | No numeraire-mixing bug exists. |
| **M8** | `auth.rs:215` `mint_magic` requires constant-time `x-internal-secret`; `consume_magic` requires 32-byte (256-bit) random nonce, atomic single-use, 15-min TTL | Bot-only + non-enumerable nonce. A per-`telegram_id` cap protects nothing. |
| **M21** | `discount.rs:29-39` SOL-path cancellation already shipped; `sanctum.rs` publishes `value_sol` | Time-basis cross-source risk already mitigated. |
| **L14** | `rederive.rs` is deterministic on `inputs.now`, does **not** call `Utc::now()` | Misattribution — the real issue is M17 (engine label path), folded there. |

### 1.2 ALREADY-SHIPPED or much-reduced (CUT or reduced to residual)
| ID | Verified evidence | Disposition |
|---|---|---|
| **H4 (timeout half)** | `onchain_commit.rs:34-41` `COMMIT_TIMEOUT=60s` + retry + backoff present | Retain **only the fallback half** (`rpc` is a single `Arc<RpcClient>`, `:50`). |
| **H9 (metrics)** | `dispatcher main.rs:608,621,627` — `dispatches_total{ok|dead_letter}` + latency histogram + dead-letter pipeline all shipped | Retain only panel+alert, **conditional on a webhook consumer (none yet)**. |
| **M11** | `engine main.rs:1185-1198` confidence already pulls the Jupiter numéraire feed + caps no-Pyth at `medium` | Residual = C2 (token-leg depth). Fold into C2. |
| **H13** | prod populates `methodology_git_sha` (220/224); only dev/test null (`version.rs:8-10` via `option_env!`, set at build by `Dockerfile`+`deploy.sh:133`) | Marginal — at most verify a prod receipt carries a real SHA. |
| **L12** | `thresholds.rs:218-222` BLACK_SWAN copy already honest (ADR-0025); no terminal/never-reset claims survive in any doc | Already-fixed. |
| **M1** | `perena.rs` — no stale comment at HEAD; hardcoded program/account is the **consistent** pattern across all sources; source is ACTIVE | Downgraded to LOW → backlog. |

### 1.3 Phantom metric (audit citation error)
`pegana_engine_n_total` **does not exist** anywhere in code — it appears only inside the audit's own markdown. The real startup-refusal counter is **`pegana_engine_methodology_broken_total`** (`engine main.rs:86`). Any task line citing `n_total` must use the real name.

### 1.4 Re-framed (the audit's prescription was wrong)
- **C2** — ADR-0026 **rejects** putting a liquidity number in the receipt. The correct C2 is to **consume the already-collected `price_impact_pct`** to *cap confidence / force UNKNOWN* (already-hashed fields), **not** add new hashed receipt fields.
- **Historical re-derive** — there is **no in-binary multi-version dispatch**; the CLI hard-exits (`exit(3)`) on version mismatch (`pegana-replay-cli/main.rs:161-172`). Re-derivability of 0.4.0 receipts is preserved **only** by keeping version-pinned CLI binaries installable (`PEGANA_REPLAY_VERSION`). Any methodology bump (Trilha B) **must preserve that install path**.

### 1.5 Landmine defused
**H11 (rewrite `assets.toml` header) is hash-safe.** `canonical_assets_hash` (`canonical.rs:22-28`) parses TOML → re-serializes, **stripping comments + whitespace** (proven by tests at `:108,170-180`). A header-only edit does **not** change any receipt hash.

---

## 2. Execution model

| Role | Who | Responsibility |
|---|---|---|
| **Orchestrator + reviewer** | **Opus 4.8 (me)** | Per-task spec, dispatch, review **every** diff, fix-loop, gate enforcement. |
| **Root-cause Rust** | **Codex** (`/goal` goal-mode, [[reference_codex_goal_mode_workflow]]) | Engine/methodology heavy reasoning (Trilha B; parts of D/E). |
| **Mechanical / docs / web / additive** | **Sonnet 4.6** | Docs, web, additive metrics/alerts, enum plumbing, SQL alignment. |

### 2.1 Per-task review gate (the "padrão forte")
```
Opus: read finding → write task-spec (file + acceptance + guard-rails)
  → delegate to Codex (Rust) or Sonnet (docs/web/additive)
  → diff returns
Opus: /code-review (effort high)  →  /review-and-iterate  →  fix-loop until clean
Gate: cargo test + vitest green  +  2025-10-10 backtest drift-gate (any formula-adjacent change)
  [Trilha B / C1+C2 only]: /code-review ultra (cloud, multi-agent) + 7-day dual-run + ADR
  → commit on the sprint branch → next item
```

### 2.2 Branch & deploy discipline
- One branch per sprint. **Verify branch before every commit** (`git branch --show-current`) — the session snapshot goes stale; user FF-merges externally ([[feedback_verify_branch_before_commit]]).
- Web deploys via Vercel on push to `main`. Services deploy via `scripts/deploy.sh` (`--config-only` / `--migrate` / `--services`). **No prod mutation (deploy/migrate) without explicit founder OK.**

---

## 3. The campaign — 5 trilhas, sequence A → D → C → E → B

> Sequence rationale: trust-core (demo-able, zero-risk) first → reliability deadline (H3) → observability → security → root-cause (gated bump) last. Pausable for demand after any sprint.

### Sprint 0 — Ops / Founder (outside the code-loop)
| Item | Status |
|---|---|
| Prod disk 86%→14% (`docker buildx prune -af`, freed 104 GB; 12/12 containers healthy) | ✅ **DONE 2026-06-29** |
| Jupiter post-30/06 decision (pay tier vs keyless conc=1) — keyed key already SET in prod | ⏳ founder — Opus prepares comparison |
| Helius credits / hosting SKU / TimescaleDB retention-policy existence | ⏳ data-gathering (does not block code) |

---

### Sprint A — Trust-core / legibility · **Sonnet** · zero hash-impact, no drift-gate
The thesis layer. All additive or doc/web. Ship-able immediately; biggest trust-value per unit risk.

| ID | Task | File(s) | Acceptance | Impl |
|---|---|---|---|---|
| **H2** | `state_reason` enum (`premium_sanity\|stale_source\|no_oracle_crosscheck\|intrinsic_unavailable\|shallow_market\|nominal`) as **top-level `Receipt` field**, `Option<String>` + `#[serde(default)]` (sibling of `schema_version`, **outside hash**) | `methodology/src/receipt.rs`, `engine` populate site, `api-rs/routes/assets.rs` | Old 0.4.0 receipts re-hash/re-derive byte-identical; field surfaced on `/v1/assets*`; documented as **advisory (not in the cryptographic commitment)** | Sonnet |
| **EURC** | Align `/v1/assets` (15-min freshness gate → `null`) vs `/state` (no gate → frozen `PEGGED`+`stale:true`). Make `/state` apply the same staleness→UNKNOWN collapse; weekend-aware for FX intrinsics. Folds **M5** (`engine_sample_status`) | `api-rs/routes/assets.rs` (`ASSETS_LIST_SQL`, `state_for_symbol`) | Same asset never returns contradictory states; existing P3 embed test still green | Sonnet |
| **H11** | Rewrite `assets.toml` header honestly: "~25 calibrated + ~38 monitoring_only beta = ~63 active" (currently claims "26 active, 28 total" — off by 37) | `crates/.../assets.toml:1` | Header matches `retain(active)` runtime count; **hash unaffected** (verified) | Sonnet |
| **H12** | Bring `METHODOLOGY.md` v0.2.0 → **0.4.0** (BLACK_SWAN-from-CR, NAV premium-sanity, ADR-0025 non-terminal). Note anti-backdating is enforced in the closed sibling repo (not outsider-verifiable) | `METHODOLOGY.md` | Version + logic match code; "SAS" already reads "SPL Memo" (no change) | Sonnet |
| **M19** | **Relabel** "Verify" → "Verify integrity (hash)" + plain-language note that correctness re-derivation is roadmap. (Full JS re-derive deferred to post-Trilha-B.) Folds **M17** honesty note (confidence_label hashed-but-not-re-derived) | `web/.../static-receipt-verifier.tsx`, `web/lib/verify-receipt.ts` | UI no longer implies the verdict is recomputed; states tamper-evidence explicitly | Sonnet |
| **M4** | Additive API field `risk_side` / `display_direction` derived from `class` (makes the signed `discount` self-describing, like `anchor`) | `api-rs/routes/assets.rs`, web render | Consumers can tell which sign is the risk side; no hash surface | Sonnet |
| **M15** | One hosting SKU across docs (README CAX21 ~$8.50/mo is newest); mark `spec.html` superseded | `README.md`, `docs/spec.html`, `docs/.../04-data-model.md` | No contradictory infra cost across public docs | Sonnet |
| **L22** | Add "in this 2025-10-10 replay" denominator to "123 receipts / 43,210 obs" | `web/app/backtest/page.tsx`, sibling page | Headline numbers no longer read as product-scale totals | Sonnet |
| **L23** | v1 receipt `PASS` line states "tamper-evident only" vs v2 "re-derived" | `pegana-replay-cli/src/main.rs:203-231` | Verifier can't conflate the weaker v1 guarantee | Sonnet |
| **M2** (hylo only) | Wire `hylo_onchain_poll_ms` toml field (currently silently dead; hylo reads only env) | `indexer-rs/sources/hylo.rs:88` | Setting the toml key takes effect | Codex/Sonnet |

**Exit:** all green (cargo/vitest), `/code-review` high + `/review-and-iterate` clean, **no hash change** (assert receipts unchanged), deploy via `--config-only`/Vercel after founder OK.

---

### Sprint D — Reliability (RPC / on-chain) · **Codex** · deadline-aware
| ID | Task | File(s) | Acceptance | Impl |
|---|---|---|---|---|
| **H3** ⏰ | Pyth Hermes API-key ready: `PYTH_HERMES_API_KEY` (bearer) + dourolabs URL, key-gated default. **Hard deadline ~31/07/2026** — keyless Hermes 401s after | `indexer-rs/config.rs:71`, `sources/pyth.rs:164`, `state.rs` client | With key set, stream authenticates; without, falls back to current behavior. Code lands now; founder provisions key later | Codex |
| **M14+H5** | `get_multiple_accounts_with_fallback` in `rpc.rs`; rewrite hylo poll (5 sequential `get_account` → 1 batch) + capture `RpcResponse.context.slot` → populate the dead `slot` column + slot-stale detection | `indexer-rs/rpc.rs`, `sources/hylo.rs:161`, `postgres.rs` | Hylo does 1 RPC/tick not 5; `slot` populated; slot-stale flagged | Codex |
| **M3** | Use observation `ts` (from Redis envelope) for engine freshness, not receive-time `Utc::now()`. **Subsumes L3, L8 (engine staleness)** | `engine-rs/src/state.rs:448-492` | A frozen-but-republishing source trips `side_is_stale` within the gate window, not only the 900s sweep. Per-feed windows preserved (no false-stale on slow NAV feeds) | Codex/Sonnet |
| **H4** (fallback half) | Primary/fallback commit RPC pair, alternate on retry. **Subsumes L8 (engine commit RPC commitment)** | `engine-rs/onchain_commit.rs:49-54` (`CommitContext`), `main.rs:1576` | A primary-RPC outage during a depeg burst still lands receipts on the fallback | Codex |
| **L5** | `scale_price` — `bail!` on `expo` abs > 28 instead of silent `.min(28)` clamp (rides H3, same file) | `sources/pyth.rs:454` | Out-of-range expo → skipped tick, not silent wrong number | Codex |

**Exit:** strong gate + **run the 2025-10-10 drift-gate as a guard** (these touch ingestion, not methodology math — expect no hash change; confirm it).

---

### Sprint C — Observability · **Sonnet** · all additive, no hash-impact
| ID | Task | File(s) | Acceptance | Impl |
|---|---|---|---|---|
| **H7 + M13** | Alert rules (panels mostly exist) for `nav_sanity_unknown_total`, `methodology_broken_total`, `audit_persist_failed_total`, `startup_check_failed_total` | `ops/alerts/pegana.yml` | The trust-layer-silent-failure events page; highest value/effort in the cluster | Sonnet |
| **H8** | `pegana_engine_asset_state{asset,state}` gauge (set old=0/new=1 on transition). **Subsumes L17** (keep labels to `asset×state` only — cardinality note) | `engine-rs/src/main.rs` recompute path | A per-asset state heatmap + "stuck in UNKNOWN" alert become possible | Sonnet |
| **API p95/p99** | Request-latency histogram middleware (ride-along; generic but expected) | `api-rs` middleware | p95/p99 visible | Sonnet |
| **H9** | Webhook panel + `dead_letter` alert rule — **written DISABLED** (no consumer yet); enable the day the first consumer signs | `ops/grafana/dashboard.json`, `ops/alerts/pegana.yml` | Rule exists, commented/disabled, documented trigger condition | Sonnet |

**Exit:** strong gate, no hash impact (ops YAML/JSON + additive metric emits).

---

### Sprint E — Security · **Codex + Sonnet** · scoped to the real perimeter
> Perimeter (SSH-verified): `api:8080` unpublished on host; ufw allows only 22/80/443; everything reachable only via Caddy. Severities reflect this.

| ID | Task | File(s) | Acceptance | Impl |
|---|---|---|---|---|
| **C3** | Fix XFF spoof at the edge: Caddy `trusted_proxies private_ranges` + `header_up X-Forwarded-For {remote_host}` so the app sees one trustworthy IP. **Repairs L9 + H10 per-IP caps for free** | `ops/Caddyfile` (+ optionally `rate_limit.rs:79`/`ws.rs`) | A client-sent `X-Forwarded-For` can no longer bypass the rate limiter | Codex |
| **M20** | Per-user webhook cap (`COUNT(*)` ceiling) + validate `body.asset` against known assets before INSERT. (Low priority — no consumer — but cheap) | `api-rs/routes/webhooks.rs:162` | A user can't create unbounded / dead subscriptions | Codex |
| **H10** | WebSocket idle/read timeout (server-side ping/pong deadline) | `api-rs/src/ws.rs:140-266` | Slow-loris idle sockets are reaped; verify tungstenite default frame limits | Sonnet |

**Exit:** strong gate + `/review-and-iterate` with security emphasis.

---

### Sprint B — 🎯 Root-cause (sHYUSD class) · **Codex** · **METHODOLOGY BUMP 0.4.0 → 0.5.0**
> The deepest fix and the only hash-breaking sprint. Done last, deliberately gated.

**Step 0 — ADR first** (`docs/adr/0027` or next free number): version-bump policy, 7-day announce + dual-run, **preserve the version-pinned CLI install path** so historical 0.4.0 receipts still verify.

| ID | Task | File(s) | Acceptance | Impl |
|---|---|---|---|---|
| **C1** | Replace notional=1 Jupiter quote with a realistic per-class notional (the root cause of shallow-pool mispricing) | `indexer-rs/sources/jupiter.rs:195-199` | Shallow pools no longer read as priced; drift-gate passes with documented expected diffs | Codex |
| **C2** | Consume `price_impact_pct` → cap confidence; beyond threshold force **UNKNOWN + `state_reason='shallow_market'`** (the chosen honest-dark default). **Promote `state_reason` INTO `Computed`** (hashed + re-derivable) since the hash is bumping anyway. Folds **M9, L2, L13** | `engine-rs` consume path, `methodology/receipt.rs`, `thresholds.rs` | Thin/high-impact quotes → UNKNOWN, not confident PEGGED; `state_reason` now verified | Codex |
| **H1** | Extend `premium_sanity` to `synth_lev` (xSOL) + CDP (hyUSD), bound per class | `methodology/src/thresholds.rs:35-37,69` | xSOL/CDP premium anomalies caught | Codex |
| **M18** | Backtest exercises the sHYUSD premium-vs-NAV class (demonstrates `premium_sanity_violated`) | `xtask` backtest, fixtures | New backtest case green in CI drift-gate | Codex |
| **M19** (re-derive) | Port `compute_discount` + `thresholds` + hysteresis to TS with property-tests mirroring the Rust proptests — **after 0.5.0 stabilizes** (avoid maintaining two impls during the bump) | `web/lib/`, new TS methodology port | In-browser "Verify" re-derives the verdict, not just the hash | Sonnet |

**Exit (MAXIMUM gate):** `/code-review ultra` (cloud) on C1+C2 · `/review-and-iterate` · cargo/vitest green · **MUST pass the 2025-10-10 drift-gate** · ADR merged · 7-day dual-run before flipping prod.

---

## 4. Explicit cut list (nothing dropped silently)

- **Refuted (do NOT touch — would regress):** L1, M7, M6, M8, M21, L14.
- **Already-shipped / marginal:** L12, M1, H13, H4-timeout, H9-metrics, M11.
- **Folded into a retained item:** M9→C2, L2→C2, L13→C2, M11→C2, L3→M3, L8→M3/H4, L17→H8, M5→EURC, M17→M19, L14→M17.
- **Backlog (real but deferred by perimeter/mission, NOT denied):** M12 (divergence already observable via `discount_raw`), M10 (circuit-breaker — obviated by M3), L4 (band asymmetry partly justified), L6 (closed-vault decode — guards suffice), L7 (self-heals within one tick), L9 (via C3), L10 (opportunistic attest), L11 (Report-Only, style-only), L15 (channel-naming debt), L16 (cosmetic DRY), L18 (freshness gauges redundant; keep verify-counter if verify gets traffic), L19 (free DexScreener/tokens.xyz — no SLA/fallback; acceptable until a paid consumer needs the SLA), L20 (producer-bounded), L21 (operator-misconfig guardrail), M16 (300-asset projection is hypothetical; update doc table + confirm retention policy exists).

### Coverage check (all 61 accounted for, exactly once)
- **CRITICAL:** C1→B · C2→B · C3→E
- **HIGH:** H1→B · H2→A · H3→D · H4→D (fallback; timeout already shipped) · H5→D · H6→Sprint 0 (founder) · H7→C · H8→C · H9→C (disabled) · H10→E · H11→A · H12→A · H13→cut (marginal)
- **MEDIUM:** M1→backlog · M2→A (hylo) · M3→D · M4→A · M5→A (EURC) · M6→cut · M7→cut · M8→cut · M9→B (C2) · M10→backlog · M11→cut/B · M12→backlog · M13→C · M14→D · M15→A · M16→backlog · M17→A (M19) · M18→B · M19→A (relabel)+B (re-derive) · M20→E · M21→cut
- **LOW:** L1→cut · L2→B (C2) · L3→D (M3) · L4→backlog · L5→D · L6→backlog · L7→backlog · L8→D (M3/H4) · L9→backlog/E · L10→backlog · L11→backlog · L12→cut · L13→B (C2) · L14→cut (M17) · L15→backlog · L16→backlog · L17→C (H8) · L18→backlog · L19→backlog · L20→backlog · L21→backlog · L22→A · L23→A

---

## 5. Founder decisions / data inputs (do not block code)

1. Jupiter post-30/06: pay tier vs keyless conc=1 (~120s staleness)?
2. Helius credits/month today → headroom for 100/300 assets?
3. Real CPX32 invoice + does an enforced TimescaleDB retention policy exist? (M16)
4. "SAS" — already reads SPL Memo; confirm no migration is intended (H12).
5. Beta→calibrated criterion + window (no recalibration cron visible).
6. tokens.xyz/Foundation: breadth (all LSTs) or depeg-signal (stables)? → fate of ~22 INVESTIGATE LSTs.
7. **DEMAND** — the #1: convert outreach into 1 paid design partner.

---

## 6. Guard-rails (from the audit "🚫 não fazer")

- ❌ No large feature without a paid design partner.
- ❌ No formula change (α, thresholds, premium-gate, notional) without passing the 2025-10-10 drift-gate.
- ❌ Do **not** re-apply `state_for_cr` `<`→`<=` (reverted regression; DRIFT at CR<130 is intentional — [[project_hyusd_cr_deadband_2026_06_04]]).
- ❌ Do **not** resurrect the ADR-0024 freeze-detector (rejected for false-positiving; replacement is the depth-gate ADR-0026).
- ❌ No prod mutation (prune/deploy/migrate) without explicit founder OK.
- ❌ Do not add more thin-market-leg assets until the depth-gate exists (default UNKNOWN > confident PEGGED on a frozen quote).
- ❌ Do not build a dedicated sUSD backtest as "proof" (proof trap; use sUSD/Hylo as a demand wedge).

---

## 7. Process lessons (carry forward)

- Long/open audit agents → request **markdown** output, NOT StructuredOutput schema (16/18 schema agents failed first round; plain-text 100%).
- Verify external claims via `WebSearch`/`WebFetch` + MCP (`context7`, `solana-dev`, `helius`) through `ToolSearch`.
- SSH gotcha: `docker compose exec -T` inside an ssh heredoc drains stdin → append `</dev/null`. cred-guard hook blocks `.env` reads → mask secrets.
