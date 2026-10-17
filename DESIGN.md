---
version: 1.0
name: pegana-v2-landing-design
approved: 2026-07-02 (Rafael, artifact v4 "e16b4559")
scope: >
  Governs BOTH the marketing surface (pegana.xyz landing) AND the (app) console. The app-era
  migration (W3a–c + W4) SHIPPED 2026-07-10/11, so every signed-in screen (dashboard, /assets,
  /asset, /compare, /events, /account, /auth) now runs on this same token/type/motion system —
  there is no pre-V5 product surface left. SUPERSEDES brand.md as the implementation spec for all
  product surfaces (marketing + app).
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
nav-glass       rgba(12,12,14,.62) + backdrop-blur(20px)
```

Semantic status (data only, never decoration):
```
pegged #5fd3a0 · drift #e2a651 · depeg #e87089 · critical #e0574e · unknown #8f8aa3
```

**The iridescent gradient** `linear-gradient(100deg,#ff8a5b 0%,#ff7a3d 26%,#fb6fae 55%,#e878d8 78%,#df91f7 100%)`
appears in EXACTLY five moments per page (hard rule, audit before ship):
1. Logo (nav + footer lockup; the Telegram-bot avatar and the footer's animated
   chroma wave `public/brand/pegana-wave-chroma.svg` count as logo instances;
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
| display-xl (hero h1) | Switzer | clamp(42px, 6.6vw, 80px) | 500 | -0.025em | line-height 1.02, pure white, max 2 lines |
| h2 section | Switzer | clamp(30px, 4.2vw, 50px) | 500 | -0.022em | line-height 1.05 |
| pane h3 | Switzer | 23px | 500 | -0.015em | |
| lead | Switzer | 17px | 400 | | muted; bold keywords in text color w500 |
| body | Switzer | 14.5-15.5px | 400 | | |
| strike-row false claim | Switzer | clamp(19px, 2.6vw, 27px) | 500 | -0.015em | dim color |
| eyebrow (max 2/page) | Geist Mono | 10.5-12px | 500 | .14-.18em, uppercase | |
| button label | Geist Mono | 12px | 500 | .09em, UPPERCASE | Rafael's signature |
| numbers / metadata | Geist Mono | 10.5-13px | 400-500 | tabular-nums | |
| big stat number | Geist Mono | clamp(26px, 3vw, 34px) | 500 | -0.01em | |

## 3. Shape & materials

- Interactive = pills (radius 100px). Containers = 14-22px radius. Hairline borders.
- Glass (backdrop-blur) ONLY on the fixed navbar. Everything else flat panels.
- No drop shadows on cards except the floating objects, which carry a deep ambient shadow +
  `inset 0 1px 0 rgba(255,255,255,.05-.08)` top highlight. There are three: the hero board, the
  receipt, and (added 2026-08-11) the app's floating mobile tab bar, which genuinely floats over
  scrolling content and reads as debris without separation. Each is implemented as a plain CSS
  class (`.v2-shadow-board`, `.v2-shadow-receipt`, `.app-tabbar-pill`), never a Tailwind
  arbitrary value: composite shadows die in the v4 production build, and the tab bar shipped a
  transparent one for weeks before anyone read its computed style.
- Buttons: primary = solid white pill, mono uppercase label, dark text `#141118`, nested
  arrow-in-circle icon (`.cta-ic`, 22px circle, slides +2px on hover). Secondary = ghost pill.
  Compact: 11-12px vertical padding. NEVER large/fat CTAs.

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
| Reveal-mask hero bg | THESIS ("market price is only half the story") | canvas 2D: faint market-noise ticks always visible; offscreen layer (26px grid + dashed `intrinsic 1.0000` baseline + mono micro-values) masked by radial spotlight r=230 at lerped cursor (.07); no mouse → Lissajous drift; the spotlight reveals what's underneath |
| Board float | product is alive | translateY ±5px, 9s loop |
| Arc glow breathe | signature moment | opacity .8↔1, 9s |
| Live pips pulse | real state semantics | 2.2s opacity blink, only on non-pegged states |
| Sources marquee | breadth | translateX -50%, 48s linear infinite, mask-fade 8%/92% edges (max ONE marquee per page) |
| Pinned trust scene | storytelling (how a verdict is made) | wrapper 340vh, sticky 100vh; scroll progress lights steps 01-04 (left 2px white bar + color) and builds the receipt row-by-row; artifact uses a scroll handler, PRODUCTION USES Lenis + GSAP ScrollTrigger (scrub) |
| Candor strike | the false claim "depegs" | rose 2px line scaleX 0→1, origin left, .9s physical ease, on view (threshold .55) |
| Chart draw-in | data arriving | line draws over ~1.2s when visible, then slow phase drift; endpoint glow dot |
| Wave close | brand scenario | two blurred (46/64px) wave-logo SVG layers, sine float + pointer-lerped parallax (opposite factors, ±46px/±30px, rotate ±2.2°) |

**Reduced-motion matrix (mandatory):** canvas layers OFF · pinned scene unrolls static with all
steps/rows visible · strikes pre-drawn · marquee stopped · floats/breathe off · reveals instant.
Mobile (<900px): no pinning (static expanded), reveal-mask off (touch has no cursor).

## 5. Page architecture (locked — 5 sections + chrome)

1. **Nav** — floating glass pill, links Product/Methodology/Verify/Developers/Docs,
   CTAs: `ASSETS API` (ghost) + `OPEN DASHBOARD` (white). Height ≤72px, one line.
2. **Hero** — centered. H1 "Prove the peg of every asset you hold." (pure white) · sub ≤21 words
   with bold keywords · CTAs `OPEN THE DASHBOARD →` (white, nested icon) + `ASSETS API` (ghost) ·
   mono trust line · **live board** full-width rising under the arc (real-fidelity table:
   Asset/State/Market/Intrinsic/Spread/Band-proximity/Updated; amber row-tint on drift;
   UNKNOWN row shows honest "no verified source"; footer = latest real transition + receipt).
3. **Sources** — numbers grid (63/14/5/byte-exact, mono, vertical hairlines, transparent bg)
   + V1 logo marquee (14 real protocol SVGs from `web/public/logos/`, mono uppercase names).
   NOTE: Rafael still wants a future redesign of this section (backlog).
4. **Product** — pill tabs `ASSET DETAIL / ALERTS / API` (mono uppercase) → split panes
   (checklist left, real-fidelity visual right: chart+strip30 / telegram+webhook / JSON).
5. **Trust (pinned scene)** — "Don't trust the score. Replay it." Steps 01 Ingest → 02 Measure →
   03 Judge → 04 Receipt light with scroll while the sUSD receipt builds (inputs → formula with
   real numbers `spread = 1 − 0.9772/1.0006 → +2.34%` → verdict → hash + `pegana-replay` +
   "byte-identical, or it fails loudly" + verify link). Below: **candor strike rows**
   (eyebrow-pill "what pegana does not claim" + 3 rows: struck false claim | truth).
6. **Close** — statement h2 + 3 ICP sentences + CTAs + wave scenario. 7. **Footer** — logo+tagline,
   3 link columns, hairline, `© 2026 Pegana. All rights reserved.` + real X/GitHub SVG icons.

## 6. Copy guardrails (taste-skill hard rules, audited at 0 violations)

- **ZERO em-dashes** anywhere visible. Use period, comma or colon. (Data-null cells use `-`.)
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
| Hero board rows | `useAssets()` → `/v1/assets` (top rows by class mix; keep UNKNOWN visible) |
| Numbers grid | `useStats()` → `/v1/stats` (never hardcode) |
| Latest transition footer | events feed (same source as V1 "Live this week") |
| Receipt scene | real receipt shape (state, inputs, methodology version, hash) |
| Asset-detail pane | `useAsset('jitosol')` or representative live asset |
| Fallback | existing `MockDataBanner` honest-degradation pattern |

## 8. Port notes (Next.js, web/)

- Fonts: Switzer 400/500/600 + Geist Mono variable via `next/font/local` (woff2 committed).
- Motion deps: keep GSAP (already a dep) + add `lenis`. ScrollTrigger drives the pinned scene
  (scrub); Lenis wraps the landing only. Both OFF under reduced-motion.
- Canvas components (`reveal-mask`, chart, wave layers) = isolated client leaf components.
- CSP: no inline event handlers; scripts through the bundle (nonce handled by existing setup).
- Reuse: `useAssets/useStats/useAsset` hooks, `MockDataBanner`, `web/public/logos/*.svg`,
  wave path from `brand-mark.tsx`. The old v3 landing organisms are replaced, not edited.
- NEVER run `next dev`/`next build` locally (crashes the machine). Verify with
  `tsc --noEmit` + `vitest` + code review; visual QA on the Vercel preview after push.
- Implementation model: Sonnet 4.5/5 agents for mechanical build; Opus only for review.
