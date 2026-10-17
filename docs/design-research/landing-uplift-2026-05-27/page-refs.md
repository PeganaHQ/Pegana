# Per-page references — Pegana marketing + app pages

Sweep on 2026-05-27, post landing-uplift-v3, to gather real polished SaaS
references for every Pegana page (except `/dashboard`, saved for last).

Each archetype gets: 2-3 real-world examples, the **structural move** worth
lifting, and the Pegana-specific adaptation.

---

## `/about` — operator + story page

### References
- **Linear** (https://linear.app/about) — 64px Inter Variable 510 headline, single statement + sub, then HUGE founder photo. Editorial weight on the person.
- **Vercel** (https://vercel.com/about) — centered headline + sub copy with bold accents, then 3-col grid with **bold lead-in + period** ("Easy.", "Universal.", "Accessible.") followed by short prose. Brutalist + tick marks at corners.
- **Phantom** (https://phantom.com/about) — playful illustration-led, brand glyph in copy.

### Pattern to lift for Pegana
- **Vercel's bold-tail 3-col grid** for the stats block (Operator / Built with / Status / Hosted / License / Funding). Each cell: bold word + period leading the description.
- **Linear's editorial weight**: drop the GitHub commits widget to its own side rail; let the prose breathe.
- **No grid of chips for contact** — keep pill CTAs (already done in v3).

### Current state
v3 commit `fe09262` applied: headline italic accent, stats grid 2-col with mono dt + value + sub, pill CTA row. **Still missing**: Vercel-style "bold lead-in + period" pattern on the stats descriptions.

---

## `/changelog` — release history

### References
- **Linear "Now"** (https://linear.app/changelog) — timeline column on left (orange dot + date), entry content on right (h2 + visual mockup + body). Filter tabs above: All / Changelog / Community / News / Craft / AI / Practices / Press. Search + bell.
- **Stripe** (https://stripe.com/changelog) — simple month-grouped list with API version pill + bullet items.
- **Resend** (https://resend.com/changelog) — minimalist date-bordered cards.

### Pattern to lift for Pegana
- **Linear's timeline pattern** — orange dot on left, date in mono, release title + body on right. Vertical hairline rail running down the page connecting the dots.
- **Filter tabs** (already have: All / Feature / Fix / Internal).
- **RSS link top-right** (already have).

### Current state
v3 commit `fe09262` applied: italic headline, removed `(01)`/`(02)`, updated releases with v3 + webhook + v2 launch. **Still missing**: Linear's timeline rail; current is 2-col grid (date | body) without the dot connector.

---

## `/status` — operational health

### References
- **Vercel Status** (https://www.vercel-status.com) — big blue banner "All Systems Operational", then per-service section with **90-day uptime bars** (one bar per day, colored by status: blue=ok, orange=degraded, red=down). "Subscribe to updates" pill CTA top-right.
- **Openstatus** (https://openstatus.dev) — green banner, 45-day bars per service with hover tooltip.
- **OpenAI Status** (https://status.openai.com) — similar 90-day pattern.
- **Cloudflare Status** (https://www.cloudflarestatus.com) — industry-standard incident timeline below the uptime bars.

### Pattern to lift for Pegana
- **Big status banner** at top: "All systems operational" with state-pip background (st-pegged green when ok). Already brand-fits Pegana.
- **90-day uptime bars** per source (DexScreener / Jupiter / Pyth / Hylo / Sanctum / etc). Each bar a div, color from state token.
- **Subscribe to updates** pill — link to Telegram bot or RSS.
- **Incident timeline** below (last 5-10 incidents with date + status + resolution).

### Current state
Pegana `/status` exists but is the older "per-source freshness" layout, not the canonical status-page format. Worth lifting Vercel's pattern fully — it's the industry-recognized contract for "this is a status page".

---

## `/events` — depeg event history

### References
- **Linear Changelog** (timeline pattern, already documented above)
- **Stripe Events Dashboard** (https://docs.stripe.com/api/events) — table-driven event list with type filter, date column, expandable row with payload.
- **GitHub Releases** (https://github.com/lrafasouza/pegana/releases) — long-form per-release card pattern.
- **DefiLlama News** (https://defillama.com/news) — list with timestamp + asset chip + headline + body.

### Pattern to lift for Pegana
- **Linear's timeline rail** (dot + date) + per-event cards on the right.
- Each event card: state pip (DEPEG/RECOVER/DRIFT/CRITICAL) + asset ticker + spread + duration + recovery time + sparkline.
- **Filter by**: asset class (LST / stable / synthetic), state (depeg / recover / drift), time range (24h / 7d / 30d / all).
- **Per-event detail link** to dedicated event page (future).

### Current state
`/events` page exists but inherits old design. Worth replacing with v3 pattern: dark editorial timeline, factual headlines (no marketing prose), mono numbers, sparklines where the data pays rent.

---

## `/asset/[symbol]` — asset detail

### References
- **DexScreener pair** (https://dexscreener.com/solana/...) — top stat strip (price / 24h change / volume / liquidity / market cap) + big TradingView chart + recent trades table.
- **Etherscan token** (https://etherscan.io/token/0xdac17f...) — header with token logo + name + symbol + price, then tabbed sections (overview / holders / transfers / contract).
- **CoinGecko coin** (https://www.coingecko.com/en/coins/usdc) — most detailed: hero with multi-stat + 24h spark + comprehensive market data sections.

### Pattern to lift for Pegana
- **Hero stat strip**: peg state pip + ticker + current spread (big mono number with state color) + asset name + 24h transitions count + last update timestamp.
- **Chart**: intrinsic vs market over time, with state-zone bands (green / amber / red horizontal stripes for PEGGED/DRIFT/DEPEG thresholds).
- **Metadata grid**: class · peg_target · decimals · mint · source for intrinsic · source for market · last computed at · alert subscribers count.
- **Recent events table**: last 10 state transitions on this asset (compact rows).
- **Alert me** pill CTA — opens SubscribeModal.

### Current state
`/asset/[symbol]` exists. Worth aligning hero + chart + metadata pattern to v3 design language (mono numbers, state pips, no eyebrow).

---

## `/compare` — cross-asset comparison

### References
- **Notion comparisons** (https://www.notion.so/product/notion-vs-confluence) — side-by-side feature table.
- **CoinGecko compare** (https://www.coingecko.com/en/coins/compare) — token vs token chart overlay + side-by-side stat columns.
- **TradingView compare** — multi-line chart with legend per symbol.

### Pattern to lift for Pegana
- **2-column asset selector** at top (asset A + asset B + add asset C button).
- **Overlay chart**: spread % over time for both assets on same axis (state-color lines).
- **Side-by-side stat columns**: current state · spread · 24h transitions · class · peg_target · last alert.
- **Diff highlight**: differences between A and B (e.g., "BRZ is in DEPEG, jitoSOL is in PEGGED, spread delta 366 bps").

### Current state
`/compare` exists. Current design is functional but pre-v3.

---

## `/account` + sub-pages

### References
- **Linear settings** (auth-gated, can describe from memory) — sidebar nav (Account / Notifications / Integrations / Theme) + main panel with form-led sections.
- **Vercel settings** (https://vercel.com/account/settings — also auth-gated) — same sidebar pattern, generous form spacing.
- **Stripe dashboard settings** — same archetype, slightly denser.

### Pattern to lift for Pegana
- **Persistent left sidebar** (already have via account-sidebar.tsx): Account / Subscriptions / Alerts / Webhooks.
- **Main panel**: title (sans, mid-size) + body + form sections separated by hairlines.
- **AccountChip in header** (already implemented in v1.1 console branch — keep).
- **Forms**: pill-style submit + ghost-style cancel.

### Current state
`/account/*` pages built in v1.1 Console branch. Worth aligning typography + pill CTAs to v3.

---

## `/embed` — badge widget playground

### References
- **Stripe Elements playground** (https://stripe.com/payments/elements) — left panel: configurator (theme / locale / accent color). Right panel: **live preview iframe** that updates in real time as you tweak.
- **Cal.com embed** (https://cal.com/embed) — same configurator + preview pattern, with copy-paste snippet below.
- **Resend block editor** — same idea for emails.

### Pattern to lift for Pegana
- Current `/embed` page already does this well (EmbedClient component). Worth aligning headline + body to v3 (already done in commit `fe09262`).
- **No further structural change needed** — keep the playground UI, just type/color updates.

### Current state
v3 commit applied. ✓

---

## `/privacy` + `/terms`

### References
- **Stripe Privacy Center** (https://stripe.com/legal/privacy-center) — hub page with sections + breakouts to detailed pages.
- **Linear Privacy** (https://linear.app/docs/privacy) — long-form prose with sidebar TOC.
- **Vercel Privacy** (https://vercel.com/legal/privacy-policy) — narrow column, generous line-height, no decoration.

### Pattern to lift for Pegana
- Current narrow-column long-form layout is correct for legal pages.
- **TOC sidebar** would be nice for navigability — but only if the doc is long enough (ours is medium).
- v3 commit aligned headline + section spacing. ✓

### Current state
v3 commit applied. Privacy + Terms both clean. **Nothing to add** unless we want TOC sidebar.

---

## `/methodology` — docs page

### References
- **Vercel docs** (https://vercel.com/docs) — left sidebar with nested sections, right TOC, main column with prose + code blocks.
- **Stripe API docs** (https://docs.stripe.com) — same 3-col layout with extreme polish on code snippets.
- **Helius docs** (https://docs.helius.dev) — Mintlify-based, similar 3-col.

### Pattern to lift for Pegana
- **3-col docs layout**: left nav + center prose + right TOC.
- **BUT** — Pegana's docs are at `pegana.xyz/docs` (Mintlify, served via a Vercel rewrite; the old `docs.pegana.xyz` subdomain is dead) now. The in-app `/methodology` page is a SUMMARY, not full docs.
- **Recommendation**: kill the in-app `/methodology` page or repurpose it as a teaser that links to `pegana.xyz/docs/methodology/overview`.

### Current state
`/methodology` redirects to Mintlify per `next.config.ts`. The file still exists at `app/(app)/methodology/page.tsx` but is ghost.

---

# Implementation priority (excluding /dashboard)

1. **`/about`** — apply Vercel "Easy. Universal. Accessible." 3-col bold-tail pattern to the stats grid
2. **`/changelog`** — lift Linear timeline rail (dot + date connector)
3. **`/status`** — replace freshness layout with canonical 90-day uptime bars (Vercel pattern)
4. **`/events`** — Linear timeline applied to depeg events; replaces UniverseGrid live-dump's space on landing too
5. **`/asset/[symbol]`** — hero stat strip + chart + metadata grid (DexScreener-inspired but Pegana-tone)
6. **`/account/*`** — apply v3 typography + pill CTAs
7. **`/compare`** — overlay chart pattern (Notion / TradingView)
8. **`/embed`** — ✓ already aligned
9. **`/privacy`, `/terms`** — ✓ already aligned (consider TOC sidebar later)
10. **`/methodology`** — delete file or kill ghost route
11. **`/dashboard`** — saved for last per user request

Each item above is a single small focused PR.
