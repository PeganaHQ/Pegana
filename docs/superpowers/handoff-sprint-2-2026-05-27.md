# Pegana V2 — Sprint 2 handoff (2026-05-27)

Self-contained briefing for the next Claude/terminal. Read top-to-bottom; everything you need to pick up cold is here.

---

## Current state (last commit: `3f53910`)

**Branch:** `main` (active dev branch, not `V2`).
**Production:** Hetzner CPX32 ARM at `<prod-host>`, all 9 containers healthy.
**Live hosts:** `api.pegana.xyz`, `mcp.pegana.xyz`, `www.pegana.xyz`.
**Launch target:** **2026-06-10** (14 days out).
**Scorecard:** A+ security · A+ quality · A production-readiness · A test-coverage · A− observability · ready_for_mainnet = true.

### Sprint history (today's session)

| Sprint | Commit | What shipped |
|---|---|---|
| 1a | `a6da9ed` | Retry curve 36s→2h35m, `x-pegana-{event,delivery}-id` + `x-pegana-attempt` headers, `GET /v1/meta/webhook-ips` |
| 1b | `0ccfe76` | `POST /v1/me/webhooks/{id}/test` + `/replay`, single-shot `webhook_dispatch.rs` module, `x-pegana-test:true` header |
| 1c | `dbd3326` | `pegana_common::webhook_sign` shared primitive, dual-active key rotation, `GET /v1/meta/webhook-keys`, `webhook_deliveries` table + `GET /deliveries`, all 3 receiver examples upgraded |
| 1d | `a788e2a` | P1 review fixes: 8 KiB receiver-body cap (`read_truncated_body`), 2 KiB URL cap, `PATCH /v1/me/webhooks/{id}`, shared `reqwest::Client` in `AppState`, dual-write doc |
| 1e | `e2faf03` | P2/P3 review fixes: 64 KiB `DefaultBodyLimit`, opaque `internal()` workspace-wide, PATCH integration test, clippy clean (0 warnings) |

132 tests pass. Two `/review-and-iterate` loops reached fixed-point.

---

## Pending launch-critical (TaskList)

| # | Status | What |
|---|---|---|
| #14 | in_progress | **Webhook dogfood** — receiver registered, running 7-day passive soak. Passive task; just check `/v1/me/webhooks/{id}/deliveries` periodically |
| #16 | pending | **`docs/CALIBRATION-v1.md`** — write from 14-day dogfood data. Depends on #14 completing |
| #22 | pending | **Launch screenshots + GIFs** — user action (Rafael's), not codable |
| #9 | pending | **B6 internal soak** vs prod-local — lower priority, defer post-launch |

---

## Recommended Sprint 2 scope

Choose **A** (launch comms) OR **B** (observability polish) OR **C** (MCP webhook ergonomics). Don't try all three — bandwidth is 14 days to launch.

### Option A — Launch comms + assets (RECOMMENDED)

Goal: everything Rafael needs to actually announce 2026-06-10 is ready.

- [ ] **Polish 3 receiver READMEs** (`docs/examples/webhook-receivers/*/README.md`) — each needs a 60-second copy-paste quickstart. Already work; just rewrite for clarity.
- [ ] **Write rotation playbook** at `docs/webhooks/key-rotation.md` — extracted from `crates/common/src/webhook_sign.rs` module docs. 3-step recipe.
- [ ] **Mintlify OpenAPI consumption** — point `docs-site/` (if exists) at `https://api.pegana.xyz/openapi.json` instead of hand-written YAML. Test that all 6 webhook endpoints render.
- [ ] **Draft `CALIBRATION-v1.md` skeleton** (task #16) — sections + placeholder tables; fill in real numbers when dogfood window closes 2026-06-03 (7 days in).
- [ ] **Brief Rafael on #22 screenshots** — exact URLs to capture: `pegana.xyz/`, `/developers`, `/console/webhooks`, `mcp.pegana.xyz/health`, Telegram `@PeganaWatchBot` `/start`.

Effort: ~1 day. Output: launch-day blockers all moved or resolved.

### Option B — Observability polish (deferred from review)

The only A− on the round-3 scorecard. Two concrete additions:

- [ ] **Per-subscription success-rate gauge** — `metrics::gauge!("pegana_webhook_success_rate", "sub_id" => id).set(succ/total)` updated on every dispatch. Powers a Grafana row "Receivers ranked by failure rate" without log-grepping.
- [ ] **Retention cron** for `webhook_deliveries` — `DELETE WHERE attempted_at < now() - 30d`. Add to `crates/xtask/src/main.rs` or a tiny new bin; schedule via host cron or `docker-compose` ofelia sidecar.
- [ ] **Sentry release tracking** — each deploy should set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` so errors group by commit.

Effort: ~half day. Output: scorecard goes A on every dimension.

### Option C — MCP-side webhook ergonomics

Currently MCP agents can READ peg state but can't manage their own webhooks. Add:

- [ ] **`pegana_register_webhook`** MCP tool (paid, x402) — wraps `POST /v1/me/webhooks` so an LLM agent can subscribe itself to alerts during a conversation.
- [ ] **`pegana_list_deliveries`** MCP tool — wraps `GET /v1/me/webhooks/{id}/deliveries`; LLM can debug "did my webhook fire?" without leaving the chat.
- [ ] Update `mcp-ts/src/server.ts` tool registry; bump version; redeploy `mcp` container.

Effort: ~1 day. Output: agents get full self-service webhook lifecycle. Adds 2 paid tools to revenue surface.

---

## How to resume context

### Repo + branch
```bash
cd <repo>
git checkout main
git pull origin main
```

### Local dev stack (prod-local Docker)
```bash
docker compose up -d postgres redis indexer engine api dispatcher bot mcp
# Postgres :5434, Redis :6381, API :8081 (Caddy maps :443 in prod)
# pgcli pegana://pegana@localhost:5434/pegana
```

### Deploy to production (Hetzner)
```bash
# Option 1: helper script (user prefers this)
./scripts/deploy.sh

# Option 2: manual (what we used today)
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && git pull --ff-only && docker compose up -d --build api dispatcher'
```

If `docker compose up --build` errors with "container name already in use" (happened 2x today), garbage-collect: `ssh ${PEGANA_DEPLOY_SERVER} 'docker rm -f <stale-container-hash>'` then retry.

### Apply a new migration
```bash
# On Hetzner:
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres psql -U pegana -d pegana < migrations/NNNN_name.sql'
```

### Tests
```bash
cargo test --workspace --lib --bins                  # ~84 fast tests, no env needed
cargo test --workspace --tests                       # +integration; some skip silently without env
cargo clippy --workspace --tests --no-deps           # MUST be 0 warnings before commit
```

### Run the integration tests against prod
```bash
PEGANA_INTEGRATION_API_BASE=https://api.pegana.xyz \
PEGANA_INTEGRATION_BOT_TOKEN=$BOT_TOKEN \
cargo test -p api-rs --test me_endpoints -- --nocapture
```

---

## Key files / modules

### Webhook surface (the bulk of recent work)
- `crates/common/src/webhook_sign.rs` — Ed25519 + dual-key rotation (single source of truth)
- `crates/common/src/webhook_url.rs` — SSRF guards (static + runtime DNS-resolving)
- `crates/common/src/webhook_response.rs` — 8 KiB receiver-body truncation
- `crates/api-rs/src/webhook_dispatch.rs` — single-shot delivery (used by `/test` and `/replay`)
- `crates/api-rs/src/routes/webhooks.rs` — CRUD + PATCH + test + replay + list_deliveries handlers
- `crates/dispatcher-rs/src/webhook.rs` — production retry loop (6 attempts, 5s→30s→5m→30m→2h backoff)
- `crates/dispatcher-rs/src/main.rs:389-403` — **DUAL-WRITE COMMENT** explaining why 3 tables fire per attempt
- `migrations/0022_webhook_subscriptions.sql` + `0023_webhook_deliveries.sql`
- `docs/examples/webhook-receivers/{typescript-cloudflare-worker,python-fastapi,rust-axum}/` — all 3 dual-key ready

### Auth surface
- `crates/api-rs/src/auth/{jwt,telegram,middleware,mod}.rs`
- HS256 JWT, 7-day TTL, jti revocation via `web_sessions` table
- Telegram Login Widget HMAC with `verify_slice` (constant-time)

### Endpoints registered (`api-rs/src/main.rs:98-149`)
- Public read: `/`, `/healthz`, `/readyz`, `/openapi.json`, `/v1/meta/webhook-{ips,keys}`, `/v1/assets/*`, `/v1/alerts`, `/v1/stats`
- Auth: `POST /v1/auth/telegram`, `POST /v1/auth/logout`
- User-scoped: `/v1/me`, `/v1/me/preferences`, `/v1/me/subs[/:asset]`, `/v1/me/alerts`
- Webhooks: `/v1/me/webhooks` (GET POST), `/v1/me/webhooks/:id` (DELETE PATCH), `/v1/me/webhooks/:id/{test,replay,deliveries}`
- WS: `/v1/ws`

---

## Gotchas + memory hooks

### Critical conventions
- **English-only** in code, comments, commits, docs. User explicitly enforced this.
- **Never `git add .`** — stage files explicitly. Avoids picking up unrelated edits (we have `web/` changes from Rafael's other work that aren't ours).
- **Never amend** — always new commits (CLAUDE Code convention).
- **Memory:** `~/.claude/projects/<project>/memory/MEMORY.md` is the index; load via the auto-memory system. Key entries: `project_production_deploy.md`, `project_bot_state.md`, `project_brand_identity.md`, `feedback_deploy_workflow.md`.

### Env vars in production (Hetzner `~/pegana/.env`)
- `PEGANA_WEBHOOK_SIGNING_KEY` — base64 32-byte Ed25519 seed (primary). REQUIRED for api + dispatcher.
- `PEGANA_WEBHOOK_SIGNING_KEY_NEXT` — optional secondary for rotation. Empty currently.
- `PEGANA_WEBHOOK_EGRESS_IPS` — comma-separated; defaults to `<prod-host>` if unset.
- `JWT_SECRET` — HS256 secret (openssl rand -hex 32).
- `BOT_TOKEN` — Telegram `@PeganaWatchBot` token.
- `CDP_API_KEY_{ID,SECRET}` — Coinbase x402 facilitator (mainnet).
- `WEBHOOK_SSRF_ALLOW_LOOPBACK` — **NEVER set in prod**; tests-only.
- `SENTRY_DSN`, `DATABASE_URL`, `REDIS_URL` — standard.

### Things that LOOK like findings but aren't
- 5 `.expect()` calls in non-test paths (`rate_limit.rs`, `ws.rs`, `webhook_dispatch.rs`) — intentional fail-fast on poisoned mutex / missing boot env. Documented in code.
- `decimal_to_f64` + `Subscription { asset, threshold_bps }` — `#[allow(dead_code)]` with rationale; bin-only consumers.
- `process()` 8-arg fn — `#[allow(clippy::too_many_arguments)]` with rationale.
- `auth.rs` UNAUTHORIZED errors still surface `e.to_string()` — intentional; telegram-widget rejection reasons are part of the public contract.

### Things that ARE intentional design (don't "fix")
- Three write paths per attempt (`webhook_deliveries` + `webhook_subscriptions.last_status` + `webhook_dead_letter`) — answer three different operator questions. See comment block in `dispatcher-rs/src/main.rs:389`.
- Body truncation cap = 8 KiB (`webhook_response::MAX_ERROR_BODY_BYTES`).
- URL length cap = 2 KiB (`webhooks::MAX_URL_LEN`).
- Request body limit = 64 KiB (`main::MAX_REQUEST_BODY_BYTES`).
- Retry envelope = 6 attempts × `[5s, 30s, 5m, 30m, 2h]` = ~2h35m. Documented in `webhook.rs:74-79`.
- Receiver examples cache `/v1/meta/webhook-keys` for 1h (CFW only does dynamic fetch; Python + Rust use CSV env).

### Known deferred (not Sprint 2 unless explicitly chosen)
- `crates/api-rs/src/openapi.rs:60` — sole `TODO` in repo; extend utoipa to assets/alerts/stats/me/ws routes (v2.1).
- Rate limiter is in-memory `Mutex<HashMap>` — move to Redis when horizontal scale matters (v1.5).
- `webhook_deliveries` retention — schedule cron when row count crosses ~100k.

---

## Quick verification commands

After any deploy, run these 4 curls to confirm health:

```bash
# 1. Openapi includes all webhook paths
curl -s https://api.pegana.xyz/openapi.json | jq '.paths | keys[] | select(contains("webhook"))'

# 2. Body limit fires
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.pegana.xyz/v1/auth/telegram \
  -H 'Content-Type: application/json' --data-binary "$(printf '{"pad":"%200000s"}' x)"
# Expect: 413

# 3. PATCH route wired
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  https://api.pegana.xyz/v1/me/webhooks/00000000-0000-0000-0000-000000000000 \
  -H 'Content-Type: application/json' -d '{"threshold_bps":50}'
# Expect: 401

# 4. Container freshness
ssh ${PEGANA_DEPLOY_SERVER} 'docker ps --format "{{.Names}} {{.Status}}" | grep pegana'
```

---

## TL;DR for next session

> "Last sprint closed the entire `/review-and-iterate` loop — webhook surface is launch-ready. Pending: dogfood data (passive #14), calibration writeup (#16, blocks on #14), launch screenshots (#22, Rafael's hands). For coding work, the highest-leverage next sprint is **Option A (launch comms)** — polish 3 receiver READMEs, write the rotation playbook, point Mintlify at `/openapi.json`. Half-day, unblocks launch comms."
