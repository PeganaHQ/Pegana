# Pegana product strategy review

**Date:** 2026-05-28  
**Scope:** product direction, monetization, oracle narrative, latency tiers, launch gates, and competitive risk.  
**Reviewer posture:** product review + strategic stress test, not implementation.

## Tooling note

- Product review framework used from `product-review`.
- Colosseum Copilot API could not be used because `COLOSSEUM_COPILOT_PAT` is not configured. Public Colosseum pages were used instead.
- `context7` was requested, but no Context7 tool is available in this session.
- `solana.new` was interpreted as current Solana ecosystem/source research; official Solana x402 pages were used.

## Executive verdict

Pegana should continue, but not as a broad dashboard or Telegram-first alert product. The future-proof direction is narrower and stronger:

> Pegana is the Solana peg-risk oracle that agents, protocols, and risk desks read before allocating capital to pegged assets.

The partner feedback is directionally useful but should not be implemented literally. "Make it an oracle" is a perception/narrative problem more than an infrastructure problem: Pegana already reads Pyth and mechanism-specific sources. "Free delayed / paid faster" is the right monetization shape, but sub-second should be an enterprise roadmap claim only after source latency is rebuilt around paid Jupiter or self-hosted market data plus push-based account streams.

## Verified facts

### Live product state

- `https://api.pegana.xyz/` is live and returns HTTP 200.
- API root still advertises `"docs": "https://docs.pegana.xyz"`.
- `docs.pegana.xyz` does not resolve from this environment.
- `https://api.pegana.xyz/v1/stats` returns:
  - `assets_tracked: 22`
  - `alerts_24h: 35`
  - `delivery_health.sent_24h: 24`
  - `delivery_health.failed_24h: 0`
- `https://api.pegana.xyz/v1/assets/USDC` returned a fresh `updated_at` timestamp and a valid PEGGED state during the review.

### Repository state

- Branch: `feat/dashboard-rebuild`.
- Recent commits are mostly dashboard/MCP/frontend lift, not pricing, docs DNS, SIWS, or latency-tier plumbing.
- `docs-site/` already contains real documentation, including `pricing.mdx`, guides, methodology pages, OpenAPI YAML, and x402 docs.
- `crates/api-rs/src/routes/health.rs` still points root discovery at `https://docs.pegana.xyz`.
- `web/components/organisms/channels-section.tsx` links directly to `https://docs.pegana.xyz`.
- `web/app/(marketing)` has no `/pricing` route.
- Account pages exist: `/account`, `/account/subscriptions`, `/account/webhooks`, `/account/alerts`.
- Web login is Telegram-only through `web/components/atoms/telegram-login.tsx`.
- `assets.toml` still retains `dSOL` and `BRZ` entries, but both are documented as inactive/deactivated cases. Public copy must say 22 active assets, not 23/24.

### x402 state

- `docs/CALIBRATION-v2-mcp-spike.md` records:
  - devnet x402 paid path complete;
  - 71/71 paid devnet soak calls successful;
  - first mainnet x402 paid call settled on 2026-05-27;
  - mainnet transaction signature recorded;
  - remaining issue is not "can x402 work", but mainnet latency distribution, custody hardening, and packaging.

### Calibration state

- `docs/CALIBRATION-v1.md` is still running and explicitly says broad public launch should wait until the 14-day dogfood window ends on 2026-06-10.
- Webhook dogfood started 2026-05-27 and has synthetic delivery proof, but not a completed 7-day aggregate yet.

## Market and ecosystem signals

### x402 / agent economy

Official Solana x402 pages frame x402 as a way for APIs and content to be monetized without accounts/subscriptions, explicitly for agentic payments. They cite Solana as a low-latency, low-cost settlement layer and list MCP-with-x402 as an ecosystem pattern.

Implication: Pegana's MCP + x402 path is not a side quest. It is the most future-aligned distribution surface in the repo.

### Oracle landscape

- Pyth positions itself as real-time market data sourced from institutional publishers and delivered via Hermes REST/SSE.
- Hermes public API enforces rate limits; Pyth also notes production users should use node providers for resilience.
- Jupiter's current docs distinguish keyless/free/pro rate limits; current public docs indicate keyless/free limits are materially lower than paid tiers.
- Chainlink's Data product explicitly uses heartbeat/deviation-triggered feeds for push-based data feeds.

Implication: the partner's "just be an oracle" framing needs refinement. Pegana should not replace Jupiter execution quotes with smoothed oracle prices. Pegana's product is the discrepancy between mechanism/intrinsic truth and executable market truth.

### Colosseum / competitor signal

Public Colosseum StableGuard page is directly relevant. StableGuard's hackathon description says it observes Pyth oracle prices plus Jupiter liquidity, scores risk, detects regimes, and can execute protective swaps. It uses a freemium model with Pro and Protocol tiers.

Implication: Pegana's Pyth + Jupiter design is not embarrassing; it is exactly how another Solana-native stablecoin-risk project describes itself. Pegana's differentiation should be:

- broader mechanism semantics beyond fiat stables;
- LST/NAV/CDP coverage;
- read-only oracle/data layer rather than custody/action agent;
- signed webhook/MCP/API surfaces for protocols and agents.

## Product review scorecard

| Dimension | Score | Evidence |
|---|---:|---|
| Onboarding flow | 6.5/10 | Hero explains "peg-risk oracle", dashboard is reachable, but no pricing route and docs link can be dead. |
| Core experience | 8/10 | API, stats, asset state, MCP, webhook code, account pages, and live data exist. |
| Error handling | 7/10 | Backend hardening is strong; public docs/DNS failure is the visible weak point. |
| Information architecture | 6.5/10 | Marketing, dashboard, docs-site, account, MCP, webhook exist, but monetization and docs are split/invisible. |
| Visual design/polish | 8/10 | Current lift is strong visually, but product proof/trust numbers are underused. |
| Performance | 6.5/10 | User-facing API is responsive; source freshness is around current polling limits, not true real-time. |
| Accessibility | 7.5/10 | Prior audits report strong a11y baseline; current branch not re-audited in this pass. |
| Feature completeness | 7/10 | Strong read surfaces; weak auth breadth, pricing, launch proof, and self-serve B2B conversion. |
| Overall | 7.1/10 | Strong technical product with packaging and go-to-market gaps. |

## Strategic decision

### Keep

Keep Pegana as a specialized oracle/data product.

Do not broaden into:

- wallet portfolio monitoring;
- NFT alerts;
- generic Telegram notifications;
- generic DEX analytics;
- autonomous swap execution as the main product.

Those directions dilute the moat and put Pegana into crowded dashboards/notification tools.

### Change

Change the packaging from "dashboard/bot that shows peg movement" to "risk oracle consumed by agents and protocols."

Concrete surface changes:

- publish docs successfully;
- expose pricing on web;
- make x402 paid mainnet visible;
- show trust metrics on the home page;
- add one clear methodology sentence explaining Pyth/oracle + Jupiter/execution quote;
- make free-delayed vs paid-faster the commercial model.

### Defer

Do not promise sub-second product broadly yet.

Sub-second is technically possible later, but today the source architecture is not built for that promise across all assets. Make sub-second an Enterprise/SLA exploration only after:

- paid Jupiter or equivalent DEX quote capacity;
- push-based account subscriptions for on-chain mechanism sources;
- dedicated authenticated WebSocket;
- measured p95/p99 latency report.

## Partner feedback analysis

### "Tem que ser oraculo de preço"

The useful reading is not "replace Pegana with Pyth/Chainlink/Switchboard." The useful reading is:

> Buyers understand "oracle" faster than they understand "Jupiter quote plus intrinsic mechanism model."

Pegana already has oracle inputs and mechanism inputs. The narrative should say:

> Price oracles tell you what the market says. Pegana tells you whether the market price is still consistent with the asset's own peg mechanism.

Recommended methodology copy:

> Pegana reads oracle and mechanism sources for intrinsic value, then compares them against executable market quotes. If we used an oracle on both sides, the peg-risk signal would be smoothed away. The spread is the product.

### "Free com 30s delay, pago instantaneo"

The shape is correct, but the exact numbers need correction.

Recommended model:

| Tier | Latency promise | Price | Audience |
|---|---|---:|---|
| Free | 5-minute delayed REST/dashboard | $0 | retail, demos, early devs |
| Pro | current freshness, higher limits, MCP paid tools, one webhook | $49/mo or $0.001/call x402 | agents, indie protocols |
| Realtime | target sub-10s, dedicated WS/webhook | $499/mo | serious apps, bots, small protocols |
| Enterprise | measured sub-second/SLA after infra work | custom | lending, perps, insurance, institutional risk |

Why not 30 seconds for free? Because current system already lives around that order of latency. A 30-second free tier does not create enough paid pressure. Five-minute delayed is standard market-data psychology: useful for evaluation, weak for action.

Why not promise paid <1s now? Because the current source chain includes Jupiter polling and mechanism-specific reads. Sub-second requires a different source strategy.

## Roadmap

### P0: do now, before more visual lift

1. Fix docs discoverability:
   - either deploy `docs-site` to `docs.pegana.xyz`;
   - or temporarily point all docs URLs to a live fallback.

2. Patch API root discovery:
   - `crates/api-rs/src/routes/health.rs`;
   - replace dead docs URL until DNS/deploy is fixed.

3. Add `/pricing` to the web app:
   - Free, Pro, Realtime, Enterprise;
   - mention x402 paid MCP mainnet as live;
   - mark Realtime/Enterprise as waitlist/SLA-backed, not generally available.

4. Add home trust strip:
   - 22 active assets;
   - alerts in last 24h;
   - delivery failures last 24h;
   - mainnet x402 paid proof;
   - webhook dogfood status.

5. Add methodology copy for "oracle + execution quote":
   - this directly answers the partner concern;
   - no engine rewrite needed.

### P1: within 1-3 days

6. Implement latency-tier policy in product/API docs:
   - write the commercial contract before coding middleware;
   - avoid accidental promises.

7. Add API key/auth plan:
   - keys for Pro/Realtime;
   - x402 pay-per-call remains parallel for agents;
   - Telegram login cannot be the only account path for B2B buyers.

8. Add SIWS or wallet login:
   - unlock `/account/subscriptions` and webhook management for Solana-native buyers;
   - Telegram remains notification auth, not business auth.

9. Finish docs-site deployment:
   - the docs already exist;
   - this is ops/distribution, not content creation.

10. Update launch artifacts:
   - do not say 23 active assets if stats say 22;
   - say "22 active assets" or "20+ Solana pegged assets."

### P2: after dogfood gates

11. Complete calibration v1 by 2026-06-10:
   - p50/p95/p99 by asset;
   - noisy/false-positive classification;
   - threshold changes.

12. Complete webhook dogfood by 2026-06-03:
   - delivery count;
   - 2xx rate;
   - p99 latency;
   - dead-letter count.

13. Build evidence pages:
   - `/events/{id}`;
   - show intrinsic, market, source timestamps, state transition, confidence, raw JSON.

14. Publish one agent demo:
   - agent checks Pegana before entering a pegged asset;
   - agent pays via x402 for a higher-value call.

### P3: real realtime investment

15. Buy/upgrade market-data capacity:
   - Jupiter API paid tier or equivalent execution quote infrastructure.

16. Move mechanism sources toward push:
   - Helius/Triton account subscriptions;
   - reduce polling where source allows.

17. Dedicated paid stream:
   - authenticated WS;
   - replay buffer;
   - signed event receipts;
   - explicit p95/p99 latency SLO.

18. Custody hardening:
   - rotate x402 receiver to hardware-wallet-controlled address before broad paid launch.

## What would be bad for the future

- Continuing visual polish while docs/pricing/trust proof remain broken.
- Claiming sub-second before measurements and source upgrades exist.
- Hiding x402 mainnet in changelog/docs while the home page has no monetization story.
- Making Telegram the primary identity path for B2B users.
- Replacing executable market quotes with oracle-only prices and destroying the signal.
- Launching loudly before calibration and webhook dogfood are summarized.
- Adding broad monitoring features that compete with omniboard/Alertio instead of deepening peg-risk semantics.

## Recommended external response

Suggested message to the partner:

> Boa. Concordo com a estrutura free delayed / paid faster. Vou adaptar isso como pricing: Free com dado atrasado para avaliação, Pro com latência atual e x402 pay-per-call, Realtime com stream dedicada, e Enterprise com SLA quando a infra sub-second estiver medida.
>
> Sobre oracle: a Pegana já lê Pyth e fontes de mecanismo. O ponto é que o sinal não pode ser só oracle agregado, porque oracle suaviza exatamente o movimento curto que quero detectar. O produto é o gap entre valor intrínseco e preço executável no mercado. Vou reescrever a metodologia para deixar isso claro e mais vendável.

## Sources

- Local: `docs/CALIBRATION-v1.md`
- Local: `docs/CALIBRATION-v2-mcp-spike.md`
- Local: `.superstack/idea-context.md`
- Local: `.superstack/build-context.md`
- Local: `crates/api-rs/src/routes/health.rs`
- Local: `web/app/(marketing)/page.tsx`
- Local: `web/components/organisms/hero-landing.tsx`
- Local: `web/components/organisms/channels-section.tsx`
- Local: `assets.toml`
- Live: `https://api.pegana.xyz/`
- Live: `https://api.pegana.xyz/v1/stats`
- Live: `https://api.pegana.xyz/v1/assets/USDC`
- Web: `https://docs.pyth.network/price-feeds/api-instances-and-providers/hermes`
- Web: `https://dev.jup.ag/docs/api-rate-limit`
- Web: `https://solana.com/x402`
- Web: `https://solana.com/x402/what-is-x402`
- Web: `https://colosseum.com/agent-hackathon/projects/stableguard`
- Web: `https://data.chain.link/`
- Web: `https://www.coingecko.com/en/api/pricing`
- Web: `https://www.helius.dev/pricing`

---

## Second-pass decision memo

**Added:** 2026-05-28  
**Purpose:** answer the follow-up request for a higher-certainty decision before implementation.

### Important correction

There is a real product-decision conflict in the repo:

- `docs-site/pricing.mdx` currently says: **"Pegana does not have tiers."**
- This review recommends introducing visible tiers: **Free / Pro / Realtime / Enterprise**.

That is not a copy tweak. It is a product strategy reversal.

The reversal is still recommended, but it must be explicit. The old "no tiers" position made sense when Pegana was an open public feed plus a few x402 agent tools. It is weaker now because:

- the partner's exact objection is "how does this make money?";
- MCP x402 mainnet proof exists but is invisible to buyers;
- competitors package risk monitoring through plans, APIs, alerts, and institutional tiers;
- B2B users expect procurement language: plan, limit, SLA, support, latency.

### Certainty model

No strategic analysis can give absolute certainty. What we can do is assign confidence and reversibility.

| Decision | Confidence | Reversibility | Reason |
|---|---:|---:|---|
| Keep Pegana focused on peg-risk oracle/data layer | Very high | Medium | Strongest moat is vertical mechanism semantics, not generic monitoring. |
| Do not broaden into wallet/NFT/portfolio alerts | Very high | High | Broadening is easy later; doing it now dilutes positioning. |
| Fix docs/DNS before anything else public | Very high | High | Broken docs damages trust immediately and is cheap to fix. |
| Add visible pricing on web | High | High | Can start as packaging/waitlist without enforcing billing. |
| Reverse "no tiers" docs stance | High | Medium | Needed for B2B clarity; must be done deliberately across docs/web. |
| Use free delayed + paid faster packaging | High | Medium | Validated by market-data buying behavior and competitor packaging. |
| Make Free delay 5 minutes instead of 30 seconds | Medium-high | High | 30s is too close to current latency; 5m creates a clearer upgrade boundary. |
| Promise paid sub-second now | Low | Low | Current source architecture cannot honestly guarantee it across all assets. |
| Put sub-second under Enterprise roadmap only | High | High | Lets sales capture demand without lying about current capability. |
| Add SIWS / wallet login | High | Medium | Telegram-only auth blocks B2B buyers from account/webhook flows. |
| Replace Jupiter execution quotes with oracle-only pricing | Very low | Low | This would destroy the intrinsic-vs-market spread signal. |

### External competitor pressure

The second web pass strengthened the same conclusion:

- Webacy's Depeg Monitor packages depeg risk as an API with 5-minute updates, 600+ pegged tokens, and composite risk signals across EVM chains.
- ChainAlerts sells real-time stablecoin depeg alerts with Telegram/Discord, webhooks, REST, and WebSocket for automated bots.
- Alertio positions around broad real-time DeFi monitoring, including stablecoin depegs, lending health, bridge TVL, perp liquidation risk, and governance.
- StableGuard's public Colosseum listing uses the same conceptual ingredients Pegana uses: Pyth, Jupiter liquidity, risk scoring, regimes, and protective action.

This means Pegana is not alone in "depeg monitoring." The defensible lane is narrower:

> Solana-native peg-state oracle with mechanism semantics for LSTs, yield-bearing stables, CDPs, and fiat stables, delivered to agents/protocols via REST, WS, MCP/x402, and signed webhooks.

Do not compete on "we alert depegs too." Compete on "we model why this Solana asset should be pegged, and whether the executable market still agrees."

### Current docs contradiction to fix

`docs-site/pricing.mdx` should be rewritten, not lightly edited.

Current claims to remove or revise:

- "Pegana does not have tiers."
- "Free means free. No API key. No signup."
- "Tier names — we will not invent Pro / Team / Enterprise tiers."
- "SLA contracts — none in v1."

Replacement stance:

- Free remains generous for public reads, but delayed.
- x402 remains the agent-native pay-per-call path.
- Pro/Realtimes tiers exist for buyers who need limits, webhooks, API keys, and freshness guarantees.
- Enterprise is custom and SLA-backed only after latency instrumentation proves the promise.

### Recommended implementation order after this memo

1. **Docs/DNS emergency patch**
   - Deploy `docs-site` or point all docs links to a live fallback.
   - Patch API root `docs` URL.

2. **Pricing strategy rewrite**
   - Update docs pricing stance.
   - Add web `/pricing`.
   - Keep Realtime/Enterprise honest: "available for design partners / measured rollout."

3. **Methodology trust patch**
   - Add the "oracle + executable market quote" explanation.
   - This answers the partner without rewriting the engine.

4. **Home trust strip**
   - Show live proof: 22 assets, alerts last 24h, delivery health, x402 mainnet proof.

5. **Auth/billing foundations**
   - Add wallet login or API keys.
   - Keep Telegram as notification identity, not the only business account identity.

6. **Latency productization**
   - Only after pricing copy is honest.
   - Build delayed free cache first; build paid bypass second; build realtime source upgrades third.

### Hard no-list

Do not do these now:

- Do not promise `<1s` on the public pricing page.
- Do not spend another sprint only on visual lift.
- Do not remove Jupiter quotes from the signal.
- Do not launch loudly before `CALIBRATION-v1.md` and webhook dogfood have real aggregates.
- Do not make "autonomous execution" the core product. Pegana should inform action, not custody user funds.

### Final conviction

The safest future-facing path is:

> Package what already works, fix trust leaks, expose monetization, and defer hard realtime until the source architecture earns it.

That path has the highest upside with the least irreversible technical risk. It turns existing code into a credible product surface without making false latency promises.
