# Mobile + Motion Overhaul — SPEC

Date: 2026-08-11
Status: approved for execution (founder brief: "improve the whole mobile app, restructure the
sidebar/menu, decide the iOS/Android question, add animation everywhere including pagination and
page changes, desktop and mobile, do it completely")
Surfaces: `web/` only. No Rust, no backend, no schema change.

---

## 1. Context: what is actually wrong today

Every claim below was measured on production (`pegana.xyz`) at 390x844 on 2026-08-11, or read out
of the source. Nothing here is inferred.

### 1.1 The phone has four competing navigation affordances

The `(app)` header at 390px carries: logo, a search icon, a `SIGN IN ->` text link, and a hamburger.
Below it, `MobileTabBar` carries Dashboard / Assets / Events / Account. The hamburger then opens a
**flat 10-item list whose first four items are the same four tabs**. Four affordances, one of which
duplicates another, in 390 CSS pixels.

The drawer has no grouping, no icons, no sections, and no hierarchy. It reads as a sitemap, not as
an app menu.

### 1.2 Two mobile drawers, two rigor levels, two breakpoints

| | app (`components/molecules/mobile-menu.tsx`) | marketing (`components/organisms/v2/nav-v2.tsx`) |
|---|---|---|
| Element | native `<dialog>` + `showModal()` | plain `<div>` sibling |
| Focus trap | platform | none |
| Body scroll lock | yes | none |
| Esc to close | platform | none |
| Reveal | `clip-path` + `@starting-style`, attribute-driven | `max-height: 0 -> 420px` |
| Breakpoint | `lg` (1024px) | `min-[920px]` |

A phone visitor on marketing gets the weaker one, and also gets no command palette (the palette is
only mounted in `(app)/layout.tsx`).

### 1.3 Four uncentralized breakpoints

640 (`sm`, table -> card), 899/900 (motion + stacking), 919/920 (marketing nav), 1024 (`lg`, app
chrome + the only place `.app-chrome-glass` gets blur). Nothing names them; 900 and 920 are raw
arbitrary values scattered across `v2.css` and six components.

The topbar height is worse: the literal `73px` is hardcoded in `(app)/layout.tsx`,
`health-banner.tsx`, `ws-banner.tsx`, `dashboard-topbar.tsx`, and passed as a string into
`mobile-menu.tsx`. Five files must agree by hand.

### 1.4 There is no route transition of any kind

Verified: zero occurrences of `ViewTransition`, `startViewTransition`, or `view-transition-name`;
no `template.tsx`; no `loading.tsx` anywhere in `app/`; no `experimental` block in
`next.config.ts`. Every navigation is a hard cut. This is the founder's headline complaint.

### 1.5 Pagination is copy-pasted four times, and does not animate

`dashboard/page.tsx` (10/page), `assets-screener-page.tsx` (25), `events/page.tsx` (25),
`lst-directory-table-v2.tsx` (25). All four are `useState` + `array.slice`. None writes `?page=` to
the URL. Two use `<nav aria-live>`; two use a `div` plus a separate `sr-only role="status"` twin.
Page changes swap rows instantly and leave the scroll position wherever it was, so on a long table
the user can page while the table is off-screen.

### 1.6 The phone's first viewport contains almost no data

Chrome costs 142px of 844 (77px header + 65px tab bar = 17%). Below it: a clipped spread-tape
marquee, then two full-height insight cards ("Closest to its band", "Most volatile 24h"). The asset
board, which is the reason the page exists, starts on the third screen.

### 1.7 The PWA is manifest-only

`public/site.webmanifest` exists and is decent (`display: standalone`, 3 icons, maskable). Missing:
service worker, offline shell, `appleWebApp` metadata, `shortcuts`, `screenshots`, `id`,
`display_override`. `start_url` is `/`, so an installed Pegana opens the marketing landing rather
than the console. There is no install affordance anywhere.

### 1.8 Dead and mis-wired code found on the way

- `components/organisms/app-footer.tsx` — zero import sites; its header comment claims it is "used
  on every (app) route", which stopped being true when `(app)/layout.tsx` moved to `SiteFooterV2`.
- `components/molecules/reveal.tsx` — zero import sites.
- `lib/motion/use-counter-morph.ts` — zero call sites, but it has a passing unit test. It is
  finished work that was never wired up.
- `components/molecules/pill-tabs.tsx` imports raw `motion` instead of `m`, which defeats the
  `LazyMotion` bundle split that `motion-provider.tsx` exists to provide.
- `.skeleton-sheen` (an animated shimmer in `globals.css`) is used in exactly 2 places, while the
  shared `Skeleton`/`SkeletonRow` atoms every other surface uses are static.
- The card surface class string (`rounded-[16px] border border-hairline bg-surface-1 ...
  hover:ring-2 ... active:scale-[0.98]`) is copy-pasted across 9+ files.

---

## 2. The iOS / Android decision

**Decision: one installable PWA, one interaction language derived from Apple's HIG, applied
identically on both platforms. No native shell, no per-platform UI fork.**

Recorded as **ADR-0045**.

### Why not native (or React Native / Capacitor)

- The product has zero paying users. `ROADMAP.md`'s own trigger table gates even a *Telegram Mini
  App* behind "60%+ mobile traffic OR partner ask", and the anti-roadmap bans building ahead of
  demand. A native app is an order of magnitude past that bar.
- The one capability that genuinely justifies a native shell is push. Pegana already delivers
  alerts over Telegram and webhooks, which for this audience is better than APNs/FCM: no store
  review, no install required, and it already works.
- A store presence adds a release gate to a product whose whole value is that its numbers are
  current.

### Why not fork iOS and Android

- One founder cannot keep two interaction languages honest. The repo already carries one documented
  duplication (`v2.css` tokens vs `globals.css` tokens) and it has cost real bugs.
- `DESIGN.md` specifies a single motion system with named eases and a mandatory reduced-motion
  matrix. Forking it would mean two matrices to audit.
- Material's own bottom-navigation guidance and Apple's tab-bar guidance agree on the parts that
  matter here (persistent bottom tabs, 3-5 destinations, no nested tabs). The divergence is
  cosmetic, and cosmetic divergence is exactly what a brand-led product should not import.

### What "full Apple" means concretely in this codebase

Not skeuomorphism, and not iOS chrome pastiche. It means adopting the *behaviours* iOS users read
as "this is an app":

1. Persistent bottom tab bar owns primary destinations; everything else lives in a **sheet**.
2. Sheets rise from the bottom, are dismissible by the platform (Esc / backdrop), and never nest.
3. Navigation has direction: forward pushes, back pops. Expressed with view transitions.
4. The chrome never moves during a push. Only content moves.
5. Minimum 44px touch targets; `env(safe-area-inset-*)` respected on every fixed edge.
6. No tap highlight rectangle, no 300ms delay, no rubber-band scroll chaining out of a sheet.
7. Large title collapses into a compact title as content scrolls.

Android gets exactly this. It is a superset of what Material asks for on every point that
conflicts.

### What actually ships for "the app"

`app/manifest.ts` (typed `MetadataRoute.Manifest`) with `id`, `display_override`, `shortcuts`,
`screenshots`, and `start_url: "/dashboard?source=pwa"` so an installed Pegana opens the console;
`appleWebApp` metadata; a deliberately minimal service worker; and a non-nagging install affordance.

**Service-worker honesty constraint (non-negotiable):** the service worker caches the app shell,
fonts, and icons. It **never** caches `/v1/*` responses. This is a freshness product whose entire
purpose is to tell you a peg has moved. Serving a cached peg state offline would be the exact
failure the product exists to prevent. Offline shows the offline page, not stale numbers.

---

## 3. Technical findings that constrain the implementation

These were verified against the installed packages, not assumed.

1. **Next 16.2.11 supports view transitions.** `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`
   documents `experimental.viewTransition: true`, `<ViewTransition>`, `transitionTypes` on `<Link>`,
   and directional `enter`/`exit` maps.
2. **`next/link` already types `transitionTypes?: string[]`** (`next/dist/client/app-dir/link.d.ts:183`).
   No shim needed on the Link side.
3. **Next's bundled React exports `ViewTransition` and `addTransitionType`**
   (`next/dist/compiled/react/cjs/react.production.js`), so `import { ViewTransition } from "react"`
   resolves in App Router code.
4. **But `node_modules/react@19.2.4` does NOT export `ViewTransition`.** Vitest resolves plain
   `react`, so any component importing `ViewTransition` directly from `"react"` renders `undefined`
   and blows up 652 unit tests. **Mitigation: a single shim at `lib/motion/view-transition.tsx`
   that falls back to a passthrough when the symbol is absent. Every component imports the shim,
   never `react` directly.**
5. **Types come from `@types/react/canary.d.ts`** (27 `ViewTransition` references). Reference it
   from a new `types/react-canary.d.ts`; do not edit `next-env.d.ts` (generated).
6. **The global reduced-motion rule does not reach view transitions.** `globals.css:246-256` nukes
   `animation`/`transition` on `html, *, *::before, *::after`. `::view-transition-*` pseudo-elements
   live in the top layer under `:root` and are not descendants of anything that rule matches. An
   explicit opt-out block is required or the entire WCAG 2.3.3 posture regresses.
7. **Lenis will fight a view transition on `/`.** `LenisV2` hijacks scroll and drives ScrollTrigger
   through `gsap.ticker`; `TrustSceneV2` is a 340vh scrubbed pin. Marketing therefore gets a
   crossfade only, never a directional slide, and never a shared-element morph into the pinned scene.
8. **`view-transition-name` must be unique per document.** jitoSOL can appear simultaneously in the
   board, the spread tape, the market feed, and peer comparison. The morph name is applied only on
   the primary list row of a given page, guarded by a prop, never on decorative repeats.
9. **CSP is nonce-based and strict.** All view-transition keyframes go in bundled CSS
   (`globals.css`), never an injected `<style>`.
10. **`next dev` / `next build` are banned locally** (they crash the machine). Verification is
    `typecheck` + `lint` + `vitest` + Playwright against a pushed Vercel preview.

---

## 4. Waves

Each wave ends green on `bun run typecheck && bun run lint && bun run test`. Files are disjoint
across parallel work. Commits are by explicit path; `git add -A` is never used. The uncommitted
`x-oauth` / `x-share` WIP stays uncommitted (it has 15 open review findings including an open
redirect and a broken PKCE encoder).

### Wave 1 — Foundations (no visual change)

- `app/globals.css` `@theme`: add `--breakpoint-scene: 900px`, `--breakpoint-navpill: 920px` so
  Tailwind v4 generates `scene:` / `navpill:` variants, replacing raw `min-[900px]` / `min-[920px]`.
- Add `--app-topbar-h` (and a `--app-tabbar-h`) custom property; replace the hardcoded `73px` in
  `(app)/layout.tsx`, `health-banner.tsx`, `ws-banner.tsx`, `dashboard-topbar.tsx`, and the
  `panelTopClassName` default in `mobile-menu.tsx`.
- `next.config.ts`: `experimental: { viewTransition: true }`.
- New `types/react-canary.d.ts` referencing `react/canary`; include it from `tsconfig.json`.
- New `lib/motion/view-transition.tsx` shim (point 3.4 above) + its unit test.
- `globals.css`: view-transition keyframes (`vt-fade`, `vt-slide`) and the
  `@media (prefers-reduced-motion: reduce) { ::view-transition-old(*) ... }` opt-out.
- Delete `components/organisms/app-footer.tsx` and `components/molecules/reveal.tsx`.
- `pill-tabs.tsx`: raw `motion` -> `m`.
- Native-feel base CSS on the app shell: `-webkit-tap-highlight-color: transparent`,
  `touch-action: manipulation`, `overscroll-behavior-y: contain` on sheets/scrollers.

### Wave 2 — Route transitions and chrome anchoring

- Wrap `(app)` and `(marketing)` page content in the `ViewTransition` shim with directional
  `enter`/`exit` maps keyed on `nav-forward` / `nav-back` / `nav-lateral`, `default: "none"`.
- `viewTransitionName` + `::view-transition-group(...) { animation: none }` on `DashboardTopBar`,
  `MobileTabBar`, `HealthBanner`, `WsBanner`, `NavV2` so the chrome never slides.
- `transitionTypes` on links: tab bar and drawer -> `nav-lateral`; board/screener row -> asset ->
  `nav-forward`; breadcrumbs and back links -> `nav-back`.
- Shared-element morph `asset-mark-${symbol}` from the primary list row's token mark into the asset
  hero mark, guarded by a `morphName` prop so it is applied exactly once per document.
- Marketing gets crossfade only (finding 3.7).
- E2E `tests/e2e/page-transitions.spec.ts`.

### Wave 3 — Pagination unification and animation (explicit ask)

- New `lib/hooks/use-pagination.ts`: page state, clamping, reset-on-dependency-change, `?page=` URL
  sync via `router.replace(..., { scroll: false })` (the idiom already in `use-screener-state.ts`),
  and a `direction` output (`next` | `prev`) for the transition.
- New `components/molecules/pagination.tsx`: one control, one a11y contract
  (`<nav aria-label aria-live="polite">` + `aria-disabled`), replacing the two divergent patterns.
- Animate the page change: `ViewTransition key={page}` with directional slide by `direction`,
  crossfade under `share="auto"`, instant under reduced motion.
- Scroll the table head back into view on page change.
- Replace all four call sites: `dashboard/page.tsx`, `assets-screener-page.tsx`, `events/page.tsx`,
  `lst-directory-table-v2.tsx`.
- Unit tests for the hook; a guard test that all four call sites use the shared component.

### Wave 4 — Mobile navigation restructure (the core ask)

- Topbar slims 77px -> 56px on phones; the redundant `SIGN IN ->` text link is removed from the
  header (Account tab and the sheet's "You" section already own it). Driven by `--app-topbar-h`, so
  every dependent offset follows automatically.
- Hamburger drawer becomes a grouped **More sheet**: Search row, then `Analyze` (Compare, Heatmap,
  Loop), `Directory` (LST Directory, Audit), `Trust` (Methodology, Status, FAQ), `You` (Account,
  Alerts, sign in/out). Lucide icons. It no longer repeats the four tab-bar destinations.
- Row entrance stagger, driven by CSS `transition-delay` computed from index on the existing
  `[open]`-attribute selectors, **not** React state (the existing comment explains why: React state
  and the DOM `[open]` attribute land a tick apart).
- `MobileTabBar`: sliding active indicator via framer `layoutId` (the `pill-tabs` idiom) plus a tap
  spring on the icon. Keeps `aria-label="Mobile app navigation"` (asserted in E2E) and keeps
  returning `null` on `/asset/*`.
- `NavV2`'s marketing drawer is rebuilt on a native `<dialog>` to match the app drawer's rigor
  (focus trap, scroll lock, Esc) while keeping its opaque `#141418` background (backdrop-filter
  computes to `none` there; that finding stands).
- `/dashboard` mobile: the two insight cards become one scroll-snap carousel with dots
  (`snap-x snap-mandatory`, `sm:grid` restores the desktop pair), halving the distance to the board.
- E2E `mobile-shell.spec.ts` extended for the new sheet structure and the slimmer header.

### Wave 5 — Motion uplift, desktop and mobile

- Wire the finished-but-unused `useCounterMorph` to the large live numbers (asset hero spread,
  dashboard stat tiles) so values roll instead of jumping.
- Move `.skeleton-sheen` into the shared `Skeleton` / `SkeletonRow` atoms so every loading surface
  shimmers identically instead of two of them.
- Staggered row entrance on first load for the board, the screener and events, reusing the existing
  `useRevealV2({ mode: "load", index })` rather than a new mechanism.
- Extract the copy-pasted card surface into one `cardSurface()` CVA in
  `components/atoms/surface-card.tsx` and replace the 9+ inline copies, giving press feedback a
  single tuning point.

### Wave 6 — PWA and documentation

- `public/site.webmanifest` -> `app/manifest.ts` with `id`, `display_override`, `shortcuts`
  (Dashboard, Assets, Events, Alerts), `screenshots`, `start_url: "/dashboard?source=pwa"`.
- `appleWebApp` metadata (`capable`, `statusBarStyle: "black-translucent"`, `title: "Pegana"`).
- Minimal service worker: precache the shell, fonts and icons; network-only for `/v1/*`; an
  `app/offline/page.tsx` fallback. Registered from a client atom, guarded, with a kill switch.
- Install affordance: `beforeinstallprompt` capture on Chromium; a one-time, dismissible
  "Add to Home Screen" hint inside the More sheet on iOS Safari. Never a nag, never a modal.
- **ADR-0045** recording section 2.
- `ROADMAP.md`: translate the remaining Portuguese sections to English.
- `CLAUDE.md` + `web/AGENTS.md`: add the standing rule that all documentation and code is written in
  English, and document the new systems (breakpoint tokens, `--app-topbar-h`, the view-transition
  shim and its vitest constraint, the pagination primitive).

### Wave 7 — Validation

- `bun run typecheck`, `bun run lint`, `bun run test` (652 unit tests must stay green).
- `bun run test:e2e` plus `IOS_E2E=1` for the iPhone 13 webkit project, which is not part of the
  default run today.
- Push the preview branch; verify live with Playwright at 390, 768 and 1440: zero page-level
  horizontal scroll, axe clean, transitions firing, and reduced-motion producing no movement.
- **Never `git push origin main`.** Web auto-deploys from `main`.

---

## 5. Out of scope (deliberate)

- Retro-translating the historical Portuguese research files under `docs/design-research/` and
  `docs/call-prep-*`. They are an archive. The English-only rule applies going forward and to the
  living documents (`CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, `CONTEXT.md`, `README.md`, `ROADMAP.md`).
- Any native iOS or Android project (section 2).
- Push notifications (Telegram and webhooks already carry alerts).
- Backend, methodology, or schema changes.
