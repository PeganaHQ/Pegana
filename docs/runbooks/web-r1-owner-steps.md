# Runbook: owner steps for the r1 web fixes (fix/r1-app)

These steps need dashboard access or a production operation, so the
`fix/r1-app` branch could not do them. Each one says when it has to happen
relative to the web deploy and how to check it.

## 1. Sentry browser ingestion (findings app #58, #90)

**Symptom (verified 2026-10-21 UTC):** every browser event is rejected with
HTTP 403 `event submission rejected with_reason: ProjectId`. This happens
through the `/monitoring` tunnel (`tunnelRoute` in `web/next.config.ts`) and
also when posting straight to `ingest.us.sentry.io`. A bad public key returns
401, so the key is accepted. The problem is that Sentry refuses the project
the DSN points to: it was deleted, disabled, or belongs to another org.

DSN target in use: org `4511473316265984`, project `4511473334943744`.

The branch only removes the eager Session Replay integration and documents
the problem in `web/instrumentation-client.ts`. It does not change the DSN.

Steps (owner, Sentry and Vercel dashboards):

1. In Sentry, open the org whose ID is `4511473316265984` and go to
   Settings > Projects. Confirm that a project with ID `4511473334943744`
   exists and is not disabled. Also check Settings > Projects > (project) >
   Client Keys (DSN): the key must be enabled and must have no rate limit set
   to 0.
2. If that project is missing or cannot be re-enabled, create a new
   project (platform: Next.js) in the same org. Copy its DSN from
   Client Keys.
3. In Vercel (project `prj_QywwTu3o84BWbdd1iyWsKRO82dG0`, team
   `team_AKb5ZkPLNlPWO2W95Dn1fFzV`), Settings > Environment Variables,
   Production scope:
   - `NEXT_PUBLIC_SENTRY_DSN` = the DSN of the existing or new project.
     This value is inlined at build time, so a redeploy is required.
   - `SENTRY_ORG` = the org slug (not the numeric ID). `withSentryConfig`
     uses it to upload source maps.
   - `SENTRY_PROJECT` = the project slug of the same project.
   - `SENTRY_AUTH_TOKEN`: confirm it exists and has `project:releases`
     (or `project:write`) scope on that org. If the project changed,
     rotate it if needed.
4. Redeploy through the sanctioned path, `scripts/deploy.sh`. Never push
   to `main` by hand.
5. Verify:
   - Open `https://www.pegana.xyz/` with DevTools > Network filtered on
     `monitoring`. In the console, run
     `setTimeout(() => { throw new Error("sentry ingest check") })`.
     The SDK's global error handler sends the event, and the `POST
     /monitoring` request must return **200**. Today it returns 403
     (`ProjectId`).
   - The event appears in the Sentry project's Issues view within a minute.
   - The Vercel build log shows the source-map upload with no
     authentication error.
6. Optional, only after step 5 passes: re-add Session Replay lazily
   (`Sentry.lazyLoadIntegration("replayIntegration")`) as described in the
   comment in `web/instrumentation-client.ts`.

If the owner decides to drop Sentry instead, remove `NEXT_PUBLIC_SENTRY_DSN`
from Vercel production and redeploy. An empty DSN makes `Sentry.init` a
no-op, and the `/monitoring` tunnel then gets no traffic.

## 2. security.txt reporting channels (security_web item, docs #17 and #28)

`web/public/.well-known/security.txt` lists only channels that work today:

- `Contact: mailto:rafael@pegana.xyz`
- `Policy: https://github.com/PeganaHQ/Pegana/blob/main/SECURITY.md`

The GitHub advisory URL
(`https://github.com/PeganaHQ/Pegana/security/advisories/new`) was removed
on purpose, because
`gh api repos/PeganaHQ/Pegana/private-vulnerability-reporting` returns
`{"enabled":false}` (checked 2026-10-20).

Deploy dependency: the `Policy:` target, the live `SECURITY.md`, still sends
reporters to `github.com/lrafasouza/pegana/security/advisories/new`, which
returns 404. Land the docs workstream fix for `SECURITY.md` (docs #17 and
#28) before this web deploy or together with it. Until then, the policy page
contains a dead link, but the mailto contact still works.

Optional owner step to restore the GitHub channel:

1. On GitHub, open PeganaHQ/Pegana > Settings > Code security >
   Private vulnerability reporting > Enable.
2. Verify: `gh api repos/PeganaHQ/Pegana/private-vulnerability-reporting`
   returns `{"enabled":true}`.
3. Only then, add this line back to `web/public/.well-known/security.txt`
   below the mailto line, and deploy through `scripts/deploy.sh`:
   `Contact: https://github.com/PeganaHQ/Pegana/security/advisories/new`

## 3. Re-checks after deploy (findings #8, #89)

These could not be reproduced without a build:

- #89, React #418 on `/audit` and `/backtest`: load both pages on the
  preview or in production with the console open. There must be no
  `Minified React error #418`.
- #8, dashboard row layout: at 360px and 768px widths, the row symbol must
  stay visible. Badges such as PROVISIONAL are clipped rather than
  overflowing, which is the accepted trade-off.
