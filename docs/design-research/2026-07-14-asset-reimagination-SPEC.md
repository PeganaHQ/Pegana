# `/asset/[symbol]` re-imagination — SPEC (Phase 1, FE-only)

> 2026-07-14. Author: Opus (conta 2). Status: **awaiting Rafael's 1:1 review** before the
> implementation loop runs. Scope approved by Rafael: **Phase 1 = FE re-imagination**
> (new IA, premium card language, hierarchy-by-value, surface data we already have, fix 2
> data bugs). Backend differentiators = Phase 2, demand-gated, out of scope here.
>
> Sources: `2026-07-11-app-reimagination-MASTER.md` (killer-Opus laws), the `/asset` reality
> map (agent audit 2026-07-14), and the code read 1:1: `page.tsx`, `asset-hero-v2.tsx`,
> `asset-rail.tsx`, `exit-liquidity.tsx`, `alert-policy.tsx`, `peer-comparison.tsx`, plus the
> approved-language reference (`assets-screener-row.tsx`, `dashboard-board-row.tsx`,
> `pill-tabs.tsx`, `answer-card.tsx`).
>
> Branch: `landing/v2-port` (worktree `agent-a7bb15fca70bd58f2`). NEVER `main`. Preview-only.

---

## 0. The core insight (why this redo exists)

The `/asset` **content is genuinely strong** (editorial derivation, recovery-confidence
rubric, NAV-backing math, live Jupiter exit-liquidity, safety grade). The problem is **100%
presentation**: every one of the ~19 panels is dressed as a flat editorial blog-scroll
(`border-t border-hairline` dividers, flat `border border-hairline` boxes, 3 fake grid-
tables, zero V5 card DNA). Next to the already-premium dashboard/screener it reads as
*unfinished*. Phase 1 turns the blog-scroll into a **verdict-first premium instrument**
without touching the data spine.

## 1. Governing laws (killer-Opus, applied at asset scale)

1. **Draw the calm day first.** A PEGGED asset must look confident and intentional at rest —
   not empty, not alarmed. Motion/glow are NOT how we signal "live".
2. **Signature = the verdict + replay/receipts, not widgets.** The moat is that we *judge*
   the asset and let the user *verify* that judgment (tamper-evident history). Lead with the
   verdict; the number is the evidence; the receipt is the proof.
3. **Liveness only via real timestamps** ("updated 3m ago"), NEVER pulse/glow/motion.
   → Kill the `box-shadow` glow on the state dot in hero (`asset-hero-v2.tsx:194-196`) and
   rail (`asset-rail.tsx:129-133`).
4. **V5 brand unchanged** — this is FORM, not rebrand. Switzer ≤500 display, Geist Mono for
   numbers/labels, states Capitalized via `stateMeta`, pills, **zero gradient in app
   screens**, glass only on navbar. Card DNA is the approved language (§3).
5. **Anti-slop:** no generic bento, no purple glow, no cards-inside-cards-inside-cards. A
   card holds content, not more cards.
6. **Hierarchy = data value.** Live money-relevant data (exit-liquidity, proximity, health)
   must out-rank static filler (yield-source blurb, thin identity grid) VISUALLY, not just be
   equally spaced.

## 2. The approved card language (the "sarrafo" — copy from these, do not reinvent)

- **Panel card:** `rounded-[20px] border border-hairline bg-surface-1`; a heading gets a
  header band `bg-surface-2/60 border-b border-hairline`; body padding `p-5 sm:p-6`.
- **Small/nested card:** `rounded-[16px] border border-hairline`.
- **Card hover DNA** (interactive cards only): `hover:ring-2 hover:ring-outline/80
  active:scale-[0.98] transition-[box-shadow,transform] duration-150 ease-out
  motion-reduce:transition-none`.
- **Real table:** `<table table-fixed>` + explicit `<colgroup>` + ONE shared `COL_PAD` map
  mirrored on every `th`/`td` (alignment by construction) + header band `bg-surface-2/60` +
  rows `h-16` + hairline `divide` + full-bleed hover veil `hover:bg-surface-2/50` (NO radius)
  + stretched-link rows (`<Link after:absolute after:inset-0>` in `<tr relative>`) + mobile
  card in a **sibling list**, never inside a colSpan cell. Reference: `assets-screener-row.tsx`.
- **State pill:** `StatePillCell` pattern (canonical `stateMeta`, Capitalized).
- **Pills FLIP-spring:** `pill-tabs.tsx` (`layoutId` unique per group).

## 3. The new IA — "verdict-first"

The above-fold answers three questions in order: **(1) what's our verdict on this asset
right now, (2) can I trust that number, (3) how do I verify it.** The 5-tab deep-dive IA
survives (MASTER Q1: already-strong, approved), but every panel is re-skinned in card
language with hierarchy-by-value.

### 3.1 Above-fold restructure

Current: `AssetHeroV2` (open-air) + sticky `AssetRail` (open-air) in a
`lg:grid-cols-[minmax(0,1fr)_340px]`.

New: **VERDICT card** (left, dominant) + **sticky RAIL card** (right, 340px). Same 2-col
grid + sticky-scroll UX (which works — do not break it), but both become real premium cards.

**VERDICT card** (`asset-hero-v2.tsx` rework) — a `rounded-[20px] border-hairline bg-surface-1`
card, state-aware, containing, top→bottom:
- **Identity row:** TokenIcon 44 + symbol (`text-[36px]`) + name + MonitoringBadge (unchanged).
- **The verdict, co-leading:** the giant spread number (keep `clamp(46px,15vw,80px)` /
  `sm:104px`, keep full-contrast on UNKNOWN — documented divergence) PAIRED with the
  **Capitalized state as a first-class readout** (not a small strip afterthought). The state
  accent replaces the `border-l-2` coral bar with a **state-colored** accent (`stateMeta().dotVar`),
  and the dot **loses its glow** (law 3) — freshness is carried by the timestamp, not light.
- **Trust line (NEW, data we already have):** the Pyth `confidence` bucket surfaced HERE,
  next to the number ("how much to trust this reading"), via `PythConfidenceBadge` — moved
  up from the rail where it was buried. **Remove `PythConfidenceBadge` from the rail** (single
  source of truth in the verdict; no duplication).
- **State strip:** navSide (premium/discount to NAV) · drift floor (24h) · **updated Ns ago**
  (the honest liveness) · SustainedBadge · `state_reason` on UNKNOWN. (All existing, kept.)
- **Reference strip:** market / intrinsic / 24h-range — keep, but re-skin from the loose
  `border border-hairline bg-surface-1/70` box to sit cleanly inside the verdict card.
- **Editorial pullquote:** keep (`EditorialPullquote`, coral left-bar — intentional, on-brand,
  law-compliant; the analysis marked it STRONG).
- **Moat affordance (NEW):** a quiet, high-signal link — **"Verified state history →"** —
  that jumps to the History tab (`?tab=history`, the replay ledger) where each transition
  carries a tamper-evident receipt. This is the un-copyable signature, built from existing
  data (the ActivityTimeline + `/audit/{alert.id}` receipts). NO fabricated receipt for the
  current state — the affordance points to the real verifiable ledger.

**RAIL card** (`asset-rail.tsx` rework) — now a real `rounded-[20px] border-hairline bg-surface-1`
card (fixes premium-problem #3: the rail was explicitly open-air), sticky as today. Sections
become internal hairline-divided blocks INSIDE the one card (not individual boxes → no cards-
in-cards; use `divide-y divide-hairline` or `border-t` between blocks within the single card):
- Live-state mini (desktop-only, dedupes the hero) — **dot glow removed** (law 3).
- **Proximity to depeg** (`BandGauge`) — the on-thesis risk signal, keep prominent.
- CTAs (Subscribe pill + Custom threshold) — keep.
- **Health · 24h** (Time pegged / State flips / Median / Worst) — keep the 4-KPI grid, now
  framed inside the card with a proper header band block.
- Quick links (compare / solscan / issuer docs) — keep.

**Notes:**
- **Drama vs containment:** the verdict card must ELEVATE the giant number, not cage it —
  generous padding, subtle surface (calibrate `bg-surface-1` vs a faint state-wash at
  preview). The number's impact comes from size + the state color; the card gives it
  "premium instrument" framing. This is a preview-QA calibration point (Rafael's eye).
- **Mobile stickies preserved:** the inline mobile sticky header + sticky bottom CTA in
  `page.tsx` (reveal once hero scrolls out) are STRONG — keep verbatim, only re-skin if a
  token drifts. Their `fixed`-not-`sticky` workaround for the `overflow-x:hidden` ancestor
  stays.

### 3.2 The 5 tabs — every panel becomes a premium card (hierarchy by value)

Tabs (`AssetTabs`) stay as-is (STRONG — WAI-ARIA tablist + FLIP-spring; keep). URL `?tab=`
contract unchanged. Per tab:

- **Overview** — `AssetChart` gets a card frame (the loading skeleton too);
  `RecoveryConfidence` → premium card (its rubric bars are gold — elevate);
  `ExitLiquidity` → **real table + card** (§4.3), marked LIVE via timestamp copy (not glow);
  `ArbitrageHint` → a small card, but visually SUBORDINATE (it's a footnote).
  Hierarchy: chart + recovery-confidence + exit-liquidity are the value; arbitrage is quiet.
- **History** — unify the 4 disconnected sections: ONE consistent heading language
  (pick the mono-uppercase eyebrow + display title used elsewhere), each in a
  `rounded-[20px]` card; `ComparableEvents` cards get hover DNA; **kill the `border-dashed`
  empty state in `activity-timeline.tsx:273`** (the only pre-V5 fossil in the tree) → replace
  with a solid-hairline card empty state. Keep all scrub/keyboard/receipt wiring.
- **Mechanism** — `NavBacking` → card (merge its two disconnected boxes into one card with an
  internal divider); `MechanismFlow` → card (keep the SVG gap bar — it's the best explanatory
  design on the page); `AlertPolicy` threshold ladder → **real table** (§4.2), rest of
  AlertPolicy (policy `dl` + source links) stays as prose; `YieldSource` → card (thin/static,
  lowest value — smallest card, subordinate).
- **Risk** — `SafetyGrade` → card (keep the big glyph + GSAP reveal, wrap in card; keep the
  "Heuristic v1" honesty label — do NOT overstate it as an engine verdict); `PeerComparison`
  → **real table** (§4.1) + fix the sort inversion (§4.1 / Bug B).
- **Identity** — `IdentityRow` → card (thinnest section; a clean metadata card, don't over-
  promise); `AssetActionStrip` 4 cards → add the card hover DNA (`hover:ring-2` + `active:scale`)
  + `rounded-[16px]`, fix the one card with an inconsistent white border.

## 4. Correctness fixes (NOT cosmetic — these ship as part of the redo)

### 4.1 Bug A — the page bypasses the freshness gate  *(Sonnet + Opus; do FIRST)*

`page.tsx:317`: `const state = (asset.state ?? "UNKNOWN") as PegState;` reads raw state. The
dashboard (`dashboard/page.tsx:282`) instead uses `effectiveState(...)` from
`lib/asset/freshness.ts`, which degrades a stale snapshot (> `STALE_AFTER_MS` = 120s) to
UNKNOWN in the value itself, not just a banner. On `/asset`, a stale snapshot keeps showing a
confident "Pegged" everywhere while only `StaleBanner` warns — inconsistent with the app and a
soft trust bug.

**⚠️ Verified 2026-07-14 — the real signature (do NOT guess it):**
```ts
effectiveState(
  live: { state?; updated_at? } | undefined,   // WS frame
  asset: { state?; updated_at? },
  nowMs: number,
  thresholdMs = STALE_AFTER_MS,
): PegState                                     // dashboard: effectiveState(liveOverrides[sym], a, now)
```
Two facts about `/asset` that shape the fix (verified): the page has **no `useLive()` WS frame**
for the focus asset, and **no page-level clock tick** (only the rail ticks internally, locally).

- **Fix (minimal, correct):**
  1. Add a page-level `now` that advances every 30s (a `useState`+`setInterval` tick, mirror
     `asset-rail.tsx:63-67`) so staleness re-evaluates without waiting for the next SWR
     revalidation.
  2. `const state = effectiveState(undefined, asset, now);` — `live = undefined` (no WS frame
     today). This flows to hero/rail/tabs/editorial — verify each renders the UNKNOWN degrade
     (hero `SPREAD_COLOR.UNKNOWN` = full-contrast `text-text` ✓; `StaleBanner` still fires ✓).
  3. Keep `reconcileBps(asset)` for the NUMBER (`bps`) exactly as today — only the STATE gains
     the gate; the two are independent.
- **Optional upgrade (flag, do NOT require in Phase 1):** adopt `useLive()` for the focus
  asset → pass the real WS frame as `live` for true real-time state. Scope creep; note only.
- **Crown jewel:** never recompute `PegState` from bps — `effectiveState` derives from
  freshness + server state, not bps. Compliant.
- **Acceptance:** `effectiveState` itself is already unit-tested (`tests/unit/asset/
  freshness.test.ts`). The page fix REUSES it, so correctness rides on that + a preview check
  that a stale asset reads "Unknown". Add a page-level unit test ONLY if a pure helper is
  cleanly extractable; otherwise the reused tested module + preview QA is the honest bar (a
  full client-page render test isn't worth the harness cost).

### 4.2 Bug B — peer-comparison sorts best-first (inverts worst-first)  *(decision needed)*

`peer-comparison.tsx:72` sorts peers `Math.abs(bps)` **ascending** (closest-to-peg first) —
the inverse of the app-wide worst-first convention.
- **Recommendation:** sort **worst-first** (descending `|bps|`, consistent with the app's
  risk-oracle framing — "which siblings are also stressed"), keep the focus row ("you are
  here") pinned at the top with its tint regardless of sort. Cap 5 peers.
- **DECIDED (2026-07-14, Opus under Rafael's delegated approval):** **worst-first**. Rafael
  was silent on the alternative, so the recommended default stands. Focus row "you are here"
  pinned at top; peers sorted descending `|bps|`; cap 5.

## 5. The 3 fake grid-tables → real `<table>` (exact columns)

All three copy the `assets-screener-row.tsx` mechanic (table-fixed + colgroup + shared
`COL_PAD` + header band + hairline divide + mobile sibling card). **Data/logic untouched** —
only the render markup changes.

### 5.1 PeerComparison  *(Sonnet — touches worst-first + reconcileBps)*
- Columns: **Asset** (icon+symbol+name, "you are here" tint on focus row) · **Spread**
  (`spreadTextClass`) · **State** (`StatePillCell`, canonical — replaces the current
  lowercase `state.replace("_"," ")`) · **Safety** (grade A–D color).
- Rows: focus row pinned + tinted; up to 5 peers, worst-first (§4.2). Stretched-link to
  `/asset/[peer]`. Keep the "Overlay on /compare" header link + `?s=` URL.
- Keep `reconcileBps`, `isPeer`, `useLive()` WS overrides (crown jewels). Mobile sibling card.

### 5.2 AlertPolicy threshold ladder  *(DeepSeek — bounded)*
- The `<ol>` grid (`alert-policy.tsx:83-122`) → real table. Columns: **Tier** (colored mono
  label) · **Condition** (`|spread| ≥ X` or hyUSD `CR ≤ X%`) · **Meaning** (muted prose).
- Keep: hyUSD CR special-case + the conditional Black-swan row, `formatThreshold`,
  `thresholdsFor`. The policy `<dl>` grid + "Want the source?" links below the ladder stay
  exactly as-is. DO NOT touch any imported constant.

### 5.3 ExitLiquidity  *(Sonnet — has live-fetch state machine)*
- The size-ladder div-grid (`exit-liquidity.tsx:219-291`) → real table. Columns: **Size** ·
  **Best route** · **USDC received** · **Impact** (`impactColor`). Wrap in the card; header
  band. Keep the depth-curve summary + sparkline card, the "Safe to exit up to $X" summary,
  the LIVE Jupiter fetch `useEffect`, loading/failed states, mobile single-$10k reflow, and
  the **UNKNOWN-state suppression** (crown-jewel honesty — do not remove).
- ⚠️ **DO-NOT-TOUCH:** the `jupiterQuote` fetch, the `useEffect`, `sizes`/`isMobile` logic,
  `safeExitSize`. Only the table MARKUP changes. (This is why it's Sonnet, not DeepSeek.)

## 6. Global crown-jewels checklist (verify per surface — NONE may regress)

Traced to the reality-map §A. Every PR in the loop is checked against this list:
- `reconcileBps` (declared-vs-computed, `format.ts:52-97`) — the NUMBER; never read
  `asset.discount` raw for display.
- `isPlausibleDiscount` gate (`format.ts:171`) — before any median/range/series (hero, rail).
- **Freshness gate** `effectiveState`/`STALE_AFTER_MS` (`freshness.ts`) — now ADOPTED (§4.1),
  not just preserved.
- Never recompute `PegState` from bps client-side — read `state`/`asset.state` as passed.
- Worst-first convention — peer sort fixed to match (§4.2).
- Hysteresis copy `CONFIRM_UP_SECS`/`DECAY_DOWN_SECS` (`policy.ts:93-95`) verbatim in
  AlertPolicy — mirrors the engine; do not edit.
- Backend-down ≠ empty — `page.tsx:303-313` 404 vs `apiUnreachable`; keep.
- A11y announcers — `StatePip announce`, `StaleBanner` role alert/status, ShareButton
  live-region, tablist semantics; keep all.
- `cleanSeries`/`MAX_PLAUSIBLE_ABS_DISCOUNT` for any sparkline series; never raw.

## 7. URL / test contracts (byte-identical — treated as tests)
- `?tab=overview|history|mechanism|risk|identity` · `?range=1h|24h|7d|30d` · `?mode=baseline|
  area|line|candle|legs`. `router.replace` scroll:false. B-023 redirect `/assets/[sym]→/asset/`.
  404 (`status !== 404` → apiUnreachable) unchanged. All preserved verbatim.

## 8. The workflow + loop (the "correct-by-construction" machine)

Decompose into **bounded surfaces** (avoids DeepSeek's large-file hang; makes scope
unambiguous). Each surface runs this loop before the next starts:

```
FOR each surface:
  1. SPEC (this doc §3–5): exact file(s), reference to copy, DO-NOT-touch, crown-jewels (§6),
     URL contract (§7), acceptance criteria.
  2. IMPLEMENT:  bounded FE → DeepSeek V4 (opencode, cwd = worktree) · logic/crown-jewel → Sonnet 5
  3. GATE:  npx tsc --noEmit  &&  npx vitest run   (I run; NEVER next dev/build)
  4. REVIEW (Opus, adversarial): data-lies, crown-jewel regressions, column drift, law breaks
  5. LOOP 2→4 until: review 0 issues  AND  green  AND  §6 checklist intact
  6. COMMIT by explicit path (exclude the 2 Rafael-dirty files) → push landing/v2-port
     → append one line to 2026-07-10-w3-EXECUTION-LOG.md
AFTER all surfaces:
  7. QA Playwright on preview (RESIZE 1440 before measuring; real data)
  8. RAFAEL judges on the alias — the final gate (DR-1)
```

DeepSeek rules (memory `feedback_deepseek_opencode_tokens`): one opencode at a time per
worktree; spec tightly bounded; forbid `git`/`next dev|build`; verify only via my tsc+vitest;
monitor liveness by `opencode.log` mtime (no macOS `timeout`).

## 9. Execution order + model assignment

| # | Surface | Model | Why |
|---|---|---|---|
| 0 | **Bug A** — freshness gate in `page.tsx` | Sonnet+Opus | crown-jewel; everything builds on correct `state`. Do FIRST. |
| 1 | **VERDICT card** (hero rework) | Sonnet+Opus | centerpiece; state/glow/trust/moat logic |
| 2 | **RAIL card** | DeepSeek | wrap-in-card + remove dot glow; bounded |
| 3 | Overview: recovery-confidence, chart frame, arbitrage cards | DeepSeek | card-wrap, bounded |
| 3b | Overview: **ExitLiquidity table** | Sonnet | live-fetch state machine (§5.3) |
| 4 | History: unify + cards + kill dashed | DeepSeek | card-wrap + heading unify |
| 5 | Mechanism: nav-backing, mechanism-flow, yield-source cards | DeepSeek | card-wrap |
| 5b | Mechanism: **AlertPolicy table** | DeepSeek | bounded table (§5.2) |
| 6 | Risk: safety-grade card | DeepSeek | card-wrap |
| 6b | Risk: **PeerComparison table** + Bug B | Sonnet | worst-first + reconcileBps (§5.1) |
| 7 | Identity: identity-row card + action-strip hover DNA | DeepSeek | card-wrap + hover |

Each numbered row = one loop pass = one commit. Grouped by tab so QA can validate a whole tab
at once. ~10 passes total.

## 10. Out of scope — Phase 2 (backend, demand-gated)

Recorded so they're not silently dropped, NOT built now (respects "demand is the gap"):
engine-computed safety score (today client "Heuristic v1"), NAV/backing historical series,
real venue-level liquidity depth, per-episode intra-event price path, reserve-attestation
panel. These need backend work (Sonnet+Opus) and ideally a design partner pulling for them.

Also deferred data-we-have-but-don't-surface that COULD enter Phase 1 if cheap and Rafael
wants: `calibration` enum (provisional/calibrated), `state_reason` in Risk context,
`series_24h` instant-paint sparkline. Flagged, not assumed.

---

## 11. Craft & motion rules (Emil Kowalski + Apple, tuned for Pegana)

Folded in from the `emilkowalski/skills` (`emil-design-eng`, `apple-design`). **Mood = risk
instrument: crisp, fast, restrained. NO bounce, NO playful spring** (Emil: "a professional
dashboard should be crisp and fast — match motion to mood"). This REINFORCES the killer-Opus
law (calm day first; liveness only via timestamps), it does not soften it.

- **Liveness = a real timestamp ("updated 3m ago"), NEVER glow/pulse/motion** → confirms
  killing the state-dot `box-shadow` glow in hero (`asset-hero-v2.tsx:194-196`) and rail
  (`asset-rail.tsx:129-133`). The existing tick-flash on the spread number is the one
  sanctioned data-motion; do not add others.
- **Motion is a page-load entrance touch ONLY**, never on data updates. Entrance: subtle
  stagger 30–50ms between siblings, each ≤200ms, `opacity` + small `translateY(8px→0)` or
  `scale(0.98→1)` — **NEVER `scale(0)`** (Emil). Gate the whole thing behind
  `useAppReducedMotion` (already in `pill-tabs.tsx`) → opacity-only/instant fallback (reduced
  motion = gentler, not zero). Motion is OPTIONAL polish — the premium comes from the card
  language + hierarchy + type, not movement.
- **Only animate `transform`/`opacity`** (GPU). Never height/margin/width.
- **Easing:** reuse the repo's motion tokens; the approved card DNA is `duration-150 ease-out`.
  For any custom entrance, prefer a strong curve `cubic-bezier(0.23, 1, 0.32, 1)` over CSS
  default ease-out (built-ins too weak). Never `ease-in` on UI; never `transition: all`.
- **Springs:** only the existing pill-tabs FLIP spring (`stiffness:500, damping:40` ≈
  critically damped, ~270ms, zero overshoot = Apple's "damping 1.0, no bounce" default). Do
  NOT introduce bouncy springs.
- **Press/hover feedback** stays the approved card DNA (`active:scale-[0.98]` + `hover:ring-2`)
  — Emil: pressable elements need instant scale feedback.
- **Typography (Apple):** display negative tracking (`-0.02em`, already used), body near `0`;
  hierarchy from weight+size+leading as a set. Keep.
- **Reviews** (the loop's step 4) use Emil's required **Before / After / Why markdown table**.

---

## Acceptance for the whole Phase 1
tsc + vitest green (with the new Bug-A test) · axe 0 violations at 1440 + 390 (add `/asset`
to the suite if not already) · every §6 crown jewel intact · every §7 URL contract byte-
identical · Opus adversarial review 0 issues per surface · Rafael approves the alias.
