# Brand — Pegana 2.0

Status: living (rewritten 2026-07-03 — the V2 language is now THE brand, not a marketing fork).
Implementation spec: `DESIGN.md` (repo root) carries exact tokens, type scale, motion matrix and
section architecture. This file carries the identity: what Pegana looks like, sounds like, and refuses to be.
Surfaces: BOTH marketing and the (app) console now run on the V2 language — the app-era migration
(W3a–c + W4) shipped 2026-07-10/11; no product screen carries legacy V1 styles anymore.

## One sentence

Pegana measures the distance between what a pegged asset trades at and what it is intrinsically
worth, and ships every verdict as a replayable receipt. Everything visual serves that sentence.

## The five signatures

1. **The Wave** — the coral→lavender wave mark (`web/lib/brand/wave.ts`, lockup source of truth
   `web/components/atoms/brand-mark.tsx`). Nav + footer lockups; the footer wave is the animated
   chroma (`public/brand/pegana-wave-chroma.svg`, static under reduced motion). The wave is the
   only place the brand is playful.
2. **The iridescent gradient** `linear-gradient(100deg,#ff8a5b,#ff7a3d 26%,#fb6fae 55%,#e878d8 78%,#df91f7)`
   in EXACTLY five sanctioned moments per page (logo instances · hero h1 accent · hero arc ·
   chart market-line · close scenario). Never on buttons. Never as body text. Scarcity is what
   makes it premium: 12 gradient instances was the AI-tell that got a whole draft rejected.
3. **The distance field** — contour lines bending around the peg baseline (hero atmosphere).
   The thesis drawn as topography: pegged is flat, drift is a dip. Quiet (white alpha ≤ .06),
   pointer-aware on desktop, static on mobile and under reduced motion.
4. **The live board** — real data, real token icons (`/tokens/{mint}.webp`), semantic state pills
   (Pegged / Drift / Depeg / Critical / Unknown — always Capitalized), band-proximity bars,
   spread sparklines with recency fade. The product IS the hero image; we never fake a screenshot.
5. **The receipt** — the verifiability object: input chips, formula chip, verdict pills,
   copyable hash, `pegana-replay` command. When trust must be shown, show the receipt.

## Voice

Technical-calm. Every number is real or visibly labeled sample. UNKNOWN is shown, never guessed.
Zero em-dashes in visible copy. Middle-dot rationed (max 1 per line). Max 2 eyebrows per page.
No hype verbs (revolutionize, seamless, unleash, next-gen). States and class labels Capitalized.
Candor is a feature: we print what Pegana does NOT claim, struck through in semantic rose.

## Surfaces

- Canvas `#0a0a0b` neutral zinc (never pure `#000000`, never violet-tinted). Panels `#121214` /
  `#17171a`, hairlines `rgba(255,255,255,.08)`, board/receipt objects carry the only shadows.
  State dots are FLAT — never a glow/pulse/box-shadow. Liveness is shown by real timestamps
  only, never by light or motion (supersedes the retired V1 `state-pip glow 0 0 8px` sanction).
- Type: **Switzer** 400/500/600 (display + body; display weight ≤ 500) + **Geist Mono**
  (numbers, labels, buttons, receipts). No serif. No italics. Numbers tabular.
- Shape: interactive = pills (radius 100); containers 14-22px. Glass only on the fixed nav.
- Buttons: white pill primary (Geist Mono 12px UPPERCASE label — Rafael's signature — dark text,
  arrow-in-circle on hero/close CTAs only) + ghost pill secondary. Compact. Never fat, never gradient.
- Semantic status colors (`#5fd3a0` peg · `#e2a651` drift · `#e87089` depeg · `#e0574e` critical ·
  `#8f8aa3` unknown) are data, never decoration.
- Motion: every animation states its purpose (DESIGN.md §4 matrix). Physical eases
  (`cubic-bezier(.32,.72,0,1)`), no springs, no linear. Reduced-motion degradation is mandatory
  and tested (canvases off/static, pinned scenes unrolled, strikes pre-drawn, chroma → static).

## NO TERMINAL / NO CLI AESTHETIC — locked rule (survives 2.0 intact)

Pegana is a polished crypto SaaS product, not a Bloomberg terminal, CLI, hacker dashboard or CRT.
Forbidden with no exceptions: mono as default body/headline/nav type · phosphor green ·
scanlines / flicker / CRT glow · ASCII borders, `>` prompts, blinking cursors as decoration ·
fake terminal windows with traffic-light dots · `[INFO]`-style output typography as decoration.
The single sanctioned "terminal" object is the receipt's `$ pegana-replay …` line, because it is
a real command users actually run. Peers are Phantom / Base / Helius — editorial polish, not ops console.

## Honesty rules (non-negotiable, inherited and permanent)

Real numbers or labeled samples. No fake social proof, no "trusted by", no invented metrics,
no fake-precise specs. The sUSD +2.34% case is a real recorded event and stays byte-exact.
"Nothing is display-only": any UI element that looks interactive must actually work.

## App migration (the 2.0 debt)

The product app still renders the V1 language (pure black, Geist sans + JetBrains Mono, radius-0).
Migration order when it starts: tokens (canvas/panels/hairlines) → type (Switzer + Geist Mono) →
pills and state colors (Capitalized labels) → charts (gradient = market line only).
Until then, new app screens copy the dashboard's existing patterns rather than mixing systems on
one screen. Nothing new is designed on V1 patterns for marketing, ever.

## Provenance

V1 heritage kept: Wave Signal mark, iridescent palette, honesty rules, no-terminal rule,
mono-UPPERCASE button labels. V1 retired: pure-#000 canvas, radius-0, mono-as-body,
iridescent-fill CTA, bracket wordmark `[ pegana ]`. Decision trail: DESIGN.md front-matter +
`docs/design-research/2026-07-*` (teardown → 33-agent research → artifact iterations v1-v5).
This file changes by evolution with evidence, not by mood.
