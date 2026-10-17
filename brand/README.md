# Pegana — Brand Asset Package

**Direction:** Pegana Wave Signal · **Symbol:** gradient wave, traced 1:1 from `imageforcopy.png` · **Status:** generated & browser-validated, **not yet wired into the product** (2026-06-30)

A **signal wave** = real-time peg-risk state changes: dominant pointed center peak, deep side valleys, thick rounded ends — a solid **filled** form, not a thin line. The silhouette was **vectorized (potrace) directly from the approved `imageforcopy.png`** and overlay-verified 1:1 against the source, so it's a faithful copy, not an approximation. Warm-on-black is the differentiator vs. the all-blue/teal competitor field (`../docs/design-research/2026-06-30-brand-audit/`). Rendered in a real browser across every context before export.

> Banners were intentionally dropped (founder feedback: too templated / AI-looking).

## Files
```
brand/
  pegana-brand-board.png             # FULL brand board — 1600px (final assets: traced wave + gradient A)
  pegana-brand-board@2x.png          #   ↳ 3200px, for print / deck
  pegana-guidelines.png              # guidelines page — clear-space · do/don'ts · mockups (1650px)
  pegana-guidelines@2x.png           #   ↳ 3320px, for print / deck
  TypeLogo.png                       # earlier reference board (superseded)
  imageforcopy.png                   # approved app-icon the wave was traced from
  logo/                              # vector sources
    pegana-symbol-gradient.svg       # PRIMARY symbol (gradient wave)
    pegana-symbol-coral.svg          # flat coral fallback (#ff8a5b)
    pegana-symbol-white.svg          # white wave (reversed / mono)
    pegana-lockup-dark.svg           # gradient wave + "pegana" (Geist 600) on black
    pegana-app-icon.svg              # rounded squircle (rx 22%) + gradient wave  → favicons 64–512
    pegana-icon-fullbleed.svg        # full-square black + wave (OS masks)        → apple-touch / android
    pegana-icon-maskable.svg         # full-square, wave in central safe zone     → maskable
    favicon.svg                      # wave on rounded square for tiny sizes      → favicon 16/32/48
  animated/
    pegana-wave-chroma.svg           # Razer-Chroma: warm spectrum flows along the wave (seamless loop)
  exports/
    symbol-gradient-1024.png         # 1024×428 transparent — marketing/symbol art
    symbol-white-1024.png            # 1024×428 transparent
    web-public/                      # ← DROP-IN replacement for web/public (exact filenames)
      favicon.svg  favicon.ico
      favicon-16x16 … favicon-512x512.png   (16/32/48/64/96/128/192/256/512)
      apple-touch-icon.png           (180)
      android-chrome-192x192.png  android-chrome-512x512.png
      icon-maskable-512x512.png      (safe-zone padded)
```

## The wave (single source)
A **filled** vector traced from `imageforcopy.png`, viewBox `0 0 1022 486` (the exact wave bbox). The `d` is embedded in every logo SVG — edit there, or re-trace from the source PNG. Intentionally faithful to the reference, including its natural slight asymmetry.

**Gradient A (approved)** — objectBoundingBox, horizontal:
`#ff8a5b` 0% · `#ff8400` 22% · `#fb6fae` 48% · `#e878d8` 74% · `#df91f7` 100%
(orange reduced to a thin band so the mark reads coral → pink → magenta → lavender, not "too orange").

## Animated wave — chroma flow (Razer-style)
`pegana-wave-chroma.svg` — the wave shape stays fixed while the **warm spectrum (coral → orange → pink → magenta → lavender) flows continuously along the filled wave**, with a soft RGB-style underglow. Built with a repeating `userSpaceOnUse` gradient + `animateTransform translate` over exactly one period → a **seamless 3s loop** (no snap). Self-contained SMIL: animates as `<img src=…>`, inline, or CSS background — no JS.
- Tune speed via the `dur` on `<animateTransform>`; density via the gradient `x2` (period); glow via the `feGaussianBlur stdDeviation`.
- For calmer product surfaces, lower the glow opacity / slow `dur` to ~6s.
- Respect `prefers-reduced-motion` when embedding (gate with a static fallback — e.g. `pegana-symbol-gradient.svg`).

## Usage
- **Primary = gradient symbol** (founder decision 2026-06-30 — gradient is allowed *on the mark*).
- White wave on dark when gradient can't render; coral flat for one-color; black wave on light.
- Background pure black `#000000`. Wordmark Geist Semibold, lowercase, tracking `-0.04em`.
- Hierarchy: symbol-only → favicon/app-icon/integrations · lockup → navbar/headers · animated → hero/loaders.
- Don't: scanlines/terminal/CRT/ASCII/mono headlines · wave reading as heartbeat/stock-chart · blue/teal/purple as main accent · the old `[p]` / brackets as the main logo.

## Adopt into the product (when you give the go-ahead — no code touched yet)
1. Copy everything in `exports/web-public/` over `web/public/` (filenames already match the existing chain).
2. Update `web/components/atoms/brand-mark.tsx` to render the wave + wordmark (replace the `[ pegana ]` lockup). Outline the wordmark or keep Geist via the app font.
3. Refresh the OG image at `web/public/` (the old `og-v3.png` still shows brackets — needs a new one; banners were dropped here, so this is a separate task).
4. Update `brand.md` (still documents the bracket lockup as the locked identity).

## Open decisions
- **Wordmark face** — board uses a rounder geometric; assets use **Geist** (brand/product font). System-wide change, deferred.
- **Coral hue** — board renders punchier (~`#f3714c`) than canonical `#ff8a5b`. Kept canonical; switchable.
- **16px favicon** — the wave compresses to a warm mark at 16px (legible, detail lost — inherent to a wave).
