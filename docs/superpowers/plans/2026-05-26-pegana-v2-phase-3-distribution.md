# Pegana v2 — Phase 3 Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live oracle into a publicly-known one. By the end of this plan, the v2 launch announcement is pinned on @PeganaHQ Twitter, Hacker News + Superteam Brasil + Awesome Solana have working demos to link to, at least one autonomous trading agent has cited the Pegana feed publicly, ≥ 1 protocol integration is signed in writing, and (if the next Colosseum hackathon window opens) a competitive submission is filed on the Stablecoins or Infrastructure track.

**Architecture:** Phase 3 is mostly **non-code** — it's distribution, narrative, partnership, and submission work. The two genuinely code-shaped pieces are (1) an outreach packet/site (a one-pager + integration checklist that protocols can hand to their CTO) and (2) the hackathon submission (which requires a 3-minute pitch video, 2-3 minute technical demo video, and the Colosseum project page text). Everything else is operations: tweet drafts, email outreach, social-proof gathering, post-launch metrics watching.

**Tech Stack:** Markdown + light static HTML for the outreach packet and integration checklist. Whatever recording tool the user prefers for the pitch and demo videos (recommended: OBS for screen capture + a simple voiceover script). Twitter (X) for the launch thread. GitHub for Awesome Solana PR.

---

## Scope

This plan covers **Phase 3 (Distribution)** of the SPEC at `docs/superpowers/specs/2026-05-26-pegana-v2-a2-oracle-reframe-design.md`. Specifically:

- Decision #12 Phase 3 #9 — Public launch announcement (Twitter PT+EN, HN Show, Superteam Brasil, Awesome Solana)
- Decision #12 Phase 3 #10 — Outreach to 5 protocols (StableGuard insurance, Parity, Kamino, MarginFi, Reflect)
- Decision #12 Phase 3 #11 — Submit to next Colosseum hackathon if one opens in Q4 2026 (Stablecoins or Infrastructure track)
- Acceptance-criteria items: public launch published + pinned, ≥ 1 autonomous agent cites Pegana publicly, ≥ 1 protocol integration via API or webhook, MCP server listed on at least one MCP directory (already covered in Plan 2 Task F3 — verified here)

**Prerequisites:**
- Plan 1 complete: reframed pegana.xyz live, `CALIBRATION-v1.md` committed, accessibility AA-clean.
- Plan 2 complete: `mcp.pegana.xyz` live with 6 tools, webhook channel live, 3 reference receivers passing test matrix, listed on Smithery + mcp.run.

**Out of scope:**
- v2.1 features (Solana Agent Kit listing, MPP SDK evaluation, on-chain Doppler publisher) — go to a separate v2.1 plan after Phase 3.
- Plan 3 does not block on Colosseum window. If no hackathon opens in Q4 2026, items #11 sub-tasks remain `pending`; everything else still ships.

---

## File Structure

### New documents

| Path | Responsibility |
|---|---|
| `docs/launch/twitter-thread-pt.md` | Portuguese launch thread (3-5 tweets, with screenshots) |
| `docs/launch/twitter-thread-en.md` | English launch thread (same structure) |
| `docs/launch/hn-show-post.md` | Hacker News "Show HN" submission text |
| `docs/launch/superteam-br-post.md` | Superteam Brasil community announcement (Portuguese, longer-form) |
| `docs/launch/awesome-solana-pr.md` | Draft of the Awesome Solana repo PR addition |
| `docs/launch/integration-checklist.md` | One-pager protocols can hand to their engineering team |
| `docs/outreach/template-protocol-email.md` | Outreach email template (subject, body) |
| `docs/outreach/log.md` | Outreach tracking — who, when, response, follow-ups |
| `docs/hackathon/submission-checklist.md` | Pre-flight checklist for Colosseum submission |
| `docs/hackathon/pitch-video-script.md` | 3-minute pitch video script |
| `docs/hackathon/demo-video-script.md` | 2-3 minute technical demo video script |
| `docs/hackathon/project-description.md` | The Colosseum Arena project-page text |

### Modified

| Path | Why |
|---|---|
| `README.md` | Add "Used by" section once first integration lands |
| `web/app/(marketing)/page.tsx` | Add social-proof strip after first integration is announced |
| Twitter (X) bio + pinned tweet | Update bio, pin the launch thread |

---

## Track A — Launch readiness

### Task A1: Pre-launch checklist verification

**Files:**
- Read-only: SPEC acceptance criteria
- Verification only — no commits

- [ ] **Step 1: Verify every Plan 1 + Plan 2 acceptance criterion**

Walk through `docs/superpowers/specs/2026-05-26-pegana-v2-a2-oracle-reframe-design.md` section "Acceptance criteria for v2 launched". Confirm each bullet:

- Hero copy on `pegana.xyz/` reads "The specialized peg-risk oracle for Solana"
- 5-channel cards rendered + link to `/developers#section` anchors
- `/oracle` adds "See the math →" link
- `/methodology` per-class semantics + back-link
- `/dashboard` subtitle "Live state of the oracle"
- `marketing-header` dropdowns ordered correctly
- `mcp.pegana.xyz` live with 6 tools, paid tools work via x402 mainnet
- Webhook: ≥ 7 consecutive days of > 99.5% delivery on Rafael's own dogfood subscriber
- `CALIBRATION-v1.md` committed
- Performance budgets met (verification-spike artifact)
- Webhook receiver test matrix passes for ≥ TypeScript + 1 of (Rust, Python)
- Accessibility WCAG AA clean (axe-core empty)

Print a checklist in the terminal:

```
[x] Hero copy oracle-first
[x] 5 channel cards
[x] /oracle cross-links
[x] /methodology back-links
[x] /dashboard subtitle
[x] /developers TOC + sections
[x] mcp.pegana.xyz live
[x] Paid tools mainnet
[x] Webhook 7-day dogfood pass
[x] CALIBRATION-v1.md committed
[x] Performance budgets met
[x] Webhook receivers pass
[x] Axe-core clean
```

- [ ] **Step 2: If any item is `[ ]`, stop and resolve before continuing**

Phase 3 must not start with broken Phase 1/2 items. Either fix or descope; do not launch over a known gap.

### Task A2: Capture demo screenshots + GIFs

**Files:**
- Create: `docs/launch/assets/` directory

- [ ] **Step 1: Capture 6 screenshots**

Desktop, 1440-wide, dark theme (the only theme):
- `01-landing.png` — full hero with channel cards visible
- `02-dashboard.png` — `/dashboard` with at least one DRIFT visible
- `03-asset-detail.png` — `/asset/jitoSOL` with sparkline
- `04-oracle.png` — `/oracle` pitch page
- `05-methodology.png` — `/methodology` equation
- `06-developers-mcp.png` — `/developers#mcp` section showing MCP catalog

- [ ] **Step 2: Record 2 GIFs (≤ 15s each, ≤ 4 MB)**

- `live-feed.gif` — `/dashboard` showing the live ticker rotate through PEGGED → DRIFT animation
- `mcp-call.gif` — Claude Desktop calling `getAssetState({symbol: "sUSDe"})` and showing the response

Use `ffmpeg -i input.mov -vf "fps=15,scale=1024:-1" -loop 0 out.gif` to compress.

- [ ] **Step 3: Commit**

```bash
git add docs/launch/assets/
git commit -m "docs(launch): demo screenshots + GIFs for v2 announcement"
```

---

## Track B — Public launch announcement

### Task B1: Draft Twitter thread (PT + EN)

**Files:**
- Create: `docs/launch/twitter-thread-pt.md`
- Create: `docs/launch/twitter-thread-en.md`

- [ ] **Step 1: Draft the EN thread (5 tweets)**

Save to `docs/launch/twitter-thread-en.md`:

```markdown
# Twitter thread — English (launch day)

## Tweet 1 (the hook + image: 01-landing.png)
Solana now has a specialized peg-risk oracle.

Pegana v2 is live: 23 LSTs, stablecoins, yield-bearing assets, CDPs, and synthetics — every one tracked with mechanism-aware semantics (NAV / stake-pool / CDP / FX).

Read via REST · WebSocket · MCP · Webhook · Telegram.
🔗 pegana.xyz

## Tweet 2 (the moat + image: 04-oracle.png)
Why specialized?

Price oracles tell you what an asset trades at. They don't tell you whether it's at peg.

Pegana computes both:
- Intrinsic value (what the peg mechanism says)
- Market value (Jupiter quote)
- The gap, smoothed (EWMA) and gated (hysteresis)

→ pegana.xyz/methodology

## Tweet 3 (the channels + image: 06-developers-mcp.png)
v2 launches with 5 read channels:

🔌 REST — JSON over HTTPS, no key, soft rate limit
🌊 WebSocket — sub-second peg-state stream
🤖 MCP — native Model Context Protocol for AI agents (x402 USDC per call)
📬 Webhook — Ed25519-signed POSTs for protocols
✉️  Telegram — human-readable alerts via @PeganaWatchBot

## Tweet 4 (social proof + image: 02-dashboard.png)
Open source · MIT licensed · no API keys for retail · live on mainnet.

Watched and called by agents and protocols building real things.

The math is at pegana.xyz/methodology.
The code is at github.com/lrafasouza/pegana.

## Tweet 5 (CTA + image: live-feed.gif)
If you're an agent builder: connect Pegana via MCP, pay $0.001 USDC per call when you need history.

If you're a protocol: register a webhook at pegana.xyz/account/webhooks.

If you're none of the above: open the dashboard and watch the live state.

🔗 pegana.xyz
```

- [ ] **Step 2: Translate to PT**

Save to `docs/launch/twitter-thread-pt.md` — same structure, PT-BR colloquial. Maintain the technical terms (LST, NAV, EWMA, MCP, Webhook) but use Portuguese connective tissue.

- [ ] **Step 3: Commit**

```bash
git add docs/launch/twitter-thread-pt.md docs/launch/twitter-thread-en.md
git commit -m "docs(launch): Twitter thread drafts PT + EN"
```

### Task B2: Draft Hacker News "Show HN" post

**Files:**
- Create: `docs/launch/hn-show-post.md`

- [ ] **Step 1: Write the post**

```markdown
# HN — Show HN: Pegana — Peg-risk oracle for Solana (LSTs, stables, NAV-aware)

## Title
Show HN: Pegana – Peg-risk oracle for Solana with mechanism-aware semantics

## URL
https://pegana.xyz

## Body
Hi HN — I built Pegana because price oracles on Solana don't tell you what
you actually need to know about pegged assets. A USDe price feed says
"USDe is $0.998" — fine, but that doesn't help if you're trying to decide
whether to keep collateral in a sUSDe pool. The risk dimension is the
*mechanism*: is the NAV still credible, is the stake-pool still accruing,
is the CDP collateral ratio above the floor.

Pegana tracks 23 assets — every actively-traded Solana LST, the major
stablecoins, yield-bearing instruments (USDY, sUSDe, sUSD, etc.), Hylo
CDPs, the xSOL synthetic — and computes per-asset intrinsic value by
mechanism class. We reconcile against the market quote and emit five
distinct peg states (PEGGED ↔ DRIFT ↔ DEPEG ↔ CRITICAL ↔ BLACK_SWAN)
with hysteresis.

Five read channels: REST, WebSocket, native MCP for AI agents (with x402
USDC per-call billing on Solana), Ed25519-signed webhooks for protocols,
and a Telegram bot for retail.

It's MIT, no API keys for retail, runs on Hetzner ARM for $8.50/mo.

Methodology and state machine are at /methodology. Source at
github.com/lrafasouza/pegana.

Happy to answer questions about the math, the architecture, or the
decision to use x402 + MCP for paid tools.
```

- [ ] **Step 2: Plan the submission timing**

HN responds best on weekday mornings US time. Aim for Tuesday or Wednesday 9-10 AM ET. Note the date in the file.

- [ ] **Step 3: Commit**

```bash
git add docs/launch/hn-show-post.md
git commit -m "docs(launch): HN Show post draft"
```

### Task B3: Superteam Brasil announcement

**Files:**
- Create: `docs/launch/superteam-br-post.md`

- [ ] **Step 1: Write the PT-BR post (longer form for community context)**

```markdown
# Superteam Brasil — anúncio Pegana v2 (lançamento)

[Português, ~300 palavras, mais coloquial]

## Título
Pegana v2 — o oracle de peg-risk da Solana, feito por brasileiro

## Corpo
[Abrir com problema: stablecoin/LST no Solana e por que monitorar peg
importa pra quem aloca capital — institucional ou retail.]

[Explicar como Pegana resolve: 23 ativos, semântica por mecanismo
(NAV / stake-pool / CDP / FX), 5 canais de leitura, mainnet em produção,
MIT, brasileiro, open source.]

[Convite específico pra comunidade BR: dashboard em PT-BR + EN, bot
Telegram com locale PT-BR, sem necessidade de wallet pra começar,
free para retail.]

[CTA: três caminhos: usuário comum → @PeganaWatchBot · agente →
mcp.pegana.xyz · protocolo → /account/webhooks. Link pegana.xyz.]

[Fechamento: "Se você tá construindo algo na Solana que toca
stablecoin ou LST e quer feedback técnico, mensagem aberta — Telegram
ou X."]
```

- [ ] **Step 2: Commit**

```bash
git add docs/launch/superteam-br-post.md
git commit -m "docs(launch): Superteam Brasil announcement draft"
```

### Task B4: Awesome Solana PR

**Files:**
- Create: `docs/launch/awesome-solana-pr.md`

- [ ] **Step 1: Fork awesome-solana, find the right section**

Awesome Solana is at github.com/paul-schaaf/awesome-solana. The relevant section is "Tools" or "Oracles". Pegana fits as both an oracle and a developer tool.

- [ ] **Step 2: Draft the entry**

```markdown
# Awesome Solana PR entry

## Section: Oracles (or new "Risk oracles" subsection if needed)

- [Pegana](https://pegana.xyz) - Peg-risk oracle for Solana. Real-time
  intrinsic-vs-market discount for 23 LSTs, stablecoins, yield-bearing
  assets, CDPs, and synthetics. Mechanism-aware (NAV / stake-pool /
  CDP / FX). Read via REST · WebSocket · MCP · Webhook · Telegram.
  MIT licensed.

## PR title
Add Pegana — peg-risk oracle for Solana

## PR body
Pegana is a specialized peg-risk oracle covering 23 Solana assets across
LSTs, stablecoins, yield-bearing assets, CDPs, and synthetics. Each
asset uses its own peg-mechanism semantics (NAV via Pyth Redemption
Rate, stake-pool via Sanctum, CDP via Hylo on-chain decode, FX via
Pyth). Five read channels including a native MCP server for AI agents
with x402 USDC payments.

Live at pegana.xyz · source at github.com/lrafasouza/pegana.
```

- [ ] **Step 3: File the PR after launch announcement**

Sequence matters: tweet + HN first (so the awesome-solana maintainer sees momentum), THEN file the PR. Note the planned PR date in the file.

- [ ] **Step 4: Commit**

```bash
git add docs/launch/awesome-solana-pr.md
git commit -m "docs(launch): Awesome Solana PR draft"
```

### Task B5: Execute launch day

**Files:**
- Operational — Twitter posts, HN submission, Superteam post, Awesome Solana PR

- [ ] **Step 1: Sequence (one day)**

Recommended timing:

| Time (BR) | Action |
|---|---|
| 09:00 | Post EN Twitter thread, pin it |
| 09:15 | Submit HN Show |
| 10:00 | Post PT Twitter thread (or quote-tweet the EN thread + PT translation) |
| 10:30 | Post Superteam Brasil announcement |
| 14:00 | If HN got traction, file Awesome Solana PR |
| 14:00–22:00 | Monitor comments, reply, fix any reported bugs |

- [ ] **Step 2: Update Twitter bio**

Change `@PeganaHQ` bio to: `"The peg-risk oracle for Solana · API · MCP · Webhook · MIT · pegana.xyz"`

- [ ] **Step 3: Pin the EN thread**

In Twitter, pin the first tweet of the EN thread to the profile.

- [ ] **Step 4: Document launch metrics in `docs/launch/post-launch.md`**

After 48 hours, capture:
- HN: rank peak, comment count, sentiment
- Twitter EN: impressions, likes, retweets, replies of substance
- Twitter PT: same metrics
- Superteam BR: comment count, DMs received
- New GitHub stars (pre vs post launch)
- New @PeganaWatchBot subscribers
- Webhook subscriptions registered

Commit `docs/launch/post-launch.md` with the data.

```bash
git add docs/launch/post-launch.md
git commit -m "docs(launch): 48h post-launch metrics"
```

---

## Track C — Protocol outreach

### Task C1: Build the outreach packet

**Files:**
- Create: `docs/launch/integration-checklist.md`
- Create: `docs/outreach/template-protocol-email.md`

- [ ] **Step 1: Write the integration checklist (one-pager)**

```markdown
# Pegana integration checklist (for protocols)

You are a Solana protocol — lending, insurance, prediction markets,
perps, structured products — and you want to consume peg-risk data
from Pegana.

## What Pegana gives you

- Per-asset peg state (PEGGED ↔ DRIFT ↔ DEPEG ↔ CRITICAL ↔ BLACK_SWAN).
- Intrinsic value computed from the *peg mechanism*, not just spot price.
- 23 assets covered out of the box (LSTs, stables, yield-bearing, CDPs, synthetic).
- 4 ways to consume: REST poll, WebSocket stream, MCP tool call, signed webhook POST.

## What you need to integrate (~30 min for read-only, ~2 hours for webhook)

### Read-only consumer
1. `GET https://api.pegana.xyz/v1/stats` — sanity-check connectivity.
2. `wss://api.pegana.xyz/v1/ws` + `{"op":"subscribe","assets":["jitoSOL", ...]}`.
3. Cache state per asset; treat any `to_state ≠ PEGGED` as a signal.

### Signed-webhook consumer (recommended for risk-bearing flows)
1. Stand up an HTTPS endpoint that verifies Ed25519 (sample receivers in TS, Rust, Python at github.com/lrafasouza/pegana/tree/main/docs/examples/webhook-receivers).
2. Register the endpoint at https://pegana.xyz/account/webhooks (one per asset + threshold).
3. Receive signed POSTs on every state transition. Verify signature + 5-minute replay window + dedupe on `alert_id`.

## What we'd like from you in exchange (none of these are blocking)
- A public mention when you go live: tweet, blog post, or Discord message.
- A quote we can include in the v2.1 launch ("Pegana feeds our X liquidation logic" or similar).
- Honest feedback — if our state machine misses an event you care about, please file an issue.

## Pricing
- REST + WebSocket + Telegram: free, forever.
- MCP paid tools ($0.001 + $0.0005): pay per call via x402 USDC on Solana mainnet, no account.
- Webhook channel: contract for protocols with strict SLA needs (~$500-2000/mo negotiated based on volume + criticality). Contact rafael@pegana.xyz.

## Open source + audited
MIT licensed. Methodology at pegana.xyz/methodology. Source at github.com/lrafasouza/pegana. We will respond to security reports within 24h — security@pegana.xyz (or DM Rafael on Telegram).
```

- [ ] **Step 2: Write the outreach email template**

```markdown
# Outreach email template

## Subject
Peg-risk oracle for [Protocol name] — quick read

## Body

Hi [Founder/CTO name],

I built Pegana — a peg-risk oracle for Solana that publishes real-time
state for 23 LSTs, stablecoins, yield-bearing assets, CDPs, and
synthetics, with mechanism-aware semantics (NAV / stake-pool / CDP / FX).

I think it's relevant to [Protocol name] specifically because:

[1-2 sentences customized per protocol]

For [StableGuard insurance]: "Pegana can be your settlement oracle for
depeg claims — third-party, audited methodology, public state history."

For [Parity]: "Pegana resolves peg-state markets without you needing to
operate your own oracle — public methodology + 23-asset coverage."

For [Kamino / MarginFi]: "Pegana's intrinsic-vs-market spread fires
typically 5-15 minutes before a depeg becomes visible on Jupiter quotes
— useful as an upstream signal for your LST collateral risk module."

For [Reflect]: "If you ever want a third-party check on Reflect's own
peg, Pegana can publish that alongside your hedge-backed metrics."

5-minute read of the integration checklist:
https://github.com/lrafasouza/pegana/blob/main/docs/launch/integration-checklist.md

Live: pegana.xyz · MIT · no API keys.

Happy to do a 15-minute call if useful. Either way, would love to know
if peg-risk oracle as a primitive is something [Protocol name] wants to
consume from someone else, or build internally.

— Rafael
```

- [ ] **Step 3: Commit**

```bash
git add docs/launch/integration-checklist.md docs/outreach/template-protocol-email.md
git commit -m "docs(outreach): integration checklist + email template"
```

### Task C2: Send personalized outreach to 5 protocols

**Files:**
- Create: `docs/outreach/log.md`

- [ ] **Step 1: Identify the right contact for each protocol**

| Protocol | Contact | Channel | Notes |
|---|---|---|---|
| StableGuard insurance (Breakout 2025) | Jeevan R (@_Jeevan_R) | Twitter DM or email | Solo builder, friendly |
| Parity (Cypherpunk 2025) | TBD via Colosseum project page | Whatever the project page lists | Prediction market — Pegana = settlement oracle |
| Kamino | engineering@kamino.finance or specific eng contact | Email | Bigger org, formal |
| MarginFi | hello@marginfi.com or DM founder | Email + Twitter DM | Mid-size org |
| Reflect (Radar 2024 GC) | Founder via X | Twitter DM | Stablecoin protocol — natural ally |

- [ ] **Step 2: Customize the template per protocol + send**

Use the email template from C1. Customize the second paragraph for each.

- [ ] **Step 3: Log each send**

```markdown
# Outreach log

| Date | Protocol | Contact | Channel | Status | Response | Next action |
|---|---|---|---|---|---|---|
| 2026-XX-XX | StableGuard | @_Jeevan_R | Twitter DM | sent | | follow up in 7d |
| 2026-XX-XX | Parity | (project page) | email | sent | | follow up in 7d |
| ... | | | | | | |
```

- [ ] **Step 4: Follow up after 7 days if no response**

Single follow-up. After that, leave it for organic discovery.

- [ ] **Step 5: When you get a yes — log it + announce**

```bash
git add docs/outreach/log.md
git commit -m "docs(outreach): [protocol name] integration confirmed"
```

Tweet a thank-you + add to a "Used by" section in README (Task C3).

### Task C3: Update social proof when first integration lands

**Files:**
- Modify: `README.md`
- Modify: `web/app/(marketing)/page.tsx` (add `<SocialProofStrip />`)

- [ ] **Step 1: Add "Used by" section to README**

```markdown
## Used by

- [Protocol name](https://protocol.xyz) — uses Pegana webhook for [purpose]
- [Agent name](https://agent.xyz) — calls Pegana MCP for [purpose]
```

- [ ] **Step 2: Add a `SocialProofStrip` to the landing**

New file: `web/components/organisms/social-proof-strip.tsx`. Renders 3-5 logos with one-line attribution. Insert into landing between `<ChannelCards />` and use-cases.

- [ ] **Step 3: Commit**

```bash
git add README.md web/components/organisms/social-proof-strip.tsx web/app/\(marketing\)/page.tsx
git commit -m "feat(web): social proof strip — first integrations live"
```

---

## Track D — Colosseum hackathon submission (conditional)

**Trigger:** Only execute Track D if Colosseum announces a new hackathon in Q4 2026 with a Stablecoins or Infrastructure track. Otherwise: skip until v2.1 plan.

### Task D1: Confirm window + track fit

**Files:**
- Modify (verify): `docs/hackathon/submission-checklist.md`

- [ ] **Step 1: Check Colosseum announcements**

Visit `colosseum.com/hackathon` and `blog.colosseum.com`. If the next hackathon is announced:
- Capture: name, dates, registration deadline, submission deadline, tracks.
- Decide: Stablecoins, Infrastructure, DeFi, or AI/Payments — which track positions Pegana best?

Recommended track ranking (per landscape v2):
1. **Stablecoins** (MCPay precedent — paid MCP tools settled in USDC)
2. **Infrastructure** (Autonom precedent — specialized vertical oracle)
3. **DeFi** (requires partner integration — softer fit)
4. **AI / Payments** (MCPay/Latinum precedent — strong if MCP is the centerpiece)

- [ ] **Step 2: Register**

Operational — register Pegana on the Colosseum Arena. Capture the project slug for later.

### Task D2: Write the project description

**Files:**
- Create: `docs/hackathon/project-description.md`

- [ ] **Step 1: Draft the Colosseum project page text**

```markdown
# Pegana — peg-risk oracle for Solana

## One-liner
The specialized peg-risk oracle for Solana — mechanism-aware semantics across 23 LSTs, stablecoins, yield-bearing assets, CDPs, and synthetics. Consumed by AI agents (MCP + x402), protocols (signed webhooks), and humans (Telegram).

## Problem
Solana now has $X billion in stablecoin and LST TVL. The risk of any one of those assets losing its peg is real (Drift 2026-04-01, USDC 2023-03-11), and the existing oracle stack is *price-aware* but not *mechanism-aware*. A price oracle tells you sUSDe traded at $0.998. It doesn't tell you whether sUSDe's NAV is still credible.

Lending protocols can't liquidate correctly without it. Insurance can't price premiums without it. Prediction markets can't resolve peg-bets without it. Trading agents enter pools blind.

## Solution
Pegana publishes the peg state of every actively-traded pegged asset on Solana, with mechanism-aware intrinsic value computation:
- LSTs: stake-pool valuation via Sanctum, reconciled with Jupiter market quote.
- Yield-bearing stables: NAV via Pyth Redemption Rate or Token-2022 InterestBearing extension.
- CDP stables (hyUSD): on-chain Hylo Exchange collateral ratio decode.
- FX stables (BRZ): Pyth USD/BRL feed.

EWMA smoothing + 30s/120s hysteresis windows + per-asset thresholds → 5-state machine (PEGGED / DRIFT / DEPEG / CRITICAL / BLACK_SWAN).

## How it works
[400 words on architecture — indexer-rs (6 sources) → engine-rs (state machine) → 5 channels]

## What we built for this hackathon
- mcp.pegana.xyz: 6 MCP tools, 4 free + 2 paid via x402 USDC on Solana mainnet
- Ed25519-signed webhook channel with 3 reference receivers
- 23 actively tracked assets in production
- Full open-source MIT, ~$8.50/mo infra cost

## Demo
- 3-minute pitch video: [URL]
- 2-3 minute technical demo: [URL]
- Live: pegana.xyz
- MCP: mcp.pegana.xyz

## Team
Rafael Souza — solo builder. Based in Brazil.

## Traction
[Number of agent calls / Number of webhook deliveries / Number of protocol integrations as of submission date]
```

- [ ] **Step 2: Commit**

```bash
git add docs/hackathon/project-description.md
git commit -m "docs(hackathon): Colosseum project description draft"
```

### Task D3: Pitch video script (3 minutes)

**Files:**
- Create: `docs/hackathon/pitch-video-script.md`

- [ ] **Step 1: Write the script with timestamps**

```markdown
# Pitch video script — 3:00 max

## Structure
0:00–0:20 — Hook
"Solana now has $X billion in stablecoin and LST TVL. Every one of those
assets can lose its peg. None of the existing oracles tell you that —
they tell you the price, not the mechanism. I built Pegana to fix that."

0:20–0:50 — Problem (with screen recording of a real depeg)
[Show a Solana depeg event — sUSDe in stress, BRZ at -3.6%, dSOL post-exploit.]
"Here's sUSDe under funding-rate inversion. Here's BRZ. Here's dSOL the
hour Drift was exploited. A price oracle saw none of these as
problematic — they all kept trading. Pegana flagged each one within 30
seconds."

0:50–1:30 — How it works (architecture diagram, 30s reading)
"Pegana computes per-asset intrinsic value by mechanism. LSTs use
Sanctum's stake-pool calculator. Yield-bearing stables read Pyth
Redemption Rate. CDPs decode on-chain Hylo state. Each compared against
Jupiter market price, EWMA smoothed, hysteresis gated. The result is a
5-state peg machine, published in real-time."

1:30–2:15 — Five channels (rapid montage)
[Show dashboard, then Telegram alert, then `curl` for REST, then Claude
Desktop calling MCP, then a webhook hitting a sample receiver.]
"Five ways to consume. REST and WebSocket are free. Telegram is the human
read. MCP — built natively into the new Model Context Protocol stack —
lets AI agents read for free, pay $0.001 USDC per call for history.
Webhooks for protocols, Ed25519-signed."

2:15–2:45 — Who reads (social proof — names)
"[Agent X] consumes Pegana to avoid entering pools mid-depeg.
[Protocol Y] uses Pegana's webhook for liquidation risk inputs.
[Insurance Z] resolves claims against Pegana's state history."

2:45–3:00 — Close
"Pegana — the peg-risk oracle for Solana. Live at pegana.xyz. MIT.
Source on GitHub. Thank you."
```

- [ ] **Step 2: Record the video**

Use OBS or similar. Practice 5+ times before the take that ships. Target 2:50-3:00 final length.

- [ ] **Step 3: Upload to Loom or YouTube unlisted**

Get a URL for the Colosseum submission.

- [ ] **Step 4: Commit script + link**

```bash
git add docs/hackathon/pitch-video-script.md
git commit -m "docs(hackathon): pitch video script + recording URL"
```

### Task D4: Technical demo video script (2-3 minutes)

**Files:**
- Create: `docs/hackathon/demo-video-script.md`

- [ ] **Step 1: Write the script**

```markdown
# Technical demo video — 2:30 target

## Structure

0:00–0:20 — Stack overview
"Pegana is six Rust crates plus one TypeScript MCP server plus one
TypeScript bot. Indexer-rs polls six sources. Engine-rs runs the state
machine. Dispatcher-rs fans out Telegram + webhooks. Api-rs serves REST
+ WebSocket. Mcp-ts serves agents with x402 USDC. Postgres TimescaleDB +
Redis pub/sub glue."

0:20–1:00 — Live tracing of an alert
[Live screen: `psql` window + `redis-cli MONITOR` + Telegram chat.]
"I'll trigger a synthetic peg breach on jitoSOL. Watch the state machine
move: engine-rs publishes to Redis, dispatcher-rs picks it up, fans out
to Telegram, signs an Ed25519 payload, POSTs to my Cloudflare worker.
Total latency from breach to webhook delivery: under one second."

1:00–1:40 — MCP + x402 walkthrough
[Live screen: Claude Desktop configured with mcp.pegana.xyz.]
"I'll ask Claude: 'check sUSDe peg state'. Claude calls `getAssetState`
— that's free. Now: 'show me 30 days of sUSDe history'. That triggers
`getAssetHistory`, which is paid. Claude pays $0.001 USDC via x402 — no
API key, no account. Settlement confirmed on Solana mainnet. Data
returned."

1:40–2:10 — Webhook receiver
[Live screen: tail of a Cloudflare worker log, paired with the receiver
source code on the left.]
"Here's the webhook reference receiver in TypeScript on Cloudflare. 12
lines verify Ed25519 with the Web Crypto API. The same logic in Rust
(axum) and Python (FastAPI) is in the repo."

2:10–2:30 — Open source + close
"Everything you saw — the stack, the math, the deployed infrastructure —
is MIT licensed on GitHub. Pegana runs on a Hetzner CAX21 ARM box for
$8.50 a month. Methodology at pegana.xyz/methodology. Thank you."
```

- [ ] **Step 2: Record + upload + commit**

Same process as D3.

```bash
git add docs/hackathon/demo-video-script.md
git commit -m "docs(hackathon): technical demo video script + recording URL"
```

### Task D5: Final submission

**Files:**
- Operational — Colosseum Arena submission form

- [ ] **Step 1: Pre-flight check**

Use `docs/hackathon/submission-checklist.md` to verify each requirement:

- [ ] Project description text (Task D2)
- [ ] Pitch video URL ≤ 3 min (Task D3)
- [ ] Technical demo URL 2-3 min (Task D4)
- [ ] GitHub repo URL (public; current main branch)
- [ ] Demo URL (pegana.xyz live)
- [ ] Team info
- [ ] Track selection
- [ ] Optional: presentation deck (if Colosseum requires one)

- [ ] **Step 2: Submit before deadline**

Submit on Colosseum Arena. Capture the project URL.

- [ ] **Step 3: Tweet the submission**

```
Pegana is in the [hackathon name] [track] track.

Specialized peg-risk oracle for Solana — 23 assets, mechanism-aware, five channels.

[Colosseum project URL]
```

- [ ] **Step 4: Document the submission**

```bash
# Add to docs/hackathon/submission-checklist.md the final state
git add docs/hackathon/submission-checklist.md
git commit -m "docs(hackathon): Colosseum submission filed"
```

---

## Track E — Post-launch monitoring (passive, ~14 days)

### Task E1: Weekly metric snapshot

**Files:**
- Append-only: `docs/launch/post-launch.md`

- [ ] **Step 1: Capture once per week for 4 weeks**

For each week:
- MCP tool call count (Prometheus: `sum(pegana_mcp_tool_calls_total) - prev_week`)
- Paid call count (`pegana_mcp_payments_total{status="success"}`)
- Unique `payTo` callers (from log analysis)
- Webhook subscriptions registered
- Webhook deliveries success rate
- New Telegram bot subscribers
- GitHub stars delta
- Twitter follower delta
- Inbound integration asks (DMs, emails) — qualitative

- [ ] **Step 2: Append to `docs/launch/post-launch.md`**

```markdown
## Week N (date range)
- MCP calls: X (paid: Y)
- Webhook deliveries: X (success rate: Y%)
- New Telegram subs: X
- GitHub stars: +X
- Twitter followers: +X
- Inbound asks: [list]
- Issues raised: [list with severity]
```

- [ ] **Step 3: Commit weekly**

```bash
git add docs/launch/post-launch.md
git commit -m "docs(launch): week N post-launch metrics"
```

### Task E2: First regression / incident review

**Files:**
- Create: `docs/incident-YYYY-MM-DD-<slug>.md` if any incident happens

- [ ] **Step 1: For any post-launch incident (false-positive burst, MCP outage, webhook failure cluster) write a post-mortem**

Use the pattern in `docs/incident-2026-05-25-lst-burst.md`. Include:
- Summary, severity, detected at, resolved at
- Impact (user-facing + reputational)
- Root cause
- Detection (how Pegana noticed, or how a user reported)
- Resolution
- Lessons learned + follow-ups

- [ ] **Step 2: Publish the post-mortem publicly (if any)**

Tweet the link. Building trust by being transparent about incidents.

- [ ] **Step 3: Commit**

```bash
git add docs/incident-YYYY-MM-DD-*.md
git commit -m "docs(incident): YYYY-MM-DD <slug> post-mortem"
```

### Task E3: Decide v2.1 scope at week 4

**Files:**
- Create: `docs/superpowers/specs/2026-MM-DD-pegana-v2.1-design.md` (next spec)

- [ ] **Step 1: Review the 4 weeks of metrics**

Aggregate the weekly snapshots. Compare against acceptance-criteria targets from the SPEC:

| Target | Status |
|---|---|
| ≥ 1 autonomous agent cites Pegana publicly | ? |
| ≥ 1 protocol integration | ? |
| ≥ 25 agents consuming MCP by day 180 (target) | ? (week 4 should show baseline trajectory) |
| Hackathon placement (if applicable) | ? |

- [ ] **Step 2: Choose v2.1 priorities**

From the SPEC "Ecosystem adjacencies" table, the candidates are:
- Solana Agent Kit listing (highest distribution multiplier)
- MPP SDK evaluation (if x402 facilitator is a hot path issue)
- Doppler on-chain publisher (if a protocol asked)
- Telegram Mini App (if mobile traffic > 60%)
- Discord adapter (if a community asked twice)

Pick the top 1-3 based on actual signal from post-launch metrics.

- [ ] **Step 3: Open a new SPEC for v2.1**

Start a new brainstorming session for v2.1 with the post-launch metrics as primary input. End of Phase 3 + start of v2.1 — that's the v2 launch arc completed.

- [ ] **Step 4: Commit the v2.1 design spec when ready**

```bash
git add docs/superpowers/specs/2026-MM-DD-pegana-v2.1-design.md
git commit -m "spec(v2.1): scope based on 4-week post-launch metrics"
```

---

## Self-Review

### Spec coverage

| SPEC requirement | Covered by Task |
|---|---|
| Decision #12 Phase 3 #9 — Public launch (Twitter PT+EN, HN, Superteam, Awesome Solana) | B1, B2, B3, B4, B5 |
| Decision #12 Phase 3 #10 — Outreach to 5 protocols | C1, C2 |
| Decision #12 Phase 3 #11 — Colosseum hackathon submission | D1–D5 (conditional on window) |
| Acceptance: public launch published + pinned | B5 |
| Acceptance: ≥ 1 autonomous agent cites Pegana publicly | C2 (outreach), E1 (measurement) |
| Acceptance: ≥ 1 protocol integration | C2, C3 |
| Acceptance: MCP server listed on ≥ 1 directory | Plan 2 Task F3 (referenced from A1 pre-flight verification) |
| Operational: monthly health sweep cron | Plan 1 Task F1 (already done) |
| Out of scope: v2.1 features (Solana Agent Kit, MPP SDK, Doppler, Mini App, Discord) | E3 (v2.1 spec written based on post-launch signal) |

### Placeholder scan

Searched for "TBD", "TODO", "fill in", "...". Intentional placeholders only:
- Email template placeholders (`[Founder/CTO name]`, `[Protocol name]`, `[1-2 sentences customized per protocol]`) — these are intentional template gaps for the user to fill at send time. Per-protocol customizations provided as concrete examples in Task C1.
- Hackathon submission date / track / Colosseum URL — left as `[?]` because they depend on Colosseum announcing the next hackathon. Task D1 explicitly says "Only execute Track D if a hackathon window opens."
- Week N / YYYY-MM-DD slugs in post-launch and incident docs — these are date-bound and filled at write time.

No unintentional placeholders.

### Type consistency

- "Used by" section format in README is consistent across Task C3.
- All Colosseum video URLs are tracked in `docs/hackathon/` files.
- All outreach contacts tracked in single `docs/outreach/log.md`.
- Twitter handle `@PeganaHQ` used consistently across all tweet drafts.

No inconsistencies found.

### Phase 3 character note

Phase 3 is mostly non-code. The `Self-Review > Type consistency` check above is short by design — there are few types to be consistent about. The bigger risk in Phase 3 is **stale dates and stale URLs**: every reference to a Colosseum window, a hackathon track, a competitor name, or a partner protocol is a real-world fact that can change between when this plan is written and when it executes. The execution should verify each external claim at the moment it's about to be posted, not assume the plan's snapshot is current.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-pegana-v2-phase-3-distribution.md`. Two execution options:

**1. Subagent-Driven (recommended for Tracks A + D + content drafting)** — dispatch a subagent to draft each artifact (tweet thread, HN post, video script, etc.). The user reviews each artifact before posting/recording.

**2. Inline Execution (recommended for Tracks B5 + C2 + D5)** — operational tasks (posting tweets, sending DMs, submitting to Colosseum) are real-world actions the user takes personally. The plan provides the artifacts; the user executes the click.

**Mixed-mode is fine and likely correct: use Subagents to generate, the user (Rafael) to act.**

**Which approach?**
