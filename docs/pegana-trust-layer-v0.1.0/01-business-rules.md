> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 01 — Business Rules

> Read this before any other file. These rules govern the entire Trust Layer release. Violations are bugs, not features.

---

## 1. Product identity

**Pegana IS**:
- A peg-risk oracle for Solana assets (stablecoins, LSTs, yield-bearing wrappers, CDPs, synthetic-leveraged tokens, index baskets).
- An open-source, verifiable computation log: every alert is reproducible bit-for-bit.
- A multi-surface product: Telegram bot + REST API + MCP server + Web dashboard + Webhooks + SDKs + Embed widget + RSS feeds + CLI verifier.
- Mainnet-only. No devnet/testnet pretensions.

**Pegana IS NOT**:
- A wallet tracker, NFT alert system, or portfolio dashboard.
- An autonomous-execution product (we signal; we do not act on user funds).
- A regulatory audit firm (SOC 2, ISO 27001 — out of scope).
- A financial advice provider.
- A general-purpose Solana monitoring tool (we monitor asset peg state, not transaction-level threats — that's Hexagate/Hypernative/Range's job).
- A risk scoring service for protocols (Pegana scores assets; DefiSafety/DeFi Score score protocols — complementary, not competitive).

---

## 2. Hard NO list (anti-patterns to refuse on sight)

These items will be tempting to add or ship. They will hurt the product. Refuse them:

1. **Never promise sub-1-second latency in public pricing or marketing** before calibration v1 publishes p95/p99 numbers. Any claim of "real-time" today is a credibility burn waiting to happen.

2. **Never remove Jupiter quotes from the engine signal pipeline.** They are the executable market price. Replacing them with Pyth-only or DexScreener-only destroys the "intrinsic vs market spread" semantic that makes Pegana different from a price oracle.

3. **Never expand scope to wallet/NFT/portfolio alerts.** Tempting because it broadens audience; fatal because it dilutes the core thesis.

4. **Never ship "autonomous execution" as a core product.** Pegana signals; agents and users decide. The moment Pegana acts on funds, the entire trust posture collapses.

5. **Never edit `docs-site/pricing.mdx`** (the "no tiers, free during alpha" stance) before 2026-06-10 calibration verdict. Reversibility of public pricing claims is LOW — once tiers are announced and partners forward the email, retreating to "free for everyone" burns credibility worse than just delaying.

6. **Never launch loud** (Twitter announcements, AMAs, paid marketing) before webhook dogfood report (06-03) AND calibration v1 report (06-10) close. Loud launch + unmeasured product = predictable disaster.

7. **Never treat Parity (Colosseum) or StableGuard as competitors.** They are prospects/customers. Parity needs a state oracle for prediction market settlement; StableGuard needs a trigger for insurance payouts. Both pipe into Pegana's output.

8. **Never claim "audit" in a regulatory sense.** Our audit is "verifiable computation log" — we always include the disclaimer "not SOC 2, not regulatory audit, not financial advice."

9. **Never commit `assets.toml` threshold changes** without an entry in `crates/methodology/CHANGELOG.md` explaining why. The `/calibration.xml` feed surfaces every change publicly; cryptic messages erode trust.

10. **Never let an `alert_evidence` insert failure abort an alert dispatch.** Order of priority: deliver the alert > persist evidence. We retry persistence; we never silence the alert.

---

## 3. Calibration gates (the timeline anchor) — amended per ADR-0001, ADR-0005

CALIBRATION-v1.md is already running. Trust Layer v0.1.0 must respect its calendar.

| Date | Gate | What must close |
|---|---|---|
| 2026-05-27 | Calibration v1 START (pre-evidence) | `FEATURE_PUBLIC_ALERTS=false`, dogfood-only chat |
| **2026-06-01** | **Phase 3 prod deploy** | alert_evidence + on-chain commit live in dogfood mode (per ADR-0005) |
| 2026-06-03 | **Webhook dogfood report** | Delivery count, 2xx rate, dead-letter count, p99 latency |
| 2026-06-10 | **Calibration v1 verdict** | Computed mechanically per ADR-0001 from the 2026-06-01 → 2026-06-10 evidenced sub-window. Pre-06-01 data is informational only. |
| 2026-06-11 | **Public launch** | `FEATURE_PUBLIC_ALERTS=true`, Trust Layer ships, audit URLs in alerts |

**Deploy gate rule**: PUBLIC LAUNCH (06-11) requires the mechanical verdict per ADR-0001 returning SHIP. The 06-01 prod deploy is dogfood-only (no public surface flip) — it exists to generate verifiable calibration data. If verdict = TUNE, re-run 7 days (slip to 06-17 min). If verdict = EXTEND, +14 days (slip to 06-24 min).

**This is non-negotiable.** A Trust Layer that ships with miscalibrated thresholds produces noisy alerts that destroy the value of the audit infrastructure being built around them.

---

## 4. Scope of v0.1.0

### IN scope

- New `pegana-methodology` crate (pure functions, RFC 8785 hashing, semver)
- New `pegana-replay-cli` binary (cargo-dist distribution, Sigstore attestations)
- Append-only `alert_evidence` table (migration 0028)
- Codify `alert_events` view (migration 0029)
- `methodology_versions` lifecycle table (migration 0030)
- `alert_evidence.onchain_tx_sig` column (migration 0031)
- 5 new REST endpoints (`/v1/audit/:id`, `/v1/audit`, `/v1/audit.csv`, `/v1/audit/:id/onchain`, `/v1/audit/:id/replay-bundle`)
- 1 new MCP tool (`verify_alert`), 1 extended (`subscribe_peg_events`)
- Evidence URL propagation to Telegram (5 templates × 2 languages = 10 locale updates) and webhook payload
- 7 new web pages (`/audit`, `/audit/[id]`, `/methodology`, `/embed/[asset]`, `/embed/demo`, `/pricing` waitlist, `/agents`)
- Dynamic OG images for `/audit/[id]`
- 2 RSS/Atom feeds (`/audit.xml`, `/calibration.xml`)
- Embed widget (`/embed.js` script + `/embed/[asset]` iframe)
- CSV streaming export (`/v1/audit.csv`)
- 2 auto-generated SDKs (`@pegana/sdk-ts`, `pegana-sdk`)
- Solana Attestation Service integration for critical alerts (on-chain receipt commitment)
- Reproducible build CI verification + Docker base image digest pinning
- **5 new assets** in passive calibration (Phase 0): **JupUSD, JLP, EURC, dzSOL, vSOL**. (USDe and USDS are already in `assets.toml` as active; calibration data is being captured for them in v1 dogfood.)
- 5 new Prometheus metrics
- Trust strip on home page (`assets_in_drift` exposed)
- Updated launch artifacts (asset count, methodology copy)

### OUT of scope (deferred to sub-projects B+ or Phase 14/15)

- Venue-aware feeds (Phase B)
- Pyth Lazer integration (Phase B)
- Oracle health monitoring beyond Pyth confidence (Phase B)
- Loop exposure tracking across Kamino/Jupiter Lend/MarginFi/Drift/Loopscale (Phase C)
- Cascade simulator (Phase C)
- Wallet-level risk monitoring + `/connect <wallet>` (Phase D)
- Predictive signals: whale tracking, mint/burn anomalies, TVL flow (Phase E)
- Multi-sig or RBAC for calibration changes (future, when team grows past 1)
- Public calibration editor UI (future)
- SIWS / wallet-based login (Phase B+ if pricing demands it)
- API keys management (Phase 15 — only if pricing tiers activate)
- Pricing tiers ACTIVE billing (Phase 15 — gated by design partner feedback)
- Backtest 2025-10-10 publication (Phase 14 — runs AFTER Trust Layer v0.1.0 ships stable; USDe is already monitored in production so backtest replays methodology against historical USDe data, paired with live coverage)
- Bot `/connect`, `/portfolio`, `/wallet` commands (Phase D)
- Additional asset classes: tokenized equities (xStocks), private credit (ACRED), money market funds (USYC) — Phase 14+ as demand validates

---

## 5. Deploy gate (the "ship verdict" rule) — amended per ADR-0001, ADR-0002, ADR-0008

PUBLIC LAUNCH (06-11) requires ALL of the following:

1. ✅ Calibration v1 verdict = SHIP per the mechanical rule in **ADR-0001** (computed from 06-01→06-10 evidenced sub-window per ADR-0005)
2. ✅ Webhook dogfood report published with delivery rate ≥ 99%, p99 latency ≤ 5s
3. ✅ All Trust Layer acceptance criteria in `12-acceptance-criteria.md` met
4. ✅ Per-asset activation decided per **ADR-0002** (per-asset, not all-or-nothing; JupUSD may drop without slip)
5. ✅ `pegana-replay` CLI passes on all 4 platforms (macOS arm64/x64, Linux x64, Windows x64) AND default install verifies Sigstore attestation per **ADR-0008**
6. ✅ Solana Attestation Service (or SPL Memo fallback per ADR-0004) tested on devnet
7. ✅ Reproducible build CI workflow green on the release commit
8. ✅ Engine wallet (`PEGANA_COMMIT_KEYPAIR`) funded with ≥ 0.5 SOL on mainnet; on-chain commit retry+burst+alarm policy per **ADR-0004** live

If any item is missing on 2026-06-10, deploy slips per the verdict rule (06-17 TUNE, 06-24 EXTEND). No exceptions for "we'll fix it later."

---

## 6. Outreach posture

Pegana competes on **trust + auditability + Solana-native depth**, not on coverage breadth (CoinGecko/DefiLlama win that) or enterprise sales (Chaos Labs wins that).

### Design partners (PRIORITY 1)

Two confirmed prospects from prior strategy session:

1. **Parity (Colosseum)** — prediction market on peg stability via Pyth. They need a *state oracle* saying "this asset depegged". Pegana's `subscribe_peg_events` + on-chain attestations are exactly the input they need for settlement triggers. **Outreach in Phase 13.3.**

2. **StableGuard** — insurance protocol for stable-asset depeg. They need a trustworthy trigger for payout decisions. Pegana's critical-state alerts with on-chain commitment are insurance-grade signals. **Outreach in Phase 13.4.**

### Distribution channels (PRIORITY 2)

3. **SendAI / solana.new** — submit Pegana as a concept entry under "Peg-Risk Oracle for Agent Allocators" category. Free distribution to VC-aligned audience. **PR in Phase 13.5.**

4. **DefiLlama** — submit category-creation PR for "Risk Oracle" with Pegana as first listing. Adapter exposes `tvs_protected` (TVL of protocols consuming Pegana signals). **Phase 13 (post-launch).**

5. **Solana Foundation STRIDE program** — apply to be a data source feeder for protocol monitoring under STRIDE's incident response pipeline. **Phase 14+ (post-launch, after design partners signed).**

### Loud channels (PRIORITY 3, gated by data)

6. **Twitter / Farcaster** — only after calibration v1 publishes real numbers. Demo: live `assets_in_drift` ticker on home + screen recording of `pegana-replay --alert-id <real-uuid>` returning PASS.

---

## 7. Pricing rules (post-launch, NOT in v0.1.0)

Pricing tiers ACTIVATE only in Phase 15, gated by:

1. Calibration v1 verdict = "ship" (06-10) ✓
2. At least 1 design partner signed (Parity or StableGuard committed to integration)
3. p95/p99 latency measured per asset (no claim made without data)

When activated, **proposed tiers** (subject to design partner negotiation):

- **Free**: 5-min delayed alerts, audit URLs, public RSS/Atom feeds, MCP free tools (`get_assets`, `get_asset_state`, `verify_alert`, `get_methodology`)
- **Pro**: current latency (whatever calibration measured), WebSocket access, all webhook delivery features, paid MCP tools at standard pricing ($0.0005-0.005/call)
- **Realtime** (waitlist): sub-second alerts (only if calibration measures it), priority RPC routing, dedicated WebSocket connection with replay buffer
- **Enterprise**: custom SLO, custom thresholds, on-chain attestations published with custom signing key, white-label embed widget

Until Phase 15 activates, the `/pricing` page shows **waitlist only** ("Free now, Pro/Realtime in development — join the list"). See `09-web-pages.md § /pricing`.

---

## 8. Methodology change protocol

Threshold changes in `assets.toml`, new asset additions, or methodology code changes follow this protocol:

1. **Code change**: PR with the diff, CHANGELOG.md entry explaining why, version bump per semver rules (see `05-methodology-crate.md § Versioning`).
2. **CI gate**: `cargo build --locked --frozen` passes; reproducibility check passes; all existing tests pass; if behavior changes, regression test added.
3. **Calibration**: if it's a new asset, run 14-day passive calibration (`active=false` in `assets.toml`) before going live. Capture p99 in Grafana panel.
4. **Public surface**: change reflected in `/calibration.xml` feed automatically (git log derived) AND on `/methodology` page (CHANGELOG rendered at build time).
5. **Methodology lifecycle**: if a version is found broken, update `methodology_versions.status = 'broken'` with reason; past alerts emitted by that version show a warning banner on `/audit/[id]`.

---

## 9. Surface tone & language

Each surface speaks a slightly different language because the audience differs:

- **Telegram bot** (humans, mostly Brazilian + English-speaking retail/power-users): casual but factual. Templates render HTML with `<b>`/`<code>`/`<a>`. PT-BR and EN both supported. Evidence link appended as `🔍 Evidence: <a href="...">Evidence (audit ABC123)</a>`.
- **Web `/audit/[id]`** (humans, mostly skeptics or partner engineers): factual, no marketing copy. Receipt JSON sections labeled plainly. OG card optimized for shareability.
- **Web `/methodology`** (humans, mostly skeptics/journalists/auditors): explicit disclaimer about "not SOC 2", clear install snippet, lifecycle states explained.
- **Web home `/`** (humans, mostly first-time visitors): trust strip with `assets_in_drift` live count. Methodology one-liner: "Oracle/intrinsic + executable market quote = spread." No marketing fluff.
- **Embed widget** (machine-rendered on partner sites): minimalist badge, asset symbol + state dot + "Pegana ↗" attribution.
- **MCP tools** (LLM agents): English-only descriptions for now (i18n deferred). Structured `content` (text JSON for LLM parsing) + `structuredContent` (typed for client parsing). Every alert response includes `evidence_url`.
- **REST API** (developers): standard REST conventions, OpenAPI 3.1 spec, HTTP status codes per RFC 9110, cache headers on immutable resources.
- **CLI `pegana-replay`** (skeptics): minimal output by default; `--quiet` for CI use; `--verify-onchain` for full chain-of-trust check.

---

## 10. Disclaimers (required on all public surfaces)

Every page that displays an alert or methodology version must carry, somewhere visible:

> Pegana is a verifiable computation log for peg-state decisions. It is **not** SOC 2 compliance, **not** a regulatory audit, and **not** financial advice. Verify our claims; do not substitute them for your own judgment.

This disclaimer is rendered on `/methodology`, `/audit/[id]`, `/audit`, `/embed/[asset]`, and the bot `/help` command. See `09-web-pages.md § Disclaimers`.

---

## Cross-references

- For technical scope details, see `02-architecture.md` and `04-data-model.md`.
- For asset list including JupUSD, dzSOL, vSOL details, see `03-asset-coverage.md`.
- For deploy gate operational details, see `plans/13-phase-13-deploy-outreach.md`.
- For acceptance criteria mapped to each rule above, see `12-acceptance-criteria.md`.
