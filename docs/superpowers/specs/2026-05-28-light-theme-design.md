# Light theme for marketing surfaces — design spec

**Date:** 2026-05-28
**Branch:** `feat/light-theme-landing`
**Status:** Draft — implementation ready
**Owner:** Rafael (solo)
**Implementer:** Codex (handoff)

---

## 1. Intent

Add a light color mode to the marketing surfaces of pegana.xyz. Dark stays the default and primary identity. **Light is a token swap, not a redesign.** Same layout, same components, same animations, same copy — only the color tokens flip.

A toggle button is added to the marketing header, immediately after the existing dashboard CTA pill. The existing "Open Dashboard" pill is renamed to "Dashboard". The toggle morphs sun ↔ moon and triggers a smooth page-wide color transition.

This spec **does not** alter:
- Component structure, layout, or copy
- Animations, motion timing, or scroll choreography
- The iridescent gradient, sunset coral/magenta brand accents, hero spotlight
- Dashboard (`(app)` group) — stays dark-only in v1 (chart density and TradingView theming are calibrated for dark)
- `/embed` route — stays dark-only in v1 (third-party iframe consumers expect a stable palette)

---

## 2. Out of scope

- Redesign of any organism, atom, or molecule
- Changes to dashboard, asset, compare, account, events, status pages
- Light variant of `/embed` widget (third-party-facing)
- Light theme for the TradingView chart (`organisms/tv-chart/theme.ts`)
- Light variant of OG images / favicons / metadata images (these stay dark for social previews)
- System preference auto-detection (decision: opt-in only in v1; can enable `enableSystem` later)
- Theme cookie / SSR per-request hydration (next-themes default localStorage is enough)

---

## 3. Token system

### 3.1 Token split

Current `app/globals.css` declares `:root` and `.dark` with identical values (app is dark-only). Refactor to make dark the explicit default and add a light branch.

**Two attribute-scoped blocks** under `@theme` semantic — actual variables remain Tailwind v4 tokens.

```css
/* Default: dark. Identical to today's prod values. */
[data-theme="dark"], :root {
  --color-canvas:        #000000;
  --color-surface-1:     #0a0a0a;
  --color-surface-2:     #141414;
  --color-text:          #fffdf9;
  --color-text-body:     #e8e8e8;
  --color-text-muted:    #9aa9b8;
  --color-text-caption:  #7c7c7c;
  --color-hairline:      #1a1a1a;
  --color-outline:       #2a2a2a;
  --color-st-pegged:     #6bd697;
  --color-st-drift:      #c08a55;
  --color-st-depeg:      #a55a5a;
  --color-st-critical:   #b73838;
  --color-st-unknown:    #9aa9b8;
}

/* Light. New. Tuned for AA contrast on #ffffff. */
[data-theme="light"] {
  --color-canvas:        #ffffff;
  --color-surface-1:     #ffffff;
  --color-surface-2:     #f7f7f7;
  --color-text:          #0a0a0a;
  --color-text-body:     #171717;
  --color-text-muted:    #3d3d3d;
  --color-text-caption:  #6e6e6e;
  --color-hairline:      rgba(10,10,10,0.10);
  --color-outline:       rgba(10,10,10,0.22);
  --color-st-pegged:     #16a34a;
  --color-st-drift:      #b45309;
  --color-st-depeg:      #b91c1c;
  --color-st-critical:   #991b1b;
  --color-st-unknown:    #3d3d3d;
}
```

### 3.2 Untouched in both themes

- `--gradient-iridescent: linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%)`
- `--color-coral: #ff8a5b`
- `--color-magenta: #e878d8`
- All spacing tokens, ease tokens, font tokens
- Hero spotlight gradient stops (declared inline in `app/(marketing)/page.tsx`)
- shadcn `--background`, `--foreground`, `--card`, etc. — already use the swapped variables, so they invert automatically

### 3.3 Shadcn token remap

Already remapped via `--background: var(--color-canvas)` etc. Leave the remap intact; it follows whichever theme is active.

---

## 4. Header — copy + toggle placement

**File:** `web/components/organisms/marketing-header.tsx`

### 4.1 Rename

Line 47 currently reads `<span>Open Dashboard</span>`. Change to `<span>Dashboard</span>`.

**File:** `web/components/molecules/mobile-menu.tsx` — `ctaLabel` value passed from header. Update header line 53 from `ctaLabel="Open dashboard"` to `ctaLabel="Dashboard"`.

### 4.2 Toggle insertion

Insert `<ThemeToggle />` immediately after the Dashboard `<Link>`, before `<MobileMenu>`.

Resulting structure of the right-side group:

```tsx
<div className="flex items-center gap-3 sm:gap-4">
  <Link href="/dashboard" className="...">
    <span>Dashboard</span>
    <IconArrowRight ... />
  </Link>
  <ThemeToggle />
  <MobileMenu .../>
</div>
```

Gap stays `gap-3 sm:gap-4` — same as current.

---

## 5. Theme toggle atom

**New file:** `web/components/atoms/theme-toggle.tsx`

### 5.1 Visual spec

- Shape: 36×36 px circle (`size-9 rounded-full`)
- Border: `border border-hairline`
- Hover: `border-outline bg-text/[0.04]` (matches the ghost-CTA hover language already used in the header)
- Color: `text-text-muted` default, `text-text` on hover
- Focus: no halo (project rule — per `globals.css:212`)
- Icon: 16×16 px, currentColor, stroke 1.5, Lucide-style (matches channel-section icons)

### 5.2 Icon set

Two SVGs declared inline:

- Sun (when current theme is dark — clicking switches to light): circle + 8 rays
- Moon (when current theme is light — clicking switches to dark): crescent

Standard Lucide paths. Both icons live in the same DOM, layered via absolute positioning so they can cross-fade.

### 5.3 Animation

On click:
- Icon currently visible: `opacity 1 → 0`, `rotate 0 → 90deg`, duration 280ms, ease `cubic-bezier(0.22, 1, 0.36, 1)` (the `--ease-default`)
- Icon becoming visible: `opacity 0 → 1`, `rotate -90deg → 0`, same duration & ease
- Both transitions start simultaneously, so the rotation crosses through 0 in the middle of the swap

Implementation: `framer-motion` `<AnimatePresence mode="popLayout">` is overkill — prefer CSS classes toggled by current `theme` value. Both icons rendered, only one has `data-active`. Transition declared on the SVG.

### 5.4 Accessibility

- `<button type="button">`
- `aria-label` dynamic: `"Switch to light mode"` when theme=dark, `"Switch to dark mode"` when theme=light
- `title` same as aria-label
- `aria-pressed` not used (theme is two-state, not a toggle of a single thing)
- `prefers-reduced-motion`: skip rotation/cross-fade, swap icon instantly. The page-wide color transition (§7) also collapses to instant.

### 5.5 Hydration

The toggle must not render either icon until next-themes resolves the actual current theme (avoids flashing the wrong icon for one paint). Pattern:

```tsx
const { theme, setTheme } = useTheme();
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <div className="size-9 rounded-full border border-hairline" />; // placeholder, same dimensions
```

---

## 6. Theme provider

**New file:** `web/components/providers/theme-provider.tsx`

Thin wrapper around `next-themes` so the rest of the app imports `useTheme` from one place.

```tsx
"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

**Mount point:** `web/app/layout.tsx`

```tsx
<html lang="en" suppressHydrationWarning>
  <body>
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </ThemeProvider>
  </body>
</html>
```

- `attribute="data-theme"` — matches the CSS selectors in §3.1
- `defaultTheme="dark"` — first-paint preserves prod identity
- `enableSystem={false}` — first-visit ignores `prefers-color-scheme` (decision: light is opt-in)
- `disableTransitionOnChange={false}` — we WANT the transition; next-themes' default is to disable it during swap

**Dep to add:** `next-themes` (1.0KB gzipped, no runtime deps)

```bash
cd web && bun add next-themes
```

---

## 7. Page-wide color transition

Declared once in `app/globals.css` inside `@layer base`. Applies during theme swap.

```css
@layer base {
  html {
    transition:
      background-color 280ms cubic-bezier(0.22, 1, 0.36, 1),
      color 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Cover all elements that read tokens */
  *, *::before, *::after {
    transition:
      background-color 280ms cubic-bezier(0.22, 1, 0.36, 1),
      color 280ms cubic-bezier(0.22, 1, 0.36, 1),
      border-color 280ms cubic-bezier(0.22, 1, 0.36, 1),
      fill 280ms cubic-bezier(0.22, 1, 0.36, 1),
      stroke 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }
}
```

**Edge cases:**
- `transition` already declared in `globals.css:100-105` on `button, a` for `color/background-color/border-color/transform/box-shadow` with 200ms duration. The new global rule on `*` will win for the theme-transition properties (since later rules override). The 200ms hover transitions on buttons remain unaffected for `transform/box-shadow`. The button color/bg transitions now respect the theme-swap 280ms — this is correct (snappier hover vs slower theme swap is fine, but harmonizing to 280ms is also acceptable).
- The transition rule on `*` is generally unfriendly because it makes EVERY style change animated. Mitigation: scope to only the theme-relevant properties (background-color, color, border-color, fill, stroke). Leave `transform`, `opacity`, `box-shadow`, `width`, `height` alone — these are used by component animations and should not get a 280ms latch.

**Reduced motion:**

```css
@media (prefers-reduced-motion: reduce) {
  html, *, *::before, *::after {
    transition: none !important;
  }
}
```

Already handled globally via `globals.css:122-129`. Verify it covers the new transitions.

---

## 8. Components needing per-theme behavior (not pure token swap)

### 8.1 HeroCanvas (`web/components/effects/hero-canvas.tsx`)

**Line 129:** `ctx!.fillStyle = \`rgba(255,255,255,${op.toFixed(3)})\``;

Hardcoded white-on-black dust. In light mode, particles disappear into the canvas. Replace with theme-aware ink color.

**Strategy:** read `--color-text` at frame time as `r,g,b` tuple. Add a paired token `--color-text-rgb` declared in both theme blocks so we can compose the rgba string without parsing hex at runtime.

Add to §3.1:

```css
[data-theme="dark"], :root { --color-text-rgb: 255, 253, 249; }
[data-theme="light"]      { --color-text-rgb: 10, 10, 10; }
```

In `hero-canvas.tsx`, replace line 129:

```tsx
const textRgb = getComputedStyle(canvas).getPropertyValue("--color-text-rgb").trim() || "255, 253, 249";
// ... inside the frame loop:
ctx!.fillStyle = `rgba(${textRgb},${op.toFixed(3)})`;
```

Re-read `textRgb` on theme change so the particles transition smoothly. Option: subscribe to a `MutationObserver` watching `data-theme` on `<html>`, OR just re-read once per frame (negligible cost — `getComputedStyle` on a parent element with a known var is microsecond-scale).

In light mode the opacity ranges in `LAYERS` may need tuning — current values (max 0.8) are designed against pure black where they pop. On white, the same particle at 0.8 opacity ink reads heavier than the white version did on black. Decision: keep opacities as-is for v1; can tune after seeing it live.

### 8.2 Wordmark (`web/components/organisms/wordmark.tsx`)

**Line 50:** `background: "linear-gradient(180deg, #fff 50%, rgba(255,255,255,.35))"`

Hardcoded white gradient applied to the giant PEGANA text. In light mode this becomes invisible (white text on white background, gradient or not).

**Strategy:** replace inline `background` with a CSS variable `--wordmark-fill`. Declare in both themes:

```css
[data-theme="dark"], :root {
  --wordmark-fill: linear-gradient(180deg, #fff 50%, rgba(255,255,255,0.35));
}
[data-theme="light"] {
  --wordmark-fill: var(--color-text); /* solid ink */
}
```

In `wordmark.tsx`, change:

```tsx
style={{ background: "linear-gradient(180deg, #fff 50%, rgba(255,255,255,.35))" }}
```

to:

```tsx
style={{ background: "var(--wordmark-fill)" }}
```

The `-webkit-background-clip: text` and `-webkit-text-fill-color: transparent` already in the file work for both: in dark, clips the gradient; in light, clips the solid color (which is equivalent to setting `color: var(--color-text)` but keeps the code path identical for both themes).

### 8.3 State pip glows

Two files use `shadow-[0_0_8px_...]` on the state pip dots, which is a dark-mode atmospheric device. On white they read as "dirty smudge".

**`web/components/organisms/live-this-week.tsx:42-45`:**

```tsx
const STATE_BG: Record<TransitionState, string> = {
  depeg: "bg-st-depeg shadow-[0_0_8px_var(--color-st-depeg)]",
  drift: "bg-st-drift shadow-[0_0_8px_var(--color-st-drift)]",
  recover: "bg-st-pegged shadow-[0_0_8px_var(--color-st-pegged)]",
  critical: "bg-st-critical shadow-[0_0_8px_var(--color-st-critical)]",
};
```

Wrap the shadow in a `dark:` variant. Tailwind v4 + `@custom-variant dark (&:is(.dark *))` is already declared at `globals.css:5` but uses the `.dark` class. The new tokens use `[data-theme="dark"]` attribute. Two options:

**Option A — adjust the custom variant to match attribute:**

```css
/* in globals.css */
@custom-variant dark ([data-theme="dark"] &);
```

This makes `dark:shadow-[...]` apply when the closest ancestor (or html) has `data-theme="dark"`. Then update STATE_BG:

```tsx
depeg: "bg-st-depeg dark:shadow-[0_0_8px_var(--color-st-depeg)]",
// etc.
```

In light mode no shadow renders — clean dot. Decision: take Option A. Cleaner.

**`web/components/organisms/channels-section.tsx:150`:**

```tsx
c.status === "live"
  ? "bg-st-pegged shadow-[0_0_8px_rgba(107,214,151,0.5)]"
  : "bg-st-drift"
```

Same fix:

```tsx
c.status === "live"
  ? "bg-st-pegged dark:shadow-[0_0_8px_rgba(107,214,151,0.5)]"
  : "bg-st-drift"
```

### 8.4 Hero spotlight (`web/app/(marketing)/page.tsx`)

Lines around `radial-gradient(circle, rgba(255,132,0,0.18), rgba(254,237,122,0.08), transparent 60%)`.

**No change.** Orange/yellow translucent on either canvas reads correctly (sun-spot on white, glow on black). Confirmed visually in the v3 mock.

### 8.5 Live alert bubble (`web/components/molecules/live-alert-bubble.tsx:128`)

```tsx
<span style={{ color: "#000", letterSpacing: "-0.04em" }}>
```

This is the "P" inside the iridescent avatar circle. Hardcoded black on iridescent gradient reads correctly in both themes. **No change.**

### 8.6 Files explicitly out of scope (dashboard-only hardcodes)

These have hardcoded color values but only render in `(app)` routes which stay dark-only:

- `organisms/asset-hero-v2.tsx`, `organisms/asset-table.tsx`, `molecules/active-mini-chart.tsx` — `useTickFlash` restore color
- `organisms/asset-preview-pane.tsx`, `atoms/engine-flow-strip.tsx`, `atoms/recovery-gauge.tsx`, `molecules/dot-grid.tsx`, `atoms/dotted-grid-bg.tsx`
- `organisms/tv-chart/theme.ts`

No change required for v1.

---

## 9. Dashboard guard

To prevent the toggle in marketing from accidentally turning the dashboard light (which has uncalibrated chart density for light), the `(app)` group layout pins the attribute back to dark on its subtree.

**File:** `web/app/(app)/layout.tsx`

Add at top of layout:

```tsx
"use client";
import { useEffect } from "react";
import { useTheme } from "next-themes";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setTheme, theme } = useTheme();
  useEffect(() => {
    // Dashboard is dark-only in v1. Force dark on entry, restore the user's
    // preference on exit so navigating back to marketing keeps their choice.
    const prev = theme;
    setTheme("dark");
    return () => {
      if (prev && prev !== "dark") setTheme(prev);
    };
  }, []);
  // ... existing layout content
}
```

**Alternative — simpler:** wrap `(app)` content in `<div data-theme="dark">` so its descendants always read dark tokens regardless of the html attribute. CSS selector `[data-theme="dark"]` works on any element, not only `<html>`. This is preferred — it's stateless and doesn't fight the user's preference.

**Decision:** use the wrapper div approach.

```tsx
// (app)/layout.tsx
export default function AppLayout({ children }) {
  return <div data-theme="dark">{children}</div>;
}
```

`(app)/layout.tsx` already exists; this is a 1-line wrap of its existing return value.

**Same treatment for `/embed`:** `app/(marketing)/embed/page.tsx` (or its layout) — wrap in `<div data-theme="dark">`. Third-party iframes get stable dark regardless of consumer toggle state.

---

## 10. Page scope

| Route | Toggle visible | Theme honors swap |
|---|---|---|
| `/` | yes | yes |
| `/about` | yes | yes |
| `/changelog` | yes | yes |
| `/privacy` | yes | yes |
| `/terms` | yes | yes |
| `/embed` | no | no (pinned dark via wrapper) |
| `/dashboard`, `/asset/*`, `/compare`, `/account`, `/events`, `/status` | no | no (pinned dark via `(app)` wrapper) |

The toggle is in `MarketingHeader`. Marketing routes all use that header; `(app)` uses `ProductHeader`. Routes that don't render `MarketingHeader` won't show the toggle by construction.

---

## 11. Files touched — summary

### New files

1. `web/components/atoms/theme-toggle.tsx` — toggle button
2. `web/components/providers/theme-provider.tsx` — next-themes wrapper

### Edited files

1. `web/app/layout.tsx` — wrap children in `<ThemeProvider>`, add `suppressHydrationWarning` on `<html>`
2. `web/app/globals.css` — split tokens into `[data-theme="dark"]` and `[data-theme="light"]`, add `--color-text-rgb`, add `--wordmark-fill`, add page-wide color transition, adjust `@custom-variant dark` to use attribute selector
3. `web/components/organisms/marketing-header.tsx` — rename "Open Dashboard" → "Dashboard", insert `<ThemeToggle />` after the Dashboard link, update `ctaLabel` passed to MobileMenu
4. `web/components/molecules/mobile-menu.tsx` — (no edits if `ctaLabel` is already a prop; verify)
5. `web/components/organisms/wordmark.tsx` — replace hardcoded white gradient with `var(--wordmark-fill)`
6. `web/components/effects/hero-canvas.tsx` — read `--color-text-rgb` at frame time instead of hardcoded `rgba(255,255,255,...)`
7. `web/components/organisms/live-this-week.tsx` — wrap state pip glows in `dark:` variant
8. `web/components/organisms/channels-section.tsx` — wrap LIVE pip glow in `dark:` variant
9. `web/app/(app)/layout.tsx` — wrap in `<div data-theme="dark">`
10. `web/app/(marketing)/embed/page.tsx` (or its layout) — wrap in `<div data-theme="dark">`

### Deps

Add: `next-themes` (~1KB)

---

## 12. Test plan

### Visual (manual on dev server)

1. `/` — toggle appears in header next to "Dashboard" pill. Click → entire page color-transitions (~280ms). Iridescent gradient stays. Dust particles invert color. Spotlight stays warm. Wordmark inverts. State pips lose glow in light, keep it in dark. Hero copy reads cleanly in both. Reload → state persists.
2. `/about`, `/changelog`, `/privacy`, `/terms` — toggle appears, theme swaps, all sections legible in both modes.
3. `/embed` — toggle does NOT appear. Page is locked dark regardless of root html `data-theme`.
4. `/dashboard` — toggle does NOT appear. Page is locked dark. Navigate `/` → `/dashboard` with light pre-selected: marketing shows light, dashboard renders dark. Navigate back: marketing returns to light (preference preserved).
5. Hover toggle button → border darkens, color brightens (matches existing ghost-CTA hover).
6. Click toggle: icon morphs (sun ↔ moon) with rotate + cross-fade.
7. Test with `prefers-reduced-motion: reduce` enabled in DevTools: no transitions, instant swap.
8. Test with localStorage cleared in incognito: first paint is dark (default).

### A11y

1. Toggle has `aria-label` matching current state ("Switch to light mode" when dark, etc.).
2. Focus visible on tab navigation (project rule: no halo, but the element must still be focusable).
3. Light mode passes WCAG AA contrast for all text — verify with Lighthouse on `/?theme=light` (or after toggle).
4. State pips have 3:1 contrast against background in both modes after recalibration.

### SSR / hydration

1. No flash of wrong theme on first paint (next-themes inline script handles this).
2. No `Hydration failed` console errors with `suppressHydrationWarning` on `<html>`.
3. Build + `next start` — production behavior matches dev.

### Lighthouse

1. Run on `/` in both themes. Maintain current scores (Performance, A11y, Best Practices, SEO).
2. Cumulative Layout Shift unchanged (toggle insertion shouldn't shift anything; the placeholder during hydration is the same dimensions).

---

## 13. Risks

1. **Global `*` transition is broad.** Mitigation: scope only to color/border/fill/stroke. Validated by leaving `transform/opacity/box-shadow` out of the rule.
2. **Hero spotlight on light may read too warm** depending on monitor calibration. Acceptable risk — can tune the alpha values if user reports.
3. **State pip without glow in light may look less alive.** Acceptable — the pip is solid color and the colors are darker/more saturated than dark-mode equivalents, so they punch on their own.
4. **`(app)` wrapper div changes the cascade root.** If any descendant component reads CSS vars via `getComputedStyle(document.documentElement)` instead of `getComputedStyle(<some closer node>)`, it will get the wrong theme. Audit: hero-canvas reads from canvas parent (correct); TradingView reads from its own theme.ts hardcodes (correct, no var lookup); no other component reads vars at runtime in the marketing surfaces.
5. **localStorage SSR mismatch** — handled by next-themes' inline script; no app-level work needed.

---

## 14. Implementation order (for Codex handoff)

1. `bun add next-themes` in `web/`
2. Create `theme-provider.tsx`, wire into `app/layout.tsx`
3. Edit `globals.css`: token split + new vars + page transition + `@custom-variant dark` selector update
4. Create `theme-toggle.tsx` atom
5. Edit `marketing-header.tsx`: rename "Open Dashboard" → "Dashboard", insert toggle, update mobile cta label
6. Edit `wordmark.tsx`: var-driven fill
7. Edit `hero-canvas.tsx`: read text-rgb token
8. Edit `live-this-week.tsx`, `channels-section.tsx`: wrap glow in `dark:`
9. Edit `(app)/layout.tsx`: wrap in `<div data-theme="dark">`
10. Edit `(marketing)/embed/layout.tsx` (or page): wrap in `<div data-theme="dark">`
11. Run dev server, hit all 6 marketing routes, toggle theme, validate visually
12. Run `bun run build` to catch build errors
13. Run Lighthouse on `/` in both themes
14. Open PR against `main`

---

## 15. Acceptance criteria

- [ ] Toggle visible on `/`, `/about`, `/changelog`, `/privacy`, `/terms` immediately after the Dashboard pill
- [ ] Toggle invisible on `/embed`, `/dashboard`, `/asset/*`, `/compare`, `/account`, `/events`, `/status`
- [ ] "Open Dashboard" → "Dashboard" everywhere in marketing header (desktop + mobile menu)
- [ ] Click toggle: sun ↔ moon icon morphs (rotate + cross-fade, ~280ms)
- [ ] Click toggle: page colors transition smoothly (background, text, border, fill, stroke — 280ms)
- [ ] Iridescent gradient text/elements unchanged across themes
- [ ] Hero spotlight unchanged across themes
- [ ] HeroCanvas particles use ink color in light, off-white in dark
- [ ] PEGANA wordmark uses solid `--color-text` in light, current white gradient in dark
- [ ] State pips have glow shadow in dark, no shadow in light
- [ ] Theme persists across page reload via localStorage
- [ ] First-paint default = dark
- [ ] Navigate marketing → dashboard with light selected: dashboard renders dark, returning to marketing restores light
- [ ] `/embed` always renders dark regardless of theme attribute
- [ ] `prefers-reduced-motion: reduce` collapses theme transition to instant
- [ ] Lighthouse a11y ≥ current score on both themes
- [ ] No hydration errors in console
- [ ] No flash of wrong theme on first paint
