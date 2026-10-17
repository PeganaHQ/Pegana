# CODE-level reference findings
**Method:** playwright `browser_evaluate` to read computed styles + DOM markup + CSS custom properties from each reference site. NOT screenshot interpretation.

**Why this exists:** the 3 previous mock attempts (incl. mine today) failed for being "generic AI". User feedback: "pegue os codigos, não somente tire fotos". This doc has only verifiable real values from each site's live DOM.

---

## frames.ag — the explicit reference

### Stack discovered
- **Next.js + Tailwind**, font loading via `next/font` (body class lists CSS module variables)
- **4 fonts loaded**, each used for a specific role:
  - `GeistSans` (variable 100-900) — UI / general
  - `GeistMono` (variable 100-900) — labels, tabs, tickers
  - `Host Grotesk` (300-800) — **HERO headline**
  - `Noto Serif` (100-900) — **CLOSER headline only**
- Uses Privy SDK (wallet auth) — privy- tokens visible
- Uses Lucide icons

### Color tokens (light + dark)
```css
/* light :root */
--background: white;
--foreground: black;
--card: #f2f5f6;
--muted: #d8dddf;
--muted-foreground: #4d5353;
--border: #d8dddf;

/* .dark */
--background: black;
--foreground: white;
--card: #0d1416;
--muted: #1c2123;
--muted-foreground: #8a8f8f;   /* notably grayer than Pegana's #e8e8e8 */
--border: #1c2123;
--input: #ffffff26;            /* white at 15% alpha */
```

**Comparison with Pegana current:**
| token | Pegana | frames.ag dark | note |
|---|---|---|---|
| canvas/bg | `#000` | `#000` | identical |
| text | `#fffdf9` (cream) | `#fff` pure | ours is warmer |
| body text | `#e8e8e8` (-text-body) | `#8a8f8f` (-muted-foreground) | THEY ARE MUCH GRAYER. Significant. |
| surface-1 | `#0a0a0a` | `#0d1416` (slight blue) | both subtle |
| surface-2 | `#141414` | `#1c2123` (slight blue) | both subtle |
| hairline | `#1a1a1a` | `#1c2123` (-border) | nearly identical |

### Hero headline (the "Outperform regular agents.")
```html
<h1 class="font-host font-normal text-[44px] sm:text-[48px] md:text-[56px]
           leading-[1.1] tracking-tight text-left sm:text-center max-w-[720px]">
  Outperform<br class="sm:hidden"> regular agents.
</h1>
```
Computed (desktop): **56px / 61.6px line / -1.4px letter-spacing / weight 400 / Host Grotesk sans**.

**Surprise:** I previously logged this as "giant serif headline" — wrong. Sans (Host Grotesk). It LOOKS serif-like because Host Grotesk has high contrast strokes.

### Closer headline (the "Maximizing Agent Potential")
```html
<h2 class="font-serif text-5xl sm:text-6xl lg:text-7xl xl:text-8xl
           tracking-tight mb-8 sm:mb-12">
  Maximizing<br>Agent Potential
</h2>
```
Computed (desktop): **96px / 96px line (1.0) / -2.4px letter-spacing / weight 400 / Noto Serif**.

**This is the move I missed:** hero uses sans, closer uses serif. Two typefaces for two roles. Sophisticated. The sans hero feels modern/technical; the serif closer feels editorial/conclusive.

### Eyebrow pill (above hero headline)
```html
<a href="..." class="inline-flex items-center px-3 py-1.5 bg-teal-500/10
                    hover:bg-teal-500/20 transition-colors cursor-pointer">
  <span class="font-mono text-xs font-medium tracking-[0.5px] uppercase
               text-teal-600 dark:text-teal-400">
    All new wallets funded with free cash
  </span>
</a>
```
**Critical detail:** `border-radius: 0`. Not rounded-full / not a pill. It's a **rectangular tag** with 10% alpha background. Mono font, uppercase, 12px, +0.5px letter-spacing.

The "pill" descriptor in my prior notes was wrong — it's a rectangle.

### Setup section — the tabbed paste widget
```html
<section class="px-5 sm:px-[6vw] lg:px-[16vw] py-24 sm:py-48 flex flex-col gap-12 lg:gap-16">
  <div class="flex flex-col gap-8">
    <p class="text-xl sm:text-2xl text-foreground leading-tight">
      Setup in one minute
    </p>
    <!-- tab row -->
    <div class="flex items-center gap-1 mb-3">
      <button class="font-mono rounded-[2px] transition-colors cursor-pointer
                     text-sm px-3 py-1.5 bg-muted text-foreground">prompt</button>
      <button class="font-mono rounded-[2px] transition-colors cursor-pointer
                     text-sm px-3 py-1.5 text-muted-foreground
                     hover:bg-muted/80 hover:text-foreground/80">pnpm</button>
      <!-- npm, bun similar -->
    </div>
    <!-- paste box -->
    <div class="flex group w-full">
      <div class="font-mono text-left relative flex-1 flex items-center
                  overflow-hidden min-w-0 rounded-l-[2px] bg-foreground
                  text-sm leading-none h-[44px]">
        <!-- code content (inverted: black bg, white text on light page) -->
      </div>
      <!-- COPY button on right with rounded-r-[2px] -->
    </div>
  </div>
</section>
```

**Real values:**
- Section padding: `px-5 sm:px-[6vw] lg:px-[16vw]` = 20px → 6% viewport → 16% viewport (huge gutters on desktop)
- Section vertical: `py-24 sm:py-48` = 96px → 192px
- Section label: simple `<p>` not `<h3>`. 20px → 24px. Leading-tight. Just text, no decoration.
- Tabs: `gap-1` (4px between buttons), `rounded-[2px]` (barely rounded), `font-mono text-sm` (14px), `px-3 py-1.5` (12px/6px)
- Active tab: `bg-muted text-foreground` (no underline, no border — just a fill)
- Inactive tab: `text-muted-foreground` + hover state
- Paste box: `bg-foreground` (BLACK on light theme — INVERTED contrast), height `44px`, `text-sm` mono, `rounded-l-[2px]` (only left corners), `leading-none` (1.0 line height)

**The pattern in plain English:** 4 mono buttons in a row, then a thin (44px tall) black bar with code text and a copy button at the right end. Minimal. NOT framed in a heavy widget container. NOT a card. Just buttons and a bar.

**For Pegana (dark theme inverse):** paste box would be `bg-foreground` = WHITE on our black background. Or stay with a dark surface and just contrast more subtly. Inversion gives more punch.

### "Live ticker" at hero bottom — NOT a marquee
```html
<div class="px-4 sm:px-8 lg:px-12 pt-12 pb-10 sm:pt-0 sm:pb-12">
  <!-- mobile: 2-col flex -->
  <div class="flex sm:hidden flex-col gap-8">
    <div class="flex items-end gap-8">
      <div class="flex flex-col gap-1">
        <span class="font-mono text-base text-muted-foreground tracking-[0.5px]">TXS</span>
        <span class="font-mono text-base font-semibold text-foreground tracking-[0.5px]">444,042</span>
      </div>
      <!-- VOLUME similar -->
    </div>
    <!-- ACTIVITY: 1 most recent event with status -->
  </div>
  <!-- desktop variant similar -->
</div>
```

**Surprise:** my prior note said "live ticker band running marquee" — wrong. It's a **STATIC two-column stats display** (TXS / VOLUME) on the left + ACTIVITY block (most recent event with red FAILED status) on the right. Bloomberg-terminal energy without the kitsch of scrolling text.

The actual "ticker" element on the page (`.scrollbar-none ... cursor-grab active:cursor-grabbing`) is a **draggable horizontal scroll**, user-controlled, not auto-scrolling. Different from the typical marquee.

**For Pegana:** validates that a thin stats strip + 1 latest event is more "real" than a marquee. But since user said the current marquee is "lindo", do NOT touch it.

### Section padding rhythm (use as guide for new sections)
- Horizontal: `px-5 sm:px-[6vw] lg:px-[16vw]` (huge desktop gutters)
- Vertical: `py-20 sm:py-40` (80px → 160px) for normal sections; `py-24 sm:py-48` (96px → 192px) for emphasis sections
- Gap inside section content: `gap-12` (48px), `lg:gap-16` (64px)

### Border-radius discipline
**Everywhere they use:** `rounded-[2px]`. Barely rounded. Sharp without being brutalist.
**Exception:** the eyebrow tag is `rounded: 0` (zero).
**Pegana current state:** most elements have NO radius (sharp). Some buttons use border-only. Pegana is sharper than frames.ag — that's a discipline difference, not a fault.

---

## measured.site — the wordmark reference

### Stack discovered
- Custom build (no Tailwind tokens visible in `:root`)
- **ONE typeface only**: "Untitled" (Klim's Untitled Sans, likely)
- Body bg: `#fff` pure white. Body text: `#000` pure black.
- Body class includes `selection:bg-measured-blue` — custom Tailwind plugin/theme

### Hero "wordmark headline"
```html
<h1 style="line-height:0.69" class="text-[24vw] absolute left-1/2 -translate-x-1/2 top-0">
  Measured
</h1>
```
**Computed:** font-size **414.72px** (at 1728px viewport), line-height 286px (0.69!), weight 400.
**Position:** absolutely positioned, centered horizontally, anchored to top.
**Discipline:** `text-[24vw]` = always 24% of viewport width. Scales with viewport, not breakpoint hops.

### CTA "Join"
- White bg, black text, **border-radius: 0px** (sharp corners — NOT rounded)
- 15.5px font
- Padding: 3.456px / 17.28px (Tailwind rem units)

### Confidence patterns
- Single typeface across entire site
- No `<section>` semantics — just `<div>`s
- 0 border-radius (sharper than frames.ag's 2px)
- Headline scales viewport-relative (`24vw`), not breakpoint-relative

**For Pegana wordmark closer:** validates "as big as you can make it" approach. The V2 Wordmark was xl:248px — Measured would call that conservative. Could go to `text-[20vw]` or even more aggressive.

---

## incredibles.dev — dark + iridescent reference

### Stack discovered
- Custom build (NOT Next/Tailwind — own grid system)
- **2 fonts**:
  - `Supply` (sans, normal + bold) — body, UI, sub-headings
  - `Monument` (800 only) — display wordmark
- Body bg: `#120e12` — **near-black with subtle purple tint** (not pure `#000`)
- Body text: `#fff4fa` — **off-white with pink tint** (not pure `#fff`)

### Wordmark "incredibles" (centered hero)
```html
<h1>
  <span class="l__header__title">incredibles</span>
  <span class="l__header__baseline u-height-fix">Web development studio</span>
</h1>
```
- `incredibles` span: **Monument, 99.7px, weight 700, line-height 1.0, letter-spacing -4.985px** (-5%)
- `Web development studio` baseline: **Supply, 28px, weight 700, line-height 1.5, letter-spacing +2.8px** (+10%, wide)

**Surprise:** the wordmark is **only 100px** — NOT edge-to-edge as I'd thought. The visual impression of "huge" comes from:
1. Very tight tracking (-5%)
2. Monument is a wide / extended sans
3. Iridescent prism BEHIND the wordmark amplifies it visually
4. Single anchor in mostly empty viewport

### CSS variable system (deep)
```css
:root {
  --color-black: #120e12;
  --color-white: #fff4fa;
  --color-brand-1: #e97c00;       /* orange anchor */
  --font-family-sans: "Supply", sans-serif;
  --font-family-heading: "Monument", sans-serif;
  --main-title-size: clamp(3rem, min(6vw, 10lvh), 7.14rem);
  --main-title-width: calc(var(--main-title-size) * 8.64);
  --font-size-base: 14px;        /* 14px not 16px */
  --font-weight-base: 400;
  --font-height-base: 1.5;
  --font-spacing-base: 0.2rem;
  --global-padding: 2rem;        /* 32px */
  --section-spacing: 4.6875rem;  /* 75px */
  --grid-container-max-width: 2560px;
  --grid-offset: 16px;
  --grid-columns-count: 12;
}
```

**Notable:**
- Base font size **14px** (not the typical 16px). Tighter informational density.
- Title size uses `clamp(3rem, min(6vw, 10lvh), 7.14rem)` — combines viewport-width AND viewport-height with a rem clamp. Defensive.
- `lvh` (large viewport height) used — modern unit for browsers with shrinking URL bars.
- 12-col grid with `2560px` max width (way wider than typical 1280-1440).
- `--section-spacing` is 75px — tighter than frames.ag's 96-192px.

### Iridescent gradient
The header SVG logo has a 3-stop gradient defined but filled solid white on top:
```svg
<linearGradient id="a" x1="0" x2="7.75" y1="22" y2=".138">
  <stop stop-color="color(display-p3 0 .9725 .9451)"></stop>      <!-- cyan -->
  <stop offset=".482" stop-color="color(display-p3 1 .7399 .1167)"></stop>  <!-- yellow -->
  <stop offset="1" stop-color="color(display-p3 .9961 .5176 .5608)"></stop> <!-- coral pink -->
</linearGradient>
```
Three stops: cyan → yellow → coral pink. Pegana's iridescent is: yellow → orange → magenta. Similar palette, different temperature (Incredibles is cooler/cyan-leading, Pegana is warmer/yellow-leading).

Note the use of `color(display-p3 ...)` — modern wide-gamut color syntax for Apple/iOS displays.

**For Pegana:** consider migrating iridescent gradient stops to display-p3 for newer browsers (fallback to sRGB hex). Subtle but more vivid on modern hardware.

### Text glitch hover (the "HIRE US" link)
```html
<a class="js-text-glitch" aria-label="Hire us">
  <span class="u-height-fix">
    <div class="word" aria-hidden="true" style="position: r..."> <!-- (truncated) -->
```
They use a custom JS class `js-text-glitch` that splits text into characters and randomly cycles them on hover. Common technique. Not unique to Incredibles. Pegana could implement with a small util.

---

# Cross-site takeaways at code level

## Typography roles
All three sites have STRICT typeface discipline:
- **Frames.ag**: Host Grotesk (display sans), Noto Serif (closer), Geist Sans (UI), Geist Mono (labels). 4 fonts, 4 roles.
- **Measured**: Untitled Sans only. 1 font, all roles.
- **Incredibles**: Monument (display), Supply (everything else). 2 fonts, 2 roles.

**Pegana current**: Geist Sans + JetBrains Mono. **2 fonts, 2 roles.** ✓ already disciplined.

The "sans for hero, serif for closer" move from frames.ag is the ONE missing typographic play. If we want it: add a Serif font (Noto Serif or even Inter Display) for the closer/wordmark only.

## Border-radius
- Frames.ag: `rounded-[2px]` everywhere
- Measured: 0px everywhere
- Incredibles: 0px everywhere
**Pegana current**: mostly 0, some 8px (cards). Sharper alignment with Measured/Incredibles.

## Color depth
- Frames.ag dark: pure black + slight blue tint cards (`#0d1416`, `#1c2123`)
- Incredibles: near-black `#120e12` + slight pink off-white `#fff4fa`
- Pegana: pure black `#000` + warm off-white `#fffdf9`
**All three avoid pure greyscale.** Each picks a temperature. Pegana's warm (coral/magenta brand) is consistent with brand DNA — keep.

## Section padding rhythm
- Frames.ag: 96–192px vertical, 6vw–16vw horizontal
- Incredibles: 75px vertical (tighter)
- Pegana current: 120px vertical, 20-80px horizontal
**Pegana could grow vertical padding** on big sections to 160-192px to match frames.ag confidence.

## Live data / ticker
- Frames.ag: STATIC stats strip (TXS/VOLUME/ACTIVITY) at hero bottom. Not marquee.
- User says Pegana's marquee is "lindo" — keep untouched.
**Decision:** do NOT replace marquee with stats. User's word wins.

## Wordmark closer scale
- Measured: text-[24vw] = 414px at desktop (the wordmark IS the hero)
- Incredibles: 99.7px (smaller, but with -5% tracking and prism backdrop)
- Frames.ag: closer is Noto Serif at 96px (smaller still)
**Pegana V2 Wordmark** was xl:248px — between Incredibles (100) and Measured (414). Solid middle ground; could push to 20vw if user wants more impact.

---

## rarible.com — crypto-native dark terminal

### Stack
- Next.js + shadcn/ui (HSL CSS variables: `240 5.9% 10%` etc.)
- Dark by default — body has `dark` class
- **Body font: Geist Mono** ← this is a major move. They use MONO as the base typeface for body text.
- **Heading font: Tomorrow** (Google Fonts geometric sans, weight 400 + 700)
- Body bg: `rgb(10,10,10)` = `#0a0a0a`
- Body text: white pure

### Headline
```html
<h1 class="font-bold text-white text-xl leading-tight md:text-2xl">VeeFriends</h1>
```
- Font: Tomorrow, 28px, weight 400, line-height 36px (1.29)
- Modest (not display) — Rarible is a marketplace, headlines are content titles not hero pieces

### Cards
- bg `#09090b` (zinc-950 from Tailwind)
- border `1px solid rgba(255, 255, 255, 0.1)` ← white at 10% alpha — subtle
- **border-radius: 12px** (more rounded than frames.ag's 2px or incredibles' 0px)
- 0 padding (content has its own)

### Color tokens (shadcn pattern with HSL)
```css
:root {  /* light defaults */
  --background: white;
  --foreground: black;
  --primary: 240 5.9% 10%;        /* HSL fragments */
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --destructive: 334.41 100% 58.63%;   /* hot pink */
  --chart-positive: 81.2 100% 48.82%;  /* electric green */
  --chart-negative: 334.41 100% 58.63%; /* hot pink */
  --radius: .5rem;
}
```
The `--chart-positive: 81.2 100% 48.82%` is **electric green** (#5fe800 ish) — the "Electric Green" that refero tagged this site for. Used on price-up indicators.

### Take for Pegana
- **Mono-as-body font** is the boldest single move in the crypto-dark genre. Pegana could shift from Geist Sans → JetBrains Mono for body text on the landing only. Risk: legibility on longer paragraphs. Reward: maximum "terminal" / data-native feel.
- **Geo-sans (Tomorrow) for headings** is interesting but Tomorrow specifically has tech-dystopian vibe — doesn't fit Pegana's editorial-precision tone. Pegana's Geist Sans is the right call.
- **Electric green for positive state** could replace Pegana's `--st-pegged: #6bd697` (more muted). Decision pending — depends on whether we want "Bloomberg classic" (muted) or "crypto-native dashboard" (electric).

---

# DECISION INPUTS — what these findings actually unlock

Based on the 4 sites inspected at code level, the open decisions for Pegana landing fall into 3 buckets:

## 1. TYPEFACE STRATEGY (biggest wedge)

| Option | Pattern source | Pros | Cons |
|---|---|---|---|
| **A. Keep as-is** (Geist Sans + JetBrains Mono) | Pegana current | Already on-brand, no work needed | Misses the "two-type roles" frames.ag move that gives editorial texture |
| **B. Add a serif for the closer only** (Pegana Geist Sans body + Geist Mono labels + Noto Serif on Wordmark/closer) | frames.ag closer | Adds editorial-conclusive feeling to the closer; cheap to add (1 Google Font) | Three fonts is one more thing to maintain |
| **C. Switch BODY to mono** (JetBrains Mono everywhere) | Rarible | Maximum "terminal" feel, totally on-genre for crypto-data | Reading 4+ paragraphs in mono is fatiguing |
| **D. Add a display sans for headlines** (e.g., Host Grotesk or Söhne for hero/wordmark, keep Geist Sans + JetBrains Mono otherwise) | frames.ag hero | Hero gets a distinctive voice; body stays readable | Yet another font |

## 2. BORDER-RADIUS DISCIPLINE

| Option | Source | Note |
|---|---|---|
| 0px everywhere | Measured, Incredibles | Sharpest. Editorial. |
| 2px barely-rounded | frames.ag | Sharp without being brutalist. Their signature. |
| 8-12px on cards | Rarible / shadcn default | More mainstream SaaS. |

**Pegana current**: mostly 0, occasional 8. **Recommendation:** lock everything to 0 OR everything to 2px. Pick one and commit.

## 3. PALETTE EXTENSIONS

The current Pegana palette (warm off-white on pure black with sunset coral/magenta brackets) is uncontested by any reference. The optional adds:
- Electric green `#5fe800`-ish for "live / positive" state (Rarible move)
- Slight cool tint to surface-1/surface-2 (frames.ag `#0d1416` instead of our `#0a0a0a`)
- Slight color tint to canvas (Incredibles `#120e12` instead of pure `#000`)

**Recommendation:** stay pure black canvas (committed brand), do NOT add electric green (clashes with sunset coral/magenta), consider the cool tint on surfaces only if the visual companion shows it helping.

---

# REFRAMING — user wants "real crypto SaaS", NOT terminal

User explicitly rejected the terminal direction: *"Eu não quero terminalzinho, font em italico, eu quero real crypto saas project"*. Surfaced three additional anchors: **base.org**, **phantom.app**, and reaffirmed frames.ag.

## base.org — clean cobalt, friendly enterprise

- Body bg: pure white. Body text: `#171717`.
- Fonts: **`googleSansFlex`** (variable Google Sans), **Geist Mono** (technical), **baseSansMono** (custom Base font), **CoinbaseSans** (Coinbase brand font).
- Hero: huge headline "The blockchain for global finance." in friendly bold sans, ~500 weight.
- Single eyebrow utility bar at very top: "Introducing Base MCP. Give your agents a wallet." — small slim, single link.
- Color tokens: `--base-blue-p3: #002ef4` (deep cobalt), `--base-blue-light-p3: #0057ea`. Display-p3 wide-gamut.
- Decoration: tiny pixel-rain particle animations scattered, NOT large 3D objects.
- Logo strip below hero: ~7 partner logos DESATURATED (Aave, Chainlink, alchemy, PNC, etc.). All-gray.
- 10 sections — full-length editorial newsfeed structure.

**Pattern: a blog/newsroom landing.** The "Latest Releases" carousel near the top dominates the visible page — not a sales pitch. Base lets the news cards do the talking.

## phantom.app — playful consumer, custom typeface

- Body bg: pale lavender cream. Body text color: `rgb(60, 49, 91)` = `#3c315b` (dark purple-violet).
- Custom font: **"Phantom"** (their own typeface), 96px on the hero, weight 400, line-height 105.6px, letter-spacing -2.4px.
- Headline color: `rgb(255, 253, 248)` = `#fffdf8` — **IDENTICAL to Pegana's `#fffdf9`** (warm cream).
- Hero structure: **DARK PURPLE/CHARCOAL BOX** sitting on cream lavender body, rounded bottom corners. Background of the dark box has **organic abstract shapes** — large coral/orange, muted green, beige, dark blob shapes. Not gradients, not particles — **abstract art**.
- Headline: "Your home for trading crypto, predictions, and more." playful, conversational, generous spacing across 4 lines.
- Eyebrow: small text "The money app that'll take you places" above headline.
- CTA: single rounded lavender PILL "Download Phantom" with phone icon. NO secondary CTA.
- Nav: **floating white pill** containing all nav links + search icon + Download CTA. Sticky.
- Below hero: section heading "Trading tools for [ghost icon] everyone" — **brand glyph inline in the headline between "for" and "everyone"**. Playful.
- Pill "See more" CTA with diagonal arrow.

**Pattern: playful consumer with brand identity.** Phantom's design language: alternating dark box (hero / closer) on cream body, custom typeface, organic art as decoration, brand glyphs INLINE in copy.

## What "real crypto SaaS" actually means here

Comparing frames.ag + base.org + phantom.app + Pegana brand DNA:

| Dimension | frames.ag | base.org | phantom.app | Pegana brand |
|---|---|---|---|---|
| Background | white | white | lavender + dark hero box | pure black |
| Headline weight | medium sans | bold sans (~500) | regular custom (400) | medium sans |
| Decoration | minimal | tiny particles | **organic art shapes** | iridescent gradient + dot grid |
| Tone | technical sharp | enterprise friendly | playful consumer | technical precise |
| CTAs | small rectangular | pill | **pill** | rectangular bordered |
| Nav | flat caps | flat dropdowns | floating pill | flat caps |

**Common across all three real-crypto-SaaS sites:**
1. **Generous whitespace** — sections breathe. Not packed dense like terminal.
2. **Single dominant statement per section** — one big headline, one visual, maybe one CTA. No info-dump.
3. **Friendly approachable copy** — "Your home for trading..." / "The blockchain for global finance." Not "Read peg-risk via REST API endpoint /v1/assets".
4. **Custom brand asset front and center** — Phantom's ghost glyph, Base's blue square, frames.ag's "F" seal. Pegana has `[ pegana ]` brackets.
5. **Decoration that's brand-distinctive** — not generic dots/gradients. Phantom's organic shapes are signature. Pegana's iridescent gradient is signature.
6. **Pills > rectangles** on Phantom and base.org for CTAs. Pegana uses rectangular bordered CTAs.

## What this means for Pegana's direction

- KEEP: dark canvas, iridescent gradient, off-white text, sharp brand DNA, the hero (locked), the marquee (locked), the wordmark closer (V2 return).
- ADOPT: **generous whitespace** between sections (more padding), **single dominant statement** per section instead of card grids, **friendly copy tone** (less "REST API endpoint", more "Read peg-risk wherever your code lives"), maybe **pill CTAs** as a secondary option alongside rectangular, **organic non-geometric decoration** instead of dot grids and gradient blobs (Phantom-style).
- AVOID: terminal-card grids, info-dense rows, "spec-sheet Bloomberg" patterns, italic-anything, generic SaaS positioning strips.
