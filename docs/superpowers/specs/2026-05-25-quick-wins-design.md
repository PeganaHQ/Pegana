# Quick-wins distribution sprint — design

**Date:** 2026-05-25
**Branch:** `feat/quick-wins-sprint` (worktree of `main`)
**Concurrent work:** `feat/v1.1-console` (auth + `/v1/me/*`) — orthogonal, no shared files.

## Goal

Five small, independent shippable wins that cut friction in the bot funnel and
unlock organic distribution (social cards, embed visibility, bot-side dashboard
links). Each item is independently deployable; sprint can be partially merged.

## Scope (in / out)

**In:**
1. Fix `peganaBotHref` Telegram handle (currently `t.me/PeganaBot` — broken; real is `@PeganaWatchBot`).
2. New `/web` bot command — returns dashboard URL, personalised when user has subs.
3. Extend bot deeplink contract: `?start=sub_<asset>_<bps>` opens a confirmation keyboard.
4. Per-asset dynamic Open Graph image at `/asset/[symbol]` via Next 16 file convention.
5. "Alert me" CTA on the dashboard `universe-grid` rows and `asset-table` last column.

**Out:**
- `/embed` page polish (already shipped, discoverable via header + footer).
- Refactoring `AssetCard` molecule (dead code — separate cleanup sprint).
- Server/client split of `/asset/[symbol]/page.tsx` to enable `generateMetadata`
  for og:title/og:description. The file-convention OG image alone delivers ~80%
  of the value; title/description deferred.
- `?subs=<list>` filter on dashboard (`/web` returns simple URL; filter is a
  separate frontend task).

## Surfaces touched

| File / area | Type | Why |
|---|---|---|
| `web/lib/bot-link.ts` | edit | Fix handle |
| `web/tests/unit/lib/bot-link.test.ts` | edit | Asserts wrong handle today |
| `web/lib/data/concepts.ts` | edit if stale handle found | Stale `@PeganaBot` mentions |
| `bot-ts/src/helpers.ts` | edit | Extend `parseStartPayload` to handle `sub_*` |
| `bot-ts/src/helpers.test.ts` | edit | New test cases for sub payload |
| `bot-ts/src/index.ts` | edit | `/start` confirmation flow, new `/web` command, register in command menus |
| `bot-ts/locales/en.ftl` | edit | `web_link_*`, `sub_confirm_*` keys |
| `bot-ts/locales/pt-BR.ftl` | edit | Mirror keys |
| `web/app/(app)/asset/[symbol]/opengraph-image.tsx` | new | Dynamic OG renderer |
| `web/app/(app)/asset/[symbol]/twitter-image.tsx` | new | Re-export of OG image |
| `web/components/organisms/universe-grid.tsx` | edit | Hover-reveal Alert link |
| `web/components/organisms/asset-table.tsx` | edit | Visible Alert column entry |

No DB migration. No new dependencies (uses `next/og` which is bundled with
Next 16). One new optional env var on the bot: `PEGANA_WEB_BASE`
(default `https://pegana.xyz`) — read in the `/web` handler.

## Detailed design per deliverable

### 1 — Telegram handle fix

Single-line change in `web/lib/bot-link.ts:14`:

```ts
const base = "https://t.me/PeganaWatchBot";
```

The function signature, payload encoding, and four call sites
(`asset-action-strip`, `site-footer`, `about/page`, `(marketing)/page` if any)
stay exactly as-is. Tests in `bot-link.test.ts` currently assert the wrong
literal — update assertions in lockstep. `web/lib/data/concepts.ts` also
contains stale `@PeganaBot` mentions per the audit; grep + correct.

**Risk:** zero. Pure literal fix. Verified live by curl/HEAD on
`https://t.me/PeganaWatchBot` is the actual bot.

### 2 — `/web` bot command

New `bot.command("web", ...)` handler in `bot-ts/src/index.ts` after `/digest`.

Behaviour:

```text
/web (no args)
  ├── user has 0 active subs
  │     → "📊 Dashboard: https://pegana.xyz/dashboard
  │        Tip: use /subscribe <asset> to track an asset on the web too."
  └── user has 1+ active subs
        → "📊 Your dashboard:
           https://pegana.xyz/asset/<first sub asset>

           Other watched: <comma list of remaining subs>"
```

The "first sub" is the lowest-ID active subscription (oldest). We don't try to
pick "the most relevant" — keep it deterministic.

Fluent keys (HTML mode, identical structure pt/en):
- `web_link_no_subs` — vars: none
- `web_link_with_subs` — vars: `{ url, others }` (others is the
  comma-joined remaining list, may be empty string)

Register in both `COMMANDS_EN` and `COMMANDS_PT`. Wrap with `withCmd("web", ...)`
for telemetry parity.

Group-chat policy: respects `rejectGroupIfNoDm` — `/web` in a group from someone
who hasn't DM'd the bot first gets the standard rejection.

`SITE_URL` is read from `process.env.NEXT_PUBLIC_SITE_URL ?? "https://pegana.xyz"`
in the bot (env var doesn't exist there yet — add `PEGANA_WEB_BASE` with the
same default).

### 3 — `sub_<asset>_<bps>` deeplink confirmation

#### Payload contract extension

`parseStartPayload(raw)` returns a discriminated union instead of a string:

```ts
type StartPayload =
  | { kind: "source"; source: string }      // src_<source>[_<asset>]
  | { kind: "subscribe"; asset: string; bps: number }  // sub_<asset>_<bps>
  | null;
```

Parsing rules:
- `src_...` → unchanged behaviour, source string stored on user row.
- `sub_<ASSET>_<BPS>` where ASSET is `[A-Za-z0-9+]+` (allow `+` to support
  `hyloSOL+`), BPS is a positive integer ≤ `THRESHOLD_PCT_MAX * 100`. We accept
  bps directly (not percent) for URL compactness — but document this so the
  frontend uses bps.
- Anything else → `null`.

Backwards-compat: callers of the old string-returning function get updated
in lockstep (only `bot.command("start", ...)` uses it).

#### `/start` flow with `sub` payload

```text
ctx.match = "sub_jitoSOL_50"
  ↓
parseStartPayload → { kind: "subscribe", asset: "jitoSOL", bps: 50 }
  ↓
- upsert user (source = null on subscribe payload — we attribute via the action itself)
- send welcome photo (as today)
- if FEATURE_PUBLIC_ALERTS=false, send banner (as today)
- look up asset; if unknown, send `unknown_asset` and bail
- send confirmation message with InlineKeyboard:
    ✅ Subscribe to {asset} @ {pct}%
    ⚙️ Change threshold
    ❌ Cancel
```

Inline-keyboard callback data (Telegram limits to 64 bytes):
- `subok:<asset>:<bps>` → invoke existing `db.subscribe(user.id, asset, bps)` (idempotent: if a sub already exists it bumps threshold; matches `/subscribe` behaviour).
- `subcust:<asset>` → answerCallbackQuery + send a message that prompts `/threshold <asset> <pct>` usage.
- `subno` → answerCallbackQuery with `cancelled` toast + edit message to remove keyboard.

After confirm: edit the original confirmation message to "✅ Subscribed to {asset} @ {pct}%" and remove the keyboard so the button can't be clicked twice.

Group-chat: same `rejectGroupIfNoDm` policy applies if the deeplink is opened from a group (rare but possible). The `/start` is generally a private-chat thing, so this is just defensive.

Fluent keys (en + pt-BR):
- `sub_confirm` — vars: `{ asset, pct }` — body text above the keyboard
- `sub_confirm_button_yes` — keyboard label
- `sub_confirm_button_custom` — keyboard label
- `sub_confirm_button_cancel` — keyboard label
- `sub_confirmed` — vars: `{ asset, pct }` — message after Yes click
- `sub_cancelled` — toast
- `sub_custom_hint` — body with `/threshold <asset> <pct>` example

### 4 — Per-asset Open Graph image

New file: `web/app/(app)/asset/[symbol]/opengraph-image.tsx`

Next 16 file-convention API (verified in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`):

```ts
import { ImageResponse } from "next/og";

export const alt = "Pegana — peg status";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  // fetch asset state from API_BASE/v1/assets/<symbol>
  // render 1200x630 JSX with symbol, state pill, discount, intrinsic vs market
  // graceful fallback on fetch failure → generic "pegana.xyz" card
  return new ImageResponse(<JSX/>, { ...size });
}
```

`params: Promise<...>` is the v16 breaking change (was sync in v14/v15). The
existing `embed/badge/[symbol]/route.ts` reads from
`process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080"` — we use the same
constant.

Visual brief (kept simple — Satori has tight CSS constraints):
- Canvas: pure black `#000`
- Top-left: brand mark `[ pegana ]` in mono, ~28px, muted color
- Center-left: asset symbol gigantic (160px, white, serif/system-stack fallback since custom font requires bytes)
- Below symbol: state pill (color + label) at 32px
- Right column: two-line stack — "intrinsic $X.XXXX" / "market $X.XXXX" in mono 28px
- Bottom-right: iridescent gradient hairline + "pegana.xyz / live" footer at 18px

State colour map mirrors `embed/badge` route:
```ts
const STATE_COLOR = {
  PEGGED: "#3fa776", DRIFT: "#c08a55",
  DEPEG: "#c34a4a", CRITICAL: "#c34a4a",
  BLACK_SWAN: "#c34a4a", UNKNOWN: "#7d909d",
};
```

Twitter card: `web/app/(app)/asset/[symbol]/twitter-image.tsx` re-exports
`default`, `alt`, `size`, `contentType` from the OG file (one-line file). Both
file conventions inject the appropriate `<meta>` tag.

Fonts: ship without custom-font bytes in v1 — `system-ui, sans-serif` fallback.
A future polish loads Inter from `web/public/fonts/` as raw bytes (Satori
requires this; can't reuse `next/font`).

Caching: by default `opengraph-image` is statically optimized, but our
`fetch(/v1/assets/...)` is uncached so Next will treat the route as dynamic. We
accept the per-request cost — OG fetches are infrequent (only when scrapers
hit, not user pageviews).

Failure mode: if the fetch fails or symbol is unknown, render a generic
"pegana.xyz" fallback (not a 404 — broken social cards are worse than generic
ones).

### 5 — Dashboard "Alert me" CTAs

#### `universe-grid.tsx`

Each grid card row has space for a small action on hover. Add:

```tsx
<a
  href={peganaBotHref("dashboard", asset.symbol)}
  target="_blank"
  rel="noreferrer"
  aria-label={`Alert me on ${asset.symbol}`}
  className="opacity-0 group-hover:opacity-100 transition-opacity ..."
>
  <BellIcon className="size-3.5" />
  alert
</a>
```

Discovery: `group-hover` reveals on row hover only — keeps the grid visually quiet for browsing, surfaces intent when the user is pointing at a specific asset. Touch devices: hover doesn't fire on iOS Safari; for v1 we accept this (mobile users have the action strip at the bottom of the asset page).

#### `asset-table.tsx`

Tables are denser and the hover reveal pattern feels janky here. Add a fixed
column on the right with a small "Alert" link styled as a quiet button:

```tsx
<td>
  <a href={peganaBotHref("dashboard", asset.symbol)} ...>Alert →</a>
</td>
```

Both use the standard `peganaBotHref("dashboard", symbol)` — the `dashboard`
source string lands in `users.source` via existing `parseStartPayload` so we
get attribution for free.

## Test plan

| Item | Test |
|---|---|
| 1 | `bot-link.test.ts` updated; manual visit to `peganaBotHref(...)` resolves |
| 2 | New bot integration test for `/web` (gated on `PEGANA_INTEGRATION_DB`), 2 cases: 0 subs and N subs |
| 3 | New unit tests in `helpers.test.ts` for `parseStartPayload` covering `src_*`, `sub_*`, malformed, edge bps |
| 3 | Manual: open `t.me/PeganaWatchBot?start=sub_jitoSOL_50` → confirm flow works |
| 4 | Manual: visit `/asset/jitoSOL/opengraph-image` and `/twitter-image` in browser, inspect image |
| 4 | Twitter card validator + Facebook sharing debugger on `pegana.xyz/asset/jitoSOL` after deploy |
| 5 | Visual: hover universe-grid card, confirm Alert link appears; click → opens Telegram |

## Rollout order

1. (1) handle fix — unblocks 4 and 5 (otherwise CTAs go to wrong bot).
2. (2) `/web` command — independent.
3. (3) `sub_*` deeplink + confirm flow.
4. (4) OG image.
5. (5) dashboard CTAs — depends only on (1).

Each step is committed independently. Sprint mergeable any time.

## Coordination with concurrent `feat/v1.1-console`

Touch-zone diff:

| File | This sprint | v1.1 console |
|---|---|---|
| `migrations/` | — | adds new migration |
| `crates/api-rs/` | — | auth handler + `/v1/me/*` |
| `bot-ts/src/db.ts` | — | possibly adds auth fields |
| `bot-ts/src/index.ts` | adds `/web`, extends `/start` | possibly adds `/login` |
| `web/app/account/*` | — | new routes |
| `web/components/.../header*.tsx` | — | adds Login button |
| `web/lib/bot-link.ts` | edits | — |
| `web/app/(app)/asset/[symbol]/opengraph-image.tsx` | new file | — |
| `web/components/organisms/universe-grid.tsx` | edits | — |

Likely overlap: only `bot-ts/src/index.ts`. Resolution: simple textual merge —
new commands are added in distinct top-level blocks; menus are list literals.
If a conflict arises, rebase this branch on the merged v1.1 changes.

## Done criteria

- All 5 items committed and pushed.
- Unit tests pass: `cd web && bun test`, `cd bot-ts && bun test`.
- Manual smoke: each deliverable verified per the test plan table.
- PR opened (or fast-forward merge to main, depending on how `feat/v1.1-console` lands first).

## Outcome (2026-05-25)

Three of the five items shipped on `feat/quick-wins-sprint` after the
concurrent `feat/v1.1-console` branch was discovered to be doing items
2 (`/web`) and 3 (`sub_*` deeplink) already:

| # | Status | Notes |
|---|---|---|
| 1 — handle fix | ✅ Shipped (commits `ad92ff3` + `b637140`) | 10 files updated; `feat/v1.1-console` lacks this fix → it must rebase on top after merge. |
| 2 — `/web` command | ⏭ Ceded to `feat/v1.1-console` | Their version points at `/account/subscriptions` which lines up with the Console UX. |
| 3 — `sub_*` deeplink | ⏭ Ceded to `feat/v1.1-console` | Their version auto-subscribes instead of asking — flagged in code review as a UX call worth revisiting. |
| 4 — OG image | ✅ Shipped (commits `5481789` + `36ed09f`) | Build passed; rendered as dynamic route. `runtime` re-export removed for Turbopack. |
| 5 — Asset-table Alert CTA | ✅ Shipped (commit `8c99709`) | Hover-revealed pill; restructured row so anchors no longer nest. |
