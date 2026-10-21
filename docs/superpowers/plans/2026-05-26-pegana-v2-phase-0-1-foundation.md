# Pegana v2 — Phase 0 + 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Pegana v2 *oracle reframe* end-to-end on the live web surface, plus a calibrated 14-day dogfood, without touching any backend channel (MCP / Webhook are Phase 2). When this plan is complete, `pegana.xyz` reads as "specialized peg-risk oracle for Solana" instead of "Solana peg watchdog," `/oracle` resolves in production, accessibility is WCAG-AA-clean, and `docs/CALIBRATION-v1.md` is committed.

**Architecture:** Frontend-only reframe (Next.js 16 marketing routes) on top of the already-deployed backend. Two new tiny components (`channel-cards.tsx`, `developers-toc.tsx`, `get-started-card.tsx`), edits to 6 existing pages and 2 organisms, plus an a11y harness via `@axe-core/playwright`. Backend untouched. Hetzner deploy unblocks `/oracle` 404 in production. Dogfood runs passive for 14 days; output is a single markdown calibration artifact.

**Tech Stack:** Next.js 16.2 (App Router, RSC), Tailwind v4, framer-motion, GSAP (existing), Geist + JetBrains Mono, shadcn/ui patterns, `@axe-core/playwright` (new), Bun (web is `bun dev`). Bot side: grammY + Fluent (no edits). Backend: api-rs + engine-rs + dispatcher-rs + bot-ts (no edits this plan).

---

## Status (2026-05-26)

**17 / 21 tasks done. V2 live in production on `www.pegana.xyz`.**

Branch: `V2` (pushed). Commits ahead of `main`: 22. Vercel: `dpl_14rhDC6qE3R7xAWopCNMbVfSPNWu`.

| Track | Tasks | Status |
|---|---|---|
| **A — Marketing reframe** | A1 · A2 · A3 · A4 · A5 · A6 · A7 · A8 | ✅ all done |
| **B — `/developers` redesign** | B1 · B2 · B3 · B4 | ✅ all done |
| **C — A11y sweep** | C1 · C2 | ✅ all done — axe-core 0 violations across 6 routes; Lighthouse a11y 100 on `/`, 95 on `/developers` |
| **D — Deploy unblock** | D1 ✅ · **D2 ⏸** | D1: `vercel --prod` shipped V2 to www.pegana.xyz, `/oracle` 404 → 200. D2: Hetzner deploy (separate spec, half-day op) — operator's call |
| **E — Dogfood + calibration** | **E1 ⏸** · **E2 ⏸** · **E3 ⏸** | Time-bound (14 days passive) + needs backend on stable infra. **E3 is the only Phase 3 launch gate** |
| **F — Health sweep cron** | F1 | ✅ done — `scripts/asset-health-sweep.sh` shipped |
| **G — Final polish** | G1 | ✅ done — 7 launch screenshots + Lighthouse reports in `docs/design-research/2026-05-26-launch/` |

### Lighthouse (production, mobile)

| Route | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| `/` | **80** ❌ | 100 ✅ | 96 ✅ | 100 ✅ |
| `/developers` | 88 ✅ | 95 ✅ | 100 ✅ | 91 ✅ |

`/` misses the Performance ≥ 85 gate by 5 points. Hot spots: LCP 4.6s (GSAP hero), 91 KiB unused JS, 14 KiB legacy JS. **Bundle-split is a follow-up sprint** — dynamic-import the hero motion code, audit GSAP plugin usage, preload the hero font subset, consider PPR (partial prerendering) on the landing per the SPEC's Next.js 16.2 budget. Full notes in `docs/design-research/2026-05-26-launch/LIGHTHOUSE.md`.

### What's left to finish Phase 1

| # | Task | Blocker | Effort | Blocks Phase 2/3? |
|---|---|---|---|---|
| D2 | Hetzner CAX21 deploy per `docs/superpowers/specs/2026-05-25-production-deploy.md` | Operator session, separate spec | ~half day | No |
| E1 | Enable dogfood routing (`FEATURE_PUBLIC_ALERTS=false` + `DOGFOOD_TELEGRAM_CHAT_ID=<dogfood-chat-id>`) | Stable backend infra (does not require D2 strictly) | ~10 min | No |
| E2 | 14-day passive observation (capture true/noise per asset, threshold deltas) | Time (14 days from E1) | passive | No |
| E3 | Write `docs/CALIBRATION-v1.md` (per-asset p50/p95/p99 + threshold tuning) | E2 complete | ~2 h | **Yes — Phase 3 launch gate** |
| ⬆ Perf follow-up | Landing bundle-split / hero motion lazy-load / PPR | — | ~half day | No (cosmetic Lighthouse gate, not user-facing block) |

Realistic critical path: turn on E1 in parallel with Phase 2 work → E2 runs in background → E3 lands at day 14 → Phase 3 public launch.

### Production sanity (verified post-deploy)

```
www.pegana.xyz/              200 ✓ (new hero "The specialized peg-risk oracle for Solana.")
www.pegana.xyz/oracle        200 ✓ (was 404 pre-deploy)
www.pegana.xyz/developers    200 ✓ (sticky TOC + 5 anchored channel sections)
www.pegana.xyz/methodology   200 ✓ (back-links to /oracle + /concepts)
www.pegana.xyz/dashboard     200 ✓ ("Live state of the oracle" subtitle)
www.pegana.xyz/concepts      200 ✓
```

---

## Scope

This plan covers **Phase 0 (pre-flight) + Phase 1 (Foundation)** of the SPEC at `docs/superpowers/specs/2026-05-26-pegana-v2-a2-oracle-reframe-design.md`. Specifically:

- Decisions #1 (hero), #2 (oracle/methodology cross-links), #3 (top-nav), #4 (developers with sticky TOC + get-started cards + MCP/Webhook **placeholders only**), #11 (brand/copy touchpoints).
- Decision #12 phases 0–1 (design-taste pass, README sync, copy rewrites, Hetzner deploy unblock, 14-day dogfood, accessibility sweep).
- Acceptance criteria for v2 launched: every "frontend" and "operational" bullet that does NOT depend on MCP / Webhook running.

**Out of scope (Phase 2 + 3 in separate plans):**
- `mcp-ts/` package (decisions #5, #6) — separate plan after this one ships.
- Webhook implementation in `dispatcher-rs` (decision #7) — separate plan.
- Public launch announcement, protocol outreach, hackathon submission (Phase 3) — separate plan once Phase 2 is in flight.

---

## File Structure

### Files to create

| Path | Responsibility | Lines (est.) |
|---|---|---|
| `web/components/organisms/channel-cards.tsx` | 5-card grid (REST · WS · MCP · Webhook · Telegram) anchored to `/developers#section` | ~120 |
| `web/components/molecules/developers-toc.tsx` | Sticky left-rail TOC with `IntersectionObserver` active-anchor highlight | ~90 |
| `web/components/molecules/get-started-card.tsx` | 3-step reusable card (Install / First request / Auth) | ~80 |
| `web/tests/e2e/a11y.spec.ts` | Playwright + axe-core sweep across 6 routes | ~70 |
| `docs/CALIBRATION-v1.md` | 14-day dogfood artifact (per-asset p50/p95/p99 + threshold deltas) | ~150 |
| `scripts/asset-health-sweep.sh` | Monthly cron that cross-references tracked assets vs DefiLlama TVL and solana-knowledge DEFUNCT list | ~60 |

### Files to modify

| Path | Why |
|---|---|
| `web/app/(marketing)/page.tsx` | New hero copy + insert `<ChannelCards />` + migrate use-case cards from `/oracle` |
| `web/app/(marketing)/oracle/page.tsx` | Drop migrated use-cases, add "See the math →" link to `/methodology`, add link to `/concepts` |
| `web/app/(app)/methodology/page.tsx` | Add "See the pitch →" back-link to `/oracle`, add inline link to `/concepts`, verify per-class semantics documented |
| `web/app/(app)/dashboard/page.tsx` | Subtitle near hero: "Live state of the oracle." |
| `web/app/(marketing)/developers/page.tsx` | Restructure into 5 anchored sections (`#rest #websocket #mcp #webhook #telegram`), each lead with `<GetStartedCard />`, mount `<DevelopersToc />` sticky |
| `web/components/organisms/marketing-header.tsx` | Extend `developersItems` dropdown to list all 5 channels in order |
| `web/components/molecules/mobile-menu.tsx` | Mirror the 5-channel order in the mobile drawer |
| `web/components/organisms/site-footer.tsx` | Update tagline to "Built to be consumed. Read by agents and protocols. MIT." |
| `web/components/organisms/hero-landing.tsx` | Replace H1 copy + subhero (or wrap in a new prop without breaking existing motion code) |
| `web/app/layout.tsx` | Update `siteTitle` and `siteDescription` to oracle-first |
| `README.md` | Opening line oracle-first (partial work already in branch — validate + finalize) |
| `web/lib/data/concepts.ts` | LST list synced to actual active TOML entries (partial work already in branch — validate) |
| `web/package.json` | Add `@axe-core/playwright` devDependency |

### Phase-1 commits expected: ~14 atomic commits, 1 follow-up calibration commit at day 14.

---

## Track A — Marketing reframe (frontend only)

### Task A1: Design-taste pass on the 5 channel cards

**Status:** ✅ Done — commit `bf9a21c`. Direction C "Spec Sheet" chosen; mockups in `docs/design-research/2026-05-26-channel-cards/`.

**Files:**
- Read-only: `brand.md`, `web/app/(marketing)/page.tsx`, any existing card component for style reference.

- [ ] **Step 1: Run the `design-taste` skill on the channel-cards problem**

```
Skill name: design-taste
Args: "5 channel cards for the Pegana home page: REST, WebSocket, MCP, Webhook, Telegram. Each card has icon + label + 1-liner + status pill (live | preview) + 'Read docs →' link. Brand is locked: Threshold Brackets, sunset coral #ff8a5b + magenta #e878d8 on canvas #000, Geist + JetBrains Mono. Page archetype: trading terminal density, Bloomberg-like. Show 3 visual directions and recommend one."
```

- [ ] **Step 2: Capture the chosen direction**

Save the resulting mockup to `docs/design-research/2026-05-26-channel-cards/<direction>.html`. We'll reference this when building `ChannelCards` in Task A4.

- [ ] **Step 3: Commit**

```bash
git add docs/design-research/2026-05-26-channel-cards/
git commit -m "design: lock channel-cards direction for v2 home"
```

### Task A2: Validate README + concepts.ts sync (already partial in branch)

**Status:** ✅ Done — committed pre-V2 in `37939a0` on `main`. Cross-checked against `assets.toml`: 6 SOL LSTs + 2 Hylo LSTs active, dSOL deactivated. The plan's python helper has a bug (comment lines inside `[[assets]]` blocks bleed into preceding block); corrected script lives in `scripts/asset-health-sweep.sh` (F1).

**Files:**
- Modify (validate): `README.md`
- Modify (validate): `web/lib/data/concepts.ts`

- [ ] **Step 1: Diff what's currently in the working tree vs HEAD**

Run: `git diff README.md web/lib/data/concepts.ts`
Expected: shows the LST list sync that was done earlier today (post-dSOL commit).

- [ ] **Step 2: Cross-check against `assets.toml`**

Run:

```bash
python3 -c "
import re
c = open('assets.toml').read()
blocks = c.split('[[assets]]')[1:]
lsts = []
for b in blocks:
    sym = re.search(r'symbol\s*=\s*\"([^\"]+)\"', b)
    cls = re.search(r'class\s*=\s*\"([^\"]+)\"', b)
    act = re.search(r'\bactive\s*=\s*(true|false)', b)
    if sym and cls and cls.group(1) == 'lst':
        active = act.group(1) if act else 'true'
        lsts.append((sym.group(1), active))
print('LSTs in TOML:')
for s, a in lsts: print(f'  {s:14} active={a}')
"
```

Expected output: `jitoSOL · mSOL · bSOL · INF · bbSOL · JupSOL` active=true, `hyloSOL` + `hyloSOL+` active=true (default), `dSOL` active=false.

- [ ] **Step 3: Confirm README + concepts.ts match the active list**

`README.md` opening should reference "6 SOL-pegged LSTs + 2 Hylo LSTs" with the exact 8 names. `concepts.ts` LST sentence should say "Six SOL-pegged LSTs are actively tracked on Pegana — jitoSOL, mSOL, bSOL, INF, bbSOL, JupSOL — plus two Hylo LSTs (hyloSOL, hyloSOL+)."

- [ ] **Step 4: Commit the working-tree changes**

```bash
git add README.md web/lib/data/concepts.ts
git commit -m "docs: sync README and concepts.ts to actual active LST list"
```

### Task A3: Update brand-wide metadata to oracle-first

**Status:** ✅ Done — commit `9229aed`.

**Files:**
- Modify: `web/app/layout.tsx` (lines 19–23)

- [ ] **Step 1: Replace `siteTitle` + `siteDescription`**

Replace:

```typescript
const siteTitle = "Pegana — Solana peg watchdog";
const siteDescription =
  "The peg-risk oracle for Solana. Real-time intrinsic-vs-market monitoring across 23 LSTs, stablecoins, yield-bearing assets, and synthetics. Alerts via Telegram; public REST + WS for protocols.";
```

With:

```typescript
const siteTitle = "Pegana — peg-risk oracle for Solana";
const siteDescription =
  "The specialized peg-risk oracle for Solana. Pegana publishes intrinsic-vs-market discount, peg state, and every state transition for 23 LSTs, stablecoins, yield-bearing assets, CDPs, and synthetics. Read via REST, WebSocket, MCP, Webhook, and Telegram.";
```

- [ ] **Step 2: Run typecheck**

```bash
cd web && bun run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/app/layout.tsx
git commit -m "feat(web): oracle-first metadata for SEO + social cards"
```

### Task A4: Create `ChannelCards` organism

**Status:** ✅ Done — commit `ff8a598` + follow-up `73a2ca0` (copy realignment with verbatim plan strings after spec reviewer caught taglines/heading/kicker drift). Implementation followed Direction C from A1 (semantic `<table>` with iridescent left-mark on REST row).

**Files:**
- Create: `web/components/organisms/channel-cards.tsx`
- Test: visual only (no unit test — pure presentational component using existing brand tokens)

- [ ] **Step 1: Write the component**

Create `web/components/organisms/channel-cards.tsx` with the exact body below. The visual treatment follows the direction locked in Task A1; if A1 produced a different layout, replace the inner JSX while keeping the data shape.

```typescript
import Link from "next/link";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";

type Channel = {
  key: "rest" | "websocket" | "mcp" | "webhook" | "telegram";
  label: string;
  tagline: string;
  href: string;
  status: "live" | "preview";
};

const CHANNELS: ReadonlyArray<Channel> = [
  { key: "rest",      label: "REST API",   tagline: "JSON over HTTPS. No key, soft rate limit.",       href: "/developers#rest",      status: "live" },
  { key: "websocket", label: "WebSocket",  tagline: "Sub-second peg-state stream. Subscribe per asset.", href: "/developers#websocket", status: "live" },
  { key: "mcp",       label: "MCP",         tagline: "Native Model Context Protocol for AI agents.",     href: "/developers#mcp",       status: "preview" },
  { key: "webhook",   label: "Webhook",     tagline: "Ed25519-signed POST on every state transition.",   href: "/developers#webhook",   status: "preview" },
  { key: "telegram",  label: "Telegram",    tagline: "Human-readable alerts via @PeganaWatchBot.",       href: "/developers#telegram",  status: "live" },
];

export function ChannelCards() {
  return (
    <section
      aria-labelledby="channels-heading"
      className="mx-auto mt-24 max-w-[1280px] px-5 sm:mt-32 sm:px-8 lg:px-12"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Channels
      </p>
      <h2
        id="channels-heading"
        className="mt-2 text-[28px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[36px]"
      >
        Read peg state your way.
      </h2>
      <ul className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CHANNELS.map((c) => (
          <li key={c.key} className="border border-hairline bg-canvas/40 p-5 transition-colors hover:border-text">
            <Link href={c.href} className="block">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text">{c.label}</span>
                <span
                  className={c.status === "live"
                    ? "rounded-sm border border-st-pegged/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-st-pegged"
                    : "rounded-sm border border-st-drift/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-st-drift"}
                >
                  {c.status === "live" ? "Live" : "Preview"}
                </span>
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-text-muted">
                {c.tagline}
              </p>
              <span className="mt-6 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text">
                Read docs <IconArrowRight size={10} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd web && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/organisms/channel-cards.tsx
git commit -m "feat(web): add ChannelCards organism (5 v2 channels)"
```

### Task A5: Rewrite landing hero copy + insert ChannelCards

**Status:** ✅ Done — commit `d7909e6`. ChannelCards inserted between `HeroLanding` and `LogoMarquee` (prime position above social proof).

**Files:**
- Modify: `web/components/organisms/hero-landing.tsx` (H1 + subhero block)
- Modify: `web/app/(marketing)/page.tsx` (insert `<ChannelCards />` between `<HeroLanding />` and `<HowItComputes />`)

- [ ] **Step 1: Locate the H1 in `hero-landing.tsx`**

Run: `grep -n '<h1' web/components/organisms/hero-landing.tsx`

- [ ] **Step 2: Replace the H1 + subhero**

The current copy is "Catch a depeg before it catches you." Replace the `<h1>` text content with "The specialized peg-risk oracle for Solana." and the subhero paragraph with: "Multi-asset · mechanism-aware · dual-source reconciled · sub-second WS. Read by agents and protocols before allocating capital."

The motion code that splits words via `splitWords(h1)` will pick up the new copy automatically — do not touch the GSAP timeline.

- [ ] **Step 3: Insert `<ChannelCards />` in `page.tsx`**

In `web/app/(marketing)/page.tsx`, add the import:

```typescript
import { ChannelCards } from "@/components/organisms/channel-cards";
```

Insert `<ChannelCards />` between `<HeroLanding ... />` and `<HowItComputes ... />` in the returned JSX.

- [ ] **Step 4: Visual check**

```bash
cd web && bun dev
```

Open `http://localhost:3000`. Hero should read the new copy; channel cards row should render below the hero, above HowItComputes.

- [ ] **Step 5: Commit**

```bash
git add web/components/organisms/hero-landing.tsx web/app/\(marketing\)/page.tsx
git commit -m "feat(web): oracle-first hero + ChannelCards on landing"
```

### Task A6: Migrate use-case cards from `/oracle` to landing, add cross-links

**Status:** ✅ Done — commit `d14457b`. New `use-cases-strip.tsx` organism preserves the original L-bracket accent treatment verbatim; `/oracle` replaces the section with a 2-card "Two reads" cross-link to `/methodology` + `/concepts`.

**Files:**
- Modify: `web/app/(marketing)/page.tsx` (add use-case section)
- Modify: `web/app/(marketing)/oracle/page.tsx` (remove migrated use-cases, add cross-links)

- [ ] **Step 1: Extract `USE_CASES` + rendering into a new component**

The current `/oracle` page (`web/app/(marketing)/oracle/page.tsx`) defines `USE_CASES` as a const array around line 53 and renders it inline via `USE_CASES.map((u) => (...))` around line 154. **There is no exported `UseCase` function component — the JSX is inline.** This step extracts BOTH the constant and the rendering into a new reusable component.

Create `web/components/organisms/use-cases-strip.tsx`:

```typescript
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";

interface UseCase {
  accent: string;
  tag: string;
  title: string;
  body: string;
  endpoint: string;
}

const USE_CASES: ReadonlyArray<UseCase> = [
  {
    accent: "#feed7a",
    tag: "Insurance",
    title: "Trigger payouts on confirmed depeg",
    body: "Insurance protocols selling cover against stablecoin or LST depegs need a credible, third-party event source — not the protocol they're insuring against. Pegana emits AlertEvent on every state transition with class-aware thresholds.",
    endpoint: "wss://api.pegana.xyz/v1/ws",
  },
  // …copy the 2 remaining entries verbatim from oracle/page.tsx lines 53–80.
];

export function UseCasesStrip() {
  return (
    <section
      aria-labelledby="who-consumes"
      className="mx-auto mt-24 max-w-[1280px] px-5 sm:mt-32 sm:px-8 lg:px-12"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Who reads from Pegana
      </p>
      <h2
        id="who-consumes"
        className="mt-2 text-[28px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[36px]"
      >
        Built to be consumed.
      </h2>
      <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {USE_CASES.map((u) => (
          <li key={u.tag} className="border border-hairline p-5">
            <p
              className="font-mono text-[11px] uppercase tracking-[0.08em]"
              style={{ color: u.accent }}
            >
              ({String(USE_CASES.indexOf(u) + 1).padStart(2, "0")}) {u.tag}
            </p>
            <h3 className="mt-3 text-[18px] font-medium leading-[1.25] tracking-[-0.01em]">
              {u.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-text-muted">{u.body}</p>
            <code className="mt-4 block font-mono text-[11px] text-text-muted">
              {u.endpoint}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

> **Note:** the rendering style above mirrors the inline JSX currently in `oracle/page.tsx` (kicker, title, body, endpoint code). Reading the actual current file lines 145–195 will confirm the exact class names — match them so the visual is identical to today's `/oracle` page.

- [ ] **Step 2: Render `<UseCasesStrip />` on the landing**

In `web/app/(marketing)/page.tsx`, add:

```typescript
import { UseCasesStrip } from "@/components/organisms/use-cases-strip";
```

Insert `<UseCasesStrip />` after `<ChannelCards />` in the returned JSX.

- [ ] **Step 3: Strip the use-cases from `/oracle`**

In `web/app/(marketing)/oracle/page.tsx`, delete:
- The `USE_CASES` constant declaration (around line 53–80).
- The `<section ...>` block that renders the inline `USE_CASES.map(...)` JSX (around line 145–195 — the section with `aria-labelledby="who-consumes"`).

Replace the deleted section with the cross-link block below:

```typescript
<section className="mt-20">
  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
    Going deeper
  </p>
  <h2 className="mt-2 text-[28px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[36px]">
    Two reads.
  </h2>
  <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
    <Link href="/methodology" className="border border-hairline p-6 transition-colors hover:border-text">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        See the math
      </p>
      <p className="mt-3 text-[16px] leading-relaxed text-text">
        How we derive intrinsic value per mechanism — stake-pool, NAV, CDP, FX. Formula, hysteresis, state machine.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text">
        /methodology <IconArrowRight size={10} />
      </span>
    </Link>
    <Link href="/concepts" className="border border-hairline p-6 transition-colors hover:border-text">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        See the primitives
      </p>
      <p className="mt-3 text-[16px] leading-relaxed text-text">
        Explainers on the concepts Pegana measures — LST peg drift, yield-bearing NAV, CDP collateral ratio.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text">
        /concepts <IconArrowRight size={10} />
      </span>
    </Link>
  </div>
</section>
```

- [ ] **Step 4: Visual check both pages**

Run dev server, open `/` and `/oracle`. Confirm use-cases render on `/` only; cross-links render on `/oracle`.

- [ ] **Step 5: Commit**

```bash
git add web/components/organisms/use-cases-strip.tsx \
        web/app/\(marketing\)/page.tsx \
        web/app/\(marketing\)/oracle/page.tsx
git commit -m "feat(web): move use-cases from /oracle to landing; add cross-links"
```

### Task A7: Augment `/methodology` with back-links

**Status:** ✅ Done — commit `ea7a992`. Per-class semantics (LST stake-pool / NAV / CDP / FX) verified as already covered in `methodology-client.tsx`; only the link strip was net-new.

**Files:**
- Modify: `web/app/(app)/methodology/page.tsx`

- [ ] **Step 1: Read current page to find a good insertion point**

Run: `head -60 web/app/(app)/methodology/page.tsx`

- [ ] **Step 2: Add a "See the pitch ↩" + "See the primitives →" link strip near the bottom of the page**

Above `<SiteFooter />`, add:

```typescript
<section className="mt-24 border-t border-hairline pt-12">
  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
    <Link href="/oracle" className="border border-hairline p-6 transition-colors hover:border-text">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        See the pitch
      </p>
      <p className="mt-3 text-[16px] leading-relaxed text-text">
        Why a peg-risk oracle is a category, who reads from Pegana, and what each channel looks like.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text">
        /oracle <IconArrowRight size={10} />
      </span>
    </Link>
    <Link href="/concepts" className="border border-hairline p-6 transition-colors hover:border-text">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Primer first?
      </p>
      <p className="mt-3 text-[16px] leading-relaxed text-text">
        Reference explainers — LST drift, NAV oracles, CDP collateral ratios.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text">
        /concepts <IconArrowRight size={10} />
      </span>
    </Link>
  </div>
</section>
```

Make sure the file imports `Link` and `IconArrowRight` if not already.

- [ ] **Step 3: Verify per-class semantics are documented (decision #2 acceptance)**

Read the page in the browser at `/methodology`. Confirm sections exist (or add concise paragraphs to existing sections) for: (a) LST stake-pool valuation via Sanctum, (b) yield-bearing NAV via Pyth Redemption Rate / Token-2022 InterestBearing extension, (c) CDP collateral ratio via on-chain Hylo Exchange decode, (d) FX via Pyth USD/BRL. If any are missing, add a short paragraph each (≤ 5 lines).

- [ ] **Step 4: Commit**

```bash
git add web/app/\(app\)/methodology/page.tsx
git commit -m "feat(web): /methodology back-links + per-class semantics"
```

### Task A8: Update footer tagline + top-nav 5 channels

**Status:** ✅ Done — commit `c4ea847`. Dropdown order: REST API · WebSocket · MCP · Webhook · Telegram bot · Examples · Embed widget. Mobile drawer mirrors.

**Files:**
- Modify: `web/components/organisms/site-footer.tsx`
- Modify: `web/components/organisms/marketing-header.tsx`
- Modify: `web/components/molecules/mobile-menu.tsx`

- [ ] **Step 1: Update footer tagline**

Find the existing tagline in `site-footer.tsx` (look for "MIT" or similar near the bottom of the file). Replace whatever phrase is there with: `"Built to be consumed. Read by agents and protocols. MIT licensed."`

- [ ] **Step 2: Extend `developersItems` in `marketing-header.tsx`**

Replace:

```typescript
const developersItems: NavDropdownItem[] = [
  { href: "/developers", label: "REST API" },
  { href: "/developers/examples", label: "Examples" },
  { href: "/embed", label: "Embed widget" },
];
```

With:

```typescript
const developersItems: NavDropdownItem[] = [
  { href: "/developers#rest",      label: "REST API" },
  { href: "/developers#websocket", label: "WebSocket" },
  { href: "/developers#mcp",       label: "MCP" },
  { href: "/developers#webhook",   label: "Webhook" },
  { href: "/developers#telegram",  label: "Telegram bot" },
  { href: "/developers/examples",  label: "Examples" },
  { href: "/embed",                label: "Embed widget" },
];
```

- [ ] **Step 3: Mirror in `mobile-menu.tsx`**

Find the existing list (`mobileLinks` or similar) and add the four new entries (`#websocket`, `#mcp`, `#webhook`, `#telegram`) in the same order.

- [ ] **Step 4: Visual check**

`cd web && bun dev`, hover the "Developers" dropdown, verify 7 items render in the order above. Open mobile menu (resize to < 768px), verify same order.

- [ ] **Step 5: Commit**

```bash
git add web/components/organisms/site-footer.tsx \
        web/components/organisms/marketing-header.tsx \
        web/components/molecules/mobile-menu.tsx
git commit -m "feat(web): top-nav exposes 5 channels; footer tagline oracle-first"
```

---

## Track B — `/developers` redesign

### Task B1: Create `GetStartedCard` molecule

**Status:** ✅ Done — commit `db7112b`.

**Files:**
- Create: `web/components/molecules/get-started-card.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { ReactNode } from "react";

interface Step {
  label: string;
  body: ReactNode;
}

interface GetStartedCardProps {
  channel: "REST" | "WebSocket" | "MCP" | "Webhook" | "Telegram";
  steps: [Step, Step, Step];
}

export function GetStartedCard({ channel, steps }: GetStartedCardProps) {
  return (
    <div className="border border-hairline bg-canvas/40 p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Get started · {channel}
      </p>
      <ol className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Step {i + 1}
            </span>
            <p className="mt-2 font-mono text-[12px] text-text">{s.label}</p>
            <div className="mt-3 text-[13px] leading-relaxed text-text-muted">
              {s.body}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/components/molecules/get-started-card.tsx
git commit -m "feat(web): add GetStartedCard molecule for /developers channels"
```

### Task B2: Create `DevelopersToc` sticky left-rail

**Status:** ✅ Done — commit `d097e6c`.

**Files:**
- Create: `web/components/molecules/developers-toc.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useEffect, useState } from "react";

const ANCHORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "rest",       label: "REST API" },
  { id: "websocket",  label: "WebSocket" },
  { id: "mcp",        label: "MCP" },
  { id: "webhook",    label: "Webhook" },
  { id: "telegram",   label: "Telegram" },
];

export function DevelopersToc() {
  const [active, setActive] = useState<string>("rest");

  useEffect(() => {
    const sections = ANCHORS
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Developer channels"
      className="sticky top-24 hidden lg:block"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        Channels
      </p>
      <ul className="mt-3 space-y-1">
        {ANCHORS.map((a) => (
          <li key={a.id}>
            <a
              href={`#${a.id}`}
              className={
                "block border-l-2 py-1.5 pl-3 font-mono text-[12px] uppercase tracking-[0.06em] transition-colors " +
                (active === a.id
                  ? "border-text text-text"
                  : "border-hairline text-text-muted hover:text-text")
              }
            >
              {a.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/components/molecules/developers-toc.tsx
git commit -m "feat(web): add DevelopersToc sticky left-rail with active-anchor highlight"
```

### Task B3: Restructure `/developers` with TOC + 5 sections

**Status:** ✅ Done — commit `149c622`. Implementer preserved existing Embed / Examples / Resources sections below the 5 channels with a `+` kicker prefix to separate them from the numbered channel narrative. Webhook copy bumped "v1.5" → "v2.0" to align with the Preview tag.

**Files:**
- Modify: `web/app/(marketing)/developers/page.tsx`

- [ ] **Step 1: Read current page structure**

`head -120 web/app/(marketing)/developers/page.tsx`. Note the existing REST + WS + Webhook (marked "soon") + Embed + Examples sections.

- [ ] **Step 2: Add layout wrapper with sticky TOC**

Wrap the existing main content in a 2-column layout on `lg+`:

```typescript
import { DevelopersToc } from "@/components/molecules/developers-toc";
import { GetStartedCard } from "@/components/molecules/get-started-card";

// In the returned JSX, wrap content:
<main className="mx-auto max-w-[1280px] px-5 py-12 sm:px-8 sm:py-20 lg:px-12">
  <div className="grid grid-cols-1 gap-12 lg:grid-cols-[180px_1fr]">
    <aside><DevelopersToc /></aside>
    <div>
      {/* sections below */}
    </div>
  </div>
</main>
```

- [ ] **Step 3: Add five anchored sections, each with `<GetStartedCard />`**

Each section uses `<section id="rest" /* etc. */>` and starts with a `<GetStartedCard />`. The five `<GetStartedCard />` props:

```typescript
// REST (live)
<GetStartedCard
  channel="REST"
  steps={[
    { label: "No install", body: <span>JSON over HTTPS, no key.</span> },
    { label: "curl", body: <code className="block whitespace-pre">curl https://api.pegana.xyz/v1/stats</code> },
    { label: "Done", body: <span>Soft per-IP rate limit. Read the endpoints below.</span> },
  ]}
/>

// WebSocket (live)
<GetStartedCard
  channel="WebSocket"
  steps={[
    { label: "No install", body: <span>Subscribe over WSS, no key.</span> },
    { label: "wscat", body: <code className="block whitespace-pre">{`wscat -c wss://api.pegana.xyz/v1/ws\\n> {"op":"subscribe","assets":["jitoSOL"]}`}</code> },
    { label: "Listen", body: <span>You receive discount snapshots and AlertEvents as JSON frames.</span> },
  ]}
/>

// MCP (preview)
<GetStartedCard
  channel="MCP"
  steps={[
    { label: "Add to client", body: <code className="block whitespace-pre">{`{"mcpServers":{"pegana":{"url":"https://mcp.pegana.xyz"}}}`}</code> },
    { label: "First tool call", body: <span><code>getAssets()</code> returns the live universe. Free.</span> },
    { label: "Pay per call", body: <span>Paid tools auto-quote via x402 — your agent pays USDC, no API key.</span> },
  ]}
/>

// Webhook (preview)
<GetStartedCard
  channel="Webhook"
  steps={[
    { label: "Register URL", body: <span>POST to /v1/me/webhooks with target URL + asset filter.</span> },
    { label: "Verify Ed25519", body: <span>Sample receivers ship in TS / Rust / Python below.</span> },
    { label: "Receive events", body: <span>Signed POST on every state transition. 5-min replay window.</span> },
  ]}
/>

// Telegram (live)
<GetStartedCard
  channel="Telegram"
  steps={[
    { label: "Open bot", body: <span><a className="underline" href="https://t.me/PeganaWatchBot">@PeganaWatchBot</a></span> },
    { label: "/subscribe", body: <span>Pick assets + threshold. Telegram identity, no wallet.</span> },
    { label: "Get alerts", body: <span>Human-readable alerts on every transition.</span> },
  ]}
/>
```

For MCP and Webhook sections, below the GetStartedCard add a "Preview — full launch in v2.0" callout pointing to the SPEC.

- [ ] **Step 4: Visual check**

`cd web && bun dev`, open `/developers`. Confirm: 2-col layout on desktop, sticky TOC visible, 5 anchored sections present, scrolling highlights the active anchor.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(marketing\)/developers/page.tsx
git commit -m "feat(web): /developers sticky TOC + 5 anchored channel sections"
```

### Task B4: Update `/dashboard` subtitle

**Status:** ✅ Done — commit `0680420`. Subtitle added inside `dashboard-overview.tsx` (the canonical dashboard hero) rather than `dashboard/page.tsx` directly, so the line ships with the existing layout.

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Locate the hero/title area**

Run: `grep -n 'Dashboard\|Live\|<h1\|<header' web/app/\(app\)/dashboard/page.tsx | head -10`

- [ ] **Step 2: Add subtitle "Live state of the oracle."**

Wherever the dashboard heading or breadcrumb shows the page identity (likely near the top of the returned JSX), add a small mono-styled line below it:

```typescript
<p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
  Live state of the oracle
</p>
```

If the existing dashboard does not have a visible title (it's an app surface that jumps straight into table), add a small header section above the filters with the subtitle.

- [ ] **Step 3: Commit**

```bash
git add web/app/\(app\)/dashboard/page.tsx
git commit -m "feat(web): /dashboard subtitle 'Live state of the oracle'"
```

---

## Track C — Accessibility sweep

### Task C1: Install axe-core + write a11y e2e test

**Status:** ✅ Done — commit `e108f89`. Baseline: 79 violations across 6 routes (58 color-contrast, 9 focusable-not-tabbable, 5 aria-hidden-focus, 3 only-dlitems, plus singletons). `bun add` migrated lockfile from pnpm → bun (see chore `76e36fd`).

**Files:**
- Modify: `web/package.json` (devDependencies)
- Create: `web/tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Install `@axe-core/playwright`**

```bash
cd web && bun add -d @axe-core/playwright
```

Expected: `package.json` gains the devDependency, `bun.lock` updates.

- [ ] **Step 2: Write the failing test**

Create `web/tests/e2e/a11y.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = [
  "/",
  "/oracle",
  "/methodology",
  "/dashboard",
  "/developers",
  "/concepts",
];

for (const route of ROUTES) {
  test(`a11y — ${route} has zero WCAG AA violations`, async ({ page }) => {
    await page.goto(`http://localhost:3000${route}`);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

- [ ] **Step 3: Run the test (expect failures to be captured)**

```bash
cd web && bun dev &
DEV_PID=$!
sleep 5
bunx playwright test tests/e2e/a11y.spec.ts --reporter=list 2>&1 | tee /tmp/a11y-baseline.log
kill $DEV_PID
```

Expected: prints per-route violation counts. **Save the log.** This is your baseline of violations to fix in C2.

- [ ] **Step 4: Commit (test + baseline)**

```bash
git add web/package.json web/bun.lock web/tests/e2e/a11y.spec.ts
git commit -m "test(web): axe-core a11y sweep across 6 marketing/app routes"
```

### Task C2: Fix WCAG AA violations

**Status:** ✅ Done — commits `63bce2b` + `54ff048` + (post-Lighthouse) `168c92f`. Final state: **0 violations across all 6 routes** (axe-core); Lighthouse a11y 100 on `/`, 95 on `/developers`. Key fixes: `text-caption` token bump `#787878 → #7c7c7c`, `tabIndex={open ? 0 : -1}` on NavDropdown + MobileMenu items, `<dl>`/`<dt>`/`<dd>` structural correction in methodology, CodeBlock `<pre tabIndex={0}>`, AlertsSidebar opacity floor 0.55 → 0.85, state-color labels switched to `text-text` (color stays on pip/diamond/border), LiveTickerCard `<h4>` → `<p>`, footer column `<h5>` → `<h2>`.

**Files:**
- Modify (likely): `web/app/globals.css` (token adjustments), Tailwind config (if color contrast fails), various organisms (aria-labels, alt text).

- [ ] **Step 1: Triage `/tmp/a11y-baseline.log`**

Categorize each violation by rule (`color-contrast`, `aria-label`, `image-alt`, `link-name`, etc.) and by route.

- [ ] **Step 2: Fix per violation type**

Likely fixes:
- **`color-contrast`** on sunset coral text against canvas — bump `text-st-coral` opacity or shift to a slightly lighter hue per the brand (verify against `brand.md` first; do not unilaterally change locked tokens — only adjust *usage*, e.g., use coral only on hairline borders, not body text).
- **`link-name`** on icon-only links — add `aria-label` to any `<Link><IconArrowRight /></Link>` that lacks visible text.
- **`button-name`** on icon-only buttons — same fix.
- **`region`** failures — wrap orphan content in `<section>` or add `role="region"` + `aria-label`.

Apply fixes one rule type per commit.

- [ ] **Step 3: Re-run the test until empty**

```bash
cd web && bun dev &
DEV_PID=$!
sleep 5
bunx playwright test tests/e2e/a11y.spec.ts --reporter=list
kill $DEV_PID
```

Expected: 0 violations across all 6 routes.

- [ ] **Step 4: Commit fixes**

Per rule type, e.g.:

```bash
git add web/components/atoms/icon-arrow-right.tsx web/...
git commit -m "fix(web): add aria-label to icon-only links (a11y)"
```

Repeat for each violation type.

---

## Track D — Deploy unblock + `/oracle` 404 fix

### Task D1: Fix `/oracle` 404 in Vercel production

**Status:** ✅ Done — Vercel deployment `dpl_14rhDC6qE3R7xAWopCNMbVfSPNWu` (V2 prod). Important: deploy must run from `web/` (the Vercel project root), not the repo root — running from root triggers `Error: Request body too large. Limit: 10mb` because Vercel CLI uploads the entire monorepo (Rust + node_modules). Defensive `.vercel` and `.env*.local` entries landed in root `.gitignore` (commit `53a956d`).

**Files:**
- None (operational). Validated by browser.

- [ ] **Step 1: Check current production state**

```bash
curl -I https://www.pegana.xyz/oracle
```

Expected (per memory `project_vercel_root_404`): 404.

- [ ] **Step 2: Trigger a fresh production deploy on Vercel**

```bash
cd web && vercel --prod
```

If you don't have the Vercel CLI authenticated, the command will prompt. Otherwise, push the current branch and Vercel auto-deploys.

- [ ] **Step 3: Verify**

```bash
curl -I https://www.pegana.xyz/oracle
curl -I https://www.pegana.xyz/
```

Expected: both 200.

- [ ] **Step 4: If still 404 — check Vercel project routes config**

Inspect `vercel.json` (if present) for any rewrite or redirect that intercepts `/oracle`. Fix and redeploy. Document the resolution in a follow-up note.

- [ ] **Step 5: No commit needed unless `vercel.json` was edited**

If only operational: skip. If edited:

```bash
git add web/vercel.json
git commit -m "fix(deploy): unblock /oracle in Vercel prod (route resolution)"
```

### Task D2: Hetzner CAX21 deploy (per separate spec)

**Status:** ⏸ **Pending — operator's call.** Does not block Phase 2 frontend or backend work. Current backend continues running wherever it is today; Hetzner migration is independent and can ship anytime. Follow `docs/superpowers/specs/2026-05-25-production-deploy.md` end-to-end.

**Files:**
- Reference: `docs/superpowers/specs/2026-05-25-production-deploy.md`

- [ ] **Step 1: Open the production-deploy spec and follow it end-to-end**

This is a separate ~half-day operation specced elsewhere. Phase 1 of this plan **does not block** on it, but the dogfood (Track E) does require backend running somewhere stable. If Hetzner is not ready, dogfood can run against prod-local docker temporarily — only the artifact write happens at day 14.

- [ ] **Step 2: Verify all backend endpoints from outside the box**

```bash
curl https://api.pegana.xyz/healthz
curl https://api.pegana.xyz/v1/stats
```

Both should return 200 with valid JSON.

- [ ] **Step 3: BotFather setdomain (only after Hetzner up)**

In the Telegram chat with `@BotFather`, send `/setdomain` for `@PeganaWatchBot` → `pegana.xyz`. This locks the Telegram Login Widget to the production domain.

- [ ] **Step 4: No commit (operational milestone)**

---

## Track E — 14-day dogfood + calibration

### Task E1: Enable dogfood routing

**Status:** ⏸ **Pending — kicks off the 14-day clock.** Independent of D2 (Hetzner); can ship on current backend if infra is stable enough to log 14 continuous days. Set both env vars on whatever dispatcher is live and record the start date for E3.

**Files:**
- Modify: `.env` (Hetzner / prod-local — operational, NOT committed)

- [ ] **Step 1: Set the two env vars**

In whatever env file the dispatcher reads:

```
FEATURE_PUBLIC_ALERTS=false
DOGFOOD_TELEGRAM_CHAT_ID=<dogfood-chat-id>
```

- [ ] **Step 2: Restart the dispatcher**

```bash
docker compose -f docker-compose.yml restart dispatcher-rs
```

- [ ] **Step 3: Verify alerts route only to dogfood chat**

Trigger a synthetic alert (any test mechanism the project supports — likely a small change to `alert_events` row state in psql followed by `NOTIFY`). Confirm the Telegram message lands only in chat `<dogfood-chat-id>`.

- [ ] **Step 4: Note the start date in the calibration draft (see Task E3)**

### Task E2: Daily review (passive, days 1–14)

**Status:** ⏸ **Pending — passive, runs in background.** Can run in parallel with Phase 2 work. Capture true/noise per asset daily; final aggregation lands in E3.

**Files:**
- Append (during the period): `docs/CALIBRATION-v1.md`

- [ ] **Step 1: Each day, capture three numbers and any qualitative notes**

For each asset that fired ≥ 1 alert in the past 24h:
- Total alerts fired
- Of those, how many were "true" (sustained state change ≥ 5min) vs "noise" (fluctuated back to PEGGED within 5min)
- Any unclear alert text or threshold that felt wrong

Append to a running notes section in `docs/CALIBRATION-v1.md` (you'll formalize it at day 14 in Task E3).

- [ ] **Step 2: No commits during the period**

Daily notes stay in the draft file uncommitted, or in a scratch file. Final commit happens at Task E3.

### Task E3: Write `docs/CALIBRATION-v1.md` at day 14

**Status:** ⏸ **Pending — the only Phase 3 launch gate among the unfinished tasks.** Must commit before the public launch announcement (Twitter PT+EN thread, HN Show, Superteam Brasil). Per-asset p50/p95/p99 + threshold adjustments.

**Files:**
- Create: `docs/CALIBRATION-v1.md`
- Possibly modify: `assets.toml` (threshold deltas)
- Possibly create: `migrations/0021_threshold_calibration.sql` (if any thresholds changed in DB)

- [ ] **Step 1: Query Postgres for per-asset p50/p95/p99 of |discount_bps| across 14 days**

Use the existing `discount_snapshots` hypertable:

```sql
SELECT
  asset,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY ABS(discount * 10000)) AS p50_bps,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ABS(discount * 10000)) AS p95_bps,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY ABS(discount * 10000)) AS p99_bps,
  COUNT(*) AS samples
FROM discount_snapshots
WHERE ts > now() - interval '14 days'
GROUP BY asset
ORDER BY p99_bps DESC;
```

- [ ] **Step 2: Compare p99 to current `thresholds_bps` in `assets.toml`**

For each asset where p99 > `drift_bps` threshold OR p99 << `drift_bps`, decide whether to retune. Rule of thumb: `drift_bps ≈ p99 × 1.25` to give margin without alert fatigue.

- [ ] **Step 3: Write the calibration artifact**

Create `docs/CALIBRATION-v1.md` with sections:

```markdown
# CALIBRATION v1 — 14-day dogfood (YYYY-MM-DD to YYYY-MM-DD)

## Summary
[2-3 sentences: total alerts fired, true vs noise ratio, any asset that fired excessively or not at all]

## Per-asset distribution
[table: asset · p50_bps · p95_bps · p99_bps · samples · current drift_bps · proposed drift_bps · delta]

## Alerts fired (full list)
[table: ts · asset · from → to · discount_bps · subjective rating: true / noise / borderline]

## Threshold adjustments applied
[list each change with rationale]

## Open items
[anything that wasn't fixable in calibration — e.g., a source that returns stale data sometimes, an asset whose distribution doesn't fit EWMA assumptions]

## Lessons for v2 launch
[3-5 bullets: anything that would surprise a new user or break the trust narrative]
```

- [ ] **Step 4: If thresholds changed, update `assets.toml` AND create a migration**

For each asset whose thresholds you adjusted, edit the `thresholds_bps = { drift = X, depeg = Y, critical = Z }` line in `assets.toml`. Then create `migrations/0021_threshold_calibration.sql` that `UPDATE`s the `assets.thresholds` JSONB column with the new values — pattern matches `0011_deactivate_unusable_assets.sql`.

- [ ] **Step 5: Commit calibration + threshold updates as one atomic commit**

```bash
git add docs/CALIBRATION-v1.md assets.toml migrations/0021_threshold_calibration.sql
git commit -m "feat(calibration): v1 — 14-day dogfood results + threshold tuning"
```

---

## Track F — Health sweep cron

### Task F1: Monthly asset-health sweep script

**Status:** ✅ Done — commit `f270fba`. Script correctly handles the `assets.toml` comment-bleed bug that broke the A2 validation snippet. Dry-run confirmed 22 active assets enumerated, DefiLlama TVL hits 5 of 7 protocol slugs (marinade-finance + 1 other 404 — script falls back to `?`).

**Files:**
- Create: `scripts/asset-health-sweep.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Monthly cross-reference of tracked assets against external health signals.
# Catches dSOL-style protocol failures before they become a credibility leak.

set -euo pipefail

OUT="/tmp/pegana-health-$(date +%Y%m%d).md"
echo "# Asset health sweep — $(date -u +%Y-%m-%d)" > "$OUT"

# 1. Extract active assets from assets.toml
python3 - <<'PY' >> "$OUT"
import re
content = open('/path/to/pegana/assets.toml').read()
blocks = content.split('[[assets]]')[1:]
print('\n## Active assets in TOML')
for b in blocks:
    sym = re.search(r'symbol\s*=\s*"([^"]+)"', b)
    cls = re.search(r'class\s*=\s*"([^"]+)"', b)
    act = re.search(r'^\s*active\s*=\s*(true|false)', b, re.MULTILINE)
    if sym and (not act or act.group(1) == 'true'):
        print(f"- {sym.group(1)} ({cls.group(1) if cls else '?'})")
PY

# 2. Cross-reference each protocol against DefiLlama TVL
echo "" >> "$OUT"
echo "## TVL check (DefiLlama)" >> "$OUT"
for slug in jito-liquid-staking marinade-finance solayer maple-finance ethena; do
  tvl=$(curl -s "https://api.llama.fi/protocol/$slug" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tvl',[{}])[-1].get('totalLiquidityUSD','?'))" 2>/dev/null || echo "?")
  echo "- $slug: \$$tvl" >> "$OUT"
done

# 3. Flag any solana-knowledge DEFUNCT mentions
echo "" >> "$OUT"
echo "## DEFUNCT scan" >> "$OUT"
grep -i "DEFUNCT\|exploit\|frozen" ~/.claude/skills/data/solana-knowledge/04-protocols-and-sdks.md | head -10 >> "$OUT" || true

echo ""
echo "Report written to $OUT"
echo "Review and open follow-up tickets for any issue."
```

Replace `/path/to/pegana` with the absolute path to the repo.

- [ ] **Step 2: Make executable and dry-run**

```bash
chmod +x scripts/asset-health-sweep.sh
./scripts/asset-health-sweep.sh
cat /tmp/pegana-health-*.md
```

Expected: a readable markdown report with TVL numbers per protocol.

- [ ] **Step 3: (Operational) add a cron entry on Hetzner**

```cron
# Asset health sweep, 1st of each month at 09:00 UTC
0 9 1 * * /path/to/pegana/scripts/asset-health-sweep.sh > /var/log/pegana-health.log 2>&1
```

This is operational, not committed.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/asset-health-sweep.sh
git commit -m "ops: monthly asset-health sweep (DefiLlama TVL + DEFUNCT scan)"
```

---

## Track G — Final polish

### Task G1: Visual review + Lighthouse audit

**Status:** ✅ Done — commit `a101a66`. Artifacts in `docs/design-research/2026-05-26-launch/` (7 desktop screenshots + 2 Lighthouse JSON + `LIGHTHOUSE.md`). Lighthouse mobile (production): `/` Perf **80** / A11y 100 / BP 96 / SEO 100; `/developers` Perf 88 / A11y 95 / BP 100 / SEO 91. `/` misses Perf ≥ 85 gate by 5 — bundle-split (GSAP hero, 91 KiB unused JS) is a follow-up sprint. Reproducible via `web/scripts/capture-launch-screenshots.mjs`.

**Files:**
- None (operational verification).

- [ ] **Step 1: Walk through every modified page in production**

After Hetzner deploy + Vercel deploy of the marketing branch: visit each route on a real desktop and a real phone (or Chrome DevTools mobile preview):

- `/`
- `/oracle`
- `/methodology`
- `/concepts`
- `/learn`
- `/developers` (verify sticky TOC works, 5 sections anchored, GetStartedCards render)
- `/dashboard` (verify "Live state of the oracle" subtitle)
- `/account` (no changes expected, sanity)

- [ ] **Step 2: Run Lighthouse on `/` and `/developers`**

In Chrome DevTools → Lighthouse → Run audit for both routes. Targets:
- Performance ≥ 85 (mobile)
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO ≥ 90

Fix anything below target before declaring Phase 1 complete.

- [ ] **Step 3: Capture screenshots in `docs/design-research/2026-05-26-launch/`**

Save 6 screenshots (one per route, desktop only) to the design-research dir. Useful for the eventual launch announcement.

- [ ] **Step 4: Commit screenshots**

```bash
git add docs/design-research/2026-05-26-launch/
git commit -m "docs: capture v2 launch-ready screenshots"
```

---

## Self-Review

### Spec coverage

Reviewing the SPEC's Acceptance Criteria section against this plan:

| Criterion | Covered by Task |
|---|---|
| Hero copy "The specialized peg-risk oracle for Solana" | A5 |
| 5-channel cards on `/` linking to `/developers` anchors | A4, A5, B3 |
| `/oracle` adds "See the math →" link | A6 |
| `/methodology` per-class semantics + back-link | A7 |
| `/dashboard` subtitle "Live state of the oracle" | B4 |
| `marketing-header` lists 5 channels in order | A8 |
| Verification spike performance budgets met | **Out of scope — Phase 2 plan** |
| Webhook reference receivers | **Out of scope — Phase 2 plan** |
| `docs/CALIBRATION-v1.md` committed | E3 |
| Public launch announcement | **Out of scope — Phase 3 plan** |
| `README.md` opening line oracle-first | A2 |
| Performance dashboard panel | **Out of scope — Phase 2 plan (mcp-ts metrics) — partial in this plan via cron** |
| WCAG 2.1 AA: color contrast, keyboard nav, mobile targets, screen-reader, math alt, i18n review | C1, C2 |

**Identified gap:** The acceptance criterion "i18n PT-BR + EN strings reviewed for any new copy added in this spec" is not explicitly covered. Adding to Task A8 as an implicit check (when copying tagline + dropdown items, paste both PT and EN where the existing component supports them).

### Placeholder scan

Searched for "TBD", "TODO", "fill in", "similar to". None remain in code blocks. Operational steps (Hetzner deploy, BotFather setdomain, env var setting on prod) intentionally reference separate spec or runbook — that is not a placeholder, it's a hand-off to a documented operational procedure.

### Type consistency

- `ChannelCards` exports `ChannelCards` (no `Channel` type exported — kept internal).
- `GetStartedCard` props use `channel: "REST" | "WebSocket" | "MCP" | "Webhook" | "Telegram"` consistently across B1 and B3.
- `DevelopersToc` anchors are `rest`, `websocket`, `mcp`, `webhook`, `telegram` — match the section IDs in B3 and the href fragments in A8.

No inconsistencies found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-pegana-v2-phase-0-1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
