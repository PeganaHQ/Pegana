# Channel Cards — design-taste pass (2026-05-26)

Three visual directions for the new `ChannelCards` section that will sit between
the hero and the source table on the v2 landing page. The 5 channels:
REST · WebSocket · MCP · Webhook · Telegram.

Brand is **locked** (see `brand.md`). These directions vary on
**density, hierarchy, and motion treatment** only — never color or font.

## Direction summary

| Direction | Density | Hierarchy | Card chrome | Motion | Best for |
|---|---|---|---|---|---|
| **A · Ledger Row** | Compact | Flat (all 5 equal) | Hairline grid, no fill | Pip blink + arrow nudge | Trust + scannability; "5 entries in a manifest" |
| **B · Channel Stack** | Comfortable | Featured + 2 live + 2 preview | Per-card frame + endpoint chip | Featured iridescent rail + hover surface lift | Editorial / sales — "REST first, others follow" |
| **C · Spec Sheet** | Densest | Single recommended marker | None (true table rows) | Subtle gradient wash on hover | Continuity with `HowItComputes` Sources/Ladder lists |

## Recommendation: **Direction C — Spec Sheet**

This recommendation is locked-in for the v2 implementation in Task A4 unless
contradicted by Rafael.

**Why C beats A and B:**

1. **Visual continuity with the page it lives on.** The landing already has
   two list/table sections (`HowItComputes`'s Sources rows and the State
   ladder). Direction C uses the same grammar — hairline-divided rows with
   mono kickers, name + endpoint, right-aligned meta. Direction A invents
   a new "5 equal tiles" rhythm that the rest of the page doesn't repeat;
   Direction B invents a third (cards). C earns its place by reusing
   what's already there.
2. **Bloomberg-terminal archetype demands compactness.** A trading terminal
   shows you the data. Cards-with-padding push the channels into a
   marketing-feature-grid cliche (one of the strong AI-slop signals:
   "three-column feature grid with icon + heading + paragraph"). A table
   says "this is the spec, integrate it."
3. **The single iridescent left-mark on REST is exactly the brand's
   ammunition pattern** — one channel signals primary, the others read
   as peers. Direction B used the iridescent rail too, but C does it
   without dragging cards along.
4. **Endpoint column carries its own weight.** The 5 channels' identities
   live in their endpoints (`GET /v1/state/...`, `wss://...`, `mcp.pegana.xyz`,
   `POST {your-url}`, `@PeganaWatchBot`). A table puts those side-by-side
   for instant comparison. Cards force the reader to crawl five separate
   blocks.
5. **Status pill works harder in a table.** "Live | Preview" on a single
   axis reads like an inventory column. In a card grid it's a corner
   garnish.

**Concessions:**

- C is the riskiest mobile collapse — the table → stacked rows transition
  loses some hierarchy. Direction A is the cleanest 5-up grid → 3-up → 1-up
  collapse. The mockup ships a working mobile layout (`@media (max-width: 980px)`)
  that stacks each row's cells in `name+status / endpoint / desc / docs`
  order, but Task A4 will need to validate it against real device widths.
- Mono endpoint column needs care with `word-break: break-all` for the
  WSS URL — handled in the mockup, but verify in the React port.

**What to keep from A and B if C wins:**

- The **mono glyphs** (`{}`, `<>`, `[ ]`, `↗`, `@`) — used in all three.
  These are not generic SVG icons; they're typographic marks that match
  the brand's bracket logo language. Keep.
- The **pip blink** for "live" status (2.4s with `ease-default`) — used
  in all three. Subtle, brand-aligned, signals real-time without
  being a distraction.

## Anti-slop self-check

Ran the diagnostic checklist on Direction C:

**Strong signals — none triggered.**
- Not centered with symmetrical padding (asymmetric heading grid)
- No uniform border-radius (0px brand-locked everywhere)
- No identical padding (table rows breathe more than dense kicker bar)
- No card nesting (table rows have no card containers)
- Not a three-column feature grid (it's a 5-row table)
- One primary action (recommended REST has the iridescent mark)
- Not "every section is a card with the same shadow" (no shadows)
- Not "hero metric: big number + small label + gradient line" (it's a table)
- No glassmorphism
- No default shadcn gray (brand tokens)
- One accent only (sunset gradient, used once on REST)
- No default blue/violet gradient

**Weak signals — none triggered.**
- Geist + JetBrains Mono = deliberate pairing
- 2-weight hierarchy (400 + 600) per brand
- `ease-default` custom cubic-bezier
- Asymmetric pip-blink animation
- Copy is specific to Pegana ("the 30-second integration", "Sub-second
  peg-state stream — every drift, depeg, recovery")
- No gradient text on headings (one underline on the formula only,
  not on this section)

**Convergence test:** would a reviewer say "AI made this"? No — it reads
as a deliberately-restrained data spec sheet. The intentionality is
in the absence of decoration.

## Files

- `direction-a-ledger-row.html`
- `direction-b-channel-stack.html`
- `direction-c-spec-sheet.html` ← **recommended**

Open each in a browser side-by-side at ≥ 1280px width to compare.
A1 produces the visual direction; Task A4 will port Direction C to React.
