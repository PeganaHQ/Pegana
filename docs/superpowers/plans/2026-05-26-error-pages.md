# Error pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `not-found.tsx`, `error.tsx`, and `global-error.tsx` at the root of `web/app/` matching the v2 oracle reframe voice and visual system.

**Architecture:** Three small files in `web/app/`. No new components, no new routes, no backend touch. Server Component for `not-found`; Client Components for `error` and `global-error`. `global-error.tsx` is fully self-contained (owns its own `<html><body>`, no dependency on the root layout).

**Tech Stack:** Next 16.2 App Router, React 19, Tailwind v4, Geist + JetBrains Mono via `next/font`. Reuses existing tokens in `web/app/globals.css` and existing button / brand-mark patterns. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-26-error-pages-design.md`

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `web/app/not-found.tsx` | Server Component | 404 surface, renders inside `RootLayout` |
| `web/app/error.tsx` | Client Component (`'use client'`) | Runtime error surface, renders inside `RootLayout`, receives `{ error, reset }` |
| `web/app/global-error.tsx` | Client Component (`'use client'`) | Root-layout failure surface, owns its own `<html><body>`, zero external dependencies |

No shared component file. The three pages are intentionally duplicated copy/markup — they have different layout constraints (especially `global-error.tsx`) and a shared abstraction would couple them in ways that hurt later edits.

---

### Task 1: Discover existing patterns

**Files (read-only):**
- Read: `web/app/layout.tsx`
- Read: `web/app/(marketing)/layout.tsx`
- Read: `web/app/(marketing)/page.tsx`
- Read: `web/app/(marketing)/oracle/page.tsx`
- Read: `web/app/globals.css`
- Read: `web/components/organisms/marketing-header.tsx` (find brand mark)
- Read: `web/components/molecules/background.tsx` (confirm it's already in RootLayout)
- Read (if exists): `web/node_modules/next/dist/docs/` for `not-found`, `error`, `global-error` conventions in Next 16

- [ ] **Step 1: Locate the `[ pegana ]` brand mark pattern**

Grep for the brand mark in components:
```bash
grep -rn "\[ pegana \]" web/components web/app | head -20
```

Note the exact JSX/className used so we can reuse it identically.

- [ ] **Step 2: Locate the hero CTA button pattern**

Read `web/app/(marketing)/page.tsx` and find the hero CTA buttons. Record:
- Primary button: exact `className` string
- Secondary (ghost/outline) button: exact `className` string
- Whether buttons are `<Link>` from `next/link` or `<a>` or `<button>`

- [ ] **Step 3: Locate color tokens**

Read `web/app/globals.css`. Record the CSS custom property names for:
- Sunset accent (coral `#ff8a5b`)
- Foreground / muted-foreground
- Background
- Mono font variable (`--font-mono`)

- [ ] **Step 4: Confirm Next 16 conventions**

Check the Next docs bundled in node_modules:
```bash
ls web/node_modules/next/dist/docs/ 2>/dev/null || ls web/node_modules/next/dist/ | head
find web/node_modules/next -name "*.md" -path "*error*" 2>/dev/null | head
```

Verify the prop signatures for `error.tsx` and `global-error.tsx` in Next 16 (props are `{ error: Error & { digest?: string }; reset: () => void }`). Verify `global-error.tsx` must render `<html><body>`. Note any breaking changes vs older Next versions.

- [ ] **Step 5: Record findings inline in this plan**

Write a short summary of findings under each task (brand mark JSX, button classNames, color tokens, Next 16 confirmation) before moving to Task 2 — the next subagent will not have this context. **Do not commit yet.**

---

### Task 2: Implement `web/app/not-found.tsx`

**Files:**
- Create: `web/app/not-found.tsx`

- [ ] **Step 1: Write the file**

Use the brand mark JSX, button classNames, and color tokens recorded in Task 1. Structure:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative z-[2] flex min-h-[calc(100vh-var(--header-h,4rem))] flex-col items-center justify-center px-6 text-center">
      <div className="mb-10 font-mono text-sm tracking-tight text-foreground/60">
        {/* exact [ pegana ] brand mark JSX from Task 1 */}
        [ pegana ]
      </div>

      <div className="mb-8 font-mono text-xl uppercase tracking-wider text-[var(--accent)]">
        [ ROUTE_NOT_FOUND ]
      </div>

      <h1 className="mb-4 max-w-xl text-balance text-2xl font-medium text-foreground">
        This path isn&apos;t a published surface of the oracle.
      </h1>

      <p className="mb-10 max-w-xl text-balance text-sm text-foreground/60">
        The feed is live — read it directly via REST, WS, MCP, Webhook, or Telegram.
      </p>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link href="/" className="{PRIMARY_BUTTON_CLASS_FROM_TASK_1}">
          Back to home
        </Link>
        <Link href="/developers" className="{SECONDARY_BUTTON_CLASS_FROM_TASK_1}">
          Read the API →
        </Link>
      </div>
    </main>
  );
}
```

Replace `{PRIMARY_BUTTON_CLASS_FROM_TASK_1}` and `{SECONDARY_BUTTON_CLASS_FROM_TASK_1}` with the actual classNames. Replace the brand-mark `div` with the exact JSX pattern Task 1 found. If brand-mark needs a component import instead of inline JSX, use the import.

If the project uses a `ThresholdBrackets` or similar component, prefer importing it over inline JSX.

If buttons use `<Button>` from `web/components/ui/`, import and use that instead of styled `<Link>`.

- [ ] **Step 2: Visual sanity check**

Start the dev server if not already running:
```bash
cd web && bun run dev
```
(Use `bun run dev` because `bot-ts` and other TS packages run on Bun per `project_dev_workflow.md`. If `npm run dev` is the convention in `web/`, use that instead — check `web/package.json` scripts.)

Open `http://localhost:3000/this-route-does-not-exist`. Verify:
- The `[ pegana ]` brand mark renders at top
- The `[ ROUTE_NOT_FOUND ]` token is in sunset accent (coral)
- The two CTAs render and clicking `Back to home` goes to `/`, `Read the API` goes to `/developers`
- The page renders **inside** the marketing layout (header + footer visible) — if it does not, that's expected for now because `not-found.tsx` is at root, not inside `(marketing)`. Move to next step.

- [ ] **Step 3: Commit**

```bash
git add web/app/not-found.tsx
git commit -m "feat(web): add not-found page with oracle voice"
```

---

### Task 3: Implement `web/app/error.tsx`

**Files:**
- Create: `web/app/error.tsx`

- [ ] **Step 1: Write the file**

```tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pegana] runtime error", error);
  }, [error]);

  return (
    <main className="relative z-[2] flex min-h-[calc(100vh-var(--header-h,4rem))] flex-col items-center justify-center px-6 text-center">
      <div className="mb-10 font-mono text-sm tracking-tight text-foreground/60">
        [ pegana ]
      </div>

      <div className="mb-8 font-mono text-xl uppercase tracking-wider text-[var(--accent)]">
        [ INTERNAL_FAULT ]
      </div>

      <h1 className="mb-4 max-w-xl text-balance text-2xl font-medium text-foreground">
        Something faulted while rendering this view.
        <br />
        <span className="text-foreground/60">The oracle feed itself is unaffected.</span>
      </h1>

      <p className="mb-10 max-w-xl text-balance text-sm text-foreground/60">
        Live state remains queryable at <Link href="/dashboard" className="underline">/dashboard</Link> and{" "}
        <a href="https://api.pegana.xyz" className="underline" target="_blank" rel="noreferrer">
          api.pegana.xyz
        </a>
        .
      </p>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button onClick={() => reset()} className="{PRIMARY_BUTTON_CLASS_FROM_TASK_1}">
          Try again
        </button>
        <Link href="/dashboard" className="{SECONDARY_BUTTON_CLASS_FROM_TASK_1}">
          Open dashboard →
        </Link>
      </div>
    </main>
  );
}
```

Replace button classNames as in Task 2. Replace inline brand-mark JSX with the component if one exists.

- [ ] **Step 2: Trigger the error path manually**

Add a temporary throw to any marketing page to trigger `error.tsx`. For example, edit `web/app/(marketing)/about/page.tsx`, add `throw new Error("test")` at the top of the component. **This is temporary — revert immediately after testing.**

- [ ] **Step 3: Visual sanity check**

Open `http://localhost:3000/about`. Verify:
- `[ INTERNAL_FAULT ]` renders
- The `Try again` button is present
- Open browser console: confirm `[pegana] runtime error Error: test` is logged
- Click `Try again` — the page tries to re-render and faults again (expected, the throw is still there)
- `Open dashboard` link goes to `/dashboard`

- [ ] **Step 4: Revert the test throw**

```bash
git checkout web/app/(marketing)/about/page.tsx
```

(Or undo the throw by hand if you also had legitimate edits in that file.)

- [ ] **Step 5: Commit**

```bash
git add web/app/error.tsx
git commit -m "feat(web): add error boundary page with oracle voice"
```

---

### Task 4: Implement `web/app/global-error.tsx`

**Files:**
- Create: `web/app/global-error.tsx`

**Important:** This file owns its own `<html>` and `<body>`. It MUST NOT depend on anything from the root layout (no fonts from `next/font`, no global CSS classes, no Background component, no providers). Use inline styles or a `<style jsx>` block.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pegana] fatal error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "1.125rem",
            letterSpacing: "0.08em",
            color: "#ff8a5b",
            marginBottom: "1.5rem",
            textTransform: "uppercase",
          }}
        >
          [ pegana : FATAL ]
        </div>

        <div style={{ maxWidth: "36rem", marginBottom: "0.75rem", fontSize: "1rem" }}>
          The web client failed to mount.
        </div>

        <div
          style={{
            maxWidth: "36rem",
            marginBottom: "2.5rem",
            fontSize: "0.875rem",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          The oracle data feed is reachable directly.
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.625rem 1.25rem",
              background: "#ff8a5b",
              color: "#000",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Reload
          </button>
          <a
            href="https://api.pegana.xyz"
            style={{
              padding: "0.625rem 1.25rem",
              background: "transparent",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
              textDecoration: "none",
              fontFamily: "inherit",
              fontSize: "0.875rem",
            }}
          >
            api.pegana.xyz →
          </a>
        </div>
      </body>
    </html>
  );
}
```

Note: The `reset` prop is part of the signature even if unused — keep it typed.

- [ ] **Step 2: Trigger the global error path manually**

This is harder to trigger because errors in `error.tsx`'s render or in the root layout itself are the only causes. Easiest method: temporarily add a throw to `web/app/layout.tsx` inside `RootLayout` before the `return`. **This is temporary — revert immediately.**

Example:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "development") throw new Error("global test");
  // ... existing return
}
```

- [ ] **Step 3: Visual sanity check**

Open `http://localhost:3000/` (any URL). Verify:
- Page is pure black with `[ pegana : FATAL ]` in coral
- No header, no footer, no Background gradient
- `Reload` button reloads the page (it will fault again, expected)
- `api.pegana.xyz →` link opens the API

- [ ] **Step 4: Revert the test throw**

```bash
git checkout web/app/layout.tsx
```

Verify the root layout renders normally again.

- [ ] **Step 5: Commit**

```bash
git add web/app/global-error.tsx
git commit -m "feat(web): add global-error fallback when root layout faults"
```

---

### Task 5: Production build + lint validation

**Files:** none touched

- [ ] **Step 1: Run TypeScript check**

```bash
cd web && bun run typecheck 2>&1 || cd web && npx tsc --noEmit
```

(Check `web/package.json` for the actual script name — common variants are `typecheck`, `type-check`, or running `tsc --noEmit` directly.)

Expected: clean output, no errors related to the three new files.

- [ ] **Step 2: Run ESLint**

```bash
cd web && bun run lint 2>&1 || cd web && npx next lint
```

Expected: no errors in `web/app/not-found.tsx`, `web/app/error.tsx`, `web/app/global-error.tsx`.

- [ ] **Step 3: Run production build**

```bash
cd web && bun run build
```

Expected: build succeeds. In the route list output, look for `/not-found` (Next emits it as a special route). The build should NOT prerender any of the test throws (those should already be reverted in Task 3/4).

- [ ] **Step 4: Spot-check each surface in dev server one more time**

With dev server running, visit:
- `http://localhost:3000/no-such-page` → expects `[ ROUTE_NOT_FOUND ]`
- After confirming, no need to re-trigger error/global-error (covered in Tasks 3 and 4)

- [ ] **Step 5: Commit if any lint/typecheck fixes were needed**

If Step 1 or 2 surfaced issues and you patched them, commit now:
```bash
git add -A
git commit -m "chore(web): satisfy lint/typecheck for error pages"
```

If no fixes were needed, skip this step.

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Decision #1 (3 surfaces) | Tasks 2, 3, 4 |
| Decision #2 (shared visual: brand mark, status token, copy, CTAs) | All three task implementations carry the same structure |
| Decision #3 (copy per surface) | Embedded verbatim in Tasks 2/3/4 |
| Decision #4 (CTAs and destinations) | Hard-coded in Tasks 2/3/4 |
| Decision #5 (why this copy, not generic) | Spec-level, no code change |
| `error.digest` to console only | Task 3 Step 1 (useEffect with console.error) |
| `global-error.tsx` zero dependencies | Task 4 Step 1 (inline styles only) |
| `global-error.tsx` owns html/body | Task 4 Step 1 |
| Dark mode renders correctly | Task 5 Step 4 (spot check); inline styles in global-error already dark |
| No TS / ESLint errors | Task 5 Steps 1 & 2 |
| Reload does hard refresh | Task 4 Step 1 (`window.location.reload()`) |
| api.pegana.xyz link resolves | Task 4 Step 1 |

All acceptance criteria from the spec map to a step.

**Placeholder scan:**

The `{PRIMARY_BUTTON_CLASS_FROM_TASK_1}` placeholders in Tasks 2 and 3 are intentional — Task 1 records the actual classes, and the implementer substitutes them. This is the *only* discovery-driven gap because the codebase's button classes are not memorized here; the implementing agent reads them once in Task 1.

No `TODO`, `TBD`, or "add appropriate error handling" instances.

**Type consistency:** The `{ error, reset }` prop signature matches between `error.tsx` and `global-error.tsx`. All `<Link>` imports are from `next/link`.
