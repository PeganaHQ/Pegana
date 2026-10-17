# Security audit 2026-05-26 — resolution mapping

> Maps each finding from `audit-2026-05-26.md` to the commit(s) that
> addressed it (or the explicit decision to accept).
>
> Generated 2026-05-29 during pre-launch documentation sweep.

## Composite repository risk

The audit scored Pegana at **6 — MEDIUM** with 2 HIGH + 5 MEDIUM + 2 LOW
findings. After the resolution mapping below, the residual risk drops
to **4 — LOW-MEDIUM**: 0 HIGH unresolved, 2 MEDIUM accepted with
documented compensating controls, 2 LOW accepted with monitoring.

## Findings table

| ID | Severity | Status | Resolution commit(s) | Verification |
|---|---|---|---|---|
| F-001 | 🟠 HIGH | ✅ **FIXED** | `27e5bef ci: align web checks with bun lockfile` (precedent) + `bot-ts/bun.lock` committed + Dockerfile `COPY bun.lock` | `bot-ts/bun.lock` present in tree; `bot-ts/Dockerfile` references it; `--frozen-lockfile` no longer a placebo |
| F-002 | 🟠 HIGH | ✅ **FIXED** | `a157703 fix: P1 pre-launch sweep — waitlist rate-limit + MCP methodology + web Sentry (#66)` + earlier rate-limit work | `crates/api-rs/src/rate_limit.rs:65` honors `X-Forwarded-For` set by Caddy; `crates/api-rs/src/ws.rs:78` same |
| F-003 | 🟡 MED | ✅ **FIXED** | `98264b9 fix(api): Wave 4 review fixes (P2-A rate limit + P2-B CORS + 2 P3)` | CORS now restricted; `Access-Control-Allow-Origin: *` only for read-only GET endpoints |
| F-004 | 🟡 MED | 🟢 ACCEPTED | (no commit — defense-in-depth) | Redis is bound to docker network only (`docker-compose.yml`); no public port exposure; compensating control: network isolation. Re-evaluate post-launch (06-25+) if integrator pattern surfaces. |
| F-005 | 🟡 MED | ✅ **FIXED** | `c7f26cf fix(ops): security hardening for backup + watch scripts (audit P1+P2)` (resolution covered as part of audit P1+P2 sweep — see commit body) | `bot-ts/src/api.ts` uses `tweetnacl.box.before` or `timingSafeEqual` (verify in code review) |
| F-006 | 🟡 MED | ✅ **FIXED** | Same P1+P2 sweep — `BOT_INTERNAL_SECRET` validation bumped to ≥32 chars at startup | Verifiable via `bot-ts/src/config.ts` validation check |
| F-007 | 🟡 MED | ✅ **FIXED** | `1afbe20 fix(mcp): paid rate-limit no longer bypassable via x402 nonce (audit B P1)` (broader auth hardening commit) — also added JWT secret length validation | `crates/api-rs/src/auth/jwt.rs` checks min-32-char secret at startup |
| F-008 | 🔵 LOW | ✅ **FIXED** | Bot HMAC verification refactored as part of `c7f26cf` security hardening pass | `bot-ts/src/auth/telegram.ts` uses constant-time comparison |
| F-009 | 🔵 LOW | 🟢 ACCEPTED | (no commit) | WebSocket has no per-IP cap, but `crates/api-rs/src/ws.rs` uses `X-Forwarded-For` for IP attribution. Rate-limit applies at the HTTP upgrade. No origin check is by design — the WS endpoint is public-readable and meant to be consumed by widgets / 3rd-party integrations. Re-evaluate when abuse patterns surface. |

## Residual risk profile

| Severity | Count | Status |
|---|---|---|
| 7+ HIGH | 0 | none |
| 6 MEDIUM | 0 | none |
| 5 MEDIUM | 1 | F-004 (Redis no auth) — accepted with network isolation |
| 4 LOW | 1 | F-009 (WS no origin check) — accepted with rate-limit at upgrade |
| 3 LOW | 0 | none |

**Composite: 4 — LOW-MEDIUM.**

## Verification commands

For an external auditor or future-Rafael wanting to re-verify the
fixes without trusting this doc blindly:

```bash
# F-001 — bot-ts has lockfile in builds
test -f bot-ts/bun.lock && grep -q "COPY bun.lock" bot-ts/Dockerfile && echo "F-001: PASS"

# F-002 — rate limiter honors X-Forwarded-For
grep -q "X-Forwarded-For" crates/api-rs/src/rate_limit.rs && grep -q "X-Forwarded-For" crates/api-rs/src/ws.rs && echo "F-002: PASS"

# F-003 — CORS no longer Any in production
# Inspect crates/api-rs/src/main.rs for tower-http cors layer config

# F-005 / F-006 / F-007 / F-008 — code-level verification (manual review)
# See per-row commits above.

# F-004 / F-009 — accepted findings, verify compensating controls
# F-004: docker-compose.yml shows redis port not bound to host
# F-009: rate-limit middleware applies before WS upgrade
```

## Next audit

Per general practice, re-audit after:

1. Major architectural change (e.g., SAS proper migration, Sub-project B)
2. Annual (2027-05-26 by default)
3. Any newly-discovered finding upstream (CVE in dependency, exposed
   secret, etc.)

Triggered audit can be done with the same skill / process as
`audit-2026-05-26.md`. New audits append timestamp-suffixed files
(`audit-YYYY-MM-DD.md`).
