# Landing redesign — handoff to fresh chat

**Date:** 2026-05-27
**Why this exists:** Previous chat session attempted a landing redesign without actually opening the reference sites in a browser. Built two HTML mocks (`landing-mock.html`, `landing-mock-v2.html`) from text-only WebFetch research + agent reports. **Result felt generic / AI-template.** User rejected both. Start over with a different method: actually SEE the references before building anything.

---

## What Pegana is (1 paragraph)

Peg-risk oracle for Solana. Watches 22 pegged assets (LSTs, fiat stables, yield-bearing, synthetics) in mainnet, compares market price to intrinsic value, publishes state transitions (PEGGED / DRIFT / DEPEG / CRITICAL) via 5 channels: REST, WebSocket, MCP (for AI agents), Webhook (Ed25519-signed), Telegram bot. Soft launch. Show HN target: **2026-06-10 (14 days from this handoff)**. Solo founder, MIT licensed, Brazilian, sells to agents as much as to humans.

---

## Locked decisions from this session (do NOT relitigate)

1. **Hero stays untouched.** `web/components/organisms/hero-landing.tsx` — "The peg-risk / oracle for Solana." with iridescent gradient on the second line, GSAP word-reveal, white-dust canvas behind. User called the hero "impecável."
2. **`[ pegana ]` brand mark stays untouched** in both header and footer.
3. **Site footer stays untouched.** `web/components/organisms/site-footer.tsx` — iridescent thread + drift glow + 4 columns + ops pip.
4. **Docs platform = Mintlify** (served at `pegana.xyz/docs` via a Vercel rewrite — the originally-planned `docs.pegana.xyz` subdomain is dead). Rejected GitBook (signals early-stage, no CSS injection). Mintlify is what Resend uses, supports OpenAPI auto-render, JetBrains Mono via custom font upload, dark theme.
5. **`/examples` stays on the marketing site** (Next.js, not GitBook). Terminal-density list, NOT screenshot card gallery.
6. **`UniverseGrid` removed from landing** (was the live product feed bleeding into marketing). `LogoMarquee` removed (we have no real logos).
7. **Sections to reformulate:** everything between hero and footer.
8. **Numbered section anchors `(01)` `(02)` ... in mono** in the left gutter — Linear pattern, already partially used.

---

## What went wrong with my mock attempts

- **Text-only research.** I used WebFetch + research agents to read frames.ag, curated.design, landing.love, etc. WebFetch returns markdown — I never SAW the actual visual treatments (spacing, typography weight subtleties, motion timing, micro-interactions, color rendering).
- **Playwright tool was hung** on a previous browser instance ("Browser is already in use") and I gave up instead of resolving. The fresh chat MUST resolve this.
- **Patterns I extracted were correct but assembled generically.** I added a Bloomberg-terminal ticker, an MCP-style setup card (frames.ag mirror), a split-pane request/response, a pricing strip — each move is individually valid but the composition felt like a template stitched from blog screenshots.

**Lesson for next chat:** open each reference site in playwright FIRST, take full-page screenshots, study them visually for 5-10 minutes, then propose. Do NOT build a mock until you have visual context.

---

## Design inspiration sites — visit ALL in playwright

The user has shared this list twice and is frustrated I didn't actually look at them:

| Category | URL |
|---|---|
| Web Design | http://curated.design |
| Landing Pages | http://landing.love |
| Saas Websites | http://saaspo.com |
| Navbar | http://navbar.gallery |
| CTA Sections | http://cta.gallery |
| Animation | http://appmotion.design |
| Mobile Apps | http://mobbin.com/?via=abraham |
| Brands | http://rebrand.gallery |
| Icons | http://hugeicons.com/?via=Abraham |
| Design Systems | http://component.gallery |
| Styles (filterable) | https://styles.refero.design/ (try `?q=clean+SaaS` and `?q=crypto`) |

**The explicit reference the user named:** https://frames.ag/ — specifically the "Setup in one minute" section (eyebrow "MAXIMIZING AGENT POTENTIAL", tabs `prompt · pnpm · npm · bun`, the `prompt` tab is the distinctive move, client logo rail below). User wants Pegana to have an equivalent MCP section.

---

## Brand DNA (already in memory — DO NOT redesign)

Read in memory:
- `project_brand_identity.md` — Threshold Brackets `[ pegana ]` locked, sunset coral/magenta, sharp/mono geometry
- `project_design_uplift.md` — locked direction A/Bloomberg Live, GSAP+framer hybrid, color tokens
- `project_frontend_arch.md` — Next 16, Tailwind v4, framer-motion, Recharts
- `feedback_design_pacing.md` — never parallelize multi-page redesigns
- `feedback_tailwind_v4_layer.md` — base reset MUST live in `@layer base`
- `project_nextjs_version.md` — read `node_modules/next/dist/docs/` before writing Next.js code (Next 16 has breaking changes from training data)

Tokens from `web/app/globals.css`:
```css
--color-canvas: #000000;
--color-text: #fffdf9;       /* off-white */
--color-text-body: #e8e8e8;  /* soft body */
--color-text-muted: #9aa9b8;
--color-text-caption: #7c7c7c;
--color-hairline: #1a1a1a;
--color-outline: #2a2a2a;
--color-st-pegged: #6bd697;
--color-st-drift: #c08a55;
--color-st-depeg: #a55a5a;
--color-st-critical: #b73838;
--gradient-iridescent: linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%);
--ease-default: cubic-bezier(0.22, 1, 0.36, 1);
```

Fonts via `next/font/google`: **Geist** (sans) + **JetBrains Mono**.

Iridescent gradient discipline: appears max ONCE per viewport. Approved usages today: hero "oracle for Solana" text fill (the brand moment), how-it-computes formula underline (1px), pinged CTA divider (1px), footer thread (1px). Never on body text. Never on multiple objects same viewport.

---

## Current sections that render today (`web/app/(marketing)/page.tsx`)

In order:
1. `HeroCanvas` (dust particles)
2. `HeroLanding` — **LOCKED**
3. `ChannelCards` — spec-sheet table with 5 rows ({}, <>, [], ↗, @ glyphs, endpoint, description, status, docs link). Already non-generic.
4. `UseCasesStrip` — 3 cards with L-corner state accents (DEPEG/DRIFT/PEGGED).
5. `LogoMarquee` — **REMOVE**
6. `HowItComputes` — formula `spread = 1 − market / intrinsic`, sources list, state ladder. Numbered (02). Already strong.
7. `UniverseGrid` — **REMOVE** (live product data bleeding into marketing)
8. `PingedCTA` — telegram bubble + 2 CTAs. Numbered (05).
9. `SiteFooter` — **LOCKED**

ChannelCards + HowItComputes + UseCasesStrip + PingedCTA are NOT generic — they're the same DNA the user calls "impecável". The redesign work is about **what fills the slots where UniverseGrid + LogoMarquee were**, not about gutting what already works.

---

## What the new chat should do, in order

1. **Visit all 11 inspiration sites in playwright with full-page screenshots.** Spend tokens here — the user is explicitly frustrated about this skip. URLs above.
2. **Visit frames.ag specifically** — capture the MCP/Setup section. Note exact spacing, font weights, hover states.
3. **Visit current pegana.xyz landing** (or read the components) so the existing aesthetic is the ground truth, not a target.
4. **Propose ONE direction, not three** — the user values commitment over options. Be specific: which patterns from which references make it into which slots.
5. **Build ONE small section at a time as a real Next.js component in `web/components/organisms/`** — NOT a giant standalone HTML mock. Iterate visually with the user via `web/` dev server.
6. **Use the existing `MarketingHeader`, atoms (BrandMark, IconArrowRight, StatePip), tokens.** Don't reinvent.

---

## What NOT to do

- Don't build another monolithic HTML mock file. Two failed already at:
  - `/Users/rafazaum/Desktop/Projetos/pegana/.superpowers/brainstorm/48379-1779889253/content/landing-mock.html`
  - `/Users/rafazaum/Desktop/Projetos/pegana/.superpowers/brainstorm/48379-1779889253/content/landing-mock-v2.html`
- Don't propose KPI strip with giant numbers + tiny labels.
- Don't propose "Problem → Solution → Pricing" narrative arc — generic SaaS.
- Don't add emoji icons anywhere. Use the existing glyphs (`{}` `<>` `[ ]` `↗` `@`) or Hugeicons Stroke Sharp.
- Don't propose gradient blobs, glassmorphism, neon glow, MacBook mockups, carousel testimonials, logo grids, iridescent type fills outside the existing approved uses.
- Don't relitigate the locked decisions above.
- Don't redesign the hero, the brand mark, or the footer.
- Don't write Next.js code without first reading `node_modules/next/dist/docs/` (Next 16 caveat in `web/AGENTS.md`).

---

## Tactical reference

- Brainstorm session dir (visual companion + mocks): `/Users/rafazaum/Desktop/Projetos/pegana/.superpowers/brainstorm/48379-1779889253/`
- Failed mocks: `content/landing-mock.html`, `content/landing-mock-v2.html` (kept for diff reference, do not extend)
- Companion server may have stopped (30-min idle timeout) — restart with: `/Users/rafazaum/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir /Users/rafazaum/Desktop/Projetos/pegana`
- Existing landing file: `web/app/(marketing)/page.tsx`
- Marketing header (with nav dropdowns): `web/components/organisms/marketing-header.tsx`
- All organisms: `web/components/organisms/`
- Design tokens: `web/app/globals.css`
- Fonts loaded at: `web/app/layout.tsx`
- Brand source of truth: `/Users/rafazaum/Desktop/Projetos/pegana/brand.md`

---

## Open tasks at handoff time

From the brainstorm task list:
- ✓ Validate route restructure (visual)
- ✓ Define Mintlify information architecture
- ⏳ Design landing page structure (in_progress, FAILED twice)
- ⏸ Define header nav + global UX
- ⏸ Lock Mintlify brand/theme tokens
- ⏸ Decide app surface location (app.pegana.xyz vs /dashboard)
- ⏸ Write design spec (target: `docs/superpowers/specs/2026-05-27-docs-and-landing-overhaul-design.md`)
- ⏸ User reviews spec, then writing-plans
- ✓ Decide docs platform: Mintlify
- ⏸ Design /examples — terminal-density, not card gallery
- ⏳ Reformulate ALL landing sections (in_progress, FAILED twice)

---

## Bottom line for the next chat

Open playwright. See the sites. Don't trust text descriptions of design — design is visual. Build one section at a time inside the real Next.js app. Show the user, iterate, commit small.
