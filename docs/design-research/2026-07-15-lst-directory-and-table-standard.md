# /lst directory + the real-`<table>` standard — completion record (2026-07-15)

> Branch `landing/v2-port` (`9852bc6`). **Preview only — nothing on `main`/prod.**
> Merge + engine deploy are founder-gated. This is the operator record of the
> V2-finishing session; the running log lives in `ROADMAP.md` (Current state
> 2026-07-15).

## 1. `/lst` — public LST peg-risk directory (new)

`pegana.xyz/lst` overlays Pegana's live verdict on the whole Solana LST universe.

- **Data:** lst-directory.com (Hylo — 244 LSTs, on-chain TVL/APY/rate, 15-min
  refresh) merged by mint with Pegana's `/v1/assets?class=lst` (60s). Graceful
  fallback to Pegana's own tracked LSTs if the directory is unreachable.
  Layer: `web/lib/lst/{fetch-directory,fetch-pegana-lst,merge,parse,format,types}.ts`.
- **Table** (`web/components/organisms/lst/lst-directory-table-v2.tsx`, via the
  shared `ListRowsV2` real-`<table>`): a **real logo on every row** — covered
  rows use the vendored self-hosted `TokenIcon` (`/tokens/{mint}.webp`),
  uncovered rows use a **same-origin logo proxy** (`app/api/token-logo/route.ts`)
  that relays the directory's `logoUri` through our own origin (the page CSP
  `img-src 'self'` blocks the external CDNs directly). The proxy is SSRF-safe by
  construction — the client sends only a `mint`; the URL fetched is always the
  `logoUri` lst-directory.com published for that exact mint (resolved from the
  same cached directory fetch), http(s)-only, private/loopback hosts blocked,
  `image/*` content-type required, 5s timeout, 1 MB cap, every failure → 404 →
  monogram. A first-class **"vs NAV"** column showing premium(+)/discount(−) in
  the holder convention; a "The universe" section header + a credit line to
  lst-directory.com.
- **Partnership:** `docs/outreach/2026-07-15-hylo-lst-directory-integration.md`
  — the /lst demo IS the pull-test for the Hylo peg-risk-layer proposal.

Coverage: the 7 new LSTs + reactivated dSOL show **"not yet rated"** until the
engine ships the expanded `assets.toml` (founder-gated). That's honest, not a bug.

## 2. The "1001% validado" flags — all closed

1. **bps→% + spread sign.** The API's internal `discount` field is signed
   `intrinsic−market` (premium = negative). /lst rendered the raw value, so a
   healthy LST at a +1% premium read as a scary "−1%". Fixed once in the data
   layer (`lib/lst/merge.ts` negates → `spreadBps` is holder-signed: `+` premium
   above NAV, `−` discount below). Playwright-verified on the preview.
2. **Divergence self-audit alert.** `PeganaIntrinsicDivergence`
   (`ops/alerts/pegana.yml`, warning/indexer, `pegana_intrinsic_divergence_bps
   > 75` for 30m) completes the observability of the `lst_directory_audit`
   source (which already emits the gauge + a per-poll WARN). `promtool check
   rules` → 22 rules OK. Judgment calls kept deliberate: denominator = our rate
   (we're the reference under audit); match-by-mint only (a symbol fallback could
   mis-audit); 75bps mirrors `INTRINSIC_DIVERGENCE_TOLERANCE_BPS`.
   > ⚠️ **Superseded 2026-07-17 (backend-upgrade Item 3):** the 75bps here was
   > wrong — our rate (Sanctum sol-value, *realizable*) and the directory's
   > `rate` (*booked* NAV) are different quantities, with a permanent ~114-124bps
   > structural redemption haircut (verified live), so 75 paged on every LST
   > forever. Threshold raised to **300** (feed-integrity tripwire only) and the
   > source now also decodes the directory's `flags{stale,deprecated,dead}` +
   > `ratePrev` → new `PeganaLstDirectoryFlagged` alert (backend twin of the
   > frontend INTRINSIC_DEGRADED advisory, ADR-0037).
3. **Real icons for the 7 new LSTs.** Vendored from Sanctum's registry
   (`extra-api.sanctum.so/v1/lsts`); `MONOGRAM_FALLBACK` removed from the coverage
   guard; `vendor-token-icons.mjs` restored (it was a react-doctor false-positive
   deletion in `712c6ca` — it's run via `package.json` `icons:sync`, not imported).
4. **"Pegged −1%"** was flag 1's sign bug, not a threshold bug. LST thresholds
   (drift 55 / depeg 140 / critical 300 bps) are correct.

**Bonus — two mobile bugs found in Playwright, both fixed:**
1. The marketing nav drawer (`.v2-ndrawer`) bled the hero through its links —
   `backdrop-filter` computes to `none` here (loses to Tailwind's cascade; iOS
   Safari drops it under fixed+rounded stacking), so any translucency leaked.
   Switched to a solid `#141418` surface.
2. The app-shell native `<dialog>` menu (dashboard-topbar) opened **empty** on
   mobile — the `<dialog>` is `fixed` top+bottom, but the UA gives it
   `height: fit-content` and every child is absolute/fixed → it collapsed to
   ~0px. `height: auto` on `.mobile-menu-dialog` lets top+bottom resolve the
   height (0px → 771px). Verified in-browser (all nav links visible).

## 3. Real-`<table>` is the app-wide standard (confirmed, not migrated)

Rafael: "igual é em /dashboard. Isso tem que ser o padrão." Audited every data
surface — **all are already real semantic `<table>`s, zero div-tables:**

| Surface | Idiom |
|---|---|
| dashboard board, `/assets` screener, `/account/alerts`, peer-comparison, exit-liquidity, alert-policy | hand-rolled `<table table-fixed>` + `<colgroup>` |
| `/lst`, about, audit, changelog, methodology, status, assets-canon | shared `ListRowsV2` (`<table>` + colgroup, grid rows) |

Both are approved real-table idioms. Nothing to migrate — the dashboard board
and /lst already share the same `<table>`/`<colgroup>` mechanic. Formalized as a
rule in `web/AGENTS.md` (§ "V2 data tables — always a real `<table>`") so future
surfaces comply. The dashboard board (crown-jewel, craft-passed) stays as-is.

## 4. Validation

tsc clean · **628/628 vitest** · Playwright on the preview (desktop + mobile:
/lst, the nav drawer, `documentElement.scrollWidth === clientWidth` at 390px so
the page never scrolls sideways). Commits on `landing/v2-port`:
`dd89a0d` icons · `95142f1` spread-sign · `86075eb` alert · `56e3824` /lst
redesign · `9852bc6` drawer. Pushed to the preview branch only — never
`origin/main`.

## 5. Still open (founder-gated)

- Deploy the engine with the expanded `assets.toml` (the 7 LSTs + dSOL then flip
  to live "rated" on /lst).
- Merge `landing/v2-port → main` (the whole V5 rebrand + /lst).
- Send the Hylo `/lst` partnership message.
