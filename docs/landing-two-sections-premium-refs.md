# Landing: "four surfaces" + trust section, premium redesign references

Captured live 2026-10-20, Playwright, 1440x900 viewport, production https://www.pegana.xyz and the reference sites below.
Scope is exactly two sections: A = `web/components/organisms/v2/product-tabs-v2.tsx` (`#product`) and B = `web/components/organisms/v2/trust-scene-v2.tsx` (first child of `#trust`; the candor block under it is out of scope and excluded from every B number).
Owner verdict being answered (verbatim): "Não está nada PREMIUM; está cheio de informações e totalmente FEIO".

Screenshots: `docs/refs/two-sections/` (png, not committed). Every number below is read from computed styles / DOM in that session, not recalled.

Measurement notes (read before trusting a number)
- "Section" for references = the nearest ancestor of the matched heading that is >=380px tall (or 1100px wide), capped at 2400px. It can include neighbouring blocks; where a capture is obviously a partial slice it is flagged.
- `words` = whitespace-split `innerText` of that element (includes code tokens and UI labels). `vis` = visible descendant elements. `ui` = buttons + links + role=tab. `colors` = distinct computed text colours. `vp` = section height / 900.
- Fixed navbars appear over some screenshots (Linear, Goldsky, Railway, Arcjet, Warp); cookie banners over Svix/Railway/Arcjet. They are page chrome, not section content.
- Several sites follow the OS colour scheme; Stainless, Supabase, Warp, Svix, Firecrawl, Browserbase, Goldsky, Sigstore, Swimm, Mercury rendered light in this browser. Layout numbers are theme-independent; colour verdicts are noted per site.

---

## 1. Quantified diagnosis of the current sections

### A. `#product` (live, REST tab selected)

| Metric | Value | Read |
|---|---|---|
| Height | 1010px = 1.12vp | one section, more than a viewport |
| Words visible (default state) | 138 | |
| Visible DOM elements | 154 (91 carry text) | |
| Interactive controls on screen | 8 (4 surface squares, 3 variant tabs, 1 copy) | two stacked selector systems |
| Distinct font sizes | 8 (50, 23, 17, 15, 14.5, 14, 12.5, 12) | 14.5 and 12.5 are half-steps off the DESIGN.md scale |
| Distinct text colours | 5 | |
| Code panel | `pre` 638x410, Geist Mono 14/21, 18 lines | |
| Behind the tabs (from source) | 4 surfaces x (title + lead + 3 bullets), 9 payloads, about 290 words of non-code copy and 102 code lines | the "crammed" feeling is reachable depth, not only the first screen |

Structural diagnosis (screenshot `pegana-A-current.png`)
1. Five stacked text layers say the same thing before any code appears: h2, section lead, panel h3 ("One GET, the whole verdict."), panel lead, three bullets. The bullets restate fields that the payload next to them already shows (state, discount, thresholds).
2. Two selector systems for one choice: four 100px glyph squares outside the panel, then a second tab strip inside it, then a path bar, then a caption bar. Five horizontal bands inside one 410px panel.
3. Nine payloads for four ideas. board, stats, heartbeat, get_assets, json are variants nobody asked for; each costs a tab, an icon and a caption.
4. Icons carry no information: 4 surface glyphs plus 9 variant glyphs plus copy.
5. Real defect: the sizes 14.5 and 12.5 and 17 are off-token; the left column is ~40% empty below the bullets (visible in the capture).

### B. trust scene (live)

| Metric | Value | Read |
|---|---|---|
| Height | 982px = 1.09vp | |
| Words | 112 | |
| Visible DOM elements | 105 | |
| Text nodes at 12px mono | 36 | a dashboard rendered at caption size |
| Icons | 6 lucide icons + 3 icon boxes for 3 steps | the verb is drawn twice per card |
| Eyebrow | 1 ("verifiable, not a black box") | spends one of the page's two allowed eyebrows |
| Nested chrome | 3 cards, each with number + icon box + h3 + desc + inner artifact card with its own header bar and second icon | card inside card |
| Floor violation | `text-[11px]` on the "copy hash" label (`trust-scene-v2.tsx:188`) | below the 12px floor in DESIGN.md |
| Honesty defect | frozen `now` shows `2026-06-16T00:01:15Z`; the bundle value is `2026-06-16T00:01:15.884348512Z`. `discount_raw` shows 27 chars fewer than the bundle's `0.032208507799922078945643858`. Values are silently truncated, not marked with an ellipsis | repo rule: payload samples verbatim |

Structural diagnosis (screenshot `pegana-B-current.png`)
1. Three equal cards in a row is the default dev-tool "how it works" layout; the thing that makes the product different (a diff of two hashes) is the smallest, bottom-right object.
2. The match step is rendered as 3 rows of 12px text while step 01 gets 7 rows. The visual weight is inverted: the payoff has the least weight.
3. Each step says its verb four times: title, desc, artifact header ("inputs_frozen"), icon.
4. The recompute sweep is a decorative 200ms gradient that proves nothing; it exists only in DESIGN.md's motion table.
5. The bottom bar splits the one action (copy command, open /audit) into two small mono controls.

---

## 2. References

Discovery log (galleries): `landing.love/categories/development` (44 sites, gallery blurb: "code samples are part of the layout and clarity outranks polish"; thumbnail grid only, screenshot `gallery-landinglove-development.png`), `saaspo.com` page-types How it works (15), Product (336), Integrations (56) (screenshot `gallery-saaspo-how-it-works.png`) produced the domains firecrawl.dev/agent, browserbase.com/browsers, cloudflare browser-rendering, cartesia.ai/sonic, mercury.com, swimm.io, readme.com/ai, hex.tech, glassflow.dev. `recent.design`, `curated.design`, `unsection.com`, `designvault.io` (now screensdesign.com) were opened: portfolio, app-screen and section-thumbnail catalogues with no dev-tool names, no use. `mnmm.xyz` failed DNS (ERR_NAME_NOT_RESOLVED). Not visited: noiced, pixel-perfect (it is a UI kit site), collectui, scene ai, navbar.gallery, cta.gallery (CTA-only), namethatui, originkit. Reference choice therefore came from saaspo domains plus the owner's named dev-tool candidates, each opened live. readme.com/ai and raycast.com returned no measurable section (auto-selector empty); not used.

### 2.A Multi-surface API / SDK code sections (12 sites measured, 10 listed)

| # | Site and section | Screenshot | Captured numbers | Verdict |
|---|---|---|---|---|
| A1 | resend.com "Integrate this morning" | `resend-A.png` | 1.44vp, 110 words, 318 vis, 25 interactive, h2 56/67.2 w400 ls -2.8 centred, code `pre` Commit Mono 14/20 1022x500, panel radius 24px, border `rgba(214,235,253,.19)`, panel bg transparent, transitions .15-.2s, 8 text colours | STEAL the panel: transparent fill, 1 hairline, dim line numbers, one icon-only copy button top right, GitHub / Download as two quiet footer links. AVOID the 12 icon tiles + 9 framework tabs (25 controls is the exact disease pegana has) |
| A2 | stainless.com hero code panel | `stainless-A.png` | 0.61vp (546px), 82 words, 78 vis, h2 40/48 w600 ls -1.6 measure 580, code 14/21, 7 language tabs at 12px 8x16 padding, no transition, light theme | STEAL the proportion: one h2, one 3-line paragraph, one button, one panel, 0.61vp total. AVOID 12px coloured-logo tabs and the underlined inline links inside the lead |
| A3 | supabase.com "Use Supabase with React" | `supabase-A.png` | 0.77vp, 47 words, 129 vis, 7 interactive, h2 34/37.8 w600 two-tone (grey + black), code 13/22.1, six equal 90px icon-only tab cells separated by hairlines, transition .15s | STEAL the equal-width hairline cell tab row and the 2-colour headline that names the active surface. AVOID 13px code (under the 14px floor) and the empty left column |
| A4 | firecrawl.dev/agent request/response | `firecrawl-A.png` | 0.66vp, 105 words, 88 vis, 5 interactive, code 13/20, `pre` 556x508, window 1112 wide, 4 tabs (Python, Node.js, cURL, CLI), `[ INPUT ]` / `[ .JSON ]` corner labels, copy at right, .2s, 5 colours | STEAL request and response side by side in ONE window with tiny corner labels. AVOID traffic-light dots and 13px code |
| A5 | browserbase.com/browsers | `browserbase-A.png` | 0.6vp, 65 words, 52 vis, 3 interactive, 14px x40 text nodes, code 16/24 1238x434, 2 tabs only (TYPESCRIPT / PYTHON, uppercase, 2px accent underline), .2s | STEAL zero prose around the code and 2 tabs max. AVOID the tinted panel and bold-keyword syntax (heavy) |
| A6 | cloudflare.com/products/browser-rendering | `cfbr-A.png` | 0.56vp (502px), 98 words, 102 vis, 10 interactive, code 14/21 gutter `01..10`, panel left ~612 wide, right rail of 3 text rows (title + one line), active row filled with 3px accent bar at left, transitions .1/.2s | STEAL the right-hand rail of text rows with an active bar: closest model for pegana's four surfaces. AVOID the second tab row inside the panel (curl / playwright.ts / curl) |
| A7 | stripe.com/payments "docs" block | `stripe-A.png` | 1.11vp, 150 words, 164 vis, 22 interactive, code 14/24 655x344 with line gutter, 7 language tabs, eyebrow + h2 + paragraph + 6 green-check bullets + CTA + sub-card, 14px x64 | AVOID as a pattern. This is the template pegana A currently follows (check bullets, language tabs, paragraph). STEAL only the 14/24 leading and the dim gutter |
| A8 | svix.com "Integrate with just a few lines of code" | `svix-A.png` | 0.78vp, 69 words, 120 vis, 14 interactive, h2 32/32 w300, code 16/19.2 872x326, 260px vertical language rail with logos + 2 link cards under the panel, .1-.15s | STEAL a left vertical rail next to a ~870x326 panel. AVOID logo bloat, w300 headline, link cards under the panel |
| A9 | turso.tech "From zero to a database per entity" | `turso-A.png` | 0.59vp (531px), 74 words, 35 vis (26 text), 4 interactive, h2 36/40 w700 ls -.9 measure 444, code 13/24 664x376, 3 filename tabs with a 2px underline and a `TURSO` mono tag at right, 11 colours, .15s | STEAL 5/7 column split, the file-name-as-tab idea, one CTA. AVOID 13px code, a mint pill CTA, 11 text colours |
| A10 | trigger.dev "Reliable by default" | `triggerdev2-B.png` | 0.75vp, 107 words, 252 vis, 6 interactive, h2 30/36 w600, code 14/20 765x460, left list of 5 selectable cards (title + one line), active card filled, .15-.3s | STEAL the left selector list where each item is a title and one dim sentence, active item filled. AVOID five items; four is the pegana ceiling |

Cross-reference takeaways (A), derived from the measurements above
- Best sections are 0.56-0.78vp; pegana A is 1.12vp. Only Resend and Stripe exceed 1vp and both carry 22-25 controls.
- Words (non-code prose) in the strong ones: 65-82 total including labels; pegana A shows 138.
- Controls: 3-10 in the strong ones (Browserbase 3, Turso 4, Trigger 6, Supabase 7, Cloudflare 10); pegana A 8 across two levels.
- Code: 14px is the floor in the good ones (Resend, Stainless, Stripe, Cloudflare, Trigger at 14; Browserbase and Svix at 16). 13px (Turso, Supabase, Firecrawl) is rejected by DESIGN.md.
- Tab chrome that works: icon-less text tabs, or hairline cells, or a left rail. None of the strong ones use two selector levels.
- Motion in all ten: 0.1-0.3s transitions on hover/active only; nothing scroll-bound in the code panel.

### 2.B How it works / verification / proof sections (12 sites measured)

| # | Site and section | Screenshot | Captured numbers | Verdict |
|---|---|---|---|---|
| B1 | linear.app "Build, review, and ship" | `linear-B.png` | 1.35vp, 288 words, 606 vis, 11 interactive, h2 48/48 w510 ls -1.056 measure 542, code 14/24 560x432 with line gutter and red/green full-row diff highlights, 12 colours, .1-.2s | STEAL the diff mechanic: line gutter, whole-row tint on changed lines, nothing else on the panel. This is the model for the "match" step. AVOID everything around it (288 words, 606 nodes: issue list mock + feature accordion) |
| B2 | metera.xyz "Your agent says what. Metera handles how." | `metera2-A.png` | 0.8vp, 25 words, 33 vis, 11 text nodes, h2 48/55.7 w500 ls -1.44 measure 624, one bordered panel ~1120x330 split about 60/40: left = input line + 6-node stepper (Policy, Build, Verify, Sign, Execute, Landed) at 13px, right = "Execution log"; .3s typing | STEAL one panel, one stepper whose nodes are the real verbs, an evidence pane beside it, 25 words in total. AVOID the autoplay typewriter (violates restraint) |
| B3 | metera.xyz "Every execution has a trail." | `metera-B.png` | 0.65vp, 35 words, 14 vis, 4 text nodes, 1 link, h2 48/55.7 ls -1.44, 17px body, halftone illustration right, light section | STEAL the copy budget: h2 + 2 sentences + 1 link. AVOID the illustration and the lime highlighter on a phrase (no evidence in it) |
| B4 | arcjet.com "Observe. Enforce. Audit." | `arcjet-B.png` | 1.54vp, 188 words, 106 vis, 3 interactive, h2 40/48 w700 with coloured words, I / II / III stacked cards, mono log pills `14:32  claude v2.x  support.reply.send`, 34 nodes at 12px, .1-.6s | STEAL the log-row micro-format (time, actor, action in mono) as proof-by-artifact. AVOID 1.54vp, gradient words in the headline, roman-numeral stacked cards (these read as scroll-driven in the capture; not verified, avoid anyway) |
| B5 | sigstore.dev "What is Sigstore?" | `sigstore-B.png` | 1.0vp, 41 words, 4 vis, 2 text nodes, h2 54/60 w500 centred, 24px body, one paragraph, pastel full-bleed, .75s | STEAL the restraint: one headline and one paragraph hold a whole viewport. AVOID it as the proof step: there is no artifact at all |
| B6 | svix.com "Webhooks your security team will sign off on." | `svix-B.png` | 0.54vp, 59 words, 28 vis, 10 text nodes, h2 32/32 w300, mono 12px eyebrow, one hairline-ruled row of 6 certificate badges with 12px mono labels | STEAL one hairline-ruled evidence row with mono labels. AVOID badges: pegana has no certifications and must not imply any |
| B7 | goldsky.com "Built for products that can't go down" | `goldsky-B.png` | 1.37vp, 112 words, 99 vis, 0 interactive, h2 38/47.5, six icon+claim pairs and two illustration cards (a fake green status-bar "Dashboard / API") | AVOID: invented uptime bars are fake proof, exactly what DESIGN.md section 6 forbids |
| B8 | pyth.network "Trusted by institutions. Used by everyone." | `pyth-B.png` | 0.45vp, 42 words, 62 vis, h2 36/46.8 ls -1.15, 64px stat numerals | AVOID: it is the stat band the owner rejected |
| B9 | tinybird.co "Low-latency queries..." | `tinybird-B.png` | 1.0vp, 22 words, 6 vis, h2 40/48 w400 measure 800 | STEAL the permission to leave air. AVOID as proof: a claim with no artifact |
| B10 | railway.com "Logs, metrics, and traces in one place" | `railway-B.png` | 1.44vp, 424 words, 1035 vis, 11px x60 and 12px x59 text nodes (a pasted dashboard) | AVOID: a product screenshot as proof, 1035 nodes, text inside the screenshot below the floor |
| B11 | trigger.dev "How it works" | `triggerdev-B.png` | 0.93vp, 13 words, 30 vis, 3 controls (Pause, Replay, Full screen), h2 30/36 w600 left aligned over a hairline rule, single caption pill per step ("Write tasks in your Trigger folder"), autoplaying stage | STEAL one caption per step and a hairline-ruled header row. AVOID the autoplay; pegana is static |
| B12 | succinct.xyz "Proofs for the real world" | `succinct-B.png` | 0.91vp, 69 words, 107 vis, 15 interactive, 01-06 numbered tile grid + case-study carousel with Pause | AVOID: numbered tiles and a carousel are the pattern pegana is leaving |

Cross-reference takeaways (B)
- No site that proves something does it with three cards. The ones that read as real (Linear diff, Metera execution log, Arcjet log rows) put ONE artifact in ONE bordered panel and use the surrounding text only to name stages.
- Words: Metera 25 and 35, Tinybird 22, Sigstore 41, Pyth 42. Pegana B is 112 with a 105-node DOM.
- All the good ones use at most 3 text colours and one accent. Linear's diff uses red/green only on changed rows, not on text.
- Nobody in the set uses 11px; the lowest legitimate size is 12px mono for labels (Svix, Arcjet, Linear).

---

## 3. Redesign specs

Shared rules (from DESIGN.md plus the owner): container 1280px with `px-10` (1200px usable) and `px-6` below 640px; neutral zinc only; no gradient, no shadow on these panels (shadow is reserved for the three floating objects); text floor 12px, body majority 14px+; ZERO em-dashes; no stat band, no sticky, no scroll-jack, no marquee; at most one reveal per section (the whole grid, not per element); all hover transitions 150ms with `cubic-bezier(.22,1,.36,1)`; no springs; zero marketing numbers in either section (the only numbers are real payload values).

### 3.A "One verdict, four open surfaces." (replace `product-tabs-v2.tsx` body)

Concept: ONE code window; a plain text rail on its left chooses the surface. One selector level. No icons. No bullets.

Layout (1440 viewport)
- Section padding 112px top and bottom. Target height 672px (0.75vp), hard cap 760px.
- Two columns, 360px | 776px, gap 64px (1200 usable). Below 1024px stack: h2, then the rail as a 4-cell segmented row (REST, WS, MCP, CLI at 14px, 44px tall, hairline separators), then the panel full width, one active description line under the row.
- Left column, top to bottom: h2, 32px gap, rail.
- Right column: panel 776x412, then 16px gap, one caption line.

Copy budget (non-code): at most 45 words total, one number-free line.
- h2 (keep): "One verdict, four open surfaces." 5 words. Switzer 500, `clamp(28px,3vw,40px)`, line-height 1.1, tracking -0.8px, measure 360px (wraps to 3 lines at 40px: that is intended).
- No section lead. No per-surface h3. No per-surface lead. No bullets.
- Rail rows (4), label + one description, 6 words max each:
  - REST: "One GET returns the verdict."
  - WebSocket: "Frames pushed on every recompute."
  - MCP: "Agents call get_asset_state."
  - CLI: "Replay a receipt offline."
- Panel header: request line only (mono 14px, muted): `GET api.pegana.xyz/v1/assets/jitosol` | `wss://api.pegana.xyz/v1/ws` | `mcp.pegana.xyz` | `$ pegana-replay --bundle ./replay-bundle.json`. Right: one copy icon button, 32x32, no label text (aria-label "Copy request", `copied` swaps the glyph for a check for 1.4s).
- Caption below panel (Geist Mono 12px, dim `#80808a`, one line, 10 words max), labels samples as DESIGN.md section 6 requires: REST "Sample, trimmed. Receipts at /v1/audit/{alert_id}."; WS "Sample frames from api.pegana.xyz, 2026-10-19."; MCP "Free tool, no key. Sample, trimmed."; CLI "cargo install pegana-replay --locked".

Element budget: at most 5 interactive (4 rail rows, 1 copy). At most 90 visible DOM nodes in the section including every code line (today 154). Zero icons other than copy. Zero cards.

Type scale
| Element | Font | Size / line | Weight | Colour |
|---|---|---|---|---|
| h2 | Switzer | clamp(28,3vw,40) / 1.1 | 500, -0.8px | `#f5f5f6` |
| rail label | Switzer | 16 / 24 | 500 | active `#f5f5f6`, idle `#a3a3ad` |
| rail desc | Switzer | 14 / 20 | 400 | `#a3a3ad` |
| panel header | Geist Mono | 14 / 21 | 400 | `#a3a3ad` |
| code | Geist Mono | 14 / 21 | 400 | see below |
| gutter | Geist Mono | 14 / 21 | 400 | `#80808a` |
| caption | Geist Mono | 12 / 18 | 400 | `#80808a` |

Rail row spec: 60px tall, padding 12px 16px, radius 8px; active = `rgba(255,255,255,.04)` fill plus a 2px left bar `#f5f5f6`; hover = fill `rgba(255,255,255,.03)`, 150ms. Rows are `role=tab` with arrow-key navigation; roving tabindex. Source of the pattern: Cloudflare browser-rendering (A6) and Trigger (A10).

Code panel spec
- 776x412, radius 16px, fill `#121214`, border `1px rgba(255,255,255,.08)`, no shadow.
- Header 44px, bottom hairline; body fixed 368px (16 lines x 21 + 32 vertical padding) so switching surface never moves the section (current build already does this at 460px; it stays fixed here too).
- Line-number gutter 40px wide, right-aligned, `#80808a`; `pre` horizontal scroll hidden-scrollbar on overflow, never wrap.
- Max 16 lines per payload. Syntax colour restraint, four neutrals plus one semantic: key `#a3a3ad`, string and number `#f5f5f6`, punctuation `#80808a`, and ONLY the real status value in its semantic colour (`"PEGGED"` and the `PASS` token in `#5fd3a0`). Rationale: DESIGN.md section 1 says semantic status colours are data only, never decoration; the current build paints every string pegged-green and every number drift-amber, which breaks that rule. No bold-keyword syntax.
- Four payloads, one per surface, verbatim from the repo (values captured from https://api.pegana.xyz on 2026-10-19 or from the repo's own binary). Subsets are allowed only by dropping whole fields and are labelled "trimmed" in the caption; no value may be edited.

REST (12 lines):
```
{
  "symbol": "jitoSOL",
  "state": "PEGGED",
  "discount": "0.000951",
  "intrinsic_usd": "136.489559498995573553",
  "market_usd": "136.3608189190419111",
  "thresholds": {
    "drift_bps": 45,
    "depeg_bps": 110,
    "critical_bps": 250
  },
  "updated_at": "2026-10-19T16:28:53.985Z"
}
```
WebSocket (15 lines, both real frame types, no tab):
```
{
  "op": "update",
  "asset": "jitoSOL",
  "payload": {
    "state": "PEGGED",
    "discount": "0.000951",
    "intrinsic_usd": "136.489559498995573553",
    "market_usd": "136.3608189190419111",
    "updated_at": "2026-10-19T16:28:53.985Z"
  }
}

{
  "op": "heartbeat",
  "ts": "2026-10-19T14:43:13.508Z"
}
```
MCP (12 lines): the existing `MCP_PAYLOAD` string unchanged.
CLI (4 lines): the existing `CLI_VERIFY` string unchanged (verbatim `cargo run -p pegana-replay` output for USDe-004; states print `Critical -> Depeg`, not the API's uppercase labels).

Motion (all of it)
- Surface change: code region cross-fades, opacity only, 120ms, default ease; the header request line swaps in the same frame. No translate, no blur, no typewriter, no height animation.
- Rail hover/active: background and bar colour, 150ms.
- Copy button: border/colour 150ms.
- Section entrance: one existing `useRevealV2` on the grid wrapper (fade + translateY 18px, <=200ms duration token) instead of three staggered reveals.
- `prefers-reduced-motion: reduce`: reveal renders final state immediately; code swap is instant (no cross-fade); hover/active colour changes stay (they are not motion) but with `transition: none`.

What gets CUT from the current A
- Section lead paragraph (18 words) and the bold-keyword treatment.
- The four glyph squares and all 13 lucide glyphs (Globe, Radio, Bot, Terminal, FileJson, LayoutGrid, Activity, Radio, HeartPulse, Wrench, List, ShieldCheck, FileCode).
- The inner variant tab level and five payloads: `BOARD_PAYLOAD`, `STATS_PAYLOAD`, `WS_HEARTBEAT` as its own tab (merged), `MCP_ASSETS`, `CLI_BUNDLE`.
- 4 panel h3s, 4 panel leads, 12 bold-lead bullets, the two-band path + caption chrome, the 17px/14.5px/12.5px off-token sizes.
- Moved, not lost: thresholds are visible in the REST payload; the audit route moves into the REST caption; `cargo install` moves into the CLI caption.
- Target after: ~45 words prose, 5 controls, at most 90 DOM nodes, height <=760px.

Mobile (390px): h2 28px; segmented rail 4 cells; panel full width, header request line truncates with ellipsis, code 14px with horizontal scroll inside the panel, body height auto with min 252px; caption wraps to two lines.

### 3.B Trust section (replace `trust-scene-v2.tsx` body; candor block untouched)

Concept: ONE receipt window with three ruled segments, beside a plain text list that names the three verbs. The payoff (hash match) is the last and highlighted segment, the way Linear highlights only changed rows. Static; no card grid; no icons.

Layout (1440 viewport)
- Section padding 96px top and bottom; band `#0d0d0f` (surface-1) as now. Target height 612px (0.68vp), hard cap 700px.
- Two columns 5/7 of the 1200 usable with 24px gutter: left 480px, right 696px.
- Left, top to bottom: h2 (max 2 lines, measure 480px), 32px gap, three step rows separated by hairlines, 32px gap, one action row.
- Right: one panel 696px wide, natural height (about 412px), top aligned with the h2.

Copy budget: at most 85 words total including the artifact tokens (today 112), at most 64 DOM nodes including code lines (today 105).
- No eyebrow (frees one of the page's two).
- h2, descriptive not a punchline, <=8 words: "Every verdict replays from its receipt." (6). If the owner wants to keep "Don't trust the score. Replay it." that is a content call, not a layout one. Switzer 500, `clamp(28px,3vw,40px)` / 1.1, tracking -0.8px.
- No lead paragraph.
- Three step rows (label Switzer 16/24 w500 `#f5f5f6`, one sentence Switzer 14/22 `#a3a3ad`, <=9 words, no numerals, no icons, row padding 20px 0):
  - Freeze: "Inputs, thresholds and methodology pinned in one JSON file."
  - Recompute: "The same pure functions, run offline."
  - Match: "Same hash, or the run fails."
- Action row: one command chip (`$ pegana-replay --bundle ./replay-bundle.json`, Geist Mono 14px, 1px `rgba(255,255,255,.08)`, radius 8px, click copies, label swaps to `copied` for 1.4s) and one underlined link "Verify in your browser" to `/audit` (Switzer 14/20, 8px gap arrow). That is the whole interactive count: 2.

Receipt panel spec
- 696px wide, radius 16px, fill `#121214`, border `1px rgba(255,255,255,.08)`, no shadow.
- Header 44px: left `replay-bundle.json` (Geist Mono 14, `#a3a3ad`), right nothing (the copy lives in the action row, not duplicated).
- Three segments separated by 1px hairlines. Each segment = a 28px label row + its lines + 16px bottom padding. Label rows are Geist Mono 12px `#80808a`, lowercase, `verb  field`: `freeze  inputs_frozen`, `recompute  expected_computed`, `match  expected_receipt_sha256`. These pair the verb with the real field name, so the left list and the panel map one to one without numerals or icons.
- Lines: Geist Mono 14/21; key column `#a3a3ad`, value `#f5f5f6`; key and value separated by flex space, value right-aligned, tabular-nums; NO truncation of numbers (full strings), hashes may be middle-ellipsised with the full hash as the copy payload.
- Segment 1, `inputs_frozen` (5 rows, verbatim from `web/tests/fixtures/replay-bundle-sample.json`): `asset` sUSD; `previous_state` PEGGED; `intrinsic_usd` 1.1366084625308834; `market_usd` 1.10; `now` 2026-06-16T00:01:15.884348512Z.
- Segment 2, `expected_computed` (3 rows): `discount_raw` 0.032208507799922078945643858; `discount_smooth` 0.0300958778852580991768204985; `final_state` DRIFT.
- Segment 3, `expected_receipt_sha256`: a two-line diff with a 16px `-` / `+` gutter: `expected` and `recomputed`, both `5ae45763a225cafb…b4419d24a4e`. Only the `recomputed` row carries the result tint: background `rgba(95,211,160,.08)` full row and the word `byte-identical` in `#5fd3a0` (semantic pegged, data not decoration). Exactly one tinted row in the whole panel.
- If a real CLI transcript for this bundle is wanted instead of the `byte-identical` label, capture it by running `cargo run -p pegana-replay -- --bundle web/tests/fixtures/replay-bundle-sample.json` and paste it verbatim; do not compose one. The USDe-004 CLI text used by section A is a different asset and must not be mixed into this sUSD panel.
- Fields deliberately left out of the panel (still in the real bundle, linked via /audit): class, alpha, thresholds, confirm_up_secs, decay_down_secs, ewma_prev, hyusd_cr, methodology_git_sha. Dropping fields is fine; editing values is not.

Hover mapping (optional, 150ms): hovering or focusing a step row tints its segment `rgba(255,255,255,.03)`. Touch devices get the mapping from the label rows, so nothing depends on hover.

Motion (all of it)
- One `useRevealV2` on the grid wrapper.
- Step-row/segment hover tint, 150ms, default ease. Command chip border/colour 150ms.
- The recompute sweep and its DESIGN.md motion-table row are deleted. Nothing else moves.
- `prefers-reduced-motion: reduce`: reveal final state immediately; hover tint `transition: none`.

What gets CUT from the current B
- Eyebrow "verifiable, not a black box"; lead paragraph (17 words).
- The 3-card grid, the 3 numerals, the 6 lucide icons and 3 icon boxes, the 3 artifact header bars, the card-in-card nesting.
- The 200ms sweep overlay and `useAppReducedMotion` branch that exists only for it.
- The `copy hash` button and its 11px label (floor violation); the hash row becomes plain text.
- Frozen rows `class`, `alpha`, `thresholds` (7 to 5 rows) and derived row `previous_state` (4 to 3, it moved to frozen).
- The bottom bar split into two small mono controls; replaced by one action row.
- Silent truncation of `now` and `discount_*` values (replaced by full verbatim strings).
- Target after: <=85 words, <=64 nodes, 2 interactive, 0 icons, height <=700px.

Mobile (390px): h2 28px; step list; panel below, full width, label rows keep 12px, lines 14px with the value column allowed to wrap onto its own line under the key (flex-wrap) so nothing scrolls horizontally; action row stacks, command chip full width with horizontal scroll inside the chip only.

### 3.C Acceptance checks the implementer can run

1. `marketing-type-floor` unit test still passes; nothing below 12px, body majority >=14px.
2. grep for `—` in both files returns nothing.
3. Computed-style pass on the Vercel preview (never `next dev` locally): section A height <=760px, words <=45 outside code, interactive <=5; section B height <=700px, words <=85 including artifact, interactive <=2, zero `svg` icons except the copy glyph in A.
4. Every payload string is a substring-for-substring copy of the sources listed in sections 3.A and 3.B (diff against `docs/` fixtures and `replay-bundle-sample.json`).
5. Reduced-motion emulation: no element has a non-zero `transition-duration` on transform/opacity inside either section.
