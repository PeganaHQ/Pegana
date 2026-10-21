export const meta = {
  name: 'pegana-product-audit',
  description: 'Comprehensive design+feature audit of the Pegana product app (dashboard, assets, asset-detail, compare, events, status) — verified against live UI, code, real API data, references, and library docs',
  whenToUse: 'Full audit + prioritized improvement plan for the Pegana product surfaces',
  phases: [
    { title: 'Recon', detail: '7 dimensions read live shots + code + API data + references in parallel' },
    { title: 'Verify', detail: 'adversarially confirm each finding against the real source — drop already-built / off-brand' },
    { title: 'Synthesize', detail: 'dedup, prioritize, write the report' },
  ],
}

// ---------------------------------------------------------------------------
// Shared context. Every agent gets this so recommendations stay on-brand and
// grounded in the real data layer. Pegana = peg-risk oracle for Solana stables
// + LSTs. The 2026-06-01 audit redesigned ONLY the marketing pages; this
// product app (the signed-in surfaces) was NOT touched — expect a visual seam.
// ---------------------------------------------------------------------------
// Repo root: set PEGANA_ROOT, or run from the repo root.
const ROOT = (typeof process !== 'undefined' && (process.env.PEGANA_ROOT || process.cwd())) || '.'
const EVID = ROOT + '/docs/design-research/2026-06-02-product-audit'
const SHOTS = EVID + '/shots'

const CONTEXT = `
PRODUCT: Pegana — a peg-risk oracle for Solana. It tracks 21 pegged assets
(LSTs like jitoSOL/mSOL/INF, fiat stables USDC/USDT/PYUSD, CDP stables
USDS/hyUSD, delta-neutral USDe, yield-bearing sUSD/USDY/sUSDe/syrupUSDC,
synthetic xSOL) and classifies each as PEGGED / DRIFT / DEPEG / CRITICAL /
BLACK_SWAN by comparing market price vs intrinsic (NAV) value. The signed-in
product app is what we are auditing — NOT the marketing site.

LOCKED DESIGN LANGUAGE (do not violate — these are hard constraints):
- Editorial dark SaaS, premium and calm. NOT Bloomberg/terminal/CLI. NO CRT,
  scanlines, ASCII borders, fake-terminal chrome. Monospace is ONLY for
  numbers, tickers, and small captions/labels — never for body or headings.
- Brand: Threshold Brackets wordmark "[ pegana ]"; sunset coral/magenta accent;
  sharp, restrained, mono-geometric. Reference memory: feedback_no_terminal_aesthetic.
- Stack: Next.js 16 (App Router), Tailwind v4 (tokens in web/app/globals.css),
  framer-motion + GSAP hybrid, Recharts + a TradingView-style tv-chart, SWR.
- Design tokens (Tailwind classes): text, text-body, text-muted, text-caption,
  surface-1, canvas, hairline, outline; state colors st-pegged/st-drift/
  st-depeg/st-critical; washes wash-pegged/wash-drift.
- The 2026-06-01 marketing redesign spec lives in
  docs/design-research/2026-06-01-audit/00-DESIGN-DIRECTION.md and
  04-MOTION-AMBIENT.md — the product app should converge toward that language.
- Onboarding pattern: full modal walkthrough with rich visuals is preferred
  (inline strips / text-only flows were rejected).

DATA LAYER (verified live 2026-06-02):
- API base https://api.pegana.xyz. Endpoints actually used by the UI:
  GET /v1/assets ; GET /v1/assets/{symbol} ; GET /v1/assets/{symbol}/history
  ?bucket=1m&from=ISO&limit=2000 ; GET /v1/stats ; GET /v1/alerts?asset=X&limit=N ;
  WS wss://api.pegana.xyz/v1/ws (live ticks). A Next.js route
  /api/jupiter-quote proxies Jupiter for REAL on-chain slippage (Exit Liquidity).
- Asset payload fields: symbol,name,mint,class,peg_target,decimals,state,
  discount,intrinsic_usd,market_usd,updated_at,series_24h.
- State thresholds are CLASS-SPECIFIC (e.g. USDT shows DRIFT at +0.13% while
  sUSD shows PEGGED at +2.24% because yield/LST bands are wider). Verify this is
  intentional AND legible to a user — a naive user reading raw % will be confused.
- Deprecated assets are filtered from listings (lib/api/format.ts isDeprecated).
- Methodology is in a CALIBRATION window (until ~2026-06-10, verdict gate 06-11);
  the public audit ledger is gated. Keep that in mind for any "trust" claims.
- KNOWN ODDITIES to investigate: there are TWO asset-detail routes
  web/app/(app)/asset/[symbol]/page.tsx (323 lines, the real one) and
  web/app/(app)/assets/[symbol]/page.tsx (22 lines, likely a redirect/dupe).
  Guessed endpoints /v1/events, /v1/assets/X/exit-liquidity, /recovery, /peers
  all 404 — those sections are computed client-side.

EVIDENCE PACK (read what's relevant to your dimension):
- Screenshots (full-page PNGs) in ${SHOTS}/ :
  dashboard-desktop.png, dashboard-mobile.png, assets-list-desktop.png,
  assets-list-mobile.png, asset-jitoSOL-desktop.png, asset-jitoSOL-mobile.png,
  compare-desktop.png, events-desktop.png, status-desktop.png
- Raw API payloads in ${EVID}/ : api-assets.json, api-asset-jitoSOL.json,
  api-asset-USDT.json, api-asset-sUSD.json, api-history-jitoSOL.json
- Network logs: ${EVID}/network-asset.txt, network-dashboard.txt

YOUR JOB: find the highest-value DESIGN and FEATURE improvements for your
surface. For each: cite concrete evidence (a screenshot, a code line, an API
field), say what's there now, recommend a specific on-brand change, explain the
user/business value, and where useful name a best-in-class reference. Separate
"already good, keep" from real gaps. NO generic AI-slop suggestions. NO padding —
the 6-12 highest-leverage findings only, ranked. Be concrete and opinionated.
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: '2-3 sentence verdict on this surface: what works, what is weak' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'category', 'surface', 'severity', 'observation', 'recommendation', 'why', 'effort', 'impact'],
        properties: {
          id: { type: 'string', description: 'short slug, e.g. dash-no-search' },
          title: { type: 'string' },
          category: { type: 'string', enum: ['design', 'feature', 'data-bug', 'ux', 'perf', 'a11y', 'content', 'motion'] },
          surface: { type: 'string', enum: ['dashboard', 'assets', 'asset-detail', 'compare', 'events', 'status', 'global'] },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          observation: { type: 'string', description: 'what exists now, with evidence (file:line or screenshot region or API field)' },
          recommendation: { type: 'string', description: 'specific, on-brand change to make' },
          why: { type: 'string', description: 'user/business value' },
          reference: { type: 'string', description: 'best-in-class source or design-doc pointer; empty if none' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verified'],
  properties: {
    dimension: { type: 'string' },
    verified: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'category', 'surface', 'severity', 'observation', 'recommendation', 'why', 'reference', 'effort', 'impact', 'verdict', 'verdict_reason'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          surface: { type: 'string' },
          severity: { type: 'string' },
          observation: { type: 'string' },
          recommendation: { type: 'string' },
          why: { type: 'string' },
          reference: { type: 'string' },
          effort: { type: 'string' },
          impact: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'revise', 'drop'], description: 'drop if already implemented in code, off-brand, or unfounded' },
          verdict_reason: { type: 'string', description: 'cite the file/line you checked to confirm or refute' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------
const DIMENSIONS = [
  {
    key: 'dashboard',
    label: 'Dashboard 3-pane app shell',
    prompt: `Audit the DASHBOARD — the 3-pane Bloomberg-density app shell (left sidebar / asset list / right peek pane) plus its mobile layout.
Read these shots: ${SHOTS}/dashboard-desktop.png and ${SHOTS}/dashboard-mobile.png.
Read this code: ${ROOT}/web/app/(app)/dashboard/page.tsx ; ${ROOT}/web/app/(app)/layout.tsx ; ${ROOT}/web/components/organisms/dashboard-sidebar.tsx ; ${ROOT}/web/components/organisms/dashboard-topbar.tsx ; ${ROOT}/web/components/organisms/asset-table.tsx ; ${ROOT}/web/components/organisms/asset-preview-pane.tsx ; ${ROOT}/web/components/organisms/onboarding-modal.tsx ; ${ROOT}/web/components/atoms/engine-flow-strip.tsx.
Focus: is there search / command-palette / keyboard nav? sorting & column controls? density toggle? the peek pane's depth vs a full detail page? live-tick affordance (does the user SEE it updating)? watchlist UX? empty/loading/error states; mobile parity; information scent; what a power user (risk desk, trader) needs that's missing. Also judge visual craft vs the locked editorial language.`,
  },
  {
    key: 'assets-compare',
    label: 'Assets list + Compare',
    prompt: `Audit the ASSETS LIST (/assets) and COMPARE (/compare) surfaces.
Read shots: ${SHOTS}/assets-list-desktop.png ; ${SHOTS}/assets-list-mobile.png ; ${SHOTS}/compare-desktop.png.
Read code: ${ROOT}/web/app/(app)/assets/page.tsx ; ${ROOT}/web/app/(app)/assets/[symbol]/page.tsx ; ${ROOT}/web/app/(app)/compare/page.tsx ; ${ROOT}/web/components/organisms/compare-chart.tsx ; ${ROOT}/web/components/organisms/peer-comparison.tsx.
The /assets page is notably flatter than the dashboard (no sparklines, no sort, no search) — is it redundant with the dashboard, or should it differentiate (e.g. a richer directory / screener)? Evaluate Compare: how many assets, what metrics, is the chart legible, can you share/deeplink a comparison? Flag the duplicate /asset vs /assets/[symbol] route. Look for screener-grade features (multi-sort, filter chips, CSV/export, saved views) that a stablecoin/LST analyst expects.`,
  },
  {
    key: 'asset-detail',
    label: 'Asset detail page',
    prompt: `Audit the ASSET DETAIL page — the richest surface (hero, tabs Overview/History/Mechanism/Risk/Identity, 24h spread chart with range toggles, Recovery confidence gauge, Exit liquidity table, alerts CTA).
Read shots: ${SHOTS}/asset-jitoSOL-desktop.png ; ${SHOTS}/asset-jitoSOL-mobile.png.
Read code: ${ROOT}/web/app/(app)/asset/[symbol]/page.tsx and the section components ${ROOT}/web/components/organisms/asset-hero-v2.tsx, asset-chart.tsx, asset-rail.tsx, recovery-confidence.tsx, exit-liquidity.tsx, comparable-events.tsx, mechanism-flow.tsx, time-to-recovery.tsx, activity-timeline.tsx, and ${ROOT}/web/components/organisms/tv-chart/use-tv-chart.ts.
Also read ${EVID}/api-asset-jitoSOL.json and ${EVID}/api-history-jitoSOL.json to see what data is actually available vs shown.
Focus: chart depth (only 24h? add 7d/30d/all, overlays of market vs intrinsic, mark alert events on the chart), the Recovery-confidence and Exit-liquidity sections (are they explained, trustworthy, sourced?), tab content richness, mechanism explainer quality, alert-creation flow, embed/share/permalink, cross-linking to peers. Judge premium feel vs the locked editorial language. Compare to how Pyth / DefiLlama / a TradingView symbol page present a single instrument.`,
  },
  {
    key: 'events-status',
    label: 'Events + Status',
    prompt: `Audit the EVENTS (/events) and STATUS (/status) surfaces.
Read shots: ${SHOTS}/events-desktop.png ; ${SHOTS}/status-desktop.png.
Read code: ${ROOT}/web/app/(app)/events/page.tsx ; ${ROOT}/web/app/(app)/status/page.tsx ; ${ROOT}/web/components/organisms/activity-timeline.tsx.
Events is the de-peg/recovery activity feed (likely backed by /v1/alerts). Status is the system health page. Focus: is the events feed filterable/groupable/live? does it tell a story (what happened, severity, link to the asset+chart moment)? Is Status credible (real component health, uptime, last-tick freshness, methodology calibration banner) vs a static placeholder? What would a user checking "is the oracle healthy and is anything depegging right now" need? Reference: well-built status pages (status.io style), on-chain activity feeds.`,
  },
  {
    key: 'data-integrity',
    label: 'Data correctness & API integrity',
    prompt: `Audit DATA CORRECTNESS — are the information, APIs, and deliveries in order? This is the "be 100% sure" dimension.
Read the real payloads: ${EVID}/api-assets.json ; ${EVID}/api-asset-jitoSOL.json ; ${EVID}/api-asset-USDT.json ; ${EVID}/api-asset-sUSD.json ; ${EVID}/api-history-jitoSOL.json ; and ${EVID}/network-asset.txt ; ${EVID}/network-dashboard.txt.
Read the client code: ${ROOT}/web/lib/api/base.ts, client.ts, types.ts, format.ts, me.ts, ws.ts ; ${ROOT}/web/lib/hooks/use-assets.ts, use-asset.ts, use-history.ts, use-stats.ts, use-alerts.ts ; ${ROOT}/web/lib/state-class.ts ; and the route ${ROOT}/web/app/api (jupiter-quote).
Verify, citing evidence: (1) Does every value shown in the UI match what the API returns (spreads, states, market/intrinsic, timestamps)? (2) Is the state-threshold logic coherent and EXPLAINED — why is USDT DRIFT at 0.13% but sUSD PEGGED at 2.24%? Would a user be misled? (3) Number formatting correctness (decimals, sign, sub-cent, SOL vs USD peg_target units) — use number-formatting best practices. (4) Stale/mock data risk, WS reconnect behavior, SWR cache correctness. (5) The duplicate /asset vs /assets/[symbol] routes — which is canonical, is the other a 404/redirect, SEO/sitemap impact. (6) Any TypeScript type vs payload mismatches. (7) Empty/error/backend-down handling. List concrete bugs as category "data-bug" with severity.`,
  },
  {
    key: 'design-system',
    label: 'Design system / brand / motion / a11y',
    prompt: `Audit DESIGN-SYSTEM COHERENCE, BRAND, MOTION and ACCESSIBILITY across the product app, especially the seam between the freshly-redesigned marketing pages and this untouched product app.
Read the design spec: ${ROOT}/docs/design-research/2026-06-01-audit/00-DESIGN-DIRECTION.md and 04-MOTION-AMBIENT.md ; and ${ROOT}/brand.md ; and the token file ${ROOT}/web/app/globals.css.
Look across ALL shots in ${SHOTS}/ for: typography scale consistency, spacing rhythm, state-color usage, hairline/border system, mono-vs-sans discipline (mono only for numbers/captions), the wordmark, and whether the product feels like the same brand as the redesigned marketing. Evaluate MOTION: is there page-entrance choreography, live-tick flash, reveal-on-scroll, reduced-motion support (lib/motion/*)? Evaluate A11Y: contrast on the dark theme (the state greens/ambers), focus rings, keyboard nav, aria on the live regions, the StatePip announce prop. Flag specific inconsistencies and the highest-leverage polish moves. Stay strictly on-brand (no terminal aesthetic).`,
  },
  {
    key: 'competitive',
    label: 'Competitive & reference research',
    prompt: `Research EXTERNAL REFERENCES and competitors, then propose feature + design ideas Pegana's product app is missing. Use web search and Context7.
Use ToolSearch to load: WebSearch, WebFetch, and the Context7 tools (mcp__plugin_context7_context7__resolve-library-id, query-docs).
(1) Study how best-in-class peg/risk/data products present this domain — Pyth (price feeds), Chaos Labs / Edge risk oracle, Gauntlet, DefiLlama (stablecoins & peg pages), Hyperliquid, Sanctum (LST), Curve pool peg views, Ethena dashboard, Nansen/Dune, and the direct competitor stableguard.org. For each, note 1-2 concrete patterns Pegana could adopt (with the source URL in the reference field).
(2) Use Context7 to check for under-used capabilities in our libs that would raise quality: Recharts (brush, reference lines/areas, synchronized charts), framer-motion (layout/shared-layout animations, AnimatePresence patterns), SWR (subscription/optimistic, useSWRSubscription for the WS), Next.js 16 (streaming, PPR/cache-components for the asset pages), and TradingView lightweight-charts (markers, price lines) since a tv-chart already exists. Tie each to a specific Pegana surface.
Output findings as feature/design improvements with the reference URL/library populated. Keep them realistic and on-brand for an editorial dark SaaS — no generic dashboard slop.`,
  },
]

// ---------------------------------------------------------------------------
// Phase 1 + 2 — recon each dimension, then adversarially verify its findings.
// Pipeline: a dimension's findings get verified as soon as its recon finishes.
// ---------------------------------------------------------------------------
phase('Recon')
log(`Auditing ${DIMENSIONS.length} dimensions of the Pegana product app…`)

const verified = await pipeline(
  DIMENSIONS,
  (dim) =>
    agent(CONTEXT + '\n\n=== YOUR DIMENSION: ' + dim.label + ' ===\n' + dim.prompt, {
      label: 'recon:' + dim.key,
      phase: 'Recon',
      schema: FINDING_SCHEMA,
    }),
  (recon, dim) => {
    if (!recon || !recon.findings || recon.findings.length === 0) return { dimension: dim.label, verified: [] }
    return agent(
      CONTEXT +
        '\n\n=== ADVERSARIAL VERIFICATION: ' + dim.label + ' ===\n' +
        'Below are draft findings from a recon agent. For EACH finding you MUST independently confirm it by re-opening the actual source — the real code files, the screenshots, and the API payloads referenced in the shared context. Be skeptical and rigorous (the user demanded 100% certainty).\n' +
        'Set verdict="drop" if: the recommendation is ALREADY implemented in the code, the observation is factually wrong, it violates the locked design language (e.g. terminal aesthetic), or it is generic filler.\n' +
        'Set verdict="revise" and fix the fields if it is real but mis-stated, mis-scoped, or wrong on effort/impact.\n' +
        'Set verdict="keep" only if you confirmed it against the real source. In verdict_reason, cite the exact file/line or screenshot/API field you checked.\n' +
        'Preserve the id. Return ALL findings with verdicts (do not silently omit any).\n\n' +
        'DRAFT FINDINGS (JSON):\n' + JSON.stringify(recon.findings, null, 2),
      {
        label: 'verify:' + dim.key,
        phase: 'Verify',
        schema: VERIFY_SCHEMA,
      },
    )
  },
)

// Collect confirmed findings (keep + revise; drop the rest).
const confirmed = []
let dropped = 0
for (const v of verified) {
  if (!v || !v.verified) continue
  for (const f of v.verified) {
    if (f.verdict === 'drop') { dropped++; continue }
    confirmed.push(f)
  }
}
log(`Verification done: ${confirmed.length} confirmed findings, ${dropped} dropped.`)

// ---------------------------------------------------------------------------
// Phase 3 — synthesize one prioritized report.
// ---------------------------------------------------------------------------
phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['markdown', 'backlog', 'quick_wins', 'data_bugs_count'],
  properties: {
    markdown: { type: 'string', description: 'the full report in GitHub-flavored markdown' },
    quick_wins: { type: 'array', items: { type: 'string' }, description: 'top 5 high-impact / low-effort items' },
    data_bugs_count: { type: 'number' },
    backlog: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tier', 'title', 'surface', 'category', 'effort', 'impact', 'why'],
        properties: {
          tier: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          title: { type: 'string' },
          surface: { type: 'string' },
          category: { type: 'string' },
          effort: { type: 'string' },
          impact: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
}

const synth = await agent(
  CONTEXT +
    '\n\n=== SYNTHESIS ===\n' +
    'You are the lead. Below are all VERIFIED findings across 7 audit dimensions of the Pegana product app. Produce the final improvement plan.\n' +
    'Tasks: (1) DEDUPLICATE findings that overlap across dimensions (merge, keep the strongest framing). (2) CLUSTER into the surfaces: Dashboard, Assets/Compare, Asset detail, Events/Status, Data correctness (bugs), Design-system/brand/motion/a11y, plus a "Net-new features" cluster from the competitive research. (3) PRIORITIZE every item into tiers: P0 = data-correctness bugs / trust-breaking issues, P1 = high-impact product gaps, P2 = strong improvements, P3 = polish/nice-to-have. Weigh impact vs effort. (4) Surface the top 5 QUICK WINS (high impact, S effort).\n' +
    'Write `markdown`: a comprehensive but skimmable report titled "# Pegana Product Audit — 2026-06-02". Structure: Executive summary (3-5 sentences + a verdict per surface) → Data-correctness bugs (a table, these are P0) → Prioritized backlog (a table: Tier | Surface | Improvement | Effort | Impact) → Per-surface deep-dive sections (each finding: what now / recommendation / why, with evidence + reference) → "Net-new feature bets" from competitive research → Quick-wins shortlist. Be specific and opinionated; preserve concrete file/API references and reference URLs. No fluff.\n' +
    'Also return the structured `backlog`, `quick_wins`, and `data_bugs_count`.\n\n' +
    'VERIFIED FINDINGS (JSON):\n' + JSON.stringify(confirmed, null, 2),
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return {
  confirmedCount: confirmed.length,
  droppedCount: dropped,
  dataBugs: synth.data_bugs_count,
  quickWins: synth.quick_wins,
  backlog: synth.backlog,
  markdown: synth.markdown,
}
