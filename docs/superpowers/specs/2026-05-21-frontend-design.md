# Pegana — Frontend design spec

> v1.0 · 2026-05-21 · approved direction · ready for implementation plan

## 1. Scope

**What we build for v1:**

- **Landing** (`/`) — single-page narrative explaining what Pegana does, with embedded live state and a Telegram mock as proof of product
- **Dashboard** (`/dashboard`) — read-only public view of all 14 monitored assets with current state, discount, intrinsic vs market, last update; live updates via WebSocket
- **Asset detail** (`/asset/[symbol]`) — chart of historical discount (24h / 7d / 30d), last alerts, threshold spec, intrinsic strategy description

**Explicitly out of scope for v1:**

- Auth, login, accounts (everything is read-only public)
- Pricing / billing / API key management (planned for v1.5 freemium)
- Methodology long-form article page (covered by accordion on landing + tooltips on dashboard)
- Multi-language i18n (English only; bot keeps PT/EN per existing decision)
- Native mobile apps (responsive web only)

**Stack:**

- Next.js 16 App Router · TypeScript · Tailwind v4 · CSS variables for tokens
- shadcn/ui components where appropriate (cards, buttons, tooltip, dropdown-menu)
- Recharts for the historical discount chart on `/asset/[symbol]`
- Framer Motion for orchestrated entrance animations (replacing the inline IntersectionObserver pattern from the mock)
- SWR for REST data fetching with focus revalidation
- Native WebSocket → in-memory store → React context for live state push
- Deployed to Vercel. API/bot stay on the VPS (Epic 10).

---

## 2. Information architecture

```
/                       → Landing (this spec's primary surface)
/dashboard              → Live grid of 14 assets, filterable by class/peg target
/asset/[symbol]         → Detail: chart, alerts, spec
/methodology            → Long-form methodology (anchor links from accordion rows on landing)

Not v1, but routes are reserved:
/api                    → API docs page (placeholder until v1.5)
/changelog              → Changelog page (markdown rendered)
```

**Navigation primary** (header, every page):

`Pegana` mark + `Dashboard · Methodology · Alerts · API · [Get the bot]`

**Navigation footer** (every page):

- **Product** — Dashboard, Methodology, Alerts archive, Roadmap
- **Developers** — Telegram bot, REST API, WebSocket, Webhooks (soon)
- **Open** — Github, Spec v3, Changelog, Audit log
- **Company** — About, Contact, rafael@pegana.xyz, Press kit
- Status pip "All systems operational" + Terms · Privacy · License (MIT)

---

## 3. Landing structure (top to bottom)

| # | Section | Content |
|---|---------|---------|
| 0 | Top nav | Brand mark left · 4 links + CTA right |
| 1 | Hero | Title (no eyebrow), subhead, announcement pill top-right with live counts, track-record stats panel bottom-left, embedded asset card bottom-right showing one live drift |
| 2 | Marquee | Caption "Built on the Solana stack we monitor." · 16-logo horizontal scroll (Pyth, Sanctum, Jupiter, Hylo, Jito, Marinade, drift, Solana, Circle, PYUSD, Ethena, Wormhole, Phantom, Helius, Bybit, BlazeStake) · mask-fade edges · 55s loop · pauses on hover |
| 3 | `(01) Methodology` | Numbered title + body + 5-row accordion (Intrinsic LST · CDP · FX, Market, State machine) |
| 4 | `(02) Universe` | Numbered title + 14 asset portraits in a 7-col grid (4:5 aspect) |
| 5 | `(03) Get pinged` | 2-col: text + buttons on left (Open @PeganaBot, Browse live dashboard), Telegram alert mock on right |
| 6 | Wordmark | `PEGANA` filled white, responsive 21vw clamp, generous padding |
| 7 | Footer | Brand block + 4 link columns (Product/Developers/Open/Company) + bottom bar with status pip + legal |

---

## 4. Brand tokens

### Color

```css
/* Surface */
--canvas:        #000000;     /* page background */
--surface-1:     #0f0f12;     /* asset card backdrop */
--surface-2:     #1a1c22;     /* hover state */
--hairline:      #1a1a1a;     /* subtle divider */
--outline:       #2a2a2a;     /* card border */

/* Text */
--text:          #fffdf9;     /* refined white — Vivid+Co warm off-white */
--text-muted:    #6f879c;     /* stonewash gray — the only chromatic accent */
--text-caption:  #787878;     /* Coinbase trusted-by caption grey */

/* Signature iridescent gradient (used ONLY for: brand mark, hero spotlight, asset card edge, CTA buttons primary hover) */
--grad:          linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%);

/* State semantics — desaturated for clean-minimal feel, distinct enough for instant read */
--st-pegged:     #6bd697;     /* desaturated green */
--st-drift:      #c08a55;     /* muted amber */
--st-depeg:      #a55a5a;     /* muted brick */
--st-critical:   #b73838;     /* deeper brick — pulses on transition */
--st-unknown:    #6f879c;     /* muted = same as text-muted */
```

### Typography

```css
--font-sans:  'Inter', system-ui, sans-serif;     /* all UI + display */
--font-mono:  'JetBrains Mono', ui-monospace, monospace;  /* numeric data, captions, labels */
```

**Scale:**

| Role | Size | Weight | Tracking | Usage |
|------|------|--------|----------|-------|
| Display hero | 104px | 500 | -0.05em | Hero title only |
| Display CTA | 56px | 500 | -0.035em | `(03)` title |
| Display wm | clamp(120, 21vw, 280)px | 700 | -0.05em | PEGANA footer wordmark |
| Heading section | 40px | 500 | -0.025em | `(01)`, `(02)`, `(03)` titles |
| Body | 16-17px | 400 | 0.16-0.18px | Main copy |
| Caption | 12-14px | 400 | -0.005em | Footer copy, links |
| Mono label | 9-12px | 400 | 0.06-0.1em uppercase | Numeric labels, eyebrows |
| Mono data | 11-14px | 400 | 0.02em | All numeric values |

### Spacing

```css
--section-gap:    144px;   /* between major numbered sections */
--hero-pad-bot:   32px;    /* hero bottom internal padding */
--card-pad:       20px;    /* default card padding */
--card-pad-tight: 14px;    /* asset portraits (dense grid) */
--page-max:       1280px;  /* main container */
```

### Radii

- `0` default for buttons, panels, hairline divisions (Vivid+Co sharp edges)
- `12px` asset portraits
- `14px 14px 14px 4px` Telegram bubble (Telegram-shape)

### Shadow

- **None on UI elements**. Depth comes from color blocking and 1px hairline borders.
- `box-shadow: 0 24px 60px rgba(0,0,0,0.5)` only on the Telegram mock (it's a "floating UI from another platform")

---

## 5. Components inventory

Each component needs an independent implementation file. Listed in build order.

### Atoms

1. **`BrandMark`** — gradient square + "Pegana" wordmark inline
2. **`Pill`** — base pill, variants: ghost, filled, with-dot
3. **`StatePip`** — colored dot, optional pulse animation per state
4. **`Counter`** — animates from 0 to target on mount or on intersection
5. **`Sparkline`** — small SVG line chart, accepts array of points
6. **`Marquee`** — generic horizontal scroll with mask fade, duplicate-track pattern

### Molecules

7. **`AssetCard`** — sym + state pip + intrinsic/market/discount block. **Variants:**
   - `variant="floating"` (hero embedded preview) — fixed 340px width, backdrop blur, iridescent edge, sparkline included
   - `variant="row"` (dashboard table view) — full-width, no sparkline, denser padding
   - `variant="detail"` (asset detail header) — larger type, no border, multi-line meta
8. **`AssetPortrait`** — compact 4:5 card (used in landing `(02)` grid and dashboard mosaic view)
9. **`AlertItem`** — single alert row: asset · transition · timestamp · discount · dispatched-after. Used in dashboard sidebar feed and asset detail alerts list
10. **`AccordionRow`** — category + title + plus icon, hover lift
11. **`StatPanel`** — bordered container with 2-4 stat cells (used in hero track record)
12. **`AnnouncementPill`** — backdrop-blur pill with dot + summary + arrow (top-right of hero)
13. **`TelegramBubble`** — full mock of bot alert
14. **`SocialIcon`** — 32px bordered icon (Telegram, X, Github, Email)
15. **`MouseSpotlight`** — fixed-position layer with mouse-tracked radial gradient (Base-pattern)
16. **`DotGrid`** — fixed-position background dots with mouse-mask

### Organisms

17. **`HeroLanding`** — hero composition (announcement pill + title + subhead + stat panel + asset card)
18. **`LogoMarquee`** — captioned marquee with the 16 ecosystem brand wordmarks
19. **`MethodologyAccordion`** — `(01)` section with 5 rows
20. **`UniverseGrid`** — `(02)` section with 14 portraits
21. **`PingedCTA`** — `(03)` section with Telegram bubble on the right
22. **`AssetChart`** — Recharts-wrapped area chart with threshold lines (DRIFT, DEPEG, CRITICAL); bucket-toggle (1h / 24h / 7d / 30d); used on `/asset/[symbol]`
23. **`AssetSpec`** — block listing intrinsic strategy, market source, thresholds, decimals, token program; used on `/asset/[symbol]`
24. **`SiteHeader`** — nav
25. **`SiteFooter`** — 5-col footer with bottom bar

### Pages (composition only)

26. **`/` page** — composes Hero + Marquee + Methodology + Universe + CTA + Wordmark + Footer
27. **`/dashboard` page** — composes Header + filter row + AssetCard table OR AssetPortrait mosaic (user-toggled) + AlertItem sidebar feed (live updates via WS) + Footer
28. **`/asset/[symbol]` page** — composes Header + AssetCard `variant="detail"` + AssetChart + AlertItem list + AssetSpec + Footer

---

## 6. Animation contract

**Easing:**

```css
--ease:      cubic-bezier(0.22, 1, 0.36, 1);  /* default smooth */
--ease-out:  cubic-bezier(0.16, 1, 0.3, 1);   /* entrance */
```

**Durations:**

- Hover state: 500ms
- Section reveal: 900ms
- Word reveal stagger: 120ms between words
- Counter ramp: 1400ms cubic ease-out from 0 to target

**Animations live in the page:**

| Where | Animation | Trigger |
|-------|-----------|---------|
| Hero title | Word-by-word fade + 36px slide up | onMount, stagger 80ms |
| Live dot | Radial ripple pulse | continuous, 2.5s loop |
| Counter values | Ramp 0 → target with cubic ease-out | onMount, 900ms delay |
| Mouse spotlight | Radial gradient follows cursor | mousemove, rAF throttled |
| Dot grid | Mask radial reveals dots near cursor | bound to spotlight |
| Marquee | translateX 0 → -50% in 55s linear | continuous, pauses on hover |
| Section reveal | Opacity + 20px slide-up | IntersectionObserver threshold 0.08 |
| Portrait stagger | Sequential reveal 60ms apart | IntersectionObserver per card |
| Accordion hover | Plus rotates 45°, row shifts 8px right, bg lightens | hover |
| State pip drift | Box-shadow expand 6px ring | continuous, 2s loop |
| State pip depeg | Box-shadow expand 8px ring, faster | continuous, 1.4s loop |
| Nav link hover | Underline sweeps left → right 100% | hover |
| Button fill | Background slides up from 101% offset | hover |
| Wordmark | Opacity + 24px slide-up | IntersectionObserver threshold 0.25 |

**Reduced motion:**

All animations honor `@media (prefers-reduced-motion: reduce)` — disable transforms, keep opacity only.

---

## 7. Data contracts (consuming the existing API)

The frontend reads from the Rust API documented in `crates/api-rs`. Endpoints reused as-is:

| Endpoint | Returns | Frontend use |
|----------|---------|--------------|
| `GET /v1/assets` | `AssetCard[]` | Landing universe grid · Dashboard list |
| `GET /v1/assets/:symbol` | `AssetCard` | Asset detail header |
| `GET /v1/assets/:symbol/history?bucket=1m&from&to&limit` | `HistoryPoint[]` | Asset detail chart |
| `GET /v1/assets/:symbol/state` | `StateResp` (state + since + values) | Asset detail current state badge |
| `GET /v1/alerts?limit=&since=` | `AlertRow[]` | Asset detail alerts list · Dashboard sidebar |
| `GET /v1/stats` | `{ assets_tracked, alerts_24h, by_state }` | Hero announcement pill + stat panel |
| `GET /v1/ws` | WebSocket — `ServerMsg::Update{asset, payload}` | Live state push to all open pages |

**Refresh strategy:**

- Initial paint: SSR fetch of `/v1/stats` + `/v1/assets` at request time (no caching) so the page lands with real numbers
- Client mount: open WebSocket, merge incoming updates into store
- SWR for non-realtime fetches (history, alerts archive) with `revalidateOnFocus: true`

**Loading state:**

- Cards render with skeleton placeholders (1px hairline rectangles, no shimmer) until first data arrives — keeps the visual still
- Counters skip the ramp animation if values are stale (>30s without WS update); revert to ramp on next update

**Error state:**

- API down: announcement pill switches to "Service · degraded" in muted color, no pulse
- WS disconnect: silent backoff retry with exponential up to 30s, no UI noise unless 5 min elapsed (then a subtle hairline banner on dashboard)

---

## 8. Background interactions

**Mouse spotlight (every page):**

- Two fixed layers above canvas, below content (`z-index: 0` and `1`)
- `DotGrid` — radial-gradient dots (1px @ 26px spacing) revealed only in a 320px radius around cursor via mask-image
- `Spotlight` — large 480px radial gradient using brand iridescent tones at 2-4% alpha, screen blend mode
- Cursor coords updated via `--mx` / `--my` CSS variables, rAF-throttled on mousemove
- On touch devices: spotlight defaults to centered, no tracking

**Hover lift across the page:**

- Cards translate -4px on hover with 600ms transition
- Border color shifts from `--hairline` to `--outline`
- Internal radial tint becomes fully opaque

---

## 9. Responsiveness

| Breakpoint | Adaptation |
|------------|------------|
| ≥1280px | Full layout as specified |
| 1024-1279px | Hero title 88px, asset card moves below stats panel, portraits grid drops to 6 cols, footer 4 cols |
| 768-1023px | Hero title 64px, all 2-col sections stack, accordion full-width, portraits 4 cols |
| 480-767px | Title 48px, announcement pill becomes block above title, asset card full-width, portraits 3 cols, footer collapses to 2 cols accordion-style |
| <480px | Title 36px, portraits 2 cols, marquee narrower, footer single column |

The dashboard page on small viewports defaults to mosaic (cards) instead of table.

---

## 10. Accessibility

- Color contrast: all primary text (`#fffdf9` on `#000000`) is 19:1 (AAA). Muted text (`#6f879c` on `#000000`) is 5.2:1 (AA for body, falls below AAA — restrict muted to non-essential text).
- All animations honor `prefers-reduced-motion`.
- Mouse spotlight is decorative; never used to convey state.
- State colors are paired with text labels (PEGGED / DRIFT / DEPEG) — never rely on color alone.
- Keyboard navigation: every interactive element reachable via Tab. Focus rings styled (1px outline in `--text` color, 2px offset).
- Screen reader: announcement pill has `aria-label`, mouse spotlight + dot grid have `aria-hidden`, Telegram bubble has full text content (not an image).

---

## 11. Build order (gates implementation plan)

1. **Foundation** — Next.js scaffold, Tailwind v4 + tokens, fonts via `next/font`, base CSS reset
2. **Atoms** — BrandMark, Pill, StatePip, Counter, Sparkline
3. **Background** — MouseSpotlight + DotGrid (the foundation that affects every page)
4. **Header + Footer** — SiteHeader, SiteFooter (used on every page)
5. **Hero** — HeroLanding with all 4 internal elements
6. **Marquee** — LogoMarquee with the 16 wordmarks
7. **Sections (01) (02)** — MethodologyAccordion, UniverseGrid
8. **Section (03)** — PingedCTA with TelegramBubble
9. **Wordmark + Landing compose** — assemble `/` page
10. **API client** — typed fetcher + WS client + SWR config
11. **Dashboard page** — `/dashboard` with table view + filter row + WS-live updates
12. **Asset detail page** — `/asset/[symbol]` with chart, alerts, spec
13. **Responsive pass** — verify each breakpoint
14. **Reduced-motion + a11y pass** — verify all guards
15. **Deploy** — Vercel preview, then production

---

## 12. Open questions (none blocking)

- **Brand mark final form** — currently a gradient square. Could become a 16x16px SVG glyph (a stylized "P" or a peg-line motif). Decision deferred to post-implementation polish; the current shape is acceptable.
- **Marquee wordmarks** — currently text-styled (Inter weights/sizes per brand). If we have real partner SVG logos by launch, swap them in (Coinbase pattern). No structural change.
- **Asset chart bucketing** — `?bucket=raw` vs `?bucket=1m`. Decision: default `1m` for ≤24h, `raw` for ≤1h, `5m` aggregate (needs a new continuous aggregate in the migration) for ≥7d. Tracked as a small backend follow-up.
- **Dashboard view mode** — table (dense) vs mosaic (portraits at fuller size). Decision: ship both, default to table, user toggle persisted in localStorage.

---

## 13. References that grounded each choice

| Choice | Reference |
|--------|-----------|
| Single typeface, sharp edges, vast negative space, muted accent | Vivid+Co live site + design.md |
| Marquee mask gradient + 70% opacity + 55s + duplicated track | Base.org production code (inspected via Playwright) |
| Numbered section storytelling `(01) (02) (03)` | Vivid+Co + Linear |
| Embedded product UI in hero (asset card) | Linear hero pattern |
| Announcement pill in opposing corner | Linear "Issue tracking is dead" pattern |
| Mouse spotlight on dot grid | Base.org background canvas + dot pixel grids |
| Iridescent gradient as single signature accent | Clyde design.md "Iridescent Glow" |
| Big stat numbers + mono labels | Pyth + DefiLlama + Coinbase |
| Asset portraits 4:5 grid | Vivid+Co team photo grid pattern |
| Footer with sans headers + social icons + status pip | Linear + Coinbase production footers |
| Hover fill-up on buttons | Vivid+Co + Linear |
| Mono for numeric data, sans for UI | Coinbase (CoinbaseMono pattern) + Eclipse (Atlas Typewriter) |
| State colors green/orange/red | Coinbase positive/negative + Uniswap success/alert |
| Pure black canvas | Vivid+Co + Clyde + Eclipse |
