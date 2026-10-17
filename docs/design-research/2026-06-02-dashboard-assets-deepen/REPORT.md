# Dashboard + Assets — Forward Product Roadmap

**Date:** 2026-06-02
**Surface:** the signed-in app — Dashboard (`/dashboard`), Assets universe screener (`/assets`), Asset detail (`/asset/[symbol]`)
**Status of upstream work:** extends the already-shipped 06-02 P0 data-correctness batch (commit `fde5fae`)

## Executive summary

The 06-02 product audit found and fixed nine P0 data-correctness bugs plus a WCAG-AA pass on the signed-in app — the trust-breaking class of bug where the product told the user something false (USD priced as SOL, fabricated uptime history, mislabeled "7d" KPIs, fake recovery sparklines). That batch is live and verified on `www.pegana.xyz`. This report is the **forward roadmap**: the 41 de-duplicated, code-verified improvements that turn the corrected surfaces from "shows the number" into "shows the risk." The throughline is the product thesis — Pegana is a peg-risk *oracle*, not a price table — so the highest-leverage moves all answer one of two questions the current UI cannot: *how close is this asset to breaking?* (proximity-to-threshold) and *how steady has it been?* (dispersion / jitter), both computable today from data already in the payload. The rest is the load-bearing scaffolding: a real `/assets` screener (sortable, searchable, URL-stateful, breakpoint-complete), keyboard/screen-reader reachability of a peek pane that is currently mouse-gated, and the elimination of three remaining self-contradictions on the trust surface (a chart that draws every asset's drift line at the wrong threshold, a "24h spread" heading over a 30d chart, and onboarding copy that documents a dashboard that no longer exists).

## What we verified is already live

The nine 06-02 P0 fixes hold in code and in prod: USD prices are no longer mislabeled "SOL"; the Status page no longer fabricates 90-day uptime; "7d" KPIs are fixed/relabeled; class-specific drift bands surface inline with spread; Compare "Save" writes to the real watchlist store; the fake recovery sparkline is gone; `/assets` spread color is driven by engine state; the WS heartbeat watchdog flips `connected=false` on stale feeds; and row sparklines render from inline `series_24h` with zero refetch. `policy.ts` is synced to `assets.toml`, and the WCAG-AA token lightening (`st-depeg`/`st-critical` text) plus `formatUsdValue`/`spreadTextClass` are in place. **Every proposal below was checked against the post-`fde5fae` codebase so nothing re-proposes shipped work** — and two items below are direct *follow-through* on those fixes, closing the same class of bug where it still survives (the chart's hardcoded thresholds, the rail's stale "Engine tick 1.2s").

## Master prioritized table

| Tier | Surface | Improvement | Kind | Effort | Impact | Data |
|---|---|---|---|---|---|---|
| P1 | asset-detail | Fix hardcoded `DEFAULT_THRESHOLDS` (chart uses 20/100/300 for every asset) | data | S | high | ✅ |
| P1 | dashboard | Per-row "% of band" micro-gauge (proximity-to-threshold) | feature | M | high | ✅ |
| P1 | assets-list | Sortable column headers, URL-encoded `?sort=&dir=`, default `|spread|` desc | feature | M | high | ✅ |
| P1 | assets-list | Peg-jitter / dispersion column from `series_24h` | data | S | high | ✅ |
| P1 | asset-detail | Peg-jitter signal in hero + rail (`series_24h`, zero new data) | feature | S | high | ✅ |
| P1 | dashboard | Wire `EngineFlowStrip` to `lastHeartbeatAt` (true liveness, not socket-open) | design | M | high | ✅ |
| P1 | dashboard | Peg-stability / jitter signal from `series_24h` dispersion | feature | S | high | ✅ |
| P1 | dashboard | aria-live region announcing peg-state transitions | a11y | M | high | ✅ |
| P1 | dashboard | Decouple peek selection from hover (`onFocus`) — keyboard-reachable | a11y | S | high | ✅ |
| P1 | dashboard | Inline fuzzy filter box above the dashboard table | feature | S | high | ✅ |
| P1 | assets-list | Inline fuzzy search/filter box (symbol/name/class) | feature | S | high | ✅ |
| P1 | assets-list | 24h trend sparkline column from inline `series_24h` | feature | S | high | ✅ |
| P1 | assets-list | Error + empty states (page has NEITHER) | feature | S | high | ✅ |
| P1 | assets-list | Decision: keep `/assets` as the screener (do NOT redirect) | feature | S | high | ✅ |
| P1 | dashboard | Cmd-K command palette: jump-to-asset + view/class actions | feature | M | high | ✅ |
| P1 | dashboard | Roving-tabindex keyboard nav decoupling peek from hover | a11y | M | high | ✅ |
| P1 | dashboard | Rewrite onboarding Step 04 to the REAL 3-pane shell | design | M | high | ✅ |
| P1 | dashboard | Rewrite onboarding step 04/05 copy to match the shell | feature | M | medium | ✅ |
| P1 | dashboard | Sign-convention label (premium/discount) on the spread | design | S | high | ✅ |
| P1 | asset-detail | Recovery-confidence rubric breakdown + calibrating badge | feature | M | high | ✅ |
| P1 | dashboard | Live heartbeat pulse + "updated Ns ago" wired to `lastHeartbeatAt` | feature | S | high | ✅ |
| P1 | dashboard | Tick-flash GSAP tween must honor prefers-reduced-motion | a11y | S | medium | ✅ |
| P1 | asset-detail | Fix lying "24h spread" H2 over a switchable chart range | data | S | medium | ✅ |
| P1 | asset-detail | Exit-liquidity: stacked mobile cards instead of "Quote failed" | feature | S | medium | ✅ |
| P1 | asset-detail | Sign-convention label (discount/premium) on hero/rail spread | design | S | medium | ✅ |
| P1 | assets-list | Make header visibly interactive + add `aria-sort` | a11y | S | medium | ✅ |
| P2 | dashboard | Visual drift-band micro-gauge in the peek pane | design | M | high | ✅ |
| P2 | asset-detail | Exit-liquidity depth curve (multi-size + safe-exit marker) | feature | M | high | ✅ |
| P2 | dashboard | Default peek to worst-STATE asset, not widest `|spread|` | feature | S | medium | ✅ |
| P2 | dashboard | Fix dead 360px peek gutter at 1024–1279px (xl/lg mismatch) | design | S | medium | ✅ |
| P2 | dashboard | Consolidate peek pane into multi-signal summary | design | M | medium | ✅ |
| P2 | dashboard | Stop peek-pane `/history` double-fetch (reuse inline series) | perf | S | medium | ✅ |
| P2 | dashboard | aria-live transitions + watchlist toasts | a11y | S | medium | ✅ |
| P2 | dashboard | Sidebar "Pinned events" → severity-tagged transitions feed | feature | M | medium | ✅ |
| P2 | dashboard | App-shell entrance choreography (MotionConfig + pane cascade) | motion | M | medium | ✅ |
| P2 | dashboard | Retire "Bloomberg-density" framing + wash-gradient sub-bar | design | S | medium | ✅ |
| P2 | dashboard | Improve live-tick legibility (directional flash + caret) | design | S | medium | ✅ |
| P2 | dashboard | Accessible sort headers (`aria-sort` + glyph on all columns) | a11y | S | medium | ✅ |
| P2 | assets-list | Worst-24h `|spread|` column from `series_24h` | data | S | medium | ✅ |
| P2 | assets-list | Promote signed peg-deviation to lead numeric column | design | S | medium | ✅ |
| P2 | assets-list | Multi-select rows → Compare deeplink (`?s=A,B,C,D`) | feature | M | medium | ✅ |
| P2 | assets-list | Watchlist filter tab (scan only pinned) | feature | S | medium | ✅ |
| P2 | assets-list | Top "live peg-event" strip surfacing worst offender | design | S | medium | ✅ |
| P2 | assets-list | Mobile/tablet screener parity (pip + sparkline + sort) | design | M | medium | ✅ |
| P2 | assets-list | Safety-grade column (A–D) from `format.ts safetyGrade` | feature | S | medium | ✅ |
| P2 | asset-detail | State-transition markers on the spread chart | feature | M | high | ✅ |
| P2 | asset-detail | Shaded DRIFT/DEPEG threshold regions (ISeriesPrimitive band) | design | M | medium | ✅ |
| P2 | asset-detail | Shareable permalink (URL-encode tab/range/mode + Copy link) | feature | M | medium | ✅ |
| P2 | asset-detail | Pyth confidence badge on the rail | feature | M | medium | ❌ |
| P2 | dashboard | Tick-flash `#ff8400` → brand token (kill the magic hex) | design | S | low | ✅ |
| P3 | assets-list | Column-set presets (Peg health vs Backing) | feature | M | medium | ✅ |
| P3 | asset-detail | NAV / intrinsic backing decomposition (Proof-of-Reserves) | feature | L | high | ❌ |
| P3 | asset-detail | Historical depeg replay library (seed real incidents) | feature | L | medium | ❌ |
| P3 | asset-detail | Stop tab panels unmounting (kill refetch-on-switch) | perf | M | medium | ✅ |
| P3 | asset-detail | Detail-page entrance choreography (MotionConfig + stagger) | motion | M | low | ✅ |
| P3 | assets-list | Density + hairline polish, hero-count honesty | design | S | low | ✅ |
| P3 | dashboard | Fix stale layout-math comments (topbar/height) | design | S | low | ✅ |
| P3 | asset-detail | Fix stale rail copy ("Engine tick 1.2s" + "7d" comment) | data | S | low | ✅ |

---

## Dashboard

The dashboard is the 3-pane workbench (240px sidebar | center `AssetTable` | 360px peek). Two structural failures define its backlog: it is **keyboard-hostile** (the entire peek-pane value prop is mouse-gated and silent to assistive tech), and it **shows magnitude where it should show risk** (the table tells you a number, not how close that number is to crossing into the next state).

### Features

- **`per-row-band-micro-gauge` — the single highest-leverage move on this surface.** Problem: the table shows raw spread + a sparkline but nothing tells the user how close an asset is to the next state — `-40 bps` is 80% of the way to depeg for USDC (`depeg_bps 50`) but 14% for INF (`depeg_bps 280`). Recommendation: add a compact `|bps| / depeg_bps` micro-gauge cell to the row grid, colored off state with a tick at the drift threshold, and make it a sortable "closest to breaking" key. Lands at `web/components/organisms/asset-table.tsx:77-78` (`ROW_GRID`, a fixed 7-col template — extend the header at `:236-278` in lockstep) computing fill from `reconcileBps` + `PER_ASSET_THRESHOLDS` (`web/lib/alerts/policy.ts:33-75`). Reference: Chaos Labs / DeFi-Monitor proximity-to-threshold leading indicators. This is the differentiator for a risk oracle vs a price table.
- **`peg-jitter-leading-indicator`** — `series_24h` ships inline (already powering `SparklineCell`) but the dashboard reads only its latest value. A steady `-0.30%` and a whipsawing `±0.30%` read identically in the spread column. Add a `seriesJitter()` helper to `web/lib/api/format.ts:269` (compute stdev/MAD in bps space — values are fractional, ×10000), surface as a sortable column + a steady/choppy/volatile label in the peek. Ship the helper once and reuse across the band-gauge and peek-summary items. Reference: Pyth confidence-band widening = uncertainty.
- **`live-heartbeat-pulse-updated-ago`** — `EngineFlowStrip` shows a green "Ingesting" dot off socket-open only and a decorative hardcoded "Tick 1.2s"; it never reads `lastHeartbeatAt` (exposed at `web/lib/store/live-context.tsx:136`). Drive the dot off heartbeat age (green <15s, amber 15–30s, reconnecting >30s — matching `status/page.tsx:101-103`) and replace the static label with "updated Ns ago." On a trust product the headline liveness indicator must be measured, not theater.
- **`cmd-k-palette` / `inline-fuzzy-filter`** — there is zero keyboard-driven navigation in the app (no `cmdk` dep, only `radix-ui`). Ship the **inline filter first** (S-effort, no new dep): extend the `filtered` memo (`dashboard/page.tsx:82-99`) with a substring match over symbol/name/`CLASS_LABEL`, focus on `/`, clear on Esc. The Cmd-K palette (mounted in `web/app/(app)/layout.tsx:17`) is the power-user follow-on. Reference: DefiLlama ships both deliberately.
- **`rewrite-onboarding-step-04`** — the modal teaches a fictional UI: `DASHBOARD_SECTIONS` (`onboarding-modal.tsx:674-681`) lists an "Active strip," a "view mode (table/mosaic)" and a "Lite/Pro toggle" that don't exist, and Step 05 instructs "Hover any row → an Alert+ button appears" when the real peek has Compare + Pin. Rewrite to the actual sidebar | table | peek shell. Same severity class as the shipped data-correctness fixes — it tells the user something false.
- **`peek-defaults-worst-state`** — the cold-open peek sorts purely by `abs(reconcileBps)` (`dashboard/page.tsx:104-110`), so a wide-band PEGGED yield token outranks a genuinely DEPEGGED stable. Rank by state severity first (reuse the order map at `asset-table.tsx:223-225`), then by `% of band`. Use the LIVE state (`liveOverrides`), not the stale SWR value.
- **`transitions-feed-deep-link-severity`** — the sidebar "Pinned events" shows the first 3 non-PEGGED alerts from a static poll, no severity ordering, no "see all," no peek-on-click. Sort by severity, color off `to_state`, add a "View all" → `/events`, thread an `onSelect` so a click sets the peek. The genuinely-live WS feed depends on the separate deferred Events-WS work — scope this PR to ordering + severity + see-all + peek-on-click.

### Design & a11y

- **`peek-keyboard-focus-decouple` — the cheapest high-impact a11y win in the batch.** The peek is set ONLY via `onMouseEnter` (`asset-table.tsx:111`); a keyboard user can only ever navigate away. Add `onFocus={() => onSelect(a.symbol)}` and fix the placeholder copy from "Hover any row" to "Hover or focus any row" (`asset-preview-pane.tsx:164`). The fuller `roving-tabindex-keyboard-peek` (Arrow/Home/End listbox, mirroring the shipped `asset-tabs.tsx` pattern) is the M-effort follow-on.
- **`aria-live-state-pips`** — the product's entire value is state changes, yet every `StatePip` is `aria-hidden` and there is no live region anywhere in the dashboard tree. Add one `sr-only role=status aria-live=polite` region driven by diffing `liveOverrides`, debounced to ~1/3s, announcing only real band transitions ("jitoSOL drifting, spread 1.42% below intrinsic"). Build this together with the keyboard items as one a11y pass / one live region.
- **`drift-band-micro-gauge` — the best P2 on this surface.** The peek shows the drift band as text only ("drift band ±N.NN%"), forcing the user to mentally compare two numbers for the canonical "why isn't this +2.24% red?" case. Add a ~16px horizontal band-gauge under the 36px spread with DRIFT/DEPEG/CRITICAL wash zones and a marker at the current spread. Keep color state-driven (consistent with shipped Fix 7), honor reduced-motion (static). Reference: Pyth confidence-band visual language.
- **`sign-convention-label`** — the spread sub-line reads bare "above/below intrinsic"; name the convention (premium/discount), with a plain-English gloss. **Preserve the `sr-only` legacy string at `asset-preview-pane.tsx:337-341` verbatim** (e2e matches the all-caps "ABOVE/BELOW INTRINSIC").
- **`tick-flash-respects-reduced-motion`** — the GSAP color tween (`use-tick-flash.ts`) bypasses the CSS `prefers-reduced-motion` block entirely, so up to 21 spread cells strobe orange per WS tick for a reduced-motion user. ~5-line `matchMedia` guard; a genuine WCAG 2.3.3 defect.
- **`fix-dead-peek-gutter`** — the grid turns on at `lg` but both `AssetPreviewPane` render branches are `xl:flex`, so 1024–1279px reserves and pays for an empty 360px column. Move the shell to `xl` (and bump the topbar grid to match) for a clean 2-pane tablet view.
- **`drop-bloomberg-wash-subbar`** — "Bloomberg-density" appears in code comments (`dashboard/page.tsx:203`, `asset-table.tsx:15`), contradicting the locked `no_terminal_aesthetic` memo, and the sub-bar is a two-color directional wash implying a good→bad metaphor it doesn't encode. Rename to the editorial register; flatten the gradient to `bg-surface-1/90` + hairline.
- Supporting design/perf/hygiene: `peek-multi-signal-summary` (compose the band-gauge + jitter + worst-24h into the peek head — sequence after the helpers exist), `fix-peek-double-fetch` (pass inline `series_24h` to the pane so keyboard-arrowing 21 rows doesn't fire 21 `/history` calls), `app-entrance-choreography` (scope to the `MotionConfig` wrap — **`Reveal` is a ScrollTrigger primitive and will NOT cascade above-fold panes**), `live-tick-legibility` (build after the token + reduced-motion items; never let the directional tint override `spreadTextClass`), `tick-flash-token`, `sort-header-aria-and-glyphs`, `stale-layout-math-comment`.

**Highest-leverage on the dashboard:** `per-row-band-micro-gauge` — it is the most on-thesis feature in the entire batch and reuses the jitter helper, so build it as the spine and hang `peg-jitter`, `peek-multi-signal-summary`, and the `/assets` jitter column off the same lib work.

---

## Assets (universe screener)

**Decision (`keep-assets-as-screener-not-redirect`):** resolve the deferred "screener OR redirect" by argument, not coin-flip. The dashboard is `hidden lg:grid` and dumps tablet/mobile into a stripped `MobileAssetRow` (no sparkline/sort/peek); a redirect would throw small-screen users into the phone fallback and lose the canonical, deep-linkable `/assets` URL. So: **dashboard = live peek workbench (lg+, hover-driven); `/assets` = scannable, sortable, URL-stateful, breakpoint-complete screener.** DefiLlama keeps both `/stablecoins` and per-asset pages. Every proposal below builds that role.

### Features

- **`sortable-column-headers-url-encoded` — the spine everything hangs on.** Today the header row is plain non-interactive `<span>`s and sort is hardcoded class-family-then-alphabetical (`assets/page.tsx:60-66`), so a DEPEG asset can sit buried while a calm PEGGED asset sits on top — an analyst literally cannot rank the universe by worst-off-peg. Convert headers to `<button>` columnheaders (reuse the ▼/▲ glyph from `asset-table.tsx:273`), default sort to `|spread|` desc, persist to `?sort=&dir=` via the exact `useSearchParams` + `router.replace` pattern already in `compare/page.tsx:64-72`. **Read `web/AGENTS.md` + `node_modules/next/dist/docs` first — Next 16 router APIs differ from training data.** Ship `header-looks-sortable-affordance-fix` (hover state + `aria-sort` + glyph) in the same PR so sort never ships without a visible affordance.
- **`peg-jitter-stability-column`** — the deferred P1 jitter signal, scoped to the screener. Two assets can show the same instantaneous spread yet behave totally differently. Add `pegJitter(series)` to `format.ts:104` (recommend stdev — range is dominated by single outliers like INF's 126bps tick) and a sortable "±N bps" column. Verified dispersion is real and differentiated across the live universe (sd 0.8–2.7bps, distinct from worst-`|s|`). Highest differentiation-per-line on the list.
- **`inline-search-filter-box`** — no text search exists on `/assets`, only 4 class pills. A plain controlled input feeding the `filtered` memo over symbol+name+`CLASS_LABEL`, mirrored to `?q=`. Keep it a plain filter, NOT `cmdk`.
- **`sparkline-column-inline-series`** — every row already ships a 25-element `series_24h` (free data). **Use the `<Sparkline>` ATOM (`sparkline.tsx:36`, takes `points`, never fetches), NOT `SparklineCell`** — `SparklineCell` falls back to a `/history` fetch when `series` is null. Copy the 3-way stroke-color rule from `sparkline-cell.tsx:49-52`.
- **`empty-and-error-states`** — `/assets` destructures only `{data, isLoading}` (`assets/page.tsx:51`), so a backend-down state shows the skeleton FOREVER and a zero-match filter renders a silently empty list. Destructure `{error, mutate}` too, extract `BackendDownState` from `dashboard/page.tsx:464` into a shared component, render an explicit "No assets match {q}" empty state. A real trust gap on the most-bookmarkable cold-deep-link surface.
- Secondary feature columns/flows: `worst-24h-offpeg-column` (the scare the PEGGED pip erases — pair with jitter under a Stability group; guard `Math.max(...[])` → `-Infinity` on empty calibration series), `safety-grade-column` (reuse `format.ts:170` — label it "Heuristic — structural, not live" so it isn't read as the live verdict), `multiselect-to-compare-deeplink` (checkbox gutter with `stopPropagation` → `/compare?s=A,B,C,D` cap 4), `watchlist-filter-tab`, `column-presets-peg-health-vs-backing` (P3 — ship last; `market_usd`/`intrinsic_usd` already in payload so the Backing set needs no new data).

### Design

- **`spread-as-lead-column-signed-colored`** — promote Spread to column 2 and widen it (DefiLlama puts "% Off Peg" ahead of Price). **Keep `spreadTextClass(state)` coloring — do NOT regress to raw-bps color (06-02 Fix 7).**
- **`ai-prompt-strip-worst-offender`** — a thin editorial strip surfacing the current worst non-PEGGED asset + a by-state count. **Must degrade gracefully ("All N assets within band") during calibration** — verified 20/21 are PEGGED live, so the common case is no offender. Editorial sentence, no marquee (brand law).
- **`mobile-screener-parity`** — the State pip+label sit inside `hidden sm:flex`, so on a phone the single most important live signal disappears — and `/assets` IS the de-facto mobile experience. Keep the pip at all breakpoints (label `hidden sm:inline`), add a touch sort control.
- `density-and-hairline-polish` (P3) — drop row padding once 7–8 columns land; **decouple the hero count from `filtered.length`** (a search for "sol" currently misreads "4 assets tracked live"); align numeric columns on `tabular-nums` rails.

**Highest-leverage on `/assets`:** `sortable-column-headers-url-encoded` + its affordance sibling — a sortable, `|spread|`-desc-default, URL-stateful table is the structural spine; the jitter / worst-24h / sparkline / safety columns are the cargo it carries.

---

## Asset detail

The detail page is in good shape structurally (correct WAI-ARIA tablist, dynamic-import chart, rich organism stack). Its backlog splits cleanly into **finishing the 06-02 trust sweep where it didn't reach the chart**, **surfacing the jitter/sign signals the hero is missing**, and **a small number of API-blocked depth bets**.

### Data / trust follow-through

- **`chart-thresholds-per-asset-bug` — the single highest-ROI item in the entire batch.** `DEFAULT_THRESHOLDS = {drift 20, depeg 100, critical 300}` is hardcoded at `page.tsx:56` and drives both the threshold lines and the "now" coloring — while the rail correctly uses `thresholdsFor(symbol, class)`. So for sUSD (`+1.37%`, band `±275bps`) the chart paints a PEGGED asset red while the rail on the *same screen* reads PEGGED. This is the exact class-band trust bug fixed for the dashboard peek (Fix 4), still live on the chart. **One call-site swap** (`thresholds={thresholdsFor(asset.symbol, asset.class)}` at `page.tsx:216`, delete the constant) — `AssetChart` already accepts the per-asset shape.
- **`fix-hardcoded-24h-spread-heading`** — `<h2>24h spread</h2>` (`page.tsx:210-212`) is static while the chart range is user-switchable to 1h/7d/30d. Retitle to "Spread · market vs intrinsic" (the chart header already shows the active bucket). Same family as the shipped 7d-KPI relabel. Also drop "shaded" from the sub-caption until the band primitive ships.
- `fix-stale-engine-tick-and-7d-comment` (P3) — delete the hardcoded "Engine tick 1.2s" literal and the leftover `/* Health · 7d */` comment in `asset-rail.tsx`; piggyback on the jitter/sign-convention rail edits.

### Features

- **`peg-jitter-signal-detail`** — the hero shows current spread, drift floor, 24h range, median and worst — but NOT dispersion. Same `series_24h` helper as the dashboard/screener; surface as a 5th `RailKpi` (`asset-rail.tsx:162-183`) and a hero sub-line. One of the best value/effort ratios in the batch; unblocks the screener jitter column (shared helper).
- **`recovery-confidence-rubric-breakdown`** — the core open bug: the additive rubric awards a **full 25/25 for "flips"** when `flips===0`, and during calibration the alert stream is empty, so every asset silently banks +25 off MISSING data — the "absence == confirmation" trap the Status page was fixed to avoid. Scope to: down-weight the missing-data credit to a neutral value, surface a "calibrating" chip when `alerts.length===0`, add a `recovery_confidence` glossary term + `HelpIcon`. The sub-score bars are secondary polish.
- **`exit-liquidity-mobile-reflow`** — on `<=1023px` the effect short-circuits and marks all rows `failed:true` WITHOUT calling Jupiter, so every phone visitor sees three "Quote failed" rows reading as "the asset is broken." Replace the bail with a mobile branch: stacked cards + a SINGLE `$10k` quote (respects the lite-api budget).
- **`sign-convention-premium-discount-label`** — the hero renders a bare signed number with no word telling a newcomer whether negative is good or bad. jitoSOL `-0.47%` (LST discount, normal) vs sUSD `+1.37%` (yield premium, normal) are opposite signs, both healthy, currently indistinguishable. Glossary terms + `HelpIcon` already exist; trivial.
- P2 depth bets: `chart-state-markers` (`createSeriesMarkers` for FSM transitions — **empty until calibration ends ~06-11**, so P2 not P1), `chart-shaded-drift-depeg-regions` (the `ISeriesPrimitive` band the copy already promises — **must shade symmetric ±bands** or it's invisible for premium assets like sUSD; build with the per-asset threshold fix), `exit-liquidity-depth-curve` (expand to ~6–8 sizes + safe-exit marker; desktop-only sampling keeps the rate budget), `share-permalink-url-state` (URL-encode tab/range/mode; the OG image already gives shared links a live preview).
- P3 / motion / perf: `tabs-keep-mounted-refetch` (panels unmount on switch → remount + re-animate; **prefer lifting the 30d fetch to page level over blanket keep-mounted**, since `ExitLiquidity` fires Jupiter quotes on mount), `app-entrance-choreography-detail`.

**Highest-leverage on detail:** `chart-thresholds-per-asset-bug` — a one-line swap that kills a self-contradiction between the chart and the rail on the same screen, on a trust product.

---

## Net-new feature bets

Two bets are genuinely net-new to the product surface but **API-blocked** — they need a small `/v1/assets` serializer change before any UI, and should be batched into one backend PR:

- **`nav-intrinsic-backing-decomposition` (Proof-of-Reserves, P3/L)** — turn the black-box `intrinsic_usd` into the auditable engine formula (`sol_per_lst × SOL/USD` for LSTs; published NAV redemption-rate for yield/CDP). Core to a risk oracle's credibility. **Blocked:** `sol_per_lst`/TVL are computed in `crates/indexer-rs/src/sources/sanctum.rs:128-130` and written to `intrinsic_snapshots.meta` but are NOT serialized onto the asset endpoint. Scope to LST + yield NAV; do NOT promise fiat-stable reserve attestation or validator/epoch (no MVP source).
- **`pyth-confidence-badge` (P2/M)** — oracle certainty is a first-class signal a risk oracle should show; a low-confidence sample and a high-confidence one render identically today. **Blocked:** the engine buckets it (`engine-rs/src/state.rs:284`) and writes `discount_snapshots.confidence`, but it's only returned on `/v1/audit/:id`. Plumb a `confidence` string onto `/v1/assets`, then render a rail chip. Do NOT scrape Hermes client-side (bypasses staleness gating from hardening H1/H9).

One bet is data-blocked on a *dataset*, not an endpoint:

- **`historical-depeg-replay-library` (P3/L)** — seed the History tab (empty during calibration) with real sourced public incidents (USDC/SVB, UST, stETH) keyed by class. The **curated-seed JSON MVP is buildable now** (`web/lib/data/depeg-precedents.ts`); a `/v1/incidents` endpoint is the later upgrade. Label clearly as external / not-Pegana-measured to honor the Status "never paint history we didn't record" rule.

---

## Quick-wins shortlist (S-effort, high-impact)

These are the cheapest moves with outsized return — most are a single call-site swap, a memo extension, or a ~5-line guard:

1. **`chart-thresholds-per-asset-bug`** — one-line swap, kills a chart↔rail self-contradiction. *Highest ROI in the batch.*
2. **`peek-keyboard-focus-decouple`** — `onFocus` bridge makes the entire peek pane keyboard-reachable.
3. **`peg-jitter-*` (detail + dashboard + screener)** — one `format.ts` helper, three surfaces, a genuinely new risk dimension.
4. **`inline-fuzzy-filter` / `inline-search-filter-box`** — a memo extension; the find affordance a daily operator reaches for first.
5. **`empty-and-error-states`** — kills the forever-skeleton on the most-bookmarkable surface.
6. **`sparkline-column-inline-series`** — free data already in the payload; use the `<Sparkline>` atom.
7. **`sign-convention-premium-discount-label`** — disambiguates the single most-prominent number on each surface; glossary already shipped.
8. **`fix-hardcoded-24h-spread-heading`** — retitle one H2; stops a label lying after a range switch.
9. **`tick-flash-respects-reduced-motion`** — ~5-line `matchMedia` guard; a real WCAG 2.3.3 defect.
10. **`live-heartbeat-pulse-updated-ago`** — makes the headline liveness indicator measured instead of theater.

---

## Data gaps to unblock

Three proposals are `data_feasible=false`. All others ship with data already in the payload or computable client-side.

| Proposal | What's missing | Source / endpoint needed |
|---|---|---|
| `nav-intrinsic-backing-decomposition` | `sol_per_lst` + pool TVL exist in `intrinsic_snapshots.meta` (`sanctum.rs:128-130`) but are not serialized onto `/v1/assets`/`/v1/assets/{symbol}` | Add `sol_per_lst` (+ `tvl`, `sol_usd`) to the asset serializer. No client scraping (bypasses staleness gating). |
| `pyth-confidence-badge` | Engine buckets confidence (`state.rs:284`) into `discount_snapshots.confidence` but only returns it on `/v1/audit/:id` | Add a `confidence: 'high'|'medium'|'low'|'unknown'` string to the `/v1/assets` payload. Batch with the NAV serializer change. |
| `historical-depeg-replay-library` | No datastore of pre-Pegana real-world depeg incidents; `/v1/alerts` is empty during calibration | MVP: hand-authored seed JSON (`web/lib/data/depeg-precedents.ts`). Upgrade: a `/v1/incidents` endpoint. |

**Recommendation:** fold the first two into a single `/v1/assets` serializer PR (both are cheap reads of existing columns), which unblocks two net-new feature bets at once.

---

## Considered and cut

To show the coverage is real, the following were verified and **deliberately dropped** (kills) or confirmed **already shipped** (not re-proposed):

**Cut after verification:**

- **`density-toggle`** — feasible but low-leverage on a 21-asset universe; the proposer's own pitch admits the real win is *removing* a column, and the band/jitter columns work against it.
- **`server-watchlist-sync`** — the headline server-sync half is infeasible (no `/v1/me/watchlist` endpoint; needs net-new authed backend + migration, outside this audit's reach). The localStorage row-pin half overlaps the existing peek Pin — fold into the keyboard/peek work.
- **`staggered-row-reveal`** — fights the deliberate `React.memo` + per-symbol identity caching that keeps the hot render path from re-rendering on unrelated WS ticks; pure decoration on the densest, most-watched surface. Use the cheaper pane cascade instead.
- **`brand-sweep-mono-to-sans`** — the signed-in app deliberately adopted a mono-uppercase "instrument panel" register that shipped across the 06-01/06-02 audits; a piecemeal one-surface conversion would create a *worse* inconsistency. A true fix is an app-wide typography decision with the founder, not a dashboard sweep.
- **`onboarding-sharp-geometry-and-glyphs`** — internally contradictory: the shipped dashboard itself uses `rounded-full` pills extensively, so forcing sharp corners on the onboarding modal would make it *inconsistent* with the rounded-pill product. The glyph-swap half is real but tiny — let it ride along with the peek work.
- **`chart-market-intrinsic-two-line`** — infeasible as written. The history endpoint returns only `{ts, discount, state}` (verified against the SQL at `crates/api-rs/src/routes/assets.rs:354`); you cannot reconstruct two independent price lines from a fractional discount series. Requires storing+serializing `market_usd`/`intrinsic_usd` per history row — a backend epic, not a `useMemo`.

**Confirmed already shipped (not re-proposed):** the nine 06-02 P0 data-correctness fixes (USD/SOL label, fabricated uptime, 7d KPIs, class-specific drift band, Compare Save, fake recovery sparkline, `/assets` state-driven spread color, WS heartbeat watchdog, inline-series row sparklines) + WCAG-AA token lightening + `policy.ts`↔`assets.toml` sync.
