# Mobile + Motion Overhaul — Walkthrough

Branch: `mobile/app-motion-overhaul` · 20 commits · 71 files
Status: **MERGED AND LIVE IN PRODUCTION** (2026-08-11, merge commit `5a40e2a3`).
Spec: [`2026-08-11-mobile-and-motion-overhaul-SPEC.md`](./2026-08-11-mobile-and-motion-overhaul-SPEC.md)
Decision record: [`ADR-0045`](../adr/0045-one-installable-web-app-not-native-clients.md)

---

## 1. What was actually wrong

Measured on production at 390x844 before any change, not inferred.

| # | Defect | Evidence |
|---|---|---|
| 1 | The phone sheet's first four entries were the four bottom-tab destinations | `MOBILE_LINKS` vs `MobileTabBar.ITEMS` |
| 2 | Four navigation affordances in 390px: logo, search, `SIGN IN ->`, burger | measured header |
| 3 | Header measured 77px while every offset in the shell reserved 73px | 4px of content under the chrome on every route |
| 4 | `73px` was a literal in five files that had to agree by hand | layout, 2 banners, topbar prop, mobile-menu default |
| 5 | The board began on the **third** screen | 142px chrome + spread tape + two full-height insight cards |
| 6 | No route transition of any kind | no `template.tsx`, no `loading.tsx`, no `ViewTransition` |
| 7 | Four copy-pasted paginations, diverged five ways | two a11y patterns, two clamping strategies, one missing reset, no URL state, no scroll restoration |
| 8 | Marketing's drawer had no focus trap, scroll lock, Esc, or backdrop dismiss | the app's had all four |
| 9 | PWA was manifest-only, `start_url: "/"` | installed icon opened the marketing landing |
| 10 | Dead code: `app-footer.tsx`, `reveal.tsx`, `use-counter-morph.ts`, `Counter` | zero import sites |

---

## 2. What shipped

**Navigation.** The tab bar owns the four primary destinations; the sheet owns everything else,
grouped Analyze / Directory / Trust / You with icons and a staggered entrance. Header is 56px with
an explicit height, so `--app-topbar-h` is a definition rather than a guess. Marketing's drawer is
deleted and reuses the app's hardened `<dialog>` (`MobileMenu` takes a breakpoint now).

**The bottom bar** (founder-flagged, second pass). It was full-width, welded to the bottom edge,
with a white underline above the active cell. That is the Material idiom; no iOS tab bar has ever
used an underline. It is a floating inset pill now with a capsule behind the active tab, matching
iOS 26 (floating, inset, tint + capsule) and DESIGN.md §3's existing "interactive surfaces are
pills" rule.

**Motion.** Directional route transitions (`nav-forward` / `nav-back` / `nav-lateral`), a
shared-element morph carrying a row's token mark into the asset hero, chrome pinned so only the
page body travels, and animated pagination (`page-next` / `page-prev`). All on the browser's
`document.startViewTransition` — see §4.

**Pagination.** One hook + one control replacing four copies, adding `?page=`, scroll-back to the
table, and one a11y contract.

**PWA.** Typed `app/manifest.ts` opening `/dashboard`, `appleWebApp` metadata, a service worker,
an offline document, and a non-nagging install row. **The worker never caches `/v1/*`** — a cached
peg state is indistinguishable from a live one, which is the exact failure the product exists to
prevent.

**Docs.** ADR-0045, English-only rule, ROADMAP translated, and the new systems documented in
`web/AGENTS.md`.

---

## 3. Bugs found *by* the validation, not before it

These are the ones worth reading. Every one passed typecheck, lint and the unit suite first.

**React `<ViewTransition>` blanked `/dashboard` in the first preview.** Next 16.2.11 accepts
`experimental.viewTransition: true` and its own bundled docs describe the component, but the flag
does not switch to the React build that implements it. Both bundled React builds export the
symbol, so `typeof` feature detection is worthless; only the reconciler differs. React #306, error
boundary, blank page. Rewritten onto the native browser API rather than shipping an experimental
reconciler to a trust product for an animation.

**The service-worker kill switch did nothing.** It lived inside `sw.js`, unregistered, cleared
caches, and navigated open clients — and that navigation reloaded the page, the registrar ran, and
the worker was back in two seconds. A service worker cannot write `localStorage`, so it can never
own a decision that must outlive a reload. Moved to the page.

**A pending transition could resolve on the wrong navigation.** One shared `commitRef` resolved by
*any* pathname or searchParams change, so a `router.replace` on the page you were leaving resolved
a transition that had not committed. Pending transitions are tagged with their target route now.

**Pagination stripped `?page=` before data arrived.** Every consumer renders once with `items=[]`,
so `totalPages` was 1, `current` clamped to 1, and the sync effect deleted a perfectly good
`?page=3`, restoring it a few hundred ms later. Copy the URL in that window and you share page 1.

**The pagination control still had the sr-only twin its own comment claimed to have removed.**
Shipped on all four surfaces. The e2e test could not see it because it asserts through
`getByRole("status")`, which the leftover never matched.

**The sheet's group captions were decoration.** Bare `<p>`s with no association, so the grouping
that is the whole point existed only for sighted users. axe has no rule for it.

**Two styles were never painting.** The tab bar's `shadow-[0_-8px_24px_...]` computed to
`rgba(0,0,0,0) 0 0 0 0`, and `backdrop-blur-md` sat on an opaque background. This repo has hit the
same Tailwind v4 composite-arbitrary-value trap three times now.

**Two latent phone-width bugs on `main`**, both surfaced by running the iPhone WebKit Playwright
project, which had existed behind `IOS_E2E=1` since it was added and had never once been run:
a `scrollable-region-focusable` violation (serious) on `/methodology` and `/agents`, and
`smoke.spec.ts` waiting on a `[data-asset]` hook that only existed on the desktop variant of the
row. Both confirmed pre-existing by reproducing against production before fixing.

**A self-inflicted regression, caught only by the full two-engine run.** Giving the mobile card the
same `data-asset` hook made it the first match in DOM order, so `rows.nth(0).click()` at 1440
waited 45s on an `sm:hidden` element and timed out on both engines. Every board row renders twice
(mobile card + desktop cell), so a bare `[data-asset]` always matches one visible and one hidden
node. All five selectors are `[data-asset]:visible` now. This is the third time on this branch that
a viewport-blind selector has produced a false result, after `page-transitions.spec.ts` picked the
SEO index link and then the hidden mobile card.

---

## 4. Standing traps this branch documents

1. **Never render React's `<ViewTransition>`**, and never set `experimental.viewTransition: true`.
   Guard-tested.
2. **A `view-transition-name` must be unique among rendered elements.** A duplicate makes the
   browser abandon the *entire* transition, silently. Only four files may claim one.
3. **A class is not proof of a style.** Composite Tailwind arbitrary values die in the production
   build. Assert `getComputedStyle` on a deployed page.
4. **The global reduced-motion rule cannot reach `::view-transition-*`** — top-layer
   pseudo-elements are not descendants of anything `html, *, *::before, *::after` matches.
5. **The Vercel preview build is the only real build signal**, because `next dev`/`next build` are
   banned on this machine. It is what caught the React #306.

---

## 5. Verification

| Check | Result |
|---|---|
| `bun run typecheck` | clean |
| `bun run lint` | clean |
| `bun run test` | 1706 passed / 118 files |
| Playwright chromium + webkit-iphone, full suite, serial, vs preview | 233 passed / 1 failed / 4 skipped |
| Playwright, same, **vs PRODUCTION after deploy** | **234 passed / 0 failed / 4 skipped** |
| Lighthouse (preview `/dashboard`) | a11y, performance, CLS all clear their gates |
| `bun audit --prod` | clean |
| Service worker in a real browser | registered, controlling, **zero `/v1` cache entries** |
| Pagination in a real browser | transition fires, `?page=2`, label updates |

The one preview failure was `inner-pages-smoke /dashboard` on webkit, and the production run
settled it: it is gone. `/v1/me` returns **no** `access-control-allow-origin` for a preview origin
while production gets one (verified by header count, not inference), so WebKit surfaced the
rejection as a pageerror. On production the same call is a plain **401** (not signed in), which is
correct and harmless.

Verified live at 390px after deploy: `/dashboard` renders with no React #306, the tab bar is a
floating pill whose shadow actually paints, the header measures 56px against a 56px token, the
service worker is registered with **zero `/v1` cache entries**, there is no horizontal overflow,
and `/site.webmanifest` 307s to `/manifest.webmanifest` so existing installs survive the move.

**Preview-only noise when reading E2E output** (all proven, not assumed): the `/v1/me` CORS above;
Vercel's `vercel.live` feedback iframe tripping our own CSP; and `fullyParallel` making
navigation-driven specs flaky against a remote origin, so run `--workers=1`.

⚠️ **A background Bash command does not inherit a `cd` from an earlier foreground call.** Two
"final full runs" on this branch silently never executed: they started at the repo root, could not
find `playwright.config.ts`, and exited **0** with a grep filter swallowing the error. An empty
output file plus a zero exit code is indistinguishable from a clean pass. Always `cd` inline, and
read the output rather than trusting the exit code.

---

## 6. Not done

- `next build` never ran locally. Banned on this machine; the preview build is the substitute.
- The animations were verified to *fire* (instrumented `startViewTransition`, computed styles,
  unique morph names). They were not reviewed frame by frame for taste.
- Merging. This branch has never been pushed to `main`, and `main` deploys to production.
