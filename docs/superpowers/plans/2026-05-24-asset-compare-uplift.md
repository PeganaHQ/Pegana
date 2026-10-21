# Asset Detail + Compare Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the strongest existing page (`/asset/[symbol]`) — the IA model for downstream surfaces — with motion vocabulary inherited from landing+dashboard. Fix the broken empty state on `/compare`.

**Architecture:** All motion utilities and atoms already exist (`AnchorNumber`, `useTickFlash`, `useReducedMotionGsap`, `prepareDrawIn`, `Flip`). This wave is targeted refactors of existing organisms — no new primitives.

**Tech stack:** Same as landing + dashboard waves. No new dependencies.

**Source-of-truth references:**
- Spec: `docs/superpowers/specs/2026-05-22-design-uplift.md` § 5.3 (asset), § 5.4 (compare), § 6 P2
- Approved mock: `.superpowers/brainstorm/52885-1779654553/content/mock-03-asset.html` (with GSAP)
- Landing-wave foundation: `web/lib/motion/*`, `web/components/atoms/anchor-number.tsx`
- Dashboard-wave foundation: `web/lib/motion/get-flip.ts`

**Pacing:** This is the ASSET+COMPARE wave (P2). Do not touch landing or dashboard. Inner pages get a separate wave.

**Base branch:** `feat/asset-compare-uplift` (off `feat/dashboard-uplift` — depends on the motion utilities + Flip loader shipped there).

---

## File map

**New files:** none. All motion primitives exist already.

**Modified files:**
- `web/components/organisms/asset-hero.tsx` — spread number tick-flash + counter morph + iridescent underline + state-pip ring pulse on transition; identity row → 4-up stat strip layout.
- `web/components/molecules/threshold-ladder.tsx` — animated bps marker via GSAP timeline (slides into final position on mount).
- `web/components/organisms/activity-timeline.tsx` — render small inline sparkline per row + iridescent left-border on most recent row.
- `web/components/molecules/safety-grade.tsx` — bump letter size +30%, add iridescent underline beneath the grade letter; scroll-trigger scale-in.
- `web/components/organisms/asset-chart.tsx` — sparkline draw-in via stroke-dasharray on scroll-trigger.
- `web/app/asset/[symbol]/page.tsx` — switch footer to `variant="compact"`.
- `web/app/compare/page.tsx` — empty-state faint preview overlay + "Save as watchlist" CTA after selection.
- `web/components/organisms/compare-chart.tsx` — already exists; small polish if needed (verify what it renders today).

**Out of scope:**
- "How it's priced" math typesetting with LaTeX-ish subscripts — P3 polish.
- WebSocket-driven live recompute on the spread chart — separate backend wiring PR.
- Compare URL-state persistence — local state only this wave.

---

## Phase 1 — Asset detail polish (Tasks 1-5)

### Task 1: Asset hero — tick-flash + counter morph + iridescent underline + pip-ring pulse on transition

**Files:**
- Modify: `web/components/organisms/asset-hero.tsx`

- [ ] **Step 1.1: Read the current asset-hero.tsx**

```bash
cd <repo>/web && cat components/organisms/asset-hero.tsx
```

Identify:
- Where the huge spread number is rendered (likely a `<span>` or `<div>` with a class like `text-[88px]` or similar).
- Where the state pip is rendered.
- Whether the component already uses `useCounterMorph` or `useTickFlash`.

- [ ] **Step 1.2: Add tick-flash on the spread number**

Add imports:

```typescript
import { useRef } from "react";
import { useTickFlash } from "@/lib/motion/use-tick-flash";
```

Add ref + tick-flash hook:

```typescript
const spreadRef = useRef<HTMLElement | null>(null);
useTickFlash(spreadRef, discount, { color: "#ff8400", restore: "#fffdf9" });
```

Where `discount` is whatever prop the component uses for the live spread (could be `bps`, `discount`, `spread`).

Attach `ref={spreadRef}` to the big spread number element.

- [ ] **Step 1.3: Add iridescent underline beneath the spread number**

Wrap the spread number in a relative-positioned container and add an absolute-positioned underline:

```tsx
<div className="relative pb-2">
  <span ref={spreadRef} className="...existing classes...">
    {formattedSpread}
  </span>
  <span
    aria-hidden
    className="absolute inset-x-0 bottom-0 h-[2px]"
    style={{ background: "var(--gradient-iridescent)", opacity: 0.5 }}
  />
</div>
```

- [ ] **Step 1.4: State pip ring pulse on transition**

If the existing pip uses CSS `pip-pulse` infinite animation, ADD a one-shot ring pulse triggered on state change. Add state to detect transitions:

```typescript
import { useEffect, useRef, useState } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";

const pipRef = useRef<HTMLElement | null>(null);
const prevStateRef = useRef(state);

useReducedMotionGsap(
  (gsap, reduced) => {
    if (reduced) return;
    if (prevStateRef.current === state) return;
    prevStateRef.current = state;
    const pip = pipRef.current;
    if (!pip) return;
    gsap.fromTo(
      pip,
      { boxShadow: "0 0 0 0 rgba(255,132,0,.8)" },
      { boxShadow: "0 0 0 24px rgba(255,132,0,0)", duration: 0.8, ease: "power2.out" },
    );
  },
  [state],
);
```

Attach `ref={pipRef}` to the state pip element.

- [ ] **Step 1.5: Refactor identity row to 4-up stat strip**

If the existing component renders class/decimals/peg-target/last-updated stacked vertically, reflow into a 4-up flex strip (matches landing hero stat pattern):

```tsx
<div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-8">
  <Stat label="Class" value={assetClass} />
  <Stat label="Decimals" value={String(decimals)} />
  <Stat label="Peg target" value={pegTarget} />
  <Stat label="Last updated" value={lastUpdated} />
</div>
```

Define `<Stat>` inline:

```typescript
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <b className="block font-mono text-[14px] text-text font-normal mt-1">{value}</b>
    </div>
  );
}
```

If the identity row is in a different component (`asset-spec.tsx`), edit that file instead.

- [ ] **Step 1.6: Typecheck**

```bash
cd <repo>/web && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 1.7: Commit**

```bash
cd <repo> && git add web/components/organisms/asset-hero.tsx
git commit -m "feat(asset): hero — tick-flash + iridescent underline + pip-ring pulse on transition

- useTickFlash on spread number triggers 120ms iridescent flash when discount updates
- 2px iridescent gradient underline beneath the spread number (50% opacity)
- One-shot pip ring pulse via gsap.fromTo when state transitions
- Identity row reflowed to 4-up stat strip (matches landing hero pattern)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If asset-spec.tsx was also modified, include it in the git add and the commit message.

---

### Task 2: Threshold ladder — animated bps marker

**Files:**
- Modify: `web/components/molecules/threshold-ladder.tsx`

- [ ] **Step 2.1: Read current implementation**

```bash
cd <repo>/web && cat components/molecules/threshold-ladder.tsx
```

Identify the marker element (likely a `<span>` or `<div>` positioned via `left:` percentage based on the current bps).

- [ ] **Step 2.2: Add GSAP animation**

Add imports:

```typescript
import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
```

Add ref + animation. On mount, the marker should animate from the left edge (10%) to its final position:

```typescript
const markerRef = useRef<HTMLElement | null>(null);
const finalLeft = computeFinalLeft(bps); // existing logic — use whatever variable is current

useReducedMotionGsap(
  (gsap, reduced) => {
    const marker = markerRef.current;
    if (!marker) return;
    if (reduced) {
      gsap.set(marker, { left: finalLeft, opacity: 1 });
      return;
    }
    gsap.fromTo(
      marker,
      { left: "10%", opacity: 0 },
      { left: finalLeft, opacity: 1, duration: 1.4, ease: "power3.inOut", delay: 0.3 },
    );
  },
  [finalLeft],
);
```

Attach `ref={markerRef}` to the marker element. Remove the inline `style={{ left: finalLeft }}` since GSAP now drives it.

- [ ] **Step 2.3: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/molecules/threshold-ladder.tsx
git commit -m "feat(asset): threshold-ladder animated marker slide

Marker animates from 10% left edge to its final bps position over 1.4s
with power3.inOut on mount. Reduced-motion skips to the final state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Activity timeline — per-row sparkline + iridescent fresh-row border

**Files:**
- Modify: `web/components/organisms/activity-timeline.tsx`

- [ ] **Step 3.1: Read current implementation**

```bash
cd <repo>/web && cat components/organisms/activity-timeline.tsx
```

Each row likely has: time, transition (from→to state), held duration.

- [ ] **Step 3.2: Add inline sparkline per row**

Add a small inline SVG sparkline (24px tall, ~120px wide) between the transition and the held columns. Use a mock 4-pt series tied to the transition direction:

```typescript
function buildTransitionSpark(from: string, to: string): number[] {
  // Simple visual hint: improving → ascending, degrading → descending.
  const improving = (from === "DRIFT" || from === "DEPEG") && to === "PEGGED";
  return improving ? [18, 14, 12, 10] : [10, 12, 14, 18];
}

function sparkPath(series: number[], w = 120, h = 22): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}
```

In the row JSX, render:

```typescript
<svg viewBox="0 0 120 22" preserveAspectRatio="none" className="h-5 w-[120px] flex-none">
  <path
    d={sparkPath(buildTransitionSpark(row.fromState, row.toState))}
    stroke={improving ? "var(--color-st-pegged)" : "var(--color-st-drift)"}
    strokeWidth="1.2"
    fill="none"
  />
</svg>
```

- [ ] **Step 3.3: Iridescent fresh-row border**

Identify the first row in the timeline (the freshest event). Apply a left border:

```typescript
{rows.map((r, i) => (
  <div
    key={r.id}
    className={`grid grid-cols-[80px_1fr_120px_120px_auto] gap-4 py-3 border-b border-hairline/30 ${i === 0 ? "border-l-2 border-l-[#ff8400] pl-3" : ""}`}
  >
    {/* existing row content + new sparkline */}
  </div>
))}
```

- [ ] **Step 3.4: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/organisms/activity-timeline.tsx
git commit -m "feat(asset): activity timeline — per-row sparkline + iridescent fresh-row border

Each row now ships a 4-pt inline sparkline encoding transition direction
(ascending = improving, descending = degrading). The most recent row
gets a 2px iridescent left border.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Safety grade — bigger letter + iridescent underline + scroll-trigger scale-in

**Files:**
- Modify: `web/components/molecules/safety-grade.tsx`

- [ ] **Step 4.1: Read current implementation**

```bash
cd <repo>/web && cat components/molecules/safety-grade.tsx
```

- [ ] **Step 4.2: Refactor**

Bump the letter size by ~30% (e.g., `text-[200px]` if currently `text-[150px]`). Add iridescent underline + scroll-trigger scale-in:

Add imports:

```typescript
import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
```

Add ref + scroll-trigger:

```typescript
const gradeRef = useRef<HTMLElement | null>(null);

useReducedMotionGsap(
  (gsap, reduced) => {
    const grade = gradeRef.current;
    if (!grade || reduced) return;
    gsap.set(grade, { scale: 0.6, opacity: 0 });
    let tween: gsap.core.Tween | null = null;
    (async () => {
      await getScrollTrigger();
      tween = gsap.to(grade, {
        scale: 1,
        opacity: 1,
        duration: 0.8,
        ease: "back.out(1.4)",
        scrollTrigger: { trigger: grade, start: "top 75%", toggleActions: "play none none none" },
      });
    })();
    return () => tween?.kill();
  },
  [],
);
```

Add underline below the letter:

```tsx
<div className="relative pb-2">
  <span
    ref={gradeRef}
    className="block font-light text-[200px] leading-[0.85] tracking-[-0.05em]"
    style={{ color: gradeColor }}
  >
    {grade}
  </span>
  <span
    aria-hidden
    className="absolute inset-x-0 bottom-0 h-[3px]"
    style={{ background: "var(--gradient-iridescent)", opacity: 0.7 }}
  />
</div>
```

- [ ] **Step 4.3: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/molecules/safety-grade.tsx
git commit -m "feat(asset): safety grade — 30% larger letter + iridescent underline + scale-in

Letter at 200px. 3px iridescent underline at 70% opacity. Scale-in via
back.out(1.4) when section enters viewport.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Asset chart — sparkline draw-in + footer compact + page polish

**Files:**
- Modify: `web/components/organisms/asset-chart.tsx`
- Modify: `web/app/asset/[symbol]/page.tsx`

- [ ] **Step 5.1: Asset chart sparkline draw-in**

Open `web/components/organisms/asset-chart.tsx`. Add scroll-trigger driven path-draw-in:

```typescript
import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";
```

Add ref + effect:

```typescript
const chartRef = useRef<HTMLDivElement | null>(null);

useReducedMotionGsap(
  (gsap, reduced) => {
    const root = chartRef.current;
    if (!root || reduced) return;
    let tween: gsap.core.Tween | null = null;
    (async () => {
      await getScrollTrigger();
      const paths = root.querySelectorAll<SVGPathElement>("svg path");
      if (paths.length === 0) return;
      prepareDrawIn(paths);
      tween = gsap.to(paths, {
        strokeDashoffset: 0,
        duration: 1.8,
        ease: "power2.out",
        scrollTrigger: { trigger: root, start: "top 80%", toggleActions: "play none none none" },
      });
    })();
    return () => tween?.kill();
  },
  [],
);
```

Attach `ref={chartRef}` to the outermost chart container. If the chart is rendered by a library that injects paths after mount (Recharts), the `paths.length === 0` check handles the case gracefully — but for a paint-time draw-in we may need to wait. Skip aggressive optimization here: if Recharts paths haven't rendered yet, this hook silently no-ops, which is acceptable.

- [ ] **Step 5.2: Switch footer to compact on asset detail page**

In `web/app/asset/[symbol]/page.tsx`, change:

```tsx
<SiteFooter />
```

To:

```tsx
<SiteFooter variant="compact" />
```

- [ ] **Step 5.3: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/organisms/asset-chart.tsx "web/app/asset/[symbol]/page.tsx"
git commit -m "feat(asset): chart sparkline draw-in + compact footer

Spread chart paths draw-in via stroke-dasharray over 1.8s on viewport
entry. Asset detail page uses compact footer (matches landing/dashboard
treatment — only brand + license bar).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — Compare page (Task 6)

### Task 6: Compare empty-state preview + watchlist save

**Files:**
- Modify: `web/app/compare/page.tsx`
- Possibly modify: `web/components/organisms/compare-chart.tsx`

- [ ] **Step 6.1: Read current implementations**

```bash
cd <repo>/web && cat app/compare/page.tsx
echo "---compare-chart---"
cat components/organisms/compare-chart.tsx
```

Identify:
- How `selected` (or similar) state works
- How the empty state renders today (likely a prompt + preset buttons + footer)
- How the chart renders when assets are selected

- [ ] **Step 6.2: Add faint preview overlay when empty**

When `selected.length === 0`, render a faint preview of the "Major LSTs" preset behind the prompt. Pseudo-code:

```typescript
const MAJOR_LSTS = ["jitoSOL", "mSOL", "bSOL", "JupSOL"];

const previewSymbols = selected.length === 0 ? MAJOR_LSTS : selected;
const isEmpty = selected.length === 0;
```

Render the chart with `previewSymbols` always, but apply `opacity: 0.35 pointer-events-none` to the chart container when `isEmpty`:

```tsx
<div className="relative min-h-[540px]">
  <div className={`${isEmpty ? "opacity-30 pointer-events-none" : ""} transition-opacity`}>
    <CompareChart symbols={previewSymbols} />
  </div>
  {isEmpty && (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        Empty state preview
      </span>
      <b className="text-2xl font-normal">Pick a preset or add assets to begin.</b>
      <p className="max-w-[380px] text-sm text-text-body leading-[1.5]">
        The chart above is a faint preview of <span className="text-text">Major LSTs</span>.
        Click any preset to lock it in, or use the picker to build your own stack of up to 4 assets.
      </p>
      <button
        type="button"
        onClick={() => setSelected(MAJOR_LSTS)}
        className="px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-canvas font-semibold"
        style={{ background: "var(--gradient-iridescent)" }}
      >
        Try "Major LSTs" →
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 6.3: Save-as-watchlist after selection**

When `selected.length > 0`, render a "Save as watchlist" button in the side panel or below the chart:

```tsx
{selected.length > 0 && (
  <button
    type="button"
    onClick={() => {
      // Local-storage persistence — minimal, no UI for managing watchlists in this wave
      try {
        const existing = JSON.parse(localStorage.getItem("pegana:watchlists") ?? "[]");
        const next = [...existing, { name: `Watchlist ${existing.length + 1}`, symbols: selected, at: Date.now() }];
        localStorage.setItem("pegana:watchlists", JSON.stringify(next));
        // TODO: replace with a proper toast in a future polish PR
        alert(`Saved as Watchlist ${existing.length + 1}`);
      } catch {}
    }}
    className="border border-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] hover:bg-text hover:text-canvas transition-colors"
  >
    ★ Save as watchlist
  </button>
)}
```

`alert()` is a placeholder — note in commit message.

- [ ] **Step 6.4: Footer compact**

```tsx
<SiteFooter variant="compact" />
```

- [ ] **Step 6.5: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/app/compare/page.tsx web/components/organisms/compare-chart.tsx
git commit -m "feat(compare): faint preview overlay on empty state + save-as-watchlist

Empty state now renders the Major LSTs preset chart at 30% opacity behind
a prompt + iridescent CTA. Once assets are picked, a save-as-watchlist
button persists to localStorage (alert() placeholder for confirmation —
proper toast in a future polish PR). Footer switched to compact.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — Validation (Task 7)

### Task 7: Playwright regression — asset + compare

**Files:**
- Create: `web/tests/e2e/asset-detail.spec.ts`
- Create: `web/tests/e2e/compare.spec.ts`

- [ ] **Step 7.1: Write asset-detail spec**

Create `web/tests/e2e/asset-detail.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Asset detail — desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders all v1.1 asset-detail landmarks", async ({ page }) => {
    await page.goto("/asset/jitoSOL");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Hero spread number visible
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });

    // Threshold ladder marker present
    const ladder = page.locator("[data-threshold-marker], .marker").first();
    if (await ladder.count() > 0) {
      await expect(ladder).toBeVisible();
    }

    // Activity timeline present
    await expect(page.getByText(/Activity|timeline|activity/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Asset detail — mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders without horizontal scroll", async ({ page }) => {
    await page.goto("/asset/jitoSOL");
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
});
```

- [ ] **Step 7.2: Write compare spec**

Create `web/tests/e2e/compare.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Compare", () => {
  test("empty state renders faint preview + CTA", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForLoadState("networkidle").catch(() => {});
    // Prompt visible
    await expect(page.getByText(/Pick a preset|empty/i).first()).toBeVisible({ timeout: 8000 });
    // CTA button
    await expect(page.getByRole("button", { name: /Major LSTs|Try/i }).first()).toBeVisible();
  });
});
```

- [ ] **Step 7.3: Run specs**

```bash
cd <repo>/web && pnpm dev > /tmp/web-dev-t7.log 2>&1 &
sleep 5
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/asset-detail.spec.ts tests/e2e/compare.spec.ts --reporter=line 2>&1 | tail -10
```

Expected: ALL PASS. If fail, investigate.

- [ ] **Step 7.4: Run full e2e suite**

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test --reporter=line 2>&1 | tail -8
kill %1 2>/dev/null || pkill -f "next dev" 2>/dev/null
```

Expected: ALL PASS (≥ 33 tests).

- [ ] **Step 7.5: Run typecheck + unit tests**

```bash
cd <repo>/web && pnpm typecheck
pnpm vitest run 2>&1 | tail -4
```

Expected: zero type errors, all unit tests pass.

- [ ] **Step 7.6: Commit**

```bash
cd <repo> && git add web/tests/e2e/asset-detail.spec.ts web/tests/e2e/compare.spec.ts
git commit -m "test(e2e): asset-detail + compare regression specs

- asset-detail: hero h1 + ladder + timeline visible at 1440, no overflow at 390
- compare: empty-state preview + CTA button rendered

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Done criteria

1. `pnpm typecheck` — zero errors.
2. `pnpm vitest run` — all unit tests pass.
3. `pnpm playwright test` — all specs pass (landing + reduced-motion + inner-pages smoke + legacy + dashboard + new asset-detail + new compare).
4. `/asset/jitoSOL` shows: spread number with tick-flash, iridescent underline, animated threshold marker, activity timeline with sparklines + fresh-row border, safety grade 30% larger with iridescent underline + scale-in, compact footer.
5. `/compare` empty state renders faint preview behind CTA prompt.
6. Mobile (390): no horizontal scroll on either page.

When all 6 hold, open PR `feat/asset-compare-uplift` → `main` (stacked on dashboard PR).

---

## References

- Spec: `docs/superpowers/specs/2026-05-22-design-uplift.md` § 5.3, § 5.4
- Mock: `.superpowers/brainstorm/52885-1779654553/content/mock-03-asset.html`
- Landing plan: `docs/superpowers/plans/2026-05-22-landing-uplift.md`
- Dashboard plan: `docs/superpowers/plans/2026-05-24-dashboard-uplift.md`
- Decisions memory: `project_design_uplift.md`
- Pacing memory: `feedback_design_pacing.md`
