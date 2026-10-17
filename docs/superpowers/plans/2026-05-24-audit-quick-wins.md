# Audit Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 6 highest-leverage holes from the 2026-05-24 product review + fidelity audit, in a single PR, so the dashboard and landing stop sandbagging the rest of the product.

**Architecture:** Surgical edits to existing components — no new pages, no new data sources. One small motion helper (`gsap-reveal-safety.ts`) extracted from the proven pattern in `pinged-cta.tsx`; one new presentational atom (`MockDataBanner`); one new molecule isn't needed. Bot work is one handler edit + one web string change to thread `?start=` payload end-to-end.

**Tech Stack:** Next 16 (App Router) · React 19 · Tailwind v4 with `@theme {}` tokens · GSAP + ScrollTrigger via dynamic-import singleton · grammY 1.43 in `bot-ts/` · Vitest + Testing Library.

---

## File structure

| Path | Action | Why |
|---|---|---|
| `web/lib/motion/gsap-reveal-safety.ts` | create | Extract the proven 2-second safety-timeout pattern from `pinged-cta.tsx` into a reusable helper so other components stop being stuck-invisible when ScrollTrigger doesn't fire |
| `web/components/molecules/safety-grade.tsx` | modify | Apply safety helper to `gradeRef` |
| `web/components/organisms/how-it-computes.tsx` | modify | Apply safety helper to `blocks` (formula block, sources, ladder) |
| `web/components/molecules/events-heatmap.tsx` | modify | Apply safety helper to heatmap cells |
| `web/components/organisms/how-it-works.tsx` | modify | Apply safety helper to entries |
| `web/components/organisms/methodology-pipeline.tsx` | modify | Apply safety helper to sections |
| `web/app/(app)/methodology/methodology-client.tsx` | modify | Apply safety helper to scroll-triggered headings |
| `web/app/(app)/developers/developers-client.tsx` | modify | Apply safety helper to code-block entries |
| `web/app/(app)/dashboard/page.tsx` | inspect+fix | Verify Pro/Lite toggle renders; verify no duplicate Active/Compare rendering; fix if broken |
| `web/app/globals.css` | modify | Bump `--color-text-muted` from `#6f879c` to `#9aa9b8` for WCAG AA compliance |
| `web/lib/bot-link.ts` | create | One tiny helper `peganaBotHref(source, asset?)` that returns `https://t.me/PeganaBot?start=src_${source}[_${asset}]` — single source of truth |
| `web/components/organisms/pinged-cta.tsx` | modify | Use `peganaBotHref("landing_cta")` |
| `web/components/molecules/asset-action-strip.tsx` | modify | Use `peganaBotHref("asset", asset.symbol)` |
| `web/components/organisms/product-header.tsx` | modify | Use `peganaBotHref("header")` |
| `web/components/organisms/site-footer.tsx` | modify | Use `peganaBotHref("footer")` |
| `bot-ts/src/index.ts` | modify | Parse `ctx.match` in `/start` handler, log + store attribution on `upsertUser` |
| `bot-ts/src/db.ts` | modify | Add `source` column to `upsertUser` signature; passthrough to SQL |
| `web/components/molecules/mock-data-banner.tsx` | create | Tiny presentational banner shown when landing/dashboard fall back to mocked assets |
| `web/app/(marketing)/page.tsx` | modify | Mount `MockDataBanner` when `assets === undefined` (API unreachable) |
| `web/tests/unit/lib/bot-link.test.ts` | create | Cover the 4 link shapes |
| `web/tests/unit/molecules/mock-data-banner.test.tsx` | create | Render-snapshot equivalent |

Total: 1 new helper + 1 new banner + 1 new bot-link util + 12 file edits. No new dependencies.

---

## Task 1: GSAP reveal-safety helper

The proven pattern in `web/components/organisms/pinged-cta.tsx:39-46` works (2s timeout that force-shows any element still at `opacity:0`). Other components are missing this safety net and per the 2026-05-24 fidelity audit, six are stuck-invisible in production. We extract once and apply.

**Files:**
- Create: `web/lib/motion/gsap-reveal-safety.ts`
- Test: `web/tests/unit/lib/gsap-reveal-safety.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/lib/gsap-reveal-safety.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

describe("revealSafety", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forces opacity:1 on elements still at 0 after the safety window", () => {
    const el = document.createElement("div");
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    document.body.appendChild(el);

    const cleanup = revealSafety([el], 2000);
    vi.advanceTimersByTime(1999);
    expect(el.style.opacity).toBe("0");
    vi.advanceTimersByTime(2);
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toBe("none");
    cleanup();
    document.body.removeChild(el);
  });

  it("leaves elements alone when they have already been revealed", () => {
    const el = document.createElement("div");
    el.style.opacity = "1";
    document.body.appendChild(el);

    revealSafety([el], 100);
    vi.advanceTimersByTime(200);
    expect(el.style.opacity).toBe("1");
    document.body.removeChild(el);
  });

  it("cancels the timeout when cleanup runs", () => {
    const el = document.createElement("div");
    el.style.opacity = "0";
    document.body.appendChild(el);

    const cleanup = revealSafety([el], 100);
    cleanup();
    vi.advanceTimersByTime(200);
    expect(el.style.opacity).toBe("0");
    document.body.removeChild(el);
  });

  it("handles an empty list without throwing", () => {
    expect(() => revealSafety([], 50)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test gsap-reveal-safety -- --run`
Expected: FAIL with "Failed to resolve import '@/lib/motion/gsap-reveal-safety'".

- [ ] **Step 3: Implement the helper**

```ts
// web/lib/motion/gsap-reveal-safety.ts
/**
 * GSAP + ScrollTrigger can leave an element stuck at opacity:0 when the
 * trigger never fires (element above the start position on mount, dynamic
 * imports racing with first paint, hydration timing). This helper schedules
 * a one-shot fallback that force-shows any element still at computed
 * opacity:0 after the safety window.
 *
 * Mirrors the inline pattern proven in pinged-cta.tsx. Use it in every
 * GSAP entrance tween that hides content via opacity:0.
 *
 * Returns a cleanup that cancels the pending fallback. Always wire it into
 * the matchMedia cleanup list so unmounts don't leak timers.
 */
export function revealSafety(elements: HTMLElement[] | NodeListOf<HTMLElement>, ms = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  const id = window.setTimeout(() => {
    elements.forEach((el) => {
      if (window.getComputedStyle(el).opacity === "0") {
        el.style.opacity = "1";
        el.style.transform = "none";
      }
    });
  }, ms);
  return () => window.clearTimeout(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test gsap-reveal-safety -- --run`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/motion/gsap-reveal-safety.ts web/tests/unit/lib/gsap-reveal-safety.test.ts
git commit -m "feat(motion): extract revealSafety helper for stuck-opacity GSAP tweens

Pattern lifted from pinged-cta.tsx where it already works. Lets us
spread the same fix across the six components flagged by today's
fidelity audit without copy-pasting the timeout boilerplate."
```

---

## Task 2: Apply revealSafety to confirmed-broken components

The 2026-05-24 fidelity audit (`docs/design-research/audit-2026-05-24-shipped/AUDIT.md`) lists six components stuck-invisible. We patch each.

**Files:**
- Modify: `web/components/molecules/safety-grade.tsx:67-92`
- Modify: `web/components/organisms/how-it-computes.tsx:30-95`
- Modify: `web/components/molecules/events-heatmap.tsx:54-86`
- Modify: `web/components/organisms/how-it-works.tsx:95-130` (the GSAP block around line 103)
- Modify: `web/components/organisms/methodology-pipeline.tsx:18-50`
- Modify: `web/app/(app)/methodology/methodology-client.tsx:160-200` (the headings block around line 167)
- Modify: `web/app/(app)/developers/developers-client.tsx:50-130`

- [ ] **Step 1: Patch `safety-grade.tsx`**

Open `web/components/molecules/safety-grade.tsx`. Find the `useReducedMotionGsap` block. Add the import + safety call.

```tsx
// at the top with the other motion imports
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

// inside useReducedMotionGsap, after `tween = gsap.fromTo(...)` line ~85
// (before the IIFE's closing brace), add:
      const safety = revealSafety([el]);
      return () => { tween?.kill(); safety(); };
```

Replace the existing `return () => tween?.kill();` with the combined return above.

- [ ] **Step 2: Patch `how-it-computes.tsx`**

```tsx
// import at top
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

// inside the useReducedMotionGsap setup, after the three `cleanups.push(...)` calls
// and before the IIFE closes, add:
        const animated = [
          ...Array.from(blocks),
          ...(formulaUnderline ? [formulaUnderline] : []),
          ...Array.from(bars),
        ];
        cleanups.push(revealSafety(animated));
```

- [ ] **Step 3: Patch `events-heatmap.tsx`**

```tsx
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

// inside useReducedMotionGsap, after `tween = gsap.fromTo(divs, ...)`, before
// closing the IIFE:
        const safety = revealSafety(Array.from(divs));
        return () => { tween?.kill(); safety(); };
```

Replace the existing `return () => tween?.kill();` with the combined return.

- [ ] **Step 4: Patch `how-it-works.tsx`**

Open the file and locate the `useReducedMotionGsap` block around `web/components/organisms/how-it-works.tsx:103` (the `gsap.fromTo` with `{y:24, opacity:0}`). Identify the NodeList being animated (likely `entries` or similar). Add the same pattern:

```tsx
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

// after the fromTo + cleanups.push(...), add:
        cleanups.push(revealSafety(Array.from(entries)));
```

(Substitute `entries` for whatever the actual querySelectorAll variable is.)

- [ ] **Step 5: Patch `methodology-pipeline.tsx`**

Same pattern. Wrap the NodeList of `[data-pipeline-step]` (or whichever selector is used) in `revealSafety` and push to cleanups.

- [ ] **Step 6: Patch `methodology-client.tsx`**

Same pattern. Wrap the `headings` NodeList in `revealSafety`.

- [ ] **Step 7: Patch `developers-client.tsx`**

Two animated groups in this file (lines 59 and 112). Wrap both in `revealSafety` calls.

- [ ] **Step 8: Manual verification**

Make sure the dev stack is up (`docker compose -f docker-compose.prod-local.yml ps` should show all 7 services Up). The web dev server should already be on `http://localhost:3000` per the session start; if not, run `cd web && bun run dev`.

Open in browser and visually verify (no Playwright — eyeball check):
- `/` — formula `spread = 1 − market / intrinsic` is visible
- `/asset/jitoSOL` — "Safety grade" section shows the big letter "A" or "B" (not just the underline floating)
- `/methodology` — section headings visible on initial paint
- `/developers` — endpoint method labels visible
- `/events` — heatmap cells visible
- `/learn` — "Read article →" entries visible

Open DevTools Network tab, throttle to "Slow 3G", hard-reload each page. The safety timeout should kick in within 2s and force-show anything still hidden.

- [ ] **Step 9: Commit**

```bash
git add web/components/molecules/safety-grade.tsx \
        web/components/organisms/how-it-computes.tsx \
        web/components/molecules/events-heatmap.tsx \
        web/components/organisms/how-it-works.tsx \
        web/components/organisms/methodology-pipeline.tsx \
        web/app/\(app\)/methodology/methodology-client.tsx \
        web/app/\(app\)/developers/developers-client.tsx
git commit -m "fix(motion): apply revealSafety to GSAP reveals stuck at opacity:0

Six components flagged by the 2026-05-24 fidelity audit were invisible
in production because their ScrollTrigger never fired (race with
dynamic import + scroll position on mount). Each now gets a 2s
fallback that force-shows the elements if the tween hasn't run.

Components patched: safety-grade, how-it-computes, events-heatmap,
how-it-works, methodology-pipeline, methodology-client headings,
developers-client entries."
```

---

## Task 3: Investigate + fix dashboard render duplicates

The fidelity audit claims `dashboard` renders the Active strip AND a legacy `CriticalCallout` duplicating the same fact, plus the watchlist appears in both a `CompareCta` and a `CompareShelf`. Grep returns zero references to `CriticalCallout` or `CompareCta` in the current codebase — those components don't exist. Either the audit ran against a stale `.next` cache, or there's a real visible duplicate from a different source. We investigate first, fix only if real.

**Files:**
- Inspect: `web/app/(app)/dashboard/page.tsx:155-180`
- Inspect: live `/dashboard` DOM

- [ ] **Step 1: Clear Next build cache + restart dev server**

```bash
cd web && rm -rf .next
# kill existing dev server first
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
bun run dev
```

Wait for "Ready in" log.

- [ ] **Step 2: Inspect rendered DOM at `/dashboard`**

Open `http://localhost:3000/dashboard` in browser. Open DevTools Elements panel. Search the DOM (Cmd+F in Elements) for:
- The literal text `COMPARE WATCHLIST` — should appear exactly once. Note how many matches.
- The literal text `ACTIVE` — should appear exactly once outside the ActiveStrip itself. Note matches.
- Inspect the `<main>` direct children — there should be exactly one Active strip and one Compare shelf.

Document findings inline (paste them into the PR description later).

- [ ] **Step 3a: If duplicates are gone after cache clear → nothing to fix**

If `.next` cache clear made the duplicates disappear, the audit was a stale-build artifact. Add `.next` clearing to the runbook and skip to Step 4.

- [ ] **Step 3b: If duplicates remain → find and remove the source**

Grep the full repo for the duplicated text:

```bash
grep -rn "COMPARE WATCHLIST" web/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v .next
grep -rn "● ACTIVE" web/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v .next
```

For each match outside the legitimate `CompareShelf` / `ActiveStrip`, delete the rendering. Most likely it's a stale composition in `dashboard/page.tsx` rendering both old + new versions in parallel.

- [ ] **Step 4: Verify Pro/Lite toggle renders**

Open DevTools → Elements at `/dashboard`. Search DOM for the text `Pro` followed by `Lite`. Confirm the `<ModeToggle>` `<button>` pair from `web/components/organisms/dashboard-overview.tsx:139-160` is in the DOM.

If absent: check the `grid-cols-[auto_minmax(0,1fr)_auto_auto]` layout at `dashboard-overview.tsx:124`. On a 1440px viewport the 4th column should hold ModeToggle. If it's getting clipped or overflowing off-canvas, swap the grid to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]` so the toggle wraps to its own row below 1024px instead of vanishing.

If the toggle IS in DOM but not visible — confirm parent isn't clipping via `overflow: hidden`, and that no z-index issue is hiding it.

- [ ] **Step 5: Manual smoke**

Click Pro → Lite. Confirm the asset table collapses to top-5 by absolute bps (per `LITE_TOP_N = 5` in `dashboard/page.tsx:24` and the `mode === "lite"` slice at line ~96).

- [ ] **Step 6: Commit (only if changes made)**

```bash
git add web/app/\(app\)/dashboard/page.tsx \
        web/components/organisms/dashboard-overview.tsx
git commit -m "fix(dashboard): remove rendered duplicates flagged by 2026-05-24 audit

[Replace this line with the actual finding: either 'cleared stale
.next cache' or 'removed orphan render of CompareCta at line X'.]

Pro/Lite toggle layout adjusted to wrap below 1024px so the 4th grid
column doesn't get clipped."
```

If no changes were needed (Step 3a path), skip the commit and document in the PR body: "Dashboard audit findings were `.next` cache artifacts — verified clean after rebuild."

---

## Task 4: Thread bot attribution payload (web → bot)

Today every link points to `https://t.me/PeganaBot` with no payload, so the bot can't know which page sent the user. We add a tiny helper, replace the 6 hardcoded references, and parse the payload in the bot's `/start` handler.

**Files:**
- Create: `web/lib/bot-link.ts`
- Modify: `web/components/organisms/pinged-cta.tsx:66`
- Modify: `web/components/molecules/asset-action-strip.tsx:63`
- Modify: `web/components/organisms/product-header.tsx:66,78`
- Modify: `web/components/organisms/site-footer.tsx:43,109`
- Modify: `web/app/(app)/developers/page.tsx:164`
- Modify: `web/app/(marketing)/about/page.tsx:45`
- Modify: `bot-ts/src/index.ts:72-76` (the `/start` handler)
- Modify: `bot-ts/src/db.ts` (upsertUser signature)
- Test: `web/tests/unit/lib/bot-link.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/unit/lib/bot-link.test.ts
import { describe, it, expect } from "vitest";
import { peganaBotHref } from "@/lib/bot-link";

describe("peganaBotHref", () => {
  it("emits a no-payload URL when called with no source", () => {
    expect(peganaBotHref()).toBe("https://t.me/PeganaBot");
  });
  it("emits ?start=src_<source> for a source only", () => {
    expect(peganaBotHref("landing")).toBe("https://t.me/PeganaBot?start=src_landing");
  });
  it("appends the asset symbol when supplied", () => {
    expect(peganaBotHref("asset", "jitoSOL")).toBe("https://t.me/PeganaBot?start=src_asset_jitoSOL");
  });
  it("URL-encodes asset symbols with special characters", () => {
    // hyloSOL+ is a real symbol in our universe
    expect(peganaBotHref("asset", "hyloSOL+")).toBe("https://t.me/PeganaBot?start=src_asset_hyloSOL%2B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && bun run test bot-link -- --run
```
Expected: FAIL with "Failed to resolve import '@/lib/bot-link'".

- [ ] **Step 3: Implement the helper**

```ts
// web/lib/bot-link.ts
/**
 * Single source of truth for outbound bot links. Telegram's `?start=`
 * deep-link payload is what the bot reads as ctx.match in its /start
 * handler. We use it for attribution (which page sent the user) and to
 * pre-fill subscribe context (which asset they were looking at).
 *
 * Payload shape: `src_<source>[_<asset>]`. The bot parses underscore-
 * separated segments — keep <source> a single token (no underscores).
 */
export function peganaBotHref(source?: string, asset?: string): string {
  const base = "https://t.me/PeganaBot";
  if (!source) return base;
  const payload = asset ? `src_${source}_${asset}` : `src_${source}`;
  const params = new URLSearchParams({ start: payload });
  return `${base}?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && bun run test bot-link -- --run
```
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Replace the 7 hardcoded `https://t.me/PeganaBot` references**

For each file below, add `import { peganaBotHref } from "@/lib/bot-link";` at the top of the imports block, then swap the literal URL for the helper call.

`web/components/organisms/pinged-cta.tsx:66`:
```tsx
// before
href="https://t.me/PeganaBot"
// after
href={peganaBotHref("landing_cta")}
```

`web/components/molecules/asset-action-strip.tsx:63` (this component receives `asset.symbol` via props — verify the symbol is in scope at the call site):
```tsx
// before
href="https://t.me/PeganaBot"
// after
href={peganaBotHref("asset", asset.symbol)}
```

`web/components/organisms/product-header.tsx:66` and `:78`:
```tsx
// line 66 (the direct href)
href={peganaBotHref("header")}
// line 78 (the ctaHref prop)
ctaHref={peganaBotHref("header_cta")}
```

`web/components/organisms/site-footer.tsx:43`:
```tsx
{ href: peganaBotHref("footer_nav"), label: "Telegram bot", external: true },
```

`web/components/organisms/site-footer.tsx:109`:
```tsx
<SocialIcon network="telegram" href={peganaBotHref("footer_social")} />
```

`web/app/(app)/developers/page.tsx:164`:
```tsx
href={peganaBotHref("developers")}
```

`web/app/(marketing)/about/page.tsx:45`:
```tsx
<Link href={peganaBotHref("about")} target="_blank" ... >
```

Leave the literal string in `web/components/molecules/live-alert-bubble.tsx:94` alone — that's a rendered username label inside an alert preview, not a clickable link.

Leave the literal string in `bot-ts/src/index.ts` alone — bot links don't go through the helper.

- [ ] **Step 6: Run web tests to confirm nothing broke**

```bash
cd web && bun run test -- --run
```
Expected: ALL PASS. If `smoke.spec.ts:13` ("renders the hero and the @PeganaBot CTA") asserts on the exact href string, update its expectation to match the new payload-bearing URL.

- [ ] **Step 7: Bot side — extend `db.upsertUser` to accept a source**

Open `bot-ts/src/db.ts`. Find `upsertUser`. Add an optional `source` parameter and write it to a new column.

```ts
// db.ts — find upsertUser, change signature:
export async function upsertUser(
  telegramId: number,
  chatId: number,
  username: string | null,
  locale: "pt-BR" | "en",
  source: string | null = null,
): Promise<User> {
  // ... existing logic. In the SQL, on first insert only, write source.
  // The shape depends on the existing query — if it's an INSERT ... ON CONFLICT,
  // make source only set on insert (DO NOTHING on conflict for that column)
  // so repeat /start commands don't overwrite the original attribution.
}
```

Add a migration if `source` column doesn't exist on the `users` table:

```sql
-- new migration: crates/xtask/migrations/NNNN_user_source.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS source TEXT;
```

Find the next available migration number under `crates/xtask/migrations/` (run `ls crates/xtask/migrations/` first). Use that number prefix.

Run the migration:
```bash
cargo run -p xtask -- migrate
```
Expected: prints "applied N migrations" or similar.

- [ ] **Step 8: Bot side — parse `ctx.match` in `/start`**

`bot-ts/src/index.ts:72-76`:
```ts
bot.command("start", async (ctx) => {
  log.info({ user: ctx.from?.id, payload: ctx.match }, "/start");
  const source = parseStartPayload(ctx.match);
  await getUserOrCreate(ctx, source);
  await ctx.reply(ctx.t("welcome"));
});
```

Update `getUserOrCreate` (line ~63) to take + forward the source:
```ts
async function getUserOrCreate(ctx: AppContext, source: string | null = null): Promise<db.User> {
  if (!ctx.from || !ctx.chat) throw new Error("no from/chat");
  return db.upsertUser(
    ctx.from.id,
    ctx.chat.id,
    ctx.from.username ?? null,
    ctx.from.language_code === "pt" || ctx.from.language_code === "pt-br" ? "pt-BR" : "en",
    source,
  );
}
```

Add the parser at the top of the file (after the env block):
```ts
/**
 * Parse a Telegram deep-link payload of the form `src_<source>[_<asset>]`.
 * Returns the source string ("landing_cta", "asset_jitoSOL", etc.) or null
 * if the payload doesn't match the expected shape. We deliberately return
 * a single string (not a tuple) — Postgres only needs one column.
 */
function parseStartPayload(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("src_")) return null;
  return trimmed.slice("src_".length) || null;
}
```

- [ ] **Step 9: Manual end-to-end check**

```bash
cd bot-ts && bun run dev
```
In Telegram, open: `https://t.me/PeganaBot?start=src_asset_jitoSOL`. The bot replies with the welcome message. Check the database:

```bash
docker exec pegana-prodlocal-postgres-1 psql -U pegana -d pegana -c \
  "SELECT telegram_id, source FROM users ORDER BY id DESC LIMIT 5;"
```
Expected: latest row shows `source = asset_jitoSOL`.

- [ ] **Step 10: Commit**

```bash
git add web/lib/bot-link.ts web/tests/unit/lib/bot-link.test.ts \
        web/components/organisms/pinged-cta.tsx \
        web/components/molecules/asset-action-strip.tsx \
        web/components/organisms/product-header.tsx \
        web/components/organisms/site-footer.tsx \
        web/app/\(app\)/developers/page.tsx \
        web/app/\(marketing\)/about/page.tsx \
        bot-ts/src/index.ts bot-ts/src/db.ts \
        crates/xtask/migrations/
git commit -m "feat(bot-link): thread ?start= attribution payload web → bot

Every outbound @PeganaBot link now passes a source tag (landing_cta,
header, asset_<symbol>, footer_*, developers, about). Bot parses the
payload in /start and stores it on first user insert (preserved on
repeat /start so we don't overwrite the original attribution).

Enables 'where did this user come from' analytics and unblocks
contextual replies like 'I see you came from jitoSOL — want alerts
on it?' in a follow-up."
```

---

## Task 5: Bump text-muted contrast for WCAG AA

`#6f879c` on `#000` is ~5.4:1 — passes AA for >=18px text but fails AA for the small caption text (`text-[10px]`, `text-[11px]`) that's everywhere in this product. `#9aa9b8` gives ~8.1:1 which clears AA for all sizes and AAA for body text. Visually almost identical at the design's typical mute usage.

**Files:**
- Modify: `web/app/globals.css:20`
- Modify: `web/app/globals.css:28` (state-unknown shares the same hex)

- [ ] **Step 1: Snapshot the current contrast claim**

Verify the current ratio before changing anything (so the commit message is accurate):

```bash
# quick sanity calc — paste into any JS console or use https://contrast-ratio.com
# #6f879c on #000: L1 = ~0.245, L2 = 0 → ratio = (0.245 + 0.05) / 0.05 = ~5.9
```

- [ ] **Step 2: Patch the token**

```css
/* web/app/globals.css — line 20 */
--color-text-muted: #9aa9b8;

/* line 28 — keep state-unknown in lockstep with text-muted */
--color-st-unknown: #9aa9b8;
```

- [ ] **Step 3: Visual diff**

Open `/dashboard` and `/asset/jitoSOL` in the dev browser. Compare against the previous look from memory — the muted text (labels, captions, hairlines) should read slightly brighter but the warmth/cool balance should be unchanged.

If anything starts to look wrong (text reading as primary instead of muted), revert and try `#8a9aa9` instead.

- [ ] **Step 4: Commit**

```bash
git add web/app/globals.css
git commit -m "fix(a11y): bump --color-text-muted from #6f879c to #9aa9b8

The 10-11px mono captions used across the product fell below WCAG AA
contrast (~5.4:1) on the canvas background. New value lands at ~8.1:1
which clears AA at all sizes and AAA for body text. Visually almost
identical — same hue, +20% lightness.

Also bumps --color-st-unknown which uses the same hex by design."
```

---

## Task 6: Mock-data banner on landing

When the public API is unreachable, the landing falls back to the 14 hardcoded `MOCKED` assets in `web/app/(marketing)/page.tsx:27-42`. A first-time visitor sees stale-but-realistic numbers with zero indication they're not live, which actively damages trust when the user later notices.

**Files:**
- Create: `web/components/molecules/mock-data-banner.tsx`
- Modify: `web/app/(marketing)/page.tsx` (import + conditional mount)
- Test: `web/tests/unit/molecules/mock-data-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/unit/molecules/mock-data-banner.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MockDataBanner } from "@/components/molecules/mock-data-banner";

describe("MockDataBanner", () => {
  it("renders when show=true with the explanatory copy", () => {
    render(<MockDataBanner show />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/showing sample data/i)).toBeInTheDocument();
  });
  it("returns nothing when show=false", () => {
    const { container } = render(<MockDataBanner show={false} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && bun run test mock-data-banner -- --run
```
Expected: FAIL with import error.

- [ ] **Step 3: Implement the banner**

```tsx
// web/components/molecules/mock-data-banner.tsx
/**
 * Top-of-page banner that admits the landing is rendering against the
 * hardcoded MOCKED assets instead of live API data. Shown only when
 * useStats/useAssets both come back undefined (API unreachable). Keeps
 * the visual language understated — this is honesty signal, not an
 * error toast.
 */
interface Props {
  show: boolean;
}

export function MockDataBanner({ show }: Props) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-st-drift/40 bg-st-drift/[0.08] px-5 sm:px-8 lg:px-12 xl:px-20 py-2.5"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
        ● Showing sample data — live API unreachable. Numbers below are illustrative, not current.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && bun run test mock-data-banner -- --run
```
Expected: PASS — 2/2 tests.

- [ ] **Step 5: Mount on the landing page**

Open `web/app/(marketing)/page.tsx`. Add the import and conditional mount.

Add to the imports block:
```tsx
import { MockDataBanner } from "@/components/molecules/mock-data-banner";
```

In `HomePage()`, after the hooks but before the `return`, derive the mock flag:
```tsx
// True when both endpoints are unreachable — we're rendering MOCKED below.
const isMockMode = !stats && !assets;
```

In the JSX, mount the banner as the first child of `<main>`:
```tsx
return (
  <>
    <main>
      <MockDataBanner show={isMockMode} />
      <HeroLanding
        // ... existing props
      />
      {/* ... rest unchanged */}
    </main>
    <SiteFooter variant="full" />
  </>
);
```

- [ ] **Step 6: Manual verification**

With the dev stack running, the API is up — confirm banner does NOT show on `/`. Then stop the API container to simulate outage:

```bash
docker stop pegana-prodlocal-api-1
```

Hard-reload `/` after waiting ~65s for SWR's refresh interval to expire (or use DevTools "Disable cache" + reload). Expected: orange banner appears at the very top with the "Showing sample data" line.

Bring the API back:
```bash
docker start pegana-prodlocal-api-1
```

Wait for SWR refresh; banner should disappear within 60s.

- [ ] **Step 7: Commit**

```bash
git add web/components/molecules/mock-data-banner.tsx \
        web/tests/unit/molecules/mock-data-banner.test.tsx \
        web/app/\(marketing\)/page.tsx
git commit -m "feat(landing): show mock-data banner when API is unreachable

Landing falls back to 14 hardcoded MOCKED assets when /v1/stats and
/v1/assets both fail. Until now a visitor saw realistic-looking but
stale numbers with no indication anything was wrong. The banner is
visually understated (drift-orange on dark) — honesty signal, not
an error toast."
```

---

## Final integration step

- [ ] **Step 1: Run the full test suite**

```bash
cd web && bun run test -- --run
```
Expected: ALL PASS. If `smoke.spec.ts:13` fails on the bot link href assertion (Task 4), update it to use `peganaBotHref` directly so the test stays a source-of-truth.

- [ ] **Step 2: Run type-check**

```bash
cd web && bun run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
cd web && bun run lint
```
Expected: 0 errors.

- [ ] **Step 4: Full manual walk-through**

In order, open each page and confirm:
- `/` — formula section visible, marquee animating, banner absent (API up)
- `/dashboard` — Pro/Lite toggle visible top-right of hero, Active strip with exactly one rendering, Compare watchlist with exactly one rendering
- `/asset/jitoSOL` — Safety grade letter visible
- `/asset/hyloSOL+` — same (special char in path)
- `/methodology` — headings visible
- `/developers` — code-block entries visible, REST table visible
- `/events` — heatmap visible
- `/learn` — entries visible
- click any `@PeganaBot` link → URL contains `?start=src_*`

- [ ] **Step 5: Single PR**

```bash
git push -u origin polish/audit-quick-wins-2026-05-24
gh pr create --title "polish: 2026-05-24 audit quick wins (6-pack)" --body "$(cat <<'EOF'
## Summary
Closes the 6 highest-leverage findings from today's product review + fidelity audit in one bundled PR.

1. **GSAP reveal-safety helper** + applied to 6 components stuck-invisible per audit (safety-grade letter, how-it-computes formula, events-heatmap, how-it-works, methodology-pipeline, methodology-client headings, developers-client entries)
2. **Dashboard duplicates** — verified clean after `.next` cache clear / removed orphan render [update based on actual finding]
3. **Pro/Lite toggle** — confirmed renders correctly / layout fix [update based on actual finding]
4. **Bot link attribution** — `?start=src_<page>[_<asset>]` threaded across 7 web touchpoints, parsed in bot's `/start`, stored on `users.source`
5. **WCAG AA contrast** — bumped `--color-text-muted` from `#6f879c` to `#9aa9b8`
6. **Mock-data banner** — shown on landing when API unreachable

## Test plan
- [x] Web test suite passes
- [x] Type-check + lint clean
- [x] Manual walkthrough: 7 pages each show the previously-broken elements
- [x] Telegram deep-link `?start=src_asset_jitoSOL` writes `source=asset_jitoSOL` to users table
- [x] API stop → banner appears within 60s; API start → banner disappears
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** all 6 quick-wins from the product review are mapped to tasks 1+2 (GSAP), 3 (duplicates + toggle), 4 (bot link), 5 (contrast), 6 (banner). No gaps.
- **Placeholder scan:** Task 2 Step 4 says "Substitute `entries` for whatever the actual querySelectorAll variable is" for `how-it-works.tsx`. This is intentional — the file's selector name needs to be read at edit-time. Similarly Task 3 Step 3b leaves the deduplication target unspecified because it depends on what the cache-cleared rebuild reveals. These are investigation-then-fix tasks by design, not placeholders.
- **Type consistency:** `peganaBotHref(source?, asset?)` signature is consistent between helper, test, and all 7 call sites. `revealSafety(elements, ms?)` ditto. `MockDataBanner({show})` ditto.
- **Bot DB column rename:** verified `upsertUser` is called from one place (`getUserOrCreate` line ~63). Adding the param at the tail with a default keeps backward-compat. Migration is additive (ADD COLUMN IF NOT EXISTS) so re-running is safe.
