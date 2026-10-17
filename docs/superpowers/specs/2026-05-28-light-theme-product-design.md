# Light theme for product (`(app)`) surfaces — design spec

**Date:** 2026-05-28
**Branch:** `feat/light-theme-product`
**Status:** Draft — implementation ready
**Owner:** Rafael (solo)
**Implementer:** Codex (handoff)
**Predecessor:** `docs/superpowers/specs/2026-05-28-light-theme-design.md` (marketing surfaces, shipped)

---

## 1. Intent

Extend the existing light theme (shipped on marketing surfaces) to the entire `(app)` route group. **Token swap only, no redesign** — same as marketing. Same toggle behavior, same animation, same default (dark), same `localStorage` key (shared across surfaces).

Out of v1 of the light theme, `(app)` was guarded to dark-only via a `<div data-theme="dark">` wrapper in `app/(app)/layout.tsx`. This spec removes that guard and fixes every component that hardcoded dark-mode colors so the theme actually swaps end-to-end.

This spec does **not** alter:
- Component structure, layout, or copy on any product page
- Animations, motion timing, scroll behavior, chart interactions, GSAP timelines
- Iridescent gradient, coral/magenta brand accents, hero spotlight
- `/embed` — still dark-only (third-party iframe consumers)
- OG / metadata images — still dark
- `LiveAlertBubble` Telegram skin — keeps `bg-[#17212b] text-white` because it mimics Telegram's native dark UI

---

## 2. Out of scope

- Recharts / sparkline color overhaul — already use semantic tokens (`st-pegged`, `text-muted`, `hairline`) which invert via tokens
- Drop shadows on modals/popovers (`shadow-[0_X_Y_rgba(0,0,0,0.6)]`) — keep as-is in v1. They read as standard panel-depth shadow on white. If they feel heavy in light after live testing, reduce intensity in a follow-up.
- TradingView chart preset overhaul — only theme-color reactivity is wired (§7)
- New tokens — every value the product needs is already declared by the marketing spec

---

## 3. Tokens — no changes

All needed tokens were declared in the marketing light-theme spec and shipped to `globals.css`:

- `--color-canvas`, `--color-surface-1`, `--color-surface-2`
- `--color-text`, `--color-text-body`, `--color-text-muted`, `--color-text-caption`
- `--color-hairline`, `--color-outline`
- `--color-st-pegged`, `--color-st-drift`, `--color-st-depeg`, `--color-st-critical`, `--color-st-unknown`
- `--color-text-rgb` (consumed by components that need `rgba()` composition at runtime)
- `--wordmark-fill`
- `--gradient-iridescent`, `--color-coral`, `--color-magenta` (brand — same in both themes)

No additions in this spec.

---

## 4. Shell change — drop the guard

**File:** `web/app/(app)/layout.tsx`

```tsx
// BEFORE
<div data-theme="dark" className="relative min-h-screen bg-canvas text-text">

// AFTER
<div className="relative min-h-screen bg-canvas text-text">
```

The `<html>` `data-theme` attribute now flows through the entire app subtree, same as marketing.

---

## 5. Theme toggle in product topbar

**File:** `web/components/organisms/dashboard-topbar.tsx`

This is the actual header rendered by `app/(app)/layout.tsx`. (The `product-header.tsx` file exists but isn't wired to any route.)

Insert `<ThemeToggle />` in the right-side group, immediately after the "Account" link and before `<MobileMenu>` — mirroring the marketing header pattern. Existing right-side group:

```tsx
<div className="flex items-center gap-3">
  <AccountMenu />
  <MobileMenu links={MOBILE_LINKS} />
</div>
```

Becomes:

```tsx
<div className="flex items-center gap-3">
  <AccountMenu />
  <ThemeToggle />
  <MobileMenu links={MOBILE_LINKS} />
</div>
```

The `MobileMenu` molecule already renders an internal `<ThemeToggle />` (added in the marketing PR) — no edits needed inside the mobile drawer.

---

## 6. `useTickFlash` — theme-aware restore color

**File:** `web/lib/motion/use-tick-flash.ts`

Current signature forces callers to pass `restore: "#fffdf9"` (off-white) or it defaults to that — fine in dark, invisible in light.

```ts
// BEFORE
export function useTickFlash(
  ref: React.RefObject<HTMLElement | null>,
  signal: unknown,
  opts: { color?: string; restore?: string } = {},
) {
  const { color = "#ff8400", restore = "#fffdf9" } = opts;
  // ...
  gsap.to(node, { color: restore, duration: 0.18, ease: "power2.out" });
}
```

Change to:

```ts
// AFTER
export function useTickFlash(
  ref: React.RefObject<HTMLElement | null>,
  signal: unknown,
  opts: { color?: string; restore?: string } = {},
) {
  const { color = "#ff8400", restore } = opts;
  // ...
  const restoreColor = restore
    ?? (typeof window !== "undefined"
      ? getComputedStyle(node).getPropertyValue("--color-text").trim() || "#fffdf9"
      : "#fffdf9");
  gsap.to(node, { color: restoreColor, duration: 0.18, ease: "power2.out" });
}
```

Read `--color-text` at flash time (inside the async effect) — picks up whichever theme is currently active. SSR fallback `#fffdf9` is never reached in practice because `useEffect` only runs client-side.

**Callers to update** — drop `restore` from opts (let hook resolve from token):

- `web/components/molecules/active-mini-chart.tsx:69`
- `web/components/organisms/asset-table.tsx:82`
- `web/components/organisms/asset-hero-v2.tsx:96`

Each line:

```ts
// BEFORE
useTickFlash(spreadRef, signal, { color: "#ff8400", restore: "#fffdf9" });

// AFTER
useTickFlash(spreadRef, signal, { color: "#ff8400" });
```

---

## 7. TradingView Lightweight Charts — theme reactivity

**File context:** `web/components/organisms/tv-chart/theme.ts` already reads `--color-canvas` and `--color-text` at chart mount via `getComputedStyle`. The DEFAULTS (`#000000`, `#fffdf9`) on lines 28/31 are fallbacks only and never used in the browser path.

The gap: the chart reads tokens **once at mount**. When the user toggles theme with a chart visible, colors don't refresh. Fix:

**File to edit:** `web/components/organisms/tv-chart/index.tsx` (or whichever file instantiates the chart and calls `theme.ts`)

Add a `MutationObserver` on `<html>` watching for `data-theme` attribute changes. On change, re-read tokens and call `chart.applyOptions()`. This re-styles in place — preserves user's pan/zoom.

```tsx
useEffect(() => {
  if (!chartRef.current) return;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "data-theme")) {
      const t = readChartTheme(); // existing function in theme.ts
      chartRef.current?.applyOptions({
        layout: { background: { color: t.canvas }, textColor: t.text },
        grid: {
          vertLines: { color: t.hairline },
          horzLines: { color: t.hairline },
        },
        // any other options that depend on tokens
      });
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}, []);
```

If `tv-chart/theme.ts` exposes a `readChartTheme()` style helper, reuse it. If not, inline the same `getComputedStyle(document.documentElement).getPropertyValue(...)` calls already there.

**Pages affected:** `/asset/[symbol]`, `/compare` (any route that renders `<TVChart />`).

---

## 8. State pip glow — wrap in `dark:`

Same pattern shipped in `live-this-week.tsx` and `channels-section.tsx`. One file in product still has unconditional glows:

**File:** `web/app/(app)/status/page.tsx` lines 174–176

```tsx
// BEFORE
overall === "PEGGED" && "bg-st-pegged shadow-[0_0_10px_var(--color-st-pegged)]",
overall === "DRIFT"  && "bg-st-drift shadow-[0_0_10px_var(--color-st-drift)]",
overall === "DEPEG"  && "bg-st-depeg shadow-[0_0_10px_var(--color-st-depeg)] animate-pulse",

// AFTER
overall === "PEGGED" && "bg-st-pegged dark:shadow-[0_0_10px_var(--color-st-pegged)]",
overall === "DRIFT"  && "bg-st-drift dark:shadow-[0_0_10px_var(--color-st-drift)]",
overall === "DEPEG"  && "bg-st-depeg dark:shadow-[0_0_10px_var(--color-st-depeg)] animate-pulse",
```

The `animate-pulse` stays in both themes (intentional — `DEPEG` should always pulse for attention).

---

## 9. Token-rgb migration — 5 files

Mechanical rewrite. Every hardcoded `rgba(255,253,249, X)` becomes `rgba(var(--color-text-rgb), X)` so it inverts with the theme.

| File | Line | Change |
|---|---|---|
| `web/components/atoms/dotted-grid-bg.tsx` | 15 | `radial-gradient(rgba(var(--color-text-rgb), 0.05) 1px, transparent 1px)` |
| `web/components/atoms/engine-flow-strip.tsx` | 58 | `background: "rgba(var(--color-text-rgb), 0.06)"` |
| `web/components/atoms/recovery-gauge.tsx` | 48 | `stroke="rgba(var(--color-text-rgb), 0.08)"` |
| `web/components/molecules/dot-grid.tsx` | 8 | `radial-gradient(circle, rgba(var(--color-text-rgb), 0.07) 1px, transparent 1.6px)` |
| `web/components/organisms/asset-preview-pane.tsx` | 221 | `background: "rgba(var(--color-text-rgb), 0.015)"` |

**Verify after each edit:** Tailwind v4 + the rendered HTML accept `rgba(var(--token), alpha)` syntax. Modern browsers (Chrome 117+, Safari 16.4+, Firefox 113+) all support `rgb(R G B / A)` and `rgba(R, G, B, A)` with custom-property substitution inside. This is the same pattern used in the marketing's `HeroCanvas` after the spec.

---

## 10. Intentional hardcodes — do NOT change

These look like hardcoded colors but are deliberate. Document so future audits don't churn them.

- **`molecules/live-alert-bubble.tsx:102`** — `bg-[#17212b] text-white border-white/10`. This is the **Telegram-themed alert bubble**. It mimics the Telegram client's native dark UI. Stays dark in both themes (Telegram is always dark).
- **`molecules/live-alert-bubble.tsx:128`** — `color: "#000"` on the avatar letter inside the iridescent gradient circle. Black on iridescent reads correctly in both themes.
- **All `shadow-[0_X_Y_rgba(0,0,0,0.X)]` drop shadows** on modals, popovers, dropdowns (`alerts-modal`, `recipe-modal`, `asset-picker`, `nav-dropdown`, `help-icon`, `uptime-bars`). These are depth shadows, not glows. In light they read as standard floating-panel shadow. Keep as-is for v1; tune intensity in a follow-up if reported.
- **`app/(app)/asset/[symbol]/opengraph-image.tsx:96`** — `color: "#fffdf9"`. OG card stays dark for social previews.
- **`organisms/tv-chart/theme.ts` DEFAULTS** lines 28, 31 — fallbacks only, never used in browser. Keep.

---

## 11. Page scope — all of `(app)` lights up

| Route | Components needing item 9 swap | Components needing items 6/7/8 |
|---|---|---|
| `/dashboard` | `engine-flow-strip`, `dot-grid` | `useTickFlash` (active-mini-chart) |
| `/dashboard` (background) | `dotted-grid-bg` | — |
| `/asset/[symbol]` | `asset-preview-pane` | `useTickFlash` (asset-hero-v2), TV chart observer |
| `/assets` | — | `useTickFlash` (asset-table) |
| `/compare` | — | TV chart observer |
| `/events` | `dotted-grid-bg` (if used) | — |
| `/account`, `/account/alerts`, `/account/subscriptions`, `/account/webhooks` | — | — (token-only swap, no hardcodes) |
| `/status` | `recovery-gauge` | glow wraps (item 8) |

---

## 12. Files touched — summary

### Edited (11 files)

1. `web/app/(app)/layout.tsx` — drop `data-theme="dark"`
2. `web/components/organisms/dashboard-topbar.tsx` — insert `<ThemeToggle />`
3. `web/components/atoms/dotted-grid-bg.tsx` — token-rgb
4. `web/components/atoms/engine-flow-strip.tsx` — token-rgb
5. `web/components/atoms/recovery-gauge.tsx` — token-rgb
6. `web/components/molecules/dot-grid.tsx` — token-rgb
7. `web/components/organisms/asset-preview-pane.tsx` — token-rgb
8. `web/components/molecules/active-mini-chart.tsx` — drop `restore` from useTickFlash call
9. `web/components/organisms/asset-table.tsx` — drop `restore`
10. `web/components/organisms/asset-hero-v2.tsx` — drop `restore`
11. `web/app/(app)/status/page.tsx` — wrap glow shadows in `dark:`

### Edited — logic change (2 files)

12. `web/lib/motion/use-tick-flash.ts` — read `--color-text` at flash time when no `restore` passed
13. `web/components/organisms/tv-chart/index.tsx` — `MutationObserver` on `data-theme` → `chart.applyOptions()`

### New files

None.

### Dependencies

None. `next-themes`, `ThemeToggle` atom, and `ThemeProvider` already in place from marketing spec.

---

## 13. Implementation order (for Codex handoff)

1. `web/lib/motion/use-tick-flash.ts` — make hook theme-aware (item 6)
2. Update the 3 callers (`active-mini-chart`, `asset-table`, `asset-hero-v2`) to drop `restore`
3. `web/components/organisms/tv-chart/index.tsx` — add MutationObserver (item 7)
4. The 5 token-rgb migrations (item 9)
5. `web/app/(app)/status/page.tsx` — wrap glow shadows (item 8)
6. `web/components/organisms/dashboard-topbar.tsx` — insert `<ThemeToggle />` (item 5)
7. `web/app/(app)/layout.tsx` — drop the guard (item 4)
8. Run `bun run typecheck && bun run build`
9. Hit each route in dev server, toggle theme, eyeball:
   - `/dashboard` — sparkline trail color, engine strip, dotted grid bg
   - `/asset/jitoSOL` — hero spread flash (trigger via WS or refetch), TV chart re-paint preserves pan
   - `/assets` — table row flashes restore correctly
   - `/compare` — TV chart re-paint
   - `/events` — background grid, state pip pills
   - `/account/*` — pure token swap, no surprises
   - `/status` — overall pip has glow only in dark, animate-pulse in both themes for DEPEG
10. Toggle theme on `/dashboard` while a chart is open with custom pan/zoom — verify zoom not reset
11. Lighthouse on `/dashboard` in light mode — accessibility ≥ current dark score
12. Open PR against `main`

---

## 14. Test plan

### Functional

- [ ] Toggle button visible in topbar on every `(app)` route
- [ ] Toggle in mobile drawer works on every `(app)` route
- [ ] Click toggle on `/dashboard`: page colors transition smoothly (~280ms, same as marketing)
- [ ] Click toggle on `/asset/jitoSOL` with TV chart visible: chart colors update without re-mount, pan/zoom preserved
- [ ] `useTickFlash` on `/dashboard` sparkline: flash → restore goes to ink (light) or off-white (dark)
- [ ] `useTickFlash` on `/asset/X` hero spread: same behavior
- [ ] State pip on `/status` in light mode: solid color, no blur shadow
- [ ] State pip on `/status` in dark mode: glow shadow present (regression check)
- [ ] DEPEG pip on `/status`: `animate-pulse` in both themes
- [ ] LiveAlertBubble on `/asset/X` or `/`: stays `bg-[#17212b]` Telegram skin in both themes
- [ ] Theme persists across page reload and across route navigation

### Cross-surface

- [ ] Set light on `/` → navigate to `/dashboard` → dashboard renders light (no flash, no reset)
- [ ] Set light on `/dashboard` → navigate to `/about` → marketing renders light
- [ ] Theme survives `next/link` soft navigations
- [ ] No `Hydration failed` errors in console after toggle on any route

### Accessibility (axe / Lighthouse)

- [ ] `/dashboard` light: WCAG AA passes (state colors recalibrated already, but re-verify in dense data viz context)
- [ ] `/asset/X` light: tables and headers readable
- [ ] `/compare` light: chart legend readable
- [ ] `/events` light: timeline + state pills readable
- [ ] `/status` light: uptime bars, recovery gauge readable

### Reduced motion

- [ ] `prefers-reduced-motion: reduce` — theme transition collapses to instant on `(app)` routes too

---

## 15. Risks

1. **`useTickFlash` race during theme switch** — if a tick flash fires the same frame the theme attribute changes, the restore color may be read mid-transition. Acceptable: the next tick will restore to the correct final color. Worst case is a single frame of slightly off color on a 300ms flash.
2. **TradingView observer fires before chart mount** — guard with `if (!chartRef.current) return` inside the observer callback. Trivial.
3. **Recharts in `/dashboard` cards** — use semantic tokens (`text-muted`, `hairline`) and should invert automatically. If any chart hardcodes a hex inline as a `stroke` or `fill` prop, fix in same PR. Audit during step 9 of implementation order.
4. **Drop shadows on modals look heavy in light** — accepted v1 risk. If reported, soften in follow-up via `data-[theme=light]:shadow-[...]` variants on the affected components. Not blocking.
5. **`tv-chart/index.tsx` location** — may need to find the actual instantiation file (could be named differently or split). Spec assumes there's a wrapping React component that calls into `theme.ts`. If the chart is instantiated in multiple places, every instantiation needs the observer or it lives in a shared hook.

---

## 16. Acceptance criteria

- [ ] Toggle visible in `DashboardTopBar` on every `(app)` route, immediately after `AccountMenu`, before `MobileMenu`
- [ ] `(app)/layout.tsx` no longer wraps in `<div data-theme="dark">`
- [ ] All 8 `(app)` routes render correctly in both themes — no contrast failures, no invisible elements, no broken charts
- [ ] TV chart on `/asset/X` and `/compare` re-paints on theme change, preserves pan/zoom
- [ ] `useTickFlash` restores to the active theme's text color (no `restore` prop passed in any caller after this PR)
- [ ] `/status` state pip glow renders only in dark; DEPEG pulse animation runs in both themes
- [ ] `LiveAlertBubble` remains Telegram-styled (dark) in both themes
- [ ] Theme persists across reload, navigation, and surfaces (marketing ↔ product)
- [ ] No hydration errors in console on any `(app)` route
- [ ] Lighthouse accessibility on `/dashboard` light ≥ current dark score
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] Lighthouse CI passes (or maintains parity — won't regress beyond current main)
