# Runbook — Vercel root 404 (`www.pegana.xyz/`)

> **Symptom (verified 2026-05-25):** `https://www.pegana.xyz/` returns
> HTTP **200** but the body is `<title>404: This page could not be
> found.</title>` (Next's built-in not-found). Every other route
> (`/dashboard`, `/asset/[symbol]`, `/about`, `/methodology`, `/learn`,
> `/feed/events.xml`, `/embed/badge/[symbol]`, `/favicon.ico`) serves **200**
> with the right content.

## What's NOT wrong

Verified before opening this runbook:

- `web/app/(marketing)/page.tsx` exists in `origin/main` (committed in
  `35cf928` and updated through `654fb79`).
- `main` is at parity with `origin/main` (`git rev-list --count
  origin/main..main` → 0).
- `web/app/(marketing)/layout.tsx` exists; `web/app/layout.tsx` exists.
  Per Next 16 route-groups docs, root-in-group + top-level layout is the
  documented pattern.
- No competing `app/(app)/page.tsx` or `app/page.tsx` that would shadow
  the marketing root.
- `vercel.json` is the minimal `{"framework":"nextjs"}`.
- `next.config.ts` is empty (just exports `{}`).
- Project ID `prj_QywwTu3o84BWbdd1iyWsKRO82dG0`, team
  `team_AKb5ZkPLNlPWO2W95Dn1fFzV`.

## Most likely root cause

Vercel **deployed an older build successfully** and a more recent build
**failed silently**. Vercel keeps serving the last-good deployment, so
inner routes that existed in the older build keep working, while the
newer `(marketing)/page.tsx` content never reached production.

The "fail then keep old" failure mode is silent unless you look at the
build log of the latest deploy.

## Fix sequence (run in order; stop when `/` serves the right page)

### Step 1 — force a fresh production deploy

```bash
cd web
vercel --prod
```

Wait for the build to finish. If the CLI reports an error, **read it**
— that error is your real root cause and you can skip to Step 4.

Then re-check:

```bash
curl -s --max-time 5 https://www.pegana.xyz/ | grep -oE "<title>[^<]+</title>" | head -3
```

Expected: a single `<title>Pegana — peg-risk oracle for Solana</title>`
(no "404: This page could not be found" tag). If yes — **done.**
Note: title string was updated during the v2 oracle reframe (2026-05-26);
if you see the legacy "Solana peg watchdog" tag, the page is being served
by an old Vercel build — bisect deploys.

### Step 2 — inspect the Vercel project's recent deploys

If Step 1 still serves the 404 body:

```bash
vercel inspect www.pegana.xyz
vercel ls
```

Look at the last 3 deployments. Find the most recent one that's
**"Ready" (green)**. Compare its commit hash to `origin/main`. If the
green deploy is on an older commit, the recent push(es) failed.

Open the failing deploy:

```bash
vercel logs <deployment-url>
```

Search the build output for `(marketing)/page` or `HomePage`. The
specific error will be in there.

### Step 3 — common failure shapes (from log search)

| Error pattern | Fix |
|---|---|
| `useSearchParams() should be wrapped in a suspense boundary` | Wrap the offending call in `<Suspense>` at the page level |
| `window is not defined` in a non-client module | Mark module `"use client"` or move the `window` access into `useEffect` |
| `Cannot find module` | A package was added to `package.json` but the lockfile or `node_modules` wasn't updated — re-run `pnpm install` and recommit lockfile |
| `Type error: ...` in a TSX file | Run `pnpm typecheck` locally, fix, push |
| `Failed to fetch ...` during build | Page is statically generating something that needs the API at build time — add `export const dynamic = 'force-dynamic'` to the page |

### Step 4 — last-resort: simplify the page to bisect

If the build log error is non-obvious, temporarily replace the page
with a minimal version and redeploy:

```tsx
// web/app/(marketing)/page.tsx
export default function HomePage() {
  return <div>hello</div>;
}
```

```bash
vercel --prod
curl -s https://www.pegana.xyz/ | head
```

If `hello` appears — the original page has a runtime/build issue.
Re-introduce the original imports one block at a time, redeploy after
each, and watch which block breaks `/`. **Revert this minimal page
once you've identified the culprit.**

### Step 5 — escalate to Vercel support

If the build log shows nothing meaningful and the deployment looks
green but `/` still serves 404, open a support ticket with project ID
`prj_QywwTu3o84BWbdd1iyWsKRO82dG0` and a paste of the curl output
above. This is rare; usually one of Steps 1–4 resolves it.

## Why we don't touch `(marketing)/page.tsx` defensively

We considered adding `export const dynamic = 'force-dynamic'` to the
page preemptively. Skipped because:

1. We can't test the change without `vercel --prod` access (the same
   action that probably fixes the actual bug).
2. Other route-group pages with the same shape (`/about`, `/learn/[slug]`)
   work fine without that config, so it's not the structural issue.
3. Adding an untested config could mask the real failure or introduce a
   new regression (e.g. losing the SEO benefits of the initial render
   for the landing page).

The right fix is to make Vercel rebuild and surface the real error in
the log.
