# Pegana — Brand & Visual Identity Audit + Direction

**Date:** 2026-06-30
**Author:** senior design audit (Claude)
**Purpose:** A complete, evidence-based study of Pegana's brand vs. its competitive set, written to be **fed into Claude Design / other AI design tools** to *evolve* the existing identity (logo, app icon, banner, system) — not to start over.
**Method:** First-hand reads of Pegana's shipped assets + live site (`www.pegana.xyz`) + `brand.md`, plus two parallel competitor teardowns pulling live computed-style values (hex/fonts) from 13 brands on 2026-06-30.

> **Locked constraints (do not violate in any output):** No terminal/CLI/Bloomberg aesthetic. No scanlines/CRT/ASCII. No serif, no italic — *anywhere*. Mono (JetBrains Mono) is scoped to numbers/labels/code only. Dark canvas for marketing. The `[ pegana ]` bracket concept is brand equity — **evolve it, never discard it.**

---

## 0. How to use this document

1. Section 1–2 = grounding (what Pegana is + the exact current system, with hex tokens).
2. Section 3 = honest critique (strengths + the 4 real weaknesses).
3. Section 4 = the competitive map (where every relevant brand sits + the whitespace).
4. Section 5 = the direction (5 recommendations, each justified by evidence).
5. Section 6 = **what I deliberately refused to recommend, and why** (the discipline pass).
6. Section 7 = **ready-to-paste briefs/prompts** for Claude Design and other AIs.

---

## 1. What Pegana is (positioning grounding)

**One line:** *The peg-risk oracle for Solana.*

Pegana watches Solana pegged assets in real time — stablecoins, liquid-staking tokens (LSTs), and yield-bearing assets — compares **market price** against **intrinsic value**, and publishes the **state change** before risk moves downstream. It ships the signal across REST, WebSocket, MCP (for AI agents), Webhooks, and Telegram, and backs it with **verifiable receipts** (a public, byte-reproducible trust layer).

- **Core mechanic:** `spread = 1 − market / intrinsic`. Five sources, four/five states: **PEGGED · DRIFT · DEPEG · CRITICAL · UNKNOWN**.
- **The whole product is a question:** *is the asset's value inside the band, or has it drifted out?* This matters for the identity — the brand is literally named after a **threshold** / band.
- **~23 assets tracked.** Mainnet only. Solo founder.
- **Brand register today:** a polished, dark, editorial crypto-SaaS — peers it explicitly benchmarks against are Phantom / Base / Helius / NEAR / frames.ag.

---

## 2. Current brand inventory (the exact system today)

### 2.1 Logo / mark
- **"Threshold Brackets" lockup:** `[ pegana ]`.
  - Left bracket `[` — **coral `#ff8a5b`**, JetBrains Mono, weight 400.
  - Wordmark `pegana` — `currentColor` (white on dark), **Geist semibold (600/500)**, tracking `-0.04em`.
  - Right bracket `]` — **magenta `#e878d8`**, JetBrains Mono, weight 400.
- **Built as inline-flex text**, not an SVG path (`web/components/atoms/brand-mark.tsx`).
- **App icon `[p]`:** coral `[`, white `p` (Geist 700), magenta `]`, on a pure-black rounded square.
- **There is no abstract/standalone symbol.** The identity is 100% typographic. The favicon and app icon are rasterized type.

### 2.2 Palette
| Token | Hex | Role |
|---|---|---|
| canvas | `#000000` | page bg — **pure black**, not navy |
| surface-1 / -2 | `#0a0a0a` / `#141414` | cards / inner panels |
| hairline / outline | `#1a1a1a` / `#2a2a2a` | dividers / interactive borders |
| text / body / muted / caption | `#fffdf9` / `#e8e8e8` / `#9aa9b8` / `#787878` | type ladder |
| **coral** | `#ff8a5b` | bracket-left, accent |
| **magenta** | `#e878d8` | bracket-right, accent |
| iridescent gradient | `linear-gradient(90deg,#feed7a 0%,#ff8400 50%,#df91f7 100%)` | **the** signature accent — "ammunition, never decoration" |
| state pips | pegged `#6bd697` · drift `#c08a55` · depeg `#a55a5a` · critical `#b73838` · unknown `#9aa9b8` | semantic peg states (separate from brand accent) |

### 2.3 Typography
- **Geist** (sans) — body, headlines, UI, nav, CTAs. The default.
- **JetBrains Mono** — numbers, datestamps, captions, technical labels (REST/WS/MCP), code, kbd.
- Weights 400 / 500 / 600. **No italic, no serif anywhere** (locked rule; verified enforced in code).

### 2.4 Geometry / surface / motion
- **Sharp by default:** containers `border-radius: 0`. **Pills (`rounded-full`) only for CTAs.** 1px borders. No card shadows (glow only on state pips).
- Surface ladder on pure black: `#000 → #0a0a0a → #141414`.
- **Motion: ease only, no springs** (`cubic-bezier(0.22,1,0.36,1)`); GSAP hero word-reveal; global reduced-motion guard.

### 2.5 Signature visual devices (what's actually memorable)
1. **Iridescent gradient** (yellow→orange→magenta) — on hero headline 2nd line, brandmark dot, primary CTA, footer glow, methodology variable underlines.
2. **Giant edge-to-edge `PEGANA` footer wordmark** with a vertical white→grey fade and a warm glow band above it (Phantom/Base/Vercel lineage). Strong.
3. **Methodology "formula" device:** `spread = 1 − market / intrinsic` with iridescent underlines under each variable.
4. **State-pip lozenges** — rounded capsules with a colored dot (the live peg-state atom).
5. **Corner-tick framing + faint peg-line wave** on the OG banner.

### 2.6 The current OG banner (`og-v3.png`, 1200×630)
Pure-black; `[ pegana ]` top-left + `● LIVE` top-right; headline "**The peg-risk** / *oracle for Solana.*" (2nd line in the iridescent gradient); faint peg-line wave across the bottom; `REST · WEBSOCKET · MCP · WEBHOOK · TELEGRAM` bottom-left; `PEGANA.XYZ` bottom-right; thin corner brackets framing the canvas. **Genuinely clean, editorial work** — already above the category bar.

---

## 3. Honest critique

### Strengths (keep, protect)
- **Warm-on-pure-black is a real, rare differentiator** (see §4). The sunset palette is the brand's biggest asset.
- **Editorial restraint** — no 3D blobs, no isometric clutter, no neon soup. Disciplined whitespace and a single statement per section. This is *exactly* what separates premium from AI-template (verified across the peer set).
- **The bracket concept is genuinely on-strategy** — Pegana is a *threshold/band* product; brackets literally bracket a value. Most brands have to invent a metaphor; Pegana already owns one.
- **The footer wordmark + the formula device** are confident, ownable brand moments.
- **Internal consistency** — the no-italic/no-serif/no-terminal rules are documented *and* enforced in code.

### The 4 real weaknesses (in priority order)
1. **No standalone, reducible symbol.** The mark is a typographic lockup. It cannot live as a 16px favicon, an integration-row logo, or an app icon without becoming a 3-element, 2-color cluster. Every premium peer has a separable glyph; this is the one structural gap.
2. **Identity over-depends on a gradient.** The iridescent gradient carries the hero headline, the mark dot, and the CTAs. Gradients date fast, and across 8 premium brands gradients are kept *ambient* (background washes), never on the logo or type. Pegana's memorability is currently renting a trend.
3. **The `[p]` icon is weak at small size** and **collides with a category neighbor.** Asymmetric coral/magenta brackets read as arbitrary at 16–32px; the maskable variant floats too small in the safe zone; and a lowercase "p" mark sits right next to **Pyth's circular "p"** in the *same* oracle category.
4. **The banner's channel strip is the weakest element.** `REST · WEBSOCKET · MCP · WEBHOOK · TELEGRAM` is exactly the "generic SaaS positioning strip" `brand.md` itself bans on-site — it's plumbing, not proof, and it's the least distinctive thing on an otherwise strong banner.

---

## 4. Competitive landscape (live-verified, 2026-06-30)

### 4.1 Direct / adjacent — peg, depeg, stablecoin & DeFi-risk
| Brand | Canvas | Signature accent | Type | Mark | Vibe |
|---|---|---|---|---|---|
| **StableGuard** (closest direct) | dark | teal `#3DD6D0` | system sans | wordmark, no real symbol | indie alert-console |
| **Chaos Labs** | dark navy `#0B101C` | electric blue `#2D6AE7` | **custom "ataero" display** | small abstract glyph | premium institutional (the one to beat) |
| **BlueChip** | **light** | blue `~#0066CC` | Inter-like | wordmark + letter-grades (A–F) | neutral ratings authority |
| **Stablewatch** | light-ish | **none owned** | modern sans | wordmark + minor glyph | generic analytics terminal |
| **LlamaRisk** | dark | blue/teal (unconfirmed) | sans | **llama mascot** (tonally off for "risk") | "Guardians of DeFi" |

**Read:** the direct lane is **cool (teal/blue) + system/Inter sans + wordmark-led, with no owned peg/depeg symbol.** Chaos Labs wins on a *proprietary typeface*; nobody owns a *mark*.

### 4.2 Aspirational peers — premium crypto/infra
| Brand | Canvas | Signature accent | Type | Mark | Device |
|---|---|---|---|---|---|
| **Phantom** | light lavender `#F5F2FF` | lavender `#AB9FF2` | **custom "Phantom" (F37)** | **ghost mascot** | floating ghost + pastel wash |
| **Helius** ⭐ | **pure black `#000`** | **orange `#E84326`** (warm!) | Lausanne + **Geist** | sunburst dot | stark black + 1 hot accent |
| **Base** | white | blue `#0052FF` | **custom Base Sans/Mono** | square-with-hole | flat primary-color blocks |
| **Pyth** (direct oracle peer) | **white** | aqua `#3DD6D0` / mint `#06FFA5` | Manrope | coil/"p" loop | live tickers, data-as-art |
| **Chainlink** | white | blue `#375BD2` | Inter | hexagon | **giant live $-counter (trust anchor)** |
| **NEAR** | white | mint `#00EC97` | FK Grotesk | N-bars | grain texture, editorial whitespace |
| **Jito** | dark `#0E0119` | lavender `#B96BFC` + mint | Aeonik | faceted glyph | purple→green glow field |
| **Sanctum** | dark navy `#0B101C` | multicolor pastel | Instrument Sans | loop mark | app mockups, soft color |

### 4.3 The three synthesis facts that drive everything
1. **Warm is open.** Of 13 brands, **only Helius is warm.** Every peg/risk/oracle brand is cool. Pegana's coral→magenta shares the rare warm lane with one respected infra brand and is **unique among all direct competitors.** → *Protect the warm palette; it is the moat.*
2. **An owned symbol is table stakes up-tier and whitespace down-tier.** All 8 premium peers have a separable, favicon-scale mark; almost no direct competitor does. → *A real Pegana glyph wins on both axes at once.*
3. **Premium = one flat accent + ambient (not applied) gradient + reducible mark + one repeated proof device + restraint.** The AI-slop tells are: default Inter/Geist with no personality, gradient-on-everything, 3D/isometric hero art, feature-card soup. → *Pegana already nails restraint; it should fix the mark and discipline the gradient.*

> **Most useful single reference for Pegana: Helius.** Pure-black canvas + one warm non-blue accent + a serious grotesque + a reducible dot mark + near-zero gradient. It is the closest tonal proof that Pegana's direction is *right* — and shows the next move (flatten the accent, own a mark).

---

## 5. Direction — recommendations (each justified, prioritized)

### R1 — Evolve the brackets into a real, single-color "peg-band" symbol *(highest leverage)*
- **What:** Promote `[ ]` from a typographic lockup to a true glyph whose meaning *is* the product: a value sitting **inside a band** — e.g. brackets with a centered tick/dot `[ · ]`, where the gap = the peg band/spread. Keep the brackets (equity); add the thing-inside (meaning).
- **Hard requirements:** must read in **one flat color** (so it survives in mono, in an integration logo row, as a state pip), at **16px**, as an **app icon**, and in **grayscale**.
- **Why it's defensible (not generic):** (a) it claims unclaimed category whitespace — no competitor owns a peg symbol; (b) it's derived from the literal mechanism, not decoration; (c) it dodges the Pyth-"p" collision; (d) all premium peers prove a reducible mark is table stakes. This is the one change that fixes weaknesses #1 and #3 together.

### R2 — Discipline the gradient: atmosphere, not identity
- **What:** Keep the coral→magenta sunset as **ambient** (hero spotlight, footer glow — the warm differentiator). Pull it **off the logo dot**; consider a **single flat coral** (`#ff8a5b`) as the primary mark/CTA color, and reserve the full iridescent for **one** hero moment.
- **Why:** Verified across 8 premium brands — gradients stay in the background; logos/type stay flat. The two most "infra-serious" peers (Helius, Chainlink) use essentially no gradient. This reduces dependence on a dating trend and lets the *timeless* element (the brackets/band) carry the brand.
- **Note (honest):** Pegana's gradient-headline is currently *restrained*, so treat R2 as a **fork to test in Claude Design** (flat-headline + ambient-gradient vs. current), not a blind mandate. The non-negotiable part is getting the gradient **off the mark**.

### R3 — Rebuild the app icon / favicon from the R1 symbol
- **What:** Derive the icon from the new glyph; make it **fill the maskable safe zone** with presence; test at 16/32px and in grayscale; resolve the asymmetric-color problem (a single flat accent, or a deliberate, *semantic* two-tone — not arbitrary).
- **Why:** Concrete, cheap, and the icon is the most-seen instance of the brand (browser tabs, wallet lists, integration rows).

### R4 — Rebuild the banner around a live *trust anchor*, not a channel strip
- **What:** Replace `REST · WEBSOCKET · MCP · WEBHOOK · TELEGRAM` with **one credible proof** tied to the promise — e.g. *"23 assets watched · last state-change published in 1.8s"* or *"0 missed depegs"* — plus the band motif. Shrink the protocol list to a quiet mono footer line at most.
- **Why:** Chainlink anchors its homepage on **one giant live metric** as proof; Pegana's verifiable-receipts trust layer is its real edge. Lead with proof, not plumbing. Fixes weakness #4.

### R5 — *(secondary, optional)* Use the existing light theme as the "authority" register for data/verification surfaces
- **What:** Keep marketing **dark** (differentiation); lean the **light product theme** (already built) for the dashboard / receipts / verification pages.
- **Why:** The two *actual* oracle brands (Pyth, Chainlink) and the ratings authority (BlueChip) are all **light** — light reads as "neutral financial-data authority," the exact register Pegana needs where it asks to be trusted as a source of record. Nearly free since the theme exists. **Low priority — flagged as product-strategy, not core brand.**

---

## 6. What I deliberately did NOT recommend (discipline pass)

Cut because generic, unjustifiable for a solo founder pre-demand, or actively wrong for this brand:

- **❌ Rebrand the palette / go light on marketing.** Destroys the single biggest differentiator (warm-on-black). The warm lane is the moat — protect it.
- **❌ Commission a custom typeface.** The peers that have one (Phantom F37, Base Sans) are well-funded. Geist is clean and *shared with Helius* — it is not the weak link. (If personality is ever wanted cheaply, an off-the-shelf characterful grotesque for headlines only — FK Grotesk / Aeonik — is the lever. Optional, not advised now.)
- **❌ Add a mascot** (à la LlamaRisk's llama / Phantom's ghost). A mascot undercuts the "serious oracle / source of record" register; the llama was flagged as tonally wrong for risk. Wrong move for a trust product.
- **❌ Add 3D blobs / isometric art / particle fields / animated hero gimmicks.** The single strongest AI-slop signal per the verified set. Pegana's restraint is an asset — don't spend it.
- **❌ Discard the brackets for a generic abstract geometric mark.** The brackets are already distinctive, semantic, and owned. Replacing them would be a downgrade. *Evolve, don't abandon.*
- **❌ "Improve consistency / more whitespace / add hover states / more gradients."** Generic filler. Pegana's craft is already high; these aren't where the leverage is.

---

## 7. Ready-to-paste briefs for Claude Design / other AIs

### 7.1 — Brand context block (paste this first, every time)
```
You are evolving the visual identity of PEGANA — "the peg-risk oracle for Solana."
It watches Solana pegged assets (stablecoins, liquid-staking tokens, yield-bearing
assets), compares market price to intrinsic value, and publishes the state change
(PEGGED / DRIFT / DEPEG / CRITICAL) before risk spreads. The whole product asks one
question: is the asset's value INSIDE the peg band, or has it drifted out? The brand
is named after that threshold/band.

LOCKED — do not violate:
- Palette: pure-black canvas #000000. Warm sunset accents: coral #ff8a5b, magenta
  #e878d8. Iridescent gradient linear-gradient(90deg,#feed7a,#ff8400,#df91f7) used
  ONLY as ambient atmosphere or one hero moment — NEVER on the logo/mark.
- Type: Geist (sans, everything) + JetBrains Mono (numbers/labels/code only).
  NO serif. NO italic. Anywhere.
- Geometry: sharp (border-radius 0) for containers; pills only for buttons; 1px borders.
- Equity: the "[ pegana ]" bracket lockup. EVOLVE the bracket concept — never discard it.

FORBIDDEN (these read as generic/AI or off-brand):
- Terminal/CLI/Bloomberg/CRT aesthetics, scanlines, ASCII, monospace headlines.
- 3D blobs, isometric illustration, particle fields, neon soup, mascots.
- Gradient applied to the logo or to headline-as-identity. Multiple competing accents.
- Cool blue/teal/purple (the entire competitor category already lives there — avoid it;
  warm is Pegana's differentiator).

NORTH STAR: Helius (helius.dev) — pure-black canvas, ONE warm flat accent, a serious
grotesque, a reducible dot mark, almost no gradient. Premium = one flat accent +
ambient gradient + a reducible mark + restraint.
```

### 7.2 — Logo / symbol exploration (R1 + R3)
```
[paste 7.1 first]
TASK: Design a standalone PEGANA symbol by evolving the "[ ]" bracket motif into a
mark whose meaning is "a value held inside the peg band." Think: brackets enclosing a
centered tick/dot/value — the gap between brackets reads as the band/spread.

Requirements:
- Must work as a SINGLE FLAT COLOR (test in coral #ff8a5b AND in mono white/black).
- Must be legible and distinct at 16px and 32px (favicon), as an app icon on a
  black rounded square, and inline in a row of other protocol logos.
- Must NOT look like a lowercase "p" (avoid colliding with Pyth's circular p mark).
- Pair the symbol with the existing "[ pegana ]" wordmark (Geist semibold, tracking
  -0.04em); show the lockup AND the symbol alone.
- Avoid: arbitrary two-tone (coral-left/magenta-right reads as accidental at small
  size) — if you use two tones, make them mean something (e.g. inside vs. outside band).
Deliver 4–6 distinct directions, each shown at large + 16px + grayscale.
```

### 7.3 — Banner / OG redesign (R4)
```
[paste 7.1 first]
TASK: Redesign the 1200×630 OG/social banner. Keep the strong bones of the current
one (pure black, "[ pegana ]" top-left, ● LIVE marker, corner-tick framing, headline
"The peg-risk oracle for Solana."). Two changes:
1) Replace the "REST · WEBSOCKET · MCP · WEBHOOK · TELEGRAM" channel strip with ONE
   credible live trust-anchor stat, e.g. "23 assets watched · last state-change
   published in 1.8s" or "0 missed depegs". Lead with proof, not plumbing.
2) Make the peg-BAND concept visible and ownable: a value/line riding inside a
   coral→magenta band, only if it communicates the real mechanism (intrinsic vs.
   market vs. band) — not a decorative sparkline.
Keep the iridescent gradient ambient (a glow), not on the logo. Deliver 3 variants.
```

---

## 8. Reference index

- **Pegana:** `brand.md`; `web/components/atoms/brand-mark.tsx`; `web/public/og-v3.png`, `android-chrome-512x512.png`, `icon-maskable-512x512.png`, `favicon.svg`; live `https://www.pegana.xyz`; shipped landing shots in `docs/design-research/landing-uplift-2026-05-27/shots/next-*.png`.
- **Competitors (live-verified 2026-06-30):** stableguard.org, chaoslabs.xyz, bluechip.org, stablewatch.io, llamarisk.com; phantom.com, helius.dev, base.org, pyth.network, chain.link, near.org, jito.network, sanctum.so.
- **Note:** "Parity" (alleged Solana peg-stability prediction market) could not be verified as a real branded product — excluded rather than invented.

---

## 9. Logo — alternative routes (solution space opened)

The current `[ pegana ]` lockup is **not** treated as locked here. Below is the full territory map, from "keep maximum equity" to "fresh start." Constraints that still hold for *every* route: must reduce to a **flat single-color** glyph legible at **16px**, work as an app icon on a black rounded square, carry meaning from the product (band / peg / measurement / signal / spread), use the **warm** accent (coral `#ff8a5b`), and **not** be a letter-P (dodges the Pyth "p" collision). Schematics below are *concept shorthand, not final art*.

### Route 1 — Containment / band *(keeps bracket equity)*
The brackets become a true glyph: a value held inside a band. Two expressions:
```
vertical (bracket lineage):   [ • ]        drifting:  [•  ]   →   [   •
horizontal (data lineage):    ───────
                                  •
                              ───────
```
- **Signals:** "is the value inside the band?" — the literal product question.
- **16px:** strong. **Equity kept:** maximum. **Pyth collision:** none.
- **Risk:** the safe choice; least surprising. **Verdict: keep as the low-risk anchor.**

### Route 2 — Anchor / peg *(name-driven, fresh start)*
"Pegana" literally contains *peg*. The mark = a peg/tack pinning a value to a reference line.
```
   ▽
 ──┴──        (a value pegged to its intrinsic baseline)
```
- **Signals:** the asset *pinned* to its true value; deviation = the peg loosening.
- **16px:** good. **Equity kept:** none (new). **Pyth collision:** none.
- **Risk:** must read as "peg," not the location-pin cliché. **Verdict: bold wildcard — strongest name tie.**

### Route 3 — Level / peg-gauge *(oracle-authority register)* ⭐
A measurement scale with end-stops and a marker; marker centered = PEGGED, marker drifted toward a stop = DRIFT/DEPEG. The end-stops can echo the brackets (equity bridge).
```
 ├──●──┤        pegged
 ├────●┤        drifting
```
- **Signals:** instrument / source-of-record / "we measure the peg." This is the register Pyth & Chainlink use to signal authority — but warm, not blue.
- **16px:** strong (short axis + dot). **Equity kept:** partial (stops ≈ brackets). **Pyth collision:** none. The dot carries the warm accent and can **flip color live in-product**.
- **Risk:** low. **Verdict: lead recommendation — unifies band + level + signal in one mark.**

### Route 4 — Signal / state *(product output as the logo)*
The state-pip — the colored dot that flips PEGGED→DEPEG — *becomes* the brand mark, inside a minimal enclosure.
```
 ( ● )    or    [ ● ]
```
- **Signals:** the brand *is* a live signal; maximally minimal and modern.
- **16px:** excellent. **Equity kept:** low–partial. **Pyth collision:** none.
- **Risk:** a bare dot is generic — the enclosure must do the distinguishing work. **Verdict: strong, modern; develop alongside Route 3.**

### Route 5 — Spread / divergence *(the formula made visible)*
Two reference marks (intrinsic vs. market) with the measured gap between them = `spread`.
```
 ▏   ▏
  └Δ┘          the gap is the spread
```
- **Signals:** the exact mechanic, `spread = 1 − market/intrinsic`.
- **16px:** moderate (risk of reading as a glitch). **Equity kept:** none. **Pyth collision:** none.
- **Risk:** most abstract — meaning may not survive without explanation. **Verdict: conceptual; keep as a secondary exploration, not a lead.**

### Floor option — wordmark-led, no symbol (Stripe/Vercel position)
Keep it primarily a wordmark, extract ONE distinctive letterform detail (e.g. a dot/state-pip over a letter, or a bracket-cut into the `g`). Lowest cost, most cohesive — **but it leaves the 16px/app-icon/integration-row gap unsolved**, which was weakness #1. Valid only if you decide a symbol isn't worth it.

### Cut (discipline pass)
- **❌ Pure "drift" mark** (a single off-register tick, no reference) — too abstract to read as anything without a caption; folded into Routes 3/5 as *motion behavior* instead (the marker animates off-center to show drift).
- **❌ Eye / radar / watchtower / shield** — "guard/watch" is StableGuard's lane and the most clichéd risk-symbol territory; it signals surveillance, not measurement/authority.

### Recommendation
Take **Routes 3, 4, and 1** into Claude Design as the three to generate variations of — they span *authority / live-signal / equity-keep*, all reduce to 16px, all warm-compatible, all dodge the Pyth-p. **Route 3 (`├──●──┤` peg-gauge) is the lead** — it's the only one that fuses band + level + signal *and* bridges bracket equity. Use **2 and 5** as wildcards to pressure-test against the favorites.

### Per-route generation add-on (append to the §7.1 brand-context block)
```
Generate logo/symbol concepts for PEGANA across these routes — show each at large + 16px + grayscale + as an app icon on a black rounded square:
- Route 3 (LEAD): a peg-gauge — a short measurement axis with two end-stops and a centered marker dot; marker centered = pegged, marker drifted toward a stop = depeg. End-stops may echo "[ ]" brackets. Marker dot in coral #ff8a5b.
- Route 4: the state-pip dot as the mark, inside a minimal enclosure ( ● ) / [ ● ].
- Route 1: the "[ ]" brackets evolved into a band with a value/dot inside.
- Route 2 (wildcard): a peg/tack pinning a value to a baseline — read as "peg", NOT a location pin.
- Route 5 (wildcard): two reference marks with a measured gap = the spread.
Constraints: single flat color must work; no letter-P (avoid Pyth collision); no eye/shield/radar; warm accent only.
```
