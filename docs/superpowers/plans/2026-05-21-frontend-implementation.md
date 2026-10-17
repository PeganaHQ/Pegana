# Pegana Frontend v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three public surfaces of Pegana (landing, dashboard, asset-detail) per `docs/superpowers/specs/2026-05-21-frontend-design.md`, deployable to Vercel, consuming the existing Rust API at `crates/api-rs`.

**Architecture:** Next.js 16 App Router (React 19, Server Components by default, Client Components for live data and interactive layers). Tailwind v4 with CSS variable tokens. shadcn/ui used sparingly (Tooltip, DropdownMenu, Dialog). Live data via native WebSocket → small in-memory store → React context. SWR for non-realtime fetches. Framer Motion for orchestrated entrance animations. Recharts for the asset history chart.

**Tech Stack:** Next.js 16 · React 19 · TypeScript 5.4+ · Tailwind v4 · shadcn/ui · Framer Motion · Recharts · SWR · Vitest + Testing Library · Playwright (e2e) · pnpm

---

## File Structure (locked in before tasks)

```
web/                                              # new top-level dir, parallel to crates/ and bot-ts/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── components.json                               # shadcn config
├── .env.local.example
├── public/
│   └── favicon.svg                               # gradient square favicon
├── app/
│   ├── layout.tsx                                # root layout: fonts, background layers, providers
│   ├── globals.css                               # Tailwind directives + tokens + reset
│   ├── page.tsx                                  # landing — composes 7 sections
│   ├── dashboard/
│   │   └── page.tsx                              # live grid + alerts sidebar
│   ├── asset/
│   │   └── [symbol]/
│   │       └── page.tsx                          # detail: header + chart + alerts + spec
│   └── api/
│       └── ws/route.ts                           # OPTIONAL proxy to backend WS — only if CORS blocks
├── components/
│   ├── atoms/                                    # 6 files, one component each
│   │   ├── brand-mark.tsx
│   │   ├── pill.tsx
│   │   ├── state-pip.tsx
│   │   ├── counter.tsx
│   │   ├── sparkline.tsx
│   │   └── marquee.tsx
│   ├── molecules/                                # 10 files
│   │   ├── asset-card.tsx                        # 3 variants: floating | row | detail
│   │   ├── asset-portrait.tsx
│   │   ├── alert-item.tsx
│   │   ├── accordion-row.tsx
│   │   ├── stat-panel.tsx
│   │   ├── announcement-pill.tsx
│   │   ├── telegram-bubble.tsx
│   │   ├── social-icon.tsx
│   │   ├── mouse-spotlight.tsx
│   │   └── dot-grid.tsx
│   └── organisms/                                # 9 files
│       ├── site-header.tsx
│       ├── site-footer.tsx
│       ├── hero-landing.tsx
│       ├── logo-marquee.tsx
│       ├── methodology-accordion.tsx
│       ├── universe-grid.tsx
│       ├── pinged-cta.tsx
│       ├── asset-chart.tsx
│       └── asset-spec.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts                             # typed fetch wrappers
│   │   ├── types.ts                              # TS types mirroring crates/common
│   │   ├── ws.ts                                 # WebSocket client with backoff
│   │   └── format.ts                             # bps, decimal, USD formatters
│   ├── hooks/
│   │   ├── use-stats.ts
│   │   ├── use-assets.ts
│   │   ├── use-asset.ts
│   │   ├── use-history.ts
│   │   ├── use-alerts.ts
│   │   ├── use-live-store.ts                     # WS-backed map of asset → latest
│   │   └── use-spotlight.ts                      # mouse coord tracking
│   ├── store/
│   │   └── live-context.tsx                      # React context + provider
│   └── utils/
│       ├── cn.ts                                 # className merge
│       ├── motion.ts                             # framer-motion variant presets
│       └── reduced-motion.ts                     # prefers-reduced-motion hook
└── tests/
    ├── unit/                                     # vitest + RTL
    │   ├── atoms/
    │   │   ├── counter.test.tsx
    │   │   └── sparkline.test.tsx
    │   ├── molecules/
    │   │   └── asset-card.test.tsx
    │   ├── hooks/
    │   │   ├── use-stats.test.ts
    │   │   └── use-live-store.test.ts
    │   ├── lib/
    │   │   ├── format.test.ts
    │   │   └── ws.test.ts
    │   └── fixtures/
    │       ├── assets.json                       # canned API responses for tests
    │       └── ws-messages.json
    └── e2e/                                      # playwright
        ├── landing.spec.ts
        ├── dashboard-live.spec.ts
        └── asset-detail.spec.ts
```

**Responsibility map:**

- `components/atoms/` — pure visual, no data dependencies, no API calls
- `components/molecules/` — composed of atoms, may take live data as props but never fetch
- `components/organisms/` — page sections, may fetch (server components) or consume live store (client components)
- `app/` — composition only, minimal logic
- `lib/api/` — every network call goes through here (REST and WS)
- `lib/hooks/` — React-flavored access to lib/api with SWR/context
- `lib/store/` — single source of truth for live state pushed via WS
- `lib/utils/` — pure functions only, fully testable in isolation

---

## Build phases (gates the task ordering)

| Phase | Title | Tasks |
|-------|-------|-------|
| 1 | Foundation | 1.1 – 1.6 |
| 2 | Atoms | 2.1 – 2.6 |
| 3 | Background layers | 3.1 – 3.2 |
| 4 | Site chrome (header + footer) | 4.1 – 4.3 |
| 5 | Hero | 5.1 – 5.4 |
| 6 | Marquee | 6.1 |
| 7 | (01) Methodology | 7.1 – 7.2 |
| 8 | (02) Universe | 8.1 – 8.2 |
| 9 | (03) CTA + Wordmark + Landing | 9.1 – 9.4 |
| 10 | API client + hooks | 10.1 – 10.4 |
| 11 | Dashboard | 11.1 – 11.5 |
| 12 | Asset detail | 12.1 – 12.4 |
| 13 | Responsive pass | 13.1 |
| 14 | a11y + reduced-motion | 14.1 – 14.2 |
| 15 | Deploy | 15.1 – 15.2 |

After Phase 9 the landing is shippable on its own. After Phase 12 all three surfaces work with real data.

---

# Phase 1 — Foundation

## Task 1.1: Initialize Next.js 16 project

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`

- [ ] **Step 1: Scaffold with create-next-app**

Run from repo root:

```bash
pnpm dlx create-next-app@latest web \
  --typescript --tailwind --app --no-src-dir \
  --import-alias "@/*" --use-pnpm \
  --no-eslint --no-turbopack --skip-install
cd web && pnpm install
```

Expected: `web/` directory populated with Next 16 + Tailwind v4 + TS skeleton, `pnpm install` completes without errors.

- [ ] **Step 2: Pin engines and add scripts**

Edit `web/package.json` — replace the `scripts` section and add `engines`:

```json
{
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **Step 3: Verify dev server boots**

Run from `web/`:

```bash
pnpm dev
```

Open http://localhost:3000 in browser. Expected: default Next.js welcome page renders. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat(web): scaffold Next.js 16 + Tailwind + TS"
```

---

## Task 1.2: Install runtime + dev dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install runtime deps**

Run from `web/`:

```bash
pnpm add framer-motion@^11 recharts@^2.12 swr@^2.2 clsx tailwind-merge
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): add framer-motion, recharts, swr, testing deps"
```

---

## Task 1.3: Configure fonts via next/font

**Files:**
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Replace `web/app/layout.tsx` font imports**

Open `web/app/layout.tsx`, replace the `import { Inter } ...` line and the `<html>` className with:

```tsx
import { Inter, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pegana — Solana peg watchdog",
  description:
    "Real-time intrinsic-vs-market monitoring for 14 Solana LSTs, stables, and synthetics.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Verify build still passes**

```bash
pnpm build
```

Expected: build completes; no font errors.

- [ ] **Step 3: Commit**

```bash
git add web/app/layout.tsx
git commit -m "feat(web): wire Inter + JetBrains Mono via next/font"
```

---

## Task 1.4: Define design tokens in CSS + globals reset

**Files:**
- Replace: `web/app/globals.css`

- [ ] **Step 1: Replace `web/app/globals.css` entirely**

```css
@import "tailwindcss";

@theme {
  /* Surface */
  --color-canvas: #000000;
  --color-surface-1: #0f0f12;
  --color-surface-2: #1a1c22;
  --color-hairline: #1a1a1a;
  --color-outline: #2a2a2a;

  /* Text */
  --color-text: #fffdf9;
  --color-text-muted: #6f879c;
  --color-text-caption: #787878;

  /* State */
  --color-st-pegged: #6bd697;
  --color-st-drift: #c08a55;
  --color-st-depeg: #a55a5a;
  --color-st-critical: #b73838;
  --color-st-unknown: #6f879c;

  /* Brand gradient */
  --gradient-iridescent: linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%);

  /* Spacing tokens */
  --spacing-section-gap: 144px;
  --spacing-card-pad: 20px;
  --spacing-card-pad-tight: 14px;
  --spacing-page-max: 1280px;

  /* Easing */
  --ease-default: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-strong: cubic-bezier(0.16, 1, 0.3, 1);

  /* Font families bound from next/font variables */
  --font-family-sans: var(--font-sans), system-ui, sans-serif;
  --font-family-mono: var(--font-mono), ui-monospace, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-family-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body { position: relative; overflow-x: hidden; }
::selection { background: var(--color-text-muted); color: var(--color-canvas); }

/* Reduced motion guard — applied globally */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* Mouse-tracked CSS custom props default centered */
:root {
  --mx: 50vw;
  --my: 40vh;
}
```

- [ ] **Step 2: Verify Tailwind picks up custom tokens**

Edit `web/app/page.tsx` (the default Next page) to test:

```tsx
export default function Home() {
  return (
    <main className="min-h-screen bg-canvas text-text font-sans p-8">
      <h1 className="text-3xl tracking-tight">Pegana</h1>
      <p className="text-text-muted mt-4">Token wiring verified.</p>
    </main>
  );
}
```

Run `pnpm dev`, open localhost:3000. Expected: black page, off-white text, muted-blue paragraph. Stop server.

- [ ] **Step 3: Commit**

```bash
git add web/app/globals.css web/app/page.tsx
git commit -m "feat(web): define design tokens + global reset + reduced-motion guard"
```

---

## Task 1.5: Initialize shadcn/ui

**Files:**
- Create: `web/components.json`
- Create: `web/lib/utils/cn.ts`

- [ ] **Step 1: Run shadcn init**

From `web/`:

```bash
pnpm dlx shadcn@latest init -d --css-variables --base-color neutral
```

When prompted, accept defaults (TypeScript yes, App Router yes, RSC yes, components alias `@/components`, utils alias `@/lib/utils`).

- [ ] **Step 2: Add tooltip and dropdown-menu primitives**

```bash
pnpm dlx shadcn@latest add tooltip dropdown-menu
```

Expected: `web/components/ui/tooltip.tsx` and `web/components/ui/dropdown-menu.tsx` created.

- [ ] **Step 3: Extract our `cn()` to `lib/utils/cn.ts`**

shadcn creates a `lib/utils.ts` with `cn`. Move it to our convention:

```bash
mkdir -p web/lib/utils && mv web/lib/utils.ts web/lib/utils/cn.ts
```

Open `web/components.json`, change the `"utils"` alias to `@/lib/utils/cn`. Update any imports in the freshly-added shadcn components from `@/lib/utils` to `@/lib/utils/cn`.

- [ ] **Step 4: Commit**

```bash
git add web/components.json web/components/ui web/lib/utils
git commit -m "feat(web): shadcn init + tooltip + dropdown-menu"
```

---

## Task 1.6: Mirror Rust API types into TypeScript

**Files:**
- Create: `web/lib/api/types.ts`

- [ ] **Step 1: Write the types**

Source of truth is `crates/common/src/lib.rs` and the JSON serialized by `crates/api-rs/src/routes/*.rs`. The peg-state enum serializes UPPERCASE per the Postgres `peg_state` enum (verified in `migrations/0001_initial.sql:line ~30`).

Create `web/lib/api/types.ts`:

```ts
export type PegState =
  | "PEGGED"
  | "DRIFT"
  | "DEPEG"
  | "CRITICAL"
  | "BLACK_SWAN"
  | "UNKNOWN";

export type AssetClass =
  | "lst"
  | "stable_fiat"
  | "stable_cdp"
  | "stable_rwa"
  | "stable_dn"
  | "stable_fx";

export type PegTarget = "SOL" | "USD" | "BRL" | "EUR";

// GET /v1/assets, GET /v1/assets/:symbol
export interface AssetCardData {
  symbol: string;
  name: string;
  mint: string;
  class: AssetClass;
  peg_target: PegTarget;
  decimals: number;
  state: PegState | null;
  discount: string | null;       // rust_decimal::Decimal serializes as string
  intrinsic_usd: string | null;
  market_usd: string | null;
  updated_at: string | null;     // ISO 8601
}

// GET /v1/assets/:symbol/history
export interface HistoryPoint {
  ts: string;                    // ISO 8601
  discount: string;
  state: PegState;
}

// GET /v1/assets/:symbol/state
export interface AssetStateResp {
  asset: string;
  state: PegState;
  since: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
}

// GET /v1/alerts
export interface AlertRow {
  id: string;
  asset: string;
  class: AssetClass;
  from_state: PegState;
  to_state: PegState;
  detected_at: string;
  dispatched_at: string | null;
}

// GET /v1/stats
export interface StatsResponse {
  assets_tracked: number;
  alerts_24h: number;
  by_state: Partial<Record<PegState, number>>;
}

// WebSocket server frames
export type ServerMsg =
  | { op: "pong" }
  | { op: "error"; msg: string }
  | { op: "update"; asset: string; payload: Record<string, unknown> };

// WebSocket client frames
export type ClientMsg =
  | { op: "subscribe"; assets: string[] }
  | { op: "unsubscribe"; assets: string[] }
  | { op: "ping" };
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/api/types.ts
git commit -m "feat(web): mirror Rust API types into TypeScript"
```

---

# Phase 2 — Atoms

## Task 2.1: BrandMark component

**Files:**
- Create: `web/components/atoms/brand-mark.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { cn } from "@/lib/utils/cn";

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md";
}

export function BrandMark({
  className,
  showWordmark = true,
  size = "sm",
}: BrandMarkProps) {
  const dot = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  const text = size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(dot, "block")}
        style={{ background: "var(--gradient-iridescent)" }}
        aria-hidden="true"
      />
      {showWordmark && (
        <span className={cn(text, "font-medium tracking-tight text-text")}>
          Pegana
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Smoke-test in dev**

Drop `<BrandMark />` into `web/app/page.tsx` temporarily, run `pnpm dev`, verify the gradient square + "Pegana" wordmark render on black bg. Then revert page.tsx to the placeholder from Task 1.4.

- [ ] **Step 3: Commit**

```bash
git add web/components/atoms/brand-mark.tsx
git commit -m "feat(web): BrandMark atom"
```

---

## Task 2.2: Pill component

**Files:**
- Create: `web/components/atoms/pill.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { cn } from "@/lib/utils/cn";
import type { ComponentProps } from "react";

type Variant = "ghost" | "filled" | "backdrop";

interface PillProps extends ComponentProps<"button"> {
  variant?: Variant;
  asChild?: false;
}

const variants: Record<Variant, string> = {
  ghost:
    "border border-text text-text bg-transparent hover:bg-text/[0.04]",
  filled:
    "bg-text text-canvas border border-text hover:bg-canvas hover:text-text",
  backdrop:
    "border border-hairline bg-canvas/60 backdrop-blur-md text-text hover:border-outline",
};

export function Pill({ variant = "ghost", className, ...rest }: PillProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-[0.06em] transition-colors duration-500 ease-out",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/atoms/pill.tsx
git commit -m "feat(web): Pill atom with ghost/filled/backdrop variants"
```

---

## Task 2.3: StatePip — animated state indicator

**Files:**
- Create: `web/components/atoms/state-pip.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { cn } from "@/lib/utils/cn";
import type { PegState } from "@/lib/api/types";

interface StatePipProps {
  state: PegState | null | undefined;
  pulse?: boolean;
  size?: number;
  className?: string;
}

const colorByState: Record<PegState, string> = {
  PEGGED: "var(--color-st-pegged)",
  DRIFT: "var(--color-st-drift)",
  DEPEG: "var(--color-st-depeg)",
  CRITICAL: "var(--color-st-critical)",
  BLACK_SWAN: "var(--color-st-critical)",
  UNKNOWN: "var(--color-st-unknown)",
};

const shouldPulseByDefault: Partial<Record<PegState, boolean>> = {
  DRIFT: true,
  DEPEG: true,
  CRITICAL: true,
  BLACK_SWAN: true,
};

export function StatePip({
  state,
  pulse,
  size = 6,
  className,
}: StatePipProps) {
  if (!state) return null;
  const color = colorByState[state];
  const doPulse = pulse ?? shouldPulseByDefault[state] ?? false;
  return (
    <span
      className={cn("inline-block rounded-full", doPulse && "pip-pulse", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: doPulse ? `0 0 6px ${color}` : undefined,
        ["--pip-color" as string]: color,
      }}
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 2: Add pulse keyframes to globals.css**

Append to `web/app/globals.css`:

```css
@keyframes pip-pulse-anim {
  0%, 100% { box-shadow: 0 0 0 0 var(--pip-color, transparent); }
  50%      { box-shadow: 0 0 0 6px transparent; }
}
.pip-pulse { animation: pip-pulse-anim 2s ease-in-out infinite; }
```

- [ ] **Step 3: Commit**

```bash
git add web/components/atoms/state-pip.tsx web/app/globals.css
git commit -m "feat(web): StatePip atom with per-state pulse"
```

---

## Task 2.4: Counter — animates from 0 to target

**Files:**
- Create: `web/components/atoms/counter.tsx`
- Create: `web/tests/unit/atoms/counter.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// web/tests/unit/atoms/counter.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Counter } from "@/components/atoms/counter";

describe("Counter", () => {
  it("renders target value when reduced-motion is preferred", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    render(<Counter target={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Configure vitest**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

Create `web/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Install the vite-plugin-react dep:

```bash
pnpm add -D @vitejs/plugin-react
```

- [ ] **Step 3: Run the test, verify it fails**

```bash
pnpm test counter
```

Expected: FAIL with module not found for `@/components/atoms/counter`.

- [ ] **Step 4: Write the component**

```tsx
// web/components/atoms/counter.tsx
"use client";

import { useEffect, useRef, useState } from "react";

interface CounterProps {
  target: number;
  durationMs?: number;
  startOnMount?: boolean;
  className?: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Counter({
  target,
  durationMs = 1400,
  startOnMount = true,
  className,
}: CounterProps) {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startOnMount || startedRef.current) return;
    if (prefersReducedMotion() || target === 0) {
      setValue(target);
      return;
    }
    startedRef.current = true;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, startOnMount]);

  return <span className={className}>{value}</span>;
}
```

- [ ] **Step 5: Run the test, verify it passes**

```bash
pnpm test counter
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/atoms/counter.tsx web/tests web/vitest.config.ts web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): Counter atom with rAF ramp + reduced-motion guard"
```

---

## Task 2.5: Sparkline component

**Files:**
- Create: `web/components/atoms/sparkline.tsx`
- Create: `web/tests/unit/atoms/sparkline.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// web/tests/unit/atoms/sparkline.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sparkline } from "@/components/atoms/sparkline";

describe("Sparkline", () => {
  it("renders an svg path with the expected number of points", () => {
    const { container } = render(<Sparkline points={[1, 2, 3, 4, 5]} />);
    const path = container.querySelector("path[data-role='spark-line']");
    expect(path).not.toBeNull();
    // path 'd' attribute should encode 5 L-commands (one per point, first is M)
    const d = path?.getAttribute("d") ?? "";
    const lCount = (d.match(/L/g) ?? []).length;
    expect(lCount).toBe(4);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm test sparkline
```

Expected: FAIL (module missing).

- [ ] **Step 3: Write the component**

```tsx
// web/components/atoms/sparkline.tsx
import { cn } from "@/lib/utils/cn";

interface SparklineProps {
  points: number[];
  className?: string;
  stroke?: string;
  fill?: string;
  height?: number;
  showFill?: boolean;
}

function toPath(points: number[], w: number, h: number): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    return { x, y };
  });
  const line = coords
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${w.toFixed(2)},${h.toFixed(2)} L0,${h.toFixed(2)} Z`;
  return { line, area };
}

export function Sparkline({
  points,
  className,
  stroke = "var(--color-st-drift)",
  fill = "rgba(192,138,85,0.25)",
  height = 36,
  showFill = true,
}: SparklineProps) {
  const w = 200;
  const { line, area } = toPath(points, w, height);
  return (
    <svg
      className={cn("block w-full", className)}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {showFill && area && <path d={area} fill={fill} />}
      {line && <path d={line} data-role="spark-line" stroke={stroke} strokeWidth={1.5} fill="none" />}
    </svg>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm test sparkline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/atoms/sparkline.tsx web/tests/unit/atoms/sparkline.test.tsx
git commit -m "feat(web): Sparkline atom"
```

---

## Task 2.6: Marquee primitive

**Files:**
- Create: `web/components/atoms/marquee.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/atoms/marquee.tsx
"use client";

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface MarqueeProps {
  children: ReactNode;
  durationSeconds?: number;
  className?: string;
  pauseOnHover?: boolean;
}

export function Marquee({
  children,
  durationSeconds = 55,
  className,
  pauseOnHover = true,
}: MarqueeProps) {
  return (
    <div
      className={cn(
        "marquee-window relative overflow-hidden opacity-70 w-full",
        pauseOnHover && "marquee-pausable",
        className,
      )}
      style={{
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
        maskImage:
          "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
      }}
    >
      <div
        className="marquee-track flex w-max"
        style={{ animation: `marquee-scroll ${durationSeconds}s linear infinite` }}
      >
        <div className="flex shrink-0 items-center gap-10 px-5">{children}</div>
        <div className="flex shrink-0 items-center gap-10 px-5" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the marquee keyframes to globals.css**

Append to `web/app/globals.css`:

```css
@keyframes marquee-scroll {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-50%, 0, 0); }
}
.marquee-pausable:hover .marquee-track { animation-play-state: paused; }
```

- [ ] **Step 3: Commit**

```bash
git add web/components/atoms/marquee.tsx web/app/globals.css
git commit -m "feat(web): Marquee atom — mask-fade + duplicate-track loop"
```

---

# Phase 3 — Background layers

## Task 3.1: useSpotlight hook + MouseSpotlight + DotGrid

**Files:**
- Create: `web/lib/hooks/use-spotlight.ts`
- Create: `web/components/molecules/mouse-spotlight.tsx`
- Create: `web/components/molecules/dot-grid.tsx`

- [ ] **Step 1: Write the hook**

```ts
// web/lib/hooks/use-spotlight.ts
"use client";

import { useEffect } from "react";

export function useSpotlight() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const apply = () => {
      document.documentElement.style.setProperty("--mx", `${lastX}px`);
      document.documentElement.style.setProperty("--my", `${lastY}px`);
      raf = 0;
    };

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    // initial center
    lastX = window.innerWidth / 2;
    lastY = window.innerHeight * 0.35;
    apply();

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
```

- [ ] **Step 2: Write DotGrid**

```tsx
// web/components/molecules/dot-grid.tsx
export function DotGrid() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,253,249,0.05) 1px, transparent 1.6px)",
        backgroundSize: "26px 26px",
        WebkitMaskImage:
          "radial-gradient(circle 320px at var(--mx) var(--my), black 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.18) 100%)",
        maskImage:
          "radial-gradient(circle 320px at var(--mx) var(--my), black 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.18) 100%)",
      }}
    />
  );
}
```

- [ ] **Step 3: Write MouseSpotlight**

```tsx
// web/components/molecules/mouse-spotlight.tsx
export function MouseSpotlight() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[1] pointer-events-none mix-blend-screen"
      style={{
        background:
          "radial-gradient(circle 480px at var(--mx) var(--my), rgba(254,237,122,0.04) 0%, rgba(255,132,0,0.025) 30%, rgba(223,145,247,0.02) 55%, transparent 75%)",
        transition: "background 0.4s ease",
      }}
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/lib/hooks/use-spotlight.ts web/components/molecules/mouse-spotlight.tsx web/components/molecules/dot-grid.tsx
git commit -m "feat(web): DotGrid + MouseSpotlight + useSpotlight hook"
```

---

## Task 3.2: Wire background layers into root layout

**Files:**
- Modify: `web/app/layout.tsx`
- Create: `web/components/molecules/background.tsx`

- [ ] **Step 1: Create a client wrapper that hosts the hook**

```tsx
// web/components/molecules/background.tsx
"use client";

import { useSpotlight } from "@/lib/hooks/use-spotlight";
import { DotGrid } from "./dot-grid";
import { MouseSpotlight } from "./mouse-spotlight";

export function Background() {
  useSpotlight();
  return (
    <>
      <DotGrid />
      <MouseSpotlight />
    </>
  );
}
```

- [ ] **Step 2: Mount in layout body**

Edit `web/app/layout.tsx`, replace the `<body>{children}</body>` line:

```tsx
<body>
  <Background />
  <div className="relative z-[2]">{children}</div>
</body>
```

Add the import at the top:

```tsx
import { Background } from "@/components/molecules/background";
```

- [ ] **Step 3: Verify spotlight tracks mouse**

Run `pnpm dev`, open localhost:3000, move mouse. Expected: faint glow halo follows cursor across the otherwise dark page. Stop server.

- [ ] **Step 4: Commit**

```bash
git add web/app/layout.tsx web/components/molecules/background.tsx
git commit -m "feat(web): mount mouse-reactive background in root layout"
```

---

# Phase 4 — Site chrome

## Task 4.1: SocialIcon molecule

**Files:**
- Create: `web/components/molecules/social-icon.tsx`

- [ ] **Step 1: Write the component with inline SVG paths**

```tsx
// web/components/molecules/social-icon.tsx
import { cn } from "@/lib/utils/cn";

type Network = "telegram" | "x" | "github" | "email";

const paths: Record<Network, string> = {
  telegram:
    "M21.5 4.5 18 19.5c-.2.9-1 1.1-1.7.7l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-5 9-8.2c.4-.4-.1-.6-.6-.2L6 11.7l-4.6-1.5c-1-.3-1-1 .2-1.5l18-7c.8-.3 1.6.2 1.3 1.3z",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.967 6.817H1.677l7.73-8.834L1.255 2.25h6.83l4.713 6.231 5.446-6.231Zm-1.16 17.52h1.833L7.084 4.126H5.117l11.967 15.644Z",
  github:
    "M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1 .8-.2 1.7-.3 2.5-.3s1.7.1 2.5.3c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5C19.1 20.2 22 16.4 22 12c0-5.5-4.5-10-10-10z",
  email:
    "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm0 4v10h16V8l-8 5-8-5zm0-2 8 5 8-5H4z",
};

const labels: Record<Network, string> = {
  telegram: "Telegram",
  x: "X / Twitter",
  github: "GitHub",
  email: "Email",
};

interface SocialIconProps {
  network: Network;
  href: string;
  className?: string;
}

export function SocialIcon({ network, href, className }: SocialIconProps) {
  return (
    <a
      href={href}
      aria-label={labels[network]}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center border border-hairline text-text transition-colors duration-500 ease-out hover:border-text hover:bg-text/[0.02]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d={paths[network]} />
      </svg>
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/social-icon.tsx
git commit -m "feat(web): SocialIcon molecule with telegram/x/github/email"
```

---

## Task 4.2: SiteHeader organism

**Files:**
- Create: `web/components/organisms/site-header.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/site-header.tsx
import Link from "next/link";
import { BrandMark } from "@/components/atoms/brand-mark";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/methodology", label: "Methodology" },
  { href: "/dashboard?view=alerts", label: "Alerts" },
  { href: "/api", label: "API" },
];

export function SiteHeader() {
  return (
    <header className="pt-6">
      <nav className="mx-auto flex max-w-page-max items-center justify-between px-8">
        <Link href="/" aria-label="Pegana home">
          <BrandMark />
        </Link>
        <div className="flex items-center gap-7">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative text-[12px] uppercase tracking-[0.06em] text-text after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:scale-x-0 after:bg-text after:transition-transform after:duration-500 after:origin-left hover:after:scale-x-100"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="https://t.me/PeganaBot"
            target="_blank"
            rel="noreferrer"
            className="group relative overflow-hidden border border-text px-[18px] py-[9px] text-[12px] uppercase tracking-[0.06em] text-text"
          >
            <span className="absolute inset-0 translate-y-full bg-text transition-transform duration-500 ease-out group-hover:translate-y-0" />
            <span className="relative transition-colors duration-500 ease-out group-hover:text-canvas">
              Get the bot
            </span>
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

Note: `max-w-page-max` requires adding `--spacing-page-max` to be picked up by Tailwind's arbitrary-value scanning. Either use `max-w-[1280px]` directly or add an explicit safelist entry.

- [ ] **Step 2: Use the literal value to avoid Tailwind scan issues**

Replace `max-w-page-max` with `max-w-[1280px]` in the file above.

- [ ] **Step 3: Commit**

```bash
git add web/components/organisms/site-header.tsx
git commit -m "feat(web): SiteHeader with nav + CTA fill-up hover"
```

---

## Task 4.3: SiteFooter organism

**Files:**
- Create: `web/components/organisms/site-footer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/site-footer.tsx
import Link from "next/link";
import { BrandMark } from "@/components/atoms/brand-mark";
import { SocialIcon } from "@/components/molecules/social-icon";
import { StatePip } from "@/components/atoms/state-pip";

const columns = [
  {
    title: "Product",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/methodology", label: "Methodology" },
      { href: "/dashboard?view=alerts", label: "Alerts archive" },
      { href: "/roadmap", label: "Roadmap" },
    ],
  },
  {
    title: "Developers",
    items: [
      { href: "https://t.me/PeganaBot", label: "Telegram bot" },
      { href: "/api", label: "REST API" },
      { href: "/api#ws", label: "WebSocket" },
      { href: "/api#webhooks", label: "Webhooks (soon)" },
    ],
  },
  {
    title: "Open",
    items: [
      { href: "https://github.com/lrafasouza/pegana", label: "GitHub" },
      { href: "/spec", label: "Spec v3" },
      { href: "/changelog", label: "Changelog" },
      { href: "/audit", label: "Audit log" },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "mailto:rafael@pegana.xyz", label: "rafael@pegana.xyz" },
      { href: "/press", label: "Press kit" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline pt-24 pb-8">
      <div className="mx-auto max-w-[1280px] px-8">
        <div className="grid grid-cols-1 gap-14 md:grid-cols-[2.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <BrandMark />
            <p className="mt-4 max-w-[320px] text-sm leading-snug text-text-muted">
              Real-time peg watchdog for Solana LSTs, stablecoins and synthetic assets.
              Built solo. Open methodology.
            </p>
            <div className="mt-7 flex gap-3.5">
              <SocialIcon network="telegram" href="https://t.me/PeganaBot" />
              <SocialIcon network="x" href="https://x.com/PeganaHQ" />
              <SocialIcon network="github" href="https://github.com/lrafasouza/pegana" />
              <SocialIcon network="email" href="mailto:rafael@pegana.xyz" />
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h5 className="mb-5 text-[13px] font-semibold text-text">{col.title}</h5>
              {col.items.map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className="block text-[13px] leading-[2.05] text-text-muted transition-colors duration-500 ease-out hover:text-text"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-20 flex flex-wrap items-center justify-between gap-6 border-t border-hairline pt-7 text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span>© 2026 Pegana</span>
            <span className="h-3 w-px bg-hairline" />
            <span>Solana mainnet</span>
            <span className="h-3 w-px bg-hairline" />
            <span>v1.0</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.04em]">
              <StatePip state="PEGGED" pulse />
              All systems operational
            </span>
            <span className="h-3 w-px bg-hairline" />
            <Link href="/terms" className="hover:text-text transition-colors duration-500">Terms</Link>
            <Link href="/privacy" className="hover:text-text transition-colors duration-500">Privacy</Link>
            <Link href="/license" className="hover:text-text transition-colors duration-500">License (MIT)</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/site-footer.tsx
git commit -m "feat(web): SiteFooter — 5-col grid + social icons + status pip"
```

---

# Phase 5 — Hero

## Task 5.1: AnnouncementPill molecule

**Files:**
- Create: `web/components/molecules/announcement-pill.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/announcement-pill.tsx
"use client";

import { Counter } from "@/components/atoms/counter";
import { StatePip } from "@/components/atoms/state-pip";

interface AnnouncementPillProps {
  pegged: number;
  drift: number;
  href?: string;
}

export function AnnouncementPill({ pegged, drift, href = "/dashboard" }: AnnouncementPillProps) {
  return (
    <a
      href={href}
      className="group absolute right-8 top-8 z-10 inline-flex items-center gap-2.5 border border-hairline bg-canvas/60 px-3.5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-text backdrop-blur-md transition-colors duration-500 hover:border-outline"
    >
      <StatePip state="PEGGED" pulse />
      <span><span className="font-medium"><Counter target={pegged} /></span> pegged</span>
      <span className="text-text-muted">·</span>
      <span><span className="font-medium text-st-drift"><Counter target={drift} /></span> drift</span>
      <span className="text-text-muted">·</span>
      <span>Live</span>
      <span className="text-text-muted transition-transform duration-500 group-hover:translate-x-1">→</span>
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/announcement-pill.tsx
git commit -m "feat(web): AnnouncementPill — top-right live status"
```

---

## Task 5.2: StatPanel molecule

**Files:**
- Create: `web/components/molecules/stat-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/stat-panel.tsx
import { Counter } from "@/components/atoms/counter";
import { cn } from "@/lib/utils/cn";

interface StatCell {
  value: number | string;
  unit?: string;
  label: string;
  animate?: boolean;
}

interface StatPanelProps {
  cells: StatCell[];
  className?: string;
}

export function StatPanel({ cells, className }: StatPanelProps) {
  return (
    <div
      className={cn(
        "flex w-fit items-stretch border border-hairline bg-surface-1/50 backdrop-blur-sm",
        className,
      )}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cn(
            "flex min-w-[110px] flex-col gap-1.5 px-5 py-4",
            i > 0 && "border-l border-hairline",
          )}
        >
          <span className="text-[26px] font-medium leading-none tracking-[-0.025em] text-text">
            {typeof c.value === "number" && c.animate ? (
              <Counter target={c.value} />
            ) : (
              c.value
            )}
            {c.unit && (
              <span className="ml-0.5 text-[13px] font-normal text-text-muted">
                {c.unit}
              </span>
            )}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/stat-panel.tsx
git commit -m "feat(web): StatPanel molecule"
```

---

## Task 5.3: AssetCard molecule (floating variant)

**Files:**
- Create: `web/components/molecules/asset-card.tsx`
- Create: `web/tests/unit/molecules/asset-card.test.tsx`

- [ ] **Step 1: Write failing test for state badge rendering**

```tsx
// web/tests/unit/molecules/asset-card.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AssetCard } from "@/components/molecules/asset-card";

describe("AssetCard", () => {
  it("renders symbol, state label and numeric values for the floating variant", () => {
    render(
      <AssetCard
        variant="floating"
        symbol="bSOL"
        state="DRIFT"
        intrinsicUsd="1.0241"
        marketUsd="1.0217"
        discountBps={-24}
        unit="SOL"
      />,
    );
    expect(screen.getByText("bSOL")).toBeInTheDocument();
    expect(screen.getByText(/drift/i)).toBeInTheDocument();
    expect(screen.getByText("1.0241")).toBeInTheDocument();
    expect(screen.getByText("1.0217")).toBeInTheDocument();
    expect(screen.getByText(/−24 bps/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm test asset-card
```

Expected: FAIL (module missing).

- [ ] **Step 3: Write the component**

```tsx
// web/components/molecules/asset-card.tsx
import { cn } from "@/lib/utils/cn";
import { StatePip } from "@/components/atoms/state-pip";
import { Sparkline } from "@/components/atoms/sparkline";
import type { PegState } from "@/lib/api/types";

type Variant = "floating" | "row" | "detail";

interface AssetCardProps {
  variant: Variant;
  symbol: string;
  state: PegState | null;
  intrinsicUsd?: string | null;
  marketUsd?: string | null;
  discountBps?: number | null;
  unit?: string;                 // "SOL" or "USD"
  spark?: number[];
  className?: string;
}

function formatBps(b: number | null | undefined): string {
  if (b == null) return "—";
  const sign = b < 0 ? "−" : b > 0 ? "+" : "";
  return `${sign}${Math.abs(b)} bps`;
}

const stateLabel: Record<PegState, string> = {
  PEGGED: "Pegged",
  DRIFT: "Drift",
  DEPEG: "Depeg",
  CRITICAL: "Critical",
  BLACK_SWAN: "Black Swan",
  UNKNOWN: "Unknown",
};

export function AssetCard(props: AssetCardProps) {
  if (props.variant === "floating") return <FloatingCard {...props} />;
  if (props.variant === "row") return <RowCard {...props} />;
  return <DetailCard {...props} />;
}

function FloatingCard({
  symbol, state, intrinsicUsd, marketUsd, discountBps, unit = "SOL", spark, className,
}: AssetCardProps) {
  return (
    <div
      className={cn(
        "relative w-[340px] overflow-hidden border border-hairline bg-surface-1/70 px-5 py-4 backdrop-blur-md transition-transform duration-500 ease-out hover:-translate-y-1 hover:border-outline",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-50"
        style={{ background: "var(--gradient-iridescent)" }}
      />
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[20px] font-medium tracking-tight">{symbol}</span>
        {state && (
          <span className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5",
            state === "PEGGED" && "text-st-pegged bg-st-pegged/10",
            state === "DRIFT" && "text-st-drift bg-st-drift/10",
            (state === "DEPEG" || state === "CRITICAL" || state === "BLACK_SWAN") && "text-st-depeg bg-st-depeg/15",
            state === "UNKNOWN" && "text-text-muted bg-text-muted/10",
          )}>
            <StatePip state={state} size={5} />
            {stateLabel[state]}
          </span>
        )}
      </div>
      <div className="font-mono text-[12px] leading-[1.7] text-text">
        {intrinsicUsd != null && (
          <div><span className="inline-block min-w-[70px] text-text-muted">intrinsic</span> {intrinsicUsd} {unit}</div>
        )}
        {marketUsd != null && (
          <div><span className="inline-block min-w-[70px] text-text-muted">market</span> {marketUsd} {unit}</div>
        )}
        {discountBps != null && (
          <div><span className="inline-block min-w-[70px] text-text-muted">discount</span> <span className="font-medium text-st-drift">{formatBps(discountBps)}</span></div>
        )}
      </div>
      {spark && spark.length > 0 && (
        <div className="mt-3 h-11">
          <Sparkline points={spark} height={44} />
        </div>
      )}
    </div>
  );
}

function RowCard(props: AssetCardProps) {
  // Implemented in Task 11.1 (dashboard phase)
  return <div data-variant="row" {...({} as object)}>{props.symbol}</div>;
}

function DetailCard(props: AssetCardProps) {
  // Implemented in Task 12.1 (asset detail phase)
  return <div data-variant="detail" {...({} as object)}>{props.symbol}</div>;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm test asset-card
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/molecules/asset-card.tsx web/tests/unit/molecules/asset-card.test.tsx
git commit -m "feat(web): AssetCard floating variant + state badge rendering"
```

---

## Task 5.4: HeroLanding organism

**Files:**
- Create: `web/components/organisms/hero-landing.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/hero-landing.tsx
"use client";

import { motion } from "framer-motion";
import { AnnouncementPill } from "@/components/molecules/announcement-pill";
import { StatPanel } from "@/components/molecules/stat-panel";
import { AssetCard } from "@/components/molecules/asset-card";

interface HeroLandingProps {
  pegged: number;
  drift: number;
  alertsLifetime: number;
  assetsCount: number;
}

const titleWords = [
  { text: "Catch", delay: 0.05 },
  { text: " a", delay: 0.16 },
  { text: " depeg", delay: 0.27 },
];
const secondLineWords = [
  { text: "before", delay: 0.42 },
  { text: " it", delay: 0.53 },
  { text: " catches", delay: 0.64 },
  { text: " you.", delay: 0.75 },
];

const wordVariants = {
  hidden: { opacity: 0, y: 36 },
  visible: { opacity: 1, y: 0, transition: { duration: 1.1, ease: [0.16, 1, 0.3, 1] } },
};

export function HeroLanding({ pegged, drift, alertsLifetime, assetsCount }: HeroLandingProps) {
  return (
    <section className="relative min-h-[88vh] px-8 py-20 lg:py-24">
      <div className="relative mx-auto max-w-[1280px]">
        <AnnouncementPill pegged={pegged} drift={drift} />

        <div className="max-w-[1180px] pt-28">
          <h1 className="text-[64px] font-medium leading-[0.96] tracking-[-0.045em] sm:text-[88px] lg:text-[104px]">
            <span>
              {titleWords.map((w) => (
                <motion.span
                  key={w.text}
                  variants={wordVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: w.delay }}
                  className="inline-block"
                >
                  {w.text}
                </motion.span>
              ))}
            </span>
            <span className="block text-text-muted font-normal">
              {secondLineWords.map((w) => (
                <motion.span
                  key={w.text}
                  variants={wordVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: w.delay }}
                  className="inline-block"
                >
                  {w.text}
                </motion.span>
              ))}
            </span>
          </h1>
          <p className="mt-8 max-w-[580px] text-[18px] leading-snug tracking-[0.18px]">
            Real-time intrinsic-vs-market monitoring for 14 Solana LSTs, stables and synthetics.
            Drift detected in seconds. Alerts in Telegram before the orderbook reprices.
          </p>
        </div>

        <div className="mt-20 flex flex-col items-end gap-8 lg:mt-24 lg:flex-row lg:items-end lg:justify-between">
          <StatPanel
            cells={[
              { value: assetsCount, label: "Assets live", animate: true },
              { value: alertsLifetime, label: "Alerts · 30d", animate: true },
              { value: "0.7", unit: "s", label: "Median latency" },
              { value: "99.97", unit: "%", label: "Uptime · 90d" },
            ]}
          />
          <AssetCard
            variant="floating"
            symbol="bSOL"
            state="DRIFT"
            intrinsicUsd="1.0241"
            marketUsd="1.0217"
            discountBps={-24}
            unit="SOL"
            spark={[28, 26, 28, 24, 20, 18, 14, 16, 12, 10, 8, 6]}
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/hero-landing.tsx
git commit -m "feat(web): HeroLanding organism with word-reveal + stat panel + asset card"
```

---

# Phase 6 — Marquee

## Task 6.1: LogoMarquee organism

**Files:**
- Create: `web/components/organisms/logo-marquee.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/logo-marquee.tsx
import { Marquee } from "@/components/atoms/marquee";

const logos: Array<{ key: string; className: string; text: string }> = [
  { key: "pyth",       className: "font-bold text-[22px] tracking-[-0.03em]", text: "Pyth" },
  { key: "sanctum",    className: "font-medium text-[18px] tracking-[-0.01em]", text: "sanctum" },
  { key: "jupiter",    className: "font-extrabold text-[20px] tracking-[-0.02em]", text: "Jupiter" },
  { key: "hylo",       className: "italic text-[22px] tracking-[-0.02em]", text: "hylo" },
  { key: "jito",       className: "font-bold text-[18px] tracking-[0.02em] uppercase", text: "JITO" },
  { key: "marinade",   className: "font-bold text-[20px] tracking-[-0.02em]", text: "Marinade" },
  { key: "drift",      className: "font-semibold text-[21px] tracking-[-0.04em] lowercase", text: "drift" },
  { key: "solana",     className: "font-extrabold text-[18px] tracking-[0.18em] uppercase", text: "SOLANA" },
  { key: "circle",     className: "font-semibold text-[19px] tracking-[-0.01em]", text: "Circle" },
  { key: "pyusd",      className: "italic font-extrabold text-[18px] tracking-[-0.02em]", text: "PYUSD" },
  { key: "ethena",     className: "font-medium text-[22px] tracking-[-0.04em]", text: "Ethena" },
  { key: "wormhole",   className: "font-bold text-[19px] tracking-[0.04em] uppercase", text: "WORMHOLE" },
  { key: "phantom",    className: "font-semibold text-[19px] tracking-[-0.02em]", text: "Phantom" },
  { key: "helius",     className: "italic font-semibold text-[19px] tracking-[-0.02em]", text: "helius" },
  { key: "bybit",      className: "font-extrabold text-[17px] tracking-[0.06em] uppercase", text: "BYBIT" },
  { key: "blazestake", className: "font-bold text-[17px] tracking-[-0.02em]", text: "BlazeStake" },
];

export function LogoMarquee() {
  return (
    <section className="mx-auto mt-24 flex w-full max-w-[1280px] flex-col items-center gap-4 px-8">
      <p className="text-[14px] leading-5 tracking-[-0.01em] text-text-caption">
        Built on the Solana stack we monitor.
      </p>
      <Marquee>
        {logos.map((l) => (
          <span
            key={l.key}
            className={`inline-flex h-7 items-center justify-center whitespace-nowrap text-text ${l.className}`}
          >
            {l.text}
          </span>
        ))}
      </Marquee>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/logo-marquee.tsx
git commit -m "feat(web): LogoMarquee with 16 ecosystem wordmarks"
```

---

# Phase 7 — (01) Methodology

## Task 7.1: AccordionRow molecule

**Files:**
- Create: `web/components/molecules/accordion-row.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/accordion-row.tsx
import { cn } from "@/lib/utils/cn";

interface AccordionRowProps {
  category: string;
  title: string;
  className?: string;
  href?: string;
}

export function AccordionRow({ category, title, className, href = "#" }: AccordionRowProps) {
  return (
    <a
      href={href}
      className={cn(
        "group relative grid grid-cols-[200px_1fr_24px] items-baseline gap-6 border-t border-hairline py-5.5 transition-[padding] duration-500 ease-out hover:pl-2 last:border-b",
        className,
      )}
    >
      <span className="pointer-events-none absolute -inset-x-8 inset-y-0 bg-text/[0.018] opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100" />
      <span className="relative font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">{category}</span>
      <span className="relative text-[17px] font-normal tracking-[0.17px] text-text">{title}</span>
      <span className="relative text-right font-mono text-[18px] font-light text-text transition-transform duration-500 group-hover:rotate-45">+</span>
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/accordion-row.tsx
git commit -m "feat(web): AccordionRow molecule with hover lift and plus rotate"
```

---

## Task 7.2: MethodologyAccordion organism

**Files:**
- Create: `web/components/organisms/methodology-accordion.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/methodology-accordion.tsx
import { AccordionRow } from "@/components/molecules/accordion-row";

const rows = [
  { category: "Intrinsic · LST", title: "Sanctum sol_value × Pyth SOL/USD" },
  { category: "Intrinsic · CDP", title: "Hylo on-chain collateralization ratio" },
  { category: "Intrinsic · FX",  title: "Pyth fiat-pair cross (BRL/USD, EUR/USD)" },
  { category: "Market",          title: "Jupiter route quote, round-robin 0.5 rps" },
  { category: "State machine",   title: "5-state hysteresis: 30s up, 120s down" },
];

export function MethodologyAccordion() {
  return (
    <section className="px-8 pt-36">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid items-baseline gap-16 md:grid-cols-[80px_1fr]">
          <div className="font-mono text-[13px] tracking-[0.02em]">(01)</div>
          <h2 className="max-w-[720px] text-[40px] font-medium leading-[1.15] tracking-[-0.025em]">
            Methodology.{" "}
            <span className="font-normal text-text-muted">
              Two numbers, one truth. Every alert derives from this.
            </span>
          </h2>
        </div>
        <div className="mt-7 max-w-[680px] text-[16px] leading-[1.55] tracking-[0.16px] md:ml-24">
          Intrinsic reads from the source of record — Sanctum for LSTs, on-chain CR for Hylo CDPs,
          Pyth for FX crosses, canonical 1 USD for fiat stables. Market is the deepest routed
          Jupiter quote, repriced through Pyth. EWMA-smoothed gap is the discount we publish.
        </div>
        <div className="mt-14 md:ml-24">
          {rows.map((r) => (
            <AccordionRow key={r.category} category={r.category} title={r.title} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/methodology-accordion.tsx
git commit -m "feat(web): MethodologyAccordion organism"
```

---

# Phase 8 — (02) Universe

## Task 8.1: AssetPortrait molecule

**Files:**
- Create: `web/components/molecules/asset-portrait.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/asset-portrait.tsx
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { StatePip } from "@/components/atoms/state-pip";
import type { PegState } from "@/lib/api/types";

interface AssetPortraitProps {
  symbol: string;
  category: string;      // e.g. "LST · SOL"
  state: PegState;
  bps: number;
  index?: number;
  className?: string;
}

const tintByState: Record<PegState, string> = {
  PEGGED: "rgba(111,135,156,0.10)",
  DRIFT:  "rgba(192,138,85,0.16)",
  DEPEG:  "rgba(165,90,90,0.20)",
  CRITICAL: "rgba(183,56,56,0.22)",
  BLACK_SWAN: "rgba(183,56,56,0.22)",
  UNKNOWN: "rgba(111,135,156,0.06)",
};

const stateLabel: Record<PegState, string> = {
  PEGGED: "Pegged", DRIFT: "Drift", DEPEG: "Depeg",
  CRITICAL: "Critical", BLACK_SWAN: "Black Swan", UNKNOWN: "Unknown",
};

function formatBps(b: number) {
  const sign = b < 0 ? "−" : b > 0 ? "+" : "";
  return `${sign}${Math.abs(b)} bps`;
}

export function AssetPortrait({
  symbol, category, state, bps, index = 0, className,
}: AssetPortraitProps) {
  const tint = tintByState[state];
  const colorClass =
    state === "PEGGED" ? "text-text" :
    state === "DRIFT" ? "text-st-drift" :
    (state === "DEPEG" || state === "CRITICAL" || state === "BLACK_SWAN") ? "text-st-depeg" : "text-text-muted";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15% 0px" }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: index * 0.06 }}
      whileHover={{ y: -4 }}
      className={cn(
        "relative flex aspect-[4/5] flex-col justify-between overflow-hidden border border-hairline p-3.5 transition-colors duration-500 ease-out hover:border-outline",
        "[--ap-tint:var(--tint)]",
        className,
      )}
      style={{
        background: "linear-gradient(180deg, #0a0a0a 0%, #050505 100%)",
        ["--tint" as string]: tint,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-500"
        style={{ background: "radial-gradient(circle at 70% 20%, var(--tint) 0%, transparent 60%)" }}
      />
      <div className="relative">
        <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">{category}</div>
        <div className="mt-1.5 text-[21px] font-medium leading-none tracking-tight">{symbol}</div>
      </div>
      <div className="relative">
        <div className="font-mono text-[11px] tracking-[0.02em] text-text">{formatBps(bps)}</div>
        <div className={cn("mt-2 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.15em]", colorClass)}>
          <StatePip state={state} size={4} />
          {stateLabel[state]}
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/asset-portrait.tsx
git commit -m "feat(web): AssetPortrait molecule with stagger reveal"
```

---

## Task 8.2: UniverseGrid organism

**Files:**
- Create: `web/components/organisms/universe-grid.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/universe-grid.tsx
import { AssetPortrait } from "@/components/molecules/asset-portrait";
import type { AssetCardData, PegState } from "@/lib/api/types";

// helper — derive bps from discount string, default to 0
function bpsFromDiscount(d: string | null): number {
  if (!d) return 0;
  const n = parseFloat(d);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 10000);
}

function categoryLabel(a: AssetCardData): string {
  const cls =
    a.class === "lst" ? "LST" :
    a.class === "stable_fiat" || a.class === "stable_rwa" ? "STABLE" :
    a.class === "stable_cdp" || a.class === "stable_dn" ? "SYNTH" :
    "FX";
  return `${cls} · ${a.peg_target}`;
}

interface UniverseGridProps {
  assets: AssetCardData[];
}

export function UniverseGrid({ assets }: UniverseGridProps) {
  return (
    <section className="px-8 pt-36">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-16 grid items-baseline gap-16 md:grid-cols-[80px_1fr]">
          <div className="font-mono text-[13px] tracking-[0.02em]">(02)</div>
          <h2 className="max-w-[720px] text-[40px] font-medium leading-[1.15] tracking-[-0.025em]">
            The universe.{" "}
            <span className="font-normal text-text-muted">
              Fourteen Solana assets, monitored 24/7.
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {assets.map((a, i) => (
            <AssetPortrait
              key={a.symbol}
              symbol={a.symbol}
              category={categoryLabel(a)}
              state={(a.state ?? "UNKNOWN") as PegState}
              bps={bpsFromDiscount(a.discount)}
              index={i}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/universe-grid.tsx
git commit -m "feat(web): UniverseGrid organism (7-col layout)"
```

---

# Phase 9 — (03) CTA + Wordmark + Landing assembly

## Task 9.1: TelegramBubble molecule

**Files:**
- Create: `web/components/molecules/telegram-bubble.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/telegram-bubble.tsx
export function TelegramBubble() {
  return (
    <div className="relative ml-auto max-w-[440px] border border-white/10 bg-[#17212b] px-5 py-4.5 text-white shadow-[0_24px_60px_rgba(0,0,0,0.5)] transition-transform duration-500 ease-out hover:-translate-y-1"
         style={{ borderRadius: "14px 14px 14px 4px" }}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px"
        style={{
          borderRadius: "14px 14px 14px 4px",
          padding: 1,
          background:
            "linear-gradient(135deg, rgba(254,237,122,0.4), rgba(255,132,0,0.3) 45%, rgba(223,145,247,0.4))",
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor" as unknown as string,
          maskComposite: "exclude" as unknown as string,
          opacity: 0.5,
        }}
      />
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold tracking-tight text-canvas"
             style={{ background: "var(--gradient-iridescent)" }}>
          P
        </div>
        <div className="flex flex-1 flex-col">
          <span className="text-[13px] font-semibold tracking-tight text-[#6ab0f3]">Pegana Watchdog</span>
          <span className="text-[11px] tracking-wide text-white/45">@PeganaBot · alert</span>
        </div>
        <span className="font-mono text-[10px] text-white/40">03:14 UTC</span>
      </div>
      <div className="text-[14px] leading-[1.55] text-white/95">
        <span className="font-semibold text-st-drift">⚠ DRIFT detected</span>
        <hr className="my-2.5 border-t border-white/[0.08]" />
        <div>
          <code className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[12px]">bSOL</code>{" "}
          · BlazeStake LST
        </div>
        <div className="mt-1">
          <code className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[12px]">PEGGED → DRIFT</code>{" "}
          @ <span className="font-mono font-medium text-st-drift">−24 bps</span>
        </div>
        <hr className="my-2.5 border-t border-white/[0.08]" />
        <div className="font-mono text-[12px] leading-[1.7] text-white/85">
          <div><span className="text-white/50">intrinsic</span> 1.0241 SOL</div>
          <div><span className="text-white/50">market</span>&nbsp;&nbsp;&nbsp;1.0217 SOL</div>
          <div><span className="text-white/50">route</span>&nbsp;&nbsp;&nbsp;&nbsp;Orca → Meteora</div>
        </div>
        <div className="mt-3 font-mono text-[11px] tracking-wide text-white/40">
          <span className="text-[#6ab0f3]">/methodology</span> ·{" "}
          <span className="text-[#6ab0f3]">/thresholds bsol</span> ·{" "}
          <span className="text-[#6ab0f3]">/unsubscribe</span>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-white/30">
        <span className="text-[#6ab0f3]">✓✓</span> delivered · 0.4s after detection
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/telegram-bubble.tsx
git commit -m "feat(web): TelegramBubble molecule"
```

---

## Task 9.2: PingedCTA organism

**Files:**
- Create: `web/components/organisms/pinged-cta.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/pinged-cta.tsx
import Link from "next/link";
import { TelegramBubble } from "@/components/molecules/telegram-bubble";

export function PingedCTA() {
  return (
    <section className="px-8 pt-40 pb-24">
      <div className="mx-auto grid max-w-[1280px] gap-16 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div>
          <div className="mb-8 font-mono text-[13px] tracking-[0.02em]">(03)</div>
          <h2 className="text-[56px] font-medium leading-[1.02] tracking-[-0.035em]">
            Get pinged.{" "}
            <span className="font-normal text-text-muted">
              Subscribe in Telegram. Receive an alert the moment a peg breaks.
            </span>
          </h2>
          <p className="mb-9 mt-9 max-w-[460px] text-[16px] leading-[1.55] tracking-[0.16px] text-text-muted">
            Or open the live dashboard to browse every asset, threshold and the last
            seven days of state transitions.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="https://t.me/PeganaBot"
              target="_blank"
              rel="noreferrer"
              className="group relative overflow-hidden border border-text bg-text px-6 py-4 text-[13px] uppercase tracking-[0.06em] text-canvas"
            >
              <span className="absolute inset-0 translate-y-full bg-canvas transition-transform duration-500 ease-out group-hover:translate-y-0" />
              <span className="relative transition-colors duration-500 ease-out group-hover:text-text">
                Open @PeganaBot →
              </span>
            </Link>
            <Link
              href="/dashboard"
              className="group relative overflow-hidden border border-text px-6 py-4 text-[13px] uppercase tracking-[0.06em] text-text"
            >
              <span className="absolute inset-0 translate-y-full bg-text transition-transform duration-500 ease-out group-hover:translate-y-0" />
              <span className="relative transition-colors duration-500 ease-out group-hover:text-canvas">
                Browse live dashboard
              </span>
            </Link>
          </div>
        </div>
        <TelegramBubble />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/pinged-cta.tsx
git commit -m "feat(web): PingedCTA organism (2-col)"
```

---

## Task 9.3: Wordmark organism

**Files:**
- Create: `web/components/organisms/wordmark.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/wordmark.tsx
"use client";

import { motion } from "framer-motion";

export function Wordmark() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15% 0px" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-visible py-48"
    >
      <h2
        aria-label="Pegana"
        className="m-0 whitespace-nowrap p-0 text-center font-bold leading-none tracking-[-0.05em] text-text"
        style={{ fontSize: "clamp(120px, 21vw, 280px)" }}
      >
        PEGANA
      </h2>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/wordmark.tsx
git commit -m "feat(web): Wordmark organism (clamp + fade-in)"
```

---

## Task 9.4: Compose the landing page

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Replace landing page**

```tsx
// web/app/page.tsx
import { SiteHeader } from "@/components/organisms/site-header";
import { SiteFooter } from "@/components/organisms/site-footer";
import { HeroLanding } from "@/components/organisms/hero-landing";
import { LogoMarquee } from "@/components/organisms/logo-marquee";
import { MethodologyAccordion } from "@/components/organisms/methodology-accordion";
import { UniverseGrid } from "@/components/organisms/universe-grid";
import { PingedCTA } from "@/components/organisms/pinged-cta";
import { Wordmark } from "@/components/organisms/wordmark";
import type { AssetCardData } from "@/lib/api/types";

// v1 mocked assets — Phase 10 will replace this with a real fetch
const MOCKED: AssetCardData[] = [
  { symbol: "jitoSOL", name: "Jito", mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0004", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "bSOL",    name: "BlazeStake", mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "DRIFT",  discount: "-0.0024", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "mSOL",    name: "Marinade",   mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0004", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "INF",     name: "Infinity",   mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "DRIFT",  discount: "-0.0031", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "dSOL",    name: "Drift",      mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0002", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "bbSOL",   name: "Bybit LST",  mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0004", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "JupSOL",  name: "Jupiter",    mint: "", class: "lst", peg_target: "SOL", decimals: 9, state: "PEGGED", discount: "-0.0005", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "USDC",    name: "USDC",       mint: "", class: "stable_fiat", peg_target: "USD", decimals: 6, state: "PEGGED", discount: "0.0001", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "USDT",    name: "USDT",       mint: "", class: "stable_fiat", peg_target: "USD", decimals: 6, state: "PEGGED", discount: "-0.0002", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "PYUSD",   name: "PayPal USD", mint: "", class: "stable_fiat", peg_target: "USD", decimals: 6, state: "PEGGED", discount: "0.0003", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "USDS",    name: "USDS",       mint: "", class: "stable_fiat", peg_target: "USD", decimals: 6, state: "PEGGED", discount: "-0.0001", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "hyUSD",   name: "Hylo",       mint: "", class: "stable_cdp", peg_target: "USD", decimals: 6, state: "DRIFT",  discount: "-0.0018", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "USDe",    name: "Ethena",     mint: "", class: "stable_dn",  peg_target: "USD", decimals: 9, state: "PEGGED", discount: "-0.0006", intrinsic_usd: null, market_usd: null, updated_at: null },
  { symbol: "BRZ",     name: "Brazilian Real", mint: "", class: "stable_fx", peg_target: "BRL", decimals: 4, state: "DEPEG", discount: "-0.0366", intrinsic_usd: null, market_usd: null, updated_at: null },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroLanding pegged={12} drift={2} alertsLifetime={142} assetsCount={14} />
        <LogoMarquee />
        <MethodologyAccordion />
        <UniverseGrid assets={MOCKED} />
        <PingedCTA />
        <Wordmark />
      </main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 2: Verify landing renders**

Run `pnpm dev`, open localhost:3000. Expected: hero with mouse-tracked spotlight, marquee scrolling, methodology accordion hover works, universe grid with 14 portraits, CTA + telegram mock, PEGANA wordmark, footer. Stop server.

- [ ] **Step 3: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): compose landing page (Phase 9 — landing shippable)"
```

**CHECKPOINT — landing page is functional with mocked data. Could deploy to Vercel here for review (see Task 15.1). Continuing to Phase 10 will replace the mock with live API data.**

---

# Phase 10 — API client + hooks

## Task 10.1: Format utility + tests

**Files:**
- Create: `web/lib/api/format.ts`
- Create: `web/tests/unit/lib/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { discountToBps, formatBps, formatUsd } from "@/lib/api/format";

describe("format helpers", () => {
  it("converts decimal discount to bps", () => {
    expect(discountToBps("0.0024")).toBe(24);
    expect(discountToBps("-0.0024")).toBe(-24);
    expect(discountToBps(null)).toBeNull();
  });

  it("formats bps with proper sign", () => {
    expect(formatBps(24)).toBe("+24 bps");
    expect(formatBps(-24)).toBe("−24 bps");
    expect(formatBps(0)).toBe("0 bps");
  });

  it("formats USD with adaptive decimals", () => {
    expect(formatUsd("1.000123", 4)).toBe("$1.0001");
    expect(formatUsd("0.999876", 4)).toBe("$0.9999");
    expect(formatUsd(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm test format
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement format helpers**

```ts
// web/lib/api/format.ts
export function discountToBps(d: string | null): number | null {
  if (d == null) return null;
  const n = parseFloat(d);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 10000);
}

export function formatBps(bps: number): string {
  if (bps === 0) return "0 bps";
  const sign = bps > 0 ? "+" : "−";
  return `${sign}${Math.abs(bps)} bps`;
}

export function formatUsd(value: string | null, decimals = 2): string {
  if (value == null) return "—";
  const n = parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return `$${n.toFixed(decimals)}`;
}

export function formatSol(value: string | null, decimals = 4): string {
  if (value == null) return "—";
  const n = parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(decimals)} SOL`;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm test format
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/format.ts web/tests/unit/lib/format.test.ts
git commit -m "feat(web): format helpers (bps, usd, sol)"
```

---

## Task 10.2: REST API client

**Files:**
- Create: `web/lib/api/client.ts`

- [ ] **Step 1: Write the client**

```ts
// web/lib/api/client.ts
import type {
  AssetCardData,
  AssetStateResp,
  AlertRow,
  HistoryPoint,
  StatsResponse,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  stats: () => fetchJson<StatsResponse>("/v1/stats"),
  assets: (opts?: { class?: string; peg?: string }) => {
    const q = new URLSearchParams();
    if (opts?.class) q.set("class", opts.class);
    if (opts?.peg) q.set("peg", opts.peg);
    const s = q.toString();
    return fetchJson<AssetCardData[]>(`/v1/assets${s ? `?${s}` : ""}`);
  },
  asset: (symbol: string) => fetchJson<AssetCardData>(`/v1/assets/${encodeURIComponent(symbol)}`),
  assetState: (symbol: string) =>
    fetchJson<AssetStateResp>(`/v1/assets/${encodeURIComponent(symbol)}/state`),
  assetHistory: (
    symbol: string,
    opts?: { bucket?: "raw" | "1m"; from?: string; to?: string; limit?: number },
  ) => {
    const q = new URLSearchParams();
    if (opts?.bucket) q.set("bucket", opts.bucket);
    if (opts?.from) q.set("from", opts.from);
    if (opts?.to) q.set("to", opts.to);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const s = q.toString();
    return fetchJson<HistoryPoint[]>(
      `/v1/assets/${encodeURIComponent(symbol)}/history${s ? `?${s}` : ""}`,
    );
  },
  alerts: (opts?: { asset?: string; class?: string; limit?: number; since?: string }) => {
    const q = new URLSearchParams();
    if (opts?.asset) q.set("asset", opts.asset);
    if (opts?.class) q.set("class", opts.class);
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.since) q.set("since", opts.since);
    const s = q.toString();
    return fetchJson<AlertRow[]>(`/v1/alerts${s ? `?${s}` : ""}`);
  },
};
```

- [ ] **Step 2: Create .env.local.example**

```bash
cat > web/.env.local.example <<EOF
# Copy to .env.local and customize.
# In dev, point to the local Rust API (cargo run -p api-rs).
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/v1/ws
EOF
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/api/client.ts web/.env.local.example
git commit -m "feat(web): typed REST client + .env.example"
```

---

## Task 10.3: WebSocket client + live store

**Files:**
- Create: `web/lib/api/ws.ts`
- Create: `web/lib/store/live-context.tsx`
- Create: `web/tests/unit/lib/ws.test.ts`

- [ ] **Step 1: Write failing test for WS client**

```ts
// web/tests/unit/lib/ws.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsClient } from "@/lib/api/ws";

class MockWS {
  static instances: MockWS[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    MockWS.instances.push(this);
  }
}

beforeEach(() => {
  MockWS.instances.length = 0;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = MockWS as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWsClient", () => {
  it("notifies on update messages", () => {
    const onUpdate = vi.fn();
    const client = createWsClient("ws://x", { onUpdate });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onopen?.(new Event("open"));
    sock.onmessage?.(new MessageEvent("message", {
      data: JSON.stringify({ op: "update", asset: "bSOL", payload: { state: "DRIFT" } }),
    }));
    expect(onUpdate).toHaveBeenCalledWith("bSOL", { state: "DRIFT" });
  });

  it("reconnects with backoff after close", () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const client = createWsClient("ws://x", { onUpdate, initialBackoffMs: 100 });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onclose?.(new CloseEvent("close"));
    expect(MockWS.instances.length).toBe(1);
    vi.advanceTimersByTime(100);
    expect(MockWS.instances.length).toBe(2);
    client.disconnect();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm test ws
```

Expected: FAIL.

- [ ] **Step 3: Implement WS client**

```ts
// web/lib/api/ws.ts
import type { ServerMsg } from "./types";

interface CreateOpts {
  onUpdate: (asset: string, payload: Record<string, unknown>) => void;
  onError?: (msg: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export function createWsClient(url: string, opts: CreateOpts) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let backoff = opts.initialBackoffMs ?? 800;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (stopped) return;
    socket = new WebSocket(url);
    socket.onopen = () => {
      backoff = opts.initialBackoffMs ?? 800;
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        if (msg.op === "update") opts.onUpdate(msg.asset, msg.payload);
        else if (msg.op === "error") opts.onError?.(msg.msg);
      } catch {
        // ignore malformed frame
      }
    };
    socket.onclose = () => {
      if (stopped) return;
      reconnectTimer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    };
    socket.onerror = () => {
      // close handler will fire next
    };
  }

  return {
    connect() { stopped = false; open(); },
    disconnect() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
    send(msg: object) { socket?.send(JSON.stringify(msg)); },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm test ws
```

Expected: PASS.

- [ ] **Step 5: Write the live store**

```tsx
// web/lib/store/live-context.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createWsClient } from "@/lib/api/ws";

type AssetUpdate = Record<string, unknown>;

interface LiveContextValue {
  byAsset: Record<string, AssetUpdate>;
  connected: boolean;
}

const LiveContext = createContext<LiveContextValue>({ byAsset: {}, connected: false });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [byAsset, setByAsset] = useState<Record<string, AssetUpdate>>({});
  const [connected, setConnected] = useState(false);
  const ref = useRef<ReturnType<typeof createWsClient> | null>(null);

  const onUpdate = useCallback((asset: string, payload: AssetUpdate) => {
    setByAsset((prev) => ({ ...prev, [asset]: { ...prev[asset], ...payload } }));
    setConnected(true);
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/v1/ws";
    const client = createWsClient(url, { onUpdate });
    ref.current = client;
    client.connect();
    return () => {
      client.disconnect();
      ref.current = null;
    };
  }, [onUpdate]);

  const value = useMemo(() => ({ byAsset, connected }), [byAsset, connected]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  return useContext(LiveContext);
}

export function useLiveAsset(symbol: string): AssetUpdate | undefined {
  const { byAsset } = useLive();
  return byAsset[symbol];
}
```

- [ ] **Step 6: Commit**

```bash
git add web/lib/api/ws.ts web/lib/store/live-context.tsx web/tests/unit/lib/ws.test.ts
git commit -m "feat(web): WebSocket client with backoff + live React context"
```

---

## Task 10.4: SWR hooks

**Files:**
- Create: `web/lib/hooks/use-stats.ts`
- Create: `web/lib/hooks/use-assets.ts`
- Create: `web/lib/hooks/use-asset.ts`
- Create: `web/lib/hooks/use-history.ts`
- Create: `web/lib/hooks/use-alerts.ts`

- [ ] **Step 1: Write the hooks**

```ts
// web/lib/hooks/use-stats.ts
"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useStats() {
  return useSWR("stats", api.stats, { refreshInterval: 30_000, revalidateOnFocus: true });
}
```

```ts
// web/lib/hooks/use-assets.ts
"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useAssets(opts?: { class?: string; peg?: string }) {
  const key = ["assets", opts?.class ?? "", opts?.peg ?? ""].join("|");
  return useSWR(key, () => api.assets(opts), { refreshInterval: 60_000 });
}
```

```ts
// web/lib/hooks/use-asset.ts
"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useAsset(symbol: string | null) {
  return useSWR(symbol ? `asset/${symbol}` : null, () => (symbol ? api.asset(symbol) : null));
}
```

```ts
// web/lib/hooks/use-history.ts
"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useHistory(
  symbol: string | null,
  opts?: { bucket?: "raw" | "1m"; from?: string; to?: string; limit?: number },
) {
  const key = symbol ? ["history", symbol, JSON.stringify(opts ?? {})].join("|") : null;
  return useSWR(key, () => (symbol ? api.assetHistory(symbol, opts) : null));
}
```

```ts
// web/lib/hooks/use-alerts.ts
"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

export function useAlerts(opts?: { asset?: string; limit?: number; since?: string }) {
  const key = ["alerts", JSON.stringify(opts ?? {})].join("|");
  return useSWR(key, () => api.alerts(opts), { refreshInterval: 30_000 });
}
```

- [ ] **Step 2: Wire LiveProvider into the root layout**

Edit `web/app/layout.tsx`, change the body to wrap children:

```tsx
import { LiveProvider } from "@/lib/store/live-context";
// ... existing imports

// inside the body:
<body>
  <Background />
  <LiveProvider>
    <div className="relative z-[2]">{children}</div>
  </LiveProvider>
</body>
```

- [ ] **Step 3: Update landing to use the real stats hook**

Edit `web/app/page.tsx`:

```tsx
// Replace HomePage body — make it a client component that fetches stats
"use client";

// existing imports plus:
import { useStats } from "@/lib/hooks/use-stats";
import { useAssets } from "@/lib/hooks/use-assets";

export default function HomePage() {
  const { data: stats } = useStats();
  const { data: assets } = useAssets();

  const pegged = stats?.by_state?.PEGGED ?? 12;
  const drift = stats?.by_state?.DRIFT ?? 2;
  const alerts = stats?.alerts_24h ?? 142;
  const count = stats?.assets_tracked ?? 14;

  return (
    <>
      <SiteHeader />
      <main>
        <HeroLanding pegged={pegged} drift={drift} alertsLifetime={alerts} assetsCount={count} />
        <LogoMarquee />
        <MethodologyAccordion />
        <UniverseGrid assets={assets ?? MOCKED} />
        <PingedCTA />
        <Wordmark />
      </main>
      <SiteFooter />
    </>
  );
}
```

(Keep `MOCKED` as fallback for when the API is offline.)

- [ ] **Step 4: Commit**

```bash
git add web/lib/hooks/ web/app/layout.tsx web/app/page.tsx
git commit -m "feat(web): SWR hooks + LiveProvider + wire landing to real data"
```

---

# Phase 11 — Dashboard

## Task 11.1: AssetCard row variant

**Files:**
- Modify: `web/components/molecules/asset-card.tsx`

- [ ] **Step 1: Implement the `RowCard` body in asset-card.tsx**

Replace the stub `RowCard` from Task 5.3 with:

```tsx
function RowCard({
  symbol, state, intrinsicUsd, marketUsd, discountBps, unit = "SOL",
}: AssetCardProps) {
  return (
    <div className="group grid grid-cols-[120px_1fr_1fr_120px_110px] items-baseline gap-4 border-b border-hairline px-4 py-4 transition-colors duration-500 ease-out hover:bg-surface-1/40">
      <div>
        <div className="text-[16px] font-medium tracking-tight">{symbol}</div>
      </div>
      <div className="font-mono text-[12px] tracking-[0.02em] text-text-muted">
        <span className="text-text-muted">intr</span>{" "}
        <span className="text-text">{intrinsicUsd ?? "—"} {unit}</span>
      </div>
      <div className="font-mono text-[12px] tracking-[0.02em] text-text-muted">
        <span className="text-text-muted">mkt</span>{" "}
        <span className="text-text">{marketUsd ?? "—"} {unit}</span>
      </div>
      <div className="text-right font-mono text-[13px] font-medium">
        <span className={
          state === "PEGGED" ? "text-text" :
          state === "DRIFT" ? "text-st-drift" :
          "text-st-depeg"
        }>
          {discountBps != null ? formatBps(discountBps) : "—"}
        </span>
      </div>
      <div className="flex justify-end">
        {state && (
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
            state === "PEGGED" && "text-st-pegged bg-st-pegged/10",
            state === "DRIFT" && "text-st-drift bg-st-drift/10",
            (state === "DEPEG" || state === "CRITICAL" || state === "BLACK_SWAN") && "text-st-depeg bg-st-depeg/15",
            state === "UNKNOWN" && "text-text-muted bg-text-muted/10",
          )}>
            <StatePip state={state} size={5} />
            {stateLabel[state]}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/asset-card.tsx
git commit -m "feat(web): AssetCard row variant for dashboard table"
```

---

## Task 11.2: AlertItem molecule

**Files:**
- Create: `web/components/molecules/alert-item.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/molecules/alert-item.tsx
import type { AlertRow, PegState } from "@/lib/api/types";
import { StatePip } from "@/components/atoms/state-pip";

function relative(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function AlertItem({ alert }: { alert: AlertRow }) {
  return (
    <div className="grid grid-cols-[80px_1fr_auto] items-baseline gap-3 border-b border-hairline px-3 py-2.5">
      <span className="font-mono text-[12px] text-text">{alert.asset}</span>
      <span className="font-mono text-[11px] text-text-muted">
        <span className="lowercase">{alert.from_state}</span>{" "}
        →{" "}
        <span className="inline-flex items-center gap-1 lowercase text-st-drift">
          <StatePip state={alert.to_state as PegState} size={4} />
          {alert.to_state}
        </span>
      </span>
      <span className="font-mono text-[10px] text-text-muted">{relative(alert.detected_at)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/alert-item.tsx
git commit -m "feat(web): AlertItem molecule with relative timestamps"
```

---

## Task 11.3: Dashboard filter row

**Files:**
- Create: `web/components/organisms/dashboard-filters.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/dashboard-filters.tsx
"use client";

import { cn } from "@/lib/utils/cn";

interface FilterState {
  class?: string;
  peg?: string;
}

interface DashboardFiltersProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  view: "table" | "mosaic";
  onViewChange: (v: "table" | "mosaic") => void;
}

const classOpts: Array<{ value?: string; label: string }> = [
  { label: "All" },
  { value: "lst", label: "LSTs" },
  { value: "stable_fiat", label: "Stable·fiat" },
  { value: "stable_cdp", label: "Synth·CDP" },
  { value: "stable_dn", label: "Synth·DN" },
  { value: "stable_fx", label: "FX" },
];

export function DashboardFilters({
  value, onChange, view, onViewChange,
}: DashboardFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-4">
      <div className="flex gap-1">
        {classOpts.map((o) => (
          <button
            key={o.label}
            onClick={() => onChange({ ...value, class: o.value })}
            className={cn(
              "border border-hairline px-3 py-1 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors duration-500",
              value.class === o.value ? "border-text bg-text text-canvas" : "text-text-muted hover:border-outline hover:text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex gap-1">
        {(["table", "mosaic"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            className={cn(
              "border border-hairline px-3 py-1 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors duration-500",
              view === v ? "border-text text-text" : "text-text-muted hover:border-outline hover:text-text",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/dashboard-filters.tsx
git commit -m "feat(web): dashboard filter row with class chips + view toggle"
```

---

## Task 11.4: Live alerts sidebar

**Files:**
- Create: `web/components/organisms/alerts-sidebar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/alerts-sidebar.tsx
"use client";

import { useAlerts } from "@/lib/hooks/use-alerts";
import { AlertItem } from "@/components/molecules/alert-item";

export function AlertsSidebar() {
  const { data, isLoading, error } = useAlerts({ limit: 30 });

  return (
    <aside className="sticky top-6 h-[calc(100vh-4rem)] overflow-y-auto border border-hairline">
      <div className="border-b border-hairline px-4 py-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Live alerts
        </h3>
      </div>
      {isLoading && <div className="p-4 font-mono text-[11px] text-text-muted">Loading…</div>}
      {error && <div className="p-4 font-mono text-[11px] text-st-depeg">API unreachable</div>}
      {data && data.length === 0 && (
        <div className="p-4 font-mono text-[11px] text-text-muted">No recent alerts.</div>
      )}
      {data?.map((a) => <AlertItem key={a.id} alert={a} />)}
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/alerts-sidebar.tsx
git commit -m "feat(web): AlertsSidebar organism (SWR-backed)"
```

---

## Task 11.5: Compose /dashboard page

**Files:**
- Create: `web/app/dashboard/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// web/app/dashboard/page.tsx
"use client";

import { useState } from "react";
import { SiteHeader } from "@/components/organisms/site-header";
import { SiteFooter } from "@/components/organisms/site-footer";
import { DashboardFilters } from "@/components/organisms/dashboard-filters";
import { AlertsSidebar } from "@/components/organisms/alerts-sidebar";
import { AssetCard } from "@/components/molecules/asset-card";
import { AssetPortrait } from "@/components/molecules/asset-portrait";
import { useAssets } from "@/lib/hooks/use-assets";
import { useLive } from "@/lib/store/live-context";
import { discountToBps } from "@/lib/api/format";
import Link from "next/link";

export default function DashboardPage() {
  const [filter, setFilter] = useState<{ class?: string; peg?: string }>({});
  const [view, setView] = useState<"table" | "mosaic">("table");
  const { data: assets, error, isLoading } = useAssets(filter);
  const { byAsset } = useLive();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-[1280px] gap-6 px-8 pt-10 lg:grid-cols-[1fr_320px]">
        <section>
          <h1 className="mb-6 text-[36px] font-medium tracking-tight">Universe</h1>
          <div className="border border-hairline">
            <DashboardFilters
              value={filter}
              onChange={setFilter}
              view={view}
              onViewChange={setView}
            />
            {isLoading && <div className="p-6 font-mono text-[12px] text-text-muted">Loading…</div>}
            {error && <div className="p-6 font-mono text-[12px] text-st-depeg">API unreachable.</div>}
            {assets && view === "table" && (
              <div>
                {assets.map((a) => {
                  const live = byAsset[a.symbol];
                  const liveBps = live && typeof live.discount === "string" ? discountToBps(live.discount as string) : null;
                  const bps = liveBps ?? discountToBps(a.discount);
                  return (
                    <Link key={a.symbol} href={`/asset/${a.symbol}`} className="block">
                      <AssetCard
                        variant="row"
                        symbol={a.symbol}
                        state={(live?.state as typeof a.state) ?? a.state}
                        intrinsicUsd={a.intrinsic_usd}
                        marketUsd={a.market_usd}
                        discountBps={bps ?? undefined}
                        unit={a.peg_target === "USD" ? "USD" : "SOL"}
                      />
                    </Link>
                  );
                })}
              </div>
            )}
            {assets && view === "mosaic" && (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {assets.map((a, i) => (
                  <Link key={a.symbol} href={`/asset/${a.symbol}`}>
                    <AssetPortrait
                      symbol={a.symbol}
                      category={`${a.class.toUpperCase()} · ${a.peg_target}`}
                      state={(a.state ?? "UNKNOWN") as Parameters<typeof AssetPortrait>[0]["state"]}
                      bps={discountToBps(a.discount) ?? 0}
                      index={i}
                    />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
        <AlertsSidebar />
      </main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 2: Verify dashboard renders**

Run `pnpm dev`, navigate to localhost:3000/dashboard. With the API offline, expect the "API unreachable" message in both panels. Confirm filter chips and view toggle work visually.

- [ ] **Step 3: Commit**

```bash
git add web/app/dashboard/page.tsx
git commit -m "feat(web): /dashboard page (filters + table/mosaic + live alerts)"
```

---

# Phase 12 — Asset detail

## Task 12.1: AssetCard detail variant

**Files:**
- Modify: `web/components/molecules/asset-card.tsx`

- [ ] **Step 1: Implement the `DetailCard` body**

Replace the stub `DetailCard` from Task 5.3 with:

```tsx
function DetailCard({
  symbol, state, intrinsicUsd, marketUsd, discountBps, unit = "SOL",
}: AssetCardProps) {
  return (
    <div className="grid gap-6 border-b border-hairline px-8 py-10 md:grid-cols-[1fr_auto]">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">Asset</div>
        <h1 className="mt-2 text-[64px] font-medium leading-none tracking-[-0.035em]">{symbol}</h1>
        {state && (
          <div className={cn(
            "mt-4 inline-flex items-center gap-2 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em]",
            state === "PEGGED" && "text-st-pegged bg-st-pegged/10",
            state === "DRIFT" && "text-st-drift bg-st-drift/10",
            (state === "DEPEG" || state === "CRITICAL" || state === "BLACK_SWAN") && "text-st-depeg bg-st-depeg/15",
          )}>
            <StatePip state={state} size={6} />
            {stateLabel[state]}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-6 font-mono text-[13px]">
        <div>
          <div className="text-text-muted">intrinsic</div>
          <div className="mt-1 text-text">{intrinsicUsd ?? "—"} {unit}</div>
        </div>
        <div>
          <div className="text-text-muted">market</div>
          <div className="mt-1 text-text">{marketUsd ?? "—"} {unit}</div>
        </div>
        <div>
          <div className="text-text-muted">discount</div>
          <div className="mt-1 text-st-drift">{discountBps != null ? formatBps(discountBps) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/molecules/asset-card.tsx
git commit -m "feat(web): AssetCard detail variant for /asset/[symbol] header"
```

---

## Task 12.2: AssetChart with Recharts + threshold lines

**Files:**
- Create: `web/components/organisms/asset-chart.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/asset-chart.tsx
"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useHistory } from "@/lib/hooks/use-history";
import { cn } from "@/lib/utils/cn";

type Bucket = "1h" | "24h" | "7d" | "30d";

interface AssetChartProps {
  symbol: string;
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number };
}

function bucketParams(b: Bucket): { bucket: "raw" | "1m"; from: string; limit: number } {
  const now = Date.now();
  const ranges: Record<Bucket, number> = {
    "1h": 60 * 60_000,
    "24h": 24 * 60 * 60_000,
    "7d":  7 * 24 * 60 * 60_000,
    "30d": 30 * 24 * 60 * 60_000,
  };
  const ms = ranges[b];
  return {
    bucket: ms <= ranges["1h"] ? "raw" : "1m",
    from: new Date(now - ms).toISOString(),
    limit: 2000,
  };
}

export function AssetChart({ symbol, thresholds }: AssetChartProps) {
  const [bucket, setBucket] = useState<Bucket>("24h");
  const { data, isLoading } = useHistory(symbol, bucketParams(bucket));

  const chartData =
    data?.map((p) => ({
      ts: new Date(p.ts).getTime(),
      bps: Math.round(parseFloat(p.discount) * 10000),
    })) ?? [];

  return (
    <section className="px-8 py-12">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Discount · history
        </h2>
        <div className="flex gap-1">
          {(["1h", "24h", "7d", "30d"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={cn(
                "border border-hairline px-3 py-1 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors duration-500",
                bucket === b ? "border-text bg-text text-canvas" : "text-text-muted hover:border-outline hover:text-text",
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[300px] w-full border border-hairline">
        {isLoading && (
          <div className="flex h-full items-center justify-center font-mono text-[12px] text-text-muted">
            Loading…
          </div>
        )}
        {!isLoading && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
              <defs>
                <linearGradient id="bps-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff8400" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ff8400" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="ts"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => new Date(v).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--color-text-muted)" }}
                stroke="var(--color-hairline)"
              />
              <YAxis
                dataKey="bps"
                tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--color-text-muted)" }}
                stroke="var(--color-hairline)"
                tickFormatter={(v) => `${v}`}
                width={48}
              />
              <ReferenceLine y={-thresholds.drift_bps} stroke="var(--color-hairline)" strokeDasharray="2 4" label={{ value: `−${thresholds.drift_bps}bps · DRIFT`, fill: "var(--color-text-muted)", fontSize: 10, position: "right" }} />
              <ReferenceLine y={-thresholds.depeg_bps} stroke="var(--color-hairline)" strokeDasharray="2 4" label={{ value: `−${thresholds.depeg_bps}bps · DEPEG`, fill: "var(--color-text-muted)", fontSize: 10, position: "right" }} />
              <Tooltip
                cursor={{ stroke: "var(--color-outline)", strokeDasharray: 4 }}
                contentStyle={{
                  background: "var(--color-canvas)",
                  border: "1px solid var(--color-hairline)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
                labelFormatter={(v) => new Date(v as number).toLocaleString()}
                formatter={(v) => [`${v} bps`, "discount"]}
              />
              <Area type="monotone" dataKey="bps" stroke="#ff8400" strokeWidth={1.5} fill="url(#bps-fill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/asset-chart.tsx
git commit -m "feat(web): AssetChart organism with Recharts + threshold reference lines"
```

---

## Task 12.3: AssetSpec block

**Files:**
- Create: `web/components/organisms/asset-spec.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/components/organisms/asset-spec.tsx
import type { AssetCardData } from "@/lib/api/types";

const intrinsicLabel: Record<string, string> = {
  lst: "Sanctum sol_value × Pyth SOL/USD",
  stable_fiat: "Canonical 1.0000 USD",
  stable_cdp: "Hylo on-chain collateralization ratio",
  stable_dn: "Pyth latest (delta-neutral)",
  stable_fx: "Pyth fiat-pair cross",
  stable_rwa: "Pyth latest (RWA)",
};

export function AssetSpec({ asset }: { asset: AssetCardData }) {
  return (
    <section className="grid gap-y-3 border-t border-hairline px-8 py-10 font-mono text-[12px] md:grid-cols-[180px_1fr]">
      <span className="text-text-muted">Mint</span>
      <span className="break-all text-text">{asset.mint || "—"}</span>

      <span className="text-text-muted">Decimals</span>
      <span className="text-text">{asset.decimals}</span>

      <span className="text-text-muted">Class</span>
      <span className="text-text">{asset.class}</span>

      <span className="text-text-muted">Peg target</span>
      <span className="text-text">{asset.peg_target}</span>

      <span className="text-text-muted">Intrinsic strategy</span>
      <span className="text-text">{intrinsicLabel[asset.class] ?? "—"}</span>

      <span className="text-text-muted">Market source</span>
      <span className="text-text">Jupiter route quote → Pyth USD reprice</span>

      <span className="text-text-muted">Last updated</span>
      <span className="text-text">{asset.updated_at ? new Date(asset.updated_at).toLocaleString() : "—"}</span>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/organisms/asset-spec.tsx
git commit -m "feat(web): AssetSpec organism"
```

---

## Task 12.4: Compose /asset/[symbol] page

**Files:**
- Create: `web/app/asset/[symbol]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// web/app/asset/[symbol]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/organisms/site-header";
import { SiteFooter } from "@/components/organisms/site-footer";
import { AssetCard } from "@/components/molecules/asset-card";
import { AssetChart } from "@/components/organisms/asset-chart";
import { AssetSpec } from "@/components/organisms/asset-spec";
import { useAsset } from "@/lib/hooks/use-asset";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { AlertItem } from "@/components/molecules/alert-item";
import { discountToBps } from "@/lib/api/format";

const DEFAULT_THRESHOLDS = { drift_bps: 20, depeg_bps: 100, critical_bps: 300 };

export default function AssetPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = params?.symbol;
  const { data: asset, error, isLoading } = useAsset(symbol ?? null);
  const { data: alerts } = useAlerts({ asset: symbol, limit: 30 });

  if (isLoading || !symbol) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-[1280px] px-8 py-16 font-mono text-[12px] text-text-muted">Loading…</main>
        <SiteFooter />
      </>
    );
  }
  if (error || !asset) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-[1280px] px-8 py-16 font-mono text-[12px] text-st-depeg">Asset not found or API unreachable.</main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1280px]">
        <AssetCard
          variant="detail"
          symbol={asset.symbol}
          state={asset.state}
          intrinsicUsd={asset.intrinsic_usd}
          marketUsd={asset.market_usd}
          discountBps={discountToBps(asset.discount) ?? null}
          unit={asset.peg_target === "USD" ? "USD" : "SOL"}
        />
        <AssetChart symbol={asset.symbol} thresholds={DEFAULT_THRESHOLDS} />
        <section className="border-t border-hairline px-8 py-10">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Recent alerts
          </h3>
          {alerts && alerts.length === 0 && (
            <p className="font-mono text-[12px] text-text-muted">No alerts in this window.</p>
          )}
          {alerts?.map((a) => <AlertItem key={a.id} alert={a} />)}
        </section>
        <AssetSpec asset={asset} />
      </main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/asset/[symbol]/page.tsx
git commit -m "feat(web): /asset/[symbol] page (header + chart + alerts + spec)"
```

---

# Phase 13 — Responsive pass

## Task 13.1: Test each breakpoint, patch where broken

**Files:**
- Modify (potentially): every organism file

- [ ] **Step 1: Open responsive devtools at each width**

Run `pnpm dev` and open localhost:3000 in browser devtools at widths: 1440, 1280, 1024, 768, 480, 360. For each, scroll the landing top-to-bottom and verify:

| Width | Expected behaviour |
|-------|-------------------|
| 1440 | Full hero, 7-col portrait grid, 5-col footer |
| 1024 | Title shrinks to 88px, portrait grid drops to 6 cols, asset card moves below stat panel |
| 768 | Title 64px, all 2-col sections stack, portrait grid 4 cols |
| 480 | Title 48px, portrait grid 3 cols, footer collapses to 2 cols |
| 360 | Title 36px, portrait grid 2 cols, footer 1 col |

- [ ] **Step 2: Patch broken sections**

For each section that breaks, edit the corresponding organism file. Most layout shifts are already handled by the `md:` / `lg:` Tailwind classes in the components written in Phases 5–9 — touch only what visibly breaks.

Common likely patches:
- `hero-landing.tsx` — title size already responsive with `sm:` `lg:` prefixes; verify wrapping
- `universe-grid.tsx` — grid columns already cascade `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7` — should be OK
- `site-footer.tsx` — `md:grid-cols-[2.4fr_1fr_1fr_1fr_1fr]` already collapses to single column below md. May need a `gap` adjustment

- [ ] **Step 3: Commit**

```bash
git add web/components
git commit -m "fix(web): responsive pass — verified 360/480/768/1024/1440"
```

---

# Phase 14 — a11y + reduced-motion

## Task 14.1: Verify reduced-motion + focus rings

**Files:**
- Modify: `web/app/globals.css`

- [ ] **Step 1: Add focus-visible styles**

Append to `web/app/globals.css`:

```css
:focus-visible {
  outline: 1px solid var(--color-text);
  outline-offset: 2px;
}
a:focus-visible, button:focus-visible {
  outline-offset: 3px;
}
```

- [ ] **Step 2: Verify reduced-motion**

In macOS System Preferences → Accessibility → Display, enable "Reduce motion". Reload localhost:3000. Expected:
- Word reveal stagger no longer animates (words appear instantly)
- Marquee still loops (it's continuous, but consider stopping it — see step 3)
- Counter renders final value immediately (Counter atom already guards this)
- State pip pulse does not animate
- Mouse spotlight tracking is disabled (useSpotlight already guards this)

- [ ] **Step 3: Stop the marquee under reduced-motion**

Append to `web/app/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none !important; transform: none !important; }
}
```

- [ ] **Step 4: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(web): a11y — focus-visible rings + reduced-motion guards"
```

---

## Task 14.2: Keyboard navigation + screen-reader pass

- [ ] **Step 1: Tab through landing**

Run `pnpm dev`, open localhost:3000, press Tab repeatedly. Verify every interactive element receives a visible focus ring in order: brand link → nav links → Get the bot CTA → announcement pill → CTA buttons → footer links. No element should be unreachable or skipped.

- [ ] **Step 2: Screen-reader spot check**

On macOS, enable VoiceOver (Cmd+F5). Listen through the hero. Verify:
- Announcement pill reads "12 pegged, 2 drift, Live, arrow" (or equivalent)
- StatePip is silent (it's `aria-hidden`)
- MouseSpotlight / DotGrid are silent (both `aria-hidden`)
- Telegram bubble reads its full text content

If any are broken, add `aria-label` or adjust `aria-hidden` on the affected component.

- [ ] **Step 3: Commit any fixes**

```bash
git add web
git commit -m "fix(web): a11y — keyboard nav + screen-reader pass"
```

---

# Phase 15 — Deploy

## Task 15.1: Vercel project setup

**Files:**
- Create: `web/vercel.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add Vercel config**

```json
// web/vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "pnpm install --frozen-lockfile && pnpm build",
  "installCommand": "echo skip (handled in buildCommand)",
  "outputDirectory": ".next"
}
```

- [ ] **Step 2: Ensure `.next` is gitignored**

Verify root `.gitignore` includes `web/.next/` and `web/node_modules/` (Next default scaffold creates `web/.gitignore` which handles this — confirm).

- [ ] **Step 3: Link the project**

```bash
cd web && pnpm dlx vercel link
```

Follow prompts: link to the user's Vercel team and select "Create new project" → name `pegana-web`.

- [ ] **Step 4: Set environment variables**

```bash
cd web
pnpm dlx vercel env add NEXT_PUBLIC_API_BASE production
# Enter: https://api.pegana.xyz (or whatever the production API will be)
pnpm dlx vercel env add NEXT_PUBLIC_WS_URL production
# Enter: wss://api.pegana.xyz/v1/ws
```

Repeat for `preview` and `development` environments, pointing to staging or localhost as appropriate.

- [ ] **Step 5: Commit**

```bash
cd ..
git add web/vercel.json
git commit -m "feat(web): vercel project config"
```

---

## Task 15.2: First deploy + smoke test

- [ ] **Step 1: Deploy preview**

```bash
cd web && pnpm dlx vercel
```

Wait for build to complete. Vercel returns a preview URL like `https://pegana-web-xxxxx.vercel.app`.

- [ ] **Step 2: Smoke test preview**

Open the preview URL. Expected:
- Landing renders identical to local
- Mouse spotlight tracks
- Hero counter ramps to 14 / 142 (or shows the SWR fallback if API is unreachable)
- Marquee scrolls
- Dashboard route loads (will show "API unreachable" until VPS is up)
- Asset detail route loads with error placeholder

- [ ] **Step 3: Promote to production**

```bash
cd web && pnpm dlx vercel --prod
```

Vercel deploys to production and the apex domain. If a custom domain (e.g. `pegana.xyz`) is set up, point it to the project in the Vercel dashboard.

- [ ] **Step 4: Commit deploy log marker**

```bash
cd ..
git commit --allow-empty -m "chore(web): v1 frontend deployed to production"
```

---

## Self-Review

### Spec coverage check

Walking the spec section by section to confirm every requirement has a task:

- §1 Scope (3 surfaces): Phase 9 covers landing, Phase 11 dashboard, Phase 12 asset detail ✓
- §1 Stack: Phase 1 covers Next + Tailwind + shadcn; Phase 10 covers SWR + API client; Recharts in Phase 12; Framer Motion used in hero/portrait/wordmark ✓
- §2 IA — routes: Phase 9 (`/`), Phase 11 (`/dashboard`), Phase 12 (`/asset/[symbol]`) ✓ — `/methodology`, `/api`, `/changelog` are linked but no page yet → noted as out-of-scope for v1
- §3 Landing structure — 7 sections all in Phases 4–9 ✓
- §4 Brand tokens — defined in Task 1.4 ✓
- §5 Components inventory — every component has a task ✓
- §6 Animation contract — word-reveal (Task 5.4), counter (Task 2.4), spotlight (Task 3.1), marquee (Task 2.6), section reveal (Framer's `whileInView` in portraits / wordmark; landing organisms use the `motion` patterns inline) ✓
- §7 Data contracts — Phase 10 ✓
- §8 Background interactions — Phase 3 ✓
- §9 Responsiveness — Phase 13 ✓
- §10 Accessibility — Phase 14 ✓
- §11 Build order — followed phase 1→15 ✓

### Placeholder scan

- No "TBD", "TODO", "implement later", "appropriate", or "similar to Task N" present in the plan body
- One forward reference: Task 5.3 stubs `RowCard` and `DetailCard`; the stubs are replaced in Task 11.1 and 12.1 — both tasks reference Task 5.3 explicitly and show the full replacement code

### Type consistency

- `AssetCard` variant prop matches between Task 5.3 (defined) and Tasks 11.1, 12.1 (used) ✓
- `PegState` type imported consistently from `@/lib/api/types` across all components ✓
- `useAssets()` / `useAsset()` / `useAlerts()` signatures match the calls in dashboard and asset detail pages ✓
- `formatBps()` defined twice — once locally in `asset-card.tsx` (Task 5.3) and once exported from `format.ts` (Task 10.1). Both implementations agree. Could be refactored to a single export, but TDD discipline says ship working code first; consolidating is a small follow-up not worth a dedicated task.

No issues found that block execution.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-frontend-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
