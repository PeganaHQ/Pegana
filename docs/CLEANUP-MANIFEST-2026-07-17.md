# Repo cleanup manifest (2026-07-17)

Prepared during the full V2 audit. The **temp/junk tier is already done**; the
**tracked-docs tier is left for founder approval** (git-recoverable, but 140+
docs mix stale process-logs with still-active designs — not safe to bulk-delete
speculatively). Review the REMOVE list, then run the block at the bottom.

## ✅ Already removed (temp/local, zero-risk)
- 22 gitignored root screenshots (`*-1280.png`, `home-*.png`, … — the "imagens X").
- `home-snapshot.yml` (Playwright ARIA snapshot artifact).
- `crates/methodology/tests/overflow_probe.rs` (a throwaway audit probe; self-cleaned).

## 🟢 KEEP — never remove (base, structure, decisions, how-it-works)
- `docs/adr/` (all ADRs — decisions), `docs/runbooks/`, `docs/pegana-trust-layer-v0.1.0/`
  (the trust spec), `docs/security/`, `docs/audits/`, `docs/operations/` (ops-critical),
  `docs/ARCHITECTURE.md` (new canonical map).
- Root: `README*`, `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md` (domain glossary),
  `brand.md`, `DESIGN.md`, `ROADMAP.md`, `assets.toml`, `Cargo*`, `migrations/`,
  `Caddyfile`, `docker-compose*.yml`, `deny.toml`, `rust-toolchain*`.
- **Active-but-dated (do NOT date-heuristic away):**
  `docs/design-research/2026-07-15-lst-directory-and-table-standard.md`,
  `2026-07-17-sub-b-risk-signals-DESIGN.md`, `2026-07-17-sub-c-loop-intelligence-DESIGN.md`
  (Sub-B/C are gated-but-live), `docs/launch/launch-scorecard-2026-07-15.md`
  (LIVE ADR-0007 gate, 2026-07-31), `docs/operations/usd-plus-pending.md` (verify-before-archive).

## 🔴 REMOVE candidates — stale process/handoff artifacts (founder confirm)
Superseded now the V2 is shipped; pure build-process logs, not architecture/decisions:
- `docs/design-research/` PRE-V2 dated subdirs: `2026-05-26-*`, `2026-06-01-*`,
  `2026-06-02-*`, `2026-06-03-*`, `2026-06-30-brand-audit` (brand info now in `brand.md`).
- `docs/design-research/` V2-build process docs: `2026-07-03-v2-1to1-*`, `2026-07-03-v5-*`
  (HANDOFF/MAP/section-upgrades), `2026-07-10-w3-*`, `2026-07-11-app-reimagination-MASTER.md`,
  `2026-07-14-HANDOFF-conta2.md`, `2026-07-16-v2-polish-round2-inventory.md`,
  `SYNTHESIS.md`, `SYNTHESIS-v2.md`.
- `docs/call-prep-2026-06-18/` (a past call's prep, 19 files).
- Root `PR_BODY.md` (a dated PR body).
- `.superstack/` (superstack tool scratch — build-context/idea-context/security-reports)
  — ⚠️ VERIFY the superstack tooling isn't reading it before removing.
- 6 orphaned web components (zero imports): `web/components/atoms/cta-link.tsx`,
  `live-ticker-card.tsx`, `active-mini-chart.tsx`, `anchor-number.tsx`,
  `dashed-corner-marks.tsx`, `dot-grid/mouse-spotlight` trio (+ their dangling tests).

## ▶ To execute (after review)
```sh
# from repo root; git rm keeps history (recoverable)
git rm -r docs/design-research/2026-05-26-* docs/design-research/2026-06-* \
         docs/design-research/2026-07-03-v* docs/design-research/2026-07-10-w3-* \
         docs/design-research/2026-07-11-app-reimagination-MASTER.md \
         docs/design-research/2026-07-14-HANDOFF-conta2.md \
         docs/design-research/2026-07-16-v2-polish-round2-inventory.md \
         docs/design-research/SYNTHESIS.md docs/design-research/SYNTHESIS-v2.md \
         docs/call-prep-2026-06-18 PR_BODY.md
# web orphans (delete file + its test):
git rm web/components/atoms/cta-link.tsx web/components/molecules/live-ticker-card.tsx  # …verify paths
# then: cargo test --workspace && (cd web && npx tsc --noEmit && npx vitest run) — must stay green
```
