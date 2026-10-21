# Runbook: public mirror sync and external uptime probe

The public repository `github.com/PeganaHQ/Pegana` is a filtered copy of the
private repo. `scripts/mirror-public.sh` builds it; this page is the operator
guide. (The verifier-only mirror `PeganaHQ/ReplayCLI` is a separate flow:
`scripts/mirror-replaycli.sh`.)

## What gets published

One commit: `git archive` of a private commit, minus every pattern in
[`scripts/mirror-public.exclude`](../../scripts/mirror-public.exclude) (the
single source of truth), with the workspace `Cargo.toml` pinned to
`repository = "https://github.com/PeganaHQ/Pegana"`. Files that are tracked
but gitignored are force-added. The commit is authored by
`PeganaHQ <69092895+lrafasouza@users.noreply.github.com>` on a
`sync/<UTC date>-<n>` branch, then a PR is opened. Merging is a human step.

Withheld: `PR_BODY.md`, root `CLAUDE.md`, `docs/superpowers/`,
`docs/design-research/`, `docs/operations/`, `docs/archive/`,
`docs/security/audit-*.md`, dated runbooks `docs/ops/2026-*.md`,
`docs/ops/lst-cleanup/`, and the landing working documents. To change the
list, edit the exclude file only.

Before adding a pattern, make sure no kept doc links into it. The test
`scripts/tests/mirror-public.test.sh` scans every kept `.md`/`.mdx` link and
fails if one resolves into a withheld path. Plain-text path mentions in code
comments and ADRs are not links and are left alone.

## Running it

From a clean private checkout of the commit to publish:

```bash
./scripts/mirror-public.sh              # dry run (default): clone, stage, gate, diff stat
./scripts/mirror-public.sh --apply      # commit, push sync/<date>-<n>, open the PR
./scripts/mirror-public.sh --sha <rev>  # mirror a specific committed revision
./scripts/mirror-public.sh --keep       # keep the staging clone for inspection
```

Requirements: `gh` authenticated with push and pull-request rights on
`PeganaHQ/Pegana`, and git credentials for HTTPS pushes. The script refuses a
dirty tree, an unreachable remote, and any branch outside `sync/*`. It never
force-pushes and never touches `main`.

Gates, both fail-closed, run on the staged tree before anything is committed:

1. `scripts/tests/public-docs-redaction.test.sh`: no prod host, `user@ip` pair
   or deploy key path in mirrored docs.
2. Leak grep: macOS home-directory paths, the production IP, the operator's nickname and
   email handle, a Telegram bot token pattern, and real-looking Telegram chat
   ids (placeholder ids and files under `tests/`, `fixtures/`, `*.test.*` and
   `*.spec.*` are exempt for the chat id check only).

If a gate fails, fix the private source (or the exclude list) and re-run. Do
not edit the staging clone by hand.

After the PR opens, wait for the public CI checks and merge with a merge
commit. Direct pushes to public `main` are blocked by its ruleset.

## External uptime probe

`.github/workflows/uptime-probe.yml` runs only in the public repo. It probes
`api /healthz`, `api /readyz`, `mcp /health` and `www /` from GitHub runners
(cron `3-59/10 * * * *`, three attempts per endpoint) and opens, updates or
closes a GitHub issue labelled `uptime`. It works with no secret.

Scheduling facts, verified 2026-10-21:

- The cron is valid and GitHub lists the workflow as `active`; scheduled
  workflows run only from the default branch, which `main` is.
- The workflow was merged 2026-10-21 20:23Z and by 21:37Z had run once, by
  `workflow_dispatch`, with no `schedule` run. GitHub can take hours to start
  a new schedule, and delays or drops runs at the busiest minutes, which is
  why the cron is offset from `:00` and `:10`.
- GitHub disables schedules in a public repo with no activity for 60 days. The
  regular mirror sync PRs count as activity, so keep syncing at least monthly.
- Check it with
  `gh run list -R PeganaHQ/Pegana --workflow uptime-probe.yml --limit 10`.
  Look for runs whose event is `schedule`. If none appear a day after the fix
  lands, dispatch it manually and contact GitHub Support.

### Optional Telegram notification

The issue route relies on GitHub emailing the operator. For a faster channel,
the probe has an optional Telegram step that sends the failing endpoint report
when a new outage issue opens and at most hourly while it continues. It is
skipped when either secret is unset, uses the token only through the step
environment, discards curl output so it cannot be echoed, and sends with
`curl --data-urlencode`.

Owner steps:

1. Create a dedicated bot with BotFather (not the Alertmanager bot) and a chat
   or channel for it; add the bot to the chat and send one message.
2. Get the chat id (`getUpdates` on the bot, read `message.chat.id`).
3. Set the repo secrets:

```bash
read -rs -p 'bot token: ' T; echo
gh secret set UPTIME_TELEGRAM_BOT_TOKEN -R PeganaHQ/Pegana --body "$T"; unset T
gh secret set UPTIME_TELEGRAM_CHAT_ID  -R PeganaHQ/Pegana --body '<chat id>'
```

4. The step only runs during an outage, so the first real test is the first
   outage. The step logs `Telegram notification sent.` or a warning on failure.

Limits: still best-effort cron, detects unreachable or not-ready, not wrong
data; Telegram itself is not independent of the operator's phone.
