# Pegana — Design Uplift v1.1
> Status: brainstorm complete, ready for implementation planning
> Owner: Rafael (solo)
> Date: 2026-05-22
> Direction locked: **A (Bloomberg Live)** with hybrid grafts from B and C
> Execution order: **landing → dashboard → asset → secondary pages**

---

## 0. TL;DR

The product is **information-dense, opinionated, and visually competent already**. The v7 lineage holds. The gap between today and "FODA" is not a redesign — it is three missing layers:

1. **Liveness layer.** Nothing on the screen proves the watchdog is awake right now.
2. **Motion vocabulary.** Framer-motion handles entrance. After mount, the page is a static poster.
3. **Signal coverage.** The signature visualization (sparkline) is missing on the universe grid and on mobile.

This spec defines: the **design language updates** (color, surface, typography, motion), the **dashboard direction (A)**, the **GSAP motion system**, and the **per-page TODO** sequenced landing-first.

Audit evidence:
- Screenshots: `docs/design-research/audit-2026-05-22/current/` (13 pages × 1440 + 3 × 390)
- Per-page critique: `docs/design-research/audit-2026-05-22/critique.md`
- External recon: `docs/design-research/audit-2026-05-22/recon.md` (15 refero picks + 10 dashboard benchmarks + 6 GSAP patterns)

---

## 1. Audit summary

### 1.1 Cross-page problems ranked by impact

| # | Problem | Where it hurts | Fix bucket |
|---|---|---|---|
| 1 | No live signal — UI doesn't pulse on tick | every page | foundation (motion + state) |
| 2 | Motion stops at mount | every page | foundation (GSAP intro) |
| 3 | Universe grid has no sparkline | landing | landing |
| 4 | Empty states crash the page | compare, status, learn | per-page |
| 5 | Hero stats undersized; no anchor number | landing | landing |
| 6 | Active strip is text, not chart | dashboard | dashboard |
| 7 | Hover state invisible on tables | dashboard, events | dashboard |
| 8 | Sparklines lost on mobile dashboard | dashboard | dashboard mobile |
| 9 | Methodology lacks a pipeline diagram | methodology | per-page |
| 10 | Footer too heavy on shallow pages | every page | foundation (footer variants) |

### 1.2 What's working — do not touch

- Editorial typographic posture (lowercase punctuation, big h1).
- Iridescent gradient rationed to ~5 surfaces.
- Numbered section markers `(01) (02) (03)`.
- Mono ⨉ sans pairing.
- 0-radius geometry, committed.
- Asset detail page information architecture (the model for everything else).

### 1.3 The strongest current page

`/asset/[symbol]` is the closest to the target identity. Threshold ladder + spread chart + how-it's-priced explainer + 30d strip + activity timeline + peer table + safety grade + identity row + "take it further" footer is **the reusable IA pattern** for any data-detail page. The redesign will pull this vocabulary outward.

---

## 2. Design language updates

These ship as foundation work in the **landing PR** so every subsequent page inherits them. No standalone "design system overhaul" PR.

### 2.1 Color discipline — "one signal at a time"

| Token | Role | Today | New |
|---|---|---|---|
| `--color-canvas` | page bg | `#000` | `#000` (unchanged) |
| `--color-surface-1` | elevated card | `#0f0f12` | `#0a0a0a` |
| `--color-surface-2` | hover/active | `#1a1c22` | `#141414` |
| `--color-hairline` | dividers | `#1a1a1a` | `#1a1a1a` (unchanged) |
| `--color-text` | primary text | `#fffdf9` | `#fffdf9` (unchanged, but use sparingly) |
| `--color-text-body` | **NEW** body copy | — | `#e8e8e8` |
| `--color-text-muted` | labels | `#6f879c` | `#6f879c` (unchanged) |

**Three-step depth ladder on `#000`** (Linear pattern): `#000 → #0a0a0a → #141414`. No drop shadows on dashboard surfaces.

**Gradient as ammunition** (Raycast/Linear/Sequel principle): the iridescent gradient appears on exactly these surfaces and nowhere else:
1. BrandMark dot (existing).
2. Hero spotlight radial (existing, but make it follow the mouse with a 4px blur instead of a static circle).
3. Hero anchor number underline (NEW — 2px stripe under the big number).
4. CTA primary background (existing).
5. State-pip ring at low opacity (NEW — replace pip-pulse with iridescent ring on transition).
6. Section divider stripes (existing on cta-bridge; extend to top of methodology page).

CTAs that are NOT primary stay white-on-black. The gradient becomes scarcer = more powerful (Stripe pattern).

### 2.2 Surface treatment

- **Cards lift by surface, not shadow.** `bg-canvas` → `hover:bg-surface-1` → `active:bg-surface-2`. 100ms transition with `ease: power2.out`.
- **No shadows on dashboard or asset pages.** Shadow is reserved for the future command palette overlay and modals (where it represents real elevation off the page).
- **Borders are 1px hairlines, never 2px.** Remove any `border-2` or `border-thick` from the codebase.

### 2.3 Typography

Current stack: `--font-sans` + `--font-mono` (via next/font). Add nothing now — but reduce variance:

- **Cap weights at 2 site-wide.** 400 (regular) + 600 (semibold). Audit and remove any `font-bold` / `font-light` / `font-medium`.
- **Tracking discipline** (Raycast pattern):
  - Display headlines (≥56px): `tracking-tight` (`-0.03em`).
  - Section labels (uppercase, 10-12px): `tracking-[0.08em]` (existing).
  - Body copy (14-16px): `tracking-normal`.
- **One typographic experiment for editorial pages, deferred to P3:** pilot Fraunces or IvarText for the methodology page hero. Not part of P0.

### 2.4 Motion vocabulary

Three rules, in priority order:

1. **Animate on state change, not on entrance** (Linear pattern). Once a value lands, it stays still until it actually changes.
2. **Ease easings, never spring** (ORYZO/Pyth pattern). Springs feel toy-like for financial data. Use `power2.out`, `power3.out`, `power2.inOut` — monotonic, trustworthy.
3. **Brief and committed.** Tick-flash: 120ms color flash → 180ms fade to neutral. No continuous animations. No 1s+ tweens except scroll-pinned scrub.

This is the **brutalist motion vocabulary** — the data is the motion.

### 2.5 Footer variants

Today: 5-column, brand + license, on every page. Takes ~25% of every page on first paint.

| Variant | Where | Columns |
|---|---|---|
| Full | `/`, `/about` | 5 cols + brand + license stripe |
| Compact | `/dashboard`, `/asset/*`, `/compare` | brand + license stripe only |
| Default | `/methodology`, `/status`, `/events`, `/embed`, `/developers`, `/learn`, `/changelog` | 3 cols (Product / Open / Company) + brand + license stripe |

---

## 3. Direction lock — Dashboard = A (Bloomberg Live, hybrid)

Picked direction A. Two grafts:
- **From B:** an editorial sentence above the anchor number ("Today, 8 of 23 are outside threshold."). Alternates with raw label form depending on state count. Adds gravitas without committing to a serif.
- **From C:** cross-component hover linking. Hover a row in the table → side panel slides in with the asset's 24h spread chart and key stats. Powers up the data-density without forcing a 3-pane layout that crowds mobile.

Pro/Lite toggle deferred to P2 (Tensor pattern). Lite = top-5 LSTs only; Pro = full table + sparklines + sources.

---

## 4. GSAP motion system

### 4.1 Adoption stance

**Add GSAP alongside framer-motion. Not a migration.**

- **Framer-motion stays for:** `<AnimatePresence>` on modals, dropdowns, mobile menu, sheet/drawer transitions. Anywhere a component mounts/unmounts.
- **GSAP takes over:** scroll-driven, table-reorder, headline reveals, kinetic marquees, counter morphs. Anywhere the React render cycle is the wrong driver.

Bundle cost: GSAP core + ScrollTrigger + Flip + SplitText + Observer ≈ ~42kb gzipped. Loaded only on pages that use it. Defer via `next/dynamic`.

Licensing: SplitText is a **Club GreenSock plugin** (paid). For v1 we can either (a) pay (~$99/yr, justifiable for the project), or (b) hand-roll a char-splitter for the landing hero only. Recommend (a) once a credit card is available — buys access to other paid plugins too.

### 4.2 Pattern catalog

| Pattern | Surface | Trigger | Easing | Duration |
|---|---|---|---|---|
| **ScrollTrigger pin + scrub** | landing hero → universe grid | scroll | linear (scrub: 1) | scroll-bound |
| **SplitText char reveal** | landing h1, anchor number on dashboard, asset detail h1 | mount | `power3.out` | 0.6s, 0.02s stagger |
| **Flip table↔mosaic** | dashboard view toggle | click | `power2.inOut` | 0.6s |
| **Flip sort reorder** | dashboard table sort | click | `power2.inOut` | 0.5s |
| **Observer marquee** | landing logo marquee, dashboard peg-strip | wheel/touch velocity | linear | continuous, velocity-driven |
| **Counter morph** | hero anchor, asset spread, EWMA values | data update with delta > epsilon | `power2.out` | 0.4s |
| **Tick-flash** | row that just changed state | WS update | linear | 120ms in + 180ms out |
| **State-pip ring pulse** | pip on transitioning row | WS state transition | sine.inOut | 2s, 1 loop only |

### 4.3 Reduced-motion contract

Already enforced globally via `prefers-reduced-motion`. Extend:
- All GSAP timelines wrap with `gsap.matchMedia({ "(prefers-reduced-motion: no-preference)": setup })`.
- Scrub timelines fall back to single `onEnter` reveal at 100ms duration.
- Marquee falls back to a static row (no animation).
- Tick-flash falls back to a 1px iridescent left border on the row for 2s, no color flash.

### 4.4 Mobile motion gates

- ScrollTrigger pins **disabled** on `(max-width: 767px)` — they break native scroll.
- Marquee runs at half-speed on mobile.
- Flip transitions stay (they're translate3d, perf-safe).
- Counter morphs stay.

---

## 5. Per-page redesign brief — sequenced landing → inner

### 5.1 Landing (`/`) — P0, ships first

**Goal:** make the landing prove "live" in 5 seconds. Establish the new motion vocabulary that every other page will inherit.

#### Hero section
- Replace static spotlight with **mouse-tracked iridescent radial** — already partially built, audit + tune blur (4px) and intensity (8% opacity on the gradient).
- **Anchor number** replaces the 4-stat row. Single display: `8 OF 23 OUTSIDE THRESHOLD` at ~104px on desktop, ~64px on mobile. Iridescent underline (2px) on the number itself. SplitText char-reveal on mount. Counter morph when value changes (WS-driven).
- Below anchor: 3-stat compact strip (`TRACKED 23 · ALERTS LIFETIME 95 · MEDIAN LATENCY 1.2s`) — these are context, not the eye-magnet.
- **Hero asset preview** (bSOL card top-right) becomes a **live ticker** that rotates through the 3 most-active assets every 5s. Sparkline draws in via GSAP `drawSVG` substitute (since DrawSVG is also paid — use `stroke-dasharray` trick).
- CTA pair stays: `OPEN THE DASHBOARD →` (primary, iridescent) + `HOW IT WORKS →` (ghost).

#### Logo marquee
- Replace CSS `@keyframes` with GSAP timeline + Observer. Velocity-driven: scroll fast = marquee fast; scroll up = marquee reverses.
- Add a second row counter-scrolling at half speed.
- Hover a logo → tooltip showing "What we read from {Name}" (e.g., Sanctum → "LST intrinsic via on-chain sol_value").

#### "In 30 seconds" 3-column explainer
- Each column gets a tiny **live mini-visualization** above the headline:
  - Intrinsic column: a small horizontal bar showing intrinsic = $1.00, animated tick to $0.998.
  - Market column: a small sparkline showing market quote noise.
  - Alert column: a Telegram-message-shaped envelope flashing iridescent.
- Stagger the column reveal on scroll with SplitText for the headline lines.

#### Methodology accordion
- Keep the structure.
- Embed a **mini pipeline diagram** in the FIRST row when expanded: Sanctum/Pyth/Hylo/Jupiter → engine → spread → FSM → alert. SVG with iridescent on the publish arrow.

#### Universe grid
- **THE BIG ADD: sparklines on every card.** 24h spread sparkline beneath the spread number. Single-hue, color matches state pip.
- Hover a card → it lifts (`surface-1 → surface-2`), the sparkline expands to show 7-day range, tap arrow shows on hover.
- Mobile: 1-column stack, but **keep sparklines**.
- Order: critical → depeg → drift → pegged. Sticky filter chip row above the grid (ALL / PEGGED / DRIFT / DEPEG / CRITICAL).

#### Get-pinged CTA
- Make the iridescent stripe more committed — full-bleed 1px line above the section, fade into surface.
- The Telegram simulation card on the right: animate the message typing in (per-char SplitText), then the alert spread number tick-flashes when it appears.

#### Wordmark closer
- Keep — strong as-is.
- Add a faint ScrollTrigger parallax: the wordmark moves 20px slower than scroll for a subtle depth cue.

#### Footer
- Full footer variant (5 columns).

### 5.2 Dashboard (`/dashboard`) — P1, ships second

**Goal:** the +100%. Direction A locked + hybrid grafts.

#### Top — peg-health strip
- **NEW.** 23 LSTs as colored micro-pips (or rectangles) in a single row across the top, full-bleed. Each pip is 14-22px wide, height 24px. Bottom border = state color (pegged green / drift bronze / depeg red / critical dark red). The pip has a faint internal bar showing the current spread magnitude.
- Hover a pip → small floating label with `symbol -28bps DRIFT`.
- Tap a pip → scrolls to that row in the table below.
- Tick-flash on the pip when its state changes.

#### Hero anchor
- `8 OF 23 OUTSIDE THRESHOLD` — same anchor pattern as landing, but now LIVE. Counter morph on every state transition.
- Below it: editorial sentence (B-graft). Alternates by state count:
  - `count == 0`: "Every asset is tracking within band."
  - `count < 3`: "{symbols} are outside threshold."
  - `count >= 3`: "{count} of 23 are outside threshold."
- Right side: 3-stat strip (`TRACKED 23 · ALERTS 24h 95 · MEDIAN SPREAD 21bps · WIDEST {symbol} {bps}`).
- Top-right corner: **Pro / Lite toggle** (deferred to P2 — initial ship is Pro-only).

#### Active strip
- The current text row (`• ACTIVE - 2  xSOL +11.2%  sUSD +2.16%`) becomes a **horizontal strip of 2-3 mini-charts**, each ~280px wide:
  - State pip pulsing.
  - Symbol + class.
  - 24h sparkline (state-color stroke).
  - Spread number, counter-morphed on tick.
  - Tap → opens asset detail.
- If 0 active, the strip becomes "All clear. Last drift {symbol} resolved {time}."

#### Compare watchlist row
- Promote from a single line to a sticky shelf above the table, visible while scrolling.
- Shows: current watchlist symbols as removable chips + `STACK ON ONE CHART →` CTA.

#### Filters
- Faceted chips replace the current `ALL / PEGGED / DRIFT / DEPEG` row + search.
- Chips: `ALL · LST · STABLE · CDP · YIELD · FX` + state chips + safety chips.
- Search remains, top-left.
- View toggle `TABLE · MOSAIC` top-right.

#### Table
- Columns: `★` (pin), `Asset` (symbol + name), `Class` (LST/STABLE/CDP/etc), `24h` (sparkline ~80px wide), `Safety` (letter grade), `Spread` (bps/pct), `State` (pip + label).
- Sort indicator on every column header on hover.
- **Hover row →**
  - Surface lifts (`canvas → surface-1`).
  - **Cross-component hover linking (C-graft):** a side panel on the right slides in showing 24h spread chart + intrinsic/market split + safety breakdown. Slide-in via Flip from row position.
  - Quick-action chips appear on the right edge: `★ pin · ↗ open · ⊕ compare`.
- **Mobile (390):** default to **mosaic mode** automatically. Mosaic cards keep sparklines. Filters become a bottom sheet (tap filter button → sheet up).

#### Live alerts sidebar
- Color-coded by recency intensity: just-now alerts at full opacity, older fades down.
- Critical alerts rendered 1.5× larger than drift.
- "Timeline →" link bottom — opens `/events`.
- On mobile, sidebar becomes a horizontal scrolling shelf below the table.

#### Footer
- Compact variant (brand + license only).

### 5.3 Asset detail (`/asset/[symbol]`) — P2, ships third

**Goal:** polish the strongest current page. Mostly motion + small fixes.

- **Hero spread number:** add tick-flash on update, counter morph on EWMA tick.
- **State-pip ring:** on a transition (e.g., drift → depeg), pip emits an iridescent ring pulse (single emission, not loop).
- **Threshold ladder:** add a faint moving marker (the asset's exact bps position) that animates left/right on update.
- **Activity timeline:** each row gets a 30-second sparkline thumbnail showing the moment of transition. Live row (most recent) has a faint iridescent left border that pulses once when it lands.
- **Safety grade:** make the big letter (A/B/C) the second eye-magnet on the page. Increase size by ~30%. Add a single iridescent underline.
- **"How it's priced" math block:** typeset the formula better. Use proper subscripts/superscripts for `α=0.3`. Mono code remains for the input/output lines.
- **Identity row:** group class/decimals/peg target/last-updated as a 4-up stat strip (like the hero stat strip), not stacked left.
- **"Take it further" 4-up CTA grid:** unchanged, already the model.
- **Footer:** compact variant.

### 5.4 Compare (`/compare`) — P2 same wave

**Goal:** kill the empty state.

- On load with 0 assets selected: render the **"Major LSTs" preset as a faint preview** showing jitoSOL + mSOL + bSOL + JupSOL overlay chart at 30% opacity, with a prompt `Pick a preset or add assets to begin.` Clicking the preset locks the preview in.
- Once assets are selected, the comparison chart is the eye-magnet. Add a `SAVE AS WATCHLIST →` affordance.
- Compact footer.

### 5.5 Methodology (`/methodology`) — P3

**Goal:** add the pipeline diagram.

- Insert a full-width SVG pipeline diagram between the hero and the "Intrinsic value" section. Sanctum/Pyth/Hylo/Jupiter → engine (with EWMA notation) → spread → FSM → alert. Iridescent on the alert arrow.
- Add a sticky TOC on the left (anchors: intrinsic, market, spread, honesty, open).
- Promote the "Open" CTA row to a full-width band with the gradient stripe above.
- Default footer variant.

### 5.6 Status (`/status`) — P3

**Goal:** kill the whitespace.

- Replace "By state" counters with a **stacked horizontal bar** showing the proportion of PEGGED / DRIFT / DEPEG / CRITICAL / UNKNOWN.
- Add a 7-day per-source uptime sparkline strip beneath the data sources table.
- Add a "Recent alerts (24h)" histogram bottom of page — bars by hour.
- Make the LIVE pip in data sources pulse on heartbeat (already infrastructured via WS).
- Default footer variant.

### 5.7 Events (`/events`) — P3

**Goal:** make it replayable visually.

- Add a **GitHub-style heatmap calendar** at the top — 365 cells, color intensity by event count, hover → date + count.
- Per-row: add a 24h spread sparkline thumbnail at the moment of the event.
- Add a date-range jump (month/year picker).
- Default footer variant.

### 5.8 Embed (`/embed`) — P3

**Goal:** sell the badge.

- Promote the preview from a small card to a **full-width specimen strip** showing all 4 asset/theme combos side-by-side at full badge size.
- Move "Why embed it?" up next to the specimen strip.
- Keep the form (Asset/Theme/Sparkline) but move below.
- Default footer.

### 5.9 Developers (`/developers`) — P3

**Goal:** make the docs page feel like a developer site.

- Add **syntax highlighting** to all code blocks. Iridescent on keywords like `wss://`, `curl`, `subscribe`.
- Add a `Try it →` button next to each REST endpoint that opens a simple in-page response preview.
- Tighten the Webhooks SOON section with a "waitlist" form.
- Default footer.

### 5.10 Learn / Case studies (`/learn`) — P3

**Goal:** fill the 2-column hole.

- 4-up grid OR single-row horizontal scroll, not 2-column with one empty cell.
- Each card gets a small annotated chart preview of the depeg event.
- Add a filter/sort row above the grid.
- Default footer.

### 5.11 About (`/about`) — P3

**Goal:** fill the void below the reach-out pills.

- Add a "**Working on right now**" widget pulled from the last 3 changelog entries.
- Optional: add a one-line signature or photo for personality (solo founder card).
- Default footer.

### 5.12 Changelog (`/changelog`) — P3

**Goal:** small polish.

- Make tags (FEATURE/FIX/INTERNAL) clickable filters.
- Add an RSS feed link in the page header.
- Default footer.

---

## 6. Ranked TODO — execution order

Effort estimate uses **t-shirt sizing**: XS (<2h), S (2-6h), M (6-16h), L (16-40h), XL (40h+).

### P0 — Landing wave (foundation + landing) — total ~M+L

| ID | Task | Size | Depends on |
|---|---|---|---|
| L0.1 | Add GSAP + ScrollTrigger + Flip + Observer to `web/package.json`. SplitText optional (Club license — decision needed). Dynamic-import wrapper helper at `web/lib/motion/gsap.ts` that registers plugins once. | XS | — |
| L0.2 | Foundation: color tokens update (surface ladder, body-text color), no-shadow audit, weight cap to 400+600. Edit `web/app/globals.css` + grep & remove stray weights/shadows. | S | L0.1 |
| L0.3 | Foundation: footer variants. Refactor `site-footer.tsx` to accept `variant: "full" | "compact" | "default"` (default value = "default"). Map variants per page. | S | — |
| L0.4 | Foundation: motion utilities. Build `tick-flash`, `counter-morph`, `state-pip-pulse-ring` as reusable hooks/components at `web/lib/motion/`. | M | L0.1 |
| L0.5 | Landing hero: replace stats row with single anchor number + iridescent underline + SplitText reveal. Wire to `/v1/stats` live value. | S | L0.2, L0.4 |
| L0.6 | Landing hero: mouse-tracked iridescent radial spotlight refinement (audit existing). | XS | L0.2 |
| L0.7 | Landing hero: live asset ticker preview card (rotate every 5s, sparkline draw-in). | M | L0.4 |
| L0.8 | Logo marquee: replace CSS keyframes with GSAP + Observer. Add 2nd counter-scrolling row. Hover tooltip. | M | L0.1 |
| L0.9 | "In 30 seconds" 3-column: add mini live visualizations per column. | M | L0.4 |
| L0.10 | Methodology accordion: add mini SVG pipeline diagram inside first expanded row. | S | — |
| L0.11 | Universe grid: add sparkline to every card. Hover → expand to 7-day. Sticky filter chip row. Order critical → pegged. | M | L0.2 |
| L0.12 | "Get pinged" CTA: Telegram message typing animation + tick-flash on the spread number. Iridescent stripe commitment. | S | L0.4 |
| L0.13 | Wordmark closer: faint scroll-parallax (ScrollTrigger). | XS | L0.1 |
| L0.14 | Reduced-motion contract: extend `prefers-reduced-motion` to wrap all new GSAP timelines. Verify on landing. | S | L0.1-L0.13 |
| L0.15 | Playwright visual regression: capture all 13 pages after landing PR; confirm no inner pages regressed. | S | — |
| L0.16 | Lighthouse: confirm landing CLS, LCP, INP didn't degrade (GSAP+Observer should be ≤+5kb impact). | XS | L0.15 |

**Estimated total P0:** ~3-5 days of focused work for one engineer. Landing PR is large but coherent.

### P1 — Dashboard wave — total ~L

| ID | Task | Size | Depends on |
|---|---|---|---|
| D1.1 | Top peg-health strip — 23 micro-pips, full-bleed, tick-flash on transition. | M | L0.4 |
| D1.2 | Hero anchor `8 OF 23` + editorial sentence + 3-stat strip. Counter morph wired to live data. | S | L0.5 (pattern proven on landing) |
| D1.3 | Active strip — convert text row to 2-3 mini-charts with sparkline + ticking spread + pip pulse. | M | L0.4 |
| D1.4 | Compare watchlist sticky shelf. | S | — |
| D1.5 | Filters faceted chips (class, state, safety) replacing search + 4-state row. | M | — |
| D1.6 | Table treatment: hover row → side preview panel slide-in (Flip from row position). | L | L0.1 |
| D1.7 | Table sort + view toggle Flip animations. | M | L0.1 |
| D1.8 | Mobile default = mosaic mode. Filters become bottom sheet. | M | L0.4 |
| D1.9 | Live alerts sidebar — recency-intensity color coding + size variance. Mobile horizontal scroll shelf. | M | — |
| D1.10 | Footer = compact variant on dashboard. | XS | L0.3 |
| D1.11 | Playwright regression + Lighthouse for dashboard. | S | — |

**Estimated total P1:** ~4-6 days. Largest single task is D1.6 (hover preview panel) — it's the cross-component hover linking graft from direction C.

### P2 — Asset + Compare wave — total ~M

| ID | Task | Size | Depends on |
|---|---|---|---|
| A2.1 | Asset hero spread number: tick-flash + counter morph. | S | D1.2 pattern reuse |
| A2.2 | State pip ring pulse on transition (replace current `pip-pulse` infinite). | S | L0.4 |
| A2.3 | Threshold ladder: animated marker on bps position update. | S | L0.1 |
| A2.4 | Activity timeline: per-row 30s sparkline thumbnail + iridescent left-border on live row. | M | — |
| A2.5 | Safety grade: 30% larger, iridescent underline. | XS | — |
| A2.6 | How-it's-priced math typeset (subscripts/superscripts). | XS | — |
| A2.7 | Identity row: 4-up stat strip layout. | XS | — |
| C2.1 | Compare empty state: faint "Major LSTs" preview overlay + `SAVE AS WATCHLIST` after selection. | M | — |
| AC2.2 | Footer = compact variant on asset + compare. | XS | L0.3 |
| AC2.3 | Playwright + Lighthouse. | S | — |

**Estimated total P2:** ~2-3 days.

### P3 — Secondary pages wave — total ~M

| ID | Task | Size | Depends on |
|---|---|---|---|
| M3.1 | Methodology: SVG pipeline diagram. | M | — |
| M3.2 | Methodology: sticky TOC left nav. | S | — |
| M3.3 | Methodology: "Open" CTA band promotion. | XS | — |
| S3.1 | Status: stacked horizontal bar for By-state. | S | — |
| S3.2 | Status: per-source 7-day uptime sparkline. | M | — |
| S3.3 | Status: 24h alerts histogram. | S | — |
| S3.4 | Status: LIVE pip heartbeat pulse. | XS | L0.4 |
| E3.1 | Events: GitHub-style heatmap calendar. | M | — |
| E3.2 | Events: per-row 24h sparkline thumbnail. | M | — |
| E3.3 | Events: date-range picker. | S | — |
| EM3.1 | Embed: specimen strip (4-up combos). | S | — |
| EM3.2 | Embed: "Why embed" promoted next to specimen. | XS | — |
| DV3.1 | Developers: syntax highlighting in code blocks. | S | — |
| DV3.2 | Developers: `Try it →` per-endpoint preview. | M | — |
| L3.1 | Learn: 4-up grid + chart preview per card + filter row. | M | — |
| AB3.1 | About: "Working on right now" widget. | S | — |
| CH3.1 | Changelog: clickable tag filters + RSS link. | S | — |
| ALL3 | Default footer variant applied per spec. | XS | L0.3 |

**Estimated total P3:** ~3-5 days, parallelizable across pages.

### Total scope

**~12-19 working days** for one engineer. Calls it 3-4 weeks calendar if shipping in waves with review between each.

---

## 7. Open decisions

1. **SplitText license.** Pay $99/yr for Club GreenSock or hand-roll a char-splitter? Recommendation: pay if a card is available; the catalog buys more than just SplitText.
2. **Editorial serif font for methodology (P3).** Worth piloting now or defer? Recommendation: defer — landing wave is already large.
3. **Pro/Lite toggle (D1.x).** Ship in P1 dashboard wave or defer to its own P4? Recommendation: defer — get Pro-only landing first.
4. **Mobile peg-health strip.** Does the 23-pip strip survive at 390px width? Each pip would be ~12px. Recommendation: yes, with horizontal scroll if needed. Validate in implementation.
5. **GSAP bundle gate.** Should the landing page be the only one paying the ~42kb GSAP cost, or should we land it globally? Recommendation: dynamic-import per route, but acknowledge dashboard + landing both need most of it.

---

## 8. Out of scope (deliberately)

- New page additions (e.g., blog, postmortems, watchlist standalone). The 13 existing pages cover everything.
- Authentication / personalized watchlists persisted server-side. Local storage is fine for v1.
- Mobile-app shell. Web-only.
- Brand identity changes — wordmark, color tokens core meaning, gradient stops all stay.
- API redesign. The frontend works around what the backend already serves.

---

## 9. Follow-up mocks (before each wave)

Before opening implementation on dashboard / asset / inner pages, **add GSAP animations to their respective mocks** in the brainstorm companion and get user approval per page — same treatment landing got. Sequence:

- Before P1 dashboard wave → add GSAP to `mock-02-dashboard.html` (peg-strip live tick, anchor counter, active-strip charts draw-in, table Flip on sort, hover preview slide-in, alert recency fade-in). Get approval.
- Before P2 asset/compare wave → add GSAP to `mock-03-asset.html` (hero pip ring pulse, threshold ladder marker animate, timeline row sparkline draw-in, safety A grade reveal). Compare empty-state fade overlay. Get approval.
- Before P3 secondary pages wave → add GSAP to `mock-04-inner-pages.html` (heatmap cell fade-in, pipeline arrows, status histogram bars, embed specimen specimen reveal). Get approval.

This is the user's stated pacing preference (memory: `feedback_design_pacing.md`). Do not batch.

## 10. References

- Audit screenshots: `docs/design-research/audit-2026-05-22/current/`
- Per-page critique: `docs/design-research/audit-2026-05-22/critique.md`
- External recon (refero + benchmarks + GSAP patterns): `docs/design-research/audit-2026-05-22/recon.md`
- Design lineage: `docs/superpowers/specs/2026-05-21-frontend-design.md` (the v1 contract)
- Implementation plan v1: `docs/superpowers/plans/2026-05-21-frontend-implementation.md`
- Memory: `feedback_design_pacing.md` (landing-first sequencing)
