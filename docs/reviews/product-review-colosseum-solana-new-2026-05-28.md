# Pegana product review with Colosseum Copilot + solana.new lens

**Date:** 2026-05-28  
**Product:** Pegana — Solana peg-risk oracle/data layer for pegged assets.  
**Stage:** soft launch / beta with live API, WS, MCP/x402, Telegram, and webhook dogfood.  
**Goal of this review:** decide what is good for Pegana's future before building more.

## Tooling status

- `product-review` framework: used.
- Colosseum Copilot API: used successfully with authenticated local token.
- `solana.new`: researched as ecosystem lens. It is a Solana/Superteam/SendAI builder stack with built-in skills, MCPs, CLIs, idea/build/launch/raise workflows, and strong emphasis on tasteful/useful crypto apps, AI agents, x402, stablecoins, and launch/raise readiness.
- Limitation: no separate callable `solana.new` MCP tool is installed in this session, so `solana.new` was used through public research and the local Solana skills environment rather than an MCP API call.

## Executive verdict

Pegana should continue as a **Solana peg-risk oracle**, not as a generic dashboard, generic alert bot, or execution agent.

The strongest future path is:

> Pegana models whether a Solana pegged asset is still behaving according to its mechanism, then delivers that state to agents and protocols through REST, WebSocket, MCP/x402, and signed webhooks.

Colosseum Copilot confirms the market is crowded around generic monitoring, DeFi dashboards, AI agents, and stablecoin payments. Pegana's defensible lane is the intersection that is still narrow: **mechanism-aware peg state for Solana-specific assets**.

## Product scorecard

| Dimension | Score | Reason |
|---|---:|---|
| Onboarding flow | 6.5/10 | Product is understandable as "peg-risk oracle", but broken docs and missing web pricing weaken first trust. |
| Core experience | 8/10 | Live API returns 22 tracked assets, 35 alerts/24h, 0 delivery failures/24h; MCP/x402 proof exists. |
| Error handling | 7/10 | Backend quality is strong, but a dead docs domain is a visible product error. |
| Information architecture | 6/10 | Marketing, docs-site, pricing docs, account pages, and live app disagree on what is available. |
| Visual polish | 8/10 | Current dashboard/marketing work is visually strong; product proof is still under-surfaced. |
| Performance | 6.5/10 | Public API is responsive; sub-second product claims are not yet honest across source architecture. |
| Accessibility | 7.5/10 | Prior audits are strong; current branch was not re-audited here. |
| Feature completeness | 7/10 | Strong read surfaces, weak business auth/pricing, incomplete launch proof. |
| Overall | 7.1/10 | Technically credible, commercially under-packaged. |

## Colosseum Copilot findings

### Similar projects

Copilot search query:

> Solana peg risk oracle stablecoin depeg LST monitoring Pyth Jupiter MCP x402 webhook API

Most relevant returned projects:

| Project | Why it matters | Pegana implication |
|---|---|---|
| Solana Watch | Real-time event monitoring and webhook alerts for Solana programs. Cluster: Solana Data and Monitoring Infrastructure. | Generic monitoring is crowded. Pegana must not present as "alerts for Solana". |
| StableGuard | Decentralized insurance for stablecoin depegging; target users include DeFi traders, stablecoin holders, LPs, institutional investors. | Closest depeg-risk neighbor. Pegana should be upstream risk data/oracle, not insurance marketplace. |
| Parity | Prediction market for pegged-asset stability using Pyth settlement. | Pegana could become the oracle/data source such products need. |
| Orb Oracles | Decentralized oracle platform with low-latency price updates. | Do not compete as a generic price oracle. Pegana is a state oracle. |
| x402 Agnic Hub | API monetization using stablecoins and x402. | Pegana's MCP/x402 path is ecosystem-aligned but needs packaging. |

### Cluster pressure

| Cluster | Project count | Winner count | Read |
|---|---:|---:|---|
| Solana AI Agent Infrastructure (`v1-c14`) | 325 | 14 | Crowded, but x402/MCP is a real ecosystem direction. Pegana needs a precise agent use case, not "AI wrapper". |
| Solana Data and Monitoring Infrastructure (`v1-c5`) | 257 | 31 | Strong crowding around monitoring/indexing/API/RPC. Pegana loses if framed generically here. |
| Solana Yield and DeFi Optimization (`v1-c8`) | 257 | 29 | Relevant because LST/yield-bearing assets sit here. Pegana should sell to these protocols as risk infrastructure. |
| Stablecoin Payment Rails and Infrastructure (`v1-c16`) | 202 | 20 | Validates x402/stablecoin payments, but Pegana should not become a payment rail product. |

### Winner-patterns from Copilot compare

Copilot compared 293 winners vs 5,428 projects.

Signals:

- `oracle` primitives are overrepresented among winners: 13.3% winners vs 10.5% all projects.
- `stablecoin payments` are overrepresented among winners: 1.7% winners vs 0.8% all projects.
- generic NFTs/token-gating are underrepresented among winners.
- "information overload" appears more common in the general pool than winners.

Interpretation for Pegana:

- The "oracle" framing is not cosmetic; it maps to a primitive judges and builders respect.
- Stablecoin/x402 monetization is aligned with winner patterns, but only if attached to a useful service.
- Do not frame Pegana as another dashboard that solves "information overload." Frame it as a machine-consumable risk primitive.

## solana.new lens

solana.new's public positioning emphasizes:

- useful and tasteful crypto apps;
- AI-assisted build/launch/raise workflows;
- built-in Solana integrations like Jupiter, Helius, Phantom, Privy, SendAI, DFlow, Sanctum, Kamino, Meteora, Orca;
- ideas around agent wallets, x402, stablecoins, market-making vaults, structured products, and RWA;
- launch and raise readiness, not just code.

What this means for Pegana:

- Pegana already fits the "useful crypto app" bar better than a toy because it has live data and operational surfaces.
- It is not yet "raise-ready" because docs/pricing/trust proof are inconsistent.
- It should lean into Solana-native integrations: Pyth, Jupiter, Sanctum, Hylo, MCP/x402, webhooks.
- It should avoid broad product sprawl. solana.new pushes builders toward clear wedges; Pegana's wedge is peg-state correctness.

## Core positioning

Use this:

> Price oracles tell you what an asset traded at. Pegana tells you whether the peg mechanism is still intact.

More precise:

> Pegana compares mechanism-derived intrinsic value against executable market value for Solana pegged assets, then publishes sticky risk states for agents, protocols, and humans.

Avoid:

- "Telegram peg bot"
- "Solana dashboard"
- "DEX price alert tool"
- "Pyth competitor"
- "Chaos Labs competitor"

## What to build next

### P0: immediate

1. **Fix docs**
   - `docs.pegana.xyz` currently does not resolve.
   - API root and marketing still point there.
   - This is the fastest trust win.

2. **Create visible web pricing**
   - Current docs say "Pegana does not have tiers."
   - That conflicts with the product's commercial future.
   - Recommended tiers:
     - Free: delayed public reads.
     - Pro: current freshness + x402/API access + one webhook.
     - Realtime: design partner, target sub-10s, dedicated stream.
     - Enterprise: custom SLA only after measured latency.

3. **Surface trust numbers on home**
   - 22 assets tracked.
   - Alerts in last 24h.
   - Delivery failures in last 24h.
   - x402 mainnet proof.
   - Webhook dogfood status.

4. **Patch methodology narrative**
   - Explain why Pegana uses both oracle/mechanism sources and Jupiter execution quotes.
   - This directly answers the partner's "tem que ser oraculo" concern.

### P1: 1-3 days

5. **Add `/pricing` in the web app**
   - Not only docs-site.
   - Buyers need to find it from the landing page.

6. **Add SIWS or wallet-based account identity**
   - Telegram-only auth is bad for B2B.
   - Telegram should remain an alert channel.

7. **Add an agent integration page**
   - Show MCP endpoint.
   - Show x402 paid call.
   - Show "agent refuses to allocate into DRIFT/DEPEG asset."

8. **Create integration packet**
   - REST, WS, MCP, webhook.
   - Failure semantics.
   - Confidence handling.
   - What Pegana must not be used for.

### P2: after dogfood

9. **Publish calibration**
   - Finish `docs/CALIBRATION-v1.md`.
   - Include p50/p95/p99 by asset.
   - Include noisy/false-positive classifications.

10. **Publish webhook dogfood**
    - Delivery count.
    - Success rate.
    - p99 dispatch latency.
    - Dead-letter count.

11. **Build event evidence pages**
    - `/events/{id}`.
    - Show intrinsic source, market quote, state transition, confidence, timestamps, raw JSON.

### P3: only after demand proof

12. **Realtime architecture**
    - Paid Jupiter or own execution-quote infra.
    - Helius/Triton account subscriptions.
    - Dedicated authenticated WS.
    - Replay buffer.
    - Latency SLO.

Do not build this before pricing/docs/trust proof. It is expensive and only justified if Pro/Realtime demand appears.

## Hard no-list

Do not:

- promise `<1s` publicly now;
- replace Jupiter execution quote with Pyth-only pricing;
- broaden into wallet/NFT/portfolio alerts;
- make autonomous swapping/execution the core product;
- keep polishing UI while docs/pricing are broken;
- launch loudly before calibration and webhook dogfood are summarized.

## Final recommendation

Pegana's future is strongest if it becomes a **boring, trusted, machine-readable risk primitive**.

The next sprint should not be "more visual lift." It should be:

1. docs fixed;
2. pricing visible;
3. trust proof surfaced;
4. methodology clarified;
5. agent/protocol integration path made obvious.

After that, test demand for Realtime. Build sub-second only when the market asks with money or signed design-partner intent.

## Sources

- Colosseum Copilot API:
  - project search for peg-risk oracle / depeg / MCP / x402;
  - projects: `stableguard`, `parity`, `solana-watch`, `x402-agnic-hub`;
  - clusters: `v1-c14`, `v1-c5`, `v1-c8`, `v1-c16`;
  - winner compare: winners vs all projects, dimensions `problemTags`, `solutionTags`, `primitives`.
- solana.new public site: https://www.solana.new/
- Solana x402: https://solana.com/x402
- Pegana live API: https://api.pegana.xyz/v1/stats
- Local repo:
  - `.superstack/idea-context.md`
  - `.superstack/build-context.md`
  - `docs/CALIBRATION-v1.md`
  - `docs/CALIBRATION-v2-mcp-spike.md`
  - `docs-site/pricing.mdx`
  - `web/app/(marketing)/page.tsx`
  - `crates/api-rs/src/routes/health.rs`
