# Pegana Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ~15 senior-trimmed, validated fixes from the 2026-06-19 security audit without changing any observable behavior except the bug being fixed.

**Architecture:** One phase = one independently-shippable PR with its own verification gate. Phases are ordered by value × safety. Engine/methodology changes must keep the canonical receipt hash byte-identical (gate: methodology proptests). Frontend header changes ship in a non-enforcing mode first.

**Tech Stack:** Rust (cargo workspace: `methodology`, `engine-rs`, `dispatcher-rs`, `pegana-replay-cli`), Next.js 16 (`web/`), Bun/TS (`mcp-ts`, `docs/examples/`), Caddy, Docker Compose, GitHub Actions.

**Source spec:** `docs/audit-2026-06-19-solanabr/REMEDIATION-SPEC.md` (validated; cut rationale in its Appendix A).

**Hard rule:** No `git commit`/`push` without explicit user approval. Each task's "Commit" step is a STOP — stage the diff, show it, wait for go.

---

## File-structure map

| File | Phase | Responsibility of the change |
|---|---|---|
| `crates/methodology/src/discount.rs` | ✅ done | checked division (F-12) + regression test |
| `crates/engine-rs/src/state.rs` | ✅ done | checked FX-invert (F-12) |
| `.gitignore`, `.env.example`, `.github/workflows/ci.yml` | ✅ done | F-31 / F-32 / F-15 |
| `crates/dispatcher-rs/src/main.rs` | 1 | drop `user_id` from Sentry (F-05) |
| `Caddyfile` | 1 | 403 on public `/metrics` (F-22) |
| `.github/workflows/{ci,lighthouse,reproducible-build,web-e2e}.yml` | 1 | least-privilege token (F-42) |
| `crates/pegana-replay-cli/Cargo.toml`, `src/main.rs`; `docs/pegana-trust-layer-v0.1.0/10-distribution.md`; `web/app/releases/page.tsx`; `tools/pegana-replay-public/{README.md,METHODOLOGY.md}` | 2 | reword false "re-executes methodology" claim (F-13) |
| `crates/pegana-replay-cli/src/main.rs` | 2 | `--verify-onchain` 404 → status-aware exit (F-40) |
| `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts` | 2 | `JSON.parse` try/catch (F-26) |
| `mcp-ts/Dockerfile` | 3 | run as non-root `bun` (F-34) |
| `web/app/api/waitlist/route.ts` | 3 | stop logging raw email (F-04) |
| `web/app/api/jupiter-quote/route.ts` (+ maybe `web/middleware.ts`) | 3 | stop billed-key drain (F-03) |
| `web/next.config.ts` | 3 | cheap security headers (de-scoped from full CSP) |
| `docs/runbooks/drill-log.md` (new) | 4 | record encrypted-restore drill (F-41b, ops) |

---

## Phase 0 — Already implemented + verified (record only)

- [x] **F-12** — `compute_discount` (USD + SOL paths) and `state.rs:346` use `checked_div`/`checked_sub` → `None` on overflow. Test `micro_nonzero_intrinsic_returns_none_not_panic` added. Verified: `cargo test --manifest-path crates/methodology/Cargo.toml` → **73 passed / 0 failed** (72 bit-identical proptests intact); `cargo check --manifest-path crates/engine-rs/Cargo.toml` clean.
- [x] **F-31** — `.gitignore` extended with `*.pem`, `*keypair*.json`, `.env.production`, `.env.staging`, `id_rsa*`, `id_ed25519*`, `.secrets/`.
- [x] **F-32** — `.env.example` documents `GRAFANA_ADMIN_PASSWORD` (required) + `TOKENS_XYZ_API_KEY` (optional).
- [x] **F-15** — `ci.yml` lint steps for `web` + `mcp-ts` are now blocking (`continue-on-error` removed; both lints verified clean).

> These four are uncommitted in the working tree pending the user's commit decision.

---

## Phase 1 — Backend/infra one-liners (lowest risk · ship together)

### Task 1: F-05 — drop Telegram-correlatable `user_id` from Sentry

**Files:**
- Modify: `crates/dispatcher-rs/src/main.rs:417`

- [ ] **Step 1: Verify the current line and that `alert_id` is already attached**

Run: `grep -n 'set_extra("user_id"\|set_extra("alert_id"' crates/dispatcher-rs/src/main.rs`
Expected: line ~417 has `set_extra("user_id", …)` and ~418 has `set_extra("alert_id", …)`.

- [ ] **Step 2: Delete the `user_id` extra**

Remove the line:
```rust
scope.set_extra("user_id", t.user_id.into());
```
Leave the `set_extra("alert_id", …)` line — that is sufficient to join the user in-DB and contains no PII.

- [ ] **Step 3: Verify it compiles and the leak is gone**

Run: `cargo check --manifest-path crates/dispatcher-rs/Cargo.toml 2>&1 | tail -3`
Expected: `Finished`.
Run: `grep -c 'set_extra("user_id"' crates/dispatcher-rs/src/main.rs`
Expected: `0`.

- [ ] **Step 4: Commit (STOP — show diff, await approval)**

```bash
git add crates/dispatcher-rs/src/main.rs
git commit -m "fix(dispatcher): drop Telegram-correlatable user_id from Sentry extras (audit F-05)"
```

### Task 2: F-42 — least-privilege `GITHUB_TOKEN` on the 4 unscoped workflows

**Files:**
- Modify: `.github/workflows/ci.yml`, `lighthouse.yml`, `reproducible-build.yml`, `web-e2e.yml`

- [ ] **Step 1: Confirm none of the 4 jobs push to the repo**

Run: `grep -rnE 'git push|gh release|contents: write|peter-evans|create-pull-request|comment' .github/workflows/{ci,lighthouse,reproducible-build,web-e2e}.yml`
Expected: no repo-write/PR-comment action (LHCI uses its own `LHCI_GITHUB_APP_TOKEN`, not `GITHUB_TOKEN`). If any match appears, scope that job's `permissions:` accordingly instead of the blanket read.

- [ ] **Step 2: Add a top-level `permissions` block to each of the 4 files**

Insert immediately after the `on:` block (before `jobs:`) in each:
```yaml
permissions:
  contents: read
```
(`sync-pegana-replay.yml` already has `permissions: contents: read` at job level — leave it.)

- [ ] **Step 3: Validate YAML**

Run: `for f in ci lighthouse reproducible-build web-e2e; do python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/$f.yml')); print('$f ok')"; done`
Expected: `ci ok` … `web-e2e ok`.

- [ ] **Step 4: Commit (STOP — show diff, await approval)**

```bash
git add .github/workflows/
git commit -m "ci: pin GITHUB_TOKEN to contents:read on the 4 unscoped workflows (audit F-42)"
```

### Task 3: F-22 — block public `/metrics` at Caddy

**Files:**
- Modify: `Caddyfile` (the `mcp.pegana.xyz` site block)

- [ ] **Step 1: Read the mcp.pegana.xyz block**

Run: `grep -n 'mcp.pegana.xyz' Caddyfile` then read ~25 lines from there.
Confirm a single `reverse_proxy mcp-ts:8090` with no path matcher.

- [ ] **Step 2: Add a 403 matcher BEFORE the reverse_proxy**

Inside the `mcp.pegana.xyz { … }` block, above `reverse_proxy mcp-ts:8090`:
```caddyfile
	@metrics path /metrics
	respond @metrics 403
```
(Internal Prometheus scrapes `mcp-ts:8090` over the docker network — unaffected.)

- [ ] **Step 3: Validate the config**

Run: `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -3`
Expected: `Valid configuration`.

- [ ] **Step 4: Commit (STOP). Post-deploy gate:** `curl -s -o /dev/null -w "%{http_code}" https://mcp.pegana.xyz/metrics` → `403`.

```bash
git add Caddyfile
git commit -m "fix(caddy): return 403 on public mcp.pegana.xyz/metrics (audit F-22)"
```

---

## Phase 2 — Trust layer (docs truthfulness + CLI correctness)

### Task 4: F-13 — reword the false "re-executes the methodology" claim (7 surfaces)

**Files (reword each to the honest claim):**
- `crates/pegana-replay-cli/Cargo.toml:11`
- `crates/pegana-replay-cli/src/main.rs:1-7` (module docstring)
- `docs/pegana-trust-layer-v0.1.0/10-distribution.md:14`
- `web/app/releases/page.tsx:40`
- `tools/pegana-replay-public/README.md:9` and `:53`
- `tools/pegana-replay-public/METHODOLOGY.md:204-213`

**Honest claim (the verifier re-hashes; it does NOT recompute the verdict — see ADR-0019):**
> "verifies a Pegana alert's canonical receipt hash and its signer-pinned on-chain anchor, so anyone can confirm the published history wasn't altered (tamper-evidence)."

- [ ] **Step 1: Find every false-claim string**

Run: `grep -rniE 're-execut|re-run.*methodolog|reproduce.*(methodolog|receipt|alert)|recompute|byte-for-byte|same code in crates/methodology' crates/pegana-replay-cli/ docs/pegana-trust-layer-v0.1.0/ web/app/releases/ tools/pegana-replay-public/`
Expected: the 7 locations above (plus possibly more — fix all that assert recompute).

- [ ] **Step 2: Reword each occurrence**

Replace recompute/reproduce phrasing with the honest claim. For `METHODOLOGY.md:204-213` (the most explicit), replace the "Re-runs the methodology against inputs_frozen / Compares … byte-for-byte" steps with: "Re-hashes the receipt's frozen inputs + recorded verdict and compares to the on-chain-anchored canonical hash; verifies the anchoring transaction was signed by a pinned Pegana ops key."

- [ ] **Step 3: Verify no false claim remains**

Run the Step-1 grep again.
Expected: zero hits asserting recompute/reproduce (only the corrected tamper-evidence phrasing).

- [ ] **Step 4: Confirm the CLI still builds (docstring change)**

Run: `cargo check --manifest-path crates/pegana-replay-cli/Cargo.toml 2>&1 | tail -3`
Expected: `Finished`.

- [ ] **Step 5: Commit (STOP). NOTE:** `tools/pegana-replay-public/*` syncs to the PUBLIC mirror — this also corrects the public GitHub claim.

```bash
git add crates/pegana-replay-cli docs/pegana-trust-layer-v0.1.0 web/app/releases tools/pegana-replay-public
git commit -m "docs(trust): reword verify CLI claim to tamper-evidence, not recompute (audit F-13)"
```

### Task 5: F-40 — `--verify-onchain` 404 must not silently pass

**Files:**
- Modify: `crates/pegana-replay-cli/src/main.rs:214-231` (the `verify_onchain` 404 branch)
- Test: same file's `#[cfg(test)]` module

- [ ] **Step 1: Read the current 404 handling + the API's commit_status contract**

Read `crates/pegana-replay-cli/src/main.rs:200-235` and `crates/api-rs/src/routes/audit.rs:510-590` (the `/onchain` 404 body — it returns a `commit_status`).

- [ ] **Step 2: Write the failing test**

Add to the CLI test module:
```rust
#[test]
fn onchain_404_pending_is_not_a_pass() {
    // not_applicable (DRIFT / cost-gated): never anchored → exit 0 / skip is OK.
    assert!(onchain_skip_is_ok("not_applicable"));
    // pending / retry_exhausted / wallet_drained / persistence_failed:
    // an anchor SHOULD exist → must NOT be treated as verified.
    for s in ["pending", "retry_exhausted", "wallet_drained", "persistence_failed", "unknown"] {
        assert!(!onchain_skip_is_ok(s), "status {s} must not pass silently");
    }
}
```

- [ ] **Step 3: Run it to confirm it fails (function undefined)**

Run: `cargo test --manifest-path crates/pegana-replay-cli/Cargo.toml onchain_404 2>&1 | tail -8`
Expected: FAIL — `cannot find function onchain_skip_is_ok`.

- [ ] **Step 4: Implement**

Add the helper + use it in the 404 branch:
```rust
/// Only `not_applicable` (DRIFT / cost-gated alerts that are never anchored)
/// may be skipped silently. Every other non-committed status means an anchor
/// is expected and its absence must surface as a non-pass.
fn onchain_skip_is_ok(commit_status: &str) -> bool {
    commit_status == "not_applicable"
}
```
In the 404 branch (currently `eprintln!(…); return Ok(())`), parse the body's `commit_status`; if `onchain_skip_is_ok(status)` keep `Ok(())`; otherwise print `eprintln!("ANCHOR NOT VERIFIED (status: {status})")` and return an error that maps to a non-zero exit (reuse the existing exit-4 onchain error path).

- [ ] **Step 5: Run tests**

Run: `cargo test --manifest-path crates/pegana-replay-cli/Cargo.toml 2>&1 | tail -6`
Expected: PASS (new test + existing `tests/replay.rs` green).

- [ ] **Step 6: Commit (STOP)**

```bash
git add crates/pegana-replay-cli/src/main.rs
git commit -m "fix(cli): --verify-onchain 404 exits non-zero unless commit_status is not_applicable (audit F-40)"
```

### Task 6: F-26 — webhook example: guard `JSON.parse`

**Files:**
- Modify: `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts:159`

- [ ] **Step 1: Read lines 150-165** to confirm `const event = JSON.parse(body) as …` runs after signature verification, with no try/catch.

- [ ] **Step 2: Wrap in try/catch → 400**

```ts
let event: { asset: string; from_state: string; to_state: string; discount_bps: number; ts: string; alert_id: string };
try {
  event = JSON.parse(body) as typeof event;
} catch {
  return new Response("invalid JSON body", { status: 400 });
}
```

- [ ] **Step 3: Type-check the example** (it has its own tsconfig)

Run: `cd docs/examples/webhook-receivers/typescript-cloudflare-worker && bunx tsc --noEmit 2>&1 | tail -5 || true`
Expected: no new type errors from the change.

- [ ] **Step 4: Commit (STOP)**

```bash
git add docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts
git commit -m "docs(examples): guard JSON.parse in CF-Worker webhook receiver (audit F-26)"
```

---

## Phase 3 — Web + container hardening (test the user flow before merge)

### Task 7: F-34 — run `mcp-ts` container as non-root

**Files:**
- Modify: `mcp-ts/Dockerfile`

- [ ] **Step 1: Read `mcp-ts/Dockerfile`** — confirm no `USER` directive; note the final stage uses an `oven/bun` base and `WORKDIR /app`.

- [ ] **Step 2: Add `USER bun` in the runtime stage**

After the final `COPY`/`WORKDIR /app`, before `CMD`/`ENTRYPOINT`:
```dockerfile
# Run as the non-root user shipped by the oven/bun base image (audit F-34).
# Do NOT copy the Rust uid-10001 pattern — bun's $HOME/.bun cache needs a real home.
USER bun
```

- [ ] **Step 3: Build and confirm it runs as non-root + can write its cache**

Run: `docker build -t pegana-mcp-test mcp-ts/ 2>&1 | tail -3 && docker run --rm --entrypoint sh pegana-mcp-test -c 'id -un && touch /tmp/x && echo write-ok'`
Expected: `bun` … `write-ok`.

- [ ] **Step 4: Commit (STOP)**

```bash
git add mcp-ts/Dockerfile
git commit -m "fix(docker): run mcp-ts as non-root bun user (audit F-34)"
```

### Task 8: F-04 — stop persisting waitlist email in plaintext logs

**Files:**
- Modify: `web/app/api/waitlist/route.ts:96-104`

- [ ] **Step 1: Read the handler** — confirm `console.log(JSON.stringify({ … email: payload.email … }))` is the only persistence.

- [ ] **Step 2: Stop logging the raw email**

Replace the raw `email` field with a non-reversible marker (keep the event for ops visibility):
```ts
import { createHash } from "node:crypto";
// …
console.log(
  JSON.stringify({
    event: "waitlist_signup",
    email_sha256: createHash("sha256").update(payload.email.toLowerCase()).digest("hex"),
    classes: payload.classes ?? [],
    use_case: payload.use_case ?? null,
    ts: new Date().toISOString(),
  }),
);
```
(If a real `waitlist` DB table is preferred later, that supersedes this — but the hash removes the PII-in-logs now.)

- [ ] **Step 3: Type-check + smoke the route**

Run: `cd web && bun run typecheck 2>&1 | tail -3`
Expected: clean.
Manual: POST a signup → response unchanged; logs show `email_sha256`, no raw address.

- [ ] **Step 4: Commit (STOP)**

```bash
git add web/app/api/waitlist/route.ts
git commit -m "fix(web): hash waitlist email in logs, drop plaintext PII (audit F-04)"
```

### Task 9: F-03 — stop the `/api/jupiter-quote` billed-key drain

**Files:**
- Modify: `web/app/api/jupiter-quote/route.ts`

> Validation correction: the route is called from a PUBLIC client widget (`exit-liquidity.tsx`) → JWT-gating breaks logged-out users, and an in-memory limiter is useless on Vercel serverless. Use a **mint-pair allowlist** (the screener only quotes Pegana-tracked assets) as the leanest effective fix; it kills enumeration without infra.

- [ ] **Step 1: Read the route + how the widget calls it** (`web/components/organisms/exit-liquidity.tsx`) — list the exact `inputMint`/`outputMint` values the UI ever requests.

- [ ] **Step 2: Write the failing test (allowlist rejects unknown pairs)**

Add `web/app/api/jupiter-quote/route.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isAllowedPair } from "./allowlist";
describe("jupiter-quote allowlist", () => {
  it("allows a tracked pair", () => {
    expect(isAllowedPair("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")).toBe(true);
  });
  it("rejects an arbitrary pair", () => {
    expect(isAllowedPair("So11111111111111111111111111111111111111112", "1nc1nerator11111111111111111111111111111111")).toBe(false);
  });
});
```
(Use the real tracked mints from Step 1.)

- [ ] **Step 3: Run it — fails (module missing)**

Run: `cd web && bunx vitest run app/api/jupiter-quote 2>&1 | tail -6`
Expected: FAIL — cannot find `./allowlist`.

- [ ] **Step 4: Implement `web/app/api/jupiter-quote/allowlist.ts`** with the exact tracked mint set from Step 1, and call `isAllowedPair(inputMint, outputMint)` in the route after input validation — return `400 {"error":"unsupported_pair"}` on miss, before any Jupiter fetch.

- [ ] **Step 5: Run tests + verify the widget still works for logged-out**

Run: `cd web && bunx vitest run app/api/jupiter-quote && bun run typecheck 2>&1 | tail -4`
Expected: PASS. Manual: the exit-liquidity widget renders quotes for tracked assets logged-out.

- [ ] **Step 6: Commit (STOP)**

```bash
git add web/app/api/jupiter-quote/
git commit -m "fix(web): allowlist mint pairs on jupiter-quote to stop billed-key drain (audit F-03)"
```

### Task 10: cheap security headers (de-scoped from full CSP)

**Files:**
- Modify: `web/next.config.ts`

> Senior cut: a full CSP with `'unsafe-inline'` (forced by Tailwind/JSON-LD/next-themes) adds little real XSS protection at high breakage risk. Ship the cheap, high-value headers now; full nonce-based CSP is roadmap.

- [ ] **Step 1: Read `web/next.config.ts`** — confirm there is no `async headers()` and capture the existing exported config shape.

- [ ] **Step 2: Add a `headers()` block (NOT a CSP yet)**

```ts
async headers() {
  return [
    {
      source: "/((?!embed).*)", // embed/* sets its own frame-ancestors *
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
      ],
    },
  ];
}
```

- [ ] **Step 3: Build to confirm the config is valid**

Run: `cd web && bun run build 2>&1 | tail -8`
Expected: build succeeds.

- [ ] **Step 4: Verify the headers + that `/embed` is exempt**

After `bun run start` (or on preview): `curl -sI http://localhost:3000/ | grep -iE 'x-frame|nosniff|referrer|permissions'` → all four present; `curl -sI http://localhost:3000/embed/USDC` → no `X-Frame-Options` (embeddable, intended).

- [ ] **Step 5: Commit (STOP)**

```bash
git add web/next.config.ts
git commit -m "feat(web): add X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy headers (audit F-07 cheap-subset)"
```

---

## Phase 4 — Ops (no code)

### Task 11: F-41b — drill the encrypted R2 restore

- [ ] **Step 1:** On the Hetzner host, restore the latest encrypted backup into a scratch DB:
`scripts/pg-restore.sh restore <latest-name> --into pegana_restore_drill`
- [ ] **Step 2:** Confirm the `~/.pegana-backup-key` decryption succeeded and row counts on 2-3 key hypertables are non-zero.
- [ ] **Step 3:** Create `docs/runbooks/drill-log.md` with: date, backup name, RTO observed, row-count spot-checks, pass/fail. Drop the scratch DB.
- [ ] **Step 4: Commit (STOP)** `git add docs/runbooks/drill-log.md && git commit -m "ops: log first encrypted R2 restore drill (audit F-41b)"`

---

## Self-Review

**Spec coverage:** Every IN item maps to a task — F-12/F-31/F-32/F-15 (Phase 0, done), F-05/F-42/F-22 (Phase 1), F-13/F-40/F-26 (Phase 2), F-34/F-04/F-03/F-07-cheap (Phase 3), F-41b (Phase 4). Cut items (F-39/F-08/F-18/F-16/F-28/full-CSP/F-35-extra) are intentionally absent per the senior review; roadmap items (F-13b re-derivation, F-41c RPC failover, F-06 cookie) are out of scope.

**Placeholder scan:** Tasks over files I read line-by-line during the audit (F-05, F-13 grep, F-40, F-26, F-34, F-04, F-03, headers) carry concrete code; tasks whose exact current bytes I have not re-read this session (Caddyfile block, jupiter-quote route body, waitlist route body, CLI 404 branch) open with a "read the file" step before applying the shown change — that is deliberate, not a TODO. No "implement later"/"add error handling" placeholders.

**Type/name consistency:** `onchain_skip_is_ok` (Task 5), `isAllowedPair` (Task 9), `email_sha256` (Task 8) are each defined and used within their own task. The honest-claim wording (Task 4) is identical across the 7 surfaces.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-19-pegana-audit-remediation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

**Which approach?** (And: keep the already-applied Phase-0 changes, or revert them so every change flows through the plan?)
