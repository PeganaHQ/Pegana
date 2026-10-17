# Pegana — Per-page design critique
> Captured 2026-05-22 from local dev (`http://localhost:3000`) at 1440px and 390px. Screenshots in `./current/`.

## What's working across the board (don't break)

- **Editorial typographic posture.** Every page leads with a confident lowercase-punctuation h1. "Catch a depeg before it catches you." / "Stack assets. Spot drifts." / "Every depeg, replayable." / "Two numbers, one truth." This is the strongest part of the brand voice — keep it, lean harder.
- **Numbered section markers** `(01) (02) (03)` give the product an instrument-spec feel. They work.
- **Iridescent gradient is restrained.** Reserved for hero spotlight + BrandMark dot + CTA primary + cta-bridge stripe. Holds up.
- **Mono ⨉ sans pairing** signals "lab notebook, not casino." Reads as competent.
- **0-radius geometry** is committed everywhere. No compromise.
- **Dense data tolerated**, not feared. The dashboard table is the proof — 23 rows, sparkline + state pip + spread + safety + class, and it doesn't crash.
- **jitoSOL page is the model.** Threshold ladder + spread chart + how-it's-priced explainer + 30d strip + activity timeline + peer table + safety grade + identity + "take it further". Information architecture is genuinely good here.

## Cross-cutting weaknesses (apply to most pages)

### 1. Almost no live signal
For a real-time product, **nothing on the page proves it's live**. WS connects in the background but the UI is silent: no ticking heartbeat, no pulse when data arrives, no last-updated badge counting up, no shimmer on the row that just flipped. State pip has a `pip-pulse` keyframe but it's the only motion. The user has to trust a footnote that says "live."

### 2. Motion stops at mount
Framer-motion is used for entrance animations and then nothing happens. No scroll-driven motion, no scrub, no kinetic transitions between sections, no FLIP on table-row reorder, no SplitText reveal. Once content lands, the page is a poster. For a product that wants to feel like a Bloomberg-of-Solana, this is the biggest miss.

### 3. Hero stats are too quiet
Landing hero number row (`23 ASSETS LIVE / 95 ALERTS / 0.7s LATENCY / 99.97% UPTIME`) is rendered at the same weight as small labels. Compare to Linear/Vercel: the **anchor metric** should hit at ~80-120px and animate in on scroll. Right now the hero is "Catch a depeg" + a tiny stats strip. The number that should be the eye-magnet — `8 of 23 outside threshold` or `12 detections this week` — isn't on the landing at all.

### 4. Sparklines missing where they matter most
Universe grid on landing has 23 cards showing only `symbol / class / spread / state pip`. **No sparkline.** This is the product's signature visualization and it's absent from the place that says "here's what we watch." Dashboard mobile **also strips sparklines** to save space — but the spread number alone doesn't communicate trajectory. Mosaic mode would solve this but isn't the mobile default.

### 5. Empty states crash pages
- `/compare` with 0 assets selected is 90% empty: a paragraph, 4 preset buttons, then footer. Should immediately show a starter overlay with the "Major LSTs" preset rendered as a preview chart.
- `/status` "no recorded incidents" leaves 50vh of nothing.
- `/learn` has 3 case studies and the rest of the row is dead space.
- The footer is doing the heavy lifting of "make page tall enough."

### 6. Footer too heavy
5 columns + brand + license stripe takes ~25% of every page on first paint. Should compress to 2-3 columns on most pages, full only on landing/about.

### 7. No hover/interaction reward
Table rows don't visibly respond to hover (or response is invisible). No quick-action affordance (★ pin, ⤴ open chart). No row→detail micro-interaction.

### 8. "Active" row on dashboard buries critical signal
`• ACTIVE - 2  xSOL +11.2%  sUSD +2.16%` is treated as a text line. Should be a **live strip chart** at the top of the page — two sparkline thumbnails, ticking, with state pips pulsing.

### 9. Methodology page is text-only
For a "scientific" product, the methodology page should ship a **diagram of the pipeline**: Sanctum/Pyth/Hylo/Jupiter → intrinsic + market → EWMA → spread → hysteresis FSM → alert. Right now it's prose + tables.

### 10. Brand is monochrome at scale
The iridescent is rationed to 5-6 surfaces. The product would benefit from one more brand-energetic surface — e.g., a **kinetic data wall** below the hero where 23 mini-sparklines animate in on scroll-trigger and the iridescent draws across them.

---

## Per-page critique

### Landing (`/`) — strongest current page, lowest ceiling left

**Works**
- Hero composition with mouse-spotlight + dot grid + iridescent.
- Editorial h1 with iridescent on second line.
- "STACK ON ONE CHART" CTA copy on the universe grid is good.
- Wordmark closer is bold.

**Doesn't work**
- Hero asset preview (bSOL card top-right) is a static thumbnail. Should be a **live ticker** with the asset rotating every 4s, sparkline drawing as it changes.
- Stats row (23/95/0.7s/99.97%) is undersold — make ONE of these the anchor (`8 of 23 OUTSIDE THRESHOLD NOW`) at 88px and animate the count.
- "In 30 seconds" 3-column explainer is text-text-text. Each column should have a tiny live mini-visualization (sparkline of intrinsic, sparkline of market, alert envelope).
- Logo marquee mid-page (Sanctum, Jupiter, hylo, JITO, Marinade, drift, SOLANA, Circle, PYUSD, Ethena, WORM..) is single-row + grayscale. Add a second row counter-scrolling, and treat hover as "this is what we read from them" tooltip.
- Methodology accordion is fine but visually a dead zone — nest the pipeline diagram inside the first row.
- Universe grid cards have no sparkline (fix per cross-cutting #4). Hover should preview the 24h chart inline.
- "Get pinged" Telegram simulation card is small. Should be wider, with the iridescent stripe more committed (currently it's understated). Add the actual alert text being typed in.

**Mobile (390)**
- Hero scales well. Stats wrap. Asset preview gone. OK.
- Universe grid is single column — fine but each card should keep the sparkline.

### Dashboard (`/dashboard`) — the +100% target

**Works**
- `8 of 23 outside threshold` is a strong anchor number. Tracked/Alerts/Median spread/Widest row is good context.
- Active strip with 2 assets is a good idea conceptually.
- Asset table with sparklines is the bread and butter.
- Live alerts sidebar streams. Good.
- Mosaic/Table toggle exists.

**Doesn't work**
- Anchor number `8` is rendered as a large text block but doesn't feel "live." Should **count up/down** when state transitions and have a faint iridescent rim during a transition.
- Active strip is text only (`xSOL +11.2%`). Should be: thumbnail sparkline + ticking spread + state pip pulsing, repeated for each active asset. Tap → modal with full chart.
- Compare watchlist row (`jitoSOL mSOL bSOL hyUSD +1 more` STACK ON ONE CHART →) is a great affordance buried in a single line. Promote it to a sticky shelf.
- Search input is the only filter affordance — needs faceted filters (class, peg target, state, safety grade) as chips with counts.
- Table sort indicator (▼) on Spread is the only visible sort. Should be sortable on every column with affordance on hover.
- Hover state on rows is invisible. Need a row-level highlight + quick-action column (★ watchlist, ↗ open detail, ⊕ add to compare).
- "Live alerts" sidebar treats every alert as the same weight. Critical alerts should be bigger, drift smaller. Color-code by recency intensity.
- Mosaic mode unexplored — should be the **default for new visitors** because it's more visual (24 cards with sparklines, state pip, spread; same data different density).
- No time-of-day band on the spread number — "you're seeing US market hours" or "low volume period" context is missing.

**Mobile (390)**
- Anchor number scales OK.
- Active strip wraps tightly.
- Asset table works but **loses sparklines** — mobile default should be Mosaic.
- Live alerts list goes below table, scrolls. Acceptable.
- No floating filter sheet — when you tap a class chip you get the whole page redraw. Needs a sticky filter bar.

### Asset detail (`/asset/[symbol]`) — closest to "FODA" already

**Works**
- Hero: huge `-28 bps` + `drifting` pip + last-updated. The model for every other anchor on the site.
- Threshold ladder horizontal bar with the asset's position is one of the strongest visualizations in the product.
- Spread chart with toggle (1h/24h/7d/30d/baseline/area/line/candle) is well-built.
- "How jitoSOL is priced" 2-col intrinsic/market explainer is the right idea (this should be on landing too).
- 30-day state strip is dense and honest (gaps shown).
- Activity timeline is great UX but visually flat.
- Peer comparison table tight.
- Safety grade with single big letter is iconic.
- Identity row with copy + Solscan + JSON/CSV downloads is exactly right.
- "Take it further" 4-up footer-CTA grid is a model for action-affordance.

**Doesn't work**
- Activity timeline rows are text-text. Each row should have a tiny **30-second sparkline** of that transition moment + a 1px iridescent stripe on the row that just landed (live).
- "How it's priced" math block (`spread = 1 - market ÷ intrinsic, smoothed with EWMA α=0.3`) is a code-style block. Could be a typeset formula with LaTeX-feel glyph treatment.
- Safety grade A is bold, but the 3 dots (3/3, 3/3, 3/3) are tiny. The grade card could fill more space — make this a full-width hero band.
- Identity row's class/decimals/peg target/last updated are stacked left — feels like a wireframe. Group them as a 4-up stat strip like the hero.

**Mobile (390)** — already strong, just polish
- Hero spread `-29 bps` is huge and works.
- Chart shrinks well.
- Threshold ladder ok.
- Activity timeline tight.

### Compare (`/compare`) — broken empty state

**Works**
- Hero "Stack assets. Spot drifts." is good.
- 4 presets + Add asset + watchlist is the right model.

**Doesn't work**
- **Empty state kills the page.** 90% blank. Should immediately render the "Major LSTs" preset as a faint preview overlay with a prompt "or pick another." Like Figma's homepage starter.
- After selecting assets, the comparison chart should be the eye magnet — but we haven't seen that state yet. Audit pending: walk through filled state.
- No save-as-watchlist affordance once you build a comparison.

### Methodology (`/methodology`) — text-heavy, opportunity

**Works**
- Five labeled sections (intrinsic / market / spread / honesty / open) are clean.
- "Honesty about limits" is a beautiful piece of voice — keep it, promote it.

**Doesn't work**
- No diagram. The product is a pipeline; show the pipeline. Sanctum/Pyth/Hylo/Jupiter → engine → spread → FSM → alert. SVG with arrows, mono labels, iridescent on the publish arrow.
- "Open" section CTAs at the bottom (SOURCE GITHUB, SPEC V1, ASSETS.TOML, ROADMAP, LIVE STATUS) are pill buttons that feel disconnected from the page. Promote to a full-width "what's open" band.
- No table of contents on the left. For a long-form page with 5 named sections, anchor nav is missing.

### Status (`/status`) — too much whitespace

**Works**
- "All systems operational." is the right hero.
- Data sources table is honest (LIVE pip, last-tick).
- By-state row with PEGGED/DRIFT/DEPEG/UNKNOWN counts is dense.

**Doesn't work**
- 50vh blank below "no recorded incidents." Fill with: 7-day uptime sparkline per source, per-source latency histogram, last-30-days alert counts.
- "By state" is text counters. Should be a **donut or stacked bar** at this scale — a visual proportion read in 200ms.
- Data sources LIVE pip is non-pulsing. Should pulse on heartbeat.

### Events (`/events`) — flat list, scrolls forever

**Works**
- "Every depeg, replayable." is a perfect tagline.
- Filter chips (ALL / LSTs / Stables / Synthetic) work.
- Per-row event count + worst-state is informative.

**Doesn't work**
- Rows are uniform text. Should have a per-day spread sparkline thumbnail per row (the 24h band).
- No date-range jump (year/month picker). For "replayable" you want time navigation.
- No heatmap calendar (GitHub-style) showing where the depegs cluster across time.

### Embed (`/embed`) — preview too small

**Works**
- Asset/Theme/Sparkline form on the left is clean.
- Real iframe preview on the right is honest.
- HTML + Markdown + React snippets with copy buttons cover the bases.

**Doesn't work**
- Preview is a small badge in a mostly-empty box. **Make the preview big** — full-width strip at the top with all 4 asset/theme combos previewed side-by-side, like a typography specimen.
- "Why embed it?" + Parameters table at the bottom is bullet-text-after-the-fold. Move "Why embed" up next to the preview.

### Developers (`/developers`) — works as docs, dull as UI

**Works**
- REST endpoints table with method + path + description.
- WS code block.
- One-liner examples cover the common cases.
- Resources pill-cards at the bottom.

**Doesn't work**
- Code blocks are monochrome. **Add basic syntax highlighting** with the iridescent on the `WSS://` / `curl` keywords.
- No "Try it" interactive REPL or response preview.
- Webhooks SOON tag is good but the section feels placeholder — could ship a tiny "request a key" form for waitlist.

### Learn / Case studies (`/learn`) — 3 cards floating in space

**Works**
- 3 case studies are well-summarized.
- The framing "Pegana didn't detect these live" is honest.

**Doesn't work**
- 3 cards in a 2-column grid leaves a hole. Should be a 4-up or single-row scroll.
- Cards are static. Each should preview a tiny annotated chart of the depeg event.
- No filter or sort affordance.

### About (`/about`) — minimalist, mostly empty

**Works**
- "A peg watchdog you can read." is a great line.
- Author / Built with / Status / Hosted on / License / Funding strip is exactly right.

**Doesn't work**
- 60vh of dead space below the reach-out pills.
- Could host a small "what I'm working on this week" widget pulled from the changelog.
- No photo or signature touch — solo founder line invites personality, page delivers anonymity.

### Changelog (`/changelog`) — fine, could be more alive

**Works**
- Date + tag (FEATURE/FIX/INTERNAL) + bullet content is clean.

**Doesn't work**
- No RSS or "subscribe" affordance.
- Tags don't filter the feed. Should be clickable.
- No "previous version" anchor links.
