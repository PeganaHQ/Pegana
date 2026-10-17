# Web Premium Redesign — Design Spec

**Date:** 2026-08-05
**Status:** Approved (Approach C — batched evolution with visual QA gates)
**Scope:** All web frontend improvements (Quick Wins QW1-6, Medium Effort ME7-10+12, Visualizations V1-6) **excluding** ME11 (risk-flag nomenclature expansion — Rust backend) and the statistical calibration gauge (requires backend data not yet available). Plus: asset detail page redesign, 404 premium elevation, and broken-design fixes identified in the visual audit.

---

## 1. Audit Findings — What's Broken

### Critical (must fix)
1. **Asset detail (STKESOL) mobile** — information extremely compressed, tiny text, weak visual hierarchy, chart unreadable at 390px, page 5,215px tall with no progressive disclosure, low-contrast metadata
2. **Asset detail desktop** — faint chart lines/labels, significant unused card space, right-side state card detached from summary, exit-liquidity graph nearly empty until final segment, loop-impact visually buried
3. **Dashboard onboarding modal** — blocks entire dashboard on first visit, mobile modal extremely tall, mobile step nav overflows horizontally
4. **Events mobile** — severity filter clips at right edge (CRITICAL option partially hidden), 52-week heatmap horizontally compressed, page 30,796px tall on mobile
5. **Fixed bottom tab bar** — covers content on heatmap, compare, and events pages (no bottom padding compensation)
6. **404 page** — visually polished but underwhelming for "premium" bar; desktop has excessive empty space, nav disproportionately large on mobile vs error content

### Moderate (should fix)
7. **Homepage** — "V1 IS LIVE" announcement overlaps live peg-board preview; mobile hero very tall before product preview
8. **Compare empty state** — chart preview so faint it looks disabled; contrast extremely low
9. **LST directory mobile** — 244-row page 18,746px tall, table requires horizontal scroll, stats card asymmetric
10. **FAQ/About mobile** — typography oversized, dense blocks, few answers per viewport, needs sectioning/subheadings

### Minor (nice to fix)
11. **Console 401 errors** on dashboard/assets/events — likely unauthenticated session requests (expected but noisy)
12. **Resource 404s** on STKESOL and LST — likely missing token images or API requests

---

## 2. Design Principles

All work follows the existing DESIGN.md V5 system:
- **Colors:** canvas `#0a0a0b`, surface-1 `#121214`, surface-2 `#17171a`, hairline `rgba(255,255,255,.08)`, text `#f5f5f6`, muted `#a3a3ad`
- **State colors:** pegged `#5fd3a0`, drift `#e2a651`, depeg `#e87089`, critical `#e0574e`, unknown `#8f8aa3`
- **Typography:** Switzer (display/body), Geist Mono (technical/numbers), tabular-nums for all financial figures
- **Iridescent gradient:** rationed to 5 moments per page max
- **Shapes:** pills for interactive, 14-22px radius for containers, hairline borders
- **Tables:** real semantic `<table>` for all data surfaces (AGENTS.md rule)
- **No em-dashes** in visible copy; middle-dot max 1 per line

### Mobile-first principles for this redesign:
- Minimum touch target 44px
- Minimum readable text 13px (12px for labels/captions)
- Progressive disclosure — collapse advanced sections on mobile
- Charts simplified or given mobile-specific presentation
- No horizontal page scroll (`document.documentElement.scrollWidth === clientWidth` at 390px)

---

## 3. Batch Plan

### Batch A — Foundations & Mobile Fixes
**Goal:** Fix the structural breakages that affect every page.

#### A1. Fixed bottom tab bar — content compensation
- **Problem:** `<MobileTabBar>` (fixed, 76px tall) overlaps content on heatmap, compare, events
- **Fix:** Ensure all `(app)` pages have `pb-[calc(4.75rem+env(safe-area-inset-bottom))]` on their content containers (dashboard already does this at layout level, but individual pages need it too when they don't go through the default flow)
- **File:** `web/app/(app)/layout.tsx` — verify the padding is globally applied; if not, add it to heatmap, compare, events page containers

#### A2. Events mobile filter — fix clipping
- **Problem:** Severity `FilterPillGroup` clips CRITICAL option at right edge
- **Fix:** Add `flex-wrap` or `overflow-x-auto` with proper `-mx` padding to the mobile filter container in events page
- **File:** `web/app/(app)/events/page.tsx` — mobile filter section

#### A3. Onboarding modal — make dismissible & less dominant
- **Problem:** First-visit modal blocks entire dashboard, extremely tall on mobile
- **Fix:** 
  - Reduce mobile modal to max-h-[80dvh] with internal scroll
  - Add visible skip/dismiss that doesn't require completing all steps
  - Store dismissal in localStorage so it doesn't reappear
  - Consider a "Preview dashboard" escape route
- **File:** `web/components/organisms/onboarding-modal.tsx`

#### A4. Compare empty state — fix visibility
- **Problem:** Chart preview so faint it looks disabled
- **Fix:** Increase placeholder contrast from `bg-text/[0.015]` to `bg-text/[0.04]`; add a subtle dashed border; make the "Add asset" CTA more prominent
- **File:** `web/app/(app)/compare/page.tsx`

#### A5. Homepage announcement overlap
- **Problem:** "V1 IS LIVE" banner overlaps live peg-board preview
- **Fix:** Give the announcement bar proper height and push content below it (not position:absolute overlay)
- **File:** `web/components/molecules/calibration-banner.tsx` or the homepage page

---

### Batch B — Asset Detail Page Redesign
**Goal:** Transform the broken, compressed STKESOL page into a premium, readable, progressive-disclosure experience.

#### B1. Mobile asset detail — structural restructure
**Current:** 
- 2-column grid `lg:grid-cols-[minmax(0,1fr)_340px]` collapses to single column on mobile
- Hero card has massive spread number (104px) eating most of the fold
- Right rail stacks directly under hero on mobile, duplicating state + spread info
- Chart crammed at 390px with tiny axis labels
- All tab content in one continuous 5,200px scroll

**Redesign:**
- **Above-fold (mobile):** Compact hero — spread number reduces from 104px to `text-[64px]` on mobile. Identity row reflows. State pill + risk score badge inline. Rail's duplicate "Live state" block hidden on mobile (already is). Rail's "Proximity to depeg" gauge kept (new info). CTAs collapse to a single sticky bottom bar (already exists).
- **Chart card:** Increase chart container border/contrast. Add `overflow-hidden` + `rounded-[16px]` wrapper with min-height 280px on mobile. Chart controls wrap with `flex-wrap gap-2`. Axis label font-size minimum 10px.
- **Tab content:** Each tab panel section gets `rounded-[16px] border border-hairline bg-surface-1 p-4 sm:p-5` card treatment (currently sections are unboxed, blending together). Add hairline separators between sections on mobile. Collapse advanced sections (exit liquidity route table, peer comparison table) behind `<details>` on mobile.
- **SEO section:** Restyle from raw `border-t border-hairline px-5 py-14` to a proper card with surface-1 background, matching the premium look. Add a subtle iridescent accent on the heading.

**Files:**
- `web/components/organisms/asset-hero-v2.tsx` — mobile size reductions
- `web/components/organisms/asset-rail.tsx` — mobile rail hides duplicates
- `web/app/(app)/asset/[symbol]/asset-page-client.tsx` — tab panel section card treatment
- `web/app/(app)/asset/[symbol]/asset-seo-section.tsx` — premium restyle

#### B2. Desktop asset detail — density & hierarchy improvements
**Current:**
- Faint chart lines/labels
- Right state card detached
- Exit-liquidity graph nearly empty
- Loop-impact buried

**Redesign:**
- **Chart card:** Increase axis/grid line opacity from `rgba(255,255,255,.07)` to `rgba(255,255,255,.10)` within the chart card. Add a subtle gradient background to the chart container.
- **Hero card:** Better internal padding distribution — reduce unused space in identity area, increase spread number container density.
- **Rail:** Move "Quick links" higher (above Health · 24h) — actionable content should precede passive stats. Add a subtle accent line at the top of the rail card.
- **Exit liquidity:** Add a "No recent exit data" honest empty state when the graph is empty (don't render an almost-empty visualization).
- **Systemic impact:** Promote with a distinct visual treatment — give it a surface-2 background to differentiate from exit-liquidity.
- **SEO section:** Same premium restyle as mobile.

**Files:**
- `web/components/organisms/asset-chart.tsx` or chart wrapper — grid opacity
- `web/components/organisms/asset-hero-v2.tsx` — padding redistribution
- `web/components/organisms/asset-rail.tsx` — section reordering
- `web/components/organisms/exit-liquidity.tsx` — empty state
- `web/components/organisms/systemic-impact.tsx` — surface-2 treatment

#### B3. Asset SEO section — premium restyle
**Current:** Plain `border-t border-hairline px-5 py-14` — reads as a raw, unstyled appendage.
**Redesign:**
- Wrap in `rounded-[20px] border border-hairline bg-surface-1` card with `p-6 sm:p-8`
- Add iridescent accent line (1px gradient top-border) — uses the rationed gradient
- h2 gets a small `font-mono` eyebrow above it: "PEG RISK BRIEF"
- Body text gets `leading-[1.7]` and slightly larger size `text-[16px]` for readability
- Inner h3s get a left-border accent (2px, state-colored)
- Links get the existing dotted-underline treatment but with state color
- Add a "Last verified" timestamp footer with a pip

**File:** `web/app/(app)/asset/[symbol]/asset-seo-section.tsx`

---

### Batch C — Dashboard & Nav Polish
**Goal:** Polish the dashboard and navigation to premium quality.

#### C1. Dashboard board row — micro-interactions
- Add hover state: row gets `bg-surface-2/50` on hover (desktop)
- Velocity arrow gets a subtle pulse animation on tick change
- Risk mini-gauge gets a tooltip on hover showing the exact score

#### C2. Dashboard topbar — nav consistency
- Verify all nav links resolve correctly (the "More" dropdown from QW6)
- Ensure `/systemic` is properly linked in the nav (it's the "Loop" page — confirm the nav label is clear)
- Mobile nav: ensure all 10 items in MOBILE_LINKS are reachable without horizontal scroll

#### C3. Spread tape — visual polish
- Ensure the marquee doesn't cause horizontal overflow at 390px
- Add a subtle pause-on-hover for desktop
- Verify mask-image fades work in production builds

**Files:**
- `web/components/organisms/dashboard-board-row.tsx`
- `web/components/organisms/dashboard-topbar.tsx`
- `web/components/organisms/spread-tape.tsx`

---

### Batch D — Events, Compare, Heatmap Polish
**Goal:** Fix remaining broken pages.

#### D1. Events page — timeline & filters
- Fix mobile filter clipping (from A2)
- Wrap each time-bucket section in a card treatment for visual hierarchy
- 52-week heatmap: make it horizontally scrollable on mobile instead of compressed
- Off-peg scoreboard: ensure 4-card grid wraps properly on mobile (2x2 or stacked)

#### D2. Compare page — empty state & chart
- Fix empty-state contrast (from A4)
- Chart card gets proper border + surface treatment
- Preset buttons get hover states
- Add asset count indicator ("3 of 4 assets")

#### D3. Heatmap page — mobile density
- Reduce intro text height on mobile
- Use 2 columns instead of 4 on small mobile (320-390px), 4 on 414px+
- Ensure bottom tab bar doesn't cover last row
- Add "Tap to view asset" affordance

**Files:**
- `web/app/(app)/events/page.tsx`
- `web/app/(app)/compare/page.tsx`
- `web/app/(app)/heatmap/page.tsx`

---

### Batch E — 404 & Error Pages Premium Elevation
**Goal:** Elevate the 404 to a memorable, premium experience.

#### E1. 404 page redesign
**Current:** ErrorSurfaceV2 with drift-line SVG, eyebrow, headline, sub, CTAs. Polished but underwhelming.

**Redesign — "Signal Lost" concept:**
- **Hero:** Replace the small drift-line SVG with a larger, full-width ambient visualization — a radar/signal sweep motif using the iridescent gradient. A pulsing dot at the center (state-colored) with expanding concentric rings fading outward. Represents "we can't find this signal/page."
- **Layout:** Center everything vertically. On desktop, the content occupies the center 640px column with generous whitespace. On mobile, reduce the nav to a minimal wordmark only (the full NavV2 is too heavy for an error page).
- **Typography:** Headline increases from `clamp(30px,4.6vw,46px)` to `clamp(34px,5vw,52px)`. Add an animated counter "404" in Geist Mono at 120px with `opacity-10` as a background watermark element.
- **Content:** Keep the existing copy but restructure:
  - Eyebrow: "SIGNAL LOST" (mono, 11px)
  - Headline: "This frequency isn't on the peg board."
  - Sub: "The feed is live. Read it over REST, WebSocket, MCP, webhooks, or Telegram."
  - Add a "Live assets" quick-pick strip below CTAs — 4 asset links (USDC, jitoSOL, USDe, INF) as pills, so the 404 page is a launchpad, not a dead end.
- **Background:** Subtle grain texture (already exists), plus a radial gradient glow from the center using the unknown state color at very low opacity.
- **CTAs:** Keep primary (Back to home) and secondary (Open dashboard), but style them larger with more padding. Add a third ghost link: "Search assets" (links to /assets).

**File:** `web/components/organisms/v2/error-surface-v2.tsx`, `web/app/not-found.tsx`

#### E2. 500 error page alignment
- Apply the same premium treatment to `app/error.tsx` using the "critical" state color
- The radar motif uses red/critical tones instead of unknown gray

**File:** `web/app/error.tsx`

---

### Batch F — Final QA & Regression
**Goal:** Comprehensive visual QA across all pages.

#### F1. Playwright visual regression
- Screenshot every page at desktop (1440x900) and mobile (390x844)
- Compare against pre-fix screenshots
- Verify no horizontal scroll at 390px
- Verify no console 401/404 errors (or document expected ones)
- Verify all nav links resolve
- Verify onboarding modal is dismissible

#### F2. Cross-page consistency check
- All pages use consistent card treatment (rounded-[20px], surface-1, hairline border)
- All pages have proper bottom padding for mobile tab bar
- All tables are semantic `<table>` (AGENTS.md rule)
- No em-dashes in visible copy
- Max 2 eyebrows per page
- Iridescent gradient appears in max 5 moments per page

#### F3. Final test suite
- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run test` (vitest) — all pass
- `PLAYWRIGHT_BASE_URL=https://www.pegana.xyz PLAYWRIGHT_EXTERNAL_TARGET=1 npx playwright test` — all pass

---

## 4. Items Already Completed (reference)

These items from the original list are already implemented and deployed. They will be verified in Batch F but not re-implemented:

| Item | What was done |
|---|---|
| QW1 | Risk score mini-gauge in board rows |
| QW2 | Asset-class filter via PillTabs |
| QW4 | /faq and /about in footer |
| QW5 | Velocity arrows next to spread |
| QW6 | "More" dropdown in desktop nav |
| ME7 | Sources bento grid redesign |
| ME8 | Composite risk score badge in asset hero |
| ME9 | Footer 3-column layout |
| ME10 | Dashboard empty state with radar rings |
| ME12 | Off-peg scoreboard on /events |
| V1 | Risk heatmap at /heatmap |
| V2 | Live spread tape ticker |
| V3 | MechanismFlow (pre-existing) |
| V4 | Compare chart Absolute/Normalized toggle |
| V5 | Event counts per time bucket |
| V6 | CalibrationGauge in board rows |

## 5. Items Excluded

| Item | Reason |
|---|---|
| QW3 | "Loop" nav label — retained, clear enough |
| ME11 | Risk-flag nomenclature — touches Rust methodology crate, deferred |
| Statistical calibration gauge | Requires backend data (days of history, transitions observed, p95 band) not yet available |
