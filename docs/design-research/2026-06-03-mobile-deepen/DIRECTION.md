# Mobile Redesign — Dashboard + Asset-Detail

**Date:** 2026-06-03
**Surface:** the signed-in app below the `lg` breakpoint (1024px), phone target ~390–430px — `/dashboard`, `/asset/[symbol]`, `/assets`, and the global app shell (topbar / menu / banners).
**Inputs reconciled:** 18-site reference research; 5 current-state mobile audits (dashboard, asset-detail, screener, primitives, app-shell); backend audit of `crates/api-rs`; the 25 still-unbuilt items of the 06-02 dashboard+assets-deepen backlog; the 06-03 backend-serializer SPEC.
**Brand constraints (hard):** pure-black canvas; editorial crypto-SaaS (Phantom / Base / Helius / NEAR peers); exactly Geist sans + JetBrains Mono, mono scoped to numbers/captions/technical labels; no italic/serif; no terminal/CLI/Bloomberg/CRT/scanline/ASCII aesthetic; sharp geometry (0px radius on containers/cards, rounded-full reserved for CTAs); single iridescent gradient `#feed7a → #ff8400 → #df91f7` as sparing ammunition, never decoration; ease-only motion (no springs); responsive padding `px-5 sm:px-8 lg:px-12 xl:px-20`; peg-state palette st-pegged / st-drift / st-depeg / st-critical.

---

## 1. Design direction

The current mobile app is a desktop layout that reflowed, not a phone product that was designed. The dashboard opens with ~360–400px of stacked control chrome (eyebrow + title + engine strip + search + three filter rows) — a full viewport of config panel — all rendered in 9–11px uppercase mono with tracking, which is exactly the Bloomberg/terminal register the brand forbids and which destroys hierarchy. Asset-detail dumps a 340px desktop sidebar inline as a full-width mono wall, floats an 80px hero number that overflows 358px of content width, and loses the symbol/state/price the instant you scroll. The shell has zero `env(safe-area-inset-*)` anywhere, no `viewport-fit=cover`, a global `*:focus-visible{outline:none}` (WCAG 2.4.7 fail), a hamburger-only nav burying four destinations in the worst thumb zone, and a "menu" that is not a dialog and slams shut on any scroll gesture.

The redesign is **answer-first, control-second, editorial throughout.** Both screens lead with the single quantitative truth the user came for — *is anything wrong right now?* on the dashboard, *how pegged is this, right now?* on asset-detail — rendered as one oversized anchor (the uncut.wtf size-only-hierarchy discipline: one big JetBrains Mono numeral, peg-state colored, everything else dropped several steps smaller in Geist sans). Controls collapse from five stacked blocks into **one segmented view-switcher inline with search, plus a single "Filters" pill that opens a bottom sheet** (the Mobbin / Spotify-Library 2026 pattern). The asset list becomes a true **table→card transform** (component.gallery responsive rule): each row stacks symbol + signed-colored spread + a full-width BandGauge + an inline sparkline + a recessive one-line caption (siteinspire caption discipline). Asset-detail gets a **collapsing large-title hero** that condenses on scroll into a slim sticky bar (Mobbin large-title rule) carrying symbol + live spread + state dot, so the answer never scrolls away; its dense rail collapses into a small **data bento** (rebrand.gallery, one dominant tile + a swipe row of metric tiles) and its chart gains **horizontal scrub** (60fps / Apple-Stocks / Robinhood — the single highest-value fintech interaction). A persistent **bottom tab bar** (navbar.gallery, 4–5 destinations, ~30% feature-discovery lift over a hamburger) replaces the top-right hamburger as primary nav. Motion is the Wise lineage only: number-scale-on-tick, shared-element list→detail morph, ease-only, ≤400ms, one job per animation, frozen under reduced-motion. The iridescent gradient appears exactly once per screen — bounded inside one CTA pill or one active-tab underline (coolshap.es bounded-fill rule) — never as a wash. Surfaces stay opaque pure-black (Mobbin finance-density rule: no frosted glass over data). The net feeling: a calm, type-led, glanceable risk instrument you open during a depeg, not a config rack you tolerate.

---

## 2. Strongest reference patterns (condensed)

| Pattern | Source site | Mobile application in Pegana | Brand rule it serves |
|---|---|---|---|
| Segmented control = in-place presentation switch (instant); tabs = view nav | mobbin.com | Dashboard view switch (All/Drifting/Depeg) + asset-detail chart range (1H/24H/7D/30D) are segmented; Overview/Mechanism/Risk are tabs | Sharp 0px segments; selected by value-contrast not hue (AA) |
| Filters live in a bottom sheet opened from one pill; top filters as a chip row | mobbin.com / logggos.club | One "Filters" pill → bottom sheet of toggle rows; peg-state chips with counts pinned under search | Opaque pure-black sheet (no frosted glass); 0px sheet container |
| Large-title top bar that collapses to a compact sticky header on scroll | mobbin.com | Asset-detail hero collapses to sticky bar (symbol + live spread + state dot); dashboard title condenses keeping search+filter | Keeps the answer on screen; ease-only collapse |
| Sticky bottom action, thumb-reachable, single primary | mobbin.com / cta.gallery | Asset-detail "Set peg alert" docks as a fixed bottom pill after the hero scrolls out | rounded-full CTA only; gradient on this one element |
| Opaque high-contrast surfaces for dense data, ≤5 tab-bar items | mobbin.com / navbar.gallery | Solid black cards + bottom tab bar capped at Dashboard/Assets/Events/Account | No translucency over numbers; no center FAB |
| Chart scrubbing → header readout follows the finger | 60fps.design (Apple Stocks / Robinhood) | Asset-detail chart: drag updates the sticky readout to price/deviation at that timestamp, snaps peg-state color | Highest-value mobile interaction; ease-only, no crosshair kitsch |
| Skeleton/shimmer for >2s loads; suppress loaders <300ms; spinners only on button actions | 60fps.design | Dashboard list + asset-detail first paint render skeleton cards matching final layout; nothing on <300ms refetch | One job per motion; calm |
| Number-scale-on-change for live ticks | appmotion.design (Wise) | Hero price + list NAV cells subtle scale+ease (200–300ms) on WS tick, paired with state color | Ease-only, never springy; signal not decoration |
| Shared-element morph list→detail | appmotion.design / 60fps | Tapped row's symbol+spread+state-dot morphs into the detail hero (~300–400ms ease) | Spatial continuity, ease-only |
| Count-annotated facet chips | landing.love / logggos.club / curated.design | Peg-state chips show live counts ("Drift 3 / Depeg 1 / Pegged 18") — filter row doubles as portfolio-health summary | st-* tokens; mono on the count only |
| Table→card transform on mobile (key fields only, tap-through for the rest) | component.gallery / saaspo.com | Dashboard + screener rows become stacked cards; deep columns move to asset-detail | 0px cards; no frozen-column spreadsheet (anti-Bloomberg) |
| Strict badge (static status) vs chip (interactive filter) semantics | component.gallery | Peg-state + Δ are sharp 0px **badges** (no ×); removable chips only for active filters | rounded-full stays CTA-only; badges are sharp |
| Bottom tab bar as primary nav (4–5), hamburger for secondary only | navbar.gallery | Fixed bottom nav Dashboard/Assets/Events/Account; overflow (theme, status, sign-out, search) behind one entry | line icons + mono labels on black; gradient underline sparingly |
| Empty-state taxonomy: first-use / no-results / no-data / error, each with a next action | component.gallery | Four real states: filter-empty (reset), calibration-window (link to /status), WS-disconnected (reconnect), backend-down (retry) | Editorial mono caption + one CTA, no mascot/ASCII art |
| One-typeface size-only hierarchy; oversized anchor | uncut.wtf | Hero peg value as the single oversized JetBrains Mono anchor; metadata several steps smaller in Geist | Geist+JetBrains only; no weight-soup |
| Data bento: one dominant tile + small metric tiles | rebrand.gallery | Asset-detail rail → bento: big peg tile + swipe row of (worst-24h / NAV vs market / confidence / jitter) | DATA tiles not imagery; one live tile only |
| Sparkline/preview as the at-a-glance signal; one tap-target per row | landing.love | series_24h sparkline is the row's dominant visual + hero's secondary read; single tap to detail | mono caption under; no secondary row buttons |
| Very-slow data-tinted ambient field behind hero (≤0.1–0.2× time, ≤low alpha) | shadergpt.14islands.com | Optional barely-moving field behind the hero number, tinted only by the active peg-state token | gradient/token as only color; freeze on reduced-motion |
| Bounded gradient (fill of one shape/CTA), never full-bleed | coolshap.es | Iridescent gradient = fill of the single CTA pill OR the one active-tab underline, per screen | "sparing ammunition" rule, literal |
| Single sharp stroke-icon system at 20–24px, strokeWidth ≥1.5 on black, Sharp variant | hugeicons.com | One `<Icon>` primitive (size 20 rows / 24 hero), Sharp corners, currentColor adopts peg state | 0px geometry; monochrome, gradient is the only color |
| Momentum/virtualization with a scroll-velocity flag; ease/decay (no spring) | thiings.co | Windowed list when the screener grows; dim per-row sparkline while flinging, restore at rest | ease-only decay, deterministic order |

---

## 3. Per-surface audit findings (condensed)

### Dashboard mobile (`web/app/(app)/dashboard/page.tsx`, the `lg:hidden` block ~362–497)
- **P0** `mob-chrome-stack` — five stacked control blocks push the first asset a full viewport below the fold. Collapse to one segmented view switcher inline with search + a "Filters" bottom-sheet pill; target ≤~140px header.
- **P0** `mob-no-hero-signal` — leads with an 18px "N tracked" footnote; no portfolio risk hero. Replace with a state-colored headline driven by `editorial.drifting/depegged` (the counts desktop computes and mobile throws away).
- **P1** `mob-engine-nthchild-hides-freshness` / `efs-nth-child-hack` — fragile `[&>span:nth-child(3)]:hidden` strips the "updated Ns ago" heartbeat-age and breaks on reorder. Add a `compact` prop to `EngineFlowStrip` that drops the shimmer bar, keeps the age label.
- **P1** `mob-engine-overflow` — hardcoded `w-[120px]` shimmer bar can overflow at 390px (clipped by parent `overflow-hidden`). Make the bar `flex-1 max-w-[80px]` or hide under `compact`.
- **P1** `mob-sort-no-scroll-overflow` — Sort pill row is plain `flex gap-2`, no `overflow-x-auto`; fold into the bottom sheet (preferred) or match the scrollable strip treatment.
- **P1** `mob-no-dvh-safe-area` — `<main>` has no `min-h-dvh` and no `pb-[env(safe-area-inset-bottom)]`.
- **P2** `mob-caption-contrast` — 9–10px `text-caption` (#9a9a9a) on `#000` ≈ 4.46:1, under AA. Bump token to ~#a3a3a3 (~4.9:1) or use `text-muted`.
- **P2** `mob-uniform-mono-no-hierarchy` — wall-to-wall 9–11px uppercase mono. Drop the eyebrow labels; pill labels become Geist sentence-case; mono reserved for spread + % gauge.
- **P2** `mob-class-chip-tap-target` — 8px class label is near-illegible and the only class indicator; raise to 10px, ensure name carries class context.
- **P3** `mob-search-clear-target` — clear button 36px (h-9 w-9), under 44px.
- **P3** `mob-recovered-dead-filter` — "Recovered" view hardcoded to count 0, no branch; remove the dead entry.
- **Keep:** MobileAssetRow (76px tappable Link, symbol+spread+state+name+BandGauge), the static reduced-motion-safe BandGauge, worst-first default sort, zero-count filter hiding, 44px search input, distinct backend-down vs empty states, `spreadTextClass(state)` coloring, rounded-full only on pills.

### Asset detail (`/asset/[symbol]`, below lg)
- **P0** `no-sticky-mobile-header` — symbol/state/spread vanish below the fold. Add a `lg:hidden sticky top-0` bar (symbol + state pip + live spread) revealed after the hero scrolls out, with safe-area top.
- **P0** `hero-spread-overflow-80px` — `text-[80px]` mono overflows ~358px. Use `text-[clamp(48px,16vw,80px)] sm:text-[104px]` + `max-w-full overflow-hidden`.
- **P0** `rail-no-collapse-on-mobile` — full 340px sidebar dumps inline (and duplicates the hero spread). Hide the rail "Live state" block on mobile, collapse Health/Quick-links into `<details>` or tabs, keep only the two CTAs inline → bento.
- **P0** `chart-segmented-buttons-tiny-touch` — 8 controls in two ~24px rows. Bump to `min-h-[44px]` on mobile; collapse view-mode row into one control or hide below sm.
- **P1** `tabs-overflow-no-affordance` — five gap-5 tabs clip "Identity" with no scroll cue. Add right-edge fade mask + `snap-x` + `px-5` inset.
- **P1** `missing-safe-area-top` — StaleBanner/breadcrumb collide with notch.
- **P1** `chart-not-full-bleed-double-padding` — nested px-5 wastes width; let chart go `-mx-5` edge-to-edge on mobile.
- **P2** `expand-close-buttons-40px`, `rail-cta-buttons-mono-uppercase-density`, `stale-banner-flex-wrap-stack`, `hero-driftfloor-meta-overflow`.
- **P3** `tabpanel-bottom-pad-no-safe-area`, `overview-chart-duplicate-heading`, `chart-threshold-hardcoded-axislabels`.
- **Keep:** dynamic `ssr:false` chart import with fixed-height skeleton, fixed-px chart heights (no 100vh bug), ExpandShell `inset-3`, full WAI-ARIA tabs wiring, tokenized peg-state palette with AA `*-text` variants, JetBrains-Mono-scoped numbers, sharp geometry, single gradient underline, StaleBanner-first with Retry, `formatUsdValue`/`isPlausibleDiscount` guards.

### Screener `/assets` (below lg)
- **P0** `mob-screener-columns-hidden` — all 5 risk columns (band, jitter, safety, sparkline, state) are `hidden sm:*`; phone gets a price ticker, not a screener. Branch a `block sm:hidden` card: pip+symbol+signed-colored spread / full-width BandGauge / inline Sparkline + worst-24h — all from inline `series_24h`, zero new data.
- **P1** `mob-worst-24h-missing` — compute worst-24h from inline series (same one-liner asset-rail uses); render on the card (and as a desktop column for parity).
- **P1** `mob-sort-unreachable-silent-reorder` — mobile can only sort by Spread, yet `?sort=band/jitter/safety` silently reorders by an invisible signal. Add a sm:hidden sort control + a visible "Sorted by →" label.
- **P1** `mob-touch-targets-under-44` — pills ~28px, search 32px.
- **P1** `mob-safe-area-missing` — no `viewportFit:'cover'`, content under notch/home-indicator.
- **P2** `mob-no-watchlist-tab`, `mob-state-caption-low-contrast`, `mob-no-compare-multiselect`.
- **P3** `mob-ai-prompt-strip-worst-offender`, `mob-100vh-not-dvh`, `mob-fragile-grid-template-coupling`.

### Shared primitives + nav
- **P0** `mm-no-search` — no global asset search anywhere in mobile chrome (Cmd-K + topbar Search are desktop-only). Add a search affordance in the sheet + a sm icon button calling `openCommandPalette()`.
- **P0** `mm-not-a-dialog` — no `role=dialog`/`aria-modal`, no focus trap/move/restore.
- **P0** `mm-gesture-autoclose` — sheet closes on any touchmove/wheel/pointermove; remove those listeners (body scroll is already locked).
- **P1** `mm-missing-routes` — sheet omits `/assets` + `/status`.
- **P1** `mm-no-safe-area`, `topbar-search-hidden-no-fallback`, `efs-reconnect-color-deadbranch` (reconnecting == degraded amber; make feed-down rose), `efs-nth-child-hack`.
- **P2** `efs-9px-mono`, `topbar-no-safe-area-top`, `pip-touch-target`, `bandgauge-faint-aria` (1.5px hairline, aria-hidden, tooltip-only), `sparkline-distortion` (`preserveAspectRatio=none` lies about slope; add `vector-effect=non-scaling-stroke`, strokeWidth 2).
- **P3** `bandgauge-rounded-full-brand` (track uses rounded-full — brand reserves for CTAs).
- **Keep:** body scroll-lock pattern, ≥44px menu links/CTA, dvh panel max-height, MobileAssetRow, reduced-motion guard, mono scoping, single-source state-color system, sparkline single-pass min/max + inline-series preference, real-heartbeat-age liveness.

### App shell / global chrome
- **P0** `shell-no-viewport-fit-cover` — `viewport` export omits `viewport-fit:'cover'`; insets resolve to 0.
- **P0** `shell-no-safe-area-insets` — zero `env(safe-area-inset-*)` in the whole codebase; banner under notch, footer under home-indicator in standalone PWA.
- **P0** `shell-focus-visible-killed-globally` — `*:focus-visible{outline:none!important}` strips every focus ring (WCAG 2.4.7).
- **P1** `shell-signin-hidden-below-sm` — signed-out users have no Sign-in affordance below 640px.
- **P1** `shell-no-bottom-nav` — hamburger-only buries 4 destinations in the worst thumb zone.
- **P1** `shell-menu-panel-hardcoded-top` — `top-[73px]` mis-anchors when Health/WsBanner is visible.
- **P1** `shell-100vh-not-dvh` — events/account layouts use 100vh.
- **P2** `shell-hamburger-under-44`, `shell-clear-filter-under-44`, `shell-banner-overflow-narrow`.
- **P3** `shell-nth-child-hides-engine-strip`, `shell-page-padding-px5-only` (no `sm:px-8` ramp).

---

## 4. Batched implementation plan

Ordering: **Batch 0** zero-risk shell/a11y/safe-area fixes; **Batch 1** quick visual wins (hero signal, hierarchy, gradient discipline) that need no structural rewrite; **Batch 2** structural redesign (collapsing nav, bottom sheet, table→card, bottom tab bar, sticky hero, bento, chart scrub); **Batch 3** backend-dependent (per-asset thresholds, worst/jitter, NAV decomposition, incidents). Within each batch, items are deduped across the mobile audit, the unbuilt 06-02 backlog, and the backend SPEC.

### Batch 0 — Shell, a11y, safe-area (no visual redesign, ship first)
| id | surface | what | files |
|---|---|---|---|
| B0-viewport-fit | shell | Add `viewport-fit:'cover'` to the `viewport` export | `web/app/layout.tsx` |
| B0-safe-area | shell | Add base safe-area body padding + apply to footer (`pb-[calc(1rem+env(safe-area-inset-bottom))]`), HealthBanner (`pt-env(...top)`), dashboard/asset/screener `<main>` | `web/app/globals.css`, `web/components/molecules/health-banner.tsx`, `web/app/(app)/dashboard/page.tsx`, `web/app/(app)/asset/[symbol]/page.tsx`, `web/app/(app)/assets/page.tsx` |
| B0-focus-ring | shell | Delete/scope the global `*:focus-visible{outline:none}`; add real `:focus-visible{outline:2px solid var(--color-text);offset:2px}` | `web/app/globals.css` |
| B0-dvh | shell | Swap `100vh`→`100dvh`/`min-h-dvh` in events, account layout, app-shell wrapper, screener suspense fallback | `web/app/(app)/events/page.tsx`, `web/app/(app)/account/layout.tsx`, `web/app/(app)/layout.tsx`, `web/app/(app)/assets/page.tsx` |
| B0-menu-dialog | shell | `role=dialog`/`aria-modal`, focus move-on-open + restore-on-close, trap Tab, mark siblings inert | `web/components/molecules/mobile-menu.tsx` |
| B0-menu-gesture | shell | Remove touchmove/wheel/pointermove auto-close listeners (keep scrim-click, Esc, link-tap, hamburger) | `web/components/molecules/mobile-menu.tsx` |
| B0-menu-search | shell | Add a full-width search button as first sheet item calling `openCommandPalette()`; add sm icon search button in topbar | `web/components/molecules/mobile-menu.tsx`, `web/components/organisms/dashboard-topbar.tsx` |
| B0-menu-routes | shell | Add `/assets` + `/status` to `MOBILE_LINKS`; add safe-area-bottom to sheet CTA | `web/components/organisms/dashboard-topbar.tsx`, `web/components/molecules/mobile-menu.tsx` |
| B0-signin-mobile | shell | Remove `hidden sm:inline-flex` gate so Sign-in shows below sm at 44px | `web/components/molecules/account-menu.tsx` |
| B0-efs-compact | primitives | `compact` prop on EngineFlowStrip (drop shimmer bar, keep "updated Ns ago"); replace nth-child hack | `web/components/atoms/engine-flow-strip.tsx`, `web/app/(app)/dashboard/page.tsx` |
| B0-efs-feeddown | primitives | Fix reconnecting/degraded dead branch — feed-down → `st-depeg` rose, distinct from slow amber | `web/components/atoms/engine-flow-strip.tsx` |
| B0-touch-44 | primitives | Bump under-44px targets: hamburger h-11, clear-search h-11, filter/sort pills h-11, chart expand/close h-11 | `web/components/molecules/mobile-menu.tsx`, `web/app/(app)/dashboard/page.tsx`, `web/components/organisms/tv-chart/expand-shell.tsx` |
| B0-bandgauge-a11y | primitives | h-2 track on mobile, value 11px, `aria-label` "X% to depeg" (tooltip is touch-unreachable); track `rounded-none` | `web/components/atoms/band-gauge.tsx` |
| B0-sparkline-fix | primitives | `vector-effect=non-scaling-stroke` + strokeWidth 2 so slope isn't distorted/invisible | `web/components/atoms/sparkline.tsx` |
| B0-caption-contrast | tokens | Lift caption token to ~#a3a3a3 (~4.9:1 on #000) for sub-AA mobile captions | `web/app/globals.css` |

### Batch 1 — Quick visual wins (mobile redesign, no new endpoints)
| id | surface | what | files |
|---|---|---|---|
| B1-dash-hero-signal | dashboard | Replace "N tracked" footnote with a state-colored portfolio risk headline from `editorial.drifting/depegged` (uncut oversized-anchor; "2 drifting · 0 depegged" or "all pegged") | `web/app/(app)/dashboard/page.tsx` |
| B1-dash-detune-mono | dashboard | Drop Class/View/Sort 9px mono eyebrows; pill labels → Geist sentence-case; mono only on spread/% (kills terminal register, backlog `drop-bloomberg-wash-subbar`) | `web/app/(app)/dashboard/page.tsx` |
| B1-count-chips | dashboard/screener | Annotate peg-state filter chips with live counts (landing.love) — filter row doubles as health summary | `web/app/(app)/dashboard/page.tsx`, `web/app/(app)/assets/page.tsx` |
| B1-detail-hero-clamp | asset-detail | Clamp hero spread `text-[clamp(48px,16vw,80px)]` + `max-w-full overflow-hidden`; demote drift-floor/updated meta into the reference strip | `web/components/organisms/asset-hero-v2.tsx` |
| B1-detail-chart-fullbleed | asset-detail | Chart `-mx-5 sm:mx-0` edge-to-edge on mobile; bump segmented controls to `min-h-[44px]`, collapse view-mode row | `web/components/organisms/asset-chart.tsx` |
| B1-detail-dup-heading | asset-detail | Drop the page-level "Spread · market vs intrinsic" h2 (chart owns its title) — backlog `fix-hardcoded-24h-spread-heading` + `overview-chart-duplicate-heading` | `web/app/(app)/asset/[symbol]/page.tsx`, `web/components/organisms/asset-chart.tsx` |
| B1-tabs-affordance | asset-detail | Right-edge fade mask + `snap-x` + px-5 inset on the tab strip | `web/components/molecules/asset-tabs.tsx` |
| B1-screener-card | screener | `block sm:hidden` mobile card: pip+symbol+signed-colored spread / full-width BandGauge / inline Sparkline + worst-24h (backlog `mobile-screener-parity`, `spread-as-lead-column-signed-colored`, `sparkline-column-inline-series`, `peg-jitter-stability-column`) | `web/app/(app)/assets/page.tsx` |
| B1-screener-worst24h | screener | Compute worst-24h from inline series; card + desktop column (backlog `worst-24h-offpeg-column`) | `web/app/(app)/assets/page.tsx` |
| B1-screener-states | screener | Add error + empty + worst-offender strip states (backlog `empty-and-error-states`, `ai-prompt-strip-worst-offender`) using component.gallery empty-state taxonomy | `web/app/(app)/assets/page.tsx` |
| B1-screener-sort-visible | screener | sm:hidden sort control + visible "Sorted by →" label so URL `?sort=` is never silent (backlog `sortable-column-headers-url-encoded`, `header-looks-sortable-affordance-fix`) | `web/app/(app)/assets/page.tsx` |
| B1-sign-convention | dashboard/asset-detail | Explicit premium/discount sign-convention label on spread (backlog `sign-convention-label`, `sign-convention-premium-discount-label`) | `web/app/(app)/dashboard/page.tsx`, `web/components/organisms/asset-hero-v2.tsx` |
| B1-tick-flash-token-rm | dashboard | Route tick-flash `#ff8400` through a brand token + honor reduced-motion (backlog `tick-flash-token`, `tick-flash-respects-reduced-motion`, `live-tick-legibility`) | `web/app/(app)/dashboard/page.tsx`, `web/app/globals.css` |
| B1-icon-primitive | primitives | Single sharp stroke `<Icon>` primitive (size 20/24, currentColor) used across rows/tabs/hero (hugeicons) | `web/components/atoms/icon.tsx` (new) + consumers |
| B1-gradient-discipline | both | Audit gradient usage — exactly one bounded instance per screen (CTA pill or active-tab underline); remove any wash | `web/app/(app)/dashboard/page.tsx`, `web/app/(app)/asset/[symbol]/page.tsx` |

### Batch 2 — Structural redesign
| id | surface | what | files |
|---|---|---|---|
| B2-dash-collapse-chrome | dashboard | Collapse 5 control blocks → one segmented view switcher inline with search + a "Filters" pill (≤~140px header); fold Sort + Class into the sheet | `web/app/(app)/dashboard/page.tsx` |
| B2-filter-sheet | dashboard/screener | New `FilterSheet` bottom sheet (opaque pure-black, 0px, ease-only, safe-area, focus-trapped) holding class/peg-state/sort toggle rows | `web/components/molecules/filter-sheet.tsx` (new) |
| B2-bottom-tab-nav | shell | Persistent `lg:hidden` bottom tab bar (Dashboard/Assets/Events/Account), ≥44px, icon+label, `aria-current`, safe-area-bottom; demote hamburger to overflow | `web/components/organisms/mobile-tab-bar.tsx` (new), `web/app/(app)/layout.tsx`, `web/components/organisms/dashboard-topbar.tsx` |
| B2-menu-anchor | shell | Make topbar `sticky top-0` (or measure header bottom) so the menu panel offset is correct with banners visible | `web/components/organisms/dashboard-topbar.tsx`, `web/components/molecules/mobile-menu.tsx` |
| B2-detail-sticky-hero | asset-detail | Mobile-only collapsing sticky header (symbol + state pip + live spread) via IntersectionObserver on the hero; safe-area top | `web/app/(app)/asset/[symbol]/page.tsx`, `web/components/organisms/asset-hero-v2.tsx` |
| B2-detail-rail-bento | asset-detail | Collapse AssetRail into a data bento (one big peg tile + snap-scroll metric tiles); hide redundant "Live state"; keep 2 CTAs (rebrand.gallery / endlesstools) | `web/components/organisms/asset-rail.tsx` |
| B2-detail-sticky-cta | asset-detail | Sticky bottom "Set peg alert" pill docking after the hero scrolls out; one gradient ammunition (cta.gallery / Binance) | `web/app/(app)/asset/[symbol]/page.tsx`, `web/components/organisms/asset-rail.tsx` |
| B2-chart-scrub | asset-detail | Horizontal scrub on the peg chart updating the (sticky) readout + snapping state color; soft touch glow not a hard crosshair (60fps / Apple Stocks) | `web/components/organisms/asset-chart.tsx` |
| B2-list-morph | dashboard | Shared-element morph (symbol+spread+state-dot) list row → detail hero, ease-only ~300–400ms, reduced-motion-safe | `web/components/molecules/mobile-asset-row.tsx`, `web/components/organisms/asset-hero-v2.tsx` |
| B2-tick-scale | dashboard/asset-detail | Number-scale-on-tick (Wise) on hero + NAV cells, 200–300ms ease, paired with state color, frozen on reduced-motion | `web/components/organisms/asset-hero-v2.tsx`, `web/components/molecules/mobile-asset-row.tsx` |
| B2-skeleton-shimmer | dashboard/asset-detail | Left-to-right shimmer skeleton cards matching final layout; suppress <300ms refetch loaders (60fps) | `web/components/molecules/skeleton-row.tsx`, consumers |
| B2-band-micro-gauge-row | dashboard | Per-row "% of band" micro-gauge already on MobileAssetRow — extend to peek/screener parity (backlog `per-row-band-micro-gauge`, `drift-band-micro-gauge`) | `web/components/molecules/mobile-asset-row.tsx` |
| B2-watchlist | screener/dashboard | Watchlist filter tab + per-row star (localStorage), sticky safe-area compare bar (backlog `watchlist-filter-tab`, `multiselect-to-compare-deeplink`) | `web/app/(app)/assets/page.tsx` |
| B2-aria-live | dashboard | aria-live region announcing peg-state transitions (backlog `aria-live-state-pips`, `aria-live-state-transitions`) | `web/app/(app)/dashboard/page.tsx` |
| B2-entrance | both | "First frame alive" entrance: hero count-up + ambient field already drifting on first paint, MotionConfig reducedMotion=user (backlog `app-entrance-choreography`, `app-entrance-choreography-detail`, endlesstools) | `web/app/(app)/dashboard/page.tsx`, `web/app/(app)/asset/[symbol]/page.tsx` |
| B2-ambient-field | asset-detail | Optional very-slow data-tinted ambient field behind hero number (≤0.15× time, low alpha, peg-state token only, freeze on reduced-motion) — shadergpt; gate behind a feature flag, geometry-first | `web/components/organisms/asset-hero-v2.tsx` |

### Batch 3 — Backend-dependent FE
| id | surface | what | dependsOnBackend |
|---|---|---|---|
| B3-thresholds-from-payload | dashboard/screener/asset-detail | Read per-asset thresholds off `AssetCard.thresholds`; delete hand-maintained `PER_ASSET_THRESHOLDS` in policy.ts; BandGauge/chart threshold lines/band-proximity sort all key off payload (backlog `chart-thresholds-per-asset-bug` durable fix) | BSRV-01 |
| B3-worst-jitter-server | screener/dashboard/asset-detail | Prefer server `worst_abs_24h` + `jitter_bps_24h` (accurate min/max) over client reduction of hourly-avg series (backlog `peg-jitter-*`, `worst-24h-offpeg-column` accuracy) | BSRV-02, BSRV-03 |
| B3-confidence-badge | asset-detail | Oracle-confidence badge on the rail/bento off `asset.confidence`, gated on `updated_at` freshness (backlog `pyth-confidence-badge`) | already shipped (BSRV-04 core) |
| B3-nav-decomposition | asset-detail (Mechanism) | NAV/Proof-of-Reserves bento: `sol_per_lst × sol_usd = intrinsic_usd`, gated on `sol_per_lst_at` (backlog `nav-intrinsic-backing-decomposition`) | BSRV-04 (sol_per_lst_at), TVL/sol_usd plumbing |
| B3-incidents-precedents | asset-detail (History) | Stage 1: seed `depeg-precedents.ts` labeled "external · not Pegana-measured"; Stage 2: read `/v1/incidents` (backlog `historical-depeg-replay-library`) | new `/v1/incidents` |
| B3-chart-state-markers | asset-detail | Derive state-change markers client-side from `/history` `state` column during calibration; switch to `/v1/alerts` post-launch (backlog `chart-state-markers`) | none (client-derivable) |
| B3-route-impact-chip | asset-detail | Optional "route price impact (single-probe)" chip from `price_impact_pct`/`route_label`, labeled as single-probe not depth (backlog adjacent) | BSRV-05 |

---

## 5. Backend plan (additive, non-breaking — `crates/api-rs`)

All changes are additive: new `Option` fields with `#[serde(skip_serializing_if = "Option::is_none")]` (omit, not null), no `deny_unknown_fields` anywhere, runtime-checked `sqlx::query` (no offline-cache regen). Confirmed against the 06-03 SPEC and backend audit.

| id | location | change | effort | unblocks |
|---|---|---|---|---|
| **BSRV-01** | `assets.rs` `AssetCard` (~41–72) + list SELECT (124–185) + detail (243–289); column `assets.thresholds` JSONB | Add `pub thresholds: Option<serde_json::Value>` (skip-if-none); project `a.thresholds AS thresholds` in both outer SELECTs (no new join). **Requires a companion one-time data migration** to re-sync `assets.thresholds` (+ CDP `cr_*` keys) to current `assets.toml` values — the engine reads toml at runtime and never writes the column back, so it is stale-by-design (jitoSOL DB drift=20 vs toml=45). Serve JSONB verbatim so both `{drift_bps,depeg_bps,critical_bps}` and `{cr_drift,...}` pass through. **Highest-value field** — band-gauge, chart threshold lines, and the "closest to breaking" sort all depend on a hand-copied table today. | M | B3-thresholds-from-payload (lets FE delete `policy.ts` PER_ASSET_THRESHOLDS) |
| **BSRV-02** | `assets.rs` list `s` LATERAL (163–174) + detail (268–279); view `discount_1m` (min/max columns) | Add `pub worst_abs_24h: Option<Decimal>` (skip-if-none); extend the existing `s` LATERAL to also `max(greatest(abs(min_discount),abs(max_discount)))` in the same scan (signed discount → abs required). Doc as "trailing 24h, independent of current-snapshot freshness." | S | B3-worst-jitter-server (accurate worst tick, not worst-of-hourly-avg) |
| **BSRV-03** | `assets.rs` same `s` LATERAL; `discount_1m` | Add `pub jitter_bps_24h: Option<Decimal>` (skip-if-none) — `max(max_discount)-min(min_discount)` (or stddev) in the same scan. Server-side once is far cheaper than every client recomputing from averaged series. | S | B3-worst-jitter-server (the "spine" jitter helper the roadmap flagged) |
| **BSRV-04** | `assets.rs` `i` LATERAL (~159/264) | Core `sol_per_lst` + `confidence` already shipped. Optional additive: project `i.ts AS sol_per_lst_at` + `pub sol_per_lst_at: Option<DateTime<Utc>>` so the NAV row can be gated on the intrinsic row's own (unbounded) age rather than mixing a ≤15-min `intrinsic_usd` with an unbounded `sol_per_lst`. Defer until NAV decomposition ships. | S | B3-nav-decomposition (cross-cycle NAV guard) |
| **BSRV-04b** | `assets.rs` outer SELECT; new LATERAL on `oracle_snapshots` for SOL/USD feed | Add `pub sol_usd: Option<Decimal>` via LEFT JOIN LATERAL on the latest SOL/USD oracle row. TVL is **not** in `intrinsic_snapshots.meta` today (only `sol_per_lst`+`lamports`) — do **not** promise TVL as a serializer-only change; it needs an indexer change first (`sanctum.rs` meta `json!` block). | M | B3-nav-decomposition (renders `sol_per_lst × sol_usd`) |
| **BSRV-05** | `assets.rs` (no `market_snapshots` join today) | Optional 4th LATERAL `m` joining latest `market_snapshots` (15-min bound, matching the `d` bound): `pub price_impact_pct: Option<Decimal>` + `pub route_label: Option<String>`. Single-probe only — label UI "route price impact (single-probe)", not "liquidity depth". One more LATERAL on the hot query (mitigated by the 5s Redis cache). True depth is data-blocked (indexer multi-probe). | M | B3-route-impact-chip |
| **INCID-01** | new `GET /v1/incidents` beside `methodology.rs`, registered in `main.rs` (205–211), CORS allowlist (149–154); new `depeg_incidents` table (new migration) | Curated external-precedent read endpoint: `[{id, occurred_on, asset?, class, worst_deviation_bps, recovery_hours, source_url, source_label}]`, keyed by class so archetypes (USDC/SVB → stable_fiat) show for assets Pegana didn't track at incident time. Purely additive, calibration-independent (curated, not live). FE can ship a seed-JSON MVP NOW with zero backend. | M | B3-incidents-precedents (History tab) |

**Migration note (one-time, required by BSRV-01):** `UPDATE assets SET thresholds = … per symbol` to current `assets.toml`-calibrated values (or have the engine upsert on boot), so the served column stops lying. This is the durable fix for the `chart-thresholds-per-asset-bug` — once the column is authoritative the FE drops `policy.ts` PER_ASSET_THRESHOLDS entirely.

---

## 6. ASCII wireframes

### 6.1 Redesigned mobile dashboard (~390px)

```
┌──────────────────────────────────────────────┐ ← safe-area-inset-top
│ [≡]  [ pegana ]            [search] [account] │  sticky topbar (sticky top-0)
├──────────────────────────────────────────────┤
│ Engine ● ingesting 22 · updated 8s ago        │  EngineFlowStrip compact (no shimmer)
├──────────────────────────────────────────────┤
│                                                │
│  2 drifting                       ← HERO       │  st-drift colored, 32px Geist
│  0 depegged · 20 pegged                        │  oversized anchor, answer-first
│                                                │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────┐  ┌─────────┐  │
│  │ ⌕ Filter assets…           │  │ Filters │  │  search + ONE filter pill
│  └────────────────────────────┘  └─────────┘  │  (pill opens bottom sheet)
│  [ All 22 ][ Drifting 2 ][ Depeg 0 ][ LST 9 ] │  segmented view switch, count chips
├──────────────────────────────────────────────┤
│  ●  jitoSOL                          −0.43%   │  ← MobileAssetRow (76px, kept)
│     Jito Staked SOL · LST                      │  recessive caption (1 line)
│     ▓▓▓▓▓▓▓░░░░░░░░│░░░░░  62%   ╱╲╱‾╲╱        │  BandGauge + inline sparkline
│  ──────────────────────────────────────────── │
│  ●  USDC                             +0.01%   │  st-pegged green spread
│     USD Coin · Stablecoin                      │
│     ▓░░░░░░░░░░░░░│░░░░░░   4%   ‾‾‾‾‾‾‾‾      │
│  ──────────────────────────────────────────── │
│  ●  INF                              −0.12%   │  tap → morph into detail hero
│     Infinity · LST · ▓▓▓░░│░░ 31%   ╲╱‾╲       │
│         … windowed list, ease/decay momentum … │
├──────────────────────────────────────────────┤
│   [ Dashboard ]  Assets   Events   Account     │  bottom tab bar (≥44px, aria-current)
└──────────────────────────────────────────────┘ ← safe-area-inset-bottom

  Filters bottom sheet (opaque pure-black, 0px, ease-up):
  ┌──────────────────────────────────────────────┐
  │ Filters                                   ✕   │
  │ ── Class ──────────────────────────────────── │
  │ [All] [Stablecoin] [LST] [CDP]                │  sharp 0px chips
  │ ── Peg state ────────────────────────────────  │
  │ [Pegged 20] [Drift 2] [Depeg 0] [Critical 0]  │  count chips, st-* colors
  │ ── Sort ─────────────────────────────────────  │
  │ ( ) Worst first  ( ) |Spread|  ( ) A–Z        │
  │            ( Apply · rounded-full CTA )         │  ← single gradient ammunition
  └──────────────────────────────────────────────┘
```

### 6.2 Redesigned mobile asset-detail (~390px)

```
COLLAPSED (after scroll) — sticky bar always answers "pegged right now?":
┌──────────────────────────────────────────────┐ ← safe-area-inset-top
│ ‹  ● jitoSOL              −0.43%  drift        │  sticky top-0, symbol+pip+live spread
└──────────────────────────────────────────────┘

EXPANDED (top of page):
┌──────────────────────────────────────────────┐ ← safe-area-inset-top
│ ⚠ Data may be stale. See /status   [Retry]    │  StaleBanner (kept, safe-area top)
├──────────────────────────────────────────────┤
│ Dashboard / LSTs / jitoSOL                     │  breadcrumb
│                                                │
│   −0.43%                          ← HERO       │  clamp(48px,16vw,80px) JetBrains
│   ● drift · discount to NAV   [?]              │  Mono, peg-state color, one meta line
│   (very-slow ambient field, st-drift tint)     │  shadergpt, low alpha, RM-frozen
│                                                │
│  ┌───────────── DATA BENTO ──────────────────┐ │  rail → bento (one big tile + swipe)
│  │ Peg state   │ worst 24h │ NAV vs market   │ │
│  │   DRIFT     │  −0.81%   │ 1.117 / 1.112   │ │  ← snap-scroll metric tiles →
│  │ ●           │ confidence: high · jitter…  │ │
│  └────────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ Overview │ Chart │ Mechanism │ Risk │ Iden…→  │  tabs: snap-x + right fade mask
│ ▔▔▔▔▔▔▔▔ (iridescent underline, 1 instance)    │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────┐│
│  │ Spread · market vs intrinsic   [1H 24H 7D] ││  chart edge-to-edge (-mx-5)
│  │  ╱╲                          ╱             ││  segmented range ≥44px
│  │ ╱  ╲___      depeg ───────────╱──── ◆       ││  ◆ = scrub handle, readout follows
│  │      ╲__╱╲__╱  drift ─ ─ ─ ─ ─ ─ ─          ││  soft touch glow (not crosshair)
│  │                                            ││  state-change markers (from /history)
│  └────────────────────────────────────────────┘│
│  Recovery confidence · Exit liquidity · …       │  stacked sections, generous rhythm
├──────────────────────────────────────────────┤
│        ( ⤬ Set peg alert )         ← sticky    │  sticky bottom CTA (rounded-full,
│   alerts fire on >0.5% drift · 15-min fresh     │  gradient ammunition, mono caption)
└──────────────────────────────────────────────┘ ← safe-area-inset-bottom
   [ Dashboard   Assets   Events   Account ]       bottom tab bar persists
```

---

## 7. Signature moves (summary)

1. **Answer-first hero on both screens** (uncut.wtf size-only hierarchy) — dashboard leads with a state-colored "N drifting / N depegged" headline from the counts mobile currently discards; asset-detail leads with one oversized clamp-sized peg numeral. Serves: Geist+JetBrains-only, no weight-soup; kills the "N tracked" footnote and the 80px overflow.
2. **One control row, not five — filters in a bottom sheet** (Mobbin segmented-vs-sheet) — a segmented view switch inline with search + a single "Filters" pill opening an opaque pure-black 0px sheet. Serves: ≤140px header, no frosted glass over data, sharp geometry.
3. **Collapsing sticky hero + chart scrub** (Mobbin large-title + 60fps Apple-Stocks/Robinhood) — asset-detail symbol/spread/state never scroll off; dragging the chart updates the readout and snaps peg-state color. Serves: ease-only motion, the answer always on screen.
4. **Bottom tab bar replaces hamburger-as-primary** (navbar.gallery) — Dashboard/Assets/Events/Account thumb-reachable; hamburger demoted to overflow. Serves: line icons + mono labels on black, gradient underline sparingly.
5. **Count-annotated peg-state chips + table→card transform** (landing.love + component.gallery) — the filter row doubles as a portfolio-health summary; rows become stacked cards with BandGauge + sparkline + worst-24h, restoring the screener's lost signal. Serves: sharp 0px badges (not pills), single tap-target per row.
6. **Gradient as one bounded instance per screen** (coolshap.es + cta.gallery) — the iridescent gradient is the fill of exactly one CTA pill or one active-tab underline; everything else is sharp/ghost/outlined. Serves: "sparing ammunition," literal.
