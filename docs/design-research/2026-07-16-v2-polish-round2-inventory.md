# V2 polish round 2 — complete inventory (2026-07-16)

> Branch `landing/v2-port` (preview only — NEVER main). Built from a 5-agent
> read-only survey of the whole V2 frontend (landing home, marketing inner, app
> primary, app secondary/account, cross-cutting). Structure agreed with Rafael:
> **(A) surface-by-surface, sequenced landing → app, each 100% (desktop + mobile
> + fixes) before moving on** — respects the "sequence, never parallelize"
> pacing rule. This doc is the source of truth; priorities grilled below.

Legend — severity: 🔴 high · 🟠 med · 🟡 low. Type: 🐞 correctness/bug · ⚖️
consistency · 📱 mobile · ✨ premium-uplift. Decision: **[fix]** = objective, just
do it · **[call]** = needs Rafael's design call.

## A · LANDING / MARKETING (do first)

### Hero (`/`)
- **L1** 🔴✨ **[call]** — Hero top ~350-400px is dead flat black since the prism triangle was removed (`hero-v2.tsx` pt-[172px] band). Fix: a landing-scoped `AmbientGlowBg` wash behind nav/H1 (same brand wash as the dashboard), NOT a new triangle.
- **L2** 🔴📱 **[fix]** — `HeroRevealCanvas` returns before drawing below 900px → the reveal-mask signature (dotted grid, intrinsic baseline, micro-values) is 100% absent on mobile. Add the static one-frame fallback `DistanceFieldCanvas` already has.
- **L3** 🟠🐞 **[fix]** — Hero board `<th>` uses `HIDE_M` but the sparkline `<td>` uses `HIDE_SPARK` → at 860-899px header shows 8 cols, body 7 → "Updated" slides into the wrong column. Change the th to `HIDE_SPARK`.
- **L4** 🟠🐞 **[fix]** — Hero board `aria-label` is always "(sample)" even when bound to live `/v1/assets`. Make it conditional on `usingSample`.
- **L6** 🟠⚖️ **[call]** — Hero "live" dot has glow (`shadow-[0_0_8px]`) + pulse (`v2-blink`) — violates the flat-dot law (also on trust-scene). Drop glow/pulse? (It reads as liveness, but the law says liveness = timestamps only.)
- **L5** 🟡✨ **[fix]** — Hero board `TokenIcon` lazy-loads 8 above-the-fold logos → pop-in. Pass `loading="eager"` (asset-hero already does).
- **L8** 🟡🐞 **[fix]** — Footer copyright literal `© 2026` → `{new Date().getFullYear()}`. Trust-scene receipt date hardcoded "06/15/2026" (deliberate case study, lower priority).

### Landing sections
- **L7** 🟠✨ **[call]** — `close-v2.tsx` final CTA packs 3 ICP pitches into one 366-char `<p>` → break into 3 scannable lines (friendly trim).

### Marketing inner pages
- **L9** 🔴⚖️ **[call]** — `/backtest/*` never migrated to V5 (boxy borders, mono labels = the closest thing to the banned terminal look). Re-platform onto `PageHeroV2`/`StatStripV2`/`ReceiptObjectV2`/pills.
- **L10** 🔴⚖️ **[call]** — `/embed*` (+ `/embed/demo`) never migrated to V5 (config/dev-tools look). Same re-platform + pill-tab picker.
- **L11** 🟠⚖️ **[fix]** — `/audit/[id]/loading.tsx` skeleton off-brand (old tokens, `max-w-[1280px]` vs real `880px` → reflow jump). Rewrite in `.pegana-v2` at 880px.
- **L12** 🟠⚖️ **[fix]** — `/audit` empty-states (`audit-empty-state.tsx`) in old tokens; `audit-calibration-view.tsx` is dead code (post-06-11 gate). Restyle the empty-state, delete the dead branch.
- **L13** 🟠🐞 **[fix]** — `/backtest` and `/embed/demo` are orphan pages (no nav/footer link). Add footer/trust links.
- **L14** 🟠📱 **[fix]** — `/embed` configurator: fixed 320px iframe in a padded box overflows narrow mobile. Add `overflow-x-auto`/responsive padding.

## B · APP (after landing)

### Dashboard
- **A1** 🔴📱 **[fix]** — Verdict-hero lives behind a Radix `HoverCard` (`SystemStatusHoverCard`) that disables touch → likely unopenable on iOS, with no other route to it. Add a tap/`onClick`/Popover fallback below `lg`. (Verify on touch.)
- **A2** 🔴📱 **[fix]** — Dashboard mobile card drops Stability (jitter) + Safety grade; screener mobile shows both → dashboard-mobile users see less risk signal on the default surface. Add the footer row.
- **A7** 🟠✨🎯 **[quick fix + call]** — The 2 cards you flagged: "Most volatile 24h" sparkline is missing `thresholdBps` (1-line fix, "Closest to band" has it) AND has one less content stack → optionally add a real data line for parity.
- **A3** 🟠⚖️ **[fix]** — Dashboard board never renders `SustainedBadge` (screener + asset-hero do) — the worst-first view most needs "sustained vs blip". Wire it.
- **A4** 🟠⚖️ **[call]** — Dashboard has 8 class facets, screener has 4 tabs (same dimension, incompatible). Align to one taxonomy (which?).
- **A5** 🟠⚖️ **[fix]** — Dashboard head missing the `HeaderHint`/`HelpIcon` tooltips the screener has on Depeg + Stability. Port them.
- **A6** 🟠⚖️ **[fix]** — Dashboard board sort is `useState` (not URL-persisted); screener sort is shareable via `?sort=&dir=`. Mirror the URL pattern.
- **A8** 🟡⚖️ **[fix]** — Dashboard vs screener `/`-search inputs differ (icon vs kbd hint, placeholder, width). Unify on the screener's kbd-hint affordance.
- **A9** 🟡⚖️ **[call]** — `BandGauge` off-scale state adds a real glow (`boxShadow`) — the one remaining glow vs the flat law. Keep (intentional danger emphasis) or drop?

### Compare / Events
- **A10** 🔴🐞 **[fix]** — `/compare` + `/events` show the spread sign INVERTED (~8 call sites never negate `reconcileBps`) → a premium reads as `−`. Same holder-signed fix already applied on board/screener/dashboard. Also the CSV export.
- **A11** 🟠⚖️ **[fix]** — `AssetPicker` (compare's "+ Add asset") is the one sharp-cornered CLI-ish surface in a rounded app. Round trigger/panel/input.
- **A12** 🟠📱 **[fix]** — `AssetPicker` panel is hand-rolled (no Popper collision) + right-anchored → likely overflows the viewport on mobile. Clamp/Popover.

### Account
- **A13** 🔴🐞 **[fix]** — Webhook delete fires with ZERO confirmation, next to Test/Toggle (mis-click → lost live integration). Reuse `SubConfirmModal`'s dialog.
- **A15** 🟠🐞 **[fix]** — `/account/settings` digest save has no `catch` → failures are silent (Switch just reverts). Add the `role="alert"` pattern the siblings use.
- **A14** 🟠✨ **[call]** — Webhook has no edit UI (backend `patchWebhook` supports url/threshold/channel) → must delete+recreate to change a threshold. Add inline edit?
- **A16** 🟡⚖️ **[fix]** — `/account` hub recent-alerts strip is `<ul>/<li>`, not a real `<table>` (AGENTS.md lists "alert lists" as must-be-table). Convert (or explicitly exempt).

## C · CROSS-CUTTING (threads through both)
- **X1** 🔴✨ **[call]** — **3 background layers stack on app pages**: root `<Background/>` = DotGrid + MouseSpotlight (global) + `AmbientGlowBg` (app). `AmbientGlowBg`'s docstring claims it "replaced the retired dotted grid" — that retirement never happened. Pick ONE story (which layers to keep where).
- **X2** 🔴⚖️ **[fix]** — `nav-v2.tsx` is the ONLY remaining file combining `bg-[rgba(...)]` + `backdrop-blur-[...]` as composite Tailwind arbitraries — the exact pattern that "died in prod builds" twice before (`.app-chrome-glass`, `.v2-shadow-board`). Extract to plain CSS + verify `getComputedStyle().backdropFilter`.
- **X3** 🟠⚖️ **[call]** — Two `stateMeta()` (state-meta.ts vs v2/shared.tsx) + ~12 local `Record<PegState,…>` color maps. No visual drift today (all point at the same hex) but it's the maintenance-risk the canonical file's own docstring warns about. Consolidate now or defer to the next state/class addition?
- **X4** 🟡🐞 **[fix]** — Dead code: `components/effects/hero-canvas.tsx` (0 importers); `mobile-menu.tsx` `backdrop-blur-xl` on an opaque `bg-canvas` (dead no-op). Delete/clean.

## Verified clean (no work — do NOT reinvent)
No JetBrains Mono / legacy gray-slate-zinc / raw bg-black anywhere · global `overflow-x: clip` safety net · mono-for-numbers/captions rule holds · all 6 data tables degrade to mobile cards correctly · canvas/motion effects are all reduced-motion-gated (no `v2-arcbreathe` opacity-clobber gotcha remains after the prism fix) · `/account/alerts`, subscriptions, auth/magic, ProductTabsV2, CandorV2, TrustSceneV2, AssetHeroV2, screener table, error trio, AnimatedBrandMark, FooterV2 all already premium.

## Design decisions to grill (the [call] items)
X1 backgrounds · L1 hero top fill · L6 hero live-dot glow · L7 close-v2 trim · L9/L10 backtest+embed re-platform · A4 dashboard/screener taxonomy · A7 volatile-card parity · A9 BandGauge off-scale glow · A14 webhook edit UI · X3 stateMeta consolidation.

## Objective [fix] items (no taste — execute once decisions locked)
L2, L3, L4, L5, L8, L11, L12, L13, L14, A1, A2, A3, A5, A6, A8, A10, A11, A12, A13, A15, A16, X2, X4.

---

## EXECUTION COMPLETE — 2026-07-16 (`landing/v2-port`, preview only, NOT merged)

All findings validated adversarially (5-agent workflow: 31 CONFIRMED + 2 refined)
+ live Playwright/DOM pass BEFORE fixing. Live pass refined the plan:
- **L14 REFUTED** (embed iframe does NOT overflow at 390px live) → dropped.
- **X2 downgraded** (nav backdrop-filter computes blur(20px) live, works) → did it
  as optional hardening anyway... which **BROKE it** (see below).
- **A10 confirmed live** (compare mSOL −1.03% vs dashboard +1.03%) → fixed + verified
  flipped to +1.03% on both.

**5 waves shipped** (Sonnet implementers, disjoint files, per-wave tsc+vitest gate +
explicit-path commit + push + DOM verify):
- **W1 `d2c2ab8`** — L1 hero wash, L2 mobile canvas, L3 breakpoint, L4 aria, L5 eager,
  L6 flat dot, X1 (DotGrid+MouseSpotlight retired app-wide → 1 layer). Verified: dash
  3→1 bg layers, wash h460, dot flat.
- **W2 `efc8ddf`** — L7 CTA trim, L8 footer year, L9 backtest→V5, L10 embed→V5, L11
  audit skeleton, L12 empty-state + deleted dead audit-calibration-view, L13 links,
  L6-trust flat.
- **W3 `e48822d`** — A1 hovercard tap, A2 mobile Stability+Safety, A3 SustainedBadge,
  A5 header hints, A6 URL sort (Suspense split), A7 volatile card threshold+range,
  A8 search kbd, A9 documented gauge glow. **A4 (taxonomy 8-vs-4) DEFERRED — his call.**
- **W4 `21473e8`** — A10 sign fix (compare/events/chart/CSV/picker), A11 picker rounded,
  A12 picker no mobile overflow, A13 webhook delete-confirm, A14 webhook inline edit,
  A15 settings error surfacing, A16 account hub real <table>.
- **W5 `b60844d`** — X2 nav glass→plain CSS, X4 deleted hero-canvas + mobile-menu no-op.
- **prettier `587fb84`** — format-on-save churn on 4 W2 files.

**⚠️ X2 REGRESSION caught + reverted (`f3a416c`):** the "insurance" plain-CSS
`.v2-nav-glass` computed `backdrop-filter: none` on the live build — the exact
raw-CSS-loses-to-Tailwind-v4 failure ([[feedback_backdrop_filter_dead_use_opaque]]).
The original Tailwind arbitrary `backdrop-blur-[20px]` worked. Restored it. **Caught
by DOM verification, NOT tsc/vitest** — lesson: computed-CSS regressions need a live
check. **X3 (stateMeta consolidation) DEFERRED** (touches many files, zero visual drift).

**Nav logo interaction (`527747d`, his request):** on the "egana" hover-reveal the WHOLE
pill now grows/shrinks as one unit (pill = content-width + centered ≥920px, 1180→685px)
instead of the nav items repositioning. Mobile keeps full-width logo-left/burger-right.
Verified live. ⚠️ This makes the desktop nav a compact centered floating pill (notable
visual change) — pending his eyeball.

**Gate: tsc clean · 705/705 vitest · every wave DOM-verified on the preview.**
Open for him: A4 taxonomy · confirm the nav compact-pill look · merge→main (V5).
