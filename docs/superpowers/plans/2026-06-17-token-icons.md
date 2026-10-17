# Token Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a per-asset token logo (circle + hairline ring) next to the symbol on all 9 asset-rendering surfaces of the Pegana web app, sourced and vendored at build time with a branded monogram fallback that never breaks.

**Architecture:** A build-time Node script (`vendor-token-icons.mjs`) reads `assets.toml`, resolves each mint's logo through a cascade (manual override → Jupiter Token API v2 → monogram), downloads + normalizes to a 96×96 WebP under `web/public/tokens/{mint}.webp`, and writes a provenance `manifest.json`. A single client atom `<TokenIcon mint symbol klass size>` renders `/tokens/{mint}.webp` inside a circular ring and swaps to a class-tinted monogram on `onError`. A vitest coverage test cross-checks `assets.toml` against the manifest so a new asset without an icon fails CI.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 (web), vitest + @testing-library/react (tests), Node ≥20 build script using `sharp` (image normalize) + `smol-toml` (parse `assets.toml`). Package manager: **Bun** (`web/bun.lock` is the lockfile).

---

## Pre-flight notes (read before starting)

- **`web/AGENTS.md` rule:** this is a modified Next.js 16 — read the relevant guide in `web/node_modules/next/dist/docs/` before writing any Next-specific code. Nothing here uses exotic Next APIs (plain `<img>`, client component), but heed it.
- **Brand (`brand.md`):** circular token avatars are allowed even though cards are sharp/0px. Mono font (JetBrains Mono) only for the monogram initials. No glow/CRT. Disc background is `--color-surface-2` (`#141414`).
- **Package manager:** use `bun` (`bun add -d …`, `bun run …`). `web/bun.lock` is authoritative — do **not** introduce a different lockfile. (If `bun` is unavailable in your env, `npm` works for a one-off, but do not commit a non-bun lockfile.)
- **Branch:** all work happens on a dedicated feature branch (set up by the execution skill), never directly on `main`.
- **Backend untouched:** this is frontend-only. Do not run `deploy.sh` or touch engine/indexer/api/dispatcher — calibration must stay intact. Web ships via Vercel-on-push.
- All commands below run from `web/` unless stated otherwise.

## File Structure

| File | Responsibility |
|---|---|
| `web/lib/token-icons/monogram.ts` | Pure helpers: `monogramInitials(symbol)` + `classTint(klass)`. No React. |
| `web/components/atoms/token-icon.tsx` | The `<TokenIcon>` client atom: img + ring, monogram on error. |
| `web/lib/token-icons/overrides.json` | Build-time mint→URL override map (starts `{}`). |
| `web/scripts/vendor-token-icons.mjs` | Build script: resolve cascade, download, normalize, write files + manifest. |
| `web/public/tokens/{mint}.webp` (×26) | Vendored, committed logo files (build output). |
| `web/public/tokens/manifest.json` | Provenance per mint (committed build output). |
| `web/tests/atoms/token-icon.test.tsx` | Unit tests for the atom. |
| `web/tests/lib/token-icons.test.ts` | Unit tests for monogram/tint helpers. |
| `web/tests/token-icons-coverage.test.ts` | CI guard: every active mint has a non-monogram icon. |
| 9 existing surface files | Drop `<TokenIcon>` next to the symbol (see Tasks 7–9). |

---

## Task 1: Add build dependencies + npm script

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Add dev dependencies**

Run (from `web/`):
```bash
bun add -d sharp smol-toml
```
Expected: `package.json` gains `sharp` and `smol-toml` under `devDependencies`; `bun.lock` updates.

- [ ] **Step 2: Add the sync + check scripts**

In `web/package.json`, add to the `"scripts"` object:
```json
    "icons:sync": "node scripts/vendor-token-icons.mjs"
```

- [ ] **Step 3: Verify install + typecheck still clean**

Run:
```bash
bun run typecheck
```
Expected: PASS (no new TS yet).

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/bun.lock
git commit -m "chore(web): add sharp + smol-toml for token-icon vendoring"
```

---

## Task 2: Monogram + class-tint helpers (TDD)

**Files:**
- Create: `web/lib/token-icons/monogram.ts`
- Test: `web/tests/lib/token-icons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/token-icons.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { monogramInitials, classTint } from "@/lib/token-icons/monogram";

describe("monogramInitials", () => {
  it("takes the first two alphanumerics, preserving case", () => {
    expect(monogramInitials("USDC")).toBe("US");
    expect(monogramInitials("jitoSOL")).toBe("ji");
    expect(monogramInitials("hyloSOL+")).toBe("hy");
    expect(monogramInitials("sHYUSD")).toBe("sH");
    expect(monogramInitials("JLP")).toBe("JL");
  });
  it("is deterministic for the same symbol", () => {
    expect(monogramInitials("vSOL")).toBe(monogramInitials("vSOL"));
  });
  it("falls back to ? for an empty/symbol-less input", () => {
    expect(monogramInitials("+++")).toBe("?");
  });
});

describe("classTint", () => {
  it("maps each known class to a stable hex", () => {
    expect(classTint("lst")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(classTint("stable_yield")).toBe("#6bd697");
    expect(classTint("synth_lev")).toBe("#ff8a5b");
  });
  it("defaults to the muted neutral for an unknown/undefined class", () => {
    expect(classTint(undefined)).toBe("#9aa9b8");
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `bun run test -- token-icons`
Expected: FAIL — `Cannot find module '@/lib/token-icons/monogram'`.

- [ ] **Step 3: Implement the helper**

Create `web/lib/token-icons/monogram.ts`:
```ts
import type { AssetClass } from "@/lib/api/types";

// Muted, on-brand tints used ONLY by the monogram fallback (rare). Keyed by the
// asset's structural class so a missing logo still reads as the right family.
const CLASS_TINT: Record<AssetClass, string> = {
  lst: "#7c8cf8",          // SOL-family indigo
  stable_fiat: "#5aa9d6",  // cool blue
  stable_cdp: "#6bd6b0",   // teal
  stable_rwa: "#c9a86a",   // gold
  stable_dn: "#b07cd6",    // violet
  stable_fx: "#6b9fd6",    // blue
  stable_yield: "#6bd697", // green
  synth_lev: "#ff8a5b",    // coral
};

const NEUTRAL = "#9aa9b8";

export function classTint(klass: AssetClass | undefined): string {
  return (klass && CLASS_TINT[klass]) || NEUTRAL;
}

/** First two alphanumeric characters of the symbol, case preserved. */
export function monogramInitials(symbol: string): string {
  const cleaned = symbol.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.slice(0, 2) || "?";
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `bun run test -- token-icons`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add web/lib/token-icons/monogram.ts web/tests/lib/token-icons.test.ts
git commit -m "feat(web): add token-icon monogram + class-tint helpers"
```

---

## Task 3: The `<TokenIcon>` atom (TDD)

**Files:**
- Create: `web/components/atoms/token-icon.tsx`
- Test: `web/tests/atoms/token-icon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/tests/atoms/token-icon.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenIcon } from "@/components/atoms/token-icon";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("TokenIcon", () => {
  it("renders an <img> pointing at the vendored webp for the mint", () => {
    const { container } = render(<TokenIcon mint={MINT} symbol="USDC" klass="stable_fiat" />);
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(`/tokens/${MINT}.webp`);
  });

  it("falls back to a class-tinted monogram when the image errors", () => {
    const { container } = render(<TokenIcon mint={MINT} symbol="USDC" klass="stable_fiat" />);
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("US")).toBeTruthy();
  });

  it("is decorative by default (aria-hidden, empty alt)", () => {
    const { container } = render(<TokenIcon mint={MINT} symbol="USDC" />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("exposes an accessible label when not decorative", () => {
    render(<TokenIcon mint={MINT} symbol="USDC" decorative={false} />);
    expect(screen.getByRole("img", { name: "USDC logo" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `bun run test -- token-icon`
Expected: FAIL — `Cannot find module '@/components/atoms/token-icon'`.

- [ ] **Step 3: Implement the atom**

Create `web/components/atoms/token-icon.tsx`:
```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { AssetClass } from "@/lib/api/types";
import { monogramInitials, classTint } from "@/lib/token-icons/monogram";

interface TokenIconProps {
  /** SPL mint — selects the vendored file `/tokens/{mint}.webp`. */
  mint: string;
  /** Used for the monogram initials and the accessible label. */
  symbol: string;
  /** Tints the monogram fallback by asset family. */
  klass?: AssetClass;
  /** Rendered px (square). Default 24. */
  size?: number;
  className?: string;
  /** Override the accessible label (default `${symbol} logo`). */
  alt?: string;
  /** When the symbol text sits adjacent (the common case) keep the icon out of
   *  the a11y tree to avoid a duplicate announcement. Default true. */
  decorative?: boolean;
  /** Image loading hint — eager for above-the-fold (asset hero). Default lazy. */
  loading?: "lazy" | "eager";
}

export function TokenIcon({
  mint,
  symbol,
  klass,
  size = 24,
  className,
  alt,
  decorative = true,
  loading = "lazy",
}: TokenIconProps) {
  const [failed, setFailed] = useState(false);
  const tint = classTint(klass);

  const wrapperA11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": alt ?? `${symbol} logo` } as const);

  return (
    <span
      {...wrapperA11y}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow: failed
          ? `inset 0 0 0 1px ${tint}66`
          : "inset 0 0 0 1px rgba(255,255,255,0.14)",
      }}
    >
      {failed ? (
        <span
          className="font-mono font-semibold leading-none"
          style={{ fontSize: Math.round(size * 0.38), color: tint, letterSpacing: "-0.02em" }}
        >
          {monogramInitials(symbol)}
        </span>
      ) : (
        <img
          src={`/tokens/${mint}.webp`}
          width={size}
          height={size}
          alt={decorative ? "" : alt ?? `${symbol} logo`}
          loading={loading}
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `bun run test -- token-icon`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add web/components/atoms/token-icon.tsx web/tests/atoms/token-icon.test.tsx
git commit -m "feat(web): add TokenIcon atom (circle+ring, monogram fallback)"
```

---

## Task 4: Vendor script + overrides + run it

**Files:**
- Create: `web/lib/token-icons/overrides.json`
- Create: `web/scripts/vendor-token-icons.mjs`
- Create (generated): `web/public/tokens/*.webp`, `web/public/tokens/manifest.json`

> **Cascade note (YAGNI):** The spec lists a Metaplex on-chain resolution step between Jupiter and the monogram. It is intentionally **not** implemented here — a live probe (2026-06-17) confirmed Jupiter v2 returns an `icon` for all 26 active mints, so the override → Jupiter → monogram cascade gives 100% coverage today. Add a Metaplex step only if a future asset is ever missing from Jupiter (the coverage test in Task 5 will flag it).

- [ ] **Step 1: Create the (empty) override map**

Create `web/lib/token-icons/overrides.json`:
```json
{}
```

- [ ] **Step 2: Write the vendor script**

Create `web/scripts/vendor-token-icons.mjs`:
```js
#!/usr/bin/env node
// Build-time token-icon vendoring. Reads assets.toml, resolves each mint's logo
// through override -> Jupiter Token API v2, downloads + normalizes to a 96x96
// WebP under public/tokens/{mint}.webp, and writes a provenance manifest.json.
// Re-run with `bun run icons:sync` when assets change. Output is committed, so
// production never hits the network to render an icon.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = join(WEB_ROOT, "public", "tokens");
const ASSETS_TOML = join(REPO_ROOT, "assets.toml");
const OVERRIDES = join(WEB_ROOT, "lib", "token-icons", "overrides.json");
const SIZE = 96;

const JUP_KEY = process.env.JUP_API_KEY || process.env.JUPITER_API_KEY || "";
const JUP_BASE = JUP_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";

async function jupiterIcons(mints) {
  // v2 search accepts up to 100 comma-separated mints per call.
  const url = `${JUP_BASE}/tokens/v2/search?query=${mints.join(",")}`;
  const res = await fetch(url, { headers: JUP_KEY ? { "x-api-key": JUP_KEY } : {} });
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
  const arr = await res.json();
  const map = new Map();
  for (const t of arr) {
    const id = t.id || t.address;
    if (id && t.icon) map.set(id, t.icon);
  }
  return map;
}

async function fetchBytes(url) {
  if (url.startsWith("file:")) return readFileSync(url.slice("file:".length));
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const toml = parseToml(readFileSync(ASSETS_TOML, "utf8"));
  const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
  const assets = (toml.assets ?? []).filter((a) => a.active !== false);
  const mints = assets.map((a) => a.mint);

  let jup = new Map();
  try {
    jup = await jupiterIcons(mints);
  } catch (e) {
    console.warn(`! Jupiter batch lookup failed: ${e.message} (overrides only)`);
  }

  const manifest = [];
  for (const a of assets) {
    const candidates = [];
    if (overrides[a.mint]) candidates.push(["override", overrides[a.mint]]);
    if (jup.get(a.mint)) candidates.push(["jupiter", jup.get(a.mint)]);

    let resolved = null;
    for (const [source, url] of candidates) {
      try {
        const buf = await fetchBytes(url);
        await sharp(buf, { density: 384 })
          .resize(SIZE, SIZE, { fit: "cover" })
          .webp({ quality: 90 })
          .toFile(join(OUT_DIR, `${a.mint}.webp`));
        resolved = { source, url };
        break;
      } catch (e) {
        console.warn(`  ${a.symbol}: ${source} failed — ${e.message}`);
      }
    }

    if (resolved) {
      const bytes = statSync(join(OUT_DIR, `${a.mint}.webp`)).size;
      manifest.push({ mint: a.mint, symbol: a.symbol, source: resolved.source, url: resolved.url, bytes });
      console.log(`  ok ${a.symbol.padEnd(10)} <- ${resolved.source}`);
    } else {
      manifest.push({ mint: a.mint, symbol: a.symbol, source: "monogram" });
      console.warn(`  MONOGRAM ${a.symbol} — no icon source resolved`);
    }
  }

  manifest.sort((x, y) => x.symbol.localeCompare(y.symbol));
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const fallbacks = manifest.filter((m) => m.source === "monogram");
  console.log(`\n${manifest.length} assets vendored, ${fallbacks.length} monogram fallback(s).`);
  if (fallbacks.length) {
    console.log(`Add an override in lib/token-icons/overrides.json for: ${fallbacks.map((f) => f.symbol).join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run the vendoring (needs network)**

Run (from `web/`):
```bash
bun run icons:sync
```
Expected: ~26 `ok <symbol> <- jupiter` lines, then `26 assets vendored, 0 monogram fallback(s).` If any line says `MONOGRAM <symbol>` or a download failed, see Step 4. Confirm files exist:
```bash
ls public/tokens/*.webp | wc -l   # expect 26
cat public/tokens/manifest.json | head -20
```

- [ ] **Step 4: Repair any straggler via override (only if Step 3 reported one)**

If a symbol fell to monogram or its logo is visibly wrong/low-res, add an entry to `web/lib/token-icons/overrides.json` mapping its mint to a known-good direct-image URL (or `file:./path/to/local.png`), then re-run `bun run icons:sync`. Example shape:
```json
{ "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr": "https://<direct-image-url>/eurc.png" }
```
Expected after re-run: `0 monogram fallback(s).`

- [ ] **Step 5: Commit the script + generated assets**

```bash
git add web/scripts/vendor-token-icons.mjs web/lib/token-icons/overrides.json web/public/tokens
git commit -m "feat(web): vendor token icons from Jupiter v2 (26 assets) + manifest"
```

---

## Task 5: Coverage guard test (TDD)

**Files:**
- Create: `web/tests/token-icons-coverage.test.ts`

- [ ] **Step 1: Write the test**

Create `web/tests/token-icons-coverage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseToml } from "smol-toml";

// CI guard: every ACTIVE mint in assets.toml must have a vendored, non-monogram
// icon. Adding an asset without running `bun run icons:sync` (or an override)
// fails here. Runs from web/ (vitest cwd).
const WEB_ROOT = process.cwd();
const REPO_ROOT = resolve(WEB_ROOT, "..");
const TOKENS = join(WEB_ROOT, "public", "tokens");

const toml = parseToml(readFileSync(join(REPO_ROOT, "assets.toml"), "utf8")) as {
  assets: { symbol: string; mint: string; active?: boolean }[];
};
const activeAssets = toml.assets.filter((a) => a.active !== false);

const manifest = JSON.parse(readFileSync(join(TOKENS, "manifest.json"), "utf8")) as {
  mint: string; symbol: string; source: string;
}[];
const bySource = new Map(manifest.map((m) => [m.mint, m.source]));

describe("token-icon coverage", () => {
  it("vendored at least the active asset count", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(activeAssets.length);
  });

  it.each(activeAssets.map((a) => [a.symbol, a.mint] as const))(
    "%s has a real (non-monogram) vendored webp",
    (_symbol, mint) => {
      expect(existsSync(join(TOKENS, `${mint}.webp`))).toBe(true);
      expect(bySource.get(mint)).toBeDefined();
      expect(bySource.get(mint)).not.toBe("monogram");
    },
  );
});
```

- [ ] **Step 2: Run it; verify it passes**

Run: `bun run test -- token-icons-coverage`
Expected: PASS — one row per active asset, all green (proves Task 4 produced full coverage).

- [ ] **Step 3: Commit**

```bash
git add web/tests/token-icons-coverage.test.ts
git commit -m "test(web): guard 100% token-icon coverage vs assets.toml"
```

---

## Task 6: Dashboard surfaces (desktop table + mobile row)

**Files:**
- Modify: `web/components/organisms/asset-table.tsx`
- Modify: `web/components/organisms/mobile-asset-row.tsx`

- [ ] **Step 1: Import + widen the table symbol column**

In `web/components/organisms/asset-table.tsx`, add the import after line 7 (`BandGauge` import):
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Change `ROW_GRID` (line 85-86) — widen the 2nd column from `60px` to `132px` so an icon + symbol fit:
```ts
const ROW_GRID =
  "grid grid-cols-[32px_132px_1.6fr_110px_110px_140px_24px] items-center gap-x-3.5";
```
(The header at line 313 reuses `ROW_GRID`; its "Sym" cell simply gets wider — no header cell count change.)

- [ ] **Step 2: Render the icon in the Sym cell**

In the same file, replace the `{/* Sym */}` cell (lines 161-164):
```tsx
        {/* Sym */}
        <span className="font-mono text-[13px] font-medium text-text">
          {a.symbol}
        </span>
```
with:
```tsx
        {/* Sym */}
        <span className="flex min-w-0 items-center gap-2">
          <TokenIcon mint={a.mint} symbol={a.symbol} klass={a.class} size={20} />
          <span className="truncate font-mono text-[13px] font-medium text-text">
            {a.symbol}
          </span>
        </span>
```

- [ ] **Step 3: Add the icon to the mobile row**

In `web/components/organisms/mobile-asset-row.tsx`, add the import after line 5 (`StatePip` import):
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the inner identity flex (lines 58-60) — insert the icon before the pip:
```tsx
        <div className="flex min-w-0 items-center gap-2">
          <StatePip state={state} size={7} pulse={state !== "PEGGED" && state !== "UNKNOWN"} announce />
          <span className="truncate font-mono text-[15px] font-medium text-text">{asset.symbol}</span>
```
becomes:
```tsx
        <div className="flex min-w-0 items-center gap-2">
          <TokenIcon mint={asset.mint} symbol={asset.symbol} klass={asset.class} size={26} />
          <StatePip state={state} size={7} pulse={state !== "PEGGED" && state !== "UNKNOWN"} announce />
          <span className="truncate font-mono text-[15px] font-medium text-text">{asset.symbol}</span>
```

- [ ] **Step 4: Typecheck + lint + test**

Run:
```bash
bun run typecheck && bun run lint && bun run test -- asset-table
```
Expected: typecheck/lint PASS; existing asset-table tests (if any) still PASS. If there are no asset-table tests, the test command prints "no tests" — that's fine.

- [ ] **Step 5: Visual check**

Run `bun run dev` (port 3000), open `/dashboard`, confirm: each desktop row shows a circular logo left of the symbol; mobile rows show a 26px logo. No layout shift, no broken images.

- [ ] **Step 6: Commit**

```bash
git add web/components/organisms/asset-table.tsx web/components/organisms/mobile-asset-row.tsx
git commit -m "feat(web): token icons on dashboard table + mobile rows"
```

---

## Task 7: Asset-detail surfaces (hero + sticky header + breadcrumb)

**Files:**
- Modify: `web/components/organisms/asset-hero-v2.tsx`
- Modify: `web/app/(app)/asset/[symbol]/page.tsx`

- [ ] **Step 1: Hero icon (xl)**

In `web/components/organisms/asset-hero-v2.tsx`, add after line 10 (`MonitoringBadge` import):
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the identity flex (lines 121-132):
```tsx
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.02em] text-text">
            {asset.symbol}
          </h1>
```
with (icon added, gap bumped to gap-3, eager load since it's above the fold):
```tsx
        <div className="flex flex-wrap items-center gap-3">
          <TokenIcon mint={asset.mint} symbol={asset.symbol} klass={asset.class} size={44} loading="eager" />
          <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.02em] text-text">
            {asset.symbol}
          </h1>
```

- [ ] **Step 2: Sticky header icon + breadcrumb icon**

In `web/app/(app)/asset/[symbol]/page.tsx`, add the import alongside the other component imports near the top of the file:
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the sticky-header identity flex (lines 222-225):
```tsx
            <div className="flex min-w-0 items-center gap-2">
              <StatePip state={state} size={7} pulse={state !== "PEGGED"} announce />
              <span className="truncate font-mono text-[15px] font-medium text-text">{asset.symbol}</span>
            </div>
```
with:
```tsx
            <div className="flex min-w-0 items-center gap-2">
              <TokenIcon mint={asset.mint} symbol={asset.symbol} klass={asset.class} size={22} />
              <StatePip state={state} size={7} pulse={state !== "PEGGED"} announce />
              <span className="truncate font-mono text-[15px] font-medium text-text">{asset.symbol}</span>
            </div>
```
Then in the breadcrumb, replace the final crumb (line 255):
```tsx
            <span className="truncate text-text">{asset.symbol}</span>
```
with:
```tsx
            <span className="inline-flex min-w-0 items-center gap-1.5 text-text">
              <TokenIcon mint={asset.mint} symbol={asset.symbol} klass={asset.class} size={14} />
              <span className="truncate">{asset.symbol}</span>
            </span>
```

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 4: Visual check**

Open `/asset/USDC` (and `/asset/hyUSD`): hero shows a 44px logo left of the big symbol; scroll so the mobile sticky header appears → 22px logo; breadcrumb shows a 14px logo.

- [ ] **Step 5: Commit**

```bash
git add web/components/organisms/asset-hero-v2.tsx "web/app/(app)/asset/[symbol]/page.tsx"
git commit -m "feat(web): token icons on asset-detail hero, sticky header, breadcrumb"
```

---

## Task 8: Screener + asset-picker

**Files:**
- Modify: `web/app/(app)/assets/page.tsx`
- Modify: `web/components/molecules/asset-picker.tsx`

- [ ] **Step 1: Screener — import**

In `web/app/(app)/assets/page.tsx`, add the import alongside the other component imports near the top:
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```

- [ ] **Step 2: Screener mobile card (line 446-448)**

Replace:
```tsx
          <div className="flex min-w-0 items-center gap-2">
            <StatePip state={state} pulse={state !== "PEGGED"} size={6} announce />
            <span className="truncate text-[15px] font-medium text-text">{a.symbol}</span>
```
with:
```tsx
          <div className="flex min-w-0 items-center gap-2">
            <TokenIcon mint={a.mint} symbol={a.symbol} klass={a.class} size={24} />
            <StatePip state={state} pulse={state !== "PEGGED"} size={6} announce />
            <span className="truncate text-[15px] font-medium text-text">{a.symbol}</span>
```

- [ ] **Step 3: Screener desktop grid (line 491-492)**

Replace:
```tsx
        <div className="flex min-w-0 items-center gap-2.5">
          <StatePip state={state} pulse={state !== "PEGGED"} size={6} announce />
          <div className="min-w-0">
```
with:
```tsx
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenIcon mint={a.mint} symbol={a.symbol} klass={a.class} size={22} />
          <StatePip state={state} pulse={state !== "PEGGED"} size={6} announce />
          <div className="min-w-0">
```

- [ ] **Step 4: Asset-picker dropdown rows**

In `web/components/molecules/asset-picker.tsx`, add the import alongside the other imports near the top:
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the symbol cell (lines 141-148):
```tsx
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-text">{a.symbol}</span>
                      {a.name && (
                        <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
                          {a.name}
                        </span>
                      )}
                    </span>
```
with:
```tsx
                    <span className="flex min-w-0 items-center gap-2">
                      <TokenIcon mint={a.mint} symbol={a.symbol} klass={a.class} size={20} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-text">{a.symbol}</span>
                        {a.name && (
                          <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
                            {a.name}
                          </span>
                        )}
                      </span>
                    </span>
```

- [ ] **Step 5: Typecheck + lint + test**

Run: `bun run typecheck && bun run lint && bun run test -- assets`
Expected: PASS (existing screener tests still green).

- [ ] **Step 6: Visual check + commit**

Open `/assets` (desktop + narrow) and the compare picker → icons present, aligned. Then:
```bash
git add "web/app/(app)/assets/page.tsx" web/components/molecules/asset-picker.tsx
git commit -m "feat(web): token icons on screener rows + asset picker"
```

---

## Task 9: Compare + events

**Files:**
- Modify: `web/app/(app)/compare/page.tsx`
- Modify: `web/app/(app)/events/page.tsx`

- [ ] **Step 1: Compare card**

In `web/app/(app)/compare/page.tsx`, add the import alongside the other component imports near the top:
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the title `Link` block (lines 519-533):
```tsx
        <Link href={`/asset/${asset.symbol}`} className="group min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[20px] font-medium leading-tight tracking-tight text-text group-hover:underline underline-offset-4">
              {asset.symbol}
            </span>
            <span className="text-text-muted group-hover:text-text">
              <IconArrowUpRight size={10} />
            </span>
          </div>
          {asset.name && (
            <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
              {asset.name}
            </div>
          )}
        </Link>
```
with (icon to the left, existing text wrapped in a column):
```tsx
        <Link href={`/asset/${asset.symbol}`} className="group flex min-w-0 items-center gap-2.5">
          <TokenIcon mint={asset.mint} symbol={asset.symbol} klass={asset.class} size={32} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-medium leading-tight tracking-tight text-text group-hover:underline underline-offset-4">
                {asset.symbol}
              </span>
              <span className="text-text-muted group-hover:text-text">
                <IconArrowUpRight size={10} />
              </span>
            </div>
            {asset.name && (
              <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                {asset.name}
              </div>
            )}
          </div>
        </Link>
```

- [ ] **Step 2: Events cluster heading**

In `web/app/(app)/events/page.tsx`, add the import alongside the other component imports near the top:
```ts
import { TokenIcon } from "@/components/atoms/token-icon";
```
Replace the heading flex (lines 410-413):
```tsx
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-[22px] font-medium tracking-[-0.015em] text-text transition-colors duration-300 group-hover:text-coral">
                          {c.asset}
                        </h3>
```
with (icon center-aligned against the baseline row; only render when meta resolved):
```tsx
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {meta && (
                          <TokenIcon
                            mint={meta.mint}
                            symbol={c.asset}
                            klass={c.klass}
                            size={26}
                            className="self-center"
                          />
                        )}
                        <h3 className="text-[22px] font-medium tracking-[-0.015em] text-text transition-colors duration-300 group-hover:text-coral">
                          {c.asset}
                        </h3>
```

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. (Note `meta` is already in scope at events line 389; `c.klass` is the cluster's class.)

- [ ] **Step 4: Visual check + commit**

Open `/compare` (add a couple of assets) and `/events` → icons present and aligned. Then:
```bash
git add "web/app/(app)/compare/page.tsx" "web/app/(app)/events/page.tsx"
git commit -m "feat(web): token icons on compare cards + events clusters"
```

---

## Task 10: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck + lint**

Run (from `web/`):
```bash
bun run typecheck && bun run lint && bun run test
```
Expected: all green, including the new `token-icons`, `token-icon`, and `token-icons-coverage` suites.

- [ ] **Step 2: Production build smoke**

Run: `bun run build`
Expected: build succeeds; `/tokens/*.webp` are served as static assets.

- [ ] **Step 3: Manual sweep of all 9 surfaces**

With `bun run dev`, confirm a clean circular logo (no broken image, no layout shift) on: dashboard desktop rows, dashboard mobile rows, `/asset` hero, `/asset` sticky header, `/asset` breadcrumb, `/assets` screener (desktop + mobile), compare picker dropdown, compare cards, events clusters.

- [ ] **Step 4: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(web): token-icon rollout verification fixups" || echo "nothing to commit"
```

---

## Done criteria

- All 26 active assets render a real vendored logo on all 9 surfaces; monogram never appears (coverage test green).
- `bun run typecheck && bun run lint && bun run test && bun run build` all pass.
- No backend files touched; ships via Vercel-on-push.
- Re-running `bun run icons:sync` after adding an asset to `assets.toml` is the documented path to add its icon; the coverage test fails loudly if skipped.
