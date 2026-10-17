# Landing uplift — running research notes
**Started:** 2026-05-27
**Mandate:** Visit each reference site DEEPLY (full pages, multi-screenshot, navigate into interior pages where applicable). No "skim + screenshot home". Self-question before delivering. The two failed mocks from 2026-05-27 morning are the bar to clear — they failed for being "generic / AI". This time: pattern, source, why it works, why it fits Pegana.

## Constraints / what's locked
- Hero (`hero-landing.tsx`) — untouched
- `[ pegana ]` brand mark — untouched
- Site footer — untouched (just got navlinks cleaned)
- Brand: pure black canvas, off-white text, sunset coral/magenta brackets, iridescent gradient as ammunition (`#feed7a → #ff8400 → #df91f7`), Geist + JetBrains Mono. Max ONE iridescent moment per viewport.
- 5 channels (REST/WS/MCP/Webhook/Telegram) ARE the product
- User explicitly rejects: KPI strip with huge numbers + tiny labels, "Problem → Solution → Pricing" generic SaaS arc, emoji icons, MacBook mockups, carousel testimonials, fake logo grids, gradient blobs, glassmorphism, neon glow.

## Open questions I need answers to via research
1. **How do top-tier oracle/infra sites lay out their landing?** (frames.ag is the user's explicit ref — what else?)
2. **What's the nav idiom that "Channels IS product" enables?** Single-link nav? No-nav with floating chip? Persistent rail?
3. **How do crypto/agent infra brands use motion?** Scroll-driven? Hover-reveal? Live data? Decorative-only?
4. **What replaces UniverseGrid and LogoMarquee in the section sequence?** (interactive demo? Bloomberg-strip? "Setup in 1 minute"?)
5. **What's the typography rhythm for editorial-but-technical** (Bloomberg crossed with Linear)?
6. **Where does PEGANA wordmark above footer fit modern conventions?** Brutalist? Cinematic? Editorial?

## Methodology
Per site:
- Capture: home full-page, mid-fold, footer, any signature interior page
- Note: layout grid, type hierarchy, motion behavior, color discipline, what makes it NOT generic
- Pattern extract: 1-3 specific moves I'd steal
- Fitness check: does this fit Pegana's brand DNA? Why or why not?

---

# Research log

## frames.ag (the user's explicit reference) — DEEP

**Theme:** light, near-white background, black ink, mint/teal eyebrow pills, blue/purple/green category tags.
**Type:** serif (large headlines), mono caps (nav + labels), sans body. Distinctive use of **bold tail** on body copy — last phrase of each paragraph bold.
**Brand mark:** black-square seal with serif "F" + bottom-of-page **gothic blackletter "Frames"** + closer page has **3D-extruded pixel "F" monogram** as signature object.

### Structure (in order)
1. **Top utility bar** — slim grey strip with centered "AGENT-FRIENDLY INFORMATION" + barcode-y icon + theme toggle on right. Persistent.
2. **Header** — left brand seal + 4 nav items (DATASETS / AGENTWALLET / TOOLS / ACTIVITY) all-caps mono SINGLE-LINK, no dropdowns + right "GET WALLET" CTA.
3. **Hero** — pill eyebrow ("ALL NEW WALLETS FUNDED WITH FREE CASH") → giant serif headline ("Outperform regular agents.") → 2-line sub with bold tail ("Simply paste in any client:") → **tabbed paste box** (IF YOU'RE NEW HERE / USE TOOLS / CHECK BALANCE) with COPY button → **live ticker band fixed at viewport bottom** (TXS / VOLUME on left, latest activity event on right, color-flashing on status).
4. **Credibility line** — "BACKED BY [Colosseum]" — small, centered, single line.
5. **Tools section** — section h2 left + "VIEW ALL TOOLS" CTA right + sub copy → 2-col grid of "tool cards" (provider logo + namespace/slug + category-color pill + PRICE/MAX RES/MAX DUR/CAPABILITIES rows + grey desc box with example data + full-width black "RUN" button).
6. **Constellation / "Explore datasets" scatterplot** — viewport-filling abstract dot-and-square map (data points / world / activity?) with single centered pill CTA "EXPLORE DATASETS" with green blink-dots flanking.
7. **Datasets section** — same card-grid pattern as Tools, with mini description boxes.
8. **Setup in one minute** — left col label "Setup in one minute" + right col tabs (prompt/pnpm/npm/bun) and black code paste box with copy button.
9. **Works with all clients** — left col label + right col row of 5 client SVG icons (OPENCLAW / CLAUDE CODE / OPENCODE / CURSOR / OPENAI CODEX) with mono labels.
10. **"Why us" sticky scroll** — left col **sticky** brand mark + tagline + LEARN MORE → right col scrolls through 4-6 features. Each feature: bold h2 + 1-sentence body with bold tail.
11. **Closer** — repeats the hero pattern: massive 3-line serif headline ("Maximizing Agent Potential") + signature 3D monogram on right + SAME tabbed paste box + COPY. Hero and closer use identical setup widget.
12. **Footer** — single-line strip at viewport bottom: tagline mono left + theme toggle + 3 social icons right. Hairline only. No columns.

### Specific moves to steal for Pegana
- **Top utility bar (slim)** for the "FOR AI AGENTS · FOR HUMANS" duality — anchors agent positioning before nav. Persistent.
- **Tabbed paste box as hero CTA** — for Pegana: tabs are `curl` / `WebSocket` / `MCP config` / `Telegram` / `Webhook`. Box shows the actual one-liner. COPY button. This is exactly what slot 1 should be.
- **Editorial 2-col with sticky-left brand** — fits Pegana's "Why us" / "Methodology" section. Bold-tail copy idiom.
- **Closer mirrors hero** — Pegana could repeat the channel selector + CTA at the bottom right before Wordmark.
- **Tool/dataset cards with mini description box (greyscale terminal feel)** — Pegana's ChannelCards already do this in spirit. The mini-desc box with concrete example data is a missing detail we should add.
- **Live ticker band fixed at bottom of hero** — Pegana already has `OracleTicker` — keep it. Frames validates this is a strong move.

### What NOT to copy
- Light theme — Pegana is dark.
- Gothic/medieval blackletter brand — Pegana is sharp/geometric, opposite vibe.
- 3D pixel monogram — would clash with `[ pegana ]` minimalism.
- The constellation scatterplot — pretty but abstract, doesn't fit Pegana's "concrete numbers" stance. We could do something analogous with the live state map of 23 assets.

### Self-question
- *Would copying the tabbed paste box make slot 1 generic?* No — the content is unique to Pegana (5 actual channels with real one-liner code). Frames-style component, Pegana-specific payload.
- *Is the "closer mirrors hero" move too on-the-nose to steal?* It's an industry pattern (Vercel, Linear do it too). The mirroring itself is fine; what makes it not-generic is the asymmetry — different headline copy, same widget.
- *Does the utility bar at the top fight our hero spotlight?* Risk: it splits attention before the hero loads. Mitigation: make it BARELY visible until scroll passes the hero, then anchor it. OR drop the idea and use the live ticker band as the only persistent strip.

## curated.design — 4 picked refs

### Mistral AI (mistral.ai) — AI infra peer
- Cream/peach palette, mountain photo bg in hero, "Frontier AI. In your hands." 2-line stacked sans display, real enterprise logos in strip (ASML/HSBC/Cisco/SAP).
- Fold 2: classic 2-col scroll. Right side feature list uses "→" red arrow before each item instead of bullets — small ammo for Pegana methodology rows.
- **Take:** the "X. In your Y." headline rhythm is template. Pegana already has "The peg-risk / oracle for Solana." which is better — keep ours.

### New Layer Capital (nlc.obys.agency) — Obys agency
- **Brutalist frame border** in red/orange around the entire viewport with corner letters N/L/C as page-structure annotations.
- Hot pink full-bleed solid color background.
- Massive sans wordmark headline with **underlines under each line** ("New Layer Capital" — line, line). Wordmark-as-headline.
- Bottom band: 3-column ground anchor = small label / centered statement / right CTA.
- **Take:** the **brutalist frame with corner letters** as page structure markers is genuinely usable. Pegana could do this with section numbers `(01)..(05)` running down the left margin and capability-tag letters at corners. The pink palette doesn't apply.

### Defined VC (definedvc.com)
- Dark theme. Hero = dramatic oil-paint chemical imagery, but on scroll a **dot-screen / halftone overlay reveals itself** — the image is half photo, half dot-grid forming the image. Data-vis treatment of pure imagery.
- Bottom-right overlay text + single ghost CTA.
- **Take:** the **dot/halftone overlay on imagery** is gold for Pegana. Apply it to a real chart (e.g., 23-asset state grid heatmap) so the section reads as both data and pattern. Reinforces "this is the real product talking" without being decorative.

### Rig AI (rig.ai) — local-first agent
- Bold coral-orange solid hero, black ink, sans headline "On-device AI coding. No cloud. No limits." (declarative 3-clause statement).
- Just below hero: **black band with 5-column mono labels** acting as positioning pillars — "NATIVE INTERFACE / SAME UI/SX / YOUR HARDWARE, YOUR RULES / NO TRACKING. NO LIMITS / SPECIALIZED OUT". Functional, not decorative.
- Section below in pure black: "You don't own your AI. And you're being watched." — editorial statement, full bleed.
- **Take:** the **5-column mono pillar strip** under the hero is great for Pegana. We could make it: `OPEN SOURCE  ·  MIT LICENSE  ·  NO KEY  ·  ED25519 SIGNED  ·  SOLANA MAINNET` (or similar). Functional positioning, not "trust badges". Continuous, no padding around items.

### Consensys (consensys.io) — web3 enterprise
- Dark theme. Sans headline with **gradient color fill only on the keyword phrase** ("Decentralized Finance" in green→yellow). Same move Pegana already uses on "oracle for Solana" — validates the discipline.
- 3D pyramidal/prism objects in foreground with magenta/cyan accent lighting.
- **Take:** validates Pegana's gradient discipline. The 3D prism objects are decorative bloat — skip.

## landing.love — 3 picked refs

### Tempo (tempo.xyz) — blockchain for payments
- White, minimal. Serif "The blockchain for payments at scale" + 4-line body + double CTA. Right side: **hand-drawn 3D wireframe sphere** as signature object.
- Fold 2: same pattern. **Every section has ONE signature sketched 3D object** (sphere, then spiral, then etc). Consistent visual language across sections.
- **Take:** the "every section has its OWN signature visual" discipline is interesting but Pegana already does this with the iridescent + dot grid + spotlight. We don't need new objects — we need to use ours consistently.

### Measured Analytics (measured.site) — analytics tool
- **Massive WORDMARK as the hero.** "Measured" edge-to-edge in monumental black sans, bleeds beyond viewport edges. No tagline above. CONFIDENCE move.
- **Flat single-link nav** with even spacing: Measured / Analytics / Leaderboard / Pricing + black "Join" CTA.
- **Top-left**: cropped 3D photo of a blue tape measure bleeding INTO the page corner. Literal brand object as decoration.
- **Bottom half**: hot blue gradient with **dot-grid forming a world map**. Halftone treatment of geographic data.
- Fold 2: empty space, blue gradient continues, tape measure object continues bleeding. Not afraid of negative space.
- **Take (HUGE):**
  - Confirms Pegana's V2 `Wordmark` "PEGANA" edge-to-edge above footer is exactly the right move. Bring it back.
  - **Dot-grid forming structured data** (here = world map) is now confirmed twice. Pegana should apply this to a **23-asset state grid**: tiny dot for each asset, colored by current peg state, arranged as a grid that reads as "the universe at a glance" — replaces UniverseGrid which was an obvious card grid. Halftone-style.
  - **Flat single-link nav** with even spacing is the modern convention. The user is right to reject dropdowns.

### Incredibles.dev — dev studio
- **Dark canvas with subtle noise/grain texture** + center **iridescent prism** (green/yellow/orange/pink — almost identical to Pegana's iridescent stops).
- Tiny mono caps nav: "ABOUT / AWARDS" left, central "/" divider, "HIRE US / LONDON" right.
- **Edge-to-edge "INCREDIBLES" wordmark** at hero bottom with mono labels beneath as caption (project list, location, etc.).
- Tiny showreel **thumbnail card** floating bottom-left — could be Pegana's recent-event card.
- **Take:**
  - Pegana's iridescent gradient is on-brand for the genre — validated.
  - The **"/" character as nav divider** instead of pipes or dots is a sharper, more typographic move. Use it.
  - Wordmark closer with mono caption underneath = Pegana's Wordmark + WordmarkTail.

## navbar.gallery — observation
Quick survey. The flat-single-link pattern (no dropdown) is the most modern convention right now. Pattern variants seen:
- All-caps mono (frames.ag, Incredibles)
- Title case sans, evenly spaced (Measured)
- With "/" or "·" character dividers (Incredibles)
- Centered (Measured) vs. left-anchored (frames.ag)
The dropdown era is fading — it remains for SaaS with deep IA (Vercel, Stripe). For Pegana, dropdowns add friction without paying rent.

## cta.gallery — observation
Survey confirms the universal closer pattern: typography-first headline + minimal CTA(s). Pegana's PingedCTA already follows this. The improvement isn't structural; it's the **mirroring** (closer reuses hero widget — frames.ag) and the **wordmark crowning** (Measured/Incredibles).

## refero (crypto query) — observation
Top results cluster on **dark, terminal, command-center** aesthetics. Tags refero applies to crypto sites read like Pegana's brand brief:
- Coinbase: "Digital Trust, Blueprinted"
- Eclipse: "Cosmic Rave Command Center: stark"
- BitcoinOS: "Dark Command Center"
- zkPass: "Digital-noir command center"
- Rarible: "Dark Terminal, Electric Green"
- NEAR: "Midnight command center"
- OpenSea: "Midnight data console"

These are the descriptors Pegana should earn. Validates the brand direction. Eclipse specifically uses **stacked massive sans words** as a headline ("SOLANA / ETHEREUM / ETHEREUM'S FIRST SVM L2") — same family as Pegana's hero.

## appmotion.design — dead
404 on Framer. Skipping. Motion patterns covered indirectly via frames.ag scroll-driven moves + Pegana's existing GSAP+framer hybrid.

## hugeicons — observation
Only relevant if we add new sections that need new iconography. Pegana currently uses 4 SVGs (arrow-right, chevron, copy, theme toggle) + character glyphs (`{}` `<>` `[]` `↗` `@`). The proposal below does NOT introduce icons we don't already have. So defer hugeicons import.

---

# SYNTHESIS

## The direction (ONE — no alternatives)

**Bloomberg ⇄ Bracket. Terminal-editorial.**

Pegana is a Bloomberg terminal that reads like Monocle magazine. Every section earns its space because either **the data is alive** (live ticker, state pip, spread number ticking) or **the typography refuses to fade** (massive serif/sans, mono caps eyebrow, bold-tail body). Decorative gradient blobs, glassmorphism, neon glow, MacBook mockups, carousel testimonials, fake logo grids — banned. Negative space, hairlines, sharp punctuation — promoted.

This isn't a new direction. It's **the direction Pegana was already 80% of the way to**, with three failed mocks and a fresh research pass making the remaining 20% concrete.

The references that hold the bag:
- **frames.ag** — the architectural reference. Hero pattern (eyebrow → headline → bold-tail sub → tabbed input → live ticker at viewport bottom), 2-col sticky-left "why" section, closer that mirrors hero. Adopt structurally.
- **Measured** — the wordmark reference. Edge-to-edge "PEGANA" above footer is the closer move. Dot-grid forming structured data is the visual idiom for "we have a universe of 23 assets". Adopt.
- **Incredibles.dev** — the iridescent + dark-canvas reference. Pegana's existing gradient is on-genre. Adopt the "/" character as nav divider.
- **Rig AI** — the pillar-strip reference. 5-column mono labels under the hero as positioning statements (open source · MIT · no key · ed25519 · Solana mainnet). Adopt as new slot fill.
- **Defined VC / Measured** — halftone reference. Apply to a real chart (state grid heatmap) so the section reads as both data and texture. Adopt as new slot fill.

## New nav (flat, no dropdowns)

User constraint: no dropdowns. "Channels IS product." User wants something that conveys "what is this product" in the nav.

The cleanest resolution is to expose **destinations**, not features:

```
[ pegana ]    Product    Dashboard    Docs    About            [ Open Dashboard → ]
```

- **Product** = `/#channels` (smooth-scroll to ChannelCards on landing). Clicking takes you to the 5-channel showcase, which IS the product.
- **Dashboard** = `/dashboard` (the live state app).
- **Docs** = `https://pegana.xyz/docs` (no ↗, opens in new tab silently). *(Was `docs.pegana.xyz`; that subdomain is dead — docs are served at `pegana.xyz/docs` via a Vercel rewrite to Mintlify.)*
- **About** = `/about`.
- CTA = "Open Dashboard →" (action verb, primary path).

4 nav items + 1 CTA. No dropdowns. Mono caps, even spacing, "/" divider between items optional (Incredibles).

**On `/dashboard` page** the nav swaps: Product → "Landing" or hides "Dashboard" since you're already there.

(If you prefer to *not* duplicate Dashboard in nav + CTA, drop Dashboard from nav and keep just `[ pegana ]   Product   Docs   About   [ Open Dashboard → ]` — 3 items. Minimal like Measured. My recommendation.)

## New landing section sequence

```
01. HeroCanvas + HeroLanding              LOCKED — your "impecável"
                                          + add tiny utility bar above? optional, skip first iter
                                          + add live ticker BAND fixed at hero viewport bottom
                                            (frames.ag move — pegana already has OracleTicker; move it here)

02. PILLAR STRIP                          NEW slot — replaces LogoMarquee
    5-column mono labels:
    OPEN SOURCE  /  MIT  /  NO KEY  /  ED25519 SIGNED  /  SOLANA MAINNET
    No background, just a hairline above and below. Continuous, even spacing.
    Reference: Rig AI black band.

03. ChannelCards (Product section)        keep — terminal-grid already strong
                                          + add mini-description box per card
                                            with concrete example payload
                                            (frames.ag tool-card pattern)
                                          + nav "Product" link anchors here (id="channels")

04. SETUP IN ONE MINUTE                   NEW slot — replaces UniverseGrid
    Tabbed paste-box widget:
    [ curl ] [ TypeScript ] [ Python ] [ MCP config ] [ Telegram ]
    Active tab shows the actual one-liner.
    Black box, copy button on right.
    Above: editorial section label "(02) · Read it in one minute"
    Reference: frames.ag setup widget. THE explicit user reference.

05. HowItComputes                         keep — formula + sources + state ladder
                                          + numbered "(03)" prefix in left gutter

06. UseCasesStrip                         keep — 3 cards with L-corner state accents
                                          + numbered "(04)"

07. STATE UNIVERSE (halftone)             NEW slot — replaces removed UniverseGrid live-dump
    23 dots arranged as a halftone grid, each dot colored by current peg state.
    NOT card grid. Pure dots forming a "universe at a glance" panel.
    Hover a dot → small floating chip shows ticker symbol + state + spread bps.
    Reference: Measured world map + Defined VC oil overlay.
    Editorial label: "(05) · The universe, at a glance"

08. LiveThisWeek (back from V2)           bring back — 3 most recent transitions with sparklines
                                          + numbered "(06) · Live this week"
                                          + tighten visual treatment per V2 polish

09. PingedCTA                             keep — Telegram bubble + 2 CTAs
                                          + numbered "(07)"
                                          + the second CTA "Open Dashboard" stays

10. CLOSER MIRROR                         NEW — repeat the setup-tabs widget here
    Same component as section 04, but with different eyebrow:
    "(08) · One paste away."
    Tabs + paste box + COPY. Frames.ag pattern.

11. Wordmark (back from V2)               bring back — giant PEGANA edge-to-edge
                                          + WordmarkTail with mini live counters
                                          + parallax scroll-driven (GSAP already exists)
                                          Reference: Measured + Incredibles

12. SiteFooter                            LOCKED — already cleaned today
```

Total: 12 sections. 4 new (pillar strip, setup, halftone universe, closer mirror) + 2 brought back (LiveThisWeek, Wordmark) + 6 kept.

## Per-page punch list

**`/about`** (existing 87 lines)
- Keep the "operator" angle, that's strong.
- Add **left-rail timeline** — 5 dates from project history (first commit, first depeg captured, first paid x402 call, first mainnet integration, current).
- Add a single signature visual — could be a **dot-grid mini-map** of Solana with a small dot marking São Paulo (where you are).
- Drop the broken `/oracle` internal link (it redirects).
- Increase the "Reach out" chips into a small **contact terminal block** — mono framed, 4 lines, no chips.

**`/changelog`** (existing 82 lines)
- Update `RELEASES` array — currently stops at 2026-05-26, missing v2 launch + x402 + webhook sprint.
- Add a **filter tab strip** — "All / features / fixes / internal" at top. The data is already there with `tag` field.
- Add a tiny "RSS / Atom feed" link in mono caps under the tabs (developers care).

**`/embed`** — utility page, keep as-is. Maybe wrap it with a tighter intro paragraph.

**`/privacy` + `/terms`** — legal, no design work needed.

**Routes to DELETE from `app/(marketing)/`** (zombie files, rules redirect):
`/oracle`, `/concepts`, `/developers`, `/learn`, `/methodology`. Reduces grep noise, no SEO risk (redirects in `next.config.ts` survive).

## Self-question / what could go wrong

1. **"5 columns of pillars might look like a logo strip — same generic move."**
   Different: it's text, all-caps mono, no logos, no whitespace gutters. Single line. Reads more like a sub-header than a "TRUSTED BY" gradient.

2. **"Halftone universe could feel decorative if it's pure dots."**
   Mitigation: each dot reacts to live state (color shifts on real transitions), and hover reveals concrete data. The dot grid is the entry point; the data is the substance.

3. **"Tabbed paste widget is what frames.ag does — won't user see it as copy?"**
   User explicitly cited frames.ag as a reference. Copying the *pattern* with Pegana's *payload* is what was asked. The differentiator is `pegana://state/jitoSOL` (or whatever) vs. `frames.ag/skill.md` — concrete unique strings.

4. **"Closer mirroring hero might feel padded."**
   Risk acknowledged. If it does, drop the closer mirror and keep the Wordmark as the only closer. Test in build.

5. **"PEGANA wordmark is back — same as V2. What's different?"**
   Same intent, tighter execution: the WordmarkTail now reads live counters from the API instead of static text, and the parallax tween uses lighter ease (frames.ag scroll feel).

6. **"4 nav items + CTA — is Product link useful or just a redundant scroll?"**
   Useful for two reasons: (a) returning users who want to jump to the channels section without scrolling, (b) signals nav-as-IA-of-the-site (not nav-as-table-of-contents). If user disagrees, drop it; reduces to 3 + CTA which is the Measured minimum.







