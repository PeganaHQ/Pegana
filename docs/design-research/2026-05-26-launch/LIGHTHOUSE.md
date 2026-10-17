# Lighthouse — v2 launch (2026-05-26)

Mobile form-factor, headless Chrome, against production
`https://www.pegana.xyz` after V2 deploy + Lighthouse a11y fixes
landed (commit `168c92f`).

Targets (from Plan 1 Task G1):
- Performance ≥ 85
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO ≥ 90

## Scores

| Route | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| `/` | **80** ❌ | 100 ✅ | 96 ✅ | 100 ✅ |
| `/developers` | 88 ✅ | 95 ✅ | 100 ✅ | 91 ✅ |

Raw JSON reports: `lh-home.json`, `lh-developers.json`.

## What landed (a11y closure)

`/` jumped from Accessibility 94 → **100**:

- **Mobile menu (`mobile-menu.tsx`)** — items, glossary button and CTA
  get `tabIndex={open ? 0 : -1}` so the closed drawer
  (`aria-hidden="true"`) no longer exposes tabbable descendants. Same
  C2 pattern, now also on the mobile drawer. Closes `aria-hidden-focus`.
- **Heading order** — `LiveTickerCard` was an `<h4>` jumping directly
  from the hero `<h1>`; demoted to a `<p>` since the symbol callout is
  a label not a section heading. `site-footer` column titles bumped
  from `<h5>` to `<h2>` (only headings in their region). Closes
  `heading-order`.

## Open item — performance on `/`

`/` lands at 80 vs target 85. Hot spots from the audit:

- **LCP 4.6s** (target < 2.5s). The hero is GSAP-driven with a large
  iridescent gradient overlay + animated word splits.
- **Unused JavaScript 91 KiB** + **legacy JS 14 KiB**. Bundle-split
  opportunity, likely the GSAP timeline and motion libs that ship on
  initial load.
- **Speed Index 4.4s** / **TTI 4.6s**.

These are bundle/render-strategy work, not 5-minute fixes. Recommended
follow-up sprint: dynamic-import the hero motion code, audit GSAP
plugin usage, preload the hero font subset, consider PPR (partial
prerendering) on the landing per the SPEC's Next.js 16.2 budget.

`/developers` passes all four targets — same hero pattern absent,
proves the perf gap is hero-motion driven.

## Screenshots

Desktop, 1440×900 viewport, devicePixelRatio 2, reduced-motion
forced. Captured via `web/scripts/capture-launch-screenshots.mjs`
against production.

- `01-home.png`
- `02-oracle.png`
- `03-methodology.png`
- `04-concepts.png`
- `05-developers.png`
- `05a-developers-mcp-anchor.png` (sticky TOC + MCP GetStartedCard)
- `06-dashboard.png`
