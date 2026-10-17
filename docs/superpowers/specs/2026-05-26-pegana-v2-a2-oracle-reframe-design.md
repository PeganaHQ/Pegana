# Pegana v2 — A2 Oracle Reframe

> Spec for repositioning Pegana from "Solana peg watchdog" to **"the
> specialized peg-risk oracle for Solana"**. Zero route renames. Copy
> rewrite + nav reorder + two new channels (MCP server with x402 payment
> wrapper, Ed25519-signed webhook). Pattern lifted from Autonom (1st
> RWAs $25k Cypherpunk 2025) and MCPay (1st Stablecoins $25k Cypherpunk
> 2025).

**Status:** ready for review → writing-plans
**Branch:** `feat/v2-oracle-reframe` (suggested; not created yet)
**Target ship date:** ~90 days from approval (3 phases)
**Author:** Rafael (+ Claude)

---

## Why now

Three independent pressure points landed in the same week (2026-05-26):

1. **Competitive landscape v2 finished.** Direct competitors on peg-risk
   for Solana: zero (verified across 5,400+ Colosseum projects). Closest
   neighbor — Stratalink Labs (liquidity oracle, Cypherpunk 2025, no
   prize). Confirmed in `docs/landscape-2026-05-26.html`.

2. **Found two winner playbooks that map exactly to Pegana.**
   - **Autonom playbook:** "Specialized [vertical] oracle for Solana
     adjusting for [thing incumbents miss]." Won 1st RWAs $25k.
     Replacing "RWA / corporate actions" with "peg / mechanism semantics"
     yields Pegana's pitch verbatim.
   - **MCPay playbook:** "Monetize MCP tools / AI agents via x402 +
     stablecoins." Won 1st Stablecoins $25k. x402 was formalized by the
     Linux Foundation 2026-04-02 with Solana Foundation among 22 founding
     members. The MCP + x402 + Solana stack is now the validated path to
     monetize a data feed in this ecosystem.

3. **dSOL incident exposed a credibility risk.** Drift was exploited
   2026-04-01 ($285M, DPRK-linked, frozen). dSOL was still in
   `assets.toml` reading PEGGED off stale Sanctum state. **Fixed in
   commit `477db4d`** — but the broader lesson is that Pegana's
   positioning as "watchdog / dashboard" makes its quality bar look
   informational, not infrastructural. Repositioning as oracle raises
   that bar to where it belongs.

The reframe is **strategic, not technical**. The backend already does
what an oracle does (multi-asset, mechanism-aware, dual-source, sub-second
WS, history in TimescaleDB). The web already has `/oracle`, `/developers`,
`/embed` pages. The site structure points at oracle; the copy and
hierarchy still point at watchdog. This spec closes the gap.

---

## Validation summary (pre-spec research, 2026-05-26)

Every technical decision below was cross-checked against live sources.

| Claim | Source | Status |
|---|---|---|
| MCP TypeScript SDK mature: `@modelcontextprotocol/sdk@1.29.0` is canonical stable; `@x402/mcp@2.13.0` pins `sdk@^1.12.1` | Context7 + npm registry direct (verified 2026-05-26) | ✅ |
| `@x402/mcp` real version + exports | npm registry `@x402/mcp@2.13.0`; GitHub coinbase/x402 monorepo `typescript/packages/mcp/` confirms | ✅ |
| `@x402/svm` real version + exports `./exact/server`, `./exact/client`, `./v1`; USDC mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` confirmed in `constants.ts` | GitHub coinbase/x402/typescript/packages/mechanisms/svm/ direct read | ✅ |
| Hono adapter: use SDK example `examples/server/src/honoWebStandardStreamableHttp.ts`; no pre-release `@modelcontextprotocol/hono@2.0.0-alpha.2` needed | GitHub modelcontextprotocol/typescript-sdk tree (verified) | ✅ |
| Official MCP + x402 integration package exists: `@x402/mcp` with `createPaymentWrapper` + `paid(handler)` | Context7 `/coinbase/x402`, Score 95, 3766 snippets | ✅ |
| Solana CAIP-2 identifier for x402: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet beta) | Coinbase x402 docs, Solana developer guide | ✅ |
| USDC mint on Solana mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Solana developer x402 guide | ✅ |
| x402 production: 69k active agents, 165M txs, $50M cumulative volume by April 2026 | Web search (CDP / Coinbase / Eco docs) | ✅ |
| x402 formal foundation: Linux Foundation 2026-04-02, MCP Dev Summit NA; Solana Foundation among 22 founding members | Coinbase + Linux Foundation announcements | ✅ |
| Ed25519 webhook signing pattern: Web Crypto API native in Cloudflare Workers; timestamp + 5-min replay window, no nonce DB needed | Cloudflare docs + Svix security guide | ✅ |
| Next.js 16.2 stable; `use cache`/`cacheLife`/`cacheTag`/`updateTag` stable. Pegana already on 16.2.6 | Vercel release notes May 2026 | ✅ |
| 8 LSTs in active coverage (6 SOL-pegged + 2 Hylo) all healthy in 2026; Sanctum TVL $2.53B; INF leads at 8.5% yield | DeFiLlama (web search), Sanctum blog 2026, `assets.toml` direct read 2026-05-26 | ✅ |
| Next Colosseum hackathon: Frontier closed 2026-05-11; Agent Hackathon ($100k) was Feb 2026; **next hackathon TBD, expected Q4 2026** | Colosseum.com, blog.colosseum.com | ✅ |

**Single uncertainty left:** exact start date of the next Colosseum
hackathon. Roadmap fase 3 builds a Pegana submission for whichever Solana
hackathon opens in Q4 2026 (Stablecoins or Infrastructure track).

---

## Audit corrections (round 2)

After writing the first draft of this spec, every claim that touched the
codebase was re-verified against the actual files. Six corrections
landed inline before this revision:

| # | Initial claim | Corrected to |
|---|---|---|
| 1 | Top-nav file `site-header.tsx` | Actual file `marketing-header.tsx` (`(marketing)` group); `(app)` uses separate `product-header.tsx` |
| 2 | `mcp-ts/` (sibling to `bot-ts/`) | `mcp-ts/` at repo root — `apps/` dir does not exist; project uses flat top-level packages |
| 3 | "`/oracle` becomes the methodology page" | `/methodology` already exists in `(app)` with `MethodologyEquation`, `MethodologyStateMachine`, `MethodologyPipeline`. Decision #2 now keeps both and cross-links them |
| 4 | Top-nav order "`Oracle · Dashboard · Assets · Developers · Learn · Account`" | Actual structure is dropdown-based: `Oracle · Developers ▾ · Learn ▾ · About · Changelog · [Dashboard CTA]`. Decision #3 reworked accordingly |
| 5 | MCP SDK import `@modelcontextprotocol/server` (v1.x modular) | `@modelcontextprotocol/sdk` (canonical package used in x402 + MCP official example) |
| 6 | "Cross-link to `/learn` for educational primer" | `/concepts` is the primer; `/learn` is case studies. Both already exist; decision #2 references them by their actual role |

### Codebase claims verified

| Claim | Status |
|---|---|
| `/oracle` at `web/app/(marketing)/oracle/page.tsx` | ✅ |
| `/methodology` at `web/app/(app)/methodology/page.tsx` | ✅ (existing math page) |
| `/concepts` at `web/app/(marketing)/concepts/page.tsx` | ✅ (existing primer) |
| `/learn` at `web/app/(marketing)/learn/page.tsx` | ✅ (existing case studies) |
| `/dashboard` at `web/app/(app)/dashboard/page.tsx` | ✅ |
| `web/components/organisms/marketing-header.tsx` with dropdowns | ✅ |
| `web/lib/hooks/use-stats.ts`, `use-assets.ts` | ✅ |
| `users` table in migration `0001_initial.sql` | ✅ |
| `web_sessions` table in migration `0018` | ✅ (`jti`, `telegram_id`, `expires_at`) |
| Redis channels `pegana:src:*`, `pegana:alerts`, `pegana:discount` in `pegana-common` | ✅ (lines 315–325 of `crates/common/src/lib.rs`) |
| `AlertEvent` struct with `id`, `asset`, `from_state`, `to_state`, `discount`, `intrinsic_usd`, `market_usd` | ✅ |
| `bot-ts/` runtime is Bun | ✅ (`bun.lock` + `bun run` scripts) |
| `xSOL`, `hyUSD`, `sHYUSD` in `assets.toml` | ✅ |
| `apps/` dir at repo root | ❌ does not exist (path corrected) |
| `site-header.tsx` file | ❌ does not exist (file corrected to `marketing-header.tsx`) |

### Remaining uncertainties (lower confidence)

| Item | Why uncertain | Mitigation |
|---|---|---|
| ~~`@x402/mcp` exact installed version~~ | RESOLVED — `@x402/mcp@2.13.0` (latest stable on npm registry, verified 2026-05-26). Depends on `@modelcontextprotocol/sdk@^1.12.1`. | Pin `^2.13.0` in `mcp-ts/package.json` |
| ~~`@modelcontextprotocol/sdk` vs `@modelcontextprotocol/server`~~ | RESOLVED — `@modelcontextprotocol/sdk@1.29.0` is the canonical stable. `@modelcontextprotocol/server` is the v2.0 alpha modular refactor. `@x402/mcp` v2.13.0 pinned to `sdk@^1.12.1`. | Use `@modelcontextprotocol/sdk@^1.29.0` (compatible with `@x402/mcp` peer range) |
| ~~HTTP transport adapter~~ | RESOLVED — SDK v1.x ships an official example `examples/server/src/honoWebStandardStreamableHttp.ts`. Use that pattern instead of the pre-release `@modelcontextprotocol/hono@2.0.0-alpha.2` package. | Copy the example pattern; no extra dep beyond `@modelcontextprotocol/sdk` + `hono` |
| ~~`@x402/svm` exact version + exports~~ | RESOLVED — `@x402/svm@2.13.0`. Exports include `./exact/client`, `./exact/server` (and others). Constants confirm USDC mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. | Pin `^2.13.0` |
| `mcp.pegana.xyz` subdomain | DNS not yet configured | Operational task during Phase 2 (Caddy + DNS update); not a spec change |
| `PEGANA_PAYTO_USDC` address | Not yet provisioned | Hardware-wallet-controlled Solana address before paid tools go live |
| Smithery.ai / mcp.run directory listing requirements | Not yet researched | Read submission templates in first week of Phase 2 |

Anything not in this audit table is grounded in either a file read, a
grep, or a confirmed external source. Anything in the "remaining
uncertainties" table is flagged so it doesn't ambush the implementation.

---

## References

Patterns reviewed during landscape v2 and lifted into this spec.

| Source | Pattern lifted | Pattern rejected |
|---|---|---|
| **Autonom** (Cypherpunk 2025, 1st RWAs $25k) | "Specialized [vertical] oracle for Solana adjusting for [mechanism]" hero copy; technical-argument-first landing | corporate-action-only scope (RWA-only); the pattern generalizes |
| **MCPay** (Cypherpunk 2025, 1st Stablecoins $25k) | MCP + x402 monetization stack, per-call USDC pricing for AI agents | their tool-marketplace generality (Pegana stays vertical) |
| **Chaos Labs Edge** (Jupiter primary oracle, ~90% Solana perps volume) | Risk-oracle-as-primitive framing; B2B contracts for tier-3 customers; documented methodology page | EVM-centric infra; pure-B2B (Pegana keeps retail Telegram tier) |
| **StableGuard.org** (live global, ~5 fiat stables) | Class-aware threshold design; public methodology | dashboard-only delivery; no LST / NAV / CDP coverage |
| **Stratalink Labs — Liquidity Truth Layer** (Cypherpunk 2025, no prize) | Institutional-grade risk-intelligence target audience | "AI-powered analytics" framing that diluted their pitch |
| **MCP Dev Summit NA 2026-04** | MCP servers via Streamable HTTP transport, not stdio, for production exposure | local-only MCP (Pegana ships hosted) |
| **Linux Foundation x402 governance** | x402 v2 spec; settlement via facilitator at `x402.org`; CAIP-2 network IDs; per-call price strings (`"$0.001"`) | building a custom facilitator (Pegana uses the public one in v2) |
| **Pegana's own `/oracle` page** | "Built to be consumed" hero, 3 use-case cards (insurance / prediction markets / lending) — already shipped, just needs promotion | nothing — content is correct, position is wrong |

---

## Strategic posture: A2 confirmed

After exploring A1 (additive — oracle + dashboard side-by-side) vs A2
(oracle is the product; dashboard / Telegram / web are channels), **A2 is
chosen** based on:

- Autonom and MCPay both won with **single-layer messaging**. A1 sells in
  two layers (oracle + dashboard) which dilutes the pitch.
- "Specialized > generic in oracles" is the explicit winner pattern in
  the Colosseum dataset.
- Pegana is solo-founder. A2 reduces surface to maintain.
- The site already has `/oracle`, `/developers`, `/embed` — A2 just
  promotes them; A1 would keep them secondary.

**A2 is implemented without renaming routes.** That decision was
revisited: the original spec proposed `/oracle → /`, `/dashboard →
/state`, `/methodology` (new). Revised to **zero rename**:

- `/` (existing landing) gets the oracle hero copy and the 5-channel
  cards.
- `/oracle` (existing) becomes the **methodology** page (the moat
  narrative — how we compute intrinsic by mechanism class).
- `/dashboard` (existing) keeps its URL; subtitle reframed to "Live state
  of the oracle."
- `/developers` (existing) adds **MCP** and **Webhook** sections to the
  existing REST + WS + Telegram surface.
- No redirects. No SEO canonical migration. No broken bookmarks. Less
  code touched.

---

## Decisions

### 1. Hero copy + landing reframe (`/`)

**Replace:**

> Solana peg watchdog · early-warning system for Liquid Staking Tokens
> and stablecoins on Solana.

**With:**

> The specialized peg-risk oracle for Solana.
>
> Pegana indexes 23 Solana LSTs, stablecoins, yield-bearing assets,
> CDPs, and synthetics. We publish each asset's intrinsic-vs-market
> discount, peg state, and every transition (PEGGED ↔ DRIFT ↔ DEPEG ↔
> CRITICAL ↔ BLACK_SWAN) via REST, WebSocket, MCP, Webhook, and Telegram.
> Built to be consumed.

**CTAs:** primary `Read the API` → `/developers`; secondary `Explore live
state` → `/dashboard`.

**Below hero:** 5 channel cards (REST · WS · MCP · Webhook · Telegram)
linking to the respective `/developers` section. Each card carries a
one-liner ("Sub-second feed via WebSocket. No key.") + status pill
(`live` / `preview`).

**Below cards:** 3 use-case cards lifted from current `/oracle` —
Insurance · Prediction markets · Lending/perps. (Migrating this section
out of `/oracle` is what frees `/oracle` to become methodology.)

**Below use-cases:** live preview of the feed — top-3 currently drifting
assets (already implemented via `useAssets` + `useStats`).

**Files:** `web/app/(marketing)/page.tsx`, `web/components/organisms/hero-landing.tsx`
(refactor), new `web/components/organisms/channel-cards.tsx` (5 cards),
move `UseCase` rendering from current `/oracle` page to landing.

### 2. Keep `/oracle` as pitch page; keep existing `/methodology` as math page; cross-link them

**Audit correction (against initial draft):** Pegana already has both
`/oracle` (marketing pitch page) AND `/methodology` (in `(app)` group —
math deep-dive with `MethodologyPipeline`, `MethodologyEquation`,
`MethodologyStateMachine` components already built). It also has
`/concepts` (marketing — "primitives explained once") and `/learn`
(marketing — case studies). **Zero new pages needed.**

The reframe operates on the **content + linking**, not the routes:

- **`/oracle` (marketing)** — keep as the pitch. Current sections ("Who
  reads from Pegana", "Surfaces", "Commitments") all land correctly.
  Edit: add a prominent "See the math →" link to `/methodology`. Add a
  short paragraph at the bottom that points readers to `/concepts`
  (primer) and `/learn` (case studies). Make sure the 5 channels (REST ·
  WS · MCP · Webhook · Telegram) are surfaced — they're the product.
- **`/methodology` (app)** — keep as the math deep-dive. Existing
  components (`MethodologyEquation` + `MethodologyStateMachine`) are
  the right scaffolding. Verify per-class semantics (NAV / stake-pool /
  CDP / FX) are documented at the right depth; add what's missing.
  Edit: add a back-link to `/oracle` ("See the pitch →") and an
  inline link to `/concepts` for primer-level explainers.
- **`/concepts` (marketing)** — keep. It is the public "primitives
  glossary" (LST drift, NAV oracle, CDP collateral ratio).
- **`/learn` (marketing)** — keep. Case studies and longer-form posts.

**Files:** light edits to
- `web/app/(marketing)/oracle/page.tsx` — add cross-links + ensure 5
  channels referenced.
- `web/app/(app)/methodology/page.tsx` — add cross-links + verify
  per-class coverage.

**No deletion. No new route. No redirect.**

### 3. Top-nav adjustment (marketing header)

**Audit correction:** the actual file is
`web/components/organisms/marketing-header.tsx` (not `site-header.tsx`),
and the structure is dropdown-based, not a flat list. The `(app)` group
uses a separate `product-header.tsx`. Current marketing header order is
already **Oracle-first**:

```
Brand · Oracle · Developers ▾ · Learn ▾ · About · Changelog · [Dashboard CTA]
```

Where:
- `Developers ▾` dropdown items: REST API · Examples · Embed widget
- `Learn ▾` dropdown items: Concepts · Case studies · Methodology

**Changes for v2:**

1. **Rename the `Developers` dropdown items** to surface the 5 channels:
   ```
   Developers ▾
     · REST API           (existing: /developers)
     · WebSocket          (existing: /developers#websocket — new anchor)
     · MCP                (NEW: /developers#mcp)
     · Webhook            (NEW: /developers#webhook)
     · Telegram bot       (NEW: /developers#telegram — anchor in same page)
     · Examples           (existing: /developers/examples)
     · Embed widget       (existing: /embed)
   ```

2. **Keep everything else as-is.** The `Learn` dropdown already includes
   `Methodology` and `Concepts` — those map cleanly to decision #2.

3. **`Dashboard` stays as CTA** in the right side of the nav. Adding a
   small label change in the page itself: `/dashboard` page subtitle
   reads "Live state of the oracle." Header CTA stays "Dashboard".

**Files:**
- `web/components/organisms/marketing-header.tsx` (extend
  `developersItems` array).
- `web/components/molecules/mobile-menu.tsx` (mirror items in mobile
  list).
- `web/app/(app)/dashboard/page.tsx` (subtitle line near hero).

### 4. `/developers` adds MCP and Webhook sections

The page already has REST, WS, and Telegram sections (per existing
`developers/page.tsx`). Add:

- **MCP section** — quickstart for connecting an agent (Claude Desktop,
  Cursor, custom) to `mcp.pegana.xyz`. Tool list, schemas, pricing
  pointer.
- **Webhook section** — quickstart for receiving signed POSTs; Ed25519
  verification example in TypeScript (Cloudflare Worker pattern), Rust
  (axum middleware), and Python (FastAPI). Public Ed25519 public key.

**Layout — sticky left-rail TOC:**

Linear-style sticky navigation listing the 5 channels in order:
`#rest · #websocket · #mcp · #webhook · #telegram`. Each anchor jumps
to its section. Active anchor highlighted while scrolling
(IntersectionObserver). On `lg+` viewports only; mobile collapses
into a top-of-page chip strip.

**"Get started" cards per channel:**

Each of the 5 channel sections leads with a uniform 3-step "Get started"
card (concrete, copy-paste-ready), then expands into reference. Pattern:

```
1. Install / configure        — exact command or config snippet
2. First request               — minimal curl / code that returns data
3. Authenticate / pay          — if applicable (MCP: x402 payTo;
                                 Webhook: register URL; rest: free)
```

For MCP specifically, the card shows the Claude Desktop config JSON
fragment plus a `curl` against the Streamable HTTP endpoint that returns
a tool catalog — proving connectivity before any agent wiring.

**Files:**
- `web/app/(marketing)/developers/page.tsx` — add MCP + Webhook
  sections, restructure into 5 named anchors.
- New `web/components/molecules/developers-toc.tsx` — sticky left rail.
- New `web/components/molecules/get-started-card.tsx` — reusable
  3-step card.
- Keep existing `examples/` recipes (Discord mirror, MEV scanner, etc.)
  unchanged. Pricing pointer references decision #8.

### 5. MCP server in TypeScript

**Stack (pinned, verified 2026-05-26 against npm registry + GitHub):**

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@x402/mcp": "^2.13.0",
    "@x402/svm": "^2.13.0",
    "@x402/core": "~2.13.0",
    "@solana/kit": "^5.1.0",
    "hono": "^4.6.0",
    "ioredis": "^5.4.0",
    "pg": "^8.13.0",
    "zod": "^3.24.2"
  }
}
```

**Notes on the stack:**

- `@modelcontextprotocol/sdk@1.29.0` is the canonical stable line. The
  v2.0 alpha modular split (`@modelcontextprotocol/server`,
  `@modelcontextprotocol/node`, `@modelcontextprotocol/hono`) is
  pre-release and not used. `@x402/mcp@2.13.0` itself depends on
  `sdk@^1.12.1` — staying on v1.x is the compatible path.
- HTTP transport: use the official example pattern from
  `examples/server/src/honoWebStandardStreamableHttp.ts` in the SDK
  repo. Web-standard fetch + Hono. Runs on Bun without Node-specific
  shims.
- `@x402/svm@2.13.0` exposes `./exact/server` for the scheme adapter.
- `@solana/kit@>=5.1.0` is a peer dep of `@x402/svm`.

**Location:** new package `mcp-ts/` at the repo root, sibling to
`bot-ts/`. (Audit correction: no `apps/` directory exists; the project
uses flat top-level packages.) Bun runtime (matches `bot-ts` — confirmed
via `bot-ts/bun.lock` + `bun run` scripts). Builds to a single process
behind Caddy on Hetzner.

**Tools exposed (v2 launch):**

| Tool | Free? | Returns |
|---|---|---|
| `getAssets` | free | List of tracked assets with current state |
| `getAssetState(symbol)` | free | Current state + discount + intrinsic + market for one asset |
| `getAssetHistory(symbol, bucket, limit)` | **paid** ($0.001/call) | Time-series of discount over N buckets |
| `getMethodology(symbol)` | free | Per-asset mechanism explanation |
| `subscribePegEvents(symbols, threshold_bps)` | **paid** ($0.0005/call) | Stream of AlertEvents for matching subs (WS-style subscribe, but inside MCP session) |
| `ping` | free | Health check |

**Why TypeScript over Rust:** `@x402/mcp` is TypeScript-only as of
2026-05-26. Implementing a Rust shim would duplicate work for a v2 where
speed-of-build matters more than runtime cost. The MCP server only reads
from Redis pub/sub (already published by engine-rs) and Postgres
(reusing api-rs queries) — no hot-path computation.

**Reuse from existing stack:** Redis client config and channel names
from `pegana-common` (we'll mirror the TS types into a small
`@pegana/shared` module written by hand to start; codegen if it bites
later). Postgres queries cloned from api-rs route handlers (history
endpoint is the only one needed for v2).

**Performance budgets (mandatory before paid-tools go to mainnet):**

| Metric | Target | Measured during |
|---|---|---|
| MCP cold-start latency (first request after deploy) | p99 < 800ms | Phase 2 #4 verification spike |
| MCP warm-hit latency (free tools, Redis cache) | p99 < 50ms | Phase 2 #5 internal soak |
| MCP warm-hit latency (paid tools, Postgres history) | p99 < 200ms | Phase 2 #5 internal soak |
| x402 facilitator round-trip (settlement) | p95 < 1.5s | Phase 2 #4 devnet test |
| Webhook dispatch latency (signing + POST, single subscriber) | p99 < 1s | Phase 2 #8 receiver test |
| Webhook full fan-out (1 alert → all matching subs at p99) | < 5s | Phase 2 #8 receiver test |
| Concurrent webhook dispatch pool | 50 in-flight max | Configured in `dispatcher-rs/src/webhook.rs` |
| WS publish latency (engine → first client) | unchanged: p99 < 250ms | Existing instrumentation |

If any target is missed in the verification spike, **do not proceed**
to paid tools on mainnet. Tune or descope.

**MCP error contract:**

All tool handlers conform to a single error envelope. Free-tool errors
return `isError: true` with a `text` content; paid-tool 402 returns the
x402 envelope as documented by `@x402/mcp`. Concrete examples:

```typescript
// Free tool — bad input
{
  content: [{ type: "text", text: "Error: asset 'XYZ' not tracked. Use getAssets() to list tracked symbols." }],
  isError: true
}

// Free tool — stale data (engine paused / source down)
{
  content: [{ type: "text", text: "Error: asset 'sUSDe' has no fresh discount snapshot (last update > 5min ago). Returning last-known state." }],
  isError: true,
  _meta: { state: "UNKNOWN", lastFreshSec: 312 }
}

// Paid tool — payment required (delegated to @x402/mcp wrapper)
// Wire-format is automatic; the wrapper emits:
// HTTP 402 + accepts[] in the response body + the SDK passes it through
// as the standard x402 "Payment Required" envelope.
```

Internal Pegana errors (DB query timeout, Redis disconnect) bubble up
as `isError: true` with a generic `"Temporary upstream error, retry in
a few seconds."` message plus a Sentry breadcrumb. Never leak stack
traces to the wire.

**Transport:** Streamable HTTP via the `honoWebStandardStreamableHttp`
pattern from the SDK examples (web-standard Fetch + Hono). Not stdio for
production. Hosted at `https://mcp.pegana.xyz`. Stateless mode (transport
per request) for simplicity v2; stateful (sessions) if usage justifies
later. Stdio transport added as a dev-mode entry point for local Claude
Desktop integration testing.

### 6. x402 payment per-call on MCP tier

**Pattern (verbatim from `@x402/mcp` README):**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const mcp = new McpServer({ name: "pegana-oracle", version: "2.0.0" });

const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});
const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register(
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // Solana mainnet beta
  new ExactSvmScheme()
);
await resourceServer.initialize();

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  payTo: process.env.PEGANA_PAYTO_USDC!, // Pegana's USDC receive address
  price: "$0.001",
});

const paid = createPaymentWrapper(resourceServer, { accepts });

mcp.tool(
  "getAssetHistory",
  "Time-series of intrinsic-vs-market discount. Costs $0.001.",
  { symbol: z.string(), bucket: z.string(), limit: z.number().max(50000) },
  paid(async ({ symbol, bucket, limit }) => {
    const rows = await fetchHistoryFromPg(symbol, bucket, limit);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  })
);

mcp.tool("getAssetState", "Free. Returns current state for one asset.",
  { symbol: z.string() },
  async ({ symbol }) => {
    const row = await fetchCurrentFromRedis(symbol);
    return { content: [{ type: "text", text: JSON.stringify(row) }] };
  }
);
```

**Pricing (v2 launch):**

- `getAssetHistory`: `$0.001` per call
- `subscribePegEvents`: `$0.0005` per call (subscription open)
- All other tools: free

**Free quota for retail discovery:** `1000 free calls / day per agent`
(identified by `x-payment` header origin), then paid. Implemented as
metadata in `accepts` extensions if x402 supports it natively, otherwise
in-process counter in the MCP server (Redis-backed if scale demands).

**Settlement:** Pegana's USDC receive address on Solana mainnet
(`payTo`). New env var `PEGANA_PAYTO_USDC` — a hardware-wallet-controlled
address Rafael owns. **Do not hot-key the receive wallet.** The
facilitator settles; Pegana doesn't sign anything.

### 7. Webhook channel signed with Ed25519

Specced in `docs/superpowers/specs/2026-05-25-webhook-channel.md` as
deferred. This spec **pulls it forward into v2 phase 2**.

**Protocol:**

- `POST <subscriber URL>` with JSON body:
  ```json
  { "asset": "sUSDe", "from_state": "PEGGED", "to_state": "DRIFT",
    "discount_bps": -47, "ts": 1779812345, "alert_id": "uuid" }
  ```
- Headers:
  - `x-pegana-signature`: `ed25519:<base64-encoded sig>`
  - `x-pegana-timestamp`: unix seconds (string)
  - `x-pegana-public-key`: `<base64 pub key fingerprint>` (advisory; the
    canonical key lives on `/developers`)
- **Signature input:** `<timestamp>.<body>` (canonical UTF-8 string).
- **Replay window:** receiver MUST reject `|now - timestamp| > 300s`.
- **Idempotency:** `alert_id` is unique per AlertEvent; receivers SHOULD
  dedupe on it (Pegana retries on 5xx).

**Server side (Rust, in dispatcher-rs):**

- New module `crates/dispatcher-rs/src/webhook.rs`.
- Read subscribers from `webhook_subscriptions` table (new).
- For each AlertEvent matching a subscription, sign with Ed25519 (key
  loaded from `PEGANA_WEBHOOK_SIGNING_KEY` env var, generated once,
  rotated via key versioning), POST with timeout 5s.
- Retry policy: 3 attempts, exponential backoff 1s/5s/30s, dead-letter
  to `webhook_dead_letter` table after 3 failures. Sentry alert on dead
  letter.
- Concurrency: tokio task pool, max 50 concurrent POSTs.
- Metrics: `pegana_webhook_dispatches_total{status}`,
  `pegana_webhook_dispatch_latency_seconds`.

**Receiver side (documented examples):**

- TypeScript / Cloudflare Worker (uses Web Crypto API, Ed25519 native
  per Secure Curves spec).
- Rust / axum (tower-http middleware example).
- Python / FastAPI (using `cryptography` library).

**Onboarding:** new `/account/webhooks` page lets users register a URL +
gives them the public key fingerprint. v2 launch: manual approval (one
webhook per user). v2.1: self-serve unlimited if Protocol tier (decision
#8).

**Reference-receiver test matrix (must pass before Phase 2 #8 ships):**

Before declaring the webhook channel ready, three reference receivers
must accept a signed payload and reject a tampered one. Each receiver
becomes a code sample published on `/developers#webhook`:

| Receiver | Stack | Verification API | Test cases |
|---|---|---|---|
| 1 | TypeScript / Cloudflare Worker | Web Crypto API `crypto.subtle.verify` with Ed25519 (Secure Curves) | accept valid · reject stale ts · reject bad sig · idempotent retry |
| 2 | Rust / axum | `ed25519-dalek` or tower-http verifier | same 4 cases |
| 3 | Python / FastAPI | `cryptography.hazmat.primitives.asymmetric.ed25519` | same 4 cases |

Test harness lives in `crates/dispatcher-rs/tests/webhook_receivers.rs`
+ companion Bun/Python scripts. CI runs the harness on every push that
touches `dispatcher-rs/src/webhook.rs`.

**Why three languages:** insurance / prediction-market / lending
protocols on Solana are not language-homogeneous. A Python reference is
mandatory for ML-leaning teams (Maple Finance institutional flow). The
TypeScript Worker is for serverless ops teams. Rust for protocol teams
who already have a tokio runtime.

### 8. Pricing tiers (Public / Agent / Protocol / Sponsor)

| Tier | Channels | Pricing | Auth |
|---|---|---|---|
| **Public** | REST · WS · Telegram · /dashboard · /asset/* · /embed | Free, rate-limited 60 req/min/IP | None (or Telegram login for Telegram channel) |
| **Agent (MCP)** | MCP server + WS | Free up to 1000 calls/day per `payTo`; then $0.001/paid-tool-call via x402 | x402 `payTo` (no API keys) |
| **Protocol** | Webhook signed + B2B SLA | Contract negotiated (~$500–2000/mo); volume discount on x402 too | Account-bound, manual approval |
| **Sponsor** | Footer credit + custom alerts | Outbound only, $5k+/mo | Direct invoice |

**Launch state:** Public + Agent active at v2 launch. Protocol tier
"Contact us" with no public price. Sponsor tier dormant.

**No price changes to existing public channels.** REST / WS / Telegram
remain free forever for retail.

### 9. Asset universe (v2 launch)

**No new assets in v2.** Ship with the current curated universe of **23
active assets** in `assets.toml` (after the dSOL deactivation in
`0020`):

- **LSTs SOL-pegged (6):** `jitoSOL`, `mSOL`, `bSOL`, `INF`, `bbSOL`,
  `JupSOL`
- **LSTs Hylo (2):** `hyloSOL`, `hyloSOL+`
- **Yield-bearing stables (7):** `USDY`, `sUSD`, `syrupUSDC`, `sUSDe`,
  `ONyc`, `sHYUSD`, `hyUSD` (where `hyUSD` is also the CDP target)
- **Fiat stables (5):** `USDC`, `USDT`, `PYUSD`, `USDe`, `USDS`
- **FX stable (1):** `BRZ` (deactivated in DB via migration 0012; kept
  in TOML for completeness; show as `is_active=false` on `/asset/BRZ`
  with an inline note. Public copy treats coverage as 23 — see footnote)
- **Synthetic / leveraged (1):** `xSOL`
- **Pending adapter (1):** `pbUSDC` (Piggybank vault, `verified=false`)

Total `assets.toml` entries: 24. Deprecated: `dSOL` (Drift exploit).
Active in `is_active=true` count in DB: ~22 after migrations
0011/0012/0020. Hero copy uses **23** to match the existing `/oracle`
copy and what users actually see in the UI.

**Reasoning:** stable > breadth. Calibration (decision #12) needs known
distributions. Adding assets adds noise.

**Footnote on BRZ:** BRZ is structurally interesting (only Brazilian
fiat stable tracked) but Jupiter market liquidity is too thin for
reliable quotes. Migration 0012 deactivated it. Decision to keep the
TOML block + show on UI as informational is intentional — it's the
"Brazilian story" surface for PT-BR audience. Marketing copy treats
active coverage as 23.

**Roadmap candidates (v2.1+):** `USD+` (Streamflow when mainnet), `USD*`
(Perena when IDL public), `pbUSDC` (finish adapter), tokenized RWAs
beyond USDY (BUIDL, OUSG).

### 10. dSOL deactivation (already done — documented here)

Drift was exploited 2026-04-01 ($285M, DPRK-linked, frozen). dSOL is
soft-deactivated:

- `assets.toml`: `active = false` + header comment
- `migrations/0020_deactivate_dsol_drift_exploit.sql`: `UPDATE assets
  SET is_active = false WHERE symbol = 'dSOL';`
- Frontend mocks, alert thresholds, README, concepts copy updated
- Incident report: `docs/incident-2026-04-01-drift.md`

Committed in `477db4d`. Re-mentioned here because the spec lives or dies
on the credibility of the existing feed; future reviewers should be able
to read one document and understand the full state.

**Follow-up the spec mandates** (new work): add a monthly protocol-health
sweep cron that cross-references each tracked asset against the
solana-knowledge `DEFUNCT` catalog and DefiLlama TVL trends. Spec for the
sweep itself is out-of-scope here; this spec just commits to it being
added before v2 launch.

### 11. Copy, brand, and identity touchpoints

All anchored to the locked brand kit (Threshold Brackets + sunset coral
`#ff8a5b` / magenta `#e878d8`, Geist + JetBrains Mono). No new visual
language. Only copy + page hierarchy.

| Surface | Edit |
|---|---|
| Hero `/` | New copy (decision #1) |
| Subhero / hero subtitle | "Multi-asset · mechanism-aware · dual-source reconciled · sub-second WS" |
| README.md opening | "Public peg-risk oracle for Solana" (replace "Solana peg watchdog") |
| `metadata.description` in `web/app/layout.tsx` | Mirror new hero copy for SEO |
| Twitter bio | "Peg-risk oracle for Solana · API · MCP · Webhook" |
| Footer tagline | "Built to be consumed. Read by agents and protocols. MIT." |
| Pinned tweet | New thread (3-4 tweets) explaining specialization + 5 channels |
| OG image | Existing `public/og.png` content is fine; verify text says "Pegana" not "Pegana peg watchdog" before launch |

### 12. Rollout — 3 phases, ~90 days

**Phase 0 — Pre-flight (week 1, runs in parallel with Phase 1):**

0a. **Design-taste pass on the 5 channel cards.** Use `/design-taste`
    skill to lock the visual treatment for the new home cards (REST · WS
    · MCP · Webhook · Telegram) and the developers' sticky TOC before
    any production code touches them. Goal: avoid mid-Phase-1 redesigns.
0b. **README sync.** Update LST list in `README.md` to match
    `assets.toml` (current TOML has 9 LSTs after migration 0011
    deactivations; README still references the stale 11). Same sync for
    `concepts.ts` LST list if drift exists.

**Phase 1 — Foundation (weeks 1-2, ends ~2026-06-09):**

1. Copy rewrites (decisions #1, #2, #3, #4, #11). Pure frontend, no
   backend touch. Includes the sticky TOC and `get-started-card`
   components (decision #4).
2. v1.1.1 + Hetzner deploy (already specced in
   `2026-05-25-production-deploy.md`). Independent track, blocks public
   launch but not Phase 2 work. **Also fixes** the `/oracle` 404
   currently in production (memory `project_vercel_root_404`).
3. 14-day dogfood with `FEATURE_PUBLIC_ALERTS=false` and
   `DOGFOOD_TELEGRAM_CHAT_ID=6647651772`. Produce
   `docs/CALIBRATION-v1.md` artifact at end of period.
3b. **Accessibility sweep** during the dogfood window: run axe-core on
    `/`, `/oracle`, `/methodology`, `/dashboard`, `/developers`,
    `/account/webhooks`. Fix any WCAG AA blocking issue (color contrast
    on sunset coral text especially) before Phase 3 launch.

**Phase 2 — Channels (weeks 3-6, ends ~2026-07-07):**

4. **Verification spike (1 day).** Stand up a "hello pegana" MCP server
   with one free tool (`ping`) and one paid tool ($0.001) using the
   exact pinned stack. Validate end-to-end on Solana **devnet**: agent
   pays via x402 facilitator, response delivered, settlement confirmed
   on-chain. **Measure** against the performance budget table in
   decision #5 (MCP cold/warm, x402 settlement). Goal: catch any API
   drift AND prove latency targets before building the 6 real tools.
5. `mcp-ts/` package created. Free tools shipped first
   (`getAssets`, `getAssetState`, `getMethodology`, `ping`). Internal
   stress test against prod-local Redis. Confirm warm-hit p99 < 50ms
   (free tools) and < 200ms (paid tools needing Postgres history).
6. x402 wrapper added; paid tools (`getAssetHistory`,
   `subscribePegEvents`) enabled on devnet, then mainnet after a clean
   24h devnet soak.
7. List MCP server on smithery.ai and mcp.run directories.
8. Webhook channel implemented in dispatcher-rs. `/account/webhooks`
   page shipped. **Reference-receiver test matrix (3 languages) from
   decision #7 passes.** 2-3 manual test subscribers.

**Phase 3 — Distribution (weeks 7-12, ends ~2026-08-18):**

9. Public launch announcement (Twitter PT+EN thread, HN Show, Superteam
   Brasil, Awesome Solana).
10. Outreach to 5 protocols: StableGuard insurance, Parity, Kamino,
    MarginFi, Reflect. Pitch Pegana as upstream peg-risk source.
11. If a Colosseum hackathon opens in Q4 2026: submit on Stablecoins or
    Infrastructure track. Working demo + calibration artifact + 2-3
    partner integrations.

---

## Architecture changes

**Unchanged:** indexer-rs (6 sources), engine-rs (EWMA + hysteresis),
api-rs (REST + WS), dispatcher-rs (alert fan-out core), bot-ts (Telegram
delivery), Postgres TimescaleDB, Redis pub/sub. v2 adds two channels by
**reading from the same Redis channels** the engine already publishes.

```
                                         ┌─────────────┐
                                         │  api-rs     │ REST + WS (existing)
                                         └─────────────┘
                                              ▲
                  ┌───────────────┐           │
                  │  engine-rs    │──Redis────┼─────────────┐
                  │  state machine│  pegana:* │             │
                  └───────────────┘           ▼             │
                          ▲                   ┌────────────────┐
                          │                   │ dispatcher-rs  │──Telegram (bot-ts)
                  ┌───────────────┐           │ fan-out        │
                  │  indexer-rs   │           │                │──Webhook signed (NEW)
                  │  6 sources    │           └────────────────┘
                  └───────────────┘                 ▲
                                                    │
                                          ┌────────────────┐
                                          │ mcp-ts    │ MCP + x402 (NEW)
                                          │ (Bun, Hono)    │
                                          └────────────────┘
                                              ▲
                                         AI agents
```

**New components:**

- `mcp-ts/` — TypeScript MCP server (decision #5, #6)
- `crates/dispatcher-rs/src/webhook.rs` — webhook signing + dispatch
  (decision #7)
- `web/app/(app)/account/webhooks/page.tsx` — subscriber management UI
- `migrations/0021_webhook_subscriptions.sql` — new tables (see below)

**Reused:** Redis pub/sub channels (`pegana:discount`, `pegana:alerts`),
Postgres tables (`assets`, `discount_snapshots`, `alert_events`),
`pegana-common` types (will be mirrored in TS as
`mcp-ts/src/shared/types.ts` — hand-written, ~50 lines).

---

## Data model changes

Two new tables in migration `0021_webhook_subscriptions.sql`:

```sql
CREATE TABLE webhook_subscriptions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         BIGINT       NOT NULL REFERENCES users(id),
    url             TEXT         NOT NULL,
    asset           TEXT         NOT NULL REFERENCES assets(symbol),
    threshold_bps   INTEGER      NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_fired_at   TIMESTAMPTZ,
    last_status     SMALLINT,    -- last HTTP status code
    UNIQUE (user_id, url, asset)
);

CREATE INDEX webhook_subs_active_asset_idx
  ON webhook_subscriptions(asset, is_active) WHERE is_active;

CREATE TABLE webhook_dead_letter (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID         NOT NULL REFERENCES webhook_subscriptions(id),
    alert_id        UUID         NOT NULL,
    payload         JSONB        NOT NULL,
    last_error      TEXT         NOT NULL,
    attempts        SMALLINT     NOT NULL,
    failed_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX webhook_dl_failed_at_idx ON webhook_dead_letter(failed_at);
```

No changes to existing tables. No changes to Redis channels.

---

## Telemetry & observability

**New metrics:**

- `pegana_mcp_tool_calls_total{tool, status}` — calls per tool
- `pegana_mcp_tool_latency_seconds{tool}` — histogram
- `pegana_mcp_payments_total{status, network}` — x402 settlements
- `pegana_webhook_dispatches_total{status}` — webhook deliveries
- `pegana_webhook_dispatch_latency_seconds` — histogram
- `pegana_webhook_dead_letter_total` — counter

**New Sentry alerts:**

- Webhook dispatch failure rate > 5% over 5 min
- Any `webhook_dead_letter` insert (single failed delivery → alert)
- x402 facilitator returns 5xx → alert (settlement infra down)
- MCP tool error rate > 1% over 15 min

**Grafana panels (added to existing oracle dashboard):**

- MCP tool calls / sec, free vs paid breakdown
- x402 cumulative USDC settled
- Webhook health (active subs, dispatches/min, dead-letter trend)

---

## Non-goals (explicit; what v2 does NOT do)

- ❌ Wallet tracking, portfolio view, NFT alerts. Pegana stays vertical.
- ❌ Trade signal oracle. That's the agent layer; Pegana is the data
  layer below.
- ❌ Multi-chain. Solana is the moat.
- ❌ On-chain feed publisher (Switchboard / Pyth / **Doppler**).
  Deferred to v2.5+. The webhook channel covers 80% of B2B value at 20%
  of effort. See "Ecosystem adjacencies" below for Doppler evaluation.
- ❌ Premium tier for retail Telegram. Free forever. Pricing is for
  agents and protocols.
- ❌ Discord adapter (specced separately, triggered post-launch).
- ❌ Telegram Mini App (specced separately, triggered by mobile traffic
  data).
- ❌ Wallet-based authentication. Telegram login is the v2 identity.
- ❌ Custom x402 facilitator. Use `x402.org/facilitator` until volume
  justifies running our own.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | x402 v2 spec breaks during MCP rollout | Low | Medium | Pin SDK versions in `mcp-ts/package.json`; track `@coinbase/x402` releases manually |
| R2 | x402 facilitator outage blocks paid tool calls | Medium | High | Free tools degrade gracefully; cache last successful payment requirements for 60s; document fallback to manual invoicing if extended outage |
| R3 | Webhook receiver implements Ed25519 wrong, fails verification | High | Low (per receiver) | Ship verified reference code in 3 languages; provide a `/developers/webhook-test` page that signs sample payloads against the receiver's public endpoint |
| R4 | MCP free quota abuse (single agent burns through thousands of free calls) | Medium | Low | Daily counter per `payTo`; aggressive rate limit on `getAssetHistory` (highest-cardinality tool) for unauth requests |
| R5 | Reframe alienates current Telegram users who think Pegana "removed" things | Low | Medium | Communicate clearly in launch thread: Telegram is unchanged. Add a 1-line banner on `/dashboard` for the first 2 weeks pointing to the rename ("Now: Live state of the oracle") |
| R6 | Methodology page exposes too much detail and gets reverse-engineered | Low | Low | Already open-source (MIT). Detail is the moat: nobody else has implemented this stack on Solana; copying it takes 6+ months. Welcome the scrutiny. |
| R7 | Next Colosseum hackathon opens too late or too early for Phase 3 | High | Low | Phase 3 launch is independent of hackathon; submit when one opens, don't gate the launch on it |
| R8 | dSOL-style protocol failure hits another tracked asset before monthly sweep cron lands | Medium | Medium | Add Sentry alert: any tracked asset whose intrinsic source returns errors for > 4 consecutive cadences → manual review |
| R9 | x402 facilitator round-trip dominates agent latency, making the paid path feel slow | Medium | Medium | Phase 2 #4 measures it; if p95 > 1.5s, document the trade-off prominently; consider running a Pegana-owned facilitator in v2.1 (see Ecosystem adjacencies) |
| R10 | Accessibility issues surface after launch and require rework | Low | Medium | Phase 1 #3b runs axe-core; existing brand kit uses high-contrast sunset palette, but coral on canvas needs WCAG AA verification |
| R11 | 3-language webhook receiver matrix slips, blocking Phase 2 #8 | Medium | Low | Receivers are reference-only (not in critical path of dispatcher-rs); ship Phase 2 #8 with TypeScript-only receiver if Rust + Python lag, treat them as Phase 3 follow-up |

---

## Ecosystem adjacencies — evaluate post-v2

These are Solana-native tools surfaced during the solana.new sweep that
**were not in the original spec** but are worth naming explicitly. None
block v2; each has a clear trigger to revisit.

| Tool | What it does | Why it matters for Pegana | When to revisit |
|---|---|---|---|
| **Doppler** (Blueshift) — Ultra-Optimized Oracle | On-chain Solana oracle program achieving 21 CU per update. Generic payloads, sequence-based replay protection. Rust crate `doppler-sdk`. | Natural path to publish Pegana peg state **on-chain** for protocol composability — lending protocols could read peg state in their liquidation logic atomically. Chaos Labs already does on-chain via Edge; Doppler is the cheapest way for Pegana to match without operating Switchboard or Pyth feeds. | v2.5+ once we have ≥1 lending protocol asking for on-chain composability |
| **MPP SDK** (Solana Foundation) — Machine Payments Protocol | HTTP 402 Payment Required flow with native SOL + SPL transfers, fee sponsorship, split payments. Maintained by Solana Foundation. | Alternative to Coinbase's `@x402/svm` — Solana-Foundation-native rather than EVM-rooted. Solana Foundation is a founding member of x402 (Linux Foundation), so MPP SDK and x402 are likely to converge, but they have different abstractions today. | v2.1 if x402 facilitator latency or reliability becomes a hot path issue; evaluate as a drop-in replacement for `@x402/svm` |
| **Solana Agent Kit** (SendAI) | Toolkit that gives AI agents on-chain Solana primitives (swap, transfer, deploy). Trusted by major Solana agent projects. | Adding Pegana as a registered tool in Solana Agent Kit means every agent built with SAK discovers Pegana automatically. Massive distribution multiplier with low integration cost. | v2.1 (mid-Phase 3 or shortly after public launch) |
| **Kora** (Solana Foundation) — Gasless transactions | JSON-RPC API + TypeScript SDK for fee-paying with any SPL token (not just SOL). Production-ready signing infra. | If Pegana ever charges retail (which it explicitly won't in v2), Kora would let users pay in USDC instead of SOL. Not relevant to v2 but worth knowing exists. | v3+, only if retail monetization is considered (not currently planned) |
| **Switchboard** (oracle service) | Established oracle protocol on Solana. Custom data feeds and randomness. | Alternative to Doppler for the on-chain publisher path. More established, more expensive per update (~1000s of CU vs Doppler's 21). | v2.5+ as alternative to Doppler if Doppler proves unstable in production |

**How to apply:** Anything in this table is a v2.1+ consideration. The
v2 ship target stays at the 12 numbered decisions above. Revisit this
table at the end of Phase 3 launch as the v2.1 planning input.

---

## Open questions

1. **MCP tool naming convention** — `getAssetState` vs `get_asset_state`
   vs `state` (bare). MCP convention seems to be camelCase but the
   project conventions in api-rs are snake_case. Lean toward `camelCase`
   for MCP to match SDK examples; document the divergence.
2. **x402 free quota tracking** — Redis counter (simple, fast) vs MCP
   stateful session (more correct, more code). Lean Redis for v2;
   revisit if abused.
3. **`PEGANA_PAYTO_USDC` address provenance** — Rafael needs to set up a
   hardware-wallet-controlled Solana address to receive USDC. Squads
   multisig is overkill for v2 volumes; a Ledger-derived address with
   the seed in cold storage is fine. **To resolve before Phase 2.**
4. **Smithery/mcp.run listing requirements** — both expect a published
   server. Need to register an org, get a slug, and follow each
   directory's submission template. **To resolve early Phase 2.**

These are not blockers for writing the implementation plan; they're
things to settle in the first week of each respective phase.

---

## Acceptance criteria for "v2 launched"

Pegana v2 is considered launched when **all** of the following hold:

- Hero copy on `pegana.xyz/` reads "The specialized peg-risk oracle for
  Solana."
- 5-channel cards are rendered on `/` and link to the live anchor in
  `/developers` (`#rest`, `#websocket`, `#mcp`, `#webhook`, `#telegram`).
- `/oracle` (marketing) keeps the pitch and adds explicit "See the
  math →" link to `/methodology`.
- `/methodology` (app) renders updated per-class semantics (NAV /
  stake-pool / CDP / FX) and links back to `/oracle` + `/concepts`.
- `/dashboard` URL still resolves; page subtitle reads "Live state of
  the oracle."
- `marketing-header.tsx` `Developers ▾` dropdown lists all 5 channels in
  order: REST API · WebSocket · MCP · Webhook · Telegram bot · Examples
  · Embed widget. `Learn ▾` already contains Concepts / Case studies /
  Methodology — verify they still resolve.
- `mcp.pegana.xyz` is online; `getAssets`, `getAssetState`,
  `getMethodology`, `ping` are free and working; `getAssetHistory` and
  `subscribePegEvents` are paid via x402 USDC on Solana mainnet and
  working (verified by Rafael spending real USDC on a paid call).
- Webhook channel: at least 1 active subscription (Rafael's own
  Cloudflare Worker dogfood) firing successfully for at least 7
  consecutive days with > 99.5% success rate.
- `docs/CALIBRATION-v1.md` is committed with 14-day dogfood results.
- Public launch announcement is published on Twitter PT + EN and pinned
  on the project account.
- `README.md` opening line matches the new positioning and asset list
  is synced with `assets.toml` (no stale references to deactivated LSTs).

**Performance & operational:**

- Verification spike (Phase 2 #4) passed all targets in the performance
  budget table (decision #5) — MCP cold/warm, x402 settlement, webhook
  dispatch.
- Webhook reference-receiver test matrix passes for at least
  **TypeScript** + one of (Rust, Python). Both Rust and Python receivers
  ship as code samples by end of Phase 3.
- Performance dashboard panel in Grafana shows live `pegana_mcp_*` and
  `pegana_webhook_*` metrics.

**Accessibility (WCAG 2.1 AA target):**

- Color contrast verified for sunset-coral text (`#ff8a5b`) and magenta
  (`#e878d8`) against canvas (`#000`) on `/`, `/oracle`, `/methodology`,
  `/dashboard`, and `/developers`. axe-core run shows zero AA-blocking
  issues.
- Keyboard navigation works end-to-end on `/dashboard`
  (`DashboardFilters` + `AssetTable` + `AlertsSidebar`) without trapping
  focus.
- Mobile touch targets ≥ 44×44 px on the home channel cards, the
  developers sticky TOC, and all `/account/*` buttons.
- Screen-reader labels present on `ActiveStrip`, `BrandMark`, every
  icon-only button.
- `/methodology` math notation has text equivalents (no images of LaTeX
  without `alt`).
- i18n PT-BR + EN strings reviewed for any new copy added in this spec.

---

## Out of scope for this spec (handled elsewhere)

- v1.1.1 account UX polish — `2026-05-25-account-ux.md`
- Production deploy on Hetzner — `2026-05-25-production-deploy.md`
- Discord adapter — `2026-05-25-discord-adapter.md` (deferred)
- Telegram Mini App — `2026-05-25-telegram-miniapp.md` (deferred)
- Original webhook channel spec — `2026-05-25-webhook-channel.md`
  (folded into this spec, decision #7)

Phase 1 of this spec depends on the production deploy spec finishing; if
that one slips, this spec slips with it.
