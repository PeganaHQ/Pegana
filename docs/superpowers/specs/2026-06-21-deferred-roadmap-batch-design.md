# Deferred audit-roadmap batch — design + plan (2026-06-21)

> Approved scope after a 4-agent feasibility analysis (2 Opus + 2 Sonnet) + brainstorming.
> Invariants (sacred): receipt-hash determinism preserved; behavior-preserving where it's hardening; nothing breaks live auth or the live engine; each item independently shippable + test-gated; CSP/headers ship Report-Only first.

## Scope

**IN:** Helius-key log mask · F-41c RPC failover · full nonce-CSP (Report-Only first) · F-41b R2 restore drill (ops) · WAITLIST_HASH_PEPPER (env) · F-13b true CLI re-derivation (dedicated, phased).
**OUT (decided):** **F-06 JWT→cookie — DEFERRED.** Cross-host (`pegana.xyz`↔`api.pegana.xyz`) forces `SameSite=None` → reintroduces CSRF that Bearer is immune to; net security ~zero/negative; low XSS surface; high live-auth break risk; the literal `SameSite=Strict` rec is infeasible on this topology. The nonce-CSP below is the correct XSS mitigation. Real F-06 needs a same-origin proxy (separate infra project). **Squash `18fa137` — NOT done** (force-push to main would break Hetzner's `git pull --ff-only`; empty commit is harmless).

## Sequencing (value × safety)

### Phase 1 — safe batch (low risk, ship promptly)
1. **Helius-key log mask** — engine `crates/engine-rs/src/main.rs:1537` (`info!(rpc_url=%rpc_url …)`) is the SINGLE leak site (full `?api-key=` URL at INFO; not logged anywhere else). Add `mask_rpc_url(&str)` (strip query) → `info!(rpc_url = %mask_rpc_url(&rpc_url) …)`. Pure-string `url.splitn(2,'?').next()` (no new dep). Verify: a test asserts the masked output drops the key.
2. **F-41c — indexer RPC failover** — `solana_rpc_url_fallback` is declared-but-dead in `crates/indexer-rs/src/config.rs`. Add a `get_account_with_fallback(primary, fallback, pubkey, label)` helper (new `crates/indexer-rs/src/rpc.rs`): try primary → on Err, bump `pegana_rpc_primary_failed_total{source}` + warn + try fallback. Build BOTH async `RpcClient`s at startup in `hylo.rs` / `piggybank_pb.rs` / `solayer_susd.rs`; route all `rpc.get_account(...)` (≈6 sites) through the helper. Additive, zero overhead + zero behavior change when primary is healthy. Verify: unit test of the helper's primary-ok short-circuit + fallback-on-err path.
   - Deploy: `deploy.sh --services 'engine indexer'` (engine for the mask, indexer for F-41c). Calibration-safe (post-launch).
3. **WAITLIST_HASH_PEPPER** — generate `openssl rand -hex 16`, set in Vercel Production env (CLI auth = `lrafasouza`). Takes effect on the next web build (the CSP push triggers it).
4. **F-41b — R2 restore drill (ops, no code)** — on Hetzner: `scripts/pg-restore.sh restore <latest> --into pegana_restore_drill`, validate the `~/.pegana-backup-key` decryption + row counts, drop the scratch DB, write `docs/runbooks/drill-log.md`.

### Phase 2 — full nonce-CSP (web, Report-Only first)
- Next 16 renamed middleware → `proxy.ts` (already exists for the releases rewrite). In the non-releases branch: generate a per-request nonce, set `x-nonce` on the forwarded request + the CSP header on the response. `web/app/layout.tsx` becomes async, reads `(await headers()).get('x-nonce')`, threads it to `<ThemeProvider nonce={nonce}>` (next-themes supports it) + the JSON-LD `<script nonce={nonce}>`. Next auto-nonces its own bundles + `<Script>`-based Analytics; `'strict-dynamic'` covers the React-injected Telegram widget script.
- Directives: `script-src 'self' 'nonce-{N}' 'strict-dynamic' https://telegram.org https://va.vercel-scripts.com` · `style-src 'self' 'unsafe-inline'` (style props pervasive — keep) · `frame-src 'self' https://oauth.telegram.org` · `connect-src 'self' https://api.pegana.xyz wss://api.pegana.xyz https://*.sentry.io` · `worker-src blob:` (Sentry Replay) · `img-src 'self' data: blob:` · `font-src 'self'` · `object-src 'none'` · `base-uri 'self'` · `frame-ancestors 'none'` (keep `/embed` exempt). Add `report-uri /api/csp-report` (new route → log to Sentry/console).
- **Ship `Content-Security-Policy-Report-Only` first** (observe ~72h, zero unexplained violations) → flip to enforcing (one-line). Risk: dynamic-rendering on marketing pages (dashboard already dynamic) + the strict-dynamic Telegram bet — that's exactly why Report-Only.

### Phase 3 — F-13b true CLI re-derivation (dedicated, coordinated)
> The grant thesis "anyone can recompute our peg history". Analysis found 3 latent capture-ordering bugs that must be fixed first. **Design REFINED 2026-06-21 after reading the actual engine/methodology/CLI source — supersedes the speculative notes above.**

**Confirmed facts (source-verified):**
- `canonical_receipt_hash` (methodology/canonical.rs:31-51) hashes `methodology_version · git_sha · assets_toml · inputs_frozen · computed` — it does **NOT** hash `schema_version`. So bumping `schema_version` "v1"→"v2" is **free metadata** (zero hash impact).
- `PegState::default() == Pegged` (common-verify/lib.rs:364); `AssetRuntime::last_state` defaults to it. In every emit case `g.last_state` (pre-`transition`) equals the `current_state` value `classify_*` consumed (= `last_published_state.unwrap_or(Pegged)`): steady-state because each tick sets both `g.last_state` and `last_published_state` to `final_state`; cold-start because both are `Pegged`. ⇒ **one correctly-frozen field serves BOTH the classify and the transition re-derivation inputs.**
- verify() already hard-requires `receipt.methodology_version == cli methodology_version()` (main.rs:160, exit 3). ⇒ freezing the deadband consts is **redundant** (the CLI's `DEADBAND_PCT`/`CR_DEADBAND_PCT` are guaranteed identical to the emitting engine's). **Do NOT freeze them** — that would add struct fields and reintroduce the serde/JCS v1-compat hazard for no benefit.

**The 3 capture-ordering bugs (engine `main.rs`):**
- **GAP-1:** `ewma_prev` frozen at :832 is read AFTER `apply_ewma` (:673) overwrote `g.ewma_discount` with the *new* smoothed value (`previous_ewma` just returns `g.ewma_discount`, state.rs:234). Fix: capture `ewma_prev` into a local BEFORE :673.
- **GAP-2:** `candidate_state`/`candidate_since` frozen at :835-836 are read AFTER `transition` (:746) mutated them (state.rs:522-524). Fix: capture both into locals BEFORE :746.
- **GAP-3 (new, found 2026-06-21):** `previous_state` is frozen as `prev_opt.unwrap_or(Unknown)` (=`last_published_state`), but `transition_decide` consumes `g.last_state`. They agree in steady state but diverge on cold-start (Unknown vs Pegged). Fix: add a `last_state(sym)` getter on `EngineState`, capture `g.last_state` into a local BEFORE :746, and freeze `previous_state` from THAT. (`should_emit`'s prev≠final comparison keeps using `last_published_state` — unchanged.)

**Zero-struct-change design (chosen for max v1 safety):** No fields added/removed/retyped on `InputsFrozen`/`Computed` → v1 historical + on-chain receipts deserialize and **re-hash byte-identically** (the spec's original "adding fields changes the hash" hazard is avoided entirely). Only the *values* the engine freezes into NEW (v2) receipts change (now correct), plus `schema_version`→"v2". v1 receipts in the DB/on-chain are immutable and untouched.

**Re-derivation fn:** add `pub fn rederive(inputs: &InputsFrozen) -> Result<Computed,…>` to the methodology crate, orchestrating the existing pure fns in the engine's exact order: `compute_discount` → `is_plausible_discount_sample` → `apply_ewma_pure(raw, ewma_prev, alpha)` → `classify_with_hysteresis | classify_cr_with_hysteresis(previous_state)` → `transition_decide(previous_state, …, candidate_state, candidate_since, now, confirm, decay)` → `premium_sanity_violated` (force Unknown). Returns `(discount_raw, discount_smooth, final_state)`. **`confidence_label` is DEFERRED** from the asserted set (its resolver is engine-side + `Utc::now()` staleness — would false-FAIL; Option-B follow-up moves it to methodology).

**CLI branches (verify(), main.rs:152):** accept "v1" AND "v2" (bail on others). Both paths re-hash (tamper-evidence — version-agnostic). v2 additionally calls `rederive(inputs_frozen)` and asserts `(discount_raw, discount_smooth, final_state) == expected_computed`; mismatch → exit 1 (loud, like the hash-mismatch path). v1 = re-hash only (verbatim current behavior).

**Hard test gates (all must be green before any release/deploy):**
1. methodology unit tests: `rederive` on hand-built `InputsFrozen` across USD-stable, LST SOL-path, hyUSD CR-path, premium-sanity-override, and cold-start cases → matches expected `Computed`.
2. **Engine-side round-trip integration test** (the critical gate that would have caught GAP-1/2/3): drive the recompute core through cold-start escalation, a steady transition, the hyUSD CR path, and a premium-sanity force_unknown; capture each emitted `inputs_frozen`+`computed`; assert `methodology::rederive(inputs_frozen) == computed`.
3. v1 hash-stability test: a known v1 receipt fixture still re-hashes to its stored sha256 (proves the struct is unchanged for v1).
4. CLI tests: a v2 receipt re-derives (PASS); a v2 receipt with one tampered `market_usd` → re-derive MISMATCH (exit 1); a v1 receipt → re-hash only (PASS, no re-derive).
5. methodology proptests stay green; engine behavior unchanged (only what's frozen changes) — Opus review.

**Version-compat + deploy ordering (critical):**
- **`methodology_version` stays 0.4.0** — `rederive` is an additive pure helper that changes NO existing methodology output, so no bump is warranted; bumping it would make the new CLI VERSION_MISMATCH (exit 3) on every historical 0.4.0 receipt, breaking "recompute our HISTORY". The new CLI is a *rebuild* from methodology 0.4.0 carrying the v2-verify code; `methodology_version()` stays 0.4.0 ⇒ matches both historical (v1) and new (v2) receipts.
- The currently-released CLI hard-rejects any non-"v1" schema → it would break on v2 receipts. So: **(1) build, tag, and release the new CLI (v1 re-hash + v2 re-derive) via CI→cargo-dist→Sigstore FIRST; (2) only THEN deploy the engine emitting `schema_version`="v2".** Between the two, the engine still emits v1 → new CLI re-hashes them → fine.
- ⚠️ Open release-eng wrinkle (decide at release time): the public release tooling couples the CLI tag to the methodology version, and the installer self-versions off `/v1/methodology/current` (still 0.4.0) — so a schema-only change isn't surfaced to prompt updates. Acceptable: old 0.4.0 CLIs hitting a v2 receipt get the existing "unsupported schema_version" message; the fix is to update. The engine-v2 deploy is therefore its own reviewed step, gated on the CLI release landing.
- Effort ~1-2 days; **implement + test + Opus-review fully (gates 1-5 green) as a review-ready unit, but treat the CLI-release→engine-v2-deploy as a separate coordinated rollout** distinct from Phase 1's engine deploy.

## Verification & review
- Each phase: Sonnet implements (TDD where a test fits) → Opus reviews (spec + quality) → fix loop. `/code-review` on the cumulative diff. Full suites green before deploy. 1:1 walkthrough at the end.
- No commits to main without the same gate; Hetzner deploys via `deploy.sh`; web via git-integration (auto-promote confirmed); CLI via tag→cargo-dist.
