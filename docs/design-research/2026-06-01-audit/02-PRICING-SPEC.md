# 02 — Pricing Page Master Spec (`/pricing`)

> **Status:** decision-ready · **Date:** 2026-06-02 · **Surface:** `web/app/(marketing)/pricing/page.tsx`
> **Authority:** `<repo>/brand.md` is the single source of truth. Every line below is reconciled to it. Where a generic pricing/skill default conflicts with the brand, the brand wins.
> **References modeled:** Helius (`helius.dev/pricing`, direct Solana-infra peer — weighted heaviest), Linear (`linear.app/pricing`, dark-SaaS comparison-matrix gold standard), Vercel (`vercel.com/pricing`, structural grid motif only — ignore its light canvas).

---

## 0. Non-negotiables for this page (read before building)

This page is **polished crypto SaaS** in the lineage of Phantom / Base / Helius. It is **not** a terminal, CLI, Bloomberg console, or hacker dashboard. The following are automatic-FAIL conditions on a pricing page specifically — they creep in here more than anywhere:

- **No mono as the default typeface.** Tier names, descriptions, feature-row labels, CTA labels, FAQ questions/answers, and the page title are all **Geist**. Mono (JetBrains Mono) is scoped to: price numerals, `/mo` suffixes, billing qualifiers, rate/credit labels, matrix category-group headers, and the metric-strip numbers. Nothing else.
- **No light/cream canvas.** Even though Vercel's reference is light, Pegana's canvas is `#000000`, always. Steal Vercel's *structure* (dotted grid, corner-plus marks), never its canvas.
- **No box-shadow on any card.** Elevation reads via border-color, not shadow (shadows vanish on pure black).
- **No glow halos, gradient blobs, or neon borders** on non-recommended cards. Restraint is the premium signal.
- **No italic. No serif.** Emphasis is weight (500/600) or color, never `font-style: italic`.
- **Iridescent gradient is ammunition, not decoration.** On this page it appears in *exactly three* places: (1) the recommended-tier card's 1px border, (2) the closing-CTA headline accent `<span>`, (3) the primary CTA pill fill inside the recommended card and the closing section. Nowhere else. Not as a card background, not as a section background, not on the nav CTA.
- **No animated number counters or sparklines** in the metric strip. The numbers are factual; they do not perform.
- **No eyebrow + pip + label** above the page title, and **no `(01)` section numbers** — both are deleted in v3 and read as AI-template tells.

---

## 1. Positioning & what we are pricing

Pegana monetizes **peg-risk data** through two distinct delivery models, and the pricing page must hold both without confusing the reader:

1. **Subscription tiers** — recurring access to the peg-risk dataset over **REST + WebSocket**, gated by rate limits, history depth, asset coverage, alert channels, and webhook count. This is the seat-less, workload-based SaaS spine (Free/dev → Pro → Team/Business → Enterprise).
2. **Usage-based / x402 micropayments** — pay-per-call access to the **MCP server** over **x402 on Solana mainnet**, so an autonomous agent (or a human who doesn't want a subscription) can settle a single risk query in USDC with no account. This is the developer-first, account-optional path that maps directly to Helius's "credits" framing — except settlement is on-chain, not invoiced.

The page's job: let a developer self-qualify into the right model in under ten seconds of scanning, *without reading prose*, via the price numeral hierarchy + the comparison matrix. The x402 path is framed as a peer column, not buried in fine print — it is a genuine differentiator (no Helius/Linear competitor settles per-call on-chain).

> **Calibration-window caveat:** `/v1/audit` is empty during the methodology calibration window (verdict gate 2026-06-11). Do not ship copy that promises live verdicts before the gate. The page can ship *hidden* and be revealed at or after the gate (see §13).

---

## 2. Page anatomy (top → bottom)

```
┌─ marketing-header (existing organism; gains a Pricing nav link — see §13) ───┐
│                                                                              │
│  1. HERO            page title + sub + billing toggle (Monthly / Annual)     │
│                     dotted-grid bg + 4 corner-plus marks                     │
│                                                                              │
│  2. TIER GRID       4 cards (Dev / Pro / Team / Enterprise)                  │
│                     recommended card = iridescent 1px border + badge         │
│                                                                              │
│  3. X402 STRIP      usage-based / per-call panel (account-optional)          │
│                     full-width, surface-1, distinct from the subscription grid│
│                                                                              │
│  4. METRIC STRIP    4 factual numbers in mono (Helius "outperform" pattern)  │
│                     surface-2, border-y hairline                             │
│                                                                              │
│  5. TRUSTED-BY      muted logo row (DEFERRED until real logos — see §9)      │
│                                                                              │
│  6. COMPARISON      full-width feature matrix, grouped category rows,        │
│     MATRIX          sticky thead, recommended-column highlight               │
│                                                                              │
│  7. FAQ             accordion, single column max-w-2xl, hairline dividers    │
│                                                                              │
│  8. CLOSING CTA     big Geist headline w/ iridescent accent span + 2 pills   │
│                                                                              │
│  9. site-footer (existing organism, full variant)                           │
└──────────────────────────────────────────────────────────────────────────┘
```

Section vertical rhythm follows brand: marketing inner-page padding `pt-20 pb-24 sm:pt-28 sm:pb-32` for the hero; `py-[120px] sm:py-[160px]` for the closing CTA; intermediate sections `py-20 sm:py-28`. Horizontal gutters locked at `px-5 sm:px-8 lg:px-12 xl:px-20`. Max content width `max-w-[1280px] mx-auto` (matrix/grid), `max-w-2xl mx-auto` (FAQ).

---

## 3. Section 1 — Hero

**Layout.** Single column, left-aligned (not centered — Linear/Helius pricing heroes are left-anchored; centering reads marketing-landing, not product-pricing). The billing toggle sits on the same baseline as the title block on desktop (title left, toggle right via `flex items-end justify-between`), stacking below on mobile.

**Structure.**
- Page title `Pricing` — Geist 500, `text-[40px] sm:text-[56px] lg:text-[64px]`, `tracking-[-0.022em]`, `leading-[1.0]`, `text-text`. **No eyebrow above it.**
- Sub-paragraph — bold-tail editorial, Geist 400, `text-[16px] sm:text-[17px]`, `leading-[1.58]`, `text-text-muted`, `max-w-[540px]`, `mt-5`. The load-bearing clause wraps in `<b className="font-medium text-text-body">`:
  > "Peg-risk data over REST and WebSocket, the MCP server for agents, and alerts that fire before risk moves downstream. **Pay monthly, or settle per call on-chain — no account required.**"
- Billing toggle — see §10.

**Structural motif (Vercel, adapted to dark canvas).**
- Dotted-grid background on the hero `<section>` wrapper: `background-image: radial-gradient(circle, var(--color-hairline) 1px, transparent 1px); background-size: 24px 24px;` Reuse the existing `dotted-grid-bg.tsx` atom (`pointer-events:none; position:absolute; inset:0; z-0`), opacity tuned to ~0.04 so it never competes with the card data below.
- Four corner-plus marks at the layout-boundary corners of the hero content block (top-left, top-right, bottom-left, bottom-right). Build a small `<PlusMarker>` atom: a 12×12px box, `::before` = `width:100%; height:1px`, `::after` = `width:1px; height:100%`, both `background: var(--color-outline)`, container at opacity 0.5, `aria-hidden`. Static, no animation.

**Atmosphere.** Optional single hero spotlight radial behind the title only — `radial-gradient(ellipse 80% 60% at 20% 0%, rgba(255,132,0,0.06) 0%, transparent 70%)`. One atmospheric element max; no second vignette. Static. This is the only place the warm temperature appears above the fold; it is allowed under the approved "hero spotlight" ammunition usage.

**Reveal.** Hero title → sub → toggle stagger via `.reveal` + IntersectionObserver (NOT framer-motion). Title at delay 0s, sub at 0.08s, toggle at 0.16s. `translateY(7px)→0`, `opacity 0→1`, `0.7s cubic-bezier(0.22,1,0.36,1)`. Wrapped in `prefers-reduced-motion`.

---

## 4. Section 2 — Tier card grid

### 4.1 Grid

```
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
gap-4 lg:gap-0 lg:[&>*+*]:border-l-0   // hairline-shared edges on desktop
```

Each card is a `<div>` with `border border-hairline` (`#1a1a1a`), `bg-surface-1` (`#0a0a0a`), `radius 0` (brand rule, sharp corners), `p-6 lg:p-7`, `flex flex-col`, `min-h-full`. **No box-shadow.** On desktop the four cards butt against each other so the shared 1px borders read as a single ruled object; on mobile they separate with `gap-4`.

**Card hover (non-recommended).** `transition: border-color 0.2s cubic-bezier(0.22,1,0.36,1), transform 0.35s cubic-bezier(.34,1.4,.64,1); hover: border-outline (#2a2a2a) + translateY(-3px)`. No shadow. The recommended card does **not** lift (it is already the magnet — a hover lift would compete with its border treatment); it only brightens its CTA.

### 4.2 Recommended-tier highlight (the ammunition use)

The **Pro** tier is the recommended/most-popular card. Highlight technique — iridescent 1px border via border-image (approved ammunition use), interior stays `surface-1` (do NOT lighten the fill — dark-canvas discipline):

```css
/* Recommended card only */
border: 1px solid transparent;
background:
  linear-gradient(var(--color-surface-1), var(--color-surface-1)) padding-box,
  var(--gradient-iridescent) border-box;
```

**Badge** — floated, pinned to the top edge (Vercel technique adapted to Pegana surfaces). Geist 500 11px, `bg-text text-canvas` (white on black — NOT iridescent, the gradient is already on the border), `rounded-full px-3 py-1`:

```jsx
<div className="absolute -top-px left-6 -translate-y-1/2 rounded-full bg-text px-3 py-1
                text-[11px] font-medium text-canvas">
  Most popular
</div>
```

(Left-anchored at `left-6` to align with the card padding, not centered — matches the left-aligned card content and reads more like Linear than a generic centered "Popular" pill.)

### 4.3 Card anatomy (top → bottom, per card)

1. **Tier name** — Geist 500, `text-[15px]`, `text-text`.
2. **One-line description** — Geist 400, `text-[13px]`, `text-text-muted`, `leading-[1.5]`, `mt-1.5`, `min-h-[34px]` (so all four price rows align).
3. **Price row** — `flex items-end gap-1 mt-6`:
   ```jsx
   <span className="font-mono text-[44px] leading-none font-medium text-text tabular-nums">$XX</span>
   <span className="font-mono text-[13px] text-text-muted mb-1.5">/mo</span>
   ```
   For the Free tier the numeral is `$0`; for Enterprise it is the word `Custom` in Geist 500 `text-[28px]` (not mono — it is not a number).
4. **Billing qualifier** — JetBrains Mono 11px, `text-text-caption`, `mt-1`: `Billed annually · $XXX/yr` (shown only when Annual is selected; on Monthly it reads `Billed monthly`).
5. **CTA** — full-width pill, `mt-6`:
   - Recommended (Pro): primary iridescent pill — `rounded-full px-7 py-3 text-[13px] font-semibold text-canvas`, `style={{ background: "var(--gradient-iridescent)" }}`, label `Start Pro →` with `<IconArrowRight size={13}>`.
   - Free/dev: ghost pill — `rounded-full border border-outline px-7 py-3 text-[13px] text-text hover:border-text hover:bg-text/[0.04]`, label `Get an API key →`.
   - Team: ghost pill, label `Choose Team →`.
   - Enterprise: ghost pill, label `Talk to us →` (mailto / contact).
6. **Feature list** — `mt-7 space-y-2.5`, each row:
   ```jsx
   <li className="flex items-start gap-2.5 text-[13px] text-text-body leading-[1.5]">
     <IconCheck size={14} className="mt-0.5 shrink-0 text-[var(--color-st-pegged)]" />
     <span>{feature}</span>
   </li>
   ```
   Excluded features in a tier are simply **omitted** from that card's list (the matrix below carries the full grid of dashes); cards stay scannable. Use the brand green `#6bd697` for the check, never a generic green.
7. **Usage-rate footer** (API tiers only) — `border-t border-hairline mt-6 pt-4 space-y-1`, JetBrains Mono 12px `text-text-caption`:
   ```
   Up to <span className="text-text">300</span> req/min        // OWNER TO CONFIRM
   1 month history · WS + REST                                  // OWNER TO CONFIRM
   ```

### 4.4 Reveal

Each card gets `.reveal` with a staggered `--reveal-delay` of `0s / 0.08s / 0.16s / 0.24s` (`transition-delay`). 0.7s fade-up. Cap stagger at 0.24s total. `prefers-reduced-motion` disables.

---

## 5. Section 3 — x402 / usage-based panel

This is the section that makes Pegana's pricing distinctive and must not be buried. It sits **directly under the tier grid** (before the metric strip) as a full-width panel on `bg-surface-1`, `border border-hairline`, `radius 0`, `p-8 lg:p-10`.

**Layout.** Two-column on desktop (`grid lg:grid-cols-[1.2fr_1fr] gap-10`), stacked on mobile.

**Left column — the pitch.**
- Small label, JetBrains Mono 11px `uppercase tracking-[0.14em] text-text-caption`: `PAY PER CALL · x402`
- Heading, Geist 500 `text-[28px] sm:text-[32px]` `tracking-[-0.014em]` `text-text`: `No account? Settle on-chain.`
- Body, Geist 400 `text-[15px]` `text-text-muted` `leading-[1.6]` `max-w-[460px]`, bold-tail: "Agents and one-off callers hit the MCP server and pay per request in USDC on Solana mainnet. **No signup, no monthly minimum — the request carries its own payment.**"
- Two protocol chips (NOT a terminal motif — these are capability tags): `rounded-[4px] bg-text/[0.06] px-2.5 py-1 font-mono text-[12px] text-text-muted` reading `MCP` and `x402`. Hover brightens text 0.12s.

**Right column — the rate card.** A bordered inner panel `bg-surface-2 border border-hairline p-6`, rate rows in JetBrains Mono 13px:
```
Per peg-risk query        $0.00X         // OWNER TO CONFIRM
Per asset snapshot        $0.00X         // OWNER TO CONFIRM
Settlement                USDC · mainnet
Facilitator               CDP (x402)
```
Each row `flex justify-between border-b border-hairline py-2.5 last:border-0`. Label left in `text-text-muted`, value right in `text-text tabular-nums`. **No `$` prompt decoration, no `>` glyphs** — these are price labels, the `$` here is a currency symbol on a number, which is allowed.

A single ghost pill below the rate card: `Read the MCP guide →` linking to `/docs/guides/mcp`.

**Reveal.** Whole panel `.reveal`, 0.7s fade-up.

---

## 6. Section 4 — Metric strip (Helius "outperform" pattern)

Factual numbers as the argument. Sits on `bg-surface-2`, `border-y border-hairline`, full-bleed width, `py-12`.

```jsx
<section className="bg-surface-2 border-y border-hairline py-12">
  <div className="mx-auto grid max-w-[1280px] grid-cols-2 sm:grid-cols-4 divide-x divide-hairline px-5">
    {stats.map(s => (
      <div className="px-6 text-center">
        <p className="font-mono text-[32px] font-medium text-text tabular-nums">{s.value}</p>
        <p className="mt-1.5 text-[12px] text-text-muted">{s.label}</p>
      </div>
    ))}
  </div>
</section>
```

Proposed stats (factual, from project memory — **verify each before ship**):
| Value | Label |
|---|---|
| `22` | assets monitored |
| `~180s` | avg detection window |
| `3` | early mainnet settlements |
| `99.9%` | API uptime · OWNER TO CONFIRM |

**Rules:** numbers are static — **no count-up animation, no sparklines.** Lowercase units. The strip reveals as one block (0.7s fade-up). If any stat can't be substantiated at ship time, drop the cell to a 3-up grid rather than print a soft number.

---

## 7. Section 5 — Trusted-by logo strip (DEFERRED)

Pattern reserved but **not shipped in v1** — Pegana does not yet have a row of nameable customer logos, and a half-empty or placeholder strip reads worse than its absence. When real logos exist:

- Section label, JetBrains Mono 11px `tracking-[0.14em] uppercase text-text-caption text-center mb-8`: `BUILT ON · INTEGRATED WITH` (NOT "Trusted by Solana's best teams" until that claim is true).
- `flex flex-wrap items-center justify-center gap-8 sm:gap-12`, logos `filter: brightness(0) invert(1); opacity: 0.45; transition: opacity 0.2s; hover: opacity 0.8`. No marquee.

Until then, the metric strip (§6) carries the social-proof load.

---

## 8. Section 6 — Feature comparison matrix

The completeness/confidence signal. Semantic `<table>`, full content width, sticky header.

**Header (`<thead>`).** Sticky: `position: sticky; top: 0; z-index: 10; background: var(--color-canvas)`. (If the marketing header is fixed, set `top` to its height.) First column blank/`Features`, then four tier columns. Tier names Geist 500 `text-[14px]`; under each, the price in JetBrains Mono `text-[13px] text-text-muted tabular-nums` so the header stays useful during long scroll. The **recommended (Pro) column** carries a faint full-height background `bg-surface-1` (the lightest possible lift, `#0a0a0a` against the `#000` canvas) to extend the card elevation downward.

**Category group rows.** Span all columns, JetBrains Mono 11px `uppercase tracking-[0.16em] text-text-muted`, `bg-surface-2`, `px-4 py-2.5`:
```jsx
<tr className="bg-surface-2"><td colSpan={5} className="px-4 py-2.5 font-mono text-[11px]
  uppercase tracking-[0.16em] text-text-muted">Data access</td></tr>
```

Proposed category groups (order matters — most-differentiating first):
1. **Data access** — REST, WebSocket, MCP, asset coverage, history depth
2. **Rate & throughput** — req/min, burst, concurrent WS connections
3. **Alerts & delivery** — Telegram alerts, webhooks (count), email digests
4. **Risk methodology** — verdict access, raw + smoothed spread, replay receipts
5. **Support & SLA** — community / email / priority, uptime SLA, onboarding

**Feature rows.** `<tr className="border-b border-hairline">`, label cell Geist 400 `text-[13px] text-text-body px-4 py-3`. Per-tier cells centered:
- Included → `<IconCheck size={14} className="text-[var(--color-st-pegged)] mx-auto" />`
- Excluded → `<span className="text-text-caption">—</span>`
- Value → JetBrains Mono `text-[13px] text-text tabular-nums` (e.g. `300/min`, `1 mo`, `5`)

Very subtle row alternation only: every other `<tr>` gets `bg-surface-1/40` — near-invisible, not zebra striping. Row hover: optional 2px coral left-edge accent bar (`::before scaleX 0→1, 0.2s`) + `hover:bg-text/[0.02]`.

**Mobile.** Do NOT horizontal-scroll a 5-column table (too cramped). Collapse to a single-tier view with a tier-switcher tab row above the table (Geist 500 13px pills, active = `bg-text/[0.07]`), defaulting to Pro. Render one tier column at a time.

**Reveal.** Table container `.reveal`, 0.7s fade-up (one trigger, the rows do not individually stagger — too long a list).

### Peer-comparison table (DEFERRED to post-v1)

Helius's "vs. other RPC providers" table is powerful but premature: name competitors only when there are 2+ clean, defensible columns (e.g. *Pegana vs. manual monitoring vs. no monitoring*). Build the same semantic-table component, Pegana as the leftmost anchor column with the `bg-surface-1` lift, check/dash per row. Hold until positioning is locked.

---

## 9. Section 7 — FAQ accordion

Objection-handling. Single column, `max-w-2xl mx-auto`, `py-20 sm:py-28`. Hairline dividers only — **no card borders around items.** `<details>/<summary>` baseline (works without JS), enhanced with React state for the max-height transition.

```jsx
<div className="border-b border-hairline py-5">
  <button className="flex w-full items-start justify-between gap-4 text-left
                     text-[15px] font-medium text-text">
    <span>{question}</span>
    <IconPlus size={16} className="mt-0.5 shrink-0 text-text-muted
                                   transition-transform duration-200 [[open]_&]:rotate-45" />
  </button>
  <div className="overflow-hidden transition-[max-height] duration-[350ms]
                  ease-[cubic-bezier(.34,1.4,.64,1)] max-h-0 [[open]_&]:max-h-96">
    <p className="pt-3 pb-1 text-[14px] leading-[1.6] text-text-muted">{answer}</p>
  </div>
</div>
```

Plus icon rotates to an ×, 0.2s ease. Question Geist 500 15px `text-text`; answer Geist 400 14px `text-text-muted` `leading-1.6`. No italic.

**Proposed FAQ list** (copy is buildable; owner trims/extends):
1. **Is there a free tier?** — Yes. The Dev tier gives a free API key with limited rate and one-month history, enough to build and evaluate against. No card required.
2. **What's the difference between subscribing and paying per call?** — Subscriptions give you a key with a fixed monthly rate limit over REST/WS. Per-call x402 is account-optional: your agent settles each MCP request in USDC on Solana mainnet, with no signup or monthly minimum.
3. **How does x402 billing work?** — Each MCP request returns a 402 with payment terms; your client settles in USDC via the CDP facilitator and the response is released. You pay only for calls you make. (Link the MCP guide.)
4. **What happens if I exceed my rate limit?** — Requests over the limit are throttled (HTTP 429), not silently dropped or auto-charged. Upgrade a tier, or fall back to per-call x402 for burst traffic.
5. **Can I switch or cancel anytime?** — Yes. Plans are month-to-month; annual billing is a discount commitment you can choose, not a lock-in beyond the term. *(OWNER TO CONFIRM cancellation/refund policy.)*
6. **Do you offer annual discounts?** — Yes — annual billing saves ~20%. *(OWNER TO CONFIRM %.)*
7. **What does "verdict" access mean?** — Higher tiers expose the methodology verdict and replay receipts, not just raw spread. *(Gate live from 2026-06-11; do not promise live verdicts before the gate.)*
8. **Is this mainnet?** — Yes. All data is Solana mainnet; x402 settlement is mainnet USDC.
9. **How do I talk to a human about Enterprise?** — Use the Enterprise CTA or email contact; we'll scope custom rate limits, SLA, and dedicated channels.

---

## 10. Monthly / Annual toggle

Sits in the hero, right-aligned on desktop (same baseline as the title), centered on mobile. A **rounded-full pill-switch** — two buttons, not radio buttons, not a dropdown.

```jsx
const [cycle, setCycle] = useState<'monthly'|'annual'>('annual'); // Annual default

<div className="inline-flex rounded-full border border-outline p-0.5">
  <button onClick={() => setCycle('monthly')}
    className={`rounded-full px-4 py-1.5 text-[13px] transition-colors duration-150
      ${cycle==='monthly' ? 'bg-text text-canvas' : 'text-text-muted hover:text-text'}`}>
    Monthly
  </button>
  <button onClick={() => setCycle('annual')}
    className={`rounded-full px-4 py-1.5 text-[13px] transition-colors duration-150
      ${cycle==='annual' ? 'bg-text text-canvas' : 'text-text-muted hover:text-text'}`}>
    Annual
    <span className="ml-1.5 rounded-full bg-[var(--color-coral)]/15 px-1.5 py-0.5
                     font-mono text-[11px] font-medium text-[var(--color-coral)]">
      −20%   {/* OWNER TO CONFIRM */}
    </span>
  </button>
</div>
```

**Behavior.**
- **Annual selected by default** (steers toward the higher-LTV commitment, matches Helius).
- Active button: `bg-text text-canvas`; indicator slide / color swap `0.15s var(--ease-default)`.
- Savings pill: coral at 15% opacity background, coral text, JetBrains Mono 11px. Coral here is an approved accent moment (not the iridescent ammunition).
- Price cross-fade on toggle: pre-compute both monthly and annual values, swap with a **0.12s opacity cross-fade**, no layout shift. Under `prefers-reduced-motion`, swap instantly with no fade.
- The billing qualifier under each price updates (`Billed annually · $XXX/yr` ↔ `Billed monthly`).

---

## 11. Proposed tier model

> **EVERY DOLLAR FIGURE BELOW IS A PLACEHOLDER — `OWNER TO CONFIRM`.** The structure is the recommendation; the numbers are the owner's business decision. See §12 for the questions that must be answered first.

| | **Dev** (free) | **Pro** ⟵ recommended | **Team / Business** | **Enterprise** |
|---|---|---|---|---|
| **Who** | Solo devs, evaluation, hobby agents | Production apps & funds tracking a few assets | Teams & protocols with monitoring + alerting needs | Funds / infra needing custom limits & SLA |
| **Price (monthly)** | `$0` | `$XX` · *OWNER TO CONFIRM* | `$XXX` · *OWNER TO CONFIRM* | `Custom` |
| **Price (annual)** | `$0` | `$XX × 12 −20%` · *OWNER* | `$XXX × 12 −20%` · *OWNER* | `Custom` |
| **REST + WS** | ✓ | ✓ | ✓ | ✓ |
| **Rate limit** | `60/min` *OWNER* | `300/min` *OWNER* | `1000/min` *OWNER* | Custom |
| **Asset coverage** | All 22, delayed? *OWNER* | All 22, realtime | All 22, realtime | All + custom assets |
| **History depth** | 7 days *OWNER* | 90 days *OWNER* | 1 year *OWNER* | Custom |
| **MCP access** | Pay-per-call (x402) | Included + x402 | Included + x402 | Included |
| **Telegram alerts** | — | ✓ | ✓ | ✓ |
| **Webhooks** | — | 3 *OWNER* | 25 *OWNER* | Custom |
| **Verdict + replay receipts** | — | ✓ | ✓ | ✓ |
| **Support** | Community | Email | Priority email | Dedicated + SLA |
| **Uptime SLA** | — | — | 99.9% *OWNER* | Custom |

**Usage-based / x402 (account-optional, parallel to all tiers):**
| Item | Rate | |
|---|---|---|
| Per peg-risk query (MCP) | `$0.00X` | *OWNER TO CONFIRM* |
| Per asset snapshot | `$0.00X` | *OWNER TO CONFIRM* |
| Subscription-tier API overage | `$0.00X / req` *or* hard-throttle (429) | *OWNER — choose model* |
| Settlement | USDC · Solana mainnet · CDP facilitator | fixed |

**What each tier gates (the levers):** rate limit (req/min + burst), asset coverage & data freshness (delayed vs realtime), history depth, alert channels (Telegram + webhook count), verdict/replay-receipt access, and support/SLA. These are the matrix's category groups in §8. The x402 per-call path is **orthogonal** — it is available to everyone, including no-account callers, and is the only on-chain-settled column.

---

## 12. Open pricing questions — OWNER MUST ANSWER before launch

These are pure business decisions; the design is built to absorb whatever the answers are:

1. **Dev (free) tier — does it exist, and what does it gate?** Free key with delayed data? Or eval-only with a hard cap? (Affects whether the leftmost card says `$0` or is dropped to a 3-card grid.)
2. **Pro monthly price?** The single most important number — it anchors the whole page and the recommended card.
3. **Team/Business monthly price?**
4. **Annual discount %?** (Spec assumes 20%; the savings pill and qualifier read from this.)
5. **Rate limits per tier?** Memory says the live API cap is 300/min — is that the Pro ceiling, the Free ceiling, or platform-wide? Define per-tier req/min + burst.
6. **History depth per tier?** (7d / 90d / 1y placeholders.)
7. **Webhook counts per tier?**
8. **x402 per-call price(s)?** Per query and per snapshot, in USDC. This must be live and settleable on mainnet at the price quoted.
9. **Overage model:** soft-charge per request over the limit, or hard-throttle (429) with an upgrade prompt? (Spec leans hard-throttle; cleaner story, no surprise bills.)
10. **Enterprise — self-serve "Talk to us" mailto, or a real intake form?**
11. **SLA commitment for Team/Enterprise?** (99.9% placeholder — only print a number you can stand behind.)
12. **Trial / refund / cancellation policy?** (FAQ #5 needs a real answer.)
13. **Metric-strip uptime number** — substantiated, or drop the cell.

---

## 13. Un-hiding the page (build/ship steps)

The page source already exists at `web/app/(marketing)/pricing/page.tsx`; it is currently hidden behind a temporary 307 redirect. To reveal:

1. **Remove the redirect.** In `web/next.config.ts`, delete the line at ~`:39`:
   ```ts
   { source: "/pricing", destination: "/", permanent: false },
   ```
   (It is a temporary 307 specifically so browsers don't permanently cache it — safe to remove.)
2. **Add the Pricing nav link.** In `web/components/organisms/marketing-header.tsx`, add `Pricing` to the flat nav link row (joins Product / Live / Docs / About as a **flat** link — **no dropdown**, per the locked flat-nav rule). It must never become a flyout parent.
3. **Restore the footer link.** In `web/components/organisms/site-footer.tsx`, add `{ href: "/pricing", label: "Pricing" }` to the **Product** column (`ALL_COLUMNS[0].items`). Note the `/agents` link already lives in the Company column (line 69) and the MCP/agents docs link in Developers (line 58) — confirm both still resolve; no agents link was removed by the pricing gate, so "restore agents links" is a no-op unless a prior commit pulled them (grep confirms they are present today).
4. **Verify the active-page pill.** The header's `usePathname()` active-state should render the Pricing link with the active treatment when on `/pricing`.
5. **Confirm calibration copy.** Ensure no verdict-related copy promises live data before the 2026-06-11 verdict gate (§9 FAQ #7).
6. **Smoke-test:** `/pricing` returns 200 (not 307), toggle switches prices, matrix sticky header works, FAQ expands, `prefers-reduced-motion` disables all reveals/cross-fades.

---

## 14. Component build breakdown (section → component)

All new components follow the atoms / organisms structure already in `web/components/`. Reuse existing atoms wherever noted.

| Section | Component | Notes |
|---|---|---|
| Hero bg | `dotted-grid-bg.tsx` (existing atom) | opacity tuned to ~0.04 |
| Hero corners | `plus-marker.tsx` (**new atom**) | 12px `::before`/`::after` cross, `var(--color-outline)`, opacity 0.5, `aria-hidden` |
| Billing toggle | `billing-toggle.tsx` (**new client component**) | `useState<'monthly'|'annual'>`, annual default; emits cycle to grid via context or prop-lift |
| Tier grid | `pricing-tier-grid.tsx` (**new organism**) | renders `tier-card.tsx` ×4; owns the cycle state if not contextual |
| Tier card | `tier-card.tsx` (**new molecule**) | props: name, desc, priceMonthly, priceAnnual, features[], ctaLabel, ctaHref, recommended?, rateFooter? |
| Recommended border | inline on `tier-card` | border-image iridescent technique (§4.2) |
| Badge | inline on `tier-card` | `bg-text text-canvas` pill, `-top-px left-6` |
| Check icon | `@tabler/icons-react` `IconCheck` | size 14, `text-[var(--color-st-pegged)]` |
| x402 panel | `pricing-x402-panel.tsx` (**new organism**) | 2-col; rate rows + protocol chips |
| Metric strip | `pricing-metric-strip.tsx` (**new organism**) | 4 stats, mono `text-[32px]`, NO animation |
| Comparison matrix | `pricing-comparison-matrix.tsx` (**new organism**) | semantic `<table>`, sticky thead, mobile tier-switcher |
| Matrix data | `pricing-data.ts` (**new**) | single source for tiers + matrix rows + FAQ — keeps copy out of JSX |
| FAQ | `pricing-faq.tsx` (**new organism**) | `<details>` baseline + state for max-height anim |
| Closing CTA | `pricing-cta-close.tsx` (**new organism**) | big headline + iridescent span + 2 pills |
| Reveal | existing `.reveal` + IO hook | NOT framer-motion |
| Header link | edit `marketing-header.tsx` | flat link, active pill |
| Footer link | edit `site-footer.tsx` | Product column |
| Redirect removal | edit `next.config.ts` | delete `:39` |

**Closing CTA (§8 anatomy detail).** `<section className="py-[120px] sm:py-[160px] text-center">`, headline Geist 500 `text-[40px] sm:text-[64px] lg:text-[80px]` `leading-[1.0]` `tracking-[-0.018em]` `max-w-3xl mx-auto`, with the key phrase wrapped in the iridescent text span (approved hero-accent use):
```jsx
<h2>Start tracking <span className="text-iridescent">peg risk</span> today.</h2>
```
Below it, `flex flex-wrap justify-center gap-4 mt-10`: primary iridescent pill `Get an API key →` + ghost pill `Talk to us →`. Reveal: IntersectionObserver `0.8s cubic-bezier(.16,1,.3,1)` fade-up on the headline.

---

## 15. Motion table compliance (every timing used on this page)

| Interaction | Duration | Easing |
|---|---|---|
| Toggle indicator / color swap | 0.15s | `var(--ease-default)` |
| Price cross-fade on toggle | 0.12s opacity | linear |
| Chip / link color swap | 0.12s | `var(--ease-default)` |
| CTA / button bg | 0.15s | `var(--ease-default)` |
| Card border-color hover | 0.2s | `cubic-bezier(0.22,1,0.36,1)` |
| Card lift (non-recommended) | 0.35s | `cubic-bezier(.34,1.4,.64,1)` |
| Row left-edge accent bar | 0.2s | `cubic-bezier(0.22,1,0.36,1)` |
| FAQ max-height | 0.35s | `cubic-bezier(.34,1.4,.64,1)` |
| FAQ plus→× rotation | 0.2s | ease |
| `.reveal` fade-up | 0.7s | `cubic-bezier(0.22,1,0.36,1)` |
| Closing headline entrance | 0.8s | `cubic-bezier(.16,1,.3,1)` |

**No 300/500/1000ms values.** All motion wrapped in `@media (prefers-reduced-motion: reduce)` → `transition-duration: 0.01ms !important; transform: none !important`. No springs anywhere.

---

## 16. Accessibility & states

- **Empty/loading:** prices are static data, not fetched — no skeleton needed. If a tier's live price is ever fetched (e.g. x402 rate from the facilitator), show a shape-matched skeleton row, never a spinner.
- **Toggle:** `role="group" aria-label="Billing cycle"`; buttons get `aria-pressed`.
- **Matrix:** proper `<th scope>`; mobile tier-switcher is a real `<button>` tablist.
- **FAQ:** `<details>/<summary>` gives keyboard + screen-reader support for free; if state-enhanced, mirror `aria-expanded`.
- **Focus rings:** `var(--color-outline)` ring on all interactive elements; never remove outline without a visible replacement.
- **Contrast:** body copy on `#000` uses `text-text-body #e8e8e8` / muted `#9aa9b8` — avoid `text-text-caption #787878` for anything longer than a label (it fails AA at body size). Note the known landing wordmark gradient-contrast Lighthouse flag is separate and pre-existing; do not replicate gradient text on small/low-contrast copy here.
