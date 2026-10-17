# Inner Pages Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Polish the 8 remaining inner pages (methodology, status, events, embed, developers, learn, about, changelog) with motion vocabulary + page-specific improvements per the spec.

**Architecture:** Heavy reuse of motion primitives. Each page gets one focused task: ~9 tasks total + 1 validation task.

**Tech stack:** No new deps.

**Sources:** spec § 5.5-5.12, mock `.superpowers/brainstorm/52885-1779654553/content/mock-04-inner-pages.html` (GSAP approved), foundation in `web/lib/motion/*`.

**Pacing:** Inner pages wave (P3). Final wave.

**Base branch:** `feat/inner-pages-uplift` (off `feat/asset-compare-uplift`).

---

## File map (per-page)

- `web/app/methodology/page.tsx` — TOC sticky nav + pipeline diagram organism mounted + scroll-trigger stagger
- `web/components/organisms/methodology-pipeline.tsx` — already exists from landing; reuse
- `web/app/status/page.tsx` — stacked horizontal bar by-state + per-source 7d uptime sparklines + alert histogram
- `web/components/molecules/status-stacked-bar.tsx` — NEW
- `web/components/molecules/status-uptime-spark.tsx` — NEW
- `web/components/molecules/status-alert-histogram.tsx` — NEW
- `web/app/events/page.tsx` — GitHub-style heatmap calendar + per-row sparkline thumb
- `web/components/molecules/events-heatmap.tsx` — NEW
- `web/app/embed/page.tsx` — specimen strip (4-up combos) + "Why embed" promoted next to specimen
- `web/components/molecules/embed-specimen-strip.tsx` — NEW
- `web/app/developers/page.tsx` — syntax highlighting on code blocks + scroll stagger
- `web/app/learn/page.tsx` — 4-up grid (was 2-col with hole) + per-card chart preview reveal
- `web/app/about/page.tsx` — "Working on right now" widget pulled from last 3 changelog entries
- `web/components/molecules/about-now-widget.tsx` — NEW
- `web/app/changelog/page.tsx` — clickable tag filters + RSS link
- All 8 pages — `<SiteFooter variant="default" />` (3-col)

**New e2e specs:**
- `web/tests/e2e/inner-pages.spec.ts` — exercises each page's new landmark

---

## Phase 1 — Sections one-by-one (Tasks 1-8)

### Task 1: Methodology — sticky TOC + pipeline + scroll stagger

**Files:** Modify `web/app/methodology/page.tsx`. Reuse `MethodologyPipeline` from landing.

- [ ] **1.1** Read current page
- [ ] **1.2** Add sticky TOC on left (5 anchors matching the 5 sections), with ScrollTrigger-driven `.on` highlight
- [ ] **1.3** Mount `<MethodologyPipeline />` between hero and first section
- [ ] **1.4** Per-section `(0N)` markers stagger fade-up on scroll
- [ ] **1.5** Footer `variant="default"`
- [ ] **1.6** Typecheck + commit

The TOC is a `<nav>` with `position: sticky; top: 5rem`. Each link's `.on` class toggles via ScrollTrigger `onEnter`/`onEnterBack` matching each `<section>`.

```typescript
useEffect(() => {
  // Set up after GSAP loads
  let cleanup: Array<() => void> = [];
  (async () => {
    const ST = await getScrollTrigger();
    document.querySelectorAll<HTMLElement>("[data-meth-section]").forEach((sec, i) => {
      const link = document.querySelector(`[data-toc-index="${i}"]`);
      const trigger = ST.create({
        trigger: sec, start: "top 40%", end: "bottom 40%",
        onEnter: () => link?.classList.add("on"),
        onEnterBack: () => link?.classList.add("on"),
        onLeave: () => link?.classList.remove("on"),
        onLeaveBack: () => link?.classList.remove("on"),
      });
      cleanup.push(() => trigger.kill());
    });
  })();
  return () => cleanup.forEach((c) => c());
}, []);
```

Commit: `feat(methodology): sticky TOC + pipeline diagram + scroll stagger`

---

### Task 2: Status — stacked bar + uptime sparklines + alert histogram

**Files:**
- Create: `web/components/molecules/status-stacked-bar.tsx`
- Create: `web/components/molecules/status-uptime-spark.tsx`
- Create: `web/components/molecules/status-alert-histogram.tsx`
- Modify: `web/app/status/page.tsx`

- [ ] **2.1** `StatusStackedBar` — flex container with segments proportional to state counts. Animate widths from 0 on scroll-trigger.
- [ ] **2.2** `StatusUptimeSpark` — small SVG path per source row. Mock series until backend ships per-source history. prepareDrawIn on scroll.
- [ ] **2.3** `StatusAlertHistogram` — 24-hour bars, scaleY from base on scroll.
- [ ] **2.4** Replace "By state" counter section with `<StatusStackedBar>`. Insert uptime sparks into source rows. Append histogram at bottom.
- [ ] **2.5** Footer default + typecheck + commit

Stacked bar implementation:

```typescript
interface Segment { label: string; count: number; colorVar: string }
export function StatusStackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  const ref = useRef<HTMLDivElement | null>(null);
  useReducedMotionGsap(
    (gsap, reduced) => {
      const root = ref.current; if (!root || reduced) return;
      const divs = root.querySelectorAll<HTMLElement>("[data-seg]");
      gsap.from(divs, { scaleX: 0, transformOrigin: "left center", duration: 1.2, ease: "power3.inOut", stagger: 0.06,
        scrollTrigger: { trigger: root, start: "top 80%", toggleActions: "play none none none" } });
    },
    [],
  );
  return (
    <div ref={ref} className="flex h-12 border border-hairline overflow-hidden">
      {segments.filter(s => s.count > 0).map((s) => (
        <div key={s.label} data-seg style={{ flex: s.count, background: `var(${s.colorVar})` }}
          className="flex items-center justify-center font-mono text-[11px] text-canvas font-semibold">
          {s.count} {s.label}
        </div>
      ))}
    </div>
  );
}
```

Commit: `feat(status): stacked bar + uptime sparklines + alert histogram`

---

### Task 3: Events — GitHub-style heatmap + per-row sparkline

**Files:**
- Create: `web/components/molecules/events-heatmap.tsx`
- Modify: `web/app/events/page.tsx`

- [ ] **3.1** `EventsHeatmap` — 7 rows × 52 weeks grid. Cells color-coded by event count (l0/l1/l2/l3/l4). Mock data until backend exposes per-day aggregate.
- [ ] **3.2** Mount at top of events page, above the current alerts table.
- [ ] **3.3** Per-event-row: inline 4-pt SVG sparkline thumbnail (reuse pattern from activity-timeline task)
- [ ] **3.4** Cells stagger fade-in on scroll-trigger
- [ ] **3.5** Footer default + typecheck + commit

EventsHeatmap mock:

```typescript
export function EventsHeatmap({ buckets }: { buckets: Record<string, number> }) {
  const cells = useMemo(() => { /* compute 52*7 = 364 days */ }, [buckets]);
  return (
    <div className="grid grid-cols-[60px_repeat(52,1fr)] gap-[3px]">
      {/* ... */}
    </div>
  );
}
```

Commit: `feat(events): heatmap calendar + per-row sparkline thumb`

---

### Task 4: Embed — specimen strip 4-up

**Files:**
- Create: `web/components/molecules/embed-specimen-strip.tsx`
- Modify: `web/app/embed/page.tsx`

- [ ] **4.1** `EmbedSpecimenStrip` — 4 badge previews side-by-side: bSOL dark+spark, jitoSOL dark+spark, USDC light+spark, xSOL dark+critical
- [ ] **4.2** Mount above the form. Move "Why embed" up beside it (or above it on mobile).
- [ ] **4.3** Stagger reveal + per-badge sparkline draw-in
- [ ] **4.4** Footer default + typecheck + commit

Commit: `feat(embed): specimen strip 4-up + Why-embed promoted`

---

### Task 5: Developers — syntax highlight on code + scroll stagger

**Files:**
- Modify: `web/app/developers/page.tsx`

- [ ] **5.1** Add inline syntax highlighting: wrap `wss://`, `curl`, `subscribe`, `op`, etc in spans with iridescent stop colors (no shiki/prismjs dep — manual span injection for the 4-5 keywords we use)
- [ ] **5.2** Endpoint rows stagger cascade on scroll
- [ ] **5.3** GET method labels iridescent pulse once on viewport entry
- [ ] **5.4** Footer default + typecheck + commit

Inline highlighting helper:

```typescript
function highlightSnippet(code: string): React.ReactNode {
  const KEYWORDS = ["wss", "https", "curl", "subscribe", "op", "GET", "POST"];
  // Split by keywords, wrap each
  // Or simpler: dangerouslySetInnerHTML with pre-escaped HTML
  return /* ... */;
}
```

Commit: `feat(developers): inline syntax highlight + scroll stagger`

---

### Task 6: Learn — 4-up grid + per-card chart preview

**Files:**
- Modify: `web/app/learn/page.tsx`

- [ ] **6.1** Change grid from `lg:grid-cols-2` to `lg:grid-cols-4`. Add a placeholder 4th card ("Upcoming" with date "SOON") if only 3 case studies exist.
- [ ] **6.2** Each card gets a 140px-tall SVG chart preview at the top (mock data per case study — USDC SVB shape, UST collapse, mSOL flash crash, upcoming)
- [ ] **6.3** Cards stagger on scroll-trigger + chart preview path draw-in
- [ ] **6.4** Optional filter row (All / Stables / LSTs / Algorithmic)
- [ ] **6.5** Footer default + typecheck + commit

Commit: `feat(learn): 4-up grid with chart previews + filter row`

---

### Task 7: About — "Working on right now" widget

**Files:**
- Create: `web/components/molecules/about-now-widget.tsx`
- Modify: `web/app/about/page.tsx`

- [ ] **7.1** `AboutNowWidget` — pulls the last 3 changelog entries. Since changelog is currently a static page, hard-code them as a CHANGELOG_ENTRIES constant exported from `web/lib/changelog.ts` (NEW). Or, simpler: hard-code inside the widget itself with a "TODO: extract" comment.
- [ ] **7.2** Mount in the 2-column layout on /about (left: existing copy + meta. Right: widget).
- [ ] **7.3** Entries stagger fade-up on viewport entry
- [ ] **7.4** Footer default + typecheck + commit

Commit: `feat(about): working-on-right-now widget`

---

### Task 8: Changelog — clickable tag filters + RSS link

**Files:**
- Modify: `web/app/changelog/page.tsx`

- [ ] **8.1** Tag filter row at top (All / Features / Fixes / Internal) — local state filtering
- [ ] **8.2** RSS link in page header (pointing to `/feed/changelog.xml` — even if not generated yet, link target exists)
- [ ] **8.3** Entries fade-up on scroll
- [ ] **8.4** Footer default + typecheck + commit

Commit: `feat(changelog): clickable tag filters + RSS link`

---

## Phase 2 — Validation (Task 9)

### Task 9: Inner-pages Playwright regression

**Files:**
- Create: `web/tests/e2e/inner-pages.spec.ts`

- [ ] **9.1** One test per page asserting the NEW landmark renders + no horizontal scroll at mobile width.

```typescript
import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/methodology", landmark: /pipeline|TOC|methodology/i },
  { path: "/status", landmark: /stacked|uptime|histogram|by state/i },
  { path: "/events", landmark: /heatmap|event/i },
  { path: "/embed", landmark: /specimen|preview/i },
  { path: "/developers", landmark: /REST|WebSocket|endpoint/i },
  { path: "/learn", landmark: /case studies|case study/i },
  { path: "/about", landmark: /working on|reach out/i },
  { path: "/changelog", landmark: /what changed|features|fixes/i },
];

for (const p of PAGES) {
  test(`${p.path} renders new landmark`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByText(p.landmark).first()).toBeVisible({ timeout: 10000 });
  });
  test(`${p.path} no horizontal scroll at 390`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(p.path);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
}
```

- [ ] **9.2** Run full e2e suite — all pre-existing tests + new ones pass
- [ ] **9.3** Typecheck + unit tests clean
- [ ] **9.4** Commit

Commit: `test(e2e): inner-pages regression — 8 pages × landmark + mobile no-overflow`

---

## Done criteria

1. `pnpm typecheck` clean
2. `pnpm vitest run` all unit tests pass
3. `pnpm playwright test` all specs pass (landing + reduced-motion + dashboard + asset-detail + compare + inner-pages = ≥ 50 tests)
4. Each of the 8 inner pages renders its new landmark + no horizontal overflow at 390
5. All 8 inner pages use `<SiteFooter variant="default" />`

When all 5 hold, open PR `feat/inner-pages-uplift` → `main` (stacked behind landing/dashboard/asset-compare PRs).

---

## Out of scope

- Backend `/v1/events/aggregate` endpoint for heatmap real data — mock until shipped
- Per-source uptime history backend endpoint — mock series
- Watchlist persistence backend — localStorage only
- RSS XML generation — link points to `/feed/changelog.xml` for future server route
- Toast component (used by compare wave's save-as-watchlist) — `alert()` placeholder still in use

---

## References

- Spec: `docs/superpowers/specs/2026-05-22-design-uplift.md` § 5.5-5.12
- Approved mock: `.superpowers/brainstorm/52885-1779654553/content/mock-04-inner-pages.html`
- Landing plan: `docs/superpowers/plans/2026-05-22-landing-uplift.md`
- Dashboard plan: `docs/superpowers/plans/2026-05-24-dashboard-uplift.md`
- Asset+Compare plan: `docs/superpowers/plans/2026-05-24-asset-compare-uplift.md`
