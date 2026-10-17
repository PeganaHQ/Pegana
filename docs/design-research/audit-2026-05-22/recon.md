# Pegana Design Recon — 2026-05-22

Recon for the top-tier redesign push. Pegana's identity stack: canvas-black `#000`, iridescent gradient stripe (`#feed7a → #ff8400 → #df91f7`), zero-radius geometry, monospace + sans pairing, mouse-tracked spotlight, dot-grid background, state-pip pulse, EWMA-smoothed numbers, audience = Solana power users (LST holders, market makers, integrators).

Everything below is filtered through that lens. No generic praise — every reference includes "what to steal".

---

## 1. refero.design pull

### 1.1 [Linear — Midnight Command Center](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)
- **Original:** [linear.app](https://linear.app)
- **Why it matters for Pegana:** This is the closest tonal sibling to Pegana — dark, layered, single-accent (neon lime `#e4f222`), surgical use of color. We are already neighbors visually; Linear shows what disciplined restraint looks like at the highest level.
- **Steal:**
  - **One accent, used like ammunition.** Linear restricts neon lime to primary CTAs and active states only. Pegana's iridescent gradient should be treated the same — never decorative, only signal. Rule: "if it's not a CTA, a live state, or the brand stripe, no gradient."
  - **Layered surfaces.** Charcoal base `#08090a` → graphite `#0f1011` → slate `#161718`. Three-step depth ladder rather than borders. We currently use borders + canvas — switch dashboard cards to a 3-step surface ladder on `#000`.
  - **Berkeley Mono for code/data.** Inter Variable for UI, Berkeley Mono for snippets/numbers. We're already on this pairing — Linear validates the choice.
  - **Compact density.** 4px base, 8px element, 24px section. Pegana currently uses wider section gaps; tighten everything below the hero.

### 1.2 [Sequel — Black Canvas, Sharp Typography](https://styles.refero.design/style/1bd3b2ba-9ad9-44ed-9130-03f9d94de821)
- **Original:** [sequel.co](https://sequel.co)
- **Why it matters for Pegana:** Pure black `#000` background (not Linear's near-black), 0px-radius on standard cards, sans + serif pairing where serif lives only above 32px. This is our exact canvas philosophy.
- **Steal:**
  - **0px radius as a system rule.** Sequel uses 0px on regular cards and 9999px on pill components only — no in-betweens. Pegana already commits to 0px; reinforce it by killing every stray `rounded-md` in the codebase.
  - **Serif for one job only.** They use Bradford serif ONLY for 32px+ headlines with -0.05em tracking. Worth piloting an editorial serif headline on the landing hero alongside our current mono/sans, to break the "pure tech" tone and add gravitas.
  - **No saturated color anywhere except the brand moment.** Sequel is pure grayscale + one signal. Pegana should keep the iridescent gradient as the only chromatic event on the page.

### 1.3 [Mercury — Mountain Top Command Center](https://styles.refero.design/style/3172cd4d-118a-4a16-a259-6b634d32322e)
- **Original:** [mercury.com](https://mercury.com)
- **Why it matters for Pegana:** Dark fintech, monochrome with single Mercury Blue `#5266eb` accent, generous 80-120px section gaps, "elevation through opacity not shadow". Different density posture (more spacious) but same restraint.
- **Steal:**
  - **Elevation by opacity, not shadow.** Mercury never uses `box-shadow` to lift cards — they shift the surface color by ~3-4%. On a true `#000` canvas, shadows are useless anyway. Adopt: `bg-[#0a0a0a]` for elevated, `bg-[#141414]` for hover-elevated.
  - **Display font at light weight.** They run headlines at weight 360 (essentially light). On a black canvas this reads as "expensive", not "thin". Pegana hero headlines should test a 300-400 weight, not 600.
  - **Atmospheric hero, stark functional UI below.** Hero gets the mood, every section below is brutal data. We currently leak hero mood into the dashboard — separate them.

### 1.4 [Dimension — Deep-Space Command Center](https://styles.refero.design/style/fbcf9cbb-7c6b-449d-862a-bce521a8ab1d)
- **Original:** [dimension.dev](https://dimension.dev)
- **Why it matters for Pegana:** Near-black `#0a0a0a`, Geist + DM Sans, backdrop-blur for depth instead of shadows. Strong "instrument panel" feel.
- **Steal:**
  - **Backdrop-blur translucent panels.** `backdrop-filter: blur(4px)` over translucent grays gives the "glass console" effect. Reserve for the asset detail flyout / command palette. Don't use everywhere — it kills legibility on dense tables.
  - **Avoid opaque accent fills.** Their accent colors live in low-opacity gradients only. Pegana's iridescent gradient should appear as a stripe and as low-opacity glows around state pips, never as a solid block.
  - **Reject pure white text.** Ghost White `#e5e5e5` for body, `#ffffff` only for interactive states. We currently use `#fff` too aggressively — drop body text to `#e8e8e8` and reserve `#fff` for hover/active.

### 1.5 [Raycast — Backlit Glass Panels](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8)
- **Original:** [raycast.com](https://raycast.com)
- **Why it matters for Pegana:** The most extreme dark canvas reference — `#040506` void. Tactile keyboard-key shadows. Sparse accent `#FF6363` for status, not CTAs. This is exactly the "scientific instrument" tone we want.
- **Steal:**
  - **Keyboard-key shadow recipe.** `rgba(0,0,0,0.4)` outer + `rgba(255,255,255,0.2)` inset top highlight makes UI feel physically pressable. Apply to the command palette items and sort-mode toggle.
  - **Tracking-as-hierarchy.** Display headlines at `-0.13em`, micro labels at `+0.073em`. Loose tracking on small caps reads as "instrumentation label". Pegana's table column headers should use uppercase mono at `+0.06em`.
  - **Radial gradients for atmosphere.** They use blue/violet radial gradients at very low opacity for depth. Pegana can replace the hero's solid spotlight with a low-opacity iridescent radial pinned to mouse position.
  - **Brand color is for status, not CTAs.** Pegana should consider: gradient stripe = brand/state, but CTAs = white-on-black, not gradient. The gradient becomes scarcer = more powerful.

### 1.6 [Anthropic — Research Journal on Warm Stone](https://styles.refero.design/style/d469cba4-c448-4a43-a033-883f8bfcdc42)
- **Original:** [anthropic.com](https://anthropic.com)
- **Why it matters for Pegana:** Not dark, but worth stealing for the "scientific paper" gravitas. Word-level underline replaces color as emphasis. Editorial serif headlines inside dark feature cards.
- **Steal:**
  - **Word-underline emphasis.** Instead of bolding or coloring key terms in body copy, use thick `text-decoration: underline` with `text-underline-offset: 4px`. Apply on the methodology page — feels like a printed white paper.
  - **Editorial cards inside the page.** Anthropic alternates ivory background with dark `#141413` cards holding serif display copy. Pegana inversion: keep `#000` canvas, drop a single ivory card with serif headline for the methodology section. Massive contrast hit.
  - **Mono for metadata only.** They use Anthropic Mono only for `DATE`, `CATEGORY` labels — uppercase, 16px, structural. Pegana already does this for table headers; extend to article/post metadata blocks.

### 1.7 [(dot)connect — High-Contrast Digital Blueprint](https://styles.refero.design/style/981d90e9-7be3-497f-a899-52a0a9ec16f4)
- **Original:** [dotconnect.vc](https://dotconnect.vc)
- **Why it matters for Pegana:** Engineering-focused, technical authority through compressed type, abstract 3D/data renders as imagery. Flat surfaces, no shadows.
- **Steal:**
  - **3D data renders as hero imagery.** Instead of stock illustrations or screenshots, use abstract data-driven 3D renders (depeg event surface? volatility cloud?) as atmospheric background. R3F or pre-rendered MP4.
  - **Goldenrod accent NEVER on CTAs.** They reserve their orange `#fd5321` for highlight backgrounds and decorative accents, NOT primary actions. Pegana already does this with the iridescent stripe — keep that discipline.
  - **No drop shadows, full stop.** Flat surfaces, color/border for hierarchy. Confirms our 0-radius + no-shadow stance.

### 1.8 [Antimetal — Electric Storm Over Blueprint](https://styles.refero.design/style/9f9a4a4f-1a27-47ca-a65b-68b9850a84e4)
- **Original:** [antimetal.com](https://antimetal.com)
- **Why it matters for Pegana:** Dramatic dark hero that SNAPS to a light functional UI below the fold. Chartreuse pulse `#d0f100` reserved exclusively for primary CTAs. Cropped dashboard screenshots inside cards.
- **Steal:**
  - **Theme break between hero and product.** Dark hero → light product preview is jarring in the right way. Pegana inverse possible: dark `#000` hero, then a hyper-dense pure-black dashboard preview at higher contrast.
  - **Cropped dashboard screenshots inside 20px-radius cards** — but we go 0px. Steal the framing pattern: real product UI inside rectangles, scaled to ~60% viewport width, anchored left or right.
  - **Blue-tinted shadows instead of black.** When we eventually use elevation (e.g., the command palette overlay), use `rgba(254,237,122,0.04)` shadows to match the gradient warm tone, not black shadows. Black-on-black is invisible anyway.
  - **Display serif above 32px only, ivar-style.** They use `ivarTextFont` with OpenType alternates (ss04, ss06...) at display sizes only. Consider an editorial serif (e.g., Fraunces, IvarText) for hero headlines.

### 1.9 [Monad — Softly Lit Control Panel](https://styles.refero.design/style/fc84e9f0-2058-4a0a-8d26-9cc1ba84ec9c)
- **Original:** [monad.com](https://www.monad.com)
- **Why it matters for Pegana:** Blockchain-adjacent (not directly relevant — they're an L1). Mono-as-primary-body-text approach. Negative tracking signature on headings.
- **Steal:**
  - **ABC Diatype Mono as PRIMARY body, not just code.** Most sites use mono only for snippets. Monad uses mono as UI body text. Pegana already leans this way; commit fully on the methodology and developers pages — body copy in mono, headlines in sans.
  - **Three-typeface stack: mono + serif + sans.** They run ABC Diatype Mono (UI), Untitled Serif (display), Untitled Sans (alt body). Pegana currently runs mono + sans. Adding a serif for the editorial pages (methodology, blog, postmortems) would deepen the "scientific journal" tone.
  - **Negative tracking `-0.02em` on all headings.** Compressed elegance. Already a frontend-design-guidelines default.

### 1.10 [ORYZO AI — Cork Coaster in a Blackout Studio](https://styles.refero.design/style/1f204e95-454a-437e-845b-c1b169d35607)
- **Original:** [oryzo.ai](https://oryzo.ai)
- **Why it matters for Pegana:** Single-object photographic hero on near-black canvas. Character-by-character text reveals. Full-bleed dark panels with diagonal headline/body composition.
- **Steal:**
  - **Single hero "object" with rich render.** They lean entire site on ONE physical object (coaster) photographed at studio quality. Pegana equivalent: a single hero 3D render of an LST peg surface or oracle network graph, used as the sole visual centerpiece. Stop using multiple feature screenshots.
  - **Character-by-character reveals at 0.3s ease.** Their text reveal is per-character, not per-word. Switch SplitText approach (see GSAP section) for landing headlines.
  - **All-ease, no spring.** "All transitions use ease timing function" — no bounce. Pegana's framer-motion uses spring physics by default. For financial UI, ease feels controlled; spring feels like a toy. Audit our motion easings.
  - **Stacked headline + body diagonal.** Headline top-left, body center-right creates diagonal tension. Currently our hero is centered/stacked. Worth a layout experiment.

### 1.11 [Seline Analytics — Crisp Data Canvas](https://styles.refero.design/style/7967c6d9-e50c-42b5-b4d1-74003ba41781)
- **Original:** [seline.so](https://seline.so)
- **Why it matters for Pegana:** Light-mode dashboard but the data-presentation discipline translates: single vivid accent for active states, cards with subtle shadows, abundant negative space inside dense data.
- **Steal:**
  - **Single active-state color.** Their Chartwell Blue `#3ba6f1` only marks active filters and selected states — not just CTAs. Pegana should use a single gradient hue (probably `#ff8400` — the middle stop) for active tab/sort indicators.
  - **48px section gaps + 24px card padding.** Even on dense dashboards, give cards air. We currently compress too tight.
  - **Outlined icons, brand-color or muted only.** No multi-color icons. Standardize on our gradient stops for accent icons.

### 1.12 [Firecrawl — Crisp Data-Centric Interface](https://styles.refero.design/style/78fec83e-4b27-44ab-9f64-31e9dee53e46)
- **Original:** [firecrawl.dev](https://www.firecrawl.dev)
- **Why it matters for Pegana:** Developer-tool aesthetic, single vivid orange `#ff4d00` accent, GeistMono for code blocks with comprehensive shadow stacks.
- **Steal:**
  - **Code block as hero element.** Firecrawl puts the actual code snippet front-and-center with a multi-layer shadow stack making it feel "elevated above the page". Pegana's `/developers` page should do this — the JS SDK init snippet as the hero, not a screenshot.
  - **GeistMono pairing.** Confirms our mono choice. Or consider Berkeley Mono (Linear) / JetBrains Mono if we want more personality.
  - **Single orange against neutral.** `#ff4d00` reads as fire/signal. Pegana's `#ff8400` (gradient middle) is a sibling — use it solo on the developers page hero.

### 1.13 [Stripe — Digital Command Center on Clean Canvas](https://styles.refero.design/style/48e5de76-05d5-4c4e-a269-c7c245b291ec)
- **Original:** [stripe.com](https://stripe.com)
- **Why it matters for Pegana:** Best-in-class financial-product marketing. Three decorative gradients (Sunburst, Dreamy, Fuchsia Glow) for hero sections, single typeface (Söhne) at weight 300 for understated authority.
- **Steal:**
  - **One typeface, two weights, dramatic scale.** Stripe runs Söhne at 300 and 400 only. We use too many weights — cap at 2 (400 + 600) for the entire site, scale through size + tracking instead.
  - **Decorative gradients in hero ONLY.** Stripe never repeats hero gradients in the product UI. Pegana's iridescent stripe should appear in the hero (full-bleed wash or focused stripe), then disappear in the dashboard except as the 1px state pip ring.
  - **Soft diffused shadows for elevation.** OK — but only on the marketing site, not dashboard. Confirms separation between marketing and product chrome.

### 1.14 [Adaline — Mist-Shrouded Valley](https://styles.refero.design/style/312423bf-72ea-42fb-b8f5-ab0104e778f3)
- **Original:** [adaline.ai](https://www.adaline.ai)
- **Why it matters for Pegana:** Muted earth tones, single green accent, "quiet authority" tone. Wrong palette for us, but the editorial restraint is useful for the postmortem/blog template.
- **Steal:**
  - **One accent for functional states only.** Their green is for status, not decoration. Same lesson — confirms the "ammunition" principle.
  - **Precise typography + measured spacing = engineered feel.** For the methodology page, we want this exact "research lab" tone. Tighten line-height to 1.4, raise paragraph spacing to 1.5em.

### 1.15 [ClickUp — Vibrant Productivity Hub](https://styles.refero.design/style/efcb73cb-b84a-4ae7-9a2b-e1116f79f130)
- **Original:** [clickup.com](https://www.clickup.com)
- **Why it matters for Pegana:** Anti-reference. Bright violet + electric blue, light canvas, busy. Showing it because it's the EXACT tone we must avoid — productivity-SaaS chirp.
- **Avoid:**
  - Multi-accent palettes. Pick one signal color, period.
  - Soft shadows + 12px radii. Reads "Notion clone", not "Bloomberg terminal".
  - **What to keep from it:** their `Sometype Mono` for code is decent — confirms mono-only-for-code if you decide against mono-as-body.

---

## 2. Benchmark dashboards

### 2.1 [Linear](https://linear.app) — product polish & motion discipline
- **Data density:** Progressive disclosure — spacious hero, dense issue views below. Column layouts (Backlog/Todo/In Progress/Done) with staggered cards holding ID + title + assignee + priority chip.
- **Motion language:** Triggered by state change, not entrance. Status transitions (Todo → In Progress) animate the chip color + position. CTA hover triggers directional `→` indicator. No scroll-jacking, no parallax. **This is the model for Pegana.**
- **Hierarchy strategy:** Eye-magnet per section is the section number ("1.0 Intake →") + left-aligned headline. The actual UI mock sits below at full bleed, no card chrome.
- **Table treatment:** Card-based pseudo-tables. Left status-chip → ID → title → right-aligned avatars + priority. No row borders, only hover-state surface lift.
- **Hover/interaction:** Cards lift 1 surface level (e.g., `#0f1011 → #161718`). Buttons inset by 1px on press. Subtle, fast (<150ms).
- **Mobile adaptation:** Cards stack vertically. Side-by-side columns become collapsible accordions. Timeline scrolls horizontally.
- **Steal for Pegana:** (1) section numbering as eye-magnet on the marketing pages, (2) hover = surface-level shift, never color shift, (3) zero entrance animation on data — animate only on state change.

### 2.2 [Vercel Observability](https://vercel.com/products/observability)
- **Data density:** High in the screenshots. Top-level KPI ("634,200 visitors") + tabular request logs (status, timestamp, path, duration) + grouped sections (Top Sources, Request Metrics).
- **Motion language:** Almost none on the marketing page itself. Static dashboard mockups with light/dark toggle. The product is real-time; the page is static. **Lesson: don't oversell motion on the marketing page when the product itself is the motion.**
- **Hierarchy strategy:** Marketing header → benefit subhead → static dashboard image as proof. Numbers in the screenshot are the eye-magnet, not the copy.
- **Table treatment:** Left-aligned labels, right-aligned numbers. Status codes (200, 500) get monospace + color coding (5XX in red). Striped rows implied by alternating treatment.
- **Hover/interaction:** Implied by export affordances (CSV, JSON, Share URL). Page itself non-interactive.
- **Mobile:** Tables likely collapse columns or horizontal-scroll.
- **Steal for Pegana:** (1) monospace status codes with embedded color signal (200 = neutral, 500 = red) — apply to peg-status pip + numeric deviation, (2) export affordances right on the table (CSV, JSON) — power users expect this, (3) static screenshot as the proof, not a fake live demo.

### 2.3 [Pyth Network](https://pyth.network/price-feeds) / [pythdata.app](https://app.pyth.com)
- **Data density:** 3,059 price feeds, organized by asset class (crypto/equities/FX/metals). Category-first taxonomy, not alphabetical. **This is the navigation pattern we already use (LST / yield-bearing / wrapped).**
- **Motion language:** Pyth claims "1ms update frequency" but visually the feeds tick via simple number swap + brief flash. No skeletons during updates. **The flash is the entire motion vocabulary.**
- **Hierarchy strategy:** Asset class banners → grid of feeds within. Price is the eye-magnet, set in large mono.
- **Table treatment:** Card-grid hybrid, not strict table. Card = symbol + logo + price + 24h change + sparkline.
- **Hover/interaction:** Hover surfaces feed metadata (publishers, confidence interval). Click → detail page.
- **Mobile:** Cards stack 1-up, sparklines remain visible.
- **Real-time pattern:** Brief color flash (green up / red down) on price tick, then fade to neutral. **EWMA-smoothing in Pegana can mirror this — animate only when the EWMA actually crosses a threshold, otherwise hold steady.**
- **Steal for Pegana:** (1) confidence interval surfaced inline next to price (Pegana's "trust band" around peg deviation), (2) publisher list as a peer-trust signal — Pegana can show "sources: Jupiter, DexScreener, Solayer" the same way, (3) brief tick-flash motion vocabulary (~120ms color flash → fade) instead of continuous animation.

### 2.4 [DefiLlama](https://defillama.com)
- **Data density:** Extreme — multi-column tables (Name, Category, TVL, 1d, 7d, 1m, Mcap/TVL, sparkline) with hundreds of rows per page. The gold standard for crypto data tables.
- **Motion language:** Effectively zero. The data IS the motion (numbers update on refresh). No scroll animations, no entrance effects. **Brutalist truth.**
- **Hierarchy strategy:** Top filter bar → giant sortable table. Eye-magnet is the TVL column (largest numbers).
- **Table treatment:**
  - Sticky header row with sort indicators (triangle).
  - Sparkline at end of each row (7d trend), ~80px wide, single hue.
  - Percentage changes color-coded: green positive, red negative, NO gradient or animation.
  - Icon + name on left, all numerics right-aligned.
  - Row hover: subtle background shift (`#fff` → `#f5f5f5` in light mode, `#000` → `#0a0a0a` in dark).
- **Hover/interaction:** Hover row → background lift. Click row → detail page with full chart. Sort columns by header click. No tooltips, no popovers — the data is enough.
- **Mobile:** Drops less-important columns (Mcap/TVL hidden), keeps name + TVL + 1d. Horizontal scroll for everything else.
- **Steal for Pegana:** (1) sticky header with sort indicators, (2) sparkline as the LAST column always, (3) red/green text color coding without animation — let data speak, (4) row-hover = single surface step lift, (5) hide secondary columns on mobile, don't horizontal-scroll the whole thing.

### 2.5 [Jito Network](https://www.jito.network) — Solana LST/MEV
- **Data density:** Marketing site is light on data; the [jitosol staking app](https://www.jito.network/staking) is dense. APY large, supply + price + restaking flow as KPIs. Bar chart for validator distribution.
- **Motion language:** Subtle. APY counter on-mount counts up once. Hover on validators reveals stake amount. No scroll trickery.
- **Hierarchy strategy:** APY is the hero number (40px+ display). Stake / Unstake buttons immediately below. Validator list as secondary.
- **Table treatment:** Validator list = ranked rows with rank chip, name, commission, stake. Compact, single-color.
- **Hover:** Subtle row highlight, no expansion.
- **Mobile:** APY + CTA stays prominent; validator list collapses to top-5 with "view all" link.
- **Steal for Pegana:** (1) ONE hero number per page (peg deviation, EWMA, time-to-recover) — make it the unmistakable focal point, (2) CTA pair (Watchlist / Compare) directly below hero number, (3) ranked validator list pattern = ranked LST peg-health list (rank chip + symbol + deviation + sparkline).

### 2.6 [Helius](https://www.helius.dev) — Solana infra
- **Data density:** Marketing-led, not dashboard. Metrics block ("99.99% RPC success rate", "5x faster confirmations") with quantified proof.
- **Motion language:** Minimal — metrics are static. Hero is mostly text + abstract gradient.
- **Hierarchy strategy:** Tag line → product modules in a stack → metrics → social proof testimonials → CTA.
- **Steal for Pegana:** (1) the metrics block pattern — Pegana should have one ("12 LSTs watched · 4 sources · 99.97% uptime · 1.2s median tick latency") near the fold, (2) "no credit card, no email" friction-removal in the CTA — Pegana's free tier should be just-as-blunt: "open dashboard, no signup".

### 2.7 [Phantom](https://phantom.com) — Mobile-first dark fintech polish
- **Data density:** Low on marketing page (it's a consumer wallet). Mobile-first dark UI is the takeaway.
- **Motion language:** Hero screenshot animates on scroll (parallax + tilt). Mid-page video loops of the app in use.
- **Hierarchy strategy:** App screenshot is the hero, copy is secondary. "Show, don't tell."
- **Mobile:** Native — entire site is built mobile-first then scaled up.
- **Steal for Pegana:** (1) dashboard screenshot as the primary hero asset, not abstract illustration, (2) ensure the mobile dashboard is the screenshot you ship — currently our mobile dashboard is an afterthought, (3) avoid Phantom's purple-blue gradient — too consumer, too Web3-2021. Our iridescent stripe is more refined.

### 2.8 [Drift Protocol](https://app.drift.trade) — Solana perps
- **Data density:** Very high — orderbook + chart + position panel + funding rate strip simultaneously.
- **Motion language:** Order book ticks with brief flash. PnL number animates on change. Chart updates real-time via subtle redraw.
- **Hierarchy strategy:** Chart center, orderbook right, position panel bottom. Standard trading-app layout.
- **Table treatment:** Orderbook = two columns (bid/ask) with depth-bar background. Funding rate strip across top.
- **Hover:** Hover orderbook level → highlights that price on chart.
- **Steal for Pegana:** (1) depth-bar as cell background (e.g., for "share of LST supply" column — single horizontal bar inside the cell, very low opacity), (2) cross-component hover linking (hover row → highlight on chart), (3) funding-rate-strip equivalent for Pegana = "global peg health" strip across top showing all watched LSTs as colored micro-pips.

### 2.9 [Tensor Trade](https://www.tensor.trade) — Solana NFT pro mode
- **Data density:** Pro mode is dense; Lite mode is sparse. They explicitly ship two interfaces.
- **Motion language:** Floor price ticks, bulk-action sweeps animate via Flip-style reorder.
- **Hierarchy strategy:** Rarity-price chart is the eye-magnet for collections — scatter plot of all NFTs by rarity rank vs price.
- **Table treatment:** Floor / volume / holders + rarity column. Bulk select via checkbox column.
- **Steal for Pegana:** (1) ship a "Pro" vs "Lite" toggle on the dashboard — Lite shows the top-5 LSTs with status pips, Pro shows the full table + sparklines + sources, (2) bulk select for the compare flow — checkbox column, multi-select up to 4, opens compare drawer, (3) scatter plot = peg-health vs liquidity scatter for the LST universe view.

### 2.10 [Fortress dashboard template](https://colorlib.com/wp/dark-admin-dashboard-templates/) — Bloomberg-vocab admin
- Bonus reference for the Bloomberg vocab. Dense data tables, monospace numerics, layouts that prioritize scanning thousands of rows without eye fatigue. Built on Next 16 + shadcn + Tailwind v4 (our stack).
- **Steal for Pegana:** Confirm the Bloomberg-terminal vocabulary is having a moment. Reference for our dashboard table density.

---

## 3. GSAP-specific patterns

Context: we're currently on framer-motion + CSS keyframes. The question is which GSAP features beat framer-motion for our specific Pegana surface area. Performance research is unambiguous — for 60+ simultaneous animations and timeline orchestration, GSAP is faster and has zero React-render coupling. Framer-motion's layout calculations are tied to React's render cycle, which is exactly the wrong property for a dashboard that re-renders constantly on EWMA ticks. ([Pentaclay comparison](https://pentaclay.com/blog/framer-vs-gsap-which-animation-library-should-you-choose), [Motion.dev comparison](https://motion.dev/docs/gsap-vs-motion))

Pragmatic stance: **keep framer-motion for component-level transitions (modal in/out, AnimatePresence), introduce GSAP for the five patterns below where it materially wins.**

### 3.1 ScrollTrigger pinning + scrub — hero-to-product transitions
- **What it does:** Pin a section while scroll progresses, scrub the animation to scrollbar position. `scrub: true` = instant; `scrub: 1` = 1s smoothing. ([Docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/))
- **When to use for Pegana:**
  - **Hero → Dashboard reveal.** Pin the hero, scrub a transition where the iridescent stripe contracts into the dashboard's top peg-health strip as the user scrolls. Single coherent visual transformation tied to scroll position.
  - **Methodology page narrative scroll.** Pin the EWMA formula, scrub a chart that draws itself showing raw price → smoothed signal as the user reads.
  - **Why not framer-motion:** framer-motion's `useScroll` re-renders on every scroll event, GSAP's ScrollTrigger uses `requestAnimationFrame` directly. For a pinned section animating ~6 properties simultaneously, this is the difference between 60fps and jank.
- **Real example pattern:** Codrops uses ScrollTrigger pinning with `scrub: 1` for cinematic hero-to-product transitions where graphics morph continuously through the scroll. ([Codrops Jan 2026 tutorial](https://tympanus.net/codrops/2026/01/20/animating-responsive-grid-layout-transitions-with-gsap-flip/))

### 3.2 SplitText for headline reveals
- **What it does:** Splits text into chars/words/lines as separate elements, wraps each with `visibility: clip` for masked reveals, auto-handles `aria-label` for accessibility, re-splits on resize/font-load. ([Docs](https://gsap.com/docs/v3/Plugins/SplitText/), [Codrops demo](https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/))
- **When to use for Pegana:**
  - **Landing hero headline.** Per-character mask reveal with `stagger: 0.02` and `ease: "power3.out"`. Feels machined, not bouncy.
  - **Asset detail page hero (symbol + peg status).** "JITOSOL · TRACKING WITHIN BAND" reveal per-word, then number counts up.
  - **Why not framer-motion:** framer-motion has no built-in text splitter. You'd hand-roll it with `span` per char and pay React-render cost on every key. SplitText handles the DOM + the responsive re-split on resize automatically.
- **Accessibility note:** Always set `aria-label` on the parent element BEFORE splitting — screen readers see the full sentence, not "T-r-a-c-k-i-n-g".

### 3.3 Flip for table ↔ mosaic transitions
- **What it does:** `Flip.getState()` snapshots positions/sizes; do whatever DOM change you want; `Flip.from(state)` animates back. Handles flexbox/grid jumps elegantly via `absolute: true`. ([Docs](https://gsap.com/docs/v3/Plugins/Flip/))
- **When to use for Pegana:**
  - **Dashboard table ↔ mosaic toggle.** We literally have both modes already. Today the switch is instant (jarring). With Flip: capture state, switch CSS class, `Flip.from(state, { duration: 0.6, ease: "power2.inOut", stagger: 0.02 })`. Rows fluidly become cards.
  - **Sort reorder animation.** When user sorts by peg deviation, rows reflow with continuous motion instead of a re-render jump.
  - **Modal expansion.** Hover an LST card → click → it expands smoothly into the full asset page using `Flip.fit()` matching the destination element.
  - **Why not framer-motion:** `layout` prop is the framer-motion equivalent but it requires every animated element to be a `motion.*` component, which pulls every dashboard row into React's render dance. Flip works on any DOM element with zero React coupling.
- **Critical option:** Use `absolute: true` when going from row-flex to grid — prevents siblings from collapsing during animation.

### 3.4 Observer for kinetic scroll-driven marquees
- **What it does:** Normalizes wheel + touch + pointer events into a unified callback API. Velocity calculation, direction detection (`onLeft`, `onRight`), debounced by default. 3.5kb gzipped. ([Docs](https://gsap.com/docs/v3/Plugins/Observer/))
- **When to use for Pegana:**
  - **Hero ticker marquee.** Our current marquee uses CSS `@keyframes` infinite scroll — fixed speed, no interaction. Replace with Observer: marquee speeds up/slows down based on scroll velocity, reverses direction if user scrolls up, pauses on hover. Feels like a real ticker, not a CSS loop.
  - **Cross-device scroll handling.** Trackpad / mouse wheel / touch swipe all funnel through one callback. Eliminates the "mobile feels weird" problem.
  - **Why not framer-motion:** framer-motion has nothing equivalent. You'd hand-roll wheel listeners + touch event handlers + velocity math. Observer is the right primitive.
- **Pattern from search:** ([GSAP Observer marquee examples](https://codepen.io/bappla/pen/abpyGQy)) — `gsap.to()` with `xPercent: -100, repeat: -1, ease: "none"`, then `timeScale` controlled by Observer's velocity. Layer two marquees at different speeds for parallax effect.

### 3.5 Data-driven counter morphs
- **What it does:** Tween a number value with `onUpdate` callback that re-formats the displayed text. Snap to integers with `snap: { value: 1 }`, or decimals with `snap: 0.01`. ([Chris Soul guide](https://www.chris9soul.com/blog/animate-numbers-gsap/), [GSAP forum thread](https://gsap.com/community/forums/topic/26886-number-counter-animation-in-gsap-3x-and-adding-decimal-separators-to-the-number/))
- **When to use for Pegana:**
  - **EWMA deviation counter.** Today our Counter component (framer-motion) animates on every value change. For continuous data, that means continuous animation — expensive and visually noisy. GSAP approach: animate only when delta > epsilon (e.g., 0.001), use `duration: 0.4` with `ease: "power2.out"`, snap to 4 decimal places. Holds steady when nothing's happening.
  - **Slot-machine rolling digits** (advanced). Per-digit vertical roll on big numbers (peg %, TVL). Codrops and the GSAP forum have a [slot-machine ticker pattern](https://gsap.com/community/forums/topic/44561-animated-date-counter-slot-machine-vertical-ticker-etc/) — each digit lives in a masked column, GSAP scrolls the column to the target digit.
  - **Why not framer-motion:** framer-motion's spring physics make number tweens feel bouncy — wrong for financial data. Even with a stiff spring, you get overshoot. GSAP's `power2.out` ease is monotonic — number moves from A to B, full stop. Trustworthy.

### 3.6 Bonus — ScrollTrigger.matchMedia for mobile motion gates
- **What it does:** Conditionally enable / disable ScrollTrigger setups based on viewport. ([ScrollTrigger docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/))
- **When to use for Pegana:** Pinning + scrubbing on mobile is usually wrong — it eats touch scroll. Wrap all desktop-only pins in `ScrollTrigger.matchMedia({ "(min-width: 768px)": setupPin })`. On mobile, fall back to simple `onEnter` reveal.

---

## Summary — concrete next actions

Things to commit to immediately based on this recon:

1. **Color discipline.** One signal hue at a time. Gradient stripe = brand identity moment, never decoration. CTAs in white-on-black. Status in gradient. State pip in gradient with low-opacity glow.
2. **Surface ladder.** Three-step depth on `#000` canvas: `#000` → `#0a0a0a` → `#141414`. Kill all `box-shadow` on dashboard surfaces.
3. **Body text drop.** Body copy at `#e8e8e8`, not `#fff`. Reserve `#fff` for hover/active text states.
4. **Typography stack pilot.** Add a serif (Fraunces or IvarText) for editorial pages only (methodology, postmortems, blog). Keep mono + sans elsewhere. Drop to 2 weights site-wide.
5. **GSAP introduction.** Stage adoption: (a) ScrollTrigger pin/scrub for hero-to-dashboard transition, (b) Flip for table↔mosaic + sort reorder, (c) SplitText for landing hero headline, (d) Observer-driven marquee, (e) data-counter morphs with epsilon-threshold. Keep framer-motion for modal AnimatePresence and component-level transitions.
6. **One hero number per page.** Pyth + Jito + Linear all agree: make ONE number the unmistakable focal point. Pegana: peg deviation on asset pages, "LSTs tracking within band" count on landing, EWMA half-life on methodology.
7. **Ranked list everywhere.** Validator-list pattern (Jito) = LST peg-health rank list. Rank chip + symbol + deviation + sparkline. Single most useful surface we don't have yet.
8. **Export affordances.** CSV + JSON on every table. Vercel does this; DefiLlama does this. Power users expect it.
9. **Pro vs Lite mode.** Borrow from Tensor. Lite = top-5 LSTs with pips. Pro = full table, sparklines, sources, EWMA controls. Toggle in nav.
10. **Brutalist motion vocabulary.** ~120ms tick-flash on value change (Pyth pattern), no continuous animations, ease-only easings (no springs), animate-only-on-state-change (Linear pattern). The data is the motion.

---

Sources:
- [Refero Styles catalog](https://styles.refero.design/)
- [GSAP ScrollTrigger docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
- [GSAP SplitText docs](https://gsap.com/docs/v3/Plugins/SplitText/)
- [GSAP Flip docs](https://gsap.com/docs/v3/Plugins/Flip/)
- [GSAP Observer docs](https://gsap.com/docs/v3/Plugins/Observer/)
- [Codrops — Flip grid transitions Jan 2026](https://tympanus.net/codrops/2026/01/20/animating-responsive-grid-layout-transitions-with-gsap-flip/)
- [Codrops — SplitText creative demos](https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/)
- [Pentaclay — Framer vs GSAP](https://pentaclay.com/blog/framer-vs-gsap-which-animation-library-should-you-choose)
- [Motion.dev — GSAP vs Motion comparison](https://motion.dev/docs/gsap-vs-motion)
- [LogRocket — Best React animation libraries 2026](https://blog.logrocket.com/best-react-animation-libraries/)
- [Chris Soul — Count up numbers with GSAP](https://www.chris9soul.com/blog/animate-numbers-gsap/)
- [GSAP forum — Animated counter increment](https://gsap.com/community/forums/topic/36099-animated-counter-increment/)
- [GSAP forum — Slot machine ticker](https://gsap.com/community/forums/topic/44561-animated-date-counter-slot-machine-vertical-ticker-etc/)
- [GSAP forum — Decimal counter formatting](https://gsap.com/community/forums/topic/26886-number-counter-animation-in-gsap-3x-and-adding-decimal-separators-to-the-number/)
- [Bloomberg — Designing the Terminal for color accessibility](https://www.bloomberg.com/company/stories/designing-the-terminal-for-color-accessibility/)
- [Bloomberg — How Terminal designers conceal complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/)
- [Aesthetics in the AI era 2026](https://medium.com/design-bootcamp/aesthetics-in-the-ai-era-visual-web-design-trends-for-2026-5a0f75a10e98)
