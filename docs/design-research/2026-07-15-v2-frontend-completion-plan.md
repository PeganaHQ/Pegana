# V2 frontend completion plan — "100% friendly", personas together (2026-07-15)

> Branch `landing/v2-port` (preview only — NEVER main). This is the shared
> source of truth so the landing + app personas move together on ONE design
> system. Every phase: tsc clean + vitest green + Playwright-verified on the
> preview, committed by explicit path, merged into `landing/v2-port`.

## Design-system invariants (hold across EVERY change)
- **Brand:** pure-black canvas, coral→magenta→lavender gradient accent, Switzer
  display + Geist Mono for numbers/captions, subtle glass/aurora, generous
  whitespace. Editorial premium SaaS — NOT terminal/CLI/Bloomberg.
- **Units:** every user-facing spread/discount/drift is a **percentage**, never
  bps. The literal API field name `spread_bps` stays ONLY in JSON/payload code
  samples (it's the real contract).
- **Sign (holder convention), EVERYWHERE:** `+` = premium (market ABOVE
  intrinsic/NAV), `−` = discount (below). The API's `discount`/`reconcileBps`
  is signed intrinsic−market (premium negative) — negate for display. Already
  done in `merge.ts` (/lst) + `shared.tsx` `toBoardRow` (hero board).
- **Direction-sensitivity (ADR-0021 carve-out):** for LST + stable_yield, a
  PREMIUM is benign — it must NOT drive band-proximity / "depegged" visuals.
  Only the discount side counts toward the depeg band. A healthy LST at a +1%
  premium must read as calm, never "100% / off-scale / depegged".
- **Tables:** real semantic `<table>` (see `web/AGENTS.md`). Two idioms only.
- **Friendly:** short copy, one idea at a time, no jargon (no `state_reason`,
  `ADR`, `bps`, `CR` in user-facing text). "Nem tudo precisa" — cut, don't add.

## collectui.com references (chosen patterns to adapt)
- **Onboarding:** dimmed real-product backdrop (dim the actual dashboard behind
  the walkthrough) + one feature-callout card per step + segmented progress.
- **Hero:** "prismatic" — a light beam fanning into a coral→lavender gradient as
  the hero visual, replacing the paragraph. One bold line + one visual.
- **Tables:** row = logo+ticker+mini-sparkline+signed delta; hover-popover for
  depth; icon+color status pills.
- **Empty states:** product-realistic preview (dimmed real card + dashed
  highlight), not abstract art.
- **Avoid:** mascots, "AI/anatomy" motifs, gamification, terminal aesthetic,
  loud color-block heroes.

## The 6 items (sequenced into waves to avoid file conflicts)

**Wave 1 (in flight):**
1. **Onboarding + modal redo** — `onboarding-modal.tsx` (+ shared modal). Dimmed
   real-product backdrop, one concept per step, warm copy, %-not-bps, mobile.
3. **Direction-sensitive + holder-sign + app-wide bps→%** — the correctness pass:
   `shared.tsx` (band-proximity + sample-row signs), dashboard "Closest to its
   band" card (stop showing a Pegged premium as "100%/depegged"), `band-gauge`,
   `threshold-picker`, `webhook-list`, `audit/[id]`, `asset-hero-v2`. Premium
   carve-out for LST/stable_yield. With tests.

**Wave 2 (after Wave 1 merges):**
2. **Landing hero visual** — `hero-v2.tsx` + `hero-reveal-canvas.tsx`: prismatic
   gradient beam; keep the shortened lede.
4. **/lst table richness** — `lst-directory-table-v2.tsx`: bring it toward the
   dashboard board's polish (sortable headers, mini-sparkline where data exists,
   icon+color pills), staying a real `<table>`.

**Wave 3 (last):**
6. **"100% friendly" trim** — audit + shorten the remaining big text blocks
   across landing + app; remove anything "nem tudo precisa". Final consistency
   sweep (every spread %, holder-signed; every table real; no jargon).

## Acceptance (each item)
tsc clean · vitest green · Playwright on the preview (desktop + mobile, console
clean, 0 horizontal page overflow) · committed by explicit path · merged into
`landing/v2-port` · docs/roadmap/memory updated. Founder-gated: merge→main +
engine deploy (NOT done here).
