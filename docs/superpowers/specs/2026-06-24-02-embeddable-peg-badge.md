# Spec 02 — Embeddable peg-risk badge (verify under enforced CSP + make "verifiable" true)

**Wave 1 · web · no migration · no methodology bump.** Passive distribution: a badge
third parties paste into their site = Pegana as infra others display + backlinks.

## ⚠️ This feature is ALREADY BUILT (Wave 11M). This is a harden/verify spec, not a build.

Existing, committed surfaces (do NOT rebuild):
- `web/app/(marketing)/embed/badge/[symbol]/route.ts` — rich iframe (sparkline, light/dark, price-reconciled bps). Serves URL `/embed/badge/[symbol]`.
- `web/app/(marketing)/embed/[asset]/route.ts` — minimal iframe (280×44).
- `web/app/embed.js/route.ts` — `<script>` loader (vanilla JS, 30s poll, `postMessage`).
- `web/app/(marketing)/embed/page.tsx` + `embed-client.tsx` — generator/configurator.
- `web/app/(marketing)/embed/demo/page.tsx`, `web/components/molecules/embed-specimen-strip.tsx`.
- Footer link `web/components/organisms/site-footer.tsx:40` → `/embed`.

The CSP scoping is already correct: badge routes set their OWN `Content-Security-Policy: frame-ancestors *` (cross-origin embeddable); `proxy.ts:135-138` excludes `embed/` from the site's nonce-CSP/`frame-ancestors 'none'`; `next.config.ts:29` `X-Frame-Options: SAMEORIGIN` excludes `/embed*` via `/((?!embed).*)`. The telegram-login route (`frame-ancestors 'self'`) is the deliberate exception — do NOT normalize it.

## The real work (4 items)

### 1. Make "verifiable" literally true (the core gap)
The badges claim "✓ verifiable" but the link doesn't reach a receipt:
- Rich badge links to `/asset/{symbol}` (a marketing page), not a receipt (`badge/[symbol]/route.ts:109`).
- Minimal + JS badges link to `/audit?asset={asset}` — closer, BUT `audit/page.tsx:82-86` only reads `?state=`, **ignores `?asset=`** → the verify link lands on an unfiltered feed.

**Decision:**
- Wire `?asset=` into the audit-feed filter (`web/app/(marketing)/audit/page.tsx:82-86`), mirroring the existing `?state=` handling.
- Point the rich badge's link at `/audit?asset={symbol}` (`badge/[symbol]/route.ts:109`).
- Add a small "✓ verifiable" affordance (check glyph + word, editorial — NOT a CLI checkmark) linking through (`:159-161`).
- (Enhancement, optional) deep-link to the latest receipt id for the asset (`/audit/[id]`) — defer; the filtered feed is one click from the receipt and far cheaper.

### 2. Verify it survives the now-ENFORCED CSP
The badge predates CSP enforcement (`6bd25a0`, 2026-06-22). Enforcement was verified on home/asset/dashboard/account — **NOT on `/embed`**. This is the single most important confirmation before treating the feature as done (see AC2). The badge HTML is self-contained (inline style/SVG, no external scripts) and sets its own CSP, so the site's script-CSP doesn't apply — but verify at runtime.

### 3. Build the static SVG badge (closes a dead promise + unlocks README distribution)
`embed-client.tsx:129-135` advertises a `.png` snippet that 404s. **Decision: build an SVG badge route** (`/embed/badge/[symbol].svg` or `/embed/badge/[symbol]?format=svg`) returning `image/svg+xml` so it works as a Shields-style `<img>` in GitHub READMEs / markdown. Then fix the generator snippet to point at it.

### 4. Distribution polish
- Asset picker is hardcoded to 10 symbols (`embed-client.tsx:8-19`); the universe is 63. **Decision: fetch `/v1/assets` to populate it.**
- Non-PEGGED states should propagate faster: use a shorter `s-maxage` (e.g. 15s) for non-PEGGED badges vs 60s for PEGGED (a stale "PEGGED" on a partner's deposit page is the worst failure). **Decision: state-conditional cache TTL.**

## Files to touch (exact)

- `web/app/(marketing)/audit/page.tsx:82-86` — consume `?asset=` (primary; without it the verify link is hollow).
- `web/app/(marketing)/embed/badge/[symbol]/route.ts:109` (link target), `:159-161` (verifiable affordance), `:256` (drop non-standard `X-Frame-Options: ALLOWALL`, rely on `frame-ancestors *`), cache-TTL by state, + NEW SVG branch/route.
- `web/app/(marketing)/embed/embed-client.tsx:8-19` (live asset list), `:129-135` (fix/enable the SVG snippet).
- **Do NOT touch** `proxy.ts`, `lib/security/csp.ts`, `next.config.ts` headers (CSP scoping already correct; touching risks a regression).

> Next.js 16 caveat: read `web/node_modules/next/dist/docs/` before editing routes — App-Router route-handler + caching APIs differ from training data (`web/AGENTS.md`).

## Schema / migrations / methodology

None. Web-only.

## Risks

- **Stale "PEGGED" on a partner site** = the highest-stakes risk for a peg product. Mitigate with state-conditional TTL (#4) + keep the rich badge's existing price-reconciliation (`route.ts:223-237`) + surface `as_of` in a tooltip.
- **Impersonation:** anyone can serve fake static HTML; the only lever is the link reaching a real receipt → why #1 matters. Badge has no signature (consider embedding `receipt_sha256.slice(0,12)` per the `audit/page.tsx:229` pattern as a future "self-attesting" enhancement — defer).
- **CSP regression:** a future "unify embed CSP" refactor would silently break third-party embeds → guard with a test (below).

## Test plan + acceptance criteria

Tests (none exist for badge routes today):
- Route unit tests for `badge/[symbol]`, `[asset]`, `embed.js`, `[symbol].svg`: assert `Content-Security-Policy: frame-ancestors *` + Content-Type; `UNKNOWN` fallback on API failure; symbol/name HTML-escaped (inject `<script>`).
- CSP-scope regression (extend `csp.test.ts`): main `buildCsp()` still emits `frame-ancestors 'none'`; snapshot the `proxy.ts` matcher so dropping the `embed/` exclusion fails CI.
- Verify-link test: `audit/page.tsx` filters on `?asset=`.
- Playwright (under enforced CSP): load `/embed` generator on `www`, confirm the live `<iframe src="/embed/badge/USDC">` renders with **0 console CSP violations** (AC2); frame the prod badge URL from a throwaway cross-origin page → renders (frame-ancestors `*`).

Acceptance:
- AC1 `/embed/badge/USDC`, `/embed/USDC`, `/embed.js?data-asset=USDC`, `/embed/badge/USDC.svg` → 200 with correct CSP; no `frame-ancestors 'none'` leakage.
- AC2 badge renders inside a strict-CSP Pegana parent with 0 violations.
- AC3 badge renders cross-origin.
- AC4 API failure → `UNKNOWN` badge, no layout break.
- AC5 the "verify" link reaches a per-asset receipt/audit view (`?asset=` honored).
- AC6 staleness visible (`as_of` tooltip); non-PEGGED uses the shorter TTL.
- AC7 `vitest` + `cargo` green; `X-Frame-Options: SAMEORIGIN` present on a non-embed route, ABSENT on `/embed/*`.

## Grill outcomes

- *"Is this just polish?"* — No: the badge currently asserts "verifiable" without a working verify path, which is a trust-product credibility bug, not polish. Closing it + confirming CSP survival is the minimum to call the feature real.
- *"Why build the SVG?"* — markdown/README `<img>` embeds are the highest-reach low-effort distribution surface (GitHub readmes of the protocols we monitor) and it closes an already-shipped dead promise.
- *"Brand risk?"* — the existing badge is on-brand (editorial, mono only for numbers). Keep that; the "✓ verifiable" affordance must not become a CLI/terminal checkmark (locked brand rule).
