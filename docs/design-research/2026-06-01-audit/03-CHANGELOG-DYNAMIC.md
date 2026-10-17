# Changelog — Master Design Spec: Make It Dynamic

**Page:** `pegana.xyz/changelog`
**Status:** Refine (Priority 2). Data layer is broken; visual layer is on-brand but under-spent.
**Date:** 2026-06-02
**Verdict floor:** P0 copy fix + public-repo data fix ship FIRST and INDEPENDENTLY. Everything else builds on a working feed.

---

## 0. The one-line problem

The owner sees **1 stale commit from May 21** and a **hardcoded release list**. Both symptoms have a single root cause: the commit fetcher points at a **private** repo, 404s on every unauthenticated request, and silently falls back to one hardcoded row. The releases list is genuinely hardcoded in `page.tsx` and contains copy that advertises a now-**forbidden** aesthetic (Fraunces serif italic). This doc fixes the data source, makes the curated tier semi-dynamic from real GitHub Releases, and re-spends the iridescent ammunition the page is currently missing.

---

## 1. Root-cause audit of the current data flow (verified, not assumed)

| File | Role | Defect |
|------|------|--------|
| `web/lib/github-commits.ts` L11 | `REPO = "lrafasouza/pegana"` | **PRIVATE repo.** Unauthenticated `api.github.com` returns **404** (verified: `curl → 404`). |
| `web/lib/github-commits.ts` L16-24, L90 | `FALLBACK` / `CHANGELOG_FALLBACK` | A **single** hardcoded commit. On 404 the page renders "Last 1 from main" — indistinguishable from a real feed, so it reads as broken. |
| `web/app/(marketing)/changelog/page.tsx` L12-95 | `RELEASES` const | Fully hardcoded. L19, L23 literally advertise **"Fraunces italic"** / **"Fraunces serif italic added"** — a brand-forbidden style on a live surface. |
| `web/app/feed/changelog.xml/route.ts` L17 | RSS feed | Same `getChangelogCommits` source → same 404 → same single-item feed. Fixing the lib fixes the RSS for free. |
| `web/app/(marketing)/about/page.tsx` L14 | `getRecentCommits(3)` | Same private REPO → also degraded. Fixing the lib fixes /about too. |

**Verified facts (live `curl`, 2026-06-02):**

```
GET api.github.com/repos/lrafasouza/pegana            /commits  → 404   (private)
GET api.github.com/repos/lrafasouza/pegana-replay     /commits  → 200   (public)  ✅
GET api.github.com/repos/lrafasouza/pegana-replay     /releases → 200   (public)  ✅
   releases present: v0.2.0 (2026-06-02), v0.1.0 (2026-05-29)
```

The page **already** links to `lrafasouza/pegana-replay` in its sub-copy (L107), its footer (`site-footer.tsx` L7 `REPO`), and the "See full history" CTA (L250). The fix is to make the **fetcher agree with the copy**.

---

## 2. Decision: data sources (locked)

Two tiers, two sources. Keep the existing two-tier architecture (curated story on top, raw proof below) — the audit confirms it is the right structure once the feed works.

### Tier A — Curated release notes (the human story)
**Source: GitHub Releases API of the public repo, merged over a hand-curated map.**
`GET api.github.com/repos/lrafasouza/pegana-replay/releases`

- The public repo carries real tagged releases (`v0.2.0`, `v0.1.0`) with `name`, `body` (markdown), `published_at`, `html_url`. These become the **spine** of the timeline.
- But the public repo only has CLI/methodology tags — the richer product story (web, MCP, channels) lives in the **closed** repo and must NOT be fetched. So Tier A is **release-API spine + a small curated overlay** the owner edits in one file.
- This keeps the timeline honest: every entry is either a real public tag OR an owner-authored note, never scraped from the private repo.

> **Why not 100% dynamic from releases?** The closed-repo boundary (changelog-client.tsx L116-119) is a deliberate posture: engine/dispatcher/API/indexer/bot/MCP "evolve in a closed repo and surface here only through release notes." The curated overlay is exactly that surface. Keep it editable, version-controlled, human-written.

### Tier B — Live commit feed (the proof)
**Source: GitHub Commits API of the public repo.**
`GET api.github.com/repos/lrafasouza/pegana-replay/commits?per_page=N`

- Unauthenticated. **No token.** Reading the public repo needs no auth; the unauthenticated rate limit (60 req/hr/IP) is irrelevant because we cache for 10 min (≈6 req/hr max from one ISR worker).
- **Rejected: `GITHUB_TOKEN` against the private repo.** This would dump raw closed-repo commit subjects onto a public marketing page and risk token exposure in a server path. It contradicts the stated repo-split boundary. Do not add it. (Confirmed: no `GITHUB_TOKEN` exists in `web/` today — adding one is net-new risk for zero benefit.)

### Rejected alternatives (and why)
- **`git log` at build time** → only sees the *web* repo's history on Vercel, not pegana-replay; and it would be frozen at build, defeating "live every 10 min." Reject.
- **Generated JSON committed to the repo** → stale between commits, needs a cron to regenerate, adds a moving part. The Releases/Commits API + ISR already gives freshness for free. Reject.
- **Client-side `fetch` in the browser** → leaks the API call to every visitor's IP (rate-limit fragility), no SSR content for SEO/first paint, and spinner-on-load. Reject. Fetch server-side.

---

## 3. Next 16 wiring (App Router, server-first)

`page.tsx` stays a **Server Component**: it `await`s both sources and passes serializable props into the existing `'use client'` `ChangelogClient`. This matches the project's marketing-page pattern (server fetch + metadata, client wrapper for motion).

### 3.1 Caching / revalidation
Use Next 16 ISR via `fetch`'s `next.revalidate`, plus a `tags` handle for optional on-demand purge. Keep the existing 10-minute window — it is already advertised in copy ("Both refresh every 10 minutes").

```ts
// in github-commits.ts — fetch options (both functions)
await fetch(url, {
  next: { revalidate: 600, tags: ["github-commits"] },   // 10 min ISR
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
});
```

- `revalidate: 600` → page HTML is regenerated at most every 10 min; first request after expiry serves stale, regenerates in background (Next 16 stale-while-revalidate semantics).
- `tags: ["github-commits"]` → optional `revalidateTag("github-commits")` from a webhook later if instant refresh is ever wanted. Not required for v1.
- RSS route already sets `export const revalidate = 600` and a `Cache-Control: s-maxage=600, stale-while-revalidate=86400` — leave as-is; it inherits the fixed source.

### 3.2 The single edit that unblocks everything (P0, do first)

```ts
// web/lib/github-commits.ts  L11
- const REPO = "lrafasouza/pegana";
+ const REPO = "lrafasouza/pegana-replay";   // PUBLIC — the repo the page already links to
```

This one line fixes `/changelog`, `/feed/changelog.xml`, and `/about` simultaneously. After it lands, "Past 7 days" becomes truthful and the feed shows real history.

### 3.3 New: Releases source for Tier A

Add a sibling function in `github-commits.ts` (or a new `lib/github-releases.ts`). Server-only, same cache contract.

```ts
export interface PublicRelease {
  tag: string;              // "v0.2.0"
  name: string;             // release title
  date: string;             // "2026-06-02"  (published_at sliced)
  url: string;              // html_url
  bodyMd: string;           // raw markdown body
}

export async function getPublicReleases(limit = 10): Promise<PublicRelease[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=${limit}`,
      { next: { revalidate: 600, tags: ["github-releases"] },
        headers: { Accept: "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28" } },
    );
    if (!res.ok) return [];          // empty → curated overlay still renders
    const raw = await res.json();
    return raw
      .filter((r: any) => !r.draft)
      .map((r: any) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        date: (r.published_at ?? "").slice(0, 10),
        url: r.html_url,
        bodyMd: r.body ?? "",
      }));
  } catch { return []; }
}
```

### 3.4 Tier A = curated overlay merged with releases

Keep a hand-authored map in `page.tsx` (or `changelog-releases.ts`) — this is the closed-repo "surface." Merge by date so a real GitHub release and an owner note interleave on one timeline.

```ts
// page.tsx — curated story (owner edits this; NO Fraunces/italic copy)
const CURATED: ReadonlyArray<Release> = [ /* the human narrative entries */ ];

export default async function ChangelogPage() {
  const [commits, releases] = await Promise.all([
    getChangelogCommits(24),
    getPublicReleases(10),
  ]);
  // map PublicRelease → Release shape, then merge + sort desc by date
  const fromGithub: Release[] = releases.map(r => ({
    date: r.date,
    tag: "feature",
    title: `${r.name} — pegana-replay`,
    bullets: bulletsFromMarkdown(r.bodyMd),   // split body on "- " / "\n"
    href: r.url,                              // NEW optional field: makes the row a link target
  }));
  const merged = [...CURATED, ...fromGithub]
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <>
      <ChangelogClient releases={merged} commits={commits} />
      <SiteFooter variant="default" />
    </>
  );
}
```

`bulletsFromMarkdown` is a 5-line helper: split body on newlines, keep lines starting with `-`/`*`/`•`, strip the marker, cap at 5. No markdown renderer needed — releases bodies are short bullet lists.

### 3.5 Data shapes (final)

```ts
// Tier A — extend existing Release with an optional outbound link
export interface Release {
  date: string;
  tag: "feature" | "fix" | "internal" | "breaking";
  title: string;
  bullets: string[];
  href?: string;           // NEW — present when sourced from a GitHub release
}

// Tier B — unchanged from today (already correct)
export interface ChangelogCommit {
  date: string;            // "2026-06-02"
  tag: "FEATURE" | "FIX" | "INTERNAL";
  blurb: string;
  scope: string | null;    // conventional-commit scope: "web", "api", null
  url: string;
  sha: string;             // 7-char short sha
}
```

### 3.6 Feed hygiene (the public repo is a subtree mirror — dedupe)

Verified: the public repo's recent commits are dominated by repeated `sync: mirror methodology + replay + assets + ADRs` rows (subtree-sync noise). The feed must not render six identical lines. Add a collapse step in `getChangelogCommits` **after** parsing:

- **Drop** commits whose subject matches `^sync:\s` (subtree mirror plumbing — not product changes).
- **Collapse** consecutive identical blurbs into one row (keep newest date + sha).
- Keep the existing `SKIP_TYPES_NEVER`/`style` filter.

```ts
const SKIP_SUBJECTS = /^sync:\s/i;           // subtree mirror noise
// inside the loop:
if (SKIP_SUBJECTS.test(parsed.blurb) || SKIP_SUBJECTS.test(firstLine)) continue;
// after building `out`: collapse consecutive duplicate blurbs
const deduped = out.filter((c, i) => i === 0 || c.blurb !== out[i - 1].blurb);
```

---

## 4. Designed states (no more silent fallback)

The current `CHANGELOG_FALLBACK` single row is the core "looks broken" complaint. Replace the silent fallback with **three explicit, designed states**, decided in the client from the props it receives.

| State | Trigger | Render |
|-------|---------|--------|
| **Loaded** | `commits.length > 0` | Grouped day feed (Section 6). |
| **Empty (filter)** | filter yields 0 of N | Centered designed empty state, muted Geist copy, no mono line. |
| **Degraded (feed unreachable)** | `commits.length === 0` from source | A single designed **card** — not a row — "Commit feed syncing." + external CTA. |

**Drop `CHANGELOG_FALLBACK` entirely.** Return `[]` on failure; let the client render the Degraded card. A real empty array is honest; a fake commit is not.

### Degraded card spec
- Sharp `0px` card, `bg-surface-1` (`#0a0a0a`), `border border-hairline` (`#1a1a1a`).
- Headline: Geist 500, `text-[16px]`, `text-text`: **"Commit feed syncing."**
- Sub: Geist 400, `text-[14px]`, `text-text-muted`: "Live history loads from the pegana-replay repository. Check the full log on GitHub while this catches up."
- One ghost-pill CTA (Section 7) "Full history on GitHub" with the top-right external arrow.

### Skeleton (shape-matched, for the ISR-miss window)
- One grey day-header bar (`bg-surface-2 #141414`, `h-[14px] w-[120px]`) + **4** grey rows (`h-[44px]`, `bg-surface-1`, `1px` hairline gaps mirroring the real feed grid).
- Pulse via `motion-reduce:animate-none` so it stops under reduced-motion.
- Render only if you later make the feed client-fetched; with server `await` there is no client loading flash, so this is optional/defensive. Keep the spec for the filter cross-fade window.

---

## 5. Brand & copy fixes (P0, ship independent of visuals)

### 5.1 DELETE the Fraunces/italic bullets — live brand violation
`page.tsx` RELEASES[0] (the 2026-05-27 entry) bullets L19 and L23 advertise a forbidden style.

```diff
- "New Methodology section — formula as art (Fraunces italic + iridescent underlines).",
+ "New Methodology section — formula as art with iridescent variable underlines.",
...
- "Fraunces serif italic added — accent words only, brand-distinctive.",
+   (delete this bullet entirely — there is no serif/italic in the brand)
```

This is a one-commit copy edit. It ships before any redesign because it is a contradiction shipping today.

### 5.2 DELETE the 4-up stat strip
`changelog-client.tsx` L121-126 (`<dl>` with Releases / Commits surfaced / Past 7 days / Auto-refresh). It is the canonical AI "add some stats" tell, and with the broken feed it numerically broadcasts "1 commit / 0 in 7 days." Remove the `<dl>` and the `Stat` component.

**Optional replacement — one inline caption, not a grid:** beside the headline, a single mono caption `last synced 4m ago` (number in JetBrains Mono, label in `text-text-caption`). This is a caption, not a metric strip. Compute from the newest commit date or a server timestamp; round to minutes. If it adds plumbing, ship without it — deletion alone is the win.

### 5.3 De-mono the UI strings
Mono is scoped to numbers/datestamps/sha/tech-labels — **not** filter words, link labels, or tag words.

- Filter labels `all / feature / fix / internal` → **Geist** (the count badge stays mono — it is a number).
- "See full history on GitHub" / "RSS" link text → **Geist** (they become ghost-pill CTAs, Section 7).
- Commit-tag chip word → token-colored chip, **not** mono lowercase text (Section 6).
- **Keep mono on:** the date headers, the 7-char `sha`, the optional `last synced` number. These are legitimate (datestamps + code identifier).

---

## 6. Visual spec — the two tiers

### 6.1 Hero — spend the one accent
The page is currently fully monochrome; the signature gradient appears nowhere. This is the single highest-impact fix. **Ammunition budget for the entire page: exactly one hero spotlight + one headline accent span + the coral timeline dots. Nothing else iridescent.**

- **Eyebrow** (mono caps, wide tracking, `text-text-caption`): `CHANGELOG` — `text-[11px] tracking-[0.18em]`.
- **Headline** Geist 500, `clamp(40px, 6vw, 80px)`, `tracking-[-0.025em]`, `leading-[1.0]`, `text-text` (`#fffdf9`). Wrap **one** concept in the iridescent span:

```tsx
<h1 className="font-medium tracking-[-0.025em] leading-[1.0] text-text
               text-[clamp(40px,6vw,80px)]">
  What <span className="text-iridescent">changed</span>.
</h1>
```

`.text-iridescent` already exists in `globals.css` L242-244 (the `--gradient-iridescent` clip). No new CSS.

- **Sub** Geist 400, `text-[clamp(17px,1.4vw,19px)]`, `leading-[1.6]`, `text-text-muted`, `max-w-[680px]`, with a bold-tail in `text-text-body`:
  > "Curated release notes, then the raw commit feed — both live from the pegana-replay history, **refreshed every 10 minutes.**"
  Keep the existing closed-repo sentence; it is honest and on-brand.

- **Ambient spotlight** (the approved "hero spotlight" usage, the only ambient moment on the page):
  - A single radial using `--gradient-iridescent` colors at **very low opacity** behind the hero only, fading to pure `#000` before the first section.
  - CSS-only is the right call here (LCP-sensitive page; tech-notes decision tree → "CSS @keyframes, ~0% GPU" for marketing). No R3F, no shader, no particles, no scanlines.
  - Spec: `position:absolute; inset:0 0 auto 0; height:520px; pointer-events:none; z-index:-1;` with
    `background: radial-gradient(60% 80% at 50% -10%, rgba(255,132,0,0.10), rgba(223,145,247,0.06) 38%, transparent 70%);`
    and a `mask-image: linear-gradient(#000, transparent)` so it dies into the canvas.
  - Entrance: fade `opacity 0→1` over **1.2s** (the canvas-fade-in timing), wrapped in `motion-reduce:` → render at static opacity, no fade.
  - **Must fade to pure #000 by the first section.** Below the hero stays pure black so the timeline reads as crisp editorial structure.

### 6.2 Tier A — Releases timeline (keep + refine)
The coral-dot-on-rail pattern is the best thing on the page. Keep it. Refinements:

- **Sticky month dividers**: group entries under a mono caption (`MAY 2026`, `JUNE 2026`) — `font-mono text-[11px] tracking-[0.14em] text-text-caption`, `sticky top-0` with a `bg-canvas/80 backdrop-blur` strip so it reads while scrolling a long list. Mono is correct here (it is a datestamp).
- **Hover-lift each release row** (now a real target since GitHub-sourced rows carry `href`):
  - `border border-hairline` → `border-outline` on hover; translate `-2px`.
  - Transition **0.2s `var(--ease-default)`** (respects the 200ms interactive floor; do NOT use 0.12/0.15s).
  - Wrap the whole `<li>` in a link only when `r.href` exists; curated-only entries stay static.
- **Keep** coral dot + glow (`bg-coral`, `shadow-[0_0_10px_var(--color-coral)]`), date/tag left rail, title + bullets right. Geometry stays `0px`. Tag chip stays the existing sharp `releaseTagStyle` inline span (`bg-st-pegged/15 text-st-pegged`, no radius) — **do not** round it; it is a label, not an action.
- **Reveal-on-scroll**: standardize the existing GSAP stagger to **0.7s** fade-up (currently 0.5s), `var(--ease-out-strong)`, `stagger 0.06`, guarded by the existing `useReducedMotionGsap`. The existing ScrollTrigger approach is acceptable; just fix the duration.

### 6.3 Tier B — Commit feed (de-terminalize)
This is the half that drags the page CLI-ward. Restructure from a flat zebra-less ledger into a **grouped, designed surface**.

**Group by day.** One mono date header per day (`font-mono text-[12px] text-text-caption`, e.g. `JUN 2`), then that day's rows beneath. **Drop the per-row date column** entirely.

**Per-row layout** (sharp `0px`, `bg-canvas`, `1px` hairline gaps via the existing `grid gap-px bg-hairline`):
- Grid: `grid-cols-[1fr_auto]` (mobile) → `grid-cols-[auto_1fr_auto]` (sm: tag · blurb · sha).
- **Tag** → small **sharp** token-colored chip (NOT mono lowercase text, NOT rounded). Mirror `releaseTagStyle`: `bg-st-pegged/15 text-st-pegged` (FEATURE), `bg-st-drift/15 text-st-drift` (FIX), `bg-text-muted/15 text-text-muted` (INTERNAL). `0px` radius (a 4px code-chip is the max if any radius is wanted). `text-[10px] uppercase tracking-[0.1em] px-1.5 py-px`. Pills are for actions; a tag is a label → stays a rectangle.
- **Blurb** → primary element, **Geist** `text-[14px] leading-[1.5] text-text`. Optional scope prefix as a small `text-text-caption` mono token (scope is a technical label — mono is legitimate).
- **Sha** → the **only** mono element in the row (`font-mono text-[10px] text-text-muted`), right-aligned, links to GitHub with the top-right external arrow. Hover `text-text` at **0.2s**.
- **Row interactions:** `0.2s var(--ease-default)` color-swap on the sha link; `0.2s` background lift on row hover (`bg-canvas → bg-surface-1`). No springs (brand: ease only). No 120/150ms timings.

**Filters → ghost pills (actions, so they are rounded).**
- Convert the sharp mono rectangles to `rounded-full` ghost pills, `border-outline`, **Geist** labels (`All / Feature / Fix / Internal`), with a mono count badge.
- Active state: `bg-text text-canvas` (keep), `0.2s` bg transition (`var(--ease-default)`), not 0.15s.
- Hover: `border-outline → border-text`, `text-muted → text`, 0.2s.

**Filter change = cross-fade, not hard swap.** On filter change, cross-fade the list over **0.2s** (`framer-motion` `AnimatePresence mode="wait"` on the list, or a CSS opacity swap keyed on `filter`). Wrap in `useReducedMotion()` — under reduce, swap instantly.

### 6.4 Section headers — break the formula
Two back-to-back `Word. muted-tail.` headers ("Releases. / Commit feed.") read as a template. Keep the editorial style but differentiate:
- Tier A: **"Releases."** + muted tail "Curated notes per ship."
- Tier B: drop the twin pattern. Use an eyebrow + plain head: eyebrow `LIVE FROM PEGANA-REPLAY` (mono caps) over **"Every commit."** (Geist, no muted tail). Different shape → no longer formulaic.

---

## 7. Footer / external links → ghost-pill CTAs

"See full history on GitHub" and "RSS" are **actions**, currently styled as tiny mono-uppercase dev-tool chrome. Promote both to ghost-pill CTAs per brand CTA convention.

- Shape: `rounded-full`, `border border-outline`, `px-4 py-2`, **Geist** `text-[13px]`.
- Labels: "Full history on GitHub" + top-right external arrow (`IconArrowUpRight`, already imported); "RSS feed" + same arrow.
- Hover: `border-text`, `text-text`, **0.2s** `var(--ease-default)`; arrow nudges `translate-x-[2px]` at 0.2s (currently 500ms — fix to 200ms).
- Place the pair right-aligned below the feed (replacing the current chrome links).

---

## 8. Motion table (page-wide, brand-clamped)

All interactive transitions clamped to the **200ms floor**; all reference brand tokens, no raw cubic-bezier literals in components.

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Hero spotlight | opacity 0→1 | 1.2s | `var(--ease-out-strong)` |
| Hero headline | entrance fade-up | 0.8s | `var(--ease-out-strong)` |
| Release rows / day groups | reveal fade-up | 0.7s | `var(--ease-out-strong)` |
| Link color-swap (sha, ghost pills) | color/border | **0.2s** | `var(--ease-default)` |
| Row hover lift | background/translate | **0.2s** | `var(--ease-default)` |
| Filter pill bg | background | **0.2s** | `var(--ease-default)` |
| Filter list change | cross-fade | **0.2s** | `var(--ease-default)` |
| Arrow nudge on CTA hover | transform | **0.2s** | `var(--ease-default)` |

**Corrections to the audit brief (enforced):** the brief's 0.12s/0.15s hover timings violate the brand 200–300ms interactive floor — all clamped to 0.2s above. Raw `cubic-bezier(.16,1,.3,1)` literals are replaced by `var(--ease-out-strong)` (which is exactly that curve, already a token at `globals.css` L47). Entrances (0.7/0.8/1.2s) are not interactive states, so the floor does not apply to them.

Every motion block wrapped in `prefers-reduced-motion` / `useReducedMotion()`: reveals become instant-visible, spotlight renders at static opacity, cross-fade becomes an instant swap, skeleton pulse stops (`motion-reduce:animate-none`).

---

## 9. Tokens used (all already in `globals.css` — no new tokens)

```
Canvas    #000        bg-canvas
Surface   #0a0a0a→#141414   bg-surface-1 / bg-surface-2
Hairline  #1a1a1a     border-hairline
Outline   #2a2a2a     border-outline
Text      #fffdf9     text-text
Body      #e8e8e8     text-text-body
Muted     #9aa9b8     text-text-muted
Caption   #787878     text-text-caption
Coral     #ff8a5b     bg-coral (timeline dots)
State pips st-pegged #6bd697 / st-drift #c08a55 / st-depeg #a55a5a  (tag chips)
Accent    --gradient-iridescent (L37) via .text-iridescent (L242) + hero radial
Easing    --ease-default (L46) / --ease-out-strong (L47)
```

Typefaces: **Geist** (everything except numbers/dates/sha/scope/tech-labels) + **JetBrains Mono** (those only). No serif. No italic. Geometry: `0px` on cards/rows/chips; `rounded-full` only on filter + external-link CTAs; `4px` max if a tag chip ever wants a radius.

---

## 10. Build order (each step shippable on its own)

1. **P0 copy** — delete Fraunces/italic bullets in `page.tsx` RELEASES[0]. Ship alone.
2. **P0 data** — `REPO = "lrafasouza/pegana-replay"` + `sync:` filter + dedupe in `github-commits.ts`; drop `CHANGELOG_FALLBACK`, return `[]` on failure. Unblocks /changelog, /about, RSS together.
3. **Tier A dynamic** — add `getPublicReleases` + curated-overlay merge + `Release.href`.
4. **Designed states** — Degraded card + designed filter-empty state + (optional) skeleton.
5. **Hero ammunition** — iridescent headline span + radial spotlight; delete the 4-up `<dl>`.
6. **De-terminalize feed** — day grouping, token tag chips, Geist filter pills, sha-only mono, cross-fade.
7. **Ghost-pill CTAs** + motion-timing cleanup (0.5s→0.7s reveal, 500/300ms→200ms interactions).

---

## 11. Acceptance checklist
- [ ] `/changelog` shows real, deduped commits from pegana-replay (not 1 stale row).
- [ ] "Past 7 days" / any live signal is truthful (and the 4-up strip is gone).
- [ ] Zero "Fraunces" / "italic" / serif references anywhere in copy.
- [ ] Exactly one iridescent headline span + one hero spotlight + coral dots — no other gradient.
- [ ] No mono on UI words (filters, link labels, tag words); mono only on dates/sha/scope.
- [ ] No rounded tag chips; rounded-full only on filter + external CTAs.
- [ ] Degraded feed renders a designed card, never a fake commit row.
- [ ] All interactive transitions ≥ 200ms via `--ease-default`; reveals via `--ease-out-strong`; every motion guarded by reduced-motion.
- [ ] No `GITHUB_TOKEN`, no private-repo fetch, no terminal/CLI register.
