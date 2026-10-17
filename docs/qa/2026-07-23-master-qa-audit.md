# Pegana — Master QA Audit (live product), 2026-07-23

**Auditors:** 7 parallel surface audits (marketing routes, web app/console, asset-detail page, modals/dialogs/onboarding, Rust `api-rs` backend, `mcp-ts` MCP server, `pegana-replay` CLI + methodology).
**Verification:** all findings cross-checked against live prod (`api.pegana.xyz`, `www.pegana.xyz`, `mcp.pegana.xyz`, crates.io, Solana mainnet). Synthesis lead re-curled the time-sensitive backend claims at ~16:40 UTC and confirms them still live.

---

## Executive summary

The product is fundamentally sound — verdicts are correct, the methodology-0.7.0 classification of leveraged synths as PEGGED is right, and the byte-exact receipt chain works. The problems are **presentation-layer trust leaks**, and one whole class of them is systemic.

**The single dominant finding is a peg-spread sign-convention split.** Pegana has one documented "holder convention" (`+` = premium / market above backing, `−` = discount / market below backing). Most of the app negates the raw API `discount` field to honor it — but **~14 surfaces across 4 of the 7 audited areas do not**, so the *same spread for the same asset at the same instant renders with the opposite +/− sign depending on which Pegana surface you look at.* This is worst exactly where trust is the whole pitch: the **audit "receipt" page reads backwards**, the **embeddable partner badge** shows a minus sign for a healthy premium, and the **MCP tool docs hand autonomous agents the inverted signal** (an agent would report xSOL's expected +78% leverage premium as a −78% catastrophic depeg). This is also the exact bug the founder already observed on xSOL ("+78.91% … Pegged" hero vs "−78.5%" chart).

Beyond the sign issue there are **two true criticals** (one code-fixable, one founder-only): the logged-in account surface silently never loads for returning users, and the `cargo install pegana-replay` "verify it yourself" hint is fixed in source but not yet published, so every real user still gets the broken instructions. There are also **two live backend regressions** where "missing data is being read as healthy data" — the tokens.xyz partner feed's `stale` flag and the public `/v1/stats` aggregate.

**Severity tally (deduped):** 2 Critical · 7 High · 7 Medium · 5 Low · 1 Info.

**Bottom line:** none of this is a data-integrity or methodology failure — it's a polish/consistency layer that, unpatched, directly contradicts the "unambiguous, verifiable" promise the product sells. It is almost entirely code-fixable; only two items require a founder infra action (a crates.io publish and an API binary redeploy), and both of those are already written in source.

---

## Cross-cutting theme #1 — the peg-spread sign convention

**Ground truth (verified in `crates/methodology/src/discount.rs`):** `discount = 1 − market/intrinsic`.
- market **>** intrinsic → a **PREMIUM** → `discount` is **negative**
- market **<** intrinsic → a real **DISCOUNT** (below backing) → `discount` is **positive**

**The site's own "holder convention"** (see the explicit comment in `web/app/(app)/compare/share/route.tsx`): flip that raw value so the *displayed* sign reads `+` = premium, `−` = discount. Correct call sites negate (`formatGap(-bps)`); the buggy ones feed the raw value straight into `formatGap()` and print the inverse.

The negation is applied correctly in ~13 places (landing hero board, dashboard board row, screener row, asset rail, compare page ×4, compare/share, events, asset-picker, product-tabs). It is **missing** in the following, which therefore print backwards:

| # | Surface | File | What it shows (live) |
|---|---------|------|----------------------|
| 1 | Embed badge (partner deposit pages) | `web/app/(marketing)/embed/badge/[symbol]/route.ts` (html `formatGap` + `svgBadge`) | INF at healthy +2.10% premium renders **−2.10%** |
| 2 | Embed asset panel | `web/app/(marketing)/embed/[asset]/route.ts` (`formatBps` ~66) | premium → minus sign |
| 3 | Embed.js inline | `web/app/embed.js/route.ts` (inline `bps>0?'+':'−'`) | premium → minus sign |
| 4 | USDe backtest receipt | `web/app/backtest/2025-10-10-usde-depeg/page.tsx:256` | a genuine discount renders **+3.12%** |
| 5 | **Audit receipt (the proof page)** | `web/app/(marketing)/audit/[id]/page.tsx:148` | real DRIFT discount (hyloSOL+) renders **+0.33%** |
| 6 | Asset-detail chart "now:" + tooltip + legs | `web/components/organisms/asset-chart.tsx:295,438,1096,1100,1327` | plots raw discount → premium plotted below zero, "now: −78.6%" |
| 7 | Mobile sticky header | `web/app/(app)/asset/[symbol]/page.tsx:419` | flips sign vs hero as you scroll |
| 8 | Global ⌘K palette | `web/components/organisms/command-palette.tsx:396` | opposite sign to the list you searched from |
| 9 | Dashboard "System status" hover-card | `web/components/organisms/verdict-chip.tsx:49` (fed raw from `dashboard/page.tsx`) | opposite sign to the board row beneath it |
| 10 | Peer-comparison (Risk tab) | `web/components/organisms/peer-comparison.tsx:367,450` | desktop + mobile |
| 11 | Social share card (OG + Twitter) | `web/app/(app)/asset/[symbol]/opengraph-image.tsx:117` (+ `twitter-image.tsx` re-export) | unfurled card contradicts the page it links to |
| 12 | Arbitrage hint | `web/components/molecules/arbitrage-hint.tsx:61` | opposite sign + invites a bogus arb (see xSOL section) |
| 13 | Mechanism tab headline | `web/components/organisms/mechanism-flow.tsx:178,422` | Convention-B (self-consistent but disagrees cross-tab) |
| 14 | **MCP tool docs** (docstrings + registry systemPrompt) | `mcp-ts/src/tools/get-assets.ts:26,39`, `get-asset-state.ts:29,49`, `get-asset-history.ts:29`, `mcp-ts/smithery.yaml:93` | describes the sign **backwards** to every agent |

**Two fix shapes:**
- **Display-negation sites (1–5, 7–12):** route every one through a single shared `holderSignedPct(bps)` helper (mirror the existing `dashSafe`/`timeAgoShort` pattern), so the convention physically cannot drift again. Each is a one-line change today.
- **Chart (6):** deeper — flip the series to premium-positive at ingestion (`asset-chart.tsx:295`), then coordinate the guide/band geometry (`lib/asset/chart-thresholds.ts`, `asset-chart-bands.ts`) and candle up/down semantics so the plotted line, the "now:" label, and the threshold lines all agree.
- **MCP docs (14):** documentation-only fix — correct the four strings to "negative = ABOVE intrinsic (a premium); positive = BELOW intrinsic (a discount)," matching `web/lib/glossary.ts`. **No computation change.** This is the highest-leverage single edit because it's the *only* spec an autonomous agent can read.

---

## Dedicated section — the xSOL "+78% premium / Pegged" contradiction

xSOL is the sharpest expression of the sign issue because it's a leveraged synth (`class = synth_lev`) whose premium is *supposed* to be large. **Live (16:40 UTC):** `state=PEGGED`, `discount=-0.786409`, market `0.03045` > intrinsic `0.01706` → a real **~78.6% premium**, `monitoring_only=true`. Methodology 0.7.0 classifies any synth_lev premium as PEGGED — the verdict is **correct**. Everything below is the UI failing to present that correct verdict coherently:

1. **Sign flip (the founder's reported bug).** Hero `fmtSpread` shows **+78.6% "premium to NAV"**; the chart's "now:" one inch below shows **−78.6%** and plots the line *below* zero. Same asset, same instant, opposite sign. (`asset-hero-v2.tsx:82` flips; `asset-chart.tsx:438` doesn't.)
2. **PEGGED asset drawn inside red "depeg/critical" bands.** `synth_lev` isn't treated as direction-sensitive, so `asset-chart-bands.ts:83` mirrors the drift/depeg/critical shading onto the premium side and `thresholdLineSpecs` emits symmetric ± guides. xSOL's |discount| = ~7860 bps ≈ 2.6× its 3000-bps depeg band, so the line sits *below −critical inside the red zone* while the badge says Pegged. The rail's `BandGauge` (`band.ts:29`, no synth_lev carve-out) computes `prox≈2.6 → off-scale → 100% fill + glow + aria "depegged beyond this asset's band."** A "Pegged" verdict whose own chart and gauge scream "depegged" is structurally impossible to be right.
3. **Mobile sticky header** (`page.tsx:419`) prints **−78.6%** vs the hero's **+78.6%** — flips as you scroll on the device that dominates shared-link traffic.
4. **Hero framing.** The dominant number is a state-colored peg "spread"; "premium to NAV" is only a small detail-strip item. `+78% + Pegged` lands as an 89-point contradiction to a first-time viewer even though the copy layer already handles it well elsewhere (`DerivedEditorial` synth_lev branch, `MechanismFlow` subcaption).
5. **Arbitrage hint** shows **−78.6%** *and* actively suggests "mint xSOL via the mechanism and sell on Jupiter captures the gap" — a nonsensical "arb" on a leveraged token's *designed* premium (`arbitrage-hint.tsx:61`).
6. **Social share card** (`opengraph-image.tsx` + twitter re-export) unfurls **−78%**, contradicting the page it links to.
7. **Mechanism tab** shows −78.6% with formula `(fair − trading)/fair`; internally consistent but disagrees cross-tab with the hero.
8. **MCP** would tell an agent xSOL trades **78% BELOW intrinsic** (a buy-the-dip / catastrophic-depeg reading) — the exact inverse of reality.

**Coherent xSOL fix:** (a) unify sign to premium-positive everywhere (theme #1); (b) for `synth_lev`, suppress the drift/depeg/critical bands + guides on the premium side and give `bandProximity`/`BandGauge` a synth_lev carve-out so the gauge reads the premium neutrally instead of "off-scale depegged"; (c) reframe the hero number for synth_lev as an explicitly-labeled, neutral "Premium to NAV" with a one-line "Expected for a leveraged token — not a peg break" (reuse the DerivedEditorial wording, keep the PEGGED badge); (d) early-return the arbitrage hint for `synth_lev`.

---

## Cross-cutting theme #2 — "missing data read as healthy data" (ADR-0019 leaks)

Two live backend surfaces violate the codebase's own "missing data is not confirming data" rule, both on sUSD (whose Jupiter market leg is dead while its on-chain NAV keeps ticking):

- **`/v1/peg/feed` (tokens.xyz partner contract):** returns `state:UNKNOWN` but **`stale:false`** with `discount`/`market_usd` absent — because `stale` is computed off `COALESCE(d.ts, i.ts)` (falls back to the fresh intrinsic timestamp). The doc-comment tells partners `stale` is "the single freshness gate." A partner branching on `stale` reads a dead computation as fresh/healthy. Verified live vs `/v1/assets/sUSD/state` (`stale:true, state_reason:stale_source`). Structurally affects **every LST / yield-stable** whenever DEX pricing goes dark.
- **`/v1/stats.by_state` (public trust strip):** returns `{PEGGED:68, DRIFT:1}` (no UNKNOWN bucket) while `/v1/assets` shows `{PEGGED:67, DRIFT:1, UNKNOWN:1}` for the same instant — sUSD's dead feed is silently counted PEGGED in the headline aggregate.

---

## Per-surface findings

### Surface 1 — Marketing routes (`/`, `/agents`, `/embed*`, `/methodology`, `/about`, `/status*`, `/compare*`, `/backtest*`, `/audit*`)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| High | `app/(marketing)/embed/badge/[symbol]/route.ts`, `embed/[asset]/route.ts`, `app/embed.js/route.ts`, `backtest/2025-10-10-usde-depeg/page.tsx:256`, `audit/[id]/page.tsx:148` | Partner badge shows a minus sign for a healthy premium; the **audit "receipt" proof page** and backtest receipt render the sign backwards — the opposite of the dashboard for the same asset one click away. Directly undermines the "verifiable receipt" pitch. | Negate `reconcileBps()`/`discountToBps()` before formatting in all 5 sites; ideally via one shared `holderSignedPct()` helper. (See theme #1.) |
| Medium | `app/(marketing)/agents/agent-tabs.tsx` + `app/(marketing)/v2.css` (`.v2-in-ptabs`) and `app/(marketing)/audit/page.tsx` (state-filter pills) | On mobile (majority of first-time traffic), the 3 code-panel tabs on `/agents` and the 5 state-filter pills on `/audit` wrap inside a `border-radius:999px` container → oval/stadium blob with a stray pill in dead space — the exact bug already fixed for `/embed`'s asset picker, on two integrator-trust pages. | Add a mobile `border-radius:18px` override to `.v2-in-ptabs` (or a `@media(max-width)` rule) so every 3+ item pill row is covered, not just per-call-site. |

### Surface 2 — Web app / console (`/dashboard`, `/assets`, `/asset/*`, `/compare`, `/events`, `/account/*`, shell + ⌘K)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| **Critical** | `web/lib/hooks/use-my-subs.ts:17` (+ `use-my-webhooks.ts:18`, `use-latest-alert.ts:17`; effects in `account/alerts/page.tsx:213`, `account/webhooks/page.tsx:35`) | A genuinely logged-in user who **reloads / bookmarks / opens a new tab / returns after browser restart** (the default return path) sees `/account` stat tiles, subscriptions, webhooks, and alert history skeleton-pulse **forever**. The entire self-serve subscription/webhook/alert-management surface is broken for the common case. Root cause: SWR keys gate on the in-memory `token` (only ever set inside `login()`, null after any rehydration) instead of the cookie-backed `user` — a direct violation of AuthProvider's own doc-comment. | Gate the three SWR keys on `user` (or `!loading`), not `token`; the fetcher can still pass `token` as a harmless bearer fallback (cookie does the real auth via `credentials:"include"`). Add `user` to the two effects' dep arrays. Mirrors the already-correct `useRecentAlerts`/`account-menu.tsx`. |
| High | `web/components/organisms/asset-chart.tsx:295,438`; `asset/[symbol]/page.tsx:419`; `command-palette.tsx:396`; `verdict-chip.tsx:49`; `peer-comparison.tsx:367,450`; `asset/[symbol]/opengraph-image.tsx` | Sign flips between the hero and the chart "now:" caption an inch below it; between the dashboard board and its own System-status hover-card; between any list and the global ⌘K result; and on the share card vs the page it links to. A user could misread a real discount (danger) as a premium (benign). | Negate before `formatGap()`/before charting at each site (theme #1). For the chart, flip at series-construction like `compare-chart.tsx:79` already does. |
| Medium | `web/components/organisms/dashboard-board-row.tsx:52` (+ `BOARD_SORT_KEYS` in `dashboard/page.tsx`) | Dashboard (the default landing surface) is missing the Market Cap column on a now-stale "null for every asset" premise; the backend backfilled it (68/69 non-null live) and the sibling `/assets` screener already renders it, sortable. | Restore the `<col>`/`<th>`/`<td>` mirroring `assets-screener-row.tsx`; re-add `"marketCap"` to `BOARD_SORT_KEYS`; delete the stale comments. |

### Surface 3 — Asset-detail page (`web/app/(app)/asset/[symbol]` + hero/rail/chart/mechanism/arbitrage/share)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| High | `web/components/organisms/asset-chart.tsx:438` | Flagship trust page: every asset's chart disagrees in sign with the hero above it. Hidden on stables (±0.05%), glaring on xSOL (+78.6% hero vs −78.6% chart) — reads as a broken/self-contradicting oracle. | Flip chart to premium-positive at ingestion + coordinate band/guide geometry and candle semantics (theme #1 / xSOL section). |
| High | `web/components/organisms/asset-chart-bands.ts:83` (+ `lib/asset/band.ts:29`, `band-gauge.tsx`) | Leveraged xSOL (PEGGED) is drawn deep inside red "depeg/critical" shading and the rail gauge says "depegged beyond this asset's band" — a direct visual contradiction of the verdict for a token behaving as designed. | Give `synth_lev` the premium-side band suppression + a `bandProximity`/`BandGauge` carve-out (return 0/null for a synth_lev premium). Extend the rail's existing "NAV spread" label carve-out to the gauge math. |
| Medium | `web/components/organisms/asset-hero-v2.tsx:229` | `+78% premium / Pegged` reads as an 89-point contradiction to a first-time viewer even though the verdict is correct. | For `synth_lev`, reframe the hero number as neutral, explicitly-labeled "Premium to NAV" + a one-line "Expected for a leveraged token — not a peg break." Keep the PEGGED badge. |
| Medium | `web/components/molecules/arbitrage-hint.tsx:61` | Shows −78.6% (opposite to hero) *and* invites a mint/sell "arb" on a leveraged token's structural premium — actively misleading. | `formatGap(-discountBps)` for sign + early-return `null` for `class === 'synth_lev'` (pass class down from `page.tsx:533`). |
| Medium | `web/app/(app)/asset/[symbol]/page.tsx:419` | Mobile sticky header flips sign vs hero as you scroll (large share of shared-link traffic). | One-line: `formatGap(-bps)`. |
| Medium | `web/app/(app)/asset/[symbol]/opengraph-image.tsx:117` (+ `twitter-image.tsx`) | Shared X/Discord/Telegram card's sign contradicts the page it links to — public first impression. | `formatGap(-bps)`. |
| Low | `web/components/organisms/mechanism-flow.tsx:178,422` | Overview→Mechanism sign flip; low impact because it shows the literal formula, but still cross-tab inconsistency. | Prefer flipping to premium-positive and change caption to `(trading − fair)/fair` so the math still matches. |

### Surface 4 — Modals / dialogs / drawers / onboarding

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| High | `web/components/molecules/mobile-menu.tsx:188` (Search) + `:226` (dormant Glossary) | On mobile, tapping burger → "Search assets" (the **only** mobile entry to the command palette) appears to do nothing for up to ~500ms: the next modal opens *underneath* the still-closing native `<dialog>`, which the CSS deliberately keeps promoted in the browser top layer for the exit transition. A non-top-layer Radix Dialog can never paint above it regardless of z-index. Reads as broken/unresponsive search. | Defer opening the next modal until the dialog's own `close` event fires (already wired at `:87`) / past `transitionend`, instead of calling `searchAction()` synchronously alongside `close()`. |
| Medium | `web/components/molecules/glossary-sheet.tsx:70` | The Glossary sheet (reachable from any "?" HelpIcon, incl. mobile) renders at **75vw** instead of the authored full-bleed, with a ~25% strip of weakly-dimmed backdrop on the right. A twMerge specificity gotcha: bare `w-full` and the base class's `data-[side=right]:w-3/4` are different modifier groups, so both survive and the higher-specificity attribute-qualified rule wins (compiled through the project's actual Tailwind v4 to confirm). | Override with the same variant chain so twMerge dedupes: `data-[side=right]:w-full`. Optionally raise `SheetOverlay` opacity to match `DialogOverlay` (`bg-canvas/70`). |
| Info | `web/components/organisms/onboarding-modal.tsx` | No concrete defect found via static review (first-visit auto-open, responsive sheet, step reset, single close-X, Radix focus-trap all correct). The reported "mobile onboarding bugged" is likely either the two proven mobile-modal bugs above, or an iOS-Safari `dvh` runtime issue not visible in code. | Live/Playwright verify at 390px: first-visit timing, "How it works" reopen round-trip, iOS `dvh` during address-bar collapse. |

### Surface 5 — Rust backend (`crates/api-rs`)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| High | `crates/api-rs/src/routes/peg.rs:104` (root cause `assets.rs:398` `COALESCE(d.ts,i.ts)`) | **Live now.** `/v1/peg/feed` — the tokens.xyz partner contract — returns `stale:false` for a dead-market UNKNOWN asset (verified: sUSD `stale:false, discount:null` vs `/state` `stale:true, state_reason:stale_source`). Any partner branching on `stale` (as designed) reads a dead peg computation as fresh/healthy for any LST/yield-stable whenever DEX pricing goes dark. | Derive `stale` from the discount-leg timestamp only (thread raw `d.ts` pre-COALESCE through `AssetCard`), or force `stale=true` whenever `state` is `None`/`UNKNOWN`. **Code-fixable** (then needs the normal API redeploy). |
| High (founder-only) | `crates/api-rs/src/routes/stats.rs:146` | **Live now.** `/v1/stats.by_state` = `{PEGGED:68,DRIFT:1}` while `/v1/assets` = `{PEGGED:67,DRIFT:1,UNKNOWN:1}` — sUSD's dead feed counted PEGGED in the public trust strip. The freshness-gate fix is **written and correct in the working tree but uncommitted and undeployed** (`git status` = `M`, no commit anywhere). | Commit `stats.rs` and redeploy the API binary. *Follow-up nuance:* the fix's `COALESCE(d.state,'UNKNOWN')` buckets a never-snapshotted asset as the string `"UNKNOWN"` vs `/v1/assets`' `null` — latent until a brand-new asset is onboarded pre-first-tick. |

*(Spot-check clean: `.unwrap()`/`panic!` sweep found only const header parses + Mutex-poison expects; `discount.rs` checked-arithmetic guards the F-12 Decimal-overflow class.)*

### Surface 6 — MCP server (`mcp-ts`, `mcp.pegana.xyz`)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| High | `mcp-ts/src/tools/get-assets.ts:26,39`, `get-asset-state.ts:29,49`, `get-asset-history.ts:29`, `smithery.yaml:93` | Tool docs describe the `discount` sign **backwards** — "negative = below intrinsic" when negative actually means a **premium** (above). Confirmed in the live `tools/list` schema. An agent (which can only read the doc, not the Rust) reports every premium as a discount: xSOL's expected +78% leverage premium becomes a "−78% catastrophic depeg / buy-the-dip." Inverts the safety signal on the one surface built for autonomous, un-sanity-checked consumption. | Documentation-only: correct the four strings to "negative = ABOVE intrinsic (premium); positive = BELOW intrinsic (discount)," matching `web/lib/glossary.ts`. No computation change. |
| Medium | `mcp-ts/src/tools/verify-alert.ts:37` | `verify_alert`'s `evidence` outputSchema omits the live `commit_status` field and is `additionalProperties:false`, so a strict/typed MCP client validating `structuredContent` drops exactly the field that says whether the on-chain receipt is `committed` vs `wallet_drained`/`retry_exhausted` — central to the "verifiable receipt" claim. | Add `commit_status: z.enum([...]).nullable().optional()` to `evidenceSchema` to match `AuditEvidence` in `audit.rs`. |
| Low | `mcp-ts/src/transport.ts` | No CORS headers; `OPTIONS` preflight 404s. Server-side MCP clients (Claude Desktop/Code, Cursor) unaffected; any browser-side/in-browser-agent consumer is blocked, though the landing page advertises wiring into arbitrary clients. | Add Hono `cors()` / an OPTIONS handler, or document server-side-only. |
| Low | `mcp-ts/src/quota.ts` | Dead code — `FREE_DAILY_LIMIT`/`incrementAndCheck` never imported by any tool/middleware (only the unrelated 100/min IP limiter is wired). Inert module + test shipped to prod. Can't misbehave. | Wire it into the free-tool path per SPEC decision #6, or delete it + its test. |

### Surface 7 — `pegana-replay` CLI + methodology (the "verify it yourself" path)

| Severity | File | User impact | Fix |
|----------|------|-------------|-----|
| **Critical (founder-only)** | `crates/pegana-replay-cli/src/main.rs:280` | **`cargo install pegana-replay` ships the OLD broken hint today.** The published 0.5.0 tarball (pulled from crates.io) still emits a `VERSION_MISMATCH` hint pointing at `https://releases.pegana.xyz/install.sh` (→ **404**; correct path is `/pegana-replay-installer.sh`) piped through `sh` with `PEGANA_REPLAY_VERSION` (the installer only reads `PEGANA_VERSION`, so the pin silently no-ops). VERSION_MISMATCH is the *common* case — live alerts are on methodology 0.5.0/0.4.0 while the CLI embeds 0.7.0. The fix is correct in the working tree but **uncommitted**, and crates.io versions are immutable. | Commit the diff, bump to `0.5.1`, `cargo publish`, and confirm the `tools/pegana-replay-public` subtree mirror picks it up. |
| Medium | `crates/pegana-replay-cli/src/main.rs:294` | The new hint's fallback for older receipts ("pick the build embedding methodology vX at crates.io/versions") requires manual version-hunting — crates.io's versions list doesn't show which methodology each CLI embeds; users must open each "Dependencies" tab. This is the path *most users need right now* (≈0 alerts on 0.7.0 yet). | Embed a compile-time CLI→methodology version table so the hint prints a copy-pasteable `cargo install pegana-replay@X.Y.Z`, or publish the mapping on the `/methodology` page / each crate README. (Delivery rides on the same publish as the critical above.) |
| Low | `crates/pegana-replay-cli/tests/replay.rs:233` | No test pins the VERSION_MISMATCH hint *body* (only exit code 3 + the word "VERSION_MISMATCH"), so the exact dead-URL/wrong-env-var bug would have passed CI and a future revert would ship silently. | Assert `stderr.contains("cargo install pegana-replay")` and `!stderr.contains("releases.pegana.xyz")`. |
| Low | `docs/pegana-trust-layer-v0.1.0/10-distribution.md:79` | Internal design spec is stale: exit-code table missing `ONCHAIN_INCOMPLETE=5` (live/reachable), documents `--verify-onchain` as opt-in (now default-on/deprecated no-op), wrong crate name `pegana-replay-cli`. Not user-facing (not linked from web/docs), but could mislead a future contributor. | Delete/archive as superseded by code + ADR-0033, or update to match shipped exit codes + default-on behavior. |

---

## Prioritized remediation plan

### A. Code-fixable now (ship as a normal PR / web auto-deploys via Vercel)

1. **Unify the peg-spread sign to the holder convention** across the ~11 display sites (embed badge/asset/js, backtest, audit receipt, mobile sticky, ⌘K, verdict-chip, peer-comparison, OG/Twitter card) — route all through one `holderSignedPct()` helper. *[High · trust core · founder-flagged]*
2. **Flip the asset-detail chart to premium-positive** and coordinate band/guide/candle geometry (`asset-chart.tsx` + `chart-thresholds.ts` + `asset-chart-bands.ts`). *[High]*
3. **Fix the auth gating** — key the three account SWR hooks + two effects on `user`, not `token`. *[Critical]*
4. **Correct the MCP docstrings + smithery systemPrompt** (discount sign backwards). *[High · agent-facing]*
5. **Suppress synth_lev depeg/critical bands + rail-gauge off-scale**, and reframe the synth_lev hero as "Premium to NAV" + suppress the arbitrage hint. *[High/Medium · the xSOL cluster]*
6. **Fix `/v1/peg/feed` `stale`** to key off the discount-leg timestamp (then redeploy). *[High · partner contract]*
7. **Defer the mobile burger → Search/Glossary** modal open until the native dialog leaves the top layer. *[High]*
8. **GlossarySheet full-width** (`data-[side=right]:w-full`). *[Medium]*
9. **Restore the dashboard Market Cap column** + `BOARD_SORT_KEYS`. *[Medium]*
10. **Fix the `/agents` + `/audit` pill wrap** (mobile radius override on `.v2-in-ptabs`). *[Medium]*
11. **Add `commit_status` to `verify_alert` outputSchema.** *[Medium]*
12. **Embed the CLI→methodology version table** so the mismatch hint prints an exact install command. *[Medium]*
13. **Pin the VERSION_MISMATCH hint body in a test**; add MCP CORS or document server-side-only; delete or wire `quota.ts`; archive/update the stale `10-distribution.md`. *[Low]*

### B. Founder-only (already written in source — only a founder deploy/publish delivers them)

1. **Commit + deploy `stats.rs`** so `/v1/stats.by_state` stops counting dead feeds as PEGGED (via `scripts/deploy.sh`; detached/nohup — build > 30 min). *[High · live now]*
2. **Publish `pegana-replay` 0.5.1** (`cargo publish` + verify the public subtree mirror) so real users stop getting the dead-URL "verify it yourself" hint; rotate the leaked crates.io token in the same pass (already tracked in memory). *[Critical · verify-it-yourself broken for the common case]*

> **Note:** items A6 and A2/A1 (any Rust or web change) still ride the normal deploy path — web auto-deploys on push to `main` (merge is the founder's call); the API binary redeploy is a founder step but the *code* is agent-writable. The two items in section B are distinguished because the code is **already done** and *nothing* remains except the founder infra action.

---

## Appendix — live verification log (synthesis lead, 2026-07-23 ~16:40 UTC)

- `GET /v1/stats` → `by_state {PEGGED:68, DRIFT:1}` (no UNKNOWN) — reproduces the stats bug.
- `GET /v1/assets` → 69 assets, `{PEGGED:67, DRIFT:1, UNKNOWN:1}` — sUSD is the UNKNOWN.
- `GET /v1/peg/feed/by-mint/susda…` → `state:UNKNOWN, stale:false, discount:null` vs `GET /v1/assets/sUSD/state` → `stale:true, state_reason:stale_source, updated_at 15:07:44Z` — reproduces the partner-feed bug.
- `GET /v1/assets/xSOL` → `PEGGED, synth_lev, discount:-0.786409, market 0.03045 > intrinsic 0.01706, monitoring_only:true` — ~78.6% premium, PEGGED (the founder's reported hero/chart split).
- `GET /v1/assets/INF` → `PEGGED, discount:-0.021083, market 109.30 > intrinsic 107.04` — ~2.1% premium (the badge that renders "−2.10%").

---

## Remediation status — 2026-07-23 (same session)

All fixes below are on `landing/v2-port`, validated 1:1 (web `tsc` + `eslint` +
`vitest` 796/796; `cargo check`; MCP diffs are doc-string-only). Web ships via
Vercel on merge to `main`; Rust ships via `scripts/deploy.sh`.

**DONE + committed:**
- **Sign convention (dominant finding)** — one `holderSignedPct()` helper in
  `lib/api/format.ts`; routed/negated across ⌘K, peer-comparison, verdict-chip,
  the asset mobile-sticky, arbitrage hint (+ `synth_lev` early-return), the OG /
  Twitter share card, the embed badge (html + svg), embed asset panel, embed.js,
  the USDe backtest receipt, and **the /audit receipt proof page**.
- **Auth Critical** — account subs/webhooks/latest-alert SWR + the two page
  effects now gate on cookie-backed `user`, not the in-memory `token`.
- **`/v1/peg/feed` stale** — forced `true` for a None/UNKNOWN state (dead-market
  partner-feed regression).
- **`/v1/stats.by_state`** — 15-min freshness gate + collapse-to-UNKNOWN.
- **MCP docstrings + smithery** — discount-sign corrected for agents.
- **React #418** hydration on /audit + /backtest (ListRowsV2 displayName).
- **CLI VERSION_MISMATCH hint** → `cargo install pegana-replay`.
- **RUSTSEC-2026-0204** — crossbeam-epoch 0.9.18→0.9.20 lockfile bump.
- **"Verified state history" link** now scrolls the tab section into view.
- **Mobile pill-row oval** — `.v2-in-ptabs` radius capped at 18px < 640px
  (/embed picker, /agents tabs, /audit pills). /embed picker also fixed earlier.
- **Onboarding NEXT** — verified WORKING via a trusted Playwright click (the
  reported "bug" was a synthetic-`.click()` artifact, not a defect).

**DONE (second pass) — xSOL chart cluster + magnitude, PREVIEW-verified:**
- **Magnitude unify** — the hero big number used `bpsFromPrices` (raw prices)
  while the rail/editorial/chart used the reconciled `bps`; the founder saw
  header +80.00 vs editorial 79.25. Hero now prefers `bps` → header == rail ==
  editorial (preview: all +82.05).
- **Chart sign flip** — the Overview chart plotted the RAW `discount`
  (premium-negative → "now: −78.5%"). Negated the series at ingestion
  (`asset-chart.tsx`) so it's holder-signed (premium +, up); flipped the
  threshold guides (`chart-thresholds.ts`) + shaded bands (`asset-chart-bands.ts`)
  to the −discount side for direction-sensitive classes in lockstep; treat
  `synth_lev` as direction-sensitive AT THE CHART CALL SITE so xSOL's benign
  premium (up) has NO drift/depeg/critical bands. Preview-verified across 3
  classes: xSOL chart "now: +81.3%", premium line at the TOP, red bands on the
  −discount side (not the premium); jitoSOL (LST) chart −0.06% == hero −0.06%;
  USDC (stable) −0.01% == hero −0.01%. Unit tests updated to the holder
  convention. `thresholdAreaSpecs` (backtest chart only) left untouched.

**Still open (lower-value follow-ups):** rail `BandGauge`/`bandProximity`
synth_lev carve-out (the rail's small gauge, separate from the chart, still reads
a synth_lev premium as off-scale); dashboard Market-Cap column restore (additive,
`market_cap` now backfilled); MCP CORS; dead `quota.ts`; the backtest chart's own
sign (kept raw for now). Founder-only: publish `pegana-replay` 0.5.1 for the CLI
hint + rotate the crates.io token.

**FOUNDER-only:** merge `landing/v2-port`→`main` (Vercel web); `scripts/deploy.sh`
(api stats + peg + crossbeam); publish `pegana-replay` 0.5.1 for the hint fix
(+ rotate the crates.io token). Remaining Mediums/Lows from the tables above
(dashboard Market-Cap column, GlossarySheet width, mobile burger modal defer,
verify_alert `commit_status`, MCP CORS, dead `quota.ts`, stale design spec) are
tracked, non-blocking follow-ups.