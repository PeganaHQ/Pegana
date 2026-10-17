# FINAL REVIEW WORKFLOW — Trust Layer v0.1.0

> Run before 2026-06-01 prod deploy (Phase 3 dogfood) and again before
> 2026-06-11 public launch. This is the cross-cutting audit that the
> per-wave `/review-and-iterate` passes can't catch on their own.

## Why this workflow exists

The 13 waves each got an immediate `/review-and-iterate` pass and any P0/P1/P2
findings were fixed inline. That pattern catches issues INSIDE a wave. It
does NOT catch:

- Cross-wave inconsistencies (e.g. Wave 4's payload doesn't match Wave 6's
  Telegram renderer expectations).
- Spec acceptance criteria that no commit explicitly claims.
- Cross-cutting security concerns (a route added in Wave 4 + a CORS layer
  in Wave 7 that interacts badly).
- Operational gaps (a script lists wrong migrations; a doc references a
  deleted file).

The 4-agent parallel audit catches these.

## The 4 parallel audits

| Agent | Scope | Source of truth |
|---|---|---|
| **A — AC conformance** | every `AC*` listed in `12-acceptance-criteria.md` has implementation evidence | `12-acceptance-criteria.md` (~92 ACs) |
| **B — Cross-cutting security** | 11 checks: secrets, SQL, CORS, rate limit, signing, wallet, Sigstore, install.sh, public-data leak, append-only | `docs/adr/*` |
| **C — Solana + MCP correctness** | SPL Memo encoding, RPC client patterns, MCP SDK conformance, x402 wiring | Solana mainnet docs + MCP SDK |
| **D — Feature completeness** | every user-facing surface (TG, web, RSS, embed, SDK, CLI) vs spec § 08+09 | `08-external-surfaces.md` + `09-web-pages.md` |

All four agents run **in parallel** (`run_in_background: true`) and return
short reports (≤500 words each) — only gaps + fix suggestions.

## When to re-run

| Trigger | Run |
|---|---|
| Pre 2026-06-01 dogfood deploy | All 4 (mandatory) |
| Pre 2026-06-11 public launch | All 4 (mandatory) + run `scripts/pre-deploy-check.sh` |
| Methodology bump (per ADR-0009) | B + C only — schema didn't change |
| New asset added (per ADR-0002) | D only — surfaces didn't change |
| ADR-0014 rate-limit tuning | B only |
| Outreach scorecard verdict (07-15) | NONE — review is for code, not GTM |

## How to invoke

```bash
# Sequential cycle:
bash scripts/pre-deploy-check.sh          # gauntlet first
# Then in claude session:
#   /review-and-iterate (4×, one per audit)
# OR via Agent tool, all 4 in parallel (preferred)
```

The parallel mode is faster (~5-10 min wall-clock) and the agents don't
share state — each reads the codebase fresh. Synthesis is the human's job:
collect findings, triage by severity, apply fixes.

## Severity ladder for findings

- **P0** — actively breaks the trust pitch or causes data loss. Fix before
  shipping ANYTHING. Examples: `--verify-onchain` was a stub (Wave 8 review
  caught this).
- **P1** — silent failure, misleading output, or attack surface that's
  reachable. Fix before mainnet deploy (06-01).
- **P2** — degraded behavior, race condition under specific conditions, or
  a feature that's documented but missing. Fix before public launch (06-11).
- **P3** — style nit, minor perf, by-design observation. Defer to v0.1.1+.

## Outputs

After all 4 audits complete:

1. Findings table (`P0 P1 P2 P3` counts).
2. For each P0/P1/P2: file:line + suggested fix.
3. Apply fixes inline; re-run `pre-deploy-check.sh` to confirm.
4. Commit fixes with message `fix(review): cross-cutting audit fixes`.
5. Update `AMENDMENTS.md` if a fix changes the spec contract.

## Reference: the per-wave review track record

| Wave | P0 | P1 | P2 | P3 | Status |
|---|---|---|---|---|---|
| 3B | 0 | 0 | 2 | 2 | fixed |
| 4 | 0 | 0 | 2 | 2 | fixed |
| 5 | 0 | 0 | 1 | 3 | fixed |
| 6 | 0 | 0 | 0 | 0 | clean |
| 7 | 0 | 0 | 0 | 4 by-design | clean |
| 8+9 | 0 | **1** | 2 | 1 | fixed |
| 10+11 | 0 | 0 | 1 | 0 | fixed |
| 11M | 0 | 0 | 0 | 0 | clean |
| 12 | 0 | 0 | 0 | 0 | clean |
| 13 | 0 | 0 | 0 | 0 | clean (docs only) |
| **FINAL** (4-audit) | **0** | **4** | **8** | **~6** | **fixed** |

Net (pre-final): **1 P1, 8 P2, 12 P3** across 13 waves; all fixed inline.

## Run log — 2026-05-29 final audit (pre-2026-06-01 deploy)

Four parallel audits dispatched after Wave 13. Findings:

| Audit | P0 | P1 | P2 | P3 | Notes |
|---|---|---|---|---|---|
| **A — AC conformance** | 0 | 0 | 2 | — | AC50 atom-discovery, AC54+55 embed gaps, AC84 test bound, AC88 hero copy |
| **B — Security** | 0 | **2** | 1 | — | MCP paid-tier RL bypass (x402 nonce), install.sh fail-OPEN; 0032 update-immutability |
| **C — Solana + MCP** | 0 | **2** | 1 | — | replay-cli missed inner_instructions; verify_alert no outputSchema; structured error |
| **D — Feature completeness** | 0 | 0 | 4 | — | bot /help no evidence line; trust-strip no DRIFT count; OpenAPI no methodology; audit filter UI |

**12 fixes shipped** in 12 commits (`1afbe20`..`c83e7d1`, `7014417`..`0fab52b`).

**Deferred** (not blockers for 06-01 dogfood):
- **AC72** — Dockerfile `@sha256:` pinning across 6 Dockerfiles. Effort > benefit pre-launch.
- **AC67** — devnet integration test for on-chain commit path.
- **AC70** — reproducible-build CI trigger (recipe shipped; CI hook deferred).
- **AC60-63** — SDK npm/PyPI publish — intentional per `private: true` flag.
- **AC42** — audit index server-side state filter (client-side filter shipped as bridge).

**Verification on 2026-05-29:**
- `pre-deploy-check.sh` → 10 pass / 0 fail / 1 skip (PEGANA_INTEGRATION_PG_URL operational)
- `bot-ts` → 63 pass / 7 skip / 0 fail
- `mcp-ts` → 19 pass / 2 skip (x402 devnet) / 0 fail
- `cargo clippy --workspace --all-targets -- -D warnings` → clean
- `cargo test -p pegana-common --lib assets_toml_parses` → pass

Branch state: **~74 commits ahead of main**, working tree clean.
Cross-cutting audit pass is the final gate before shipping. Re-run before 06-11.
