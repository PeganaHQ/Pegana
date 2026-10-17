# Trust Layer Broken Wires Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reconnect the 8 broken wires in the Trust Layer v0.1.0 marketing surfaces (`/methodology`, `/audit`, `/agents`, `/pricing`) so users stop hitting 404s, the install snippet works today, and the calibration window is communicated honestly instead of looking like a dead page.

**Architecture:** Pure web/ Next.js 16 marketing changes. No backend or infra changes — we replace the vaporware `releases.pegana.xyz` install snippet with a `cargo install --git` form that works *today*, swap the misleading MCP `<a>` for a copyable `CodeBlock`, hide the waitlist section, fix two broken doc links, replace runtime `git log` with a build-time JSON, and add a `CalibrationBanner` that explains the verdict-gate window (ADR-0001 / ADR-0005) on every Trust Layer surface.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 · existing `CodeBlock` molecule · Node `fs` build-time JSON · bun runtime.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `web/app/(marketing)/pricing/page.tsx` | Modify | Hide waitlist section (preserve under feature flag `SHOW_WAITLIST`) |
| `web/app/(marketing)/agents/page.tsx` | Modify | Swap MCP anchor → CodeBlock; fix Atom feed URL; drop "Pricing waitlist" CTA |
| `web/app/(marketing)/methodology/page.tsx` | Modify | Replace install snippet, fix `crates/replay-cli` path, read JSON instead of `git log` |
| `web/app/(marketing)/audit/[id]/page.tsx` | Modify | Same install snippet replacement |
| `web/app/(marketing)/audit/page.tsx` | Modify | Differentiate calibration window from API-down empty state |
| `web/lib/assets-history.json` | Create | Build-time generated list of `assets.toml` commits |
| `web/scripts/gen-assets-history.mjs` | Create | Script that writes the JSON above; hooked to `prebuild` |
| `web/components/molecules/calibration-banner.tsx` | Create | Global banner with countdown to 2026-06-11 verdict gate |
| `web/app/(marketing)/layout.tsx` | Modify | Mount `CalibrationBanner` |
| `web/package.json` | Modify | Add `prebuild` script |

---

## Task 1 — Cut feature branch (done)

Already on `fix/trust-layer-broken-wires`.

## Task 2 — Hide `/pricing` waitlist

**Files:** `web/app/(marketing)/pricing/page.tsx`

- [x] Wrap the waitlist `<section>` (lines 85-163) in a constant `SHOW_WAITLIST = false` gate. Keep the code for trivial re-enablement.
- [x] Update the page header copy to remove implicit waitlist promise (line 35-41).
- [x] Remove the footer link to `/methodology#lifecycle` referencing "why no prices" if it still reads like a waitlist tease (keep otherwise).
- [x] Update the metadata description (line 13-14) to drop "join the waitlist".

## Task 3 — Replace MCP server URL anchor with CodeBlock

**Files:** `web/app/(marketing)/agents/page.tsx`

- [x] Import `CodeBlock` from `@/components/molecules/code-block`.
- [x] Replace the `<a href={MCP_URL}>` button (line 138-145) with a small `CodeBlock` containing `https://mcp.pegana.xyz` (lang="text"). Add a hint above: "Point your MCP client here — no browser UI."
- [x] Drop the "Pricing waitlist" `<Link>` (line 152-157) since the waitlist is now hidden. Replace with a link labeled "Pricing".

## Task 4 — Fix Atom feed URL + broken crate link

**Files:** `web/app/(marketing)/agents/page.tsx`, `web/app/(marketing)/methodology/page.tsx`

- [x] In `agents/page.tsx` line 110, change `${REST_BASE.replace("api.pegana.xyz", "pegana.xyz")}/feed/events.xml` to `https://www.pegana.xyz/audit.xml`. The route at `/audit.xml` actually exists.
- [x] In `methodology/page.tsx` line 132, change `crates/replay-cli` → `crates/pegana-replay-cli`.

## Task 5 — Rewire install snippet

**Files:** `web/app/(marketing)/methodology/page.tsx`, `web/app/(marketing)/audit/[id]/page.tsx`

- [x] In `methodology/page.tsx` lines 117-130, replace the `curl ... releases.pegana.xyz | sh` snippet with:
  ```bash
  # Build & install from source (Rust toolchain required)
  cargo install --git https://github.com/lrafasouza/pegana \
    --branch main pegana-replay

  # Verify a single alert
  pegana-replay --alert-id <UUID>

  # Verify the on-chain commitment too
  pegana-replay --alert-id <UUID> --verify-onchain
  ```
  And add a note: "Hosted curl-installer with Sigstore attestation ships with v0.1.0 GA on 2026-06-11. Until then, build from source."
- [x] Mirror the same change in `audit/[id]/page.tsx` lines 287-292.

## Task 6 — Build-time JSON for assets history

**Files:** `web/lib/assets-history.json`, `web/scripts/gen-assets-history.mjs`, `web/package.json`, `web/app/(marketing)/methodology/page.tsx`

- [x] Write `web/scripts/gen-assets-history.mjs` — runs `git log --follow --pretty=format:%H|%ad|%s --date=short -n 20 -- assets.toml` from repo root, writes JSON array to `web/lib/assets-history.json`.
- [x] Run the script once now to seed `web/lib/assets-history.json`.
- [x] Add `"prebuild": "node scripts/gen-assets-history.mjs"` to `web/package.json`.
- [x] Rewrite `loadAssetsHistory()` in `methodology/page.tsx` to read `web/lib/assets-history.json` via `fs.readFile`. No more `execSync`. Falls back to empty array if file missing.

## Task 7 — `/audit` empty state + CalibrationBanner

**Files:** `web/components/molecules/calibration-banner.tsx`, `web/app/(marketing)/layout.tsx`, `web/app/(marketing)/audit/page.tsx`

- [x] Create `CalibrationBanner` server component. Until `2026-06-11T00:00:00Z`, render a thin top banner over marketing pages:
  > "Calibration window — first public verdict on 2026-06-11. We don't publish performance we haven't measured. [Read ADR-0001]"

  After the gate date, render nothing.
- [x] Mount it inside `(marketing)/layout.tsx` above `<UtilStrip />`.
- [x] In `audit/page.tsx`, change `fetchIndex()` to return `{ rows, status: 'ok' | 'unreachable' }`. When network errors → `unreachable`; when ok with empty array → `ok`. Render two distinct empty states.

## Task 8 — Dev server smoke test

- [x] `bun --cwd web dev` (or `pnpm --cwd web dev`)
- [x] Visit `/pricing`, `/audit`, `/methodology`, `/agents` — confirm fixes
- [x] Check console for hydration / 404 errors

## Task 9 — Self-review

- [x] Invoke `review-and-iterate` skill on the full diff
- [x] Address any P0/P1 findings

## Task 10 — Commit + PR

- [x] `git add` only the touched files
- [x] Commit with the message body explaining the 8 fixes
- [x] Push, `gh pr create`

## Task 11 — PR review

- [x] Invoke `/review` skill on the new PR

---

## Self-review checklist

- All 8 broken wires from the analysis have a task (✓ pricing waitlist, MCP anchor, Atom URL, crate path, install snippet x2, git-log on Vercel, audit empty state, calibration narrative).
- No placeholders or TODOs in code blocks.
- `CodeBlock` reuse confirmed.
- Layout placement of `CalibrationBanner` matches existing `UtilStrip` pattern.
