# Token Icons — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Rafael + Claude
**Scope:** Add per-asset token logos across the Pegana web app (all 9 asset-rendering surfaces), sourced and vendored at build time with a brand-controlled fallback that never breaks.

---

## 1. Goal & motivation

Today the only per-asset visual in the app is the `StatePip` (a colored dot). Assets are identified by their `symbol` text alone (e.g. `jitoSOL`, `USDC`, `hyUSD`). Adding a real token logo next to each symbol makes the dashboard and `/asset` pages instantly scannable and more premium — table-stakes for a polished crypto product (CoinGecko / Phantom / Jupiter / DefiLlama all do this).

Because Pegana is a **trust** product (peg monitoring), a broken/missing icon reads as a broken product. The non-negotiable requirement: **every asset always renders a clean visual identity** — a real logo when we have one, a branded fallback when we don't. No broken image ever ships.

## 2. Coverage finding (validated 2026-06-17)

The Jupiter Token API v2 (`/tokens/v2/search?query={mint}`) was probed live for **all 26 active mints**. It returned an `icon` URL for **26/26**, including every niche DeFi token (hyUSD, sHYUSD, hyloSOL, hyloSOL+, xSOL, JupUSD, JLP, ONyc, dzSOL, vSOL, syrupUSDC, sUSD, sUSDe, USDY). **Coverage is effectively 100% today via Jupiter alone.**

Caveat that drives the design: the source hosts are heterogeneous and several are fragile — `i.ibb.co`, `*.ipfs.nftstorage.link`, `arweave.net`, `*.s3.amazonaws.com`, `hubspotusercontent`, plus `circle.com/eurc-icon` (which may not be a direct image). We must **not** depend on these at runtime. Therefore: **fetch once at build, self-host.**

## 3. Visual treatment (locked)

- **Circle + hairline ring.** Circular avatar, full-color logo, with a 1px inner ring (`inset 0 0 0 1px rgba(255,255,255,.14)`) that unifies mismatched source art and adds polish. Background disc `#141414` (surface-2) shows behind transparent logos and during load.
- Universal token convention; chosen over squircle and sharp-square in the visual companion. (The brand is sharp/0px for *cards*, but token logos are drawn round — a sharp crop looked harsh.)
- **No network/chain badge** — everything is Solana, so a chain badge would be pure noise.
- Full color (not monochrome).

## 4. Sourcing cascade (build-time)

Resolved per `mint`, in order; first hit wins:

1. **Manual override** — `web/lib/token-icons/overrides.ts`, a `Record<mint, string>` mapping to a pinned URL or a local file under `web/public/tokens/_overrides/`. For hand-fixing any logo that is ugly / low-res / wrong / a non-image URL (e.g. EURC if needed).
2. **Jupiter Token API v2** — `GET https://api.jup.ag/tokens/v2/search?query={mint}` (keyed; Pegana already holds a Jupiter key in the indexer) or keyless `https://lite-api.jup.ag/...` as a dev fallback. Read the `icon` field. **Covers 26/26 today.**
3. **Metaplex on-chain metadata** — resolve the mint's metadata account → off-chain JSON `image`. Defensive only, for a future asset Jupiter doesn't index yet.
4. **Branded monogram** — deterministic disc tinted by asset `class` + the symbol's first 1–2 letters in JetBrains Mono. True last resort; not used by any current asset.

## 5. Vendoring pipeline

**Script:** `web/scripts/vendor-token-icons.mjs`, run via `bun run icons:sync` (web uses Bun).

Behavior:
- Read `assets.toml` (repo root) → iterate active entries (those without `active = false`). Implemented as active-only: the 2 inactive assets (BRZ, pbUSDC) render nowhere in the app, so vendoring them would be dead output. Revisit only if a historical-snapshot view ever needs deactivated-asset icons.
- For each mint, walk the cascade (§4), **download the image once**, normalize: square canvas, preserve transparency, resize to **96×96 WebP** (~2–4 KB each; crisp on retina at the largest 44px render).
- Write `web/public/tokens/{mint}.webp`.
- Write `web/public/tokens/manifest.json` — provenance per mint: `{ mint, symbol, source: "override"|"jupiter"|"metaplex"|"monogram", fetchedAt, bytes }`.
- **Log** (not silently skip) any mint that fell through to `monogram`.
- **Idempotent:** a content hash avoids re-writing unchanged files; re-running only updates what changed.

The circular crop and ring are **not** baked into the file — they are applied in the component (CSS), so one square source works at every size and the ring stays consistent.

## 6. CI guard

Extend the existing asset-verification check (`cargo xtask verify-assets`, which already gates CI on unverified mints) — or add an equivalent check in the sync script run in CI — to **fail** if any active mint in `assets.toml` lacks both a vendored `{mint}.webp` and an override entry. Adding a new asset thus *forces* icon sourcing before it can ship. Mirrors the existing "no unverified mint" guard.

## 7. `<TokenIcon>` component

**File:** `web/components/atoms/token-icon.tsx`. Single component used on every surface.

```tsx
interface TokenIconProps {
  mint: string;
  symbol: string;          // for the monogram fallback initials + alt text
  klass?: AssetClass;      // for the monogram tint
  size?: number;           // px; default 24
  className?: string;
  alt?: string;            // override; default derives from symbol
}

<TokenIcon mint={a.mint} symbol={a.symbol} klass={a.class} size={24} />
```

- Renders `<img src="/tokens/{mint}.webp" width={size} height={size}>` inside the circle+ring disc.
- `onError` → swap to the monogram (symbol initials + class tint). No runtime dependency on any external host.
- Explicit `width`/`height` → **no layout shift** (CLS). `loading="lazy"` in long lists; `loading="eager"` for the `/asset` hero.
- A11y: when the `symbol` text sits adjacent (the common case), `alt=""` + `aria-hidden` to avoid duplicate screen-reader announcement; otherwise `alt="{symbol} logo"`.
- Plain `<img>` (no `next/image`) — files are local, tiny, and pre-sized; avoids touching `next.config.ts` image config.

## 8. Size scale & integration points

Single scale: `xs=16 · sm=20 · md=24 · lg=32 · xl=44`.

| Surface | File | Position | size |
|---|---|---|---|
| Dashboard desktop row | `components/organisms/asset-table.tsx` (~L162) | after pip, before symbol | 24 |
| Dashboard mobile row | `components/organisms/mobile-asset-row.tsx` (~L60) | after pip | 28 |
| `/asset` hero | `components/organisms/asset-hero-v2.tsx` | left of symbol/name | 44 |
| `/asset` sticky header | `app/(app)/asset/[symbol]/page.tsx` (~L224) | after pip | 22 |
| `/asset` breadcrumb | `app/(app)/asset/[symbol]/page.tsx` (~L255) | before symbol | 16 |
| Screener rows | `app/(app)/assets/page.tsx` (~L448, ~L495) | after pip | 20 |
| Compare card | `app/(app)/compare/page.tsx` (~L521) | left of symbol h-row | 32 |
| Events cluster | `app/(app)/events/page.tsx` (~L412) | left of asset heading | 28 |
| Asset picker dropdown | `components/molecules/asset-picker.tsx` | after pip | 20 |

## 9. Testing (vitest)

- `TokenIcon` renders `<img>` with the correct `src` for a given mint.
- `onError` → monogram with correct initials and class tint.
- Monogram is deterministic (same symbol → same initials/color).
- Manifest snapshot covers all active mints in `assets.toml` (catches a dropped icon).
- A11y: adjacent-symbol case renders `aria-hidden`/empty alt.

## 10. Out of scope / deferred

- Animated or hover-state icon treatments.
- Network/chain badges.
- A runtime fetch path (deliberately rejected — vendoring chosen for speed, reliability, brand control).
- Light-theme-specific logo variants (the dark disc works for both; revisit only if a specific logo clashes on light canvas).

## 11. Deploy

Frontend-only change. No backend (engine/indexer/api/dispatcher) touched → **calibration untouched**. Ships via the normal Vercel-on-push path for `web/`. The vendored `web/public/tokens/` files are committed to the repo (build output of `icons:sync`), so production needs no network access to render icons.

---

### Reference appendix — live-probed icon sources (2026-06-17)

All 26 active mints returned a Jupiter v2 `icon`. Hosts seen: `storage.googleapis.com`, `raw.githubusercontent.com` (solana-labs token-list, archived but still serving), `arweave.net`, `*.ipfs.nftstorage.link`, `static.jup.ag`, `hylo-token-metadata.s3.amazonaws.com`, `i.ibb.co`, `doublezero.xyz`, `static.bymj.io`, `ipfs.io`, `hubspotusercontent`, `circle.com` (EURC — verify direct-image; override candidate). This heterogeneity is the core justification for build-time vendoring.
