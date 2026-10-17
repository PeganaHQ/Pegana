# pegana.xyz Redesign — Master Page Briefs

**Date:** 2026-06-01 · **Scope:** landing, methodology, agents, audit, changelog, pricing, about, shell (nav/footer/tokens)
**Authority:** `brand.md` overrides every generic/skill default. Every spec below is checked against it line-by-line.

---

## How to read this document

Each page brief carries: **Verdict** (keep / refine / rebuild), **Top problems** with severity, **What to keep**, a **Section-by-section redesign brief** (hero, ordered sections, motion, ambient), and the **adversarial-verify fixes** folded in. A **priority-ordered table** closes the document.

### The non-negotiable brand frame (applies to all pages)

- **Two typefaces only:** Geist (body, headlines, nav, UI, CTAs) + JetBrains Mono (numbers, datestamps, captions, technical labels, code). **No serif. No italic anywhere** — emphasis is weight (500/600) or color, never `font-style:italic`.
- **Canvas:** pure black `#000`. Surface ladder `#0a0a0a → #141414`; hairline `#1a1a1a`; outline `#2a2a2a`. Text `#fffdf9` / body `#e8e8e8` / muted `#9aa9b8` / caption `#787878`. State pips: pegged `#6bd697`, drift `#c08a55`, depeg `#a55a5a`, critical `#b73838`.
- **Iridescent gradient** `linear-gradient(90deg,#feed7a 0%,#ff8400 50%,#df91f7 100%)` is the **single signature accent = ammunition**, never decoration. The complete approved-usage list: BrandMark dot · primary CTA fill (landing hero only) · hero spotlight · hero headline accent `<span class="text-iridescent">` · methodology variable underlines (SVG stroke) · footer thread. **Nothing else.**
- **Geometry:** cards / sections / code blocks / list rows = **0px radius**. CTAs (primary + ghost) = `rounded-full` pills. Code chips = 4px. No `box-shadow` on cards.
- **Motion — TWO eases, by token, no raw literals, no springs:** `--ease-default: cubic-bezier(0.22,1,0.36,1)` and `--ease-out-strong: cubic-bezier(0.16,1,0.3,1)` (both verified in `globals.css:46-47`). **All interactive transitions: 200–300ms** via `var(--ease-default)`. **No control point may exceed y=1** — `cubic-bezier(.34,1.4,.64,1)` is a banned spring. Entrances (reveal fade-up ~0.7s, big entrance ~0.8s, canvas fade-in ~1.2s) use `var(--ease-out-strong)`. Always wrap motion in `prefers-reduced-motion`.
- **Iridescent fill on a primary pill is LANDING-HERO-ONLY.** On every inner page the primary CTA is the **solid white-on-black pill** (`bg-text` → `hover:bg-text/85`); the secondary is the **ghost pill** (`border-outline`, hover invert).
- **No standalone eyebrow+pip+label section headers** (deleted in v3). The mono-caps caption idiom is a *typographic* primitive (`Caption`), never a section organism with a pip.
- **Reveal-on-scroll mechanism is GSAP** (`useReducedMotionGsap` + ScrollTrigger) — the house infra already in `about-now-widget.tsx`, `methodology-pipeline`, `how-it-works`. Do **not** introduce a parallel `.reveal` CSS path (no shared `.reveal` class exists in `globals.css`). The reveal *intent* (fade-up, stagger, reduced-motion → opacity-only) is correct; use the existing mechanism.

---

## 1 · LANDING — `app/(marketing)/page.tsx`

> **VERDICT: KEEP.** This page is the DNA reference. `brandCompliant: true`, `genericRisk: low`. Do not touch the hero. Ship exactly two small fixes.

The landing is the most ownable surface on the site and the source-of-truth for every pattern the inner pages must inherit. It actively *deletes* the AI-template tells the brand forbids (no eyebrow+pip rows, no `(01)/(02)` section numbers, no `OPEN SOURCE · MIT` positioning strips). Mono is scoped correctly; the formula is a typeset fraction, not a CLI string; all structural type is Geist.

### What to keep (the transferable DNA)

- **THE FORMULA MOMENT — north-star.** `spread = 1 − market/intrinsic` rendered as a true typeset vertical fraction (market over intrinsic, thin iridescent divider rule) at `clamp(22px, 6vw, 88px)` in JetBrains Mono, with hand-drawn iridescent SVG-stroke underlines under each variable. This is the single most non-generic asset on the site. **Every inner page must hunt for its own type-as-hero equivalent** (a dominant number, an equation, a state diagram) rendered this confidently.
- **Hero cadence (the inheritable recipe):** no eyebrow → two-line Geist H1 `clamp(42px → 128px)`, `leading-[0.96]`, `tracking-tight`, iridescent on exactly ONE concept span (`oracle for Solana.`) → one mono caption (numbers/spec only) → one editorial body paragraph with a single bold-tail phrase → max two `rounded-full` CTAs (iridescent primary + ghost) with arrow glyphs. GSAP word-stagger reveal (`y:110%→0`, opacity, 0.55s `power3.out`, stagger 0.035), `prefers-reduced-motion`-guarded.
- **Signature-accent discipline:** iridescent appears only in sanctioned slots — hero headline span, hero spotlight (mouse-lerp 800px radial blur), primary CTA fill, formula underlines + fraction divider. Nowhere else.
- **Vertical rhythm:** `py-20 / sm:py-[160px]` cadence, `max-w-[1280px]` wrap, `px-5 sm:px-8 lg:px-12 xl:px-20` gutter — constant. One dominant statement per section, generous black between. Single-column editorial **row-lists** (Channels, Live-this-week) on sharp 0px hairline rows with `group-hover bg-text/[0.015]` + icon color shift — **this row-list pattern replaces every card grid on inner pages.**
- **Designed states:** Live-this-week has a real shape-matched skeleton (three 88px pulse rows) AND a designed empty path (returns null on a fresh system; pluralizes 1/2/3). Mock-data banner gated to fire only after both endpoints truly fail.
- **Giant PEGANA wordmark closer:** `clamp(64px, 20vw, 320px)`, 600 weight, `tracking-[-0.045em]`, `leading-[0.85]`, edge-to-edge, parallax scrub. The model closing move for any long page.
- **Motion restraint:** GSAP only for (1) the hero word reveal and (2) the wordmark parallax scrub; composite-only transform lerp for the spotlight; everything else plain CSS at ~200–300ms. All behind `prefers-reduced-motion` + `(hover:hover)` pointer guard so touch skips the RAF particle loop + blur layer.
- **Ambient:** the two-layer hero ambient (HeroCanvas dust particles + the mouse-driven 800px iridescent radial spotlight `rgba(255,132,0,.18) → (254,237,122,.08) → transparent`), desktop-hover-only and reduced-motion-safe. **This is the ONLY ambient moment on the page; the rest is pure black + hairlines.** Inner pages adopt the same rule: at most one ambient signature, confined to the hero.

### Fixes to ship (from adversarial verify)

1. **Drop the phantom "iridescent footer thread."** `site-footer.tsx` explicitly renders **no** iridescent thread above the wordmark (by owner direction: wordmark + columns + bottom row read as one continuous block). The actual closer is: white→translucent vertical-fade wordmark (`--wordmark-fill: linear-gradient(180deg,#fff 50%,rgba(255,255,255,0.35))`) → 5-col grid → TrustStrip → single-line copyright. The footer iri-thread **is** on the sanctioned ammunition list but is **intentionally omitted here** — do not silently reintroduce it.
2. **Regularize the Channels status grammar (the one substantive change).** `channels-section.tsx` `statusNote` currently varies across four axes in one mono slot — `1.2s` (latency), `24h` (uptime window), `x402` (protocol name), `Jun 11` (ship date) — which reads auto-generated. Fix: either split into **two mono tokens** (status pip+word, then a labelled metric) or restrict the trailing token to a **single axis**. Keep it in mono (numbers/labels); do **not** add an eyebrow/pip-row to "fix" it.

### Motion / ambient

**Keep the current budget verbatim and propagate it as the house rule** — GSAP for the one hero word-stagger + one parallax scrub per page; composite-only transform lerp for the spotlight; everything else CSS at 200–300ms `var(--ease-default)`. Never reach for framer spring physics.

---

## 2 · METHODOLOGY — `app/(marketing)/methodology/page.tsx`

> **VERDICT: REFINE.** `brandCompliant: false` until fixed. The content architecture is sound; the page reads as a developer README, not editorial SaaS, and carries zero brand signature.

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Zero iridescent on the whole page.** Hero `Deterministic. Versioned. Replayable.` is flat `text-text`, no accent span, no spotlight, no footer thread. The single brand weapon is entirely absent — the page reads brand-neutral. |
| **HIGH** | **Density collapse → README register.** The "Assets canon" table dumps 22+ rows of undifferentiated mono filling the middle third, flanked by two large dark code blocks (verify + raw CHANGELOG) in one narrow `max-w-3xl` column. Mono dominates the page register — the brand's "mono must not dominate" line is breached. |
| **MED** | **`rounded-sm` (4px) everywhere** — code blocks, lifecycle rows, status pills, table wrapper, empty-state. Structural containers must be **0px**. |
| **MED** | **Mono-as-prose.** The formula sentence `Oracle/intrinsic + executable market quote = spread.` is a full English sentence in mono caps under the headline — reads as a terminal echo line. Mono is for numbers/labels, not sentences. |
| **LOW** | Verified column uses a literal `✓` glyph in a dense mono table — state meaning must be carried by a **pip**, not a text glyph. |

**Generic-AI tells:** single narrow centered column repeated 6× with identical rhythm (the canonical "AI docs page"); raw `CHANGELOG.md` piped into a `<pre>` (the laziest "render the file" move); colored-tag-in-bordered-row lifecycle pills; zero signature visual moment.

### What to keep

Typography discipline (Geist headings/body, mono scoped, no italic/serif). Full token hygiene (`text/text-muted/text-body/text-caption`, `surface-1`, `hairline`, `st-pegged/st-critical`). On-spec hero scale. Honest build-time content (reads real `assets.toml` + `CHANGELOG`) — the `curl | sh` **verify snippet genuinely pays rent; keep it.** Correct state-color semantics. The trust narrative order: verify → lifecycle → assets → changelog → retraction → what-this-is-NOT.

### Hero

- Keep `Deterministic. Versioned. Replayable.` and wrap **one word — `Replayable.`** in `<span class="text-iridescent">` (the page's single ammunition usage). Add a faint top-edge **hero spotlight** (radial iridescent ~5–6% opacity, masked to fade before the first section, 1.2s canvas fade-in via `var(--ease-out-strong)`).
- Scale: `text-[40px] sm:text-[64px] lg:text-[80px]`, `leading-[1.0]`, `tracking-[-0.025em]`, Geist 500, no italic.
- **Delete the residual mono `methodology` kicker above the H1** — it is the v3-deleted eyebrow pattern. The headline stands alone.
- Replace the mono-caps formula sentence with a proper Geist sub at 17px / 1.6 `text-text-muted`: *"Every alert is a pure function of intrinsic value, an executable market quote, `assets.toml` thresholds, and EWMA state."* Demote the literal `oracle/intrinsic + market quote = spread` to a small mono **caption** below the sub (where mono is legitimate).
- Two pill CTAs: primary solid `Verify an alert →` (anchors `#verify`) + ghost `Browse audits →`.

### Sections (ordered)

1. **Verify any alert** — keep the `curl | sh` block; make it **0px** (not `rounded-sm`), one focused snippet, small mono `shell` caption above. Pull the platform caveat into one muted Geist line.
2. **Version lifecycle** — convert the three stacked bordered rows into a **3-up 0px card grid** (active / deprecated / broken). Each card **leads with the real state pip** (`--color-st-pegged` / `--color-st-critical` dot) + label — the pip carries the color semantic, not a re-lettered text chip. Hairline border, hover border-brighten (0.2s `var(--ease-default)`). Chip radius 4px max if any chip is used.
3. **Assets canon** — the density problem. Default to a **COLLAPSED** view: a summary strip (`22 active assets across 7 classes` with class-count tag-pills) + first ~6 rows, then a `Show all 22 →` disclosure (height/opacity 0.3s `var(--ease-default)` — **no overshoot bezier**). De-mono: symbols stay mono, Class/Peg-target in Geist; hairline rows with generous `py`; verified status as a real pegged-state **pip + label**, not `✓`. Wrapper 0px. This must **not** be the visual center of gravity.
4. **Methodology changelog** — stop dumping raw `CHANGELOG.md` into a `<pre>`. Parse into versioned entries: each release a 0px card with a **mono version+date header**, a state **pip + label** lead, styled bullet list in Geist. Minimum viable: style the `<pre>` with a mono caption header and collapse to latest 1–2 versions with `Full changelog on GitHub →`.
5. **Retraction protocol** — keep as editorial prose (it reads well). Optional: a 3-step horizontal sequence (confirm broken → ship fix + restart → mark broken, receipts warn) as 0px cards with `→` glyphs.
6. **What this is NOT** — elevate to a closing statement. Three NOTs (NOT SOC 2 / NOT regulatory audit / NOT financial advice) as muted tag-pills above the one-line clarifier, then GitHub/audit/agents links as a clean footer row.

### Motion / ambient

Reveal-on-scroll via the **existing GSAP + `useReducedMotionGsap` infra** (not a new `.reveal` path), staggered ~0.06s per section. Hero spotlight 1.2s canvas fade-in via `var(--ease-out-strong)`. Card hovers 0.2s border/bg via `var(--ease-default)`. Link color swaps 0.2s; CTA bg 0.2s. Disclosure 0.3s `var(--ease-default)` height/opacity. All in `prefers-reduced-motion`. **Ambient:** one restrained top-anchored iridescent spotlight (~5–6%) masked to fade by the first section + the sanctioned footer iri-thread; everything else pure `#000`. No particles, no scanlines, no glow halos.

---

## 3 · AGENTS — `app/(marketing)/agents/page.tsx`

> **VERDICT: REBUILD.** `brandCompliant: false`. The code content is high-value PROOF and must be preserved — but reframed as proof *inside* an editorial container, not as the whole page.

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Code-as-content.** Four full-width dark `<pre>` blocks stacked back-to-back with one muted line between each. Below the hero the entire body is monospace — reads as API docs, the developer-terminal register the brand forbids. |
| **HIGH** | **Zero iridescent.** No `text-iridescent`, no spotlight; the only CTA is `bg-text` white-on-black. No brand identity beyond the header lockup. |
| **HIGH** | **No hero CTA; the only CTA is buried in Pricing** with no arrow glyph and a stale `duration-300`. An agent integrator hits an 80px headline then falls into code with nowhere to click. |
| **MED** | **4-up trust-chip grid** (`methodology v0.1.0 · receipt v1 · sigstore · x402 USDC`) directly under the hero — the generic SaaS positioning-strip / "badges row." |
| **MED** | No reveal-on-scroll, no entrance choreography; one dead vertical scroll with a single hover state. |
| **LOW** | Lone CTA uses `transition-colors duration-300` with no ease token. |

### What to keep (PRESERVE)

The code samples are genuine, high-value proof — real `verify_alert` + `subscribe_peg_events` + curl receipts with `evidence_url` / `receipt_sha256`. **Preserve this content; only reframe it.** Geometry is compliant (sharp sections, pill CTA, hairline borders, token usage, no hardcoded hex/serif/italic). Voice is factual ("No API keys. Free MCP tools are free."). The deliberate choice to render the MCP endpoint as a **copyable CodeBlock, not a clickable link**, is correct product judgment — keep it.

> **Note on the existing mono-caps `for AI agents` eyebrow:** the audit listed it as a keeper, but verify correctly flags it as the **v3-deleted standalone-eyebrow pattern**. **Fold `for AI agents` into the headline or lede; do not canonize a standalone mono-caps eyebrow above the H1.**

### Hero

- Keep the Geist headline structure; make **one concept** the iridescent span — wrap `Verifiable` (e.g. `Verifiable peg state`) in `<span class="text-iridescent">`, the only gradient text on the page. Fold the "for AI agents" framing into the headline/lede (drop the standalone eyebrow).
- Add a low-opacity radial **iridescent hero spotlight** behind it (1.2s canvas fade-in).
- Add **two hero pill CTAs:** primary **solid** `bg-text` pill `Get the MCP endpoint →` (anchors the endpoint section) + ghost `Read the methodology →`. **The primary is solid white-on-black, NOT iridescent** — iridescent fill is landing-hero-only.
- Replace the flat 4-up trust-chip grid with one tighter **inline mono spec line** (`methodology v0.1.0 · receipt v1 · sigstore · x402 USDC`) so it reads as a datestamp caption, not a badge wall.

### Sections (ordered)

1. **Why verifiability matters (lead, not buried)** — promote to position 1 as a full-width editorial statement: one 28–40px Geist line with a bold-tail emphasis (*"agents that act on financial signals must cite **why** they acted"*). Render `evidence_url` / `receipt_sha256` / `pegana-replay` as **inline mono code chips** (4px, `bg-text/[0.06]`) — NOT a code block. Set the argument before any code appears.
2. **Three capabilities — editorial cards, code as proof** — convert `verify_alert` / `subscribe_peg_events` / REST into a 3-up (sm: stacked) card grid. Each card: capability name (Geist 500), one-line plain-English what-it-does, a mono tag-pill (`free` / `paid · x402` / `no-client`), and the code sample as a **compact framed proof panel inside the card** — bounded, captioned `TypeScript` / `curl` in mono, with a copy affordance. Cards: 0px, hairline border, hover-lift 0.2–0.3s `var(--ease-default)` + 0.12–0.2s border swap to `outline`.
3. **Pricing strip** — single confident line: *"Free tools are free. Paid calls $0.0005–$0.001, settled per-call in x402 USDC on Solana mainnet. No keys, no signup."* Numbers in mono. Primary solid `Get the endpoint →` + ghost `How to verify →`, real arrow glyphs, 0.2s bg `var(--ease-default)`.
4. **Closing / endpoint + cross-links** — keep the copyable MCP endpoint CodeBlock + liveness/metrics mono captions as the deliberate closing action surface with one final CTA, then methodology/audit footer links + the sanctioned footer iri-thread.

### Motion / ambient

Reveal-on-scroll via existing GSAP infra (fade-up, stagger ~0.04s per card). Hero spotlight 1.2s canvas fade-in; headline span 0.8s `var(--ease-out-strong)` entrance. **Card hover: `var(--ease-default)` at 200–300ms (NOT a spring bezier).** CTA/color swaps 0.2s `var(--ease-default)`; copy-button feedback 0.2s. All raw beziers mapped to tokens — no `cubic-bezier(...)` literals in component code. **Ambient:** one iridescent radial spotlight behind the hero + a footer iri-thread. Optional very-faint dotted-grid behind the hero only (reuse the dashboard's `dotted-grid-bg` component), never behind code panels. No glow halos, noise, or scanlines.

---

## 4 · AUDIT — `app/(marketing)/audit/page.tsx`

> **VERDICT: REBUILD.** `brandCompliant: false`. During calibration (now → Jun 11) the body is one drift-tinted notice box on a void — a blank page, not a designed empty state. The calibration story is the most ownable narrative on the site and it's reduced to one apologetic amber box.

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Undesigned empty state.** `audit-empty-state.tsx` `kind === "calibration"` is a `p-6` border-st-drift box on a 64px headline, then ~50% viewport of empty black to the footer. |
| **HIGH** | **Zero iridescent / zero brand signature.** Hero `h1` flat `text-text`, no spotlight, no primary CTA. Coral/magenta appear only in the nav bracket logo. |
| **MED** | **Headline describes the SQL query** (`Last 50 non-pegged alerts.`) rather than making a claim. No accent span, no emphasis. |
| **MED** | **Dead end during calibration** — no primary/ghost pills; the only links are buried in the notice box and a mono line at the very bottom. |
| **LOW** | `rounded-sm` on the notice container and state badges — section containers must be 0px. |
| **LOW** | Everything is `text-[10px]` mono — below comfortable read; with the table absent, the page is two 10px mono eyebrows + an 80px headline and nothing between. |

### What to keep

The **calibration-vs-unreachable distinction** (`pickEmptyKind` + the `(kind, inCalibrationWindow)` matrix) is genuine trust thinking — keep the logic entirely, just dress it better. Mono correctly scoped (timestamps, `v0.2.0`, `sha256…`, `GET`, state badges). The **full-row `<Link>` overlay pattern** with the solscan link `relative z-10` is correct accessible UX. State badges driven by `stateBadgeClass` → `st-drift/st-depeg/st-critical` tokens. The programmatic-access line (REST + CSV + methodology) is real developer affordance.

### Hero

- **Drop the standalone `audit ledger` eyebrow** (v3-deleted pattern) — let the headline stand alone.
- Replace the query-label headline with a statement landing iridescent on ONE concept: *"Every alert ships a receipt you can `<span class="text-iridescent">`verify yourself`</span>`."* Scale `text-[40px] sm:text-[64px] lg:text-[80px]`, `leading-[1.0]`, `tracking-[-0.025em]`, Geist 500, no italic.
- Sub (Geist 17px / 1.6 `text-text-muted`) with one bold-tail phrase: *"Pegana watches Solana pegged assets, compares market price to intrinsic value, and seals each state change into a content-addressed receipt — **reproducible from the inputs the methodology saw.**"*
- Two pill CTAs: primary solid `Read the API →` + ghost `Methodology →`. The `?state=DRIFT` variant keeps its dynamic headline + the same accent treatment.

### Sections (ordered)

1. **Calibration status panel** (replaces the lone notice box) — a **0px** `surface-1` block, hairline border. **Reframe in editorial product voice, not ops-console:** lead with a real headline — *"The first public verdict seals in 9 days."* — then a plain Geist sub explaining the gate (do **not** render a `pip + label` eyebrow header; "Engine live · calibration window" as a status-console readout drifts toward ops-feed framing). Include a real countdown to the Jun 11 verdict gate in mono `tabular-nums` (recomputed from `lib/calibration.ts`). Place the `st-drift` state pip **inline beside the countdown numerals** where it carries genuine state meaning — its glow is strictly the `0 0 8px` pip box-shadow on the pip element, spatially separated from any headline text (no glow-halo on text). This is the page's dominant statement during calibration — give it weight.
2. **What the feed WILL show — sample / redacted receipt** — build the live-feed shape as a single redacted sample card (0px `surface-1`, hairline): asset (USDC), state-transition badge pair (`PEGGED → DRIFT` via `stateBadgeClass` tokens), mono timestamp, `v0.2.0`, truncated `sha256 a1b2c3…`, an "anchored on-chain" link styled like the real solscan link but tagged `sample` (`st-caption`). Subtle "redacted preview" affordance so it's never mistaken for a real alert. Doubles as the shape-matched skeleton geometry.
3. **Shape-matched skeleton strip** — 3–4 ghost rows at the EXACT dimensions of real audit rows (when / asset / transition / methodology / receipt / on-chain), hairline borders + `surface-1` shimmer — no spinner, no "loading…" text. Shimmer static under `prefers-reduced-motion`.
4. **Verify-it-yourself block** (promote the buried mono footnote) — a square code-chip group (4px chips, `bg-text/[0.06]`): `GET /v1/audit?limit=50`, `/v1/audit.csv`, and the replay CLI (`curl releases.pegana.xyz | sh`) so the central claim has a concrete path. Mono for snippets only; framing copy in Geist.

### Motion / ambient

Reveal-on-scroll via existing GSAP infra, staggered: hero → calibration panel → sample receipt → skeleton → verify block. Countdown ticks via `setInterval` updating only the mono numerals (`tabular-nums`, no layout shift). State pip: a slow 2s opacity pulse (ease-only) on the pip itself only — static under `prefers-reduced-motion`; countdown stays (it's information). Hover: 0.2s bg on pills, 0.2s border on the sample card, 0.2s color on links — all `var(--ease-default)`. No framer-motion (no true interactions). **Ambient — pick ONE:** the approved hero iridescent radial spotlight (~6–8%, no animation, masked, behind the headline only) is the signature spend. Cut the dotted-grid unless the skeleton genuinely needs the "structure-waiting" read; if kept, hold it `≤3%` contrast confined to the skeleton zone so it never competes with the spotlight. No scanlines, noise, vignette, or terminal chrome — the page should feel like a sealed vault counting down, not a console streaming logs.

---

## 5 · CHANGELOG — `app/(marketing)/changelog/page.tsx` + `changelog-client.tsx`

> **VERDICT: REFINE.** `brandCompliant: false`, `genericRisk: med`. **Two P0s ship independently of the visual redesign:** the live page advertises a now-forbidden serif/italic aesthetic, and the commit feed is broken (private repo 404 → one hardcoded fallback row).

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Live copy advertises a forbidden aesthetic.** `RELEASES[0]` (2026-05-27) bullets read *"formula as art (Fraunces italic + iridescent underlines)"* and *"Fraunces serif italic added."* The brand bans Fraunces, serif, and italic anywhere (locked 2026-05-27). The changelog publicly advertises the exact treatment the brand removed. |
| **HIGH** | **Broken data source.** `web/lib/github-commits.ts` `REPO = "lrafasouza/pegana"` (verified) is the **private** repo; unauthenticated `api.github.com` returns 404 → `CHANGELOG_FALLBACK` (one hardcoded commit). Both `/changelog` and `/feed/changelog.xml` are affected. The page advertises its own brokenness (`Commits=1`, `Past 7 days=0`). |
| **HIGH** | **Zero iridescent.** `What changed.` is flat `text-text`; no spotlight, no accent span. Fully monochrome. |
| **MED** | **Mono on UI strings** — filter pills use mono for the words `all/feature/fix/internal`; `See full history on GitHub` is mono uppercase. Mono is for numbers/labels, not nav/controls. |
| **MED** | **4-up metric stat-strip** (`Releases / Commits surfaced / Past 7 days / Auto-refresh`) — the AI "add some stats" move that numerically broadcasts the broken feed. |
| **MED** | No designed degraded/empty state; the single hardcoded fallback is indistinguishable from real data. |

### What to keep

Typeface discipline mostly correct (Geist headings/blurbs, mono for dates/sha). The **releases timeline** (coral dot + glow on a hairline rail, date/tag left, title+bullets right) is a genuinely good on-brand editorial pattern — keep it. Sharp 0px cards, correct tokens (`st-pegged/st-drift` tags). GSAP reveal-on-scroll with `useReducedMotionGsap` already correct. The two-tier architecture (curated RELEASES = human story, raw commit feed = proof) is sound — keep it once the feed works. RSS route shares the same source.

### P0 fixes (ship independently, before any visual work)

1. **Copy edit (decoupled, ships today):** edit `page.tsx` `RELEASES[0]` bullets to drop **both** Fraunces/italic mentions. Reframe to the truthful *"Methodology section — formula as art with iridescent variable underlines."* This is a live brand-contradiction shipping today.
2. **Data fix — public repo, NO token:** point `REPO` at the **public** `lrafasouza/pegana-replay` (the repo the page already links to in copy + footer) so the unauthenticated fetch succeeds and only public history surfaces. **Do NOT add a `GITHUB_TOKEN` for the private repo** — that would dump raw closed-repo commit subjects onto a public marketing surface (contradicting the stated closed-repo boundary) and risk token exposure in a client-reachable path.

### Hero

- Keep `What changed.` and spend the ammunition: Geist 500 `clamp(40px, 6vw, 80px)`, negative tracking; wrap **one concept** (`changed`) in `text-iridescent` (or a single iridescent SVG underline-span). Sub-line, editorial bold-tail: *"Curated release notes, then the raw commit feed — both live from the `pegana-replay` history, refreshed every 10 minutes."*
- **Delete the 4-up stat strip entirely.** If a single live signal is wanted, replace with one inline mono caption (`last synced 4m ago`) — designed as a caption, not a metric grid.

### Sections (ordered)

1. **Releases timeline** — keep the coral-dot-on-rail (the best thing here). Add sticky month dividers (mono caption `MAY 2026`). Each release row a hover-lift target (0.2s lift, `border-hairline → border-outline`, `var(--ease-default)`).
2. **Commit feed** — de-terminalize. Group commits by day with a date header per day (mono caption) instead of repeating the date per row. Per row: drop the date column; blurb in **Geist 14px** as the primary; demote tag to a small **sharp (0px) token-colored chip** (`st-pegged/st-drift`/muted, **not** a rounded pill — tags are containers, not actions; mirror the existing `releaseTagStyle` inline span); keep `sha` as the only mono element (legitimate code identifier). 0.2s color-swap hover + 0.2s row lift. **Filter buttons** (genuine actions) become ghost `rounded-full` pills with **Geist labels** and mono count badges.
3. **Designed states** — build a real degraded state: a single designed card `Commit feed syncing — check the full history on GitHub →` (external top-right arrow), NOT a bare fallback row. Add a shape-matched skeleton (grey day-header + 4 grey rows). Style the `No commits matching this filter` empty state as a centered designed empty state, not a left-aligned mono line.
4. **Footer / external links** — promote `See full history on GitHub` and `RSS` from tiny mono-uppercase chrome to proper ghost-pill CTAs with arrow glyphs (Geist labels). They are actions → pills.

### Motion / ambient

All interactive transitions **200–300ms** via `var(--ease-default)` — the audit's earlier 0.12s/0.15s figures are **below the brand's 200ms floor; use 0.2s.** No raw bezier literals — hero entrance uses `var(--ease-out-strong)`. Day-groups/release rows: reveal fade-up ~0.7s via existing GSAP infra (standardize to 0.7s, not 0.5s). Filter change: cross-fade the list 0.2s rather than hard swap. No springs. **Ambient:** one soft iridescent hero spotlight (radial, low opacity, top-center, 1.2s canvas fade-in) fading to pure `#000` by the first section. Below the hero stays pure black. Full ammunition budget for this page: one spotlight + one accent span + the coral timeline dots. Footer keeps the standard iri-thread.

---

## 6 · PRICING — `app/(marketing)/pricing/page.tsx`

> **VERDICT: REBUILD.** `brandCompliant: false`. A pricing page is the highest-conversion brand surface and this one is 100% grayscale with **zero CTAs in production** (the only button is behind `SHOW_WAITLIST=false`).

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Zero iridescent.** No gradient anywhere; hero `h1` flat `text-text`; the only button is `bg-text`. No Pegana identity. |
| **HIGH** | **No CTA on the live Free tier.** The user is told Free is "fully live" but given nowhere to go. The only button is in the feature-flagged-OFF waitlist → in production the page has **zero CTAs**. |
| **MED** | `transition-colors duration-300` on the submit button; no reveal-on-scroll, no card hover-lift — motionless. |
| **MED** | `opacity-70` to dim "coming soon" tiers — the lazy blanket-transparency disabled treatment. |
| **MED** | TierCard has no hover state — four static rectangles. |

**Generic-AI tells:** four equal-width tier cards in `grid lg:grid-cols-4` (no featured tier, no hierarchy); `opacity-70` inactive state; plain `<li>` feature lists with no grouping; asterisk-footnote shoved into a bullet; a static document with no FAQ/comparison depth.

### What to keep

Typography discipline (mono → eyebrow caps, badges, `$0`, form labels; Geist headlines/body; no serif/italic). Color tokens throughout (no bare Tailwind, no hardcoded hex). Sharp containers + pill CTA. **Honest voice** ("No promises about performance we haven't measured") — a differentiator, preserve it. Semantic `text-st-pegged` on the active-tier badge. Locked inner-page padding. The **feature-flag + `/api/waitlist` + success-state plumbing** is real working infra — reuse it, redesign the surface.

> **The page is brand-clean on the terminal axis** — `terminalFeel: false`. Its failure is blandness, not terminal-creep.

### Hero

- Eyebrow as a mono-caps **caption** (not a pip-section): `pricing`. Headline Geist `clamp(40px, 7vw, 80px)`, `leading-[1.0]`, `tracking-[-0.025em]`, no italic: *"Free now. We won't charge for latency we haven't measured."* — wrap **only `latency`** in `<span class="text-iridescent">` (background-clip on the locked gradient token, never a hardcoded hex).
- Sub `text-text-muted` 17px/1.6 carrying calibration/verdict-gate context.
- **The primary action belongs here:** primary **solid `bg-text` pill** `Open the dashboard →` (the Free tier IS live) + ghost `Why no prices yet → methodology`. **NOT iridescent fill** — iridescent pill is landing-hero-only.

### Sections (ordered)

1. **Tier ladder (break the 4-equal grid)** — lead with one **wide `Free — active now` panel** spanning full width (the only actionable thing today): crisp `surface-1` 0px card, `st-pegged` pip + `active now` badge, two-column feature list with hairline check glyphs, inline **solid** CTA. Below it, a 3-up row of upcoming tiers (Pro / Realtime / Enterprise) at reduced visual weight — **NOT via `opacity-70`.** Keep borders crisp (`border-hairline`), render price as a muted `—`, signal future-state with a single `st-unknown` pip + a one-line ETA (`after verdict gate, Jun 11`) in mono caption. Hover-lift on every card (`border → outline`, 0.2s `var(--ease-default)`).
2. **What 'free' actually includes** — a horizontal capability strip, 0px, listing real free-tier deliverables as tag-pills (`5-min delayed alerts` / `public RSS+Atom` / `MCP free tools` / `audit URL per alert` / `Replay CLI + Sigstore`). The trust differentiator surfaced as proof. Numbers in mono.
3. **Pricing philosophy / disclosure** — editorial bold-tail paragraph (`max-w-3xl`), Geist `text-muted` with the load-bearing clause in `text-body` weight 500: *"…we won't price a tier until calibration v1 publishes p95/p99 and at least one design partner signs."* Single methodology link. Keep it prose, not a card.
4. **Waitlist (redesign the flagged section)** — when `SHOW_WAITLIST` flips: a two-column block — left, `Join the waitlist.` + intent copy; right, form on `surface-1` with **sharp 0px inputs** (`border-outline → border-text` on focus, 0.2s), asset-class selectors as toggle tag-pills (keep the started pattern, tighten it), submit as the **solid `bg-text` pill** (NOT iridescent) with a `→` arrow. Keep the `st-pegged` success-state panel (already good).
5. **FAQ / objection handling** — a sharp 3-item Q&A grid: *"Will the free tier stay free?"* / *"What changes at the verdict gate?"* / *"Can I get current-tick alerts now?"* Hairline dividers, Geist, mono only on dates/intervals.

### Motion / ambient

Reveal-on-scroll via existing GSAP infra (fade-up, `prefers-reduced-motion`-guarded) for header, ladder, each section. Tier cards: 0.2–0.35s `var(--ease-default)` border/bg + lift — **no overshoot bezier on the active panel** (use `var(--ease-default)`, kill the bounce). Buttons: 0.2s bg `var(--ease-default)` (replace the `duration-300`). Iridescent hero word: **static fill** (ammunition, not animated decoration). All CSS. **Ammunition cap = exactly TWO:** the hero accent span on `latency` + the hero spotlight. Hero CTA stays solid; waitlist submit stays solid. **Ambient:** one restrained iridescent hero spotlight behind the headline only, masked to feather before the tier grid. No particles, grid, or scanlines. Footer via `SiteFooter` (its iri-thread is the closing note). **Geometry:** set cards/panels/inputs to `rounded-none` (0px) while rebuilding — `rounded-sm` (2px) is drift; reserve radius for pills (full) and code chips (4px).

---

## 7 · ABOUT — `app/(marketing)/about/page.tsx` + `about-now-widget.tsx`

> **VERDICT: REFINE.** `brandCompliant: true` (after the two named fixes). Strong copy in an undesigned shell; the commit widget is the highest-risk surface to get wrong (terminal-adjacent).

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **Hardcoded iridescent hex outside ammunition.** `about-now-widget.tsx:20` — `FIX: "text-[#feed7a] border-[#feed7a]"` (verified). The iridescent start-stop hex hardcoded as a tag border/text color = a raw-hex violation AND iridescent-outside-ammunition. Meanwhile the actual hero headline carries zero iridescent. |
| **MED** | **Commit widget reads terminal-adjacent.** `FEATURE/FIX/INTERNAL` bordered mono uppercase chips + glow pip + mono datestamp/sha per row + the "evolve in a closed repo" caption = changelog/output-stream register the brand warns against. |
| **MED** | **Inert hero.** `A peg watchdog you can read.` is plain `text-text`, no accent span, no spotlight — the most important line has no brand signature. |
| **LOW** | Left column (h1 + prose + Get-in-touch) has no entrance motion; widget hover states snap with zero ease. |

**Generic-AI tells:** the default "big text left / sticky card right" about template; four undifferentiated contact pills in a row; the load-bearing `REST and WebSocket are public; no key.` differentiator buried inline in paragraph 3.

### What to keep

Headline copy `A peg watchdog you can read.` — strong, on-brand, **keep verbatim.** Body copy is specific and active (liquidation cascade, peg-risk oracle, insurance/prediction/lending) — keep the substance. Pill CTAs already `rounded-full` with arrow glyphs — geometry compliant. Cards 0px `surface-1` hairline, no shadow. Live GitHub commits via `getRecentCommits` — keep the data, redesign the container. Sticky right rail + locked padding.

### Hero

- Keep the line; render at locked inner-page scale (`text-[40px] sm:text-[64px] lg:text-[80px]`, `leading-[1.0]`, Geist 500, `tracking-[-0.035em]`) and wrap **one concept — `read`** in `<span class="text-iridescent">` (the real utility, `globals.css:242`, used exactly this way on the landing hero). Add a faint **hero spotlight** (radial iridescent, low opacity, top-left, masked so it never reads as a glow-halo on glyphs — the load-bearing constraint — via `var(--gradient-iridescent)` at low opacity, never a hardcoded hex).
- One tight muted sub-lede: *"Open methodology, one operator, same thresholds for everyone."*

### Sections (ordered)

1. **Editorial body** — keep three paragraphs; apply bold-tail emphasis (wrap each para's load-bearing phrase in `text-text-body` weight/color instead of flat). Constrain measure ~62ch. GSAP fade-up on scroll.
2. **Peg-risk oracle / who reads it** — pull the `insurance / prediction markets / lending` sentence into a **3-up of sharp 0px hairline cards** (Insurance · Prediction markets · Lending), each one line (who reads + what they do on a peg event). End the row with the **REST/WS line as a designed statement** (mono `REST`/`WS` labels) + one ghost pill `Read the API`.
3. **Working on right now (rebuild the commit card)** — keep live commits, **kill the changelog-chip look.** Strictly: remove ALL bordered uppercase `FEATURE/FIX/INTERNAL` chips **and the `#feed7a` hex**; use the brand **state-pip vocabulary** OR a single borderless muted mono category label (token colors only). Mono stays ONLY on datestamp + sha (legitimate); blurb in Geist body. Real hover: row bg lift to `bg-text/[0.04]` over 0.2s `var(--ease-default)`. **Reword/drop the "evolve in a closed repo" caption** — "closed repo" framing edges toward ops-feed register. Verify the final card reads editorial, not build-log.
4. **Get in touch** — give the four channels hierarchy: ONE primary **solid** pill (Telegram — "fastest"), the rest ghost pills, single line on desktop, arrow glyphs (external = top-right). Drop the duplicate Telegram entries to one bot link.

### Motion / ambient

Reveal-on-scroll via the **existing GSAP + `useReducedMotionGsap` + `getScrollTrigger`** pattern already in `about-now-widget.tsx` (do **not** build a net-new `.reveal` CSS path — no shared class exists). Headline 0.8s big entrance via `var(--ease-out-strong)`; body 0.7s fade-up; oracle 3-up 0.7s, stagger 0.08s. Hover: pills + commit-row bg at **0.2s** (`var(--ease-default)` — **not** the 0.15s the audit suggested; that's below the 200ms floor, and the existing `duration-300` on the pills is already compliant). Hero spotlight 1.2s canvas fade-in. All in `prefers-reduced-motion` (reduce to opacity-only). **Ambient:** single low-opacity iridescent hero spotlight (top-left, masked, behind glyphs not on them) — the page's only color moment. Pure `#000` elsewhere; footer keeps its iri-thread. No scanlines, noise, or grid.

---

## 8 · SHELL — nav + footer + global tokens

`layout.tsx → MarketingHeader / UtilStrip / CalibrationBanner / SiteFooter` · `globals.css`

> **VERDICT: REFINE.** `brandCompliant: true` (after refinements). The token system is the right foundation. The structural root of "inner pages feel generic" is the **missing design-system layer** between raw Tailwind and pages — every CTA, caption, and card is open-coded and drifts.

### Top problems

| Sev | Problem |
|-----|---------|
| **HIGH** | **No shared CTA primitive.** The solid header pill is hand-copied inline across 9+ call sites; the ghost pill is reinvented in 15 files. `components/atoms/pill.tsx` exists but is a `<button>`-only atom whose `filled` variant inverts on hover (`bg-text → bg-canvas`), which **contradicts** the brand header spec (`hover:bg-text/85`) and can't render as a `<Link>` — so nobody uses it for nav/marketing CTAs. The canonical CTA has no single component. |
| **MED** | **No shared caption primitive.** The mono-caps idiom is open-coded in 72 files with drifting tracking — nav `0.06em`, util-strip `0.12em`, trust-strip `0.08em`, footer `0.12em`, Pill atom `0.06em`. The exact "feels generic per page" symptom. |
| **MED** | **Shell fires iridescent zero times.** `BrandMark` (in every header) renders coral `[` + magenta `]` only — **no iridescent dot**, despite "BrandMark dot" being a named approved usage. The shell reads monochrome-generic. |
| **LOW** | `MobileMenu` panel carries `shadow-[0_24px_80px_rgba(0,0,0,0.32)]` — the only drop-shadow in the shell; convert to a hairline + backdrop-blur edge. |

### What to keep

The **token system in `globals.css` is genuinely strong** — full surface ladder (`#000 → #0a0a0a → #141414`), hairline/outline, four-tier text scale, all five state pips, wash tints, two named eases (`--ease-default`, `--ease-out-strong`, verified `46-47`), spacing tokens, the `text-iridescent` helper, a shadcn→brand bridge forcing radius to 0px, and a global `prefers-reduced-motion` guard. **Keep this as the source of truth.** Nav is correctly an **edge-to-edge transparent bar** (absolute on `/`, relative on inner pages) — the Phantom/Base/Helius flat-nav lineage; **do not turn it into a glass pill.** Footer composition (giant PEGANA wordmark opener → 5-col Product/Trust/Developers/Company/Legal grid → live TrustStrip → `© 2026 Pegana · Beta`) is solid; the dedicated **Trust column** is a smart product-specific differentiator. WCAG-aware token work (captions raised to ~4.6:1). BrandMark routed through one atom; body reset correctly inside `@layer base` (the Tailwind v4 gotcha respected). MobileMenu is high-craft (portal, scroll-lock, clip-path reveal, escape/scroll-to-close, gated tabIndex).

### Sections (ordered)

1. **Primitive layer (do this FIRST — it de-genericizes every page)**
   - **`CtaLink`** — a `Link`-based pill, `rounded-full px-7 py-3.5 text-[13px]`, with the `→` glyph + group-hover translate baked in. Variants: **`solid`** (`bg-text` → `hover:bg-text/85`, the header/dashboard/inner-page primary) and **`ghost`** (`border-outline`, hover invert). The **`primary` (iridescent fill) variant must NOT live in the shell-imported atom** — put it in a separate export (or a `variant='primary'` that lints/throws outside `app/(marketing)/page.tsx`) so iridescent never leaks into header/footer CTAs. The shell only ever imports `solid` / `ghost`. Migrate the 9 solid + 15 ghost call sites; delete or refit the contradictory `pill.tsx` as the icon-button base only.
   - **`Caption`** — one mono-caps atom, **`uppercase` + ONE locked tracking value `0.08em`** (matching trust-strip). **Name it `Caption`, never `Eyebrow`** (brand deleted "eyebrow" in v3). It is an inline caption/label primitive only — **no pip slot, never usable as a section-header organism.** Route util-strip / footer / copyright / trust-strip through it.
   - **`Card` + `ListRow`** — 0px radius, hairline border, no shadow, hover-lift 0.2–0.3s via `var(--ease-default)` (no overshoot bezier).
2. **Nav bar** — keep edge-to-edge transparent (NOT a glass pill). On inner pages (`relative`), add `border-b border-hairline` so it reads as deliberate chrome. Keep flat single-link nav; standardize the underline-grow hover to **0.2s** (not the current 0.5s) via `var(--ease-default)`. Route the Dashboard CTA through `CtaLink solid`.
3. **Util-strip + Calibration banner** — keep the slim announcement bar; desaturate the coral `NEW` chip slightly so it doesn't out-shout the hero accent below it. Ensure CalibrationBanner → UtilStrip → Header never produce two colored bars at once (the banner self-nulls post-gate — good). Route NEW chip + copy through `Caption`. **Fix the geometry the audit missed:** `calibration-banner-client.tsx` uses `rounded-[10px]` on the DialogContent + two `surface-1` sections (verified `47/90/126`), `rounded-md` (close button + chip, `58/68`), `rounded-lg` (ADR link, `154`) — convert the panels/DialogContent to **0px**; keep `rounded-full` only on the FloatingTrigger/real CTAs and 4px for code chips. Reconcile with the new `Card`.
4. **Footer** — composition stays. Fix the responsive header type-swap (mono 10px caps on mobile → sans 13px semibold normal-case on desktop reads as two design languages): **pick ONE — sans 13px semibold normal-case at all breakpoints.** Optionally reinstate a single **hairline-thin iridescent rule above the PEGANA wordmark** (the one sanctioned footer-thread ammunition slot, 1px, low opacity). **Fix the live violation the audit missed:** `trust-strip.tsx:114-122` broken-methodology branch uses raw `border-rose-500/40 bg-rose-500/10 text-rose-200 text-rose-100 decoration-rose-300/60` (verified) — replace with the **`--color-st-critical` (#b73838)** state token for border/bg/text so it recalibrates per theme like the rest of TrustStrip.

### Hero (shell brand-presence)

The shell has no hero, but the persistent chrome must carry exactly **ONE** iridescent moment. Add a single **6px iridescent dot** to `BrandMark` (note: `brand-mark.tsx` currently renders NO dot, so this is **net-new**, not a "restore"). **Ship only the static dot — drop the hover-reveal gradient-baseline alternative** (a hover-reveal gradient underline is iridescent-as-decoration, not on the closed approved list; the brief's own conclusion is "a point, not a fill"). The PEGANA footer wordmark keeps its flat white→grey `--wordmark-fill` (mass, not accent).

### Motion / ambient

Adopt the two-ease token system **at the atom level** so it propagates: all interactive transitions 200–300ms via `var(--ease-default)`; entrances via `var(--ease-out-strong)`. Replace the grab-bag of `duration-300/500` on links and `after:duration-500` on the nav underline with `var(--ease-default)` at 0.2s. Keep GSAP only for the footer wordmark parallax + hero word reveal; everything else CSS. The global `prefers-reduced-motion` guard exists — ensure new atoms inherit it (no per-element 300/500/1000 overrides). **Ambient stays near-zero by design** — pure black, no CRT/noise/vignette. The only ambient is the existing `MouseSpotlight` (fixed, `mix-blend-screen`), which the footer correctly occludes via `bg-canvas isolate`. Do not add particles/grids to the chrome; the single iridescent BrandMark dot is the entire brand-presence budget for the shell. Pages own their own ambient.

---

## Priority-ordered build table

| # | Page | Verdict | Effort | Why this rank | First moves |
|---|------|---------|--------|---------------|-------------|
| **1** | **SHELL** (nav/footer/tokens) | refine | M | Structural root of "every page feels generic." `CtaLink` + `Caption` + `Card`/`ListRow` atoms de-genericize all six pages at once and unblock them. | Build the 3 atoms; fence iridescent `primary` out of the shell; add the BrandMark dot; fix `trust-strip` rose-* → `st-critical` + `calibration-banner` `rounded-[10px]` → 0px. |
| **2** | **CHANGELOG** | refine | S→M | Two P0s ship **today**, independent of redesign: a live brand-contradiction (Fraunces/italic copy) and a broken public feed. | Edit `RELEASES[0]` bullets (drop Fraunces/italic); point `REPO` → public `pegana-replay` (no token). Then hero accent + de-terminalize feed. |
| **3** | **AGENTS** | rebuild | M | High-value code-as-proof is buried in a docs-page register; integrators have nowhere to click. Highest-conversion developer surface. | Reframe code as proof inside editorial cards; add hero iridescent span + spotlight + two solid/ghost CTAs; drop the standalone eyebrow + 4-up chip grid. |
| **4** | **AUDIT** | rebuild | M | A void during the exact calibration window curious early visitors land on. The countdown is the most ownable narrative on the site. | Build the calibration panel (editorial voice + mono countdown + inline pip) + sample receipt + skeleton + verify block; drop the eyebrow; one hero spotlight. |
| **5** | **PRICING** | rebuild | M | Highest-conversion brand surface with **zero CTAs in production** and no identity. | Hero accent on `latency` + spotlight + solid `Open the dashboard →`; break the 4-equal grid into a wide Free panel + reduced-weight upcoming row; kill `opacity-70`. |
| **6** | **METHODOLOGY** | refine | M | The trust spine; currently a README. Solve density + add signature. | Iridescent on `Replayable.` + spotlight; delete the mono kicker; de-mono + collapse the assets table; parse the changelog; 0px everywhere. |
| **7** | **ABOUT** | refine | S | Strongest copy, smallest gap. Two named fixes + a widget rebuild. | Wrap `read` in `text-iridescent` + masked spotlight; kill the `#feed7a` hex + bordered chips on the commit widget; reuse existing GSAP reveal infra. |
| **—** | **LANDING** | **keep** | XS | The DNA reference. Do not touch the hero. | Drop the phantom footer iri-thread from docs; regularize Channels status grammar to one axis. |

**Cross-page invariants to enforce on every build:** exactly two typefaces (Geist + JetBrains Mono, no serif, no italic); iridescent only in the closed approved-usage list (and `primary` iridescent fill is landing-hero-only — inner-page primaries are solid `bg-text`); 0px on cards/sections/rows, pills for CTAs, 4px for code chips; motion via `var(--ease-default)` / `var(--ease-out-strong)` only, 200–300ms interactive floor, **no `y>1` overshoot beziers**, no raw bezier literals in components; one ambient signature per page, confined to the hero; reveal-on-scroll via the existing GSAP infra, never a net-new `.reveal` CSS path; no standalone eyebrow+pip section headers.

---

## Open question for the owner

**Footer iridescent thread — reinstate or keep omitted?** It is on the sanctioned ammunition list (the v3 footer-opener pattern), but `site-footer.tsx` *deliberately* renders none today ("wordmark + columns + bottom row as one continuous block"). The methodology / agents / audit / pricing / changelog briefs all assume a footer iri-thread as their closing brand note, and the shell brief offers it as the one optional extra slot. **Decide once, globally:** (a) reinstate a 1px low-opacity hairline thread above the PEGANA wordmark on all long pages for a consistent closer, or (b) keep it omitted everywhere and let the BrandMark dot be the sole shell-level iridescent. I have written the briefs to work either way, but the inner-page closers should match the landing footer exactly — so this needs a single ruling before the shell atoms are built.
