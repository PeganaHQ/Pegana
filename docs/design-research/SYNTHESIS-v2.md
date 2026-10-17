# Pegana — Frontend synthesis v2

> Second pass. Now grounded in 6 live crypto sites + 7 refero design.md = 13 references total.
> Visited: Eclipse · Vivid+Co · Base · DefiLlama · Pyth · Jito · Sanctum · Helius · Linear.
> Design.md analysed: Clyde · Vivid+Co · Gsap · Eclipse · Coinbase · Uniswap · Base.

## Where v1 fell short

- Caught the **tokens** (colors, fonts, spacing) but missed **what makes the live sites feel like products**.
- Confused "minimal" with "empty". Vivid+Co is not empty — it is *restrained*. Difference: restraint implies confidence (you have a thing, you choose to show little). Empty implies thin (you don't have a thing). My v2 landing leaned toward empty.
- Treated landing as separate from dashboard. Real premium sites **embed product UI fragments throughout the landing** (Linear is the master of this).
- Underused live data as a brand asset. Jito puts TVL/APY in the top of the page. DefiLlama treats numbers as anchor. We have 14 live assets — that *is* the product. Show it.

## 8 patterns I missed in v1 (each grounded in a specific live site)

### P1 · Top-of-page live ticker (Jito)
Jito puts `TVL: 626.50L · APY: 7.804.72B · Holders: 187,251` as the first row, above even the nav. It's a hyper-confident move — "we are not pitching, we are showing you real numbers." Pegana's analog: `PEGGED 12 · DRIFT 2 · DEPEG 0 · ALERTS 24H · 5 · UPTIME 99.97%` running across the very top.

### P2 · Hero with embedded product UI (Linear, DefiLlama)
Linear shows a real Linear UI mock as the hero centerpiece. Not a 3D illustration. The actual product. DefiLlama's hero literally IS the dashboard. The "product is the marketing" pattern. For Pegana: hero block contains a **live ticker pill + actual asset state cards floating** behind the headline. Not the whole dashboard — a curated fragment.

### P3 · Big number + sparkline (Pyth, DefiLlama)
Pyth: 4 stats blocks, each shows a big number + category label + tiny sparkline-ish chart. DefiLlama: same. Communicates "this is alive and growing." Pegana version: 4 inline stat cells showing `14 assets · 0.7s latency · 99.97% uptime · 142 alerts dispatched` each with a 24h sparkline graph below.

### P4 · Storytelling 01·02·03·04 with screenshots (Linear, Helius, Jito)
Linear scrolls through 6 numbered feature sections, each text-left + screenshot-right, alternating sides. Every section has a real product screenshot. This is the OPPOSITE of grid-of-cards. It's a narrative. For Pegana: 4 sequential sections (Intrinsic · Market · Discount · State machine), each shows the actual data flow + real Postgres query + real Telegram message screenshot.

### P5 · Wavy atmospheric glow (Helius)
Helius has orange wavy light streaks behind the hero — like aurora borealis but oriented horizontally. Branded atmosphere, not generic. The Vivid+Co prism is the SAME concept executed differently (3D refractive cube). Pegana needs ONE atmospheric element with personality — not just "subtle radial gradient." Refractive prism (Vivid+Co) OR signal wave (Helius-style but iridescent) OR data spray (Pyth's radial bars).

### P6 · Trusted-by as colored testimonial cards (Linear, Helius, Pyth)
Yellow card with quote on dark canvas (Linear). Multi-colored testimonial cards in a row (Helius). Pyth uses real publisher photos + quote + name + title. Pegana v1: Github stars + bot user count + first 5 dogfood users with handle and Telegram archive link.

### P7 · Saturated CTA strip before footer (Pyth, Base, Jito)
Pyth: deep purple full-width strip. Base: deep blue full-width strip. Jito: dark green w/ stripe pattern. EVERY one of these sites has a high-saturation full-width final CTA section before the footer. Pegana needs this: deep midnight w/ iridescent gradient stripe + "Catch the next depeg. Subscribe in Telegram."

### P8 · Wordmark at footer scale (Eclipse, Jito)
Eclipse: "ECLIPSE" letters take the full width of the footer at maybe 200px. Jito: "Jito" with diagonal stripe pattern inside the letters. The wordmark IS the closing statement. Pegana v1 has the right idea (outlined) but should be filled OR have a textural pattern (Solana CRT scanline? hairlines? iridescent gradient inside the letters?).

## Synthesis: what Pegana's landing should be

The model is **Linear's structure × Vivid+Co's restraint × Jito's live-data confidence**.

### Sequence

1. **Live ticker** (Jito) — thin row at top: counts + uptime + latency
2. **Nav** (Vivid+Co) — tiny brand mark left, minimal links right, ghost CTA
3. **Hero** (Linear) — large left-aligned title + narrow subhead right · embedded asset state card floating in background as product proof · iridescent atmospheric glow
4. **Stats row** (Pyth) — 4 big numbers + sparklines + captions
5. **Trusted-by row** — small monochrome wallet/protocol logos (Jito, Marinade, Sanctum) we monitor
6. **(01) Intrinsic** — text left, code/screenshot right
7. **(02) Market** — alternating direction
8. **(03) Discount** — alternating
9. **(04) State machine** — alternating, with state-pill visualization
10. **Live universe** — the 14 asset portraits in grid (already have, keep)
11. **Sample alert** — embedded Telegram message screenshot
12. **Trusted-by quote cards** — 2-3 colored cards w/ user quotes (when we have them, dogfood for v1)
13. **Saturated CTA strip** — full-width iridescent gradient
14. **Wordmark footer** — PEGANA at 200px scale, with hairline pattern inside the letters
15. **Footer** — 5 cols

### What we explicitly avoid

- Centered hero with three feature cards (the SaaS template). Linear NEVER centers, always left-aligns and uses asymmetric two-column flow.
- Glossy gradient cards with shadow (AI slop). Helius uses dark cards with subtle borders only.
- Stock crypto isometric illustration (AI slop). Use REAL product screenshots and asset state cards.
- Generic mono-tone state badges. Coinbase, Uniswap, Helius all use saturated semantic colors for state.

### Type & color refresh based on live sites

Live data shows real premium sites are **more colorful than refero suggests**. Pyth has 6+ accent colors. Helius uses orange + yellow + green simultaneously. Linear uses yellow callouts on dark.

Pegana revised palette:
- Canvas: `#08090a` (Linear-derived, slightly cooler than #000)
- Surface: `#13141a`
- Text: `#f6f6f4`
- Muted: `#6f879c`
- **Iridescent (signature)**: `linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%)` — used in: brand mark, hero glow, CTA strip, footer wordmark interior. Repeat for unity.
- State PEGGED: `#27ad75` (Coinbase positive) — UPGRADE from muted, since live sites validate saturated state colors
- State DRIFT: `#ff8400` (gradient mid-stop — coherent with brand)
- State DEPEG: `#f0616d`
- State CRITICAL: `#e01a2b` w/ pulse animation
- Testimonial card accent: `#fee65d` (yellow, Linear-derived)

So the EARLIER iridescent direction was right about the gradient — it just needed Vivid+Co's structural restraint instead of being plastered everywhere.

## Composite reference grid

| Element | Reference | Why |
|---|---|---|
| Top live ticker | Jito | Confidence + immediate "this is real" |
| Tiny brand · minimal nav | Vivid+Co | Restraint |
| Left-aligned hero | Linear, Helius | Premium B2B pattern |
| Atmospheric glow | Helius (wavy) + Vivid+Co (prism) | Brand atmosphere not stock art |
| Stats with sparklines | Pyth, DefiLlama | Live numbers as hero anchor |
| Numbered storytelling | Linear (01-06), Jito (01-03), Vivid+Co (01-03) | Sequential not grid |
| Product UI embedded | Linear, DefiLlama | "Show the thing" |
| Asset portraits grid | Vivid+Co team photos | Editorial card pattern |
| Yellow testimonial card | Linear | Hi-contrast quote anchor |
| Saturated CTA strip | Pyth, Base, Jito | Final push before footer |
| Wordmark footer | Eclipse, Jito | Brand assertion |
| State colors saturated | Coinbase, Uniswap, Helius | Quant audience demands signal |
