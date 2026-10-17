# Pegana — Unified Design Direction (Inner Pages)

> Master spec, decision-ready. The single coherent system every inner page must follow so the site feels as crafted as the landing.
>
> Authority: `brand.md` overrides every line below. This document does not invent a new aesthetic — it extends the landing's proven language to the inner pages (`/methodology`, `/agents`, `/audit`, `/changelog`, `/pricing`, `/about`) and the marketing shell.
>
> Source of truth for tokens: `web/app/globals.css`. Source of truth for the landing recipe: `web/app/(marketing)/page.tsx` + the landing organisms.
>
> Audit basis: 2026-06-01 page sweep. Landing verdict = **keep** (it is the DNA reference). Inner-page verdicts ranged refine → rebuild; the common failure was **the brand signature is entirely absent and the page drifts toward developer-docs / terminal register.**

---

## 1. Design thesis

Pegana is **polished crypto SaaS, editorial dark** — the peer set is Phantom, Base, Helius, NEAR, not a Bloomberg terminal, not a CLI, not a hacker dashboard. The canvas is pure black `#000` with a quiet surface ladder and hairline structure; type is Geist sans carrying every headline, nav item, and body line, with JetBrains Mono scoped strictly to numbers, datestamps, captions, technical labels, and code. The single signature accent is the iridescent gradient `linear-gradient(90deg, #feed7a → #ff8400 → #df91f7)`, spent as **ammunition, never decoration** — one hero spotlight, one headline accent word, one primary CTA fill per page, and nothing else. Geometry is sharp (0px cards, sections, rows) with rounded-full pills reserved for actions; motion is ease-only (no springs), restrained, and always reduced-motion-safe. Every inner page must read as one confident editorial statement per section on black — never as a wall of monospace, never as a stack of identical-weight `h2 + paragraph + code-block` boxes.

---

## 2. Type system (Geist + JetBrains Mono only)

Two typefaces, fixed jobs. **No serif. No italic anywhere** — emphasis is weight (500/600) or color, never `font-style: italic`. Numbers always mono, `tabular-nums` where they align or tick.

### 2.1 Scale ladder

The brand fixes hero/section/h2 scales. This doc locks the **full** ladder, including the rungs `brand.md` left open (caption / number / the negative-tracking + leading contract), so components stop defaulting to Tailwind's `1.25`/`1.5` line-heights and arbitrary tracking.

| Role | Font / weight | Size | line-height | letter-spacing | Tailwind |
|---|---|---|---|---|---|
| **Hero h1** (landing only) | Geist 500 | `clamp(44px, 8vw, 128px)` | `0.96` | `-0.022em` | locked: `text-[44px] sm:text-[64px] md:text-[80px] lg:text-[104px] xl:text-[128px] leading-[0.96] tracking-[-0.022em]` |
| **Page / section h1** (inner) | Geist 500 | `clamp(40px, 6vw, 80px)` | `1.0` | `-0.018em` | `text-[40px] sm:text-[64px] lg:text-[80px] leading-[1.0] tracking-[-0.018em]` |
| **h2 subsection** | Geist 500 | `clamp(28px, 4vw, 40px)` | `1.08` | `-0.014em` | `text-[28px] sm:text-[40px] leading-[1.08] tracking-[-0.014em]` |
| **h3 / card title** | Geist 500 | `clamp(18px, 2vw, 22px)` | `1.15` | `-0.008em` | `text-[18px] lg:text-[22px] leading-[1.15] tracking-[-0.008em]` |
| **Body lede** | Geist 400 | `17px` | `1.6` | `0` | `text-[17px] leading-[1.6]` color `text-text-muted` |
| **Body** | Geist 400 | `15px` | `1.6` | `0` | `text-[15px] leading-[1.6]` color `text-text-body` |
| **Caption / label** | Geist **or** mono caps | `11px` | `1.4` | `+0.08em` (uppercase) | `text-[11px] uppercase tracking-[0.08em]` color `text-text-caption` |
| **Number / stat** | **Mono 500** | `clamp(28px, 4vw, 48px)` | `1.0` | `-0.01em` | `font-mono tabular-nums text-[32px] lg:text-[48px]` color `text-text` |
| **Inline number** | **Mono 400/500** | inherits | inherits | `0` | `font-mono tabular-nums` |

### 2.2 Negative-tracking contract (the highest-ROI uplift)

Tracking scales **down** with size and **up** at caption scale. This is the primary separator between premium and AI-generic sans. Add to the Tailwind `@theme` so components reference tokens, not literals:

```
--tracking-hero:     -0.022em;   /* landing h1 only */
--tracking-display:  -0.018em;   /* inner page/section h1 */
--tracking-heading:  -0.014em;   /* h2 */
--tracking-subhead:  -0.008em;   /* h3 / card title */
--tracking-body:      0em;       /* all body + lede */
--tracking-caption:  +0.08em;    /* uppercase captions/labels */
```

### 2.3 Leading contract (lock all five — close the brand.md gap)

```
--leading-hero:    0.96;   /* landing h1 */
--leading-display: 1.0;    /* inner h1 / section headlines */
--leading-heading: 1.08;   /* h2 */
--leading-subhead: 1.15;   /* h3 / card title */
--leading-body:    1.6;    /* body + lede */
```

### 2.4 Two caption registers (both legal, do not conflate)

- **Large all-caps marker** — Geist 500, `clamp(18px, 2.5vw, 32px)`, uppercase, `tracking-[-0.01em]`, `text-text`. Use for structural group markers on dense pages (e.g. asset-class dividers `STABLECOINS · LSTs · DEFI`, methodology section breaks). Sits **above** a hairline rule, never inside a card header, never with a pip.
- **Small caption** — `11px`, uppercase, `tracking-[0.08em]`, `text-text-caption`. Datestamps, filter counts, util-strip copy, footer column titles, inline `last synced 4m ago`.

### 2.5 Mono scope (hard boundary)

Mono is **only**: numbers, datestamps, `sha256…` hashes, methodology version strings (`v0.2.0`), technical labels (`REST` / `WS` / `MCP` / `GET`), rate values, code snippets, and the typeset formula. Mono is **never**: headlines, nav, CTA labels, filter words (`all` / `feature` / `fix`), section titles, prose, or a full English sentence styled as a "spec line." A sentence in mono caps under a headline is the forbidden terminal-echo tell — use a Geist `17px` `text-text-muted` lede instead, and demote any literal formula to a small mono caption **below** it.

---

## 3. Color + surface usage

Pure black canvas, quiet ladder, color spent only where it carries meaning. **Never bare Tailwind color classes** (`bg-gray-900`, `text-blue-500`, `border-rose-500`) — always tokens.

### 3.1 Tokens (from `globals.css` — source of truth)

| Token | Hex | Role |
|---|---|---|
| `--color-canvas` | `#000000` | Page background. Pure black, no off-black. |
| `--color-surface-1` | `#0a0a0a` | Cards, raised surfaces, util-strip |
| `--color-surface-2` | `#141414` | Inner panels, stat-strip backdrop |
| `--color-hairline` | `#1a1a1a` | Default borders, dividers, dotted-grid dots |
| `--color-outline` | `#2a2a2a` | Interactive borders, ghost-pill border, focus rings, plus-marks |
| `--color-text` | `#fffdf9` | Headlines, interactive, primary copy |
| `--color-text-body` | `#e8e8e8` | Long-form copy, bold-tail emphasis span |
| `--color-text-muted` | `#9aa9b8` | Labels, lede, secondary copy |
| `--color-text-caption` | `#9a9a9a` | Smallest captions, datestamps (raised for ~4.6:1 — do not lower) |
| `--color-coral` | `#ff8a5b` | Bracket left, "NEW" chip, state-pip drift family accents |
| `--color-magenta` | `#e878d8` | Bracket right |
| `--color-st-pegged` | `#6bd697` | State pip — green (included/healthy) |
| `--color-st-drift` | `#c08a55` | State pip — amber |
| `--color-st-depeg` | `#a55a5a` | State pip — rose |
| `--color-st-critical` | `#b73838` | State pip — red |
| `--color-st-unknown` | `#9aa9b8` | State pip — neutral / future-state |
| `--gradient-iridescent` | `linear-gradient(90deg,#feed7a,#ff8400,#df91f7)` | The single signature accent |

### 3.2 Monochromatic-surface + single-chromatic-moment rule

Everything that is not (1) the iridescent ammunition, (2) a state pip, or (3) the brand-mark brackets must be `surface-1` / `surface-2` / `hairline` / `outline` / the text ladder. No colored icon backgrounds, no tinted section gradients, no colored dividers, no `border-rose-*` literals. If everything else is near-black, one chromatic element gets maximum pop for free.

### 3.3 Iridescent ammunition budget (per page)

Approved usages, **closed list**: BrandMark dot, primary CTA fill, hero spotlight, hero headline accent `<span class="text-iridescent">`, methodology variable underlines (SVG stroke), footer iri-thread. Per inner page the realistic budget is **one hero spotlight + one accent word + (at most) the coral/state accents the data already needs.** Every additional use dilutes the weapon and is a brand exception requiring explicit justification.

Two hard fences from the audit:
- **The iridescent *fill* primary CTA is landing-hero-only.** On inner pages the primary action is the **solid white pill** (`bg-text` / `text-canvas`), the ghost pill is the secondary. Do not reach for the iridescent fill outside the landing hero.
- **The marketing shell (nav/footer) fires iridescent exactly once** — the BrandMark dot (a single 6px gradient point) — and never as a nav-CTA fill or hover-reveal gradient line.

### 3.4 State color = meaning, carried by the pip

A peg state is communicated by the **pip** (a colored dot, optionally its own `0 0 8px` glow — the only glow permitted, on the pip itself, never as a halo around text), plus a Geist/mono label. Do **not** re-letter the state as a bordered colored text chip standing in for the pip. Tag chips stay sharp (0px, or 4px for code chips); the pip carries the color semantic.

### 3.5 Selection + washes

`::selection { background: rgba(255,132,0,0.35); color: var(--color-text); }`. Wash tints (`--color-wash-*`) are for row/state backgrounds at ~10–14% only; never as a section background.

---

## 4. Shared component primitives (build once, reuse everywhere)

The structural root of "inner pages feel generic" is that the CTA, caption, and card are open-coded on every page (9+ solid-pill call sites, 15+ ghost-pill, 72 files re-deriving the caption tracking). Build these atoms once; migrate call sites; delete the contradictory `pill.tsx` button atom or refit it as the icon-button base.

> Naming guard: do **not** create an atom named `Eyebrow` — the eyebrow+pip+label section pattern was deleted in v3. The typographic primitive is named **`Caption`** and may never carry a pip slot or act as a section header.

### 4.1 `Caption` (mono/Geist caps label)

- One locked tracking value: `uppercase tracking-[0.08em]`, `text-[11px]`, `text-text-caption`.
- Mono when the content is a number/datestamp/tech-label; Geist otherwise.
- Inline only. No pip. Replaces the scattered util-strip / trust-strip / footer / filter caption variants.

### 4.2 Section header (no eyebrow)

- Headline stands alone at the §2 h1/h2 scale + tracking + leading tokens. **No eyebrow, no `(01)` number, no pip row above it.**
- Optional: a single trailing count rendered as a `TagPill` (e.g. `22 assets`) or a large all-caps marker (§2.4) above a hairline rule.
- Total header chrome height capped ~64px on dense/table surfaces (content-forward restraint).

### 4.3 `Card` / `ListRow`

```css
.card {
  border: 1px solid var(--color-hairline);
  border-radius: 0;                 /* sharp is the structure */
  background: var(--color-surface-1);
  transform: translateY(0);
  transition: transform 0.35s var(--ease-default),   /* NO overshoot — no y>1 */
              border-color 0.2s var(--ease-default);
}
.card:hover { transform: translateY(-3px); border-color: var(--color-outline); }
/* state-semantic rows: hover border shifts to color-mix(in srgb, var(--color-st-*) 40%, transparent) */
/* NEVER box-shadow on a card (vanishes / muddies on pure black) */
```

`ListRow` is the reusable single-column editorial pattern (Channels, asset browser, commit feed): full-width, 0px, hairline `border-top`, `py-5`, `group-hover:bg-text/[0.015]`, optional `::before` 2px left-edge accent bar sliding in (`scaleX 0→1`, `0.2s`, origin-left) in `--color-coral` or the row's state token. **Prefer the ruled list over a card grid** for any "list of things."

### 4.4 Button pills (`CtaLink`, Link-based)

Three variants, `rounded-full px-7 py-3.5 text-[13px]`, with arrow glyphs (`→` forward, `↓` down, `↗` external). All transitions use `var(--ease-default)`.

| Variant | Surface | Hover | Where |
|---|---|---|---|
| `primary` (iridescent) | `background: var(--gradient-iridescent)` | `opacity 0.15s → 0.90`; **never transition the gradient itself** | **landing hero only** |
| `solid` | `bg-text text-canvas` | `0.15s bg → bg-text/85` | inner-page primary, header CTA |
| `ghost` | `border border-outline text-text` | `0.2s border→text + bg-text/[0.04]` | secondary, most sections |

Press feedback on all: `active:scale-[0.985]` at `0.12s`. Fence the `primary` variant so it lints/throws outside `app/(marketing)/page.tsx`; the shell only imports `solid` / `ghost`.

### 4.5 `TagPill` (status / capability / category)

- Outlined = informational; filled = action (so most tags are outlined).
- `rounded-full border border-outline px-3 py-1 text-[11px]`; the value/number inside is mono `tabular-nums`, the word is Geist.
- Category counts, capability tags (`free` / `paid · x402` / `no-client`), asset-class chips. Not a section positioning strip — never a uniform 4-up `OPEN SOURCE · MIT` grid (AI tell).

### 4.6 `Stat`

- Mono `tabular-nums` numeral at `clamp(28px,4vw,48px)` `text-text` over a Geist `12px` `text-text-muted` label.
- Lives on a `surface-2` strip with `border-y border-hairline`, `divide-x divide-hairline` between cells.
- **Factual numbers only — do not animate** decorative metric strips (count-up is reserved for a single genuine hero metric, §6). Never advertise a broken count (e.g. "Commits 1 / Past 7 days 0").

### 4.7 Code-as-proof frame

Code is **evidence inside an editorial container**, never the page body. Frame, don't dump.

- Wrapper: 0px radius, `border border-hairline`, `bg-surface-1`, a small mono caption label above (`TypeScript` / `curl` / `shell`), a copy affordance.
- Inline identifiers (`evidence_url`, `receipt_sha256`) render as **code chips** (4px radius, `bg-text/[0.06]`), not a `<pre>` block.
- Never pipe a raw `CHANGELOG.md` into `<pre>`. Parse into versioned cards (mono version+date header, state pip + label, Geist bullets) or collapse to latest 1–2 with a "Full changelog on GitHub ↗".

### 4.8 Empty state (designed, not a notice box)

- Shape-matched to the real content it replaces, with a clear message and a way forward (CTA). Never a single tinted bordered notice centered in a void.
- For an intentional quiet window (e.g. calibration), tell the story: a `surface-1` panel with a live status sub-line, a mono `tabular-nums` countdown, and a one-line plain-Geist explanation — confident, not apologetic. Pair with a **sample / redacted** card showing the shape the live feed will take.

### 4.9 Skeleton (shape-matched)

- Ghost rows at the **exact dimensions** of the real rows (same column rhythm), hairline borders, `surface-1` shimmer blocks. No spinner, no "loading…" text.
- Shimmer wrapped in `prefers-reduced-motion: reduce` (static on reduce). Distinct, designed degraded state when a feed is unreachable — never a single fallback row that looks identical to real data.

---

## 5. Section rhythm (how dark sections breathe)

- **Vertical padding (locked).** Landing sections `py-[120px] sm:py-[160px]`; marketing inner pages `pt-20 pb-24 sm:pt-28 sm:pb-32`. Gutters always `px-5 sm:px-8 lg:px-12 xl:px-20`; wrap `max-w-[1280px]`.
- **One dominant statement per section.** Generous black between sections is the rhythm. Whitespace-as-statement: isolate the load-bearing editorial paragraph or formula to its own section (`min-height: ~60vh`, centered, `max-width: 540–600px`), no adjacent icon grid or bullet list competing.
- **No alternating surface bands.** The page is pure `#000` throughout; "alternation" comes from a section being a ruled list vs an editorial paragraph vs a framed proof block vs a stat strip — **layout register varies, the canvas does not.** The only non-`#000` surfaces are `surface-1`/`surface-2` cards and the single `surface-2` stat strip. Never tint a whole section background.
- **Bold-tail isolation.** The editorial paragraph is the only child in its row (max-width ~540px), load-bearing clause in `<b class="text-text-body font-medium">` — no size change, no color:coral/magenta on body copy, no italic.
- **One ambient moment per page, in the hero only.** A low-opacity iridescent hero spotlight (`radial-gradient(ellipse 80% 60% at 50% 0%, rgba(254,237,122,0.13) 0%, rgba(255,132,0,0.08) 35%, rgba(223,145,247,0.06) 60%, transparent 100%)`) that fades to pure `#000` before the first section. Everything below is black + hairline structure. Resist a second glow, grain, or particle field per section. Optional ambient bokeh orbs (CSS `blur(80px)`, 8–14% opacity, periphery-only, `pointer-events:none`, `aria-hidden`) may bleed hero light into the next section but must never overlap headline/CTA.
- **Page closer.** Every long inner page reuses the giant `PEGANA` wordmark closer (`clamp(64px,20vw,320px)`, weight 600, `tracking-[-0.045em]`, `leading-[0.85]`, white→translucent `--wordmark-fill`, NOT iridescent, parallax scrub) → footer. Continuity across surfaces. The footer iri-thread is the one extra sanctioned ammunition slot (1px, low opacity, above the wordmark) — optional, off by owner direction today.
- **Per-page north-star moment.** The landing's typeset fraction is the model: each inner page should find ITS own type-as-hero equivalent (a dominant number, an equation, a state diagram, a sample receipt) rendered with that confidence — not a sixth identical `h2 + paragraph + box`.

---

## 6. Motion (timing table — never 300/500/1000ms arbitrary)

Ease only, no springs. **No control point may exceed y=1** (a `cubic-bezier(.34,1.4,.64,1)` overshoot is a banned spring — use `--ease-default` instead). Reference tokens, not raw bezier literals.

| Interaction | Duration | Ease |
|---|---|---|
| Color swap (links, icons) | `0.12s` | `var(--ease-default)` |
| Button background / pill bg | `0.15s` | `var(--ease-default)` |
| Lift / underline / row bg / border swap | `0.2s` | `var(--ease-default)` |
| Card lift (translateY -3px) | `0.35s` | `var(--ease-default)` |
| Disclosure (max-height/opacity) | `0.35s` | `var(--ease-default)` |
| Reveal-on-scroll fade-up | `0.7s` | `var(--ease-out-strong)` |
| Big entrance (hero headline) | `0.8s` | `var(--ease-out-strong)` |
| Hero spotlight / canvas fade-in | `1.2s` | `var(--ease-out-strong)` |
| Ambient orb drift (environmental) | `25s` | `ease-in-out` |

- **Reveal-on-scroll:** IntersectionObserver (`threshold 0.12`, `rootMargin '0px 0px -48px 0px'`) toggling a `.reveal` CSS class — `opacity 0→1` + `translateY(7px)→0` over `0.7s var(--ease-out-strong)`. Stagger via `--reveal-delay` in `0.05s` steps, capped `0.30s` total. **Not framer-motion** — IO + CSS is paint-thread-safe at 60fps. (House caveat: the hero headline word-reveal stays on the existing GSAP timeline + `useReducedMotionGsap` so it matches the landing exactly; the about/methodology pages already have GSAP reveal infra — reuse it rather than building a parallel `.reveal` path where GSAP is already wired.)
- **Counter tick** (single genuine hero metric only): count to value over `0.8s` ease-out, mono `tabular-nums` so the container never reflows; `unobserve` after first trigger. Decorative stat strips do **not** tick.
- **Reduced motion:** every animation wrapped in `prefers-reduced-motion`. Global rule: `@media (prefers-reduced-motion: reduce){ .reveal,.section-reveal{ transition-duration:.01ms!important; transform:none!important; filter:none!important } }`. Static fallback must look intentional (the spotlight and ruled structure already do).
- **GSAP only** for the one hero word-reveal and the one wordmark parallax. Composite-only transforms for the hero spotlight lerp. Everything else is CSS. No spring/damping/stiffness anywhere.

---

## 7. "Generic-AI tells" checklist (avoid)

- [ ] Single narrow centered column of identical-weight `h2 + paragraph + bordered box` repeated 5–6×, no scale/layout variation, no full-bleed moment.
- [ ] Eyebrow + pip + label above a headline; `(01)`/`(02)` section numbers. (Deleted in v3.)
- [ ] Uniform 4-up positioning/trust strip (`OPEN SOURCE · MIT · ETC`) — badges row that signals trust without earning it.
- [ ] Metric strip that broadcasts brokenness (`Commits 1 / Past 7 days 0`) or animates decoratively.
- [ ] Code-block-as-content: stacked raw `<pre>` panels with a one-line lede each; raw `CHANGELOG.md` piped into `<pre>`.
- [ ] `opacity-70` on a whole card to mean "coming soon" (keep structure crisp; signal future-state with copy + an `st-unknown` pip + ETA).
- [ ] Card grid where a ruled list would read more editorial; equal-width tier cards with no recommended-tier hierarchy.
- [ ] CTA stranded in the footer / a flagged-off section; a hero with nowhere to click.
- [ ] Headline that labels the data structure ("Last 50 non-pegged alerts.") instead of making a claim.
- [ ] Bold-tail paragraph cluttered by an adjacent icon row, pill, or column (kills the editorial effect).
- [ ] Monochrome page with zero spent ammunition (no spotlight, no accent word) — "minimal = safe" default.
- [ ] Responsive type-swap on the same label (mono caps mobile → sans normal-case desktop) — reads as two design languages.
- [ ] Bare Tailwind color classes / hardcoded hex (`border-rose-500/40`, `text-[#feed7a]`) instead of tokens.
- [ ] Default tracking + `line-height: 1.25/1.5` on display headlines (the single biggest AI-vs-premium sans tell).

## 8. "Terminal tells" checklist (avoid — locked rule, corrected multiple times)

- [ ] Mono as the default for body / headline / nav / CTA / filter words / section titles.
- [ ] A full English sentence rendered in mono caps as a "spec line" under a headline (terminal-echo).
- [ ] Page register dominated by monospace: dense 20+ row all-mono table flanked by stacked dark code panels = developer README, not editorial SaaS.
- [ ] Phosphor / terminal green (`#0f0`, `#33ff33`) — peg-state greens are muted, not phosphor.
- [ ] CRT effects: scanlines, flicker, glow halos around **text**, chromatic aberration, vignette, noise overlays as "monitor texture." (Pip's own `0 0 8px` glow is the only permitted glow.)
- [ ] ASCII / box-drawing borders, `>`/`$` prompt prefixes, blinking cursors.
- [ ] `[INFO]`/`[OK]`/`[ERROR]` output-stream decoration; checkmark glyph (`✓`) standing in for a state pip.
- [ ] Bordered uppercase `FEATURE`/`FIX`/`INTERNAL` mono chips as a commit/changelog feed → ops-feed register.
- [ ] Fake terminal windows with red/yellow/green traffic-light dots as a container.
- [ ] "Terminal-dense" / "Bloomberg" / "ops console" / "CLI-first" / "engine live"-as-status-readout framing in copy, eyebrows, section titles, or rationale.

---

## 9. Per-page application (from the audit)

| Page | Verdict | The one move that fixes it |
|---|---|---|
| **Landing** | keep (DNA reference) | Don't touch the hero/formula. Only refine: regularize Channels status-grammar (trailing token = one consistent axis); footer has **no** iri-thread today (don't silently reintroduce). |
| **Methodology** | refine | Add the missing signature: accent `<span>` on one word + hero spotlight. Replace mono-caps formula *sentence* with a Geist lede; demote literal formula to a mono caption. Collapse the 22-row asset table (summary + 6 rows + "Show all →"), de-mono Class/Peg-target. Parse the changelog. 0px everywhere (kill `rounded-sm`). |
| **Agents** | rebuild | Stop the four stacked code panels. Reframe `verify_alert` / `subscribe_peg_events` / REST into a 3-up card grid with **code-as-proof** inside each. Accent word + spotlight + two hero pills (solid primary, ghost secondary — **not** iridescent fill). |
| **Audit** | rebuild | Replace the lone calibration notice with a designed panel (live sub-line, mono countdown, plain explanation) + a **sample/redacted receipt** + shape-matched skeleton + promoted "verify-it-yourself" block. Accent word, one spotlight only. No eyebrow/pip header. |
| **Changelog** | refine | P0 copy fix: delete the `Fraunces serif italic` bullets (they advertise a forbidden aesthetic live). Fix data source → public `pegana-replay` repo. Delete the broken 4-up stat strip. De-terminalize the commit feed (group by day, Geist blurb, mono only on date+sha, sharp token chips not mono words). Accent word + spotlight. |
| **Pricing** | rebuild | Give it identity: accent word + spotlight + a **hero CTA** (solid white "Open the dashboard →" — the free tier is live). Break the 4-equal grid (wide active Free panel + reduced-weight upcoming tiers, crisp borders not `opacity-70`). Card hover-lift. Add FAQ. 0px cards/inputs. |
| **About** | refine | Accent `<span>` on one word + masked spotlight. Kill the `#feed7a` hex + bordered FEATURE/FIX chips on the commit card (raw-hex + iridescent-outside-ammunition). Bold-tail the prose; give the four contact channels hierarchy (one solid pill, rest ghost). |
| **Shell** | refine | Build the primitive layer (`CtaLink` solid/ghost, `Caption`, `Card`/`ListRow`). Add the **one** iridescent BrandMark dot. Inner-page nav gets `border-b border-hairline`; scroll-materialise on landing. Standardize footer column titles to one Geist treatment. Fix `TrustStrip` raw `rose-*` → state tokens; CalibrationBanner rounded surfaces → 0px. |

---

## 10. Build order (recommendation)

1. **Tokens + primitives first** — `--tracking-*` / `--leading-*` ladders into `@theme`; `CtaLink`, `Caption`, `Card`/`ListRow`, `TagPill`, `Stat`, code-as-proof frame, `EmptyState`, `Skeleton`, `.reveal` + global reduced-motion rule. Migrate the ~24 open-coded pill call sites. This single layer removes most "feels generic" drift.
2. **P0 copy/data fixes** (decoupled from visual work) — changelog Fraunces/italic bullets; changelog data source → public repo; about `#feed7a` hex; shell `rose-*` → state tokens. These are live brand contradictions shipping today.
3. **Page rebuilds** by ROI — pricing → agents → audit → changelog → methodology → about.

---

### Open question for the owner

`brand.md` lists the footer iridescent thread as a sanctioned ammunition slot, but the live `site-footer.tsx` deliberately omits it (the wordmark + columns read as one continuous block). Two paths conflict: do you want the 1px iri-thread reinstated above the `PEGANA` wordmark on long inner pages as the page-closer brand note (per `brand.md`), or kept omitted everywhere (per the current footer's owner-direction comment)? Pick one so every page's closer is consistent.
