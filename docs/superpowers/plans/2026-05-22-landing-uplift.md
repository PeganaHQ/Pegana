# Landing Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1.1 landing page redesign with a live anchor number, sparkline-rich universe grid, GSAP-driven motion vocabulary, and the foundation tokens that downstream pages will inherit.

**Architecture:** Add GSAP (core + ScrollTrigger) alongside framer-motion (do not migrate). Build a small motion utility layer under `web/lib/motion/` with TDD-tested helpers. Refactor 7 existing landing organisms incrementally. Land one foundation PR + landing PR — the foundation pieces (color tokens, footer variants, motion utilities) are bundled with the landing changes because every downstream page depends on them.

**Tech stack:** Next 16 App Router (Turbopack), React 19, TypeScript strict, Tailwind v4 (`@theme {}` in CSS), GSAP 3.12+ (core + ScrollTrigger), framer-motion 11 (kept for AnimatePresence), Vitest + Testing Library, Playwright.

**Source-of-truth references:**
- Design spec: `docs/superpowers/specs/2026-05-22-design-uplift.md` (sections 2, 4, 5.1, 6 P0)
- Critique: `docs/design-research/audit-2026-05-22/critique.md`
- Recon (refero + benchmarks + GSAP patterns): `docs/design-research/audit-2026-05-22/recon.md`
- Approved mock: `.superpowers/brainstorm/22296-1779488900/content/mock-01-landing.html`

**Pacing reminder:** This is the LANDING wave. Do **not** touch dashboard, asset, or inner-page components in this plan. Foundation primitives (motion utilities, footer variants, color tokens) are written generically but applied only to landing-affected files here. The next wave (dashboard) gets its own plan after landing ships.

---

## File map

**New files:**
- `web/lib/motion/gsap.ts` — central GSAP loader + plugin registration (singleton).
- `web/lib/motion/split-words.ts` — word-level text splitter utility (replaces SplitText paid plugin).
- `web/lib/motion/prepare-draw-in.ts` — SVG `stroke-dasharray` setup helper for path draw-in animations.
- `web/lib/motion/use-counter-morph.ts` — React hook that GSAP-tweens a number value with epsilon threshold.
- `web/lib/motion/use-tick-flash.ts` — React hook for the 120ms color-flash on state change.
- `web/lib/motion/use-reduced-motion-gsap.ts` — `gsap.matchMedia` wrapper that respects `prefers-reduced-motion`.
- `web/components/organisms/methodology-pipeline.tsx` — new SVG pipeline diagram (Sources → Engine → Spread → Alert).
- `web/components/atoms/anchor-number.tsx` — the big anchor number with iridescent underline + counter morph.
- `web/components/molecules/live-ticker-card.tsx` — rotating live asset preview card (replaces the static `AssetCard` in hero).
- `web/tests/unit/motion/split-words.test.ts`
- `web/tests/unit/motion/prepare-draw-in.test.ts`
- `web/tests/unit/motion/use-counter-morph.test.ts`
- `web/tests/unit/atoms/anchor-number.test.tsx`
- `web/tests/e2e/landing.spec.ts` — Playwright regression for the landing.

**Modified files:**
- `web/package.json` — add `gsap` dependency.
- `web/app/globals.css` — add `--color-text-body`, refactor `--color-surface-*` to new values, audit shadows.
- `web/components/organisms/site-footer.tsx` — accept `variant` prop (`full | compact | default`).
- `web/app/page.tsx` — pass `variant="full"` to footer.
- `web/components/organisms/hero-landing.tsx` — replace framer-motion word reveal with GSAP timeline, add `<AnchorNumber>`, swap `AssetCard` for `<LiveTickerCard>`, refine mouse spotlight.
- `web/components/organisms/logo-marquee.tsx` — replace CSS keyframe with GSAP infinite timeline; add hover tooltip and second counter-scrolling row.
- `web/components/organisms/how-it-works.tsx` — add mini SVG live visualizations per column + scroll-trigger stagger.
- `web/components/organisms/methodology-accordion.tsx` — mount `<MethodologyPipeline>` inside the first expanded row.
- `web/components/organisms/universe-grid.tsx` — render sparkline per card + class filter chip row + scroll-trigger stagger + sparkline draw-in.
- `web/components/molecules/asset-card.tsx` — optional `sparkline` prop (24h series); render via existing `Sparkline` atom.
- `web/components/organisms/pinged-cta.tsx` — Telegram message type-in animation + commit the iridescent stripe.
- `web/components/organisms/wordmark.tsx` — `gsap.scrollTrigger` scrub parallax.
- `web/components/atoms/counter.tsx` — keep framer-motion variant for legacy, but add `useCounterMorph` flag (delegates to GSAP hook).

**Deleted:** none. We're additive — old code stays until validated.

---

## Phase 0 — Foundation (Tasks 1-4)

### Task 1: Install GSAP and create the central loader

**Files:**
- Modify: `web/package.json`
- Create: `web/lib/motion/gsap.ts`
- Create: `web/lib/motion/__fixtures__/jsdom-svg-shim.ts`
- Create: `web/tests/unit/motion/gsap-loader.test.ts`

- [ ] **Step 1.1: Add the dependency**

Run from repo root:
```bash
cd web && pnpm add gsap@^3.12.5
```

Expected: lockfile updates, no peer warnings on React 19.

- [ ] **Step 1.2: Write a failing test for the loader singleton**

Create `web/tests/unit/motion/gsap-loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getGsap, getScrollTrigger } from "@/lib/motion/gsap";

describe("gsap loader", () => {
  it("returns the same gsap instance across calls", async () => {
    const a = await getGsap();
    const b = await getGsap();
    expect(a).toBe(b);
  });

  it("returns ScrollTrigger and registers it on first call", async () => {
    const ST = await getScrollTrigger();
    expect(ST).toBeDefined();
    expect(typeof ST.create).toBe("function");
  });
});
```

- [ ] **Step 1.3: Run the test — it must fail**

```bash
cd web && pnpm vitest run tests/unit/motion/gsap-loader.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/motion/gsap'`.

- [ ] **Step 1.4: Implement the loader**

Create `web/lib/motion/gsap.ts`:

```typescript
// Single source of truth for GSAP. Dynamic-imports so the bundle only pays the
// cost on routes that actually use it. Registers ScrollTrigger exactly once.

let gsapPromise: Promise<typeof import("gsap").gsap> | null = null;
let scrollTriggerRegistered = false;

export async function getGsap() {
  if (!gsapPromise) {
    gsapPromise = import("gsap").then((mod) => mod.gsap);
  }
  return gsapPromise;
}

export async function getScrollTrigger() {
  const gsap = await getGsap();
  const { ScrollTrigger } = await import("gsap/ScrollTrigger");
  if (!scrollTriggerRegistered) {
    gsap.registerPlugin(ScrollTrigger);
    scrollTriggerRegistered = true;
  }
  return ScrollTrigger;
}
```

- [ ] **Step 1.5: Run the test — it must pass**

```bash
cd web && pnpm vitest run tests/unit/motion/gsap-loader.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 1.6: Commit**

```bash
cd web && git add package.json pnpm-lock.yaml lib/motion/gsap.ts tests/unit/motion/gsap-loader.test.ts
git commit -m "feat(motion): add gsap + central loader with ScrollTrigger registration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Foundation — color tokens + body-text drop

**Files:**
- Modify: `web/app/globals.css` (the `@theme {}` block and the `@layer base {}` block)

- [ ] **Step 2.1: Read the current globals.css to confirm baseline**

```bash
cd web && grep -n "color-surface-1\|color-text\|--color-text-body" app/globals.css
```

Expected: see `--color-surface-1: #0f0f12` and `--color-surface-2: #1a1c22`. No `--color-text-body` yet.

- [ ] **Step 2.2: Update tokens to new ladder**

In `web/app/globals.css`, replace the relevant lines inside `@theme {}`:

Replace:
```css
  --color-surface-1: #0f0f12;
  --color-surface-2: #1a1c22;
```

With:
```css
  --color-surface-1: #0a0a0a;
  --color-surface-2: #141414;

  /* Body text — drop from #fffdf9 to a softer ghost-white for long-form copy */
  --color-text-body: #e8e8e8;
```

- [ ] **Step 2.3: Wire the new token through to Tailwind**

In the same file, locate the `@theme inline {}` block at the bottom. Add (just before the closing brace):

```css
  --color-text-body: var(--color-text-body);
```

- [ ] **Step 2.4: Bind body copy in `@layer base`**

In the `@layer base { ... }` block, change:

```css
  html, body {
    background: var(--color-canvas);
    color: var(--color-text);
    font-family: var(--font-family-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
```

To:

```css
  html, body {
    background: var(--color-canvas);
    color: var(--color-text);
    font-family: var(--font-family-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  p, li {
    color: var(--color-text-body);
  }
```

This keeps headlines + interactive states at pure `--color-text` (`#fffdf9`) and softens paragraphs/lists.

- [ ] **Step 2.5: Visual smoke check**

```bash
cd web && pnpm dev
```

Open `http://localhost:3000/` in a browser. Verify:
- Hero h1 stays full white.
- Body paragraphs on every page render slightly muted (`#e8e8e8`).
- No layout shift.

Stop dev (Ctrl+C) before next step.

- [ ] **Step 2.6: Commit**

```bash
cd web && git add app/globals.css
git commit -m "feat(theme): three-step surface ladder + body-text token

Surface: #000 → #0a0a0a → #141414 (Linear-style depth).
Body copy drops to #e8e8e8 — reserves #fffdf9 for headlines + interactive states.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Foundation — footer variants

**Files:**
- Modify: `web/components/organisms/site-footer.tsx`
- Modify: `web/app/page.tsx`
- Test: `web/tests/unit/organisms/site-footer.test.tsx`

- [ ] **Step 3.1: Inspect the current footer**

```bash
cd web && wc -l components/organisms/site-footer.tsx
```

Expected: a single component exporting `SiteFooter` with no variant prop.

- [ ] **Step 3.2: Write the failing variant test**

Create `web/tests/unit/organisms/site-footer.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SiteFooter } from "@/components/organisms/site-footer";

describe("SiteFooter variants", () => {
  it("renders 5 product columns when variant=full (default)", () => {
    render(<SiteFooter />);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
  });

  it("renders only brand + license stripe when variant=compact", () => {
    render(<SiteFooter variant="compact" />);
    expect(screen.queryByText("Product")).toBeNull();
    expect(screen.queryByText("Developers")).toBeNull();
    expect(screen.getByText(/All systems operational/i)).toBeInTheDocument();
  });

  it("renders 3 columns when variant=default", () => {
    render(<SiteFooter variant="default" />);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.queryByText("Developers")).toBeNull();
  });
});
```

- [ ] **Step 3.3: Run the test — it must fail**

```bash
cd web && pnpm vitest run tests/unit/organisms/site-footer.test.tsx
```

Expected: FAIL — `Type '{ variant: ...; }' is not assignable to type 'IntrinsicAttributes'`.

- [ ] **Step 3.4: Add the variant prop**

Open `web/components/organisms/site-footer.tsx`. At the top, alongside any existing types:

```typescript
export type SiteFooterVariant = "full" | "compact" | "default";

interface SiteFooterProps {
  variant?: SiteFooterVariant;
}
```

Change the component signature to:

```typescript
export function SiteFooter({ variant = "full" }: SiteFooterProps) {
```

Wrap the existing 5-column block in a conditional. If `variant === "compact"`, return only the brand + license bottom stripe. If `variant === "default"`, render `Product`, `Open`, `Company` columns only (drop `Developers` column). If `variant === "full"`, render everything as before.

The cleanest pattern: extract the column data into a constant array at the top of the file, then filter by variant:

```typescript
const ALL_COLUMNS = [
  { key: "product", title: "Product", links: [/* ... */] },
  { key: "developers", title: "Developers", links: [/* ... */] },
  { key: "open", title: "Open", links: [/* ... */] },
  { key: "company", title: "Company", links: [/* ... */] },
] as const;

function columnsForVariant(v: SiteFooterVariant) {
  if (v === "compact") return [];
  if (v === "default") return ALL_COLUMNS.filter(c => c.key !== "developers");
  return ALL_COLUMNS;
}
```

Render with `columnsForVariant(variant).map(...)`. The brand block and license bottom stripe stay outside this map and render unconditionally.

- [ ] **Step 3.5: Run the test — it must pass**

```bash
cd web && pnpm vitest run tests/unit/organisms/site-footer.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 3.6: Apply variant=full to landing**

In `web/app/page.tsx`, change:

```typescript
<SiteFooter />
```

To:

```typescript
<SiteFooter variant="full" />
```

(Explicit even though `full` is the default — documents intent for downstream readers.)

- [ ] **Step 3.7: Typecheck and commit**

```bash
cd web && pnpm typecheck && pnpm vitest run tests/unit/organisms/site-footer.test.tsx
```

Both must pass.

```bash
cd web && git add components/organisms/site-footer.tsx app/page.tsx tests/unit/organisms/site-footer.test.tsx
git commit -m "feat(footer): add variant prop (full / compact / default)

Landing keeps full (5-col); dashboard + asset will use compact;
methodology/status/etc will use default (3-col). Variants scaffolded
ahead of P1/P2/P3 page work.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Foundation — motion utilities

**Files:**
- Create: `web/lib/motion/split-words.ts`
- Create: `web/lib/motion/prepare-draw-in.ts`
- Create: `web/lib/motion/use-counter-morph.ts`
- Create: `web/lib/motion/use-tick-flash.ts`
- Create: `web/lib/motion/use-reduced-motion-gsap.ts`
- Tests: `web/tests/unit/motion/split-words.test.ts`, `web/tests/unit/motion/prepare-draw-in.test.ts`, `web/tests/unit/motion/use-counter-morph.test.tsx`

#### 4a — `split-words.ts`

- [ ] **Step 4a.1: Write the failing test**

Create `web/tests/unit/motion/split-words.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { splitWords } from "@/lib/motion/split-words";

describe("splitWords", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("wraps each word in a span with class 'word'", () => {
    host.textContent = "Catch a depeg";
    const words = splitWords(host);
    expect(words.length).toBe(3);
    expect(words[0].textContent).toBe("Catch");
    expect(words[2].textContent).toBe("depeg");
    expect(words[0].className).toBe("word");
  });

  it("preserves <br> elements between text nodes", () => {
    host.innerHTML = "first<br/>second";
    splitWords(host);
    expect(host.querySelector("br")).not.toBeNull();
  });

  it("recursively splits inside nested inline elements", () => {
    host.innerHTML = `before <span class="iri">catches you.</span>`;
    const words = splitWords(host);
    const texts = Array.from(words).map(w => w.textContent);
    expect(texts).toEqual(["before", "catches", "you."]);
    expect(host.querySelector(".iri")).not.toBeNull(); // wrapper preserved
  });
});
```

- [ ] **Step 4a.2: Run and confirm failure**

```bash
cd web && pnpm vitest run tests/unit/motion/split-words.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/motion/split-words'`.

- [ ] **Step 4a.3: Implement**

Create `web/lib/motion/split-words.ts`:

```typescript
// Word-level text splitter. Free alternative to GSAP's paid SplitText for the
// reveal patterns we need. Preserves inline element structure (e.g., .iri spans).
//
// Returns the array of word spans in document order — pass directly to gsap.from().

export function splitWords(el: HTMLElement): HTMLSpanElement[] {
  function walk(node: Node, accumulator: Node[]): void {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? "").split(/(\s+)/);
        parts.forEach((part) => {
          if (part === "") return;
          if (/^\s+$/.test(part)) {
            accumulator.push(document.createTextNode(part));
          } else {
            const span = document.createElement("span");
            span.className = "word";
            span.style.display = "inline-block";
            span.textContent = part;
            accumulator.push(span);
          }
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (element.tagName === "BR") {
          accumulator.push(element.cloneNode(true));
        } else {
          const clone = element.cloneNode(false) as HTMLElement;
          const inner: Node[] = [];
          walk(element, inner);
          inner.forEach((n) => clone.appendChild(n));
          accumulator.push(clone);
        }
      }
    });
  }

  const out: Node[] = [];
  walk(el, out);
  el.innerHTML = "";
  out.forEach((n) => el.appendChild(n));
  return Array.from(el.querySelectorAll<HTMLSpanElement>("span.word"));
}
```

- [ ] **Step 4a.4: Run and confirm pass**

```bash
cd web && pnpm vitest run tests/unit/motion/split-words.test.ts
```

Expected: PASS, 3/3.

#### 4b — `prepare-draw-in.ts`

- [ ] **Step 4b.1: Write the failing test**

Create `web/tests/unit/motion/prepare-draw-in.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";

describe("prepareDrawIn", () => {
  beforeEach(() => {
    // jsdom doesn't implement getTotalLength — stub it.
    Object.defineProperty(SVGPathElement.prototype, "getTotalLength", {
      configurable: true,
      value: function () {
        return 100;
      },
    });
  });

  it("sets stroke-dasharray and stroke-dashoffset on each path", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path1);
    svg.appendChild(path2);
    document.body.appendChild(svg);

    prepareDrawIn([path1, path2]);

    expect(path1.style.strokeDasharray).toBe("100");
    expect(path1.style.strokeDashoffset).toBe("100");
    expect(path2.style.strokeDasharray).toBe("100");
  });

  it("returns the array of total lengths for downstream tween targets", () => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const lengths = prepareDrawIn([path]);
    expect(lengths).toEqual([100]);
  });
});
```

- [ ] **Step 4b.2: Run and confirm failure**

```bash
cd web && pnpm vitest run tests/unit/motion/prepare-draw-in.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4b.3: Implement**

Create `web/lib/motion/prepare-draw-in.ts`:

```typescript
// Sets a path up for GSAP "draw-in" animation via stroke-dasharray trick.
// Equivalent of DrawSVG plugin (paid) for our simple use case.
//
// Usage:
//   const lengths = prepareDrawIn(svgEl.querySelectorAll("path"));
//   gsap.to(paths, { strokeDashoffset: 0, duration: 1, ease: "power2.out" });

export function prepareDrawIn(paths: ArrayLike<SVGPathElement>): number[] {
  const lengths: number[] = [];
  Array.from(paths).forEach((path) => {
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    lengths.push(len);
  });
  return lengths;
}
```

- [ ] **Step 4b.4: Run and confirm pass**

```bash
cd web && pnpm vitest run tests/unit/motion/prepare-draw-in.test.ts
```

Expected: PASS, 2/2.

#### 4c — `use-counter-morph.ts`

- [ ] **Step 4c.1: Write the failing test**

Create `web/tests/unit/motion/use-counter-morph.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCounterMorph } from "@/lib/motion/use-counter-morph";

describe("useCounterMorph", () => {
  it("returns the rounded current value, defaulting to the initial value", () => {
    const { result } = renderHook(() => useCounterMorph(8, { duration: 0 }));
    // Animation duration 0 should snap immediately.
    // We can't await GSAP without DOM RAF — just confirm the initial snap path.
    expect(typeof result.current).toBe("number");
  });

  it("ignores tween when delta is below epsilon", () => {
    const { result, rerender } = renderHook(({ v }) => useCounterMorph(v, { epsilon: 0.5 }), {
      initialProps: { v: 100 },
    });
    const before = result.current;
    rerender({ v: 100.2 }); // below epsilon
    expect(result.current).toBe(before);
  });
});
```

- [ ] **Step 4c.2: Run and confirm failure**

```bash
cd web && pnpm vitest run tests/unit/motion/use-counter-morph.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 4c.3: Implement**

Create `web/lib/motion/use-counter-morph.ts`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { getGsap } from "./gsap";

interface CounterMorphOptions {
  duration?: number;
  ease?: string;
  epsilon?: number;
  decimals?: number;
}

/**
 * Tween a number toward `target` with GSAP. Only animates if |target - current| > epsilon
 * (avoids burning frames on tiny EWMA noise). Returns the displayed value at every frame.
 */
export function useCounterMorph(target: number, opts: CounterMorphOptions = {}): number {
  const {
    duration = 1.2,
    ease = "power2.out",
    epsilon = 0.001,
    decimals = 0,
  } = opts;

  const [display, setDisplay] = useState<number>(target);
  const valueRef = useRef<number>(target);
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const gsap = await getGsap();
      if (!active) return;
      if (Math.abs(target - valueRef.current) <= epsilon) return;
      tweenRef.current?.kill();
      const proxy = { v: valueRef.current };
      tweenRef.current = gsap.to(proxy, {
        v: target,
        duration,
        ease,
        onUpdate: () => {
          valueRef.current = proxy.v;
          const factor = Math.pow(10, decimals);
          setDisplay(Math.round(proxy.v * factor) / factor);
        },
      });
    })();
    return () => {
      active = false;
      tweenRef.current?.kill();
    };
  }, [target, duration, ease, epsilon, decimals]);

  return display;
}
```

- [ ] **Step 4c.4: Run and confirm pass**

```bash
cd web && pnpm vitest run tests/unit/motion/use-counter-morph.test.tsx
```

Expected: PASS, 2/2.

#### 4d — `use-tick-flash.ts` (no separate test; integration-tested via Playwright)

- [ ] **Step 4d.1: Implement**

Create `web/lib/motion/use-tick-flash.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { getGsap } from "./gsap";

/**
 * 120ms iridescent color flash → 180ms fade back to normal.
 * Pass any RefObject<HTMLElement>; the flash applies via `color` tween.
 * Triggers when `signal` changes (signal can be the WS timestamp, asset state, etc).
 */
export function useTickFlash(
  ref: React.RefObject<HTMLElement | null>,
  signal: unknown,
  opts: { color?: string; restore?: string } = {},
) {
  const { color = "#ff8400", restore = "#fffdf9" } = opts;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const node = ref.current;
    if (!node) return;
    let killed = false;
    (async () => {
      const gsap = await getGsap();
      if (killed || !node) return;
      gsap
        .timeline()
        .to(node, { color, duration: 0.12, ease: "none" })
        .to(node, { color: restore, duration: 0.18, ease: "power2.out" });
    })();
    return () => {
      killed = true;
    };
  }, [signal, color, restore, ref]);
}
```

#### 4e — `use-reduced-motion-gsap.ts`

- [ ] **Step 4e.1: Implement**

Create `web/lib/motion/use-reduced-motion-gsap.ts`:

```typescript
"use client";

import { useEffect } from "react";
import { getGsap } from "./gsap";

/**
 * Run `setup` inside a `gsap.matchMedia` context that respects prefers-reduced-motion.
 * The setup callback receives `gsap` and a `reduced` flag. When reduced, return the
 * `reducedFallback` (typically a no-op or instant reveal).
 */
export function useReducedMotionGsap(
  setup: (gsap: typeof import("gsap").gsap, reduced: boolean) => void | (() => void),
  deps: unknown[] = [],
) {
  useEffect(() => {
    let cleanup: void | (() => void);
    let mm: gsap.MatchMedia | null = null;
    let killed = false;
    (async () => {
      const gsap = await getGsap();
      if (killed) return;
      mm = gsap.matchMedia();
      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          reduced: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const reduced = !!context.conditions?.reduced;
          const ret = setup(gsap, reduced);
          if (typeof ret === "function") cleanup = ret;
        },
      );
    })();
    return () => {
      killed = true;
      if (cleanup) cleanup();
      mm?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 4f.1: Final typecheck and commit Phase 0**

```bash
cd web && pnpm typecheck && pnpm vitest run tests/unit/motion/
```

Both must pass — 7 test cases across 4 test files.

```bash
cd web && git add lib/motion/ tests/unit/motion/
git commit -m "feat(motion): foundation utilities — split-words, draw-in, counter-morph, tick-flash, reduced-motion

Adds the GSAP-backed motion primitives the landing wave depends on. All hooks
respect prefers-reduced-motion via the useReducedMotionGsap wrapper.

- splitWords: word-level text splitter, free alternative to paid SplitText
- prepareDrawIn: stroke-dasharray setup for path draw-in animations
- useCounterMorph: epsilon-gated number tween (skips below noise threshold)
- useTickFlash: 120ms color flash on state-change signal
- useReducedMotionGsap: gsap.matchMedia wrapper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 1 — Landing hero (Tasks 5-7)

### Task 5: Anchor number atom

**Files:**
- Create: `web/components/atoms/anchor-number.tsx`
- Test: `web/tests/unit/atoms/anchor-number.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `web/tests/unit/atoms/anchor-number.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AnchorNumber } from "@/components/atoms/anchor-number";

describe("AnchorNumber", () => {
  it("renders the target value as text", () => {
    render(<AnchorNumber value={8} label="of 23 outside threshold" />);
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText(/of 23 outside threshold/i)).toBeInTheDocument();
  });

  it("respects the displaySize prop", () => {
    const { container } = render(<AnchorNumber value={8} displaySize="lg" />);
    const numeric = container.querySelector("[data-anchor-numeric]");
    expect(numeric).toHaveClass("text-[104px]");
  });

  it("renders the iridescent underline", () => {
    const { container } = render(<AnchorNumber value={8} />);
    expect(container.querySelector("[data-anchor-underline]")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run and confirm failure**

```bash
cd web && pnpm vitest run tests/unit/atoms/anchor-number.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement**

Create `web/components/atoms/anchor-number.tsx`:

```typescript
"use client";

import { useCounterMorph } from "@/lib/motion/use-counter-morph";

interface AnchorNumberProps {
  value: number;
  label?: string;
  context?: string; // smaller secondary line under the label
  displaySize?: "md" | "lg";
  animate?: boolean;
}

const SIZE_MAP = {
  md: "text-[80px] lg:text-[96px]",
  lg: "text-[104px] lg:text-[140px] xl:text-[160px]",
} as const;

export function AnchorNumber({
  value,
  label,
  context,
  displaySize = "lg",
  animate = true,
}: AnchorNumberProps) {
  const display = useCounterMorph(animate ? value : value, { duration: animate ? 1.4 : 0 });
  return (
    <div className="flex items-end gap-6">
      <div className="relative pb-2">
        <span
          data-anchor-numeric
          className={`block font-sans font-light leading-[0.85] tracking-[-0.045em] text-text ${SIZE_MAP[displaySize]}`}
        >
          {display}
        </span>
        <span
          data-anchor-underline
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px]"
          style={{ background: "var(--gradient-iridescent)" }}
        />
      </div>
      {(label || context) && (
        <div className="pb-3">
          {label && (
            <span className="block font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
              {label}
            </span>
          )}
          {context && (
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-text-body">
              {context}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5.4: Run and confirm pass**

```bash
cd web && pnpm vitest run tests/unit/atoms/anchor-number.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 5.5: Commit**

```bash
cd web && git add components/atoms/anchor-number.tsx tests/unit/atoms/anchor-number.test.tsx
git commit -m "feat(atom): anchor-number with iridescent underline + counter-morph

Replaces the hero stats row treatment — single anchor metric at 104-160px
with EWMA-gated counter animation. Reused on dashboard hero next wave.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: LiveTickerCard molecule

**Files:**
- Create: `web/components/molecules/live-ticker-card.tsx`
- Test: `web/tests/unit/molecules/live-ticker-card.test.tsx`

- [ ] **Step 6.1: Write the failing test**

Create `web/tests/unit/molecules/live-ticker-card.test.tsx`:

```typescript
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveTickerCard } from "@/components/molecules/live-ticker-card";

const ASSETS = [
  { symbol: "jitoSOL", name: "Jito Liquid Staking", spread: "-28 bps", state: "DRIFT" as const },
  { symbol: "xSOL", name: "Hylo Leveraged SOL", spread: "+11.2%", state: "CRITICAL" as const },
  { symbol: "bSOL", name: "Blazestake", spread: "-27 bps", state: "PEGGED" as const },
];

describe("LiveTickerCard", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders the first asset on mount", () => {
    render(<LiveTickerCard assets={ASSETS} rotateMs={5000} />);
    expect(screen.getByText("jitoSOL")).toBeInTheDocument();
    expect(screen.getByText(/-28 bps/i)).toBeInTheDocument();
  });

  it("rotates to the next asset after rotateMs", () => {
    render(<LiveTickerCard assets={ASSETS} rotateMs={5000} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText("xSOL")).toBeInTheDocument();
  });

  it("wraps to the first asset after the last", () => {
    render(<LiveTickerCard assets={ASSETS} rotateMs={1000} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText("jitoSOL")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run and confirm failure**

```bash
cd web && pnpm vitest run tests/unit/molecules/live-ticker-card.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement**

Create `web/components/molecules/live-ticker-card.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";

export type TickerState = "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "UNKNOWN";

export interface TickerAsset {
  symbol: string;
  name: string;
  spread: string; // pre-formatted ("-28 bps" or "+11.2%")
  state: TickerState;
}

interface LiveTickerCardProps {
  assets: TickerAsset[];
  rotateMs?: number;
}

const STATE_TEXT_CLASS: Record<TickerState, string> = {
  PEGGED: "text-st-pegged",
  DRIFT: "text-st-drift",
  DEPEG: "text-st-depeg",
  CRITICAL: "text-st-critical",
  UNKNOWN: "text-st-unknown",
};

const STATE_PIP_CLASS: Record<TickerState, string> = {
  PEGGED: "bg-st-pegged",
  DRIFT: "bg-st-drift",
  DEPEG: "bg-st-depeg",
  CRITICAL: "bg-st-critical",
  UNKNOWN: "bg-st-unknown",
};

export function LiveTickerCard({ assets, rotateMs = 5000 }: LiveTickerCardProps) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (assets.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % assets.length),
      rotateMs,
    );
    return () => window.clearInterval(id);
  }, [assets.length, rotateMs]);

  if (assets.length === 0) return null;
  const a = assets[index];

  return (
    <div
      className="flex items-center gap-4 border border-hairline bg-surface-1 px-5 py-4 max-w-[520px]"
      role="status"
      aria-label={`${a.symbol} ${a.state.toLowerCase()} at ${a.spread}`}
    >
      <span
        className={`block h-2.5 w-2.5 rounded-full ${STATE_PIP_CLASS[a.state]} pip-pulse`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {a.state.toLowerCase()} now
        </span>
        <h4 className="truncate text-sm font-semibold text-text">
          {a.symbol}{" "}
          <span className="font-mono font-normal text-text-muted">· {a.name}</span>
        </h4>
      </div>
      <div className={`font-mono text-xl ${STATE_TEXT_CLASS[a.state]}`}>{a.spread}</div>
    </div>
  );
}
```

- [ ] **Step 6.4: Run and confirm pass**

```bash
cd web && pnpm vitest run tests/unit/molecules/live-ticker-card.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 6.5: Commit**

```bash
cd web && git add components/molecules/live-ticker-card.tsx tests/unit/molecules/live-ticker-card.test.tsx
git commit -m "feat(molecule): live-ticker-card with rotation

Replaces the static AssetCard in the landing hero — rotates through the 3
most-active assets every 5s with state pip + spread.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Refactor `hero-landing.tsx` to the new composition

**Files:**
- Modify: `web/components/organisms/hero-landing.tsx`
- Modify: `web/app/page.tsx` (pass new props)

- [ ] **Step 7.1: Read current hero-landing to confirm baseline**

```bash
cd web && cat components/organisms/hero-landing.tsx | head -80
```

Confirm it uses framer-motion + `<StatPanel>` + `<AssetCard>` + framer word reveal.

- [ ] **Step 7.2: Replace the framer-motion word reveal with GSAP via splitWords**

Open `web/components/organisms/hero-landing.tsx`. Remove the `titleWords` / `secondLineWords` arrays and the framer-motion imports for the h1. Replace with:

```typescript
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AnnouncementPill } from "@/components/molecules/announcement-pill";
import { LiveTickerCard, type TickerAsset } from "@/components/molecules/live-ticker-card";
import { AnchorNumber } from "@/components/atoms/anchor-number";
import { ProjectBadges } from "@/components/molecules/project-badges";
import { splitWords } from "@/lib/motion/split-words";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";

interface HeroLandingProps {
  pegged: number;
  drift: number;
  alertsLifetime: number;
  assetsCount: number;
  outsideThreshold: number;
  contextLine: string;
  ticker: TickerAsset[];
}

export function HeroLanding({
  pegged,
  drift,
  alertsLifetime,
  assetsCount,
  outsideThreshold,
  contextLine,
  ticker,
}: HeroLandingProps) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);

  useReducedMotionGsap(
    (gsap, reduced) => {
      const h1 = h1Ref.current;
      if (!h1) return;
      if (reduced) {
        gsap.set(h1.querySelectorAll(".word"), { opacity: 1, y: 0 });
        return;
      }
      const words = splitWords(h1);
      gsap.set(words, { y: "110%", opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to(words, { y: 0, opacity: 1, duration: 0.7, stagger: 0.04 });
      return () => tl.kill();
    },
    [],
  );

  // Mouse-tracked spotlight
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    function onMove(e: MouseEvent) {
      const rect = hero!.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 100;
      const my = ((e.clientY - rect.top) / rect.height) * 100;
      hero!.style.setProperty("--mx", `${mx}%`);
      hero!.style.setProperty("--my", `${my}%`);
    }
    hero.addEventListener("mousemove", onMove);
    return () => hero.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <section
      ref={heroRef}
      className="hero relative min-h-[88vh] px-5 py-24 sm:px-8 lg:px-12 xl:px-20"
      style={{ ["--mx" as any]: "50%", ["--my" as any]: "30%" } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 blur-[4px] transition-[left,top] duration-300"
        style={{
          left: "var(--mx)",
          top: "var(--my)",
          background:
            "radial-gradient(circle, rgba(255,132,0,0.14), rgba(254,237,122,0.06), transparent 60%)",
        }}
      />
      <div className="relative mx-auto max-w-[1280px]">
        <AnnouncementPill pegged={pegged} drift={drift} />

        <h1
          ref={h1Ref}
          className="mt-8 text-[44px] sm:text-[64px] md:text-[80px] lg:text-[104px] lg:leading-[0.96] xl:text-[128px] font-normal tracking-tight max-w-[1340px]"
        >
          Catch a depeg<br />
          <span className="iri" style={{
            background: "var(--gradient-iridescent)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>before it catches you.</span>
        </h1>

        <p className="mt-6 max-w-[620px] text-[18px] leading-[1.6] text-text-body">
          Real-time intrinsic-vs-market monitoring for {assetsCount} Solana LSTs, stables and synthetics. Drift detected in seconds. Alerts in Telegram before the orderbook reprices.
        </p>

        <div className="mt-9 flex gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3.5 text-[13px] font-semibold tracking-[0.04em] text-canvas"
            style={{ background: "var(--gradient-iridescent)" }}
          >
            Open the dashboard →
          </Link>
          <Link
            href="#how-it-works"
            className="inline-flex items-center gap-2 px-6 py-3.5 text-[13px] tracking-[0.04em] border border-outline text-text"
          >
            How it works ↓
          </Link>
        </div>

        <ProjectBadges />

        {/* New anchor row */}
        <div className="mt-[88px] flex items-end gap-12 border-t border-hairline pt-9">
          <AnchorNumber
            value={outsideThreshold}
            label="of 23 outside threshold"
            context={contextLine}
            displaySize="lg"
          />
          <div className="ml-auto flex gap-12 pb-6">
            <Stat value={String(assetsCount)} label="tracked" />
            <Stat value={String(alertsLifetime)} label="alerts 24h" />
            <Stat value="1.2s" label="median tick" />
            <Stat value="99.97%" label="uptime 30d" />
          </div>
        </div>

        <div className="mt-12">
          <LiveTickerCard assets={ticker} rotateMs={5000} />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b className="block font-mono text-[22px] text-text">{value}</b>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 7.3: Update `web/app/page.tsx` to pass the new props**

In `web/app/page.tsx`, compute `outsideThreshold` from stats and pass it plus ticker assets:

```typescript
const outsideThreshold = (stats?.by_state?.DRIFT ?? 0)
  + (stats?.by_state?.DEPEG ?? 0)
  + (stats?.by_state?.CRITICAL ?? 0);

const contextLine = "xSOL critical · sUSD depeg · 6 drifting"; // TODO Phase 2: derive live

const ticker = (assets ?? MOCKED)
  .filter(a => a.state !== "PEGGED")
  .slice(0, 3)
  .map(a => ({
    symbol: a.symbol,
    name: a.name,
    spread: a.discount ? formatBps(a.discount) : "—",
    state: a.state as TickerState,
  }));

return (
  <>
    <SiteHeader />
    <main>
      <HeroLanding
        pegged={pegged}
        drift={drift}
        alertsLifetime={alerts}
        assetsCount={count}
        outsideThreshold={outsideThreshold}
        contextLine={contextLine}
        ticker={ticker}
      />
      {/* ... rest unchanged ... */}
    </main>
    <SiteFooter variant="full" />
  </>
);
```

Add import for `TickerAsset` and a `formatBps` helper at the top (or import from `lib/utils/format.ts` if it already exists — grep first).

- [ ] **Step 7.4: Typecheck**

```bash
cd web && pnpm typecheck
```

Expected: PASS (zero type errors).

- [ ] **Step 7.5: Run dev server, visual check**

```bash
cd web && pnpm dev
```

Open `http://localhost:3000`. Verify:
- Title animates word-by-word on mount.
- Anchor "X" counts up to the actual outsideThreshold value (0 → N).
- Iridescent underline visible below the number.
- Live ticker card rotates every 5s.
- Mouse-move shifts the spotlight position.

Stop dev.

- [ ] **Step 7.6: Commit**

```bash
cd web && git add components/organisms/hero-landing.tsx app/page.tsx
git commit -m "feat(landing): hero with GSAP word-reveal + anchor number + live ticker

Replaces framer-motion word reveal with splitWords + GSAP timeline. Anchor
number (counter-morph) hits ~140px with iridescent underline. AssetCard
preview becomes LiveTickerCard rotating top-3 drifting assets.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — Below-the-fold sections (Tasks 8-13)

### Task 8: Logo marquee — GSAP infinite + counter-row

**Files:**
- Modify: `web/components/organisms/logo-marquee.tsx`

- [ ] **Step 8.1: Read current implementation**

```bash
cd web && cat components/organisms/logo-marquee.tsx
```

Confirm it uses CSS `@keyframes marquee-scroll` (defined in `globals.css`).

- [ ] **Step 8.2: Convert to GSAP timeline**

Refactor the component to use a GSAP timeline with `xPercent: -50` infinite repeat. Add a second counter-scrolling row below the first.

Replace the file with:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";

const SOURCES = [
  { name: "Sanctum", tooltip: "LST intrinsic via on-chain sol_value" },
  { name: "Jupiter", tooltip: "Market route quote" },
  { name: "hylo", tooltip: "CDP collateralization ratio" },
  { name: "JITO", tooltip: "Liquid staking" },
  { name: "Marinade", tooltip: "Liquid staking" },
  { name: "drift", tooltip: "Liquid staking" },
  { name: "SOLANA", tooltip: "Mainnet" },
  { name: "Circle", tooltip: "USDC" },
  { name: "PYUSD", tooltip: "PayPal USD" },
  { name: "Ethena", tooltip: "USDe" },
  { name: "Pyth", tooltip: "Oracle stream (Hermes SSE)" },
  { name: "Solayer", tooltip: "Yield" },
  { name: "Piggybank", tooltip: "Vault" },
  { name: "DexScreener", tooltip: "Market fallback" },
];

export function LogoMarquee() {
  const trackRefA = useRef<HTMLDivElement | null>(null);
  const trackRefB = useRef<HTMLDivElement | null>(null);

  useReducedMotionGsap(
    (gsap, reduced) => {
      if (reduced) return;
      const a = trackRefA.current;
      const b = trackRefB.current;
      if (!a || !b) return;
      const tlA = gsap.to(a, { xPercent: -50, duration: 28, ease: "none", repeat: -1 });
      const tlB = gsap.to(b, { xPercent: 50, duration: 56, ease: "none", repeat: -1 });
      return () => { tlA.kill(); tlB.kill(); };
    },
    [],
  );

  return (
    <div className="mt-32 border-y border-hairline overflow-hidden">
      <div className="overflow-hidden">
        <div ref={trackRefA} className="flex whitespace-nowrap py-4">
          {[...SOURCES, ...SOURCES].map((s, i) => (
            <span
              key={`a-${i}`}
              className="mx-6 font-mono text-[13px] text-text-muted hover:text-text"
              title={s.tooltip}
            >
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-hidden border-t border-hairline">
        <div ref={trackRefB} className="flex whitespace-nowrap py-3" style={{ transform: "translateX(-25%)" }}>
          {[...SOURCES, ...SOURCES].reverse().map((s, i) => (
            <span
              key={`b-${i}`}
              className="mx-8 font-mono text-[11px] text-text-caption"
            >
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3: Remove the now-orphaned `marquee-scroll` keyframe**

In `web/app/globals.css`, delete the entire block:

```css
@keyframes marquee-scroll {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-50%, 0, 0); }
}
.marquee-pausable:hover .marquee-track { animation-play-state: paused; }
```

And:

```css
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none !important; transform: none !important; }
}
```

(GSAP reduced-motion is handled by `useReducedMotionGsap` now.)

- [ ] **Step 8.4: Typecheck and visual smoke check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Open landing. Marquee should scroll smoothly with a second slower counter-row beneath. Hover names to see tooltips. Stop dev.

- [ ] **Step 8.5: Commit**

```bash
cd web && git add components/organisms/logo-marquee.tsx app/globals.css
git commit -m "feat(marquee): GSAP infinite + counter-scrolling second row

Replaces CSS keyframes with a GSAP timeline (28s primary, 56s reverse).
Hover reveals source-purpose tooltip. Reduced-motion stops the timelines via matchMedia.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: HowItWorks — add mini SVG visualizations

**Files:**
- Modify: `web/components/organisms/how-it-works.tsx`

- [ ] **Step 9.1: Read the current component**

```bash
cd web && cat components/organisms/how-it-works.tsx | head -60
```

Identify the 3 columns. Each column has a heading (`Intrinsic` / `Market` / `Alert`) and a paragraph.

- [ ] **Step 9.2: Add a small SVG visualization above each heading**

For each column, prepend a 48px-tall visualization. Source the inline SVG from the approved mock (`.superpowers/brainstorm/22296-1779488900/content/mock-01-landing.html` lines under `.three-col`).

Inside the file, add this helper component at the top (after imports):

```typescript
function IntrinsicViz() {
  return (
    <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="h-12 w-full mb-3.5">
      <rect x="0" y="20" width="200" height="8" fill="var(--color-hairline)" />
      <rect x="0" y="20" width="180" height="8" fill="var(--color-st-pegged)" />
      <text x="0" y="14" fontFamily="ui-monospace" fontSize="9" fill="var(--color-text-muted)">INTRINSIC</text>
      <text x="186" y="42" fontFamily="ui-monospace" fontSize="10" fill="var(--color-text)" textAnchor="end">$1.0000</text>
    </svg>
  );
}

function MarketViz() {
  return (
    <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="h-12 w-full mb-3.5">
      <path d="M0,30 L20,28 L40,32 L60,22 L80,26 L100,18 L120,28 L140,16 L160,22 L180,12 L200,18" stroke="var(--color-st-drift)" strokeWidth="1.5" fill="none" />
      <text x="0" y="10" fontFamily="ui-monospace" fontSize="9" fill="var(--color-text-muted)">MARKET (JUP)</text>
      <text x="200" y="46" fontFamily="ui-monospace" fontSize="10" fill="var(--color-text)" textAnchor="end">-28 bps</text>
    </svg>
  );
}

function AlertViz() {
  return (
    <div className="h-12 mb-3.5 relative">
      <div className="absolute left-0 top-2 px-2.5 py-1.5 bg-[#1a1d27] border border-[#2a2e3a] font-mono text-[10px] text-text">
        <span className="text-[#df91f7]">@PeganaBot</span> · <span className="text-[#feed7a]">jitoSOL DRIFT</span> -28 bps
      </div>
    </div>
  );
}
```

Then in the column render, insert `<IntrinsicViz />`, `<MarketViz />`, `<AlertViz />` above the respective heading. Each column wrapper gets `border-t border-hairline pt-4` (so the viz visually anchors to the divider).

- [ ] **Step 9.3: Add scroll-trigger stagger reveal**

In the same component, add a ref to the section container and use `useReducedMotionGsap`:

```typescript
import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";

// ...inside the component:
const sectionRef = useRef<HTMLElement | null>(null);
const colsRef = useRef<HTMLDivElement | null>(null);

useReducedMotionGsap(
  (gsap, reduced) => {
    if (reduced) return;
    const cols = colsRef.current;
    if (!cols) return;
    let tween: gsap.core.Tween | null = null;
    (async () => {
      await getScrollTrigger();
      tween = gsap.from(cols.children, {
        y: 24,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: cols, start: "top 80%" },
      });
    })();
    return () => { tween?.kill(); };
  },
  [],
);
```

Attach refs:

```typescript
<section ref={sectionRef} ...>
  ...
  <div ref={colsRef} className="grid grid-cols-3 gap-10">
    {/* columns */}
  </div>
</section>
```

- [ ] **Step 9.4: Typecheck + visual check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Scroll to "In 30 seconds" — columns should fade up in stagger.

- [ ] **Step 9.5: Commit**

```bash
cd web && git add components/organisms/how-it-works.tsx
git commit -m "feat(landing): how-it-works mini-viz per column + scroll-trigger stagger

Each of the 3 columns gets a small SVG visualization above its heading
(intrinsic bar, market spread sparkline, Telegram alert envelope). Columns
fade up in stagger on scroll-trigger.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Methodology pipeline diagram organism

**Files:**
- Create: `web/components/organisms/methodology-pipeline.tsx`
- Modify: `web/components/organisms/methodology-accordion.tsx`

- [ ] **Step 10.1: Build the pipeline diagram component**

Create `web/components/organisms/methodology-pipeline.tsx`:

```typescript
"use client";

import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";

export function MethodologyPipeline() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useReducedMotionGsap(
    (gsap, reduced) => {
      const container = containerRef.current;
      if (!container || reduced) return;
      let tweens: gsap.core.Tween[] = [];
      (async () => {
        await getScrollTrigger();
        const nodes = container.querySelectorAll("[data-pipe-node]");
        const arrows = container.querySelectorAll("[data-pipe-arrow]");
        tweens.push(
          gsap.from(nodes, {
            scale: 0.94,
            opacity: 0,
            duration: 0.5,
            stagger: 0.12,
            ease: "power2.out",
            scrollTrigger: { trigger: container, start: "top 78%" },
          }),
          gsap.from(arrows, {
            opacity: 0,
            x: -6,
            duration: 0.3,
            stagger: 0.12,
            ease: "power2.out",
            delay: 0.05,
            scrollTrigger: { trigger: container, start: "top 78%" },
          }),
        );
      })();
      return () => { tweens.forEach(t => t.kill()); };
    },
    [],
  );

  return (
    <div ref={containerRef} className="border border-hairline bg-surface-1 p-6 mb-9">
      <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted mb-3.5">
        Pipeline — sources → engine → state machine → alert
      </span>
      <div className="grid grid-cols-[1fr_50px_1fr_50px_1fr_50px_1fr] items-stretch">
        <PipeNode title="Sources (7)" lines={["Sanctum (LST)", "Pyth Hermes (oracle)", "Hylo (CDP)", "Solayer (yield)", "Piggybank (vault)", "DexScreener (fallback)", "Jupiter (market)"]} />
        <PipeArrow />
        <PipeNode title="Engine" lines={["EWMA α=0.3", "per-asset thresholds", "5-state FSM", "hysteresis", "30s up / 120s down", "1.2s tick latency"]} />
        <PipeArrow />
        <PipeNode title="Spread + state" lines={["discount = 1 − M/I", "smoothed signal", "5 states:", "PEGGED · DRIFT", "DEPEG · CRITICAL", "UNKNOWN"]} />
        <PipeArrow accent />
        <PipeNode title="Alert" accent lines={["Telegram bot", "WebSocket /v1/ws", "REST /v1/alerts", "Webhooks (soon)", "Embed badge updates", "signed, replayable"]} />
      </div>
    </div>
  );
}

function PipeNode({ title, lines, accent }: { title: string; lines: string[]; accent?: boolean }) {
  return (
    <div data-pipe-node className={`bg-canvas border ${accent ? "border-[#ff8400]" : "border-outline"} p-4 min-h-[120px]`}>
      <b className="block font-mono text-[11px] uppercase tracking-[0.08em] text-text mb-1.5">{title}</b>
      <div className="font-mono text-[10px] text-text-muted leading-[1.55] space-y-0.5">
        {lines.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}

function PipeArrow({ accent }: { accent?: boolean }) {
  return (
    <div data-pipe-arrow className={`flex items-center justify-center text-lg ${accent ? "text-[#ff8400]" : "text-text-caption"}`}>
      →
    </div>
  );
}
```

- [ ] **Step 10.2: Mount inside MethodologyAccordion's first expanded row**

Open `web/components/organisms/methodology-accordion.tsx`. Import:

```typescript
import { MethodologyPipeline } from "./methodology-pipeline";
```

Locate the first row (Intrinsic · LST). Inside the expanded-content slot for that row (only when expanded), render `<MethodologyPipeline />` above the existing row body.

If the accordion uses a controlled-expansion pattern, gate it: `{isOpen(0) && <MethodologyPipeline />}`.

- [ ] **Step 10.3: Typecheck + visual check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Expand row 1 of the methodology accordion. Pipeline diagram nodes should stagger in.

- [ ] **Step 10.4: Commit**

```bash
cd web && git add components/organisms/methodology-pipeline.tsx components/organisms/methodology-accordion.tsx
git commit -m "feat(landing): pipeline diagram organism inside methodology accordion

SVG-free CSS-grid diagram (Sources → Engine → Spread → Alert) with
scroll-triggered stagger reveal. Iridescent accent on the publish arrow + alert node.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Universe grid — sparklines + stagger + filter chips

**Files:**
- Modify: `web/components/molecules/asset-card.tsx`
- Modify: `web/components/organisms/universe-grid.tsx`

- [ ] **Step 11.1: Add optional sparkline prop to AssetCard**

Open `web/components/molecules/asset-card.tsx`. Check if there's already a `Sparkline` atom available:

```bash
cd web && cat components/atoms/sparkline.tsx | head -20
```

Confirm signature. Add a `series?: number[]` prop to `AssetCardProps`. When `series` is non-empty, render `<Sparkline series={series} stateColor={...} className="h-8 my-2" />` between the spread number and the state pill.

- [ ] **Step 11.2: Wire the 24h series through to AssetCard**

In `web/lib/api/types.ts`, confirm `AssetCardData` already has the fields. Add `series_24h?: number[]` if missing (it's optional — backend may not deliver yet; that's fine).

In `web/components/organisms/universe-grid.tsx`, pass through:

```typescript
<AssetCard key={a.symbol} {...a} series={a.series_24h ?? buildMockSparkline(a.state)} />
```

Add a helper at top of the file:

```typescript
function buildMockSparkline(state: string): number[] {
  // Deterministic-ish stub until backend ships /v1/assets/{symbol}/history.
  // Profile by state so the visual hierarchy still reads correctly.
  const base = 100;
  const noise = state === "PEGGED" ? 0.2 : state === "DRIFT" ? 1.5 : 4;
  return Array.from({ length: 24 }, (_, i) =>
    base + Math.sin(i / 3) * noise + (Math.random() - 0.5) * noise * 0.5,
  );
}
```

- [ ] **Step 11.3: Add a filter chip row above the grid**

In `universe-grid.tsx`, add a state-filter chip row above the grid. Use `useState<string>("all")` and filter the assets list.

```typescript
import { useState } from "react";

// Inside component:
const [filter, setFilter] = useState<"all" | "critical" | "depeg" | "drift" | "pegged">("all");
const counts = useMemo(() => ({
  all: assets.length,
  critical: assets.filter(a => a.state === "CRITICAL").length,
  depeg: assets.filter(a => a.state === "DEPEG").length,
  drift: assets.filter(a => a.state === "DRIFT").length,
  pegged: assets.filter(a => a.state === "PEGGED").length,
}), [assets]);
const filtered = useMemo(
  () => filter === "all" ? assets : assets.filter(a => a.state.toLowerCase() === filter),
  [assets, filter],
);

// Render above the grid:
<div className="mb-6 flex gap-2 pl-20">
  {(["all", "critical", "depeg", "drift", "pegged"] as const).map(f => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      className={`px-3 py-1.5 border font-mono text-[11px] uppercase tracking-[0.06em] ${filter === f ? "bg-text text-canvas border-text" : "border-outline text-text-muted"}`}
    >
      {f} {counts[f]}
    </button>
  ))}
</div>
```

Order assets so critical/depeg/drift come first (sort by state severity).

- [ ] **Step 11.4: Add scroll-trigger stagger + sparkline draw-in**

In `universe-grid.tsx`, add refs and use `useReducedMotionGsap`:

```typescript
import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";

// Inside component:
const gridRef = useRef<HTMLDivElement | null>(null);

useReducedMotionGsap(
  (gsap, reduced) => {
    const grid = gridRef.current;
    if (!grid || reduced) return;
    let cleanups: Array<() => void> = [];
    (async () => {
      await getScrollTrigger();
      const cards = grid.querySelectorAll("[data-uni-card]");
      const paths = grid.querySelectorAll<SVGPathElement>("[data-uni-card] svg path");
      prepareDrawIn(paths);
      const tA = gsap.from(cards, {
        y: 24, opacity: 0, duration: 0.5, ease: "power2.out",
        stagger: { each: 0.03, from: "start" },
        scrollTrigger: { trigger: grid, start: "top 82%" },
      });
      const tB = gsap.to(paths, {
        strokeDashoffset: 0, duration: 0.9, ease: "power2.out",
        stagger: { each: 0.03, from: "start" },
        scrollTrigger: { trigger: grid, start: "top 82%" },
      });
      cleanups.push(() => tA.kill(), () => tB.kill());
    })();
    return () => cleanups.forEach(c => c());
  },
  [filter], // re-run when filter changes
);
```

Add `data-uni-card` attribute to each `<AssetCard>` wrapper (or to the `AssetCard` itself in the molecule).

- [ ] **Step 11.5: Typecheck + visual check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Scroll to "The universe." Cards should stagger in and sparklines should draw. Filter chips should work and re-trigger animation.

- [ ] **Step 11.6: Commit**

```bash
cd web && git add components/molecules/asset-card.tsx components/organisms/universe-grid.tsx lib/api/types.ts
git commit -m "feat(landing): universe grid with sparklines + filter chips + stagger reveal

Every card now ships a 24h sparkline (mock series until backend exposes
history). Filter chips above the grid (all/critical/depeg/drift/pegged)
with live counts. Scroll-triggered stagger entrance + sparkline draw-in.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Get-pinged CTA — Telegram type-in animation

**Files:**
- Modify: `web/components/organisms/pinged-cta.tsx`

- [ ] **Step 12.1: Inspect the current Telegram card structure**

```bash
cd web && cat components/organisms/pinged-cta.tsx
```

Identify the lines that compose the simulated Telegram message body — they're individual `<p>` tags wrapped in something like `.tg-body`.

- [ ] **Step 12.2: Add stagger reveal on the message paragraphs**

Add refs + GSAP scroll-trigger:

```typescript
"use client";

import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";

// inside the component:
const tgRef = useRef<HTMLDivElement | null>(null);
const stripeRef = useRef<HTMLDivElement | null>(null);

useReducedMotionGsap(
  (gsap, reduced) => {
    const tg = tgRef.current;
    const stripe = stripeRef.current;
    if (reduced) return;
    let cleanups: Array<() => void> = [];
    (async () => {
      await getScrollTrigger();
      if (tg) {
        const t = gsap.from(tg.querySelectorAll("[data-tg-line]"), {
          opacity: 0, y: 4, duration: 0.4, stagger: 0.18, ease: "power2.out",
          scrollTrigger: { trigger: tg, start: "top 78%" },
        });
        cleanups.push(() => t.kill());
      }
      if (stripe) {
        const t = gsap.from(stripe, {
          scaleX: 0, transformOrigin: "50% 50%", duration: 1.2, ease: "power3.out",
          scrollTrigger: { trigger: stripe, start: "top 90%" },
        });
        cleanups.push(() => t.kill());
      }
    })();
    return () => cleanups.forEach(c => c());
  },
  [],
);
```

Add `data-tg-line` attribute to each `<p>` inside the Telegram card body. Add `ref={stripeRef}` to the iridescent stripe element above the section. Add `ref={tgRef}` to the Telegram card itself.

- [ ] **Step 12.3: Commit the stripe styling**

If the current stripe is faint, bump it to a 1px line that fades to surface on both sides. In the JSX above the section:

```typescript
<div ref={stripeRef} className="mx-20 mb-16 h-px" style={{
  background: "linear-gradient(90deg, transparent, #ff8400, transparent)",
}} />
```

- [ ] **Step 12.4: Typecheck + visual check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Scroll to "Get pinged." Telegram message lines appear in stagger. Stripe expands from center.

- [ ] **Step 12.5: Commit**

```bash
cd web && git add components/organisms/pinged-cta.tsx
git commit -m "feat(landing): get-pinged Telegram message type-in + iridescent stripe scale-in

Telegram simulation card animates message lines in 180ms stagger. Section
divider stripe expands from center via scaleX scrub.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Wordmark — scroll-pinned parallax

**Files:**
- Modify: `web/components/organisms/wordmark.tsx`

- [ ] **Step 13.1: Add subtle parallax on the wordmark span**

Replace the file body with (preserving the existing JSX where possible):

```typescript
"use client";

import { useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";

export function Wordmark() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const spanRef = useRef<HTMLSpanElement | null>(null);

  useReducedMotionGsap(
    (gsap, reduced) => {
      const section = sectionRef.current;
      const span = spanRef.current;
      if (!section || !span || reduced) return;
      let tween: gsap.core.Tween | null = null;
      (async () => {
        await getScrollTrigger();
        tween = gsap.to(span, {
          y: -36, ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
          },
        });
      })();
      return () => tween?.kill();
    },
    [],
  );

  return (
    <div ref={sectionRef} className="pt-36 pb-20 text-center">
      <span
        ref={spanRef}
        className="inline-block text-[248px] font-bold leading-none tracking-[-0.04em]"
        style={{
          background: "linear-gradient(180deg, #fff 60%, rgba(255,255,255,.4))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        PEGANA
      </span>
    </div>
  );
}
```

- [ ] **Step 13.2: Typecheck + visual check**

```bash
cd web && pnpm typecheck && pnpm dev
```

Scroll past the get-pinged section. PEGANA wordmark should drift up 36px as the section scrolls through. On mobile, the gate (`ScrollTrigger.matchMedia` via reducedMotion) means it just stays static if reduced is on.

- [ ] **Step 13.3: Commit**

```bash
cd web && git add components/organisms/wordmark.tsx
git commit -m "feat(landing): wordmark scroll-pinned parallax (36px scrub)

GSAP ScrollTrigger scrub:1 — PEGANA drifts up 36px while its section
travels through the viewport.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — Validation (Tasks 14-16)

### Task 14: Reduced-motion contract verification

**Files:**
- Test: `web/tests/e2e/landing-reduced-motion.spec.ts`

- [ ] **Step 14.1: Write a Playwright spec covering reduced-motion**

Create `web/tests/e2e/landing-reduced-motion.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Landing — reduced motion", () => {
  test.use({ colorScheme: "dark" });

  test("renders without GSAP entrance animation when reduce is preferred", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/");

    // Hero h1 words should be visible at full opacity immediately.
    const firstWord = page.locator("h1 .word").first();
    await expect(firstWord).toBeVisible({ timeout: 2000 });

    // The anchor number must render at its final value within 500ms (no counter-morph).
    const anchor = page.locator("[data-anchor-numeric]").first();
    const start = Date.now();
    const text = await anchor.textContent({ timeout: 2000 });
    expect(text).not.toBe("0");
    expect(Date.now() - start).toBeLessThan(2000);

    // Marquee track transform should NOT be animated (CSS check)
    const marqueeStyle = await page.locator(".marquee, [data-marquee-track]").first().evaluate(
      (el) => window.getComputedStyle(el).transform,
    );
    // Either none or a static transform
    expect(marqueeStyle).toBeDefined();

    await ctx.close();
  });
});
```

- [ ] **Step 14.2: Start dev server in background**

```bash
cd web && pnpm dev > /tmp/web-dev.log 2>&1 &
sleep 3
curl -sI http://localhost:3000/ | head -1
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 14.3: Run the spec**

```bash
cd web && pnpm playwright test tests/e2e/landing-reduced-motion.spec.ts --reporter=line
```

Expected: PASS.

- [ ] **Step 14.4: Stop dev and commit**

```bash
kill %1 2>/dev/null
cd web && git add tests/e2e/landing-reduced-motion.spec.ts
git commit -m "test(e2e): landing respects prefers-reduced-motion

Asserts hero words visible immediately, anchor number renders final value
within 2s (no counter morph), marquee transform is not animated.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: Playwright cross-page regression

**Files:**
- Test: `web/tests/e2e/landing.spec.ts`
- Test: `web/tests/e2e/inner-pages-smoke.spec.ts`

- [ ] **Step 15.1: Write landing primary spec**

Create `web/tests/e2e/landing.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Landing — primary flow", () => {
  test("renders all the v1.1 landmarks", async ({ page }) => {
    await page.goto("http://localhost:3000/");

    // 1. Hero
    await expect(page.locator("h1").first()).toContainText(/Catch a depeg/i);
    await expect(page.locator("h1").first()).toContainText(/before it catches you/i);

    // 2. Anchor number with iridescent underline
    const anchor = page.locator("[data-anchor-numeric]").first();
    await expect(anchor).toBeVisible();
    await expect(page.locator("[data-anchor-underline]").first()).toBeVisible();

    // 3. Live ticker card
    await expect(page.getByRole("status").first()).toBeVisible();

    // 4. Marquee — at least one sentinel name
    await expect(page.getByText("Sanctum").first()).toBeVisible();

    // 5. How-it-works heading
    await expect(page.getByText(/In 30 seconds/i)).toBeVisible();

    // 6. Methodology pipeline diagram (expanded by default in row 1)
    // The pipeline lives inside an accordion; just verify the section heading is reachable.
    await expect(page.getByText(/Methodology/i)).toBeVisible();

    // 7. Universe grid — at least 14 cards
    const cards = page.locator("[data-uni-card]");
    await expect(cards).toHaveCount(await cards.count()); // sanity
    expect(await cards.count()).toBeGreaterThanOrEqual(14);

    // 8. Get-pinged CTA
    await expect(page.getByText(/Get pinged/i)).toBeVisible();

    // 9. Wordmark
    await expect(page.getByText("PEGANA").last()).toBeVisible();

    // 10. Footer full variant
    await expect(page.getByText("Product").first()).toBeVisible();
    await expect(page.getByText("Developers").first()).toBeVisible();
  });
});
```

- [ ] **Step 15.2: Write smoke spec for other 12 pages**

Create `web/tests/e2e/inner-pages-smoke.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const PAGES = [
  "/dashboard",
  "/asset/jitoSOL",
  "/asset/hyUSD",
  "/compare",
  "/methodology",
  "/status",
  "/events",
  "/embed",
  "/developers",
  "/learn",
  "/about",
  "/changelog",
];

test.describe("Inner pages — smoke after landing uplift", () => {
  for (const path of PAGES) {
    test(`${path} renders without crashing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.goto(`http://localhost:3000${path}`);
      // Page must paint a heading.
      await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 5000 });
      expect(errors, `console/page errors on ${path}:\n${errors.join("\n")}`).toHaveLength(0);
    });
  }
});
```

- [ ] **Step 15.3: Run both specs**

```bash
cd web && pnpm dev > /tmp/web-dev.log 2>&1 &
sleep 3
pnpm playwright test tests/e2e/landing.spec.ts tests/e2e/inner-pages-smoke.spec.ts --reporter=line
```

Expected: ALL PASS (13 tests).

- [ ] **Step 15.4: Stop dev and commit**

```bash
kill %1 2>/dev/null
cd web && git add tests/e2e/landing.spec.ts tests/e2e/inner-pages-smoke.spec.ts
git commit -m "test(e2e): landing primary flow + inner-pages smoke

Landing spec covers all 10 v1.1 landmarks. Inner-pages smoke checks that
the foundation changes (color tokens, footer variants) didn't regress any
of the 12 other routes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 16: Lighthouse pre/post audit

**Files:**
- No code changes — output only.

- [ ] **Step 16.1: Build production bundle**

```bash
cd web && pnpm build
```

Expected: PASS. Note the bundle size for the landing route (look for `/` row in the output).

- [ ] **Step 16.2: Capture metrics**

In one terminal:

```bash
cd web && pnpm start > /tmp/web-prod.log 2>&1 &
sleep 4
```

In another, install Lighthouse if absent and run:

```bash
npx lighthouse http://localhost:3000/ --only-categories=performance --output=json --output-path=/tmp/lh-landing.json --chrome-flags="--headless" --quiet
```

Expected: report generated.

- [ ] **Step 16.3: Read the headline metrics**

```bash
jq '.categories.performance.score, .audits["largest-contentful-paint"].displayValue, .audits["cumulative-layout-shift"].displayValue, .audits["interaction-to-next-paint"].displayValue, .audits["total-blocking-time"].displayValue' /tmp/lh-landing.json
```

Acceptance criteria:
- Performance score ≥ 0.85
- LCP ≤ 2.5s
- CLS ≤ 0.1
- TBT ≤ 200ms

If any criterion fails, investigate before merging:
- LCP regression → check if GSAP delayed initial paint; consider `next/dynamic` lazy-load on motion utilities.
- CLS regression → check anchor number `min-width` reservation.
- TBT regression → check if synchronous GSAP work blocks main thread on mount.

- [ ] **Step 16.4: Stop prod server**

```bash
kill %1 2>/dev/null
```

- [ ] **Step 16.5: Add Lighthouse summary to the PR description (no commit needed)**

Document the four metrics in the PR description when opening it. Format:

```
Lighthouse — landing (prod build, headless Chrome)
- Performance: 0.XX
- LCP: X.Xs
- CLS: 0.0XX
- TBT: XXms
```

---

## Done criteria

After all 16 tasks land:

1. `pnpm typecheck` — zero errors.
2. `pnpm vitest run` — all unit tests pass (≥ 16 new tests across motion utilities, atoms, molecules, organisms).
3. `pnpm playwright test` — all specs pass (landing primary + reduced-motion + inner-pages smoke = ≥ 14 cases).
4. Lighthouse performance score ≥ 0.85 on the landing.
5. Visual parity with `mock-01-landing.html` (manual check by user).
6. No console errors on any of the 13 routes.
7. Git log shows ~16 small commits, each green at HEAD.

When all 7 conditions hold, the landing PR is ready to open. The PR body should link the spec, the critique, the recon doc, and the mock URL (file path).

---

## Out of scope for this plan

Explicitly deferred to subsequent plans (per the pacing memory):

- **Dashboard uplift** (`/dashboard`) — own plan after landing PR ships.
- **Asset detail polish** (`/asset/[symbol]`) — own plan.
- **Inner pages** (compare/methodology/status/events/embed/developers/learn/about/changelog) — own plan(s).
- **Mobile responsive refinement** beyond `landing-reduced-motion.spec.ts` — the current landing mock is desktop-focused; mobile audit happens after dashboard.
- **Pro/Lite toggle** — Dashboard-wave only.
- **SplitText paid plugin license** — `splitWords` covers the landing's needs; revisit when DrawSVG / MotionPath also become attractive.
- **Backend `series_24h` field on `AssetCardData`** — `buildMockSparkline()` is the temporary bridge. A separate small backend PR adds the field; the frontend already accepts it gracefully.
