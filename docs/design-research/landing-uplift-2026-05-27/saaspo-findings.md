# Saaspo sweep — 2026-05-27 (focused on /dashboard direction)

Real saaspo browsing (not my own picks). Saaspo doesn't have a "dashboard"
page-type — closest is **Product** (327 entries). Pulled 4 real cards from
that list, visited each external URL, code-inspected.

These are *commercial-grade SaaS product pages*, not my self-curated
crypto-data-tool picks. The user's been right that this is a different
visual paradigm than what I kept defaulting to.

---

## Reference 1 — Notion `/dev/notion`

**URL:** `https://www.notion.com/product/dev`

**Aesthetic — what's unique:**
- Full-bleed solid cobalt blue background (~`#2547D5`) — committed brand
  color, not a gradient, not particles
- Mono caps nav with **single-letter keyboard prefixes**: `[S] Syncs`
  `[A] Agent tools` `[H] Webhooks` `[W] Workers` `[E] External agents`
  `[P] Platform` `[D] Docs`. Reads like a CLI/IDE menu — distinctive.
- Hero headline is `/dev/notion` — formatted as a URL path / route.
  Massive, light weight, mono-flavoured.
- Sub: "Não é apenas mais uma API CRUD para o seu SaaS."
- **Inline install command** with copy icon: `curl -fsSL https://ntn.dev | bash`
- Body link: "Comece a criar com o Notion CLI ou leia a nossa documentação"
- BIG REAL product screenshot below — Notion app with sidebar
  (Favorites / Agents / Databases), Support Tickets table with status pills,
  assignee avatars.

**Lessons for Pegana dashboard:**
- Commit to ONE brand color moment (Pegana = pure black + iridescent gradient).
- "Letter-prefix nav" is gorgeous for a dev-oriented tool — could map to
  Pegana's channels: `[R] REST` `[W] WebSocket` `[M] MCP` `[H] Webhook` `[T] Telegram`.
- **Show the real product** — not a sketch, not a particle field. The dashboard
  itself should be the visual.

---

## Reference 2 — Cloudflare Browser Rendering

**URL:** `https://www.cloudflare.com/products/browser-rendering/`

**Aesthetic — what's unique:**
- White background, near-black text. Drastically different palette from Pegana.
- **Dashed-corner annotations** — small hairline dashed brackets at the
  corner of the hero tag and around the 3-col features grid. Reads like
  engineering blueprint inspection marks. Distinctive Cloudflare move.
- Pill CTAs: orange "Start building for free" (Cloudflare brand orange) +
  ghost "View docs"
- 3-col features below: icon + h3 + body, each cell has a tag pill above
  ("Scale to thousands of browsers" / "Global by Default" / "Easy to Integrate")

**Lessons for Pegana dashboard:**
- The **dashed-corner annotation** is a signature graphical move that costs
  nothing structurally but feels distinctive. Could mark Pegana dashboard
  panels with dashed corners as "instrumentation" — engineering precision
  vibe that pairs well with peg-data accuracy claims.

---

## Reference 3 — Intercom Helpdesk

**URL:** `https://www.intercom.com/helpdesk`

**Aesthetic — what's unique:**
- White-to-pale-blue subtle gradient background — soft, friendly, not stark.
- Centered hero: "The next-gen Helpdesk / designed for efficiency"
- Two CTAs centered: ghost "View demo" + dark pill "Start free trial"
- HUGE product screenshot below — **3-pane Intercom Helpdesk UI**:
  - Left: Inbox sidebar (Mentions / Mine / Unassigned counts)
  - Middle: Mentions list with sender avatars
  - Right: Carlos Rivera conversation thread with status badges

**Lessons for Pegana dashboard:**
- The 3-pane app shell (sidebar / list / detail) is the SaaS-tool canonical
  layout. Pegana's dashboard could adopt: left sidebar (filters/classes/views) /
  middle (asset list with state) / right (asset preview on hover/select).
- **Real product screenshot as the proof** — better than abstract data viz.

---

## Reference 4 — ConductorAI Platform

**URL:** `https://www.conductorai.com/platform`

**Aesthetic — what's unique (the standout of the sweep):**
- White background with **subtle dotted grid** showing through (graph paper).
  Hairline-thin dots, evenly spaced — feels like engineering paper.
- **NUMBERED nav**: `01 PLATFORM` (active, underlined blue) / `02 CASE STUDIES` /
  `03 PARTNERS` / `04 CAREERS` / `05 NEWS`. Mono caps. Each item literally
  prefixed with its position. Reads as table-of-contents.
- Massive sans headline in navy `#1a2540`-ish: "Stop Ctrl-F'ing through
  thousand-page PDFs" — long, declarative, problem-stated-as-headline.
- Right column: short body copy supporting the headline.
- Below: **PRODUCT WORKFLOW VIZ** instead of a screenshot:
  - Mono progress bar "`PROCESSING // 523 DOCUMENTS >>> ████████████ 43%`"
  - Three illustrated agent cards (AGENT ALPHA / AGENT BRAVO / AGENT FOXTROT),
    each a document placeholder with title in mono caps + blue accent dots
    where the agent reviews + dashed lines connecting cards (flow diagram).
- Industrial/aerospace navy + light blue accent. Engineering blueprint feel.

**Lessons for Pegana dashboard (highest signal):**
- **Numbered nav** — `01 DASHBOARD` `02 EVENTS` `03 COMPARE` `04 ACCOUNT` —
  reads as IDE / engineering tool, distinctive vs "Dashboard / Events / Compare".
- **Dotted grid background** + **mono progress bars** + **dashed flow lines**
  between panels = blueprint aesthetic. Costs nothing structurally. Highly
  distinctive.
- **Workflow viz over screenshots** — show what Pegana DOES:
  "INGESTING // 23 ASSETS >>> ████ EWMA → STATE MACHINE → ALERT" as a live
  flow strip at the top of the dashboard. Real-time mono progress bar
  showing engine ticks.

---

# Synthesis — what the new Pegana dashboard should be

The 4 references converge on a few principles:
1. **Commit to one brand atmosphere** (Notion's cobalt / Cloudflare's white /
   ConductorAI's blueprint paper). Pegana's is dark + iridescent — already locked.
2. **Show the real product, or illustrate its workflow** — not abstract
   "live state" decoration.
3. **Distinctive nav** beats generic top-bar. Numbered or letter-prefixed
   feels engineering-tool, not marketing-site.
4. **3-pane app shell** (sidebar / list / detail) is the canonical SaaS
   tool layout — Pegana already has the pieces (AlertsSidebar, AssetTable,
   AssetPreviewPane) but they don't compose into a shell yet.
5. **Hairline + dashed-corner + dotted-grid annotations** are cheap
   structural ammunition that reads as "instrumentation" — perfect for
   a peg-watchdog product whose value prop is measurement accuracy.

## Proposed Pegana dashboard rebuild — concrete

```
┌── TOP BAR (slim, persistent) ────────────────────────────────────┐
│ [ pegana ]  01 DASHBOARD  02 EVENTS  03 COMPARE  04 ACCOUNT     │
│ INGESTING // 23 ASSETS ░░░░░░░░░░░ ENGINE TICK 1.2s │ Open Bot →│
└──────────────────────────────────────────────────────────────────┘
┌── 3-PANE APP SHELL ──────────────────────────────────────────────┐
│ ┌─ SIDEBAR ─┐  ┌─ ASSET LIST (Bloomberg-density table) ─┐  ┌─PEEK┐│
│ │ All 23    │  │ Sym  Name     State   Spread   24h     │  │      ││
│ │ LSTs   8  │  │ jSOL Jito     ●PEG   -0.04% [▁▂▃▂]    │  │ live ││
│ │ Stables 9 │  │ mSOL Marinade ●PEG   -0.02% [▂▂▂▂]    │  │ chart││
│ │ CDPs    2 │  │ BRZ  Brl Real ●DEP   -3.66% [▆▇█]     │  │ for  ││
│ │ Synthetic 1│ │ USDC Circle   ●PEG   +0.01% [▁▁▁▁]    │  │ row  ││
│ │ Watch 4   │  │ ...                                    │  │ on   ││
│ │           │  │                                        │  │ hover││
│ │ DOTTED    │  │  DASHED-CORNER PANEL FRAMES            │  │      ││
│ │ GRID BG   │  │                                        │  │      ││
│ └───────────┘  └────────────────────────────────────────┘  └──────┘│
└──────────────────────────────────────────────────────────────────┘
```

Components to ship:
- **TopBar w/ engine-tick flow strip** — mono progress bar that pulses on
  every engine publish (1.2s cadence). Live workflow visualization.
- **Numbered nav** — `01 DASHBOARD` etc. Brand-distinctive.
- **Sidebar w/ class filters + watchlist** — replaces today's row of pill
  filters. Linear/Vercel/DefiLlama canonical SaaS app layout.
- **AssetList table** — Bloomberg-density rows, mono everywhere data lives,
  inline sparklines, click-row → expand peek pane.
- **PeekPane (right rail)** — slides in on row hover/click, shows the asset's
  live mini-chart + last 3 transitions + Alert-me button. No page navigation
  required.
- **Dotted-grid bg + dashed-corner panels** as the signature graphic motif.

This is a real structural rebuild — not "pillify the filters and call it
done." It removes the current top-search-bar pattern and turns the
dashboard into a 3-pane app shell, the SaaS canonical that all 4 saaspo
references converge on.

## Not in scope (yet)
- About / changelog / privacy / terms / status / events / asset / compare /
  account — those need their own saaspo sweep (next tasks) before any
  rebuild. The pages reverted earlier today are intentionally back at
  their old design until the saaspo refs for each page-type are in.
