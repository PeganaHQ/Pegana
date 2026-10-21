---
version: 1.0
name: pegana-v2-landing-design
approved: 2026-07-02 (Rafael, artifact v4 "e16b4559")
scope: >
  Governs BOTH the marketing surface (pegana.xyz landing) AND the public console. The app-era
  migration (W3a–c + W4) SHIPPED 2026-07-10/11, so every console screen (dashboard, /assets,
  /asset, /compare, /events, /heatmap, /systemic) now runs on this same token/type/motion system —
  there is no pre-V5 product surface left. SUPERSEDES brand.md as the implementation spec for all
  product surfaces (marketing + app). Everything is public and free; no signed-in surface exists.
reference_implementation: >
  The approved artifact source (self-contained HTML, fonts embedded) is the pixel-truth spec:
  every component, animation and copy string below exists working there. Port it, do not reinvent.
description: >
  A neutral dark (zinc) premium landing where the brand's iridescent wave gradient appears in
  exactly four moments, typography is Switzer (display/body) + Geist Mono (technical voice),
  every number is real or labeled sample, and the thesis (the measurable distance between
  market price and intrinsic value) is expressed as interaction, not decoration.
---

# Pegana V2 — DESIGN.md

## 1. Colors (neutral base, rationed accent)

```
canvas          #0a0a0b      page background (neutral zinc near-black; NEVER violet-tinted)
surface-1       #0d0d0f      alternating section band (trust section)
panel           #121214      cards, panes
panel-2         #17171a      inner raised
board-grad      linear-gradient(180deg,#131315,#0e0e10)   hero board / receipt object
line            rgba(255,255,255,.08)   hairlines
line-2          rgba(255,255,255,.16)   interactive borders
text            #f5f5f6
muted           #a3a3ad
dim             #80808a   (AA-safe; #70707a fails WCAG AA at 4.04:1)
nav-glass       dynamic: tint .38 / blur 12px (light) to tint .76 / blur 28px / saturate 1.1 (frosted), see section 3
```

Semantic status (data only, never decoration):
```
pegged #5fd3a0 · drift #e2a651 · depeg #e87089 · critical #e0574e · unknown #8f8aa3
```

**The iridescent gradient** `linear-gradient(100deg,#ff8a5b 0%,#ff7a3d 26%,#fb6fae 55%,#e878d8 78%,#df91f7 100%)`
appears in EXACTLY five moments per page (hard rule, audit before ship):
1. Logo (nav + footer lockup; the footer's animated
   chroma wave `public/brand/pegana-wave-chroma.svg` counts as a logo instance;
   chroma swaps to the static wave under reduced motion)
1b. Hero headline accent: the second phrase of the h1 carries the gradient
   (V1 "oracle for Solana." heritage, requested 2026-07-02)
2. Hero arc: 1.6px SVG arc stroke + radial arcglow behind the board top (arcglow breathes, 9s).
   Plus the V1-heritage warm glow: static radial amber `rgba(255,132,0,.21) -> rgba(254,237,122,.09)`
   900px at hero top (.v2-hero-glow) — the "vivid but not too much" hero color
3. Chart data: the market-price line in charts (the gradient IS the measured data)
4. Close scenario: two blurred wave-logo layers floating behind the final CTA

Zero gradient buttons. Zero gradient text. The strike-through line in the candor section uses
the semantic depeg rose, not the gradient.

## 2. Typography

Two families. Switzer (Fontshare, weights 400/500/600) and Geist Mono (variable).
Ship via `next/font/local` (woff2 in repo). No italics. No serif.

| Role | Family | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| display-xl (hero h1) | Switzer | clamp(40px, 4.4vw, 56px) | 500 | -1.4px | line-height 1.04, pure white, measure ≤580px |
| h2 section | Switzer | clamp(28px, 3vw, 40px) | 500 | -0.8px | line-height 1.1 |
| h2 punchline (trust) | Switzer | clamp(32px, 4vw, 52px) | 500 | -1.1px | line-height 1.06, section-level type |
| pane h3 | Switzer | 22px | 500 | -0.4px | |
| lead | Switzer | 16-17px | 400 | | muted; bold keywords in text color w500 |
| body | Switzer | 14-17px | 400 | | **marketing floor: body majority ≥14px** |
| candor claim / correction | Switzer | 14px dim / clamp(19px,2.2vw,24px) full | 400/400 | -0.3px on correction | no strikethrough; hierarchy does the work |
| eyebrow (max 2/page) | Geist Mono | 12px | 500 | .16em, uppercase | |
| CTA label (hero/close) | Switzer | 14px | 500 | 0 | solid white, 8px radius, nested arrow |
| numbers / metadata | Geist Mono | 12-14px | 400-500 | tabular-nums | never below 12px |
| big stat number | Switzer | clamp(44px, 5vw, 68px) | 500 | -2px | naked numerals, no cards |
| code | Geist Mono | 14px / 21px line | 400 | | dimmed line-number gutter, 4-5 syntax hues |
| board th / td / row | Switzer | 14px / 16px / 64px | 500 / 400 | | tokens.xyz scale |

## 3. Shape & materials

- Interactive = pills (radius 100px). Containers = 14-22px radius. Hairline borders.
- Glass (backdrop-blur) ONLY on the fixed navbar. Everything else flat panels.
- Nav glass is dynamic on the landing (desktop): one `--nav-glass` property (0 to 1) ramps the
  pill from light (tint .38, blur 12px) over the hero intro to frosted (tint .76, blur 28px,
  saturate 1.1) as the live board reaches the nav (`web/lib/landing/nav-glass.ts`; falls back
  to the hero's bottom edge when no board is found). Never opaque. Mobile, non-landing routes
  and pages without a hero keep the static base glass (tint .62, blur 20px); without
  backdrop-filter support the pill uses a more opaque tint and no blur. Reduced motion jumps
  between the two endpoints instead of ramping.
- **Backdrop-root rule.** A backdrop-filter only samples content up to its nearest backdrop-root
  ancestor, so NO ancestor of a backdrop-filter element may have `view-transition-name`,
  `filter`, `opacity < 1`, `mask`, `clip-path`, `mix-blend-mode` or `will-change: opacity|filter`.
  The nav pill carries its own `view-transition-name` for exactly this reason: on `<nav>` the
  blur sampled nothing.
- No drop shadows on cards except the floating objects, which carry a deep ambient shadow +
  `inset 0 1px 0 rgba(255,255,255,.05-.08)` top highlight. There are three: the hero board, the
  receipt, and (added 2026-08-11) the app's floating mobile tab bar, which genuinely floats over
  scrolling content and reads as debris without separation. Each is implemented as a plain CSS
  class (`.v2-shadow-board`, `.v2-shadow-receipt`, `.app-tabbar-pill`), never a Tailwind
  arbitrary value: composite shadows die in the v4 production build, and the tab bar shipped a
  transparent one for weeks before anyone read its computed style.
- Buttons (landing, 2026-10-19): primary = solid white rectangle, 8px radius, Switzer 14px
  w500 label, dark text `#0a0a0b`, plain arrow. Secondary = underlined text link. The mono
  uppercase pill pair was retired with the July hero. Product-app buttons keep the pill system.
  Compact: 12px vertical padding. NEVER large/fat CTAs.

## 4. Motion system (every animation has a stated purpose)

Eases: default `cubic-bezier(.22,1,.36,1)`; physical `cubic-bezier(.32,.72,0,1)`. No linear.

**Springs: one sanctioned exception.** The rule used to read "no springs", and three components
already broke it: the sliding indicators in `pill-tabs`, `asset-tabs` and the mobile tab bar all
run framer's `layoutId` FLIP on `{stiffness:500, damping:40}` (critically damped, ~270ms, zero
overshoot). That is the measured tokens.xyz mechanic and a CSS `transition: left/width` cannot
reproduce it, which is why it kept being reached for. Documented rather than pretended: springs
are allowed ONLY for a `layoutId` FLIP indicator, only at that constant, and every one collapses
to `{duration: 0}` under reduced motion.

| Animation | Purpose | Spec |
|---|---|---|
| Hero entrance | orientation | staggered on LOAD (not scroll): 100ms + i*110ms; fade + translateY(18px) + blur(5px) → 0 |
| Scroll reveals (.rv) | hierarchy | IntersectionObserver once, threshold .1, stagger i%6*70ms, same fade/blur |
| Live pips pulse | real state semantics | 2.2s opacity blink, only on non-pegged states |
| Nav glass ramp | the pill stays legible over content | `--nav-glass` 0 to 1, scroll-linked to the live board's top edge (120px range), written to the element so scrolling never re-renders React |
| Verdict replay (trust) | FREEZE, RECOMPUTE, MATCH of the real USDe event | plays once on entering the viewport (threshold .4), not scroll-linked: freeze 600ms, sweep 2400ms, match 700ms |
| Micro-hovers | affordance | links, rows and cards change border/background in ≤200ms; no transforms beyond 1px |

**Reduced-motion matrix (mandatory):** verdict replay shows its final state · reveals instant · nav glass jumps between endpoints ·
no marquee, no pinning, no scroll-jacking anywhere on the landing (all three were retired
2026-10-19). Mobile: the hero stacks, the board hides four of seven columns, the topology
scales, and every section remains static.

## 5. Page architecture (landing remake 2026-10-19 — 8 sections + chrome)

Canonical numbers live in `docs/landing-remake-spec.md`; this is the map. Container **1280px**.
Every section boundary is a **background-temperature change** (`v2-band-1..5`, all neutral zinc),
never a divider. Total page height ≤ 6 viewports at 1440×900.

1. **Nav**: floating dynamic-glass pill (light over the hero intro, frosted once the live
   board reaches it, never opaque; see section 3), links Product/Methodology/Verify/
   Developers/Docs, one `OPEN DASHBOARD` CTA. Does not hide on scroll.
2. **Hero** — two columns. Left: h1 "Prove the peg of every asset you hold." (48-56px, w500,
   ls -1.4px, measure ≤580), sub ≤21 words, one solid-white CTA + one underlined text link,
   "free and open source" line. No gradient phrase, no uppercase-mono pill pair, no caption
   duplication. Right: **topology node-graph** (13 sources → intrinsic − market → EWMA →
   state machine → receipt) over a dotted grid, one accented node.
3. **Board** (`#board`) — asserting headline "Every peg on Solana, measured live." Real
   `<table>`: th 14px / td 16px / rows 64px; two groups (Stablecoins & synthetics, Liquid
   staking tokens); ONE encoding and ONE legend (band proximity); no in-card dashboard CTA.
4. **Sources** — static grid of the **13 ingestion tasks**, each card = name + contribution +
   cadence. No marquee.
5. **Product (section A)**: live verdict playground, "One verdict, four open surfaces." A
   token selector (8 curated tokens: jitoSOL, mSOL, JupSOL, INF, USDC, USDT, PYUSD, USDe)
   whose hover popover opens on top and lists the tokens as tiles. Beside it the real
   `/v1` verdict for the chosen asset (state, discount against its thresholds, reason,
   freshness; live over WebSocket with a polling fallback), plus a REST/WebSocket/MCP/CLI
   surface switch showing the matching request line with a COPY button. Not a screenshot.
6. **Trust (section B)**: "Don't trust the score. Replay it." A choreographed
   FREEZE, RECOMPUTE, MATCH replay of the real USDe 2025-10-10 event (data generated by
   `web/scripts/gen-usde-replay.mjs`, nothing interpolated): the series draws in, a cursor
   sweeps it and each receipt blooms as it is reached, then the receipt's sha256 is
   recomputed in the browser. "match" is shown only after the verification actually resolves
   (a mismatch is shown as such). Plays once on entering the viewport; static final state
   under reduced motion.
7. **Candor** — eyebrow "what pegana does not claim" + 3 rows. Claim dimmed at 14px, correction
   full-weight at 20-24px. No strikethrough.
8. **Close** — naked-numeral stat band (assets / sources / endpoints / free), one receipt line,
   ONE CTA. No glow orb. **Footer** — logo+tagline, PRODUCT collapsed to 2 links, DEVELOPERS,
   PROJECT, legal line, real X/GitHub icons.

## 6. Copy guardrails (taste-skill hard rules, audited at 0 violations)

- **ZERO em-dashes** anywhere visible. Use period, comma or colon. (Data-null cells use `-`.)
- **Marketing type floor:** no text below 12px, and body type (≥14px) must be the majority of
  sized text. The 12px floor is enforced for `web/components/organisms/v2/**` by
  `web/tests/unit/lib/type-floor.test.ts`.
- Middle-dot `·` max 1 per line.
- Max 2 eyebrows on the page (currently: trust section + candor pill).
- Hero sub ≤ 21 words. Section headlines ≤ 8 words.
- No hype verbs (revolutionize/seamless/unleash/next-gen). Technical-calm register.
- **Honesty rules (non-negotiable):** every number is real (from `/v1/stats`, `/v1/assets`,
  real events) or visibly labeled sample. No fake social proof, no "trusted by", no invented
  metrics. UNKNOWN is shown, not hidden. The sUSD +2.34% case is a real recorded event.

## 7. Data binding (production)

| Surface | Source |
|---|---|
| Board rows | `useAssets()` → `/v1/assets` (worst-first per class group; keep UNKNOWN visible) |
| Close stat band | `useStats()` → `/v1/stats` for assets; sources = `SOURCE_ITEMS.length`; endpoints = 21 (unique `/v1` paths, verified against the router) |
| Trust replay | recorded USDe 2025-10-10 event (`web/lib/landing/usde-replay-data.ts`, generated from `docs/backtests/2025-10-10-usde-depeg/`) |
| Asset-detail pane | `useAsset('jitosol')` or representative live asset |
| Fallback | existing `MockDataBanner` honest-degradation pattern |

## 8. Port notes (Next.js, web/)

- Fonts: Switzer 400/500/600 + Geist Mono variable via `next/font/local` (woff2 committed).
- Motion deps: the landing no longer pins or scrubs, so GSAP ScrollTrigger is not used here.
  Lenis still wraps the landing for smooth scrolling only; it is OFF under reduced-motion.
- The hero canvases (`reveal-mask`, distance field) and the wave close were retired with the
  remake. The topology is a static SVG; the only landing animations are reveals, live pips,
  the verdict replay, the nav glass ramp and micro-hovers.
- CSP: no inline event handlers; scripts through the bundle (nonce handled by existing setup).
- Reuse: `useAssets/useStats/useAsset` hooks, `MockDataBanner`, `web/public/logos/*.svg`,
  wave path from `brand-mark.tsx`. The old v3 landing organisms are replaced, not edited.
- NEVER run `next dev`/`next build` locally (crashes the machine). Verify with
  `tsc --noEmit` + `vitest` + code review; visual QA on the Vercel preview after push.
- Implementation model: Sonnet 4.5/5 agents for mechanical build; Opus only for review.
