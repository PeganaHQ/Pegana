> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Plans — Trust Layer v0.1.0 Execution Order

> Companion to `../00-README.md`. This file is the navigation + dependency graph for the 14 phase files.

---

## Execution philosophy

- **Each phase is independently committable**. Phase boundaries are TDD checkpoints + commit points.
- **TDD discipline**: every task follows write-failing-test → run-to-fail → implement → run-to-pass → commit. Steps within a task are 2-5 minute units.
- **No batching**: do not skip the "run to confirm fail" step. Without it, the test is not validated.
- **Frequent commits**: each task ends with a `git commit`. Atomic.
- **Subagent execution recommended**: dispatch a fresh subagent per phase, review between phases. Keeps main context clean for 50+ tasks.

---

## Phase dependency graph

```
                 ┌──────────────────────────────────┐
                 │  Phase 0 — Pre-Flight (PARALLEL) │
                 │  - asset entries active=false   │
                 │  - calibration monitoring        │
                 │  - dogfood/calibration reports   │
                 └────────────┬─────────────────────┘
                              │
                              │ runs in parallel with engineering phases
                              │
   ┌──────────────────────────▼────────────────────────────┐
   │                                                       │
   │  Phase 1 — methodology crate (foundation)             │
   │            ↓                                          │
   │  Phase 2 — engine refactor (depends on Phase 1)       │
   │            ↓                                          │
   │  Phase 3 — audit persistence (migrations + push_alert)│
   │            ↓                                          │
   │  Phase 4 — API endpoints (depends on Phase 3 schema)  │
   │            ↓                                          │
   │  Phase 5 — Dispatcher (depends on Phase 3 + 4 URL fmt)│
   │            ↓                                          │
   │  Phase 6+7 — Bot locale + MCP tools (parallel ok)     │
   │            ↓                                          │
   │  Phase 8+9 — pegana-replay CLI + cargo-dist (parallel)│
   │            ↓                                          │
   │  Phase 10 — Web pages /audit/[id]                     │
   │            ↓                                          │
   │  Phase 11 — methodology_versions + /audit index + OG  │
   │             + /methodology + /pricing + /agents       │
   │            ↓                                          │
   │  Phase 11M — Maximalist (7 features, mostly parallel) │
   │   ├─ 11M.1 SAS on-chain commit (engine + new col)     │
   │   ├─ 11M.2 RSS /audit.xml                             │
   │   ├─ 11M.3 Embed widget /embed.js + /embed/[asset]    │
   │   ├─ 11M.4 CSV /v1/audit.csv                          │
   │   ├─ 11M.5 SDK auto-gen (TS + Python)                 │
   │   ├─ 11M.6 RSS /calibration.xml                       │
   │   └─ 11M.7 Reproducible builds CI                     │
   │            ↓                                          │
   │  Phase 12 — Observability + trust strip + launch copy │
   │            ↓                                          │
   │  Phase 13 — DEPLOY (gated by Phase 0.4 + 0.5 reports) │
   │             + Outreach (Parity, StableGuard, SendAI)  │
   │            ↓                                          │
   └────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌─────────────────────────────┐
                  │  Phase 14 — Backtest 10/10  │
                  │  (DEFERRED — post-USDe live) │
                  └────────────────┬─────────────┘
                                   │
                                   ▼
                  ┌─────────────────────────────┐
                  │  Phase 15 — Pricing tiers   │
                  │  (DEFERRED — post-partners) │
                  └─────────────────────────────┘
```

---

## Phase files

| File | Phase(s) | Tasks | Approx duration |
|---|---|---|---|
| `01-phase-0-preflight.md` | 0 | 5 tasks (0.1-0.5) | Calendar-gated: 14d (05-27 → 06-10) |
| `02-phase-1-methodology.md` | 1 | 7 tasks (1.1-1.7) | 2-3 days focused |
| `03-phase-2-engine.md` | 2 | 4 tasks (2.1-2.4) | 1-2 days |
| `04-phase-3-audit-persistence.md` | 3 | 6 tasks (3.1-3.6) | 1-2 days |
| `05-phase-4-api.md` | 4 | 2 tasks (4.1-4.2) | 1 day |
| `06-phase-5-dispatcher.md` | 5 | 2 tasks (5.1-5.2) | 0.5 day |
| `07-phase-6-7-bot-mcp.md` | 6+7 | 4 tasks (6.1, 6.2, 7.1, 7.2) | 0.5 day |
| `08-phase-8-9-cli-distribution.md` | 8+9 | 4 tasks (8.1, 8.2, 9.1, 9.2) | 1-2 days |
| `09-phase-10-web-pages.md` | 10 | 1 task (10.1 with 6 sub-steps) | 1 day |
| `10-phase-11-lifecycle-index-og.md` | 11 | 6 tasks (11.1-11.6) | 2-3 days |
| `11-phase-11M-maximalist.md` | 11M | 7 tasks (11M.1-11M.7) | 4-5 days (parallel: 2-3 days) |
| `12-phase-12-observability.md` | 12 | 5 tasks (12.1-12.5) | 1 day |
| `13-phase-13-deploy-outreach.md` | 13 | 6 tasks (13.1-13.6) | 1 day deploy + outreach over a week |
| `14-phase-14-15-post-launch.md` | 14+15 | DEFERRED | Post-06-11, weeks-month |

**Total in-scope work (Phases 1-13)**: ~14-18 days focused, OR 8-10 days with subagent parallelism. ADRs 0001-0014 add ~5 days; see `../AMENDMENTS.md § Engineering budget impact`.

**Critical path constraint**:
- **Phase 3 prod deploy by 2026-06-01** (per ADR-0005 — gives 9 days of evidenced calibration data before the verdict).
- **Public launch by 2026-06-11** gated by mechanical verdict per ADR-0001.
- Calendar gives ~14 days from now (05-28).

---

## How to execute (recommended subagent flow)

1. **Start of day**: read this file + current phase file.
2. **Open the phase file's "Tasks" section** (e.g., `02-phase-1-methodology.md`).
3. **For each task**:
   - Dispatch a subagent with prompt: "Execute Task X.Y from `docs/pegana-trust-layer-v0.1.0/plans/<phase>.md`. Follow the steps exactly. Do not skip TDD verification."
   - Subagent runs steps 1-N, commits at the end.
   - You review the diff + tests passed.
   - Mark task done in this file via `- [x]`.
4. **End of phase**: verify acceptance criteria for that phase (see `../12-acceptance-criteria.md`).
5. **Move to next phase**.

---

## What can run in parallel?

- **Phase 0** runs in parallel with Phases 1-12 (it's calendar-gated, not engineering-gated).
- **Phase 11M** tasks 11M.1 through 11M.7 are mostly independent of each other after Phase 10 + Phase 11 complete. Can run in parallel with separate subagents.
- **Outreach in Phase 13** (Tasks 13.3-13.6) runs in parallel with deploy work (Tasks 13.1-13.2).
- **SDK release** (Phase 11M.5) can be a separate workflow that triggers on demand, not blocking other work.

---

## What blocks deploy (Phase 13)? — amended per ADRs 0001-0008

The deploy gate now references ADRs as authoritative. See `../01-business-rules.md § 5` (amended) for the current 8-item checklist, and ADR-0001 for the mechanical verdict rule.

Key sequencing change (ADR-0005): Phase 3 deploys to prod on **2026-06-01** with `FEATURE_PUBLIC_ALERTS=false`, NOT in Phase 13. The 06-11 Phase 13 step is only the public surface flip.
8. Engine wallet funded ≥ 0.5 SOL

If any item is missing on 06-10, deploy slips. No exceptions.

---

## Conventions

### File paths
All paths in plan files are **relative to repo root** unless absolute (which they shouldn't be).
- ✅ `crates/methodology/Cargo.toml`
- ❌ `/Users/rafazaum/Desktop/Projetos/pegana/crates/methodology/Cargo.toml`

### Commit messages
Standard Conventional Commits:
- `feat(scope): description` — new feature
- `refactor(scope): description` — code change without behavior change
- `test(scope): description` — test additions
- `docs(scope): description` — doc-only
- `chore(scope): description` — build, CI, config
- `i18n(scope): description` — locale changes

Every commit ends with:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Test commands
- Rust: `cargo test -p <crate-name> [--test <test-file>] [test_name]`
- TS/Bun: `cd <ts-dir> && bun test`
- Web typecheck: `cd web && bun typecheck`
- Web dev: `cd web && bun dev`
- Migrations: `sqlx migrate run --source migrations --database-url $DATABASE_URL`

### Branch + worktree

Recommended setup:
```bash
git worktree add ../pegana-trust-layer feat/trust-layer-v0.1.0
cd ../pegana-trust-layer
```

This isolates Trust Layer work from `main`. Merge after all 13 phases complete and acceptance criteria green.

---

## When tasks fail unexpectedly

Per spec `13-risks-and-mitigations.md`:

- **Compilation error after refactor**: revert the last change, re-read the task, retry in isolation.
- **Test failure that's NOT due to your code**: pause, investigate; might indicate a stale `Cargo.lock` or db state.
- **Migration error**: check `sqlx migrate info` for divergent state.
- **Deploy step fails**: do not retry blindly; consult `plans/13-phase-13-deploy-outreach.md § Rollback`.

When in doubt, ask Rafael before proceeding. Mistakes that touch production database or push to npm/PyPI are NOT reversible.

---

## Cross-references

- Each phase file references specific sections of spec files in `../`.
- For business rules governing all work, see `../01-business-rules.md`.
- For component-level architecture, see `../02-architecture.md`.
- For acceptance criteria mapped to each phase, see `../12-acceptance-criteria.md`.
