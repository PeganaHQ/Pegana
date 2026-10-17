# Commercial GA Gate Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Pegana's five remaining Commercial GA gates with exact-SHA technical runs and authentic legal, operational, commercial, and security evidence.

**Architecture:** A fail-closed evidence ledger coordinates five independent tracks. CI workflows test an externally deployed candidate rather than a development server; repository templates capture only redacted attestations and immutable digests; the final verdict reads those artifacts and remains `NO-GO` until every gate is valid.

**Tech Stack:** GitHub Actions, Vercel preview/production, Lighthouse CI, Playwright, Bun/Vitest/ESLint/TypeScript, Telegram/Alertmanager, Markdown ADRs, SHA-256 evidence digests.

---

## File structure

- Modify `.github/workflows/lighthouse.yml`: accept an exact deployed target and retain Lighthouse evidence.
- Modify `.github/workflows/web-e2e.yml`: run blocking preview/production-shaped Playwright without `next dev`.
- Modify `web/playwright.config.ts`: support external targets without starting a local server.
- Modify `web/lighthouserc.json`: make target URLs explicit while preserving budgets.
- Modify relevant `web/tests/e2e/*.spec.ts`: repair only failures demonstrated by the final run.
- Create `docs/launch/commercial-ga/evidence-ledger.md`: canonical fail-closed status and artifact index.
- Create `docs/launch/commercial-ga/legal-review-attestation.md`: redacted counsel attestation schema.
- Create `docs/launch/commercial-ga/telegram-paging-attestation.md`: human receipt schema.
- Modify `docs/outreach/log.md`: instrument ADR-0007 entries with proof and qualification fields.
- Create `docs/launch/commercial-ga/paid-pilot-attestation.md`: restricted-record digest schema.
- Create `docs/security/protocol-indexer-bigint-buffer-waiver.md` only if removal is infeasible.
- Create `docs/decisions/YYYY-MM-DD-adr-0007-commercial-ga-verdict.md` after authentic demand evidence exists.
- Create `docs/decisions/YYYY-MM-DD-commercial-ga-verdict.md` only after all five gates pass.

### Task 1: Establish the fail-closed evidence ledger

**Files:**
- Create: `docs/launch/commercial-ga/evidence-ledger.md`
- Test: repository content checks

- [ ] **Step 1: Create the evidence directory after verifying its parent**

Run: `ls docs/launch`
Expected: existing launch documents are listed.

- [ ] **Step 2: Write the ledger with five blocked gates**

Use this exact status vocabulary: `BLOCKED`, `INCONCLUSIVE`, `PASS`, `EXPIRED`. Each row must include gate, owner, candidate SHA, target, primary evidence, independent verifier, verified-at UTC, expiry/revalidation trigger, and status. Initialize every gate to `BLOCKED`; do not insert example approvals.

- [ ] **Step 3: Add fail-closed rules**

State that GA is allowed only when all rows are `PASS`, candidate SHAs agree, restricted originals have verifiable SHA-256 digests, and no evidence has expired.

- [ ] **Step 4: Verify no placeholder can be mistaken for evidence**

Run: `rg -n 'PASS|approved|received|paid' docs/launch/commercial-ga/evidence-ledger.md`
Expected: matches occur only in rules/schema, never as a claimed gate result.

- [ ] **Step 5: Review the diff**

Run: `git diff -- docs/launch/commercial-ga/evidence-ledger.md`
Expected: one new fail-closed ledger and no claimed external event.

### Task 2: Make Lighthouse test the exact deployed candidate

**Files:**
- Modify: `.github/workflows/lighthouse.yml`
- Modify: `web/lighthouserc.json`

- [ ] **Step 1: Add a failing workflow contract check**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('.github/workflows/lighthouse.yml').read_text()
assert 'target_url:' in p
assert 'workflow_dispatch:' in p
assert 'LHCI_BASE_URL' in p
assert 'actions/upload-artifact' in p
assert 'bun run build' not in p
PY
```

Expected: FAIL before workflow changes.

- [ ] **Step 2: Add required manual inputs**

Under `workflow_dispatch`, define `target_url` as required string and `candidate_sha` as required string. Add a validation step that rejects non-HTTPS targets and checks `git rev-parse HEAD` equals `candidate_sha`.

- [ ] **Step 3: Remove the CI-local Next build/server path**

Delete the build step. Configure Lighthouse URLs from `LHCI_BASE_URL=${{ inputs.target_url }}` so every audited route resolves on the immutable Vercel deployment.

- [ ] **Step 4: Preserve budgets and exact routes**

Ensure `web/lighthouserc.json` audits `/`, `/dashboard`, and `/asset/jitoSOL`; preserve the `cumulative-layout-shift <= 0.1` assertion for jitoSOL and existing accessibility/SEO assertions.

- [ ] **Step 5: Upload complete evidence**

Upload `.lighthouseci/` with artifact name containing `${{ inputs.candidate_sha }}` and a minimum 30-day retention. Do this under `if: ${{ !cancelled() }}`.

- [ ] **Step 6: Run the workflow contract check**

Run the Python command from Step 1.
Expected: PASS.

- [ ] **Step 7: Validate YAML and web configuration**

Run: `bunx prettier --check .github/workflows/lighthouse.yml web/lighthouserc.json`
Expected: exit zero, or format only those files and rerun.

### Task 3: Make Playwright externally targeted and blocking

**Files:**
- Modify: `.github/workflows/web-e2e.yml`
- Modify: `web/playwright.config.ts`

- [ ] **Step 1: Write a failing configuration contract check**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
w = Path('.github/workflows/web-e2e.yml').read_text()
p = Path('web/playwright.config.ts').read_text()
assert 'target_url:' in w
assert 'candidate_sha:' in w
assert 'PLAYWRIGHT_EXTERNAL_TARGET' in w
assert 'continue-on-error: true' not in w
assert 'bun run dev' not in w
assert 'PLAYWRIGHT_EXTERNAL_TARGET' in p
PY
```

Expected: FAIL before changes.

- [ ] **Step 2: Add exact-target workflow inputs and validation**

Add required `target_url` and `candidate_sha` inputs. Reject non-HTTPS targets, confirm checked-out SHA, and probe the target with bounded retries before installing browsers.

- [ ] **Step 3: Update Playwright server selection**

In `web/playwright.config.ts`, set `webServer` to `undefined` when `PLAYWRIGHT_EXTERNAL_TARGET=1`; use `PLAYWRIGHT_BASE_URL` as `use.baseURL`. Preserve the existing local behavior for developer-invoked tests.

- [ ] **Step 4: Replace development-server CI runs**

Set `PLAYWRIGHT_EXTERNAL_TARGET=1` and `PLAYWRIGHT_BASE_URL=${{ inputs.target_url }}` in both browser jobs. Remove comments and steps claiming `bun run dev` is production-shaped.

- [ ] **Step 5: Make the complete suite blocking**

Remove `continue-on-error: true`. Run the full repository E2E suite against the deployed target, excluding only tests that explicitly require unavailable private credentials. Do not exclude stale tests; update them after inspecting real failures.

- [ ] **Step 6: Add Chromium and WebKit coverage**

Install Chromium and WebKit. Run the complete Chromium suite and the existing iPhone WebKit command from `docs/operations/qa-pre-launch-workflow.md`.

- [ ] **Step 7: Retain reports and traces**

Upload `web/playwright-report/` and `web/test-results/` with candidate SHA in artifact names and at least 30-day retention.

- [ ] **Step 8: Run the contract check and static validation**

Run the Python command from Step 1, then `cd web && bun run typecheck && bun run lint`.
Expected: all exit zero.

### Task 4: Execute preview technical gates and repair demonstrated failures

**Files:**
- Modify only failing `web/tests/e2e/*.spec.ts` or corresponding `web/app/**` production code
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Obtain the immutable preview URL for the candidate SHA**

Use the Vercel deployment associated with `git rev-parse HEAD`; record deployment ID, SHA, URL, and creation time. Abort if SHA cannot be proven.

- [ ] **Step 2: Dispatch Lighthouse**

Run: `gh workflow run lighthouse.yml --ref <candidate-branch> -f target_url=<immutable-preview-url> -f candidate_sha=<40-char-sha>`
Expected: workflow dispatch accepted.

- [ ] **Step 3: Dispatch Playwright**

Run: `gh workflow run web-e2e.yml --ref <candidate-branch> -f target_url=<immutable-preview-url> -f candidate_sha=<40-char-sha>`
Expected: workflow dispatch accepted.

- [ ] **Step 4: Inspect runs and download every artifact**

Use `gh run watch <run-id> --exit-status` and `gh run download <run-id> --dir <approved-temp-directory>`. Read Lighthouse JSON, Playwright report, traces, screenshots, console errors, and failed requests.

- [ ] **Step 5: Fix one reproduced failure at a time using TDD**

For each failure, run the exact failing spec against the same preview or a newly deployed fix preview, verify failure, make the minimum code/test correction, run web unit/type/lint checks, then redeploy. Never weaken assertions merely to obtain green status.

- [ ] **Step 6: Repeat until both fresh exact-SHA runs pass**

Expected: Lighthouse and all required Playwright projects exit zero; jitoSOL CLS is at most `0.1`; no critical/serious accessibility issue or unexplained console error remains.

- [ ] **Step 7: Record evidence**

Update only the technical row in the ledger with run URLs, artifact digests, immutable target, SHA, UTC time, and independent verifier. Set it to `PASS` only after artifact inspection.

### Task 5: Verify the same candidate in production

**Files:**
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Deploy only the verified candidate SHA**

Follow the repository deployment runbook. Abort on a dirty remote checkout or SHA mismatch.

- [ ] **Step 2: Prove production identity**

Record the production deployment ID and evidence linking it to the preview-tested SHA.

- [ ] **Step 3: Rerun both workflows against production**

Dispatch Lighthouse and Playwright with `target_url=https://www.pegana.xyz` and the same 40-character SHA.
Expected: both complete successfully.

- [ ] **Step 4: Inspect production artifacts**

Apply the same artifact review as Task 4. A preview pass does not override a production failure.

- [ ] **Step 5: Update technical evidence**

Add production run URLs/digests to the same ledger row. Keep `PASS` only if preview and production evidence agree.

### Task 6: Prepare and collect qualified legal approval

**Files:**
- Create: `docs/launch/commercial-ga/legal-review-attestation.md`
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Export exact production legal content**

Fetch `/privacy` and `/terms`, save restricted originals outside git, and compute `shasum -a 256` for each normalized export. Record URL, effective date, fetch UTC, and candidate SHA.

- [ ] **Step 2: Create the redacted attestation schema**

Include reviewer name/firm, qualification, review date, production URLs, both hashes, checklist outcomes, exceptions accepted by counsel, signature method, restricted-original location, and independent hash verification. Leave status `BLOCKED` until signed.

- [ ] **Step 3: Send counsel the exact review packet**

The packet must cover every issue listed in the approved design: processing, subprocessors/transfers, retention/deletion, rights, Telegram, webhooks/accounts, x402/USDC, refunds, sanctions/suspension, disclaimers/liability/law, methodology license, and Replay CLI.

- [ ] **Step 4: Apply counsel-requested changes**

For each requested change, update the page, run `cd web && bun run typecheck && bun run lint && bun run test`, deploy a new candidate, and invalidate prior web/legal hashes.

- [ ] **Step 5: Obtain final signature on deployed hashes**

Expected: named qualified counsel signs the exact final production revisions. An unsigned response fails.

- [ ] **Step 6: Independently re-fetch and verify hashes**

Expected: deployed content hashes equal counsel-approved hashes.

- [ ] **Step 7: Record legal gate**

Store no privileged text in git. Add the permitted redacted attestation and digest, then set the legal ledger row to `PASS`.

### Task 7: Collect human Telegram paging confirmation

**Files:**
- Create: `docs/launch/commercial-ga/telegram-paging-attestation.md`
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Create the attestation schema**

Include drill ID, chat purpose, operator name, warning/critical/resolved source timestamps, Alertmanager counters, Telegram message IDs/timestamps, visible-field comparison, screenshot digest, signature, and verification UTC. Initialize as `BLOCKED`.

- [ ] **Step 2: Announce and execute a controlled drill**

Trigger warning, escalation to critical, and resolution using the established production-safe alert procedure. Record source alert fingerprints and delivery counters without exposing credentials.

- [ ] **Step 3: Obtain human visual confirmation**

A member with access to the designated operations chat verifies all three rendered messages and supplies message IDs, visible timestamps, and a redacted screenshot or restricted screenshot digest.

- [ ] **Step 4: Correlate both sides**

Compare severity, labels, links, ordering, resolution state, source timestamps, delivery counters, and Telegram IDs. Any mismatch keeps the gate `BLOCKED`.

- [ ] **Step 5: Record signed evidence**

After the human signs, independently verify the screenshot digest and set the Telegram ledger row to `PASS`.

### Task 8: Instrument and execute ADR-0007 demand validation

**Files:**
- Modify: `docs/outreach/log.md`
- Create: `docs/launch/commercial-ga/paid-pilot-attestation.md`
- Create after evidence: `docs/decisions/YYYY-MM-DD-adr-0007-commercial-ga-verdict.md`
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Replace the outreach template with auditable fields**

Require target, tier, qualification criterion, owner, channel, UTC timestamp, value hypothesis, proof-of-send digest/location, response, meeting evidence, next action/date, outcome, and independent verifier. Preserve historical entries and their `PREPARED, NOT OPENED` status.

- [ ] **Step 2: Predeclare the sprint target set**

Before sending, classify targets and write what objectively constitutes Tier-1 qualification or a Tier-2 win under ADR-0007.

- [ ] **Step 3: Execute authentic outreach**

The founder or authorized commercial operator sends each message through the stated account and records proof immediately. Prepared drafts do not count.

- [ ] **Step 4: Reconcile responses weekly**

Record meetings, qualification facts, objections, next actions, and outcomes against primary evidence. Contradictory trackers must be reconciled into `docs/outreach/log.md`.

- [ ] **Step 5: Secure one qualifying outcome**

Expected: at least one qualified Tier-1 outcome or completed Tier-2 distribution win satisfying the predeclared criterion.

- [ ] **Step 6: Execute one genuine paid pilot**

An unrelated external counterparty agrees to defined scope, objective acceptance, non-zero price, and payment terms. Obtain settled attributable payment and delivery/active-pilot evidence. Internal transfers, grants, donations, unpaid trials, and verbal intent fail.

- [ ] **Step 7: Create the redacted pilot attestation**

Record counterparty category, scope, dates, currency/amount disclosure level, settlement reference digest, contract digest, delivery evidence digest, acceptance status, restricted-original locations, founder signature, and independent verification. Do not commit confidential originals.

- [ ] **Step 8: Issue the new ADR-0007 verdict**

Recompute Tier-1/Tier-2 outcomes from the canonical log, cite the paid-pilot attestation, preserve the 2026-08-03 historical verdict, and obtain founder signature.

- [ ] **Step 9: Record demand gate**

Set the ledger row to `PASS` only when both the qualifying outcome and paid pilot are independently verified.

### Task 9: Resolve or formally waive the protocol-indexer advisory

**Files:**
- Modify if removal succeeds: `protocol-indexer-ts/package.json`, `protocol-indexer-ts/bun.lock`, affected `protocol-indexer-ts/src/**`, affected tests
- Create only if removal is infeasible: `docs/security/protocol-indexer-bigint-buffer-waiver.md`
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Capture the advisory and dependency graph**

Run in `protocol-indexer-ts`:

```bash
bun audit --production
bun pm ls --all
```

Expected: capture `GHSA-3gc7-fjrx-p6mg` / `CVE-2025-3194`, exact paths to `bigint-buffer@1.1.5`, and nonzero audit status while unresolved.

- [ ] **Step 2: Prove runtime reachability**

Search imports and bundle metadata for each Jupiter/Kamino path. Add focused tests around the source operations that exercise those dependencies and record whether vulnerable conversion code executes on network-controlled data.

- [ ] **Step 3: Attempt removal in dependency-path order**

Prefer upgrading to a release whose production graph lacks `bigint-buffer`; otherwise replace the narrow SDK use with existing safe RPC/account parsing patterns. Preserve ADR-0036's prohibition on owner/authority access and k-anonymity behavior.

- [ ] **Step 4: Verify a removal candidate**

Run:

```bash
cd protocol-indexer-ts
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
bun audit --production
```

Expected: all checks pass and no high advisory remains. If achieved, do not create a waiver.

- [ ] **Step 5: If removal is infeasible, document proof**

Record attempted versions/replacements, incompatibilities, upstream release status, static/runtime reachability, untrusted-input boundaries, and why removal would regress required behavior.

- [ ] **Step 6: Add compensating controls before waiver**

Verify container memory/CPU limits, bounded polling/input sizes, restart policy, readiness/liveness monitoring, upstream request timeout/rate limits, and alerting. Add missing controls with focused tests and rerun the full protocol-indexer checks.

- [ ] **Step 7: Create a maximum-30-day waiver**

Include exact advisory/path, impact, controls, named security owner, approval signature, upstream-removal issue, issue URL/reference, issue owner, approval UTC, expiry UTC, and automatic re-block language. A package-manager suppression is prohibited.

- [ ] **Step 8: Record security gate**

Set `PASS` based on either a clean production audit or a valid signed unexpired waiver plus verified controls. Record which path was used and its revalidation trigger.

### Task 10: Run repository-wide verification

**Files:**
- No intended modifications

- [ ] **Step 1: Verify Rust workspace**

Run:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace --all-targets
cargo test --workspace --all-targets
```

Expected: all exit zero; environment-gated integrations may self-skip as documented.

- [ ] **Step 2: Verify web**

Run: `cd web && bun run typecheck && bun run lint && bun run test`
Expected: all exit zero. Do not run local `next dev` or `next build`.

- [ ] **Step 3: Verify protocol-indexer**

Run: `cd protocol-indexer-ts && bun run typecheck && bun run lint && bun run test && bun audit --production`
Expected: checks exit zero; audit is clean or its sole accepted high matches the signed unexpired waiver exactly.

- [ ] **Step 4: Verify MCP and bot if shared files changed**

Run typecheck, lint, and tests from each affected package.
Expected: all exit zero.

- [ ] **Step 5: Inspect repository state**

Run: `git status --short && git diff --check`
Expected: only intended files changed; no whitespace errors, secrets, restricted evidence, generated reports, or temporary downloads are present.

### Task 11: Issue the final Commercial GA verdict

**Files:**
- Create: `docs/decisions/YYYY-MM-DD-commercial-ga-verdict.md`
- Update: `docs/launch/commercial-ga/evidence-ledger.md`

- [ ] **Step 1: Pin and verify the final candidate**

Record `git rev-parse HEAD`, production deployment identity, image/artifact identities, and UTC verification time. Abort on mismatch.

- [ ] **Step 2: Revalidate every ledger row**

Confirm all five are `PASS`, all required signatures exist, all digests verify, no waiver/evidence expired, and no later change invalidated legal or technical evidence.

- [ ] **Step 3: Rerun production technical smoke and security audit**

Expected: exact-SHA Lighthouse/Playwright production runs remain green and protocol audit remains clean or exactly covered by the valid waiver.

- [ ] **Step 4: Write the verdict without overclaiming**

List each gate, primary artifact, verifier, verification UTC, expiry/revalidation trigger, final SHA, and production target. State `Commercial GA: GO` only if every check passed in this execution; otherwise write `NO-GO` and retain Technical Preview positioning.

- [ ] **Step 5: Obtain founder signature**

The founder signs and dates the final verdict after reviewing restricted evidence. Agent authorship is not a signature.

- [ ] **Step 6: Final integrity check**

Run:

```bash
rg -n 'TBD|TODO|PLACEHOLDER|example signature' docs/launch/commercial-ga docs/decisions
rg -n '(BOT_TOKEN|PRIVATE_KEY|DATABASE_URL|TELEGRAM_CHAT_ID)=' docs/launch/commercial-ga docs/decisions
```

Expected: no unresolved placeholders in final evidence and no secrets.

## Completion rule

Implementation work may prepare every workflow, template, control, and verification command. The project is not Commercial GA until qualified counsel signs the deployed legal text, a human confirms the three Telegram messages, an external qualifying demand outcome exists, a genuine external paid pilot is paid, and the advisory is removed or covered by a valid signed waiver. Missing third-party action is a truthful `BLOCKED` result, not an implementation failure and never a reason to manufacture evidence.
