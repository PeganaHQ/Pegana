# Design Audit — Scout Notes (2026-06-01)

Captured by main thread via Playwright before the analysis workflow. Screenshots in
`screenshots/pegana/` (live prod) and `screenshots/refs/` (reference sites). Token
extractions in `extracted/*.json`.

## Pegana pages (live prod, captured)
- **landing** (`pegana-01-landing.png`) — BASELINE the owner likes. Dark, editorial, iridescent
  "oracle" accent, REST/WS/MCP/Telegram source rows, `spread = 1 - market/intrinsic` formula,
  giant `PEGANA` chrome wordmark, footer. This is the bar.
- **methodology** (`pegana-02`) — long + dense. Hero "Deterministic. Versioned. Replayable."
  then verify code block, version lifecycle, a VERY long monospace **Assets canon** table,
  a changelog diff block, retraction protocol, "What this is NOT". Density + mono-table risk.
- **agents** (`pegana-03`) — almost the WHOLE page is stacked dark **code blocks** (MCP verify_alert,
  subscribe_peg_events, REST GET). Reads as dev-docs / terminal at the page level → brand risk.
- **audit** (`pegana-04`) — body is EMPTY during calibration (verdict gate ~Jun 11). Just a hero +
  calibration notice + blank. Needs a real calibration/empty-state design.
- **changelog** (`pegana-05`) — "Commit feed. Last 1 from main." shows ONLY 1 stale commit (May 21);
  releases list is hardcoded. Owner wants it DYNAMIC.
- **about** (`pegana-06`) — prose "A peg watchdog you can read." + commit-feed card + contact pills. Plain.
- **pricing** — `/pricing` is DISABLED in prod (307 → `/`, see web/next.config.ts:39). Source kept
  at `web/app/(marketing)/pricing/page.tsx`. Owner wants a "respectable" pricing page. KEY deliverable.

## Reference sites (captured)
- **thiings.co** — infinite grid of premium 3D-rendered objects, light canvas, floating glass card.
  Lesson: playful-premium object craft + floating card (register is lighter than ours).
- **endlesstools.io** — dark canvas, thumbnail strip, centered editorial headline, floating product
  window mockup over soft bokeh glow. Strong "show the product floating on dark + glow" pattern.
- **uncut.wtf** — editorial type/design resource.
- **shadergpt.14islands.com** — full-bleed LIVING GLSL shader gradient bg (pink/green/blue flow) +
  left editorial nav + floating glass code panel. Directly relevant to our iridescent ammunition.
- **coolshap.es** — dark canvas, grid of GRAINY iridescent gradient shapes. Grainy-gradient texture
  technique maps straight onto our gradient.
- **60fps.design** — motion/UI animation inspiration gallery.
- **linear.app/pricing** — gold-standard structure: 4 tier cards → trusted-by → long categorized
  feature matrix → "Built for the future" CTA close. Dark, minimal.
- **vercel.com/pricing** — bold centered headline, dotted-grid bg with corner `+` marks, 3 tiers w/
  "Popular" tab on middle, icon+label feature rows.
- **helius.dev/pricing** — DIRECT Solana-infra peer. Dark + single accent (orange) on recommended
  tier, comparison stat cards, feature matrix, "X vs other providers", FAQ, trusted-by, CTA close.
  This is the template for OUR market.

## Hard constraint (brand.md) — overrides skill defaults
NO terminal/CLI/CRT. Two typefaces only: Geist (sans, default) + JetBrains Mono (numbers/labels/code).
NO serif, NO italics. Pure-black #000 canvas. Sharp 0px cards, pill CTAs. Iridescent gradient
(#feed7a→#ff8400→#df91f7) = single signature ammunition, never decoration.
