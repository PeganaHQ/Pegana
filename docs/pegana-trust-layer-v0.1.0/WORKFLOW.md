# WORKFLOW — Trust Layer v0.1.0 execution

> Branch: `feat/trust-layer-v0.1.0`
> Spec: `00-README.md` → `13-risks-and-mitigations.md`
> Plans: `plans/00-README.md` → `plans/14-phase-14-15-post-launch.md`
> ADR amendments: `AMENDMENTS.md`
> Glossary: `../../CONTEXT.md`

This document defines HOW the 59 tasks across 13 phases will be executed.
It does NOT redefine the work itself — that's in the plan files.

---

## Operating principles

1. **One branch**: `feat/trust-layer-v0.1.0`. All work merges into this
   single branch. Single PR at the end goes to `main` (or a series of
   PR if scope creeps).
2. **One commit per task**: commit message follows the
   `<type>(<scope>): <subject>` convention already in repo history.
3. **ADRs win**: when an ADR conflicts with the original spec, follow
   the ADR. AMENDMENTS.md is the index.
4. **Verification before "done"**: a task is not complete until tests
   pass AND the acceptance criterion is hit.
5. **Subagent dispatch for parallelizable work**: use the Agent tool
   with the `general-purpose` subagent type. Each subagent is given:
   - The exact task ID + plan file path
   - Required reading: `AMENDMENTS.md` + the relevant ADRs
   - "Commit at the end; do not push"
6. **Wait gates between dependent phases**: never start a downstream
   phase before its dependency commits land.

---

## Phase dependency graph

```
Phase 0 ──────────────────────────────────────────────────────┐
(parallel, calendar-gated, 05-29 → 06-10)                     │
                                                              │
Phase 1 (methodology) ──┐                                     │
                        ├──► Phase 3 (audit persistence) ──┐  │
Phase 2 (engine) ───────┘                                  │  │
                                                           ├──► Phase 13
Phase 4 (API) ────────────────────────────────────────────┤  (deploy + outreach)
Phase 5 (dispatcher) ─────────────────────────────────────┤
Phase 6+7 (bot + MCP) ────────────────────────────────────┤
Phase 8+9 (CLI + distribution) ───────────────────────────┤
Phase 10 (web /audit pages) ──────────────────────────────┤
Phase 11 (lifecycle + index + OG) ────────────────────────┤
Phase 11M (maximalist features) ──────────────────────────┤
Phase 12 (observability) ─────────────────────────────────┘
```

**Critical path**: Phase 1 → Phase 2 → Phase 3 → (everything else) → Phase 13.

---

## Wave plan (when to dispatch what)

### Wave 1 — 2026-05-29 (NOW)
- **Phase 0 Task 0.1** — `alert_events` view check on prod
- **Phase 0 Task 0.2** — add 5 new assets to `assets.toml` (passive)
- **Phase 1 Tasks 1.1–1.7** — `pegana-methodology` crate (subagent
  dispatch: 1 agent, sequential within phase)

These three can start in parallel (Task 0.1 needs SSH access; Task 0.2
is a single PR; Phase 1 is heavy engineering).

### Wave 2 — after Phase 1 commits
- **Phase 2 Tasks 2.1–2.4** — engine refactor (depends on Phase 1)

### Wave 3 — after Phase 2 commits
- **Phase 3 Tasks 3.1–3.6 + ADR amendments** — audit persistence,
  including:
  - ADR-0003 retraction tables
  - ADR-0004 commit_status enum + commit_failures table + retry job
  - ADR-0006 alert_evidence_pending table + 202/410 + evidence_status
  - ADR-0010 engine_state_snapshot table + load/write

**Deploy gate**: end of Wave 3 commits get tagged + DEPLOYED TO PROD on
2026-06-01 (ADR-0005).

### Wave 4 — after Phase 3 prod-deploy
Parallel dispatch of all of these (independent after Phase 3):
- **Phase 4** — API endpoints + ADR-0006 (202/410) + ADR-0014 (rate limits)
- **Phase 5** — Dispatcher + ADR-0003 retraction re-fire + ADR-0006 evidence_status
- **Phase 6+7** — Bot locales + MCP tools + ADR-0011 rate limit + telemetry
- **Phase 8+9** — CLI + cargo-dist + ADR-0008 install verify
- **Phase 10** — `/audit/[id]` page + ADR-0013 snapshot badge
- **Phase 11** — lifecycle + index + OG + ADR-0013 timeline
- **Phase 11M** — 7 maximalist tasks (further parallelizable)
- **Phase 12** — Observability + ADR-0004 metrics + ADR-0011 mcp_calls panel

### Wave 5 — calibration ends
- **2026-06-10**: read calibration data, compute mechanical verdict
  per ADR-0001
- If SHIP: proceed to Phase 13
- If TUNE: 7-day extension cycle
- If EXTEND: 14-day extension cycle

### Wave 6 — Phase 13 (launch day)
- **2026-06-11**: deploy public surface flip; outreach (Parity,
  StableGuard, SendAI, DefiLlama)

### Wave 7 — post-launch
- **2026-06-25**: methodology stability lock ends (ADR-0009)
- **2026-07-15**: launch scorecard published (ADR-0007)
- **2026-07-31**: scorecard kill-rule decision (ADR-0007)

---

## Subagent dispatch template

Every dispatch follows this prompt skeleton:

```
You are executing Task <X.Y> from
`docs/pegana-trust-layer-v0.1.0/plans/<phase-file>.md`.

REQUIRED READING before starting:
1. `docs/pegana-trust-layer-v0.1.0/AMENDMENTS.md` (index)
2. `docs/pegana-trust-layer-v0.1.0/<phase-file>.md` § Task <X.Y>
3. Any ADR listed in AMENDMENTS.md as affecting this task

WORKFLOW:
1. Read the task fully.
2. Read the referenced ADRs.
3. Follow the steps in the task EXACTLY.
4. Run the listed tests; they must pass.
5. Commit with the message in the task (do not edit it).
6. Do NOT push.
7. Return: "Task <X.Y> committed as <sha>" plus any deviations.

CONSTRAINTS:
- Match existing code conventions (look at neighbor files).
- Do not add new dependencies beyond what the task lists.
- Do not write comments explaining WHAT the code does.
- Do not "improve" code that isn't in the task scope.

VERIFICATION:
- After commit, run `cargo check -p <crate>` (or equivalent) once more.
- Report any unexpected output.
```

---

## Verification gate between phases

Before moving from Wave N → Wave N+1:

1. **Tests green**: `cargo test --workspace` AND `pnpm test` (in `web/`,
   `bot-ts/`, `mcp-ts/` where applicable).
2. **No uncommitted files**: `git status` clean.
3. **Acceptance criteria touched**: cross-check the AC list in
   `12-acceptance-criteria.md` against work done; mark which are
   satisfied.
4. **ADR conformance**: spot-check that ADR amendments were
   incorporated (grep for the ADR number in changed files).
5. **Branch state**: `git log --oneline main..feat/trust-layer-v0.1.0`
   reads as a coherent narrative.

If any check fails: STOP, fix, re-verify before dispatching Wave N+1.

---

## Calendar checkpoints

| Date | Action |
|---|---|
| 2026-05-29 | Wave 1 dispatch (Phase 0 + Phase 1) |
| 2026-05-30 | Wave 2 dispatch (Phase 2) |
| 2026-05-31 | Wave 3 dispatch (Phase 3 + ADR amendments) |
| 2026-06-01 | Phase 3 PROD DEPLOY (FEATURE_PUBLIC_ALERTS=false) |
| 2026-06-02 | Wave 4 dispatch (Phases 4–12 in parallel) |
| 2026-06-03 | Webhook dogfood report due |
| 2026-06-05 | Wave 4 verification gate |
| 2026-06-10 | Calibration v1 mechanical verdict (ADR-0001) |
| 2026-06-11 | PUBLIC LAUNCH (Wave 6, Phase 13) |
| 2026-06-25 | Stability lock ends |
| 2026-07-15 | Launch scorecard |
| 2026-07-31 | Scorecard kill-rule |

---

## Rollback

If a wave breaks production (Phase 3 deploy on 06-01 is the highest
risk):

1. `git revert <commit-range>` on `feat/trust-layer-v0.1.0`
2. Re-deploy the previous engine binary on Hetzner
3. `DROP TABLE alert_evidence, alert_evidence_pending,
   alert_evidence_commit_failures, engine_state_snapshot,
   methodology_versions, mcp_call_log CASCADE;` (rollback per ADR
   migration)
4. Document the incident in `docs/operations/incidents/`
5. Resume work on the branch from a known-good commit

---

## When to merge to main

The branch merges to main as a single PR on **2026-06-11** when:

- All Wave 4–6 work is committed.
- Phase 3 prod deploy (Wave 3 → 06-01) is stable.
- Calibration verdict was SHIP per ADR-0001.
- Public launch is GO.

If the verdict slips to 06-17 or 06-24, the merge date slips with it.

---

## Out of scope for this branch

The following stay on main / future branches:
- Sub-project B (venue feeds, Pyth Lazer, oracle health)
- Sub-project C (loop intelligence)
- Sub-project D (wallet risk + `/connect`)
- Sub-project E (predictive signals)
- Phase 14 (backtest publication) — post-launch, separate PR
- Phase 15 (pricing tiers ACTIVE billing) — gated by design partner

These are tracked in `project_trust_layer_followups.md` memory entry.
