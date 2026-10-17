# Commercial GA gate-closure design

## Objective

Promote Pegana from Technical Preview to Commercial GA only after every remaining gate has binary, independently reviewable evidence tied to the exact release SHA and deployed target. No inferred, synthetic, or agent-authored evidence substitutes for a required human or commercial act.

## Governing rule

Commercial GA is fail-closed. The release verdict remains `NO-GO` while any gate is open, expired, contradictory, or lacks provenance. A waiver is permitted only for the transitive protocol-indexer advisory because the stated acceptance criteria explicitly allow resolution or waiver; waivers do not replace legal review, Telegram receipt confirmation, qualified demand, or a paid pilot.

## Evidence contract

Each gate record must contain:

- gate name and binary status;
- exact git SHA and deployment URL where applicable;
- UTC execution or signature timestamp;
- named human owner;
- command, workflow run, signed document, message identifier, or counterparty artifact;
- redacted public-safe evidence plus the location of any restricted original;
- independent verification result;
- expiration or revalidation trigger.

Secrets, private customer terms, personal contact data, wallet keys, and Telegram credentials must not enter git. Repository evidence may reference a restricted artifact by immutable digest.

## Gate 1 — Lighthouse, CLS, and Playwright

### Execution

1. Create or identify a Vercel preview for the exact candidate SHA.
2. Run the existing manually dispatchable Lighthouse workflow against that preview.
3. Run the complete Playwright workflow against that preview, including Chromium and configured WebKit/mobile projects.
4. Inspect all reports, traces, screenshots, console output, and failed-request artifacts rather than relying only on workflow status.
5. Deploy the same SHA to production without source drift.
6. Repeat the production critical-path Playwright smoke and Lighthouse measurement.

### Acceptance

- Both workflow suites exit zero against the exact preview SHA.
- Production critical paths exit zero against the same SHA.
- `/asset/jitoSOL` CLS is `<= 0.1` in the recorded Lighthouse run.
- Existing Lighthouse accessibility and SEO budgets pass.
- Automated accessibility has no critical or serious violation.
- There are no unexplained browser console errors or failed application requests.
- Reports and workflow URLs are retained with SHA, target URL, and timestamp.

Any flake must be reproduced and fixed or classified with concrete evidence. Rerunning until green without root-cause review does not satisfy the gate.

## Gate 2 — Privacy and Terms legal review

### Execution

1. Export the exact production Privacy and Terms text, including effective dates and immutable content hashes.
2. Provide the texts and an issue checklist to qualified legal counsel.
3. Counsel reviews data processing, subprocessors and international transfers, retention/deletion, user rights, Telegram authentication, webhook/account data, x402 USDC payments, refund policy, sanctions, suspension, disclaimers, liability, governing law, methodology licensing, and Replay CLI treatment.
4. Apply requested textual changes through normal review and deployment.
5. Counsel signs the final deployed revision, not an earlier draft.

### Acceptance

- A named qualified reviewer signs and dates approval of the exact final text.
- The approval identifies the production URL, effective date, and hashes of both documents.
- Every checklist issue is resolved or explicitly accepted by counsel.
- The deployed pages match the signed hashes.
- The restricted signed original is retained outside git; the repository stores a redacted attestation and digest only when permitted.

An agent, founder-only code review, or unsigned email does not satisfy this gate.

## Gate 3 — Telegram paging receipt

### Execution

1. Coordinate a controlled warning, critical, and resolved drill in the designated operations chat.
2. Record Alertmanager event timestamps and delivery counters.
3. A human chat member verifies each rendered message in Telegram and records its message ID and visible timestamp.
4. Compare alert labels, severity, links, ordering, and resolved state with the originating alerts.
5. Redact bot tokens, chat identifiers where sensitive, and unrelated chat content.

### Acceptance

- Warning, critical, and resolved are all visibly received in the correct operations chat.
- A named human signs the confirmation.
- Telegram message IDs/timestamps correlate with Alertmanager evidence.
- No delivery failure is present and `send_resolved` behavior is demonstrated.
- A redacted screenshot or restricted screenshot digest supports the attestation.

Alertmanager counters alone do not satisfy the human-receipt requirement.

## Gate 4 — ADR-0007 demand and paid pilot

### Execution

1. Preserve the prior mechanical verdict `launch failed, regroup` and begin a new, instrumented demand sprint under ADR-0007.
2. Define target account, tier, qualification criteria, owner, channel, value hypothesis, and next action before outreach.
3. For every attempt, record UTC timestamp, proof of send, response state, meeting notes, and outcome in the canonical outreach log.
4. Obtain at least one qualified Tier-1 outcome or one completed Tier-2 distribution win.
5. Execute at least one genuine paid pilot with an external counterparty.
6. Record the pilot scope, price, payment evidence, start/end criteria, delivery evidence, acceptance status, and permission level for public reference.

### Acceptance

- At least one Tier-1 qualified outcome or Tier-2 win meets the predeclared ADR criteria.
- At least one external counterparty pays non-zero consideration for a defined Pegana pilot.
- Payment is settled and attributable; an internal transfer, founder-controlled entity, grant, donation, verbal intent, or unpaid trial does not count.
- The counterparty accepts delivery or the contract defines an active paid pilot with objective acceptance criteria.
- Sensitive commercial records remain restricted; repository evidence uses redaction and immutable digests.
- A new dated ADR-0007 verdict reconciles the canonical log and is signed by the founder.

This gate cannot be completed by code changes or fabricated outreach. Until a counterparty acts, Commercial GA remains blocked.

## Gate 5 — protocol-indexer transitive high advisory

### Preferred path: remove reachability

1. Generate the current production dependency graph for `bigint-buffer@1.1.5`.
2. Identify every import and runtime call path through Jupiter/Kamino/Solana dependencies.
3. Remove, replace, patch, or isolate dependencies so the vulnerable package is absent from the production lockfile and artifact.
4. Run protocol-indexer typecheck, lint, all tests including ADR-0036 guard, production audit, and source/readiness regressions.

Acceptance is a clean production audit with no high advisory and no loss of required source behavior.

### Fallback path: formal time-bounded waiver

A waiver is acceptable only if removal is not presently feasible and must include:

- advisory/CVE and exact package/version/path;
- evidence that no patched upstream release exists;
- static and runtime reachability analysis;
- impact assessment for untrusted input and DoS exposure;
- process/container limits, restart policy, health monitoring, rate limits, and isolation controls;
- named security owner;
- issue tracking upstream replacement/removal;
- approval by the accountable security authority;
- maximum 30-day expiry and automatic GA re-block on expiry;
- explicit statement that the waiver covers only this advisory.

A bare `ignore`, audit suppression, or undocumented risk acceptance fails the gate.

## Orchestration and verdict

The technical and external tracks may proceed concurrently, but their evidence remains independent. The canonical GA checklist is updated only after verification of each artifact. Immediately before verdict:

1. pin the candidate SHA;
2. confirm production runs that SHA;
3. verify no post-evidence drift affects a gate;
4. rerun security audit and production technical smoke;
5. verify legal approval, Telegram attestation, demand outcome, and paid-pilot evidence remain valid;
6. issue a signed, dated Commercial GA verdict listing every artifact.

If any check fails, the verdict is `NO-GO`, Technical Preview remains the public label, and the failed gate receives an owner and next action.

## Error handling and integrity

- Network or CI interruption produces `INCONCLUSIVE`, never `PASS`.
- Missing restricted evidence produces `BLOCKED`, even if a summary claims success.
- Conflicting artifacts are reconciled against primary evidence before status changes.
- Any code or legal-text change after approval invalidates affected evidence and triggers rerun/re-signing.
- Evidence containing secrets is removed from shared artifacts, credentials are rotated if exposed, and the gate is rerun.

## Scope boundaries

This effort closes only the five named Commercial GA gates and produces the final verdict. It does not add unrelated product features, weaken ADR-0007, reinterpret Technical Preview as GA, or manufacture third-party approvals.
