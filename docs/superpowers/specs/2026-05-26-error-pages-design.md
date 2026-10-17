# Error pages — `not-found`, `error`, `global-error`

> Spec for the three App Router error surfaces in `web/`. Aligned with
> the v2 oracle reframe: vocabulary uses *surface / feed / channel*, tone
> is institutional, and every error visibly separates "the UI failed"
> from "the oracle failed" — protecting the credibility of the feed.

**Status:** ready for review → writing-plans
**Branch:** current working branch (no rename)
**Scope:** 3 small files in `web/app/`, no backend changes
**Author:** Rafael (+ Claude)

---

## Why now

The site has no `not-found.tsx`, `error.tsx`, or `global-error.tsx`.
Any unmatched route or runtime error currently falls through to Next's
generic white screens — fine in dev, embarrassing on the public
oracle landing. The v2 reframe also gives us a chance to make the
error pages *demonstrate* the "Built to be consumed" positioning: even
when the UI fails, the feed is queryable via REST / WS / MCP / Webhook
/ Telegram.

---

## Decisions

### 1. Cover all three App Router error surfaces

| File | Purpose | Renders inside RootLayout? |
|---|---|---|
| `web/app/not-found.tsx` | URL didn't match any route, or `notFound()` was called | Yes |
| `web/app/error.tsx` | Runtime exception in any segment beneath root | Yes |
| `web/app/global-error.tsx` | RootLayout itself faulted | No — owns its own `<html><body>` |

`error.tsx` and `global-error.tsx` MUST be Client Components
(`'use client'`). Next 16 receives `{ error, reset }` as props on both.
`global-error.tsx` must render its own `<html>` and `<body>` because
the root layout did not mount.

**Read `node_modules/next/dist/docs/` before implementation** to verify
the Next 16 conventions for these files (per `web/AGENTS.md` — Next 16
has breaking changes vs training data).

### 2. Shared visual treatment

Centred, vertical, full-viewport. No new components needed beyond the
three page files. Reuses tokens already in `globals.css`.

- Reuses the `<Background />` already rendered by `RootLayout` for
  `not-found.tsx` and `error.tsx`.
- `global-error.tsx` is intentionally bare — no Background, no
  providers, no glossary sheet, no fonts beyond a system mono fallback
  if `next/font` can't load. It is the last line of defence and must
  render with zero dependencies on the root layout's tree.
- Threshold Brackets brand mark `[ pegana ]` in mono at the top.
- A status token in mono caps with sunset coral (`--accent` /
  `#ff8a5b`): `[ ROUTE_NOT_FOUND ]` / `[ INTERNAL_FAULT ]` /
  `[ pegana : FATAL ]`.
- Body copy in Geist regular, neutral, 1–2 sentences.
- One muted-foreground line reinforcing that the oracle feed is live.
- Two CTAs in a row: a primary action and a secondary route.
- No illustrations, no glitch effects, no mascot. Tone is institutional
  — matches the rest of the site post-reframe.

### 3. Copy per surface (English, matches the rest of the site)

**`not-found.tsx`:**

```
[ pegana ]

[ ROUTE_NOT_FOUND ]

This path isn't a published surface of the oracle.

The feed is live — read it directly via REST, WS, MCP, Webhook, or Telegram.

[ Back to home ]   [ Read the API → ]
```

CTAs: primary `Back to home` → `/`; secondary `Read the API` →
`/developers`.

**`error.tsx`:**

```
[ pegana ]

[ INTERNAL_FAULT ]

Something faulted while rendering this view.
The oracle feed itself is unaffected.

Live state remains queryable at /dashboard and api.pegana.xyz.

[ Try again ]   [ Open dashboard → ]
```

CTAs: primary `Try again` → calls `reset()` from props; secondary
`Open dashboard` → `/dashboard`.

The Next-supplied `error.digest` is NOT rendered to the user — kept
clean. It is forwarded to `console.error` in a `useEffect` so the
browser console (and any error tracker) still sees it. Revisit if a
support workflow needs it surfaced.

**`global-error.tsx`:**

```
[ pegana : FATAL ]

The web client failed to mount.
The oracle data feed is reachable directly.

[ Reload ]   [ api.pegana.xyz → ]
```

CTAs: primary `Reload` → `window.location.reload()`; secondary
`api.pegana.xyz` → external link to the public API root.

No `[ pegana ]` brand mark above the status token here — the file uses
its own minimal stylesheet and stays as small as possible. Black
background, mono-family stack, no gradients, no Background component.

### 4. CTAs and link destinations

| Surface | Primary | Secondary |
|---|---|---|
| `not-found` | `Back to home` → `/` | `Read the API →` → `/developers` |
| `error` | `Try again` → `reset()` | `Open dashboard →` → `/dashboard` |
| `global-error` | `Reload` → `window.location.reload()` | `api.pegana.xyz →` → `https://api.pegana.xyz` |

Buttons reuse the existing hero button styles (mono, sharp corners,
sunset accent for the primary, ghost/outline for the secondary). No
new button variants.

### 5. Why this copy, not a generic "Page not found"

- "surface", "feed", "channel" are the exact terms decision #1, #2, #4
  of the v2 spec introduced. Consistency across hero, `/oracle`,
  `/developers`, and the error pages.
- The 404 names the 5 channels in plain prose. Every wrong URL becomes
  a free reminder that the oracle has multiple consumption surfaces —
  which is the v2 thesis.
- Each error explicitly distinguishes **"the UI failed"** from **"the
  oracle failed"**. For a product positioned as infrastructure
  ("intrinsic-vs-market monitoring", "Built to be consumed"), this
  protects credibility even when the shop window cracks.
- Zero "cute" / themed copy. Matches institutional tone.

---

## Files

**New:**

- `web/app/not-found.tsx` — Server Component. Imports the brand mark
  pattern and renders the static layout.
- `web/app/error.tsx` — `'use client'`. Receives
  `{ error, reset }: { error: Error & { digest?: string }; reset: () => void }`.
  Logs `error` to `console.error` in a `useEffect`.
- `web/app/global-error.tsx` — `'use client'`. Renders own
  `<html lang="en"><body>`. Receives the same props as `error.tsx`.
  Inline styles only, no className tokens that depend on `globals.css`.

**Modified:** none.

**No new components, no new routes, no migrations, no backend touch.**

---

## Non-goals

- ❌ Per-route `not-found.tsx` (e.g., `app/(marketing)/not-found.tsx`).
  The root file is enough for v1.
- ❌ Per-segment `error.tsx` boundaries (e.g., one for `(app)`, one
  for `(marketing)`). The root file is enough for v1.
- ❌ Surfacing `error.digest` in the UI. Logged to console only.
- ❌ Wiring an external error tracker (Sentry browser SDK) here. That
  is a separate ticket; this spec only ensures the page renders cleanly.
- ❌ A custom 500 page in Pages Router style. App Router does not use
  `pages/500.tsx`; `error.tsx` + `global-error.tsx` cover it.
- ❌ Localised (PT-BR) copy. Site is English-only today.
- ❌ Illustrations, mascots, animated 404 numbers.

---

## Acceptance criteria

The work is done when **all** of the following hold:

- Hitting any unknown URL on `localhost:3000` (e.g.
  `/this-does-not-exist`) renders the `not-found.tsx` copy above,
  inside the marketing layout (header + footer + Background).
- Throwing inside any page component (temporary test, then revert)
  triggers `error.tsx` with the `[ INTERNAL_FAULT ]` copy and a
  working `Try again` button that calls `reset()`.
- Throwing inside `web/app/layout.tsx` (temporary test, then revert)
  triggers `global-error.tsx` with the `[ pegana : FATAL ]` copy on a
  bare page (no Background, no header, no glossary).
- `error.digest` is visible in the browser console for the `error.tsx`
  case (not in the page body).
- All three pages render correctly in dark mode (the only mode the
  site ships).
- No TypeScript errors, no ESLint errors, no console warnings on any
  of the three pages.
- The `Reload` button on `global-error.tsx` performs a hard refresh.
- The `api.pegana.xyz` link on `global-error.tsx` opens in the same
  tab and resolves.

---

## Open questions

1. **Brand mark on `global-error.tsx`** — left out for minimalism. If
   the page looks too plain in practice, add `[ pegana : FATAL ]` as
   the only visual element (already the plan) and skip the separate
   brand mark.
2. **`Try again` semantics** — `reset()` re-renders the failed
   segment. If the underlying cause is transient (network blip,
   upstream API hiccup), this works. If it's deterministic (a bug),
   the user re-triggers the same error. Acceptable for v1; revisit if
   support sees loops.
3. **Sentry browser SDK** — not in this spec. Consider opening a
   follow-up once the launch traffic justifies a tracker.

These are not blockers for implementation; flagged here so they're not
discovered mid-build.

---

## Tech-debt surfaced during this work (post-launch follow-up)

While implementing the three pages, the verification step revealed that
**`bun run lint` has never functioned in this project**. The failure
mode is unrelated to the error pages and predates this spec.

**Root cause (two independent factors):**

1. `web/package.json:9` declares `"lint": "next lint"`. Next 16 removed
   the `next lint` subcommand entirely (per
   `web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`,
   line 122: *"Starting with Next.js 16, `next lint` is removed."*). When
   the CLI receives `lint`, it treats the word as a positional
   `[directory]` argument and fails with the misleading message
   `Invalid project directory provided, no such directory: .../web/lint`.
2. ESLint was never installed in this project. `web/package.json` has no
   `eslint`, `eslint-config-next`, or `@next/eslint-plugin-next`. There
   is no `.eslintrc.*` or `eslint.config.*`. The `next lint` script was
   `create-next-app` boilerplate that would have prompted to install
   ESLint on first run — nobody ever ran it.

**Impact on this spec:** The Acceptance Criteria line *"No TypeScript
errors, no ESLint errors, no console warnings"* is partially
unverifiable. TypeScript and console warnings were both checked. The
ESLint check was a no-op (the linter was never installed). Three error
page files were not linted in any release before or after this spec —
neither were any other files in the repo.

**Why not address it in this spec:** Setting up ESLint properly requires
triaging the first run's output (likely 50–200 warnings across the
existing codebase), deciding per-rule which become `error` vs `warn` vs
disabled, and plugging it into CI / pre-commit. That is focused work
worth 1–2 hours of attention. Pre-launch (v2 oracle reframe, v1.1
Console, Hetzner deploy) is the wrong moment — adding `lint warn-only
that nobody reads` would normalize ignoring lint warnings, which is
worse than no lint.

**Recommended path (post-v2-launch):**

1. Remove the misleading script entry (`"lint": "next lint"`) so
   `bun run lint` stops emitting the confusing error. One-line PR.
2. Open a dedicated spec for ESLint setup. The Next-recommended
   migration is the codemod
   `npx @next/codemod@canary migrate-from-next-lint-to-eslint-cli`,
   which installs `eslint` + `eslint-config-next` and creates
   `eslint.config.mjs` with the flat-config format.
3. First run: capture full output, triage rule-by-rule, land a
   commit with the chosen ruleset (probably `core-web-vitals` +
   `typescript`) and the necessary code fixes.
4. Wire into CI (`bun run lint` as a required check) and optionally
   pre-commit via `lint-staged`.

**Deferred — not a v2 launch blocker.**
