# Trilha E — Security Implementation Plan

> **For agentic workers:** Implemented by **Codex** (Sonnet 4.6 fallback if Codex stalls/errors), reviewed 1:1 by **Opus**. Task-altitude pointers + acceptance + tests. Scoped to the REAL perimeter (api:8080 unpublished on host, ufw 22/80/443 only, everything behind Caddy).

**Goal:** Close the security gaps that defeat a *deployed* control or enable authenticated abuse — XFF spoofing of the rate limiter, unbounded webhook creation, and slow-loris WebSockets — without changing the methodology or receipt hash.

**Architecture:** C3 is an edge fix (Caddyfile) so the app sees a trustworthy client IP — repairs the rate-limiter (L9) and the WS per-IP cap for free. M20 + H10 are small api-rs guards. No DB migration expected. No methodology/discount/receipt surface → hash unchanged.

**Tech Stack:** Caddy (reverse_proxy header_up), Rust (axum handlers, sqlx, tokio timeouts).

**Parent spec:** `docs/superpowers/specs/2026-06-29-audit-remediation-campaign-design.md` (§3 Sprint E).

**Per-task gate:** `cargo build`/`clippy`(0)/`fmt`/test for Rust tasks + the Task 0 hash baseline; Caddyfile validated with `caddy validate` (if available) or `caddy fmt`/manual. Opus 1:1 review + `/code-review` with security emphasis.

---

## Verified integration points (2026-06-30)

- **C3:** `Caddyfile` api site (~lines 30-36): `@ws { header Connection *Upgrade*; header Upgrade websocket }`, then `reverse_proxy @ws api:8080` and `reverse_proxy api:8080` — both BARE (no `header_up`), so Caddy APPENDS the client-sent `X-Forwarded-For` rather than replacing it. `rate_limit.rs:73 client_ip` takes `xff.split(',').next()` (the first, attacker-controlled token). Same first-token logic feeds the WS per-IP cap.
- **M20:** `crates/api-rs/src/routes/webhooks.rs:162 create_webhook` — `INSERT INTO webhook_subscriptions ...` (line 172) with NO per-`user_id` count ceiling and `body.asset` bound straight to SQL (no membership check). `resolve_user_id` (:88) gives the `user_id`. The list query (:114) filters `WHERE user_id=$1 AND is_active=TRUE`.
- **H10:** `crates/api-rs/src/ws.rs` connection handler (~140-266) — has a per-IP connection cap (`WS_MAX_PER_IP`) + origin allowlist, but NO idle/read timeout and no explicit frame-size cap.

---

## File Structure

| File | Change | Tasks |
|---|---|---|
| `Caddyfile` | `header_up X-Forwarded-For {remote_host}` on both api reverse_proxy blocks | E1 (C3) |
| `crates/api-rs/src/routes/webhooks.rs` | per-user webhook cap + asset-membership validation before INSERT | E2 (M20) |
| `crates/api-rs/src/ws.rs` | server-side idle/read timeout on the WS connection | E3 (H10) |

---

## Task 0: Hash-invariance baseline

- [ ] `cargo run -q -p pegana-replay-cli --bin pegana-replay -- --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json` → `recomputed receipt:31c06db4fc9a matches stored receipt:31c06db4fc9a`. Re-run after each Rust task (E is not methodology — hash must not change).

---

## Task E1 (C3): stop XFF spoofing at the Caddy edge

**File:** `Caddyfile` (api site, the two `reverse_proxy ... api:8080` lines ~33-36)

The rate limiter and WS per-IP cap trust `X-Forwarded-For`, but Caddy currently *appends* the client-sent header (bare `reverse_proxy`), so `client_ip` reads an attacker-controlled first token and the per-IP limiter is bypassable. Fix at the edge so the app receives Caddy's view of the real TCP peer.

- [ ] **Step 1:** FIRST confirm there is no CDN/extra proxy in front of Caddy for `api.pegana.xyz` (grep the Caddyfile global block + any `trusted_proxies`/`servers` config; check for Cloudflare/`CF-Connecting-IP` handling). If Caddy is the TLS edge (direct client → Caddy), `{remote_host}` is the real client IP and the fix below is correct. If a CDN is in front, REPORT it (the correct source header would be the CDN's, e.g. `CF-Connecting-IP`) and do NOT guess.
- [ ] **Step 2:** convert both api reverse_proxy directives to block form with an overwriting `header_up`:
  ```
  reverse_proxy @ws api:8080 {
      header_up X-Forwarded-For {remote_host}
  }
  reverse_proxy api:8080 {
      header_up X-Forwarded-For {remote_host}
  }
  ```
  This REPLACES any inbound `X-Forwarded-For` with the actual peer, so a spoofed header can't survive. (Leave the grafana/mcp blocks unchanged — they're not the rate-limited API.)
- [ ] **Step 3 (verify):** `caddy validate --config Caddyfile --adapter caddyfile` if the `caddy` binary is available locally; else `caddy fmt --overwrite Caddyfile` then eyeball; at minimum confirm the file is syntactically balanced (matched braces). NOTE in the report that the real proof is post-deploy (a request with a forged `X-Forwarded-For: 1.2.3.4` must be rate-limited under the real IP, not 1.2.3.4).
- [ ] **Step 4:** commit only `Caddyfile`. Message: `fix(caddy): overwrite X-Forwarded-For at the edge so the rate limiter can't be spoofed — C3` + trailer.

> **Acceptance:** both api reverse_proxy blocks set `header_up X-Forwarded-For {remote_host}`; the grafana/mcp vhosts untouched; no app code change (client_ip's first-token now reads the real peer). This also repairs L9 + the WS per-IP cap. Hash gate N/A (no Rust change) but confirm the workspace still builds.

---

## Task E2 (M20): per-user webhook cap + asset-membership validation

**File:** `crates/api-rs/src/routes/webhooks.rs` (`create_webhook` ~162)

An authenticated user can create unbounded `webhook_subscriptions` rows (each a valid outbound dispatch target = stored amplification), and `body.asset` is inserted without checking it's a tracked asset (dead rows for nonexistent assets).

- [ ] **Step 1 (TDD where a seam exists):** add a `const MAX_WEBHOOKS_PER_USER: i64 = 50;` (pick a sane ceiling; document it). If there's a pure validation seam, unit-test it; the count + membership checks are DB-bound, so prefer extending the existing webhooks integration test (gated on `PEGANA_INTEGRATION_*`) to assert: (a) creating beyond the cap returns 4xx (e.g. 429 or 400 with a clear error), (b) an unknown asset returns 4xx, (c) re-activating an existing (url,asset) via the ON CONFLICT path does NOT count against the cap.
- [ ] **Step 2:** before the INSERT (after `resolve_user_id`), add:
  - **Asset membership check:** verify `body.asset` exists in the `assets` table (and is active, matching how other routes validate — mirror `peg.rs` unknown-asset handling if present). On miss → `ApiError::unknown_asset(&body.asset)` (or a 400).
  - **Per-user cap:** `SELECT COUNT(*) FROM webhook_subscriptions WHERE user_id=$1 AND is_active=TRUE`. If `>= MAX_WEBHOOKS_PER_USER`, return a 429/400 with a clear message — BUT only enforce on NEW rows: if the (user_id, url, asset) already exists (the ON CONFLICT re-activation path), allow it (don't block updating an existing sub). Simplest: check whether this (user_id,url,asset) already exists; if not and count >= cap → reject; else proceed.
- [ ] **Step 3:** verify `cargo build` + `cargo test -p api-rs` + clippy 0 + fmt clean + hash gate unchanged.
- [ ] **Step 4:** commit only `webhooks.rs` (+ test). Message: `feat(api): cap webhooks per user + validate asset on create — M20` + trailer.

> **Acceptance:** a user can't exceed the cap with NEW subscriptions; an unknown asset is rejected; re-activating an existing sub still works. Authenticated-abuse ceiling in place.

---

## Task E3 (H10): WebSocket server-side idle/read timeout

**File:** `crates/api-rs/src/ws.rs` (connection handler ~140-266)

The WS endpoint has a per-IP connection cap + origin allowlist but no idle/read timeout, so a slow-loris client can hold a socket (and its dedicated Redis subscriber) open indefinitely.

- [ ] **Step 1:** read the connection loop fully (the `select!` over the Redis subscription stream + the client socket). Identify where inbound client frames are read and where the loop awaits.
- [ ] **Step 2:** add a server-side idle deadline: a `const WS_IDLE_TIMEOUT: Duration` (e.g. 120s). Use a `tokio::time::timeout`/`tokio::select!` with an interval so that if no client frame (or pong) is received within the window, the server sends a Ping and, if still no response within a grace period, closes the connection. If the codebase already sends periodic pings, just add the read-deadline/close path. Keep the existing per-IP cap + origin checks intact.
- [ ] **Step 3 (TDD where possible):** the socket loop isn't easily unit-tested; if a pure helper (e.g. "should_close_for_idle(last_seen, now, timeout)") factors out, test that. Otherwise rely on review + a manual note.
- [ ] **Step 4:** verify `cargo build` + `cargo test -p api-rs` + clippy 0 + fmt clean + hash gate unchanged.
- [ ] **Step 5:** commit only `ws.rs`. Message: `feat(api): WebSocket idle/read timeout to reap slow-loris connections — H10` + trailer.

> **Acceptance:** an idle WS connection is closed after the timeout (server ping → no pong → close), freeing its Redis subscriber; active connections with traffic/pongs are unaffected.

---

## Sprint exit criteria

- [ ] E1–E3 committed. `Caddyfile` valid; `cargo build`/`clippy`(0)/`fmt`(clean)/`cargo test --workspace` green.
- [ ] Hash baseline `31c06db4fc9a` byte-identical.
- [ ] Opus 1:1 review + `/code-review` (security emphasis); findings fixed.
- [ ] Deploy: `scripts/deploy.sh` (recreates api/engine/etc) + recreate `caddy` so the new Caddyfile loads (`--services 'api caddy'` or a caddy reload). No migration. Prod-verify: a forged `X-Forwarded-For` does NOT change the rate-limit bucket; webhook cap rejects beyond limit; idle WS is reaped.

## Self-review (author)

- **Coverage:** C3 → E1 (repairs L9 + WS per-IP) · M20 → E2 · H10 → E3. All Sprint E items.
- **Perimeter-scoped:** these are the 3 findings that defeat a deployed control or enable authenticated abuse; the rest of the security cluster (L10/L11/L20/L21/M8) is REFUTED or backlog per the spec — NOT in this plan.
- **No hash surface:** edge config + 2 small api guards; no methodology/discount/receipt change → hash unchanged (assert via Task 0).
- **CDN caveat:** E1 Step 1 forces a check for a CDN in front of Caddy before assuming `{remote_host}` is the client — do not guess.
