> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 02 — Architecture

> System architecture of Pegana with Trust Layer v0.1.0. Components, data flow, deployment topology. Read after `01-business-rules.md`.

---

## 1. System diagram (post-Trust Layer)

```
                  ┌──────────────────────────────────────┐
                  │   crates/methodology (lib only)      │
                  │   • Pure functions, no I/O           │
                  │   • RFC 8785 canonical hashing       │
                  │   • Semver lifecycle                 │
                  │   • Used by engine + replay CLI      │
                  └──────────┬───────────────────────────┘
                             │ (compile-time dep)
              ┌──────────────┴──────────────────────┐
              │                                     │
   ┌──────────▼──────────┐              ┌──────────▼─────────────┐
   │  engine-rs           │              │  pegana-replay-cli      │
   │  (Rust service)      │              │  (Rust binary, distributable)
   │                      │              │  • cargo-dist → releases │
   │  emit AlertEvent →   │              │  • Sigstore attestations │
   │  push_alert writes:  │              │  • --verify-onchain flag │
   │  - alerts row        │              └──────────▲──────────────┘
   │  - alert_evidence    │                         │ fetch /audit/:id/replay-bundle
   │    row (audit)       │                         │
   │  spawn:              │              ┌──────────┴──────────────┐
   │  - SAS on-chain      │              │  External skeptics       │
   │    commit (devnet/   │              │  (journalists, partners) │
   │    mainnet memo)     │              └──────────────────────────┘
   └──────────┬───────────┘
              │ Redis pub/sub (existing)
              │   • pegana:alerts stream
              │   • pegana:discount channel
   ┌──────────▼───────────┐
   │  dispatcher-rs        │
   │  - inject evidence_url│
   │  - call bot /send     │
   │  - sign + POST webhook│
   └──┬───────────┬────────┘
      │           │
      ▼           ▼
  Telegram     Webhook
  (5 templates  receivers
  × 2 langs)    (HMAC ed25519)

   ┌──────────────────────────────────────────────┐
   │  api-rs (Axum REST)                           │
   │  Existing: /v1/assets, /v1/alerts, /v1/stats │
   │  NEW:                                         │
   │  - GET  /v1/audit/:id                        │
   │  - GET  /v1/audit/:id/replay-bundle          │
   │  - GET  /v1/audit/:id/onchain                │
   │  - GET  /v1/audit?limit&exclude_pegged       │
   │  - GET  /v1/audit.csv?from&to&asset          │
   └──────────────┬───────────────────────────────┘
                  │ HTTP
   ┌──────────────┴──────────────────────────────┐
   │                                             │
┌──▼──────────┐  ┌──────────┐  ┌──────────────┐  ┌──▼──────────────────┐
│  web         │  │  mcp-ts   │  │  SDKs        │  │  RSS/Atom feeds      │
│  Next.js 16  │  │  MCP      │  │  TS (npm)    │  │  /audit.xml          │
│  /audit/[id] │  │  +verify  │  │  Python      │  │  /calibration.xml    │
│  /audit      │  │  alert    │  │  (PyPI)      │  │                      │
│  /methodology│  │           │  │              │  │                      │
│  /pricing    │  │           │  └──────────────┘  └──────────────────────┘
│  /agents     │  └──────────┘
│  /embed/[a]  │
│  + OG images │
└──────────────┘

   ┌─────────────────────────────────────────┐
   │  Postgres (TimescaleDB)                  │
   │  Existing: alerts, discount_snapshots,   │
   │            assets, users, ...            │
   │  NEW:                                    │
   │  - alert_evidence (append-only triggers) │
   │  - alert_events VIEW (codified)          │
   │  - methodology_versions                  │
   │  - alert_evidence.onchain_tx_sig column  │
   └─────────────────────────────────────────┘

   ┌─────────────────────────────────────────┐
   │  Solana Mainnet                          │
   │  • Solana Attestation Service (SAS)      │
   │    - schema: PeganaAuditAttestation      │
   │    - issuer: Pegana engine keypair       │
   │    - records: (alert_id, method_v, hash) │
   │  • Fallback: SPL Memo program            │
   │  • Wallet funded ≥ 0.5 SOL               │
   └─────────────────────────────────────────┘

   ┌─────────────────────────────────────────┐
   │  Distribution Infrastructure              │
   │  • GitHub Releases + cargo-dist          │
   │  • GitHub Attestations (Sigstore OIDC)   │
   │  • releases.pegana.xyz (CNAME/Caddy)     │
   │  • npm @pegana/sdk-ts                    │
   │  • PyPI pegana-sdk                       │
   │  • Homebrew tap lrafasouza/pegana        │
   └─────────────────────────────────────────┘
```

---

## 2. Component responsibilities

### `crates/methodology` (NEW lib crate)

**Owns**: pure decision logic. Every function is deterministic, no I/O, takes inputs explicitly.

**Public surface**:
- `compute_discount(intrinsic, market, intrinsic_sol?, market_sol?, class) → Decimal`
- `apply_ewma_pure(raw, prev, alpha) → Decimal`
- `transition_decide(current, candidate, prev_candidate, prev_since, now, confirm_up, decay_down) → TransitionDecision`
- `state_for_bps_discount(discount, thresholds) → PegState`
- `state_for_bps_discount_aware(class, discount, thresholds) → PegState`
- `state_for_cr(cr, thresholds) → PegState`
- `is_plausible_discount_sample(d) → bool`
- `canonical_assets_hash(toml_str) → [u8; 32]`
- `canonical_receipt_hash(version, git_sha, assets_canonical, inputs_frozen, computed) → [u8; 32]`
- `methodology_version() → &'static str`
- `methodology_git_sha() → Option<&'static str>`

**Consumers**: `engine-rs` (runtime) + `pegana-replay-cli` (offline).

**Detail spec**: `05-methodology-crate.md`.

### `crates/engine-rs` (MODIFIED)

**Changes**:
- Imports from `pegana_methodology` instead of local `thresholds.rs` (deleted).
- `state.rs::apply_ewma` delegates to `methodology::apply_ewma_pure`.
- `state.rs::transition` takes explicit `now: DateTime<Utc>` parameter, delegates to `methodology::transition_decide`.
- `main.rs::try_recompute` reads `Utc::now()` once at top, threads through.
- `main.rs::push_alert` writes `alert_evidence` row (after `alerts` insert, separate sqlx call).
- `main.rs` startup: query `methodology_versions` for own version; refuse to start if `status='broken'`.
- New module `onchain_commit.rs`: tokio::spawn fire-and-forget SAS attestation for critical alerts.

**Detail spec**: `06-engine-changes.md`.

### `crates/pegana-replay-cli` (NEW binary)

**Purpose**: verify a Pegana alert's canonical receipt hash and its signer-pinned on-chain anchor, confirming the published history wasn't altered (tamper-evidence). Re-hashes frozen inputs + recorded verdict — does NOT re-execute the methodology (ADR-0019).

**Distribution**:
- cargo-dist → GitHub Releases (4 platforms)
- Sigstore via `github-attestations = true`
- Mirror at `releases.pegana.xyz` via Caddy CNAME
- Install one-liner: `curl -LsSf https://releases.pegana.xyz/pegana-replay-installer.sh | sh`
- Homebrew: `brew tap lrafasouza/pegana && brew install pegana-replay`
- Cargo: `cargo install pegana-replay-cli`

**Args**:
- `--alert-id <UUID>` — fetch from API
- `--bundle <path>` — load local JSON
- `--verify-onchain` — additionally check SAS attestation
- `--api-url <url>` — override (env `PEGANA_API`)
- `--quiet` — minimal output (CI mode)

**Exit codes**: 0=PASS, 1=FAIL, 2=ERROR, 3=VERSION_MISMATCH, 4=ONCHAIN_MISMATCH.

**Detail spec**: `10-distribution.md`.

### `crates/api-rs` (MODIFIED)

**New routes**: 5 endpoints under `/v1/audit*`.
**Modified**: OpenAPI spec auto-includes new routes (via utoipa annotations).
**No changes**: existing routes (`/v1/assets`, `/v1/alerts`, `/v1/stats`).
**CORS**: new tower-http layer on `/v1/assets/*` only (read-only public) for embed widget cross-origin.

**Detail spec**: `07-api-surface.md`.

### `crates/dispatcher-rs` (MODIFIED)

**Changes**:
- `format.rs::build_send_payload` adds `evidenceUrl` + `alertId` to bot `/send` `vars`.
- `webhook.rs` adds `evidence_url` field to top-level payload (HMAC ed25519 signing automatically covers it).
- `DispatchConfig` loads `AUDIT_BASE_URL` env at startup.

**No new modules**. Pure additive change.

**Detail spec**: `08-external-surfaces.md`.

### `mcp-ts` (MODIFIED)

**New tool**: `verify_alert(alert_id)` — proxy to `/v1/audit/:alert_id`, free tier.
**Extended tool**: `subscribe_peg_events` — adds `evidence_url` to each event in `content` + `structuredContent`.
**No change**: ping, get_assets, get_asset_state, get_asset_history, get_methodology, ping_paid.

**Detail spec**: `08-external-surfaces.md`.

### `bot-ts` (MODIFIED)

**Changes**: locale strings only. 5 alert templates × 2 languages get one new line each:
```
🔍 <a href="{ $evidenceUrl }">Evidence (audit { $alertId })</a>
```
**No code change**: existing `/send` handler accepts arbitrary `vars` via Zod `z.record(z.string(), z.unknown())`.

**Detail spec**: `08-external-surfaces.md`.

### `web/` (Next.js 16, MODIFIED)

**New routes** (7 surfaces):
- `app/audit/[alert_id]/page.tsx` — receipt renderer
- `app/audit/[alert_id]/loading.tsx` — skeleton
- `app/audit/[alert_id]/not-found.tsx` — 404
- `app/audit/[alert_id]/opengraph-image.tsx` — dynamic OG card
- `app/audit/page.tsx` — index of recent audits
- `app/methodology/page.tsx` — fresh build (does not exist today)
- `app/pricing/page.tsx` — waitlist (no active tiers)
- `app/agents/page.tsx` — MCP showcase + verify_alert demo
- `app/embed/[asset]/page.tsx` — iframe variant of embed widget
- `app/embed/demo/page.tsx` — integration demo for partners
- `app/audit.xml/route.ts` — Atom 1.0 feed
- `app/calibration.xml/route.ts` — Atom 1.0 feed from git log
- `public/embed.js` — vanilla JS embed widget

**Modified**:
- Root `app/layout.tsx` — `<link rel="alternate" type="application/atom+xml">` discovery
- Home `app/(marketing)/page.tsx` — trust strip with `assets_in_drift` live count

**Detail spec**: `09-web-pages.md`.

### Database (Postgres + TimescaleDB, MODIFIED)

**New migrations**:
- `0028_alert_evidence.sql` — append-only audit table + immutability triggers
- `0029_alert_events_view.sql` — codify existing prod view
- `0030_methodology_versions.sql` — lifecycle tracking + seed `0.1.0 active`
- `0031_alert_evidence_onchain_sig.sql` — column for SAS attestation tx signature

**No changes**: existing tables (`alerts`, `discount_snapshots`, `assets`, `users`, `subscriptions`, `webhook_subscriptions`, etc.).

**Detail spec**: `04-data-model.md`.

### Solana (NEW dependency)

**Engine submits**:
- `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (SPL Memo fallback)
- Solana Attestation Service (primary) — schema `PeganaAuditAttestation` registered via SAS CLI
- Engine wallet keypair loaded from `PEGANA_COMMIT_KEYPAIR` env (file path or base58)

**Cost**: ~$0.025/month at current SOL price + alert volume.

**Detail spec**: `10-distribution.md § On-chain attestation`.

---

## 3. Data flow: a critical alert end-to-end

Walk through a `PEGGED → DEPEG` transition for USDe:

```
T+0ms     indexer-rs publishes Pyth USDe/USD update to Redis pegana:src:pyth
T+5ms     engine-rs handle_message receives, calls engine.set_pyth(...) and engine.set_market(...)
T+10ms    try_recompute fires:
          - now = Utc::now()  [read ONCE]
          - intrinsic = 1.00, market = 0.987
          - methodology::compute_discount(...) = 0.013
          - is_plausible_discount_sample(0.013) = true
          - methodology::apply_ewma_pure(raw=0.013, prev=0.005, alpha=0.3) = 0.0074
          - methodology::state_for_bps_discount_aware(StableYield, 0.0074, thresholds) = DRIFT
          - state.rs::transition(USDe, DRIFT, now, 30s, 120s) returns DRIFT (after candidate confirms)
          - eventually transitions to DEPEG when discount stays above threshold

T+50ms    push_alert runs:
          - Build inputs_frozen (InputsFrozen struct)
          - Build computed (Computed struct)
          - assets_canonical = engine cache (loaded at startup)
          - assets_toml_sha256 = methodology::canonical_assets_hash(...).hex()
          - receipt_sha256 = methodology::canonical_receipt_hash(...).hex()
          - sqlx INSERT INTO alerts (existing)  [SUCCESS]
          - sqlx INSERT INTO alert_evidence (new) [SUCCESS, async, non-blocking]
          - For critical states (DEPEG, CRITICAL, BLACK_SWAN): build Receipt struct, populate replay_artifact JSONB
          - tokio::spawn(onchain_commit::commit_receipt(...))
          - Redis XADD to pegana:alerts stream

T+50ms    Redis stream consumer (dispatcher-rs) reads the alert
T+100ms   dispatcher:
          - format::build_send_payload(chat_id, locale, event, audit_base_url)
          - vars.evidenceUrl = "https://pegana.xyz/audit/<uuid>"
          - vars.alertId = "<uuid>"
          - POST to bot /send → user receives Telegram with 🔍 link
          - For each webhook subscriber: POST signed payload with evidence_url field

T+500ms   Solana commit (async, parallel):
          - onchain_commit::do_commit() in tokio::spawn
          - rpc.get_latest_blockhash()
          - Build SAS attestation tx OR SPL memo tx (fallback)
          - rpc.send_and_confirm_transaction_with_spinner_and_commitment(...)
          - Returns signature within ~30s typically
          - persist_sig() updates alert_evidence.onchain_tx_sig

T+5min    User clicks 🔍 in Telegram:
          - GET https://pegana.xyz/audit/<uuid>
          - Web server component fetches /v1/audit/<uuid>
          - Renders: header, inputs, computed, methodology version, replay snippet
          - OG image generated lazily (or cached)
          - "Verify on-chain" section shows tx_sig with Solscan link

T+1day    Skeptic runs:
          - curl ... pegana-replay-installer.sh | sh
          - pegana-replay --alert-id <uuid> --verify-onchain
          - CLI fetches bundle, re-hashes frozen inputs + recorded verdict, verifies receipt_sha256, fetches tx_sig from chain
          - PASS / FAIL / VERSION_MISMATCH / ONCHAIN_MISMATCH
```

---

## 4. Deployment topology

### Production environment

- **Host**: Hetzner CPX32, Falkenstein, IP `<prod-host>`
- **OS**: Ubuntu (per existing memory notes)
- **Orchestration**: Docker Compose, all services as containers
- **Networking**: Caddy reverse proxy with TLS (Let's Encrypt)
- **Domains**:
  - `api.pegana.xyz` → api-rs container :8080
  - `mcp.pegana.xyz` → mcp-ts container :8090
  - `pegana.xyz` + `www.pegana.xyz` → Vercel (web Next.js)
  - **NEW**: `releases.pegana.xyz` → Caddy reverse proxy to `github.com/lrafasouza/pegana/releases/latest/download/`
- **Database**: Postgres 16 + TimescaleDB extension, hosted in same compose
- **Cache/PubSub**: Redis 7, same compose
- **Secrets**: `.env` file with chmod 600. NEW: `PEGANA_COMMIT_KEYPAIR` for SAS signing.
- **Observability**: Prometheus (compose) + Grafana (compose) + Sentry SaaS (engine, dispatcher, api, mcp, bot all wired)

### Container map (post-Trust Layer)

```
docker-compose.yml services:
├── postgres (timescale)
├── redis
├── indexer (Rust, existing)
├── engine (Rust, MODIFIED — methodology dep + SAS hook)
├── api (Rust, MODIFIED — /v1/audit/* routes)
├── dispatcher (Rust, MODIFIED — evidence_url propagation)
├── bot (TS/Bun, MODIFIED — locale updates)
├── mcp-ts (TS/Bun, MODIFIED — verify_alert tool)
├── caddy (reverse proxy, NEW vhost releases.pegana.xyz)
└── prometheus + grafana (observability, existing)
```

**No new services**. All Trust Layer changes fit existing containers.

### Vercel (web)

- Next.js 16 app deployed to Vercel
- Build env: `PEGANA_API=https://api.pegana.xyz`, `AUDIT_BASE_URL=https://pegana.xyz`
- New routes auto-deployed on push to main
- ISR cache: 60s for `/audit/[id]` (immutable receipts, can cache hard); 30s for `/audit` index; 1h for `/calibration.xml`

### CI (GitHub Actions)

**Existing workflows**:
- `ci.yml` — Rust fmt+clippy+check+test, verify-assets, Lighthouse

**New workflows**:
- `release.yml` (cargo-dist generated) — binary releases on `methodology-v*` tag
- `sdk-release.yml` — SDK publishing on `sdk-v*` tag
- `reproducible.yml` — same-machine bit-for-bit build verification on PR
- `backtest.yml` (Phase 14) — regression test for backtest output

---

## 5. Data ownership

| Data | Owner service | Persistence | Retention | Access pattern |
|---|---|---|---|---|
| Asset config | `assets.toml` (git) | filesystem | git history forever | engine + api read at startup |
| Live discount snapshots | engine-rs | Postgres `discount_snapshots` (hypertable) | 90d | API + WS clients fan-out via Redis |
| Alerts | engine-rs | Postgres `alerts` | forever | dispatcher consumes, MCP queries |
| Audit evidence | engine-rs | Postgres `alert_evidence` (append-only triggers) | forever | api `/v1/audit/*`, replay CLI |
| Methodology versions | manual + migration | Postgres `methodology_versions` | forever | engine startup check, audit page |
| On-chain attestations | Solana SAS | Solana mainnet ledger | forever | CLI `--verify-onchain` |
| Calibration data | engine-rs | discount_snapshots → Grafana panel | 90d hot, exported for backtests | manual review during dogfood window |
| User subscriptions | bot-ts | Postgres `users`, `subscriptions` | until user deletes | bot commands |
| Webhook deliveries | dispatcher-rs | Postgres `webhook_deliveries` | 30d | api `/v1/me/webhooks/{id}/deliveries` |

---

## 6. Failure modes (system-level)

| Failure | Impact | Fallback |
|---|---|---|
| `alert_evidence` insert fails | Alert delivered, but no audit row → 404 on `/v1/audit/<id>` with `evidence_missing` | Counter `pegana_audit_persist_failed_total` alerts; manual investigation; alert is NOT silenced |
| Solana RPC unavailable | SAS attestation delayed | Retry exponential backoff to 1h; alert dispatch unaffected; on-chain sig populates async |
| Methodology version not in DB | Engine logs warning, inserts as `active` | Auto-recovery; logged for review |
| Methodology version marked `broken` | Engine refuses to start | Operator must roll forward to fixed version (deploy gate prevents broken version in prod) |
| `alert_events` view missing on prod | MCP `subscribe_peg_events` fails | Phase 0.1 pre-flight detects and applies migration 0029 |
| Calibration p99 above expected for a Phase 0 asset | Asset stays `active=false` past 06-11 | Tune thresholds + extend calibration; do not flip to active |
| Solana wallet balance low (<0.5 SOL) | SAS commits start failing | Sentry alert; engine logs `pegana_commit_wallet_low_balance` gauge; ops re-funds |
| Webhook delivery 5xx persists | Dead-letter queue, retry exponentially | Existing dispatcher logic; surfaced in dogfood report (Phase 0.4) |
| OG image generation timeout | Twitter/Telegram unfurl shows fallback | Vercel `revalidate: 60`; first request after expiry may be slow |

---

## 7. Scalability

Phase 0 → Phase 14 = 21 → 32 active assets = ~50% increase. Estimated impact:

- Postgres `alert_evidence`: ~50 critical alerts/mo × 10KB = 500 KB/mo current; 32 assets → ~750 KB/mo. Negligible.
- Solana wallet cost: 50 → 75 commits/mo at $0.0005 each = $0.0375/mo. Still negligible.
- API latency: read-only audit endpoints are PK-indexed; no change with row growth.
- Web ISR: more `/audit/[id]` cache entries, but each only 4-15KB. Vercel handles.
- Embed widget polling: each badge polls `/v1/assets/<symbol>` every 30s. 100 badges = 200 req/min. Well within rate limit.

No bottlenecks expected at this scale.

---

## 8. Cross-references

- For each component's detailed spec, follow links in section 2 above.
- For the full data flow including failure paths, see `06-engine-changes.md § main.rs::push_alert`.
- For deployment runbook including pre-flight checks, see `plans/13-phase-13-deploy-outreach.md`.
- For observability of system health, see `11-observability.md`.
