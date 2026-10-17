# Pegana Product Audit — 2026-06-02

## Executive summary

The signed-in app is, at its best, genuinely best-in-class: the asset-detail TV-chart, the sticky live rail, and the real-data history panels (ActivityTimeline / StateStrip30d / ComparableEvents) are craft work that should set the quality bar for every other surface. But the product is undermined by a cluster of **trust-breaking data bugs** that are fatal for a peg-risk *oracle* — most damningly, SOL-pegged NAV/market prices are labeled "SOL" while shipping USD values (jitoSOL renders "market 100.94 SOL" for a ~1.04-SOL asset), the Status page paints an 89-of-90-day **fabricated** uptime wall, and the asset-detail "7d" health KPIs are silently computed from 24h of data. Layered on top is a **legibility failure** that makes the correct, sophisticated class-specific thresholds *look* like a bug to every naive user (sUSD "+2.24% PEGGED" sitting above USDT "+0.13% DRIFT" with no band shown). The product also has structural gaps versus DefiLlama/TradingView-grade tooling: no search/command palette, a hover-only/keyboard-hostile dashboard, an Events feed that isn't live during a depeg, a Compare "Save" button that silently discards work, and onboarding that teaches a dashboard that no longer exists.

**Verdict per surface:**

| Surface | Verdict |
|---|---|
| **Dashboard** | Strong 3-pane bones, but undermined by illegible thresholds, hover-only/no-keyboard nav, no search, and onboarding that describes a dead UI. **Fix trust + legibility, then add search.** |
| **Assets / Compare** | /assets is a flatter clone of the dashboard with a self-contradicting color function; Compare has a fake-success "Save" bug and bleeding empty-state numbers. **Differentiate or redirect /assets; fix Compare bugs.** |
| **Asset detail** | Best-in-class chart + rail. Marred by the USD-as-SOL mislabel, 24h-as-7d KPIs, mobile-dead exit liquidity, and a fake recovery sparkline. **Keep the craft, kill the lies.** |
| **Events / Status** | Both have honest, well-built bones but mislead at the headline: Status fabricates uptime and omits the one delivery-health signal built for it; Events is poll-only and numberless. **P0 trust + live wiring.** |
| **Data correctness** | The product's core promise is numeric credibility; 9 distinct bugs currently break it. **This is the launch blocker.** |
| **Design system / brand / motion / a11y** | Editorial lock mostly held, but depeg/critical spread text fails WCAG AA, state dots are silent to screen readers, mono creeps onto buttons, raw iridescent hex leaks, and the app has zero entrance choreography the marketing site has. **Tighten before public launch.** |

---

## Data-correctness bugs (P0)

These break the "every number is real" positioning and must ship before the verdict gate (06-11).

| # | Bug | Surface | Evidence | Fix |
|---|---|---|---|---|
| 1 | **LST/synth market & intrinsic prices are USD but labeled "SOL"** — jitoSOL hero reads "market 100.94 SOL · intrinsic 100.45 SOL" (~100× off; it's ~1.04 SOL / ~$100) | asset-detail (+ dashboard peek, mechanism-flow, arb hint) | API `market_usd:"100.99"`, `intrinsic_usd:"100.49"`; `asset-hero-v2.tsx:92`+`181-190` uses `PEG_UNIT[peg_target]`; repeats `mechanism-flow.tsx:150/205/212`, `dashboard/page.tsx:270`, `asset/[symbol]/page.tsx:225`. Verified in `shots/asset-jitoSOL-desktop.png`. | Label these two fields USD unconditionally via existing `formatUsd()` (`format.ts:280`); drop `peg_target` unit on the value strip. **S** |
| 2 | **Status uptime bars are 89/90 days fabricated** — a seeded PRNG paints a near-solid-green 90-bar wall; only "today" is real | status | `status/page.tsx:90-101` `mockSamples()` PRNG; disclaimer buried at `:213-217` under a 40px "Last 90 days." headline; `status-desktop.png`. | Render only measured data: real "today" + freshness age, left-pad rest as explicit UNKNOWN grey (`uptime-bars.tsx:51-55` supports it). Never synthesize green history. **M** |
| 3 | **"Health · 7d" and hero "drift floor (7d)" are computed from 24h of data** | asset-detail | `page.tsx:103-111` fetches `from = now−24h`; `asset-rail.tsx:157`+`83-107` and `asset-hero-v2.tsx:99-108/167` label it 7d; only `stateFlips7d` is real 7d. jitoSOL mobile shows rail "Worst −0.65%" == hero 24h-range floor. | Fetch a real 7d window for the KPIs (the chart already makes this call at bucket=7d) OR relabel to "24h". **S** |
| 4 | **Class-specific bands invisible where spread is shown — dashboard looks self-contradictory** | dashboard (+ assets, compare) | sUSD `+2.24%` green PEGGED above USDT `+0.13%` amber DRIFT; bare `formatGap` at `asset-table.tsx:164`, mobile `dashboard/page.tsx:437`. Ladder exists only on detail (`alert-policy.tsx:84`); `thresholdsFor()` at `policy.ts:77`. `shots/dashboard-desktop.png`. | Show each row's own drift band inline (caption "/ band 0.15%" or a "% of band" micro-gauge). Editorial caption, not a track. **M** |
| 5 | **Compare "Save as watchlist" writes to a key nothing reads — fake "Saved" pill** | compare | `compare/page.tsx:328/331` writes `pegana:watchlists`; real store uses `pegana.watchlist.v1` (`watchlist.ts:5`); grep: `pegana:watchlists` has zero readers. Green pill at `:319-323`. | Call the real `useWatchlist` (already destructured as `watch`, `compare/page.tsx:58`). **S** |
| 6 | **Comparable-events cards draw a hardcoded fake recovery curve** | asset-detail | `comparable-events.tsx:139-144` polyline `"0,16 10,20 25,26 40,22 60,16 80,12 100,10"` identical for every event; subtitle promises "recovery profile" (`:117`). | Plot the real spread path from `/history` for the event window, or drop the sparkline and keep honest stats. **M** |
| 7 | **/assets spread color contradicts its own state pip** | assets | `assets/page.tsx:140-149` colors by raw `abs(bps)` (>300→st-depeg), independent of `state`; `STATE_COLOR` at `:40-47` colors only the pip. INF −1.20% renders amber next to a PEGGED pip (`assets-list-desktop.png`). | Color the spread off engine `state` (reuse `STATE_COLOR`/`STATE_TEXT_COLOR`), delete the bps heuristic. **S** |
| 8 | **WS silent-open socket leaves dashboard "live" and frozen with no signal** | global | `ws.ts:38-43` reconnects on close only; no heartbeat-timeout watchdog (`onHeartbeat` wired at `:32`). Dashboard `liveOverridesRef` (`page.tsx:65`) has no staleness path; EngineFlowStrip stays green. | Add a heartbeat-timeout (~3× the ~5s cadence) → force-close + `onStale`; reuse StaleBanner age logic on the dashboard header. **M** |
| 9 | **Per-row history re-fetches every render (SWR key keyed off raw `Date.now()`)** | dashboard | `sparkline-cell.tsx:25` uses raw `Date.now()`; `use-history.ts:9` keys on `JSON.stringify(opts)` → ms-drift cache misses. Proven: `network-asset.txt` lines 30 vs 84 (two jitoSOL history calls 0.73s apart). `series_24h` already inline. | Render row sparklines from inline `series_24h` (zero extra requests, as `asset-card.tsx:142-145` already does); or floor `from` to the minute. **M** |

Honorable-mention correctness notes (verified **not** bugs / lower tier): the `/asset` vs `/assets/[symbol]` redirect is correct (`assets/[symbol]/page.tsx`, B-023) — keep as a guardrail; the alert-ladder-vs-live-state gap is **hysteresis**, not mirror drift (`policy.ts:74-75` CONFIRM_UP/DECAY_DOWN), so it needs an annotation, not a config fix.

---

## Prioritized backlog

| Tier | Surface | Improvement | Effort | Impact |
|---|---|---|---|---|
| P0 | asset-detail | Label USD prices as USD, not "SOL" (#1) | S | high |
| P0 | status | Stop rendering fabricated 90-day uptime; show only measured (#2) | M | high |
| P0 | asset-detail | Fix "7d" KPIs that use 24h data (#3) | S | high |
| P0 | dashboard | Surface class-specific drift band inline with spread (#4) | M | high |
| P0 | compare | Fix fake "Saved" — wire to real watchlist store (#5) | S | high |
| P0 | asset-detail | Remove hardcoded fake recovery sparkline (#6) | M | medium |
| P0 | assets | Color spread off engine state, not raw bps (#7) | S | medium |
| P0 | global | WS heartbeat watchdog so frozen feed can't read green (#8) | M | medium |
| P0 | dashboard | Render row sparklines from inline series_24h; kill key-drift refetch (#9) | M | medium |
| P0 | status | Surface `delivery_health` — the signal added for this page | S | high |
| P0 | global | Lighten depeg/critical spread-text tokens to pass WCAG AA | S | high |
| P1 | dashboard/global | Cmd-K command palette + inline filter box (fuzzy symbol/name/class) | M | high |
| P1 | dashboard | Roving-tabindex keyboard nav; decouple peek from hover-only | M | high |
| P1 | dashboard | Rewrite onboarding step 04 to the real 3-pane shell (kill mosaic/Lite-Pro/seed/search claims) | S | high |
| P1 | events | Wire Events feed to live WS (pip + new-row flash); drop poll to ~10s | M | high |
| P1 | events | Add magnitude to event rows (discount/spread, inline sparkline) | M | high |
| P1 | assets | Make /assets a real screener (sort, search, sparkline, safety col) OR redirect to dashboard | L | high |
| P1 | assets | Sortable column headers (spread, \|spread\|, state, class) + URL-encoded sort | M | high |
| P1 | assets | Sparkline column from inline series_24h (Sparkline atom, zero fetches) | S | high |
| P1 | global | Status calibration banner (verdicts provisional through 06-10) | S | medium |
| P1 | dashboard | Per-row peg-stability/jitter signal from series_24h dispersion | S | medium |
| P2 | compare | "Widest now" / "Drifting" computed presets | S | medium |
| P2 | compare | Share-link + PNG/CSV export | M | medium |
| P2 | compare | Per-series PEGGED-band guides on the overlay | M | medium |
| P2 | compare | Quiet "preview" mode for the empty-state ghost chart (hide legend/axis) | S | medium |
| P2 | asset-detail | State-transition markers + shaded DRIFT/DEPEG regions on the chart (lightweight-charts v5 `createSeriesMarkers`) | M | medium |
| P2 | asset-detail | Market-vs-intrinsic two-line chart view | M | medium |
| P2 | asset-detail | Share/permalink + URL-encoded tab/range/mode (+ OG image) | M | medium |
| P2 | asset-detail | Recovery-confidence rubric breakdown + HelpIcon + "calibrating" badge | M | medium |
| P2 | asset-detail | Exit liquidity: fetch on mobile (stacked cards) instead of blanking | M | high |
| P2 | asset-detail | Fix hardcoded "24h spread" H2 (range toggle goes to 30d) | S | medium |
| P2 | global | Sign-convention label ("premium"/"discount" to NAV) at hero + list | S | medium |
| P2 | global | fetch timeout (AbortSignal) so a hung API fails fast, not perpetual skeleton | S | low |
| P2 | global | aria-live + announce on dashboard state pips (screen-reader-silent today) | S | medium |
| P2 | global | Subscribe asset-detail hero/chart to live WS; patch market/intrinsic into overrides | M | medium |
| P2 | events | Deep-link to the depeg moment (`?t=` + chart scroll/marker) | M | medium |
| P2 | dashboard | Promote sort headers (arrows on all keys); density toggle; band-% column | M | medium |
| P2 | dashboard | Mark pinned rows in table; one-tap row pin; server-side watchlist for signed-in users | M | medium |
| P2 | dashboard | Default peek to worst-state asset, not widest \|spread\| | S | low |
| P2 | dashboard | Render peek from lg (drop xl:flex) so the reserved 360px column isn't a dead gutter | M | medium |
| P2 | dashboard | Visible live heartbeat (pulse dot + "updated Ns ago"); real tick cadence | M | medium |
| P3 | global | App entrance choreography (reuse GSAP Reveal) + `<MotionConfig reducedMotion>` | M | medium |
| P3 | global | Sharp-geometry sweep: rounded-none on onboarding modal; delete 01–06 numbers | S | medium |
| P3 | global | Route tick-flash through a token, not raw `#ff8400`; fix `#feed7a`/`#ff8400` leaks | S | medium |
| P3 | dashboard | Gate the onboarding shimmer loop with reduced-motion (animates `left`, MotionConfig won't cover it) | S | medium |
| P3 | dashboard | Reframe "Bloomberg-density" code comments; flat sub-bar (no wash-gradient section bg) | S | medium |
| P3 | global | Mono → sans on interactive English labels/CTAs | S | low |
| P3 | dashboard | Drive shell height off measured header, not two hardcoded literals | S | low |
| P3 | assets | List → Compare deeplink (multi-select / "Compare top 4 LSTs") | M | medium |
| P3 | global | Shared-layout (layoutId) row→detail transition + animated live re-sort | M | low |
| P3 | compare | Drag-to-zoom + brush/minimap (synced crosshair already exists) | M | medium |
| P3 | asset-detail | Exit-liquidity depth curve (8–10 log-spaced sizes + "safe exit size") | M | medium |
| P3 | asset-detail | Intrinsic/NAV backing decomposition (Proof-of-Reserves pattern) | L | high |
| P3 | events | Seed Events with historical reference depegs (USDC Mar-2023) as replay cards | L | high |
| P3 | asset-detail | PPR/cache-components streaming shell (needs server-component split) | L | low |
| P3 | status | Make uptime bars interactive (per-day drill) once real data lands | S | low |
| P3 | events | Reframe calm-market empty state as "all clear," not "no data" | S | low |

---

## Per-surface deep-dives

### Dashboard

**Class-specific thresholds look like a bug (P0 #4).** *Now:* the spread column renders bare signed % with no band, so sUSD "+2.24%" green sits above USDT "+0.13%" amber and a naive reader concludes the engine is broken. *Recommend:* render each row's spread against its own class band — a tiny "% of band" micro-gauge or a "band ±X%" caption — and show the active threshold in the peek pane. The `STATE_BUCKETS` ladder already exists (`onboarding-modal.tsx:562-574`) and `thresholdsFor()` is client-side. *Why:* the product's entire claim is *legible* peg risk; the headline color contradicting the headline number with no explanation is the worst failure inside the calibration window. *Ref:* Pyth confidence-band visual language; Sanctum/Curve render tolerance bands beside the live value.

**No search / command palette (P1).** *Now:* the only way to an asset is scanning a 21-row list or the sidebar filters — grep for input/search/cmdk across the four shell files returns nothing, and onboarding even *promises* a search toolbar that doesn't exist. *Recommend:* Cmd-K palette fuzzy-matching symbol+name+class → `/asset/[symbol]`, plus an inline filter box in the sticky list header. radix-ui is already a dep. *Why:* a trader watching a depeg needs to type "usdt" and be on the chart in under a second. *Ref:* Linear/cmdk; DefiLlama global search.

**Hover-only, keyboard-hostile (P1, a11y).** *Now:* rows are Links whose only selection driver is `onMouseEnter → onSelect` (`asset-table.tsx:109`); zero keyboard handlers, so a keyboard/touch user can never drive the peek pane. *Recommend:* roving-tabindex listbox — ArrowUp/Down drives the active row + peek, Enter opens, `/` focuses search; decouple peek from hover. *Ref:* macOS Mail / Linear j/k model; WAI-ARIA listbox.

**Onboarding teaches a dead dashboard (P1).** *Now:* `onboarding-modal.tsx:674-681`+`688-690` walks Anchor/Editorial/Active-strip/Watchlist/Table/Preview and promises "view mode (table/mosaic) and a Lite/Pro toggle" plus a default seed and class/safety sort — none of which exist in the shipped 3-pane shell. *Recommend:* rewrite step 04 to the real Sidebar/List/Peek and use a literal annotated screenshot so it can't drift again. *Why:* onboarding is the credibility-setting first impression for a trust product. **Cheapest high-impact fix in the backlog.**

**Peek auto-previews a healthy asset (P2).** With nothing selected the peek shows the widest \|spread\| (`page.tsx:103-109`), which is sUSD +2.24% **PEGGED** — while the only DRIFT in the universe (USDT) sits elsewhere. Default the peek to worst-state-first so the auto-preview agrees with the alarm coloring.

**Other dashboard items:** the `lg:grid` reserves a 360px peek column but the peek itself is `xl:flex` → a dead 360px gutter at 1024–1279px (P2); live ticks barely read as live — one GSAP flash, a static SVG chart, a hardcoded "Tick 1.2s" literal (P2); sort controls are 9px mono glyphs with the direction arrow only on spread, no density toggle (P2); watchlist is localStorage-only, unmarked in the table, never syncs despite auth (P2); shell height subtracts 110px from two literals that don't map to any element (P3).

**Keep:** the 3-pane density and the live-override merge (state+discount already reconciled from WS into the table — `dashboard/page.tsx:65-79`, `asset-table.tsx:94/207-215`) are genuinely good. Do not rebuild.

### Assets / Compare

**/assets is a flatter clone (P1).** Every capability is a subset of the dashboard; both link to the same detail. *Recommend:* make /assets the analyst **screener** the dashboard isn't — search, sortable columns (spread, \|spread\|, state, class, plus the already-computed `safetyGrade` at `format.ts:170`), state chips, and a 24h sparkline per row — **or** redirect it to /dashboard the way `/assets/[symbol]` already redirects. Two near-identical flat tables are dead weight. *Ref:* DefiLlama Stablecoins screener; Token Terminal.

**Wasted `series_24h` (P1).** Every asset already ships an inline 25-point `series_24h` array, but /assets rows show no trend. *Recommend:* a sparkline column rendered from `asset.series_24h` via the `Sparkline` atom (exactly as `asset-card.tsx:142-145` does) — **zero extra requests**. Do **not** reuse `SparklineCell` (it fetches `/history` per symbol → 21 extra calls). Cheapest upgrade to make /assets feel like a screener.

**Static header that looks sortable (P1).** `assets/page.tsx:114-119` renders an Asset/Class/Spread/State header as plain spans; rows hard-sort class-then-alpha, burying USDT's DRIFT mid-table between USDS and USDY. Make headers clickable sort toggles, persist in `?sort=spread.desc`.

**Compare fake-save (P0 #5)** and **bleeding empty-state ghost chart (P2):** `compare/page.tsx:211` wraps a live `CompareChart` in `opacity-30` only, so the legend (JITOSOL −0.50% / MSOL −0.36% …) and overlapping −50/−50 axis ticks read through as a loading glitch. Add a `preview` prop that hides legend + axis labels. *Ref:* Linear/Vercel faded label-free silhouettes.

**Compare gaps (P2):** computed "Widest now"/"Drifting" presets (only 3 static ones today, `reconcileBps` already imported); share-link + PNG/CSV export (selection is already URL-driven but nothing surfaces it); per-series PEGGED-band guides so a yield token's wide-band line isn't misread as "worse."

### Asset detail

**Keep this as the reference bar.** The lightweight-charts v5.2.0 integration (1h/24h/7d/30d, baseline/area/line/candle with candle gating, muted raw overlay, threshold price-lines, mono crosshair tooltip, expand-to-fullscreen, GSAP reduced-motion draw-in) and the sticky live rail with one-click Telegram subscribe are genuine craft. The fixes below are labeling/coverage/trust — **do not regress the chart or rail.** (Minor: `page.tsx:41` comment says "Recharts ~95KB" but it's lightweight-charts — cosmetic.)

**The lies to kill:** USD-as-SOL mislabel (P0 #1), 24h-as-7d KPIs (P0 #3), fake recovery sparkline (P0 #6). **The coverage gaps:** exit-liquidity is silently blanked on every viewport ≤1023px (`exit-liquidity.tsx:85-88`) while the footnote still claims "Live Jupiter quotes" — reflow to stacked cards instead of blanking the page's most differentiated feature (P2). **The opacity gaps:** recovery-confidence shows an unauditable "C · 63%" letter with invisible weights and no methodology link (P2) — reuse the existing HelpIcon and show the factor breakdown; the chart never marks state transitions or shades DRIFT/DEPEG episodes (P2) even though per-point state color is already computed (`asset-chart.tsx:154-161`) — use v5 `createSeriesMarkers` + a wash-tinted region; no market-vs-intrinsic two-line view despite that being the product's core mental model (P2); the H2 hardcodes "24h spread" while the toggle goes to 30d (P2); no share/permalink or URL-encoded view state on the most-shared surface (P2).

**Net-new on detail:** intrinsic/NAV **backing decomposition** (P3, L) — turn the opaque `intrinsic_usd` into "stake pool: N SOL/share, last epoch, validator count" / "collateral vs short notional" / "reserve composition," the Proof-of-Reserves pattern that moves Pegana from gap-meter to *why-is-this-worth-what-it-claims*. *Ref:* Chaos Labs Edge / Ethena transparency dashboard.

### Events / Status

**Status fabricates uptime (P0 #2)** and **omits `delivery_health` (P0).** The `delivery_health` block (`types.ts:79-89`) — whose own doc-comment says failures "dropped alerts to users without any visible signal" — has **zero usages** outside types.ts, even though `stats` is already fetched. Add an "Alert delivery" row (Operational when `failed_24h===0`, Degraded otherwise, surfacing `last_failure_error`). A page that says "All systems operational" while alerts silently fail to send is lying. *Ref:* Stripe/Twilio break out "Webhook/Notification delivery" as a separate component. Also: no **calibration banner** despite the verdict gate at 06-11 (P1) — add a slim neutral "verdicts provisional through Jun 10" notice; it also pre-empts the threshold confusion.

**Events isn't live and is numberless (P1).** `events/page.tsx:77` is a 30s SWR poll with no WS subscription — a new transition takes up to 30s with no pip, no flash, no connection indicator, on the one page people leave open during a depeg. And `AlertRow` (`types.ts:60-68`) carries no price/discount, so every cluster renders "N alerts … worst <state>" with zero magnitude — a user can't tell a −0.2% wobble from a −8% crash. Wire the existing live context (Status already consumes it), animate new rows in with a coral highlight, and join to the assets payload (`assetMap` already built) for inline magnitude + the existing `EventSparkline`. *Ref:* Parsec/DefiLlama live feeds.

**Events polish (P2/P3):** deep-link "replayable" to the actual moment (`?t=` + chart scroll, today it just lands on the default view); reframe the calm-market empty state as "all clear" rather than "no data" (the backend-down branch is already well-built — this is only the calm-vs-filtered distinction).

**Keep:** the per-asset History tab (ActivityTimeline / StateStrip30d / ComparableEvents) is already a real state changelog — don't rebuild it; the Events clustered timeline and the backend-down branch are solid.

### Design system / brand / motion / a11y

**WCAG fails on the most-urgent numbers (P0).** `st-depeg #a55a5a` (3.97:1) and `st-critical #b73838` (3.43:1) are used as spread **text** (`asset-table.tsx:46-47`, `asset-hero-v2.tsx:58-59`, `asset-preview-pane.tsx:68-69`) — both below the 4.5:1 AA floor, and **lower** on the lighter `surface-2 #141414` (3.69/3.19). The lowest-contrast color is assigned to the most-urgent-to-read value. Add lightened `--color-st-depeg-text`/`--color-st-critical-text` tokens validated against `surface-2`; keep the saturated hue as the pip/wash semantic. Mirrors the existing `globals.css:21-24` text-caption precedent.

**State dots are silent to screen readers (P2, a11y).** `state-pip.tsx` defaults `announce=false`; the dashboard pip is an open-coded `aria-hidden` span (`asset-table.tsx:124-133`) with no label and no `aria-live` region, so a PEGGED→DEPEG flip is announced to nobody — and color is the only other cue (which fails for color-blind users given the AA failure above). /assets already passes `announce` — apply the same on the live dashboard + wrap the list in `aria-live="polite"`.

**Motion gaps (P3).** The app has **zero** entrance choreography (GSAP `Reveal` is imported only by marketing pages) and no `<MotionConfig reducedMotion="user">` anywhere — a real a11y hole since the CSS guard doesn't stop framer JS loops. Reuse the existing GSAP Reveal on app surfaces (per 04-MOTION line 229, don't build a parallel `.reveal` path) and wrap the root once. The onboarding shimmer (`onboarding-modal.tsx:726-735`, `repeat:Infinity`) is ungated unlike its siblings — and because it animates `left`, MotionConfig won't cover it, so gate it manually.

**Brand drift (P3).** Raw iridescent hex leaks outside the §4.1 allow-list — `#ff8400` fires the tick-flash on *every* WS tick (`use-tick-flash.ts:16`) and `#feed7a` is a literal keyword color (`code-block.tsx:210`); route through a token. Onboarding modal uses `rounded-md/lg/[10px]` and "01–06" section numbers (deleted in brand v3) — sweep to sharp geometry. "Bloomberg-density" code comments (`dashboard/page.tsx:202`, `asset-table.tsx:15`) reintroduce the one banned framing, and the engine sub-bar paints a full wash-gradient section background (forbidden) — both near-mechanical S fixes; the *rendered* dashboard is on-brand. Mono creeps onto interactive English labels/CTAs (`asset-preview-pane.tsx:336/343/351`, etc.) — switch to Geist 500, keep mono for numbers/tickers only.

---

## Net-new feature bets (competitive research)

1. **Historical depeg replay library (P3, L, high impact).** The flagship promise "Every depeg, replayable" currently shows an **empty grid** during calibration. Seed Events + per-asset Comparable events with real public incidents (USDC Mar-2023 → ~$0.88, USDT episodes) as replay cards with the spread chart pre-loaded. This is the "it really does replay any depeg" demo that converts skeptics on day one — and it works before Pegana has its own incident history. *Ref:* DefiLlama/StableGuard lead with concrete past depegs as proof.

2. **NAV backing decomposition / Proof-of-Reserves (P3, L, high impact).** See asset-detail above — the trust ledger's visible companion that works *today*, vs. the calibration-gated audit ledger. *Ref:* Chaos Labs Edge / Ethena.

3. **Peg-stability / jitter signal (P1, S, medium-high).** A depeg is preceded by rising spread *volatility*, not one bad print. Compute a calm/choppy/volatile score from `series_24h` dispersion (xSOL swings −0.98%→+2.99% while jitoSOL is flat — both render PEGGED today). Nearly free; turns Pegana from a lagging state-reporter into a leading indicator — the thing Chaos/Gauntlet sell as "risk oracle." *Ref:* Pyth confidence interval.

4. **Exit-liquidity depth curve (P3, M, medium).** Sample Jupiter at 8–10 log-spaced sizes ($1k→$1M) and plot slippage-vs-size with the drift threshold as a reference line; headline a single "safe exit size." Answers the treasury question ("how much can I get out before it moves?") that three rows can't, on real routing data no TVL-based competitor has. *Ref:* Curve depth-curve.

5. **Compare as a workbench (P2, M).** Share-link + PNG/CSV export turns Compare from a viewer into a distribution loop — a shared `?s=` link is a live product demo inside a desk/Discord. *Ref:* TradingView snapshot links; DefiLlama CSV.

---

## Quick-wins shortlist (high impact, S effort)

1. **Label USD prices as USD, not "SOL" (P0 #1)** — `formatUsd()` already exists; one-line swap across `asset-hero-v2.tsx:181-190`, `mechanism-flow.tsx`, `dashboard/page.tsx:270`, `asset/[symbol]/page.tsx:225`. Kills the single most trust-destroying number on the page.
2. **Fix Compare's fake "Saved" (P0 #5)** — call the already-imported `useWatchlist` store; a few lines turn a silent-data-loss bug into a working round-trip.
3. **Fix the "7d" KPIs that show 24h, or relabel (P0 #3)** — the 7d fetch path already exists in the chart; relabeling is trivial, fetching is cheap.
4. **Surface `delivery_health` on Status (P0)** — `stats` is already fetched; one health row removes the "All systems operational while alerts silently fail" lie. No backend work.
5. **Rewrite onboarding step 04 to the real 3-pane shell (P1)** — copy + one visual; stops the modal from teaching a dashboard that doesn't exist on a user's first contact.