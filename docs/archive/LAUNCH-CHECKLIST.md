# Pegana — Big-Launch Checklist (updated 2026-07-19 · "V1")

> **What "the big launch" is:** merge `landing/v2-port` → `main` (Vercel web prod) +
> deploy the Rust services (`scripts/deploy.sh` on `${PEGANA_DEPLOY_SERVER}`) + activate
> the hardening + the GTM push. This release is branded **V1** for the official launch.
> **425 commits ahead of `main`; nothing deployed.** Prod runs the PRE-hardening build
> (confirm the exact methodology version on the box — the on-chain memo showed `0.5.0`);
> this branch is **methodology 0.7.0**.
>
> **2026-07-19 update:** the branch went through a **7-round adversarial hardening loop to
> convergence** (~45 findings, 4 P0s — ledger `docs/RELAUNCH-AUDIT-MASTER-2026-07-18.md`) and a
> **V1 cleanup pass** (dead assets/routes/code removed; `/pricing` + waitlist cut; footer
> "License (MIT)" removed). The **paste-ready PR body is `docs/V1-LAUNCH-PR.md`.**
>
> **Readiness verdict:** **Technically READY-WITH-ACTIONS on every deploy track. BLOCKED on
> GTM/demand only.** No code-level blocker; the branch is green + byte-exact + merges clean.
> Companions: `docs/V1-LAUNCH-PR.md` (PR body), `docs/runbooks/v2-launch.md` (ordered steps),
> `docs/AUDIT-V2-2026-07-18.md` (trust), `docs/launch/launch-scorecard-2026-07-15.md` (GTM).

| Track | Ready? | Owner |
|---|:---:|---|
| A · Pre-flight / merge-readiness | 🟡 actions | founder + verified here |
| B · Deploy sequence | 🟢 verified accurate | founder (SSH/Vercel) |
| C · In-hash gate activation | 🟡 needs prod calibration | founder (prod SQL) |
| D · Ops & rollback | 🟡 fix 2 runbooks | me (docs) + founder (verify env) |
| E · Public-facing honesty | 🟠 **1 reputational blocker** | me (docs) + founder (wallet) |
| F · GTM / demand | 🔴 **BLOCKED** | founder only |

---

## A · Pre-flight / merge-readiness (do FIRST)

- [ ] **Rotate the leaked crates.io token** (founder — external account state, un-verifiable from repo). ⚠️ standing item.
- [x] **Push `landing/v2-port` to origin** — DONE; branch is synced with `origin/landing/v2-port` (all 425 commits pushed).
- [ ] **Merge via a GitHub PR into `origin/main`, NOT a local `git merge`.** `main` genuinely diverged; a local FF/merge would misfire. `[[feedback_local_main_diverged_deploy_blocked]]`. **Paste `docs/V1-LAUNCH-PR.md` as the PR body.**
- [x] **7-round adversarial hardening → CONVERGED** (2026-07-19) — ~45 findings fixed incl. 4 P0s; every round re-verified the prior round's fix. Ledger: `docs/RELAUNCH-AUDIT-MASTER-2026-07-18.md`.
- [x] **V1 cleanup pass** (2026-07-19) — dead assets/routes/code removed; `/pricing`+waitlist cut; footer "License (MIT)" removed.
- [x] **Branch is green** — 43 rust suites · fmt · clippy 0 · **golden byte-exact** · web tsc + **796 vitest** + eslint 0 · bot tsc + 74 tests + lint. ✅
- [x] `web/playwright.preview.config.ts` — **now gitignored** (this pass) per its own header.
- [x] `.env.example` — **the new opt-in gate envs added** (this pass): `INTRINSIC_LIVENESS_GATE`, `DEPTH_GATE_FLOOR_USD` + freshness, with the Pyth-const caveat.

## B · Deploy sequence (verified accurate against code — follow `v2-launch.md`)

1. 🔒 **Publish crates — methodology FIRST, then CLI** (ADR-0030): `cargo publish -p pegana-methodology` (0.7.0) → `cargo publish -p pegana-replay` (0.5.0; pins methodology `=0.7.0`, confirmed). Verify with `cargo install pegana-replay` + a byte-exact check.
2. 🔒 **Merge → `main`** = Vercel web prod (auto-build + auto-promote ~1-2 min).
3. **`deploy.sh --migrate`** — migs 0064–0068 (all present + content-correct; **0064 has NO dSOL UPDATE** — split-out consistent across assets.toml/DB/allowlist/web). ⚠️ **0067's index on the `oracle_snapshots` hypertable: apply manually first with `WITH (timescaledb.transaction_per_chunk)`** (same as 0052) — `--migrate` runs a plain `psql -f` with no hypertable special-casing.
4. **Calibrate the Pyth conf-gate + depth-gate vs prod — BEFORE the engine recreate** (Track C).
5. **Set `DEPTH_GATE_FLOOR_USD`** only after step 4's GO.
6. 🔒 **Recreate the engine** (methodology 0.7.0 + gates + synth_lev-B fix + latency). **Never mid-calibration.** ⚠️ *the Pyth conf-gate goes verdict-affecting LIVE at this instant — see Track C.*
7. **`deploy.sh --services 'api indexer'`** — ⚠️ **single-quoted, space-separated** (comma = one bogus service, rebuilds neither). Carries: market-cap · `/v1/calibration` CORS fix · 3-leg `oracle_usd` · ORACLE_DEGRADED · self-calibration metrics.
8. **Ops (7.5)** — update `ops/alerts/pegana.yml` + **`docker compose kill -s SIGHUP prometheus`** from `~/pegana` (compose DNS doesn't resolve from the host shell). `promtool check` = **26 rules** (runbook says 25 — stale by one → fixed below). Docker pins (AC72) confirmed.
9. **e2e full on CI** (`/status/calibration` wired into `web-e2e.yml`).

## C · In-hash gate activation (the risk-critical part — prod calibration required)

- ⚠️ **The Pyth confidence gate is NOT env-gated** — `PYTH_CONFIDENCE_GATE_BPS = 500` is a **compile-time const** (`thresholds.rs:166`, no env override anywhere). It goes **verdict-affecting LIVE, unconditionally, at the engine recreate (step 6).** So:
  - [ ] **Founder runs ADR-0032 Query A + Query B** against prod `oracle_snapshots` BEFORE step 6 to confirm 500 bps trips ~0 on healthy operation. **This is a hard gate, not optional.**
  - Rollback if it misfires = **full engine redeploy on the prior methodology tag** (no faster path).
- ✅ **The intrinsic-liveness gate ships DISABLED + byte-exact** (`INTRINSIC_LIVENESS_GATE` env, fail-open; verified via the canonical-hash omission test). To ENABLE (a **separate, later** step — NOT at merge):
  - [x] Indexer populating `intrinsic_liveness` (mig 0068; the table's `reason` is generic TEXT, accepts `nav_accrual_stall`). 4 write-paths live: Sanctum (corroborated) · SplStakePool (epoch_lag) · Hylo (epoch_lag) · Perena (nav_accrual_stall).
  - [x] **Calibração completa** (2026-07-17): 41 tracked sanctum_lst, 1 raw `flags.stale` trip (sharkSOL — false-positive caught, rate advancing) → 0 expected trips post-corroboration. Perena: 60,461 polls @ 30s, max healthy flat ~3h35m → 12h window = 3.3× margin, zero false-positives in-sample.
  - [x] **FLIP:** `INTRINSIC_LIVENESS_GATE=on` set in VPS `.env` + engine force-recreated on 2026-08-03. Engine log confirms `"enabled":true,"freshness_secs":3600`. Rollback = unset env + `--config-only` (instant, no rebuild).

## D · Ops & rollback (fail-safe today; 2 runbooks are wrong)

- [x] **`rollback.md` §B flagged** (this pass) — a ⚠️ banner now points to the real drilled `pg-backup.sh`/`pg-restore.sh` pipeline (the `rclone`+`restore.sh` block was the old one). *Full rewrite of the block around `pg-restore.sh` is a follow-up.*
- [ ] **Verify on the box:** `ALERTMANAGER_TELEGRAM_BOT_TOKEN/_CHAT_ID` are non-empty in `~/pegana/.env` (the Alertmanager→Telegram pager is built but silent without them).
- **Accept with eyes open** (pre-existing, honestly documented, NOT new — do not let these block): Pyth Hermes is single-host (no fallback mirror) · no per-source auto-heal (human MTTR) · `pegana_source_task_up` freezes at 1 on a panic (the page keys off a different metric) · free-public RPC fallback (no SLA). All fail *safe* (→ UNKNOWN). *Post-launch hardening, not a blocker.*

## E · Public-facing honesty (🟠 the reputational blocker)

- [x] **RESOLVED (2026-07-19) via reframe — ADR-0041.** The mismatch (prod `PEGANA_COMMIT_KEYPAIR` unset → a severe alert's verify returns **ONCHAIN_INCOMPLETE exit 5, not PASS**, while copy claimed on-chain anchoring "by default / every severe verdict anchored") is closed on the copy side: **13 public surfaces reframed** to lead with the always-true off-chain byte-exact re-derivation and describe on-chain anchoring as *optional / capability for severe transitions, proven with a real receipt* — **honest whether or not the wallet is funded** (the worst offender was the whole `/whats-new` relaunch page). Validated the SPL-Memo wording vs Solana docs + code + the proven mainnet tx.
  - **Optional upgrade (founder, spends SOL):** funding the commit wallet (`7Ppoyum…u7R9`, ≥0.05 SOL) + setting `PEGANA_COMMIT_KEYPAIR` activates anchoring for severe alerts — the reframed copy is still accurate afterward (it never over-claimed). Not a launch blocker anymore.
- [x] **Root `SECURITY.md` added** (this pass) — private disclosure via Telegram/pegana.xyz, scope, and a note that anyone can re-derive a verdict. (A `/.well-known/security.txt` on the site is a nice follow-up.)
- [ ] **Docs-site accuracy audit** (2026-06-15, 85 findings, code-green/docs-red, never applied) — fold into launch scope or track as an explicit deferral.

## F · GTM / demand (🔴 BLOCKED — founder only)

> **Brutally honest:** this is a *capability announcement with a strong product*, not a
> commercial launch with a path to revenue. The only "revenue" on record is ~$0.002 of
> dogfood x402 settlements. Every launch-day GTM asset is drafted-but-unfired.

- [ ] **Send the drafted Ernani / NAV-Guard reply TODAY** — the oldest-overdue, zero-cost, highest-leverage GTM action in the repo (still `NOT sent`).
- [ ] **Fill in the ADR-0007 scorecard** — it's 3 days past its cut date with every field `TBD`; mechanically it reads `launch failed, regroup` today. Grade it (or apply a written override).
- [ ] **Reconcile `docs/outreach/log.md`** — still the unedited template; log real Tier-1/Tier-2 send status.
- [x] **Commercial surface DECIDED (2026-07-19): `/pricing` + waitlist CUT** — the page advertised tiers/API-keys/email-digests that don't exist (a credibility risk on a trust product) and was already 307-hidden. V1 launches as a **capability announcement** with a strong product, not a paid-tier commercial launch. Rebuild `/pricing` when real tiers ship. (The `/pricing → /` 307 stays as a graceful redirect.)
- [ ] **Close the sHYUSD calibration** (self-flagged `miscalibrated`/HARD-BLOCK) before pitching any stablecoin issuer — it's the asset most like theirs.
- [ ] **Refresh ALL launch-copy asset counts** (founder — messaging + prod-verify; **NOT auto-fixed on purpose**). A 2026-07-19 audit found **22 locations** with inconsistent hardcoded counts: README "**21**", launch drafts "**22**", `twitter-copy-launch.md` "**27**", docs-site "**63**", `docs/spec.html` "**14**". Ground truth I *can* verify: `assets.toml` (the canon, public repo) = **72 assets / ~69 not-marked-inactive**. What I **can't** verify from the repo: the prod **DB `is_active`** count (drives the live screener; the docs-site "63" may reflect it) — that's SSH-only. **So the right number depends on a definition only you can settle** (canon total `72` vs prod-active vs the *calibrated* subset — the calibrated number is the honest one for a trust pitch). Pick one definition + number; then aligning all 22 locations is a 10-min mechanical follow-up. *(Left un-sprayed rather than stamp a number I can't confirm.)*
- [ ] **2026-07-31: run the ADR-0007 kill-rule** — don't let it pass unattended like 07-15 did.

---

## The one-line answer: is everything ready?

**The machine is ready; the launch is not — on purpose.** The V2 line is green, byte-exact,
merge-clean, and the deploy sequence is verified accurate. What's not ready is (1) a handful
of founder-only prod actions (crates publish, the Pyth-gate prod calibration, the wallet/keypair
decision), and (2) the **GTM/demand track, which is genuinely blocked** — no live commercial
surface, no logged outreach, the one warm lead unanswered. **Highest-leverage single action:
merge + deploy** (a buyer sees the pre-hardening build today). **Cheapest: send the Ernani reply.**
