# Pegana — Full Security Audit Report

> Produced with the **solanabr/AUDITOR** skill (v4.3 — 18 checklists / 1,182 items + 100 known attack vectors), run as a two-pass, fan-out audit (Sonnet broad sweep + Opus deep review of the financial math and trust layer). Severity scale 1–10 per AUDITOR `OUTPUT-RULES.md`.

---

## 1. Executive Summary

| | |
|---|---|
| **Repository** | `pegana` (private monorepo) |
| **Commit** | `e8c0dd1` (branch `main`) |
| **Date** | 2026-06-19 |
| **Scope** | FULL (off-chain) — all applicable checklists 08–18 + the off-chain-relevant subset of 02–06; on-chain-only checklists 01/04/07 marked N/A |
| **Auditor** | AUDITOR skill, 12 read-only sub-agents (10× Sonnet broad, 2× Opus deep) |
| **Repository Risk Score** | **7 — HIGH** (driven entirely by transitive Solana-SDK crypto advisories outside Pegana's control). **First-party code: 6 — MEDIUM.** |

### What we found

Pegana is an **off-chain** Solana stablecoin peg-monitoring system (Rust services + Next.js 16 web + TS bot/MCP/SDK). There is **no on-chain Anchor program**, so the entire on-chain attack surface (accounts, signers, CPI, PDAs, program-upgrade authority — checklists 01/02/04/05/07, ~417 items) is N/A.

**No CRITICAL (9–10) and no HIGH (7–8) vulnerability exists in Pegana's own code.** The highest first-party findings are MEDIUM (sev 6): an `X-Forwarded-For` rate-limit bypass, an unauthenticated billed-API proxy (`/api/jupiter-quote`) that can be drained, and a user-email PII leak into Vercel logs. The single sev-7 finding is a **transitive** Rust dependency advisory (`ed25519-dalek 1.0.1`) pulled in by the Solana SDK 2.0 tree — Pegana already pins the patched v2 directly and cannot remove the transitive copy until upstream ships the fix.

The two crown jewels held up under deep adversarial review:

- **Trust layer (on-chain receipt verification):** the ops-signer allowlist is a **genuine hard, fail-closed gate**. The Opus pass attempted to forge a passing `--verify-onchain` for data the ops wallet never signed and **could not** — the SPL-Memo program-ID is pinned, the signer check runs before memo collection and fails closed on any non-parsed RPC encoding, and the bypass a prior `/code-review` caught is gone. The one real gap is a *thesis-scoping* issue: the public "replay" CLI proves the receipt is **tamper-evident and on-chain-anchored**, but does not independently **re-run the methodology** to re-derive the verdict from raw inputs.
- **Peg-classification math (EWMA / discount / NAV-sanity / CR hysteresis):** sound and unusually well regression-tested — every historical incident (JupUSD `out_amount=0`, sHYUSD NAV-sanity, hyUSD CR-deadband) is fixed **with a pinned test**. The intentional `<` boundary in `state_for_cr` is correct (a `<`→`<=` change would be a regression). Two real findings: a `rust_decimal` overflow **panic** reachable in the inline recompute loop (engine-wide DoS, not a misclassification) and a string-truncation classifier with a floor bias + a latent "huge input → PEGGED" footgun.

**Deploy verdict:** safe to remain in production. No finding blocks deploy. The MEDIUM cluster (rate-limit hardening, the Jupiter-proxy drain, PII-in-logs, and the engine panic-safety) should be scheduled this sprint.

### Severity Distribution (deduplicated, first-party + transitive)

| Score | Label | Count |
|-------|-------|-------|
| 10 | 🔴 CRITICAL | 0 |
| 9 | 🔴 CRITICAL | 0 |
| 8 | 🟠 HIGH | 0 |
| 7 | 🟠 HIGH | 1 *(transitive only)* |
| 6 | 🟡 MEDIUM | 5 |
| 5 | 🟡 MEDIUM | 12 |
| 4 | 🔵 LOW | 24 |
| 3 | 🔵 LOW | 6 |
| 2 | ⚪ INFO | 7 |
| 1 | ⚪ INFO | 0 |
| **Total findings** | | **55** |

### Items Verified

| Metric | Count |
|--------|-------|
| Total AUDITOR checklist items | 1,182 |
| Applicable to Pegana (evaluated) | ~765 |
| N/A — on-chain-only (no Anchor program) | ~417 |
| Known attack vectors evaluated | 100 (≈70 off-chain assessed, ≈30 on-chain N/A) |
| Completion | 100% of applicable scope |

---

## 2. Corpus Coverage

| AUDITOR file group | Loaded | Notes |
|---|---|---|
| Root docs (`SKILL`, `OUTPUT-RULES`, `FULL-AUDIT`, `README`, `COSTS`, `QUESTIONS`) | ✅ | Read by orchestrator before fan-out |
| `checklists/01–07` (on-chain) | ✅ | 01/04/07 → N/A; 02/03/05/06 applied off-chain by Opus pass |
| `checklists/08–18` (off-chain + universal) | ✅ | Each assigned to a domain sub-agent |
| `known-vectors/INDEX.md` + 001–100 | ✅ | Distributed by category across sub-agents |
| `discovery/`, `templates/` | ✅ | Orchestrator-level |

> Distribution model: each sub-agent loaded `OUTPUT-RULES.md` + its assigned checklist(s) + its assigned vector files. Collectively every checklist and every vector received a verdict. On-chain-only items render as `[N/A]` with the single reason **"no on-chain Anchor program — no accounts/signers/CPI/PDA/upgrade-authority to validate."**

---

## 3. Scope & Methodology

**Languages / stack detected**

| Area | Lines | Checklists applied |
|---|---|---|
| Rust off-chain (`crates/engine-rs, indexer-rs, dispatcher-rs, api-rs, methodology, common, common-verify, pegana-replay-cli`) | 27,950 | 03, 05, 06, 09, 15-concepts, 16 |
| TypeScript (`bot-ts`, `mcp-ts`, `sdk/typescript`) | 16,812 | 08, 09 |
| TSX (`web/` Next.js 16) | 26,940 | 08, 10 |
| Python (`sdk/python`, webhook examples) | 901 | 14 |
| SQL (`migrations/`) | 2,566 | 09/13 |
| Always-applied (any repo) | — | 11, 12, 13, 16, 17, 18 |

**Execution:** two-pass, read-only fan-out. Pass 1 = 10 Sonnet agents (one per domain). Pass 2 = 2 Opus agents on the crown jewels. No code was modified. The repository's credential-guard hook was respected throughout (masked grep only; no `.env` reads).

**Out of scope (correctly excluded):** the vendored `.venv/` under `docs/examples/webhook-receivers/python-fastapi/` (364k lines of third-party FastAPI deps, not git-tracked, not Pegana code); live server/DNS/Cloudflare/Vercel dashboard state; dynamic/live exploitation (this is a static read-only audit).

---

## 4. Findings (severity ≥ 4)

### 🟠 HIGH (7)

#### [F-01] Transitive Rust crypto advisories via Solana SDK 2.0 / sqlx 0.8 — sev 7 (transitive)
**Checklist 11 / KV-089** · `Cargo.lock`
`cargo audit` reports 6 advisories, all in **transitive** deps Pegana does not control:
- `ed25519-dalek 1.0.1` — RUSTSEC-2022-0093 (double-PK signing oracle) — **sev 7**, via `solana-signature → solana-keypair`. Pegana's own crates correctly pin `ed25519-dalek = "2.1"`; the v1 copy is dragged in by the SDK.
- `curve25519-dalek 3.2.0` — RUSTSEC-2024-0344 (timing side-channel) — sev 6.
- `rustls-webpki 0.101.7` — RUSTSEC-2026-0104/0098/0099 (CRL panic + cert-constraint bypass) — sev 6, via `tungstenite → solana-pubsub-client`.
- `rsa 0.9.10` — RUSTSEC-2023-0071 (Marvin, **no fix exists**) — sev 5, via `sqlx-mysql` macro infra (Postgres-only at runtime; path almost never exercised).

**Impact:** mostly theoretical for an off-chain signer that signs sparingly; the webpki CRL panic is a possible indexer DoS if a malicious TLS server is reached. **Fix:** these cannot be patched directly — add annotated `cargo audit --ignore` entries (the CI already does this with rationale) and track the Solana SDK 2.1 / tungstenite bump. Do **not** `[patch]` dalek (breaks the SDK).

### 🟡 MEDIUM (5–6)

#### [F-02] `X-Forwarded-For` rate-limit bypass — sev 6 · `crates/api-rs/src/rate_limit.rs:73-86`
The limiter trusts the first XFF entry unconditionally. An attacker who can reach `api:8080` directly (bypassing Caddy) rotates the header to get a fresh IP bucket per request, nullifying the 300/min cap on `/v1/auth/*` and webhook creation. **Fix:** reject private/loopback XFF values before trusting them (a real Caddy-forwarded client IP is always public-routable).

#### [F-03] `/api/jupiter-quote` proxy is unauthenticated & unthrottled → billed-key drain — sev 6 · `web/app/api/jupiter-quote/route.ts:17-98`
The Next.js proxy forwards to Jupiter using a server-side key with no rate limit or auth. Anyone can bulk-call it and exhaust the (free-tier-ending-2026-06-30) quota, denying the feature and risking billing surprises. **Fix:** per-IP in-memory limiter (≈30/min) on the route.

#### [F-04] Waitlist email written to logs in plaintext (PII) — sev 6 · `web/app/api/waitlist/route.ts:96-104`
Signup emails are persisted **only** via `console.log` → Vercel function logs (a third-party system) with no retention policy, deletion path, or consent. The privacy policy doesn't mention email collection. **Fix:** persist to a DB table (preferred) or disclose + add consent + a deletion path; never log raw email.

#### [F-05] Telegram `user_id` sent to Sentry as `extra` (PII) — sev 5 · `crates/dispatcher-rs/src/main.rs:417`
`scope.set_extra("user_id", …)` ships a pseudonymous user identifier to Sentry's cloud on every DLQ failure. `send_default_pii:false` does **not** suppress manual extras. The privacy policy claims telemetry never sends chat/user identifiers. **Fix:** replace with `set_tag("alert_id", …)` — the UUID is enough to look the user up internally.

#### [F-06] JWT stored in `localStorage` — sev 5 · `web/lib/auth/context.tsx`
Session JWT in `localStorage` (documented tradeoff). Any future XSS → full session theft for every user. **Fix:** migrate to `httpOnly` + `SameSite=Strict` cookie via an API proxy; short-term keep Sentry text masking and avoid rendering any user HTML.

#### [F-07] No security headers on the Vercel/Next.js frontend — sev 5 · `web/next.config.ts`, `web/vercel.json`
Caddy sets strong headers on `api.*`/`mcp.*`, but the main app (`pegana.xyz`) has **no CSP, X-Frame-Options, or Referrer-Policy** — clickjacking + no script-src restriction. **Fix:** add a `headers()` block (CSP with `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy) for all non-`/embed` routes.

#### [F-08] No per-user rate limit on API mutations — sev 5 · `crates/api-rs/src/rate_limit.rs`
Limiting is per-IP only; an authenticated user behind NAT/rotating IPs can create unbounded subscriptions (storage DoS) and trigger unbounded webhook replays (outbound amplification). **Fix:** add a `RateLimiter` keyed by `telegram_id` + a per-user subscription cap.

#### [F-09] MCP free-tool IP fingerprint spoofable — sev 5 · `mcp-ts/src/middleware/fingerprint.ts:153-162`
Free-tool rate limiting trusts client-supplied `X-Forwarded-For`. If port 8090 is ever directly reachable, the 100/min cap is bypassable. **Fix:** bind MCP to the internal network only; only trust XFF from the known proxy hop; document as a deployment invariant.

#### [F-10] Indexer source URLs lack SSRF validation — sev 5 · `crates/indexer-rs/src/config.rs`, `sources/*.rs`
`SOLANA_RPC_URL`, `JUPITER_API_URL`, `PYTH_HERMES_URL`, etc. flow from env straight into requests with no SSRF guard (unlike the dispatcher's strong webhook guard). An operator-tier env compromise could redirect ingestion to `169.254.169.254`. **Fix:** validate configured URLs against the same IP-classification predicates `pegana_common::webhook_url` already implements.

#### [F-11] Unbounded read of bot `/send` response — sev 5 · `crates/dispatcher-rs/src/main.rs:800`, `retraction.rs:452`, `evidence_reconcile.rs:364`
Three sites use `resp.text().await.unwrap_or_default()` with no cap (the webhook path correctly uses an 8 KiB `read_truncated_body`). A misbehaving/compromised internal bot could OOM the dispatcher during an incident. **Fix:** apply `read_truncated_body` at all three sites.

#### [F-12] `rust_decimal` overflow panic in the inline recompute loop → engine-wide DoS — sev 5 · `crates/methodology/src/discount.rs:32,36`, reached from `crates/engine-rs/src/main.rs:230`
`compute_discount` divides with only an `is_zero()` guard (no near-zero/overflow guard). `rust_decimal` operators **panic** on overflow, and `try_recompute` runs **inline** in the main `select!` loop (no `spawn`/`catch_unwind`), so one pathological tick (e.g. a near-zero intrinsic from an ungated hylo `exp` byte paired with a normal market) **kills the whole engine** — all assets stop classifying. **Fix:** use `checked_div`/`checked_mul` (treat `None` as "no signal → skip"), add an intrinsic magnitude floor, and isolate per-asset recompute so one asset can't take down the rest.

#### [F-13] Trust "replay" verifies hash self-consistency, not methodology re-execution — sev 5 · `crates/pegana-replay-cli/src/main.rs:143-205`
`--verify-onchain` re-hashes the bundle's own `inputs_frozen + expected_computed` and compares to the signed on-chain hash — it does **not** re-run `compute_discount`/`state_for_*`/`transition_decide` to independently re-derive the verdict. So the public claim "anyone can replay/recompute our peg history" is, today, "the receipt is **tamper-evident and on-chain-anchored**," not "the decision is independently recomputed." **Not a forge** (a signed receipt is still required) but a thesis-honesty gap for a grant built on independent verifiability. **Fix:** re-execute the methodology in the CLI and assert it equals `expected_computed`, **or** re-word the public claim.

#### [F-14] GitHub Actions not SHA-pinned — sev 5 · `.github/workflows/*.yml`
All third-party actions use mutable tags (`actions/checkout@v5`, `dtolnay/rust-toolchain@1.90`, `Swatinem/rust-cache@v2`, …). A compromised publisher can move a tag to exfiltrate `PEGANA_REPLAY_PUSH_TOKEN`. **Fix:** pin to commit SHAs + Dependabot/Renovate.

#### [F-15] ESLint non-blocking for `mcp-ts` and `web` — sev 5 · `.github/workflows/ci.yml:149-151,169-171`
Both run lint with `continue-on-error: true` (commented "escalate post-launch" — launch was 2026-06-11). The mainnet x402 MCP and the web app can merge lint/security-plugin violations. **Fix:** remove `continue-on-error` after clearing existing violations.

#### [F-16] No fuzz targets for indexer on-chain byte-decoders — sev 5 · `crates/indexer-rs/src/sources/{hylo,piggybank_pb,solayer_susd}.rs`
Fixed-offset decoders of raw account blobs have length checks but no fuzzing; hylo's `exp` i8 (offset 320) has **no range gate**, so a malformed-but-length-valid blob can yield a garbage intrinsic that feeds F-12's unguarded division. **Fix:** `cargo-fuzz` target + a plausibility gate on the decoded exponent.

#### [F-17] Waitlist form has no consent mechanism (GDPR) — sev 5 · `web/app/api/waitlist/route.ts`
No consent checkbox / privacy-policy reference / opt-in on email submission (Article 7). **Fix:** add explicit consent + link the policy. Pairs with F-04.

### 🔵 LOW (4) — condensed

| ID | sev | Finding | Location |
|---|---|---|---|
| F-18 | 4 | `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` disables the **entire** SSRF guard (not just loopback); no prod assertion | `crates/common/src/webhook_url.rs:114-119` |
| F-19 | 4 | Unbounded `resp.json()` on external API responses (indexer) | `indexer-rs/src/sources/{tokens_xyz,sanctum,dexscreener,jupiter}.rs` |
| F-20 | 4 | `/readyz` leaks internal source names + freshness, unauthenticated | `api-rs/src/routes/health.rs:188-249` |
| F-21 | 4 | Auth error messages distinguish expired vs invalid (minor enumeration) | `api-rs/src/routes/auth.rs` |
| F-22 | 4 | MCP `/metrics` endpoint unauthenticated | `mcp-ts/src/transport.ts:148-151` |
| F-23 | 4 | `verify_alert` concatenates user `alert_id` into outbound URL (Zod-`uuid` mitigated) | `mcp-ts/src/tools/verify-alert.ts:126` |
| F-24 | 4 | Untyped `catch (e)` → unsafe `.message`/`${e}` across bot/mcp/web | multiple TS files |
| F-25 | 4 | Telegram widget loaded without SRI | `web/components/atoms/telegram-login.tsx:72` |
| F-26 | 4 | `JSON.parse(body)` without try/catch (CF Worker example → retry storm) | `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts:159` |
| F-27 | 4 | Python SDK does not URL-encode `alert_id` in path (TS SDK does) | `sdk/python/pegana_sdk/__init__.py:104,130` |
| F-28 | 4 | Webhook-receiver examples use `x-pegana-event-id` as a storage key with no length bound | worker.ts / python-fastapi main.py |
| F-29 | 4 | Python SDK public API typed as `Any` (7 sites) | `sdk/python/pegana_sdk/__init__.py` |
| F-30 | 4 | `@types/bun: "latest"` floating tag | `mcp-ts/package.json:58` |
| F-31 | 4 | `.gitignore` missing `*.pem`, `*keypair*.json`, `.env.production`, `id_rsa`, `.secrets/` | `.gitignore` |
| F-32 | 4 | `TOKENS_XYZ_API_KEY` & `GRAFANA_ADMIN_PASSWORD` missing from `.env.example` | `.env.example` |
| F-33 | 4 | No pre-commit/CI secret scanning (gitleaks/detect-secrets) | repo / CI |
| F-34 | 4 | `mcp-ts` Dockerfile runs as **root** (no `USER`); others use uid 10001 | `mcp-ts/Dockerfile` |
| F-35 | 4 | Mutable image tags (`timescaledb:latest-pg16`, `caddy:2`, `alertmanager:latest`) | `docker-compose.yml` |
| F-36 | 4 | `pre-deploy-check.sh` uses `set -uo pipefail` (missing `-e`) | `scripts/pre-deploy-check.sh:29` |
| F-37 | 4 | No code-coverage measurement in CI (Rust or TS) | `.github/workflows/ci.yml` |
| F-38 | 4 | BPS/CR classifiers use string-truncation parsing → floor bias + latent huge-input→PEGGED | `crates/methodology/src/thresholds.rs:166,247` |
| F-39 | 4 | On-chain memo match doesn't bind `alert_id` (cross-alert hash reuse; short-memo edge) | `pegana-replay-cli/src/main.rs:376-380` |
| F-40 | 4 | `--verify-onchain` 404 → silently skips, run can still exit 0 | `pegana-replay-cli/src/main.rs:214-231` |
| F-41 | 4 | No `SECURITY.md` / published disclosure policy | repo root |
| (others) | 4 | No correlation IDs across services; backup-restore drill never run/logged; RPC fallback field declared but unused; no perf/load regression tests | monitoring/testing |

### 🔵 LOW (3) / ⚪ INFO (2) — noted, inline verdicts only
`fetch_card` static-`&str` format string (use an enum); `unjustified #[allow(dead_code)]` ×3 in dispatcher; bot internal-error string returned to dispatcher; Redis dedup key uses raw `event.asset`; dispatcher HTTP client missing `User-Agent`; WS unauthenticated (public data, by design); `/v1/meta/webhook-ips` exposes server IP (by design); `--verify-onchain --bundle` silent no-op; FastAPI example exposes `/docs`.

---

## 5. Per-Checklist Summary

| # | Checklist | Items | Domain | Verdict | Top finding |
|---|-----------|-------|--------|---------|-------------|
| 01 | Account Validation | 57 | on-chain | **N/A** | no Anchor program |
| 02 | Access Control | 50 | on-chain → off-chain (auth/signer-pin) | PASS | signer-pin hard-gate ✅ |
| 03 | Arithmetic Safety | 61 | engine math | PARTIAL | F-12 panic, F-38 truncation |
| 04 | CPI & PDA | 63 | on-chain | **N/A** | memo program-ID pinned (verifier) |
| 05 | State Machine | 56 | engine FSM | PASS | transitions sound, no stuck states |
| 06 | Economic & Logic | 62 | engine | PASS | multi-source fail-safe to UNKNOWN ✅ |
| 07 | OpSec & Governance | 75 | on-chain ops | mostly N/A | ops wallet off-repo |
| 08 | TypeScript Safety | 60 | bot/mcp/web/sdk | PASS | untyped catch (F-24) |
| 09 | Backend Security | 100 | api/indexer/dispatcher/bot/mcp | PASS | rate-limit (F-02/08/09), SSRF (F-10) |
| 10 | Frontend Security | 76 | web | PARTIAL | CSP (F-07), JWT storage (F-06), jupiter-proxy (F-03) |
| 11 | Supply Chain | 43 | all | PARTIAL | transitive crypto (F-01) |
| 12 | Secrets & Keys | 52 | all | PASS | no secrets in code/history; gitignore gaps (F-31/33) |
| 13 | Deployment & Infra | 77 | devops | PASS | SHA-pin (F-14), mcp root (F-34) |
| 14 | Python Safety | 82 | sdk/examples | PASS | URL-encode (F-27), Any types (F-29) |
| 15 | General Language | 88 | off-chain Rust | PASS | covered via 03/09/16 |
| 16 | Verification & Testing | 58 | all | PARTIAL | no coverage/fuzz (F-16/37), replay scope (F-13) |
| 17 | Logging/Monitoring/IR | 62 | all | PARTIAL | PII in logs (F-04/05), no drill (F-41 area) |
| 18 | Privacy/Compliance/Change | 60 | all | PARTIAL | consent (F-17), sub-processor disclosure |

**Aggregate (applicable items):** PASS ≈ 70% · FAIL ≈ 8% · PARTIAL ≈ 10% · N/A (on-chain) ≈ rest. **Highest first-party severity: 6. Repository Risk Score: 7 (transitive-driven).**

---

## 6. Known Attack Vectors (100/100 verdicts)

| Range | Category | Verdict summary |
|---|---|---|
| KV-001 | Private key leak | **PASS** — verifier/keys are public-only; no key material in code or git history |
| KV-002–030 | On-chain (flash-loan, reentrancy, CPI, PDA, mint, upgrade-hijack…) | **N/A** — no on-chain program. Exceptions assessed off-chain: KV-005 oracle-manip **PASS** (multi-source, fail-safe), KV-006 share-inflation **PASS** (no vault/pool), KV-011 overflow **PARTIAL** (F-12), KV-012 rounding **PARTIAL** (F-38) |
| KV-031–055 | Backend/API (SQLi, NoSQLi, SSRF, CORS, IDOR, JWT, rate-limit, wallet-sig…) | **PASS** mostly — SQLi PASS (sqlx parameterized everywhere), JWT-alg PASS, IDOR PASS, CORS PASS; **FAIL** KV-039 rate-limit bypass (F-02), SSRF partial (F-10) |
| KV-056–075 | Frontend (XSS, clickjacking, localStorage, SRI, CSP, key-in-bundle, console-leak…) | XSS **PASS**, key-in-bundle **PASS**; **FAIL** KV-057 clickjacking & KV-066 missing CSP (F-07), KV-060 localStorage (F-06), KV-063 SRI (F-25), KV-070 console-leak (F-04) |
| KV-076–100 | DevOps/supply-chain (dep-confusion, typosquat, secrets-in-git, CI-injection, docker, TLS, backup…) | secrets-in-git **PASS**, CI-injection **PASS** (no `pull_request_target`), TLS/headers **PASS** (Caddy); **FAIL** KV-089 unpatched transitive (F-01); KV-091 upgrade-authority **N/A** |

---

## 7. Positive Security Controls (verified)

These were independently confirmed and are worth recording:

- **Trust-layer signer pin is a real hard gate** — compile-time allowlist, fail-closed on any non-parsed RPC encoding, SPL-Memo program-ID pinned, exact-hash match. Opus could not forge a passing verification. (`pegana-replay-cli/src/main.rs`)
- **Dispatcher webhook SSRF guard** — two-layer (static + DNS-resolution) blocking RFC1918, loopback, link-local, CGNAT, `169.254.169.254`, IPv6 ULA, IPv4-mapped. (`common/src/webhook_url.rs`)
- **SQL injection: none** — every query across all Rust + TS services uses parameterized `sqlx`/`postgres.js` binding.
- **Webhook receivers (all 3 examples)** — correct Ed25519 verify over `<ts>.<body>`, 5-min replay window, raw-body-before-parse, dual-key rotation, dedup.
- **Credential-guard hook** — PreToolUse + `permissions.deny` genuinely blocks `.env` reads / secret dumps (fail-open, masked grep passes). No secret in code or git history.
- **Financial-math regression discipline** — every past incident pinned by a named test/proptest; no-floats-in-receipt enforced by type + round-trip proptests.
- **x402 payment verification** correctly delegated to `@coinbase/x402` + `@x402/*` (not re-implemented); mainnet-only-with-CDP invariant enforced at boot.

---

## 8. Remediation Roadmap

**P0 — this week (MEDIUM, real user/operator impact)**
1. **F-03** Rate-limit `/api/jupiter-quote` (billed-key drain). *~15 lines.*
2. **F-04 / F-17** Stop logging waitlist emails; move to DB + add consent + privacy disclosure.
3. **F-05** Replace `set_extra("user_id")` with `set_tag("alert_id")` in the dispatcher.
4. **F-12** Make the engine hot-path division panic-free (`checked_*` + intrinsic floor) and isolate per-asset recompute.

**P1 — this sprint (MEDIUM hardening)**
5. **F-02 / F-08 / F-09** Rate-limit hardening: validate XFF, add per-user limits + subscription cap, bind MCP to internal net.
6. **F-07** Add security headers / CSP to `next.config.ts`.
7. **F-10 / F-11 / F-18 / F-19** SSRF-validate indexer source URLs; bound all external-response reads; narrow the loopback bypass.
8. **F-13** Decide: make the replay CLI re-execute the methodology, **or** re-word the public "independently verifiable" claim. (Thesis-critical for the grant.)
9. **F-14 / F-15** SHA-pin GitHub Actions; make `mcp-ts`/`web` lint blocking.

**P2 — next sprint (LOW)**
10. **F-31/32/33** `.gitignore` patterns + `.env.example` entries + a gitleaks pre-commit/CI step.
11. **F-34/35/36** `USER` in `mcp-ts` Dockerfile; pin image tags; add `-e` to `pre-deploy-check.sh`.
12. **F-16 / F-37** Fuzz target + range-gate for the hylo decoder; add coverage tooling to CI.
13. **F-38** Replace string-truncation classifiers with explicit `Decimal`→int conversion.
14. **F-39 / F-40** Bind `alert_id` in the memo match; make `--verify-onchain` 404 exit non-zero.
15. **F-06** Plan JWT → `httpOnly` cookie migration.
16. **F-41 area** Add `SECURITY.md`; run + log a backup-restore drill; disclose Sentry/R2/Vercel sub-processors.

**Track (cannot fix directly)**
17. **F-01** Annotated `cargo audit --ignore` + watch for Solana SDK 2.1 / tungstenite bump to clear the transitive crypto advisories.

---

## 9. Appendix

- **Method:** solanabr/AUDITOR v4.3, two-pass read-only fan-out (10× Sonnet broad + 2× Opus deep). 12 sub-agents, ~1.6M sub-agent tokens.
- **Environment:** Node v25.9.0, Bun 1.3.14, Cargo 1.90.0, `cargo-audit` available; `npm audit` not run (bun lockfiles).
- **Per-domain raw verdict reports** (full item-by-item `[PASS]/[FAIL]/[PARTIAL]/[N/A]` lists) are preserved per sub-agent in this audit's working set.
- **Disclaimer:** AI-assisted static audit. It covers more items than a typical manual review but does not replace a human pentest for business-logic, social-engineering, or live-infrastructure assessment. No dynamic exploitation was performed; findings are from source analysis. Severity is advisory.
