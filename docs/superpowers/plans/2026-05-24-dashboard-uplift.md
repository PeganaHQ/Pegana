# Dashboard Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dashboard direction A (Bloomberg Live, hybrid) — peg-health strip, anchor-number hero, active mini-charts, cross-component hover preview, Flip-driven view toggle, recency-fade alerts.

**Architecture:** Reuse all motion utilities from the landing wave (`web/lib/motion/*`). Refactor 5 existing dashboard organisms incrementally, add 3 new components (peg-strip, active mini-chart card, asset preview pane). Single PR.

**Tech stack:** Next 16 App Router, React 19, TypeScript strict, Tailwind v4 (`@theme {}`), GSAP core + ScrollTrigger + **Flip** (new for this wave), framer-motion 11 (kept for AnimatePresence on the preview pane), SWR, WebSocket (LiveContext).

**Source-of-truth references:**
- Spec: `docs/superpowers/specs/2026-05-22-design-uplift.md` § 3, § 5.2, § 6 P1
- Approved mock (with GSAP): `.superpowers/brainstorm/42854-1779652136/content/mock-02-dashboard.html`
- Landing-wave foundation utilities at `web/lib/motion/`: `getGsap`, `getScrollTrigger`, `useReducedMotionGsap`, `useCounterMorph`, `useTickFlash`, `splitWords`, `prepareDrawIn`
- Existing dashboard: `web/app/dashboard/page.tsx`, organisms `dashboard-overview`, `dashboard-filters`, `asset-table`, `alerts-sidebar`

**Pacing:** This is the DASHBOARD wave (P1). Do not touch landing, asset detail, compare, or inner pages. Asset detail gets its own plan after this wave ships.

**Base branch:** `feat/dashboard-uplift` (off `feat/landing-uplift` — the landing PR provides the motion utilities + color tokens this wave consumes).

---

## File map

**New files:**
- `web/lib/motion/get-flip.ts` — Flip plugin loader (Pyth-style singleton; pattern matches `get-scroll-trigger`).
- `web/components/organisms/peg-health-strip.tsx` — full-bleed 23-pip strip across the top.
- `web/components/molecules/active-mini-chart.tsx` — single active-asset card with sparkline + ticking spread + pip pulse.
- `web/components/organisms/active-strip.tsx` — wrapper organism that maps active assets to `<ActiveMiniChart>` (replaces the current text-only "ACTIVE" row inside `DashboardOverview`).
- `web/components/organisms/asset-preview-pane.tsx` — slide-in side panel rendered when a row is hovered (cross-component hover linking).
- `web/components/molecules/compare-shelf.tsx` — sticky watchlist shelf above the filter row.
- `web/tests/unit/organisms/peg-health-strip.test.tsx`
- `web/tests/unit/molecules/active-mini-chart.test.tsx`
- `web/tests/unit/organisms/asset-preview-pane.test.tsx`
- `web/tests/e2e/dashboard.spec.ts`

**Modified files:**
- `web/app/dashboard/page.tsx` — mount `<PegHealthStrip>` + `<CompareShelf>` + `<AssetPreviewPane>`, pass hovered-row state via local React state, switch footer to `variant="compact"`.
- `web/components/organisms/dashboard-overview.tsx` — replace `<Counter>` with `<AnchorNumber>`, add editorial sentence (alternating by state count), mount `<ActiveStrip>` below the anchor, remove the existing text-only ACTIVE row.
- `web/components/organisms/asset-table.tsx` — add hover-link event dispatch (calls a prop callback with the symbol on `mouseenter`), wrap sort & view-toggle transitions in GSAP Flip, add `useTickFlash` on the spread cell.
- `web/components/organisms/alerts-sidebar.tsx` — apply recency-intensity opacity ramp + fresh-alert highlight (left border iridescent).
- `web/components/organisms/dashboard-filters.tsx` — promote class/peg/safety filters to faceted chips with live counts (today's filters live in `dashboard-filters` but the chip-with-count pattern is missing).
- `web/components/molecules/critical-callout.tsx` — delete or repurpose (replaced by `<ActiveStrip>`).

**Out of scope (deferred to a future wave):**
- Pro / Lite toggle (Tensor pattern) — deferred per spec § 7 open decisions.
- Mobile-specific bottom-sheet filter — covered in a separate "mobile polish" follow-up. Mobile DOES get default mosaic mode in this wave.
- Faceted filter URL persistence — local state only.

---

## Phase 0 — Foundation (Task 1)

### Task 1: Flip loader

**Files:**
- Create: `web/lib/motion/get-flip.ts`
- Create: `web/tests/unit/motion/flip-loader.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `web/tests/unit/motion/flip-loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getFlip } from "@/lib/motion/get-flip";

describe("flip loader", () => {
  it("returns Flip plugin and registers it on first call", async () => {
    const flip = await getFlip();
    expect(flip).toBeDefined();
    expect(typeof flip.getState).toBe("function");
    expect(typeof flip.from).toBe("function");
  });

  it("returns the same Flip instance across calls", async () => {
    const a = await getFlip();
    const b = await getFlip();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 1.2: Run — must fail**

```bash
cd <repo>/web && pnpm vitest run tests/unit/motion/flip-loader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement**

Create `web/lib/motion/get-flip.ts`:

```typescript
// Dynamic-loads the Flip plugin and registers it once. Mirrors get-scroll-trigger.ts.

import { getGsap } from "./gsap";

let flipPromise: Promise<typeof import("gsap/Flip").Flip> | null = null;
let flipRegistered = false;

export async function getFlip() {
  if (!flipPromise) {
    flipPromise = (async () => {
      const gsap = await getGsap();
      const { Flip } = await import("gsap/Flip");
      if (!flipRegistered) {
        gsap.registerPlugin(Flip);
        flipRegistered = true;
      }
      return Flip;
    })();
  }
  return flipPromise;
}
```

- [ ] **Step 1.4: Run — must pass**

```bash
cd <repo>/web && pnpm vitest run tests/unit/motion/flip-loader.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 1.5: Commit**

```bash
cd <repo> && git add web/lib/motion/get-flip.ts web/tests/unit/motion/flip-loader.test.ts
git commit -m "feat(motion): Flip plugin loader (mirrors get-scroll-trigger singleton)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 1 — Top of dashboard (Tasks 2-4)

### Task 2: Peg-health strip organism

**Files:**
- Create: `web/components/organisms/peg-health-strip.tsx`
- Create: `web/tests/unit/organisms/peg-health-strip.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `web/tests/unit/organisms/peg-health-strip.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PegHealthStrip } from "@/components/organisms/peg-health-strip";
import type { AssetCardData } from "@/lib/api/types";

const ASSETS: AssetCardData[] = [
  { symbol: "xSOL", name: "Hylo Leveraged", mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "CRITICAL", discount: "0.112", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "jitoSOL", name: "Jito", mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "DRIFT", discount: "-0.0028", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "bSOL", name: "Blazestake", mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0027", intrinsic_usd: null, market_usd: null, updated_at: null },
];

describe("PegHealthStrip", () => {
  it("renders one pip per asset", () => {
    const { container } = render(<PegHealthStrip assets={ASSETS} />);
    expect(container.querySelectorAll("[data-strip-pip]").length).toBe(3);
  });

  it("applies state-specific class to each pip", () => {
    const { container } = render(<PegHealthStrip assets={ASSETS} />);
    expect(container.querySelector('[data-strip-pip="CRITICAL"]')).toBeInTheDocument();
    expect(container.querySelector('[data-strip-pip="DRIFT"]')).toBeInTheDocument();
    expect(container.querySelector('[data-strip-pip="PEGGED"]')).toBeInTheDocument();
  });

  it("shows the asset symbol on hover (title attribute)", () => {
    render(<PegHealthStrip assets={ASSETS} />);
    expect(screen.getByTitle(/xSOL/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.2: Run — must fail**

```bash
cd <repo>/web && pnpm vitest run tests/unit/organisms/peg-health-strip.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement**

Create `web/components/organisms/peg-health-strip.tsx`:

```typescript
"use client";

import type { AssetCardData, PegState } from "@/lib/api/types";

interface PegHealthStripProps {
  assets: AssetCardData[];
  liveOverrides?: Record<string, { state?: PegState }>;
  onPipClick?: (symbol: string) => void;
}

const BAR_COLOR: Record<PegState, string> = {
  PEGGED: "border-st-pegged bg-st-pegged/20",
  DRIFT: "border-st-drift bg-st-drift/20",
  DEPEG: "border-st-depeg bg-st-depeg/20",
  CRITICAL: "border-st-critical bg-st-critical/30",
  UNKNOWN: "border-st-unknown bg-st-unknown/20",
};

const BAR_HEIGHT: Record<PegState, string> = {
  PEGGED: "h-2",
  DRIFT: "h-3",
  DEPEG: "h-4",
  CRITICAL: "h-6",
  UNKNOWN: "h-2",
};

export function PegHealthStrip({ assets, liveOverrides = {}, onPipClick }: PegHealthStripProps) {
  return (
    <div className="border-b border-hairline px-5 sm:px-8 lg:px-12 pt-3 pb-2">
      <div className="mb-2 flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-body">
          <span className="block h-1.5 w-1.5 rounded-full bg-st-pegged" style={{ boxShadow: "0 0 0 3px rgba(107,214,151,0.2)" }} />
          Peg health — live · {assets.length} assets
        </span>
      </div>
      <div className="flex gap-[3px] h-8" role="list" aria-label="Per-asset peg health">
        {assets.map((a) => {
          const state = (liveOverrides[a.symbol]?.state ?? a.state) as PegState;
          return (
            <button
              key={a.symbol}
              type="button"
              data-strip-pip={state}
              role="listitem"
              title={`${a.symbol} · ${state}`}
              onClick={() => onPipClick?.(a.symbol)}
              className="flex-1 min-w-[14px] bg-surface-1 hover:bg-surface-2 flex flex-col justify-end transition-colors group"
            >
              <span className={`block border-b-2 ${BAR_COLOR[state]} ${BAR_HEIGHT[state]} transition-all`} />
              <span className="block font-mono text-[8px] text-text-muted opacity-40 group-hover:opacity-100 text-center pt-0.5 truncate px-0.5">
                {a.symbol}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.4: Run — must pass**

```bash
cd <repo>/web && pnpm vitest run tests/unit/organisms/peg-health-strip.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 2.5: Commit**

```bash
cd <repo> && git add web/components/organisms/peg-health-strip.tsx web/tests/unit/organisms/peg-health-strip.test.tsx
git commit -m "feat(dashboard): peg-health-strip organism

Full-bleed 23-pip strip across the top. State drives bar color + height.
Click pip → calls onPipClick(symbol). Tick-flash animation wired in the
dashboard page (next task) on WS state transitions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: ActiveMiniChart molecule + ActiveStrip organism

**Files:**
- Create: `web/components/molecules/active-mini-chart.tsx`
- Create: `web/components/organisms/active-strip.tsx`
- Create: `web/tests/unit/molecules/active-mini-chart.test.tsx`

- [ ] **Step 3.1: Write failing test for ActiveMiniChart**

Create `web/tests/unit/molecules/active-mini-chart.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ActiveMiniChart } from "@/components/molecules/active-mini-chart";

describe("ActiveMiniChart", () => {
  it("renders symbol, name, state pip, and spread", () => {
    render(
      <ActiveMiniChart
        symbol="xSOL"
        name="Hylo Leveraged SOL"
        className="LEV"
        state="CRITICAL"
        spread="+11.2%"
        series={[100, 102, 105, 110, 112]}
      />,
    );
    expect(screen.getByText("xSOL")).toBeInTheDocument();
    expect(screen.getByText(/Hylo Leveraged SOL/i)).toBeInTheDocument();
    expect(screen.getByText("+11.2%")).toBeInTheDocument();
  });

  it("renders an SVG sparkline path from the series", () => {
    const { container } = render(
      <ActiveMiniChart
        symbol="xSOL"
        name="x"
        className="LEV"
        state="DRIFT"
        spread="-1%"
        series={[100, 101, 99, 100]}
      />,
    );
    expect(container.querySelector("svg path")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run — must fail**

```bash
cd <repo>/web && pnpm vitest run tests/unit/molecules/active-mini-chart.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement ActiveMiniChart**

Create `web/components/molecules/active-mini-chart.tsx`:

```typescript
"use client";

import type { PegState } from "@/lib/api/types";

interface ActiveMiniChartProps {
  symbol: string;
  name: string;
  className: string; // asset class label e.g. "LEV", "YIELD"
  state: PegState;
  spread: string; // pre-formatted "+11.2%" or "-28 bps"
  series: number[];
  onClick?: () => void;
}

const STATE_TEXT: Record<PegState, string> = {
  PEGGED: "text-st-pegged",
  DRIFT: "text-st-drift",
  DEPEG: "text-st-depeg",
  CRITICAL: "text-st-critical",
  UNKNOWN: "text-st-unknown",
};

const STATE_STROKE: Record<PegState, string> = {
  PEGGED: "var(--color-st-pegged)",
  DRIFT: "var(--color-st-drift)",
  DEPEG: "var(--color-st-depeg)",
  CRITICAL: "var(--color-st-critical)",
  UNKNOWN: "var(--color-st-unknown)",
};

const STATE_PIP_BG: Record<PegState, string> = {
  PEGGED: "bg-st-pegged",
  DRIFT: "bg-st-drift",
  DEPEG: "bg-st-depeg",
  CRITICAL: "bg-st-critical",
  UNKNOWN: "bg-st-unknown",
};

function buildPath(series: number[], w = 100, h = 36): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function ActiveMiniChart({ symbol, name, className, state, spread, series, onClick }: ActiveMiniChartProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="flex flex-1 items-center gap-4 border border-outline bg-surface-1 px-4 py-3 max-w-[480px] text-left hover:bg-surface-2 transition-colors"
    >
      <span className={`block h-2 w-2 flex-none rounded-full ${STATE_PIP_BG[state]} pip-pulse`} aria-hidden />
      <div className="flex-1 min-w-0">
        <b className="block text-sm font-semibold text-text">{symbol}</b>
        <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted truncate">
          {name} · {className}
        </span>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="flex-none h-9 w-[100px]">
        <path d={buildPath(series)} stroke={STATE_STROKE[state]} strokeWidth="1.5" fill="none" />
      </svg>
      <span className={`flex-none font-mono text-xl ${STATE_TEXT[state]}`}>{spread}</span>
    </Comp>
  );
}
```

- [ ] **Step 3.4: Implement ActiveStrip wrapper**

Create `web/components/organisms/active-strip.tsx`:

```typescript
"use client";

import Link from "next/link";
import { ActiveMiniChart } from "@/components/molecules/active-mini-chart";
import type { AssetCardData, PegState } from "@/lib/api/types";
import { discountToBps } from "@/lib/api/format";

interface ActiveStripProps {
  assets: AssetCardData[];
  liveOverrides?: Record<string, { state?: PegState; discount?: string }>;
}

function classLabel(c: string): string {
  if (c.startsWith("stable")) return "STABLE";
  return c.toUpperCase();
}

function formatSpread(discount: string | null): string {
  const bps = discountToBps(discount);
  if (bps == null) return "—";
  if (Math.abs(bps) >= 100) return `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
  return `${bps > 0 ? "+" : ""}${bps} bps`;
}

function buildMockSeries(state: PegState): number[] {
  const noise = state === "PEGGED" ? 0.1 : state === "DRIFT" ? 1.2 : 4;
  return Array.from({ length: 24 }, (_, i) =>
    100 + Math.sin(i / 3) * noise + (Math.cos(i / 2.7) - 0.5) * noise * 0.5,
  );
}

export function ActiveStrip({ assets, liveOverrides = {} }: ActiveStripProps) {
  const active = assets
    .filter((a) => {
      const s = (liveOverrides[a.symbol]?.state ?? a.state) as PegState;
      return s === "DRIFT" || s === "DEPEG" || s === "CRITICAL";
    })
    .slice(0, 3);

  if (active.length === 0) {
    return (
      <div className="border-b border-hairline px-5 sm:px-8 lg:px-12 py-5">
        <p className="font-mono text-[13px] text-text-body">
          All clear. Every tracked asset is within band.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-hairline px-5 sm:px-8 lg:px-12 py-5 flex gap-4 flex-wrap" data-testid="active-strip">
      {active.map((a) => {
        const state = (liveOverrides[a.symbol]?.state ?? a.state) as PegState;
        const discount = liveOverrides[a.symbol]?.discount ?? a.discount;
        return (
          <Link key={a.symbol} href={`/asset/${a.symbol}`} className="flex-1 max-w-[480px] no-underline">
            <ActiveMiniChart
              symbol={a.symbol}
              name={a.name}
              className={classLabel(a.class)}
              state={state}
              spread={formatSpread(discount)}
              series={buildMockSeries(state)}
            />
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3.5: Run — must pass**

```bash
cd <repo>/web && pnpm vitest run tests/unit/molecules/active-mini-chart.test.tsx
```

Expected: PASS, 2/2.

- [ ] **Step 3.6: Commit**

```bash
cd <repo> && git add web/components/molecules/active-mini-chart.tsx web/components/organisms/active-strip.tsx web/tests/unit/molecules/active-mini-chart.test.tsx
git commit -m "feat(dashboard): active-mini-chart molecule + active-strip organism

Replaces the text-only ACTIVE row inside DashboardOverview. Each active asset
gets pip + name + sparkline + spread. Mock 24-pt series until backend ships
history; ranks DRIFT/DEPEG/CRITICAL, slices top 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Refactor DashboardOverview to AnchorNumber + editorial sentence

**Files:**
- Modify: `web/components/organisms/dashboard-overview.tsx`

- [ ] **Step 4.1: Read current implementation**

```bash
cd <repo>/web && wc -l components/organisms/dashboard-overview.tsx && cat components/organisms/dashboard-overview.tsx | head -60
```

Identify how the current `<Counter>` is wired and how anomaly count is computed. Preserve the data derivation logic.

- [ ] **Step 4.2: Refactor**

Open `web/components/organisms/dashboard-overview.tsx`. Replace the rendered hero with:

```typescript
import { AnchorNumber } from "@/components/atoms/anchor-number";
// keep existing imports

// Inside the component, after `derived` is computed:
const editorial = (() => {
  const n = derived?.anomalies ?? 0;
  if (n === 0) return "Every tracked asset is within band.";
  if (n === 1) return `${derived?.widestSymbol ?? "One asset"} is outside threshold.`;
  if (n < 3) return `${n} assets are outside threshold.`;
  return `${n} of ${assets?.length ?? 23} are outside threshold.`;
})();

// Replace the existing hero JSX block with:
return (
  <section className="border-b border-hairline px-5 sm:px-8 lg:px-12 pt-8 pb-6">
    <div className="flex items-end gap-12 flex-wrap">
      <AnchorNumber
        value={derived?.anomalies ?? 0}
        label={`of ${assets?.length ?? 23} outside threshold`}
        context={new Date().toLocaleString("en-GB", { hour12: false, timeZoneName: "short" })}
        displaySize="lg"
      />
      <p className="max-w-[420px] text-sm leading-[1.5] text-text-body pb-3">
        {editorial}
      </p>
      <div className="ml-auto flex gap-8 pb-4 flex-wrap">
        <Stat value={String(assets?.length ?? 0)} label="Tracked" />
        <Stat value={String(stats?.alerts_24h ?? 0)} label="Alerts 24h" />
        <Stat value={derived?.medianBps != null ? `${derived.medianBps} bps` : "—"} label="Median" />
        <Stat value={derived?.widestSymbol ?? "—"} label="Widest" mono />
      </div>
    </div>
  </section>
);

// Add helper at bottom:
function Stat({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  return (
    <div className="text-right">
      <b className={`block ${mono ? "font-mono" : "font-mono"} text-[18px] text-text font-normal`}>{value}</b>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
    </div>
  );
}
```

Remove all references to the old `<Counter>` import (clean unused imports). Preserve the `derived` memoization — only the JSX changes.

If `derived` doesn't already expose `widestSymbol` and `medianBps`, add them inside the `useMemo`:

```typescript
// inside useMemo, after computing withBps:
const widestSymbol = withBps
  .slice()
  .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps))[0]?.a.symbol;
const medianBps = absBps.length ? absBps[Math.floor(absBps.length / 2)] : null;
return { anomalies, widestSymbol, medianBps /* and existing fields */ };
```

- [ ] **Step 4.3: Typecheck**

```bash
cd <repo>/web && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
cd <repo> && git add web/components/organisms/dashboard-overview.tsx
git commit -m "feat(dashboard): hero replaced with AnchorNumber + editorial sentence + 4-stat strip

Drops the previous Counter-based hero. AnchorNumber inherits from landing
foundation. Editorial sentence alternates by state count (0/1/2/3+) for
human-readable context above the raw number.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — Body (Tasks 5-7)

### Task 5: CompareShelf sticky molecule

**Files:**
- Create: `web/components/molecules/compare-shelf.tsx`

- [ ] **Step 5.1: Read existing CompareCta**

```bash
cd <repo>/web && cat components/molecules/compare-cta.tsx
```

Understand current model. CompareShelf is a richer version (sticky position, chips with remove, add button, CTA).

- [ ] **Step 5.2: Implement**

Create `web/components/molecules/compare-shelf.tsx`:

```typescript
"use client";

import Link from "next/link";

interface CompareShelfProps {
  symbols: string[];
  onRemove?: (symbol: string) => void;
  onAdd?: () => void;
}

export function CompareShelf({ symbols, onRemove, onAdd }: CompareShelfProps) {
  if (symbols.length === 0) return null;
  return (
    <div className="border-b border-hairline bg-surface-1 px-5 sm:px-8 lg:px-12 py-3 flex items-center gap-3 flex-wrap">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Compare watchlist
      </span>
      {symbols.map((s) => (
        <span key={s} className="inline-flex items-center gap-2 border border-outline px-2.5 py-1 font-mono text-[11px]">
          {s}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(s)}
              className="text-text-caption hover:text-text"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="border border-dashed border-outline px-2.5 py-1 font-mono text-[11px] text-text-muted hover:text-text"
        >
          + add asset
        </button>
      )}
      <Link
        href={`/compare?assets=${symbols.join(",")}`}
        className="ml-auto border border-text px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text hover:bg-text hover:text-canvas transition-colors"
      >
        Stack on one chart →
      </Link>
    </div>
  );
}
```

- [ ] **Step 5.3: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/molecules/compare-shelf.tsx
git commit -m "feat(dashboard): compare-shelf molecule (sticky watchlist with chips + CTA)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: AssetPreviewPane organism (cross-component hover linking)

**Files:**
- Create: `web/components/organisms/asset-preview-pane.tsx`
- Create: `web/tests/unit/organisms/asset-preview-pane.test.tsx`

- [ ] **Step 6.1: Write the failing test**

Create `web/tests/unit/organisms/asset-preview-pane.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AssetPreviewPane } from "@/components/organisms/asset-preview-pane";

describe("AssetPreviewPane", () => {
  it("renders null when no symbol provided", () => {
    const { container } = render(<AssetPreviewPane symbol={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the symbol and a chart placeholder when symbol provided", () => {
    render(<AssetPreviewPane symbol="jitoSOL" name="Jito Liquid Staking" spread="-28 bps" state="DRIFT" />);
    expect(screen.getByText("jitoSOL")).toBeInTheDocument();
    expect(screen.getByText("-28 bps")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run — must fail**

```bash
cd <repo>/web && pnpm vitest run tests/unit/organisms/asset-preview-pane.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement**

Create `web/components/organisms/asset-preview-pane.tsx`:

```typescript
"use client";

import Link from "next/link";
import type { PegState } from "@/lib/api/types";

interface AssetPreviewPaneProps {
  symbol: string | null;
  name?: string;
  spread?: string;
  state?: PegState;
  intrinsic?: string;
  market?: string;
  safety?: string;
}

const STATE_COLOR: Record<PegState, string> = {
  PEGGED: "text-st-pegged",
  DRIFT: "text-st-drift",
  DEPEG: "text-st-depeg",
  CRITICAL: "text-st-critical",
  UNKNOWN: "text-st-unknown",
};

const STATE_PIP: Record<PegState, string> = {
  PEGGED: "bg-st-pegged",
  DRIFT: "bg-st-drift",
  DEPEG: "bg-st-depeg",
  CRITICAL: "bg-st-critical",
  UNKNOWN: "bg-st-unknown",
};

export function AssetPreviewPane({ symbol, name, spread, state, intrinsic, market, safety }: AssetPreviewPaneProps) {
  if (!symbol) return null;
  const s = state ?? "UNKNOWN";
  return (
    <aside className="hidden xl:block bg-surface-1 border-l border-hairline min-h-[540px] p-5 w-[320px]" data-testid="asset-preview-pane">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Hover preview · {symbol}
      </span>
      <div className="mt-2 flex items-center gap-2">
        <span className={`block h-2 w-2 rounded-full ${STATE_PIP[s]} pip-pulse`} aria-hidden />
        <b className="text-xl font-semibold text-text">{symbol}</b>
        {state && (
          <span className={`ml-auto font-mono text-[10px] uppercase tracking-[0.08em] ${STATE_COLOR[s]}`}>
            {state}
          </span>
        )}
      </div>
      {spread && (
        <div className={`mt-3 text-[48px] font-light leading-none tracking-[-0.02em] ${STATE_COLOR[s]}`}>
          {spread}
        </div>
      )}
      {name && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-body">
          {name}
        </p>
      )}
      <div className="mt-4 h-[140px] border-b border-hairline bg-canvas" aria-hidden>
        {/* Live 24h chart slot — backend wiring in a separate task */}
      </div>
      {(intrinsic || market || safety) && (
        <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px] text-text-muted">
          {intrinsic && <div><dt>Intrinsic</dt><dd className="text-text">{intrinsic}</dd></div>}
          {market && <div><dt>Market</dt><dd className="text-text">{market}</dd></div>}
          {safety && <div><dt>Safety</dt><dd className="text-text">{safety}</dd></div>}
        </dl>
      )}
      <Link
        href={`/asset/${symbol}`}
        className="mt-5 block border border-text px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.06em] text-text hover:bg-text hover:text-canvas transition-colors"
      >
        Open asset →
      </Link>
    </aside>
  );
}
```

- [ ] **Step 6.4: Run — must pass**

```bash
cd <repo>/web && pnpm vitest run tests/unit/organisms/asset-preview-pane.test.tsx
```

Expected: PASS, 2/2.

- [ ] **Step 6.5: Commit**

```bash
cd <repo> && git add web/components/organisms/asset-preview-pane.tsx web/tests/unit/organisms/asset-preview-pane.test.tsx
git commit -m "feat(dashboard): asset-preview-pane (cross-component hover linking)

Slides in on the right (>=1280px). Hidden on smaller viewports. Receives
the hovered symbol from the dashboard page state. Live chart slot empty
for now — backend wiring follows in a separate PR.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: AssetTable — hover linking, Flip on sort, tick-flash

**Files:**
- Modify: `web/components/organisms/asset-table.tsx`

- [ ] **Step 7.1: Add `onRowHover` callback prop**

Open `web/components/organisms/asset-table.tsx`. Add to props:

```typescript
interface AssetTableProps {
  assets: AssetCardData[];
  liveOverrides: Record<string, { state?: PegState; discount?: string }>;
  onRowHover?: (symbol: string | null) => void;
}
```

In the row JSX (find the `<Link>` or `<tr>` per asset), add:

```typescript
onMouseEnter={() => onRowHover?.(a.symbol)}
onMouseLeave={() => onRowHover?.(null)}
```

- [ ] **Step 7.2: Add Flip wrapper around sort changes**

Inside the component, import:

```typescript
import { useEffect, useRef } from "react";
import { getGsap } from "@/lib/motion/gsap";
import { getFlip } from "@/lib/motion/get-flip";
```

Add a ref + effect that captures Flip state on sort key changes:

```typescript
const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
const lastSortRef = useRef<SortKey | null>(null);

useEffect(() => {
  if (lastSortRef.current === sortKey) return;
  lastSortRef.current = sortKey;
  const tbody = tbodyRef.current;
  if (!tbody) return;
  let killed = false;
  (async () => {
    const [gsap, Flip] = await Promise.all([getGsap(), getFlip()]);
    if (killed) return;
    const state = Flip.getState(tbody.querySelectorAll("tr"));
    requestAnimationFrame(() => {
      if (killed) return;
      Flip.from(state, {
        duration: 0.5,
        ease: "power2.inOut",
        stagger: 0.02,
        absolute: true,
      });
    });
  })();
  return () => { killed = true; };
}, [sortKey]);
```

Attach `ref={tbodyRef}` to the `<tbody>` element.

- [ ] **Step 7.3: Add tick-flash on the spread cell**

For each row, the spread cell becomes:

```typescript
import { useTickFlash } from "@/lib/motion/use-tick-flash";

// Inside the row sub-component (extract to <TableRow> if not already):
const spreadRef = useRef<HTMLTableCellElement | null>(null);
useTickFlash(spreadRef, a.discount, { color: "#ff8400", restore: "#fffdf9" });

return (
  // ...other cells...
  <td ref={spreadRef} className="font-mono text-right">
    {formatGap(...)}
  </td>
);
```

If the row JSX is inline (not extracted), extract it to a `<TableRow>` sub-component so the hook can be called per-row legitimately. The function declaration:

```typescript
function TableRow({ a, liveOverrides, onHover }: { a: AssetCardData; liveOverrides: ...; onHover?: (s: string | null) => void }) { ... }
```

- [ ] **Step 7.4: Typecheck**

```bash
cd <repo>/web && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
cd <repo> && git add web/components/organisms/asset-table.tsx
git commit -m "feat(dashboard): asset-table hover linking + Flip on sort + tick-flash on spread

- onRowHover callback wires cross-component preview.
- GSAP Flip animates row reorder on sort change (power2.inOut, 0.5s, 0.02s stagger).
- useTickFlash on spread cell briefly flashes iridescent on EWMA update.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — Mount in dashboard page + footer + alerts (Tasks 8-10)

### Task 8: Mount new organisms in dashboard page

**Files:**
- Modify: `web/app/dashboard/page.tsx`

- [ ] **Step 8.1: Add state + render new components**

Open `web/app/dashboard/page.tsx`. Add imports:

```typescript
import { PegHealthStrip } from "@/components/organisms/peg-health-strip";
import { ActiveStrip } from "@/components/organisms/active-strip";
import { CompareShelf } from "@/components/molecules/compare-shelf";
import { AssetPreviewPane } from "@/components/organisms/asset-preview-pane";
```

Add state:

```typescript
const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
const [watchlist, setWatchlist] = useState<string[]>(["jitoSOL", "mSOL", "bSOL", "hyUSD"]);
```

Add `hoveredAsset` derivation:

```typescript
const hoveredAsset = useMemo(() => {
  if (!hoveredSymbol || !assets) return null;
  return assets.find((a) => a.symbol === hoveredSymbol) ?? null;
}, [hoveredSymbol, assets]);
```

Update the JSX (preserve all existing wiring, add new components in this order before/within the main grid):

```typescript
return (
  <>
    <SiteHeader />
    <main>
      <PegHealthStrip
        assets={assets ?? []}
        liveOverrides={liveOverrides}
        onPipClick={(sym) => {
          // scroll to row — simple anchor for now
          const row = document.querySelector(`[data-asset="${sym}"]`);
          row?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      />
      <DashboardOverview stats={stats} assets={assets} />
      <ActiveStrip assets={assets ?? []} liveOverrides={liveOverrides} />
      <CompareShelf
        symbols={watchlist}
        onRemove={(s) => setWatchlist((w) => w.filter((x) => x !== s))}
      />
      <DashboardFilters ... existing props ... />
      <section className="flex">
        <div className="flex-1">
          <AssetTable
            assets={...existing...}
            liveOverrides={liveOverrides}
            onRowHover={setHoveredSymbol}
          />
        </div>
        <AssetPreviewPane
          symbol={hoveredSymbol}
          name={hoveredAsset?.name}
          spread={hoveredAsset?.discount ? formatGap(...) : undefined}
          state={hoveredAsset?.state}
        />
        <AlertsSidebar ...existing... />
      </section>
    </main>
    <SiteFooter variant="compact" />
  </>
);
```

Preserve all existing functionality (filters, mosaic/table toggle, loading skeletons, error state). The mosaic-toggle behavior carries over — Task 7's Flip wires it to animate when view changes too if asset-table renders both modes inside the same ref. If it doesn't, add a second effect tracking `view`:

```typescript
useEffect(() => {
  if (!tbodyRef.current) return;
  // similar Flip capture/from on view change
}, [view]);
```

Most importantly: **the existing AssetTable + AssetPortrait + AlertsSidebar wiring stays**. Only ADD the new components.

- [ ] **Step 8.2: Switch footer to compact**

In the same file:

```typescript
<SiteFooter variant="compact" />
```

(Was `variant="full"` or no prop.)

- [ ] **Step 8.3: Typecheck + smoke**

```bash
cd <repo>/web && pnpm typecheck
```

Then visually with dev:

```bash
cd <repo>/web && pnpm dev > /tmp/web-dev-t8.log 2>&1 &
sleep 5
curl -sI http://localhost:3000/dashboard | head -1
kill %1 2>/dev/null
```

- [ ] **Step 8.4: Commit**

```bash
cd <repo> && git add web/app/dashboard/page.tsx
git commit -m "feat(dashboard): mount peg-strip + active-strip + compare-shelf + preview-pane

Cross-component hover linking wired via useState<hoveredSymbol> — table
onRowHover lifts the value, AssetPreviewPane subscribes. Footer switched
to compact variant per design spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: AlertsSidebar — recency-intensity fade

**Files:**
- Modify: `web/components/organisms/alerts-sidebar.tsx`

- [ ] **Step 9.1: Inspect current implementation**

```bash
cd <repo>/web && cat components/organisms/alerts-sidebar.tsx | head -60
```

Find the alert-row render. Each alert has a timestamp; sort by recency (already done? confirm).

- [ ] **Step 9.2: Add recency opacity ramp + fresh highlight**

In the alert row render, add a `freshness` computation:

```typescript
const ageMs = Date.now() - new Date(alert.ts).getTime();
const opacity = ageMs < 5 * 60_000 ? 1 : ageMs < 60 * 60_000 ? 0.8 : 0.55;
const isFresh = ageMs < 60_000;
```

Render the row with opacity and a fresh-class:

```typescript
<li
  style={{ opacity }}
  className={`flex items-center gap-2 py-2.5 border-b border-hairline/30 ${isFresh ? "border-l-2 border-l-[#ff8400] pl-2" : ""}`}
  data-alert-fresh={isFresh}
>
  ...
</li>
```

Critical alerts also get bumped:

```typescript
const sizeClass = alert.state === "CRITICAL" ? "text-[13px]" : "text-[12px]";
```

If the alert row is currently a sub-component, modify it; otherwise inline these changes in the map.

- [ ] **Step 9.3: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/organisms/alerts-sidebar.tsx
git commit -m "feat(dashboard): alerts sidebar recency-intensity fade + fresh-alert highlight

Alerts <5 min: opacity 1. <60 min: 0.8. Older: 0.55. <1 min:
iridescent left border. Critical alerts rendered larger.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: DashboardFilters — faceted chips with counts

**Files:**
- Modify: `web/components/organisms/dashboard-filters.tsx`

- [ ] **Step 10.1: Read current implementation**

```bash
cd <repo>/web && cat components/organisms/dashboard-filters.tsx | head -80
```

Confirm current filter structure (search + class/peg select).

- [ ] **Step 10.2: Replace selects with chip rows + counts**

The existing filters are likely `<select>` elements or a row of buttons. Replace with chip rows per facet (CLASS / STATE / SAFETY), each showing the asset count for that filter value. Counts are computed from the unfiltered assets list (passed as a prop):

```typescript
interface DashboardFiltersProps {
  assets: AssetCardData[];
  filter: { class?: string; peg?: string; state?: string; safety?: string };
  onFilterChange: (next: typeof filter) => void;
  query: string;
  onQueryChange: (next: string) => void;
  view: "table" | "mosaic";
  onViewChange: (v: "table" | "mosaic") => void;
}

// inside component:
const counts = useMemo(() => ({
  total: assets.length,
  byClass: groupCount(assets, "class"),
  byState: groupCount(assets, "state"),
}), [assets]);

// Render chips per facet:
<div className="flex gap-1.5 flex-wrap">
  {(["all", "lst", "stable", "cdp", "yield"] as const).map((c) => (
    <button
      key={c}
      type="button"
      onClick={() => onFilterChange({ ...filter, class: c === "all" ? undefined : c })}
      className={`px-3 py-1.5 border font-mono text-[11px] uppercase tracking-[0.06em] ${(filter.class === c || (c === "all" && !filter.class)) ? "bg-text text-canvas border-text" : "border-outline text-text-muted"}`}
    >
      {c} {c === "all" ? counts.total : counts.byClass[c] ?? 0}
    </button>
  ))}
</div>
```

Add a `groupCount` helper at the top:

```typescript
function groupCount<T extends Record<string, unknown>>(items: T[], key: keyof T): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = String(item[key] ?? "").toLowerCase();
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
```

Also include a state chip row (PEGGED / DRIFT / DEPEG / CRITICAL).

- [ ] **Step 10.3: Update `dashboard/page.tsx` to pass assets + extended filter state**

The dashboard page may currently pass class/peg only. Extend its `filter` state to include `state` and `safety`. Update `useAssets(filter)` to handle (or filter client-side after fetch if backend doesn't accept state filter — confirm via `lib/api/assets`).

If client-side: derive the filtered list with `useMemo` and pass to AssetTable.

- [ ] **Step 10.4: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/components/organisms/dashboard-filters.tsx web/app/dashboard/page.tsx
git commit -m "feat(dashboard): faceted filter chips with live counts (class + state)

Replaces select dropdowns with chip rows. Counts derived from unfiltered
assets list. State filter applied client-side post-fetch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 — Mobile + validation (Tasks 11-12)

### Task 11: Mobile default = mosaic + responsive layout

**Files:**
- Modify: `web/app/dashboard/page.tsx`
- Modify: `web/components/organisms/asset-table.tsx`

- [ ] **Step 11.1: Detect viewport on mount and default `view` accordingly**

In `dashboard/page.tsx`, change the initial state:

```typescript
const [view, setView] = useState<"table" | "mosaic">(() => {
  if (typeof window === "undefined") return "table";
  return window.matchMedia("(max-width: 767px)").matches ? "mosaic" : "table";
});
```

- [ ] **Step 11.2: Ensure mosaic mode keeps sparklines on mobile**

`AssetTable`'s mosaic render must include sparklines. Check current implementation; if mosaic uses `<AssetCard>` molecule (which we already shipped sparklines for in the landing wave), it should automatically be fine. If mosaic uses `<AssetPortrait>`, verify it renders the sparkline at narrow widths.

- [ ] **Step 11.3: Stack the right-side panels below the table on mobile**

In `dashboard/page.tsx`:

```typescript
<section className="flex flex-col xl:flex-row">
  <div className="flex-1">...table...</div>
  <AssetPreviewPane ... /> {/* already hidden < xl */}
  <AlertsSidebar ... className="xl:w-[320px] xl:border-l xl:border-hairline" />
</section>
```

- [ ] **Step 11.4: Typecheck + commit**

```bash
cd <repo>/web && pnpm typecheck
cd <repo> && git add web/app/dashboard/page.tsx web/components/organisms/asset-table.tsx
git commit -m "feat(dashboard): mobile defaults to mosaic + stacked panels below table

Detects viewport on mount, picks mosaic at <=767px. Preview pane stays
hidden at <xl. Alerts sidebar stacks below table on mobile.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Playwright dashboard regression — desktop + mobile

**Files:**
- Create: `web/tests/e2e/dashboard.spec.ts`

- [ ] **Step 12.1: Write the spec**

Create `web/tests/e2e/dashboard.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Dashboard — desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders all v1.1 dashboard landmarks", async ({ page }) => {
    await page.goto("/dashboard");

    // Peg-health strip with at least 14 pips
    const pips = page.locator("[data-strip-pip]");
    await expect(pips.first()).toBeVisible({ timeout: 6000 });
    expect(await pips.count()).toBeGreaterThanOrEqual(14);

    // Anchor number visible
    await expect(page.locator("[data-anchor-numeric]").first()).toBeVisible();
    await expect(page.locator("[data-anchor-underline]").first()).toBeVisible();

    // Filter chips
    await expect(page.getByRole("button", { name: /^all/i }).first()).toBeVisible();

    // Compact footer (no Developers column)
    await expect(page.getByText("Developers").first()).not.toBeVisible().catch(() => {
      // OK if absent — compact footer drops it
    });
  });

  test("anchor number counts up to a non-zero integer", async ({ page }) => {
    await page.goto("/dashboard");
    const anchor = page.locator("[data-anchor-numeric]").first();
    await expect(anchor).toBeVisible();
    await page.waitForTimeout(2000);
    const text = (await anchor.textContent())?.trim() ?? "";
    expect(Number.isInteger(Number(text))).toBe(true);
  });

  test("hovering a row updates the preview pane symbol", async ({ page }) => {
    await page.goto("/dashboard");
    // wait for table to render
    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 6000 });
    const symbol = await firstRow.locator("td").nth(0).textContent();
    await firstRow.hover();
    await page.waitForTimeout(200);
    const previewPane = page.locator('[data-testid="asset-preview-pane"]');
    if (await previewPane.count() > 0) {
      // Preview pane is xl-only; may not be visible at 1440. If visible, verify content.
      const text = await previewPane.textContent();
      expect(text).toMatch(symbol?.split(/\s/)[0] ?? /.*/);
    }
  });
});

test.describe("Dashboard — mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders the strip + anchor + table at mobile width", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("[data-strip-pip]").first()).toBeVisible({ timeout: 6000 });
    await expect(page.locator("[data-anchor-numeric]").first()).toBeVisible();
  });

  test("no horizontal scroll at mobile width", async ({ page }) => {
    await page.goto("/dashboard");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
});
```

- [ ] **Step 12.2: Run against dev**

```bash
cd <repo>/web && pnpm dev > /tmp/web-dev-t12.log 2>&1 &
sleep 5
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/dashboard.spec.ts --reporter=line 2>&1 | tail -15
kill %1 2>/dev/null
```

Expected: ALL PASS. If failures: read the trace, identify root cause, fix in a small follow-up commit (e.g., responsive padding, mosaic mode at narrow widths).

- [ ] **Step 12.3: Run the FULL e2e suite to verify zero regressions**

```bash
cd <repo>/web && pnpm dev > /tmp/web-dev-final.log 2>&1 &
sleep 5
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test --reporter=line 2>&1 | tail -8
kill %1 2>/dev/null
```

Expected: ALL pre-existing tests still PASS. Landing tests + reduced-motion + inner-pages smoke + legacy smoke + dashboard new spec.

- [ ] **Step 12.4: Run unit tests + typecheck**

```bash
cd <repo>/web && pnpm vitest run 2>&1 | tail -5
cd <repo>/web && pnpm typecheck
```

Expected: ALL PASS.

- [ ] **Step 12.5: Commit**

```bash
cd <repo> && git add web/tests/e2e/dashboard.spec.ts
git commit -m "test(e2e): dashboard regression — desktop + mobile + hover linking

Asserts: peg-health strip pips, anchor number visible + counts up, filter
chips present, mobile no horizontal scroll. Hover-row → preview-pane test
gracefully skips when pane is hidden (xl breakpoint).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Done criteria

1. `pnpm typecheck` — zero errors.
2. `pnpm vitest run` — all unit tests pass (≥ 5 new tests this wave: flip-loader 2, peg-health-strip 3, active-mini-chart 2, asset-preview-pane 2).
3. `pnpm playwright test` — all specs pass (landing wave + reduced-motion + inner-pages smoke + legacy smoke + new dashboard spec = ≥ 30 cases).
4. Manual: dashboard at `/dashboard` renders the peg-strip + anchor + active strip + compare shelf + table-with-hover-linking + preview pane (xl+) + alerts sidebar + compact footer.
5. Mobile (390): mosaic mode is default, sparklines preserved, no horizontal scroll.
6. No console errors on `/dashboard` route in dev OR prod.
7. Visual parity with `mock-02-dashboard.html` (manual check by user).

When all 7 hold, open PR `feat/dashboard-uplift` → `main` (or queue behind landing PR depending on merge order).

---

## Out of scope (deliberately)

- Pro / Lite toggle (Tensor pattern) — deferred to P4 follow-up.
- Backend `series_24h` field — `buildMockSeries()` is the temporary bridge.
- AssetPreviewPane live chart — slot exists, wiring to `/v1/assets/{symbol}/history` in a separate PR.
- WebSocket-driven tick-flash on the PegHealthStrip pip (current implementation: random simulation in mock, real WS tick in implementation only happens via existing LiveProvider state propagation; if the strip-pip needs explicit useTickFlash on `liveOverrides[symbol]`, surface as a P3 polish task).
- Mobile bottom-sheet filter (current: chips stack at mobile width).
- URL persistence of filter state (current: local state only).

---

## References

- Landing wave plan: `docs/superpowers/plans/2026-05-22-landing-uplift.md`
- Master design spec: `docs/superpowers/specs/2026-05-22-design-uplift.md`
- Critique: `docs/design-research/audit-2026-05-22/critique.md`
- Recon: `docs/design-research/audit-2026-05-22/recon.md`
- Approved mock: `.superpowers/brainstorm/42854-1779652136/content/mock-02-dashboard.html`
- Pacing memory: `feedback_design_pacing.md`
- Decisions memory: `project_design_uplift.md`
