# Pegana Audit Remediation — Design Spec

**Date:** 2026-06-19 · **Commit baseline:** `e8c0dd1` (main)
**Sources:** `REPORT.md` (solanabr/AUDITOR full audit) → adversarial validation (6 agents) → final certainty pass (2 Opus re-verifiers + hand-verified F-12 crux) → independent cross-check (`../../docs/audits/infra-2026-06-19.md`, solana-ai-kit:audit-infra).
**Status:** validated. Every item below survived adversarial re-verification against the code. Fix approaches reflect the corrections that re-verification surfaced.

---

## 1. Goal & non-negotiable safety invariants

Fix the 23 validated-real findings **without changing any observable behavior except the bug being fixed**. The audit confirmed the system is sound; this is surgical hardening, not a rewrite.

**Invariants every change MUST preserve (the "não quebra nada" contract):**

1. **Receipt-hash determinism is sacred.** Any change to `crates/methodology` or `crates/engine-rs` MUST produce byte-identical `canonical_receipt_hash` for all real historical inputs. The two math fixes (F-12, F-38) were *verified bit-identical* during validation — that property must hold in the implementation (gate: a determinism test + the existing 72 proptests stay green).
2. **Behavior-preserving.** Hardening fixes must not change classification, alerting, or API responses. Gate: full suite green (266 cargo + 219 vitest + 72 proptests) **plus** a targeted regression test per fix.
3. **No fix touches the intentional calibration.** The `<` in `state_for_cr` (DRIFT at CR<130), the CR/spread deadbands, the EWMA α, the NAV-sanity threshold — all stay exactly as-is.
4. **One batch = one PR = independently shippable + revertible.** No batch depends on another. Each carries its own test gate.
5. **Frontend header/CSP changes ship `Report-Only` first**, observe, then enforce.
6. **Credential-guard + signer-pin are not weakened.** (Re-confirmed hard-gate; out of scope to touch.)

---

## 2. Scope

**IN — ~15 fix-items** after the senior-review challenge cut the original 22. The batches in §4 are the authoritative list.

**Senior-review cuts (2026-06-19) — removed as belt-and-suspenders / YAGNI / generic:**
- **F-39** (bind alert_id in memo) — signer-pin + sha-binds-asset+time make forgery cryptographically impossible; pure belt-and-suspenders.
- **F-08** (per-user sub cap) — theoretical DoS, auth-gated, beta scale → YAGNI.
- **F-18** (narrow `ALLOW_LOOPBACK`) — test-only env var, no prod path.
- **F-16** (hylo `exp` range gate) — cosmetic, redundant with F-12.
- **F-28** (event-id length guard) — needs a forged *signed* header → near-impossible.
- **Full CSP (F-07)** — de-scoped: `'unsafe-inline'` (forced by Tailwind/JSON-LD/next-themes) guts the anti-XSS value. → ship only the cheap high-value headers (`frame-ancestors 'none'` / `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`); full nonce-based CSP → roadmap.
- **F-35** image pins — keep only `timescaledb:latest-pg16` (real outage risk); `caddy:2`/`alertmanager` marginal → cut.

**Implementation status (2026-06-19):**
- ✅ **F-12 DONE + verified** — `compute_discount` (both paths) + `state.rs:346` now use `checked_div`/`checked_sub` → `None` on overflow. New regression test `micro_nonzero_intrinsic_returns_none_not_panic` (red→green); methodology suite **73 passed / 0 failed**, 72 bit-identical proptests intact (receipt determinism preserved); `engine-rs` compiles.
- ✅ **F-31** (.gitignore key-material patterns), **F-32** (`.env.example` GRAFANA/TOKENS keys), **F-15** (ESLint blocking — both lints verified clean) DONE.
- ⏳ Queued: F-13, F-03, F-34, F-22, F-05, F-04, F-40, F-42, F-41b, F-26, F-07 cheap-headers.

**OUT — 27 cut findings** (false-positive / design-decision / box-ticking / fix-would-break). Listed with rationale in Appendix A so the map is complete and the cuts are auditable.

**ROADMAP — 3 deferred features** (not implemented here, tracked in §5).

---

## 3. Verification strategy (how each fix is proven not to break anything)

| Layer | Gate |
|---|---|
| Engine/methodology | New regression test reproducing the exact bug input + `cargo test --workspace` (266) + 72 proptests + a **receipt-hash determinism** assertion over a fixed historical bundle. |
| Rust backend | New unit/integration test per fix + existing `api-rs`/`dispatcher-rs` tests. |
| Web | The affected user flow exercised (Playwright or manual): jupiter-quote widget logged-out, waitlist signup, Telegram login + Sentry Replay under CSP. CSP ships Report-Only first. |
| DevOps/config | `cd web && bun run lint` / `cd mcp-ts && bun run lint` green (already verified clean); `docker compose config` + container boots as non-root; `deploy.sh` dry-run. |
| Ops | Drill executed on a scratch DB; result logged. No prod mutation. |

---

## 4. The fixes (by batch, risk-ordered)

### Batch 1 — Engine math (determinism-critical · ship first · isolated PR)

**F-12 · sev 5 · `rust_decimal` overflow panic → engine crash-loop**
- **Root cause:** `crates/methodology/src/discount.rs:32,36` divide with only an `is_zero()` guard; `rust_decimal 1.42` operators **panic** on overflow. `try_recompute` runs **inline** in the engine `select!` loop (`crates/engine-rs/src/main.rs:230`) with no `catch_unwind`, so one panic exits the process. **Reachability (hand-verified):** only during a Hylo **hyUSD undercollateralization (CR<1)**, where `free_collateral_usd = reserve_usd − hyusd_mc` becomes a tiny positive rounding residual (~1e-22) → `xSOL NAV < 2.5e-27` → `market/intrinsic` overflows. With `restart: unless-stopped` this becomes a crash-loop = **zero monitoring of all assets during a real depeg.**
- **Change (✅ implemented):** in `compute_discount`, replace `Some(Decimal::ONE - (market / intrinsic))` and the SOL-path `m_sol / i_sol` with checked ops returning `None` on overflow (`market.checked_div(intrinsic).and_then(|q| Decimal::ONE.checked_sub(q))`). `None` is the **existing H8 "no signal → skip publish"** path. Apply the same to `crates/engine-rs/src/state.rs:346` (`Decimal::ONE / p`, the FX-cross invert). **Scope correction (senior review):** the SPEC originally also listed `crates/indexer-rs/src/sources/hylo.rs:180,273` — those divisions produce *small* results (normal/normal, tiny/large) and do **not** overflow; the panic is purely the engine dividing `market` by a micro intrinsic. Hylo dropped from the fix.
- **Blast-radius: ZERO.** `checked_div`/`checked_sub` return identical `Some(x)` for every non-overflowing input; every legitimate discount is `|d|<1`. The only behavior change: inputs that previously *crashed* now return `None` (skip) — semantically correct (xSOL≈0 during undercollateralization *should* skip, not crash).
- **Verification:** new test `compute_discount_no_panic_on_micro_nav` feeding `intrinsic = Decimal::new(1, 27)`, `market = 200` → asserts `None` (today it panics). + determinism gate + 72 proptests green.
- **Rollback:** revert the PR; pure-function change, no migration.

**F-38 · sev 4 · string-truncation classifier (floor bias + huge-input→PEGGED footgun)**
- **Root cause:** `crates/methodology/src/thresholds.rs:166-173` (`state_for_bps_discount`) and `:247-253` (`state_for_cr`) parse via `(v*10000).to_string().split('.').next().parse::<u32>().unwrap_or(0)` — truncates (floor) and, if `v*10000 > u32::MAX`, falls to `unwrap_or(0)` → **PEGGED** (most-reassuring, wrong). Unreachable in the engine today (gated by `is_plausible` `|d|<1`), but it's a `pub` fn — a future caller would hit the footgun.
- **Change:** `(v.abs() * Decimal::from(10_000u32)).trunc().to_u32().unwrap_or(u32::MAX)` (and `to_i64().unwrap_or(0).max(0)` for CR). Fail-loud default (`u32::MAX` → strictest state), not PEGGED. **Do not touch the `<`/`>=` match arms.**
- **Blast-radius: ZERO — verified bit-identical** during validation (0 mismatches sweeping bps `[-0.04,0.04]`@1e-5 and CR `[0.5,2.0]`@5e-4). Only the unreachable saturating default changes (PEGGED→BLACK_SWAN).
- **Verification:** bit-identical sweep test + existing pinned regression tests green.

**F-16 · sev 1 · hylo `exp` range gate (fold-in, optional)**
- `crates/indexer-rs/src/sources/hylo.rs:430` — add `if !(-20..=10).contains(&exp) { return None; }` in `ufix_to_decimal` for self-documentation. Cosmetic; the real fix is F-12. Include only if trivial.

---

### Batch 2 — Trust layer (docs reword + small CLI hardening)

**F-13 · sev 3-4 (honesty/integrity) · public CLI claims "re-executes the methodology" — FALSE**
- **Root cause:** the CLI only re-hashes the recorded receipt (`verify()` never calls `compute_discount`/`state_for_*`/`transition_decide`; ADR-0019 documents this). But **7 public surfaces** claim recompute: `crates/pegana-replay-cli/Cargo.toml:11`, `crates/pegana-replay-cli/src/main.rs:1-7`, `docs/pegana-trust-layer-v0.1.0/10-distribution.md:14`, `web/app/releases/page.tsx:40`, `tools/pegana-replay-public/README.md:9` + `:53`, `tools/pegana-replay-public/METHODOLOGY.md:204-213` (the last two are **live on the public GitHub mirror**).
- **Change:** reword all 7 to the honest claim — *"verifies the receipt's canonical hash and its signer-pinned on-chain anchor (tamper-evidence), so anyone can confirm the published history wasn't altered."* No code change. **Grep gate:** `re-execut|reproduce the methodology|recompute|byte-for-byte` returns no false-claim hits post-edit.
- **Blast-radius:** docs/strings only. Zero behavior.
- **Roadmap (§5):** true independent re-derivation as a future feature.

**F-39 · sev 2-3 · memo match doesn't bind `alert_id`**
- `crates/pegana-replay-cli/src/main.rs:376-380` — require `parts.len()==4` and `parts[2]==alert_id.to_string()` in addition to scheme + sha. Update the `memo_match_middle_fields_lenient` test to assert binding. Engine always emits 4 fields → rejects nothing legitimate. Defense-in-depth (sha already binds asset+time).

**F-40 · sev 3 · `--verify-onchain` 404 silently skips → can exit 0**
- `crates/pegana-replay-cli/src/main.rs:223-226` — parse the 404 body's `commit_status` (the API already returns it, `audit.rs:524-589`): keep `exit 0` for `not_applicable` (DRIFT/cost-gated — never anchored, preserves UX); print a distinct `ANCHOR NOT VERIFIED (<reason>)` and exit non-zero for `pending`/`retry_exhausted`/`wallet_drained`/`persistence_failed`. New test per status.

---

### Batch 3 — API / dispatcher (Rust)

**F-05 · sev 3 · Telegram-correlatable `user_id` → Sentry `set_extra`**
- `crates/dispatcher-rs/src/main.rs:417` — drop `set_extra("user_id", …)`; `alert_id` is already attached (`:418`) and is sufficient to join the user in-DB. Lossless. Matches the privacy-policy claim.

**F-08 · sev 3 (Tier-3) · no per-user subscription cap**
- `crates/api-rs/src/routes/me.rs` (create-sub path) — `SELECT count(*) … WHERE user_id=$1` guard before insert (e.g. cap 100), return 429/400 over cap. New test. No effect on existing users below the cap.

**F-18 · sev 3 (Tier-3) · `WEBHOOK_SSRF_ALLOW_LOOPBACK` disables the whole guard**
- `crates/common/src/webhook_url.rs:114-119,153` — narrow the bypass to loopback hosts only (keep https + denylist for everything else); add a non-test `debug_assert!`/warn if the env is set. The 3 test files that set it still pass (they target loopback).

---

### Batch 4 — Web frontend (careful · Report-Only first)

**F-03 · sev 3 · `/api/jupiter-quote` billed-key drain**
- **Correction from validation:** the route is a **public** client widget (`exit-liquidity.tsx`) — JWT-gating would break it for logged-out visitors, and an in-memory limiter is useless on Vercel serverless. **Fix:** Vercel Edge Middleware enforcing same-origin/referer + a per-IP rate-limit via Vercel KV/Upstash (single-region, shared state) on `/api/jupiter-quote`; OR a non-secret signed client token minted at page render. Verify the widget still works logged-out + abuse is throttled.

**F-04 · sev 3 · waitlist email logged in plaintext (PII)**
- `web/app/api/waitlist/route.ts:96-104` — stop logging the raw email: write to a `waitlist` DB table (preferred) or log a salted hash only. Keep the existing 5/IP/hr limiter. Verify signup still works; no raw email in Vercel logs.

**F-07 · sev 5 · no CSP / security headers on the Vercel app**
- `web/next.config.ts` — add `async headers()`. **Exhaustive origin list (validated — missing any breaks the site):** `script-src 'self' 'unsafe-inline' https://telegram.org https://va.vercel-scripts.com`; **`frame-src https://oauth.telegram.org`** (login iframe); **`worker-src blob:`** (Sentry Replay); `connect-src 'self' https://*.sentry.io` (ingest is same-origin tunneled, include as fallback); `style-src 'self' 'unsafe-inline'` (Tailwind/framer style props + JSON-LD/next-themes inline scripts); `img-src 'self' data: blob: https://t.me`; `frame-ancestors 'none'`; `base-uri 'none'`. Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`. **Ship `Content-Security-Policy-Report-Only` first**, watch violations ~1 week, then flip to enforcing. Leave the `/embed/*` routes (which set `frame-ancestors *`) untouched.

---

### Batch 5 — MCP / Caddy

**F-22 · sev 2 · MCP `/metrics` publicly reachable**
- `Caddyfile` `mcp.pegana.xyz` block — add `@metrics path /metrics` + `respond @metrics 403` (or IP-allowlist) before `reverse_proxy`. Internal Prometheus scrape uses the docker network, unaffected. No mcp-ts code change.

---

### Batch 6 — DevOps / config (additive · low risk)

**F-15 · sev 5 · ESLint non-blocking (zero blast — both lint-clean today, verified)**
- `.github/workflows/ci.yml:151,171` — remove `continue-on-error: true`.

**F-42 · MEDIUM (kit cross-check) · 4 workflows lack least-privilege token**
- `.github/workflows/{ci,lighthouse,reproducible-build,web-e2e}.yml` — add top-level `permissions: { contents: read }` (elevate per-job only where needed). `sync-pegana-replay.yml` already correct. **Supersedes the cut F-14** (SHA-pin) as the better/cheaper mitigation of the same risk.

**F-32 · sev 3 · `.env.example` missing required keys**
- Add `GRAFANA_ADMIN_PASSWORD` (compose hard-fails without it — `${...:?required}`) and `TOKENS_XYZ_API_KEY` with generation hints. Additive.

**F-31 · sev 3 · `.gitignore` gaps**
- Add `*.pem`, `*.key`, `*keypair*.json`, `.env.production`, `.env.staging`, `id_rsa*`, `id_ed25519*`, `.secrets/`. Additive — cannot break anything.

**F-34 · sev 3 · mcp-ts Dockerfile runs as root**
- `mcp-ts/Dockerfile` — add `USER bun` (the `oven/bun` base ships the `bun` user; **do NOT** copy the Rust `useradd uid-10001` pattern — it would need an explicit writable HOME + chown). Mirror `bot-ts/Dockerfile:19`. Verify bun can write its cache (`/tmp`/`$HOME/.bun`).

**F-35 · sev 2-3 · mutable prod image tags**
- `docker-compose.yml` — pin `timescale/timescaledb:latest-pg16` (the risky one — a breaking DB pull = outage) and `prom/alertmanager:latest` to the exact versions currently running on Hetzner (`docker inspect` first). `caddy:2` may stay (semver-stable).

---

### Batch 7 — Ops (no code)

**F-41b · sev 4 · encrypted backup restore never drilled**
- Run `scripts/pg-restore.sh restore <latest> --into pegana_restore_test` on Hetzner, validate the `~/.pegana-backup-key` decryption + row counts, create `docs/runbooks/drill-log.md` with the result. Pure ops; no deploy, no code.

---

### Batch 8 — Example code (lowest priority)

**F-26 + F-28 · sev 2-4 · CF-Worker webhook example**
- `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts:159` — wrap `JSON.parse(body)` in try/catch → 400; `:146-154` — guard `x-pegana-event-id` length (`<= 100`) before KV use. Example code users copy; single commit.

---

## 5. Roadmap (deferred — NOT in this remediation)

- **F-13b — true independent re-derivation:** make the CLI re-run `compute_discount`/`apply_ewma_pure`/`state_for_*`/`transition_decide` from `inputs_frozen` and assert `== expected_computed`. Real feature: engine-side guards (staleness/force-unknown) live outside the methodology crate and would FALSE-FAIL legit historical receipts unless first moved to a shared crate. Track for the grant thesis.
- **F-41c — RPC failover:** wire the declared-but-unused `solana_rpc_url_fallback` into the 3 indexer RPC sources. Do when Helius has its first availability event.
- **F-06 — JWT → httpOnly cookie:** migrate web session out of `localStorage`. Auth-hardening sprint; cross-origin `api.pegana.xyz` makes it non-trivial (needs server cookie + CORS credentials). Low XSS surface today (no user-HTML rendered).

---

## 6. Sequencing

Ship in this order; each is an independent PR with its own green gate:
1. **Batch 1** (engine math) — highest value, zero behavioral risk, determinism-gated.
2. **Batch 6** (devops/config) — additive, near-zero risk, fast wins (F-15, F-31, F-32, F-42).
3. **Batch 3** (API/dispatcher) — F-05 first (one-liner), then F-08/F-18.
4. **Batch 5** (Caddy /metrics) — one config line.
5. **Batch 2** (trust docs + CLI) — F-13 reword is urgent (false public claim); F-39/F-40 with it.
6. **Batch 4** (web) — F-04, then F-03, then F-07 **Report-Only → observe → enforce**.
7. **Batch 7** (ops drill), **Batch 8** (example) — when convenient.

---

## Appendix A — CUT findings (27, with rationale)

Verified non-actionable under adversarial re-verification (revive list was **empty**):

| ID | Why cut |
|---|---|
| F-01 | Transitive crypto advisories — already CI-`--ignore`'d with per-advisory rationale; unexploitable in-context (no MySQL runtime, rustls patched in live path, sparse signer). |
| F-02 | XFF bypass — `api:8080` unexposed in prod + Caddy (no `trusted_proxies`) **strips** spoofed XFF. *Record the real rationale* (not "Caddy forwards a private IP" — that was wrong); revisit if a proxy chain / Cloudflare is ever added. |
| F-06 | JWT in localStorage — documented tradeoff, no user-HTML XSS sink. → roadmap. |
| F-09 | MCP fingerprint — port internal, Caddy strips XFF. |
| F-10 | Indexer SSRF — operator-env URLs only, no user input. |
| F-11 | Unbounded bot `/send` read — internal + 10s timeout. |
| F-14 | SHA-pin Actions — **superseded by F-42** (least-privilege `permissions:` is the better/cheaper mitigation for a private repo). |
| F-17 | Waitlist GDPR consent — `/pricing` 307-redirected to `/`; form unreachable; no retained PII store. |
| F-19 | Unbounded `resp.json()` — 15s whole-request timeout bounds it. |
| F-20 | `/readyz` source names — sources public in `assets.toml`/docs. |
| F-21 | Auth-error enumeration — "expired/revoked" only after signature verifies; attacker only ever gets "invalid". |
| F-23 | `verify_alert` URL — Zod `.uuid()` blocks injection. |
| F-24 | Untyped `catch (e)` — `${e}` is always safe; one internal-only path. Cosmetic. |
| F-25 | Telegram SRI — infeasible (no published versioned hash); server HMAC is the real control. |
| F-27 | Python SDK URL-encode — UUID inputs only. |
| F-29 | Python SDK `Any` — intentional v0.1.0 placeholder. |
| F-30 | `@types/bun: latest` — devDep, not in prod image, lockfile-pinned. |
| F-33 | gitleaks — redundant with cred-guard for a solo private repo. |
| F-36 | `pre-deploy-check.sh` `set -e` — **fix would BREAK** the run-all-gates accumulator; the script's error handling is already correct. Dropped. |
| F-37 | CI coverage — vanity metric; tests already pass. |
| F-41a | `SECURITY.md` — zero value for a private repo (add when public). |
| F-41d | Correlation IDs — current Sentry-tag + Grafana-time-window IR works at this scale. |
| (SSL monitor) | Caddy ACME auto-renews + is health-monitored. |
| (sub-processors) | Privacy page already names R2+Sentry; add Vercel when next touched. Box-ticking pre-revenue. |
| (data export automation) | Manual email deletion right-sized for current scale; documented design. |
| (hylo fuzz target) | Decode is `Option`-safe + band-gated; the real fix is F-12. |
| (F-12 "any-tick" framing) | Corrected: reachable only in the Hylo CR<1 residual path (kept as F-12, narrowed). |
