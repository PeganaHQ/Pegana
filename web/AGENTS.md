<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Known breaking changes in Next.js 16 (vs training data):**
- `params` in dynamic routes, `generateMetadata`, `opengraph-image`, `ImageResponse` is now a **Promise** — must be `await`ed
- `ImageResponse` import is from `next/og` (NOT `next/server` — moved in v14)
- Satori (the engine behind `ImageResponse`) supports **only flexbox** — no `display: grid`, no CSS custom properties, no `gap` shorthand (use `marginLeft`/`marginTop` instead)
- Font loading for satori: only `ttf`/`otf`/`woff` (NOT `woff2`); load via `node:fs/promises` `readFile` at module scope or fetch from Google Fonts with archaic UA (`Mozilla/4.0`) to get `.ttf` URLs
- Turbopack is the default bundler; `next.config.ts` `turbopack.root` can point to monorepo parent
<!-- END:nextjs-agent-rules -->

# V2 data tables — always a real `<table>` (the standard)

Any surface that renders rows of data — boards, screeners, ledgers, directories,
size-ladders, alert lists — MUST be a real, semantic `<table>`, never a stack of
`<div>`s. This is the app-wide standard and every current surface complies
(dashboard board, `/assets` screener, peer-comparison,
exit-liquidity, alert-policy, audit-calibration, `/lst` + marketing). Two
approved idioms, both real tables:

- **Shared `ListRowsV2`** (`components/organisms/v2/inner/list-rows-v2.tsx`) — a
  real `<table>` + `<colgroup>` whose `<tr>`s are `display:grid` for pixel
  control. Use for marketing + editorial surfaces (`/lst`, about, audit,
  changelog, methodology, status, assets-canon).
- **Hand-rolled `<table table-fixed>` + explicit `<colgroup>`** — the command-
  center idiom (dashboard board, `/assets` screener, `/account/alerts`,
  peer-comparison, exit-liquidity, alert-policy). Ship the `<colgroup>` +
  `<thead>` in the SAME component as the rows so the column count can't drift.

Holds for both: real `<thead>/<tbody>/<tr>/<th scope>/<td>`, with an explicit
`role` wherever a CSS `display` override would strip the native table role;
horizontal overflow scrolls INSIDE the table's own container, never the page
body (verify `document.documentElement.scrollWidth === clientWidth` at 390px);
the mobile card renders as a `sm:hidden` SIBLING of the `hidden sm:block` table,
not inside a `colSpan` cell. This line used to say the opposite; the codebase
changed and the doc did not. The reason is in the code (dashboard-board-row.tsx,
assets-screener-row.tsx): a card smuggled through a `colSpan` cell of a
`table-fixed` table inherits that table's `min-width` — 976px on the dashboard
board — so it is forced far wider than a phone. Dashboard board, assets screener,
account/alerts and /systemic all use the sibling split.

# Design system — DESIGN.md is the spec

`DESIGN.md` (repo root, approved 2026-07-02) supersedes `brand.md` and governs
ALL product surfaces (marketing + app console). Read it before styling anything.

**Hard rules (audited, guard-tested, 0 violations):**
- **ZERO em-dashes** anywhere visible. Use period, comma, or colon. (Data-null cells use `-`.)
- **Middle-dot** max 1 per line.
- **Max 2 eyebrows** per page.
- **Hero sub** <= 21 words. **Section headlines** <= 8 words.
- **No hype verbs** (revolutionize/seamless/unleash/next-gen). Technical-calm register.
- **Iridescent gradient** in EXACTLY 5 moments per page: logo, hero headline accent, hero arc, chart data, close scenario. Zero gradient buttons or gradient text.
- **Glass** (backdrop-blur) ONLY on the fixed navbar. Everything else flat panels.
- **Drop shadows** ONLY on hero board + receipt objects. Never on cards.
- **Buttons**: primary = solid white pill, mono uppercase label, nested arrow-in-circle. Secondary = ghost pill. NEVER large/fat CTAs. NEVER gradient buttons.
- **Every number is real** (from production API) or visibly labeled sample. No fake social proof, no "trusted by", no invented metrics. UNKNOWN is shown, not hidden.

# Color tokens (never hardcode hex in components)

All colors are CSS custom properties in `app/globals.css` under `@theme` and
`[data-theme="dark"]/:root`. Use Tailwind utilities (`text-text`,
`bg-surface-1`, `border-hairline`) or `var(--color-*)` in inline styles.

**Surfaces**: `canvas` #0a0a0b, `surface-1` #121214, `surface-2` #17171a
**Text**: `text` #f5f5f6, `text-muted` #a3a3ad, `text-body` #b4b4bc
**State** (data only, never decoration): `st-pegged` #5fd3a0, `st-drift` #e2a651, `st-depeg` #e87089, `st-critical` #e0574e, `st-unknown` #8f8aa3
**Brand**: `coral` #ff8a5b, `magenta` #e878d8, iridescent gradient (5 stops)

**NEVER violet-tint** the canvas. It is neutral zinc near-black.

# Typography

Two families ONLY: **Switzer** (display + body) and **Geist Mono** (technical
voice, numbers, metadata, button labels). Loaded via `next/font/local` woff2 in
`app/fonts/v2-fonts.ts`. No italics. No serif.

- Button labels: Geist Mono, 12px, uppercase, 0.09em tracking
- Numbers/metadata: Geist Mono, tabular-nums
- Hero h1: Switzer, clamp(42px, 6.6vw, 80px), weight 500, -0.025em tracking

# State metadata — single source of truth

`lib/asset/state-meta.ts` is the CANONICAL state metadata. Every component that
needs a color/label/class for a peg state reads from `stateMeta()` — NEVER keep
a local `Record<PegState, string>` copy. Those local copies are how the app
ended up with a dozen drifting maps.

**Spread numbers are colored by their own SIGN, not by state** (changed
2026-08-10). Premium (holder `+`) is green, discount (holder `−`) is red, zero
is neutral. Use `spreadSignClass(rawBps)` from `lib/api/format.ts` (or
`v2SpreadSignClass` for `--v2-*` surfaces, `satoriSpreadColor` for satori).

⚠️ **Pass the RAW `reconcileBps`-convention bps** — the same variable that feeds
the text through `holderSignedPct()`. Those helpers negate internally so the
printed sign and the color come from one input by one code path. Deriving the
color from a separately hand-negated variable is how the 2026-07-23 audit ended
up with ~11 surfaces printing the sign backwards; a guard test
(`tests/unit/lib/spread-sign-color.test.ts`) now pins that they always agree.

This **replaced** a prior rule that PEGGED's spread was deliberately neutral.
That rule was retired because the same number rendered neutral on the app and
GREEN on the share cards (satori's `STATE_COLOR` has no neutral PEGGED), and a
negative number in green is indefensible on any surface.

**`severityTextClass`** (formerly `spreadTextClass`) is what remains of the
state-keyed path, and is ONLY for values bound to the state that carry no sign
of their own: a verdict headline sentence, a 0-100 risk score, a band-distance
metric. Do not reach for it to color a spread.

**There are no surviving exceptions.** A live-DOM sweep on 2026-08-10 found six
more surfaces, and the two carve-outs proposed alongside the original change
were both retired on contact with the deployed page:

- `/compare` "Widest now" had a THIRD scheme, by magnitude (>300bps red, >30bps
  amber). It made a `+1.52%` premium amber there and green on `/dashboard`.
- `mechanism-flow`'s `SpreadBar` label shared the connector's state stroke, so
  jitoSOL's `−0.09%` was white there and red in the hero on the same page.

Both were defensible in isolation and wrong in aggregate: a number that changes
color between two pages is worse than any local nicety. **When a number sits
beside something that carries identity — a state word, a series swatch, an SVG
connector — that neighbour keeps its own color and the number still takes its
sign.** `/events` (state word + number), the `/compare` legend (swatch +
number) and `SpreadBar` (connector + label) all resolve this way.

**Unsigned magnitudes stay neutral.** `asset-rail`'s "median spread" is a
`Math.abs` median and the `synth_lev` verdict prints `2.31% above NAV` — no
sign printed means no sign color, or you assert a direction the text does not.

⚠️ **A class is not proof of a color.** This bit twice in one pass, both times
with the correct class sitting on the element and the wrong color on screen:

1. `useTickFlash` tweens `color` via GSAP, which writes an INLINE style that
   beats the class permanently. It restored to a hardcoded `--color-text` for
   months without anyone noticing, because PEGGED's class was that same
   `#f5f5f6` — then sign-coloring landed and every flashed cell reverted to
   white on the first WS tick.
2. `EditorialPullquote` defaults its numbers with `[&_[data-num]]:text-text`.
   That is a *descendant* selector (0,2,0) and outranks any utility class on
   the span itself (0,1,0), so the verdict number's class was applied and
   simply lost. Fixed with an inline `spreadSignVar(bps)` — which is what that
   helper is for, and the only thing that wins without disturbing the other
   pullquotes relying on the default.

Every unit test passed through both, because they all asserted the class. If
you change how a number is colored, **read `getComputedStyle` on the deployed
page** — and on a live surface, wait for a WS tick first. Do not trust the diff.

**BLACK_SWAN** reuses CRITICAL's color treatment everywhere, but keeps its own
label ("Black Swan") for copy precision (audit/incident views).

The V2 landing organisms (`components/organisms/v2/shared.tsx`) have their own
`STATE_META` for the marketing surfaces — this is a known duplication that mirrors
the app-side one. If you change one, change the other.

# Share cards and OG images

Four distinct share surfaces exist:

1. **Per-asset OG image** (`app/(app)/asset/[symbol]/opengraph-image.tsx`) —
   auto-injected `<head>` meta tags. 1200x630 PNG via `ImageResponse`/satori.
   Shows brand mark, symbol, state pill, gap, intrinsic/market values.
2. **Compare share card** (`app/(app)/compare/share/route.tsx`) — on-demand
   PNG download. Route handler with `?s=SYM1,SYM2,...`. Branded multi-asset card.
3. **Per-asset share card** (`app/(app)/asset/[symbol]/share-card/route.tsx`) —
   on-demand PNG download. Richer than the OG image: sparkline, band-proximity
   gauge, timestamp. 1200x630 via satori. Linked from `ShareButton` ("Card" pill).
4. **ShareButton** (`components/molecules/share-button.tsx`) — ghost pills on
   the asset detail page: "Share on X" (web intent), "Card" (download PNG from
   `share-card/route.tsx`), "Copy link" (clipboard). Compact `ShareIconButton`
   (copy-link only) on mobile sticky header.

**Shared helpers** (`lib/og/shared.ts`): all satori constants + utilities
(`IRIDESCENT_GRADIENT`, `SATORI_CANVAS`, `STATE_COLOR`, `STATE_LABEL`,
`formatGapBps`, `trimDecimal`, `loadGeistFonts`, `satoriStateMeta`, etc.) are
extracted to `lib/og/shared.ts`. All four surfaces import from there — NEVER
duplicate these constants again. If you add a new satori route, import from
`lib/og/shared.ts`.

**Satori constraints** (the engine behind `ImageResponse`):
- Only flexbox (`display: flex`). No grid, no table, no float.
- No CSS custom properties (`var(--...)` — satori can't read them). Hardcode hex.
- No `gap` shorthand — use `marginLeft`/`marginTop` for spacing between flex children.
- Max bundle 500KB including fonts + JSX + images.
- Font formats: `ttf`/`otf`/`woff` only (NOT `woff2`). Load from Google Fonts
  with `User-Agent: Mozilla/4.0` to get `.ttf` URLs, or read local files via
  `node:fs/promises` `readFile` at module scope.
- Images: use base64 data URLs or `Uint8Array` buffer (needs `@ts-expect-error`).

**`reconcileBps()`** (`lib/api/format.ts`): all share cards must use this
canonical spread calculation (NOT a manual `bpsFromDiscount` inline) so the
card never disagrees with the asset page / board / rail. `bps` is signed
**intrinsic - market** (premium is NEGATIVE). For holder display, negate:
`+` = premium, `-` = discount.

# Public entry points — enumerate them, never recall them

`pegana.xyz` served raw unstyled HTML in production and 234 passing E2E tests
said nothing, because every one of them asked for `www.pegana.xyz`. The apex is
what a person types.

The mechanism was a **split origin**: `proxy.ts` answered the document on the
apex, while `_next/*` fell through to `vercel.json`'s apex->www redirect. So the
HTML came from `pegana.xyz` carrying `style-src 'self'` and every stylesheet it
referenced 308'd to a *different* origin. CSP refused all of them. The page was
a 200 with three `<link>` tags the browser had thrown away.

Three rules follow, each with a guard:

1. **The apex redirects before any CSP is attached.** `proxy.ts` handles
   `pegana.xyz` first and returns a 308 with no policy header. A redirect that
   carries a policy has already picked an origin. Guard: `proxy.test.ts`
   (runs in `bun run test`).
2. **A 200 is not evidence a page works.** The broken page returned 200. Assert
   that CSS *applied*: `document.styleSheets` readable, rule count > 50, body
   background not transparent. Guard: `tests/public/entry-points.spec.ts`.
3. **The host list is enumerated from the repo root, not from memory and not
   from `web/`.** Recall produced five hosts. The grep produced six — because
   it was run from `web/`, and `.` meant the subdirectory. From the repo root
   the same command returns **ten**. The command was right and the working
   directory was wrong, which is the identical failure that caused the outage.
   Always `cd` to the repo root first, and check the counts look like a whole
   repo (`pegana.xyz` appears ~1186 times, not ~64).

```bash
cd "$(git rev-parse --show-toplevel)" && grep -rhoE '\b[a-z0-9-]*\.?pegana\.xyz' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=target --exclude-dir=worktrees \
  | sort | uniq -c | sort -rn
```

Ten hostnames appear in the repo; **six are public product surfaces** and are
the ones `PUBLIC_HOSTS` covers:

| Host | Role |
|---|---|
| `pegana.xyz` | what a human types; 308s to www |
| `www.pegana.xyz` | the console and marketing site |
| `releases.pegana.xyz` | CLI release surface, own branch in `proxy.ts` |
| `api.pegana.xyz` | Rust API. Health is `/health`, **not** `/v1/health` |
| `docs.pegana.xyz` | Mintlify, also proxied at `/docs` |
| `mcp.pegana.xyz` | MCP server, x402-metered |

The other four are deliberately **not** in `PUBLIC_HOSTS`, and the reason
matters more than the exclusion: `grafana.pegana.xyz` is internal ops behind
Caddy + Grafana auth (302 to `/login` is it working, and it is not served by
`proxy.ts` at all, so it carries no split-origin risk); `staging.`, `app.` and
`mcp-staging.` were never provisioned and exist only in deferred specs and
archived research notes. Adding a genuinely public host means adding it to
`PUBLIC_HOSTS`.

```bash
bun run verify:public   # all six hosts, both engines, against LIVE production
```

It has its own `playwright.public.config.ts` with **no `webServer`**, because
the main config would boot `next dev` — banned on this machine. Run it after any
deploy touching `proxy.ts`, `vercel.json`, `next.config.ts`, or the CSP.

# Guard tests — what each one pins, and the bug it exists to stop

A guard whose reason is not written down gets deleted the first time it fails.
Every one of these was added after the defect it describes shipped to
production. `bun run test` runs the unit ones; `bun run verify:public` runs the
live ones against production.

**Unit** (`tests/unit/design/`):

| Guard | Stops |
|---|---|
| `em-dash-guard` | visible em-dashes (DESIGN.md) |
| `iridescent-count-guard` | more than 5 gradient moments per page |
| `state-token-parity` | V2's `STATE_META` drifting from `state-meta.ts` |
| `v2-contrast` | WCAG AA regressions on the V5 surfaces |
| `pagination-single-source` | a fifth hand-rolled pagination copy |
| `view-transition-guard` | React's `<ViewTransition>` and duplicate `view-transition-name`s |
| `spread-sign-formatter-guard` | a spread's printed sign and its colour drifting apart |
| `display-heading-leading` | the 26px heading inheriting its line-height. It is declared in two places (a utility stack and `.v2-in-prose h2`) and neither set one, so the same heading rendered 45.5px on /methodology and 39px on /status |
| `list-surface-request-budget` | a row-rendering surface fetching per row. The hero board paged 10 windows of 5000 buckets PER ASSET to draw 48 pixels: 68 API calls per homepage load against a 300/min limit |
| `server-fetch-honesty` | a cached server fetch returning a bare `[]` on failure. `/lst` did, so every LST read "not yet covered" during a blip of our own API — a permanent claim about coverage. Browser QA cannot see this class: these run server-side, so Playwright network interception blocks nothing |
| `null-not-zero` | `?? 0` piped into `formatGap`/`holderSignedPct`. They return "-" for null on purpose; the spread tape defeated that and printed a muted "0.00%" for an unknown spread — the most reassuring value a peg product can show |
| `account-noindex` | /account/* routes without their own metadata. All five served one title and a canonical pointing at /account, because the pages are `"use client"` and Next forbids exporting `metadata` from one. Also pins noindex: robots.txt disallow is NOT noindex, and link-preview unfurlers ignore robots.txt |

**Live** (`tests/public/`, run with `bun run verify:public`; own config, no
`webServer`, because the main one boots the banned `next dev`):

| Guard | Stops |
|---|---|
| `entry-points` | a hostname serving unstyled HTML. The apex did, and 234 passing E2E tests all asked for `www`. Asserts CSS actually applied, since the broken page was a 200 |
| `page-contract` | a route with no `<h1>`, and the homepage exceeding its API request budget |
| `mobile-nav` | the closed mobile bar's optical alignment, measured on GLYPHS not touch targets — the boxes were symmetric while the marks sat 16px and 30px in |
| `mobile-menu-open` | everything about the OPEN sheet. Every other guard measured the closed bar, which is why five visible defects shipped while the suite read green |

# Build, test, lint — NEVER run `next dev` or `next build` locally

The dev machine crashes on `next dev`/`next build`. Verify changes with:

```bash
bun run typecheck        # tsc --noEmit
bun run lint             # eslint
bun run test             # vitest run (unit tests)
bun run test:e2e         # playwright (needs backend running)
```

Run a single unit test: `bun run test -- <pattern>` or `vitest run -t <name>`.
Run a single E2E test: `npx playwright test <file>`.

**Playwright** config: chromium desktop by default; iPhone 13 (webkit) via
`IOS_E2E=1` env. Tests assume the backend is running. `webServer` auto-starts
`bun run dev` unless `EXTERNAL_TARGET=1` or `CI`.

**Vitest** config: jsdom, globals enabled, setup file at `./tests/setup.ts`.
Excludes `tests/e2e/`, `.claude/**`, `worktrees/**`.

# Data binding — real numbers, honest fallbacks

All data surfaces bind to real API endpoints via SWR hooks (`useAssets()`,
`useAsset()`, `useStats()`, etc.). Numbers come from production API — NEVER
hardcode. When live data is unavailable, use the existing `MockDataBanner`
honest-degradation pattern: show sample data with a visible "sample" caption.

**`dashSafe()`** (`components/organisms/v2/shared.tsx`): `formatValue`/
`formatGap` fall back to em-dash for null input. DESIGN.md bans visible em-dashes
anywhere, so every V2 call site runs the result through `dashSafe()` to swap it
for a plain hyphen.

**`reconcileBps()`** (`lib/api/format.ts`): the canonical spread calculation.
Returns `{ bps, ... }` where `bps` is signed **intrinsic − market** (premium is
NEGATIVE). For holder display, negate: `+` = premium, `-` = discount. All
display layers (hero, rail, LST table, share cards) negate `bps` for display.

**`effectiveState()`** (`lib/asset/freshness.ts`): freshness gate. Degrades a
stale REST snapshot to UNKNOWN using a clock tick (not just when SWR
revalidates). Used by the asset page and dashboard.

# LST directory — merge mechanics

The `/lst` page merges two data sources:
- **lst-directory.com** (Hylo, ~15m refresh): TVL, APY, rate, lifecycle flags.
- **Pegana API** (`/v1/assets?class=lst`, ~60s refresh): state, spreadBps.

`lib/lst/merge.ts` `mergeLstDirectory()` matches by mint (base58) first, then
case-insensitive symbol. Uncovered LSTs get `covered: false`, `state: null` —
rendered as "not yet covered" (NOT "not yet rated" — Pegana covers assets, it
doesn't "rate" them). Fallback when lst-directory.com is unreachable:
`buildFallbackRows()` uses Pegana's own tracked LSTs only.

# Accessibility — non-negotiable

- **Color contrast**: WCAG AA (4.5:1+) on all three V5 surfaces. Verified
  2026-07-03 retokenization pass. Guard test: `tests/unit/design/v2-contrast.test.ts`.
- **Em-dash ban**: guard test at `tests/unit/design/em-dash-guard.test.ts`.
- **Iridescent count**: max 5 per page. Guard test:
  `tests/unit/design/iridescent-count-guard.test.ts`.
- **State token parity**: V2 `STATE_META` must match `state-meta.ts` colors.
  Guard test: `tests/unit/design/state-token-parity.test.ts`.
- Screen reader announcements: `AssetStateAnnouncer`, `aria-live="polite"` on
  copy confirmation, `aria-sort` on sortable headers, `role="status"` on page
  changes.
- Keyboard navigation: roving tabindex on dashboard board, Esc clears scrub.
- `role="table"`, `role="columnheader"`, `scope="col"` on all data tables.

# Motion system

GSAP + Lenis (landing only) + framer-motion (component-level).
Custom eases: `cubic-bezier(.22,1,.36,1)` (default) and `cubic-bezier(.32,.72,0,1)` (physical).
No springs, no linear.

**Reduced-motion matrix (mandatory):** canvas layers OFF, pinned scene unrolls
static, strikes pre-drawn, marquee stopped, floats/breathe off, reveals instant.
Mobile (<900px): no pinning, reveal-mask off.

**framer: import `m`, never `motion`.** `motion` pulls the full bundle eagerly and
defeats the `LazyMotion` split that `components/atoms/motion-provider.tsx` exists
to provide.

## View transitions

Driven by the browser's `document.startViewTransition`, orchestrated in
`lib/motion/view-transitions.tsx`. **NOT React's `<ViewTransition>`.**

⚠️ Next 16.2.11 accepts `experimental.viewTransition` and its own bundled docs
describe `<ViewTransition>` and `<Link transitionTypes>`. The component only
works on React's *experimental* build, and
`next/dist/lib/needs-experimental-react.js` selects that build from
`taint || transitionIndicator || gestureTransition` only. `viewTransition` is
not on that list, so the flag turns on the config and not the reconciler. Both
bundled React builds export the `ViewTransition` symbol, so feature detection is
worthless; rendering it on the shipped one throws React #306 and the error
boundary blanks the page. It typechecks, lints, and passes 1700 unit tests
first. This branch shipped exactly that to a preview before catching it.

Links opt in with `data-vt="<kind>"`; the orchestrator intercepts the click,
runs the navigation inside the transition, and stamps `data-vt` on `<html>` so
the CSS can key off `:root[data-vt="..."]`:

| kind | when | motion |
|---|---|---|
| `nav-forward` | drilling deeper (row -> asset detail) | slide 56px + fade |
| `nav-back` | breadcrumbs, back links | mirrored slide |
| `nav-lateral` | tab bar, drawer, topbar rail | fade only, no travel |
| `page-next` / `page-prev` | pagination | slide 24px + fade |

Four rules, each of which has a guard test in
`tests/unit/design/view-transition-guard.test.ts`:

1. **Never render React's `<ViewTransition>`,** and never turn on
   `experimental.viewTransition` (see above).
2. **A `view-transition-name` must be unique among RENDERED elements.** jitoSOL
   appears four times on `/dashboard`. A duplicate makes the browser abandon the
   ENTIRE transition, silently. Only `token-icon.tsx` (via `assetMorphName()`),
   the board row, the screener row and the asset hero may claim one.
3. **Every `viewTransitionName` needs a matching
   `::view-transition-group(...) { animation: none }`** in `globals.css`, or the
   chrome slides with the page.
   Client state changes (pagination) go through `withViewTransition()`, which
   does the `flushSync` the API requires: `startViewTransition` snapshots when
   its callback returns, so a batched React update lands after the snapshot and
   nothing animates.
4. **Reduced motion needs its own `::view-transition-*` block.** The global
   `html, *, *::before, *::after` rule cannot reach top-layer pseudo-elements.

Marketing links carry no `data-vt` at all. `/` runs Lenis driving GSAP's ticker
and `TrustSceneV2` is a 340vh scrubbed pin; translating the outgoing document
mid-pin fights it for the same scroll position.

# Chrome metrics and breakpoints

`--app-topbar-h` (56px) and `--app-tabbar-h` in `globals.css` are the single
source of truth for every offset against the fixed header and bottom tab bar.
They replaced a literal `73px` typed into five files. The header sets
`--app-topbar-h` as its own explicit height, and `mobile-shell.spec.ts` asserts
the two agree.

Two named breakpoints beyond Tailwind's own, registered in `@theme`:

- **`scene` (900px)** — below it the pinned GSAP scene unrolls static and the
  hero canvases draw one frame.
- **`navpill` (920px)** — the width at which the marketing nav's links fit inside
  the glass pill.

They are different numbers for different reasons; do not merge them. The three
`max-width` queries in `v2.css` mirror them by hand, because a media query cannot
read a custom property.

# Pagination

One implementation: `lib/hooks/use-pagination.ts` + `components/molecules/pagination.tsx`.
It owns clamping, reset-on-reshuffle, `?page=` URL state, the scroll-back to the
table, and the animated swap. Four surfaces consume it (dashboard board, `/assets`
screener, `/events`, `/lst`). `tests/unit/design/pagination-single-source.test.ts`
fails if a fifth hand-rolled copy appears.

# Cards

`cardSurface()` in `components/atoms/surface-card.ts` is the card surface. Pass
padding and layout through `className`. `background: "none"` for cards that sit
on the canvas with only a hairline (the dashboard highlights).

**Pills are not cards.** `VerdictChip` and the trust chip are `rounded-full`,
state-tinted, and hover their text rather than a border. Routing them through
`cardSurface()` forces `border-hairline bg-surface-1` underneath and leaves the
state tint to win a class merge, which is the "a class is not proof of a colour"
failure documented above.

# PWA

`app/manifest.ts` (typed metadata route, served at `/manifest.webmanifest`),
`public/sw.js`, `app/offline/page.tsx`, and the install row in the mobile sheet.
The strategy is ADR-0045: one installable web app, no native clients.

**The service worker never caches `/v1/*`, `/api/*`, `/monitoring` or `/auth/*`.**
A cached peg state is visually identical to a live one, so it fails silently and
confidently. Navigations are network-first; only content-hashed assets are
cache-first. Kill switch: `postMessage({ type: "PEGANA_SW_KILL" })`, or
`NEXT_PUBLIC_DISABLE_SW=1` to unregister on next load. Pinned by
`tests/unit/app/pwa.test.ts`.

# Language

Everything written into this repo is English: code, comments, docs, tests, commit
messages, and user-facing copy.

# File conventions

- **Route handlers** that generate PNGs (share cards, OG images) use
  `ImageResponse` from `next/og`. They catch all errors and return a plain
  `Response("failed", { status: 500 })` — NEVER let a rendering error bubble as
  an unhandled 500 HTML page.
- **Dynamic imports** (`next/dynamic` with `ssr: false`) for heavy client-only
  modules: `AssetChart` (lightweight-charts), `CompareChart` (recharts). Keeps
  them off the initial JS payload.
- **Server components** fetch data; **client components** (`"use client"`) handle
  interactivity, SWR hooks, and state.
- **`app/api/`** routes are same-origin proxies (token-logo, lst-liveness,
  jupiter-quote) to avoid CORS issues under strict CSP.

# Environment

- **Node** >= 20, **pnpm** >= 9 (but scripts use **bun** runtime)
- **TypeScript** strict mode, `moduleResolution: "bundler"`
- **Tailwind CSS v4** — NO `tailwind.config.ts`. Theme is CSS-first in
  `app/globals.css` `@theme {}` blocks. PostCSS via `@tailwindcss/postcss`.
- **shadcn/ui** (radix-nova style) — 13 primitives in `components/ui/`
- **Path alias**: `@/*` maps to `./*` (web root)

# Tech stack reference

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.11 (App Router, Turbopack) |
| React | 19.2.4 |
| Styles | Tailwind CSS v4, shadcn/ui (radix-nova) |
| Icons | lucide-react v1.16 |
| Data fetching | SWR 2.4 |
| Charts | lightweight-charts 5.2 (asset), recharts 2.15 (secondary) |
| Motion | GSAP 3.15, Lenis 1.3, framer-motion 11.18 |
| Fonts | Switzer + Geist Mono via next/font/local (woff2) |
| Testing | Vitest 4 (unit), Playwright 1.60 (E2E + a11y) |
| Error tracking | @sentry/nextjs (tunneled via /monitoring) |
| Analytics | @vercel/analytics |
| CSP | nonce-based, no inline handlers, self-only img-src |
